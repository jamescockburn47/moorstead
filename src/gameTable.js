// src/gameTable.js — Workstream D4 Task B: the pub-game session. A PURE
// reducer over the four engines in src/games/ (ENGINE-CONTRACT.md), plus a
// couple of thin lookup helpers. No THREE, no DOM — main.js/ui.js are the
// only callers that touch the world/camera/panel; this module never does.
//
// Session shape (plain JSON, mirrors the engine-state discipline):
//   {
//     gameId, state (engine state), opponent: {name, role, mobId|null},
//     wager, level, seed, over: bool, result: null|'w'|'l'|'d', plies,
//   }
//
// `result` is always from the PLAYER's (challenger, engine player 0) point
// of view — 'w' player 0 won, 'l' player 0 lost, 'd' draw. This is the same
// vocabulary ledgers.js's recordGameResult expects.

import * as merrils from './games/merrils.js';
import * as draughts from './games/draughts.js';
import * as dominoes from './games/dominoes.js';
import * as shoveha from './games/shoveha.js';
import { strSeed } from './noise.js';
import { relCell } from './innplan.js';

export const ENGINES = {
  [merrils.GAME_ID]: merrils,
  [draughts.GAME_ID]: draughts,
  [dominoes.GAME_ID]: dominoes,
  [shoveha.GAME_ID]: shoveha,
};

export function gameLabel(gameId) {
  const e = ENGINES[gameId];
  return e ? e.GAME_LABEL : gameId;
}

// Villager role -> NPC difficulty level (1..3), per the D4 plan's ground-truth
// annex. Anything not listed (trades/constable/railway/etc.) defaults to 3 —
// the "everything-else" bucket, i.e. a settled adult plays a sharp game.
export const ROLE_LEVEL = {
  child: 1,
  gossip: 1,
  pedlar: 2,
  rambler: 2,
};
export function levelForRole(role) {
  return ROLE_LEVEL[role] || 3;
}

// --- table lookup -----------------------------------------------------

// Does world cell (x, y, z) sit on one of the 4 undercroft game tables of any
// plan in `inns` (a Map<villageName, plan> — world.gen.inns)? Table cells have no
// unique block id (they're plain B.PLANKS), so we match by coordinate: each
// plan's parlour.tables[i] is a door-relative (f,l) cell, resolved to world via
// innplan.js relCell (the single source of truth the worldgen carve also uses).
// Returns { plan, index, game } or null.
export function tableAt(x, y, z, inns) {
  if (!inns) return null;
  for (const plan of inns.values()) {
    const floorY = plan.parlour.floorY;
    if (y !== floorY + 1) continue;
    const tables = plan.parlour.tables;
    for (let i = 0; i < tables.length; i++) {
      const t = tables[i];
      const w = relCell(plan.origin, plan.doorSide, t.f, t.l);
      if (w.x === x && w.z === z) return { plan, index: i, game: t.game };
    }
  }
  return null;
}

// --- session reducer ----------------------------------------------------

// newSession({gameId, opponent:{name,role,mobId}, wager, seed}) -> session
export function newSession({ gameId, opponent, wager, seed }) {
  const engine = ENGINES[gameId];
  if (!engine) throw new Error('unknown gameId: ' + gameId);
  const level = levelForRole(opponent && opponent.role);
  return {
    gameId,
    state: engine.initState(seed | 0),
    opponent: { name: (opponent && opponent.name) || 'a passing local', role: (opponent && opponent.role) || 'rambler', mobId: (opponent && opponent.mobId) || null },
    wager: Math.max(0, wager | 0),
    level,
    seed: seed | 0,
    over: false,
    result: null,
    plies: 0,
  };
}

function deriveResult(session, engineWinner) {
  // engine player 0 is always the challenger/player (ENGINE-CONTRACT.md).
  if (engineWinner === 'draw') return 'd';
  if (engineWinner === 0) return 'w';
  if (engineWinner === 1) return 'l';
  return null;
}

function withWinnerCheck(session) {
  const engine = ENGINES[session.gameId];
  const w = engine.winner(session.state);
  if (w === null) return session;
  return { ...session, over: true, result: deriveResult(session, w) };
}

// sessionMove(session, move) -> new session, PURE. Applies the player's
// (or NPC's — the engine doesn't care whose turn it structurally is)
// chosen move, bumps the ply counter, and checks for a finished game.
export function sessionMove(session, move) {
  if (session.over) return session;
  const engine = ENGINES[session.gameId];
  const nextState = engine.applyMove(session.state, move);
  const next = { ...session, state: nextState, plies: session.plies + 1 };
  return withWinnerCheck(next);
}

// sessionNpcReply(session) -> new session, PURE and deterministic for the
// same session (bestMove is seeded off session.seed ^ plies, so replaying
// the same session from the same point always picks the same NPC move).
export function sessionNpcReply(session) {
  if (session.over) return session;
  const engine = ENGINES[session.gameId];
  const move = engine.bestMove(session.state, session.level, (session.seed ^ session.plies) >>> 0);
  if (!move) {
    // no legal move for the side to move (shouldn't outlast winner() saying
    // so, but guard rather than throw mid-session): treat as a stalemate draw.
    return { ...session, over: true, result: 'd' };
  }
  return sessionMove(session, move);
}

