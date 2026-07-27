'use strict';
/**
 * Spotify adapter (Client Credentials search + metadata).
 *
 * Dormant until you set SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET in .env.
 * The moment those exist, this provider joins every search fan-out with no
 * other code change — that's the point of the provider registry.
 *
 * Heads-up on reality, not marketing:
 *  - Spotify deprecated `preview_url` for new apps (Nov 2024), so results here
 *    are metadata-rich but usually silent. Sonora auto-resolves a playable
 *    preview from the key-free providers via `resolvePlayable()` in the API
 *    layer, so a Spotify row still makes sound.
 *  - True in-app full playback additionally needs the Web Playback SDK, user
 *    OAuth and a Premium account. Scaffolded in authorizeUrl/exchangeCode.
 *
 * The same pattern is how you'd bolt on Boomplay: implement search()+lookup()
 * that return the normalized shape, register it in providers/index.js.
 */

const { fetchJson, fetchRaw } = require('../fetchx');

const key = 'spotify';
const label = 'Spotify';
const playback = 'metadata';

let tokenCache = { token: null, expiresAt: 0 };

function clientId() {
  return process.env.SPOTIFY_CLIENT_ID || '';
}
function clientSecret() {
  return process.env.SPOTIFY_CLIENT_SECRET || '';
}
function redirectUri() {
  return process.env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:3000/api/providers/spotify/callback';
}

function isEnabled() {
  return Boolean(clientId() && clientSecret());
}

function note() {
  return isEnabled()
    ? 'Connected — metadata search active; audio auto-resolved from preview providers'
    : 'Add SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET to .env to activate';
}

async function appToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 30000) return tokenCache.token;
  if (!isEnabled()) throw new Error('Spotify credentials not configured');
  const basic = Buffer.from(`${clientId()}:${clientSecret()}`).toString('base64');
  const res = await fetchRaw('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    timeout: 9000,
  });
  const data = JSON.parse(res.body);
  if (!data.access_token) throw new Error(data.error_description || 'Spotify token failed');
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
  return tokenCache.token;
}

function normalize(t) {
  if (!t || !t.id) return null;
  const images = t.album?.images || [];
  return {
    id: `spotify:${t.id}`,
    provider: key,
    providerId: t.id,
    title: t.name,
    artist: (t.artists || []).map((a) => a.name).join(', ') || 'Unknown',
    album: t.album?.name || '',
    artwork: images[0]?.url || null,
    artworkSmall: images[images.length - 1]?.url || images[0]?.url || null,
    previewUrl: t.preview_url || null,
    streamUrl: null,
    durationMs: t.duration_ms || 0,
    genre: '',
    year: t.album?.release_date ? Number(String(t.album.release_date).slice(0, 4)) : null,
    externalUrl: t.external_urls?.spotify || null,
    explicit: Boolean(t.explicit),
    spotifyUri: t.uri || null,
  };
}

async function search(query, limit = 24) {
  const token = await appToken();
  const url =
    'https://api.spotify.com/v1/search?' +
    new URLSearchParams({ q: query, type: 'track', limit: String(Math.min(limit, 50)) });
  const data = await fetchJson(url, {
    timeout: 9000,
    headers: { Authorization: `Bearer ${token}` },
    cacheKey: `spotify:${query}:${limit}`,
  });
  return (data.tracks?.items || []).map(normalize).filter(Boolean);
}

async function lookup(providerId) {
  const token = await appToken();
  const data = await fetchJson(`https://api.spotify.com/v1/tracks/${encodeURIComponent(providerId)}`, {
    timeout: 9000,
    headers: { Authorization: `Bearer ${token}` },
    cacheKey: `spotify:lookup:${providerId}`,
  });
  return normalize(data);
}

/** OAuth scaffold for Premium/Web-Playback-SDK upgrades. */
function authorizeUrl(state) {
  const scopes = [
    'streaming',
    'user-read-email',
    'user-read-private',
    'playlist-read-private',
    'user-modify-playback-state',
  ].join(' ');
  return (
    'https://accounts.spotify.com/authorize?' +
    new URLSearchParams({
      response_type: 'code',
      client_id: clientId(),
      scope: scopes,
      redirect_uri: redirectUri(),
      state,
    })
  );
}

async function exchangeCode(code) {
  const basic = Buffer.from(`${clientId()}:${clientSecret()}`).toString('base64');
  const res = await fetchRaw('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
    }).toString(),
    timeout: 9000,
  });
  return JSON.parse(res.body);
}

module.exports = {
  key,
  label,
  playback,
  isEnabled,
  note,
  search,
  lookup,
  normalize,
  authorizeUrl,
  exchangeCode,
};
