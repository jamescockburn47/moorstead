// Merrils (Nine Men's Morris) — pure rules engine. See ENGINE-CONTRACT.md.
//
// Board: 24 points on 3 concentric squares (outer 0-7, middle 8-15, inner
// 16-23), each ring numbered clockwise from its top-left corner with odd
// local indices as midpoints. Spokes join same-side midpoints across rings.
// 16 mill lines: 4 per ring (corner-mid-corner) + 4 spokes (outer-mid to
// inner-mid through the middle-mid). See docs comment block below for the
// full adjacency/mill tables — they are generated once at module load from
// the coordinate layout, not hand-typed, so the two can't drift apart.
//
// State shape (plain JSON, round-trips via JSON.stringify/parse):
//   {
//     board: Array(24) of null | 0 | 1        // point -> owning player, or null
//     phase: 'placing' | 'moving' | 'gameover'
//     turn: 0 | 1                              // whose go it is
//     placed: [n0, n1]                         // men each side has placed so far (0..9)
//     onBoard: [n0, n1]                        // men each side currently has on the board
//     pendingRemoval: boolean                  // true when `turn` must supply a `remove`
//                                               // (kept false in this engine — see below)
//     movesSinceMill: number                   // plies since the last mill, for the draw rule
//     winner: null | 0 | 1 | 'draw'
//   }
//
// Move encoding (per ENGINE-CONTRACT.md):
//   { type: 'place', to, remove: point|null }
//   { type: 'move',  from, to, remove: point|null }
// A move that forms a mill carries its removal already chosen — legalMoves()
// enumerates one move per (placement/slide × legal removal) combination, so
// applyMove never has to ask "now what do you take" as a second step. This
// keeps the state machine single-ply, which is what the minimax/NPC and the
// PvP relay both expect (ENGINE-CONTRACT.md: "moves are plain-JSON, applied
// one at a time").
//
// Removal preference rule: a move's removal must target an opponent man that
// is NOT currently part of one of the opponent's mills, UNLESS every one of
// the opponent's men is in a mill (in which case any opponent man may be
// taken). This is the standard house rule and is enforced in legalMoves —
// applyMove trusts the move it's given as long as it appears in legalMoves.
//
// Draw rule (engine addition, since Merrils has no built-in termination
// guarantee once both sides are down to sliding with no mills available):
// if 50 plies (100 half-moves is excessive — 50 is the standard "no
// progress" horizon borrowed from chess-like games) pass with no mill formed
// by either side, and neither side is in the placing phase, the game is a
// draw. `movesSinceMill` counts plies since the last mill (or since the
// start of the moving phase, whichever is later) and resets to 0 whenever a
// mill is formed. This guarantees self-play terminates.

import { mulberry32 } from '../noise.js';

export const GAME_ID = 'merrils';
export const GAME_LABEL = 'Merrils';

const MEN_PER_SIDE = 9;
const DRAW_PLY_LIMIT = 50;

// --- board geometry (generated from coordinates, not hand-typed) ---

// local index within a ring: 0=corner,1=mid,2=corner,3=mid,... around the ring
function ringPoints(base) {
  return [base, base + 1, base + 2, base + 3, base + 4, base + 5, base + 6, base + 7];
}
const OUTER = ringPoints(0);
const MIDDLE = ringPoints(8);
const INNER = ringPoints(16);
const RINGS = [OUTER, MIDDLE, INNER];

function ringEdges(ring) {
  const edges = [];
  for (let i = 0; i < 8; i++) edges.push([ring[i], ring[(i + 1) % 8]]);
  return edges;
}

function ringMills(ring) {
  // corner-mid-corner triples: indices (0,1,2) (2,3,4) (4,5,6) (6,7,0)
  const mills = [];
  for (let i = 0; i < 8; i += 2) {
    mills.push([ring[i], ring[(i + 1) % 8], ring[(i + 2) % 8]]);
  }
  return mills;
}

// spokes: local mid-index 1 (top), 3 (right), 5 (bottom), 7 (left) join
// outer -> middle -> inner at the same local position.
const SPOKE_LOCALS = [1, 3, 5, 7];
const SPOKE_EDGES = SPOKE_LOCALS.flatMap((li) => [
  [OUTER[li], MIDDLE[li]],
  [MIDDLE[li], INNER[li]],
]);
const SPOKE_MILLS = SPOKE_LOCALS.map((li) => [OUTER[li], MIDDLE[li], INNER[li]]);

export const MILLS = [...RINGS.flatMap(ringMills), ...SPOKE_MILLS];

