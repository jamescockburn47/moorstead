// Merrils (Nine Men's Morris) rules-engine check — run wi': node scripts/verify-merrils.mjs
//
// Headless Node only. Tests the ENGINE-CONTRACT.md surface (determinism,
// legality, termination, game-specific rules), not internals.

import {
  GAME_ID,
  GAME_LABEL,
  MILLS,
  ADJ,
  initState,
  currentPlayer,
  legalMoves,
  applyMove,
  winner,
  bestMove,
  summary,
} from '../src/games/merrils.js';

let failed = false;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failed = true; console.log('  FAIL  ' + m); };

function boardWith(assignments) {
  const board = new Array(24).fill(null);
  for (const [p, v] of assignments) board[p] = v;
  return board;
}

function stateWith(overrides) {
  return { ...initState(0), ...overrides };
}

// --- contract surface exists ---
{
  (GAME_ID === 'merrils' ? ok : bad)('GAME_ID is "merrils"');
  (typeof GAME_LABEL === 'string' && GAME_LABEL.length > 0 ? ok : bad)('GAME_LABEL is a non-empty string');
  ([initState, currentPlayer, legalMoves, applyMove, winner, bestMove, summary].every((f) => typeof f === 'function') ? ok : bad)(
    'all contract functions exported'
  );
}

// --- determinism ---
{
  const s1 = initState(42);
  const s2 = initState(42);
  (JSON.stringify(s1) === JSON.stringify(s2) ? ok : bad)('initState(seed) is deterministic for same seed');

  const st = initState(7);
  const m1 = bestMove(st, 2, 5);
  const m2 = bestMove(st, 2, 5);
  (JSON.stringify(m1) === JSON.stringify(m2) ? ok : bad)('bestMove(state, level, seed) is deterministic');
}

// --- JSON round-trip ---
{
  const st = initState(1);
  const rt = JSON.parse(JSON.stringify(st));
  (JSON.stringify(rt) === JSON.stringify(st) ? ok : bad)('initState round-trips through JSON unchanged');

  const moves = legalMoves(st);
  const mv = moves[0];
  const mvRt = JSON.parse(JSON.stringify(mv));
  (JSON.stringify(mvRt) === JSON.stringify(mv) ? ok : bad)('a legal move round-trips through JSON unchanged');

  const next = applyMove(st, mv);
  const nextRt = JSON.parse(JSON.stringify(next));
  (JSON.stringify(nextRt) === JSON.stringify(next) ? ok : bad)('post-move state round-trips through JSON unchanged');
}

// --- all 16 mill lines fire ---
{
  (MILLS.length === 16 ? ok : bad)('exactly 16 mill lines defined');

  let allFire = true;
  for (const mill of MILLS) {
    const [a, b, c] = mill;
    // Placing phase: player 0 already occupies a,b; player 1 has a single
    // man sitting somewhere outside this mill line so there's something to
    // capture. Player 0 places on c, completing the mill.
    const decoy = [...Array(24).keys()].find((p) => !mill.includes(p));
    const board = new Array(24).fill(null);
    board[a] = 0;
    board[b] = 0;
    board[decoy] = 1;
    const placingState = stateWith({
      board,
      phase: 'placing',
      placed: [2, 1],
      onBoard: [2, 1],
      turn: 0,
    });
    const moves = legalMoves(placingState);
    const placeC = moves.find((m) => m.type === 'place' && m.to === c);
    if (!placeC || placeC.remove !== decoy) {
      allFire = false;
      bad(`mill line [${mill.join(',')}] did not register a capture when completed`);
    }
  }
  if (allFire) ok('all 16 mill lines register a capture when completed');
}

