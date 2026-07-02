// World persistence via IndexedDB: modified chunks (raw bytes) + game metadata.
// DB keeps its owd 'moorcraft' name on purpose — renaming would orphan every save.
const DB_NAME = 'moorcraft';
const DB_VERSION = 1;

// ---- save-format versioning + stepwise migration ----
// The meta.version main.js WRITES (saveNow) and the load path expects after migration.
export const SAVE_VERSION = 2;

// Ordered stepwise migrations: MIGRATIONS[v] takes the whole loaded bundle { meta, chunks }
// AT version v and returns it at v+1 (it must set meta.version to v+1 — migrateSave applies
// steps in order till SAVE_VERSION and refuses a step that doesn't advance).
//
// To add v2 -> v3: bump SAVE_VERSION to 3, then add
//   2: (saved) => { /* rewrite meta / chunk bytes here */ saved.meta.version = 3; return saved; },
// Old v1 saves then run 1 -> 2 -> 3 stepwise, no special casing.
const MIGRATIONS = {
  // v1 (pre-moors, or unversioned) -> v2: nothing structural to rewrite — the moors moved
  // under the save, which no data rewrite can heal. A worked no-op example: it records where
  // the save came FROM (migratedFrom) so the load path can still warn about odd seams.
  1: (saved) => {
    if (saved.meta.migratedFrom == null) saved.meta.migratedFrom = saved.meta.version || 1;
    saved.meta.version = 2;
    return saved;
  },
};

// Bring a loaded save up to SAVE_VERSION, one step at a time. Returns:
//   { ok: true, saved }                        — current (possibly just migrated)
//   { ok: false, reason: 'future', version }   — written by a NEWER build; loading would corrupt
//   { ok: false, reason: 'no-path', version }  — a gap/broken step in MIGRATIONS (add the step)
export function migrateSave(saved) {
  if (!saved || !saved.meta) return { ok: true, saved };
  let v = saved.meta.version || 1;
  if (v > SAVE_VERSION) return { ok: false, reason: 'future', version: v };
  while (v < SAVE_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) return { ok: false, reason: 'no-path', version: v };
    saved = step(saved) || saved;
    const nv = saved.meta.version || 0;
    if (nv <= v) return { ok: false, reason: 'no-path', version: v }; // a step that stands still would loop forever
    v = nv;
  }
  return { ok: true, saved };
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks');
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
  });
}

export async function saveGame(meta, chunkMap) {
  const db = await openDB();
  await tx(db, 'meta', 'readwrite', s => s.put(meta, 'game'));
  await tx(db, 'chunks', 'readwrite', s => {
    for (const [k, data] of chunkMap) s.put(data, k);
  });
  db.close();
}

