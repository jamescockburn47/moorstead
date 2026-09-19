import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BattleRenderer } from '../src/freeplay/battle-renderer.js';
import { BattleLabels } from '../src/freeplay/battle-models.js';

const actor = (id, team = 'blue', x = 0, z = 10) => ({ id, team, x, y: 30, z, yaw: 0, hp: 50, shield: 0, respawn: 0 });
let loaded = true;
const scene = new THREE.Scene(), world = { isLoaded: () => loaded, setBlock: () => assert.fail('rendering cannot modify terrain') };
const renderer = new BattleRenderer(scene, world), viewer = new THREE.Vector3(0, 30, 0), matrix = new THREE.Matrix4();
const soldiers = Array.from({ length: 48 }, (_, i) => actor(`npc-${i}`, i < 24 ? 'blue' : 'red', i % 12 * 2, 10 + Math.floor(i / 12) * 2));
const players = [{ ...actor('henry', 'blue', -4, 6), hp: 100, shield: 100, name: 'Henry' }, { ...actor('james', 'red', 4, 6), hp: 100, name: 'James' }];
const state = { soldiers, players, shields: [{ id: 'dome', team: 'blue', x: 0, y: 30, z: 10, radius: 6, remaining: 12 }],
  camps: { blue: [-20, 30, 0], red: [20, 30, 0], bogus: [0, 30, 0] } };
const inputCopy = JSON.stringify(state);
assert.equal(renderer.apply(state), true); renderer.update(.016, viewer);
assert.equal(JSON.stringify(state), inputCopy, 'render state remains an immutable authoritative input');
assert.deepEqual([renderer.stats().soldiers, renderer.stats().players], [48, 2]);
assert.equal(renderer.stats().batches, 18, 'draw object count stays fixed independent of army size');
assert.equal(renderer.campMesh.count, 10, 'two teams receive five-metre flags in one fixed batch');
renderer.campMesh.getMatrixAt(1, matrix); assert.equal(matrix.elements[12], -20); assert.equal(matrix.elements[13], 32.5);
const campBlue = new THREE.Color(), campRed = new THREE.Color();
renderer.campMesh.getColorAt(2, campBlue); renderer.campMesh.getColorAt(7, campRed);
assert.ok(campBlue.b > campBlue.r && campRed.r > campRed.b, 'camp flags clearly distinguish the two teams');
for (const team of renderer.models.teams.values()) {
  assert.equal(team.batches.length, 5); assert.ok(team.batches.every(mesh => mesh.count === 24));
  team.geometries[0].computeBoundingBox();
  assert.ok(team.geometries[0].boundingBox.max.z > .7, 'toy blaster barrel is visible ahead of the soldier');
  assert.ok(team.geometries[0].boundingBox.max.y > 1.7, 'helmet is visibly part of the merged body');
  assert.ok(new Set(team.geometries[0].attributes.color.array).size > 3, 'skin and equipment retain distinct colours');
}
assert.equal(renderer.labels.count, 50); assert.ok(renderer.labels.labels.includes('blue:Henry'));
assert.ok(renderer.labels.labels.includes('red:James')); assert.equal(renderer.health.count, 200);
assert.equal(renderer.domes.count, 1); renderer.domes.getMatrixAt(0, matrix);
assert.equal(new THREE.Vector3().setFromMatrixScale(matrix).x, 6);
assert.equal(renderer.pick(new THREE.Ray(new THREE.Vector3(0, 31, 0), new THREE.Vector3(0, 0, 1))), 'npc-0');
assert.equal(renderer.pick(new THREE.Ray(new THREE.Vector3(0, 31, 0), new THREE.Vector3(0, 0, 1)), 5), null);
assert.equal(renderer.pick(new THREE.Ray(new THREE.Vector3(NaN, 31, 0), new THREE.Vector3(0, 0, 1))), null);
assert.equal(renderer.pick(new THREE.Ray(new THREE.Vector3(0, 31, 0), new THREE.Vector3())), null);
loaded = false; renderer.update(.016, viewer);
assert.equal(renderer.health.count, 0); assert.equal(renderer.models.teams.get('blue').batches[0].count, 0);
assert.equal(renderer.campMesh.count, 0, 'camp markers only render above loaded terrain');
assert.equal(renderer.pick(new THREE.Ray(new THREE.Vector3(0, 31, 0), new THREE.Vector3(0, 0, 1))), null, 'unloaded soldiers cannot be selected');
loaded = true;

renderer.apply({ soldiers: [actor('one')], players: [] }); renderer.update(.016, viewer);
renderer.apply({ soldiers: [actor('one', 'blue', 2)], players: [] }); renderer.update(.025, viewer);
assert.ok(renderer.actors.get('n:one').current.x > 0 && renderer.actors.get('n:one').current.x < 2, '5Hz snapshots interpolate');
renderer.apply({ soldiers: [{ ...actor('one', 'blue', 2), hp: 0, respawn: 8 }], players: [] }); renderer.update(.016, viewer);
assert.equal(renderer.stats().knocked, 1); assert.ok(renderer.labels.labels[0].includes('Recovering 8s'));
renderer.models.teams.get('blue').batches[0].getMatrixAt(0, matrix);
assert.ok(Math.abs(matrix.elements[0]) < 1e-6 && matrix.elements[1] > .99, 'knockout renders a resting sideways toy');
assert.equal(renderer.pick(new THREE.Ray(new THREE.Vector3(2, 31, 0), new THREE.Vector3(0, 0, 1))), null);
renderer.apply({ soldiers: [actor('one', 'blue', -40)], players: [] });
assert.equal(renderer.actors.get('n:one').current.x, -40, 'camp respawn snaps, never interpolates across the battlefield');
assert.equal(renderer.actors.get('n:one').hp, 50);
renderer.event({ type: 'hit', targetId: 'one', x: -40, y: 31, z: 10, shield: true });
assert.equal(renderer.actors.get('n:one').hp, 50, 'visual hit cannot locally alter authoritative health');