// --- placing -> moving phase transition ---
{
  let st = initState(0);
  for (let i = 0; i < 18; i++) {
    (st.phase === (i < 18 ? 'placing' : 'moving') ? ok : bad)(`ply ${i}: still in placing phase`);
    const moves = legalMoves(st);
    if (moves.length === 0) { bad('ran out of legal placing moves early'); break; }
    // avoid forming mills during this generic walk so removal doesn't complicate counts —
    // pick a no-removal move if one exists, else take the first.
    const quiet = moves.find((m) => m.remove === null) ?? moves[0];
    st = applyMove(st, quiet);
  }
  (st.phase === 'moving' ? ok : bad)('after 18 placements (9 each) phase is "moving"');
  (st.placed[0] === 9 && st.placed[1] === 9 ? ok : bad)('both sides have placed all 9 men');
}

// --- moving phase: only adjacent slides are legal (non-flying) ---
{
  const board = new Array(24).fill(null);
  board[0] = 0; // player 0 man at point 0, adjacent to 1 and 7
  board[10] = 1;
  board[11] = 1;
  board[12] = 1;
  const st = stateWith({
    board,
    phase: 'moving',
    placed: [9, 9],
    onBoard: [4, 3], // player0 has 4 men elsewhere too (not placed on board here, but count must be consistent)
    turn: 0,
  });
  // onBoard[0] should match board occupancy for a well-formed state; fix it up:
  const count0 = board.filter((v) => v === 0).length;
  st.onBoard[0] = count0;
  const moves = legalMoves(st).filter((m) => m.type === 'move' && m.from === 0);
  const dests = new Set(moves.map((m) => m.to));
  const expected = new Set(ADJ[0]);
  const onlyAdjacent = [...dests].every((d) => expected.has(d));
  (onlyAdjacent && dests.size > 0 ? ok : bad)('non-flying move only targets adjacent empty points');
  (!dests.has(5) ? ok : bad)('non-flying move cannot jump to a non-adjacent point');
}

// --- flying phase: 3 men may move anywhere ---
{
  const board = new Array(24).fill(null);
  board[0] = 0;
  board[10] = 0;
  board[20] = 0; // player 0 down to 3 men, none adjacent to point 0's far side
  board[1] = 1;
  board[2] = 1;
  const st = stateWith({
    board,
    phase: 'moving',
    placed: [9, 9],
    onBoard: [3, 2],
    turn: 0,
  });
  const moves = legalMoves(st).filter((m) => m.type === 'move' && m.from === 0);
  const dests = new Set(moves.map((m) => m.to));
  // point 21 is far from point 0 and not adjacent — flying should reach it
  (dests.has(21) ? ok : bad)('flying (3 men) can move to a non-adjacent empty point');
}

// --- removal preference: cannot take a milled man while free men exist ---
{
  // opponent (player1) has a formed mill [8,9,10] plus one free man at 15
  const board = new Array(24).fill(null);
  board[8] = 1; board[9] = 1; board[10] = 1; // mill
  board[15] = 1; // free man
  board[0] = 0; board[1] = 0; // player0 about to complete a mill at point 2
  const st = stateWith({
    board,
    phase: 'placing',
    placed: [2, 4],
    onBoard: [2, 4],
    turn: 0,
  });
  const moves = legalMoves(st).filter((m) => m.type === 'place' && m.to === 2);
  const removals = new Set(moves.map((m) => m.remove));
  (removals.has(15) ? ok : bad)('removal targets the free (non-milled) man');
  (!removals.has(8) && !removals.has(9) && !removals.has(10) ? ok : bad)('removal excludes milled men while a free man exists');
}

// --- removal preference: all opponent men in mills -> any may be taken ---
{
  const board = new Array(24).fill(null);
  board[8] = 1; board[9] = 1; board[10] = 1; // player1's only men, all in one mill
  board[0] = 0; board[1] = 0;
  const st = stateWith({
    board,
    phase: 'placing',
    placed: [2, 3],
    onBoard: [2, 3],
    turn: 0,
  });
  const moves = legalMoves(st).filter((m) => m.type === 'place' && m.to === 2);
  const removals = new Set(moves.map((m) => m.remove));
  (removals.has(8) && removals.has(9) && removals.has(10) ? ok : bad)('when all opponent men are milled, any may be taken');
}

