// Shove ha'penny engine check — run wi': node scripts/verify-shoveha.mjs
//
// Contract under test (src/games/shoveha.js, per src/games/ENGINE-CONTRACT.md):
// determinism, the distance accuracy model, first-to-2-coins-in-5-beds scoring,
// the wasted-coin rule, the 40-hand cap tiebreak/draw, JSON round-tripping,
// seeded self-play termination, and applyMove rejecting illegal moves.

import {
  GAME_ID, initState, currentPlayer, legalMoves, applyMove, winner, bestMove,
  summary, accuracyFor, BEDS, COINS_PER_BED, BEDS_TO_WIN, SHOVES_PER_HAND,
  MAX_HANDS, STRENGTHS,
} from '../src/games/shoveha.js';

let failed = false;
const ok  = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// helper: hunt a seed whose first shove at `bed` (best strength) settles,
// starting from a crafted board position
function landingSeed(beds, bed, strength, turn = 0) {
  for (let seed = 0; seed < 5000; seed++) {
    const s = { ...initState(seed), beds: JSON.parse(JSON.stringify(beds)), turn };
    const before = s.beds[bed - 1][turn];
    const after = applyMove(s, { type: 'shove', bed, strength });
    if (after.beds[bed - 1][turn] !== before) return seed;
    // full-bed case: landed-but-wasted is invisible; caller uses missSeedToo below
  }
  return -1;
}

// --- determinism: same seed + same moves -> same state; same bestMove ---
{
  const play = () => {
    let s = initState(42);
    const moves = [
      { type: 'shove', bed: 1, strength: 'soft' },
      { type: 'shove', bed: 9, strength: 'sharp' },
      { type: 'shove', bed: 5, strength: 'firm' },
      { type: 'shove', bed: 3, strength: 'sharp' },
      { type: 'shove', bed: 7, strength: 'soft' },
      { type: 'shove', bed: 2, strength: 'soft' },
    ];
    for (const m of moves) s = applyMove(s, m);
    return s;
  };
  (JSON.stringify(play()) === JSON.stringify(play()) ? ok : bad)('same seed + same moves -> identical state');
  let s = initState(7);
  for (let i = 0; i < 3; i++) s = applyMove(s, { type: 'shove', bed: 4, strength: 'firm' });
  for (const lvl of [1, 2, 3])
    (JSON.stringify(bestMove(s, lvl, 99)) === JSON.stringify(bestMove(s, lvl, 99)) ? ok : bad)('bestMove level ' + lvl + ' deterministic for (state, level, seed)');
}

// --- accuracy model shape: near beds want soft, far beds want sharp ---
{
  (accuracyFor(1, 'soft') > accuracyFor(1, 'sharp') ? ok : bad)('bed 1: soft beats sharp');
  (accuracyFor(9, 'sharp') > accuracyFor(9, 'soft') ? ok : bad)('bed 9: sharp beats soft');
  (accuracyFor(5, 'firm') > accuracyFor(5, 'soft') && accuracyFor(5, 'firm') > accuracyFor(5, 'sharp') ? ok : bad)('bed 5: firm is best');
  (accuracyFor(1, 'soft') === 0.75 && accuracyFor(1, 'firm') === 0.5 && accuracyFor(1, 'sharp') === 0.25 ? ok : bad)('near band table is 0.75/0.5/0.25 for soft/firm/sharp');
  (accuracyFor(9, 'sharp') === 0.75 && accuracyFor(9, 'firm') === 0.5 && accuracyFor(9, 'soft') === 0.25 ? ok : bad)('far band table mirrors it');
  // statistical sanity: over many hash draws, soft on bed 1 actually lands ~3x sharp
  let softLands = 0, sharpLands = 0;
  for (let seed = 0; seed < 400; seed++) {
    const s = initState(seed);
    if (applyMove(s, { type: 'shove', bed: 1, strength: 'soft' }).beds[0][0] === 1) softLands++;
    if (applyMove(s, { type: 'shove', bed: 1, strength: 'sharp' }).beds[0][0] === 1) sharpLands++;
  }
  (softLands > sharpLands * 1.8 ? ok : bad)('hash draws respect the table (bed 1 over 400 seeds: soft ' + softLands + ' vs sharp ' + sharpLands + ')');
}

