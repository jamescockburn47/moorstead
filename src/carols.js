// carols.js — the carol registry + a day-seeded rotation order. Pure: no DOM,
// no WebAudio, no three.js (so it parses headless under Node for the verify).
//
// Seven public-domain carols, all comfortably pre-1900 (the tune or the words
// in print by the year shown), so they sit right in the Victorian moor. The MIDI
// arrangements live under public/music/carols/ and are served by vite at
// /music/carols/<file>. The anachronistic 1906 Holst ("In the Bleak Midwinter",
// Cranham) this replaces is gone.

export const CAROLS = [
  { id: 'wenceslas',   name: 'Good King Wenceslas',         year: 1853, file: 'good-king-wenceslas.mid' },
  { id: 'shepherds',   name: 'While Shepherds Watched',     year: 1700, file: 'while-shepherds-watched.mid' },
  { id: 'godrest',     name: 'God Rest You Merry, Gentlemen', year: 1833, file: 'god-rest-you-merry.mid' },
  { id: 'firstnowell', name: 'The First Nowell',            year: 1833, file: 'the-first-nowell.mid' },
  { id: 'onceinroyal', name: "Once in Royal David's City",  year: 1849, file: 'once-in-royal-davids-city.mid' },
  { id: 'herald',      name: 'Hark! The Herald Angels Sing', year: 1855, file: 'hark-the-herald.mid' },
  { id: 'ocome',       name: 'O Come, All Ye Faithful',     year: 1743, file: 'o-come-all-ye-faithful.mid' },
];

// A small, fast integer hash (Mulberry32 step) so the shuffle is deterministic
// across clients and platforms — no Math.random, so the same daySeed always
// yields the same order, on every machine. Folded to a 32-bit unsigned value.
function hash32(n) {
  let h = (n | 0) + 0x6d2b79f5;
  h = Math.imul(h ^ (h >>> 15), h | 1);
  h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
  return ((h ^ (h >>> 14)) >>> 0);
}

// rotationOrder(daySeed) → a permutation of all carol ids for the given integer
// day-seed. A seeded Fisher–Yates: every client on the same in-game day walks
// the same shuffle, so the village carol is shared, and it advances each day as
// the seed ticks over. Returns a fresh array (CAROLS is never mutated).
export function rotationOrder(daySeed) {
  const seed = Math.floor(daySeed) | 0;
  const ids = CAROLS.map(c => c.id);
  for (let i = ids.length - 1; i > 0; i--) {
    // a fresh hash per index keeps adjacent days from sharing a swap pattern
    const j = hash32(seed * 0x9e3779b1 + i) % (i + 1);
    const t = ids[i]; ids[i] = ids[j]; ids[j] = t;
  }
  return ids;
}
