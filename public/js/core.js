/* ============================================================
   Sonora core — DOM helpers, API client, store, toasts, utils
   ============================================================ */

/* ------------------------------------------------------------- dom */

// SVG elements must be created in the SVG namespace or the browser produces an
// inert HTMLUnknownElement that renders nothing.
const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'g', 'defs', 'use']);

export function h(tag, props = {}, ...children) {
  const isSvg = SVG_TAGS.has(tag);
  const el = isSvg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') {
      if (isSvg) el.setAttribute('class', v);
      else el.className = v;
    }
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = Boolean(v);
    else el.setAttribute(k, v);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function mount(el, ...children) {
  clear(el);
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/* ------------------------------------------------------------- api */

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    throw new ApiError(0, 'Network unavailable — check your connection');
  }

  if (res.status === 204) return null;

  let data;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError(res.status, 'Unexpected response from server');
  }

  if (!res.ok) {
    throw new ApiError(res.status, data?.error || `Request failed (${res.status})`, data?.details);
  }
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b),
  patch: (p, b) => request('PATCH', p, b),
  put: (p, b) => request('PUT', p, b),
  del: (p) => request('DELETE', p),
};

/* ----------------------------------------------------------- store */

function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...next };
      for (const fn of subs) fn(state);
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export const store = createStore({
  user: null,
  booting: true,
  route: { name: 'home', params: {} },
  playlists: [],
  library: [],
  librarySet: new Set(),
  providers: [],
  aiStatus: null,
  sidebarOpen: false,
});

/* ---------------------------------------------------------- toasts */

const TOAST_ICONS = {
  success: '<path d="M20 6L9 17l-5-5"/>',
  error: '<circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
};

export function toast(message, type = 'success', ms = 3200) {
  let host = $('#toasts');
  if (!host) {
    host = h('div', { id: 'toasts', class: 'toasts' });
    document.body.append(host);
  }
  const el = h(
    'div',
    { class: `toast toast-${type}` },
    h('svg', {
      class: 'toast-icon',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2.2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      html: TOAST_ICONS[type] || TOAST_ICONS.info,
    }),
    h('span', {}, message)
  );
  host.append(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 260);
  }, ms);
  return el;
}

/* ----------------------------------------------------------- utils */

export function fmtTime(ms) {
  if (!ms || ms < 0 || !Number.isFinite(ms)) return '0:00';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m >= 60) {
    const hrs = Math.floor(m / 60);
    return `${hrs}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtDuration(ms) {
  const mins = Math.round((ms || 0) / 60000);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  return `${hrs} hr ${mins % 60} min`;
}

export function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const hr = Math.floor(m / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function initials(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

export function debounce(fn, ms = 320) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/** Audio URLs go through our proxy: fixes CORS + Audius redirects + Range. */
export function streamUrl(track) {
  const raw = track?.streamUrl || track?.previewUrl;
  if (!raw) return null;
  return `/api/stream?url=${encodeURIComponent(raw)}`;
}

export function isPlayable(track) {
  return Boolean(track?.streamUrl || track?.previewUrl);
}

/* ------------------------------------------------- optimistic helper */

/**
 * Apply an optimistic UI change, fire the request, roll back on failure.
 *
 *   optimistic({
 *     apply()    -> mutate local state + repaint immediately
 *     rollback() -> undo it
 *     commit()   -> Promise (the real request)
 *     onSuccess(result)
 *     errorMessage
 *   })
 */
export async function optimistic({ apply, rollback, commit, onSuccess, errorMessage }) {
  apply?.();
  try {
    const result = await commit();
    onSuccess?.(result);
    return result;
  } catch (err) {
    rollback?.();
    toast(errorMessage || err.message || 'Something went wrong', 'error');
    throw err;
  }
}

/* -------------------------------------------------------- confirm */

export function confirmDialog({ title, message, confirmLabel = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    const backdrop = h('div', { class: 'modal-backdrop' });
    const close = (val) => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter') close(true);
    };
    document.addEventListener('keydown', onKey);

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(false);
    });

    backdrop.append(
      h(
        'div',
        { class: 'modal', style: { maxWidth: '420px' } },
        h('div', { class: 'modal-head' }, h('div', {}, h('div', { class: 'modal-title' }, title))),
        h('p', { class: 'text-dim', style: { fontSize: '13.5px', lineHeight: '1.65' } }, message),
        h(
          'div',
          { class: 'modal-foot' },
          h('button', { class: 'btn btn-ghost', onclick: () => close(false) }, 'Cancel'),
          h(
            'button',
            { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => close(true) },
            confirmLabel
          )
        )
      )
    );
    document.body.append(backdrop);
  });
}

/* --------------------------------------------------------- modal */

export function openModal(render, { size = '' } = {}) {
  const backdrop = h('div', { class: 'modal-backdrop' });
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  const modal = h('div', { class: `modal ${size}` });
  backdrop.append(modal);
  document.body.append(backdrop);
  mount(modal, render({ close, modal }));

  // focus the first meaningful control
  requestAnimationFrame(() => {
    const first = modal.querySelector('input, textarea, button.btn-primary');
    first?.focus();
  });
  return { close, modal };
}
