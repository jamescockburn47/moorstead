// English draughts (checkers) — pure rules engine. See src/games/ENGINE-CONTRACT.md.
//
// Board: 8x8, dark squares only, numbered 0..31 in standard checkers order —
// row-major over the 32 dark squares, top-left dark square is 0. Mapping
// square index -> (row, col):
//   row = floor(s / 4)
//   col = (s % 4) * 2 + (row % 2 === 0 ? 1 : 0)
// (even rows have dark squares at odd columns 1,3,5,7; odd rows at even
// columns 0,2,4,6 — the usual chequerboard layout).
//
// Player 0 ("the challenger") starts on rows 0-2 (squares 0-11) and moves
// DOWN the board (increasing row). Player 1 starts on rows 5-7 (squares
// 20-31) and moves UP the board (decreasing row). Row 7 is player 0's
// crowning row; row 0 is player 1's crowning row.
//
// state = {
//   board: Array(32) of null | { owner: 0|1, king: bool },
//   turn: 0 | 1,
//   pliesSinceAction: number,   // plies since the last capture or crowning
// }
//
// move = { from: <sq>, to: <sq>, jumps: [<captured sq>, ...] }
//   jumps is empty for a simple (non-capturing) step; for a capture it lists
//   every square whose man was jumped, in order, for the whole chain.
//
// Rules implemented:
// - Men capture/move diagonally forward only; kings both ways.
// - Captures are compulsory: if any legal capture exists for the side to
//   move, every non-capturing move is illegal.
// - Multi-jump chains are compulsory to complete and are enumerated as a
//   SINGLE move object (one legalMoves() entry per whole chain).
// - English/American rule: a man that reaches the crowning row becomes a
//   king immediately and mid-chain crowning ENDS the move there — it does
//   not continue jumping as a king in the same turn, even if further
//   captures would be available.
// - No maximum-capture rule: when multiple distinct captures (or capture
//   chains) are available, the mover may choose any of them.
// - Draw rule (added for guaranteed termination, not classic tournament
//   law): 40 plies (half-moves) with no capture and no crowning is a draw.
//   Classic English draughts uses more elaborate king-only-endgame counting
//   rules; this fixed-ply counter is a simplification documented here.

import { mulberry32 } from '../noise.js';

export const GAME_ID = 'draughts';
export const GAME_LABEL = 'Draughts';

const NO_CAPTURE_DRAW_PLIES = 40;

function sqToRC(s) {
  const row = Math.floor(s / 4);
  const col = (s % 4) * 2 + (row % 2 === 0 ? 1 : 0);
  return [row, col];
}

function rcToSq(row, col) {
  if (row < 0 || row > 7 || col < 0 || col > 7) return -1;
  if ((row + col) % 2 === 0) return -1; // light square, not playable
  return row * 4 + Math.floor(col / 2);
}

export function initState(seed = 0) {
  const board = new Array(32).fill(null);
  for (let s = 0; s < 12; s++) board[s] = { owner: 0, king: false };
  for (let s = 20; s < 32; s++) board[s] = { owner: 1, king: false };
  // seed is accepted for interface uniformity (PvP shares a seed); the
  // starting position is fixed in English draughts, so seed only affects
  // bestMove tiebreaks downstream, not the deal.
  void seed;
  return { board, turn: 0, pliesSinceAction: 0 };
}

export function currentPlayer(state) {
  return state.turn;
}

function forwardDirs(owner, king) {
  // player 0 moves toward increasing row (down), player 1 toward decreasing row (up)
  const fwd = owner === 0 ? 1 : -1;
  const dirs = [[fwd, -1], [fwd, 1]];
  if (king) dirs.push([-fwd, -1], [-fwd, 1]);
  return dirs;
}

function isCrowningRow(owner, row) {
  return owner === 0 ? row === 7 : row === 0;
}

// Enumerate every complete capture chain from a given square, as full move
// objects. Recursion stops (per English rule) the instant a man crowns.
function captureChainsFrom(board, from, owner, kingAtStart) {
  const results = [];
  const startRow = sqToRC(from)[0];
  const startKing = kingAtStart || isCrowningRow(owner, startRow);
  // Note: a man already sitting on the crowning row at the START of its own
  // move (shouldn't normally happen) is not re-crowned here; kingAtStart
  // reflects the piece's actual state before this move.

  function recurse(curSq, king, captured, board2, path) {
    const [row, col] = sqToRC(curSq);
    const dirs = forwardDirs(owner, king);
    let found = false;
    for (const [dr, dc] of dirs) {
      const midRow = row + dr, midCol = col + dc;
      const landRow = row + 2 * dr, landCol = col + 2 * dc;
      const midSq = rcToSq(midRow, midCol);
      const landSq = rcToSq(landRow, landCol);
      if (midSq < 0 || landSq < 0) continue;
      const midPiece = board2[midSq];
      if (!midPiece || midPiece.owner === owner) continue;
      if (captured.includes(midSq)) continue; // can't jump the same man twice
      if (board2[landSq]) continue; // landing must be empty
      found = true;
      const board3 = board2.slice();
      board3[curSq] = null;
      board3[midSq] = null;
      const crownsNow = !king && isCrowningRow(owner, landRow);
      const newKing = king || crownsNow;
      board3[landSq] = { owner, king: newKing };
      const newPath = path.concat(landSq);
      const newCaptured = captured.concat(midSq);
      if (crownsNow) {
        // English rule: crowning mid-chain stops the move immediately.
        results.push({ from, to: landSq, jumps: newCaptured, path: newPath });
      } else {
        recurse(landSq, newKing, newCaptured, board3, newPath);
      }
    }
    if (!found && captured.length > 0) {
      results.push({ from, to: curSq, jumps: captured, path });
    }
  }

  recurse(from, startKing, [], board, [from]);
  return results;
}

