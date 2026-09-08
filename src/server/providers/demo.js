'use strict';
/**
 * Sonora Sampler — an offline, always-available demo catalog.
 *
 * The live catalogs (Apple Music, Audius, Deezer) are great but need outbound
 * network, which some dev boxes, CI sandboxes and air-gapped previews do not
 * have. This provider is registered alongside them and ALWAYS participates, so
 * search/browse/AI keep returning real, playable tracks even when the network
 * is down. It serves:
 *
 *   • a curated catalog of real songs (artists/albums/year/genre)
 *   • deterministic SVG cover art   via  GET /api/demo/art/:slug
 *   • generated, seeking-enabled audio via the /api/stream proxy
 *        streamUrl = "sonora://demo/:slug"
 *
 * Nothing here talks to the network — it cannot rot.
 */

const key = 'demo';
const label = 'Sonora Sampler';
const playback = 'full';
const DEMO_SECONDS = 40; // must match the rendered audio length below

function isEnabled() {
  return process.env.SONORA_DISABLE_DEMO !== '1';
}

function note() {
  return 'Built-in offline catalog — always available, real covers, full-length generated audio';
}

/* ----------------------------------------------------------- catalog */

// genre uses the lexicon keys (features.estimate understands them): afrobeats,
// hiphop, rnb, pop, electronic, latin, reggae, jazz, country, rock, gospel...
const CATALOG = [
  // Afrobeats
  { slug: 'burna-boy-last-last', title: 'Last Last', artist: 'Burna Boy', album: 'Love, Damini', genre: 'afrobeats', year: 2022, explicit: true, rank: 96, tags: ['afrobeats', 'afro', 'naija', 'hit'] },
  { slug: 'wizkid-essence', title: 'Essence', artist: 'Wizkid', album: 'Made in Lagos', genre: 'afrobeats', year: 2020, explicit: false, rank: 95, tags: ['afrobeats', 'afro', 'naija', 'summer'] },
  { slug: 'tems-free-mind', title: 'Free Mind', artist: 'Tems', album: 'If Orange Was a Place', genre: 'afrobeats', year: 2021, explicit: false, rank: 90, tags: ['afrobeats', 'r&b', 'chill', 'moody'] },
  { slug: 'rema-calm-down', title: 'Calm Down', artist: 'Rema', album: 'Rave & Roses', genre: 'afrobeats', year: 2022, explicit: false, rank: 93, tags: ['afrobeats', 'afro', 'naija', 'hit'] },
  { slug: 'davido-unavailable', title: 'Unavailable', artist: 'Davido', album: 'Timeless', genre: 'afrobeats', year: 2023, explicit: false, rank: 88, tags: ['afrobeats', 'afro', 'naija'] },
  { slug: 'ayra-starr-rush', title: 'Rush', artist: 'Ayra Starr', album: '19 & Dangerous', genre: 'afrobeats', year: 2021, explicit: false, rank: 86, tags: ['afrobeats', 'afro', 'pop', 'naija'] },
  { slug: 'ckay-love-nwantiti', title: 'Love Nwantiti', artist: 'CKay', album: 'CKay the First', genre: 'afrobeats', year: 2019, explicit: false, rank: 82, tags: ['afrobeats', 'afro', 'naija', 'viral'] },
  { slug: 'fireboy-peru', title: 'Peru', artist: 'Fireboy DML', album: 'Playboy', genre: 'afrobeats', year: 2022, explicit: false, rank: 84, tags: ['afrobeats', 'afro', 'naija'] },
  { slug: 'asake-terminator', title: 'Terminator', artist: 'Asake', album: 'Mr. Money With The Vibe', genre: 'afrobeats', year: 2022, explicit: true, rank: 83, tags: ['afrobeats', 'afro', 'naija'] },
  { slug: 'omah-lay-soso', title: 'Soso', artist: 'Omah Lay', album: 'Boy Alone', genre: 'afrobeats', year: 2022, explicit: false, rank: 80, tags: ['afrobeats', 'afro', 'r&b', 'moody'] },

  // Amapiano (the lexicon treats amapiano as an afrobeats alias)
  { slug: 'kabza-sponono', title: 'Sponono', artist: 'Kabza De Small', album: 'Piano Republic', genre: 'afrobeats', year: 2020, explicit: false, rank: 78, tags: ['amapiano', 'afro', 'house', 'south african', 'dance'] },
  { slug: 'focalistic-ke-star', title: 'Ke Star', artist: 'Focalistic', album: 'Ke Star', genre: 'afrobeats', year: 2021, explicit: false, rank: 76, tags: ['amapiano', 'afro', 'dance', 'hit'] },
  { slug: 'major-league-piano-mapula', title: 'Piano Mapula', artist: 'Major League DJz', album: 'Piano Land', genre: 'afrobeats', year: 2020, explicit: false, rank: 72, tags: ['amapiano', 'afro', 'dance', 'party'] },
  { slug: 'sha-sha-tender', title: 'Tender', artist: 'Sha Sha', album: 'Blossom', genre: 'afrobeats', year: 2020, explicit: false, rank: 74, tags: ['amapiano', 'afro', 'soul', 'chill'] },
  { slug: 'victony-soweto', title: 'Soweto', artist: 'Victony', album: 'Outlaw', genre: 'afrobeats', year: 2022, explicit: false, rank: 81, tags: ['amapiano', 'afro', 'naija', 'dance'] },

  // Hip-hop / rap
  { slug: 'kendrick-humble', title: 'HUMBLE.', artist: 'Kendrick Lamar', album: 'DAMN.', genre: 'hiphop', year: 2017, explicit: true, rank: 92, tags: ['hip hop', 'rap', 'hit'] },
  { slug: 'drake-gods-plan', title: "God's Plan", artist: 'Drake', album: 'Scorpion', genre: 'hiphop', year: 2018, explicit: true, rank: 91, tags: ['hip hop', 'rap', 'pop'] },
  { slug: 'jcole-no-role-modelz', title: 'No Role Modelz', artist: 'J. Cole', album: '2014 Forest Hills Drive', genre: 'hiphop', year: 2014, explicit: true, rank: 89, tags: ['hip hop', 'rap', 'r&b'] },
  { slug: 'kanye-stronger', title: 'Stronger', artist: 'Kanye West', album: 'Graduation', genre: 'hiphop', year: 2007, explicit: true, rank: 79, tags: ['hip hop', 'rap', 'electronic', '2000s'] },
  { slug: 'asap-rocky-praise-the-lord', title: 'Praise The Lord', artist: 'A$AP Rocky', album: 'Testing', genre: 'hiphop', year: 2018, explicit: true, rank: 77, tags: ['hip hop', 'rap', 'trap'] },

  // R&B / soul
  { slug: 'sza-kill-bill', title: 'Kill Bill', artist: 'SZA', album: 'SOS', genre: 'rnb', year: 2022, explicit: true, rank: 87, tags: ['r&b', 'soul', 'moody', 'hit'] },
  { slug: 'the-weeknd-blinding-lights', title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', genre: 'rnb', year: 2019, explicit: false, rank: 94, tags: ['r&b', 'pop', 'synth', 'hit'] },
  { slug: 'her-damage', title: 'Damage', artist: 'H.E.R.', album: 'Back of My Mind', genre: 'rnb', year: 2021, explicit: true, rank: 73, tags: ['r&b', 'soul', 'chill'] },
  { slug: 'frank-ocean-pink-white', title: 'Pink + White', artist: 'Frank Ocean', album: 'Blonde', genre: 'rnb', year: 2016, explicit: false, rank: 85, tags: ['r&b', 'soul', 'chill', 'moody'] },

  // Pop
  { slug: 'dua-lipa-levitating', title: 'Levitating', artist: 'Dua Lipa', album: 'Future Nostalgia', genre: 'pop', year: 2020, explicit: false, rank: 90, tags: ['pop', 'dance', 'party', 'hit'] },
  { slug: 'olivia-rodrigo-drivers-license', title: 'drivers license', artist: 'Olivia Rodrigo', album: 'SOUR', genre: 'pop', year: 2021, explicit: false, rank: 83, tags: ['pop', 'sad', 'emotional'] },
  { slug: 'harry-styles-as-it-was', title: 'As It Was', artist: 'Harry Styles', album: "Harry's House", genre: 'pop', year: 2022, explicit: false, rank: 88, tags: ['pop', 'hit'] },

  // Electronic / lo-fi
  { slug: 'nujabes-feather', title: 'Feather', artist: 'Nujabes', album: 'Modal Soul', genre: 'electronic', year: 2005, explicit: false, rank: 75, tags: ['lofi', 'lo-fi', 'chill', 'instrumental', 'study', 'focus'] },
  { slug: 'jdilla-time-donut', title: 'Time: The Donut of the Heart', artist: 'J Dilla', album: 'Donuts', genre: 'electronic', year: 2006, explicit: false, rank: 71, tags: ['lofi', 'instrumental', 'beats', 'chill'] },
  { slug: 'kina-can-we-kiss-forever', title: 'Can We Kiss Forever?', artist: 'Kina', album: 'Can We Kiss Forever?', genre: 'electronic', year: 2019, explicit: false, rank: 69, tags: ['chill', 'electronic', 'sad', 'moody'] },

  // Latin / regaetón
  { slug: 'bad-bunny-titi', title: 'Tití Me Preguntó', artist: 'Bad Bunny', album: 'Un Verano Sin Ti', genre: 'latin', year: 2022, explicit: true, rank: 86, tags: ['latin', 'reggaeton', 'dance', 'party'] },

  // Throwback (90s)
  { slug: 'lauryn-hill-doo-wop', title: 'Doo Wop (That Thing)', artist: 'Lauryn Hill', album: 'The Miseducation of Lauryn Hill', genre: 'rnb', year: 1998, explicit: true, rank: 78, tags: ['90s', 'throwback', 'soul', 'hip hop', 'classic'] },
  { slug: 'aaliyah-try-again', title: 'Try Again', artist: 'Aaliyah', album: 'Aaliyah', genre: 'rnb', year: 2000, explicit: false, rank: 76, tags: ['2000s', 'throwback', 'r&b', 'classic'] },
  { slug: 'tupac-california-love', title: 'California Love', artist: '2Pac', album: 'All Eyez on Me', genre: 'hiphop', year: 1996, explicit: true, rank: 74, tags: ['90s', 'throwback', 'hip hop', 'rap', 'classic'] },
];

const BY_ID = new Map();
for (const c of CATALOG) BY_ID.set(c.slug, c);

// The searchable text a track is matched against (lowercased once).
function hay(c) {
  return `${c.title} ${c.artist} ${c.album} ${c.genre} ${c.year} ${c.tags.join(' ')}`.toLowerCase();
}

const HAYS = new Map(CATALOG.map((c) => [c.slug, hay(c)]));

/* ------------------------------------------------------------- artwork */

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic, self-contained SVG cover (no network, no binary assets). */
function coverSvg(slug) {
  const c = BY_ID.get(slug) || { title: 'Sonora', artist: 'Sampler' };
  const h1 = hash(`${slug}:h1`) % 360;
  const h2 = (h1 + 46) % 360;
  const initials = (c.title || '?')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 2)
    .toUpperCase();
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${h1},72%,54%)"/>` +
    `<stop offset="1" stop-color="hsl(${h2},70%,42%)"/></linearGradient></defs>` +
    `<rect width="600" height="600" fill="url(#g)"/>` +
    `<circle cx="470" cy="130" r="210" fill="rgba(255,255,255,0.10)"/>` +
    `<circle cx="120" cy="520" r="260" fill="rgba(0,0,0,0.12)"/>` +
    `<text x="50" y="430" font-family="Inter,system-ui,sans-serif" font-size="230" font-weight="800" fill="rgba(255,255,255,0.92)" letter-spacing="-6">${initials}</text>` +
    `<text x="54" y="548" font-family="Inter,system-ui,sans-serif" font-size="34" font-weight="600" fill="rgba(255,255,255,0.85)">${c.title.slice(0, 34)}</text>` +
    `</svg>`;
  return Buffer.from(svg, 'utf8');
}

