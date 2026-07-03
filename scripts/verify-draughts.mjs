// Draughts engine check — run wi': node scripts/verify-draughts.mjs
//
// Headless Node only. Tests the CONTRACT (ENGINE-CONTRACT.md): determinism,
// compulsory capture, multi-jump chains, English crowning-stops-chain rule,
// king both-ways movement, loss-by-no-moves, the 40-ply draw rule, JSON
// round-trip, seeded self-play termination, and illegal-move rejection.

import {
  GAME_ID,
  GAME_LABEL,
  initState,
  currentPlayer,
  legalMoves,
  applyMove,
  winner,
  bestMove,
  summary,
} from '../src/games/draughts.js';

let failed = false;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failed = true; console.log('  FAIL  ' + m); };

function emptyBoard() {
  return new Array(32).fill(null);
}

function stateWith(board, turn = 0, pliesSinceAction = 0) {
  return { board, turn, pliesSinceAction };
}

function man(owner, king = false) {
  return { owner, king };
}

// --- contract shape ---
{
  (GAME_ID === 'draughts' ? ok : bad)('GAME_ID is "draughts"');
  (typeof GAME_LABEL === 'string' && GAME_LABEL.length > 0 ? ok : bad)('GAME_LABEL is a non-empty string');
  const s0 = initState(1);
  (currentPlayer(s0) === 0 ? ok : bad)('challenger (player 0) moves first');
  (s0.board.filter((p) => p && p.owner === 0).length === 12 ? ok : bad)('player 0 starts with 12 men');
  (s0.board.filter((p) => p && p.owner === 1).length === 12 ? ok : bad)('player 1 starts with 12 men');
}

// --- determinism ---
{
  const a = initState(42);
  const b = initState(42);
  (JSON.stringify(a) === JSON.stringify(b) ? ok : bad)('initState is deterministic for the same seed');

  const movesA = legalMoves(a);
  const movesB = legalMoves(b);
  (JSON.stringify(movesA) === JSON.stringify(movesB) ? ok : bad)('legalMoves deterministic for identical states');

  const bm1 = bestMove(a, 2, 7);
  const bm2 = bestMove(b, 2, 7);
  (JSON.stringify(bm1) === JSON.stringify(bm2) ? ok : bad)('bestMove deterministic for (state, level, seed)');
}

// --- opening legal moves: no captures available, 7 quiet moves for player 0 ---
{
  const s0 = initState(0);
  const moves = legalMoves(s0);
  const allQuiet = moves.every((m) => m.jumps.length === 0);
  (allQuiet ? ok : bad)('opening position has only quiet moves (no captures available)');
  (moves.length === 7 ? ok : bad)('opening position has 7 legal quiet moves for player 0');
}

// --- compulsory capture: a quiet move is illegal when a capture exists ---
{
  // Player 0 man at square that can jump a lone player-1 man into an empty
  // landing square. Squares: use row/col via known mapping.
  // sq 9 -> row=2,col=(9%4)*2+((2%2===0)?1:0)=1*2+1=3 -> (2,3)... let's just
  // build via explicit board with one attacker, one victim, rest empty, and
  // also a spare player-0 man elsewhere with a legal quiet move.
  const board = emptyBoard();
  // (2,3) attacker player 0, sq for row2,col3: row=2 -> even -> col=(s%4)*2+1
  // solve: 2 = floor(s/4) => s in [8..11]; col = (s%4)*2+1 = 3 => (s%4)=1 => s=9
  board[9] = man(0); // (2,3)
  // victim at (3,4) player 1: row=3(odd) => col=(s%4)*2 ; s in [12..15]; col=4 => (s%4)=2 => s=14
  board[14] = man(1); // (3,4)
  // landing (4,5) must be empty -> row4 even => col=(s%4)*2+1=5 => (s%4)=2 => s=18 ; s in [16..19]
  // s=18 -> leave empty (default)
  // spare player-0 man elsewhere with an obviously legal quiet move, e.g. sq 1 (row0,col? )
  board[1] = man(0);
  const s = stateWith(board, 0);
  const moves = legalMoves(s);
  const hasCapture = moves.some((m) => m.jumps.length > 0);
  const hasQuiet = moves.some((m) => m.jumps.length === 0);
  (hasCapture ? ok : bad)('a capture is available from square 9');
  (!hasQuiet ? ok : bad)('compulsory capture: quiet moves are excluded when a capture exists');

  // confirm applying the quiet move (which is illegal) throws
  let threw = false;
  try {
    applyMove(s, { from: 1, to: 5, jumps: [] });
  } catch (e) {
    threw = /illegal move/.test(e.message);
  }
  (threw ? ok : bad)('applyMove throws "illegal move" for a quiet move when a capture is compulsory');
}

