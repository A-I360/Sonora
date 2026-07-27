'use strict';
/** Deezer public API — no key, huge catalog incl. strong Afrobeats coverage, 30s MP3 previews. */

const { fetchJson } = require('../fetchx');

const key = 'deezer';
const label = 'Deezer';
const playback = 'preview';

function isEnabled() {
  return process.env.SONORA_DISABLE_DEEZER !== '1';
}

function note() {
  return '30-second previews, strong Afrobeats/global coverage, no key required';
}

function normalize(t) {
  if (!t || !t.title) return null;
  return {
    id: `deezer:${t.id}`,
    provider: key,
    providerId: String(t.id),
    title: t.title_short || t.title,
    artist: t.artist?.name || 'Unknown',
    album: t.album?.title || '',
    artwork: t.album?.cover_xl || t.album?.cover_big || t.album?.cover_medium || null,
    artworkSmall: t.album?.cover_small || t.album?.cover_medium || null,
    previewUrl: t.preview || null,
    streamUrl: null,
    durationMs: (t.duration || 0) * 1000,
    genre: '',
    year: null,
    externalUrl: t.link || null,
    explicit: Boolean(t.explicit_lyrics),
  };
}

async function search(query, limit = 24) {
  const url =
    'https://api.deezer.com/search?' +
    new URLSearchParams({ q: query, limit: String(Math.min(limit, 50)) });
  const data = await fetchJson(url, { timeout: 9000, cacheKey: `deezer:${query}:${limit}` });
  return (data.data || []).map(normalize).filter(Boolean);
}

async function lookup(providerId) {
  const data = await fetchJson(`https://api.deezer.com/track/${encodeURIComponent(providerId)}`, {
    timeout: 9000,
    cacheKey: `deezer:lookup:${providerId}`,
  });
  return normalize(data);
}

module.exports = { key, label, playback, isEnabled, note, search, lookup, normalize };
