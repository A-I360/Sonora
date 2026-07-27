/* ============================================================
   Shared UI components
   ============================================================ */

import { h, api, store, toast, optimistic, fmtTime, initials, openModal, isPlayable } from './core.js';
import { icon } from './icons.js';
import { player, playTrack, addToQueue, onPlayerChange } from './player.js';

/* ------------------------------------------------------- avatar */

export function avatar(user, size = 32) {
  const bg = user?.avatarColor || 'linear-gradient(135deg,#8b5cf6,#ec4899)';
  return h(
    'div',
    {
      class: 'avatar',
      style: { width: `${size}px`, height: `${size}px`, background: bg, fontSize: `${size * 0.4}px` },
      title: user?.displayName || '',
    },
    initials(user?.displayName)
  );
}

/* ------------------------------------------------- empty / loading */

export function emptyState({ iconName = 'music', title, text, action }) {
  return h(
    'div',
    { class: 'empty' },
    h('div', { class: 'empty-art' }, icon(iconName)),
    h('div', { class: 'empty-title' }, title),
    text ? h('p', { class: 'empty-text' }, text) : null,
    action || null
  );
}

export function loadingRows(count = 6) {
  return h(
    'div',
    { class: 'track-list' },
    ...Array.from({ length: count }, () =>
      h(
        'div',
        { class: 'skel-row' },
        h('div', { class: 'skeleton', style: { width: '16px', height: '11px', margin: '0 auto' } }),
        h('div', { class: 'skeleton', style: { width: '46px', height: '46px', borderRadius: '8px' } }),
        h(
          'div',
          { class: 'flex-col gap-8' },
          h('div', { class: 'skeleton skel-line', style: { width: `${45 + Math.random() * 35}%` } }),
          h('div', { class: 'skeleton skel-line', style: { width: `${25 + Math.random() * 25}%`, height: '9px' } })
        ),
        h('div', { class: 'skeleton skel-line', style: { width: '34px' } })
      )
    )
  );
}

export function loadingCards(count = 6) {
  return h(
    'div',
    { class: 'card-grid' },
    ...Array.from({ length: count }, () =>
      h(
        'div',
        { class: 'media-card' },
        h('div', { class: 'skeleton', style: { width: '100%', aspectRatio: '1', borderRadius: '12px', marginBottom: '12px' } }),
        h('div', { class: 'skeleton skel-line', style: { width: '78%', marginBottom: '7px' } }),
        h('div', { class: 'skeleton skel-line', style: { width: '48%', height: '9px' } })
      )
    )
  );
}

export function spinnerBlock(text = 'Loading…') {
  return h('div', { class: 'loading-center' }, h('div', { class: 'spinner spinner-lg' }), h('p', {}, text));
}

/* --------------------------------------------------- library state */

export function isSaved(trackId) {
  return store.get().librarySet.has(trackId);
}

/** Optimistic save/unsave with rollback. */
export async function toggleSave(track, onUpdate) {
  const saved = isSaved(track.id);
  const set = store.get().librarySet;

  return optimistic({
    apply() {
      if (saved) set.delete(track.id);
      else set.add(track.id);
      store.set({
        librarySet: new Set(set),
        library: saved
          ? store.get().library.filter((t) => t.id !== track.id)
          : [{ ...track, saved: true, savedAt: new Date().toISOString() }, ...store.get().library],
      });
      onUpdate?.(!saved);
    },
    rollback() {
      const s = store.get().librarySet;
      if (saved) s.add(track.id);
      else s.delete(track.id);
      store.set({
        librarySet: new Set(s),
        library: saved
          ? [{ ...track, saved: true }, ...store.get().library]
          : store.get().library.filter((t) => t.id !== track.id),
      });
      onUpdate?.(saved);
    },
    commit: () => (saved ? api.del(`/api/library/${encodeURIComponent(track.id)}`) : api.post('/api/library', { track })),
    onSuccess: () => toast(saved ? 'Removed from your library' : 'Saved to your library'),
    errorMessage: saved ? 'Could not remove that track' : 'Could not save that track',
  }).catch(() => {});
}

/* ------------------------------------------------------ track row */

const PROVIDER_LABEL = { itunes: 'Apple Music', audius: 'Audius', deezer: 'Deezer', spotify: 'Spotify' };

