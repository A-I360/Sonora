'use strict';
/**
 * Audius — decentralised music network. No key, and crucially it streams
 * FULL-LENGTH tracks (not 30s clips), so the player has real audio to chew on.
 */

const { fetchJson } = require('../fetchx');

const key = 'audius';
const label = 'Audius';
const playback = 'full'; // complete tracks

const APP_NAME = 'SonoraApp';
let hostCache = { host: null, at: 0 };
const HOST_TTL = 10 * 60 * 1000;

function isEnabled() {
  return process.env.SONORA_DISABLE_AUDIUS !== '1';
}

function note() {
  return 'Full-length streaming, independent artists, no key required';
}

async function host() {
  if (hostCache.host && Date.now() - hostCache.at < HOST_TTL) return hostCache.host;
  const data = await fetchJson('https://api.audius.co', { timeout: 8000 });
  const hosts = data.data || [];
  if (!hosts.length) throw new Error('no audius hosts');
  const picked = hosts[Math.floor(Math.random() * hosts.length)];
  hostCache = { host: picked, at: Date.now() };
  return picked;
}

function normalize(t, base) {
  if (!t || t.is_delete) return null;
  const art = t.artwork || {};
  return {
    id: `audius:${t.id}`,
    provider: key,
    providerId: t.id,
    title: t.title,
    artist: t.user?.name || t.user?.handle || 'Unknown',
    album: '',
    artwork: art['1000x1000'] || art['480x480'] || art['150x150'] || null,
    artworkSmall: art['150x150'] || art['480x480'] || null,
    previewUrl: null,
    streamUrl: `${base}/v1/tracks/${t.id}/stream?app_name=${APP_NAME}`,
    durationMs: (t.duration || 0) * 1000,
    genre: t.genre || '',
    year: t.release_date ? Number(String(t.release_date).slice(0, 4)) : null,
    externalUrl: t.permalink ? `https://audius.co${t.permalink}` : null,
    explicit: false,
  };
}

async function search(query, limit = 24) {
  const base = await host();
  const url =
    `${base}/v1/tracks/search?` +
    new URLSearchParams({ query, app_name: APP_NAME, limit: String(Math.min(limit, 50)) });
  const data = await fetchJson(url, { timeout: 9000, cacheKey: `audius:${query}:${limit}` });
  return (data.data || []).map((t) => normalize(t, base)).filter(Boolean);
}

async function trending(genre, limit = 20) {
  const base = await host();
  const params = new URLSearchParams({ app_name: APP_NAME, limit: String(limit) });
  if (genre) params.set('genre', genre);
  const data = await fetchJson(`${base}/v1/tracks/trending?${params}`, {
    timeout: 9000,
    cacheKey: `audius:trending:${genre}:${limit}`,
  });
  return (data.data || []).map((t) => normalize(t, base)).filter(Boolean);
}

async function lookup(providerId) {
  const base = await host();
  const data = await fetchJson(`${base}/v1/tracks/${providerId}?app_name=${APP_NAME}`, {
    timeout: 9000,
    cacheKey: `audius:lookup:${providerId}`,
  });
  return normalize(data.data, base);
}

module.exports = { key, label, playback, isEnabled, note, search, trending, lookup };
