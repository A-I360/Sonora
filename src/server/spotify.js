'use strict';
/**
 * Spotify connector — user OAuth, playlist import, offline download.
 *
 * This sits on top of the provider registry. Two modes:
 *
 *  REAL  — requires SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET (and network).
 *          The user clicks "Connect Spotify", authorises in their browser,
 *          and we store an access token. We then list their playlists, pull
 *          every track, find a playable source via the key-free providers, and
 *          cache the audio to disk so the playlist plays offline.
 *
 *  DEMO  — no credentials / no network. We simulate a connected Spotify user
 *          whose playlists are drawn from the built-in, network-free Sonora
 *          Sampler catalog. Everything — connect, list, download, offline
 *          playback — still works so the whole flow is exercisable anywhere.
 *
 * Activate demo with SPOTIFY_DEMO=1, or it auto-activates when no credentials
 * are configured (and is clearly labelled in the UI as simulated).
 */

const crypto = require('node:crypto');
const { db, id } = require('./store');
const providers = require('./providers');
const audioCache = require('./audioCache');
const { fetchRaw, fetchBuffer } = require('./fetchx');
const spotifyProvider = require('./providers/spotify');

const DEMO_MODE = () => process.env.SPOTIFY_DEMO === '1' || !spotifyProvider.isEnabled();

// In-memory CSRF state for the OAuth redirect (survives the round trip).
const pendingStates = new Map();

function isConfigured() {
  return spotifyProvider.isEnabled();
}

function redirectUri() {
  return (
    process.env.SPOTIFY_REDIRECT_URI ||
    `${process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:3000'}/api/spotify/callback`
  );
}

/* ------------------------------------------------------- token store */

function storeToken(userId, data) {
  const user = db.users.get(userId);
  if (!user) return;
  const spotify = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    id: data.id || data.spotify_id || null,
    displayName: data.displayName || null,
    email: data.email || null,
    mode: 'real',
    connectedAt: new Date().toISOString(),
  };
  db.users.update(userId, { spotify });
  return spotify;
}

function clearToken(userId) {
  db.users.update(userId, { spotify: null });
}

function token(userId) {
  const user = db.users.get(userId);
  const s = user && user.spotify;
  if (!s || !s.accessToken) return null;
  return s;
}

function isReal(userId) {
  const s = token(userId);
  return Boolean(s && s.mode === 'real' && s.accessToken);
}

function status(userId) {
  if (DEMO_MODE()) {
    const s = userId ? token(userId) : null;
    const connected = Boolean(s && s.mode === 'demo' && s.displayName);
    return {
      configured: false,
      demo: true,
      connected,
      mode: 'demo',
      user: connected
        ? { id: s.id, displayName: s.displayName, email: s.email }
        : null,
      note: 'Simulated mode — connect credentials in .env to use a real Spotify account.',
      redirectUri: null,
    };
  }
  const s = userId ? token(userId) : null;
  const connected = Boolean(s);
  return {
    configured: true,
    demo: false,
    connected,
    mode: 'real',
    user: connected ? { id: s.id, displayName: s.displayName, email: s.email } : null,
    note: connected
      ? 'Connected to your real Spotify account.'
      : 'Connect your Spotify account to import and download playlists for offline listening.',
    redirectUri: redirectUri(),
  };
}

/* ------------------------------------------------------------ demo data */

const DEMO_PLAYLISTS = [
  { id: 'demo-pl-afrobeats-hit', name: 'Afrobeats Heat', description: 'Naija & amapiano energy', public: true, owner: 'Sonora', tracks: 8 },
  { id: 'demo-pl-latenight', name: 'Late Night Drive', description: 'Moody, chill, after dark', public: true, owner: 'Sonora', tracks: 8 },
  { id: 'demo-pl-90s', name: '90s Throwback', description: 'Classics that still bang', public: true, owner: 'Sonora', tracks: 6 },
  { id: 'demo-pl-chill', name: 'Focus & Lo-fi', description: 'Instrumentals for deep work', public: true, owner: 'Sonora', tracks: 6 },
];

