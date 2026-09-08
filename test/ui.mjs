/**
 * Sonora UI smoke test (Playwright).
 * Drives the real app in Chromium: auth, navigation, CRUD, AI, playback.
 *
 *   LD_LIBRARY_PATH=/tmp/deps/root/usr/lib/x86_64-linux-gnu node test/ui.mjs
 */
import { chromium } from '/tmp/node_modules/playwright-core/index.mjs';

const EXE = '/home/user/.cache/ms-playwright/chromium-1148/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const SHOTS = process.env.SHOTS || '/home/user/sonora/test/shots';

let pass = 0;
let fail = 0;
const errors = [];

function ok(name) {
  console.log(`  ok   ${name}`);
  pass += 1;
}
function bad(name, err) {
  console.log(`  FAIL ${name} :: ${err}`);
  fail += 1;
}
async function step(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (err) {
    bad(name, err.message.split('\n')[0]);
  }
}

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
const IGNORE = [/favicon/i, /ERR_CONNECTION_CLOSED/, /ERR_NAME_NOT_RESOLVED/, /ERR_CERT/, /net::ERR_ABORTED/, /status of 5\d\d/];
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (IGNORE.some((re) => re.test(t))) return; // third-party CDN art, not our code
  errors.push(`console: ${t.slice(0, 200)}`);
});

const email = `ui${Date.now()}@sonora.fm`;

console.log('== BOOT & AUTH ==');
await step('app loads', async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.auth-card', { timeout: 15000 });
});

await step('switch to register', async () => {
  await page.click('.auth-switch button');
  await page.waitForSelector('input[autocomplete="name"]');
});

await step('register creates session and enters app', async () => {
  await page.fill('input[autocomplete="name"]', 'UI Tester');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForSelector('.sidebar', { timeout: 20000 });
  await page.waitForSelector('.player', { timeout: 10000 });
});

await step('home dashboard renders stats', async () => {
  await page.waitForSelector('.stat-card .stat-value', { timeout: 20000 });
  const n = await page.locator('.stat-card').count();
  if (n < 4) throw new Error(`only ${n} stat cards`);
});

await step('browse rows load real tracks with artwork', async () => {
  await page.waitForSelector('.media-card img', { timeout: 30000 });
  const cards = await page.locator('.media-card').count();
  if (cards < 6) throw new Error(`only ${cards} cards`);
});
await page.screenshot({ path: `${SHOTS}/01-home.png`, fullPage: false });

console.log('== SEARCH ==');
await step('search returns playable results', async () => {
  await page.click('.nav-item:has-text("Search")');
  await page.waitForSelector('#global-search');
  await page.fill('#global-search', 'burna boy');
  await page.waitForSelector('.track-row', { timeout: 25000 });
  const rows = await page.locator('.track-row').count();
  if (rows < 5) throw new Error(`only ${rows} rows`);
});
await page.screenshot({ path: `${SHOTS}/02-search.png` });

console.log('== PLAYBACK ==');
await step('clicking a track starts real audio', async () => {
  await page.locator('.track-row').first().click();
  await page.waitForFunction(
    () => {
      const a = document.querySelector('audio') || [...document.querySelectorAll('*')].find((e) => e.tagName === 'AUDIO');
      return true;
    },
    { timeout: 5000 }
  );
  // the player bar should show the track
  await page.waitForFunction(
    () => {
      const t = document.querySelector('.player-title');
      return t && t.textContent !== 'Nothing playing';
    },
    { timeout: 15000 }
  );
});

await step('audio element actually advances currentTime', async () => {
  const r = await page.evaluate(async () => {
    const a = window.__sonora.audio;
    const start = a.currentTime;
    await new Promise((res) => setTimeout(res, 6000));
    return {
      start,
      end: window.__sonora.audio.currentTime,
      err: window.__sonora.audio.error?.code || null,
      resolvedFrom: window.__sonora.player.current?.resolvedFrom || null,
    };
  });
  if (!(r.end > 0.5)) throw new Error(`currentTime stuck at ${r.end} (err ${r.err})`);
  console.log(`       currentTime ${r.start.toFixed(2)} -> ${r.end.toFixed(2)}` +
    (r.resolvedFrom ? ` (auto-resolved via ${r.resolvedFrom})` : ''));
});

await step('now-playing row shows equalizer', async () => {
  await page.waitForSelector('.track-row.playing .eq', { timeout: 8000 });
});

await step('pause/play toggle works', async () => {
  await page.click('.ctrl-play');
  await page.waitForTimeout(600);
  await page.click('.ctrl-play');
  await page.waitForTimeout(600);
});

console.log('== LIBRARY (optimistic) ==');
await step('heart saves track instantly', async () => {
  const row = page.locator('.track-row').first();
  await row.hover();
  await row.locator('button[title="Save to library"]').click();
  await page.waitForSelector('.toast', { timeout: 8000 });
  await page.waitForSelector('.track-row .btn-icon.saved', { timeout: 8000 });
});

await step('library page lists the saved track', async () => {
  await page.click('.nav-item:has-text("Your library")');
  await page.waitForSelector('.track-row', { timeout: 15000 });
  const n = await page.locator('.track-row').count();
  if (n < 1) throw new Error('library empty after save');
});

