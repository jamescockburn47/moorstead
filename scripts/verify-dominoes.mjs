// Dominoes rules-engine check — run wi': node scripts/verify-dominoes.mjs
//
// Defends the block-dominoes contract (src/games/ENGINE-CONTRACT.md):
// deterministic deal + bestMove, the opening rule (highest double, else
// highest tile), matching legality (knock is ILLEGAL while a play exists),
// domino-out and blocked-game outcomes, JSON round-trip, bounded self-play,
// and applyMove throwing on illegal moves. Headless Node only; all
// randomness seeded (INVARIANTS rule 6).

import {
  GAME_ID, GAME_LABEL, initState, currentPlayer, legalMoves, applyMove,
  winner, bestMove, summary,
} from '../src/games/dominoes.js';

let failed = false;
const ok  = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const J = x => JSON.stringify(x);
const canon = t => (t[0] >= t[1] ? [t[0], t[1]] : [t[1], t[0]]);
const pips = h => h.reduce((s, t) => s + t[0] + t[1], 0);

// --- deal: 28 distinct tiles, 7+7+14, identical per seed ---
{
  const s1 = initState(42), s2 = initState(42), s3 = initState(43);
  (J(s1) === J(s2) ? ok : bad)('initState deals identically for the same seed');
  (J(s1.hands) !== J(s3.hands) ? ok : bad)('a different seed deals a different hand');
  const all = [...s1.hands[0], ...s1.hands[1], ...s1.boneyard];
  const uniq = new Set(all.map(t => J(canon(t))));
  (all.length === 28 && uniq.size === 28 ? ok : bad)('full double-six set: 28 distinct tiles across hands + boneyard');
  (s1.hands[0].length === 7 && s1.hands[1].length === 7 && s1.boneyard.length === 14
    ? ok : bad)('7 tiles each, 14 in the boneyard (kept, never drawn in block play)');
}

// --- opening rule: highest double opens; else highest tile; opener forced ---
{
  let sawDouble = false, sawNoDouble = false;
  for (let seed = 0; seed < 10000 && !(sawDouble && sawNoDouble); seed++) {
    const s = initState(seed);
    const doubles = [];
    for (let p = 0; p < 2; p++) for (const t of s.hands[p]) if (t[0] === t[1]) doubles.push({ p, t });
    const moves = legalMoves(s);
    if (moves.length !== 1 || moves[0].type !== 'play') { bad(`seed ${seed}: opening move not forced`); break; }
    const open = canon(moves[0].tile);
    if (doubles.length && !sawDouble) {
      sawDouble = true;
      const hi = doubles.reduce((a, b) => (b.t[0] > a.t[0] ? b : a));
      (open[0] === hi.t[0] && open[1] === hi.t[1] && s.turn === hi.p
        ? ok : bad)(`seed ${seed}: highest double [${hi.t}] opens, held by player ${hi.p}`);
    }
    if (!doubles.length && !sawNoDouble) {
      sawNoDouble = true;
      const rank = t => (t[0] + t[1]) * 10 + Math.max(t[0], t[1]);
      let best = null, holder = 0;
      for (let p = 0; p < 2; p++) for (const t of s.hands[p]) {
        if (!best || rank(t) > rank(best)) { best = t; holder = p; }
      }
      (open[0] === best[0] && open[1] === best[1] && s.turn === holder
        ? ok : bad)(`seed ${seed}: no doubles anywhere — highest tile [${best}] opens`);
    }
  }
  (sawDouble ? ok : bad)('found a deal with doubles to test the opening rule');
  (sawNoDouble ? ok : bad)('found a no-doubles deal within 10000 seeds to test the fallback rule');
}