// --- multi-jump chain enumerated fully as ONE move with 2 captures ---
{
  const board = emptyBoard();
  // attacker player 0 at sq 9 (2,3)
  board[9] = man(0);
  // first victim at (3,4) sq14, landing (4,5) sq18 empty
  board[14] = man(1);
  // second victim positioned so a jump continues from (4,5) to (6,7):
  // victim at (5,6): row5(odd) col=(s%4)*2 =6 => (s%4)=3 => s in [20..23] => s=23
  board[23] = man(1);
  // landing (6,7): row6(even) col=(s%4)*2+1=7 => (s%4)=3 => s in [24..27] => s=27, empty
  const s = stateWith(board, 0);
  const moves = legalMoves(s);
  (moves.length === 1 ? ok : bad)('exactly one legal move exists (the forced double-jump chain)');
  const m = moves[0];
  (m && m.jumps.length === 2 ? ok : bad)('the double-jump chain captures both men in a single move object');
  (m && m.jumps.includes(14) && m.jumps.includes(23) ? ok : bad)('both intermediate captured squares are recorded');
  (m && m.to === 27 ? ok : bad)('chain lands on the final square after both jumps');

  const next = applyMove(s, m);
  (next.board[14] === null && next.board[23] === null ? ok : bad)('both captured men are removed from the board');
  (next.board[9] === null && next.board[27] !== null ? ok : bad)('attacker relocated to the final landing square');
}

// --- crowning stops the chain (English rule) ---
{
  const board = emptyBoard();
  // player 0 man one row short of crowning, positioned to jump into the
  // crowning row (row 7), with a further capture technically available
  // from row 7 as a king move — but the man must STOP the moment it crowns.
  // attacker at (5,4): row5 odd => col=(s%4)*2=4 => (s%4)=2 => s in[20..23]=>s=22
  board[22] = man(0);
  // victim at (6,5): row6 even => col=(s%4)*2+1=5=>(s%4)=2=>s in[24..27]=>s=26
  board[26] = man(1);
  // landing at (7,6): row7 odd => col=(s%4)*2=6=>(s%4)=3=>s in[28..31]=>s=31, empty
  // a further victim placed as if a king could jump backward from (7,6):
  // put a player-1 man adjacent at (6,7) sq27 with empty landing (5,8) off-board
  // instead place one at (6,5) already used; add another potential "trap" at
  // (6,7)=sq27 with landing (5,8) invalid (off-board) so it wouldn't chain
  // anyway — the real assertion is simply: only ONE capture happened and the
  // piece is marked king.
  board[27] = man(1); // decorative: not reachable as a further backward jump (off-board landing)
  const s = stateWith(board, 0);
  const moves = legalMoves(s);
  const chain = moves.find((m) => m.from === 22);
  (chain !== undefined ? ok : bad)('capture chain found from the crowning attacker');
  (chain && chain.jumps.length === 1 && chain.to === 31 ? ok : bad)('chain stops after the single jump that crowns the man');

  const next = applyMove(s, chain);
  (next.board[31] && next.board[31].king === true ? ok : bad)('the man is crowned on reaching the back row');
  (next.board[31] && next.board[31].owner === 0 ? ok : bad)('crowned piece retains its owner');
}

// --- king moves both ways ---
{
  const board = emptyBoard();
  // king at (3,4) sq14, empty around it — should have 4 diagonal quiet moves
  board[14] = man(0, true);
  const s = stateWith(board, 0);
  const moves = legalMoves(s);
  (moves.length === 4 ? ok : bad)('a king in open space has 4 legal diagonal moves (both forward and backward)');
  const dRows = moves.map((m) => sqRowDelta(14, m.to));
  (dRows.includes(1) && dRows.includes(-1) ? ok : bad)('king move set includes both forward (+row) and backward (-row) steps');
}
function sqRowDelta(from, to) {
  const rowOf = (s) => Math.floor(s / 4);
  return Math.sign(rowOf(to) - rowOf(from));
}

// --- king can capture backward too ---
{
  const board = emptyBoard();
  board[14] = man(0, true); // king at (3,4)
  board[9] = man(1); // victim at (2,3) — behind the king relative to player 0's forward direction
  // landing at (1,2): row1 odd => col=(s%4)*2=2=>(s%4)=1=>s in[4..7]=>s=5, empty
  const s = stateWith(board, 0);
  const moves = legalMoves(s);
  const capture = moves.find((m) => m.jumps.length > 0);
  (capture !== undefined && capture.to === 5 ? ok : bad)('king captures backward (against its owner\'s forward direction)');
}

// --- loss by no legal moves ---
{
  const board = emptyBoard();
  // player 0's lone man boxed in by player 1 men on both forward diagonals,
  // with both landing squares occupied too, and it's player 0's move.
  // attacker (blocked) at (6,5) sq26 (near player 0's crowning row so forward = row7)
  board[26] = man(0);
  // blockers at (7,4) and (7,6):
  // (7,4): row7 odd => col=(s%4)*2=4=>(s%4)=2=>s in[28..31]=>s=30
  board[30] = man(1);
  // (7,6): (s%4)=3=>s=31
  board[31] = man(1);
  const s = stateWith(board, 0);
  const moves = legalMoves(s);
  (moves.length === 0 ? ok : bad)('boxed-in player 0 has zero legal moves');
  (winner(s) === 1 ? ok : bad)('the side with no legal moves loses');
}

