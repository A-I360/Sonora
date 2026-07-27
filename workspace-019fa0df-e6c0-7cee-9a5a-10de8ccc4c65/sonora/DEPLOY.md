# Running & hosting Sonora

Sonora has **zero dependencies** — no `npm install`, no build step. That makes it unusually easy to host.

---

## 1. Run it on your own computer

**Get the files onto your machine.** Download the `sonora` folder from this workspace (or `git clone` it if you've pushed it somewhere).

**Install Node.js** if you don't have it — [nodejs.org](https://nodejs.org) — version 18 or newer. Check with:

```bash
node -v
```

**Start it:**

```bash
cd sonora
node server.js
```

You'll see:

```
  ♪  Sonora is live
     local:   http://localhost:3000
     catalog: Apple Music, Audius, Deezer
     ai:      Deterministic engine (...)
```

Open **http://localhost:3000**, create an account, and you're in. Data is saved to `sonora/data/`.

Stop it with `Ctrl+C`.

> **Port already in use?** `PORT=3001 node server.js`

---

## 2. Open it on your phone (same Wi‑Fi)

```bash
SONORA_BIND_ALL=1 node server.js
```

The banner now prints a second line:

```
     network: http://192.168.1.42:3000   (open this on your phone)
```

Type that address into your phone's browser. Both devices must be on the same network.

> Some Wi‑Fi networks (hotel, corporate, "client isolation") block device‑to‑device traffic. If it won't connect, use a tunnel (§3).

---

## 3. Share it publicly in 30 seconds (temporary link)

Great for showing someone quickly. Keep `node server.js` running in one terminal, then in a second one:

```bash
npx localtunnel --port 3000
```

You get a public `https://…loca.lt` URL. Alternatives: `cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`.

**Caveat:** the link dies when you close your laptop, and everything runs on your machine. For anything permanent, use §4.

---

## 4. Host it properly (always‑on)

Sonora stores data in **files** (`db.json` + `wal.log`), so the one thing that matters is attaching a **persistent disk**. Without it your database resets on every deploy — most free tiers have ephemeral filesystems.

Config files for the three easiest hosts are already in the repo.

### Render — easiest, has a free tier

`render.yaml` is included.

1. Push the folder to a GitHub repo.
2. On [render.com](https://render.com): **New → Blueprint**, select your repo.
3. Render reads `render.yaml`, provisions a 1 GB disk at `/var/data`, and deploys.

Done — you get `https://sonora-xxxx.onrender.com` with free HTTPS.

> Free instances sleep after ~15 min idle and take ~30s to wake.

### Fly.io — fast, closest region to Lagos (`jnb`)

`fly.toml` is included and already set to Johannesburg.

```bash
fly launch --no-deploy          # accept the existing fly.toml
fly volumes create sonora_data --size 1
fly deploy
```

### Railway

1. Push to GitHub → **New Project → Deploy from GitHub**.
2. Railway auto-detects the `Dockerfile`.
3. Add a **Volume** mounted at `/data`.
4. Set variable `SONORA_DATA_DIR=/data`.

### Any VPS (DigitalOcean, Hetzner, EC2…)

```bash
# on the server
git clone <your-repo> sonora && cd sonora

# keep it running across reboots and crashes
sudo tee /etc/systemd/system/sonora.service > /dev/null <<'EOF'
[Unit]
Description=Sonora
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/sonora
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=SONORA_DATA_DIR=/var/lib/sonora
ExecStart=/usr/bin/node server.js
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo mkdir -p /var/lib/sonora && sudo chown www-data /var/lib/sonora
sudo systemctl enable --now sonora
```

Then put Nginx or Caddy in front for HTTPS. Caddy is two lines:

```
sonora.yourdomain.com {
    reverse_proxy localhost:3000
}
```

### Docker (anywhere)

```bash
docker build -t sonora .
docker run -d -p 3000:3000 -v sonora_data:/data --name sonora sonora
```

---

## 5. Environment variables

Everything is optional — the app runs with real music and working AI with none of them set.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `HOST` | `127.0.0.1` (dev) / `0.0.0.0` (prod) | Bind address |
| `SONORA_BIND_ALL` | – | `1` = listen on all interfaces (phone access) |
| `NODE_ENV` | – | `production` enables `0.0.0.0` binding + `Secure` cookies |
| `SONORA_DATA_DIR` | `./data` | Point at a mounted volume when hosting |
| `SONORA_SECURE_COOKIES` | auto | Force `1`/`0`. Auto-on in production |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | – | Sharpens AI naming; falls back silently |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | – | Activates the Spotify provider |

---

## Before you go public — read this

Sonora is production-*shaped*: hashed passwords, revocable sessions, ownership checks on every write, input validation, an SSRF-guarded audio proxy, and `Secure` cookies over HTTPS. For a personal or demo deployment it's solid.

Three things it deliberately does **not** have, which matter if you're opening it to strangers:

1. **No rate limiting.** Someone can hammer `/api/auth/login` or burn your catalog quota. Put Cloudflare in front, or add a limiter.
2. **No email verification or password reset.** A forgotten password means a lost account.
3. **The file store is single-node.** Perfect to a few thousand users on one machine; it does not shard across instances. If you scale horizontally, move to Postgres — `src/server/store.js` is a narrow interface (`get/insert/update/remove/find`), so swapping it is contained.

**On the music:** streaming previews from Apple/Deezer and full tracks from Audius is fine for personal and demo use — these are public endpoints. A commercial product needs licensing deals; that's a legal matter, not a technical one.

---

## Troubleshooting

**"command not found: node"** — Node isn't installed. Get it from [nodejs.org](https://nodejs.org).

**"Port 3000 is already in use"** — `PORT=3001 node server.js`

**No music / empty search** — the app needs internet access to reach the catalogs. Check with:
```bash
curl "https://itunes.apple.com/search?term=test&limit=1"
```

**Audio won't play in Chromium on Linux** — some builds ship without AAC. Sonora detects this and auto-swaps to an MP3 source; if a specific track still fails it will skip to the next one.

**Logged out on every deploy** — your data directory isn't persistent. Attach a volume and set `SONORA_DATA_DIR`.