// slug lists per demo playlist — every slug exists in demo.catalog.
const DEMO_TRACK_MAP = {
  'demo-pl-afrobeats-hit': [
    'burna-boy-last-last', 'wizkid-essence', 'rema-calm-down', 'davido-unavailable',
    'ayra-starr-rush', 'fireboy-peru', 'asake-terminator', 'omah-lay-soso',
  ],
  'demo-pl-latenight': [
    'tems-free-mind', 'frank-ocean-pink-white', 'her-damage', 'sza-kill-bill',
    'kina-can-we-kiss-forever', 'major-league-piano-mapula', 'sha-sha-tender', 'kabza-sponono',
  ],
  'demo-pl-90s': [
    'lauryn-hill-doo-wop', 'tupac-california-love', 'aaliyah-try-again', 'kanye-stronger',
    'jcole-no-role-modelz', 'nujabes-feather',
  ],
  'demo-pl-chill': [
    'nujabes-feather', 'jdilla-time-donut', 'kina-can-we-kiss-forever', 'frank-ocean-pink-white',
    'her-damage', 'tems-free-mind',
  ],
};

function demoListPlaylists(_userId) {
  return DEMO_PLAYLISTS.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    public: p.public,
    owner: p.owner,
    trackCount: p.tracks,
    cover: null, // demo playlists use a generic mark
    externalUrl: null,
  }));
}

function demoPlaylistTracks(playlistId, userId) {
  const slugs = DEMO_TRACK_MAP[playlistId] || [];
  const demo = providers.REGISTRY.demo;
  return slugs
    .map((slug) => demo.catalog.find((c) => c.slug === slug))
    .filter(Boolean)
    .map(demo.normalize);
}

/* --------------------------------------------------------- real calls */

async function realToken(userId) {
  const s = token(userId);
  if (!s || s.mode !== 'real') return null;
  if (Date.now() < s.expiresAt - 30000) return s.accessToken;
  // expired → try refresh
  if (s.refreshToken) {
    try {
      const basic = Buffer.from(`${spotifyProvider.clientId()}:${spotifyProvider.clientSecret()}`).toString('base64');
      const res = await fetchRaw('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: s.refreshToken,
        }).toString(),
        timeout: 9000,
      });
      const data = JSON.parse(res.body);
      if (data.access_token) storeToken(userId, { ...data, id: s.id, displayName: s.displayName });
      return data.access_token || null;
    } catch {
      return null;
    }
  }
  return null;
}

