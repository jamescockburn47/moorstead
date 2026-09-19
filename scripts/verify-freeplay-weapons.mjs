import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WeaponController } from '../src/freeplay/weapon-effects.js';
import { WEAPONS, weaponById } from '../src/freeplay/weapons.js';
import { FreeplayPopulation } from '../src/freeplay/population.js';
import { B } from '../src/defs.js';

function fixture() {
  const sent = [], blasts = [], explosions = [], messages = [];
  const game = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(75, 1, .08, 800),
    connection: { connected: true, epoch: 2, socket: {} }, settings: { plain: true },
    player: { pos: { x: 0, y: 35, z: 0 } }, paused: false, ready: true, accepted: true,
    world: { setBlock() { throw new Error('Weapon visuals must not mutate authoritative terrain'); } },
    canEdit() { return this.ready; }, send(type, fields) { sent.push({ type, ...fields }); return this.accepted; },
    ui: { message(value) { messages.push(value); } }, unlockAudio() {},
    effects: { audio: {}, detonate(event) { explosions.push(event); } },
    population: { blast(event) { blasts.push(event); } } };
  game.camera.position.set(0, 35, 0); game.camera.updateMatrixWorld();
  return { game, sent, blasts, explosions, messages, controller: new WeaponController(game) };
}
const target = { x: 12, y: 30, z: -20 };
const transfer = (weapon = 'plasma', revision = 1) => ({ kind: 'weapon', weapon, revision, epoch: 2, center: [0, 31, 0] });
const advance = (controller, steps = 15) => { for (let i = 0; i < steps; i++) controller.update(.1, { type: 'weapon', id: 'plasma' }); };

{
  const { game, controller, sent } = fixture();
  assert.equal(controller.fire(null, target), false);
  assert.equal(controller.fire(WEAPONS[0], null), false);
  for (const bad of [{ ...target, x: NaN }, { ...target, x: 9000 }, { ...target, y: .5 }, { ...target, y: -1 }])
    assert.equal(controller.fire(WEAPONS[0], bad), false, 'invalid targets do not invent a position');
  game.ready = false; assert.equal(controller.fire(WEAPONS[0], target), false);
  game.ready = true; const canEdit = game.canEdit; game.canEdit = undefined;
  assert.equal(controller.fire(WEAPONS[0], target), false, 'missing gate never permits a shot'); game.canEdit = canEdit;
  for (const weapon of WEAPONS) {
    controller.update(.01, { type: 'weapon', id: weapon.id });
    assert.equal(controller.gun.visible, true);
    assert.equal([...controller.models.values()].filter(model => model.visible).length, 1);
    assert.ok(controller.models.get(weapon.id).children.length >= 6, 'each held weapon has recognizable separate parts');
  }
  controller.update(.01, { type: 'block', id: 1 }); assert.equal(controller.gun.visible, false);
  game.paused = true; controller.update(.01, { type: 'weapon', id: 'plasma' }); assert.equal(controller.gun.visible, false);
  game.paused = false; game.camera.position.set(100, 40, -60); game.camera.rotation.set(.1, 2, 0); game.camera.updateMatrixWorld();
  controller.update(.01, { type: 'weapon', id: 'plasma' });
  assert.ok(controller.gun.position.distanceTo(game.camera.position) < 1, 'held gun follows camera even though camera is outside scene');
  assert.ok(controller.gun.quaternion.angleTo(game.camera.quaternion) < 1e-6);
  assert.equal(controller.fire(WEAPONS[0], target), true);
  assert.equal(controller.fire(WEAPONS[1], target), false, 'one in-flight command only');
  controller.update(.1, { type: 'weapon', id: 'plasma' }); assert.equal(sent.length, 0, 'never send before flight');
  game.ready = false; advance(controller); assert.equal(sent.length, 0, 'busy gate retains flight without sending');
  assert.equal(controller.stats().pending, true);
  game.ready = true; game.accepted = false; controller.update(.1);
  assert.equal(controller.stats().pending, true, 'temporary send refusal remains queued');
  game.accepted = true; controller.update(.1); assert.equal(controller.stats().pending, false);
  assert.deepEqual(sent.at(-1), { type: 'weapon', weapon: 'plasma', center: [12, 31, -20] });
  const count = sent.length; advance(controller); assert.equal(sent.length, count, 'successful shot is never sent twice');
  assert.equal(controller.fire(WEAPONS[0], { x: 0, y: 63, z: 0 }), true); advance(controller);
  assert.deepEqual(sent.at(-1).center, [0, 63, 0], 'ceiling remains within terrain height');
  for (const weapon of WEAPONS) {
    assert.equal(controller.fire(weapon, target), true); advance(controller);
    assert.equal(sent.at(-1).weapon, weapon.id); assert.equal(controller.stats().pending, false);
  }
  let disposed = 0; controller.box.addEventListener('dispose', () => disposed++);
  controller.dispose(); controller.dispose(); assert.equal(disposed, 1); assert.equal(game.scene.children.length, 0);
  assert.equal(controller.fire(WEAPONS[0], target), false);
}

