// Headless check: the real-Moors data carries the Stage-1a built landmarks (moor crosses
// + Wade's Causeway) at their true OSGB positions, and MoorsGeography renders/names them.
import assert from 'node:assert';
import { MoorsGeography } from '../src/moorsgeo.js';

const g = new MoorsGeography();
const t = g.data.transform;
// Same transform as build-moors-data.py to_block: +x = north, +z = east.
const toBlock = (E, N) => [Math.round((N - t.minN) / t.metresPerBlock), Math.round((E - t.minE) / t.metresPerBlock)];
const find = (name) => g.data.landmarks.find(l => l.name === name);
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const near = (lm, E, N, tol, m) => { const [x, z] = toBlock(E, N); ok(lm && Math.hypot(lm.x - x, lm.z - z) <= tol, m); };

// crosses present, kind 'cross', at their real grid refs (±2 blocks = ±30 m)
near(find('Young Ralph Cross'), 468200, 502000, 2, 'Young Ralph Cross @ NZ 682 020');
near(find('Fat Betty'),         468230, 501580, 2, 'Fat Betty @ NZ 6823 0158');
near(find('Lilla Cross'),       488930, 498740, 2, 'Lilla Cross @ SE 8893 9874');
ok(['Young Ralph Cross', 'Fat Betty', 'Lilla Cross'].every(nm => find(nm)?.kind === 'cross'), 'crosses are kind:cross');

// Wade's Causeway: a 'causeway' polyline; onRoad true on it, false well away
const cau = g.data.landmarks.find(l => l.kind === 'causeway');
ok(cau && Array.isArray(cau.points) && cau.points.length >= 2, "Wade's Causeway polyline present");
ok(g.onRoad(cau.points[0][0], cau.points[0][1]) === true, 'onRoad true on the causeway');
ok(g.onRoad(cau.points[0][0] + 40, cau.points[0][1] + 40) === false, 'onRoad false 40 blocks off');
ok(g.locationName(cau.points[0][0], cau.points[0][1]) === 'Wade’s Causey', 'names the causeway');

// build-script kinds are all handled by a consumer (drift guard)
const handled = new Set(['abbey', 'hill', 'peak', 'hollow', 'tor', 'cross', 'causeway', 'cliff', 'gully']);
ok(g.data.landmarks.every(l => handled.has(l.kind)), 'all landmark kinds are known');

console.log(`verify-landmarks-moors: ${n} assertions OK`);