function serveArt(req, res, seed) {
  const slug = String(seed || '').replace(/[^a-z0-9-]/gi, '').toLowerCase();
  if (!slug || !BY_ID.has(slug)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    return;
  }
  const buf = coverSvg(slug);
  res.writeHead(200, {
    'Content-Type': 'image/svg+xml',
    'Content-Length': String(buf.length),
    'Cache-Control': 'public, max-age=86400',
  });
  res.end(buf);
}

/* -------------------------------------------------------------- audio */

// Frequencies (Hz) for a gentle minor-pentatonic generator. We render a short
// synth loop so the player has real, seeking-enabled audio that "just works"
// on every browser (WAV + PCM = universally decodable).
const SR = 16000;
const PENTA = [0, 3, 5, 7, 10]; // minor pentatonic semitone offsets
const ROOTS = [110.0, 130.81, 146.83, 164.81, 196.0]; // A2, C3, D3, E3, G3
const CHORD_PROG = [0, 5, 3, 4]; // scale degrees: i, VI, iv, v
const ARP_PATTERN = [0, 2, 4, 2]; // arpeggio over the triad

function freqAt(root, step) {
  // step can go above one octave; fold into the pentatonic ladder
  const octaves = Math.floor(step / PENTA.length);
  const idx = ((step % PENTA.length) + PENTA.length) % PENTA.length;
  return root * Math.pow(2, (PENTA[idx] + 12 * octaves) / 12);
}