for (const change of [game => game.connection.epoch++, game => game.connection.socket = {}, game => game.connection.connected = false]) {
  const { game, controller, sent } = fixture();
  assert.equal(controller.fire(WEAPONS[1], target), true); change(game); advance(controller);
  assert.equal(controller.stats().pending, false); assert.equal(controller.projectile.visible, false);
  assert.equal(sent.length, 0, 'old socket/epoch/disconnected flight cannot reach shared terrain'); controller.dispose();
}

{
  const { game, controller, blasts, explosions } = fixture();
  for (const invalid of [{ ...transfer(), snapshot: true }, { ...transfer(), kind: 'blast' },
    { ...transfer(), weapon: 'unknown' }, { ...transfer(), center: [NaN, 31, 0] }, { ...transfer(), revision: undefined }])
    assert.equal(controller.impact(invalid), false);
  assert.equal(controller.impact(transfer()), true); assert.equal(controller.impact(transfer()), false);
  assert.equal(blasts.length, 1, 'authoritative duplicate never launches characters twice');
  assert.equal(controller.impact({ ...transfer(), epoch: 3 }), true, 'reused revision in a new epoch remains distinct');
  controller.impact(transfer('rocket', 2));
  assert.deepEqual(explosions[0], { id: 'weapon:2:2', x: 0, y: 31, z: 0, radius: 7, depth: 5, kind: 'dynamite' });
  controller.impact(transfer('gravity', 3)); assert.equal(blasts.at(-1).depth, 0); assert.equal(blasts.at(-1).radius, 14);
  for (let revision = 4; revision < 204; revision++) controller.impact(transfer(revision % 2 ? 'gravity' : 'plasma', revision));
  assert.equal(controller.stats().impacts, 3); assert.equal(controller.stats().seen, 128);
  assert.equal(controller.slots.reduce((sum, slot) => sum + slot.debris.count, 0), 48);
  game.settings.reducedMotion = game.settings.reducedFlash = true; controller.update(.1);
  assert.ok(controller.slots.every(slot => !slot.debris.visible));
  assert.ok(controller.slots.every(slot => slot.pulse.material.opacity <= .04 && slot.ring.material.opacity <= .22));
  advance(controller, 25); assert.equal(controller.stats().impacts, 0); controller.dispose();
}

{
  const { game, controller } = fixture();
  const terrain = { gen: { geo: { villages: [{ name: 'Fixture village', x: 0, z: 0 }] } },
    isLoaded() { return true; }, getBlock(x, y) { return y <= 30 ? B.STONE : B.AIR; } };
  const population = new FreeplayPopulation(game.scene, terrain, 42); game.population = population;
  population.update(.1, game.player.pos); controller.impact(transfer('gravity'));
  assert.ok(population.stats().flying > 0, 'gravity actually launches nearby population rigs');
  for (let i = 0; i < 12; i++) population.update(.1, game.player.pos);
  assert.ok(population.members.some(member => member.pos.y > 33), 'cartoon characters rise visibly');
  for (let i = 0; i < 80; i++) population.update(.1, game.player.pos);
  assert.equal(population.stats().flying, 0);
  assert.ok(population.members.every(member => member.pos.y === 31), 'every resident returns safely to unchanged ground');
  population.dispose(); controller.dispose(); assert.equal(game.scene.children.length, 0);
}

{
  const { game, controller } = fixture(); let stops = 0, disconnects = 0;
  const parameter = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
  const nodes = [];
  game.effects.audio.ctx = { state: 'running', currentTime: 0, destination: {},
    createOscillator() { const node = { frequency: parameter, start() {}, stop() { stops++; },
      connect(other) { return other; }, disconnect() { disconnects++; } }; nodes.push(node); return node; },
    createGain() { return { gain: parameter, connect() {}, disconnect() { disconnects++; } }; } };
  for (let i = 0; i < 20; i++) controller.tone(weaponById('plasma'));
  assert.equal(controller.stats().voices, 3, 'rapid fire has bounded sound voices');
  game.settings.muted = true; controller.update(.1); assert.equal(controller.stats().voices, 0);
  const before = nodes.length; controller.tone(WEAPONS[0]); assert.equal(nodes.length, before, 'mute suppresses new voices');
  game.settings.muted = false; controller.tone(WEAPONS[2]); nodes.at(-1).onended(); assert.equal(controller.stats().voices, 0);
  controller.tone(WEAPONS[1]); controller.dispose(); assert.equal(controller.stats().voices, 0);
  assert.equal(disconnects, nodes.length * 2, 'all oscillator and gain connections are released');
  assert.equal(stops, nodes.length * 2, 'each oscillator receives its scheduled stop and one cleanup');
}
console.log('Free-play weapons: PASS (distinct held models, gated flight, reconnect cancellation, bounded impacts/audio, actual gravity recovery, disposal).');
