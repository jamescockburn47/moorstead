// Live-stack contract check: proves the DEPLOYED pieces (Vercel client, EVO relay,
// EVO brain) are up and still speak the protocol this client expects. Unlike the
// headless verify-*.mjs gates this one needs the network, so it is NOT part of
// `npm run verify` — run it on its own (`npm run verify:live`) before starting
// work, after touching anything server-facing, and it runs automatically after
// `npm run deploy` (with --expect-live: the live version must match package.json).
//
//   node scripts/verify-live.mjs                pre-work / pre-deploy mode
//   node scripts/verify-live.mjs --expect-live  post-deploy: live == package.json
//
// Checks, in order:
//   1. version.json on production — parses, and live is never AHEAD of the repo
//      (that would mean this checkout is behind what's shipped — pull first).
//   2. brain /status — the village brain answers and names its model.
//   3. roster /api/roster/state — the NPC roster is populated and the shape the
//      client's roster.js consumes (id/name/state) hasn't drifted.
//   4. relay WebSocket — join a scratch room (verify-harness), get the init the
//      client's multiplayer.js resolves on, round-trip a timeq, close clean.
//   5. bot-player protocol round-trip — TWO sockets in verify-harness; A's join,
//      pos and edit broadcasts must all reach B (the relay never echoes a sender
//      its own message back, so a second socket is the only honest witness).
//      The edit is made and then reverted (id back to 0), leaving the room clean.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cmp } from '../src/update-check.js';

const EXPECT_LIVE = process.argv.includes('--expect-live');
const SITE = 'https://www.moorstead.app';
const EVO = 'https://moorstead.sovren.xyz';
const WS_URL = 'wss://moorstead.sovren.xyz/ws';

let n = 0;
const ok = (cond, msg) => {
  if (!cond) { console.error(`  FAIL  ${msg}`); process.exitCode = 1; throw new Error(msg); }
  console.log(`  ok    ${msg}`); n++;
};
const info = (msg) => console.log(`  info  ${msg}`);

const getJson = async (url, timeoutMs = 10000) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
};

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')
);

// ---- 1. deployed client version --------------------------------------------
console.log('== live version.json ==');
{
  // post-deploy, Vercel can take a few seconds to serve the new build — retry
  let live = null, tries = EXPECT_LIVE ? 4 : 1;
  for (let i = 1; i <= tries; i++) {
    live = await getJson(`${SITE}/version.json?t=${Date.now()}`);
    if (!EXPECT_LIVE || cmp(live.version, pkg.version) === 0) break;
    if (i < tries) { info(`live is ${live.version}, want ${pkg.version} — retry ${i}/${tries - 1} in 5s`); await new Promise(r => setTimeout(r, 5000)); }
  }
  ok(live && typeof live.version === 'string' && typeof live.min === 'string',
    `version.json parses (live ${live.version}, min ${live.min})`);
  ok(cmp(live.min, live.version) <= 0, 'live min <= live version (a min above version would force-reload everyone into nowt)');
  if (EXPECT_LIVE) {
    ok(cmp(live.version, pkg.version) === 0, `live version equals package.json (${pkg.version}) after deploy`);
  } else {
    ok(cmp(live.version, pkg.version) <= 0, `live (${live.version}) is not ahead of this checkout (${pkg.version}) — if it is, pull first`);
    if (cmp(live.version, pkg.version) < 0) info(`repo is ahead of live (${pkg.version} > ${live.version}) — undeployed work, as expected mid-change`);
  }
}

// ---- 2. brain ----------------------------------------------------------------
console.log('== brain /status ==');
{
  const s = await getJson(`${EVO}/brain/status`, 8000);
  ok(s && (s.status === 'ok' || s.status === 'online'), `brain answers (status=${s.status}, model=${s.model || '?'})`);
}

// ---- 3. roster ----------------------------------------------------------------
console.log('== roster /api/roster/state ==');
{
  const r = await getJson(`${EVO}/brain/api/roster/state`, 10000);
  ok(Array.isArray(r.npcs), 'roster returns an npcs array');
  ok(r.npcs.length >= 50, `roster is populated (${r.npcs.length} NPCs, want >= 50)`);
  ok(Number.isFinite(r.seq), `roster seq is numeric (${r.seq})`);
  const bad = r.npcs.filter(p => !p.id || !p.name || !p.state || typeof p.state.kind !== 'string');
  ok(bad.length === 0, `every NPC has the id/name/state.kind shape roster.js reads (${bad.length} malformed)`);
  const drift = Math.abs(Date.now() / 1000 - r.now);
  ok(drift < 600, `server clock within 10 min of local (drift ${Math.round(drift)}s)`);
}

