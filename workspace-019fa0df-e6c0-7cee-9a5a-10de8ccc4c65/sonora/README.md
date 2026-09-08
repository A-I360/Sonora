# ♪ Sonora

**AI-powered music discovery, player and sharing app.** Real music from Apple Music, Deezer and Audius — no API keys, no `npm install`, no build step.

```bash
cd sonora
node server.js       # → http://localhost:3000
```

That's it. Node 18+ is the only requirement.

**Want it on your phone, or hosted online? → see [DEPLOY.md](DEPLOY.md)** (Render, Fly.io, Railway, Docker, VPS — config files included)

---

## What it actually does

| | |
|---|---|
| **Real catalog** | Millions of tracks via Apple Music (iTunes), Deezer and Audius. Real cover art, real audio — 30s previews plus **full-length** streams from Audius. Plus a built-in, network-free **Sonora Sampler** catalog (generated cover art + audio) that always fills the grid even when the live APIs are unreachable. |
| **AI playlists** | Type *"rainy night drive, moody afrobeats"* → get 20 scored, deduplicated, artist-diverse tracks with a title and description. |
| **Auth** | Email + password, scrypt hashing, revocable server-side sessions in HttpOnly cookies. |
| **CRUD** | Playlists (+ track membership + drag reorder), library, posts, comments, likes, profile — all with validation and ownership checks. |
| **Persistence** | Crash-safe write-ahead log + atomic snapshots. Survives `kill -9`. |
| **UI** | Glassmorphism over an animated aurora field, empty/loading/error states everywhere, optimistic updates with rollback, responsive to 390px. |

---

## The AI, honestly

Sonora's AI is **real and works with zero API keys**. It is not an LLM wrapper — it's a deterministic recommendation engine:

1. **Intent parsing** — extracts moods, genres, decades and artist references from free text (`"90s r&b slow jams for a date night"` → `moods:[romantic, nostalgic]`, `genres:[rnb]`, `decade:1990-1999`).
2. **Feature estimation** — every track gets a 5-D vector (energy, valence, danceability, acousticness, tempo) derived from genre, title keywords, duration, era and explicitness. Deterministic, so results are reproducible.
3. **Scoring** — blends *query provenance* (which query found it, and at what rank) with *cosine + euclidean similarity* to the target vector, then boosts playable sources and penalises catalog noise (`"Drake Type Beat"`, ripped YouTube uploads).
4. **Diversity constraint** — max 2 tracks per artist, so you get a playlist and not an album.

> **Optional upgrade:** drop `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` into `.env` and the LLM refines intent and naming first. Every failure path falls back to the deterministic engine, so it never breaks.

---

## Spotify connector — import & download playlists offline

Sonora ships a **Spotify connector** (not just search). From the **Spotify** page in the sidebar (or *Profile → Spotify connector*) you can:

1. **Connect** your Spotify account (real OAuth, or a simulated "demo" mode when no credentials are set).
2. **Browse** your playlists.
3. **Download an entire playlist** — Sonora fetches a playable source for every track and caches it on disk (`data/audio/`).
4. **Listen offline** — cached tracks are served straight from disk via `/api/stream`, so playback works with no network connection.

```env
SPOTIFY_CLIENT_ID=xxx
SPOTIFY_CLIENT_SECRET=xxx
SPOTIFY_REDIRECT_URI=https://your-host/api/spotify/callback
```

- **Real mode** — set the three vars above (and expose the callback URL to Spotify). Connect uses the standard OAuth 2.0 authorization-code flow.
- **Demo / simulated mode** — set `SPOTIFY_DEMO=1`, or leave the vars unset. Sonora simulates a connected Spotify account whose playlists come from the built-in Sonora Sampler catalog, so the whole connect → import → download → offline-playback flow is testable with zero network.

Two things worth knowing, because no app can work around them:

