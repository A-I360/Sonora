/* Playlists: list view + detail view with full CRUD and drag reordering. */

import { h, mount, api, store, toast, openModal, confirmDialog, optimistic, fmtDuration, timeAgo } from '../core.js';
import { icon } from '../icons.js';
import { playlistCard, loadingCards, emptyState, sectionHead, trackRow, loadingRows, avatar } from '../components.js';
import { playQueue } from '../player.js';

/* --------------------------------------------------------- create/edit */

export function playlistFormModal({ playlist = null, onDone }) {
  const isEdit = Boolean(playlist);
  openModal(({ close }) => {
    const name = h('input', { class: 'input', placeholder: 'e.g. Late Night Drive', maxlength: '80', value: playlist?.name || '' });
    const desc = h('textarea', { class: 'textarea', placeholder: 'What is this playlist for?', maxlength: '300' });
    desc.value = playlist?.description || '';
    const pub = h('input', { type: 'checkbox', checked: playlist ? playlist.isPublic : true });

    const submit = h('button', { class: 'btn btn-primary' }, isEdit ? 'Save changes' : 'Create playlist');

    submit.addEventListener('click', async () => {
      const value = name.value.trim();
      if (!value) return toast('Give your playlist a name', 'error');
      submit.disabled = true;
      submit.replaceChildren(h('div', { class: 'spinner' }), document.createTextNode('Saving…'));
      try {
        const payload = { name: value, description: desc.value.trim(), isPublic: pub.checked };
        const res = isEdit
          ? await api.patch(`/api/playlists/${playlist.id}`, payload)
          : await api.post('/api/playlists', payload);
        toast(isEdit ? 'Playlist updated' : `Created "${res.playlist.name}"`);
        window.dispatchEvent(new CustomEvent('sonora:playlists-changed'));
        close();
        onDone?.(res.playlist);
      } catch (err) {
        submit.disabled = false;
        submit.replaceChildren(document.createTextNode(isEdit ? 'Save changes' : 'Create playlist'));
        toast(err.message, 'error');
      }
    });

    return h(
      'div',
      {},
      h(
        'div',
        { class: 'modal-head' },
        h('div', {}, h('div', { class: 'modal-title' }, isEdit ? 'Edit playlist' : 'New playlist')),
        h('button', { class: 'modal-close', onclick: close }, '×')
      ),
      h(
        'div',
        { class: 'modal-body' },
        h('div', { class: 'field' }, h('label', { class: 'label' }, 'Name'), name),
        h('div', { class: 'field' }, h('label', { class: 'label' }, 'Description'), desc),
        h(
          'label',
          { class: 'switch' },
          pub,
          h('span', { class: 'switch-track' }, h('span', { class: 'switch-thumb' })),
          h(
            'div',
            {},
            h('div', { style: { fontSize: '13.5px', fontWeight: '600' } }, 'Public playlist'),
            h('div', { class: 'hint' }, 'Public playlists can be shared to the community feed')
          )
        )
      ),
      h('div', { class: 'modal-foot' }, h('button', { class: 'btn btn-ghost', onclick: close }, 'Cancel'), submit)
    );
  });
}

/* ---------------------------------------------------------- list view */

/** @type {AbortController|null} */
let _playlistsController = null;

