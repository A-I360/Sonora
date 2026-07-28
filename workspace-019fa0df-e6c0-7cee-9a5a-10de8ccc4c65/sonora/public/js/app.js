/* ============================================================
   Sonora app shell — routing, sidebar, bootstrap
   ============================================================ */

import { h, mount, api, store, toast, $ } from './core.js';
import { icon, icons } from './icons.js';
import { avatar } from './components.js';
import { renderPlayerBar } from './views/player-bar.js';
import { renderAuth } from './views/auth.js';
import { renderHome } from './views/home.js';
import { renderSearch } from './views/search.js';
import { renderAI } from './views/ai.js';
import { renderPlaylists, renderPlaylistDetail, playlistFormModal } from './views/playlists.js';
import { renderLibrary } from './views/library.js';
import { renderFeed } from './views/feed.js';
import { renderProfile } from './views/profile.js';
import { clearQueue } from './player.js';

const appRoot = document.getElementById('app');

/* ------------------------------------------------------------ routing */

const ROUTES = {
  home: { render: renderHome, title: 'Home' },
  search: { render: renderSearch, title: 'Search' },
  ai: { render: renderAI, title: 'AI Studio' },
  playlists: { render: renderPlaylists, title: 'Playlists' },
  playlist: { render: renderPlaylistDetail, title: 'Playlist' },
  library: { render: renderLibrary, title: 'Library' },
  feed: { render: renderFeed, title: 'Community' },
  profile: { render: renderProfile, title: 'Profile' },
};

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  if (!raw) return { name: 'home', params: {} };
  const [path, qs] = raw.split('?');
  const [name, id] = path.split('/');
  const params = { id };
  if (qs) for (const [k, v] of new URLSearchParams(qs)) params[k] = v;
  return { name: ROUTES[name] ? name : 'home', params };
}

function navigate(name, params = {}) {
  let hash = `#/${name}`;
  if (params.id) hash += `/${params.id}`;
  const rest = Object.entries(params).filter(([k]) => k !== 'id');
  if (rest.length) hash += `?${new URLSearchParams(rest)}`;
  if (location.hash === hash) renderRoute();
  else location.hash = hash;
}

/* ------------------------------------------------------------ sidebar */

const NAV_MAIN = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'search', label: 'Search', icon: 'search' },
  { key: 'ai', label: 'AI Studio', icon: 'sparkle' },
  { key: 'feed', label: 'Community', icon: 'users' },
];

const NAV_LIB = [
  { key: 'library', label: 'Your library', icon: 'heart' },
  { key: 'playlists', label: 'Playlists', icon: 'listMusic' },
];

function renderSidebar(route) {
  const user = store.get().user;
  const playlists = store.get().playlists;

  const navBtn = (item) =>
    h(
      'button',
      {
        class: `nav-item ${route.name === item.key ? 'active' : ''}`,
        onclick: () => {
          navigate(item.key);
          closeSidebar();
        },
      },
      icon(item.icon),
      h('span', {}, item.label),
      item.key === 'library' && store.get().library.length
        ? h('span', { class: 'count' }, String(store.get().library.length))
        : item.key === 'playlists' && playlists.length
        ? h('span', { class: 'count' }, String(playlists.length))
        : null
    );

  return h(
    'aside',
    { class: `sidebar ${store.get().sidebarOpen ? 'open' : ''}`, id: 'sidebar' },
    h(
      'a',
      { class: 'brand', href: '#/home', onclick: () => closeSidebar() },
      h('div', { class: 'brand-mark', html: icons.logo }),
      h('div', { class: 'brand-text' }, 'Son', h('span', {}, 'ora'))
    ),

    h('div', { class: 'nav-label' }, 'Discover'),
    ...NAV_MAIN.map(navBtn),

    h('div', { class: 'nav-label' }, 'Your music'),
    ...NAV_LIB.map(navBtn),

    h(
      'div',
      { class: 'nav-label flex items-center justify-between' },
      'Playlists',
      h(
        'button',
        {
          class: 'btn btn-icon btn-ghost',
          style: { padding: '3px' },
          title: 'New playlist',
          onclick: () => playlistFormModal({ onDone: (p) => navigate('playlist', { id: p.id }) }),
        },
        icon('plus')
      )
    ),
    playlists.length
      ? h(
          'div',
          { class: 'sidebar-playlists' },
          ...playlists.slice(0, 12).map((pl) =>
            h(
              'button',
              {
                class: `sidebar-pl ${route.name === 'playlist' && route.params.id === pl.id ? 'active' : ''}`,
                onclick: () => {
                  navigate('playlist', { id: pl.id });
                  closeSidebar();
                },
              },
              pl.covers?.[0]
                ? h('img', { class: 'sidebar-pl-cover', src: pl.covers[0], alt: '' })
                : h('div', { class: 'sidebar-pl-cover' }, pl.aiGenerated ? '✨' : '♫'),
              h('span', { class: 'sidebar-pl-name' }, pl.name)
            )
          )
        )
      : h(
          'p',
          { class: 'text-xs text-faint', style: { padding: '4px 12px', lineHeight: '1.6' } },
          'No playlists yet. Create one or generate a mix in the AI studio.'
        ),

    h(
      'div',
      { class: 'sidebar-footer' },
      h(
        'button',
        {
          class: 'user-chip',
          onclick: () => {
            navigate('profile');
            closeSidebar();
          },
        },
        avatar(user, 32),
        h(
          'div',
          { class: 'user-chip-meta' },
          h('div', { class: 'user-chip-name' }, user.displayName),
          h('div', { class: 'user-chip-handle' }, `@${user.handle}`)
        ),
        icon('settings')
      )
    )
  );
}