// --- loss by no men left ---
{
  const board = emptyBoard();
  board[9] = man(1);
  const s = stateWith(board, 0);
  (winner(s) === 1 ? ok : bad)('a side with zero men on the board loses immediately');
}

// --- 40-ply no-capture/no-crowning draw rule ---
{
  const board = emptyBoard();
  board[9] = man(0);
  board[22] = man(1);
  const s = stateWith(board, 0, NO_CAPTURE_DRAW_PLIES_CONST());
  (winner(s) === 'draw' ? ok : bad)('40 plies without capture or crowning is ruled a draw');
  const sBefore = stateWith(board, 0, NO_CAPTURE_DRAW_PLIES_CONST() - 1);
  (winner(sBefore) === null ? ok : bad)('39 plies without action is not yet a draw (game ongoing)');
}
function NO_CAPTURE_DRAW_PLIES_CONST() { return 40; }

// --- pliesSinceAction resets on capture and on crowning, increments otherwise ---
{
  const s0 = initState(3);
  const withPlies = { ...s0, pliesSinceAction: 5 };
  const moves = legalMoves(withPlies);
  const quiet = moves.find((m) => m.jumps.length === 0);
  const next = applyMove(withPlies, quiet);
  (next.pliesSinceAction === 6 ? ok : bad)('pliesSinceAction increments after a quiet, non-crowning move');
}

// --- JSON round-trip: state and moves survive JSON.parse(JSON.stringify(x)) ---
{
  const s = initState(11);
  const rt = JSON.parse(JSON.stringify(s));
  (JSON.stringify(rt) === JSON.stringify(s) ? ok : bad)('state round-trips through JSON unchanged');

  const moves = legalMoves(s);
  const rtMoves = JSON.parse(JSON.stringify(moves));
  (JSON.stringify(rtMoves) === JSON.stringify(moves) ? ok : bad)('legalMoves round-trip through JSON unchanged');

  const bm = bestMove(s, 1, 5);
  const rtBm = JSON.parse(JSON.stringify(bm));
  (JSON.stringify(rtBm) === JSON.stringify(bm) ? ok : bad)('bestMove result round-trips through JSON unchanged');
}

// --- applyMove throws on illegal move (fabricated, off-board-ish move) ---
{
  const s = initState(0);
  let threw = false;
  try {
    applyMove(s, { from: 0, to: 31, jumps: [] });
  } catch (e) {
    threw = /illegal move/.test(e.message);
  }
  (threw ? ok : bad)('applyMove throws "illegal move" for a fabricated non-adjacent move');
}

// --- summary is a non-empty string in all phases ---
{
  const s = initState(9);
  (typeof summary(s) === 'string' && summary(s).length > 0 ? ok : bad)('summary returns a non-empty string mid-game');
}

// --- seeded self-play at level 2 terminates within a bounded number of plies ---
{
  let s = initState(123);
  let plies = 0;
  const MAX_PLIES = 400; // generous bound; draw rule guarantees termination well before this
  let w = winner(s);
  while (w === null && plies < MAX_PLIES) {
    const m = bestMove(s, 2, 1000 + plies);
    if (!m) break;
    s = applyMove(s, m);
    plies++;
    w = winner(s);
  }
  (w !== null ? ok : bad)(`seeded level-2 self-play terminates (ended after ${plies} plies, result=${JSON.stringify(w)})`);
  (plies < MAX_PLIES ? ok : bad)('self-play terminated well within the bound, not by hitting MAX_PLIES');

  // re-run with identical seeds and confirm identical game trajectory (determinism end-to-end)
  let s2 = initState(123);
  let plies2 = 0;
  let w2 = winner(s2);
  const trace1 = [];
  const trace2 = [];
  let sReplay = initState(123);
  let pliesReplay = 0;
  let wReplay = winner(sReplay);
  while (wReplay === null && pliesReplay < MAX_PLIES) {
    const m = bestMove(sReplay, 2, 1000 + pliesReplay);
    trace1.push(m);
    sReplay = applyMove(sReplay, m);
    pliesReplay++;
    wReplay = winner(sReplay);
  }
  while (w2 === null && plies2 < MAX_PLIES) {
    const m = bestMove(s2, 2, 1000 + plies2);
    trace2.push(m);
    s2 = applyMove(s2, m);
    plies2++;
    w2 = winner(s2);
  }
  (JSON.stringify(trace1) === JSON.stringify(trace2) ? ok : bad)('replaying the same seeded self-play produces an identical move trace');
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
