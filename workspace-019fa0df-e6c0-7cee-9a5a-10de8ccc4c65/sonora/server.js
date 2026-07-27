'use strict';
/**
 * Sonora — AI-powered music discovery, player and sharing app.
 * Zero npm dependencies. Node 18+.
 *
 *   node server.js            # http://127.0.0.1:3000
 *   PORT=8080 node server.js
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

// load .env before anything reads process.env
loadEnv();

const store = require('./src/server/store');
const { router } = require('./src/server/api');
const { send, HttpError } = require('./src/server/http');

const PORT = Number(process.env.PORT) || 3000;
/**
 * Bind to loopback locally (safer default: nothing else on the network can
 * reach your dev box), but to 0.0.0.0 in a container/PaaS where the platform
 * routes external traffic to the process. Override with HOST at any time.
 */
const HOST =
  process.env.HOST ||
  (process.env.NODE_ENV === 'production' || process.env.SONORA_BIND_ALL === '1'
    ? '0.0.0.0'
    : '127.0.0.1');
const PUBLIC_DIR = path.join(__dirname, 'public');

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && !process.env[key]) process.env[key] = value;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  // block traversal
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(PUBLIC_DIR, safe);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return true;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // SPA fallback: unknown non-asset routes render the shell
    if (path.extname(safe)) return false;
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }
  const ext = path.extname(filePath).toLowerCase();
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=300',
    'Content-Length': body.length,
  });
  res.end(body);
  return true;
}

/**
 * Apple serves previews as `audio/x-m4p` — a DRM-era MIME type that Chromium
 * and Safari both refuse (`canPlayType('audio/x-m4p') === ''`, MediaError 4),
 * even though the payload is ordinary AAC in an MP4 container. Left alone this
 * silently kills playback for the entire iTunes catalog, so we relabel the
 * handful of known-bad types to what the bytes actually are.
 */
const MIME_FIX = {
  'audio/x-m4p': 'audio/mp4',
  'audio/x-m4a': 'audio/mp4',
  'audio/m4a': 'audio/mp4',
  'audio/aac': 'audio/mp4',
  'application/octet-stream': null, // fall through to extension sniffing
};

function normalizeAudioMime(contentType, pathname = '') {
  const raw = (contentType || '').split(';')[0].trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(MIME_FIX, raw)) {
    const fixed = MIME_FIX[raw];
    if (fixed) return fixed;
  } else if (raw.startsWith('audio/') || raw.startsWith('video/')) {
    return raw;
  }
  // unknown or octet-stream: guess from the file extension
  const ext = pathname.toLowerCase().match(/\.(m4a|mp4|mp3|ogg|opus|wav|flac|aac)(?:$|\?)/)?.[1];
  switch (ext) {
    case 'm4a':
    case 'mp4':
    case 'aac':
      return 'audio/mp4';
    case 'ogg':
    case 'opus':
      return 'audio/ogg';
    case 'wav':
      return 'audio/wav';
    case 'flac':
      return 'audio/flac';
    default:
      return 'audio/mpeg';
  }
}

/**
 * Audio proxy.
 * Audius stream endpoints redirect across CDN hosts and some preview hosts
 * omit CORS headers; proxying keeps <audio> happy and supports Range requests
 * so seeking works.
 */
