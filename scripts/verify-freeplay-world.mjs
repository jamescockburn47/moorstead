import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Scene } from 'three';
import { B, CHUNK, HEIGHT } from '../src/defs.js';
import { World } from '../src/world.js';
import { FreeplayWorld } from '../src/freeplay/world.js';
import { OverrideStore } from '../src/freeplay/terrain-overrides.js';
import { columnRemoved, roadGround, trackSupported } from '../src/freeplay/scenery-support.js';
import { Rails } from '../src/rails.js';
import { RoadLayer } from '../src/roads.js';
import { FreeplayTrains, safeTrainBerth, scheduleAt } from '../src/freeplay/scenery-trains.js';
import { peerVisibleFrom } from '../src/freeplay/peers.js';

const scene = new Scene(), seed = 419947177;
assert.equal(peerVisibleFrom({ x: 1674, y: 40, z: 1780 }, { x: 1674, y: 40, z: 1780 }), false, 'shared spawn cannot render a peer torso around the camera');
assert.equal(peerVisibleFrom({ x: 1675, y: 40, z: 1780 }, { x: 1674, y: 40, z: 1780 }), true, 'nearby non-overlapping player remains visible');
assert.equal(peerVisibleFrom({ x: 1674, y: 45, z: 1780 }, { x: 1674, y: 40, z: 1780 }), true, 'player flying overhead remains visible');
const world = new FreeplayWorld(scene, seed);
const inn = world.gen.inns.get('Danby');
const [x, y, z] = [inn.origin.x, inn.groundY, inn.origin.z];
const t0 = performance.now();
for (let cx = Math.floor((x - 42) / CHUNK); cx <= Math.floor((x + 42) / CHUNK); cx++) {
  for (let cz = Math.floor((z - 42) / CHUNK); cz <= Math.floor((z + 42) / CHUNK); cz++) world.ensureChunk(cx, cz);
}
const originalChunks = new Map([...world.chunks].map(([key, c]) => [key, new Uint8Array(c.data)]));
const originalCentre = world.surfaceY(x, z);
assert.ok(originalCentre > y, 'real authored inn roof stands above ground');
assert.equal(new World(new Scene(), seed).isProtected(x, z), true, 'ordinary inn protection remains');
assert.equal(world.isProtected(x, z), false);

