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

console.log(`\nRESULT: PASS (${n} live checks green)`);