// Whose go is it? True when the NPC (player 1) is to move. The caller that
// builds a fresh session MUST check this — dominoes' opening rule can hand
// the first move to the NPC (whoever holds the highest double), and the
// reply timer only runs after a PLAYER move, so an unchecked NPC opening
// deadlocks the table (found live, D4 proof pass 2026-07-04).
export function npcToMove(session) {
  if (session.over) return false;
  return ENGINES[session.gameId].currentPlayer(session.state) === 1;
}

// sessionForfeit(session) -> session over, player loses (ESC mid-game, or
// the player has no legal move and declines to continue). PURE.
export function sessionForfeit(session) {
  if (session.over) return session;
  return { ...session, over: true, result: 'l' };
}

// settleWager(session) -> { earnPence, toast }. Pure arithmetic per the D4
// plan: spend(wager) already happened at session start; on win the player
// gets their stake back PLUS the opponent's matching stake (wager*2); on a
// draw the stake is simply returned (wager); on a loss nothing comes back.
export function settleWager(session) {
  if (!session.over) return { earnPence: 0, toast: '' };
  const w = session.wager;
  if (session.result === 'w') {
    const earnPence = w * 2;
    const toast = w > 0
      ? `Tha's won! ${earnPence}d off ${session.opponent.name}.`
      : `Tha's won a friendly game off ${session.opponent.name}.`;
    return { earnPence, toast };
  }
  if (session.result === 'd') {
    const toast = w > 0
      ? `A draw wi' ${session.opponent.name} — thi ${w}d stake comes back.`
      : `A draw wi' ${session.opponent.name}.`;
    return { earnPence: w, toast };
  }
  // loss
  const toast = w > 0
    ? `Beaten by ${session.opponent.name} — ${w}d gone.`
    : `Beaten by ${session.opponent.name}.`;
  return { earnPence: 0, toast };
}

// --- board rendering (monospace strings; the panel wraps them in a <pre>) --

function renderMerrils(state) {
  // 24-point diagram, 3 concentric squares. ○ = player0, ● = player1, · = empty.
  const ch = (p) => (state.board[p] === 0 ? '○' : state.board[p] === 1 ? '●' : '·');
  const c = (...pts) => pts.map(ch);
  const [o0, o1, o2, o3, o4, o5, o6, o7] = c(0, 1, 2, 3, 4, 5, 6, 7);
  const [m0, m1, m2, m3, m4, m5, m6, m7] = c(8, 9, 10, 11, 12, 13, 14, 15);
  const [i0, i1, i2, i3, i4, i5, i6, i7] = c(16, 17, 18, 19, 20, 21, 22, 23);
  return [
    `${o0}-----------${o1}-----------${o2}`,
    `|           |           |`,
    `|   ${m0}-------${m1}-------${m2}   |`,
    `|   |       |       |   |`,
    `|   |   ${i0}---${i1}---${i2}   |   |`,
    `${o7}---${m7}---${i7}       ${i3}---${m3}---${o3}`,
    `|   |   ${i6}---${i5}---${i4}   |   |`,
    `|   |       |       |   |`,
    `|   ${m6}-------${m5}-------${m4}   |`,
    `|           |           |`,
    `${o6}-----------${o5}-----------${o4}`,
  ].join('\n');
}

function renderDraughts(state) {
  const rows = [];
  for (let row = 0; row < 8; row++) {
    let line = '';
    for (let col = 0; col < 8; col++) {
      if ((row + col) % 2 === 0) { line += '. '; continue; }
      const s = row * 4 + Math.floor(col / 2);
      const p = state.board[s];
      if (!p) { line += '_ '; continue; }
      const glyph = p.owner === 0 ? (p.king ? 'W' : 'w') : (p.king ? 'B' : 'b');
      line += glyph + ' ';
    }
    rows.push(line.trimEnd());
  }
  return rows.join('\n');
}

function renderDominoes(state) {
  const tile = (t) => `[${t[0]}|${t[1]}]`;
  const line = state.line.length ? state.line.map(tile).join(' ') : '(empty)';
  const hand0 = state.hands[0].map(tile).join(' ');
  const hand1len = state.hands[1].length;
  return [
    `Line: ${line}`,
    `Thi hand: ${hand0}`,
    `Their hand: ${hand1len} tile${hand1len === 1 ? '' : 's'}`,
    `Boneyard: ${state.boneyard.length} (never drawn — block play)`,
  ].join('\n');
}

function renderShoveha(state) {
  const rows = [];
  for (let bed = 1; bed <= 9; bed++) {
    const b = state.beds[bed - 1];
    const bar0 = '●'.repeat(b[0]) + '·'.repeat(2 - b[0]);
    const bar1 = '○'.repeat(b[1]) + '·'.repeat(2 - b[1]);
    rows.push(`bed ${bed}: thee [${bar0}]  them [${bar1}]`);
  }
  return rows.join('\n');
}

const RENDERERS = {
  [merrils.GAME_ID]: renderMerrils,
  [draughts.GAME_ID]: renderDraughts,
  [dominoes.GAME_ID]: renderDominoes,
  [shoveha.GAME_ID]: renderShoveha,
};

// renderBoard(session) -> non-empty string, the board for the panel's <pre>.
export function renderBoard(session) {
  const fn = RENDERERS[session.gameId];
  return fn ? fn(session.state) : '';
}

// A stable per-opponent seed component so two different opponents (or a
// fallback "passing local") don't play out identically even with the same
// wager/table — mixed with the world seed + a session counter by the caller
// (main.js), per the D4 plan's seed formula.
export function opponentSeed(name) {
  return strSeed(name || 'a passing local');
}
