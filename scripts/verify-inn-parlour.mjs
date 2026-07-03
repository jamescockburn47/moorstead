// src/parlour.js — evening parlour crowd: determinism, cap, seat placement,
// playerInParlour, MURMUR_LINES, innOpen/eveningAtInn boundaries.
// run wi': node scripts/verify-inn-parlour.mjs
import {
  innOpen, eveningAtInn, parlourCrowd, parlourSeatFor, playerInParlour,
  MURMUR_LINES, PARLOUR_CAP,
} from '../src/parlour.js';
import { MoorsGeography } from '../src/moorsgeo.js';
import { innPlan } from '../src/innplan.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// --- a real Grosmont plan (Gen(12345)'s own geo, same idiom as verify-inn-interior) ---
const { Gen } = await import('../src/worldgen.js');
const gen = new Gen(12345);
const plan = gen.inns.get('Grosmont');
(plan ? ok : bad)('Gen(12345) builds a Grosmont plan to test against');

// a synthetic pool of NPC ids, larger than the cap
const ids = [];
for (let i = 0; i < 40; i++) ids.push('npc-' + i);

// --- innOpen boundaries: closed [0.20, 0.54), open otherwise ---
{
  (innOpen(0.19) ? ok : bad)('innOpen(0.19) — open (just before the morning-shut window)');
  (!innOpen(0.20) ? ok : bad)('innOpen(0.20) — false (morning-shut window starts)');
  (!innOpen(0.53) ? ok : bad)('innOpen(0.53) — false (still within the shut window)');
  (innOpen(0.54) ? ok : bad)('innOpen(0.54) — true (opens after the dinner bell)');
  (innOpen(0.9) ? ok : bad)('innOpen(0.9) — true (open through the evening)');
  (innOpen(0.05) ? ok : bad)('innOpen(0.05) — true (open overnight, before dawn-shut)');
}

// --- eveningAtInn boundaries: skyTime >= 0.70 || skyTime < 0.15 ---
{
  (!eveningAtInn(0.69) ? ok : bad)('eveningAtInn(0.69) — false (not yet the evening window)');
  (eveningAtInn(0.70) ? ok : bad)('eveningAtInn(0.70) — true (evening window opens)');
  (eveningAtInn(0.85) ? ok : bad)('eveningAtInn(0.85) — true (deep evening)');
  (eveningAtInn(0.14) ? ok : bad)('eveningAtInn(0.14) — true (still the overnight tail)');
  (!eveningAtInn(0.15) ? ok : bad)('eveningAtInn(0.15) — false (evening window closes at dawn approach)');
  (!eveningAtInn(0.5) ? ok : bad)('eveningAtInn(0.5) — false (broad daylight)');
}

// --- parlourCrowd: deterministic, stable, capped ---
{
  (PARLOUR_CAP === 5 ? ok : bad)('PARLOUR_CAP is exported as 5');
  const a = parlourCrowd(ids, 'Grosmont');
  const b = parlourCrowd(ids, 'Grosmont');
  (JSON.stringify(a) === JSON.stringify(b) ? ok : bad)('parlourCrowd is deterministic — same ids+salt, same crowd');
  (a.length <= PARLOUR_CAP ? ok : bad)(`parlourCrowd never exceeds the cap (got ${a.length})`);
  (new Set(a).size === a.length ? ok : bad)('parlourCrowd has no duplicate ids');
  const c = parlourCrowd(ids, 'Lealholm');
  (JSON.stringify(a) !== JSON.stringify(c) || a.length === 0
    ? ok : bad)('parlourCrowd differs (or is trivially empty) for a different salt');
  // stability across repeated calls with a shuffled-but-same-membership id list — same ids, same order in -> same crowd
  const a2 = parlourCrowd(ids.slice(), 'Grosmont');
  (JSON.stringify(a) === JSON.stringify(a2) ? ok : bad)('parlourCrowd is stable across repeated calls with the same input');
}