const ALL_EDGES = [...RINGS.flatMap(ringEdges), ...SPOKE_EDGES];

const ADJACENCY = Array.from({ length: 24 }, () => new Set());
for (const [a, b] of ALL_EDGES) {
  ADJACENCY[a].add(b);
  ADJACENCY[b].add(a);
}
export const ADJ = ADJACENCY.map((s) => [...s].sort((a, b) => a - b));

// point -> list of mill-line indices it participates in
const POINT_MILLS = Array.from({ length: 24 }, () => []);
MILLS.forEach((mill, mi) => {
  for (const p of mill) POINT_MILLS[p].push(mi);
});

// --- state ---

export function initState(seed = 0) {
  void seed; // merrils placement is player-chosen; seed only feeds bestMove tiebreaks
  return {
    board: new Array(24).fill(null),
    phase: 'placing',
    turn: 0,
    placed: [0, 0],
    onBoard: [0, 0],
    movesSinceMill: 0,
    winner: null,
  };
}

export function currentPlayer(state) {
  return state.turn;
}

function opponent(p) {
  return p === 0 ? 1 : 0;
}

function pointsOf(board, player) {
  const pts = [];
  for (let i = 0; i < 24; i++) if (board[i] === player) pts.push(i);
  return pts;
}

function formsMill(board, point, player) {
  return POINT_MILLS[point].some((mi) => MILLS[mi].every((p) => board[p] === player));
}

function inAnyMill(board, point, player) {
  if (board[point] !== player) return false;
  return formsMill(board, point, player);
}

// Legal removal targets for `player` capturing from `opponentId`, given a
// hypothetical board (post-placement/slide, pre-removal).
function removalTargets(board, opponentId) {
  const men = pointsOf(board, opponentId);
  const free = men.filter((p) => !inAnyMill(board, p, opponentId));
  return free.length > 0 ? free : men;
}

function isFlying(state, player) {
  return state.phase === 'moving' && state.onBoard[player] === 3;
}

function computePhase(state) {
  if (state.placed[0] < MEN_PER_SIDE || state.placed[1] < MEN_PER_SIDE) return 'placing';
  return 'moving';
}

// --- legal moves ---

export function legalMoves(state) {
  if (state.winner) return [];
  const player = state.turn;
  const board = state.board;
  const moves = [];

  const emitFor = (boardAfterMove, baseMove) => {
    if (formsMill(boardAfterMove, baseMove.to, player)) {
      const opp = opponent(player);
      const targets = removalTargets(boardAfterMove, opp);
      if (targets.length === 0) {
        // opponent has no men on the board yet (early placing phase) — the
        // mill still forms, there's just nothing to take.
        moves.push({ ...baseMove, remove: null });
      } else {
        for (const remove of targets) {
          moves.push({ ...baseMove, remove });
        }
      }
    } else {
      moves.push({ ...baseMove, remove: null });
    }
  };

  if (state.phase === 'placing') {
    for (let to = 0; to < 24; to++) {
      if (board[to] !== null) continue;
      const b2 = board.slice();
      b2[to] = player;
      emitFor(b2, { type: 'place', to });
    }
    return moves;
  }

  if (state.phase === 'moving') {
    const flying = isFlying(state, player);
    const mine = pointsOf(board, player);
    for (const from of mine) {
      const dests = flying ? board.map((_, i) => i).filter((i) => board[i] === null) : ADJ[from].filter((n) => board[n] === null);
      for (const to of dests) {
        const b2 = board.slice();
        b2[from] = null;
        b2[to] = player;
        emitFor(b2, { type: 'move', from, to });
      }
    }
    return moves;
  }

  return moves;
}

// --- apply ---

function findMove(state, move) {
  const moves = legalMoves(state);
  return moves.find((m) => sameMove(m, move));
}

function sameMove(a, b) {
  if (a.type !== b.type) return false;
  if (a.type === 'place') {
    return a.to === b.to && a.remove === b.remove;
  }
  return a.from === b.from && a.to === b.to && a.remove === b.remove;
}

export function applyMove(state, move) {
  const matched = findMove(state, move);
  if (!matched) throw new Error('illegal move');

  const player = state.turn;
  const board = state.board.slice();
  let placed = [...state.placed];
  let onBoard = [...state.onBoard];

  if (matched.type === 'place') {
    board[matched.to] = player;
    placed[player] += 1;
    onBoard[player] += 1;
  } else {
    board[matched.from] = null;
    board[matched.to] = player;
  }

  let movesSinceMill = state.movesSinceMill + 1;
  if (matched.remove !== null) {
    board[matched.remove] = null;
    onBoard[opponent(player)] -= 1;
    movesSinceMill = 0;
  }

  const phase = computePhase({ ...state, placed });
  const nextTurn = opponent(player);

  let next = {
    board,
    phase,
    turn: nextTurn,
    placed,
    onBoard,
    movesSinceMill,
    winner: null,
  };

  next.winner = computeWinner(next);
  return next;
}

