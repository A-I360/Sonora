/* Spotify: connect account, import & download playlists for offline listening. */

import { h, mount, api, store, toast, fmtTime, optimistic } from '../core.js';
import { icon } from '../icons.js';
import { emptyState, loadingCards, loadingRows, sectionHead, trackRow } from '../components.js';
import { playQueue } from '../player.js';

function SpotMark({ big = false }) {
  return h('div', { class: big ? 'spot-mark spot-mark-lg' : 'spot-mark', html: icon('spotify').outerHTML });
}

/* ---------------------------------------------------------- status row */

function StatusCard(status, onChanged) {
  const connected = status.connected;
  const demo = status.demo;

  const body = h('div', {
    class: 'glass',
    style: { borderRadius: 'var(--radius-lg)', padding: '22px', marginBottom: '20px' },
  });

  const desc = connected
    ? `Connected${demo ? ' in simulated mode' : ''}${status.user ? ` as ${status.user.displayName}` : ''}.`
    : 'Connect Spotify to import your playlists and download them for offline listening.';
  const note = h('p', { class: 'text-sm text-dim', style: { marginTop: '8px', lineHeight: '1.55' } }, status.note || '');

  const action = connected
    ? h(
        'button',
        {
          class: 'btn',
          onclick: async () => {
            try {
              await api.post('/api/spotify/disconnect');
              toast('Spotify disconnected');
              onChanged();
            } catch (err) {
              toast(err.message, 'error');
            }
          },
        },
        icon('x'),
        'Disconnect'
      )
    : h(
        'button',
        {
          class: 'btn btn-primary',
          onclick: async () => {
            try {
              const r = await api.get('/api/spotify/connect');
              if (r.demo) {
                toast('Connected in simulated mode');
                onChanged();
              } else if (r.authorizeUrl) {
                // real OAuth: take the user to Spotify in a new tab
                window.location.href = r.authorizeUrl;
                toast('Complete the Spotify sign-in in the new tab', 'info', 5000);
              }
            } catch (err) {
              toast(err.message, 'error');
            }
          },
        },
        icon('spotify'),
        'Connect Spotify'
      );

  mount(
    body,
    h(
      'div',
      { class: 'flex items-center gap-16 wrap', style: { alignItems: 'center' } },
      h(
        'div',
        { style: { flexShrink: 0 } },
        h(
          'div',
          {
            class: 'spot-logo',
            style: connected ? { background: 'var(--spotify, #1db954)' } : undefined,
          },
          icon('spotify', 'spot-icon')
        )
      ),
      h(
        'div',
        { style: { flex: '1', minWidth: '220px' } },
        h('div', { style: { fontSize: '17px', fontWeight: '700', marginBottom: '3px' } }, 'Spotify'),
        h('div', { class: 'flex items-center gap-8' }, h('span', { class: `badge ${connected ? 'badge-full' : 'badge-private'}` }, connected ? 'Connected' : 'Not connected'), demo ? h('span', { class: 'badge badge-ai' }, 'Demo mode') : null),
        desc,
        note
      ),
      h(
        'div',
        { style: { flexShrink: 0 } },
        action
      )
    )
  );

  return body;
}

/* ----------------------------------------------------------- offline */

function OfflineSection({ tracks, onChanged, navigate }) {
  if (!tracks.length) {
    return sectionHead(
      'Offline',
      h('p', { class: 'text-xs text-faint' }, 'Nothing downloaded yet — open a Spotify playlist and tap "Download".')
    );
  }
  const playable = tracks.filter((t) => t.url);
  return h(
    'div',
    { class: 'section' },
    sectionHead(
      'Offline',
      h(
        'button',
        { class: 'btn btn-sm', disabled: !playable.length, onclick: () => playQueue(tracks, 0, { queueName: 'Offline' }) },
        icon('play'),
        'Play all'
      )
    ),
    h(
      'div',
      { class: 'track-list' },
      ...tracks.map((t, i) =>
        trackRow({ ...t, streamUrl: t.url, previewUrl: null, provider: t.sourceProvider || t.provider || 'spotify' }, {
          index: i,
          context: tracks,
          contextName: 'Offline',
          showAlbum: true,
          extra: h(
            'button',
            {
              class: 'btn btn-icon',
              title: 'Remove download',
              onclick: async (e) => {
                e.stopPropagation();
                try {
                  await api.del(`/api/spotify/downloads/${encodeURIComponent(t.trackId)}`);
                  toast('Removed from offline');
                  onChanged();
                } catch (err) {
                  toast(err.message, 'error');
                }
              },
            },
            icon('trash')
          ),
        })
      )
    )
  );
}

