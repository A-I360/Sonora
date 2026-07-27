/* The persistent bottom player bar. */

import { h, mount, fmtTime, openModal, toast } from '../core.js';
import { icon } from '../icons.js';
import {
  player,
  onPlayerChange,
  togglePlay,
  next,
  prev,
  seek,
  setVolume,
  toggleMute,
  toggleShuffle,
  cycleRepeat,
  removeFromQueue,
  clearQueue,
} from '../player.js';
import { trackRow, isSaved, toggleSave, emptyState } from '../components.js';

export function renderPlayerBar() {
  const bar = h('div', { class: 'player' });

  /* ------------------------------------------------------- now playing */
  const artSlot = h('div');
  const titleEl = h('div', { class: 'player-title' }, 'Nothing playing');
  const artistEl = h('div', { class: 'player-artist' }, 'Pick a track to start');
  const saveBtn = h('button', { class: 'ctrl', title: 'Save to library' }, icon('heart'));

  saveBtn.addEventListener('click', () => {
    if (!player.current) return;
    toggleSave(player.current, (nowSaved) => {
      saveBtn.replaceChildren(icon(nowSaved ? 'heartFilled' : 'heart'));
      saveBtn.classList.toggle('active', nowSaved);
    });
  });

  const now = h(
    'div',
    { class: 'player-now' },
    artSlot,
    h('div', { class: 'player-meta' }, titleEl, artistEl),
    saveBtn
  );

  /* ---------------------------------------------------------- controls */
  const shuffleBtn = h('button', { class: 'ctrl', title: 'Shuffle (S)', onclick: toggleShuffle }, icon('shuffle'));
  const prevBtn = h('button', { class: 'ctrl', title: 'Previous (Shift+←)', onclick: () => prev() }, icon('prev'));
  const playBtn = h('button', { class: 'ctrl ctrl-play', title: 'Play/Pause (Space)', onclick: togglePlay }, icon('play'));
  const nextBtn = h('button', { class: 'ctrl', title: 'Next (Shift+→)', onclick: () => next() }, icon('next'));
  const repeatBtn = h('button', { class: 'ctrl', title: 'Repeat (R)', onclick: cycleRepeat }, icon('repeat'));

  const curTime = h('div', { class: 'time' }, '0:00');
  const endTime = h('div', { class: 'time right' }, '0:00');
  const fill = h('div', { class: 'scrub-fill', style: { width: '0%' } });
  const buffer = h('div', { class: 'scrub-buffer', style: { width: '0%' } });
  const thumb = h('div', { class: 'scrub-thumb', style: { left: '0%' } });
  const scrub = h('div', { class: 'scrub' }, buffer, fill, thumb);

  let scrubbing = false;
  const scrubTo = (clientX) => {
    const rect = scrub.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    fill.style.width = `${ratio * 100}%`;
    thumb.style.left = `${ratio * 100}%`;
    return ratio;
  };
  scrub.addEventListener('pointerdown', (e) => {
    if (!player.current) return;
    scrubbing = true;
    scrub.setPointerCapture(e.pointerId);
    scrubTo(e.clientX);
  });
  scrub.addEventListener('pointermove', (e) => {
    if (scrubbing) scrubTo(e.clientX);
  });
  scrub.addEventListener('pointerup', (e) => {
    if (!scrubbing) return;
    scrubbing = false;
    seek(scrubTo(e.clientX));
  });

  const center = h(
    'div',
    { class: 'player-center' },
    h('div', { class: 'player-controls' }, shuffleBtn, prevBtn, playBtn, nextBtn, repeatBtn),
    h('div', { class: 'progress-row' }, curTime, scrub, endTime)
  );

  /* ------------------------------------------------------------- right */
  const volFill = h('div', { class: 'volume-fill', style: { width: `${player.volume * 100}%` } });
  const volume = h('div', { class: 'volume', title: 'Volume (↑/↓)' }, volFill);
  let volDragging = false;
  const volTo = (clientX) => {
    const rect = volume.getBoundingClientRect();
    setVolume((clientX - rect.left) / rect.width);
  };
  volume.addEventListener('pointerdown', (e) => {
    volDragging = true;
    volume.setPointerCapture(e.pointerId);
    volTo(e.clientX);
  });
  volume.addEventListener('pointermove', (e) => volDragging && volTo(e.clientX));
  volume.addEventListener('pointerup', () => {
    volDragging = false;
  });

  const muteBtn = h('button', { class: 'ctrl', title: 'Mute (M)', onclick: toggleMute }, icon('volume'));
  const queueBtn = h('button', { class: 'ctrl', title: 'Queue', onclick: openQueue }, icon('queue'));

  const right = h('div', { class: 'player-right' }, queueBtn, h('div', { class: 'volume-wrap' }, muteBtn, volume));

  const miniFill = h('div', { class: 'player-mini-fill', style: { width: '0%' } });
  bar.append(now, center, right, h('div', { class: 'player-mini-progress' }, miniFill));

  /* ------------------------------------------------------------- sync */
  const sync = (p) => {
    const t = p.current;

    if (t) {
      const art = t.artwork || t.artworkSmall;
      const wantSpin = p.playing;
      const existing = artSlot.firstElementChild;
      const needsSwap = !existing || existing.dataset.src !== (art || 'none');
      if (needsSwap) {
        const el = art
          ? h('img', { class: 'player-art', src: art, alt: '', dataset: { src: art } })
          : h('div', { class: 'player-art-fallback', dataset: { src: 'none' } }, '♪');
        mount(artSlot, el);
      }
      const artEl = artSlot.firstElementChild;
      if (artEl) artEl.classList.toggle('spinning', wantSpin && artEl.tagName === 'IMG');

      titleEl.textContent = t.title;
      artistEl.textContent = `${t.artist}${t.album ? ` — ${t.album}` : ''}`;
      const saved = isSaved(t.id);
      saveBtn.replaceChildren(icon(saved ? 'heartFilled' : 'heart'));
      saveBtn.classList.toggle('active', saved);
    } else {
      mount(artSlot, h('div', { class: 'player-art-fallback', dataset: { src: 'none' } }, '♪'));
      titleEl.textContent = 'Nothing playing';
      artistEl.textContent = 'Pick a track to start';
    }

    playBtn.replaceChildren(p.loading ? h('div', { class: 'spinner' }) : icon(p.playing ? 'pause' : 'play'));
    playBtn.disabled = !t;
    prevBtn.disabled = !t;
    nextBtn.disabled = !t;

    shuffleBtn.classList.toggle('active', p.shuffle);
    repeatBtn.classList.toggle('active', p.repeat !== 'off');
    repeatBtn.replaceChildren(icon(p.repeat === 'one' ? 'repeatOne' : 'repeat'));

    const dur = p.duration || t?.durationMs || 0;
    const ratio = dur ? Math.min(1, p.progress / dur) : 0;
    if (!scrubbing) {
      fill.style.width = `${ratio * 100}%`;
      thumb.style.left = `${ratio * 100}%`;
    }
    buffer.style.width = dur ? `${Math.min(1, p.buffered / dur) * 100}%` : '0%';
    miniFill.style.width = `${ratio * 100}%`;
    curTime.textContent = fmtTime(p.progress);
    endTime.textContent = fmtTime(dur);

    volFill.style.width = `${(p.muted ? 0 : p.volume) * 100}%`;
    muteBtn.replaceChildren(icon(p.muted || p.volume === 0 ? 'volumeMute' : 'volume'));
  };

  sync(player);
  onPlayerChange(sync);
  return bar;
}

