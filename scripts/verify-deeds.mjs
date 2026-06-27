// Deeds backbone check — run wi': node scripts/verify-deeds.mjs
import { deedFee, weeklyUpkeep, inDeed, isLapsed, DEED, makeDeed, lapsesUnderUpkeep } from '../src/deeds.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// --- deedFee: scaled by size; a mine by depth ---
{
  (deedFee('claim', 5) === DEED.claimFeeBase + 25 * DEED.claimFeePerR2 ? ok : bad)('claim fee = base + r²·rate');
  (deedFee('mine', 3, 10) === DEED.mineFeeBase + 10 * DEED.mineFeePerDepth ? ok : bad)('mine fee = base + depth·rate');
  (deedFee('claim', 8) > deedFee('claim', 4) ? ok : bad)('a bigger claim costs more (discourages land-grabs)');
  (deedFee('mine', 0, 30) > deedFee('mine', 0, 5) ? ok : bad)('a deeper mine costs more');
}

// --- weeklyUpkeep: size-scaled, floored at 1 ---
{
  (weeklyUpkeep('claim', 5) === 5 * DEED.claimUpkeepPerR ? ok : bad)('claim upkeep = r·rate per week');
  (weeklyUpkeep('mine', 0, 10) === 10 * DEED.mineUpkeepPerDepth ? ok : bad)('mine upkeep = depth·rate per week');
  (weeklyUpkeep('claim', 0) >= 1 ? ok : bad)('upkeep never below 1');
}

// --- inDeed: cylinder membership of an ACTIVE deed of the right kind ---
{
  const claim = { kind: 'claim', cx: 0, cz: 0, radius: 5, lapsedDay: null, paidUntilDay: 0 };
  (inDeed([claim], 3, 0) === true ? ok : bad)('a point inside the radius is in the deed');
  (inDeed([claim], 10, 0) === false ? ok : bad)('a point outside the radius is not');
  (inDeed([claim], 3, 0, 'mine') === false ? ok : bad)('wrong-kind filter excludes it');
  (inDeed([{ ...claim, lapsedDay: 5 }], 3, 0) === false ? ok : bad)('a lapsed deed protects nothing');
  (inDeed([], 0, 0) === false ? ok : bad)('no deeds = not in any deed');
}

// --- isLapsed: past paidUntilDay + grace ---
{
  const d = { paidUntilDay: 10 };
  (isLapsed(d, 16, 7) === false ? ok : bad)('within the grace window, not lapsed');
  (isLapsed(d, 18, 7) === true ? ok : bad)('past paidUntilDay + grace, lapsed');
}

// --- makeDeed: the shared deed-record builder (claim + mine) ---
{
  const claim = makeDeed('claim', 'Henry', 10, 20, 5, { radius: 8 });
  (claim.kind === 'claim' && claim.by === 'Henry' && claim.cx === 10 && claim.cz === 20 ? ok : bad)('makeDeed claim: kind/by/cx/cz set');
  (claim.radius === 8 && claim.depth === 0 ? ok : bad)('makeDeed claim: radius from opts, depth 0');
  (claim.paidUntilDay === 5 + DEED.week && claim.lapsedDay === null ? ok : bad)('makeDeed claim: paid a week from now, not lapsed');
  (typeof claim.id === 'string' && claim.id.length > 0 ? ok : bad)('makeDeed claim: has an id');

  const mine = makeDeed('mine', 'Jimbob', 0, 0, 12, { depth: 10 });
  (mine.kind === 'mine' && mine.radius === 5 && mine.depth === 10 ? ok : bad)('makeDeed mine: radius 5, depth from opts');
  (mine.paidUntilDay === 12 + DEED.week ? ok : bad)('makeDeed mine: paid a week from now');

  const a = makeDeed('claim', 'x', 0, 0, 1, { radius: 4 });
  const b = makeDeed('claim', 'x', 0, 0, 1, { radius: 4, seq: 1 });
  (a.id !== b.id ? ok : bad)('makeDeed: distinct ids when seq differs (no collision in a batch)');
}

// --- lapsesUnderUpkeep: a child's land claim never lapses (no weekly upkeep to manage) ---
{
  (lapsesUnderUpkeep({ kind: 'claim' }, false) === true ? ok : bad)('adult world: a claim lapses under upkeep');
  (lapsesUnderUpkeep({ kind: 'mine' }, false) === true ? ok : bad)('adult world: a mine lapses under upkeep');
  (lapsesUnderUpkeep({ kind: 'claim' }, true) === false ? ok : bad)('bairns world: a claim NEVER lapses (kids keep their land)');
  (lapsesUnderUpkeep({ kind: 'mine' }, true) === true ? ok : bad)('bairns world: a mine still lapses under upkeep');
}

console.log('RESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
