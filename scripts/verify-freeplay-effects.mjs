// Execute scene state and recovery directly: a visible cloud cannot prove damage.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { B } from '../src/defs.js';
import { ExplosionEffects } from '../src/freeplay/effects.js';
import { ExplosionAudio } from '../src/freeplay/explosion-audio.js';
import { FreeplayPopulation } from '../src/freeplay/population.js';
import { safeSurface } from '../src/freeplay/population-ground.js';

const event = { id: 'atom-1', kind: 'atom', x: 0, y: 31, z: 0, radius: 40 };
{
  let released = 0;
  const audio = new ExplosionAudio();
  audio.voices.push({ sources: [{ stop() { released++; }, disconnect() {} }], nodes: [], stopped: false });
  audio.setMuted(true);
  assert.equal(audio.muted, true); assert.equal(released, 1); assert.equal(audio.voices.length, 0);
  audio.setMuted(true); assert.equal(released, 1, 'repeated mute is idempotent');
  audio.ctx = { state: 'running', createBuffer() { throw new Error('Muted audio tried to create a voice'); } };
  assert.equal(audio.play(event), false, 'owned mute blocks synthesis without an AudioEngine');
  audio.setMuted(false); assert.equal(audio.muted, false);
  audio.audio = { ctx: audio.ctx, muted: true };
  assert.equal(audio.play(event), false, 'external engine mute remains respected');
  audio.dispose();
  const fx = new ExplosionEffects(new THREE.Scene(), { muted: true });
  assert.equal(fx.audio.muted, true, 'constructor routes the mute preference to audio');
  fx.audio.setMuted(false); assert.equal(fx.audio.muted, false);
  assert.equal(typeof fx.stats, 'function'); fx.dispose();
}
for (const plain of [true, false]) {
  const scene = new THREE.Scene(), fx = new ExplosionEffects(scene, { plain });
  assert.equal(fx.detonate(event), true);
  assert.equal(fx.detonate(event), false, 'duplicate id must not replay sound and spectacle');
  for (let i = 0; i < 40; i++) fx.update(.1, new THREE.Vector3(60, 40, 60));
  const slot = fx.slots[0], matrix = new THREE.Matrix4(), point = new THREE.Vector3();
  let top = 0, width = 0;
  for (let i = 0; i < slot.smoke.count; i++) {
    slot.smoke.getMatrixAt(i, matrix); point.setFromMatrixPosition(matrix);
    top = Math.max(top, point.y); width = Math.max(width, Math.hypot(point.x, point.z));
  }
  assert.ok(top > 40 && width > 22, 'atom cloud must tower over village with spreading mushroom crown');
  assert.ok(slot.smoke.visible && slot.smoke.material.opacity > .5, 'Plain retains actual visible cloud');
  for (let i = 0; i < 200; i++) fx.detonate({ ...event, id: `burst-${i}` });
  assert.equal(fx.stats().active, 3); assert.equal(fx.stats().seen, 128);
  assert.ok(fx.stats().particles <= 426, 'repeated blasts keep fixed mesh/particle capacity');
  for (let i = 0; i < 130; i++) fx.update(.1);
  assert.equal(fx.stats().active, 0); assert.ok(fx.slots.every(item => !item.group.visible));
  let disposed = 0; fx.sphere.addEventListener('dispose', () => disposed++);
  fx.dispose(); fx.dispose();
  assert.equal(disposed, 1); assert.equal(scene.children.length, 0);
}
{
  const fx = new ExplosionEffects(new THREE.Scene(), { reducedFlash: true, reducedMotion: true });
  assert.equal(fx.detonate({ ...event, radius: 1000 }), false);
  assert.equal(fx.detonate({ ...event, x: NaN }), false);
  fx.detonate(event); fx.update(.1);
  assert.equal(fx.slots[0].light.intensity, 0); assert.equal(fx.slots[0].debris.visible, false);
  assert.ok(fx.slots[0].fire.material.opacity < .4);
  fx.dispose();
}

const terrain = { depth: 30, loaded: true, water: false,
  gen: { geo: { villages: [{ name: 'Moorstead', x: 0, z: 0 }] } },
  isLoaded() { return this.loaded; },
  getBlock(x, y, z) { return y <= this.depth ? B.STONE : this.water && y <= 26 ? B.WATER : B.AIR; },
};
assert.equal(safeSurface(terrain, 0, 0), 31);
terrain.depth = 1; assert.equal(safeSurface(terrain, 0, 0), 2, 'deep crater is scanned to bottom');
terrain.water = true; assert.equal(safeSurface(terrain, 0, 0), null, 'water is not a safe landing');
terrain.water = false; terrain.loaded = false;
assert.equal(safeSurface(terrain, 0, 0), null, 'unloaded blocks do not invent a surface');
terrain.loaded = true; terrain.depth = 30;
const scene = new THREE.Scene(), population = new FreeplayPopulation(scene, terrain, 42);
const twin = new FreeplayPopulation(new THREE.Scene(), terrain, 42), player = { x: 0, y: 35, z: 0 };
population.update(.1, player); twin.update(.1, player);
assert.equal(population.stats().active, 10);
assert.deepEqual(population.members.map(m => m.home), twin.members.map(m => m.home), 'same seed produces same residents');
assert.ok(population.members.every(m => m.rig.group.children.length > 1 || m.kind === 'villager'), 'actual jointed rigs are used');
const before = population.members.map(m => m.pos.clone());
terrain.depth = 1; // Destroy 29 levels; a former shallow-height scan must fail this case.
assert.equal(population.blast(event), 10);
assert.equal(population.blast(event), 0);
for (let i = 0; i < 12; i++) population.update(.1, player);
assert.ok(population.members.some((m, i) => m.pos.y > before[i].y + 2), 'explosion visibly launches characters');
for (let i = 0; i < 80; i++) population.update(.1, player);
assert.equal(population.stats().flying, 0);
assert.equal(population.stats().active, 10);
assert.ok(population.members.every(m => m.pos.y === 2), 'all characters recover on real deep-crater ground');
population.dispose(); twin.dispose(); assert.equal(scene.children.length, 0);
console.log('Free-play effects: PASS (bounded Plain/Fine spectacle, comfort settings, deterministic residents, deep-crater recovery, cleanup).');