world.setBlock(x, 58, z, B.PLANKS);
world.setBlock(x + 16, 59, z, B.STONEBRICK);
let remeshCalls = 0;
world.remesh = () => { remeshCalls++; };
const rows = [];
// An independently constructed maximum-blast fixture exercises world integration.
// The authoritative bomb evaluator has its own backend tests.
for (let dx = -40; dx <= 40; dx++) for (let dz = -40; dz <= 40; dz++) {
  const d2 = dx * dx + dz * dz;
  if (d2 > 1600) continue;
  const floor = Math.max(1, Math.ceil(y - 18 * Math.sqrt(1 - d2 / 1600)));
  for (let yy = floor; yy < HEIGHT; yy++) rows.push([x + dx, yy, z + dz, B.AIR]);
}
const undo = rows.map(([a, b, c]) => [a, b, c, world.overrides.getCell(a, b, c) ?? null]);
const beforeBlast = performance.now();
world.applyEdits(rows);
assert.equal(remeshCalls, 0, 'large edit transaction never invokes synchronous chunk rebuilding');
assert.ok(world.remeshQueue.size > 9, 'maximum crater crosses many independently remeshed chunks');
assert.ok(world.surfaceY(x, z) <= y - 17, 'collision surface is a real deep crater, not an effect');
assert.equal(world.getBlock(x, 58, z), B.AIR, 'built structure is destroyed');
assert.equal(world.getBlock(x + 16, 59, z), B.AIR, 'structure across chunk boundary is destroyed');
assert.equal(world.getBlock(x, 0, z), B.BEDROCK, 'immutable world floor survives');
assert.ok(columnRemoved(world, x, z, y));
assert.equal(roadGround(world, x, z), null, 'road does not relocate onto crater floor');
assert.equal(trackSupported(world, x, z, y), false, 'railway cannot float across crater');
assert.equal(trackSupported(world, x + 60, z, y), true, 'unaffected track remains');
const damaged = new Map([...world.chunks].map(([key, c]) => [key, new Uint8Array(c.data)]));
const reconnect = new FreeplayWorld(new Scene(), seed, new OverrideStore(world.overrides));
for (const [key, data] of damaged) {
  const c = reconnect.ensureChunk(...key.split(',').map(Number));
  assert.deepEqual(c.data, data, `reconnecting client has identical chunk ${key}`);
}
world.update(x + 1000, z + 1000, { maxGenerate: 0, maxMesh: 0 });
assert.equal(world.chunks.size, 0);
world.ensureChunk(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
assert.equal(world.getBlock(x, 58, z), B.AIR, 'unloading cannot resurrect inn/builds');
assert.ok(world.surfaceY(x, z) <= y - 17);

world.applyEdits(undo);
assert.equal(world.getBlock(x, 58, z), B.PLANKS, 'undo restores preceding player build, not just seed');
world.ensureChunk(Math.floor((x + 16) / CHUNK), Math.floor(z / CHUNK));
assert.equal(world.getBlock(x + 16, 59, z), B.STONEBRICK);
assert.equal(world.overrides.size, 2, 'null rollback removes every previous-absent override');
world.applyEdits([[x, 58, z, null], [x + 16, 59, z, null]]);
assert.equal(world.surfaceY(x, z), originalCentre, 'inn restores from exact generated baseline');
assert.equal(columnRemoved(world, x, z, y), false, 'undo restores scenery supports');
for (const [key, data] of originalChunks) assert.deepEqual(world.ensureChunk(...key.split(',').map(Number)).data, data);

world.enqueueEdits([[x, y, z, B.AIR]]);
world.replaceOverrides(new OverrideStore());
world.processEdits();
assert.equal(world.overrides.size, 0, 'reset cancels queued pre-reset edits');
assert.equal(world.ensureChunk(Math.floor(x / CHUNK), Math.floor(z / CHUNK)).data.length, CHUNK * CHUNK * HEIGHT);
assert.equal(world.surfaceY(x, z), originalCentre);
assert.throws(() => world.applyEdits([[x, 0, z, B.AIR]]), /Invalid/, 'bedrock edits rejected');
assert.throws(() => world.applyEdits([[x, 25, z, 250]]), /Invalid/, 'unknown voxel id rejected');

const staged = new OverrideStore();
staged.set('-1,22,-17', 0); staged.set('0,22,0', null);
assert.equal(staged.get('-1,22,-17'), 0);
assert.equal(staged.get('0,22,0'), null);
assert.deepEqual([...staged.cells()].sort((a, b) => a[0] - b[0]), [[-1, 22, -17, 0], [0, 22, 0, null]]);
assert.equal(staged.size, 2); staged.delete('-1,22,-17'); assert.equal(staged.size, 1);
assert.equal(staged.chunks.size, 1, 'empty compact chunks are freed');

const path = world.gen.geo.railPaths()[0].path;
assert.equal(safeTrainBerth(world, path).blocked, false, 'pristine route runs normally');
assert.deepEqual(scheduleAt(path, 1000), scheduleAt(path, 1000), 'train follows deterministic shared-clock timetable');
const bridge = path.pts.find(p => world.gen.geo.nearRiver(Math.round(p.x), Math.round(p.z), 3));
assert.ok(bridge, 'actual Moors railway contains a bridge crossing');
const bridgeCell = [Math.round(bridge.x), Math.floor(bridge.deck), Math.round(bridge.z)];
world.applyEdits([[...bridgeCell, B.AIR]]);
assert.equal(trackSupported(world, bridge.x, bridge.z, bridge.deck, 'piers'), false, 'actual damaged bridge suppresses masonry piers');
assert.equal(safeTrainBerth(world, path).blocked, true, 'actual removed bridge suspends full train route');
world.applyEdits([[...bridgeCell, null]]);
assert.equal(safeTrainBerth(world, path).blocked, false, 'undo restores train timetable on the repaired route');
const trainStart = world.gen.geo.samplePosOn(path, 33);
world.ensureChunk(Math.floor(trainStart.x / CHUNK), Math.floor(trainStart.z / CHUNK));
const trains = new FreeplayTrains({ world, scene, player: { pos: trainStart } }, () => 0);
trains.update(.016);
assert.ok(trains.routes.some(route => route.train?.parts.some(part => part.group.visible)), 'real procedural train is rendered at a loaded nearby stop');
trains.dispose();
const pristineRails = new Rails(scene, world.gen.geo);
pristineRails.build(path, path.length / 2);
assert.ok(pristineRails.meshes.some(m => m.userData.kind === 'rails' && m.count > 0));
pristineRails.dispose();
const brokenRails = new Rails(scene, world.gen.geo, { supported: () => false });
brokenRails.build(path, path.length / 2);
assert.ok(brokenRails.meshes.every(m => m.isInstancedMesh ? m.count === 0 : m.geometry.attributes.position.count === 0), 'all rail scenery categories obey missing supports');
brokenRails.dispose();
const roads = new RoadLayer(scene, world, world.gen.geo, { groundAt: () => null });
const road = world.gen.geo.roadPaths()[0];
roads.build(road, road.path.length / 2);
assert.equal(roads.meshes.length, 0, 'destroyed road columns produce no floating slabs');
roads.dispose();

for (const file of ['world.js', 'terrain-overrides.js', 'scenery.js', 'scenery-support.js', 'scenery-trains.js']) {
  assert.ok(readFileSync(new URL(`../src/freeplay/${file}`, import.meta.url), 'utf8').split('\n').length <= 300, `${file} stays within source cap`);
}
world.dispose(); reconnect.dispose();
assert.equal(scene.children.length, 0, 'scene resources detached on teardown');
console.log(`PASS free-play terrain: ${rows.length} crater cells; ${damaged.size} real inn/village chunks; ${(performance.now() - beforeBlast).toFixed(0)}ms blast/undo/reconnect/scenery checks, ${(performance.now() - t0).toFixed(0)}ms total.`);
