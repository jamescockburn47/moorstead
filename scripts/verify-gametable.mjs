// src/gameTable.js — Workstream D4 Task B: table lookup + session reducer +
// board rendering. run wi': node scripts/verify-gametable.mjs
import {
  tableAt, newSession, sessionMove, sessionNpcReply, sessionForfeit,
  settleWager, renderBoard, levelForRole, ENGINES, npcToMove,
} from '../src/gameTable.js';
import { Gen } from '../src/worldgen.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const check = (c, m) => (c ? ok(m) : bad(m));

// --- tableAt: finds all 4 Grosmont tables of a real plan, rejects neighbours ---
{
  const gen = new Gen(12345);
  const inns = gen.inns;
  const plan = inns.get('Grosmont');
  check(!!plan, 'Gen(12345) builds a Grosmont plan to test against');

  if (plan) {
    const { relCell } = await import('../src/innplan.js');
    const floorY = plan.parlour.floorY;
    const tables = plan.parlour.tables;
    const rc = (t) => relCell(plan.origin, plan.doorSide, t.f, t.l);
    check(tables.length === 4, 'the plan has 4 parlour tables');

    let allFound = true;
    const gamesSeen = new Set();
    for (const t of tables) {
      const w = rc(t);
      const hit = tableAt(w.x, floorY + 1, w.z, inns);
      if (!hit || hit.plan !== plan || hit.game !== t.game) allFound = false;
      gamesSeen.add(t.game);
    }
    check(allFound, 'tableAt finds all 4 real table cells with the correct game');
    check(gamesSeen.size === 4, 'the 4 tables carry 4 distinct games');

    // reject a neighbouring (non-table) cell, and a table cell at the wrong y
    const w0 = rc(tables[0]);
    const missY = tableAt(w0.x, floorY + 2, w0.z, inns);
    check(missY === null, 'tableAt rejects the right x/z at the wrong y');
    const missXZ = tableAt(w0.x + 1, floorY + 1, w0.z + 1, inns);
    check(missXZ === null, 'tableAt rejects a neighbouring (non-table) cell');
    check(tableAt(0, 0, 0, inns) === null, 'tableAt rejects a wild-off-map coordinate');
    check(tableAt(0, 0, 0, null) === null, 'tableAt tolerates a missing inns map');
  }
}

// --- role -> level table ---
{
  check(levelForRole('child') === 1, "role 'child' -> level 1");
  check(levelForRole('gossip') === 1, "role 'gossip' -> level 1");
  check(levelForRole('pedlar') === 2, "role 'pedlar' -> level 2");
  check(levelForRole('rambler') === 2, "role 'rambler' -> level 2");
  check(levelForRole('constable') === 3, "an unlisted role (constable) -> level 3 (everything-else)");
  check(levelForRole('railway') === 3, "an unlisted role (railway) -> level 3");
  check(levelForRole(undefined) === 3, 'no role at all -> level 3 (safe default)');
}

// --- newSession/sessionMove determinism: same inputs, same outputs ---
for (const gameId of Object.keys(ENGINES)) {
  const opts = { gameId, opponent: { name: 'Jabez Trattles', role: 'gossip' }, wager: 2, seed: 777 };
  const a = newSession(opts);
  const b = newSession(opts);
  check(JSON.stringify(a) === JSON.stringify(b), `${gameId}: newSession is deterministic for identical opts`);
  check(a.level === 1, `${gameId}: gossip opponent gets level 1`);
  check(a.wager === 2 && a.over === false && a.result === null, `${gameId}: fresh session shape is correct`);

  const engine = ENGINES[gameId];
  const moves = engine.legalMoves(a.state);
  check(Array.isArray(moves) && moves.length > 0, `${gameId}: fresh session has legal moves`);
  if (moves.length) {
    const m1 = sessionMove(a, moves[0]);
    const m2 = sessionMove(b, moves[0]);
    check(JSON.stringify(m1) === JSON.stringify(m2), `${gameId}: sessionMove is deterministic (replay identical)`);
    check(m1.plies === 1, `${gameId}: sessionMove bumps the ply counter`);
    check(m1.state !== a.state, `${gameId}: sessionMove never mutates the input session (new state object)`);
  }
}

// --- full seeded self-play: legalMoves[0] drives the player, sessionNpcReply
// drives the NPC, for all 4 games, at every level, terminating within a
// generous bound. Also proves sessionNpcReply is itself deterministic. ---
for (const gameId of Object.keys(ENGINES)) {
  for (const level of [1, 2, 3]) {
    let session = newSession({ gameId, opponent: { name: 'a passing local', role: 'rambler' }, wager: 0, seed: 42 });
    session = { ...session, level }; // force the level under test regardless of role mapping
    const engine = ENGINES[gameId];
    let steps = 0;
    const CAP = 4000; // generous — shoveha's MAX_HANDS*SHOVES_PER_HAND=200 plies is the longest engine
    while (!session.over && steps < CAP) {
      const moves = engine.legalMoves(session.state);
      if (!moves.length) { session = sessionForfeit(session); break; }
      session = sessionMove(session, moves[0]);   // "player" always takes the first legal move
      if (session.over) break;
      session = sessionNpcReply(session);          // NPC replies via bestMove(level, seed^plies)
      steps++;
    }
    check(session.over === true, `${gameId} @ level ${level}: self-play (legalMoves[0] vs bestMove) terminates within ${CAP} steps (took ${steps})`);
    check(['w', 'l', 'd'].includes(session.result), `${gameId} @ level ${level}: terminates with a valid result (${session.result})`);
  }
}

