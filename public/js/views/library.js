/* Saved tracks + recently played. */

import { h, mount, api, store } from '../core.js';
import { icon } from '../icons.js';
import { trackList, loadingRows, emptyState, sectionHead } from '../components.js';
import { playQueue } from '../player.js';

export function renderLibrary(root, { navigate }) {
  let tab = 'saved';
  const slot = h('div');

  const load = async () => {
    mount(slot, loadingRows(8));
    try {
      if (tab === 'saved') {
        const { tracks } = await api.get('/api/library');
        store.set({ library: tracks, librarySet: new Set(tracks.map((t) => t.id)) });
        if (!tracks.length) {
          mount(
            slot,
            emptyState({
              iconName: 'heart',
              title: 'Your library is empty',
              text: 'Tap the heart on any track to save it here. Saved tracks also teach the AI what you like.',
              action: h('button', { class: 'btn btn-primary', onclick: () => navigate('search') }, icon('search'), 'Find music'),
            })
          );
          return;
        }
        mount(
          slot,
          sectionHead(
            `${tracks.length} saved track${tracks.length === 1 ? '' : 's'}`,
            h('button', { class: 'btn btn-sm', onclick: () => playQueue(tracks, 0, { queueName: 'Your library' }) }, icon('play'), 'Play all')
          ),
          trackList(tracks, { contextName: 'Your library', showAlbum: true })
        );
      } else {
        const { tracks } = await api.get('/api/plays/recent');
        if (!tracks.length) {
          mount(
            slot,
            emptyState({
              iconName: 'clock',
              title: 'Nothing played yet',
              text: 'Tracks you listen to show up here so you can find them again.',
              action: h('button', { class: 'btn btn-primary', onclick: () => navigate('home') }, 'Browse music'),
            })
          );
          return;
        }
        mount(
          slot,
          sectionHead(
            'Recently played',
            h('button', { class: 'btn btn-sm', onclick: () => playQueue(tracks, 0, { queueName: 'Recently played' }) }, icon('play'), 'Play all')
          ),
          trackList(tracks, { contextName: 'Recently played', showAlbum: true })
        );
      }
    } catch (err) {
      mount(slot, emptyState({ iconName: 'x', title: 'Could not load your library', text: err.message }));
    }
  };

  mount(
    root,
    h(
      'div',
      { class: 'page-head' },
      h('h1', { class: 'page-title' }, 'Your library'),
      h('p', { class: 'page-sub' }, 'Everything you have saved, plus what you have been listening to.')
    ),
    h(
      'div',
      { class: 'tabs' },
      ...[
        ['saved', 'Saved tracks'],
        ['recent', 'Recently played'],
      ].map(([key, label]) =>
        h(
          'button',
          {
            class: `tab ${tab === key ? 'active' : ''}`,
            onclick: (e) => {
              tab = key;
              [...e.currentTarget.parentElement.children].forEach((c) => c.classList.remove('active'));
              e.currentTarget.classList.add('active');
              load();
            },
          },
          label
        )
      )
    ),
    slot
  );

  load();
}
