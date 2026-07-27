/* Search across every enabled provider. */

import { h, mount, api, store, debounce } from '../core.js';
import { icon } from '../icons.js';
import { trackList, loadingRows, emptyState, sectionHead } from '../components.js';
import { playQueue } from '../player.js';

let lastQuery = '';
let lastResults = null;
let activeProvider = null;

export function renderSearch(root, { navigate, query }) {
  const q = query ?? lastQuery;
  const results = h('div');
  const filters = h('div', { class: 'flex gap-8 wrap', style: { marginBottom: '18px' } });

  mount(
    root,
    h(
      'div',
      { class: 'page-head' },
      h('h1', { class: 'page-title' }, 'Search'),
      h('p', { class: 'page-sub' }, 'One query, every connected catalog — Apple Music, Deezer, Audius and Spotify.')
    ),
    filters,
    results
  );

  const paintFilters = () => {
    const provs = store.get().providers.filter((p) => p.enabled);
    mount(
      filters,
      h(
        'button',
        {
          class: `chip ${activeProvider === null ? 'active' : ''}`,
          onclick: () => {
            activeProvider = null;
            run(lastQuery, true);
          },
        },
        'All sources'
      ),
      ...provs.map((p) =>
        h(
          'button',
          {
            class: `chip ${activeProvider === p.key ? 'active' : ''}`,
            title: p.note,
            onclick: () => {
              activeProvider = p.key;
              run(lastQuery, true);
            },
          },
          h('span', { class: `prov-dot prov-${p.key}` }),
          p.label
        )
      )
    );
  };
  paintFilters();

  const paintResults = (data) => {
    if (!data.tracks.length) {
      mount(
        results,
        emptyState({
          iconName: 'search',
          title: `No results for "${lastQuery}"`,
          text: 'Try a different spelling, another artist, or switch the source filter above.',
        })
      );
      return;
    }
    mount(
      results,
      sectionHead(
        `${data.tracks.length} result${data.tracks.length === 1 ? '' : 's'}`,
        h(
          'button',
          { class: 'btn btn-sm', onclick: () => playQueue(data.tracks, 0, { queueName: `Search: ${lastQuery}` }) },
          icon('play'),
          'Play all'
        )
      ),
      trackList(data.tracks, { contextName: `Search: ${lastQuery}`, showAlbum: true })
    );
  };

  const run = async (value, force = false) => {
    const term = String(value || '').trim();
    lastQuery = term;
    if (!term) {
      lastResults = null;
      mount(
        results,
        emptyState({
          iconName: 'search',
          title: 'What do you want to hear?',
          text: 'Search by song, artist, album or mood. Results come from every connected catalog at once.',
        })
      );
      return;
    }
    if (!force && lastResults && lastResults.query === term && lastResults.provider === activeProvider) {
      paintResults(lastResults.data);
      return;
    }
    mount(results, sectionHead(`Searching "${term}"…`), loadingRows(8));
    try {
      const params = new URLSearchParams({ q: term, limit: '30' });
      if (activeProvider) params.set('provider', activeProvider);
      const data = await api.get(`/api/search?${params}`);
      if (lastQuery !== term) return; // a newer query already landed
      lastResults = { query: term, provider: activeProvider, data };
      paintResults(data);
    } catch (err) {
      mount(results, emptyState({ iconName: 'x', title: 'Search failed', text: err.message }));
    }
  };

  paintFilters();
  run(q);

  // wire the topbar input to this view
  const input = document.querySelector('#global-search');
  if (input) {
    input.value = q;
    const handler = debounce((e) => run(e.target.value), 380);
    input.oninput = handler;
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        handler.cancel();
        run(e.target.value, true);
      }
    };
  }
}