const oversized = Array.from({ length: 90 }, (_, i) => actor(`limit-${i}`, i < 45 ? 'blue' : 'red'));
const domes = Array.from({ length: 12 }, (_, i) => ({ id: `d${i}`, team: 'blue', x: i, y: 30, z: 10, radius: 6, remaining: .05 }));
renderer.apply({ soldiers: oversized, players: Array.from({ length: 20 }, (_, i) => actor(`p${i}`)), shields: domes });
renderer.update(.016, viewer); assert.equal(renderer.stats().soldiers, 48); assert.equal(renderer.stats().players, 8);
assert.equal(renderer.domes.count, 8); assert.equal(renderer.health.count, 224);
renderer.update(.05, viewer); assert.equal(renderer.domes.count, 0, 'expired shields do not linger without a new snapshot');
renderer.apply({ soldiers: [actor('good'), actor('good'), { ...actor('bad'), x: NaN }, { ...actor('bad-team'), team: 'green' }], players: [] });
assert.equal(renderer.stats().soldiers, 1); assert.equal(renderer.apply({}), false);
assert.equal(renderer.stats().soldiers, 1, 'invalid envelope cannot replace the last valid state');

for (let i = 0; i < 400; i++) {
  assert.equal(renderer.event({ type: 'battle-event', event: { type: 'shot', team: 'red', from: [0, 31, 0], to: [i % 30, 31, 10], weapon: 'machinegun' } }), true);
  assert.equal(renderer.event({ type: 'hit', x: i % 30, y: 31, z: 10, shield: i % 2 === 0 }), true);
}
assert.deepEqual(renderer.effects.stats(), { tracers: 48, hits: 32, capacities: [48, 32] });
assert.equal(renderer.event({ type: 'shot', team: 'blue', from: [0, NaN, 0], to: [0, 0, 0] }), false);
assert.equal(renderer.event({ type: 'hit', x: 1, y: Infinity, z: 3 }), false);
renderer.settings = { reducedMotion: true, reducedFlash: true }; renderer.update(.016, viewer);
assert.equal(renderer.effects.geometry.drawRange.count, 96); assert.equal(renderer.effects.mesh.count, 32);
assert.equal(renderer.effects.material.opacity, .4); assert.equal(renderer.effects.hitMaterial.opacity, .22);
renderer.effects.update(.5); assert.equal(renderer.effects.geometry.drawRange.count, 0); assert.equal(renderer.effects.mesh.count, 0);
assert.equal(renderer.root.children.length, 18, 'bursts do not allocate extra meshes');

let sharedDisposed = 0, ownDisposed = 0;
renderer.models.rig.group.traverse(node => { node.geometry?.addEventListener('dispose', () => sharedDisposed++); });
renderer.models.teams.get('blue').geometries[0].addEventListener('dispose', () => ownDisposed++);
renderer.clear(); assert.equal(renderer.actors.size, 0); assert.equal(renderer.health.count, 0); assert.equal(renderer.labels.geometry.drawRange.count, 0);
assert.equal(renderer.root.children.length, 18, 'clear reuses pools');
renderer.dispose(); renderer.dispose(); assert.equal(scene.children.length, 0); assert.equal(ownDisposed, 1);
assert.equal(sharedDisposed, 0, 'battlefield disposal must preserve shared Moorstead villager assets');

const previousDocument = globalThis.document, painted = [];
try {
  globalThis.document = { createElement: () => ({ getContext: () => ({ clearRect() {}, fillRect() {}, fillText: text => painted.push(text) }) }) };
  const labels = new BattleLabels(scene); labels.begin(); labels.put('Henry', 'blue', 0, 2, 0, 0); labels.end();
  const version = labels.texture.version; assert.deepEqual(painted, ['Henry']);
  labels.begin(); labels.put('Henry', 'blue', 1, 2, 0, 0); labels.end();
  assert.equal(labels.texture.version, version, 'movement never repaints/uploads the name atlas');
  labels.begin(); labels.put('James', 'red', 1, 2, 0, 0); labels.end();
  assert.equal(labels.texture.version, version + 1); assert.deepEqual(painted, ['Henry', 'James']);
  assert.equal(labels.geometry.drawRange.count, 6); labels.dispose(); assert.equal(scene.children.length, 0);
} finally {
  if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
}
console.log('Free-play battle renderer: PASS (48 pooled soldiers, player markers, 8 shields, bounded tracers/hits, recovery/interpolation, one name atlas, resource ownership).');