async function realApi(userId, path) {
  const tok = await realToken(userId);
  if (!tok) throw new Error('Spotify token is missing or expired');
  const res = await fetchRaw(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${tok}` },
    timeout: 12000,
  });
  return JSON.parse(res.body);
}

async function realListPlaylists(userId) {
  const data = await realApi(userId, '/me/playlists?limit=50');
  return (data.items || []).map((p) => {
    const images = p.images || [];
    return {
      id: p.id,
      name: p.name,
      description: p.description || '',
      public: p.public,
      owner: p.owner?.display_name || 'Spotify',
      trackCount: p.tracks?.total || 0,
      cover: images[0]?.url || null,
      externalUrl: p.external_urls?.spotify || null,
    };
  });
}

async function realPlaylistTracks(userId, playlistId) {
  // fetch up to 100 tracks (single page is fine for most playlists)
  const data = await realApi(userId, `/playlists/${encodeURIComponent(playlistId)}/tracks?limit=100`);
  return (data.items || [])
    .map((it) => (it.track ? spotifyProvider.normalize(it.track) : null))
    .filter(Boolean);
}

/* ----------------------------------------------------- playlist fetch */

async function playlistTracks(userId, playlistId) {
  if (DEMO_MODE()) return demoPlaylistTracks(playlistId, userId);
  return realPlaylistTracks(userId, playlistId);
}

async function listPlaylists(userId) {
  if (DEMO_MODE()) return demoListPlaylists(userId);
  return realListPlaylists(userId);
}

/* ------------------------------------------------- download + resolve */

function dedupe(tracks) {
  const seen = new Set();
  const out = [];
  for (const t of tracks) {
    if (!t || !t.title) continue;
    const k = `${(t.title || '').toLowerCase()}|${(t.artist || '').toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/**
 * Find a playable source for a track (metadata-only Spotify rows are common),
 * then fetch + cache the audio. Returns a result for every track tried.
 */
async function resolveAndCache(userId, track) {
  let url = track.streamUrl || track.previewUrl || null;
  if (!url) {
    try {
      const { tracks } = await providers.search(`${track.artist} ${track.title}`, { limit: 12 });
      const match = tracks.find((t) => t.streamUrl || t.previewUrl);
      if (match) {
        url = match.streamUrl || match.previewUrl;
        track = { ...track, streamUrl: match.streamUrl, previewUrl: match.previewUrl, resolvedFrom: match.provider };
      }
    } catch {
      /* best effort */
    }
  }
  if (!url) return { track, ok: false, reason: 'no playable source' };

  // Offline demo audio is generated locally and never needs the network — mark
  // it offline directly. Any real (https) source gets fetched + cached to disk.
  let bytes = 0;
  if (url.startsWith('sonora://')) {
    bytes = 0; // always available offline; generate on demand
  } else {
    bytes = (await audioCache.download(url, fetchAudioBuffer)) || 0;
    if (!bytes) return { track, ok: false, reason: 'audio download failed' };
  }
  return { track: { ...track, streamUrl: url, downloaded: true }, ok: true, bytes };
}

async function fetchAudioBuffer(url) {
  return fetchBuffer(url, { timeout: 30000, headers: { Range: 'bytes=0-' } });
}

/** Persist a downloaded track as an offline entry for this user. */
function markDownload(userId, track, bytes) {
  const existing = db.downloads.findOne(
    (d) => d.userId === userId && d.trackId === track.id
  );
  const record = {
    userId,
    trackId: track.id,
    provider: track.provider || track.resolvedFrom || 'spotify',
    sourceProvider: track.provider || 'spotify',
    resolvedFrom: track.resolvedFrom || null,
    title: track.title,
    artist: track.artist,
    album: track.album || '',
    artwork: track.artwork || null,
    artworkSmall: track.artworkSmall || track.artwork || null,
    durationMs: track.durationMs || 0,
    url: track.streamUrl || track.previewUrl,
    bytes,
    spotifyUri: track.spotifyUri || null,
  };
  if (existing) return db.downloads.update(existing.id, { ...record, downloadedAt: new Date().toISOString() });
  return db.downloads.insert({ ...record, downloadedAt: new Date().toISOString() }, 'dl');
}

function listDownloads(userId) {
  return db.downloads
    .find((d) => d.userId === userId)
    .sort((a, b) => new Date(b.downloadedAt) - new Date(a.downloadedAt))
    .map((d) => ({ ...d, offline: true }));
}

function removeDownload(userId, trackId) {
  const hit = db.downloads.findOne((d) => d.userId === userId && d.trackId === trackId);
  if (hit) db.downloads.remove(hit.id);
  return Boolean(hit);
}

function isDownloaded(userId, trackId) {
  return Boolean(db.downloads.findOne((d) => d.userId === userId && d.trackId === trackId));
}

/* ----------------------------------------------------------- OAuth */

async function connectUser(userId) {
  if (DEMO_MODE()) {
    // Simulate a completed connect: bind a fake Spotify identity.
    const user = db.users.get(userId);
    const existing = user && user.spotify && user.spotify.mode === 'demo' && user.spotify.id;
    const spotify = {
      accessToken: `demo_${crypto.randomBytes(8).toString('hex')}`,
      refreshToken: null,
      expiresAt: Date.now() + 3600 * 1000,
      id: existing || `demo_${crypto.randomBytes(6).toString('hex')}`,
      displayName: 'Simulated Listener',
      email: 'demo@spotify.sim',
      mode: 'demo',
      connectedAt: new Date().toISOString(),
    };
    db.users.update(userId, { spotify });
    return { ok: true, demo: true, user: { id: spotify.id, displayName: spotify.displayName } };
  }
  if (!isConfigured()) throw new Error('Spotify is not configured. Add SPOTIFY_CLIENT_ID/SECRET to .env.');
  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, { userId, at: Date.now() });
  return { ok: true, demo: false, authorizeUrl: spotifyProvider.authorizeUrl(state) };
}

async function completeOAuth(userId, code, state) {
  if (DEMO_MODE()) return connectUser(userId);
  if (!code) throw new Error('No authorization code returned');
  const data = await spotifyProvider.exchangeCode(code);
  if (!data.access_token) throw new Error(data.error_description || 'Spotify token exchange failed');
  // look up the account identity so we can show who's connected
  let identity = {};
  try {
    const res = await fetchRaw('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${data.access_token}` },
      timeout: 9000,
    });
    const me = JSON.parse(res.body);
    identity = { id: me.id, displayName: me.display_name, email: me.email };
  } catch {
    /* identity is optional */
  }
  storeToken(userId, { ...data, ...identity });
  return { ok: true, demo: false, user: { id: identity.id, displayName: identity.displayName, email: identity.email } };
}

module.exports = {
  isConfigured,
  redirectUri,
  status,
  token,
  isReal,
  storeToken,
  clearToken,
  connectUser,
  completeOAuth,
  listPlaylists,
  playlistTracks,
  listDownloads,
  removeDownload,
  markDownload,
  isDownloaded,
  resolveAndCache,
  dedupe,
  DEMO_MODE,
};
