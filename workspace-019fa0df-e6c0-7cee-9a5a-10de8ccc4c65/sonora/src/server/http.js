'use strict';
/** Tiny HTTP helpers + router. No express, no deps. */

const MAX_BODY = 1024 * 512; // 512kb is plenty for JSON payloads

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function send(res, status, body, headers = {}) {
  const payload = body === null || body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new HttpError(400, 'Malformed JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function serializeCookie(name, value, opts = {}) {
  let s = `${name}=${encodeURIComponent(value)}`;
  if (opts.maxAge !== undefined) s += `; Max-Age=${Math.floor(opts.maxAge)}`;
  s += `; Path=${opts.path || '/'}`;
  if (opts.httpOnly !== false) s += '; HttpOnly';
  if (opts.sameSite !== false) s += `; SameSite=${opts.sameSite || 'Lax'}`;
  if (opts.secure) s += '; Secure';
  return s;
}

/** Express-ish router with :param segments and wildcard-free matching. */
class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, ...handlers) {
    const segments = pattern.split('/').filter(Boolean);
    this.routes.push({ method, segments, handlers });
    return this;
  }

  get(p, ...h) { return this.add('GET', p, ...h); }
  post(p, ...h) { return this.add('POST', p, ...h); }
  patch(p, ...h) { return this.add('PATCH', p, ...h); }
  put(p, ...h) { return this.add('PUT', p, ...h); }
  delete(p, ...h) { return this.add('DELETE', p, ...h); }

  match(method, pathname) {
    const parts = pathname.split('/').filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== parts.length) continue;
      const params = {};
      let ok = true;
      for (let i = 0; i < route.segments.length; i += 1) {
        const seg = route.segments[i];
        if (seg.startsWith(':')) {
          params[seg.slice(1)] = decodeURIComponent(parts[i]);
        } else if (seg !== parts[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return { route, params };
    }
    return null;
  }
}

/* ---------------------------------------------------------- validation */

function str(value, field, { min = 0, max = 5000, required = true, trim = true } = {}) {
  let v = value;
  if (v === undefined || v === null) {
    if (required) throw new HttpError(422, `${field} is required`);
    return undefined;
  }
  if (typeof v !== 'string') throw new HttpError(422, `${field} must be a string`);
  if (trim) v = v.trim();
  if (required && !v) throw new HttpError(422, `${field} is required`);
  if (v.length < min) throw new HttpError(422, `${field} must be at least ${min} characters`);
  if (v.length > max) throw new HttpError(422, `${field} must be under ${max} characters`);
  return v;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  return Boolean(value);
}

module.exports = {
  HttpError,
  Router,
  send,
  readBody,
  parseCookies,
  serializeCookie,
  str,
  bool,
};
