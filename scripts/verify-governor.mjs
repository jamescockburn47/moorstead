// Frame-time resolution governor check — run wi': node scripts/verify-governor.mjs
//
// stepGovernor is PURE (no THREE, no window, no clocks o' its own) but it lives in
// src/main.js, which can't be imported under Node — the module boots the game at
// top level. So this script slices the marked GOV-PURE block out of the SOURCE
// TEXT, strips the `export `s, and evals it. The contract under test: a machine
// that labours sheds quality one rung at a time (MSAA -> FXAA first, THEN pixel
// ratio down the ladder), recovery climbs slowly and never re-arms MSAA, and the
// whole thing is a deterministic pure function of (state, dtEmaMs, nowSec).
//
// Rules (docs/INVARIANTS.md rule 1): headless Node only — no DOM, no WebGL, no
// network, no clocks, no unseeded Math.random.

import { readFileSync } from 'node:fs';

let failed = false;
const ok  = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const m = mainSrc.match(/\/\/ GOV-PURE-BEGIN[^\n]*\n([\s\S]*?)\/\/ GOV-PURE-END/);
if (!m) {
  bad('GOV-PURE block not found in src/main.js — the sliceable markers have gone');
  console.log('\nRESULT: FAIL');
  process.exit(1);
}
const { stepGovernor, GOV_SCALES, GOV_SLOW_MS, GOV_FAST_MS } = new Function(
  `${m[1].replace(/^export /gm, '')}; return { stepGovernor, GOV_SCALES, GOV_SLOW_MS, GOV_FAST_MS };`
)();

// drive the governor at a fixed EMA'd frame time for `seconds` of sim, one pure
// decision every 0.5 s (the live cadence, main.js this._govT), from time t0
function run(state, dtMs, seconds, t0 = 0) {
  const changes = [];
  let t = t0;
  for (let i = 0; i < Math.round(seconds * 2); i++) {
    t += 0.5;
    state = stepGovernor(state, dtMs, t);
    if (state.changed) changes.push({ t, aa: state.aa, level: state.level, scale: state.scale });
  }
  return { state, changes, t };
}
const fresh = () => ({ level: 0, aa: 'msaa', badSince: null, goodSince: null }); // desktop opening stance

console.log('\n-- frame-time resolution governor (pure block sliced from main.js) --\n');

// --- the ladder and the thresholds themselves ---
{
  (JSON.stringify(GOV_SCALES) === JSON.stringify([1.5, 1.25, 1.0]) ? ok : bad)(
    `ladder is [1.5, 1.25, 1.0], full quality first (got [${GOV_SCALES}])`);
  (GOV_FAST_MS === 18 && GOV_SLOW_MS === 26 ? ok : bad)(
    `dead zone spans 18..26 ms (got ${GOV_FAST_MS}..${GOV_SLOW_MS})`);
}

// --- steady 60 fps: never steps, in either direction ---
{
  const { state, changes } = run(fresh(), 16.7, 120);
  (changes.length === 0 ? ok : bad)(`steady 16.7 ms for 120 s never steps (got ${changes.length} change(s))`);
  (state.level === 0 && state.aa === 'msaa' ? ok : bad)('…and stays at full quality with MSAA armed');
}

// --- sustained 30 ms: AA swap first, then resolution, then the floor ---
{
  const { state, changes } = run(fresh(), 30, 60);
  const seq = changes.map(c => `${c.aa}@${c.scale}`).join(' -> ');
  (changes.length === 3 ? ok : bad)(`sustained 30 ms sheds exactly 3 rungs then floors (got ${changes.length}: ${seq})`);
  (changes[0] && changes[0].aa === 'fxaa' && changes[0].scale === 1.5 ? ok : bad)(
    'rung 1: MSAA -> FXAA swap BEFORE any resolution step');
  (changes[0] && changes[0].t >= 3 ? ok : bad)(
    `first shed waits the full 3 s hold (fired at ${changes[0] && changes[0].t} s)`);
  (changes[1] && changes[1].scale === 1.25 ? ok : bad)('rung 2: resolution 1.5 -> 1.25');
  (changes[2] && changes[2].scale === 1.0 ? ok : bad)('rung 3: resolution 1.25 -> 1.0');
  (state.level === 2 && state.aa === 'fxaa' ? ok : bad)('the floor holds: scale 1.0 + FXAA, no further changes');
}

// --- a dip into the dead zone resets the 3 s hold timer ---
{
  const dead = (GOV_FAST_MS + GOV_SLOW_MS) / 2; // 22 ms: neither labouring nor clear
  let r = run(fresh(), 30, 2.5);                // 2.5 s labouring — not yet held 3 s
  (r.changes.length === 0 ? ok : bad)('2.5 s over the slow threshold alone: no step yet');
  r = run(r.state, dead, 0.5, r.t);             // one dead-zone sample
  (r.changes.length === 0 && r.state.badSince == null ? ok : bad)('a dip into the dead zone clears the bad clock');
  r = run(r.state, 30, 3, r.t);                 // labouring again — a FRESH 3 s hold starts
  (r.changes.length === 0 ? ok : bad)('3 s after the dip: still no step (the hold restarted from scratch)');
  r = run(r.state, 30, 0.5, r.t);
  (r.changes.length === 1 && r.changes[0].aa === 'fxaa' ? ok : bad)(
    'the step lands only once a fresh 3 s hold completes');
}

// --- recovery at 15 ms: one rung per 20 s, and MSAA never re-arms ---
{
  const floor = { level: 2, aa: 'fxaa', badSince: null, goodSince: null }; // after a bad spell
  const { state, changes } = run(floor, 15, 70);
  (changes.length === 2 ? ok : bad)(`70 s of clear air climbs exactly 2 rungs (got ${changes.length})`);
  (changes[0] && changes[0].t >= 20 && changes[0].scale === 1.25 ? ok : bad)(
    `first climb waits the full 20 s (fired at ${changes[0] && changes[0].t} s, scale ${changes[0] && changes[0].scale})`);
  (changes[1] && changes[1].scale === 1.5 ? ok : bad)('second climb restores full resolution');
  (changes.every(c => c.aa === 'fxaa') && state.aa === 'fxaa' ? ok : bad)(
    'aa stays fxaa throughout — MSAA never re-arms once shed');
  (state.level === 0 ? ok : bad)('fully recovered to the top rung, and holds there');
}

// --- purity: input never mutated, deterministic, no randomness ---
{
  const st = Object.freeze({ level: 0, aa: 'msaa', badSince: null, goodSince: null });
  const out = stepGovernor(st, 30, 1);
  (JSON.stringify(st) === '{"level":0,"aa":"msaa","badSince":null,"goodSince":null}' ? ok : bad)(
    'frozen input state is not mutated (a NEW state comes back)');
  (out !== st ? ok : bad)('the returned state is a fresh object, not the input');
  // determinism: an identical mixed workload twice, trace for trace (INVARIANTS.md rule 6)
  const trace = () => {
    let s = fresh(); const tr = [];
    for (let i = 1; i <= 240; i++) { s = stepGovernor(s, i % 40 < 20 ? 30 : 15, i * 0.5); tr.push(JSON.stringify(s)); }
    return tr.join('|');
  };
  (trace() === trace() ? ok : bad)('deterministic — two identical runs, identical traces');
  (!m[1].includes('Math.random') ? ok : bad)('the sliced block contains no Math.random');
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
