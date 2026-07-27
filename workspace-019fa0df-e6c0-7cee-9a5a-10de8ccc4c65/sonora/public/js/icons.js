/* Inline SVG icon set (stroke-based, currentColor). */

const S = (paths, opts = {}) =>
  `<svg viewBox="0 0 24 24" fill="${opts.fill || 'none'}" stroke="${opts.stroke || 'currentColor'}" stroke-width="${
    opts.w || 2
  }" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

export const icons = {
  logo: S('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>', {
    stroke: '#fff',
    w: 2.2,
  }),
  home: S('<path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1h-5v-7H9v7H4a1 1 0 01-1-1z"/>'),
  search: S('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
  sparkle: S(
    '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 3v3M20.5 4.5h-3M5 17v2M6 18H4"/>'
  ),
  library: S('<path d="M4 4h4v16H4zM11 4h3v16h-3z"/><path d="M18.5 4.5l2.5 15"/>'),
  heart: S('<path d="M20.8 5.6a5.5 5.5 0 00-7.8 0L12 6.6l-1-1a5.5 5.5 0 00-7.8 7.8l1 1L12 22l7.8-7.6 1-1a5.5 5.5 0 000-7.8z"/>'),
  heartFilled: S(
    '<path d="M20.8 5.6a5.5 5.5 0 00-7.8 0L12 6.6l-1-1a5.5 5.5 0 00-7.8 7.8l1 1L12 22l7.8-7.6 1-1a5.5 5.5 0 000-7.8z"/>',
    { fill: 'currentColor' }
  ),
  users: S('<path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>'),
  chart: S('<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>'),
  user: S('<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0114 0v1"/>'),
  plus: S('<path d="M12 5v14M5 12h14"/>'),
  play: S('<path d="M6 4l14 8-14 8z"/>', { fill: 'currentColor', stroke: 'none' }),
  pause: S('<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>', {
    fill: 'currentColor',
    stroke: 'none',
  }),
  prev: S('<path d="M19 20L9 12l10-8z"/><rect x="4" y="4" width="2.5" height="16" rx="1"/>', {
    fill: 'currentColor',
    stroke: 'none',
  }),
  next: S('<path d="M5 4l10 8-10 8z"/><rect x="17.5" y="4" width="2.5" height="16" rx="1"/>', {
    fill: 'currentColor',
    stroke: 'none',
  }),
  shuffle: S('<path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/>'),
  repeat: S('<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/>'),
  repeatOne: S(
    '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/><path d="M11 11.5l1-.5v4"/>'
  ),
  volume: S('<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 010 7M19 5a9 9 0 010 14"/>'),
  volumeMute: S('<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/>'),
  more: S('<circle cx="12" cy="5" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="19" r="1.6" fill="currentColor"/>'),
  trash: S('<path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/>'),
  edit: S('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>'),
  share: S('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>'),
  comment: S('<path d="M21 11.5a8.4 8.4 0 01-9 8.5 9 9 0 01-4-.9L3 21l1.9-5a8.4 8.4 0 01-.9-4 8.5 8.5 0 018.5-8.5h.5A8.5 8.5 0 0121 11z"/>'),
  music: S('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
  listMusic: S('<path d="M3 6h11M3 12h7M3 18h7"/><circle cx="17" cy="17" r="3"/><path d="M20 17V8l3 1"/>'),
  logout: S('<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>'),
  settings: S('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z"/>'),
  menu: S('<path d="M3 6h18M3 12h18M3 18h18"/>'),
  x: S('<path d="M18 6L6 18M6 6l12 12"/>'),
  check: S('<path d="M20 6L9 17l-5-5"/>'),
  clock: S('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  disc: S('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/>'),
  external: S('<path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/>'),
  drag: S('<circle cx="9" cy="6" r="1.4" fill="currentColor"/><circle cx="9" cy="12" r="1.4" fill="currentColor"/><circle cx="9" cy="18" r="1.4" fill="currentColor"/><circle cx="15" cy="6" r="1.4" fill="currentColor"/><circle cx="15" cy="12" r="1.4" fill="currentColor"/><circle cx="15" cy="18" r="1.4" fill="currentColor"/>'),
  queue: S('<path d="M3 6h13M3 12h13M3 18h9"/><path d="M18 12v7M21.5 15.5h-7"/>'),
  compass: S('<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>'),
  mail: S('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 7l10 6 10-6"/>'),
  lock: S('<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/>'),
  wave: S('<path d="M2 12h2M6 8v8M10 5v14M14 9v6M18 6v12M22 12h0"/>'),
  plusCircle: S('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>'),
  trending: S('<path d="M22 7l-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>'),
};

export function icon(name, cls = '') {
  const span = document.createElement('span');
  span.innerHTML = icons[name] || icons.music;
  const svg = span.firstElementChild;
  if (cls) svg.setAttribute('class', cls);
  return svg;
}