- **Spotify deprecated `preview_url`** for new apps (Nov 2024). Its search results are metadata-rich but usually silent — Sonora resolves a playable source from the key-free providers, and the downloader does the same when caching a playlist.
- **True in-app Spotify *streaming*** requires the Web Playback SDK, user OAuth *and* a Premium account. Sonora's connector doesn't stream from Spotify's SDK; it downloads playable audio from the provider that actually has it and keeps it offline. The OAuth scaffold lives in `providers/spotify.js`.

**Boomplay** has no public API. Adding it means implementing `search()` + `lookup()` returning the normalized track shape and registering it — roughly 60 lines, same as `deezer.js`.

---

## Architecture

```
server.js                  entry: static files, routing, audio proxy, .env loader
src/server/
  store.js                 WAL + atomic snapshot persistence, table API
  http.js                  router, body parsing, cookies, validation
  auth.js                  scrypt hashing, sessions, ownership
  api.js                   all REST endpoints
  fetchx.js                fetch with timeout, retry, TTL cache
  providers/               itunes · audius · deezer · spotify · demo (pluggable, network-free sampler)
  spotify.js               Spotify connector — user OAuth, playlist import, offline download
  audioCache.js            disk cache for downloaded-for-offline audio (data/audio/)
  ai/
    lexicon.js             mood + genre → feature vectors and search queries
    features.js            5-D estimation, cosine/euclidean similarity
    engine.js              intent parsing, generation, recommendations
    llm.js                 optional OpenAI/Anthropic refinement
public/
  index.html  css/app.css
  js/  core.js · player.js · components.js · icons.js · app.js
       views/  home · search · ai · playlists · library · feed · profile · player-bar · spotify
data/                      db.json + wal.log + audio/ (created on first run)
```

**Zero dependencies** — no Express, no React, no bundler. `node_modules` is never needed, so the app can't rot.

### Why a custom store instead of SQLite?
`node:sqlite` requires Node 22+; this targets Node 18+. The store gives real durability guarantees: every mutation is `fs.writeSync`'d to an append-only log, compacted into an atomically-renamed snapshot. Verified against `kill -9`.

---

## Notable implementation details

**Apple's `audio/x-m4p` MIME.** iTunes serves previews with a DRM-era content type that Chromium and Safari refuse (`canPlayType()` returns `""`, MediaError 4) even though the bytes are ordinary AAC. The proxy relabels it to `audio/mp4`.

**Browsers without AAC.** Chromium builds compiled without proprietary codecs (common on Linux) can't decode Apple previews at all. The player detects this up front and transparently re-resolves the track to an MP3 source from another provider — the listener just hears music.

**Audio proxy.** `/api/stream` follows Audius' CDN redirects, adds CORS, forwards `Range` headers (so seeking works, verified `206 Partial Content`), and allowlists hosts to prevent SSRF.

**Optimistic updates.** `optimistic({ apply, rollback, commit })` in `core.js` — likes, saves, comments, reorders and deletes all repaint instantly and roll back with a shake animation on failure.

---

## Testing

```bash
bash test/e2e.sh          # 42 API assertions — CRUD, auth, ownership, validation
node test/ui.mjs          # 27 browser assertions (needs Playwright chromium)
```

Both suites pass fully, with no JS console errors:

```
PASS=42 FAIL=0     (API)
PASS=27 FAIL=0     (UI — includes real audio playback assertions)
```

The UI suite drives a real Chromium: registers a user, plays audio and asserts `currentTime` actually advances, exercises every CRUD flow, generates an AI playlist, posts and comments, and checks the mobile drawer.

---

## Keyboard shortcuts

`Space` play/pause · `←`/`→` seek 5s · `Shift+←`/`→` prev/next · `↑`/`↓` volume · `M` mute · `S` shuffle · `R` repeat

---

## Configuration

All optional — copy `.env.example` to `.env`:

```env
PORT=3000
OPENAI_API_KEY=          # or ANTHROPIC_API_KEY — sharpens AI naming
SPOTIFY_CLIENT_ID=       # activates the Spotify provider
SPOTIFY_CLIENT_SECRET=
SONORA_DISABLE_ITUNES=   # set to 1 to turn a provider off
```