function closeSidebar() {
  if (store.get().sidebarOpen) store.set({ sidebarOpen: false });
  $('#sidebar')?.classList.remove('open');
  $('#scrim')?.classList.remove('show');
}

/* -------------------------------------------------------------- shell */

let mainEl = null;
let sidebarSlot = null;

function renderShell() {
  const route = parseHash();

  const searchInput = h('input', {
    class: 'search-input',
    id: 'global-search',
    type: 'search',
    placeholder: 'Search songs, artists, albums…',
    autocomplete: 'off',
  });
  searchInput.addEventListener('focus', () => {
    if (parseHash().name !== 'search') navigate('search');
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && parseHash().name !== 'search') {
      navigate('search', { q: e.target.value });
    }
  });

  const scrim = h('div', {
    class: 'sidebar-scrim',
    id: 'scrim',
    onclick: closeSidebar,
  });

  sidebarSlot = h('div', { style: { display: 'contents' } }, renderSidebar(route));
  mainEl = h('div', { class: 'main-inner' });

  const shell = h(
    'div',
    { class: 'shell' },
    sidebarSlot,
    h(
      'main',
      { class: 'main', id: 'main-scroll' },
      h(
        'div',
        { class: 'topbar' },
        h(
          'button',
          {
            class: 'btn btn-icon menu-btn mobile-only',
            title: 'Menu',
            onclick: () => {
              store.set({ sidebarOpen: true });
              $('#sidebar')?.classList.add('open');
              scrim.classList.add('show');
            },
          },
          icon('menu')
        ),
        h(
          'div',
          { class: 'search-wrap' },
          icon('search', 'search-icon'),
          searchInput
        ),
        h(
          'button',
          { class: 'btn btn-primary btn-sm', onclick: () => navigate('ai') },
          icon('sparkle'),
          h('span', { class: 'ai-btn-label' }, 'AI Studio')
        )
      ),
      mainEl
    ),
    renderPlayerBar()
  );

  mount(appRoot, shell, scrim);
  renderRoute();
}

function renderRoute() {
  const route = parseHash();
  store.set({ route });

  // repaint sidebar so the active item + playlist list stay in sync
  if (sidebarSlot) mount(sidebarSlot, renderSidebar(route));

  const entry = ROUTES[route.name] || ROUTES.home;
  document.title = `${entry.title} · Sonora`;
  $('#main-scroll')?.scrollTo({ top: 0 });

  mount(mainEl);
  entry.render(mainEl, {
    navigate,
    params: route.params,
    query: route.params.q,
    onSignedOut: signOut,
  });
}

window.addEventListener('hashchange', renderRoute);

/* --------------------------------------------------------- data sync */

async function refreshPlaylists() {
  try {
    const { playlists } = await api.get('/api/playlists?scope=mine');
    store.set({ playlists });
    if (sidebarSlot) mount(sidebarSlot, renderSidebar(parseHash()));
  } catch {
    /* non-fatal */
  }
}

async function refreshLibrary() {
  try {
    const { tracks } = await api.get('/api/library');
    store.set({ library: tracks, librarySet: new Set(tracks.map((t) => t.id)) });
  } catch {
    /* non-fatal */
  }
}

window.addEventListener('sonora:playlists-changed', refreshPlaylists);
window.addEventListener('sonora:user-changed', () => {
  if (sidebarSlot) mount(sidebarSlot, renderSidebar(parseHash()));
});

/* ------------------------------------------------------------- auth */

function signOut() {
  clearQueue();
  store.set({ user: null, playlists: [], library: [], librarySet: new Set() });
  location.hash = '';
  renderAuth(appRoot, { onAuthed: onSignedIn });
  toast('Signed out');
}

async function onSignedIn(user) {
  store.set({ user });
  await Promise.all([refreshPlaylists(), refreshLibrary(), loadProviders()]);
  renderShell();
  // Set the default hash AFTER the shell is in place so the hashchange
  // event (which fires synchronously in some browsers) doesn't crash
  // renderRoute() before sidebarSlot / mainEl exist.
  if (!location.hash) location.hash = '#/home';
}

async function loadProviders() {
  try {
    const data = await api.get('/api/providers');
    store.set({ providers: data.providers, aiStatus: data.ai });
  } catch {
    /* non-fatal */
  }
}

/* ---------------------------------------------------------- bootstrap */

async function boot() {
  mount(
    appRoot,
    h(
      'div',
      { class: 'auth-screen' },
      h(
        'div',
        { class: 'flex-col items-center gap-16' },
        h('div', { class: 'auth-mark', html: icons.logo }),
        h('div', { class: 'spinner spinner-lg' }),
        h('p', { class: 'text-dim text-sm' }, 'Starting Sonora…')
      )
    )
  );

  try {
    const { user } = await api.get('/api/auth/me');
    if (user) {
      store.set({ user, booting: false });
      await Promise.all([refreshPlaylists(), refreshLibrary(), loadProviders()]);
      renderShell();
    } else {
      store.set({ booting: false });
      renderAuth(appRoot, { onAuthed: onSignedIn });
    }
  } catch (err) {
    store.set({ booting: false });
    mount(
      appRoot,
      h(
        'div',
        { class: 'auth-screen' },
        h(
          'div',
          { class: 'auth-card', style: { textAlign: 'center' } },
          h('div', { class: 'empty-art', style: { margin: '0 auto 18px' } }, icon('x')),
          h('div', { class: 'auth-title' }, 'Cannot reach the server'),
          h('p', { class: 'auth-sub' }, err.message),
          h('button', { class: 'btn btn-primary btn-block', style: { marginTop: '20px' }, onclick: () => location.reload() }, 'Retry')
        )
      )
    );
  }
}

boot();
