// A small reusable flock: real Moorstead sheep rigs, never permanent save entities.
import * as THREE from 'three';
import { PopulationModels } from './population-models.js';
import { nearbySurface, safeSurface } from './population-ground.js';

const CAPACITY = 8, FLIGHT = .8, AMBLE = 10;
export const validSheepOrigin = value => Array.isArray(value) && value.length === 3
  && value.every(Number.isSafeInteger) && Math.abs(value[0]) <= 8192 && Math.abs(value[2]) <= 8192
  && value[1] >= 1 && value[1] <= 182;

export class SheepProjectiles {
  constructor(game) {
    this.game = game; this.models = new PopulationModels(); this.slots = []; this.clock = 0; this.disposed = false;
    this.group = new THREE.Group(); this.group.name = 'freeplay-sheep-projectiles'; game.scene.add(this.group);
    this.epoch = game.connection?.epoch; this.socket = game.connection?.socket;
  }

  launch(origin, center) {
    if (this.disposed || !validSheepOrigin(origin) || !validSheepOrigin(center)
      || Math.hypot(...origin.map((value, i) => value - center[i])) > 48) return false;
    this.epoch = this.game.connection?.epoch; this.socket = this.game.connection?.socket;
    let slot = this.slots.find(item => !item.active);
    if (!slot && this.slots.length < CAPACITY) {
      slot = { rig: this.models.acquire('sheep', 0), from: new THREE.Vector3(), target: new THREE.Vector3() };
      this.slots.push(slot); this.group.add(slot.rig.group);
    }
    if (!slot) slot = this.slots.reduce((a, b) => a.started < b.started ? a : b);
    slot.active = true; slot.age = 0; slot.started = this.clock; slot.landed = false;
    slot.from.set(...origin); slot.target.set(center[0] + .5, center[1], center[2] + .5);
    slot.heading = Math.atan2(slot.target.x - slot.from.x, slot.target.z - slot.from.z);
    slot.rig.group.position.copy(slot.from); slot.rig.group.rotation.set(0, slot.heading, 0);
    slot.rig.group.scale.setScalar(.85); slot.rig.group.visible = true;
    return true;
  }

  retire(slot) { slot.active = false; slot.rig.group.visible = false; }

  step(slot, dt) {
    const world = this.game.world, rig = slot.rig, pos = rig.group.position;
    slot.age += dt;
    if (!slot.landed) {
      const t = Math.min(1, slot.age / FLIGHT);
      pos.lerpVectors(slot.from, slot.target, t);
      pos.y += Math.sin(t * Math.PI) * (this.game.settings?.reducedMotion ? 1 : 4);
      rig.group.rotation.x = this.game.settings?.reducedMotion ? 0 : -.3 * Math.cos(t * Math.PI);
      rig.legs.forEach((leg, index) => { leg.rotation.x = Math.sin(slot.age * 18 + index % 2 * Math.PI) * .5; });
      if (t === 1) {
        const landing = nearbySurface(world, pos.x, pos.z);
        if (!landing) { this.retire(slot); return; }
        pos.set(landing.x, landing.y, landing.z); slot.landed = true; slot.age = 0; rig.group.rotation.x = 0;
      }
    } else {
      if (slot.age > AMBLE) { this.retire(slot); return; }
      const ground = safeSurface(world, pos.x, pos.z);
      if (ground == null) {
        const recovery = nearbySurface(world, pos.x, pos.z);
        if (!recovery) { this.retire(slot); return; }
        pos.set(recovery.x, recovery.y, recovery.z);
      } else pos.y = ground;
      const direction = slot.heading + Math.sin(slot.age * .4) * .35;
      const x = pos.x + Math.sin(direction) * dt * .7, z = pos.z + Math.cos(direction) * dt * .7;
      const next = safeSurface(world, x, z);
      if (next != null && Math.abs(next - pos.y) <= 1) { pos.set(x, next, z); rig.group.rotation.y = direction; }
      rig.legs.forEach((leg, index) => { leg.rotation.x = Math.sin(slot.age * 7 + index % 2 * Math.PI) * .35; });
    }
    rig.group.visible = world.isLoaded(Math.floor(pos.x), Math.floor(pos.z));
  }

  update(dt) {
    if (this.disposed || !Number.isFinite(dt) || dt < 0) return;
    const connection = this.game.connection;
    if (connection && (!connection.connected || connection.epoch !== this.epoch || connection.socket !== this.socket)) {
      this.clear(); this.epoch = connection.epoch; this.socket = connection.socket;
    }
    dt = Math.min(.1, dt); this.clock += dt;
    for (const slot of this.slots) if (slot.active) this.step(slot, dt);
  }

  clear() { for (const slot of this.slots) this.retire(slot); }
  stats() { return { active: this.slots.filter(slot => slot.active).length, flying: this.slots.filter(slot => slot.active && !slot.landed).length,
    landed: this.slots.filter(slot => slot.active && slot.landed).length, allocated: this.slots.length, capacity: CAPACITY }; }
  dispose() {
    if (this.disposed) return; this.disposed = true;
    for (const slot of this.slots) this.models.release(slot.rig);
    this.slots.length = 0; this.group.removeFromParent(); this.models.dispose();
  }
}