const audioCache = new Map();
const AUDIO_CACHE_MAX = 16;

function renderAudio(slug) {
  const cached = audioCache.get(slug);
  if (cached) return cached;

  const root = ROOTS[hash(slug) % ROOTS.length];
  const total = SR * DEMO_SECONDS;
  const chordSec = DEMO_SECONDS / CHORD_PROG.length;
  const noteSec = 0.34; // relaxed eighth note
  const samples = new Float32Array(total);

  // Precompute every frequency so the per-sample loop does pure arithmetic
  // (no Math.pow, no Math.floor of scale folds) — this keeps first render fast.
  const padFreqs = CHORD_PROG.map((base) => [0, 2, 4].map((dv) => freqAt(root, base + dv)));
  const subFreq = root / 2;
  const arpFreqs = [];
  for (const base of CHORD_PROG) for (const d of ARP_PATTERN) arpFreqs.push(freqAt(root, base + d));
  const two = 2 * Math.PI;
  const arpCount = ARP_PATTERN.length;

  for (let i = 0; i < total; i += 1) {
    const t = i / SR;
    const chordIdx = Math.floor(t / chordSec) % CHORD_PROG.length;
    const pad = padFreqs[chordIdx];

    // soft pad: triad (root, minor third, fifth) + warm sub bass
    let v =
      0.07 * (Math.sin(two * pad[0] * t) + Math.sin(two * pad[1] * t) + Math.sin(two * pad[2] * t)) +
      0.1 * Math.sin(two * subFreq * t);

    // plucked arpeggio eighth notes across the triad, with a quick decay
    const step = Math.floor(t / noteSec);
    const f = arpFreqs[chordIdx * arpCount + (step % arpCount)];
    const nt = t - step * noteSec;
    const env = Math.exp(-nt * 5.5) * Math.min(1, nt / 0.012); // attack + decay
    v += 0.32 * env * (Math.sin(two * f * t) + 0.4 * Math.sin(two * f * 2 * t));

    // gentle overall fade in/out so the ends don't click
    const fadeIn = Math.min(1, t / 0.3);
    const fadeOut = Math.min(1, (DEMO_SECONDS - t) / 0.5);
    samples[i] = Math.tanh(v * 1.15) * 0.62 * fadeIn * fadeOut;
  }

  const buf = toWav(samples);
  if (audioCache.size >= AUDIO_CACHE_MAX) {
    const firstKey = audioCache.keys().next().value;
    audioCache.delete(firstKey);
  }
  audioCache.set(slug, buf);
  return buf;
}