export function renderPlaylists(root, { navigate }) {
  // Clean up any previous listener from a prior render (event listener leak prevention)
  _playlistsController?.abort();
  _playlistsController = new AbortController();
  const { signal } = _playlistsController;

  let scope = 'mine';
  const grid = h('div');

  const load = async () => {
    mount(grid, loadingCards(8));
    try {
      const { playlists } = await api.get(`/api/playlists?scope=${scope}`);
      if (scope === 'mine') store.set({ playlists });
      if (!playlists.length) {
        mount(
          grid,
          emptyState({
            iconName: 'listMusic',
            title:
              scope === 'mine' ? 'No playlists yet' : scope === 'liked' ? 'No liked playlists' : 'Nothing shared publicly yet',
            text:
              scope === 'mine'
                ? 'Create one manually, or describe a vibe in the AI studio and save the result.'
                : scope === 'liked'
                ? 'Like a public playlist and it will show up here.'
                : 'When people make their playlists public, they appear here.',
            action:
              scope === 'mine'
                ? h(
                    'div',
                    { class: 'flex gap-10 wrap', style: { justifyContent: 'center' } },
                    h('button', { class: 'btn btn-primary', onclick: () => playlistFormModal({ onDone: load }) }, icon('plus'), 'New playlist'),
                    h('button', { class: 'btn', onclick: () => navigate('ai') }, icon('sparkle'), 'Use AI studio')
                  )
                : null,
          })
        );
        return;
      }
      mount(grid, h('div', { class: 'card-grid' }, ...playlists.map((pl) => playlistCard(pl, (p) => navigate('playlist', { id: p.id })))));
    } catch (err) {
      mount(grid, emptyState({ iconName: 'x', title: 'Could not load playlists', text: err.message }));
    }
  };

  const tabs = h(
    'div',
    { class: 'tabs' },
    ...[
      ['mine', 'My playlists'],
      ['liked', 'Liked'],
      ['public', 'Community'],
    ].map(([key, label]) =>
      h(
        'button',
        {
          class: `tab ${scope === key ? 'active' : ''}`,
          onclick: (e) => {
            scope = key;
            [...e.currentTarget.parentElement.children].forEach((c) => c.classList.remove('active'));
            e.currentTarget.classList.add('active');
            load();
          },
        },
        label
      )
    )
  );

  mount(
    root,
    h(
      'div',
      { class: 'page-head flex items-center justify-between wrap gap-16' },
      h(
        'div',
        {},
        h('h1', { class: 'page-title' }, 'Playlists'),
        h('p', { class: 'page-sub' }, 'Create, curate, reorder and share your collections.')
      ),
      h('button', { class: 'btn btn-primary', onclick: () => playlistFormModal({ onDone: load }) }, icon('plus'), 'New playlist')
    ),
    tabs,
    grid
  );

  load();
  window.addEventListener('sonora:playlists-changed', load, { signal });
}

/* -------------------------------------------------------- detail view */

