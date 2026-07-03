// Shove ha'penny — pub-game engine (D4). Pure module per src/games/ENGINE-CONTRACT.md.
//
// THE ABSTRACTION. Real shove ha'penny is a dexterity game: you strike a coin up a
// slate board with the ball of your hand and it must settle cleanly between the
// scored lines of one of nine horizontal "beds". A voxel game cannot honestly host
// the wrist-work, so this is the turn-based pub-table version: each shove is a
// CHOICE (which bed you're playing for, how hard you strike) and the physics is a
// deterministic accuracy model — near beds want a soft touch, far beds want a sharp
// one, and a seeded hash draw against that accuracy decides whether the coin
// settles in the bed or skids to a miss.
//
// Deliberate v1 simplifications (documented, not accidental):
// - Real rules need THREE coins settled in EVERY one of the nine beds to win.
//   v1 shortens to FIRST TO 2 COINS IN 5 DIFFERENT BEDS, purely for session
//   length — a full 27-coin game outlasts a pub visit.
// - Real rule: a coin landed in a bed you have already filled scores the point
//   TO YOUR OPPONENT. v1: the coin is simply WASTED (no score either way).
// - Opponent's coins do not block or crowd a bed (no cannoning off resting
//   coins). This also means there is nothing to "deny", so bestMove level 3 is
//   greedy over needed beds rather than denial play.
//
// A turn ("hand") = 5 shoves of 5 ha'pennies, then the board passes over.
// Hard cap 40 hands: after that the higher total of settled coins wins,
// equal totals is a draw — the game always terminates.

import { hash3i } from '../noise.js';

export const GAME_ID = 'shoveha';
export const GAME_LABEL = "Shove Ha'penny";

export const BEDS = 9;              // horizontal beds, 1 (nearest) .. 9 (farthest)
export const COINS_PER_BED = 2;     // v1 shortening (real rules: 3)
export const BEDS_TO_WIN = 5;       // v1 shortening (real rules: all 9)
export const SHOVES_PER_HAND = 5;   // a hand of 5 ha'pennies
export const MAX_HANDS = 40;        // hard cap -> tiebreak on landed totals

export const STRENGTHS = ['soft', 'firm', 'sharp'];

// Accuracy table — the whole "aim" model. A simple distance story: near beds
// (1-3) reward a soft touch, middle beds (4-6) a firm one, far beds (7-9) a
// sharp strike. P(coin settles in the chosen bed); anything else is a miss.
const ACCURACY_BY_BAND = {
  near: { soft: 0.75, firm: 0.50, sharp: 0.25 }, // beds 1-3
  mid:  { soft: 0.50, firm: 0.75, sharp: 0.50 }, // beds 4-6
  far:  { soft: 0.25, firm: 0.50, sharp: 0.75 }, // beds 7-9
};

export function accuracyFor(bed, strength) {
  const band = bed <= 3 ? 'near' : bed <= 6 ? 'mid' : 'far';
  return ACCURACY_BY_BAND[band][strength];
}

function bestStrengthFor(bed) {
  return bed <= 3 ? 'soft' : bed <= 6 ? 'firm' : 'sharp';
}

export function initState(seed = 0) {
  return {
    game: GAME_ID,
    seed: seed | 0,
    turn: 0,                 // whose hand it is (0 = challenger)
    shoveIndex: 0,           // 0..4 within the current hand
    turnCount: 0,            // completed+current hand counter (increments when a hand ends)
    // beds[i] = [player0 coins settled, player1 coins settled] in bed i+1, capped at COINS_PER_BED
    beds: Array.from({ length: BEDS }, () => [0, 0]),
  };
}

export function currentPlayer(state) { return state.turn; }

function bedsWon(state, p) {
  let n = 0;
  for (const b of state.beds) if (b[p] >= COINS_PER_BED) n++;
  return n;
}

function landedTotal(state, p) {
  // Settled coins only — wasted coins (shoved at an already-full bed) never
  // counted, so they don't help the cap tiebreak either.
  let n = 0;
  for (const b of state.beds) n += b[p];
  return n;
}