// --- loss by reduction to 2 men ---
{
  const board = new Array(24).fill(null);
  board[0] = 0; board[1] = 0; // player0: 2 men only
  board[10] = 1; board[11] = 1; board[12] = 1;
  const st = stateWith({
    board,
    phase: 'moving',
    placed: [9, 9],
    onBoard: [2, 3],
    turn: 1,
  });
  (winner(st) === 1 ? ok : bad)('player reduced to 2 men (post-placing) has lost — opponent (player 1) wins');
}

// --- loss by no legal moves ---
{
  // player0 has 4 men, all four inner-ring corners (16,18,20,22), each fully
  // boxed by player1 men on both of its neighbours. Inner-ring adjacency:
  // 16<->17,23 / 18<->17,19 / 20<->19,21 / 22<->21,23 — so player1 occupying
  // the four inner mid-points (17,19,21,23) boxes in all four corners at
  // once, with no overlap conflicts. 4 men keeps player0 out of the 3-man
  // flying rule.
  const board = new Array(24).fill(null);
  board[16] = 0; board[18] = 0; board[20] = 0; board[22] = 0;
  board[17] = 1; board[19] = 1; board[21] = 1; board[23] = 1;
  const st = stateWith({
    board,
    phase: 'moving',
    placed: [9, 9],
    onBoard: [4, 4],
    turn: 0,
  });
  const moves = legalMoves(st);
  (moves.length === 0 ? ok : bad)(`player with no legal moves (boxed in, non-flying) has zero legalMoves (got ${moves.length})`);
  (winner(st) === 1 ? ok : bad)('opponent is declared winner when mover is stalemated');
}

// --- applyMove throws on illegal move ---
{
  const st = initState(0);
  let threw = false;
  try {
    applyMove(st, { type: 'place', to: 0, remove: 5 }); // fabricated bogus removal
  } catch (e) {
    threw = e instanceof Error && /illegal/i.test(e.message);
  }
  (threw ? ok : bad)('applyMove throws Error("illegal move") on a fabricated illegal move');

  let threw2 = false;
  try {
    applyMove(st, { type: 'move', from: 0, to: 1, remove: null }); // no man at 0 yet in placing phase
  } catch (e) {
    threw2 = e instanceof Error && /illegal/i.test(e.message);
  }
  (threw2 ? ok : bad)('applyMove throws on a move-type move during the placing phase');
}

// --- currentPlayer / summary sanity ---
{
  const st = initState(0);
  (currentPlayer(st) === 0 ? ok : bad)('player 0 (challenger) moves first');
  (typeof summary(st) === 'string' && summary(st).length > 0 ? ok : bad)('summary returns a non-empty string');
}

// --- full seeded self-play terminates with a winner or draw ---
{
  let st = initState(123);
  let plies = 0;
  const MAX_PLIES = 300;
  while (winner(st) === null && plies < MAX_PLIES) {
    const mv = bestMove(st, 2, 999 + plies);
    if (!mv) break;
    st = applyMove(st, mv);
    plies++;
  }
  const w = winner(st);
  (plies < MAX_PLIES ? ok : bad)(`self-play terminated before the ${MAX_PLIES}-ply safety cap (took ${plies} plies)`);
  (w === 0 || w === 1 || w === 'draw' ? ok : bad)(`self-play ended with a winner or draw (got ${JSON.stringify(w)})`);

  // repeat with a different seed to sanity-check it isn't a fluke of one seed
  let st2 = initState(9001);
  let plies2 = 0;
  while (winner(st2) === null && plies2 < MAX_PLIES) {
    const mv = bestMove(st2, 2, 42 + plies2);
    if (!mv) break;
    st2 = applyMove(st2, mv);
    plies2++;
  }
  (plies2 < MAX_PLIES ? ok : bad)(`second seeded self-play also terminates before ${MAX_PLIES} plies (took ${plies2})`);
}

