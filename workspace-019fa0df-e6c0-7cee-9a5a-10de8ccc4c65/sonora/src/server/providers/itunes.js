'use strict';
/** Apple Music / iTunes Search API — no key, ~100M tracks, 30s AAC previews. */

const { fetchJson } = require('../fetchx');

const key = 'itunes';
const label = 'Apple Music';
const playback = 'preview'; // 30-second previews

function isEnabled() {
  return process.env.SONORA_DISABLE_ITUNES !== '1';
}

function note() {
  return '30-second previews, full catalog, no key required';
}

function artworkAt(url, size = 600) {
  if (!url) return null;
  return url.replace(/\/\d+x\d+bb\.jpg$/, `/${size}x${size}bb.jpg`);
}

function normalize(r) {
  if (!r || r.kind !== 'song') return null;
  return {
    id: `itunes:${r.trackId}`,
    provider: key,
    providerId: String(r.trackId),
    title: r.trackName,
    artist: r.artistName,
    album: r.collectionName || '',
    artwork: artworkAt(r.artworkUrl100, 600),
    artworkSmall: artworkAt(r.artworkUrl100, 200),
    previewUrl: r.previewUrl || null,
    streamUrl: null,
    durationMs: r.trackTimeMillis || 0,
    genre: r.primaryGenreName || '',
    year: r.releaseDate ? Number(String(r.releaseDate).slice(0, 4)) : null,
    externalUrl: r.trackViewUrl || null,
    explicit: r.trackExplicitness === 'explicit',
  };
}

async function search(query, limit = 24) {
  const url =
    'https://itunes.apple.com/search?' +
    new URLSearchParams({
      term: query,
      media: 'music',
      entity: 'song',
      limit: String(Math.min(limit, 50)),
    });
  const data = await fetchJson(url, { timeout: 9000, cacheKey: `itunes:${query}:${limit}` });
  return (data.results || []).map(normalize).filter(Boolean);
}

async function lookup(providerId) {
  const url = `https://itunes.apple.com/lookup?id=${encodeURIComponent(providerId)}&entity=song`;
  const data = await fetchJson(url, { timeout: 9000, cacheKey: `itunes:lookup:${providerId}` });
  return (data.results || []).map(normalize).filter(Boolean)[0] || null;
}

module.exports = { key, label, playback, isEnabled, note, search, lookup, normalize };