/* ------------------------------------------------------------ queue */

function openQueue() {
  openModal(({ close }) => {
    const body = h('div', { class: 'modal-body' });

    const paint = () => {
      if (!player.queue.length) {
        mount(
          body,
          emptyState({
            iconName: 'queue',
            title: 'Your queue is empty',
            text: 'Play a track, album or playlist and it will show up here.',
          })
        );
        return;
      }
      mount(
        body,
        h(
          'div',
          { class: 'track-list', style: { maxHeight: '52vh', overflowY: 'auto' } },
          ...player.queue.map((t, i) =>
            trackRow(t, {
              index: i,
              context: player.queue,
              extra: h(
                'button',
                {
                  class: 'btn btn-icon',
                  title: 'Remove from queue',
                  onclick: (e) => {
                    e.stopPropagation();
                    removeFromQueue(i);
                    paint();
                  },
                },
                icon('x')
              ),
            })
          )
        )
      );
    };
    paint();

    return h(
      'div',
      {},
      h(
        'div',
        { class: 'modal-head' },
        h(
          'div',
          {},
          h('div', { class: 'modal-title' }, 'Play queue'),
          h('div', { class: 'modal-sub' }, `${player.queue.length} track${player.queue.length === 1 ? '' : 's'} lined up`)
        ),
        h('button', { class: 'modal-close', onclick: close }, '×')
      ),
      body,
      h(
        'div',
        { class: 'modal-foot' },
        player.queue.length
          ? h(
              'button',
              {
                class: 'btn btn-danger',
                onclick: () => {
                  clearQueue();
                  toast('Queue cleared');
                  close();
                },
              },
              'Clear queue'
            )
          : null,
        h('button', { class: 'btn btn-ghost', onclick: close }, 'Close')
      )
    );
  });
}
