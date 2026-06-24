// Headless check: stationOrient snaps a rail tangent to the nearest world cardinal,
// so a station BUILDING can be stamped as a clean n/s or e/w box (Stage 1a, Unit A).
import assert from 'node:assert';
import { stationOrient } from '../src/railpath.js';

let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

// near-N/S tangent (+x = north) → long axis runs north
eq(stationOrient(0.98, 0.20).along, [1, 0], 'NNE tangent → along +x');
eq(stationOrient(-0.95, 0.31).along, [-1, 0], 'SSW tangent → along -x');
// near-E/W tangent (+z = east) → long axis runs east
eq(stationOrient(0.20, 0.98).along, [0, 1], 'ENE tangent → along +z');
eq(stationOrient(0.20, -0.98).along, [0, -1], 'WNW tangent → along -z');
// 45° tie favours the x (north) axis deterministically
eq(stationOrient(0.7, 0.7).along, [1, 0], '45° tie → along +x');
// across is the left-perpendicular of along, and both are unit cardinals
eq(stationOrient(1, 0).across, [0, -1], 'along +x → across -z');
eq(stationOrient(0, 1).across, [1, 0], 'along +z → across +x');
// zero tangent must not produce [0,0] (degenerate) — defaults to +x
eq(stationOrient(0, 0).along, [1, 0], 'zero tangent → default +x');

console.log(`verify-station-align: ${n} assertions OK`);