export function winner(state) {
  if (bedsWon(state, 0) >= BEDS_TO_WIN) return 0;
  if (bedsWon(state, 1) >= BEDS_TO_WIN) return 1;
  if (state.turnCount >= MAX_HANDS) {
    const a = landedTotal(state, 0), b = landedTotal(state, 1);
    return a > b ? 0 : b > a ? 1 : 'draw';
  }
  return null;
}

export function legalMoves(state) {
  if (winner(state) !== null) return [];
  const moves = [];
  for (let bed = 1; bed <= BEDS; bed++)
    for (const strength of STRENGTHS)
      moves.push({ type: 'shove', bed, strength });
  return moves;
}

function isLegal(move) {
  return move && move.type === 'shove'
    && Number.isInteger(move.bed) && move.bed >= 1 && move.bed <= BEDS
    && STRENGTHS.indexOf(move.strength) !== -1;
}

// Deterministic land-or-miss draw for a shove in a given position.
function shoveDraw(state, move) {
  const sIdx = STRENGTHS.indexOf(move.strength);
  // one lattice point per (hand, shove, bed, strength) under the game seed
  return hash3i(state.turnCount * SHOVES_PER_HAND + state.shoveIndex,
    move.bed, sIdx + 1, state.seed);
}

export function applyMove(state, move) {
  if (!isLegal(move) || winner(state) !== null) throw new Error('illegal move');
  const next = JSON.parse(JSON.stringify(state));
  const p = next.turn;

  const landed = shoveDraw(state, move) < accuracyFor(move.bed, move.strength);
  if (landed && next.beds[move.bed - 1][p] < COINS_PER_BED) {
    next.beds[move.bed - 1][p]++;   // settles and scores
  }
  // landed into an already-full bed: wasted (v1 — real rules give the point away)
  // missed: nothing

  next.shoveIndex++;
  if (next.shoveIndex >= SHOVES_PER_HAND) {  // hand over — board passes
    next.shoveIndex = 0;
    next.turn = 1 - next.turn;
    next.turnCount++;
  }
  return next;
}

// bestMove — the aim model. All needed beds have a 0.75 best-strength accuracy,
// so "expected progress" is: correct strength on a bed I still need. Level 1
// sometimes (seeded) picks a sloppy bed/strength; level 2 is greedy over needed
// beds (lowest bed first); level 3 is greedy preferring beds where one coin is
// already settled (finishing beds fastest — no denial exists in v1, see header).
export function bestMove(state, level, seed = 0) {
  const moves = legalMoves(state);
  if (!moves.length) return null;
  const p = state.turn;
  const needed = [];
  for (let bed = 1; bed <= BEDS; bed++)
    if (state.beds[bed - 1][p] < COINS_PER_BED) needed.push(bed);
  if (!needed.length) return { type: 'shove', bed: 5, strength: 'firm' }; // can't occur pre-win; safe fallback

  const r = hash3i(state.turnCount * SHOVES_PER_HAND + state.shoveIndex, level, 7, seed ^ state.seed);
  if (level <= 1 && r < 0.4) {
    // sloppy: seeded needed bed with a seeded (possibly mismatched) strength
    const r2 = hash3i(state.turnCount * SHOVES_PER_HAND + state.shoveIndex, level, 11, seed ^ state.seed);
    const bed = needed[Math.floor(r * needed.length / 0.4) % needed.length];
    const strength = STRENGTHS[Math.floor(r2 * 3) % 3];
    return { type: 'shove', bed, strength };
  }
  let pick = needed[0];
  if (level >= 3) {
    // prefer a bed already holding one of my coins (one shove from complete)
    const nearlyDone = needed.filter(bed => state.beds[bed - 1][p] === COINS_PER_BED - 1);
    if (nearlyDone.length) pick = nearlyDone[0];
  }
  return { type: 'shove', bed: pick, strength: bestStrengthFor(pick) };
}

export function summary(state) {
  const w = winner(state);
  if (w === 'draw') return 'drawn at the cap — dead level on coins';
  if (w !== null) return (w === 0 ? 'challenger' : 'landlord’s side') + ' has five beds — game';
  return 'hand ' + (state.turnCount + 1) + ', shove ' + (state.shoveIndex + 1) + '/' + SHOVES_PER_HAND
    + ' — beds ' + bedsWon(state, 0) + ':' + bedsWon(state, 1)
    + ', coins ' + landedTotal(state, 0) + ':' + landedTotal(state, 1);
}
