'use strict';
/**
 * Audio-feature estimation.
 *
 * Real feature APIs (Spotify's /audio-features) are deprecated for new apps,
 * so Sonora derives a stable 5-D vector from signals we DO have: genre text,
 * title/album keywords, duration, release year, explicitness. Deterministic —
 * the same track always lands on the same point, which keeps recommendations
 * and "similar tracks" reproducible.
 */

const { MOODS, GENRES } = require('./lexicon');

const DIMS = ['energy', 'valence', 'danceability', 'acousticness', 'tempo'];

const BASE = { energy: 0.55, valence: 0.55, danceability: 0.55, acousticness: 0.35, tempo: 0.5 };

// keyword → feature nudges applied from track titles
const TITLE_SIGNALS = [
  { re: /\b(remix|club mix|extended mix|vip mix)\b/i, d: { energy: 0.12, danceability: 0.15, tempo: 0.1, acousticness: -0.12 } },
  { re: /\b(acoustic|unplugged|stripped|piano version)\b/i, d: { acousticness: 0.35, energy: -0.25, danceability: -0.2, tempo: -0.12 } },
  { re: /\b(live|live at|live from|session)\b/i, d: { acousticness: 0.1, energy: 0.05 } },
  { re: /\b(slowed|reverb|screwed)\b/i, d: { energy: -0.2, tempo: -0.2, valence: -0.1 } },
  { re: /\b(love|heart|baby|kiss|romance)\b/i, d: { valence: 0.1, acousticness: 0.05 } },
  { re: /\b(cry|tears|pain|hurt|broken|alone|lonely|sorry|goodbye|die|death)\b/i, d: { valence: -0.28, energy: -0.1 } },
  { re: /\b(happy|sunshine|smile|celebrate|good time|joy|party|dance)\b/i, d: { valence: 0.25, energy: 0.12, danceability: 0.15 } },
  { re: /\b(dark|shadow|night|midnight|ghost|demon|hell)\b/i, d: { valence: -0.2, energy: 0.05 } },
  { re: /\b(instrumental|beat|type beat|loop)\b/i, d: { energy: -0.05, valence: -0.02 } },
  { re: /\b(ambient|meditation|sleep|calm|peaceful|relax|spa)\b/i, d: { energy: -0.35, acousticness: 0.35, danceability: -0.3, tempo: -0.3 } },
  { re: /\b(freestyle|cypher|drill|trap)\b/i, d: { energy: 0.18, danceability: 0.1, acousticness: -0.15 } },
];

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function matchLexicon(text) {
  const t = ` ${String(text || '').toLowerCase()} `;
  const hits = [];
  for (const [name, entry] of Object.entries(GENRES)) {
    for (const a of entry.aliases) {
      if (t.includes(` ${a} `) || t.includes(`${a}`)) {
        hits.push({ kind: 'genre', name, features: entry.features });
        break;
      }
    }
  }
  for (const [name, entry] of Object.entries(MOODS)) {
    for (const a of entry.aliases) {
      if (t.includes(a)) {
        hits.push({ kind: 'mood', name, features: entry.features });
        break;
      }
    }
  }
  return hits;
}

/** Deterministic per-track jitter so identical genres don't collapse to one point. */
function hashJitter(seed, dim) {
  let h = 2166136261;
  const s = `${seed}:${dim}`;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (((h >>> 0) % 1000) / 1000 - 0.5) * 0.12; // ±0.06
}

function estimate(track) {
  if (!track) return { ...BASE };
  const vec = { ...BASE };

  // 1. genre string from the provider carries the most signal
  const genreHits = matchLexicon(track.genre || '');
  for (const hit of genreHits) {
    for (const d of DIMS) vec[d] = vec[d] * 0.35 + hit.features[d] * 0.65;
  }

  // 2. title + album keywords
  const text = `${track.title || ''} ${track.album || ''}`;
  for (const sig of TITLE_SIGNALS) {
    if (sig.re.test(text)) {
      for (const [d, delta] of Object.entries(sig.d)) vec[d] = clamp01(vec[d] + delta);
    }
  }
  const textHits = matchLexicon(text);
  for (const hit of textHits) {
    for (const d of DIMS) vec[d] = vec[d] * 0.7 + hit.features[d] * 0.3;
  }

  // 3. duration — very short = interlude/high-intensity, very long = ambient/jam
  const mins = (track.durationMs || 0) / 60000;
  if (mins > 0) {
    if (mins < 2) vec.energy = clamp01(vec.energy + 0.05);
    if (mins > 6) {
      vec.energy = clamp01(vec.energy - 0.12);
      vec.acousticness = clamp01(vec.acousticness + 0.1);
      vec.tempo = clamp01(vec.tempo - 0.08);
    }
  }

  // 4. era drift — production energy has trended up over the decades
  if (track.year) {
    if (track.year < 1970) {
      vec.acousticness = clamp01(vec.acousticness + 0.2);
      vec.energy = clamp01(vec.energy - 0.12);
    } else if (track.year < 1990) {
      vec.acousticness = clamp01(vec.acousticness + 0.1);
    } else if (track.year >= 2015) {
      vec.energy = clamp01(vec.energy + 0.05);
      vec.acousticness = clamp01(vec.acousticness - 0.05);
    }
  }

  // 5. explicit content skews aggressive
  if (track.explicit) {
    vec.energy = clamp01(vec.energy + 0.08);
    vec.valence = clamp01(vec.valence - 0.05);
  }

  const seed = track.id || `${track.title}:${track.artist}`;
  for (const d of DIMS) vec[d] = clamp01(vec[d] + hashJitter(seed, d));
  for (const d of DIMS) vec[d] = Math.round(vec[d] * 1000) / 1000;
  return vec;
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const d of DIMS) {
    dot += a[d] * b[d];
    na += a[d] * a[d];
    nb += b[d] * b[d];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function euclidean(a, b) {
  let sum = 0;
  for (const d of DIMS) sum += (a[d] - b[d]) ** 2;
  return Math.sqrt(sum);
}

/** Blended similarity: cosine catches direction, euclidean catches magnitude. */
function similarity(a, b) {
  const cos = cosine(a, b);
  const dist = euclidean(a, b) / Math.sqrt(DIMS.length);
  return Math.round((cos * 0.55 + (1 - dist) * 0.45) * 1000) / 1000;
}

function centroid(vectors) {
  if (!vectors.length) return { ...BASE };
  const out = {};
  for (const d of DIMS) {
    out[d] = Math.round((vectors.reduce((s, v) => s + (v[d] ?? BASE[d]), 0) / vectors.length) * 1000) / 1000;
  }
  return out;
}

function describe(vec) {
  const parts = [];
  parts.push(vec.energy > 0.7 ? 'high-energy' : vec.energy < 0.35 ? 'low-key' : 'mid-tempo');
  parts.push(vec.valence > 0.7 ? 'bright' : vec.valence < 0.35 ? 'melancholic' : 'balanced');
  if (vec.danceability > 0.75) parts.push('very danceable');
  if (vec.acousticness > 0.65) parts.push('acoustic-leaning');
  if (vec.acousticness < 0.15) parts.push('produced');
  return parts.join(', ');
}

module.exports = { DIMS, BASE, estimate, similarity, cosine, euclidean, centroid, describe, clamp01, matchLexicon };