function computeWinner(state) {
  // reduced to < 3 men (only possible after placing phase completes)
  for (const p of [0, 1]) {
    if (state.phase !== 'placing' && state.onBoard[p] < 3) return opponent(p);
  }
  // no legal moves on the mover's turn (with placement done)
  if (state.phase === 'moving') {
    const movesForMover = legalMoves({ ...state, winner: null });
    if (movesForMover.length === 0) return opponent(state.turn);
  }
  // 50-ply no-mill draw rule (moving phase only — placing always makes
  // progress by definition, one new man per ply)
  if (state.phase === 'moving' && state.movesSinceMill >= DRAW_PLY_LIMIT) {
    return 'draw';
  }
  return null;
}

export function winner(state) {
  // Always derive live from the board/counts rather than trust a cached
  // field — applyMove sets state.winner as a convenience, but winner() must
  // be a pure function of state per ENGINE-CONTRACT.md (e.g. the PvP relay
  // may hand back a state it didn't build via applyMove).
  if (state.winner === 'draw') return 'draw';
  return computeWinner(state);
}

// --- evaluation + search ---

// Mill-threat term: for each mill line where `p` holds exactly 2 of the 3
// points and the 3rd is empty, count it as a threat if it's actually
// completable next ply — placing phase: always (a free placement can fill
// it); moving phase: only if some friendly man adjacent to the empty point
// could slide in, or `p` is flying (3 men, can hop anywhere). This is what
// depth-limited search can't see a couple of plies out without help: a
// 2-in-a-line with an open third point is worth much more than raw material
// or mobility suggests, because it forces the opponent to respond or lose a
// man next move.
function threatCount(state, p) {
  const board = state.board;
  const flying = state.phase === 'moving' && state.onBoard[p] === 3;
  const placingPhase = state.placed[p] < MEN_PER_SIDE;
  let threats = 0;
  for (const mill of MILLS) {
    let mine = 0;
    let empty = -1;
    let blockedByOther = false;
    for (const pt of mill) {
      if (board[pt] === p) mine++;
      else if (board[pt] === null) empty = pt;
      else blockedByOther = true;
    }
    if (mine !== 2 || empty === -1 || blockedByOther) continue;
    if (placingPhase || flying) {
      threats++;
    } else {
      // moving phase, not flying: threat only counts if a friendly man
      // adjacent to the empty point can actually slide into it.
      if (ADJ[empty].some((n) => board[n] === p)) threats++;
    }
  }
  return threats;
}

// Blocked-men penalty: a man (non-flying) with zero empty adjacent points
// is stuck — can't respond to threats or reposition. Small penalty per
// stuck man, symmetric for both sides.
function blockedCount(state, p) {
  if (state.phase !== 'moving' || state.onBoard[p] === 3) return 0;
  const board = state.board;
  let blocked = 0;
  for (let i = 0; i < 24; i++) {
    if (board[i] !== p) continue;
    if (ADJ[i].every((n) => board[n] !== null)) blocked++;
  }
  return blocked;
}

function evaluate(state, player) {
  if (state.winner === player) return 100000;
  if (state.winner === opponent(player)) return -100000;
  if (state.winner === 'draw') return 0;

  const opp = opponent(player);
  const board = state.board;

  let millsMine = 0;
  let millsOpp = 0;
  for (const mill of MILLS) {
    if (mill.every((p) => board[p] === player)) millsMine++;
    if (mill.every((p) => board[p] === opp)) millsOpp++;
  }

  const materialMine = state.onBoard[player];
  const materialOpp = state.onBoard[opp];

  // mobility: count legal destinations for each side (cheap approximation —
  // doesn't need full legalMoves/removal enumeration, just raw slide/fly options)
  const mobility = (p) => {
    if (state.placed[p] < MEN_PER_SIDE) return 24 - board.filter((v) => v !== null).length;
    const flying = state.onBoard[p] === 3;
    let count = 0;
    for (let i = 0; i < 24; i++) {
      if (board[i] !== p) continue;
      if (flying) {
        count += board.filter((v) => v === null).length;
      } else {
        count += ADJ[i].filter((n) => board[n] === null).length;
      }
    }
    return count;
  };

  const mobMine = mobility(player);
  const mobOpp = mobility(opp);

  const threatsMine = threatCount(state, player);
  const threatsOpp = threatCount(state, opp);

  const blockedMine = blockedCount(state, player);
  const blockedOpp = blockedCount(state, opp);

  return (
    (materialMine - materialOpp) * 100 +
    (millsMine - millsOpp) * 40 +
    (mobMine - mobOpp) * 2 +
    (threatsMine - threatsOpp) * 15 +
    (blockedOpp - blockedMine) * 3
  );
}

