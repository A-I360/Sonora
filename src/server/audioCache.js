'use strict';
/**
 * Offline audio cache.
 *
 * When a track is "downloaded" (whole Spotify playlist import, or an explicit
 * save-for-offline), we fetch its playable audio once and store the bytes on
 * local disk. The /api/stream proxy then serves the cached copy instead of
 * hitting the network, which is what makes "listen offline" actually true.
 *
 * Files live in {DATA_DIR}/audio keyed by a hash of the resolved URL so the
 * same source is never fetched twice. Serving supports byte ranges so scrub
 * and seek still work on a cached download.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DATA_DIR } = require('./store');

const AUDIO_DIR = path.join(DATA_DIR, 'audio');

function ensureDir() {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

function cacheKey(url) {
  return crypto.createHash('sha256').update(String(url || '')).digest('hex');
}

function cachePath(url) {
  return path.join(AUDIO_DIR, `${cacheKey(url)}.bin`);
}

function has(url) {
  return Boolean(url) && fs.existsSync(cachePath(url));
}

function write(url, buffer) {
  if (!url || !buffer || !buffer.length) return false;
  try {
    ensureDir();
    const p = cachePath(url);
    // write temp then rename so a crash never leaves a truncated file
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, p);
    return true;
  } catch (err) {
    console.warn('[audioCache] write failed:', err.message);
    return false;
  }
}

function read(url) {
  if (!has(url)) return null;
  try {
    return fs.readFileSync(cachePath(url));
  } catch {
    return null;
  }
}

function size(url) {
  if (!has(url)) return 0;
  try {
    return fs.statSync(cachePath(url)).size;
  } catch {
    return 0;
  }
}

function removeByUrl(url) {
  if (!has(url)) return false;
  try {
    fs.unlinkSync(cachePath(url));
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch an upstream audio URL once and persist it. Returns the byte count on
 * success, or null when the fetch fails. Used by the download endpoint. Honours
 * an existing cache (idempotent).
 */
async function download(url, fetchFn) {
  if (!url) return null;
  if (has(url)) return size(url);
  try {
    const buffer = await fetchFn(url);
    if (!buffer || !buffer.length) return null;
    write(url, buffer);
    return buffer.length;
  } catch {
    return null;
  }
}

/**
 * Serve a cached URL with Range support. Returns true if it wrote a response
 * (200/206/416) and false if the URL isn't cached or something failed.
 */
function serve(req, res, url) {
  if (!has(url)) return false;
  let buf;
  try {
    buf = fs.readFileSync(cachePath(url));
  } catch {
    return false;
  }
  const total = buf.length;
  let start = 0;
  let end = total - 1;
  let status = 200;
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      if (m[1]) start = Number(m[1]);
      if (m[2]) end = Number(m[2]);
      if (start > end) start = 0;
      if (start >= total) {
        res.writeHead(416, {
          'Content-Range': `bytes */${total}`,
          'Content-Type': 'application/octet-stream',
          'Accept-Ranges': 'bytes',
        });
        return res.end();
      }
      if (end >= total) end = total - 1;
      status = 206;
    }
  }
  const chunk = buf.subarray(start, end + 1);
  const headers = {
    'Content-Type': 'audio/mpeg',
    'Accept-Ranges': 'bytes',
    'Content-Length': String(chunk.length),
    'Cache-Control': 'public, max-age=3600',
    'Access-Control-Allow-Origin': '*',
  };
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${total}`;
  res.writeHead(status, headers);
  return res.end(chunk);
}

module.exports = {
  AUDIO_DIR,
  cacheKey,
  cachePath,
  has,
  write,
  read,
  size,
  removeByUrl,
  download,
  serve,
};
