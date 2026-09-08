/* ============================================================
   Sonora player engine
   Queue, shuffle, repeat, scrubbing, volume, Media Session,
   play logging, and graceful handling of unplayable tracks.
   ============================================================ */

import { api, streamUrl, isPlayable, toast } from './core.js';

const audio = new Audio();
audio.preload = 'metadata';
audio.crossOrigin = 'anonymous';

const listeners = new Set();

export const player = {
  queue: [],
  originalQueue: [],
  index: -1,
  current: null,
  playing: false,
  loading: false,
  shuffle: false,
  repeat: 'off', // off | all | one
  radio: false, // endless similar-track auto-play
  radioSeed: null,
  volume: 0.8,
  muted: false,
  progress: 0,
  duration: 0,
  buffered: 0,
  error: null,
};

// ids we've already pulled into a radio session, so the same track doesn't
// come back around until the well runs dry.
let radioPool = new Set();
// Holds the in-flight refill promise (or null). Concurrent callers await the
// same job so queue-advance never races an in-progress top-up.
let radioBusy = null;

/* -------------------------------------------------------- persist */

const PREFS_KEY = 'sonora:prefs';

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    if (typeof p.volume === 'number') player.volume = Math.min(1, Math.max(0, p.volume));
    if (typeof p.muted === 'boolean') player.muted = p.muted;
    if (['off', 'all', 'one'].includes(p.repeat)) player.repeat = p.repeat;
    if (typeof p.shuffle === 'boolean') player.shuffle = p.shuffle;
  } catch {
    /* first run */
  }
  audio.volume = player.volume;
  audio.muted = player.muted;
}

function savePrefs() {
  try {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        volume: player.volume,
        muted: player.muted,
        repeat: player.repeat,
        shuffle: player.shuffle,
      })
    );
  } catch {
    /* private mode */
  }
}

loadPrefs();

/* --------------------------------------------------------- events */

export function onPlayerChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(player);
}

/* ---------------------------------------------------- play logging */

let logged = new Set();
let playedMs = 0;
let lastTick = 0;

function logPlay(track, ms) {
  if (!track || logged.has(track.id)) return;
  logged.add(track.id);
  api.post('/api/plays', { track, ms }).catch(() => {
    /* analytics is best-effort */
  });
}

/* ------------------------------------------------------ audio wire */

audio.addEventListener('loadstart', () => {
  player.loading = true;
  emit();
});
audio.addEventListener('canplay', () => {
  player.loading = false;
  emit();
});
audio.addEventListener('loadedmetadata', () => {
  player.duration = Number.isFinite(audio.duration) ? audio.duration * 1000 : player.current?.durationMs || 0;
  player.loading = false;
  emit();
});
audio.addEventListener('timeupdate', () => {
  player.progress = audio.currentTime * 1000;
  const now = Date.now();
  if (lastTick && player.playing) playedMs += now - lastTick;
  lastTick = now;
  // count as a play after 8s (or 40% for short previews)
  const threshold = Math.min(8000, (player.duration || 30000) * 0.4);
  if (playedMs > threshold && player.current) logPlay(player.current, playedMs);
  if (audio.buffered.length) {
    player.buffered = audio.buffered.end(audio.buffered.length - 1) * 1000;
  }
  emit();
});
audio.addEventListener('play', () => {
  player.playing = true;
  lastTick = Date.now();
  emit();
});
audio.addEventListener('pause', () => {
  player.playing = false;
  lastTick = 0;
  emit();
});
audio.addEventListener('ended', () => {
  player.playing = false;
  if (player.repeat === 'one') {
    audio.currentTime = 0;
    audio.play().catch(() => {});
    return;
  }
  // Endless radio: keep the feed topped up so we never dead-end. We only hit
  // /api/ai/similar when the queue is running low (last 2 tracks), so a long
  // queue doesn't cost us a fetch + toast per song. next() then advances into
  // whatever we just appended.
  if (player.radio) {
    if (player.index >= player.queue.length - 2) {
      refillRadio().then(() => next({ auto: true }));
    } else {
      next({ auto: true });
    }
    return;
  }
  next({ auto: true });
});
/**
 * Codec capability probe.
 *
 * Apple/iTunes previews are AAC-in-MP4. Chrome, Edge and Safari decode that
 * fine, but Chromium builds compiled without proprietary codecs (very common
 * on Linux) do not — the <audio> element just throws MediaError 4. Rather than
 * showing the user a dead row, detect it up front and ask the server for an
 * MP3 source from another provider.
 */
const canDecodeAac = (() => {
  const probe = document.createElement('audio');
  return Boolean(probe.canPlayType('audio/mp4; codecs="mp4a.40.2"'));
})();