export function renderPlaylistDetail(root, { navigate, params }) {
  const slot = h('div');
  mount(root, slot);
  mount(slot, loadingRows(8));

  let playlist = null;

  const removeTrack = async (row) => {
    const prevTracks = [...playlist.tracks];
    await optimistic({
      apply() {
        playlist.tracks = playlist.tracks.filter((t) => t.rowId !== row.rowId);
        playlist.trackCount = playlist.tracks.length;
        paint();
      },
      rollback() {
        playlist.tracks = prevTracks;
        playlist.trackCount = prevTracks.length;
        paint();
      },
      commit: () => api.del(`/api/playlists/${playlist.id}/tracks/${row.rowId}`),
      onSuccess: (res) => {
        playlist = res.playlist;
        paint();
        toast('Removed from playlist');
        window.dispatchEvent(new CustomEvent('sonora:playlists-changed'));
      },
      errorMessage: 'Could not remove that track',
    }).catch(() => {});
  };

  const reorder = async (from, to) => {
    const prevTracks = [...playlist.tracks];
    const moved = playlist.tracks[from];
    await optimistic({
      apply() {
        const arr = [...playlist.tracks];
        const [item] = arr.splice(from, 1);
        arr.splice(to, 0, item);
        playlist.tracks = arr;
        paint();
      },
      rollback() {
        playlist.tracks = prevTracks;
        paint();
      },
      commit: () => api.patch(`/api/playlists/${playlist.id}/tracks/${moved.rowId}`, { position: to }),
      onSuccess: (res) => {
        playlist = res.playlist;
        paint();
      },
      errorMessage: 'Could not reorder',
    }).catch(() => {});
  };

  const paint = () => {
    const tracks = playlist.tracks || [];
    const totalMs = tracks.reduce((s, t) => s + (t.durationMs || 0), 0);
    const covers = tracks.filter((t) => t.artwork).slice(0, 4);

    const likeBtn = h(
      'button',
      { class: `btn ${playlist.likedByMe ? 'btn-primary' : ''}` },
      icon(playlist.likedByMe ? 'heartFilled' : 'heart'),
      String(playlist.likeCount || 0)
    );
    likeBtn.addEventListener('click', async () => {
      const was = playlist.likedByMe;
      await optimistic({
        apply() {
          playlist.likedByMe = !was;
          playlist.likeCount += was ? -1 : 1;
          likeBtn.className = `btn ${playlist.likedByMe ? 'btn-primary' : ''}`;
          likeBtn.replaceChildren(icon(playlist.likedByMe ? 'heartFilled' : 'heart'), document.createTextNode(String(playlist.likeCount)));
        },
        rollback() {
          playlist.likedByMe = was;
          playlist.likeCount += was ? 1 : -1;
          likeBtn.className = `btn ${playlist.likedByMe ? 'btn-primary' : ''}`;
          likeBtn.replaceChildren(icon(playlist.likedByMe ? 'heartFilled' : 'heart'), document.createTextNode(String(playlist.likeCount)));
        },
        commit: () => api.post('/api/likes', { targetType: 'playlist', targetId: playlist.id }),
        errorMessage: 'Could not update like',
      }).catch(() => {});
    });

    const head = h(
      'div',
      { class: 'detail-head' },
      h(
        'div',
        { class: 'detail-cover' },
        covers.length >= 4
          ? h('div', { class: 'detail-cover-grid' }, ...covers.map((t) => h('img', { src: t.artwork, alt: '' })))
          : covers.length
          ? h('img', { src: covers[0].artwork, alt: '' })
          : h('div', { class: 'detail-cover-fallback' }, '♫')
      ),
      h(
        'div',
        { class: 'detail-meta' },
        h(
          'div',
          { class: 'detail-kicker' },
          playlist.aiGenerated ? h('span', { class: 'badge badge-ai' }, 'AI generated') : 'Playlist',
          !playlist.isPublic ? h('span', { class: 'badge badge-private', style: { marginLeft: '7px' } }, 'Private') : null
        ),
        h('h1', { class: 'detail-title' }, playlist.name),
        playlist.description ? h('p', { class: 'detail-desc' }, playlist.description) : null,
        h(
          'div',
          { class: 'detail-facts' },
          playlist.owner ? avatar(playlist.owner, 22) : null,
          playlist.owner?.displayName,
          h('span', { class: 'dot-sep' }),
          `${playlist.trackCount} track${playlist.trackCount === 1 ? '' : 's'}`,
          totalMs ? h('span', { class: 'dot-sep' }) : null,
          totalMs ? fmtDuration(totalMs) : null,
          h('span', { class: 'dot-sep' }),
          `updated ${timeAgo(playlist.updatedAt)}`
        ),
        playlist.aiPrompt
          ? h(
              'div',
              { class: 'text-xs text-faint', style: { marginTop: '10px', fontStyle: 'italic' } },
              `Prompt: "${playlist.aiPrompt}"`
            )
          : null,
        h(
          'div',
          { class: 'detail-actions' },
          h(
            'button',
            {
              class: 'btn btn-primary',
              disabled: !tracks.length,
              onclick: () => playQueue(tracks, 0, { queueName: playlist.name }),
            },
            icon('play'),
            'Play'
          ),
          likeBtn,
          h(
            'button',
            {
              class: 'btn',
              onclick: () => sharePlaylistModal(playlist),
            },
            icon('share'),
            'Share'
          ),
          playlist.isOwner
            ? h(
                'button',
                {
                  class: 'btn',
                  onclick: () =>
                    playlistFormModal({
                      playlist,
                      onDone: (p) => {
                        playlist = { ...playlist, ...p };
                        paint();
                      },
                    }),
                },
                icon('edit'),
                'Edit'
              )
            : null,
          playlist.isOwner
            ? h(
                'button',
                {
                  class: 'btn btn-danger',
                  onclick: async () => {
                    const ok = await confirmDialog({
                      title: 'Delete this playlist?',
                      message: `"${playlist.name}" and its ${playlist.trackCount} tracks will be permanently removed. This cannot be undone.`,
                    });
                    if (!ok) return;
                    try {
                      await api.del(`/api/playlists/${playlist.id}`);
                      toast('Playlist deleted');
                      window.dispatchEvent(new CustomEvent('sonora:playlists-changed'));
                      navigate('playlists');
                    } catch (err) {
                      toast(err.message, 'error');
                    }
                  },
                },
                icon('trash'),
                'Delete'
              )
            : null
        )
      )
    );

    const body = tracks.length
      ? h(
          'div',
          { class: 'track-list' },
          ...tracks.map((t, i) =>
            trackRow(t, {
              index: i,
              context: tracks,
              contextName: playlist.name,
              draggable: playlist.isOwner,
              onDrop: playlist.isOwner ? reorder : null,
              onRemove: playlist.isOwner ? () => removeTrack(t) : null,
            })
          )
        )
      : emptyState({
          iconName: 'music',
          title: 'This playlist is empty',
          text: playlist.isOwner
            ? 'Search for music and use the + button on any track to add it here.'
            : 'The owner has not added any tracks yet.',
          action: playlist.isOwner
            ? h('button', { class: 'btn btn-primary', onclick: () => navigate('search') }, icon('search'), 'Find tracks')
            : null,
        });

    mount(
      slot,
      h('button', { class: 'btn btn-ghost btn-sm', style: { marginBottom: '16px' }, onclick: () => navigate('playlists') }, '← Playlists'),
      head,
      playlist.isOwner && tracks.length
        ? h('p', { class: 'text-xs text-faint', style: { marginBottom: '10px' } }, 'Tip: drag rows to reorder — changes save automatically.')
        : null,
      body
    );
  };

  api
    .get(`/api/playlists/${params.id}`)
    .then(({ playlist: p }) => {
      playlist = p;
      paint();
    })
    .catch((err) =>
      mount(
        slot,
        emptyState({
          iconName: 'x',
          title: err.status === 404 ? 'Playlist not found' : 'Could not open playlist',
          text: err.message,
          action: h('button', { class: 'btn btn-primary', onclick: () => navigate('playlists') }, 'Back to playlists'),
        })
      )
    );
}

