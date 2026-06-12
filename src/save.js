// World persistence via IndexedDB: modified chunks (raw bytes) + game metadata.
// DB keeps its owd 'moorcraft' name on purpose — renaming would orphan every save.
const DB_NAME = 'moorcraft';
const DB_VERSION = 1;

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
