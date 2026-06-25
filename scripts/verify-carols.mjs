// Carol registry + rotation + the vendored MIDI — run wi': node scripts/verify-carols.mjs
// Headless: @tonejs/midi parses a MIDI buffer fine under Node (no WebAudio needed —
// we never schedule a note here, only confirm the files are real, well-formed carols).
//
// NOTE on the import: @tonejs/midi's Node entry is CommonJS, so Node's ESM loader
// only exposes the DEFAULT export — `import { Midi }` would throw here. (vite, which
// bundles the browser code, resolves the package's ESM and gives carolBox.js a named
// `Midi`.) So Node gets it via default-then-destructure.
import pkg from '@tonejs/midi';
const { Midi } = pkg;
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CAROLS, rotationOrder } from '../src/carols.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAROL_DIR = join(__dirname, '..', 'public', 'music', 'carols');

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// --- the registry shape ---
(CAROLS.length === 7 ? ok : bad)('CAROLS has 7 entries');
const ids = CAROLS.map(c => c.id);
(new Set(ids).size === ids.length ? ok : bad)('carol ids are unique');
{
  let wellFormed = true;
  for (const c of CAROLS) {
    if (typeof c.id !== 'string' || !c.id) wellFormed = false;
    if (typeof c.name !== 'string' || !c.name) wellFormed = false;
    if (!Number.isInteger(c.year) || c.year < 1500 || c.year > 1900) wellFormed = false;  // all pre-1900, period-true
    if (typeof c.file !== 'string' || !c.file.endsWith('.mid')) wellFormed = false;
  }
  (wellFormed ? ok : bad)('every entry has a string id/name, a pre-1900 integer year, and a .mid file');
}

// --- the vendored MIDI: exists, parses, has notes ---
for (const c of CAROLS) {
  const path = join(CAROL_DIR, c.file);
  if (!existsSync(path)) { bad(c.file + ' is missing from public/music/carols/'); continue; }
  try {
    const buf = readFileSync(path);
    const midi = new Midi(new Uint8Array(buf));
    let notes = 0;
    for (const t of midi.tracks) notes += t.notes.length;
    (notes > 0 ? ok : bad)(c.file + ' parses and has notes (' + notes + ')');
  } catch (e) {
    bad(c.file + ' failed to parse: ' + (e && e.message ? e.message : e));
  }
}

// --- rotationOrder: deterministic + a full permutation of all ids ---
{
  const a = rotationOrder(42), b = rotationOrder(42);
  (JSON.stringify(a) === JSON.stringify(b) ? ok : bad)('rotationOrder(42) is deterministic for a fixed seed');
  (a.length === CAROLS.length && new Set(a).size === a.length && a.every(id => ids.includes(id))
    ? ok : bad)('rotationOrder(42) is a permutation of all carol ids');

  // a different seed should generally give a different order (sanity, not a hard law);
  // and across a span of days every order must stay a valid permutation
  let allPermutations = true, sawDifferent = false;
  const ref = JSON.stringify(rotationOrder(0));
  for (let d = 0; d < 50; d++) {
    const o = rotationOrder(d);
    if (o.length !== CAROLS.length || new Set(o).size !== o.length || !o.every(id => ids.includes(id))) allPermutations = false;
    if (JSON.stringify(o) !== ref) sawDifferent = true;
  }
  (allPermutations ? ok : bad)('rotationOrder stays a valid permutation across 50 day-seeds');
  (sawDifferent ? ok : bad)('rotationOrder varies with the day-seed (not a fixed order)');
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