// --- sessionNpcReply determinism in isolation ---
{
  const a = newSession({ gameId: 'draughts', opponent: { name: 'X', role: 'rambler' }, wager: 0, seed: 5 });
  const engine = ENGINES.draughts;
  const moves = engine.legalMoves(a.state);
  const afterPlayer = sessionMove(a, moves[0]);
  const r1 = sessionNpcReply(afterPlayer);
  const r2 = sessionNpcReply(afterPlayer);
  check(JSON.stringify(r1) === JSON.stringify(r2), 'sessionNpcReply is deterministic for the same session');
}

// --- sessionForfeit ---
{
  const a = newSession({ gameId: 'merrils', opponent: { name: 'X', role: 'rambler' }, wager: 6, seed: 1 });
  const f = sessionForfeit(a);
  check(f.over === true && f.result === 'l', 'sessionForfeit ends the session as a loss');
  const f2 = sessionForfeit(f);
  check(f2 === f, 'sessionForfeit on an already-over session is a no-op (same reference)');
}

// --- settleWager arithmetic: win/draw/loss, including the friendly (wager 0) path ---
{
  const base = { wager: 4, opponent: { name: 'Jabez Trattles' } };
  const win = settleWager({ ...base, over: true, result: 'w' });
  check(win.earnPence === 8, 'win: earnPence = wager * 2 (stake back + winnings)');
  check(typeof win.toast === 'string' && win.toast.length > 0, 'win: produces a non-empty toast');

  const draw = settleWager({ ...base, over: true, result: 'd' });
  check(draw.earnPence === 4, 'draw: earnPence = wager (stake returned)');

  const loss = settleWager({ ...base, over: true, result: 'l' });
  check(loss.earnPence === 0, 'loss: earnPence = 0 (nothing back)');

  const notOver = settleWager({ ...base, over: false, result: null });
  check(notOver.earnPence === 0 && notOver.toast === '', 'settleWager on a live session returns zero/empty (defensive)');

  const friendlyWin = settleWager({ wager: 0, opponent: { name: 'X' }, over: true, result: 'w' });
  check(friendlyWin.earnPence === 0, 'friendly game (wager 0): win pays out nothing (nothing was staked)');
  check(!friendlyWin.toast.includes('undefined'), 'friendly game toast has no undefined/NaN leakage');
}

// --- renderBoard: non-empty strings for fresh sessions of all 4 games ---
for (const gameId of Object.keys(ENGINES)) {
  const s = newSession({ gameId, opponent: { name: 'X', role: 'rambler' }, wager: 0, seed: 9 });
  const board = renderBoard(s);
  check(typeof board === 'string' && board.length > 0, `${gameId}: renderBoard returns a non-empty string for a fresh session`);
}

// --- NPC-opens deadlock regression (found live, D4 proof pass 2026-07-04):
// dominoes' opening rule can hand the FIRST move to the NPC (highest double
// opens); npcToMove must say so on the fresh session and sessionNpcReply must
// advance it — the reply timer only chains off npcToMove now. ---
{
  let found = null;
  for (let seed = 1; seed <= 40 && !found; seed++) {
    const s = newSession({ gameId: 'dominoes', opponent: { name: 'X', role: 'rambler' }, wager: 0, seed });
    if (npcToMove(s)) found = s;
  }
  check(!!found, 'dominoes: some seed within 40 deals the NPC the opening move');
  if (found) {
    const replied = sessionNpcReply(found);
    check(replied.plies === found.plies + 1, 'npcToMove + sessionNpcReply advances an NPC-opening session (deadlock regression)');
    check(!npcToMove(replied) || replied.over, 'after the NPC opening it is the player\'s go (strict alternation)');
  }
  // and the player-opens case must NOT flag the NPC
  let playerOpens = null;
  for (let seed = 1; seed <= 40 && !playerOpens; seed++) {
    const s = newSession({ gameId: 'dominoes', opponent: { name: 'X', role: 'rambler' }, wager: 0, seed });
    if (!npcToMove(s)) playerOpens = s;
  }
  check(!!playerOpens, 'dominoes: some seed within 40 deals the PLAYER the opening move (npcToMove false)');
  // merrils/draughts/shoveha: the challenger always opens
  for (const gameId of ['merrils', 'draughts', 'shoveha']) {
    const s = newSession({ gameId, opponent: { name: 'X', role: 'rambler' }, wager: 0, seed: 3 });
    check(!npcToMove(s), `${gameId}: the challenger opens (npcToMove false on a fresh session)`);
  }
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