// ---- 4. relay WebSocket --------------------------------------------------------
console.log('== relay websocket ==');
await new Promise((resolve, reject) => {
  const pid = 'verify-' + Math.random().toString(36).slice(2, 10);
  const url = `${WS_URL}?room=verify-harness&pid=${pid}&name=${encodeURIComponent('Verify Harness')}&epoch=0`;
  const ws = new WebSocket(url);
  let gotInit = false, pingAt = 0;
  const fail = (m) => { try { ws.close(); } catch { /* already down */ } reject(new Error(m)); };
  const guard = setTimeout(() => fail('relay: no init within 15s'), 15000);
  ws.onopen = () => info('socket open, waiting on init…');
  ws.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === 'init' && !gotInit) {
      gotInit = true;
      ok(true, `relay sent init (room verify-harness, ${Array.isArray(m.players) ? m.players.length : '?'} players, epoch ${m.epoch ?? '?'})`);
      pingAt = Date.now();
      ws.send(JSON.stringify({ type: 'timeq' }));
    } else if (m.type === 'time' && pingAt) {
      const rtt = Date.now() - pingAt;
      ok(rtt < 5000, `timeq round-trip answered (${rtt}ms)`);
      clearTimeout(guard);
      ws.close(1000);
      resolve();
    }
  };
  ws.onclose = (ev) => {
    if (gotInit && pingAt) return; // clean finish path already resolved
    clearTimeout(guard);
    fail(`relay closed before completing (code ${ev.code}${ev.code === 4003 ? ' — relay wants a token; if joins now need auth, update this script AND check update-check/minClientVersion' : ''})`);
  };
  ws.onerror = () => { /* onclose carries the story */ };
});