// --- matching legality: every play matches an end; knock illegal when a play exists ---
{
  let s = initState(7);
  s = applyMove(s, legalMoves(s)[0]); // opening tile down
  const [L, R] = [s.line[0][0], s.line[s.line.length - 1][1]];
  const moves = legalMoves(s);
  const allMatch = moves.every(m => m.type === 'knock' ||
    (m.end === 'L' ? (m.tile[0] === L || m.tile[1] === L) : (m.tile[0] === R || m.tile[1] === R)));
  (allMatch ? ok : bad)('every legal play matches the end it is played to');
  if (moves.some(m => m.type === 'play')) {
    let threw = false;
    try { applyMove(s, { type: 'knock' }); } catch (e) { threw = /illegal/.test(e.message); }
    (threw ? ok : bad)('knock throws "illegal move" while a play exists');
  } else bad('seed 7 turn 2 unexpectedly had no plays — pick another seed for the knock test');
  // a tile the player does not hold, and a non-matching end, both throw
  const notHeld = (() => {
    const held = new Set([...s.hands[s.turn]].map(t => J(canon(t))));
    for (let hi = 0; hi <= 6; hi++) for (let lo = 0; lo <= hi; lo++) {
      if (!held.has(J([hi, lo])) && hi !== L && lo !== L) return [hi, lo];
    }
  })();
  let threw2 = false;
  try { applyMove(s, { type: 'play', tile: notHeld, end: 'L' }); } catch (e) { threw2 = /illegal/.test(e.message); }
  (threw2 ? ok : bad)('applyMove throws on an unheld, non-matching tile [' + notHeld + ']');
  // legality: every legalMoves entry applies cleanly
  let clean = true;
  for (const m of moves) { try { applyMove(s, m); } catch { clean = false; } }
  (clean ? ok : bad)('every legalMoves entry applies without throwing');
}

// --- orientation: the line stays chained after a flipped-tile move ---
{
  let s = initState(7);
  for (let i = 0; i < 6 && winner(s) === null; i++) {
    const m = legalMoves(s)[0];
    if (m.type === 'play') m.tile = [m.tile[1], m.tile[0]]; // hand it over backwards
    s = applyMove(s, m);
  }
  const chained = s.line.every((t, i) => i === 0 || s.line[i - 1][1] === t[0]);
  (chained ? ok : bad)('tiles flip to match: line[i-1][1] === line[i][0] throughout');
}

// --- domino-out win: emptying the hand wins immediately ---
{
  // Constructed endgame: player 0 holds one matching tile.
  const s = {
    game: GAME_ID, seed: 0,
    hands: [[[6, 2]], [[5, 4], [3, 3]]],
    boneyard: [], line: [[2, 6], [6, 6]], opening: [6, 6],
    turn: 0, knocks: 0, done: null,
  };
  const out = applyMove(s, { type: 'play', tile: [6, 2], end: 'L' });
  (winner(out) === 0 ? ok : bad)('a player who dominoes (empties their hand) wins the hand');
  (summary(out).includes('dominoed') ? ok : bad)('summary reports the domino-out');
}

// --- blocked game: two consecutive knocks; lightest pips wins; equal = draw ---
{
  const base = {
    game: GAME_ID, seed: 0, boneyard: [], line: [[1, 1]], opening: [1, 1],
    turn: 0, knocks: 0, done: null,
  };
  // neither hand holds a 1 → both must knock
  const sA = { ...base, hands: [[[5, 4]], [[6, 6]]] }; // 9 vs 12
  const a1 = applyMove(sA, { type: 'knock' });
  (winner(a1) === null && a1.turn === 1 ? ok : bad)('first knock passes play; game continues');
  ((legalMoves(a1)[0] || {}).type === 'knock' ? ok : bad)('knock is the only legal move with no matching tile');
  const a2 = applyMove(a1, { type: 'knock' });
  (winner(a2) === 0 ? ok : bad)('blocked game: lightest pip total (9 v 12) wins');
  const sB = { ...base, hands: [[[5, 4]], [[6, 3]]] }; // 9 vs 9
  const b2 = applyMove(applyMove(sB, { type: 'knock' }), { type: 'knock' });
  (winner(b2) === 'draw' ? ok : bad)('blocked game with equal pips is a draw');
  // a knock resets when the next player CAN play
  const sC = { ...base, hands: [[[5, 4]], [[1, 3], [6, 6]]] };
  const c1 = applyMove(sC, { type: 'knock' });
  const c2 = applyMove(c1, { type: 'play', tile: [1, 3], end: 'R' });
  (c2.knocks === 0 && winner(c2) === null ? ok : bad)('a play after a knock resets the knock count');
}