export async function loadGame() {
  const db = await openDB();
  const meta = await new Promise((resolve, reject) => {
    const t = db.transaction('meta', 'readonly');
    const req = t.objectStore('meta').get('game');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  if (!meta) { db.close(); return null; }
  const chunks = new Map();
  await new Promise((resolve, reject) => {
    const t = db.transaction('chunks', 'readonly');
    const s = t.objectStore('chunks');
    const req = s.openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (cur) {
        chunks.set(cur.key, new Uint8Array(cur.value));
        cur.continue();
      } else resolve();
    };
    req.onerror = () => reject(req.error);
  });
  db.close();
  return { meta, chunks };
}

export async function clearSave() {
  const db = await openDB();
  await tx(db, 'meta', 'readwrite', s => s.clear());
  await tx(db, 'chunks', 'readwrite', s => s.clear());
  db.close();
}

// ---- Oak strongbox containers (pure — verify-strongbox runs these headless) ----
// A strongbox is home storage keyed by its block coordinate. Contents ride the save meta
// (meta.strongboxes = [...Map]) in solo; on the shared moor they live in localStorage per
// room (main.persistNetStrongboxes) — the relay knows nothing in v1. The box record carries
// a schema version `v` so a future relay-synced v2 can adopt an' migrate these containers.

export const BOX_SLOTS = 27; // 9 x 3, a third of thi pockets

export function boxKey(x, y, z) { return x + ',' + y + ',' + z; }

export function makeBox() {
  return { v: 1, slots: new Array(BOX_SLOTS).fill(null), brass: 0 };
}

// Coerce a loaded/foreign box record into a well-formed one (corrupt saves must never
// NaN a purse or shrink a grid — same defensive stance as player.deserialize).
export function normalizeBox(b) {
  const box = makeBox();
  if (b && Array.isArray(b.slots)) {
    for (let i = 0; i < BOX_SLOTS; i++) {
      const s = b.slots[i];
      if (s && typeof s.id === 'number' && typeof s.n === 'number' && s.n > 0) {
        box.slots[i] = s.dur !== undefined ? { id: s.id, n: Math.floor(s.n), dur: s.dur } : { id: s.id, n: Math.floor(s.n) };
      }
    }
  }
  if (b && Number.isFinite(b.brass) && b.brass > 0) box.brass = Math.floor(b.brass);
  return box;
}

// One click on a container slot, mirroring ui.slotClick's cursor semantics exactly:
//   left  (button 0): pick up / put down / merge stack / swap
//   right (button 2): split half onto t' cursor / place one off it
// Mutates `slots[idx]`; returns the NEW cursor stack (or null). `maxStackOf` gates merging
// (tools have max stack 1, so they swap rather than merge — same as t' pockets).
export function containerClick(slots, idx, cursor, button, maxStackOf = () => 64) {
  const cur = slots[idx];
  if (cursor) {
    if (button === 2) { // place one
      if (!cur) {
        slots[idx] = cursor.dur !== undefined ? { id: cursor.id, n: 1, dur: cursor.dur } : { id: cursor.id, n: 1 };
        cursor.n--;
      } else if (cur.id === cursor.id && cur.n < maxStackOf(cur.id)) {
        cur.n++; cursor.n--;
      }
      return cursor.n <= 0 ? null : cursor;
    }
    if (!cur) { slots[idx] = cursor; return null; }
    if (cur.id === cursor.id && cur.n < maxStackOf(cur.id)) { // merge
      const take = Math.min(cursor.n, maxStackOf(cur.id) - cur.n);
      cur.n += take; cursor.n -= take;
      return cursor.n <= 0 ? null : cursor;
    }
    slots[idx] = cursor; // swap
    return cur;
  }
  if (!cur) return null;
  if (button === 2) { // split half
    const half = Math.ceil(cur.n / 2);
    const out = cur.dur !== undefined ? { id: cur.id, n: half, dur: cur.dur } : { id: cur.id, n: half };
    cur.n -= half;
    if (cur.n <= 0) slots[idx] = null;
    return out;
  }
  slots[idx] = null; // pick up
  return cur;
}

// Move brass between two purses ({brass} holders — player or box). Clamped: tha can't
// overdraw, an' nowt ever goes negative. Returns what actually moved.
export function transferBrass(src, dst, amount) {
  const have = Math.max(0, Math.floor(src.brass || 0));
  const n = Math.max(0, Math.min(Math.floor(amount) || 0, have));
  src.brass = have - n;
  dst.brass = Math.max(0, Math.floor(dst.brass || 0)) + n;
  return n;
}

// Breaking a strongbox must never vaporise its contents: empty the box and hand back
// everything in it — item stacks to spawn as drops, brass to refund to the breaker.
export function spillBox(box) {
  const drops = [];
  for (const s of box.slots) if (s && s.n > 0) drops.push([s.id, s.n]);
  const brass = Math.max(0, Math.floor(box.brass || 0));
  box.slots = new Array(box.slots.length).fill(null);
  box.brass = 0;
  return { drops, brass };
}

export async function hasSave() {
  const db = await openDB();
  const meta = await new Promise(resolve => {
    const t = db.transaction('meta', 'readonly');
    const req = t.objectStore('meta').get('game');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
  db.close();
  return !!meta;
}
