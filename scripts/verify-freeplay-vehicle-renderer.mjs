import assert from 'node:assert/strict';
import * as THREE from 'three';
import { B, BLOCKS } from '../src/defs.js';
import { tileUV } from '../src/textures.js';
import { registerFutureBlocks } from '../src/freeplay/future-blocks.js';
import { vehiclePoint } from '../src/freeplay/vehicle-motion.js';
import { VehicleRenderer } from '../src/freeplay/vehicle-renderer.js';

registerFutureBlocks();
const scene = new THREE.Scene(), texture = new THREE.Texture(), renderer = new VehicleRenderer(scene, texture);
const pose = { x: 10, y: 30, z: 20, yaw: 0 };
const vehicle = (cells, id = 'car') => ({ id, mode: 'car', cells, core: [0, 0, 0], pose, pilot: null });
assert.equal(renderer.upsert(vehicle([[0, 0, 0, B.GRASS]])), true);
let item = renderer.vehicles.get('car'), geometry = item.mesh.geometry;
assert.equal(geometry.index.count, 36, 'single block has six outward faces');
assert.equal(geometry.attributes.position.count, 24);
assert.deepEqual(geometry.boundingBox.min.toArray(), [-.5, 0, -.5]);
assert.deepEqual(geometry.boundingBox.max.toArray(), [.5, 1, .5]);
assert.equal(renderer.materials[0].map, texture, 'vehicles borrow the existing atlas');
assert.equal(item.group.children.length, 1, 'one merged mesh per vehicle');
for (const [normalY, tile] of [[1, BLOCKS[B.GRASS].tex.t], [-1, BLOCKS[B.GRASS].tex.b]]) {
  const bounds = tileUV(tile), values = [];
  for (let i = 0; i < geometry.attributes.normal.count; i++) if (geometry.attributes.normal.getY(i) === normalY)
    values.push([geometry.attributes.uv.getX(i), geometry.attributes.uv.getY(i)]);
  assert.equal(values.length, 4);
  for (const [u, v] of values) assert.ok(u >= bounds[0] - 1e-7 && u <= bounds[2] + 1e-7 && v >= bounds[1] - 1e-7 && v <= bounds[3] + 1e-7);
}
let released = 0; geometry.addEventListener('dispose', () => released++);
renderer.upsert(vehicle([[0, 0, 0, B.GRASS]])); assert.equal(item.mesh.geometry, geometry); assert.equal(released, 0);
renderer.upsert(vehicle([[0, 0, 0, B.GRASS], [1, 0, 0, B.PLANKS]]));
assert.equal(released, 1); assert.equal(item.mesh.geometry.index.count, 60, 'shared internal faces are removed');
renderer.upsert(vehicle([[0, 0, 0, B.WINDOW], [2, 0, 0, 203], [0, 1, 0, B.TORCH]]));
assert.equal(item.mesh.geometry.groups.length, 2, 'cutout and solid atlas surfaces use two merged passes');
assert.equal(renderer.materials[0].transparent, false, 'existing decorative window blocks keep their real textured-solid semantics');
assert.equal(renderer.materials[1].alphaTest, .45);

for (const yaw of [0, Math.PI / 2, Math.PI, -.4]) {
  const moved = { x: -17, y: 45, z: 9, yaw }; renderer.setPose('car', moved);
  const actual = item.group.localToWorld(new THREE.Vector3(2, 1.5, 3)), expected = vehiclePoint(moved, [2, 1, 3]);
  assert.ok(actual.distanceTo(new THREE.Vector3(expected.x, expected.y, expected.z)) < 1e-10, 'geometry matches physics voxel centre and yaw convention');
}
renderer.setPose('car', pose);
const down = new THREE.Vector3(0, -1, 0), ray = new THREE.Ray(new THREE.Vector3(10.5, 35, 20.5), down);
assert.equal(renderer.pick(ray), 'car');
assert.equal(renderer.pick(new THREE.Ray(new THREE.Vector3(11.5, 35, 20.5), down)), null, 'ray through actual hole cannot select the bounding box');
assert.equal(renderer.pick(new THREE.Ray(new THREE.Vector3(12.5, 35, 20.5), down)), 'car', 'new future block is ray-pickable');
assert.equal(renderer.pick(ray, 2), null, 'maximum reach enforced');
assert.equal(renderer.pick(new THREE.Ray(new THREE.Vector3(NaN, 35, 20), down)), null);
renderer.update(new Map([['car', { pose: { ...pose, x: 40 } }]])); assert.equal(renderer.pick(ray), null);
renderer.update({ car: { pose } }); assert.equal(renderer.pick(ray), 'car');

const selection = [[10, 30, 20, B.PLANKS], [12, 30, 20, B.PLANKS]];
assert.equal(renderer.setSelection(selection), true);
assert.equal(renderer.selection.geometry.attributes.position.count, 48, 'outlines exact separated cells');
const selectedGeometry = renderer.selection.geometry;
renderer.setSelection(selection); assert.equal(renderer.selection.geometry, selectedGeometry, 'stable selection avoids allocation per frame');
for (let i = 0; i < selectedGeometry.attributes.position.count; i++)
  assert.ok([10, 11, 12, 13].includes(selectedGeometry.attributes.position.getX(i)), 'does not fill the unselected gap');
renderer.setSelection(null); assert.equal(renderer.selection.visible, false);
renderer.setSelection(selection); assert.equal(renderer.selection.visible, true);

const full = [];
for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) for (let z = 0; z < 8; z++) full.push([x, y, z, B.PLANKS]);
renderer.upsert(vehicle(full)); assert.equal(item.mesh.geometry.index.count, 6 * 8 * 8 * 6, '512 blocks mesh only their exposed hull');
for (let i = 1; i < 16; i++) assert.equal(renderer.upsert(vehicle(full, `body-${i}`)), true);
assert.equal(renderer.upsert(vehicle(full, 'overflow')), false, 'renderer capacity is fixed at sixteen bodies');
assert.equal(renderer.vehicles.size, 16); assert.ok([...renderer.vehicles.values()].every(row => row.group.children.length === 1));
for (const invalid of [[[0, 0, 0, 255]], [[0, 0, 0, B.PLANKS], [0, 0, 0, B.PLANKS]], [...full, [10, 0, 0, B.PLANKS]], [[16, 0, 0, B.PLANKS]]])
  assert.equal(renderer.upsert(vehicle(invalid)), false, 'reject malformed or oversized replacement without destroying the current body');
assert.equal(renderer.setPose('car', { ...pose, yaw: NaN }), false);
let textureDisposed = 0, materialsDisposed = 0, lastGeometryDisposed = 0;
texture.addEventListener('dispose', () => textureDisposed++);
renderer.materials.forEach(material => material.addEventListener('dispose', () => materialsDisposed++));
item.mesh.geometry.addEventListener('dispose', () => lastGeometryDisposed++);
assert.equal(renderer.remove('car'), true); assert.equal(renderer.remove('car'), false); assert.equal(lastGeometryDisposed, 1);
renderer.clear(); assert.equal(renderer.vehicles.size, 0);
renderer.dispose(); renderer.dispose(); assert.equal(scene.children.length, 0); assert.equal(materialsDisposed, 2);
assert.equal(textureDisposed, 0, 'disposing vehicles must never dispose the terrain atlas'); texture.dispose();
console.log('Free-play vehicle renderer: PASS (16 merged512-block bodies, face culling, exact atlas UVs, pose/raycast alignment, precise selection, bounded ownership).');