const AAC_ISH = /\.m4a(\?|$)|itunes-assets|mzstatic/i;
const resolveAttempts = new Set();

function needsResolve(track) {
  if (!track) return false;
  const url = track.streamUrl || track.previewUrl || '';
  return !canDecodeAac && AAC_ISH.test(url);
}

/** Swap the current track's source for one this browser can actually decode. */
async function resolveAlternate(track, reason) {
  if (!track || resolveAttempts.has(track.id)) return false;
  resolveAttempts.add(track.id);
  try {
    const { track: resolved, changed } = await api.post('/api/tracks/resolve', {
      track,
      preferFormat: 'mp3',
      excludeProviders: canDecodeAac ? [] : ['itunes'],
    });
    if (!changed) return false;

    // patch the queue in place so skipping back also uses the good source
    const idx = player.queue.findIndex((t) => t.id === track.id);
    if (idx !== -1) player.queue[idx] = { ...player.queue[idx], ...resolved };
    const oidx = player.originalQueue.findIndex((t) => t.id === track.id);
    if (oidx !== -1) player.originalQueue[oidx] = { ...player.originalQueue[oidx], ...resolved };
    if (player.current?.id === track.id) player.current = { ...player.current, ...resolved };

    const src = streamUrl(resolved);
    if (!src) return false;
    audio.src = src;
    audio.load();
    audio.play().catch(() => {});
    player.error = null;
    emit();
    if (reason === 'error') toast(`Found a playable source via ${resolved.resolvedFrom || 'another provider'}`, 'info');
    return true;
  } catch {
    return false;
  }
}

audio.addEventListener('error', async () => {
  if (!player.current) return;
  const failed = player.current;
  player.loading = false;
  player.playing = false;
  emit();

  // first try to heal the source (codec mismatch, dead CDN link)
  const healed = await resolveAlternate(failed, 'error');
  if (healed) return;

  player.error = 'Could not play this track';
  emit();
  // auto-advance past a dead source rather than stalling the queue
  if (player.queue.length > 1) setTimeout(() => next({ auto: true }), 700);
  else toast(`No playable audio for "${failed.title}"`, 'error');
});

/* ------------------------------------------------- media session */

function updateMediaSession(track) {
  if (!('mediaSession' in navigator) || !track) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || 'Unknown',
      artist: track.artist || '',
      album: track.album || 'Sonora',
      artwork: track.artwork
        ? [
            { src: track.artwork, sizes: '512x512', type: 'image/jpeg' },
            { src: track.artworkSmall || track.artwork, sizes: '128x128', type: 'image/jpeg' },
          ]
        : [],
    });
    navigator.mediaSession.setActionHandler('play', () => togglePlay());
    navigator.mediaSession.setActionHandler('pause', () => togglePlay());
    navigator.mediaSession.setActionHandler('previoustrack', () => prev());
    navigator.mediaSession.setActionHandler('nexttrack', () => next());
  } catch {
    /* unsupported */
  }
}

/* ------------------------------------------------------------ radio */

/**
 * Pull more similar tracks for the current/seed track and append them to the
 * queue so playback continues indefinitely. Works offline: /api/ai/similar
 * runs on the deterministic engine against the local catalog.
 */
async function refillRadio() {
  if (!player.radio) return;
  if (radioBusy) return radioBusy; // already topping up; join that job
  // Seed on the *last played* track (the one currently buffering/just-ended),
  // so the "similar" neighborhood drifts with what you actually hear instead of
  // staying pinned to the very first track. Falls back to the session seed.
  const seed = player.current || player.radioSeed;
  if (!seed) return;
  player.radioSeed = seed; // keep the session seed in sync with what we play

  const job = (async () => {
    try {
      const { tracks } = await api.post('/api/ai/similar', { track: seed, limit: 20 });

      // Radio may have been toggled off (or the queue cleared) while the
      // request was in flight — don't mutate anything or toast in that case.
      if (!player.radio) return;

      // No repeats until the well runs dry: skip anything we've already pulled
      // into this session's pool AND anything still queued.
      let fresh = (tracks || [])
        .filter(isPlayable)
        .filter((t) => !radioPool.has(t.id) && !player.queue.some((q) => q.id === t.id))
        .slice(0, 12);

      if (!fresh.length) {
        // The pool is exhausted — reset so we can cycle the neighborhood
        // again. A short recency window (plus the current track) stops us
        // re-queuing the track that just played or the wave before it, while
        // letting older tracks return so radio truly loops, not dead-ends.
        radioPool = new Set();
        fresh = (tracks || [])
          .filter(isPlayable)
          .filter((t) => t.id !== player.current?.id && !player.queue.slice(-10).some((q) => q.id === t.id))
          .slice(0, 12);
        if (!fresh.length) {
          // genuinely nothing new — stop rather than dead-end silently
          player.radio = false;
          player.radioSeed = null;
          emit();
          toast('Radio stopped — no more related tracks found', 'info');
          return;
        }
      }

      for (const t of fresh) radioPool.add(t.id);
      player.queue.push(...fresh);
      player.originalQueue.push(...fresh);
      emit();
      toast(`Radio: ${fresh.length} more like ${seed.title || 'this'}`, 'info', 1800);
    } catch {
      /* best effort — stop radio rather than loop on errors */
      if (!player.radio) return; // user already turned it off; stay quiet
      player.radio = false;
      player.radioSeed = null;
      emit();
      toast('Radio stopped — could not find more tracks', 'info');
    }
  })();

  radioBusy = job;
  try {
    return await job;
  } finally {
    radioBusy = null;
  }
}

