/* Dashboard home: greeting, stats, recommendations, editorial rows. */

import { h, mount, api, store, fmtDuration } from '../core.js';
import { icon } from '../icons.js';
import {
  trackCard,
  playlistCard,
  loadingCards,
  emptyState,
  sectionHead,
  featureBars,
  trackList,
} from '../components.js';
import { playQueue } from '../player.js';

function greeting() {
  const hr = new Date().getHours();
  if (hr < 5) return 'Still up';
  if (hr < 12) return 'Good morning';
  if (hr < 17) return 'Good afternoon';
  if (hr < 22) return 'Good evening';
  return 'Late night';
}

export function renderHome(root, { navigate }) {
  const user = store.get().user;

  const statsSlot = h('div', { class: 'section' });
  const recsSlot = h('div', { class: 'section' });
  const plSlot = h('div', { class: 'section' });
  const rowsSlot = h('div');

  mount(
    root,
    h(
      'div',
      { class: 'page-head' },
      h('h1', { class: 'page-title' }, `${greeting()}, ${user.displayName.split(' ')[0]}`),
      h('p', { class: 'page-sub' }, 'Your dashboard — stats, AI picks and fresh music across every connected catalog.')
    ),
    statsSlot,
    recsSlot,
    plSlot,
    rowsSlot
  );

  /* ------------------------------------------------------------ stats */
  mount(
    statsSlot,
    h(
      'div',
      { class: 'stat-grid' },
      ...Array.from({ length: 4 }, () =>
        h(
          'div',
          { class: 'stat-card' },
          h('div', { class: 'skeleton', style: { width: '36px', height: '36px', borderRadius: '10px', marginBottom: '13px' } }),
          h('div', { class: 'skeleton skel-line', style: { width: '48px', height: '22px', marginBottom: '8px' } }),
          h('div', { class: 'skeleton skel-line', style: { width: '70%', height: '9px' } })
        )
      )
    )
  );

  api
    .get('/api/stats')
    .then(({ stats }) => {
      const cards = [
        { icon: 'listMusic', value: stats.playlists, label: 'Playlists' },
        { icon: 'heart', value: stats.savedTracks, label: 'Saved tracks' },
        { icon: 'wave', value: stats.plays, label: 'Tracks played' },
        { icon: 'clock', value: fmtDuration(stats.listenedMs), label: 'Listening time' },
      ];
      mount(
        statsSlot,
        h(
          'div',
          { class: 'stat-grid' },
          ...cards.map((c) =>
            h(
              'div',
              { class: 'stat-card' },
              h('div', { class: 'stat-icon' }, icon(c.icon)),
              h('div', { class: 'stat-value' }, String(c.value)),
              h('div', { class: 'stat-label' }, c.label)
            )
          )
        )
      );
    })
    .catch(() => mount(statsSlot));

  /* -------------------------------------------------- recommendations */
  mount(recsSlot, sectionHead('Made for you'), loadingCards(6));

  api
    .get('/api/ai/recommendations')
    .then(({ tracks, profile, cold, hint }) => {
      if (cold || !tracks.length) {
        mount(
          recsSlot,
          sectionHead('Made for you'),
          emptyState({
            iconName: 'sparkle',
            title: 'Teach Sonora your taste',
            text: hint || 'Save or play a few tracks and personalised picks will appear here.',
            action: h('button', { class: 'btn btn-primary', onclick: () => navigate('search') }, icon('search'), 'Find music'),
          })
        );
        return;
      }
      mount(
        recsSlot,
        sectionHead(
          'Made for you',
          h('button', { class: 'btn btn-sm', onclick: () => playQueue(tracks, 0, { queueName: 'Made for you' }) }, icon('play'), 'Play all')
        ),
        h(
          'div',
          {
            style: {
              display: 'grid',
              gridTemplateColumns: 'minmax(0,1fr) minmax(0,260px)',
              gap: '20px',
              alignItems: 'start',
            },
            class: 'recs-layout',
          },
          h('div', { class: 'row-scroll' }, ...tracks.map((t) => trackCard(t, tracks))),
          h(
            'div',
            { class: 'glass', style: { borderRadius: 'var(--radius)', padding: '17px' } },
            h('div', { style: { fontSize: '13px', fontWeight: '700', marginBottom: '5px' } }, 'Your taste profile'),
            h('p', { class: 'text-xs text-dim', style: { marginBottom: '14px', lineHeight: '1.55' } }, profile.summary),
            featureBars(profile.vector),
            profile.topGenres?.length
              ? h(
                  'div',
                  { class: 'flex wrap gap-6', style: { marginTop: '14px' } },
                  ...profile.topGenres.slice(0, 4).map((g) => h('span', { class: 'chip chip-static' }, g.name))
                )
              : null
          )
        )
      );
      // stack the sidebar under the carousel on narrow screens
      const layout = recsSlot.querySelector('.recs-layout');
      const applyLayout = () => {
        if (layout) layout.style.gridTemplateColumns = window.innerWidth < 900 ? 'minmax(0,1fr)' : 'minmax(0,1fr) minmax(0,260px)';
      };
      applyLayout();
      window.addEventListener('resize', applyLayout);
    })
    .catch(() => mount(recsSlot));

  /* -------------------------------------------------------- playlists */
  const paintPlaylists = () => {
    const playlists = store.get().playlists;
    if (!playlists.length) {
      mount(
        plSlot,
        sectionHead('Your playlists'),
        emptyState({
          iconName: 'listMusic',
          title: 'No playlists yet',
          text: 'Build one by hand, or let the AI studio create one from a vibe you describe.',
          action: h(
            'div',
            { class: 'flex gap-10 wrap', style: { justifyContent: 'center' } },
            h('button', { class: 'btn btn-primary', onclick: () => navigate('ai') }, icon('sparkle'), 'Generate with AI'),
            h('button', { class: 'btn', onclick: () => navigate('playlists') }, icon('plus'), 'New playlist')
          ),
        })
      );
      return;
    }
    mount(
      plSlot,
      sectionHead(
        'Your playlists',
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => navigate('playlists') }, 'See all')
      ),
      h(
        'div',
        { class: 'card-grid' },
        ...playlists.slice(0, 6).map((pl) => playlistCard(pl, (p) => navigate('playlist', { id: p.id })))
      )
    );
  };
  paintPlaylists();
  const unsub = store.subscribe(() => {
    if (document.body.contains(plSlot)) paintPlaylists();
    else unsub();
  });

  /* ------------------------------------------------------ browse rows */
  mount(rowsSlot, h('div', { class: 'section' }, sectionHead('Fresh from the catalog'), loadingCards(6)));

  api
    .get('/api/browse')
    .then(({ rows }) => {
      if (!rows.length) {
        mount(
          rowsSlot,
          emptyState({
            iconName: 'compass',
            title: 'Catalog unreachable',
            text: 'The music providers did not respond. Check your connection and refresh.',
          })
        );
        return;
      }
      mount(
        rowsSlot,
        ...rows.map((row) =>
          h(
            'div',
            { class: 'section' },
            sectionHead(
              row.title,
              h(
                'button',
                { class: 'btn btn-sm btn-ghost', onclick: () => playQueue(row.tracks, 0, { queueName: row.title }) },
                icon('play'),
                'Play'
              )
            ),
            h('div', { class: 'row-scroll' }, ...row.tracks.map((t) => trackCard(t, row.tracks)))
          )
        )
      );
    })
    .catch(() =>
      mount(
        rowsSlot,
        emptyState({ iconName: 'compass', title: 'Could not load the catalog', text: 'Please try again in a moment.' })
      )
    );
}
