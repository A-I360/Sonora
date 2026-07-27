'use strict';
/**
 * Catalog provider layer.
 *
 * Every provider normalises to the same Track shape so the rest of the app
 * never cares where a song came from:
 *
 *   { id, provider, providerId, title, artist, album, artwork, previewUrl,
 *     streamUrl, durationMs, genre, year, externalUrl, explicit }
 *
 * Enabled providers are chosen at runtime from env keys. iTunes + Audius +
 * Deezer need no credentials; Spotify/Boomplay activate when you supply keys.
 */

const itunes = require('./itunes');
const audius = require('./audius');
const deezer = require('./deezer');
const spotify = require('./spotify');

const REGISTRY = { itunes, audius, deezer, spotify };

function enabled() {
  return Object.values(REGISTRY).filter((p) => p.isEnabled());
}

function statuses() {
  return Object.values(REGISTRY).map((p) => ({
    key: p.key,
    label: p.label,
    enabled: p.isEnabled(),
    playback: p.playback,
    note: p.note(),
  }));
}

function dedupe(tracks) {
  const seen = new Set();
  const out = [];
  for (const t of tracks) {
    if (!t) continue;
    const fingerprint = `${(t.title || '').toLowerCase().replace(/[^a-z0-9]/g, '')}|${(t.artist || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')}`;
    if (seen.has(fingerprint)) {
      // prefer the copy that can actually make sound
      const existingIdx = out.findIndex((o) => {
        const f = `${(o.title || '').toLowerCase().replace(/[^a-z0-9]/g, '')}|${(o.artist || '')
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '')}`;
        return f === fingerprint;
      });
      if (existingIdx !== -1) {
        const existing = out[existingIdx];
        const existingPlayable = Boolean(existing.streamUrl || existing.previewUrl);
        const candidatePlayable = Boolean(t.streamUrl || t.previewUrl);
        if (!existingPlayable && candidatePlayable) out[existingIdx] = t;
      }
      continue;
    }
    seen.add(fingerprint);
    out.push(t);
  }
  return out;
}

/** Fan out to every enabled provider; a slow/broken one must never sink the search. */
async function search(query, { limit = 24, provider = null } = {}) {
  const q = String(query || '').trim();
  if (!q) return { tracks: [], providers: [], errors: [] };

  const targets = provider && REGISTRY[provider] ? [REGISTRY[provider]] : enabled();
  const errors = [];

  const settled = await Promise.allSettled(
    targets.map((p) =>
      p.search(q, limit).then((tracks) => ({ key: p.key, tracks }))
    )
  );

  let all = [];
  const used = [];
  for (let i = 0; i < settled.length; i += 1) {
    const r = settled[i];
    if (r.status === 'fulfilled') {
      used.push(r.value.key);
      all = all.concat(r.value.tracks);
    } else {
      errors.push({ provider: targets[i].key, message: r.reason?.message || 'failed' });
    }
  }

  // interleave providers so results aren't 20 iTunes rows then 4 Audius rows
  const byProvider = new Map();
  for (const t of all) {
    if (!byProvider.has(t.provider)) byProvider.set(t.provider, []);
    byProvider.get(t.provider).push(t);
  }
  const lists = [...byProvider.values()];
  const interleaved = [];
  let idx = 0;
  while (interleaved.length < all.length) {
    let pushedAny = false;
    for (const list of lists) {
      if (idx < list.length) {
        interleaved.push(list[idx]);
        pushedAny = true;
      }
    }
    if (!pushedAny) break;
    idx += 1;
  }

  const tracks = dedupe(interleaved)
    .sort((a, b) => {
      const ap = a.streamUrl || a.previewUrl ? 0 : 1;
      const bp = b.streamUrl || b.previewUrl ? 0 : 1;
      return ap - bp;
    })
    .slice(0, limit);

  return { tracks, providers: used, errors };
}

/** Editorial-ish home rows, assembled from real catalog queries. */
async function charts(seedQueries) {
  const settled = await Promise.allSettled(
    seedQueries.map((s) => search(s.query, { limit: s.limit || 12 }).then((r) => ({ ...s, tracks: r.tracks })))
  );
  return settled
    .filter((r) => r.status === 'fulfilled' && r.value.tracks.length)
    .map((r) => r.value);
}

module.exports = { REGISTRY, enabled, statuses, search, charts, dedupe };
