// Headless: coastal & valley morphology. The DEM smooths the Heritage Coast flat;
// landmark sculpts (cliff/gully) + revived peaks restore the drama. Deterministic
// (_heightRawNoFbm), so this also guards the JS side of parity for the sculpts.
import assert from 'node:assert';
import { MoorsGeography } from '../src/moorsgeo.js';

const g = new MoorsGeography();
const WL = 26;
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const H = (x, z) => g._heightRawNoFbm(x, z);

// ---- Stage 1A: Whitby East Cliff (the abbey headland) ----
const cliff = g.data.landmarks.find(l => l.name === 'Whitby East Cliff');
ok(cliff && cliff.kind === 'cliff', 'Whitby East Cliff present (kind cliff)');
const { x: cx, z: cz } = cliff; const top = cliff.params.top;

// flat top to perch the abbey on: a 5x5 block around the centre within 1 of WL+top
let flat = true;
for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (Math.abs(H(cx + dx, cz + dz) - (WL + top)) > 1) flat = false;
ok(flat, `clifftop is a flat plateau ~${WL + top}`);

// a steep face somewhere around the rim (drops sharply, not a ramp)
let maxStep = 0;
for (const [ux, uz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
  let prev = H(cx, cz);
  for (let r = 1; r <= 16; r++) { const h = H(cx + ux * r, cz + uz * r); maxStep = Math.max(maxStep, Math.abs(h - prev)); prev = h; }
}
ok(maxStep >= 2.4, `cliff face is steep (max step ${maxStep.toFixed(2)} ≥ 2.4 b/block)`);

// the headland drops to the harbour/sea — low ground within reach of the top
let lowNear = false;
for (let dx = -18; dx <= 18 && !lowNear; dx++) for (let dz = -18; dz <= 18; dz++) {
  if (Math.hypot(dx, dz) <= 18 && H(cx + dx, cz + dz) <= WL + 2) { lowNear = true; break; }
}
ok(lowNear, 'clifftop sits above low ground (harbour/sea) within 18 blocks');

// the town flatten must NOT pull the clifftop back down
ok(g.height(cx, cz) >= WL + top - 0.5, 'town flatten leaves the clifftop standing');

// ---- revived peak: Roseberry Topping is no longer flat ----
const ros = g.data.landmarks.find(l => l.name === 'Roseberry Topping');
ok(ros && (ros.kind === 'hill' || ros.kind === 'peak'), 'Roseberry present');
ok(H(ros.x, ros.z) >= g._baseMetresToBlock(ros.x, ros.z) + 4, 'Roseberry sculpted above the smoothed DEM');

console.log(`verify-coast-moors: ${n} assertions OK`);