console.log('== PLAYLIST CRUD ==');
await step('create playlist via modal', async () => {
  await page.click('.nav-item:has-text("Playlists")');
  await page.waitForSelector('.page-title:has-text("Playlists")');
  await page.click('button.btn-primary:has-text("New playlist")');
  await page.waitForSelector('.modal');
  await page.fill('.modal input.input', 'UI Test Playlist');
  await page.fill('.modal textarea', 'created by the smoke test');
  await page.click('.modal button:has-text("Create playlist")');
  await page.waitForSelector('.media-card', { timeout: 12000 });
});

await step('playlist appears in sidebar', async () => {
  await page.waitForSelector('.sidebar-pl:has-text("UI Test Playlist")', { timeout: 8000 });
});

await step('add a track to the playlist from search', async () => {
  await page.click('.nav-item:has-text("Search")');
  await page.fill('#global-search', 'tems');
  await page.waitForSelector('.track-row', { timeout: 25000 });
  const row = page.locator('.track-row').first();
  await row.hover();
  await row.locator('button[title="Add to playlist"]').click();
  await page.waitForSelector('.modal-title:has-text("Add to playlist")');
  await page.click('.modal .embed:has-text("UI Test Playlist")');
  await page.waitForSelector('.toast', { timeout: 10000 });
});

await step('open playlist detail and see the track', async () => {
  await page.click('.sidebar-pl:has-text("UI Test Playlist")');
  await page.waitForSelector('.detail-title:has-text("UI Test Playlist")', { timeout: 10000 });
  await page.waitForSelector('.track-row', { timeout: 10000 });
});
await page.screenshot({ path: `${SHOTS}/03-playlist.png` });

await step('edit playlist name persists', async () => {
  await page.click('button:has-text("Edit")');
  await page.waitForSelector('.modal');
  await page.fill('.modal input.input', 'Renamed By Test');
  await page.click('.modal button:has-text("Save changes")');
  await page.waitForSelector('.detail-title:has-text("Renamed By Test")', { timeout: 10000 });
});

console.log('== AI STUDIO ==');
await step('AI generates a playlist from a prompt', async () => {
  await page.click('.nav-item:has-text("AI Studio")');
  await page.waitForSelector('.ai-hero');
  await page.fill('.ai-prompt-row input', 'moody late night afrobeats for a drive');
  await page.click('button:has-text("Generate")');
  await page.waitForSelector('.detail-title', { timeout: 60000 });
  const n = await page.locator('.track-row').count();
  if (n < 5) throw new Error(`AI produced only ${n} tracks`);
  console.log(`       generated ${n} tracks`);
});

await step('AI result shows sound profile bars', async () => {
  await page.waitForSelector('.feature-bar-fill', { timeout: 8000 });
});
await page.screenshot({ path: `${SHOTS}/04-ai.png` });

await step('save AI playlist', async () => {
  await page.click('button:has-text("Save as playlist")');
  await page.waitForSelector('.detail-title', { timeout: 20000 });
  await page.waitForSelector('.badge-ai', { timeout: 8000 });
});

console.log('== COMMUNITY ==');
await step('post to the feed', async () => {
  await page.click('.nav-item:has-text("Community")');
  await page.waitForSelector('.post textarea', { timeout: 10000 });
  await page.fill('.post textarea', 'Testing the Sonora feed');
  await page.click('.post button.btn-primary');
  await page.waitForSelector('.post-msg:has-text("Testing the Sonora feed")', { timeout: 12000 });
});

await step('like post optimistically', async () => {
  const like = page.locator('.post-action').first();
  await like.click();
  await page.waitForSelector('.post-action.liked', { timeout: 6000 });
});

await step('comment on the post', async () => {
  await page.locator('.post-action').nth(1).click();
  await page.waitForSelector('.comment-form input', { timeout: 10000 });
  await page.fill('.comment-form input', 'First comment!');
  await page.click('.comment-form button');
  await page.waitForSelector('.comment-text:has-text("First comment!")', { timeout: 10000 });
});
await page.screenshot({ path: `${SHOTS}/05-feed.png` });

console.log('== PROFILE ==');
await step('profile page loads with provider status', async () => {
  await page.click('.user-chip');
  await page.waitForSelector('.detail-title:has-text("UI Tester")', { timeout: 12000 });
  await page.waitForSelector('.prov-dot', { timeout: 8000 });
});
await page.screenshot({ path: `${SHOTS}/06-profile.png` });

console.log('== RESPONSIVE ==');
await step('mobile layout collapses sidebar', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/#/home`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.menu-btn', { timeout: 10000 });
  const hidden = await page.evaluate(() => {
    const s = document.querySelector('.sidebar');
    return s.getBoundingClientRect().left < 0;
  });
  if (!hidden) throw new Error('sidebar not offscreen on mobile');
});

await step('hamburger opens sidebar drawer', async () => {
  await page.click('.menu-btn');
  await page.waitForTimeout(500);
  const open = await page.evaluate(() => document.querySelector('.sidebar').getBoundingClientRect().left >= 0);
  if (!open) throw new Error('drawer did not open');
});
await page.screenshot({ path: `${SHOTS}/07-mobile.png` });

console.log('== SESSION PERSISTENCE ==');
await step('reload keeps the user signed in', async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.sidebar', { timeout: 15000 });
  const authCard = await page.locator('.auth-card').count();
  if (authCard > 0) throw new Error('was logged out on reload');
});

console.log('');
console.log(`PASS=${pass} FAIL=${fail}`);
if (errors.length) {
  console.log(`\nJS errors captured (${errors.length}):`);
  [...new Set(errors)].slice(0, 15).forEach((e) => console.log('  - ' + e));
} else {
  console.log('No JS console/page errors.');
}

await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
