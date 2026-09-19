// Local flight is a preview. Only a completed server transaction produces impact.
import * as THREE from 'three';
import { WEAPONS, weaponById } from './weapons.js';
import { SheepProjectiles, validSheepOrigin } from './weapon-sheep.js';

const TRAIL = 12, DEBRIS = 16, IMPACTS = 3;
const validCenter = value => Array.isArray(value) && value.length === 3 && value.every(Number.isSafeInteger)
  && Math.abs(value[0]) <= 8192 && Math.abs(value[2]) <= 8192 && value[1] >= 1 && value[1] <= 63;

export class WeaponController {
  constructor(game) {
    this.game = game; this.disposed = false; this.shot = null; this.recoil = 0; this.cooldown = 0;
    this.seen = new Set(); this.voices = []; this.materials = [];
    this.root = new THREE.Group(); this.root.name = 'freeplay-weapons'; game.scene.add(this.root);
    this.box = new THREE.BoxGeometry(1, 1, 1); this.sphere = new THREE.SphereGeometry(1, 12, 8);
    this.cylinder = new THREE.CylinderGeometry(1, 1, 1, 12);
    this.ring = new THREE.RingGeometry(.86, 1, 40); this.torus = new THREE.TorusGeometry(1, .16, 6, 16);
    this.geometries = [this.box, this.sphere, this.cylinder, this.ring, this.torus];
    this.dummy = new THREE.Object3D(); this.point = new THREE.Vector3();
    this.gun = new THREE.Group(); this.gun.name = 'held-weapon'; this.gun.visible = false; this.root.add(this.gun);
    this.models = new Map(WEAPONS.map(weapon => [weapon.id, this.buildGun(weapon)]));
    this.projectile = new THREE.Mesh(this.sphere, this.material(0xffffff));
    this.projectile.name = 'weapon-projectile'; this.projectile.visible = false; this.root.add(this.projectile);
    this.trailGeometry = new THREE.BufferGeometry();
    this.trailGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
    this.trail = new THREE.Line(this.trailGeometry, new THREE.LineBasicMaterial({ transparent: true, opacity: .7, depthWrite: false }));
    this.trail.frustumCulled = false; this.trail.visible = false; this.root.add(this.trail);
    this.slots = Array.from({ length: IMPACTS }, () => this.buildImpact());
    this.sheep = new SheepProjectiles(game);
  }

  material(colour, overlay = false) {
    const material = new THREE.MeshBasicMaterial({ color: colour, depthTest: !overlay, depthWrite: !overlay, toneMapped: false });
    this.materials.push(material); return material;
  }