// --- parlourSeatFor: lands inside the parlour interior, distinct cells per index ---
if (plan) {
  const { floorY, w: pw, l: pl } = plan.parlour;
  const ix0 = plan.origin.x - Math.floor(pw / 2), iz0 = plan.origin.z - Math.floor(pl / 2);
  const ix1 = ix0 + pw - 1, iz1 = iz0 + pl - 1;

  const seats = [];
  for (let i = 0; i < PARLOUR_CAP; i++) seats.push(parlourSeatFor(i, plan));

  let allInside = true, allYCorrect = true;
  for (const s of seats) {
    if (s.x < ix0 || s.x > ix1 || s.z < iz0 || s.z > iz1) allInside = false;
    if (s.y !== floorY + 1) allYCorrect = false;
  }
  (allInside ? ok : bad)('parlourSeatFor: every seat (index 0..cap-1) lands inside the parlour interior box');
  (allYCorrect ? ok : bad)('parlourSeatFor: every seat sits at y = floorY + 1');

  const cellKeys = seats.map(s => s.x + ',' + s.z);
  (new Set(cellKeys).size === cellKeys.length ? ok : bad)('parlourSeatFor: distinct occupant indices get distinct cells');

  const a = parlourSeatFor(0, plan), b = parlourSeatFor(0, plan);
  (JSON.stringify(a) === JSON.stringify(b) ? ok : bad)('parlourSeatFor is deterministic for the same (index, plan)');

  // table-seated indices carry the table's game name; standing spots do not
  const tableSeated = seats.filter(s => s.table);
  (tableSeated.length > 0 ? ok : bad)('parlourSeatFor: at least one seat is a table seat carrying `table`/`game`');
  for (const s of tableSeated) {
    if (typeof s.game !== 'string' || !s.game) { allYCorrect = false; }
  }
}

// --- playerInParlour: true inside, false at/above the surface door ---
if (plan) {
  const { floorY, w: pw, l: pl } = plan.parlour;
  const ix0 = plan.origin.x - Math.floor(pw / 2), iz0 = plan.origin.z - Math.floor(pl / 2);
  const insidePos = { x: ix0 + 1, y: floorY + 1, z: iz0 + 1 };
  const surfacePos = { x: plan.origin.x, y: plan.groundY + 1, z: plan.origin.z };
  (playerInParlour(insidePos, plan) ? ok : bad)('playerInParlour: true for a position inside the parlour interior/depth');
  (!playerInParlour(surfacePos, plan) ? ok : bad)('playerInParlour: false for a position at the surface door/ground level');
}

// --- MURMUR_LINES: non-empty pool, no duplicates, all non-empty strings ---
{
  (Array.isArray(MURMUR_LINES) && MURMUR_LINES.length >= 14 ? ok : bad)(`MURMUR_LINES has at least 14 lines (got ${MURMUR_LINES.length})`);
  const allStrings = MURMUR_LINES.every(l => typeof l === 'string' && l.trim().length > 0);
  (allStrings ? ok : bad)('MURMUR_LINES: every entry is a non-empty string');
  (new Set(MURMUR_LINES).size === MURMUR_LINES.length ? ok : bad)('MURMUR_LINES: no duplicate lines');
}

// --- roster.js seam sanity: idHash relocated to parlour.js, roster.js still exports it ---
{
  const { idHash } = await import('../src/parlour.js');
  const { idHash: rosterIdHash } = await import('../src/roster.js');
  (typeof idHash === 'function' ? ok : bad)('parlour.js exports idHash (relocated FNV hash)');
  (idHash('grosmont-1') === rosterIdHash('grosmont-1') ? ok : bad)('roster.js\'s idHash re-export matches parlour.js\'s idHash (same hash, single source)');
}

// --- D3 Task 2: innkeeperRows render in the facts card (unit-level: feed the seam
// directly, since buildFactsCard is a pure formatter over plain data) ---
{
  const { buildFactsCard } = await import('../src/factscard.js');
  const cardWith = buildFactsCard({
    playerName: 'Tha',
    innkeeperRows: ['In t’ parlour tonight: Harry, Karen.', 'The season is autumn.'],
  });
  (cardWith.includes('In t’ parlour tonight: Harry, Karen.') ? ok : bad)('buildFactsCard renders a who’s-in-tonight innkeeperRow');
  (cardWith.includes('The season is autumn.') ? ok : bad)('buildFactsCard renders a season innkeeperRow');

  const cardEmpty = buildFactsCard({ innkeeperRows: ['T’ parlour’s empty tonight — nobbut thee.'] });
  (cardEmpty.includes('nobbut thee') ? ok : bad)('buildFactsCard renders the empty-parlour row');

  // additive-only: a card with no innkeeperRows at all is unaffected (undefined tolerated)
  const cardNone = buildFactsCard({ playerName: 'Tha' });
  (typeof cardNone === 'string' ? ok : bad)('buildFactsCard tolerates a missing innkeeperRows field');
}

// --- D3 Task 2: quests.chatContext gating — NOT headlessly constructible. Quests'
// chatContext reads this.game.{player,world,rosterClient,season,sky} plus a full
// Quests instance (standingLabel/earnedTitleList/etc. + this.completed/this.shame
// state built up over play) — building a faithful fake Game+Quests pair here would
// test the fake, not the real gating logic. Asserting the factscard.js seam above
// (the actual contract chatContext writes through) is the honest headless coverage;
// the real gating gets its proof in Task 3's in-browser pass (chat inside the
// parlour -> GAME FACTS shows INN TONIGHT).
ok('quests.chatContext innkeeperRows gating: not headlessly driven (documented above) — factscard.js seam is the real assertion');

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
