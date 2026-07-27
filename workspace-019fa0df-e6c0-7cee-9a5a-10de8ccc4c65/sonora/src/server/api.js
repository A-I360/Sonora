'use strict';
/**
 * Sonora REST API.
 *
 * Core resources with full CRUD:
 *   /api/playlists          playlists + nested track membership (reorder included)
 *   /api/shares             social posts about a track or playlist
 *   /api/comments           threaded replies on shares
 *   /api/library            saved tracks (likes)
 *   /api/me                 profile read/update/delete
 *
 * Plus: /api/auth/*, /api/search, /api/ai/*, /api/feed, /api/stats, /api/plays.
 */

const { Router, send, readBody, HttpError, str, bool } = require('./http');
const { db, id } = require('./store');
const auth = require('./auth');
const providers = require('./providers');
const engine = require('./ai/engine');
const featuresLib = require('./ai/features');
const llm = require('./ai/llm');

const router = new Router();

/* ------------------------------------------------------------ utilities */

/** Cache a catalog track locally so playlists survive provider downtime. */
function cacheTrack(track) {
  if (!track || !track.id) throw new HttpError(422, 'Track payload is invalid');
  const existing = db.tracks.get(track.id);
  const record = {
    id: track.id,
    provider: track.provider || 'unknown',
    providerId: track.providerId || '',
    title: String(track.title || 'Untitled').slice(0, 300),
    artist: String(track.artist || 'Unknown artist').slice(0, 300),
    album: String(track.album || '').slice(0, 300),
    artwork: track.artwork || null,
    artworkSmall: track.artworkSmall || track.artwork || null,
    previewUrl: track.previewUrl || null,
    streamUrl: track.streamUrl || null,
    durationMs: Number(track.durationMs) || 0,
    genre: String(track.genre || '').slice(0, 120),
    year: track.year || null,
    externalUrl: track.externalUrl || null,
    explicit: Boolean(track.explicit),
    features: track.features || featuresLib.estimate(track),
  };
  if (existing) return db.tracks.update(track.id, record);
  return db.tracks.put(track.id, {
    ...record,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

function trackOr404(trackId) {
  const t = db.tracks.get(trackId);
  if (!t) throw new HttpError(404, 'Track not found');
  return t;
}

function playlistTrackRows(playlistId) {
  return db.playlistTracks
    .find((r) => r.playlistId === playlistId)
    .sort((a, b) => a.position - b.position);
}

function hydratePlaylist(playlist, viewerId, { withTracks = false } = {}) {
  const rows = playlistTrackRows(playlist.id);
  const owner = db.users.get(playlist.userId);
  const base = {
    ...playlist,
    trackCount: rows.length,
    durationMs: rows.reduce((sum, r) => sum + (db.tracks.get(r.trackId)?.durationMs || 0), 0),
    owner: owner
      ? { id: owner.id, displayName: owner.displayName, handle: owner.handle, avatarColor: owner.avatarColor }
      : null,
    isOwner: viewerId === playlist.userId,
    likeCount: db.likes.count((l) => l.targetType === 'playlist' && l.targetId === playlist.id),
    likedByMe: viewerId
      ? Boolean(db.likes.findOne((l) => l.userId === viewerId && l.targetType === 'playlist' && l.targetId === playlist.id))
      : false,
    // first 4 covers for the mosaic thumbnail
    covers: rows
      .slice(0, 4)
      .map((r) => db.tracks.get(r.trackId)?.artworkSmall || db.tracks.get(r.trackId)?.artwork)
      .filter(Boolean),
  };
  if (withTracks) {
    base.tracks = rows
      .map((r) => {
        const t = db.tracks.get(r.trackId);
        if (!t) return null;
        return { ...t, rowId: r.id, position: r.position, addedAt: r.createdAt, note: r.note || '' };
      })
      .filter(Boolean);
  }
  return base;
}

function ownedPlaylist(playlistId, userId) {
  const p = db.playlists.get(playlistId);
  if (!p) throw new HttpError(404, 'Playlist not found');
  if (p.userId !== userId) throw new HttpError(403, 'That playlist belongs to someone else');
  return p;
}

function visiblePlaylist(playlistId, viewerId) {
  const p = db.playlists.get(playlistId);
  if (!p) throw new HttpError(404, 'Playlist not found');
  if (!p.isPublic && p.userId !== viewerId) throw new HttpError(403, 'This playlist is private');
  return p;
}

function hydrateShare(share, viewerId) {
  const user = db.users.get(share.userId);
  const out = {
    ...share,
    author: user
      ? { id: user.id, displayName: user.displayName, handle: user.handle, avatarColor: user.avatarColor }
      : { id: share.userId, displayName: 'Deleted user', handle: 'deleted', avatarColor: '#555' },
    likeCount: db.likes.count((l) => l.targetType === 'share' && l.targetId === share.id),
    likedByMe: viewerId
      ? Boolean(db.likes.findOne((l) => l.userId === viewerId && l.targetType === 'share' && l.targetId === share.id))
      : false,
    commentCount: db.comments.count((c) => c.shareId === share.id),
    isOwner: viewerId === share.userId,
    track: share.trackId ? db.tracks.get(share.trackId) : null,
  };
  if (share.playlistId) {
    const pl = db.playlists.get(share.playlistId);
    out.playlist = pl ? hydratePlaylist(pl, viewerId) : null;
  }
  return out;
}

function hydrateComment(comment, viewerId) {
  const user = db.users.get(comment.userId);
  return {
    ...comment,
    author: user
      ? { id: user.id, displayName: user.displayName, handle: user.handle, avatarColor: user.avatarColor }
      : { id: comment.userId, displayName: 'Deleted user', handle: 'deleted', avatarColor: '#555' },
    isOwner: viewerId === comment.userId,
    likeCount: db.likes.count((l) => l.targetType === 'comment' && l.targetId === comment.id),
    likedByMe: viewerId
      ? Boolean(db.likes.findOne((l) => l.userId === viewerId && l.targetType === 'comment' && l.targetId === comment.id))
      : false,
  };
}

const MP3_ISH = /\.mp3(\?|$)|dzcdn|audius|creatornode/i;

/**
 * Find an alternate playable source for a track.
 *
 * Two real cases this solves:
 *  1. Metadata-only providers (Spotify) return no audio at all.
 *  2. Codec gaps — Apple previews are AAC-in-MP4, and Chromium builds without
 *     proprietary codecs (common on Linux) refuse them. The client detects
 *     this and asks for an MP3-ish source instead.
 */
async function resolvePlayable(track, { preferFormat = null, excludeProviders = [] } = {}) {
  const alreadyFine =
    (track.streamUrl || track.previewUrl) &&
    !excludeProviders.includes(track.provider) &&
    (preferFormat !== 'mp3' || MP3_ISH.test(track.streamUrl || track.previewUrl));
  if (alreadyFine) return track;

  try {
    const { tracks } = await providers.search(`${track.artist} ${track.title}`, { limit: 12 });
    const candidates = tracks.filter((t) => {
      const url = t.streamUrl || t.previewUrl;
      if (!url) return false;
      if (excludeProviders.includes(t.provider)) return false;
      if (preferFormat === 'mp3' && !MP3_ISH.test(url)) return false;
      return true;
    });

    // prefer a title match over a merely-same-artist result
    const wantedTitle = (track.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const scored = candidates
      .map((t) => {
        const title = (t.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        let score = 0;
        if (title === wantedTitle) score += 3;
        else if (title.includes(wantedTitle) || wantedTitle.includes(title)) score += 2;
        if ((t.artist || '').toLowerCase() === (track.artist || '').toLowerCase()) score += 2;
        if (t.streamUrl) score += 1;
        return { t, score };
      })
      .sort((a, b) => b.score - a.score);

    const match = scored[0]?.score >= 2 ? scored[0].t : null;
    if (match) {
      return {
        ...track,
        previewUrl: match.previewUrl,
        streamUrl: match.streamUrl,
        durationMs: track.durationMs || match.durationMs,
        resolvedFrom: match.provider,
      };
    }
  } catch {
    /* best effort only */
  }
  return track;
}

/** Client-driven fallback when the browser cannot decode the current source. */
router.post('/api/tracks/resolve', async (req, res) => {
  auth.requireUser(req);
  const body = await readBody(req);
  const track = body.track;
  if (!track || !track.title) throw new HttpError(422, 'A track is required');
  const resolved = await resolvePlayable(track, {
    preferFormat: body.preferFormat === 'mp3' ? 'mp3' : null,
    excludeProviders: Array.isArray(body.excludeProviders) ? body.excludeProviders : [],
  });
  const changed = (resolved.streamUrl || resolved.previewUrl) !== (track.streamUrl || track.previewUrl);
  send(res, 200, { track: resolved, changed, resolvedFrom: resolved.resolvedFrom || null });
});

/* ---------------------------------------------------------------- auth */

router.post('/api/auth/register', async (req, res) => {
  const body = await readBody(req);
  const user = auth.createUser({
    email: body.email,
    password: body.password,
    displayName: body.displayName,
  });
  const { token } = auth.createSession(user.id, req.headers['user-agent']);
  send(res, 201, { user: auth.publicUser(user) }, { 'Set-Cookie': auth.sessionCookie(token) });
});

router.post('/api/auth/login', async (req, res) => {
  const body = await readBody(req);
  const email = String(body.email || '').trim().toLowerCase();
  const user = db.users.findOne((u) => u.email === email);
  // constant-ish work either way, and never reveal which half was wrong
  if (!user || !auth.verifyPassword(String(body.password || ''), user.passwordHash)) {
    throw new HttpError(401, 'Email or password is incorrect');
  }
  const { token } = auth.createSession(user.id, req.headers['user-agent']);
  send(res, 200, { user: auth.publicUser(user) }, { 'Set-Cookie': auth.sessionCookie(token) });
});

router.post('/api/auth/logout', async (req, res) => {
  const cookies = require('./http').parseCookies(req.headers.cookie || '');
  auth.destroySession(cookies[auth.SESSION_COOKIE]);
  send(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie() });
});

router.get('/api/auth/me', async (req, res) => {
  const user = auth.currentUser(req);
  if (!user) return send(res, 200, { user: null });
  send(res, 200, {
    user: auth.publicUser(user, {
      stats: {
        playlists: db.playlists.count((p) => p.userId === user.id),
        savedTracks: db.likes.count((l) => l.userId === user.id && l.targetType === 'track'),
        shares: db.shares.count((s) => s.userId === user.id),
        following: db.follows.count((f) => f.followerId === user.id),
        followers: db.follows.count((f) => f.followingId === user.id),
      },
    }),
  });
});

/* ------------------------------------------------------------------- me */

router.patch('/api/me', async (req, res) => {
  const user = auth.requireUser(req);
  const body = await readBody(req);
  const patch = {};
  if (body.displayName !== undefined) patch.displayName = str(body.displayName, 'Display name', { min: 1, max: 60 });
  if (body.bio !== undefined) patch.bio = str(body.bio, 'Bio', { required: false, max: 300 }) || '';
  if (body.avatarColor !== undefined && auth.AVATAR_COLORS.includes(body.avatarColor)) {
    patch.avatarColor = body.avatarColor;
  }
  if (body.handle !== undefined) {
    const handle = str(body.handle, 'Handle', { min: 2, max: 20 }).toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!handle) throw new HttpError(422, 'Handle must contain letters or numbers');
    const clash = db.users.findOne((u) => u.handle === handle && u.id !== user.id);
    if (clash) throw new HttpError(409, 'That handle is taken');
    patch.handle = handle;
  }
  const updated = db.users.update(user.id, patch);
  send(res, 200, { user: auth.publicUser(updated) });
});

router.delete('/api/me', async (req, res) => {
  const user = auth.requireUser(req);
  // cascade: everything this user owns
  const playlists = db.playlists.find((p) => p.userId === user.id);
  for (const p of playlists) db.playlistTracks.removeWhere((r) => r.playlistId === p.id);
  db.playlists.removeWhere((p) => p.userId === user.id);
  const shares = db.shares.find((s) => s.userId === user.id);
  for (const s of shares) db.comments.removeWhere((c) => c.shareId === s.id);
  db.shares.removeWhere((s) => s.userId === user.id);
  db.comments.removeWhere((c) => c.userId === user.id);
  db.likes.removeWhere((l) => l.userId === user.id);
  db.follows.removeWhere((f) => f.followerId === user.id || f.followingId === user.id);
  db.plays.removeWhere((p) => p.userId === user.id);
  auth.destroyAllSessions(user.id);
  db.users.remove(user.id);
  send(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie() });
});

/* -------------------------------------------------------------- search */

router.get('/api/search', async (req, res, ctx) => {
  const q = ctx.query.get('q') || '';
  const limit = Math.min(Number(ctx.query.get('limit')) || 24, 50);
  const provider = ctx.query.get('provider') || null;
  if (!q.trim()) return send(res, 200, { tracks: [], providers: [], errors: [] });
  const result = await providers.search(q, { limit, provider });
  const viewer = auth.currentUser(req);
  const savedIds = viewer
    ? new Set(db.likes.find((l) => l.userId === viewer.id && l.targetType === 'track').map((l) => l.targetId))
    : new Set();
  send(res, 200, {
    ...result,
    tracks: result.tracks.map((t) => ({
      ...t,
      features: featuresLib.estimate(t),
      saved: savedIds.has(t.id),
    })),
  });
});

router.get('/api/providers', async (req, res) => {
  send(res, 200, { providers: providers.statuses(), ai: llm.status() });
});

/* --------------------------------------------------------------- browse */

const HOME_ROWS = [
  { key: 'afro', title: 'Afrobeats Now', query: 'afrobeats hits 2025', limit: 12 },
  { key: 'global', title: 'Global Chart Toppers', query: 'top hits 2025', limit: 12 },
  { key: 'chill', title: 'Late Night Chill', query: 'chill lo-fi late night', limit: 12 },
  { key: 'hiphop', title: 'Hip-Hop Heat', query: 'hip hop bangers', limit: 12 },
  { key: 'amapiano', title: 'Amapiano Wave', query: 'amapiano', limit: 12 },
  { key: 'throwback', title: 'Throwback Gold', query: '90s throwback hits', limit: 12 },
];

router.get('/api/browse', async (req, res) => {
  const rows = await providers.charts(HOME_ROWS);
  const viewer = auth.currentUser(req);
  const savedIds = viewer
    ? new Set(db.likes.find((l) => l.userId === viewer.id && l.targetType === 'track').map((l) => l.targetId))
    : new Set();
  send(res, 200, {
    rows: rows.map((r) => ({
      key: r.key,
      title: r.title,
      tracks: r.tracks.map((t) => ({ ...t, features: featuresLib.estimate(t), saved: savedIds.has(t.id) })),
    })),
  });
});

/* ------------------------------------------------------------ playlists */

router.get('/api/playlists', async (req, res, ctx) => {
  const user = auth.requireUser(req);
  const scope = ctx.query.get('scope') || 'mine';
  let list;
  if (scope === 'public') {
    list = db.playlists.find((p) => p.isPublic);
  } else if (scope === 'liked') {
    const likedIds = new Set(
      db.likes.find((l) => l.userId === user.id && l.targetType === 'playlist').map((l) => l.targetId)
    );
    list = db.playlists.find((p) => likedIds.has(p.id) && (p.isPublic || p.userId === user.id));
  } else {
    list = db.playlists.find((p) => p.userId === user.id);
  }
  list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  send(res, 200, { playlists: list.map((p) => hydratePlaylist(p, user.id)) });
});

router.post('/api/playlists', async (req, res) => {
  const user = auth.requireUser(req);
  const body = await readBody(req);
  const name = str(body.name, 'Playlist name', { min: 1, max: 80 });
  const description = str(body.description, 'Description', { required: false, max: 300 }) || '';
  const playlist = db.playlists.insert(
    {
      id: id('pl'),
      userId: user.id,
      name,
      description,
      isPublic: bool(body.isPublic, true),
      coverColor: body.coverColor || null,
      aiGenerated: bool(body.aiGenerated, false),
      aiPrompt: body.aiPrompt ? String(body.aiPrompt).slice(0, 300) : null,
      aiIntent: body.aiIntent || null,
    },
    'pl'
  );

  // optional: create with an initial tracklist (used by the AI generator)
  if (Array.isArray(body.tracks) && body.tracks.length) {
    let position = 0;
    for (const t of body.tracks.slice(0, 100)) {
      try {
        const cached = cacheTrack(t);
        db.playlistTracks.insert(
          { id: id('plt'), playlistId: playlist.id, trackId: cached.id, position, note: '' },
          'plt'
        );
        position += 1;
      } catch {
        /* skip malformed rows rather than fail the whole create */
      }
    }
  }
  send(res, 201, { playlist: hydratePlaylist(db.playlists.get(playlist.id), user.id, { withTracks: true }) });
});

router.get('/api/playlists/:id', async (req, res, ctx) => {
  const viewer = auth.currentUser(req);
  const playlist = visiblePlaylist(ctx.params.id, viewer?.id);
  send(res, 200, { playlist: hydratePlaylist(playlist, viewer?.id, { withTracks: true }) });
});

router.patch('/api/playlists/:id', async (req, res, ctx) => {
  const user = auth.requireUser(req);
  ownedPlaylist(ctx.params.id, user.id);
  const body = await readBody(req);
  const patch = {};
  if (body.name !== undefined) patch.name = str(body.name, 'Playlist name', { min: 1, max: 80 });
  if (body.description !== undefined) {
    patch.description = str(body.description, 'Description', { required: false, max: 300 }) || '';
  }
  if (body.isPublic !== undefined) patch.isPublic = Boolean(body.isPublic);
  if (body.coverColor !== undefined) patch.coverColor = body.coverColor;
  const updated = db.playlists.update(ctx.params.id, patch);
  send(res, 200, { playlist: hydratePlaylist(updated, user.id, { withTracks: true }) });
});

router.delete('/api/playlists/:id', async (req, res, ctx) => {
  const user = auth.requireUser(req);
  ownedPlaylist(ctx.params.id, user.id);
  db.playlistTracks.removeWhere((r) => r.playlistId === ctx.params.id);
  db.likes.removeWhere((l) => l.targetType === 'playlist' && l.targetId === ctx.params.id);
  // shares that pointed at this playlist lose their subject
  db.shares.removeWhere((s) => s.playlistId === ctx.params.id);
  db.playlists.remove(ctx.params.id);
  send(res, 200, { ok: true, id: ctx.params.id });
});

/** Add a track (append, or insert at position). */
router.post('/api/playlists/:id/tracks', async (req, res, ctx) => {
  const user = auth.requireUser(req);
  const playlist = ownedPlaylist(ctx.params.id, user.id);
  const body = await readBody(req);
  const track = cacheTrack(body.track || body);
  const rows = playlistTrackRows(playlist.id);

  if (!bool(body.allowDuplicate, false) && rows.some((r) => r.trackId === track.id)) {
    throw new HttpError(409, 'That track is already in this playlist');
  }
  const position = Number.isInteger(body.position)
    ? Math.max(0, Math.min(body.position, rows.length))
    : rows.length;

  if (position < rows.length) {
    for (const r of rows) if (r.position >= position) db.playlistTracks.update(r.id, { position: r.position + 1 });
  }
  db.playlistTracks.insert(
    { id: id('plt'), playlistId: playlist.id, trackId: track.id, position, note: String(body.note || '').slice(0, 200) },
    'plt'
  );
  db.playlists.update(playlist.id, {});
  send(res, 201, { playlist: hydratePlaylist(db.playlists.get(playlist.id), user.id, { withTracks: true }) });
});

/** Update a membership row: note and/or position (drag-to-reorder). */
router.patch('/api/playlists/:id/tracks/:rowId', async (req, res, ctx) => {
  const user = auth.requireUser(req);
  ownedPlaylist(ctx.params.id, user.id);
  const body = await readBody(req);
  const row = db.playlistTracks.get(ctx.params.rowId);
  if (!row || row.playlistId !== ctx.params.id) throw new HttpError(404, 'Track is not in this playlist');

  if (body.note !== undefined) db.playlistTracks.update(row.id, { note: String(body.note).slice(0, 200) });

  if (Number.isInteger(body.position)) {
    const rows = playlistTrackRows(ctx.params.id).filter((r) => r.id !== row.id);
    const target = Math.max(0, Math.min(body.position, rows.length));
    rows.splice(target, 0, row);
    rows.forEach((r, i) => {
      if (r.position !== i) db.playlistTracks.update(r.id, { position: i });
    });
  }
  db.playlists.update(ctx.params.id, {});
  send(res, 200, { playlist: hydratePlaylist(db.playlists.get(ctx.params.id), user.id, { withTracks: true }) });
});

router.delete('/api/playlists/:id/tracks/:rowId', async (req, res, ctx) => {
  const user = auth.requireUser(req);
  ownedPlaylist(ctx.params.id, user.id);
  const row = db.playlistTracks.get(ctx.params.rowId);
  if (!row || row.playlistId !== ctx.params.id) throw new HttpError(404, 'Track is not in this playlist');
  db.playlistTracks.remove(row.id);
  playlistTrackRows(ctx.params.id).forEach((r, i) => {
    if (r.position !== i) db.playlistTracks.update(r.id, { position: i });
  });
  db.playlists.update(ctx.params.id, {});
  send(res, 200, { playlist: hydratePlaylist(db.playlists.get(ctx.params.id), user.id, { withTracks: true }) });
});

/* ------------------------------------------------------- library/likes */

router.get('/api/library', async (req, res) => {
  const user = auth.requireUser(req);
  const likes = db.likes
    .find((l) => l.userId === user.id && l.targetType === 'track')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const tracks = likes
    .map((l) => {
      const t = db.tracks.get(l.targetId);
      return t ? { ...t, saved: true, savedAt: l.createdAt } : null;
    })
    .filter(Boolean);
  send(res, 200, { tracks });
});

router.post('/api/library', async (req, res) => {
  const user = auth.requireUser(req);
  const body = await readBody(req);
  const track = cacheTrack(body.track || body);
  const existing = db.likes.findOne(
    (l) => l.userId === user.id && l.targetType === 'track' && l.targetId === track.id
  );
  if (existing) return send(res, 200, { saved: true, track: { ...track, saved: true } });
  db.likes.insert({ id: id('like'), userId: user.id, targetType: 'track', targetId: track.id }, 'like');
  send(res, 201, { saved: true, track: { ...track, saved: true } });
});

router.delete('/api/library/:trackId', async (req, res, ctx) => {
  const user = auth.requireUser(req);
  const removed = db.likes.removeWhere(
    (l) => l.userId === user.id && l.targetType === 'track' && l.targetId === ctx.params.trackId
  );
  send(res, 200, { saved: false, removed });
});

/** Generic like toggle for playlist | share | comment. */
router.post('/api/likes', async (req, res) => {
  const user = auth.requireUser(req);
  const body = await readBody(req);
  const targetType = str(body.targetType, 'targetType');
  const targetId = str(body.targetId, 'targetId');
  if (!['playlist', 'share', 'comment', 'track'].includes(targetType)) {
    throw new HttpError(422, 'Unsupported like target');
  }
  const existing = db.likes.findOne(
    (l) => l.userId === user.id && l.targetType === targetType && l.targetId === targetId
  );
  if (existing) {
    db.likes.remove(existing.id);
    return send(res, 200, {
      liked: false,
      likeCount: db.likes.count((l) => l.targetType === targetType && l.targetId === targetId),
    });
  }
  db.likes.insert({ id: id('like'), userId: user.id, targetType, targetId }, 'like');
  send(res, 201, {
    liked: true,
    likeCount: db.likes.count((l) => l.targetType === targetType && l.targetId === targetId),
  });
});

/* --------------------------------------------------------------- shares */

router.get('/api/shares', async (req, res, ctx) => {
  const viewer = auth.currentUser(req);
  const scope = ctx.query.get('scope') || 'all';
  let list = db.shares.all();
  if (scope === 'mine') {
    if (!viewer) throw new HttpError(401, 'You need to sign in to do that');
    list = list.filter((s) => s.userId === viewer.id);
  } else if (scope === 'following' && viewer) {
    const ids = new Set(db.follows.find((f) => f.followerId === viewer.id).map((f) => f.followingId));
    ids.add(viewer.id);
    list = list.filter((s) => ids.has(s.userId));
  }
  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  send(res, 200, { shares: list.slice(0, 100).map((s) => hydrateShare(s, viewer?.id)) });
});

router.post('/api/shares', async (req, res) => {
  const user = auth.requireUser(req);
  const body = await readBody(req);
  const message = str(body.message, 'Message', { required: false, max: 500 }) || '';
  let trackId = null;
  let playlistId = null;

  if (body.track) trackId = cacheTrack(body.track).id;
  else if (body.trackId) trackId = trackOr404(body.trackId).id;

  if (body.playlistId) {
    const pl = db.playlists.get(body.playlistId);
    if (!pl) throw new HttpError(404, 'Playlist not found');
    if (pl.userId !== user.id && !pl.isPublic) throw new HttpError(403, 'That playlist is private');
    playlistId = pl.id;
  }
  if (!trackId && !playlistId && !message) {
    throw new HttpError(422, 'Share a track, a playlist, or write something');
  }
  const share = db.shares.insert(
    { id: id('shr'), userId: user.id, message, trackId, playlistId, mood: body.mood || null },
    'shr'
  );
  send(res, 201, { share: hydrateShare(share, user.id) });
});

router.get('/api/shares/:id', async (req, res, ctx) => {
  const viewer = auth.currentUser(req);
  const share = db.shares.get(ctx.params.id);
  if (!share) throw new HttpError(404, 'Post not found');
  send(res, 200, { share: hydrateShare(share, viewer?.id) });
});

router.patch('/api/shares/:id', async (req, res, ctx) => {
  const user = auth.requireUser(req);
  const share = db.shares.get(ctx.params.id);
  if (!share) throw new HttpError(404, 'Post not found');
  if (share.userId !== user.id) throw new HttpError(403, 'You can only edit your own posts');
  const body = await readBody(req);
  const patch = {};
  if (body.message !== undefined) patch.message = str(body.message, 'Message', { required: false, max: 500 }) || '';
  if (body.mood !== undefined) patch.mood = body.mood || null;
  const updated = db.shares.update(share.id, { ...patch, editedAt: new Date().toISOString() });
  send(res, 200, { share: hydrateShare(updated, user.id) });
});

router.delete('/api/shares/:id', async (req, res, ctx) => {
  const user = auth.requireUser(req);
  const share = db.shares.get(ctx.params.id);
  if (!share) throw new HttpError(404, 'Post not found');
  if (share.userId !== user.id) throw new HttpError(403, 'You can only delete your own posts');
  db.comments.removeWhere((c) => c.shareId === share.id);
  db.likes.removeWhere((l) => l.targetType === 'share' && l.targetId === share.id);
  db.shares.remove(share.id);
  send(res, 200, { ok: true, id: share.id });
});

/* ------------------------------------------------------------- comments */

router.get('/api/shares/:id/comments', async (req, res, ctx) => {
  const viewer = auth.currentUser(req);
  if (!db.shares.has(ctx.params.id)) throw new HttpError(404, 'Post not found');
  const list = db.comments
    .find((c) => c.shareId === ctx.params.id)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  send(res, 200, { comments: list.map((c) => hydrateComment(c, viewer?.id)) });
});

router.post('/api/shares/:id/comments', async (req, res, ctx) => {
  const user = auth.requireUser(req);
  if (!db.shares.has(ctx.params.id)) throw new HttpError(404, 'Post not found');
  const body = await readBody(req);
  const text = str(body.body ?? body.text, 'Comment', { min: 1, max: 500 });
  const comment = db.comments.insert(
    { id: id('cmt'), shareId: ctx.params.id, userId: user.id, body: text },
    'cmt'
  );
  send(res, 201, { comment: hydrateComment(comment, user.id) });
});

router.patch('/api/comments/:id', async (req, res, ctx) => {
  const user = auth.requireUser(req);
  const comment = db.comments.get(ctx.params.id);
  if (!comment) throw new HttpError(404, 'Comment not found');
  if (comment.userId !== user.id) throw new HttpError(403, 'You can only edit your own comments');
  const body = await readBody(req);
  const text = str(body.body ?? body.text, 'Comment', { min: 1, max: 500 });
  const updated = db.comments.update(comment.id, { body: text, editedAt: new Date().toISOString() });
  send(res, 200, { comment: hydrateComment(updated, user.id) });
});

router.delete('/api/comments/:id', async (req, res, ctx) => {
  const user = auth.requireUser(req);
  const comment = db.comments.get(ctx.params.id);
  if (!comment) throw new HttpError(404, 'Comment not found');
  const share = db.shares.get(comment.shareId);
  // comment author OR the post owner can remove it
  if (comment.userId !== user.id && share?.userId !== user.id) {
    throw new HttpError(403, 'You cannot delete that comment');
  }
  db.likes.removeWhere((l) => l.targetType === 'comment' && l.targetId === comment.id);
  db.comments.remove(comment.id);
  send(res, 200, { ok: true, id: comment.id });
});

/* -------------------------------------------------------------- social */

router.post('/api/follows', async (req, res) => {
  const user = auth.requireUser(req);
  const body = await readBody(req);
  const targetId = str(body.userId, 'userId');
  if (targetId === user.id) throw new HttpError(422, 'You cannot follow yourself');
  if (!db.users.has(targetId)) throw new HttpError(404, 'User not found');
  const existing = db.follows.findOne((f) => f.followerId === user.id && f.followingId === targetId);
  if (existing) {
    db.follows.remove(existing.id);
    return send(res, 200, { following: false });
  }
  db.follows.insert({ id: id('fol'), followerId: user.id, followingId: targetId }, 'fol');
  send(res, 201, { following: true });
});

router.get('/api/users/:handle', async (req, res, ctx) => {
  const viewer = auth.currentUser(req);
  const user = db.users.findOne((u) => u.handle === ctx.params.handle || u.id === ctx.params.handle);
  if (!user) throw new HttpError(404, 'User not found');
  const playlists = db.playlists
    .find((p) => p.userId === user.id && (p.isPublic || viewer?.id === user.id))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  send(res, 200, {
    user: auth.publicUser(user, {
      followerCount: db.follows.count((f) => f.followingId === user.id),
      followingCount: db.follows.count((f) => f.followerId === user.id),
      followedByMe: viewer
        ? Boolean(db.follows.findOne((f) => f.followerId === viewer.id && f.followingId === user.id))
        : false,
      isMe: viewer?.id === user.id,
    }),
    playlists: playlists.map((p) => hydratePlaylist(p, viewer?.id)),
    shares: db.shares
      .find((s) => s.userId === user.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 20)
      .map((s) => hydrateShare(s, viewer?.id)),
  });
});

/* ---------------------------------------------------------------- plays */

router.post('/api/plays', async (req, res) => {
  const user = auth.currentUser(req);
  if (!user) return send(res, 200, { ok: true }); // anonymous listening isn't tracked
  const body = await readBody(req);
  const track = cacheTrack(body.track || body);
  db.plays.insert(
    { id: id('ply'), userId: user.id, trackId: track.id, ms: Number(body.ms) || 0 },
    'ply'
  );
  // keep history bounded per user
  const mine = db.plays.find((p) => p.userId === user.id).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  if (mine.length > 500) for (const p of mine.slice(0, mine.length - 500)) db.plays.remove(p.id);
  send(res, 201, { ok: true });
});

router.get('/api/plays/recent', async (req, res) => {
  const user = auth.requireUser(req);
  const seen = new Set();
  const out = [];
  const mine = db.plays.find((p) => p.userId === user.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  for (const p of mine) {
    if (seen.has(p.trackId)) continue;
    seen.add(p.trackId);
    const t = db.tracks.get(p.trackId);
    if (t) out.push({ ...t, playedAt: p.createdAt });
    if (out.length >= 20) break;
  }
  send(res, 200, { tracks: out });
});

/* ------------------------------------------------------------------- ai */

router.post('/api/ai/playlist', async (req, res) => {
  auth.requireUser(req);
  const body = await readBody(req);
  const prompt = str(body.prompt, 'Prompt', { min: 2, max: 300 });
  const limit = Math.min(Math.max(Number(body.limit) || 20, 5), 40);
  const result = await engine.generatePlaylist(prompt, { limit });
  if (!result.tracks.length) throw new HttpError(502, 'No tracks matched that prompt — try different wording');
  send(res, 200, result);
});

router.post('/api/ai/similar', async (req, res) => {
  auth.requireUser(req);
  const body = await readBody(req);
  const seed = body.track || (body.trackId ? trackOr404(body.trackId) : null);
  if (!seed) throw new HttpError(422, 'A seed track is required');
  const tracks = await engine.similarTo(seed, { limit: Math.min(Number(body.limit) || 12, 24) });
  send(res, 200, { seed: { id: seed.id, title: seed.title, artist: seed.artist }, tracks });
});

router.get('/api/ai/recommendations', async (req, res) => {
  const user = auth.requireUser(req);
  const likedIds = db.likes
    .find((l) => l.userId === user.id && l.targetType === 'track')
    .map((l) => l.targetId);
  const playedIds = db.plays.find((p) => p.userId === user.id).map((p) => p.trackId);
  const playlistTrackIds = db.playlists
    .find((p) => p.userId === user.id)
    .flatMap((p) => playlistTrackRows(p.id).map((r) => r.trackId));

  const knownIds = [...new Set([...likedIds, ...playedIds, ...playlistTrackIds])];
  const knownTracks = knownIds.map((tid) => db.tracks.get(tid)).filter(Boolean);
  const profile = engine.tasteProfile(knownTracks);

  if (knownTracks.length < 3) {
    return send(res, 200, {
      profile,
      tracks: [],
      cold: true,
      hint: 'Save or play at least 3 tracks and Sonora will start learning your taste.',
    });
  }

  // seed queries from the user's own top artists/genres
  const seedQueries = [
    ...profile.topArtists.slice(0, 2).map((a) => a.name),
    ...profile.topGenres.slice(0, 2).map((g) => g.name),
  ].filter(Boolean);
  if (!seedQueries.length) seedQueries.push('popular hits 2025');

  const tracks = await engine.recommend(profile, {
    limit: 12,
    exclude: new Set(knownIds),
    seedQueries,
  });
  send(res, 200, { profile, tracks, cold: false });
});

router.get('/api/ai/status', async (req, res) => {
  send(res, 200, llm.status());
});

/* -------------------------------------------------------------- stats */

router.get('/api/stats', async (req, res) => {
  const user = auth.requireUser(req);
  const myPlaylists = db.playlists.find((p) => p.userId === user.id);
  const myPlays = db.plays.find((p) => p.userId === user.id);
  const savedCount = db.likes.count((l) => l.userId === user.id && l.targetType === 'track');
  const listenedMs = myPlays.reduce((s, p) => s + (p.ms || 0), 0);

  const artistCount = new Map();
  for (const p of myPlays) {
    const t = db.tracks.get(p.trackId);
    if (!t?.artist) continue;
    artistCount.set(t.artist, (artistCount.get(t.artist) || 0) + 1);
  }
  const topArtists = [...artistCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, plays]) => ({ name, plays }));

  send(res, 200, {
    stats: {
      playlists: myPlaylists.length,
      savedTracks: savedCount,
      shares: db.shares.count((s) => s.userId === user.id),
      plays: myPlays.length,
      listenedMs,
      followers: db.follows.count((f) => f.followingId === user.id),
      following: db.follows.count((f) => f.followerId === user.id),
      topArtists,
    },
  });
});

/* ------------------------------------------------------- spotify oauth */

router.get('/api/providers/spotify/callback', async (req, res, ctx) => {
  const code = ctx.query.get('code');
  const html = `<!doctype html><meta charset="utf-8"><title>Spotify</title>
<body style="font-family:system-ui;background:#0b0b14;color:#fff;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center;max-width:420px">
<h2>${code ? 'Spotify connected' : 'Spotify connection cancelled'}</h2>
<p style="opacity:.7">${code ? 'You can close this window and return to Sonora.' : 'No authorization code was returned.'}</p>
</div></body>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

module.exports = { router, cacheTrack, hydratePlaylist, resolvePlayable };