  buildGun(weapon) {
    const group = new THREE.Group(); group.name = weapon.id; this.gun.add(group);
    const metal = this.material(0x283c50, true), rim = this.material(0x8aa5b5, true);
    const glow = this.material(weapon.colour, true), dark = this.material(0x07121e, true);
    const part = (name, geometry, material, position, scale, rotation = 0) => {
      const mesh = new THREE.Mesh(geometry, material); mesh.name = name;
      mesh.position.set(...position); mesh.scale.set(...scale); mesh.rotation.x = rotation;
      mesh.renderOrder = 20; mesh.frustumCulled = false; group.add(mesh); return mesh;
    };
    part('body', this.box, metal, [0, 0, 0], [.19, .16, .32]);
    part('grip', this.box, dark, [0, -.12, .08], [.09, .22, .11], -.25);
    part('sight', this.box, glow, [0, .105, -.04], [.035, .025, .12]);
    if (weapon.id === 'machinegun') {
      for (const x of [-.04, .04]) part('burst-barrel', this.cylinder, rim, [x, .03, -.27], [.035, .45, .035], Math.PI / 2);
      part('ammo-drum', this.cylinder, metal, [0, -.12, -.02], [.13, .14, .13], Math.PI / 2);
      part('tracer-muzzle', this.box, glow, [0, .025, -.51], [.1, .04, .03]);
      part('stock', this.box, rim, [0, -.02, .23], [.14, .14, .17]);
    } else if (weapon.id === 'sheep') {
      part('flock-tube', this.cylinder, rim, [0, .015, -.19], [.16, .43, .16], Math.PI / 2);
      part('green-muzzle', this.torus, glow, [0, .015, -.415], [.163, .163, .163]);
      part('hollow-barrel', this.cylinder, dark, [0, .015, -.409], [.138, .01, .138], Math.PI / 2);
      part('wool-chamber', this.sphere, this.material(0xf9f1d7, true), [0, .07, .03], [.18, .16, .18]);
      for (const side of [-1, 1]) part('little-ear', this.box, glow, [side * .18, .11, .02], [.1, .035, .07]);
    } else if (weapon.id === 'rocket') {
      part('launch-tube', this.cylinder, metal, [0, .02, -.2], [.135, .65, .135], Math.PI / 2);
      part('orange-muzzle', this.torus, glow, [0, .02, -.525], [.139, .139, .139]);
      part('hollow-barrel', this.cylinder, dark, [0, .02, -.52], [.115, .012, .115], Math.PI / 2);
      part('shoulder-rest', this.box, rim, [0, 0, .27], [.26, .2, .11]);
    } else if (weapon.id === 'gravity') {
      for (const side of [-1, 1]) {
        part('fork-arm', this.box, rim, [side * .14, 0, -.19], [.055, .07, .39]);
        part('purple-prong', this.box, glow, [side * .11, 0, -.39], [.1, .065, .09]);
      }
      part('gravity-core', this.sphere, glow, [0, 0, -.21], [.07, .07, .07]);
    } else {
      part('barrel', this.cylinder, rim, [0, .025, -.24], [.058, .25, .058], Math.PI / 2);
      part('cyan-muzzle', this.torus, glow, [0, .025, -.37], [.062, .062, .062]);
      part('reactor', this.sphere, glow, [.105, .01, .015], [.04, .065, .09]);
      part('energy-chamber', this.box, glow, [0, 0, -.1], [.2, .07, .055]);
    }
    return group;
  }

  buildImpact() {
    const group = new THREE.Group(); group.visible = false; this.root.add(group);
    const ring = new THREE.Mesh(this.ring, this.material(0xffffff));
    ring.rotation.x = -Math.PI / 2; ring.material.side = THREE.DoubleSide;
    const pulse = new THREE.Mesh(this.sphere, this.material(0xffffff));
    for (const mesh of [ring, pulse]) { mesh.material.transparent = true; mesh.material.depthWrite = false; group.add(mesh); }
    const debris = new THREE.InstancedMesh(this.box, this.material(0x9279bb), DEBRIS);
    debris.frustumCulled = false; group.add(debris);
    return { group, ring, pulse, debris, age: 0, life: 0, weapon: null };
  }

  fire(candidate, hit) {
    const g = this.game, weapon = weaponById(candidate?.id);
    const center = hit && [hit.x, Math.min(63, hit.y + 1), hit.z];
    if (this.disposed || this.busy || !weapon || !validCenter(center) || !Number.isSafeInteger(hit.y)
      || hit.y < 0 || hit.y > 63 || !g.connection?.connected || !g.canEdit?.()) return false;
    const origin = new THREE.Vector3(.32, -.2, -.8).applyQuaternion(g.camera.quaternion).add(g.camera.position);
    const sharedOrigin = origin.toArray().map(Math.round);
    if (weapon.id === 'sheep' && (!validSheepOrigin(sharedOrigin)
      || Math.hypot(...sharedOrigin.map((value, i) => value - center[i])) > weapon.range)) return false;
    this.shot = { weapon, center, origin, target: new THREE.Vector3(...center), elapsed: 0,
      sharedOrigin, socket: g.connection.socket, epoch: g.connection.epoch };
    this.projectile.position.copy(origin); this.projectile.material.color.set(weapon.colour);
    const size = weapon.id === 'machinegun' ? .045 : .14;
    this.projectile.scale.set(size, size, weapon.id === 'rocket' ? .38 : size);
    this.projectile.lookAt(this.shot.target); this.projectile.visible = this.trail.visible = weapon.id !== 'sheep';
    this.trail.material.color.set(weapon.colour); this.recoil = 1;
    this.cooldown = weapon.cooldown || 0;
    g.unlockAudio?.(); if (weapon.id !== 'sheep') this.tone(weapon); this.updateShot(0); return true;
  }

