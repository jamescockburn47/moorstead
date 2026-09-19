import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BUILD_SHAPES, BRUSH_SIZES, MAX_BUILD_CELLS, buildDimensions, buildShape } from '../src/freeplay/build-shapes.js';

const command = (shape, extra = {}) => ({ shape, origin: [0, 1, 0], rotation: 0, block: 8,
  ...(['line', 'wall', 'floor', 'box'].includes(shape) ? { size: 3 } : {}), ...extra });
const cellMap = rows => new Map(rows.map(([x, y, z, id]) => [`${x},${y},${z}`, id]));
const local = (rows, x, y, z) => cellMap(rows).get(`${x},${y + 1},${z}`);
const fixtures = [];
for (const shape of BUILD_SHAPES) for (const size of shape.prefab ? [undefined] : BRUSH_SIZES) {
  for (let rotation = 0; rotation < 4; rotation++) {
    const input = command(shape.id, { rotation, ...(size === undefined ? {} : { size }) });
    const rows = buildShape(input), dimensions = buildDimensions(shape.id, size);
    assert.equal(rows.length, dimensions.reduce((a, b) => a * b));
    assert(rows.length <= MAX_BUILD_CELLS); assert.equal(cellMap(rows).size, rows.length);
    assert.deepEqual(rows, buildShape(input), 'shape generation is deterministic');
    assert(rows.every(row => row.every(Number.isInteger) && row[1] >= 1 && row[1] <= 63));
    fixtures.push(input);
  }
}
assert.deepEqual(buildShape(command('line', { origin: [10, 3, 20], rotation: 1 })),
  [[10, 3, 20, 8], [10, 3, 21, 8], [10, 3, 22, 8]]);
assert.deepEqual(buildShape(command('line', { origin: [10, 3, 20], rotation: 3 })),
  [[10, 3, 20, 8], [10, 3, 19, 8], [10, 3, 18, 8]]);
const hollow = buildShape(command('box', { size: 7 }));
assert.equal(hollow.filter(row => row[3] === 0).length, 125, 'hollow brush clears the interior');
assert.equal(hollow.filter(row => row[3] === 8).length, 218);
for (const id of [1, 62, 200, 201, 202, 203, 204, 205, 206]) {
  assert(buildShape(command('line', { block: id })).every(row => row[3] === id));
}
const base = buildShape(command('base'));
assert.equal(base.length, 125); assert.equal(local(base, 2, 1, 0), 0); assert.equal(local(base, 2, 2, 0), 0);
assert.equal(local(base, 2, 2, 2), 0, 'base has a usable empty room');
assert.equal(local(base, 0, 2, 2), 203, 'base has energy windows');
assert.equal(local(base, 2, 4, 2), 202, 'base has a magenta roof beacon');
const tower = buildShape(command('tower')), stairs = [[2, 1], [3, 1], [3, 2], [3, 3], [2, 3], [1, 3], [1, 2], [1, 1]];
assert.equal(tower.length, 225);
for (const [i, [x, z]] of stairs.entries()) {
  assert.equal(local(tower, x, i + 1, z), 205, 'each step exists');
  for (const dy of [2, 3]) assert.equal(local(tower, x, i + dy, z) ?? 0, 0, 'stairs have two-block headroom');
  if (i) assert.equal(Math.abs(x - stairs[i - 1][0]) + Math.abs(z - stairs[i - 1][1]), 1, 'stairs form a walkable ascending path');
}
const bridge = buildShape(command('bridge'));
assert.equal(bridge.length, 117);
for (let z = 0; z < 13; z++) {
  assert(local(bridge, 1, 0, z) > 0); assert.equal(local(bridge, 1, 1, z), 0); assert.equal(local(bridge, 1, 2, z), 0);
  assert(local(bridge, 0, 1, z) > 0); assert(local(bridge, 2, 1, z) > 0);
}
for (const shape of ['base', 'tower', 'bridge']) {
  assert.throws(() => buildShape(command(shape, { size: 5 })), /fields/);
}
for (const value of [null, [], {}, command('unknown'), command('line', { size: 9 }), command('line', { rotation: 4 }),
  command('line', { block: 0 }), command('line', { block: 199 }), command('line', { block: 207 }),
  command('line', { block: true }), command('line', { origin: [0, 0, 0] }), command('line', { origin: [NaN, 1, 0] }),
  command('line', { origin: [8191, 1, 0] }), command('wall', { origin: [0, 62, 0] }),
  command('bridge', { origin: [-8191, 1, 0], rotation: 1 }), command('base', { unexpected: true })]) {
  assert.throws(() => buildShape(value), 'invalid requests are rejected without partial clipping');
}
assert.equal(buildShape(command('line', { origin: [8190, 63, 8192] })).length, 3, 'an exactly fitting boundary is valid');
for (const file of ['../src/freeplay/build-shapes.js', './verify-freeplay-build.mjs']) {
  assert(readFileSync(new URL(file, import.meta.url), 'utf8').split('\n').length <= 300);
}

// Preview and server must agree on every voxel, including AIR and row ordering.
const backend = fileURLToPath(new URL('../deploy/free-play/worldsvc/freeplay_builds.py', import.meta.url));
assert(existsSync(backend), 'authoritative building implementation is required');
const result = spawnSync('python', ['-c', 'import json,sys;sys.path.insert(0,sys.argv[1]);from freeplay_builds import build_cells;print(json.dumps([list(build_cells(v)) for v in json.load(sys.stdin)]))',
  fileURLToPath(new URL('../deploy/free-play/worldsvc', import.meta.url))], { input: JSON.stringify(fixtures), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
assert.equal(result.status, 0, result.stderr || 'Python shape parity failed');
assert.deepEqual(JSON.parse(result.stdout), fixtures.map(buildShape), 'every shape, size and rotation exactly matches server rows');
const { placementProblem, buildCommand } = await import('../src/freeplay/build-preview.js');
const previewFields=buildCommand({type:'build',shape:'wall',rotation:2,block:201,size:5},{x:10,y:20,z:30,face:[0,1,0]});
assert.deepEqual(previewFields,{shape:'wall',origin:[10,21,30],rotation:2,block:201,size:5});
const previewRows=buildShape(previewFields);
assert.match(placementProblem(previewRows,{isLoaded:()=>false},{x:0,y:0,z:0}),/load/);
assert.match(placementProblem(previewRows,{isLoaded:()=>true},{x:10.5,y:21,z:30.5}),/Step back/);
assert.equal(placementProblem(previewRows,{isLoaded:()=>true},{x:0,y:50,z:0}),null);
console.log('PASS freeplay build: bounded rotated brushes, usable futuristic prefabs, stairs/doors, strict bounds, safe previews and exact server parity');
