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

console.log(`verify-timetable-parity(pure): ${n} assertions OK`);
