// Dominoes — two-player BLOCK dominoes, double-six (the plain pub game).
// Pure rules engine per src/games/ENGINE-CONTRACT.md: no THREE, no DOM, no
// unseeded randomness. The table UI and the parlour NPC drive this module.
//
// Rules implemented (v1 — one hand per game):
// - 28 tiles; each player dealt 7 from a seed-shuffled deck (mulberry32).
//   The remaining 14 form the boneyard, kept in state for the deal record —
//   in BLOCK play it is never drawn from.
// - Highest double in either hand opens; if neither hand holds a double, the
//   highest tile opens (rank: pip sum, then higher single pip). The opener's
//   first move is forced to that tile.
// - Play alternates, adding a tile that matches either open end. A player
//   with no matching tile MUST knock ({type:'knock'}) — knocking with a play
//   in hand is illegal.
// - Hand ends when a player dominoes (empties their hand) → they win; or both
//   players knock consecutively (blocked) → lightest pip total wins, equal
//   pips is a draw.
// - Future: running score to 61 on the cribbage board (multi-hand games);
//   draw-variant (boneyard draws) if a table ever wants it.
//
// Tiles & orientation: a tile is a plain pair [a,b]. Hands/boneyard store the
// canonical orientation [hi,lo]. A move may give the tile either way round —
// applyMove matches it by pip SET against the hand, then flips it as needed so
// it joins the line: `state.line` is stored left→right as ORIENTED pairs, i.e.
// line[i][1] === line[i+1][0]; the open ends are line[0][0] (L) and
// line[last][1] (R). Playing to 'L' prepends [other, L]; to 'R' appends
// [R, other]. The UI never has to orient anything itself.
//
// Hidden information: both hands live in the state (the PvP relay shares a
// seed, so both clients deal identically); the UI decides what to show.

import { mulberry32 } from '../noise.js';

export const GAME_ID = 'dominoes';
export const GAME_LABEL = 'Dominoes';

// --- helpers -----------------------------------------------------------

function canon(t) { return t[0] >= t[1] ? [t[0], t[1]] : [t[1], t[0]]; }
function sameTile(a, b) {
  const ca = canon(a), cb = canon(b);
  return ca[0] === cb[0] && ca[1] === cb[1];
}
function pips(t) { return t[0] + t[1]; }
function isDouble(t) { return t[0] === t[1]; }
// Rank for the "highest tile opens" rule: pip sum first, then the higher
// single pip ([6,3] beats [5,4]). Unique across the distinct double-six set.
function tileRank(t) { const c = canon(t); return pips(c) * 10 + c[0]; }
function handPips(hand) { return hand.reduce((s, t) => s + pips(t), 0); }

function ends(state) {
  const line = state.line;
  if (!line.length) return null;
  return [line[0][0], line[line.length - 1][1]];
}

function freshDeck() {
  const deck = [];
  for (let hi = 0; hi <= 6; hi++) for (let lo = 0; lo <= hi; lo++) deck.push([hi, lo]);
  return deck; // 28 tiles, canonical [hi,lo]
}

// --- contract ----------------------------------------------------------