export function trackRow(track, options = {}) {
  const {
    index = null,
    context = null,
    contextName = '',
    onRemove = null,
    showAlbum = false,
    draggable = false,
    onDragStart = null,
    onDrop = null,
    extra = null,
  } = options;

  const playable = isPlayable(track);
  const saved = isSaved(track.id);

  const indexCell = h(
    'div',
    { class: 'track-index' },
    h('span', { class: 'track-index-num' }, index !== null ? String(index + 1) : ''),
    h('span', { class: 'track-index-play' }, icon('play'))
  );

  const eq = h('div', { class: 'eq' }, h('span'), h('span'), h('span'));

  const art = track.artworkSmall || track.artwork;
  const artEl = art
    ? h('img', { class: 'track-art', src: art, alt: '', loading: 'lazy' })
    : h('div', { class: 'track-art-fallback' }, '♪');

  const saveBtn = h(
    'button',
    {
      class: `btn-icon btn ${saved ? 'saved always' : ''}`,
      title: saved ? 'Remove from library' : 'Save to library',
      onclick: (e) => {
        e.stopPropagation();
        toggleSave(track, (nowSaved) => {
          saveBtn.classList.toggle('saved', nowSaved);
          saveBtn.classList.toggle('always', nowSaved);
          saveBtn.replaceChildren(icon(nowSaved ? 'heartFilled' : 'heart'));
          saveBtn.title = nowSaved ? 'Remove from library' : 'Save to library';
        });
      },
    },
    icon(saved ? 'heartFilled' : 'heart')
  );

  const row = h(
    'div',
    {
      class: 'track-row',
      dataset: { trackId: track.id },
      draggable: draggable ? 'true' : null,
      onclick: () => {
        if (!playable) {
          toast(`No audio available for "${track.title}" from ${PROVIDER_LABEL[track.provider] || track.provider}`, 'error');
          return;
        }
        playTrack(track, context, { queueName: contextName });
      },
    },
    indexCell,
    artEl,
    h(
      'div',
      { class: 'track-meta' },
      h(
        'div',
        { class: 'track-title' },
        h('span', { class: 'truncate' }, track.title),
        track.explicit ? h('span', { class: 'badge badge-explicit' }, 'E') : null,
        track.matchScore !== undefined
          ? h('span', { class: 'match-pill' }, `${Math.round(track.matchScore * 100)}%`)
          : null
      ),
      h(
        'div',
        { class: 'track-artist' },
        h('span', { class: `prov-dot prov-${track.provider}`, style: { display: 'inline-block', marginRight: '6px' } }),
        track.artist,
        showAlbum && track.album ? ` · ${track.album}` : '',
        !playable ? ' · no preview' : ''
      )
    ),
    h(
      'div',
      { class: 'track-actions' },
      extra,
      saveBtn,
      h(
        'button',
        {
          class: 'btn btn-icon',
          title: 'Add to playlist',
          onclick: (e) => {
            e.stopPropagation();
            addToPlaylistModal(track);
          },
        },
        icon('plusCircle')
      ),
      h(
        'button',
        {
          class: 'btn btn-icon',
          title: 'Add to queue',
          onclick: (e) => {
            e.stopPropagation();
            addToQueue(track);
          },
        },
        icon('queue')
      ),
      h(
        'button',
        {
          class: 'btn btn-icon',
          title: 'Share this track',
          onclick: (e) => {
            e.stopPropagation();
            shareTrackModal(track);
          },
        },
        icon('share')
      ),
      onRemove
        ? h(
            'button',
            {
              class: 'btn btn-icon',
              title: 'Remove from playlist',
              onclick: (e) => {
                e.stopPropagation();
                onRemove(track);
              },
            },
            icon('trash')
          )
        : null,
      h('div', { class: 'track-dur' }, fmtTime(track.durationMs))
    )
  );

  if (draggable) {
    row.addEventListener('dragstart', (e) => {
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
      onDragStart?.(index);
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      document.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('drag-over');
      const from = Number(e.dataTransfer.getData('text/plain'));
      if (!Number.isNaN(from) && from !== index) onDrop?.(from, index);
    });
  }

  // reflect now-playing state
  const sync = (p) => {
    const isCurrent = p.current?.id === track.id;
    row.classList.toggle('playing', isCurrent);
    if (isCurrent) {
      eq.classList.toggle('paused', !p.playing);
      if (indexCell.firstChild !== eq) indexCell.replaceChildren(eq);
    } else if (indexCell.firstChild === eq) {
      indexCell.replaceChildren(
        h('span', { class: 'track-index-num' }, index !== null ? String(index + 1) : ''),
        h('span', { class: 'track-index-play' }, icon('play'))
      );
    }
  };
  sync(player);
  const off = onPlayerChange(sync);
  // detach when the row leaves the DOM
  const observer = new MutationObserver(() => {
    if (!document.body.contains(row)) {
      off();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  return row;
}

export function trackList(tracks, options = {}) {
  return h('div', { class: 'track-list' }, ...tracks.map((t, i) => trackRow(t, { ...options, index: i, context: tracks })));
}

/* ------------------------------------------------------ media card */

export function trackCard(track, context = null) {
  const art = track.artwork || track.artworkSmall;
  const playable = isPlayable(track);
  return h(
    'div',
    {
      class: 'media-card',
      onclick: () => {
        if (!playable) return toast(`No audio available for "${track.title}"`, 'error');
        playTrack(track, context);
      },
    },
    h(
      'div',
      { class: 'media-cover' },
      art ? h('img', { src: art, alt: '', loading: 'lazy' }) : h('div', { class: 'media-cover-fallback' }, '♪'),
      h('div', { class: 'media-badges' }, track.streamUrl ? h('span', { class: 'badge badge-full' }, 'Full') : null),
      h(
        'button',
        {
          class: 'media-play',
          title: 'Play',
          onclick: (e) => {
            e.stopPropagation();
            if (!playable) return toast(`No audio available for "${track.title}"`, 'error');
            playTrack(track, context);
          },
        },
        icon('play')
      )
    ),
    h('div', { class: 'media-title', title: track.title }, track.title),
    h(
      'div',
      { class: 'media-sub', title: track.artist },
      h('span', { class: `prov-dot prov-${track.provider}` }),
      h('span', { class: 'truncate' }, track.artist)
    )
  );
}

export function playlistCard(playlist, onOpen) {
  const covers = playlist.covers || [];
  let cover;
  if (covers.length >= 4) {
    cover = h('div', { class: 'media-cover-grid' }, ...covers.slice(0, 4).map((c) => h('img', { src: c, alt: '', loading: 'lazy' })));
  } else if (covers.length) {
    cover = h('img', { src: covers[0], alt: '', loading: 'lazy' });
  } else {
    cover = h('div', { class: 'media-cover-fallback' }, '♫');
  }

  return h(
    'div',
    { class: 'media-card', onclick: () => onOpen(playlist) },
    h(
      'div',
      { class: 'media-cover' },
      cover,
      h(
        'div',
        { class: 'media-badges' },
        playlist.aiGenerated ? h('span', { class: 'badge badge-ai' }, 'AI') : null,
        !playlist.isPublic ? h('span', { class: 'badge badge-private' }, 'Private') : null
      )
    ),
    h('div', { class: 'media-title', title: playlist.name }, playlist.name),
    h(
      'div',
      { class: 'media-sub' },
      `${playlist.trackCount} ${playlist.trackCount === 1 ? 'track' : 'tracks'}`,
      playlist.owner && !playlist.isOwner ? ` · ${playlist.owner.displayName}` : ''
    )
  );
}

/* -------------------------------------------------------- modals */

export function addToPlaylistModal(track) {
  openModal(({ close }) => {
    const playlists = store.get().playlists;
    const body = h('div', { class: 'modal-body' });

    const renderList = () => {
      if (!playlists.length) {
        body.replaceChildren(
          emptyState({
            iconName: 'listMusic',
            title: 'No playlists yet',
            text: 'Create your first playlist to start collecting tracks.',
          })
        );
        return;
      }
      body.replaceChildren(
        h(
          'div',
          { class: 'flex-col gap-8', style: { maxHeight: '340px', overflowY: 'auto' } },
          ...playlists.map((pl) =>
            h(
              'button',
              {
                class: 'embed',
                style: { width: '100%', textAlign: 'left', border: '1px solid var(--stroke)' },
                onclick: async () => {
                  const btn = event.currentTarget;
                  btn.classList.add('pending');
                  try {
                    await api.post(`/api/playlists/${pl.id}/tracks`, { track });
                    toast(`Added to "${pl.name}"`);
                    window.dispatchEvent(new CustomEvent('sonora:playlists-changed'));
                    close();
                  } catch (err) {
                    btn.classList.remove('pending');
                    btn.classList.add('failed');
                    setTimeout(() => btn.classList.remove('failed'), 500);
                    toast(err.message, 'error');
                  }
                },
              },
              pl.covers?.[0]
                ? h('img', { class: 'embed-art', src: pl.covers[0], alt: '' })
                : h('div', { class: 'embed-art-fallback' }, '♫'),
              h(
                'div',
                { class: 'embed-meta' },
                h('div', { class: 'embed-title' }, pl.name),
                h('div', { class: 'embed-sub' }, `${pl.trackCount} tracks${pl.isPublic ? '' : ' · private'}`)
              ),
              icon('plus')
            )
          )
        )
      );
    };
    renderList();

    const nameInput = h('input', { class: 'input', placeholder: 'New playlist name…', maxlength: '80' });

    return h(
      'div',
      {},
      h(
        'div',
        { class: 'modal-head' },
        h(
          'div',
          {},
          h('div', { class: 'modal-title' }, 'Add to playlist'),
          h('div', { class: 'modal-sub' }, `${track.title} — ${track.artist}`)
        ),
        h('button', { class: 'modal-close', onclick: close }, '×')
      ),
      body,
      h('div', { style: { height: '1px', background: 'var(--stroke)', margin: '18px 0' } }),
      h(
        'div',
        { class: 'flex gap-8' },
        nameInput,
        h(
          'button',
          {
            class: 'btn btn-primary',
            onclick: async (e) => {
              const name = nameInput.value.trim();
              if (!name) return toast('Give your playlist a name', 'error');
              const btn = e.currentTarget;
              btn.disabled = true;
              btn.replaceChildren(h('div', { class: 'spinner' }));
              try {
                await api.post('/api/playlists', { name, tracks: [track], isPublic: true });
                toast(`Created "${name}" with 1 track`);
                window.dispatchEvent(new CustomEvent('sonora:playlists-changed'));
                close();
              } catch (err) {
                btn.disabled = false;
                btn.replaceChildren(document.createTextNode('Create'));
                toast(err.message, 'error');
              }
            },
          },
          'Create'
        )
      )
    );
  });
}

export function shareTrackModal(track) {
  openModal(({ close }) => {
    const msg = h('textarea', {
      class: 'textarea',
      placeholder: 'Say something about this track…',
      maxlength: '500',
    });
    const submit = h('button', { class: 'btn btn-primary' }, 'Post to feed');

    submit.addEventListener('click', async () => {
      submit.disabled = true;
      submit.replaceChildren(h('div', { class: 'spinner' }), document.createTextNode('Posting…'));
      try {
        await api.post('/api/shares', { track, message: msg.value.trim() });
        toast('Shared to the community feed');
        window.dispatchEvent(new CustomEvent('sonora:shares-changed'));
        close();
      } catch (err) {
        submit.disabled = false;
        submit.replaceChildren(document.createTextNode('Post to feed'));
        toast(err.message, 'error');
      }
    });

    return h(
      'div',
      {},
      h(
        'div',
        { class: 'modal-head' },
        h('div', {}, h('div', { class: 'modal-title' }, 'Share a track')),
        h('button', { class: 'modal-close', onclick: close }, '×')
      ),
      h(
        'div',
        { class: 'modal-body' },
        h(
          'div',
          { class: 'embed' },
          track.artwork
            ? h('img', { class: 'embed-art', src: track.artwork, alt: '' })
            : h('div', { class: 'embed-art-fallback' }, '♪'),
          h(
            'div',
            { class: 'embed-meta' },
            h('div', { class: 'embed-title' }, track.title),
            h('div', { class: 'embed-sub' }, track.artist)
          )
        ),
        msg
      ),
      h('div', { class: 'modal-foot' }, h('button', { class: 'btn btn-ghost', onclick: close }, 'Cancel'), submit)
    );
  });
}

/* ---------------------------------------------------- feature bars */

export function featureBars(vec) {
  const dims = ['energy', 'valence', 'danceability', 'acousticness', 'tempo'];
  const labels = { valence: 'positivity', tempo: 'pace' };
  return h(
    'div',
    { class: 'feature-bars' },
    ...dims.map((d) =>
      h(
        'div',
        { class: 'feature-bar' },
        h('div', { class: 'feature-bar-label' }, labels[d] || d),
        h('div', { class: 'feature-bar-track' }, h('div', { class: 'feature-bar-fill', style: { width: `${(vec[d] || 0) * 100}%` } })),
        h('div', { class: 'feature-bar-val' }, `${Math.round((vec[d] || 0) * 100)}`)
      )
    )
  );
}

export function sectionHead(title, action) {
  return h('div', { class: 'section-head' }, h('h2', { class: 'section-title' }, title), action || null);
}
