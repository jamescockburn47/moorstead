// verify-roadperf.mjs — PERF CANARY for roadInfo.
//
// roadInfo must answer from the GLOBAL spatial grid (net.grid), touching only the
// 3x3 cell neighbourhood near (x,z) — NOT by looping every road edge in the parish.
// The all-edges version cost ~110us/cell and, scanned per-cell by the flora overlay
// (81x81), produced a ~770ms freeze on every few steps (the walk-stutter we fixed).
//
// This guards against re-introducing that O(edges) pathology. It is machine-
// INDEPENDENT: it compares roadInfo against a brute all-edges scan over the SAME
// net and points and asserts roadInfo is a large multiple faster — a ratio, so it
// can't flake on a slow/loaded CI runner. It also checks parity (same answers) and
// that the grid index exists.
//
// Run: node scripts/verify-roadperf.mjs
import { MoorsGeography } from '../src/moorsgeo.js';
import { buildRoadNet, roadInfo } from '../src/roadpath.js';

let failed = false;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failed = true; console.log('  FAIL  ' + m); };

const ROAD_REACH = 4; // mirror roadpath.js

const geo = new MoorsGeography();
const net = buildRoadNet(geo);
console.log(`\n== roadInfo perf canary (${net.edges.length} road edges) ==`);

// 1. structural: the global grid index exists and is populated
if (net.grid instanceof Map && net.grid.size > 0) ok(`net.grid present (${net.grid.size} cells)`);
else bad('net.grid missing or empty — roadInfo cannot be grid-accelerated');

// The OLD algorithm, kept ONLY as a reference to race against — loops every edge.
function brute(x, z) {
  let best = null;
  const cx = Math.floor(x / 8), cz = Math.floor(z / 8);
  for (const e of net.edges) {
    const path = e.path; if (!path.cells) continue;
    for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gz = cz - 1; gz <= cz + 1; gz++) {
      const idxs = path.cells.get(`${gx},${gz}`); if (!idxs) continue;
      for (const i of idxs) {
        const a = path.pts[i], b = path.pts[Math.min(i + 1, path.pts.length - 1)];
        const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 0.001;
        let t = ((x - a.x) * dx + (z - a.z) * dz) / L2; t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
        if (d < ROAD_REACH && (!best || d < best.d)) best = { d };
      }
    }
  }
  return best;
}

// Sample a patch around a village (crosses roads) — the realistic flora-scan case.
const v = geo.villages[0];
const pts = [];
for (let dx = -60; dx <= 60; dx += 2) for (let dz = -60; dz <= 60; dz += 2) pts.push([v.x + dx, v.z + dz]);

// 2. parity: grid and brute must agree on the nearest road for every sample cell
let mismatch = 0;
for (const [x, z] of pts) {
  const a = roadInfo(net, x, z), b = brute(x, z);
  if ((a === null) !== (b === null) || (a && Math.abs(a.d - b.d) > 1e-6)) mismatch++;
}
if (!mismatch) ok(`roadInfo matches the all-edges scan on all ${pts.length} sample cells`);
else bad(`roadInfo disagrees with the all-edges scan on ${mismatch}/${pts.length} cells`);

// 3. speed: roadInfo must be a large multiple faster than scanning all edges
const now = () => (globalThis.performance ? performance.now() : Number(process.hrtime.bigint()) / 1e6);
const time = (fn) => { const t = now(); for (const [x, z] of pts) fn(x, z); return now() - t; };
for (const [x, z] of pts) { roadInfo(net, x, z); brute(x, z); }  // warm JIT
let tGrid = Infinity, tBrute = Infinity;
for (let r = 0; r < 3; r++) {
  tGrid = Math.min(tGrid, time((x, z) => roadInfo(net, x, z)));
  tBrute = Math.min(tBrute, time((x, z) => brute(x, z)));
}
const ratio = tGrid > 0 ? tBrute / tGrid : Infinity;
console.log(`  grid ${tGrid.toFixed(1)}ms   all-edges ${tBrute.toFixed(1)}ms   speedup ${ratio.toFixed(1)}x   (${pts.length} cells x3)`);
// Currently ~20-50x. A floor of 5x trips if someone reverts to the O(edges) loop,
// yet never flakes (same-machine ratio, generous margin).
if (ratio >= 5) ok(`roadInfo ≥ 5x faster than the all-edges scan (${ratio.toFixed(1)}x)`);
else bad(`roadInfo only ${ratio.toFixed(1)}x faster than all-edges — grid acceleration likely lost`);

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
