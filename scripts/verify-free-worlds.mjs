// Free Worlds backbone check — run wi': node scripts/verify-free-worlds.mjs
import { baseRoom, isFreeRoom, isBairnsRoom, FREE_STARTER } from '../src/rooms.js';
import { B, I, TOOLS } from '../src/defs.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// --- room classification (shard-aware) ---
{
  (baseRoom('bairns-free-2') === 'bairns-free' ? ok : bad)('baseRoom strips the shard suffix');
  (baseRoom('bairns') === 'bairns' ? ok : bad)('baseRoom leaves an unsharded room be');
  (isFreeRoom('bairns-free') && isFreeRoom('bairns-free-3') ? ok : bad)('a free room and its shards read as free');
  (!isFreeRoom('bairns') && !isFreeRoom('bairns-2') && !isFreeRoom('moor') ? ok : bad)('survival rooms are not free');
  (isBairnsRoom('bairns') && isBairnsRoom('bairns-2') ? ok : bad)('bairns classification is shard-aware (fixes the bairns-2 latent bug)');
  (!isBairnsRoom('bairns-free') ? ok : bad)('the free world is NOT a bairns room (free rules supersede)');
}

// --- starter pack manifest is sane ---
{
  const ids = new Set([...Object.values(B), ...Object.values(I)]);
  (Array.isArray(FREE_STARTER) && FREE_STARTER.length > 0 ? ok : bad)('starter pack is a non-empty manifest');
  (FREE_STARTER.every(it => ids.has(it.id) && it.n > 0) ? ok : bad)('every starter item is a real id with a positive count');
  (FREE_STARTER.some(it => TOOLS[it.id]) ? ok : bad)('starter pack includes at least one tool');
}

console.log('RESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