async function proxyAudio(req, res, target) {
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return send(res, 400, { error: 'Invalid url' });
  }
  const allowed = [
    'audio-ssl.itunes.apple.com',
    'cdnt-preview.dzcdn.net',
    'cdns-preview-',
    'audius',
    'creatornode',
    'dzcdn.net',
    'mzstatic.com',
    'p.scdn.co',
  ];
  const host = parsed.hostname;
  if (!allowed.some((a) => host.includes(a))) {
    return send(res, 403, { error: 'Host not allowed' });
  }
  try {
    const headers = { 'User-Agent': 'Sonora/1.0' };
    if (req.headers.range) headers.Range = req.headers.range;
    const upstream = await fetch(parsed.toString(), { headers, redirect: 'follow' });
    const out = {
      'Content-Type': normalizeAudioMime(upstream.headers.get('content-type'), parsed.pathname),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    };
    const len = upstream.headers.get('content-length');
    if (len) out['Content-Length'] = len;
    const range = upstream.headers.get('content-range');
    if (range) out['Content-Range'] = range;
    res.writeHead(upstream.status, out);
    if (!upstream.body) return res.end();
    const reader = upstream.body.getReader();
    // stream chunks through, respecting backpressure
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(Buffer.from(value))) {
        await new Promise((resolve) => res.once('drain', resolve));
      }
    }
    res.end();
  } catch (err) {
    if (!res.headersSent) send(res, 502, { error: 'Audio proxy failed', detail: err.message });
    else res.end();
  }
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  let pathname = '/';
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    pathname = url.pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': req.headers.origin || '*',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Credentials': 'true',
      });
      return res.end();
    }

    if (pathname === '/api/stream') {
      return await proxyAudio(req, res, url.searchParams.get('url') || '');
    }

    if (pathname === '/api/health') {
      return send(res, 200, { ok: true, uptime: process.uptime(), node: process.version });
    }

    if (pathname.startsWith('/api/')) {
      const matched = router.match(req.method, pathname);
      if (!matched) return send(res, 404, { error: `No route for ${req.method} ${pathname}` });
      const ctx = { params: matched.params, query: url.searchParams, url };
      for (const handler of matched.route.handlers) {
        // eslint-disable-next-line no-await-in-loop
        await handler(req, res, ctx);
        if (res.writableEnded) break;
      }
      if (!res.writableEnded) send(res, 204, null);
      if (process.env.SONORA_LOG !== '0') {
        console.log(`${req.method} ${pathname} ${res.statusCode} ${Date.now() - started}ms`);
      }
      return undefined;
    }

    if (serveStatic(req, res, pathname)) return undefined;
    return send(res, 404, { error: 'Not found' });
  } catch (err) {
    if (res.writableEnded) return undefined;
    if (err instanceof HttpError) {
      return send(res, err.status, { error: err.message, details: err.details });
    }
    console.error(`[error] ${req.method} ${pathname}:`, err);
    return send(res, 500, { error: 'Something went wrong on our end' });
  }
});

store.load();

/** Best-effort LAN address so you can open the app from your phone. */
function lanAddress() {
  try {
    const nets = require('node:os').networkInterfaces();
    for (const iface of Object.values(nets)) {
      for (const net of iface || []) {
        if (net.family === 'IPv4' && !net.internal) return net.address;
      }
    }
  } catch {
    /* not important */
  }
  return null;
}

server.listen(PORT, HOST, () => {
  const providers = require('./src/server/providers');
  const llm = require('./src/server/ai/llm');
  const active = providers.statuses().filter((p) => p.enabled).map((p) => p.label);
  const lan = HOST === '0.0.0.0' ? lanAddress() : null;

  console.log('');
  console.log('  ♪  Sonora is live');
  console.log(`     local:   http://localhost:${PORT}`);
  if (lan) console.log(`     network: http://${lan}:${PORT}   (open this on your phone)`);
  console.log(`     catalog: ${active.join(', ') || 'none — check your connection'}`);
  console.log(`     ai:      ${llm.status().note}`);
  console.log('');
  console.log('     Press Ctrl+C to stop.');
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ✗ Port ${PORT} is already in use.`);
    console.error(`    Either stop the other process, or run Sonora on a different port:\n`);
    console.error(`      PORT=3001 node server.js\n`);
    process.exit(1);
  }
  if (err.code === 'EACCES') {
    console.error(`\n  ✗ Not allowed to bind port ${PORT}. Ports below 1024 need admin rights.`);
    console.error(`    Try:  PORT=3000 node server.js\n`);
    process.exit(1);
  }
  console.error('\n  ✗ Server failed to start:', err.message, '\n');
  process.exit(1);
});