// ---- 5. bot-player protocol round-trip ------------------------------------------
// Two bot players prove the relay still RELAYS, not merely answers. Facts checked
// against the live relay source (~/moorstead/worldsvc/server.py on the EVO):
//   - join/pos/edit are broadcast with skip=<sender> — a sender NEVER receives its
//     own message back, so B (not A) must witness everything A sends.
//   - pos is rebroadcast raw and immediately (pid stamped in, no aggregation) to
//     everyone in the room regardless of distance; only chat is range-limited.
//   - edits are refused until the client's acked epoch >= room epoch (epoch_gate
//     may_persist) — so the bot mimics the client's post-init {type:'epochack'}.
//   - relay edit bounds: 0 <= y < 64, 0 <= id < 64, |x|,|z| < 100000.
//   - an edit with id == was POPS the room's edit-ledger entry, so editing air
//     0 -> 3 -> 0 asserts two broadcasts AND leaves the ledger exactly as found.
//   - pids beginning with 'a' are treated as invited accounts and demand a token;
//     bot pids must not start with 'a' (ours start 'verify-').
console.log('== relay protocol round-trip (two bot players) ==');
{
  const run = Math.random().toString(36).slice(2, 8);
  const EX = 77777, EY = 60, EZ = -77777, EID = 3; // scratch coord: air high over nowhere, inside relay bounds

  class Bot {
    constructor(tag, label) {
      this.pid = `verify-bot-${tag}-${run}`;
      this.label = label;
      this.inbox = [];   // every non-init message, so nothing is lost between waits
      this.waiters = []; // pending waitFor rescans
      this.ws = null;
    }
    connect(timeoutMs = 15000) {
      return new Promise((resolve, reject) => {
        const url = `${WS_URL}?room=verify-harness&pid=${this.pid}&name=${encodeURIComponent(this.label)}&epoch=0`;
        this.ws = new WebSocket(url);
        let init = false;
        this.ws.onmessage = (e) => {
          let m; try { m = JSON.parse(e.data); } catch { return; }
          if (m.type === 'init' && !init) { init = true; resolve(m); return; }
          this.inbox.push(m);
          for (const w of this.waiters.splice(0)) w();
        };
        this.ws.onclose = (ev) => { if (!init) reject(new Error(`${this.label}: relay closed before init (code ${ev.code})`)); };
        this.ws.onerror = () => { /* onclose carries the story */ };
        setTimeout(() => { if (!init) reject(new Error(`${this.label}: no init within ${timeoutMs}ms`)); }, timeoutMs);
      });
    }
    send(obj) { this.ws.send(JSON.stringify(obj)); }
    waitFor(pred, what, timeoutMs = 10000) {
      const scan = () => { const i = this.inbox.findIndex(pred); return i === -1 ? null : this.inbox.splice(i, 1)[0]; };
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`${this.label}: did not receive ${what} within ${timeoutMs}ms`)), timeoutMs);
        const attempt = () => { const m = scan(); if (m) { clearTimeout(t); resolve(m); } else this.waiters.push(attempt); };
        attempt();
      });
    }
    close() { try { this.ws?.close(1000); } catch { /* already down */ } }
  }

  const botB = new Bot('b', 'Verify Bot B');
  const botA = new Bot('a', 'Verify Bot A');

  const roundTrip = async () => {
    // B joins FIRST so it is in the room to witness A's join broadcast.
    const initB = await botB.connect();
    ok(initB && Array.isArray(initB.edits), `bot B got init (epoch ${initB.epoch ?? '?'}, ${Object.keys(initB.players || {}).length} players already in)`);
    const initA = await botA.connect();
    ok(initA && Array.isArray(initA.edits), `bot A got init (epoch ${initA.epoch ?? '?'})`);
    ok(initA.players && botA.pid !== botB.pid && botB.pid in initA.players, `A's init lists B among the players (distinct pids)`);

    const join = await botB.waitFor(m => m.type === 'join' && m.pid === botA.pid, `join broadcast for ${botA.pid}`);
    ok(join.pid === botA.pid, `B witnessed A's join broadcast (name "${join.name}")`);

    // mimic the client's onInit: ack the room epoch, else may_persist refuses our edits
    botA.send({ type: 'epochack', epoch: +initA.epoch || 0 });

    // pos: A reports a position, B must hear it (relay skips only the sender)
    const px = EX + 0.5, py = EY + 2, pz = EZ + 0.5, pyaw = 1.57;
    botA.send({ type: 'pos', x: px, y: py, z: pz, yaw: pyaw });
    const pos = await botB.waitFor(m => m.type === 'pos' && m.pid === botA.pid, `pos broadcast for ${botA.pid}`);
    ok(Math.abs(pos.x - px) < 0.01 && Math.abs(pos.y - py) < 0.01 && Math.abs(pos.z - pz) < 0.01 && Math.abs(pos.yaw - pyaw) < 0.01,
      `B received A's pos with the coords A sent (${pos.x}, ${pos.y}, ${pos.z}, yaw ${pos.yaw})`);

    // edit: place a block (mirrors multiplayer.js sendEdit), B must hear the broadcast
    botA.send({ type: 'edit', x: EX, y: EY, z: EZ, id: EID, was: 0, cat: 'build', day: 0, by: botA.pid });
    const ed = await botB.waitFor(m => m.type === 'edit' && m.x === EX && m.y === EY && m.z === EZ, `edit broadcast at ${EX},${EY},${EZ}`);
    ok(ed.id === EID, `B received A's block edit (id ${ed.id} at ${EX},${EY},${EZ}) — epochack was honoured`);

    // inverse edit: id == was == 0 pops the ledger entry (room left clean) AND is
    // itself broadcast, doubling as a second edit assertion.
    botA.send({ type: 'edit', x: EX, y: EY, z: EZ, id: 0, was: 0, cat: 'build', day: 0, by: botA.pid });
    const ed2 = await botB.waitFor(m => m.type === 'edit' && m.x === EX && m.y === EY && m.z === EZ, `inverse-edit broadcast at ${EX},${EY},${EZ}`);
    ok(ed2.id === 0, `B received the inverse edit (id 0) — block restored, edit ledger left clean`);
  };

  let guardT;
  const guard = new Promise((_, rej) => { guardT = setTimeout(() => rej(new Error('bot round-trip: overall 60s guard tripped — the section can never hang')), 60000); });
  try {
    await Promise.race([roundTrip(), guard]);
  } catch (e) {
    if (process.exitCode !== 1) { console.error(`  FAIL  ${e.message}`); process.exitCode = 1; }
    throw e;
  } finally {
    clearTimeout(guardT);
    botA.close();
    botB.close();
  }
  info('both bot sockets closed clean (code 1000)');
}

console.log(`\nRESULT: PASS (${n} live checks green)`);
