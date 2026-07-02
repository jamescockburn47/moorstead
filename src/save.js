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
