// Headless: the moors data carries the rivers (incl. the added Leven/Seph/Riccal),
// each with a dale name and an in-bounds polyline.
import assert from 'node:assert';
import { MoorsGeography } from '../src/moorsgeo.js';

const g = new MoorsGeography();
const t = g.data.transform;
const W = (t.maxN - t.minN) / t.metresPerBlock, D = (t.maxE - t.minE) / t.metresPerBlock;
const byName = Object.fromEntries(g.data.rivers.map(r => [r.name, r]));
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

for (const nm of ['River Esk', 'River Leven', 'River Seph', 'River Riccal']) ok(byName[nm], `river present: ${nm}`);
ok(g.data.rivers.every(r => typeof r.dale === 'string' && r.dale.length), 'every river has a dale name');
ok(byName['River Esk'].dale === 'Eskdale', 'Esk → Eskdale');
ok(byName['River Seven'].dale === 'Rosedale', 'Seven → Rosedale');
ok(byName['River Dove'].dale === 'Farndale', 'Dove → Farndale');
ok(g.data.rivers.every(r => r.points.every(([x, z]) => x >= -2 && x <= W + 2 && z >= -2 && z <= D + 2)), 'all river points in bounds');

// chained polylines: no big inter-point jump (the easting-sort scrambled multi-segment
// rivers into parallel channels — the Dove had jumps to 344 blocks near Hutton-le-Hole)
for (const r of g.data.rivers) {
  let maxJump = 0;
  for (let i = 1; i < r.points.length; i++) maxJump = Math.max(maxJump, Math.hypot(r.points[i][0] - r.points[i - 1][0], r.points[i][1] - r.points[i - 1][1]));
  ok(maxJump <= 25, `${r.name} chained (max jump ${Math.round(maxJump)} ≤ 25)`);
  ok(typeof r.size === 'string', `${r.name} has a size`);
}

// v2 model: valley-floor anchored, smoothed, monotonic; no perch, shallow source, capped cut
const esk = g._riverProfile().find(p => p.name === 'River Esk');
ok(esk.wl.every((w, i) => i === 0 || w <= esk.wl[i - 1]), 'Esk water descends (monotonic)');
ok(esk.res.every((p, i) => esk.wl[i] <= esk.floor[i] - 1 || esk.wl[i] <= 26), 'water below valley floor (no perch; tidewater reach at sea level exempt)');
const src = esk.res[0]; const rc0 = g.riverColumn(src.x, src.z);
ok(rc0 && (g._baseMetresToBlock(Math.round(src.x), Math.round(src.z)) - rc0.bed) <= 3, 'source carve shallow (no deep channel on tops)');
let maxCut = 0;
for (const p of esk.res) { const rc = g.riverColumn(p.x, p.z); if (rc) maxCut = Math.max(maxCut, g._baseMetresToBlock(Math.round(p.x), Math.round(p.z)) - rc.bed); }
ok(maxCut <= 5, `carve depth capped (max ${maxCut} ≤ 5, no canyon)`);
ok(g.locationName(esk.res[10].x, esk.res[10].z) === 'Eskdale', 'names the dale');
const mouth = esk.res[esk.res.length - 1];
ok(g.coastT(Math.round(mouth.x), Math.round(mouth.z)) > 0 || g.coastT(Math.round(mouth.x) + 3, Math.round(mouth.z)) > 0, 'Esk mouth reaches the sea');

console.log(`verify-rivers-moors: ${n} assertions OK`);
