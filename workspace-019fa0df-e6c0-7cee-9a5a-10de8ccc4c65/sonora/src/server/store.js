'use strict';
/**
 * Sonora durable store.
 *
 * Zero dependencies. Crash-safe. Node 20 compatible (node:sqlite needs 22+, and
 * node_modules is never persisted in this workspace, so we roll our own).
 *
 * Design: in-memory tables + append-only write-ahead log + periodic atomic
 * snapshot compaction.
 *   - every mutation is appended to data/wal.log as one JSON line, flushed
 *     with a real fs.writeSync to the open fd (durable across process death)
 *   - every SNAPSHOT_EVERY ops (or 2s idle) the full state is written to
 *     data/db.json.tmp then fs.renameSync'd over data/db.json (atomic on POSIX)
 *   - on boot we load the snapshot then replay any WAL tail recorded after it
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Configurable so hosts can point it at a mounted persistent volume
// (Render disk, Fly volume, Docker bind mount) instead of the app directory.
const DATA_DIR = process.env.SONORA_DATA_DIR
  ? path.resolve(process.env.SONORA_DATA_DIR)
  : path.join(__dirname, '..', '..', 'data');
const SNAP = path.join(DATA_DIR, 'db.json');
const SNAP_TMP = path.join(DATA_DIR, 'db.json.tmp');
const WAL = path.join(DATA_DIR, 'wal.log');
const SNAPSHOT_EVERY = 200;

const TABLES = [
  'users',
  'sessions',
  'playlists',
  'playlistTracks',
  'tracks',
  'shares',
  'comments',
  'likes',
  'follows',
  'plays',
];

function emptyState() {
  const s = { _v: 1 };
  for (const t of TABLES) s[t] = {};
  return s;
}

let state = emptyState();
let walFd = null;
let opsSinceSnapshot = 0;
let snapshotTimer = null;

/* ------------------------------------------------------------------ ids */

const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
function id(prefix = '') {
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (const b of bytes) out += ID_ALPHABET[b % ID_ALPHABET.length];
  return prefix ? `${prefix}_${out}` : out;
}

/* ------------------------------------------------------------- wal/snap */

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function applyOp(op) {
  const table = state[op.t];
  if (!table) return;
  if (op.o === 'put') {
    table[op.k] = op.v;
  } else if (op.o === 'del') {
    delete table[op.k];
  } else if (op.o === 'clear') {
    state[op.t] = {};
  }
}

function appendWal(op) {
  if (walFd === null) return;
  const line = JSON.stringify(op) + '\n';
  fs.writeSync(walFd, line);
}

function writeSnapshot() {
  if (snapshotTimer) {
    clearTimeout(snapshotTimer);
    snapshotTimer = null;
  }
  try {
    ensureDir();
    fs.writeFileSync(SNAP_TMP, JSON.stringify(state));
    fs.renameSync(SNAP_TMP, SNAP);
    if (walFd !== null) {
      fs.ftruncateSync(walFd, 0);
    }
    opsSinceSnapshot = 0;
  } catch (err) {
    console.error('[store] snapshot failed:', err.message);
  }
}

function scheduleSnapshot() {
  opsSinceSnapshot += 1;
  if (opsSinceSnapshot >= SNAPSHOT_EVERY) {
    writeSnapshot();
    return;
  }
  if (!snapshotTimer) {
    snapshotTimer = setTimeout(writeSnapshot, 2000);
    if (snapshotTimer.unref) snapshotTimer.unref();
  }
}

function commit(op) {
  applyOp(op);
  appendWal(op);
  scheduleSnapshot();
}

function load() {
  ensureDir();
  // 1. snapshot
  if (fs.existsSync(SNAP)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
      state = Object.assign(emptyState(), parsed);
      for (const t of TABLES) if (!state[t]) state[t] = {};
    } catch (err) {
      console.error('[store] corrupt snapshot, starting fresh:', err.message);
      state = emptyState();
    }
  }
  // 2. replay wal tail
  if (fs.existsSync(WAL)) {
    const raw = fs.readFileSync(WAL, 'utf8');
    let replayed = 0;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        applyOp(JSON.parse(line));
        replayed += 1;
      } catch {
        /* torn final line after a crash — safe to drop */
      }
    }
    if (replayed) console.log(`[store] replayed ${replayed} WAL ops`);
  }
  walFd = fs.openSync(WAL, 'a');
  // fold whatever we replayed back into a clean snapshot
  writeSnapshot();

  const counts = TABLES.map((t) => `${t}=${Object.keys(state[t]).length}`).join(' ');
  console.log(`[store] ready  ${counts}`);
}

function flush() {
  writeSnapshot();
}

process.on('exit', () => {
  try {
    if (opsSinceSnapshot > 0) writeSnapshot();
    if (walFd !== null) fs.closeSync(walFd);
  } catch {
    /* shutting down anyway */
  }
});
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    try {
      writeSnapshot();
    } finally {
      process.exit(0);
    }
  });
}

/* ------------------------------------------------------------- table API */

function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

class Table {
  constructor(name) {
    this.name = name;
  }

  get raw() {
    return state[this.name];
  }

  get(key) {
    return clone(state[this.name][key]);
  }

  has(key) {
    return Object.prototype.hasOwnProperty.call(state[this.name], key);
  }

  /** Insert. Generates `id` when absent and stamps createdAt/updatedAt. */
  insert(doc, prefix) {
    const now = new Date().toISOString();
    const record = {
      id: doc.id || id(prefix || this.name.slice(0, 2)),
      createdAt: now,
      updatedAt: now,
      ...doc,
    };
    record.id = doc.id || record.id;
    commit({ o: 'put', t: this.name, k: record.id, v: record });
    return clone(record);
  }

  /** Full overwrite of an existing row (used for imports/sessions). */
  put(key, value) {
    commit({ o: 'put', t: this.name, k: key, v: value });
    return clone(value);
  }

  /** Shallow merge patch. Returns null when the row is missing. */
  update(key, patch) {
    const cur = state[this.name][key];
    if (!cur) return null;
    const next = { ...cur, ...patch, id: cur.id, updatedAt: new Date().toISOString() };
    commit({ o: 'put', t: this.name, k: key, v: next });
    return clone(next);
  }

  remove(key) {
    if (!this.has(key)) return false;
    commit({ o: 'del', t: this.name, k: key });
    return true;
  }

  all() {
    return Object.values(state[this.name]).map(clone);
  }

  /** Predicate scan. Tables here stay small enough that O(n) is honest. */
  find(pred) {
    const out = [];
    for (const row of Object.values(state[this.name])) {
      if (pred(row)) out.push(clone(row));
    }
    return out;
  }

  findOne(pred) {
    for (const row of Object.values(state[this.name])) {
      if (pred(row)) return clone(row);
    }
    return null;
  }

  count(pred) {
    if (!pred) return Object.keys(state[this.name]).length;
    let n = 0;
    for (const row of Object.values(state[this.name])) if (pred(row)) n += 1;
    return n;
  }

  removeWhere(pred) {
    let n = 0;
    for (const row of Object.values(state[this.name])) {
      if (pred(row)) {
        commit({ o: 'del', t: this.name, k: row.id });
        n += 1;
      }
    }
    return n;
  }
}

const db = {};
for (const t of TABLES) db[t] = new Table(t);

module.exports = { db, id, load, flush, TABLES, DATA_DIR };