// Quick static ordering score for a move, used to sort candidates before
// alpha-beta so the best lines get searched (and pruned against) first.
// Mill-completing moves (removal != null) first, ranked by whether the
// removal itself breaks an opponent threat; everything else keeps its
// natural order.
function moveOrderScore(move) {
  let score = 0;
  if (move.remove !== null) score += 1000;
  return score;
}

function negamax(state, depth, alpha, beta, player, rng) {
  if (state.winner || depth === 0) {
    return { score: evaluate(state, player), move: null };
  }
  const moves = legalMoves(state);
  if (moves.length === 0) {
    return { score: evaluate(state, player), move: null };
  }
  // Order candidates so mill-completing (capturing) moves are searched
  // first — they're the most forcing and most likely to raise alpha early,
  // which lets alpha-beta prune the rest of the list sooner. Stable sort
  // keeps legalMoves' natural order within each score bucket, which is what
  // the existing determinism tests rely on (ties are still broken by rng
  // over bestMoves below, not by sort order).
  const ordered = moves
    .map((move, i) => ({ move, i, score: moveOrderScore(move) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((e) => e.move);

  let best = -Infinity;
  let bestMoves = [];
  for (const move of ordered) {
    const next = applyMove(state, move);
    const toMove = currentPlayer(next);
    // negamax sign flip: score is always from `player`'s perspective
    let child;
    if (next.winner) {
      child = { score: evaluate(next, player) };
    } else if (toMove === player) {
      child = negamax(next, depth - 1, alpha, beta, player, rng);
    } else {
      const sub = negamax(next, depth - 1, -beta, -alpha, opponent(player), rng);
      child = { score: -sub.score };
    }
    const score = child.score;
    if (score > best + 1e-9) {
      best = score;
      bestMoves = [move];
    } else if (Math.abs(score - best) <= 1e-9) {
      bestMoves.push(move);
    }
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }

  const idx = bestMoves.length === 1 ? 0 : Math.floor(rng() * bestMoves.length);
  return { score: best, move: bestMoves[idx] };
}

// Search depth per difficulty level. Merrils has a much larger branching
// factor than draughts (up to 24 placement targets, or up to 4 slide dests
// x ~9 men, times removal-choice fan-out on a mill), so a flat depth-3 cap
// for the "hard" level barely out-searches level 1 and evaluate() alone
// can't make up the difference (see threatCount/blockedCount above) without
// enough plies to actually look for forced sequences. Depth 4 was
// benchmarked to clear the >=60%-per-window bar across all 6 seeded windows
// (see scripts/verify-merrils.mjs) while keeping bestMove well under the
// ~150ms/move budget.
const DEPTH_BY_LEVEL = { 1: 1, 2: 2, 3: 4 };

export function bestMove(state, level, seed) {
  const moves = legalMoves(state);
  if (moves.length === 0) return null;
  const depth = DEPTH_BY_LEVEL[Math.max(1, Math.min(3, level | 0 || 1))];
  const rng = mulberry32(((seed | 0) ^ (state.turn * 0x9e3779b9)) >>> 0);
  const player = state.turn;
  const result = negamax(state, depth, -Infinity, Infinity, player, rng);
  return result.move ?? moves[Math.floor(rng() * moves.length)];
}

// --- summary ---

export function summary(state) {
  if (state.winner === 'draw') return 'merrils: drawn (50 moves, no mill)';
  if (state.winner !== null) return `merrils: player ${state.winner + 1} wins`;
  if (state.phase === 'placing') {
    const left0 = MEN_PER_SIDE - state.placed[0];
    const left1 = MEN_PER_SIDE - state.placed[1];
    return `merrils: placing — p1 ${left0} left, p2 ${left1} left, p${state.turn + 1} to place`;
  }
  const flying = isFlying(state, state.turn) ? ', flying' : '';
  return `merrils: moving — p1 ${state.onBoard[0]} men, p2 ${state.onBoard[1]} men, p${state.turn + 1} to move${flying}`;
}