/** Turn endless radio on/off. When turning on, immediately top up the queue. */
export function toggleRadio() {
  player.radio = !player.radio;
  if (player.radio && player.current) {
    player.radioSeed = player.current;
    radioPool = new Set([player.current.id]);
    refillRadio();
  }
  emit();
}

/**
 * Start playing a track and keep feeding from its "sound-a-likes".
 * Sets up the radio session and seeds the queue after playQueue has run
 * (playQueue intentionally clears radio for normal queues).
 */
export async function startRadio(track) {
  if (!isPlayable(track)) {
    toast(`"${track.title}" has no playable audio from this source`, 'error');
    return;
  }
  // playQueue clears radio for normal queues, so arm the session *after* it.
  playQueue([track], 0, { queueName: `Radio · ${track.artist}` });
  player.radio = true;
  player.radioSeed = track;
  radioPool = new Set([track.id]);
  // the first track is playing; pre-fill the next wave immediately
  refillRadio();
}

/* ------------------------------------------------------------ api */

function shuffled(list, keepFirst) {
  const arr = [...list];
  const first = keepFirst !== undefined ? arr.splice(keepFirst, 1)[0] : null;
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return first ? [first, ...arr] : arr;
}

/** Load a queue and start at `startIndex`. */
export function playQueue(tracks, startIndex = 0, { queueName = '' } = {}) {
  const playable = tracks.filter(isPlayable);
  if (!playable.length) {
    toast('No playable audio in this selection', 'error');
    return;
  }
  // remap the requested index into the filtered list
  const wanted = tracks[startIndex];
  let idx = playable.findIndex((t) => t.id === wanted?.id);
  if (idx === -1) idx = 0;

  // A normal queue supersedes any radio session (callers opt back in via
  // startRadio / toggleRadio).
  player.radio = false;
  player.radioSeed = null;
  player.originalQueue = playable;
  player.queueName = queueName;
  if (player.shuffle) {
    player.queue = shuffled(playable, idx);
    player.index = 0;
  } else {
    // Must copy the array so queue and originalQueue don't share a
    // reference — addToQueue pushes to both, and with a shared reference
    // the track would be added twice.
    player.queue = [...playable];
    player.index = idx;
  }
  loadCurrent(true);
}

export function playTrack(track, contextTracks = null, { queueName = '' } = {}) {
  if (!isPlayable(track)) {
    toast(`"${track.title}" has no playable audio from this source`, 'error');
    return;
  }
  if (contextTracks?.length) {
    const idx = contextTracks.findIndex((t) => t.id === track.id);
    playQueue(contextTracks, idx === -1 ? 0 : idx, { queueName });
  } else {
    playQueue([track], 0, { queueName });
  }
}

function loadCurrent(autoplay = true) {
  const track = player.queue[player.index];
  if (!track) return;
  player.current = track;
  player.error = null;
  player.progress = 0;
  player.buffered = 0;
  player.duration = track.durationMs || 0;
  playedMs = 0;
  lastTick = 0;

  const src = streamUrl(track);
  if (!src) {
    player.error = 'No audio source';
    emit();
    return;
  }

  // proactive swap: this browser cannot decode AAC and the source is Apple's
  if (needsResolve(track)) {
    player.loading = true;
    emit();
    resolveAlternate(track, 'proactive').then((healed) => {
      if (!healed) {
        audio.src = src;
        audio.load();
        if (autoplay) audio.play().catch(() => {});
      }
    });
    updateMediaSession(track);
    emit();
    return;
  }

  audio.src = src;
  audio.load();
  updateMediaSession(track);
  if (autoplay) {
    audio.play().catch((err) => {
      // autoplay policy: user gesture required
      if (err?.name === 'NotAllowedError') {
        player.playing = false;
        toast('Tap play to start audio', 'info');
      }
    });
  }
  emit();
}

export function togglePlay() {
  if (!player.current) return;
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
}