export function initState(seed = 0) {
  const rng = mulberry32(seed | 0);
  const deck = freshDeck();
  for (let i = deck.length - 1; i > 0; i--) { // Fisher–Yates, seeded
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const hands = [deck.slice(0, 7), deck.slice(7, 14)];
  const boneyard = deck.slice(14); // kept for the record; never drawn in block play

  // Who opens, and with what: highest double, else highest tile.
  let opener = 0, opening = null;
  for (let p = 0; p < 2; p++) for (const t of hands[p]) {
    if (isDouble(t) && (opening === null || t[0] > opening[0])) { opening = t; opener = p; }
  }
  if (opening === null) {
    for (let p = 0; p < 2; p++) for (const t of hands[p]) {
      if (opening === null || tileRank(t) > tileRank(opening)) { opening = t; opener = p; }
    }
  }

  return {
    game: GAME_ID,
    seed: seed | 0,
    hands,
    boneyard,
    line: [],                 // oriented pairs, left→right
    opening: [opening[0], opening[1]], // forced first tile
    turn: opener,
    knocks: 0,                // consecutive knocks; 2 = blocked
    done: null,               // null | 0 | 1 | 'draw'
  };
}

export function currentPlayer(state) { return state.turn; }

export function legalMoves(state) {
  if (state.done !== null) return [];
  const hand = state.hands[state.turn];
  if (!state.line.length) {
    // Opening move is forced to the stored opener tile.
    return [{ type: 'play', tile: [state.opening[0], state.opening[1]], end: 'R' }];
  }
  const [L, R] = ends(state);
  const moves = [];
  const seen = new Set();
  for (const t of hand) {
    for (const [end, pip] of [['L', L], ['R', R]]) {
      if (t[0] === pip || t[1] === pip) {
        const key = t[0] + '-' + t[1] + '-' + end;
        if (!seen.has(key)) { seen.add(key); moves.push({ type: 'play', tile: [t[0], t[1]], end }); }
      }
    }
  }
  if (!moves.length) moves.push({ type: 'knock' }); // knocking is only legal with no play
  return moves;
}

export function applyMove(state, move) {
  const legal = legalMoves(state);
  const match = legal.find(m =>
    m.type === move.type &&
    (m.type === 'knock' || (m.end === move.end && sameTile(m.tile, move.tile))));
  if (!match) throw new Error('illegal move');

  const next = JSON.parse(JSON.stringify(state));

  if (move.type === 'knock') {
    next.knocks += 1;
    if (next.knocks >= 2) { // blocked: lightest pip total wins, equal = draw
      const p0 = handPips(next.hands[0]), p1 = handPips(next.hands[1]);
      next.done = p0 < p1 ? 0 : p1 < p0 ? 1 : 'draw';
    }
    next.turn = 1 - next.turn;
    return next;
  }

  // Play: remove from hand (set-match, either orientation given), orient onto the line.
  const hand = next.hands[next.turn];
  const idx = hand.findIndex(t => sameTile(t, move.tile));
  const [tile] = hand.splice(idx, 1);
  if (!next.line.length) {
    next.line.push([tile[0], tile[1]]);
  } else {
    const [L, R] = ends(next);
    if (move.end === 'L') {
      next.line.unshift(tile[1] === L ? [tile[0], tile[1]] : [tile[1], tile[0]]);
    } else {
      next.line.push(tile[0] === R ? [tile[0], tile[1]] : [tile[1], tile[0]]);
    }
  }
  next.knocks = 0;
  if (!hand.length) next.done = next.turn; // dominoed out
  next.turn = 1 - next.turn;
  return next;
}

export function winner(state) { return state.done; }

// Greedy heuristic, seeded tiebreaks only — deterministic for (state, level, seed).
// level 1: seeded-random legal move. level 2: greedy (highest-pip playable,
// ties broken by keeping the two ends different — end-diversity — then seeded).
// level 3: greedy + hold-back-doubles-early (soft penalty on doubles while the
// line is short, saving them for when suits are known).
export function bestMove(state, level, seed = 0) {
  const moves = legalMoves(state);
  if (!moves.length) return null;
  if (moves.length === 1) return moves[0];

  // Fold the position into the rng seed so different turns of the same game
  // tie-break differently, while (state, level, seed) stays deterministic.
  let h = (seed | 0) ^ (level * 0x9E3779B9);
  h = (h ^ (state.line.length * 2654435761)) | 0;
  for (const [a, b] of state.line) h = (h * 31 + a * 7 + b) | 0;
  const rng = mulberry32(h);

  if (level <= 1) return moves[Math.floor(rng() * moves.length)];

  const [L, R] = ends(state) || [null, null];
  let best = null, bestScore = -Infinity;
  const scored = moves.map(m => {
    let score = pips(m.tile) * 100; // greedy: shed the heaviest tile
    // end-diversity tiebreak: prefer the resulting open ends to differ
    const other = m.tile[0] === (m.end === 'L' ? L : R) ? m.tile[1] : m.tile[0];
    const otherEnd = m.end === 'L' ? R : L;
    if (other !== otherEnd) score += 10;
    if (level >= 3 && isDouble(m.tile) && state.line.length < 4) score -= 250; // hold doubles early
    return { m, score };
  });
  const ties = [];
  for (const s of scored) {
    if (s.score > bestScore) { bestScore = s.score; ties.length = 0; ties.push(s.m); }
    else if (s.score === bestScore) ties.push(s.m);
  }
  best = ties[Math.floor(rng() * ties.length)]; // seeded tiebreak
  return best;
}

export function summary(state) {
  if (state.done === 'draw') return 'blocked — equal pips, a draw';
  if (state.done !== null) {
    const how = state.hands[state.done].length === 0 ? 'dominoed out' : 'blocked, lightest hand';
    return `player ${state.done} wins (${how})`;
  }
  if (!state.line.length) return `player ${state.turn} to set the first bone`;
  const [L, R] = ends(state);
  return `ends ${L}|${R} — hands ${state.hands[0].length}–${state.hands[1].length}, player ${state.turn} to play`;
}
