'use strict';
/**
 * Sonora AI engine.
 *
 *  1. parsePrompt()      NL → structured intent (moods, genres, decade, artists, target vector)
 *  2. generatePlaylist() intent → real catalog fan-out → feature-scored, diversity-constrained tracklist
 *  3. recommend()        taste centroid from library/likes/plays → ranked suggestions
 *  4. similarTo()        one seed track → nearest neighbours in feature space
 *  5. tasteProfile()     listening history → readable profile + top genres/artists
 *
 * Works fully offline-of-LLM. If OPENAI_API_KEY / ANTHROPIC_API_KEY is present,
 * llm.js refines the intent first (better titles, smarter query expansion) and
 * we degrade gracefully back to the deterministic path on any failure.
 */

const providers = require('../providers');
const { MOODS, GENRES, DECADES } = require('./lexicon');
const features = require('./features');
const llm = require('./llm');

const STOP = new Set([
  'a','an','the','for','with','and','or','of','to','in','on','at','my','me','i','some','songs','song',
  'music','playlist','make','create','build','give','want','need','something','that','this','like',
  'feel','feeling','vibe','vibes','mood','please','can','you','it','is','are','be','get','list','mix',
  'tracks','track','tunes','about','more','really','very','just','when','while','during','good','nice',
]);

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s'&-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Extract structured intent from free text. */
function parsePrompt(prompt) {
  const raw = String(prompt || '').trim();
  const lower = ` ${raw.toLowerCase()} `;
  const tokens = tokenize(raw);

  const moods = [];
  for (const [name, entry] of Object.entries(MOODS)) {
    for (const alias of entry.aliases) {
      if (lower.includes(` ${alias} `) || lower.includes(`${alias},`) || lower.includes(`${alias} `)) {
        moods.push(name);
        break;
      }
    }
  }

  const genres = [];
  for (const [name, entry] of Object.entries(GENRES)) {
    for (const alias of entry.aliases) {
      if (lower.includes(alias)) {
        genres.push(name);
        break;
      }
    }
  }

  let decade = null;
  for (const d of DECADES) {
    if (d.re.test(lower)) {
      decade = d;
      break;
    }
  }

  // "like Burna Boy", "similar to Adele", "artists: X"
  const artistHints = [];
  const likeRe = /(?:like|similar to|sounds like|in the style of|reminds me of)\s+([a-z0-9'&.\- ]{2,40})/gi;
  let m;
  while ((m = likeRe.exec(raw)) !== null) {
    const cleaned = m[1].trim().replace(/\b(and|but|with|for|please|songs?|music|vibes?)\b.*$/i, '').trim();
    if (cleaned.length > 1) artistHints.push(cleaned);
  }

  // target vector = blend of every matched mood + genre, else neutral
  const vectors = [
    ...moods.map((n) => MOODS[n].features),
    ...genres.map((n) => GENRES[n].features),
  ];
  const target = vectors.length ? features.centroid(vectors) : { ...features.BASE };

  // explicit modifiers
  if (/\bfast|upbeat|quick|energetic\b/.test(lower)) target.tempo = features.clamp01(target.tempo + 0.15);
  if (/\bslow|slower|downtempo\b/.test(lower)) target.tempo = features.clamp01(target.tempo - 0.2);
  if (/\binstrumental|no vocals|no lyrics\b/.test(lower)) target.acousticness = features.clamp01(target.acousticness + 0.15);

  // leftover keywords become literal search terms (catches "wedding", "gym", artist names)
  const keywords = tokens.filter((t) => t.length > 2 && !STOP.has(t)).slice(0, 6);

  // build catalog queries
  const queries = [];
  for (const g of genres) queries.push(...GENRES[g].queries.slice(0, 2));
  for (const mo of moods) queries.push(...MOODS[mo].queries.slice(0, 2));
  for (const a of artistHints) queries.push(a);
  if (decade) queries.push(decade.q);
  // cross terms sharpen results: "moody afrobeats" beats "moody" + "afrobeats" alone
  if (genres.length && moods.length) {
    queries.unshift(`${moods[0]} ${genres[0] === 'rnb' ? 'r&b' : genres[0]}`);
  }
  if (!queries.length && keywords.length) queries.push(keywords.slice(0, 3).join(' '));
  if (!queries.length) queries.push(raw || 'popular hits');

  return {
    prompt: raw,
    moods,
    genres,
    decade: decade ? { from: decade.from, to: decade.to } : null,
    artistHints,
    keywords,
    target,
    queries: [...new Set(queries)].slice(0, 6),
    source: 'rules',
  };
}

function titleCase(s) {
  return String(s || '').replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/**
 * Open catalogs carry a lot of bedroom-producer noise ("Drake Type Beat",
 * ripped YouTube uploads). Demote it so real records surface first.
 */
const NOISE = [
  { re: /\btype beat\b/i, p: 0.34 },
  { re: /\[[A-Za-z0-9_-]{8,}\]/, p: 0.3 },      // [dQw4w9WgXcQ] youtube id
  { re: /\b(bootleg|mashup|flip)\b/i, p: 0.12 },
  { re: /\b(prod\.?\s*by|prod\.)\b/i, p: 0.1 },
  { re: /\b(free download|no copyright|royalty free|copyright free)\b/i, p: 0.3 },
  { re: /\b(vol\.?\s*\d{1,2}|part\s*\d+)\b/i, p: 0.08 },
  { re: /\b(official video|official audio|lyric video|full album)\b/i, p: 0.16 },
  { re: /\b(cover|karaoke|instrumental version|tribute)\b/i, p: 0.14 },
];

function qualityPenalty(track) {
  const text = `${track.title || ''} ${track.artist || ''}`;
  let penalty = 0;
  for (const n of NOISE) if (n.re.test(text)) penalty += n.p;
  if ((track.title || '').length > 70) penalty += 0.08;
  // shouty all-caps titles are usually uploads, not releases
  const letters = (track.title || '').replace(/[^A-Za-z]/g, '');
  if (letters.length > 8 && letters === letters.toUpperCase()) penalty += 0.06;
  return Math.min(penalty, 0.6);
}

/** Human-sounding playlist name derived from the intent. */
function nameFor(intent) {
  const mood = intent.moods[0];
  const genre = intent.genres[0];
  const genreLabel = genre === 'rnb' ? 'R&B' : genre === 'hiphop' ? 'Hip-Hop' : genre ? titleCase(genre) : '';
  const templates = [];
  if (mood && genreLabel) {
    templates.push(`${titleCase(mood)} ${genreLabel}`, `${genreLabel} for ${titleCase(mood)} Hours`);
  } else if (genreLabel) {
    templates.push(`${genreLabel} Essentials`, `Deep in ${genreLabel}`);
  } else if (mood) {
    templates.push(`${titleCase(mood)} Mode`, `Strictly ${titleCase(mood)}`);
  }
  if (intent.artistHints.length) templates.push(`Sounds Like ${titleCase(intent.artistHints[0])}`);
  if (intent.decade) templates.push(`${intent.decade.from}s Rewind`);
  if (!templates.length) {
    const words = intent.keywords.slice(0, 3).map(titleCase).join(' ');
    templates.push(words || 'Your AI Mix');
  }
  return templates[0].slice(0, 60);
}

function describeIntent(intent, count) {
  const bits = [];
  if (intent.moods.length) bits.push(`${intent.moods.join(' + ')} mood`);
  if (intent.genres.length) bits.push(intent.genres.map((g) => (g === 'rnb' ? 'R&B' : g)).join(' + '));
  if (intent.decade) bits.push(`${intent.decade.from}s era`);
  if (intent.artistHints.length) bits.push(`in the orbit of ${intent.artistHints.join(', ')}`);
  const lead = bits.length ? bits.join(', ') : 'your prompt';
  return `${count} tracks matched to ${lead} · target profile: ${features.describe(intent.target)}`;
}

/**
 * Generate a playlist from a natural-language prompt.
 * Diversity constraint: max 2 tracks per artist so it doesn't become one album.
 */
async function generatePlaylist(prompt, { limit = 20, useLlm = true } = {}) {
  let intent = parsePrompt(prompt);

  if (useLlm && llm.isEnabled()) {
    try {
      const refined = await llm.refineIntent(prompt, intent);
      if (refined) intent = { ...intent, ...refined, source: 'llm' };
    } catch (err) {
      console.warn('[ai] llm refine failed, using rules:', err.message);
    }
  }

  const perQuery = Math.max(12, Math.ceil((limit * 2.5) / Math.max(intent.queries.length, 1)));
  const settled = await Promise.allSettled(
    intent.queries.map((q) => providers.search(q, { limit: perQuery }))
  );

  // Provenance matters: a rank-1 hit for the sharpest query is far more relevant
  // than a rank-18 hit for a broad one. Cosine alone can't see that.
  const relevance = new Map(); // trackId -> best relevance 0..1
  let pool = [];
  for (let qi = 0; qi < settled.length; qi += 1) {
    const r = settled[qi];
    if (r.status !== 'fulfilled') continue;
    // queries[0] is the cross-term ("moody afrobeats") — trust it most
    const queryWeight = qi === 0 ? 1 : 0.82 - Math.min(qi, 5) * 0.06;
    const list = r.value.tracks;
    for (let i = 0; i < list.length; i += 1) {
      const t = list[i];
      const rank = 1 - i / Math.max(list.length, 1); // 1 at top, →0 at tail
      const rel = queryWeight * (0.45 + 0.55 * rank);
      relevance.set(t.id, Math.max(relevance.get(t.id) || 0, rel));
      pool.push(t);
    }
  }
  pool = providers.dedupe(pool);

  // hard filters
  if (intent.decade) {
    const inEra = pool.filter((t) => t.year && t.year >= intent.decade.from && t.year <= intent.decade.to);
    if (inEra.length >= Math.min(8, limit)) pool = inEra;
  }

  const scored = pool.map((t) => {
    const vec = features.estimate(t);
    const sim = features.similarity(vec, intent.target); // ~0.7-1.0, weak discriminator
    const rel = relevance.get(t.id) || 0.3;

    // stretch similarity across its useful band so it actually separates tracks
    const simNorm = features.clamp01((sim - 0.72) / 0.28);

    let score = rel * 0.52 + simNorm * 0.33;

    // playability: silence is useless in a music player
    if (t.streamUrl) score += 0.09;
    else if (t.previewUrl) score += 0.07;
    if (t.artwork) score += 0.02;

    for (const hint of intent.artistHints) {
      if ((t.artist || '').toLowerCase().includes(hint.toLowerCase())) score += 0.14;
    }
    for (const kw of intent.keywords) {
      const hay = `${t.title} ${t.artist} ${t.album} ${t.genre}`.toLowerCase();
      if (hay.includes(kw)) score += 0.025;
    }
    score -= qualityPenalty(t);

    return { track: { ...t, features: vec }, score: Math.round(features.clamp01(score) * 1000) / 1000 };
  });

  scored.sort((a, b) => b.score - a.score);

  const picked = [];
  const perArtist = new Map();
  for (const s of scored) {
    const artistKey = (s.track.artist || '').toLowerCase();
    const n = perArtist.get(artistKey) || 0;
    if (n >= 2) continue;
    perArtist.set(artistKey, n + 1);
    picked.push(s);
    if (picked.length >= limit) break;
  }
  // top up if diversity starved us
  if (picked.length < limit) {
    for (const s of scored) {
      if (picked.includes(s)) continue;
      picked.push(s);
      if (picked.length >= limit) break;
    }
  }

  return {
    name: intent.name || nameFor(intent),
    description: intent.description || describeIntent(intent, picked.length),
    intent: {
      moods: intent.moods,
      genres: intent.genres,
      decade: intent.decade,
      artistHints: intent.artistHints,
      target: intent.target,
      queries: intent.queries,
      source: intent.source,
    },
    tracks: picked.map((p) => ({ ...p.track, matchScore: p.score })),
  };
}

/** Nearest neighbours to a seed track. */
async function similarTo(seed, { limit = 12 } = {}) {
  const seedVec = seed.features || features.estimate(seed);
  const queries = [seed.artist, seed.genre, `${seed.genre || ''} like ${seed.artist || ''}`.trim()].filter(
    (q) => q && String(q).trim().length > 1
  );
  if (!queries.length) queries.push(seed.title);

  const settled = await Promise.allSettled(queries.map((q) => providers.search(q, { limit: 20 })));
  let pool = [];
  for (const r of settled) if (r.status === 'fulfilled') pool = pool.concat(r.value.tracks);

  pool = providers.dedupe(pool).filter((t) => t.id !== seed.id);
  const scored = pool
    .map((t) => {
      const vec = features.estimate(t);
      const simNorm = features.clamp01((features.similarity(vec, seedVec) - 0.72) / 0.28);
      let score = simNorm * 0.72;
      if ((t.artist || '').toLowerCase() === (seed.artist || '').toLowerCase()) score += 0.14;
      if (t.streamUrl || t.previewUrl) score += 0.08;
      score -= qualityPenalty(t);
      return { ...t, features: vec, matchScore: Math.round(features.clamp01(score) * 1000) / 1000 };
    })
    .sort((a, b) => b.matchScore - a.matchScore);

  const out = [];
  const perArtist = new Map();
  for (const t of scored) {
    const k = (t.artist || '').toLowerCase();
    const n = perArtist.get(k) || 0;
    if (n >= 2) continue;
    perArtist.set(k, n + 1);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

/** Build a taste centroid + readable profile from a user's tracks. */
function tasteProfile(tracks) {
  if (!tracks.length) {
    return { vector: { ...features.BASE }, summary: 'Not enough listening data yet', topGenres: [], topArtists: [], count: 0 };
  }
  const vectors = tracks.map((t) => t.features || features.estimate(t));
  const vector = features.centroid(vectors);

  const genreCount = new Map();
  const artistCount = new Map();
  for (const t of tracks) {
    const g = (t.genre || '').trim();
    if (g) genreCount.set(g, (genreCount.get(g) || 0) + 1);
    const a = (t.artist || '').trim();
    if (a) artistCount.set(a, (artistCount.get(a) || 0) + 1);
  }
  const topGenres = [...genreCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, n]) => ({ name, count: n }));
  const topArtists = [...artistCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, n]) => ({ name, count: n }));

  const summary = `Your taste leans ${features.describe(vector)}${
    topGenres.length ? ` with a pull toward ${topGenres[0].name}` : ''
  }.`;

  return { vector, summary, topGenres, topArtists, count: tracks.length };
}

/** Recommendations from a taste centroid, excluding what they already have. */
async function recommend(profile, { limit = 12, exclude = new Set(), seedQueries = [] } = {}) {
  const queries = seedQueries.length ? seedQueries : ['popular hits 2025', 'trending afrobeats', 'indie discoveries'];
  const settled = await Promise.allSettled(queries.slice(0, 5).map((q) => providers.search(q, { limit: 20 })));
  let pool = [];
  for (const r of settled) if (r.status === 'fulfilled') pool = pool.concat(r.value.tracks);

  pool = providers.dedupe(pool).filter((t) => !exclude.has(t.id));
  const scored = pool
    .map((t) => {
      const vec = features.estimate(t);
      const simNorm = features.clamp01((features.similarity(vec, profile.vector) - 0.72) / 0.28);
      let score = simNorm * 0.8;
      if (t.streamUrl || t.previewUrl) score += 0.1;
      score -= qualityPenalty(t);
      return { ...t, features: vec, matchScore: Math.round(features.clamp01(score) * 1000) / 1000 };
    })
    .sort((a, b) => b.matchScore - a.matchScore);

  const out = [];
  const perArtist = new Map();
  for (const t of scored) {
    const k = (t.artist || '').toLowerCase();
    const n = perArtist.get(k) || 0;
    if (n >= 1) continue;
    perArtist.set(k, n + 1);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

module.exports = { parsePrompt, generatePlaylist, similarTo, tasteProfile, recommend, nameFor, describeIntent };
