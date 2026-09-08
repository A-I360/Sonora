'use strict';
/**
 * Auth: scrypt password hashing, opaque session tokens, HttpOnly cookies.
 * No JWTs — server-side sessions are revocable, which matters for "log out
 * everywhere" and for deleting an account.
 */

const crypto = require('node:crypto');
const { db, id } = require('./store');
const { HttpError, parseCookies, serializeCookie } = require('./http');

const SESSION_COOKIE = 'sonora_session';
const SESSION_TTL_DAYS = 30;
const SCRYPT_N = 16384;
const SCRYPT_KEYLEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N }).toString('hex');
  return `scrypt$${SCRYPT_N}$${salt}$${derived}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, nRaw, salt, expected] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const N = Number(nRaw) || SCRYPT_N;
    const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, { N }).toString('hex');
    const a = Buffer.from(derived, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function newSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createSession(userId, userAgent = '') {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 864e5).toISOString();
  db.sessions.insert(
    {
      id: hashToken(token), // store only the hash; the raw token lives in the cookie
      userId,
      userAgent: String(userAgent).slice(0, 200),
      expiresAt,
    },
    'sess'
  );
  return { token, expiresAt };
}

function destroySession(token) {
  if (!token) return;
  db.sessions.remove(hashToken(token));
}

function destroyAllSessions(userId) {
  return db.sessions.removeWhere((s) => s.userId === userId);
}

/**
 * Browsers reject `Secure` cookies over plain http://, which would silently
 * break local development. So we only set it when actually served over TLS —
 * set SONORA_SECURE_COOKIES=1 (or NODE_ENV=production behind a TLS proxy).
 */
function useSecureCookies() {
  if (process.env.SONORA_SECURE_COOKIES === '1') return true;
  if (process.env.SONORA_SECURE_COOKIES === '0') return false;
  return process.env.NODE_ENV === 'production';
}

function sessionCookie(token) {
  return serializeCookie(SESSION_COOKIE, token, {
    maxAge: SESSION_TTL_DAYS * 86400,
    httpOnly: true,
    sameSite: 'Lax',
    secure: useSecureCookies(),
  });
}

function clearCookie() {
  return serializeCookie(SESSION_COOKIE, '', {
    maxAge: 0,
    httpOnly: true,
    secure: useSecureCookies(),
  });
}

/** Resolve the current user from the request cookie. Returns null when absent. */
function currentUser(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const session = db.sessions.get(hashToken(token));
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    db.sessions.remove(session.id);
    return null;
  }
  const user = db.users.get(session.userId);
  if (!user) return null;
  return user;
}

function requireUser(req) {
  const user = currentUser(req);
  if (!user) throw new HttpError(401, 'You need to sign in to do that');
  return user;
}

/** Strip secrets before anything leaves the server. */
function publicUser(user, extra = {}) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    handle: user.handle,
    avatarColor: user.avatarColor,
    bio: user.bio || '',
    createdAt: user.createdAt,
    ...extra,
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validateEmail(email) {
  const v = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(v)) throw new HttpError(422, 'Enter a valid email address');
  return v;
}

function validatePassword(password) {
  const v = String(password || '');
  if (v.length < 8) throw new HttpError(422, 'Password must be at least 8 characters');
  if (v.length > 200) throw new HttpError(422, 'Password is too long');
  return v;
}

const AVATAR_COLORS = [
  'linear-gradient(135deg,#8b5cf6,#ec4899)',
  'linear-gradient(135deg,#06b6d4,#3b82f6)',
  'linear-gradient(135deg,#f59e0b,#ef4444)',
  'linear-gradient(135deg,#10b981,#06b6d4)',
  'linear-gradient(135deg,#ec4899,#f43f5e)',
  'linear-gradient(135deg,#6366f1,#8b5cf6)',
];

function handleFrom(displayName, email) {
  const base = (displayName || email.split('@')[0] || 'listener')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 18) || 'listener';
  let candidate = base;
  let i = 1;
  while (db.users.findOne((u) => u.handle === candidate)) {
    candidate = `${base}${i}`;
    i += 1;
  }
  return candidate;
}

function createUser({ email, password, displayName }) {
  const cleanEmail = validateEmail(email);
  const cleanPassword = validatePassword(password);
  const name = String(displayName || '').trim() || cleanEmail.split('@')[0];
  if (db.users.findOne((u) => u.email === cleanEmail)) {
    throw new HttpError(409, 'An account with that email already exists');
  }
  return db.users.insert(
    {
      id: id('usr'),
      email: cleanEmail,
      displayName: name.slice(0, 60),
      handle: handleFrom(name, cleanEmail),
      passwordHash: hashPassword(cleanPassword),
      avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
      bio: '',
      tasteProfile: null,
    },
    'usr'
  );
}

module.exports = {
  SESSION_COOKIE,
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  destroyAllSessions,
  sessionCookie,
  clearCookie,
  currentUser,
  requireUser,
  publicUser,
  createUser,
  validateEmail,
  validatePassword,
  AVATAR_COLORS,
};