export function next({ auto = false } = {}) {
  if (!player.queue.length) return;
  const last = player.index >= player.queue.length - 1;
  if (last) {
    if (player.repeat === 'all') {
      player.index = 0;
      loadCurrent(true);
    } else if (auto) {
      player.playing = false;
      player.progress = 0;
      audio.pause();
      emit();
    } else {
      player.index = 0;
      loadCurrent(true);
    }
    return;
  }
  player.index += 1;
  loadCurrent(true);
}

export function prev() {
  if (!player.queue.length) return;
  // restart the track first, like every real player does
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  if (player.index <= 0) {
    if (player.repeat === 'all') player.index = player.queue.length - 1;
    else {
      audio.currentTime = 0;
      return;
    }
  } else {
    player.index -= 1;
  }
  loadCurrent(true);
}

export function seek(ratio) {
  if (!player.duration || !player.current) return;
  const target = Math.max(0, Math.min(1, ratio)) * (player.duration / 1000);
  if (Number.isFinite(target)) {
    audio.currentTime = target;
    player.progress = target * 1000;
    emit();
  }
}

export function setVolume(v) {
  player.volume = Math.max(0, Math.min(1, v));
  audio.volume = player.volume;
  if (player.volume > 0 && player.muted) {
    player.muted = false;
    audio.muted = false;
  }
  savePrefs();
  emit();
}

export function toggleMute() {
  player.muted = !player.muted;
  audio.muted = player.muted;
  savePrefs();
  emit();
}

export function toggleShuffle() {
  player.shuffle = !player.shuffle;
  if (player.shuffle) {
    const cur = player.queue[player.index];
    const rest = player.queue.filter((_, i) => i !== player.index);
    player.queue = [cur, ...shuffled(rest)].filter(Boolean);
    player.index = 0;
  } else if (player.originalQueue.length) {
    const cur = player.current;
    player.queue = [...player.originalQueue];
    player.index = Math.max(0, player.queue.findIndex((t) => t.id === cur?.id));
  }
  savePrefs();
  emit();
}

export function cycleRepeat() {
  player.repeat = player.repeat === 'off' ? 'all' : player.repeat === 'all' ? 'one' : 'off';
  savePrefs();
  emit();
}

export function addToQueue(track) {
  if (!isPlayable(track)) {
    toast('That track has no playable audio', 'error');
    return;
  }
  player.queue.push(track);
  player.originalQueue.push(track);
  if (player.index === -1) {
    player.index = 0;
    loadCurrent(true);
  }
  emit();
  toast(`Added "${track.title}" to queue`, 'success');
}

export function removeFromQueue(index) {
  if (index < 0 || index >= player.queue.length) return;
  const [removed] = player.queue.splice(index, 1);
  player.originalQueue = player.originalQueue.filter((t) => t.id !== removed.id);
  if (index < player.index) player.index -= 1;
  else if (index === player.index) {
    if (player.index >= player.queue.length) player.index = player.queue.length - 1;
    if (player.index >= 0) loadCurrent(player.playing);
    else {
      audio.pause();
      audio.src = '';
      player.current = null;
      player.playing = false;
    }
  }
  emit();
}

export function clearQueue() {
  audio.pause();
  audio.src = '';
  player.queue = [];
  player.originalQueue = [];
  player.index = -1;
  player.current = null;
  player.playing = false;
  player.progress = 0;
  player.radio = false;
  player.radioSeed = null;
  radioPool = new Set();
  radioBusy = null;
  emit();
}

/* ------------------------------------------------------- shortcuts */

document.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  switch (e.key) {
    case ' ':
      if (player.current) {
        e.preventDefault();
        togglePlay();
      }
      break;
    case 'ArrowRight':
      if (e.shiftKey) {
        e.preventDefault();
        next();
      } else if (player.current) {
        e.preventDefault();
        seek((player.progress + 5000) / player.duration);
      }
      break;
    case 'ArrowLeft':
      if (e.shiftKey) {
        e.preventDefault();
        prev();
      } else if (player.current) {
        e.preventDefault();
        seek((player.progress - 5000) / player.duration);
      }
      break;
    case 'ArrowUp':
      e.preventDefault();
      setVolume(player.volume + 0.05);
      break;
    case 'ArrowDown':
      e.preventDefault();
      setVolume(player.volume - 0.05);
      break;
    case 'm':
      toggleMute();
      break;
    case 's':
      toggleShuffle();
      break;
    case 'r':
      cycleRepeat();
      break;
    default:
      break;
  }
});

/* Debug/test hook: the Audio element is never attached to the DOM, so tests
   and devtools need a handle on it. Harmless in production. */
if (typeof window !== 'undefined') window.__sonora = { player, audio };

export { audio };