  updateShot(dt) {
    const shot = this.shot, g = this.game; if (!shot) return;
    if (!g.connection.connected || shot.socket !== g.connection.socket || shot.epoch !== g.connection.epoch) {
      this.cancel(); g.ui.message('Shot cancelled while the shared world reconnected.'); return;
    }
    shot.elapsed += dt;
    const t = shot.weapon.flight ? Math.min(1, shot.elapsed / shot.weapon.flight) : 1, positions = this.trailGeometry.attributes.position;
    this.projectile.position.lerpVectors(shot.origin, shot.target, t);
    for (let i = 0; i < TRAIL; i++) {
      const fraction = Math.max(0, t - .2 * i / (TRAIL - 1));
      this.point.lerpVectors(shot.origin, shot.target, fraction);
      positions.setXYZ(i, this.point.x, this.point.y, this.point.z);
    }
    positions.needsUpdate = true;
    if (t === 1) {
      const fields = { weapon: shot.weapon.id, center: shot.center };
      if (shot.weapon.id === 'sheep') fields.origin = shot.sharedOrigin;
      if (g.canEdit?.() && g.send('weapon', fields)) this.cancel();
      else g.ui.message(shot.weapon.name + ' queued · waiting for the shared world…');
    }
  }

  impact(transfer) {
    const weapon = weaponById(transfer?.weapon);
    if (this.disposed || !weapon || transfer.snapshot || transfer.kind !== 'weapon' || !validCenter(transfer.center)
      || !Number.isSafeInteger(transfer.revision)) return false;
    if (weapon.id === 'sheep' && (!validSheepOrigin(transfer.origin)
      || Math.hypot(...transfer.origin.map((value, i) => value - transfer.center[i])) > weapon.range)) return false;
    const id = `weapon:${transfer.epoch ?? this.game.connection.epoch}:${transfer.revision}`;
    if (this.seen.has(id)) return false;
    this.seen.add(id); if (this.seen.size > 128) this.seen.delete(this.seen.values().next().value);
    if (weapon.id === 'sheep') { const launched = this.sheep.launch(transfer.origin, transfer.center); if (launched) this.tone(weapon, true); return launched; }
    const [x, y, z] = transfer.center, event = { id, x, y, z, radius: weapon.radius, depth: weapon.depth };
    this.game.population.blast(event);
    if (weapon.id === 'rocket') this.game.effects.detonate({ ...event, kind: 'dynamite' });
    else {
      const slot = this.slots.find(item => !item.group.visible) || this.slots.reduce((a, b) => a.age > b.age ? a : b);
      slot.weapon = weapon; slot.age = 0; slot.life = weapon.id === 'gravity' ? 1.7 : .55;
      slot.group.position.set(x + .5, y + .05, z + .5); slot.group.visible = true;
      slot.ring.material.color.set(weapon.colour); slot.pulse.material.color.set(weapon.colour);
      this.updateImpact(slot, 0); this.tone(weapon, true);
    }
    return true;
  }

  updateImpact(slot, dt) {
    if (!slot.group.visible) return;
    slot.age += dt; const t = slot.age / slot.life;
    if (t >= 1) { slot.group.visible = false; return; }
    const settings = this.game.settings || {}, gravity = slot.weapon.id === 'gravity';
    const radius = slot.weapon.radius * (settings.reducedMotion ? 1 : .15 + t);
    slot.ring.scale.setScalar(radius); slot.ring.material.opacity = (1 - t) * (settings.reducedFlash ? .22 : .65);
    slot.pulse.scale.set(radius, gravity ? radius * .3 : radius, radius);
    slot.pulse.material.opacity = (1 - t) * (settings.reducedFlash ? .04 : .14);
    slot.debris.visible = gravity && !settings.reducedMotion;
    if (slot.debris.visible) {
      for (let i = 0; i < DEBRIS; i++) {
        const angle = i * 2.39996, r = 2 + i % 5 * 1.8;
        this.dummy.position.set(Math.cos(angle) * r, Math.sin(t * Math.PI) * (3 + i % 4), Math.sin(angle) * r);
        this.dummy.rotation.set(t * 3 + i, t * 2, i); this.dummy.scale.setScalar(.18 + i % 3 * .08);
        this.dummy.updateMatrix(); slot.debris.setMatrixAt(i, this.dummy.matrix);
      }
      slot.debris.instanceMatrix.needsUpdate = true;
    }
  }

