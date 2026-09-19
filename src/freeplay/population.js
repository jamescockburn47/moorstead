// Gentle deterministic village life, independent of the NPC brain. Blasts launch
// living characters in cartoon arcs; safe recovery never consults pristine height.
import * as THREE from 'three';
import { mulberry32, strSeed } from '../noise.js';
import { PopulationModels } from './population-models.js';
import { safeSurface, nearbySurface } from './population-ground.js';

const CAPACITY = 36, RANGE = 125;
const KINDS = ['villager', 'villager', 'villager', 'villager', 'sheep', 'sheep', 'sheep', 'sheep', 'cow', 'dog'];

export class FreeplayPopulation {
  constructor(scene, world, seed) {
    this.scene = scene; this.world = world; this.models = new PopulationModels();
    this.group = new THREE.Group(); this.group.name = 'freeplay-population'; scene.add(this.group);
    this.clock = 0; this.refresh = 0; this.disposed = false;
    this.seen = new Set(); this.members = [];
    const villages = (world.gen?.geo?.villages || []).slice(0, 64);
    for (const village of villages) {
      const random = mulberry32(strSeed(`${seed}:${village.name}`));
      for (let i = 0; i < KINDS.length; i++) {
        const angle = i / KINDS.length * Math.PI * 2 + random() * .3;
        const radius = i < 4 ? 6 + random() * 9 : 18 + random() * 14;
        const home = { x: village.x + Math.cos(angle) * radius, z: village.z + Math.sin(angle) * radius };
        this.members.push({ id: `${village.name}:${i}`, kind: KINDS[i], variant: i < 4 ? i : 0,
          home, pos: null, rig: null, phase: random() * Math.PI * 2, launch: null, recovery: 0, moved: 0 });
      }
    }
  }

  refreshVisible(player) {
    const nearby = this.members.filter(member => Math.hypot((member.pos || member.home).x - player.x,
      (member.pos || member.home).z - player.z) < RANGE);
    nearby.sort((a, b) => Math.hypot(a.home.x - player.x, a.home.z - player.z) - Math.hypot(b.home.x - player.x, b.home.z - player.z));
    const selected = new Set(nearby.slice(0, CAPACITY));
    for (const member of this.members) {
      if (!selected.has(member)) {
        if (member.rig) { this.models.release(member.rig); member.rig = null; member.launch = null; }
        continue;
      }
      if (member.rig) continue;
      const site = member.pos || member.home;
      const ground = nearbySurface(this.world, site.x, site.z);
      if (!ground) continue;
      member.pos = new THREE.Vector3(ground.x, ground.y, ground.z);
      member.rig = this.models.acquire(member.kind, member.variant);
      member.rig.group.name = `freeplay:${member.id}`;
      member.rig.group.position.copy(member.pos); this.group.add(member.rig.group);
    }
  }

  blast(event) {
    if (this.disposed || ![event?.x, event?.y, event?.z, event?.radius].every(Number.isFinite) || event.radius <= 0 || event.radius > 64) return 0;
    if (event.id != null && this.seen.has(event.id)) return 0;
    if (event.id != null) { this.seen.add(event.id); if (this.seen.size > 128) this.seen.delete(this.seen.values().next().value); }
    let count = 0;
    for (const member of this.members) {
      if (!member.rig || !member.pos) continue;
      const dx = member.pos.x - event.x, dz = member.pos.z - event.z;
      if (Math.hypot(dx, dz) > event.radius * 1.25 || Math.abs(member.pos.y - event.y) > event.radius) continue;
      const random = mulberry32(strSeed(`${event.id}:${member.id}`));
      const angle = Math.hypot(dx, dz) < .1 ? member.phase : Math.atan2(dz, dx);
      const distance = event.radius * (1.03 + random() * .25) + 3;
      const target = nearbySurface(this.world, event.x + Math.cos(angle) * distance, event.z + Math.sin(angle) * distance)
        || nearbySurface(this.world, member.pos.x, member.pos.z);
      if (!target) continue;
      member.launch = { from: member.pos.clone(), target, age: 0, duration: 2 + random(),
        height: 5 + event.radius * (.3 + random() * .2), spin: random() > .5 ? 1 : -1 };
      member.recovery = 0; count++;
    }
    return count;
  }

  step(member, dt) {
    const { pos, rig } = member;
    if (!this.world.isLoaded(Math.floor(pos.x), Math.floor(pos.z))) { rig.group.visible = false; return; }
    rig.group.visible = true;
    if (member.launch) {
      const launch = member.launch; launch.age += dt;
      const t = Math.min(1, launch.age / launch.duration);
      pos.set(launch.from.x + (launch.target.x - launch.from.x) * t,
        launch.from.y + (launch.target.y - launch.from.y) * t + Math.sin(t * Math.PI) * launch.height,
        launch.from.z + (launch.target.z - launch.from.z) * t);
      rig.group.rotation.z = Math.sin(t * Math.PI) * Math.PI * 2 * launch.spin;
      if (t === 1) {
        const landing = nearbySurface(this.world, pos.x, pos.z);
        if (landing) { pos.set(landing.x, landing.y, landing.z); member.recovery = 1.5; member.launch = null; }
        // A simultaneous edit can remove a landing. Keep the character aloft while
        // the next bounded nearby search locates remaining ground; never bury it.
      }
    } else {
      const ground = safeSurface(this.world, pos.x, pos.z);
      if (ground == null) {
        const nearby = nearbySurface(this.world, pos.x, pos.z);
        if (nearby) pos.set(nearby.x, nearby.y, nearby.z);
        else rig.group.visible = false;
      } else {
        pos.y = Math.max(ground, pos.y - dt * 18);
        if (pos.y < ground) pos.y = ground;
        member.recovery = Math.max(0, member.recovery - dt);
        if (!member.recovery) this.roam(member, dt);
      }
      rig.group.rotation.z = member.recovery ? Math.sin(member.recovery * 10) * .1 : 0;
    }
    const stride = member.launch ? Math.sin(this.clock * 16) * .75 : Math.sin(member.moved * 5) * .38;
    rig.legs.forEach((leg, i) => { leg.rotation.x = stride * (i % 2 ? 1 : -1); });
    rig.group.position.copy(pos);
  }

  roam(member, dt) {
    const { pos } = member;
    const angle = member.phase + this.clock * .085;
    const dx = Math.cos(angle) * dt * .45, dz = Math.sin(angle) * dt * .45;
    const ground = safeSurface(this.world, pos.x + dx, pos.z + dz);
    if (ground == null || Math.abs(ground - pos.y) > 1.05) return;
    pos.x += dx; pos.z += dz; pos.y = ground;
    member.moved += Math.hypot(dx, dz); member.rig.group.rotation.y = Math.atan2(dx, dz);
  }

  update(dt, playerPos) {
    if (this.disposed || !playerPos || !Number.isFinite(dt) || dt < 0) return;
    dt = Math.min(dt, .1); this.clock += dt; this.refresh -= dt;
    if (this.refresh <= 0) { this.refreshVisible(playerPos); this.refresh = .75; }
    for (const member of this.members) if (member.rig) this.step(member, dt);
  }

  stats() {
    return { active: this.members.filter(member => member.rig).length, total: this.members.length,
      flying: this.members.filter(member => member.launch).length, capacity: CAPACITY };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const member of this.members) if (member.rig) { this.models.release(member.rig); member.rig = null; }
    this.scene.remove(this.group); this.models.dispose(); this.seen.clear();
  }
}