/* ------------------------------------------------------------- share */

export function sharePlaylistModal(playlist) {
  openModal(({ close }) => {
    const msg = h('textarea', { class: 'textarea', placeholder: 'Tell people why they should listen…', maxlength: '500' });
    const submit = h('button', { class: 'btn btn-primary' }, 'Post to feed');
    submit.addEventListener('click', async () => {
      submit.disabled = true;
      submit.replaceChildren(h('div', { class: 'spinner' }), document.createTextNode('Posting…'));
      try {
        await api.post('/api/shares', { playlistId: playlist.id, message: msg.value.trim() });
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
        h('div', {}, h('div', { class: 'modal-title' }, 'Share playlist')),
        h('button', { class: 'modal-close', onclick: close }, '×')
      ),
      h(
        'div',
        { class: 'modal-body' },
        !playlist.isPublic
          ? h('div', { class: 'auth-alert' }, 'This playlist is private — make it public first so others can open it.')
          : null,
        h(
          'div',
          { class: 'embed' },
          playlist.covers?.[0] ? h('img', { class: 'embed-art', src: playlist.covers[0], alt: '' }) : h('div', { class: 'embed-art-fallback' }, '♫'),
          h(
            'div',
            { class: 'embed-meta' },
            h('div', { class: 'embed-title' }, playlist.name),
            h('div', { class: 'embed-sub' }, `${playlist.trackCount} tracks`)
          )
        ),
        msg
      ),
      h('div', { class: 'modal-foot' }, h('button', { class: 'btn btn-ghost', onclick: close }, 'Cancel'), submit)
    );
  });
}
