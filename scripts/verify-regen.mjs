// Edit-ledger regrowth check — run wi': node scripts/verify-regen.mjs
import { B } from '../src/defs.js';
import { categoryOf, lifespanOf, isExpired, LIFESPAN } from '../src/editledger.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// --- categoryOf: placing is a build; breaking classifies the old block ---
{
  (categoryOf(B.GRASS, B.PLANKS) === 'build' ? ok : bad)('placing any block = build');
  (categoryOf(B.HEATHER, B.AIR) === 'harvest' ? ok : bad)('cutting heather = harvest');
  (categoryOf(B.LOG, B.AIR) === 'harvest' ? ok : bad)('felling a log = harvest');
  (categoryOf(B.COAL_ORE, B.AIR) === 'harvest' ? ok : bad)('mining a coal seam = harvest');
  (categoryOf(B.PEAT, B.AIR) === 'harvest' ? ok : bad)('cutting peat = harvest');
  (categoryOf(B.STONE, B.AIR) === 'dig' ? ok : bad)('digging stone = dig');
  (categoryOf(B.DIRT, B.AIR) === 'dig' ? ok : bad)('digging dirt = dig');
  (categoryOf(B.PLANKS, B.AIR) === 'build' ? ok : bad)('removing planks = build');
}

// --- lifespanOf: harvest blocks regrow on their own clock; dig/build never (Slice 1) ---
{
  (lifespanOf('harvest', B.HEATHER) === LIFESPAN.plant ? ok : bad)('plants regrow in LIFESPAN.plant days');
  (lifespanOf('harvest', B.LOG) === LIFESPAN.tree ? ok : bad)('trees regrow in LIFESPAN.tree days');
  (lifespanOf('harvest', B.JET_ORE) === LIFESPAN.ore ? ok : bad)('ore regrows in LIFESPAN.ore days');
  (lifespanOf('harvest', B.PEAT) === LIFESPAN.peat ? ok : bad)('peat regrows in LIFESPAN.peat days');
  (lifespanOf('dig', B.STONE) === Infinity ? ok : bad)('dig does not expire in Slice 1');
  (lifespanOf('build', B.PLANKS) === Infinity ? ok : bad)('build does not expire in Slice 1');
}

// --- isExpired: only past its lifespan, and only harvest ---
{
  const heather = { cat: 'harvest', day: 10, was: B.HEATHER };
  (isExpired(heather, 10 + LIFESPAN.plant - 0.01) === false ? ok : bad)('not expired before its lifespan');
  (isExpired(heather, 10 + LIFESPAN.plant) === true ? ok : bad)('expired at its lifespan');
  const wall = { cat: 'build', day: 10, was: B.PLANKS };
  const activeClaim = [{ kind: 'claim', cx: 0, cz: 0, radius: 5, lapsedDay: null }];
  (isExpired(wall, 9999, activeClaim, 1, 0, 40, 0, null) === false ? ok : bad)('a build inside an active claim never expires');
}

console.log('RESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
