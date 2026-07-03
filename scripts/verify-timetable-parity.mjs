// The timetable is the shared truth: nextDeparture() must agree, to the second,
// with the live engine's trainScheduleFor() pingpong — and (via the exported
// fixture, Task 3) with the EVO brain's Python port.
import assert from 'node:assert';
import { DWELL_T, legTime, callOffset, stationCallK, nextDeparture } from '../src/railtime.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

// A toy 4-station line with unequal legs (lengths in metres -> legTime seconds).
const legT = [400, 900, 250].map(legTime);
const N = 4;
const oneway = legT.reduce((a, b) => a + b, 0) + N * DWELL_T;

// callOffset: k-th dwell starts after k dwells + the legs already run, per direction
ok(callOffset(legT, N, 0, 0) === 0, 'dir0 first call at t=0 of the pass');
ok(callOffset(legT, N, 0, 2) === 2 * DWELL_T + legT[0] + legT[1], 'dir0 third call');
ok(callOffset(legT, N, 1, 1) === DWELL_T + legT[2], 'dir1 runs the legs in reverse order');
ok(stationCallK(N, 0, 2) === 2 && stationCallK(N, 1, 2) === 1, 'station->call index per direction');

// nextDeparture: correct direction, dep >= tMin, arr later in the SAME pass
for (const [from, to] of [[0, 3], [3, 0], [1, 2], [2, 1]]) {
  for (let i = 0; i < 25; i++) {
    const tMin = i * 977.3;
    const { dep, arr, dir } = nextDeparture(legT, N, from, to, tMin);
    ok(dep >= tMin, `dep after tMin (${from}->${to} @${tMin})`);
    ok(arr > dep, 'arrives after departing');
    ok(dir === (to > from ? 0 : 1), 'direction matches the journey');
    ok(Math.floor(dep / oneway + 1e-9) % 2 === dir, 'departure pass runs the right way (epsilon-robust at exact pass boundaries)');
    ok(arr - dep < oneway, 'arrival within the same directional pass');
    // the NEXT valid departure after this one is exactly 2*oneway later
    const again = nextDeparture(legT, N, from, to, dep + 1);
    ok(Math.abs(again.dep - (dep + 2 * oneway)) < 1e-6, 'service repeats every 2*oneway');
  }
}

// (pure-half total rolled into the combined total printed below)

// ---- live-engine parity + committed-file staleness ----------------------------------
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const tt = JSON.parse(readFileSync(new URL('../brain-sync/timetable.json', import.meta.url), 'utf8'));
const fx = JSON.parse(readFileSync(new URL('../brain-sync/timetable-fixture.json', import.meta.url), 'utf8'));
ok(tt.lines.length >= 1 && fx.length >= 10, 'timetable + fixture committed and non-trivial');

// staleness: regenerating must be a no-op (determinism + committed copy in sync)
const before = readFileSync(new URL('../brain-sync/timetable.json', import.meta.url), 'utf8')
             + readFileSync(new URL('../brain-sync/timetable-fixture.json', import.meta.url), 'utf8');
execFileSync(process.execPath, [new URL('./export-timetable.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')]);
const after = readFileSync(new URL('../brain-sync/timetable.json', import.meta.url), 'utf8')
            + readFileSync(new URL('../brain-sync/timetable-fixture.json', import.meta.url), 'utf8');
ok(before === after, 'committed brain-sync files match a fresh export (not stale)');

// every fixture departure re-derives to the same doubles (self-consistency).
for (const s of fx.slice(0, 40)) {
  const L = tt.lines.find(l => l.name === s.line);
  const nn = L.stations.length;
  const check = nextDeparture(L.legT, nn, s.from, s.to, s.tMin);
  ok(check.dep === s.dep && check.arr === s.arr && check.dir === s.dir,
     `fixture sample stable (${s.line} ${s.from}->${s.to})`);
}

// ---- LIVE-ENGINE PARITY: nextDeparture lands on real dwells of a faithful copy of
// Game.trainScheduleFor's dwell logic (transcribed verbatim from main.js). This is the
// parity that MATTERS — NPCs must board the train the PLAYER sees. Sample MID-DWELL
// (dep + DWELL_T/2) so the check is robust to exact-boundary FP.
function dwellStationAt(legT, nn, now) {
  const oneway = legT.reduce((a, b) => a + b, 0) + nn * DWELL_T;
  const dir = Math.floor(now / oneway) % 2;
  const idx = k => (dir === 0 ? k : nn - 1 - k);
  const leg = k => legT[dir === 0 ? k : nn - 2 - k];
  let tt = ((now % oneway) + oneway) % oneway;
  for (let k = 0; k < nn; k++) {
    if (tt < DWELL_T) return idx(k);
    tt -= DWELL_T;
    if (k < nn - 1) { const L = leg(k); if (tt < L) return -1; tt -= L; }
  }
  return idx(nn - 1);
}
for (const s of fx) {
  const L = tt.lines.find(l => l.name === s.line);
  const nn = L.stations.length;
  ok(dwellStationAt(L.legT, nn, s.dep + DWELL_T / 2) === s.from,
     `engine dwells at 'from' mid-departure (${s.line} ${s.from}->${s.to})`);
  ok(dwellStationAt(L.legT, nn, s.arr + DWELL_T / 2) === s.to,
     `engine dwells at 'to' mid-arrival (${s.line} ${s.from}->${s.to})`);
}
console.log(`verify-timetable-parity: ${n} assertions OK`);