// --- scoring: 2 coins in 5 distinct beds wins ---
{
  const beds = Array.from({ length: BEDS }, () => [0, 0]);
  for (let i = 0; i < 4; i++) beds[i][0] = COINS_PER_BED; // beds 1-4 full
  beds[4][0] = 1;                                          // one shy in bed 5
  const seed = landingSeed(beds, 5, 'firm');
  if (seed < 0) bad('could not find a landing seed for the scoring case');
  else {
    const s = { ...initState(seed), beds: JSON.parse(JSON.stringify(beds)) };
    (winner(s) === null ? ok : bad)('4 full beds + 1 coin is not yet a win');
    const after = applyMove(s, { type: 'shove', bed: 5, strength: 'firm' });
    (winner(after) === 0 ? ok : bad)('landing the 2nd coin in a 5th bed wins the game');
    (legalMoves(after).length === 0 ? ok : bad)('no legal moves once won');
  }
}

// --- wasted-coin rule: a full bed accepts nothing more ---
{
  const beds = Array.from({ length: BEDS }, () => [0, 0]);
  beds[0][0] = COINS_PER_BED; // bed 1 already full for player 0
  let capped = true, totalBefore = COINS_PER_BED;
  for (let seed = 0; seed < 200; seed++) {
    const s = { ...initState(seed), beds: JSON.parse(JSON.stringify(beds)) };
    const after = applyMove(s, { type: 'shove', bed: 1, strength: 'soft' });
    if (after.beds[0][0] !== totalBefore) capped = false;
  }
  (capped ? ok : bad)('coin shoved at an already-full bed is wasted over 200 seeds (never exceeds ' + COINS_PER_BED + ')');
}

// --- turn cap: 40 hands -> totals tiebreak, equal = draw ---
{
  const mk = (p0coins, p1coins) => {
    const s = initState(1);
    s.turnCount = MAX_HANDS;
    s.beds[0][0] = p0coins;
    s.beds[1][1] = p1coins;
    return s;
  };
  (winner(mk(2, 1)) === 0 ? ok : bad)('at the cap, more landed coins wins (player 0)');
  (winner(mk(1, 2)) === 1 ? ok : bad)('at the cap, more landed coins wins (player 1)');
  (winner(mk(2, 2)) === 'draw' ? ok : bad)('at the cap, equal coins is a draw');
  (winner({ ...mk(2, 1), turnCount: MAX_HANDS - 1 }) === null ? ok : bad)('one hand before the cap the game is still live');
}

// --- JSON round-trip (relay serialises verbatim) ---
{
  let s = initState(13);
  s = applyMove(s, { type: 'shove', bed: 6, strength: 'firm' });
  (JSON.stringify(JSON.parse(JSON.stringify(s))) === JSON.stringify(s) ? ok : bad)('state round-trips JSON unchanged');
  const m = bestMove(s, 2, 5);
  (JSON.stringify(JSON.parse(JSON.stringify(m))) === JSON.stringify(m) ? ok : bad)('move round-trips JSON unchanged');
}

// --- legality: every legalMoves entry applies cleanly; illegal moves throw ---
{
  const s = initState(3);
  let allApply = true;
  for (const m of legalMoves(s)) { try { applyMove(s, m); } catch { allApply = false; } }
  (allApply && legalMoves(s).length === BEDS * STRENGTHS.length ? ok : bad)('all ' + BEDS * STRENGTHS.length + ' legal moves apply cleanly');
  const throws = m => { try { applyMove(s, m); return false; } catch { return true; } };
  (throws({ type: 'shove', bed: 0, strength: 'soft' }) ? ok : bad)('bed 0 throws');
  (throws({ type: 'shove', bed: 10, strength: 'soft' }) ? ok : bad)('bed 10 throws');
  (throws({ type: 'shove', bed: 2.5, strength: 'soft' }) ? ok : bad)('fractional bed throws');
  (throws({ type: 'shove', bed: 5, strength: 'wallop' }) ? ok : bad)('unknown strength throws');
  (throws({ type: 'slide', bed: 5, strength: 'soft' }) ? ok : bad)('wrong move type throws');
}

// --- termination: seeded self-play ends within the bounded shove count ---
{
  for (const seed of [1, 2, 3, 4, 5]) {
    let s = initState(seed), shoves = 0;
    const capShoves = MAX_HANDS * SHOVES_PER_HAND + 1;
    while (winner(s) === null && shoves < capShoves + 5) {
      const lvl = currentPlayer(s) === 0 ? 3 : 1 + (seed % 3);
      s = applyMove(s, bestMove(s, lvl, seed));
      shoves++;
    }
    const w = winner(s);
    (w !== null && shoves <= capShoves ? ok : bad)('self-play seed ' + seed + ' terminates in ' + shoves + ' shoves -> ' + w);
  }
  (typeof summary(initState(0)) === 'string' && summary(initState(0)).length > 0 ? ok : bad)('summary returns a human string');
  (GAME_ID === 'shoveha' && BEDS_TO_WIN === 5 ? ok : bad)('exports GAME_ID/BEDS_TO_WIN as specced');
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
