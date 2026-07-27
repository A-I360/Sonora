'use strict';
/**
 * fetch with timeout, retry, and a small TTL cache.
 * Node 20 has global fetch, so no undici dependency required.
 */

const CACHE_TTL = 5 * 60 * 1000;
const CACHE_MAX = 400;
const cache = new Map();

function cacheGet(key) {
  if (!key) return undefined;
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expires) {
    cache.delete(key);
    return undefined;
  }
  // refresh LRU position
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
}

function cacheSet(key, value) {
  if (!key) return;
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  cache.set(key, { value, expires: Date.now() + CACHE_TTL });
}

async function fetchRaw(url, { method = 'GET', headers = {}, body, timeout = 9000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method,
      headers: { 'User-Agent': 'Sonora/1.0 (music discovery app)', ...headers },
      body,
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} from ${new URL(url).host}`);
      err.status = res.status;
      err.body = text.slice(0, 300);
      throw err;
    }
    return { body: text, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, opts = {}) {
  const { cacheKey, retries = 1 } = opts;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const { body } = await fetchRaw(url, opts);
      // iTunes serves JSON as text/javascript with leading whitespace
      const parsed = JSON.parse(body.trim() || '{}');
      cacheSet(cacheKey, parsed);
      return parsed;
    } catch (err) {
      lastErr = err;
      // don't retry client errors
      if (err.status && err.status >= 400 && err.status < 500) break;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
  throw lastErr;
}

module.exports = { fetchJson, fetchRaw };