// --- determinism of a full self-play run (same seeds -> same game) ---
{
  function run(seed) {
    let st = initState(seed);
    let plies = 0;
    const log = [];
    while (winner(st) === null && plies < 300) {
      const mv = bestMove(st, 2, 555 + plies);
      if (!mv) break;
      st = applyMove(st, mv);
      log.push(mv);
      plies++;
    }
    return { log, w: winner(st) };
  }
  const a = run(77);
  const b = run(77);
  (JSON.stringify(a) === JSON.stringify(b) ? ok : bad)('identical seed produces an identical self-play game log');
}

// --- bestMove strength: level 3 must reliably beat level 1 ---
//
// Reviewed defect: depth-3 search + material/mill/mobility-only evaluate()
// couldn't see mill THREATS (2-in-a-line, 3rd point empty) and lost to
// merrils' huge branching factor — level 3 scored only 37.5% in the worst
// of six 8-game mixed-colour seeded windows (aggregate ~62.5%, well under
// draughts' 87.5-100% on the identical harness). Fix: DEPTH_BY_LEVEL widens
// level 3 to depth 4, evaluate() adds a mill-threat term (+blocked-men
// penalty), and negamax orders capturing moves first.
//
// This is the trimmed, CI-affordable slice of the full 6-window benchmark:
// 2 windows x 8 games (seeds 0 and 50 — base=50 was the worst-scoring
// window pre-fix, so it stays in the gate). Full 6-window run (base seeds
// 0/50/100/200/300/500), measured after the fix, for the record:
//   base=0:   8  /8 (100.0%)
//   base=50:  7  /8 ( 87.5%)
//   base=100: 7  /8 ( 87.5%)
//   base=200: 8  /8 (100.0%)
//   base=300: 7.5/8 ( 93.8%)
//   base=500: 7  /8 ( 87.5%)
//   aggregate: 44.5/48 (92.7%), worst window 87.5% (bar: every window >=60%)
//   level-3 bestMove: ~2.4ms/move on a mid-game position (budget: ~150ms)
{
  const STRENGTH_BAR = 0.6; // fraction of 8 games (wins + 0.5*draws)

  function playStrengthGame(seed, level3IsPlayer0) {
    let st = initState(seed);
    let plies = 0;
    const MAX_PLIES = 400;
    while (winner(st) === null && plies < MAX_PLIES) {
      const isP0 = st.turn === 0;
      const level3Turn = (isP0 && level3IsPlayer0) || (!isP0 && !level3IsPlayer0);
      const mv = bestMove(st, level3Turn ? 3 : 1, seed * 1000 + plies);
      if (!mv) break;
      st = applyMove(st, mv);
      plies++;
    }
    const w = winner(st);
    if (w === 'draw' || w === null) return 0.5;
    const level3Won = (w === 0 && level3IsPlayer0) || (w === 1 && !level3IsPlayer0);
    return level3Won ? 1 : 0;
  }

  for (const base of [0, 50]) {
    let score = 0;
    for (let g = 0; g < 8; g++) {
      score += playStrengthGame(base + g, g % 2 === 0);
    }
    const pct = score / 8;
    (pct >= STRENGTH_BAR ? ok : bad)(
      `bestMove level 3 vs level 1, window base=${base}: ${score}/8 (${(pct * 100).toFixed(1)}%, bar >=${STRENGTH_BAR * 100}%)`
    );
  }
}

// --- bestMove level 3 stays within the per-move time budget ---
{
  let st = initState(7);
  for (let i = 0; i < 10; i++) {
    const mv = bestMove(st, 2, i);
    if (!mv) break;
    st = applyMove(st, mv);
  }
  const t0 = Date.now();
  const N = 5;
  for (let i = 0; i < N; i++) bestMove(st, 3, 1000 + i);
  const avgMs = (Date.now() - t0) / N;
  (avgMs < 150 ? ok : bad)(`bestMove level 3 averages under 150ms/move on a mid position (got ${avgMs.toFixed(1)}ms)`);
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
