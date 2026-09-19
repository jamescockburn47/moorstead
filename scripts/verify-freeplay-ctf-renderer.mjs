import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BattleRenderer } from '../src/freeplay/battle-renderer.js';

const scene = new THREE.Scene(), viewer = new THREE.Vector3(0, 30, 0);
let loaded = true;
const renderer = new BattleRenderer(scene, { isLoaded: () => loaded });
const flags = renderer.flags, mesh = flags.mesh, geometry = flags.geometry, material = flags.material;
const player = (x = 5) => ({ id: 'carrier', team: 'blue', x, y: 30, z: 10, yaw: 0, hp: 100, shield: 20, respawn: 0 });
const flag = (team, x, status = 'home', carrier = null) => ({ team, x, y: 30, z: 10, status, carrier, returnIn: status === 'dropped' ? 20 : 0 });
const snapshot = ctf => ({ soldiers: [], players: [player()], shields: [], camps: { blue: [-100, 30, 0], red: [100, 30, 0] }, ctf });
const active = { phase: 'active', winner: null, bases: { blue: [-20, 30, 10], red: [20, 30, 10] },
  flags: { blue: flag('blue', -20), red: flag('red', 20) } };
const center = (object, i) => { const matrix = new THREE.Matrix4(); object.getMatrixAt(i, matrix); return new THREE.Vector3().setFromMatrixPosition(matrix); };
const original = JSON.stringify(active);
renderer.apply(snapshot(active)); renderer.update(.016, viewer);
assert.equal(JSON.stringify(active), original);
assert.equal(mesh.count, 8); assert.equal(flags.slots.length, 2, 'exactly two pooled objectives');
assert.equal(renderer.campMesh.count, 2, 'custom bases are empty plinths, not duplicated static flags');
assert.deepEqual(center(renderer.campMesh, 0).toArray().map(Math.round), [-20, 30, 10]);
assert.equal(center(mesh, 0).x, -20); assert.ok(Math.abs(center(mesh, 1).y - 34.1) < 1e-5);
const blue = new THREE.Color(), red = new THREE.Color(); mesh.getColorAt(1, blue); mesh.getColorAt(5, red);
assert.ok(blue.b > blue.r && red.r > red.b, 'own and enemy flags retain visibly distinct colours');

const carried = { ...active, flags: { ...active.flags, red: flag('red', 99, 'carried', 'carrier') } };
renderer.apply(snapshot(carried)); renderer.update(.016, viewer);
assert.equal(center(mesh, 4).x, 5, 'carrier position takes precedence over stale flag snapshot coordinates');
assert.ok(center(mesh, 5).y > 32.5, 'carried cloth is clearly above the avatar head');
const moved = snapshot(carried); moved.players = [player(7)];
renderer.apply(moved); renderer.update(.025, viewer);
assert.ok(center(mesh, 4).x > 5 && center(mesh, 4).x < 7, 'flag moves smoothly with the carrier');
assert.equal(center(renderer.campMesh, 1).x, 20, 'empty enemy base stays where it was designated');

const dropped = { ...active, flags: { ...active.flags, red: flag('red', 12, 'dropped') } };
renderer.apply(snapshot(dropped)); renderer.update(.016, viewer);
assert.equal(center(mesh, 4).x, 12); assert.ok(Math.abs(center(mesh, 5).y - 31.35) < 1e-5, 'dropped flag has a visible low pole above terrain');
for (let i = 0; i < 300; i++) renderer.update(.1, viewer);
assert.equal(mesh.count, 8, 'renderer never invents a return-to-base transition when a timer expires');
renderer.apply(snapshot(active)); renderer.update(.016, viewer); assert.equal(center(mesh, 4).x, 20, 'authoritative return restores the home flag');
assert.equal(flags.geometry, geometry); assert.equal(flags.material, material); assert.equal(flags.mesh, mesh);
assert.equal(renderer.root.children.length, 18, 'flag motion never allocates scene objects');

renderer.apply(snapshot({ phase: 'setup', bases: { blue: null, red: null }, flags: {} })); renderer.update(.016, viewer);
assert.equal(mesh.count, 0); assert.equal(renderer.campMesh.count, 0, 'unset bases do not fabricate origin flags or old camp markers');
renderer.apply(snapshot({ ...active, flags: { blue: { ...active.flags.blue, x: NaN }, red: active.flags.red } })); renderer.update(.016, viewer);
assert.equal(mesh.count, 4, 'malformed coordinates are hidden, never converted to zero');
loaded = false; renderer.update(.016, viewer); assert.equal(mesh.count, 0); loaded = true;
renderer.apply(snapshot({ ...active, phase: 'won', winner: 'blue' })); renderer.update(.016, viewer); assert.equal(mesh.count, 8);
renderer.apply(snapshot(undefined)); renderer.update(.016, viewer);
assert.equal(mesh.count, 0); assert.equal(renderer.campMesh.count, 10, 'ordinary combat camps remain compatible when CTF is absent');
renderer.clear(); assert.equal(mesh.count, 0); assert.equal(flags.enabled, false);
let disposedGeometry = 0, disposedMaterial = 0;
geometry.addEventListener('dispose', () => disposedGeometry++); material.addEventListener('dispose', () => disposedMaterial++);
renderer.dispose(); renderer.dispose(); assert.equal(scene.children.length, 0);
assert.equal(disposedGeometry, 1); assert.equal(disposedMaterial, 1);
console.log('Free-play CTF renderer: PASS (two pooled flags, custom empty bases, carrier interpolation, dropped/home states, no invented transitions, bounded ownership).');