function simpleMovesFrom(board, from, owner, king) {
  const [row, col] = sqToRC(from);
  const dirs = forwardDirs(owner, king);
  const moves = [];
  for (const [dr, dc] of dirs) {
    const r = row + dr, c = col + dc;
    const sq = rcToSq(r, c);
    if (sq < 0) continue;
    if (!board[sq]) moves.push({ from, to: sq, jumps: [] });
  }
  return moves;
}

export function legalMoves(state) {
  const { board, turn } = state;
  const captures = [];
  const quiets = [];
  for (let s = 0; s < 32; s++) {
    const piece = board[s];
    if (!piece || piece.owner !== turn) continue;
    const chains = captureChainsFrom(board, s, piece.owner, piece.king);
    for (const c of chains) captures.push({ from: c.from, to: c.to, jumps: c.jumps });
    if (chains.length === 0) {
      for (const m of simpleMovesFrom(board, s, piece.owner, piece.king)) quiets.push(m);
    }
  }
  // compulsory capture: if any capture exists, only captures are legal
  return captures.length > 0 ? captures : quiets;
}

export function applyMove(state, move) {
  const moves = legalMoves(state);
  const match = moves.find(
    (m) => m.from === move.from && m.to === move.to && JSON.stringify(m.jumps) === JSON.stringify(move.jumps || [])
  );
  if (!match) throw new Error('illegal move');

  const board = state.board.slice();
  const piece = board[move.from];
  board[move.from] = null;
  for (const j of match.jumps) board[j] = null;
  const [landRow] = sqToRC(move.to);
  const crowns = !piece.king && isCrowningRow(piece.owner, landRow);
  board[move.to] = { owner: piece.owner, king: piece.king || crowns };

  const actionHappened = match.jumps.length > 0 || crowns;
  const pliesSinceAction = actionHappened ? 0 : state.pliesSinceAction + 1;

  return {
    board,
    turn: state.turn === 0 ? 1 : 0,
    pliesSinceAction,
  };
}

function hasAnyMen(board, owner) {
  return board.some((p) => p && p.owner === owner);
}

export function winner(state) {
  if (state.pliesSinceAction >= NO_CAPTURE_DRAW_PLIES) return 'draw';
  const { board, turn } = state;
  if (!hasAnyMen(board, 0)) return 1;
  if (!hasAnyMen(board, 1)) return 0;
  // side to move has no legal move -> loses
  if (legalMoves(state).length === 0) return turn === 0 ? 1 : 0;
  return null;
}

function pieceValue(piece) {
  return piece.king ? 1.6 : 1;
}

function evaluate(state, forPlayer) {
  const { board } = state;
  let material = 0;
  let advancement = 0;
  for (let s = 0; s < 32; s++) {
    const p = board[s];
    if (!p) continue;
    const sign = p.owner === forPlayer ? 1 : -1;
    material += sign * pieceValue(p);
    if (!p.king) {
      const [row] = sqToRC(s);
      const progress = p.owner === 0 ? row : 7 - row;
      advancement += sign * (progress / 7) * 0.1;
    }
  }
  const mySide = { ...state, turn: forPlayer };
  const oppSide = { ...state, turn: forPlayer === 0 ? 1 : 0 };
  const myMobility = legalMoves(mySide).length;
  const oppMobility = legalMoves(oppSide).length;
  const mobility = (myMobility - oppMobility) * 0.02;
  return material + advancement + mobility;
}

export function summary(state) {
  const w = winner(state);
  const men0 = state.board.filter((p) => p && p.owner === 0).length;
  const men1 = state.board.filter((p) => p && p.owner === 1).length;
  if (w === 'draw') return `draw by ${NO_CAPTURE_DRAW_PLIES}-ply rule — challenger ${men0}, opponent ${men1}`;
  if (w === 0 || w === 1) return `player ${w} wins — challenger ${men0}, opponent ${men1}`;
  return `to move: player ${state.turn} — challenger ${men0}, opponent ${men1}`;
}

const DEPTH_BY_LEVEL = { 1: 2, 2: 4, 3: 6 };

// True negamax: always returns the score from the perspective of the player
// whose turn it is in `state` (positive = good for state.turn).
function shuffled(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function negamax(state, depth, alpha, beta, rng) {
  const w = winner(state);
  if (w === 'draw') return 0;
  if (w === 0 || w === 1) return w === state.turn ? 1000 - depth : -(1000 - depth);
  if (depth === 0) return evaluate(state, state.turn);

  const moves = shuffled(legalMoves(state), rng);
  let best = -Infinity;
  for (const m of moves) {
    const next = applyMove(state, m);
    const val = -negamax(next, depth - 1, -beta, -alpha, rng);
    if (val > best) best = val;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

export function bestMove(state, level, seed = 0) {
  const moves = legalMoves(state);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];

  const depth = DEPTH_BY_LEVEL[level] || DEPTH_BY_LEVEL[1];
  const rng = mulberry32((seed >>> 0) ^ 0x9e3779b9);
  const ordered = shuffled(moves, rng);

  let bestVal = -Infinity;
  let bestMoves = [];
  let alpha = -Infinity;
  const beta = Infinity;

  for (const m of ordered) {
    const next = applyMove(state, m);
    const val = -negamax(next, depth - 1, -beta, -alpha, rng);
    if (val > bestVal + 1e-9) {
      bestVal = val;
      bestMoves = [m];
    } else if (Math.abs(val - bestVal) <= 1e-9) {
      bestMoves.push(m);
    }
    if (val > alpha) alpha = val;
  }

  const pick = Math.floor(rng() * bestMoves.length);
  return bestMoves[pick];
}