function toWav(samples) {
  const dataSize = samples.length * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buf;
}

/** Stream a demo track's generated audio with Range support (seeking works). */
function serveAudio(req, res, slug) {
  const safe = String(slug || '').replace(/[^a-z0-9-]/gi, '').toLowerCase();
  if (!safe || !BY_ID.has(safe)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    return;
  }
  const buf = renderAudio(safe);
  const total = buf.length;
  const range = req.headers.range;
  let start = 0;
  let end = total - 1;
  let status = 200;

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      if (m[1]) start = Number(m[1]);
      if (m[2]) end = Number(m[2]);
      if (start > end) start = 0;
      if (start >= total) {
        res.writeHead(416, {
          'Content-Range': `bytes */${total}`,
          'Content-Type': 'audio/wav',
        });
        return res.end();
      }
      if (end >= total) end = total - 1;
      status = 206;
    }
  }

  const chunk = buf.subarray(start, end + 1);
  const headers = {
    'Content-Type': 'audio/wav',
    'Accept-Ranges': 'bytes',
    'Content-Length': String(chunk.length),
    'Cache-Control': 'public, max-age=3600',
    'Access-Control-Allow-Origin': '*',
  };
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${total}`;
  res.writeHead(status, headers);
  res.end(chunk);
}

/* ----------------------------------------------------------- normalize */

function normalize(c) {
  return {
    id: `demo:${c.slug}`,
    provider: key,
    providerId: c.slug,
    title: c.title,
    artist: c.artist,
    album: c.album,
    artwork: `/api/demo/art/${c.slug}`,
    artworkSmall: `/api/demo/art/${c.slug}`,
    previewUrl: null,
    streamUrl: `sonora://demo/${c.slug}`,
    durationMs: DEMO_SECONDS * 1000,
    genre: c.genre,
    year: c.year,
    externalUrl: null,
    explicit: Boolean(c.explicit),
  };
}