  tone(weapon, impact = false) {
    const audio = this.game.effects?.audio, ctx = audio?.audio?.ctx || audio?.ctx;
    if (!ctx || ctx.state !== 'running' || this.game.settings?.muted || audio.muted || audio.audio?.muted) return;
    while (this.voices.length >= 3) this.releaseVoice(this.voices[0]);
    const oscillator = ctx.createOscillator(), gain = ctx.createGain(), now = ctx.currentTime;
    const gravity = weapon.id === 'gravity', rocket = weapon.id === 'rocket', sheep = weapon.id === 'sheep', burst = weapon.id === 'machinegun';
    const duration = sheep ? .55 : gravity ? .32 : burst ? .12 : .17;
    oscillator.type = rocket || sheep ? 'sawtooth' : gravity ? 'sine' : burst ? 'square' : 'triangle';
    oscillator.frequency.setValueAtTime(sheep ? 180 : gravity ? 160 : rocket ? 110 : burst ? 260 : impact ? 650 : 1250, now);
    oscillator.frequency.exponentialRampToValueAtTime(gravity ? 420 : rocket ? 45 : burst ? 80 : 170, now + duration);
    gain.gain.setValueAtTime(.001, now); gain.gain.exponentialRampToValueAtTime(sheep ? .016 : impact ? .025 : .05, now + .012);
    if (sheep) for (let i = 1; i < 14; i++) {
      oscillator.frequency.setValueAtTime(175 + Math.sin(i * 2) * 22, now + i * .035);
      gain.gain.setValueAtTime(.01 + Math.sin(i * 2) * .005, now + i * .035);
    }
    if (burst) for (const offset of [.035, .075]) { gain.gain.setValueAtTime(.004, now + offset); gain.gain.setValueAtTime(.035, now + offset + .008); }
    gain.gain.exponentialRampToValueAtTime(.001, now + duration);
    oscillator.connect(gain).connect(audio.audio?.master || ctx.destination);
    const voice = { oscillator, gain, stopped: false }; this.voices.push(voice);
    oscillator.onended = () => this.releaseVoice(voice); oscillator.start(now); oscillator.stop(now + duration);
  }

  releaseVoice(voice) {
    if (voice.stopped) return;
    voice.stopped = true; voice.oscillator.onended = null;
    voice.oscillator.stop(); voice.oscillator.disconnect(); voice.gain.disconnect();
    this.voices = this.voices.filter(item => item !== voice);
  }

  update(dt, selected) {
    if (this.disposed || !Number.isFinite(dt) || dt < 0) return;
    dt = Math.min(dt, .1); this.recoil = Math.max(0, this.recoil - dt * 7); this.cooldown = Math.max(0, this.cooldown - dt);
    const g = this.game, weapon = selected?.type === 'weapon' && weaponById(selected.id);
    this.gun.visible = !!weapon && !g.paused;
    if (weapon) {
      for (const [id, model] of this.models) model.visible = id === weapon.id;
      this.gun.quaternion.copy(g.camera.quaternion);
      this.gun.position.set(.33, -.28, -.62 + (g.settings?.reducedMotion ? 0 : this.recoil * .04))
        .applyQuaternion(g.camera.quaternion).add(g.camera.position);
    }
    if (g.settings?.muted) for (const voice of [...this.voices]) this.releaseVoice(voice);
    this.updateShot(dt); for (const slot of this.slots) this.updateImpact(slot, dt); this.sheep.update(dt);
  }

  cancel() { this.shot = null; this.projectile.visible = this.trail.visible = false; }
  get busy() { return !!this.shot || this.cooldown > 0; }
  stats() { return { pending: !!this.shot, impacts: this.slots.filter(slot => slot.group.visible).length, capacity: IMPACTS, seen: this.seen.size, voices: this.voices.length, sheep: this.sheep.stats() }; }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.cancel();
    this.root.removeFromParent(); this.sheep.dispose();
    for (const voice of [...this.voices]) this.releaseVoice(voice);
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const slot of this.slots) slot.debris.dispose();
    this.trailGeometry.dispose(); this.trail.material.dispose(); this.seen.clear();
  }
}
