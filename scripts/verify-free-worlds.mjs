// Free Worlds backbone check — run wi': node scripts/verify-free-worlds.mjs
import { baseRoom, isFreeRoom, isBairnsRoom, FREE_STARTER } from '../src/rooms.js';
import { B, I, TOOLS } from '../src/defs.js';
import { isExpired, mayDigDeep } from '../src/editledger.js';

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

// --- build/dig decay OFF in a free world; harvest still regrows (gather loop stays) ---
{
  const oldBuild = { cat: 'build', day: 0, was: B.AIR };
  const oldDig = { cat: 'dig', day: 0, was: B.STONE };
  const oldHarvest = { cat: 'harvest', day: 0, was: B.LOG };
  // signature: isExpired(edit, nowDay, deeds, decayScale, x, y, z, heightFunc, free)
  (isExpired(oldBuild, 999, [], 1, 0, 0, 0, null, true) === false ? ok : bad)('free world: a build never crumbles');
  (isExpired(oldDig, 999, [], 1, 0, 0, 0, null, true) === false ? ok : bad)('free world: a dig never backfills');
  (isExpired(oldHarvest, 999, [], 1, 0, 0, 0, null, true) === true ? ok : bad)('free world: harvested resources still regrow');
  (isExpired(oldBuild, 999, [], 1, 0, 0, 0, null, false) === true ? ok : bad)('survival world: an unclaimed build still crumbles');
}

// --- deep digging in a free world: no mine/fixtures needed, but pick tier still gates depth ---
{
  const grade = 50;
  // signature: mayDigDeep(y, grade, mineDeed, heldPickType, allowedFixtures, free)
  (mayDigDeep(grade - 5, grade, null, 'wood', [], true).allowed === true ? ok : bad)('free world: shallow deep-dig allowed with a wood pick, no mine');
  (mayDigDeep(grade - 15, grade, null, 'wood', [], true).allowed === false ? ok : bad)('free world: too weak a pick for the depth is still refused (pick tier kept)');
  (mayDigDeep(grade - 15, grade, null, 'stone', [], true).allowed === true ? ok : bad)('free world: right pick + no fixture needed = allowed');
  (mayDigDeep(grade - 5, grade, null, 'wood', [], false).reason === 'nomine' ? ok : bad)('survival world: deep-dig with no mine is still refused');
}

console.log('RESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