// --- bestMove: deterministic, legal, level-shaped ---
{
  let s = initState(11);
  s = applyMove(s, legalMoves(s)[0]);
  s = applyMove(s, bestMove(s, 2, 5));
  for (const level of [1, 2, 3]) {
    const m1 = bestMove(s, level, 99), m2 = bestMove(s, level, 99);
    (J(m1) === J(m2) ? ok : bad)(`bestMove level ${level} is deterministic for (state, level, seed)`);
    const legal = legalMoves(s).some(x => J(x) === J(m1));
    (legal ? ok : bad)(`bestMove level ${level} returns a legal move`);
  }
  // level 2 greedy: picks a maximal-pip playable tile
  const m2 = bestMove(s, 2, 3);
  const maxPips = Math.max(...legalMoves(s).map(x => x.tile[0] + x.tile[1]));
  (m2.tile[0] + m2.tile[1] === maxPips ? ok : bad)('level 2 greedy sheds a highest-pip playable tile');
}

// --- JSON round-trip: state and moves serialise verbatim (PvP relay) ---
{
  let s = initState(5);
  s = applyMove(s, legalMoves(s)[0]);
  const rt = JSON.parse(JSON.stringify(s));
  (J(rt) === J(s) ? ok : bad)('state round-trips JSON.parse(JSON.stringify) unchanged');
  const m = bestMove(s, 3, 1);
  const mrt = JSON.parse(JSON.stringify(m));
  (J(applyMove(rt, mrt)) === J(applyMove(s, m)) ? ok : bad)('round-tripped state + move replays to the identical position');
}

// --- seeded self-play terminates within 60 moves, outcome consistent ---
{
  let sawDominoOut = false, sawBlocked = false;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) {
    let s = initState(seed), n = 0;
    while (winner(s) === null && n < 60) { s = applyMove(s, bestMove(s, ((seed + n) % 3) + 1, seed)); n++; }
    if (winner(s) === null) { bad(`seed ${seed}: self-play did not terminate within 60 moves`); continue; }
    const w = winner(s);
    if (s.hands[0].length === 0 || s.hands[1].length === 0) {
      sawDominoOut = true;
      if (w !== (s.hands[0].length === 0 ? 0 : 1)) bad(`seed ${seed}: domino-out winner wrong`);
    } else {
      sawBlocked = true;
      const p0 = pips(s.hands[0]), p1 = pips(s.hands[1]);
      const expect = p0 < p1 ? 0 : p1 < p0 ? 1 : 'draw';
      if (w !== expect) bad(`seed ${seed}: blocked-game winner should be ${expect}, got ${w}`);
    }
    (currentPlayer(s) === 0 || currentPlayer(s) === 1 ? ok : bad)(`seed ${seed}: terminated in ${n} moves — ${summary(s)}`);
  }
  (sawDominoOut ? ok : bad)('self-play set includes at least one domino-out finish');
  (sawBlocked ? ok : bad)('self-play set includes at least one blocked finish');
}

// --- moving after the game is over is impossible ---
{
  const s = { game: GAME_ID, seed: 0, hands: [[], [[1, 1]]], boneyard: [], line: [[2, 2]], opening: [2, 2], turn: 1, knocks: 0, done: 0 };
  (legalMoves(s).length === 0 ? ok : bad)('no legal moves once the hand is decided');
  let threw = false;
  try { applyMove(s, { type: 'knock' }); } catch { threw = true; }
  (threw ? ok : bad)('applyMove throws after the game is over');
}

(GAME_ID === 'dominoes' && GAME_LABEL === 'Dominoes' ? ok : bad)('GAME_ID / GAME_LABEL match the contract');

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