/* ---------------------------------------------------------- playlists */

function PlaylistCard(pl, onOpen) {
  return h(
    'div',
    { class: 'media-card', onclick: () => onOpen(pl.id) },
    h(
      'div',
      { class: 'media-cover' },
      pl.cover
        ? h('img', { src: pl.cover, alt: '', loading: 'lazy' })
        : h('div', { class: 'media-cover-fallback spot-cover', html: icon('spotify').outerHTML }),
      h('div', { class: 'media-badges' }, h('span', { class: 'badge badge-full' }, 'Spotify'))
    ),
    h('div', { class: 'media-title', title: pl.name }, pl.name),
    h('div', { class: 'media-sub' }, `${pl.trackCount || 0} tracks · ${pl.owner || 'Spotify'}`)
  );
}

/* -------------------------------------------------------------- detail */

function PlaylistDetail({ id, onBack }) {
  const slot = h('div');
  mount(slot, loadingRows(10));

  let tracks = [];
  let meta = {};

  function paint() {
    const playable = tracks.filter((t) => t.streamUrl || t.previewUrl);
    const downloaded = tracks.filter((t) => t.downloaded);
    const dlLabel = downloaded.length ? `${downloaded.length} of ${tracks.length} offline` : '';
    mount(
      slot,
      h('button', { class: 'btn btn-ghost btn-sm', style: { marginBottom: '14px' }, onclick: onBack }, '← Spotify playlists'),
      h(
        'div',
        { class: 'detail-head', style: { marginBottom: '10px' } },
        h(
          'div',
          { class: 'detail-meta' },
          h('div', { class: 'detail-kicker' }, 'Spotify playlist'),
          h('h1', { class: 'detail-title' }, meta.name || 'Playlist'),
          meta.description ? h('p', { class: 'detail-desc' }, meta.description) : null,
          h('div', { class: 'detail-facts' }, `${tracks.length} tracks`, dlLabel ? h('span', { class: 'dot-sep' }) : null, dlLabel)
        ),
        h(
          'div',
          { class: 'detail-actions' },
          h('button', { class: 'btn btn-primary', disabled: !playable.length, onclick: () => playQueue(tracks, 0, { queueName: meta.name || 'Spotify' }) }, icon('play'), 'Play'),
          meta.mode === 'demo'
            ? h('span', { class: 'badge badge-ai', style: { alignSelf: 'center' } }, 'Demo')
            : null,
          h('span', { class: 'text-xs text-faint', style: { alignSelf: 'center' } }, 'Download each track to listen offline.')
        )
      ),
      h(
        'div',
        { class: 'glass', style: { borderRadius: 'var(--radius)', padding: '16px', marginBottom: '16px' } },
        h(
          'div',
          { class: 'flex items-center justify-between wrap gap-16' },
          h(
            'div',
            {},
            h('div', { style: { fontWeight: '700', marginBottom: '4px' } }, 'Download entire playlist'),
            h('p', { class: 'text-xs text-dim' }, 'Finds a playable source for every track and stores it on this device for offline listening.')
          ),
          h(
            'button',
            {
              class: 'btn btn-primary',
              onclick: async (e) => {
                const btn = e.currentTarget;
                btn.disabled = true;
                const label = btn.querySelector('.btn-dl-label');
                const prev = label?.textContent || 'Download all';
                label && (label.textContent = `Downloading… 0 / ${tracks.length}`);
                try {
                  const r = await api.post(`/api/spotify/playlists/${encodeURIComponent(id)}/download`);
                  label && (label.textContent = `Downloaded ${r.downloaded} of ${r.total}`);
                  toast(`Downloaded ${r.downloaded} track${r.downloaded === 1 ? '' : 's'}${r.failed ? ` · ${r.failed} failed` : ''}`, r.failed ? 'info' : 'success');
                  const d = await api.get('/api/spotify/playlists/' + encodeURIComponent(id));
                  tracks = d.tracks;
                  meta = { ...meta, mode: d.mode };
                  paint();
                  window.dispatchEvent(new CustomEvent('sonora:spotify-changed'));
                } catch (err) {
                  toast(err.message, 'error');
                  label && (label.textContent = prev);
                } finally {
                  btn.disabled = false;
                }
              },
            },
            icon('download'),
            h('span', { class: 'btn-dl-label' }, tracks.length ? 'Download all' : 'Download')
          )
        )
      ),
      tracks.length
        ? h(
            'div',
            { class: 'track-list' },
            ...tracks.map((t, i) =>
              trackRow(t, {
                index: i,
                context: tracks,
                contextName: meta.name || 'Spotify',
                showAlbum: true,
                extra: t.downloaded
                  ? h('span', { class: 'badge badge-full', style: { alignSelf: 'center' } }, 'Offline')
                  : null,
              })
            )
          )
        : emptyState({ iconName: 'music', title: 'No tracks', text: 'This playlist has no tracks to show.', action: h('button', { class: 'btn btn-secondary', onclick: onBack }, 'Back') })
    );
  }

  api
    .get(`/api/spotify/playlists/${encodeURIComponent(id)}`)
    .then((d) => {
      tracks = d.tracks;
      meta = { name: id, mode: d.mode, demo: d.demo };
      paint();
    })
    .catch((err) => mount(slot, emptyState({ iconName: 'x', title: 'Could not load playlist', text: err.message, action: h('button', { class: 'btn btn-primary', onclick: onBack }, 'Back') })));

  return slot;
}