/* -------------------------------------------------------------- search */

const DECADE_RE = /\b(19|20)?\s?(\d{2})0s\b|\b(19\d{2}|20\d{2})\b/g;
const MOOD_WORDS = 'late night,night,chill,mellow,moody,sad,romantic,party,dance,focus,study,work,drive,road,hype,workout,gym,sleep,calm,happy,throwback,nostalgic,classic,retro';

function tokenize(q) {
  return String(q || '')
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9&\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !['the', 'and', 'for', 'with', 'a', 'an', 'of', 'to', 'hits', 'top', 'songs', 'music', 'mix', 'playlist', 'me'].includes(t));
}

function scoreTrack(c, tokens, query) {
  const hay = HAYS.get(c.slug);
  const q = query.toLowerCase();
  let score = 0;

  // exact-ish title / artist wins
  if (hay.includes(` ${c.title.toLowerCase()} `) && q.includes(c.title.toLowerCase())) score += 22;
  if (hay.includes(` ${c.artist.toLowerCase()} `) && q.includes(c.artist.toLowerCase())) score += 18;

  for (const tk of tokens) {
    if (c.title.toLowerCase().includes(tk)) score += 12;
    if (c.artist.toLowerCase().includes(tk)) score += 10;
    if (c.tags.some((t) => t.includes(tk) || tk.includes(t))) score += 7;
    if (c.album.toLowerCase().includes(tk)) score += 4;
    if (c.genre.toLowerCase().includes(tk)) score += 6;
  }

  // decade handling: "90s", "1990s", "2000", "2010s"
  const ym = DECADE_RE.exec(q);
  if (ym) {
    let year = null;
    if (/^\d{4}$/.test(ym[2] || ym[0])) year = Number(ym[2] || ym[0]);
    else {
      const dec = ((ym[2] || '') + (ym[1] || '')).match(/\d{2}0s|\d{2}$/);
      if (dec) {
        const base = Number(String(dec[0]).replace('0s', '').replace(/\D/g, ''));
        year = base * 10; // e.g. 90 -> 900 -> *? ; handle below
      }
    }
    // normalize decade detection
    const decMatch = /(\d{2})0s/.exec(q);
    if (decMatch) {
      const base = Number(decMatch[1]);
      const from = base * 100 + (base < 30 ? 1900 : 2000);
      if (c.year >= from && c.year < from + 10) score += 20;
    } else if (/20\d2|\b(\d{4})\b/.test(q)) {
      const yrMatch = q.match(/\b\d{4}\b/);
      if (yrMatch && Number(yrMatch[0]) === c.year) score += 20;
    } else if (/90|2000|00s/.test(q) && c.year >= 1990 && c.year < 2000) {
      score += 20;
    }
  }

  // mood keywords
  for (const w of MOOD_WORDS.split(',')) {
    if (q.includes(w) && (c.tags.some((t) => t === w))) {
      score += 8;
    }
  }

  if (q.includes('lofi') || q.includes('lo-fi')) {
    if (c.tags.includes('lofi') || c.tags.includes('lo-fi')) score += 16;
  }
  if (q.includes('amapiano') && c.tags.includes('amapiano')) score += 22;
  if (q.includes('afro') && c.tags.includes('afro')) score += 18;

  return score;
}

async function search(query, limit = 24) {
  const lim = Math.max(1, Math.min(Number(limit) || 24, 50));
  const q = String(query || '').trim();
  if (!q) return [];

  const tokens = tokenize(q);
  const scored = CATALOG.map((c) => ({ c, score: scoreTrack(c, tokens, q) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || b.c.rank - a.c.rank);

  // always fill the grid: matches first, then the most popular picks
  const out = [];
  const seen = new Set();
  for (const s of scored) {
    if (seen.has(s.c.slug)) continue;
    seen.add(s.c.slug);
    out.push(normalize(s.c));
    if (out.length >= lim) break;
  }
  if (out.length < lim) {
    const byRank = [...CATALOG].sort((a, b) => b.rank - a.rank);
    for (const c of byRank) {
      if (seen.has(c.slug)) continue;
      seen.add(c.slug);
      out.push(normalize(c));
      if (out.length >= lim) break;
    }
  }
  return out;
}

function lookup(providerId) {
  const c = BY_ID.get(String(providerId || '').replace(/^demo:/, ''));
  return c ? normalize(c) : null;
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
  serveArt,
  serveAudio,
  catalog: CATALOG,
};