/* --------------------------------------------------------------- view */

export function renderSpotify(root, { params }) {
  // allow deep-link: /spotify/pl_xyz
  if (params.id) {
    mount(root, PlaylistDetail({ id: params.id, onBack: () => { window.location.hash = '#/spotify'; } }));
    return;
  }

  const slot = h('div');
  mount(root, slot);

  let status = null;
  let playlists = [];
  let offline = [];

  async function reload() {
    const [s, pls, off] = await Promise.all([
      api.get('/api/spotify'),
      api.get('/api/spotify/playlists').catch((e) => ({ playlists: [], error: e.message })),
      api.get('/api/spotify/downloads').catch(() => ({ tracks: [] })),
    ]);
    status = s;
    playlists = pls.playlists || [];
    offline = off.tracks || [];
    paint();
  }

  function paint() {
    if (!status) {
      mount(slot, loadingCards(4));
      return;
    }
    const cards = playlists.map((pl) => PlaylistCard(pl, (id) => { window.location.hash = `#/spotify/${id}`; }));
    mount(
      slot,
      h('div', { class: 'page-head' }, h('h1', { class: 'page-title' }, 'Spotify'), h('p', { class: 'page-sub' }, 'Link your Spotify account to import playlists and download them to listen offline — no connection needed afterwards.')),
      StatusCard(status, reload),
      OfflineSection({ tracks: offline, onChanged: reload, navigate: () => {} }),
      h(
        'div',
        { class: 'section' },
        sectionHead(
          'Your playlists',
          playlists.length ? h('button', { class: 'btn btn-sm', onclick: reload }, 'Refresh') : null
        ),
        status.connected
          ? playlists.length
            ? h('div', { class: 'card-grid' }, ...cards)
            : emptyState({ iconName: 'spotify', title: 'No playlists found', text: 'Make a playlist in Spotify and it will appear here.', action: status.demo ? null : h('button', { class: 'btn', onclick: reload }, 'Refresh') })
          : null
      )
    );
  }

  reload();
  window.addEventListener('sonora:spotify-changed', reload);
}

export default renderSpotify;
