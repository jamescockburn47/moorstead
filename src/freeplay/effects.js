// Bounded procedural blast spectacle. Cosmetic quality never determines damage.
import * as THREE from 'three';
import { mulberry32, strSeed } from '../noise.js';
import { ExplosionAudio } from './explosion-audio.js';

const LIMIT = 3, LIFETIME = 12;
const PROFILES = Object.freeze({
  grenade: { life: 2.2, fire: .36, ring: .8, rise: .6, height: .45, spread: .65, smoke: .35, debris: .4, shade: .46, aspect: [1,1,1] },
  dynamite: { life: 3.8, fire: .65, ring: 1.3, rise: 1, height: 1.1, spread: .36, smoke: .48, debris: .5, shade: .42, aspect: [.55,1.35,.55] },
  demolition: { life: 5.5, fire: 1.05, ring: 1.8, rise: 1.6, height: .8, spread: .95, smoke: .65, debris: .7, shade: .4, aspect: [1,.7,1] },
  mega: { life: 8, fire: 1.7, ring: 2.7, rise: 2.3, height: .72, spread: 1.3, smoke: .85, debris: .9, shade: .48, aspect: [1.15,.65,1.15] },
  atom: { life: 12, fire: 2.6, ring: 3.8, rise: 4, smoke: 1, debris: 1, aspect: [1,1,1], mushroom: true },
});
const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };

export class ExplosionEffects {
  constructor(scene, { plain = false, reducedMotion = false, reducedFlash = false, muted = false, audio = null } = {}) {
    this.scene = scene; this.plain = plain;
    this.reducedMotion = reducedMotion; this.reducedFlash = reducedFlash;
    this.audio = new ExplosionAudio(audio);
    this.audio.setMuted(muted);
    this.group = new THREE.Group(); this.group.name = 'freeplay-explosions';
    this.scene.add(this.group);
    this.sphere = new THREE.IcosahedronGeometry(1, plain ? 1 : 2);
    this.ringGeometry = new THREE.RingGeometry(.93, 1, plain ? 48 : 80);
    this.debrisGeometry = new THREE.BoxGeometry(1, 1, 1);
    this.dummy = new THREE.Object3D(); this.colour = new THREE.Color();
    this.camera = new THREE.Vector3(); this.serial = 0; this.seen = new Set();
    this.slots = Array.from({ length: LIMIT }, () => this.createSlot());
    this.disposed = false;
  }

  createSlot() {
    const group = new THREE.Group(); group.visible = false; this.group.add(group);
    const smokeMaterial = new THREE.MeshLambertMaterial({
      color: 0xffffff, transparent: true, opacity: .9, depthWrite: false, flatShading: true,
    });
    const smoke = new THREE.InstancedMesh(this.sphere, smokeMaterial, this.plain ? 26 : 46);
    smoke.frustumCulled = false; smoke.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const fireMaterial = new THREE.MeshBasicMaterial({ color: 0xffb23c, transparent: true, opacity: .9, depthWrite: false });
    const fire = new THREE.Mesh(this.sphere, fireMaterial);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xf7dda6, transparent: true, opacity: .6, depthWrite: false, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(this.ringGeometry, ringMaterial); ring.rotation.x = -Math.PI / 2;
    const debrisMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
    const debris = new THREE.InstancedMesh(this.debrisGeometry, debrisMaterial, this.plain ? 40 : 96);
    debris.frustumCulled = false; debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const light = new THREE.PointLight(0xffa347, 0, 160, 1.6);
    group.add(smoke, fire, ring, debris, light);
    return { group, smoke, fire, ring, debris, light, age: LIFETIME, lifetime: LIFETIME, serial: 0,
      smokeCapacity: smoke.count, debrisCapacity: debris.count, particles: [], puffs: [] };
  }

  unlockAudio() { return this.audio.unlock(); }

  detonate(event) {
    const profile = PROFILES[event?.kind];
    if (this.disposed || !profile || ![event.x, event.y, event.z, event.radius].every(Number.isFinite)) return false;
    if (event.radius <= 0 || event.radius > 64 || (event.id != null && this.seen.has(event.id))) return false;
    if (event.id != null) {
      this.seen.add(event.id);
      if (this.seen.size > 128) this.seen.delete(this.seen.values().next().value);
    }
    const slot = this.slots.find(item => item.age >= item.lifetime) || this.slots.reduce((a, b) => a.serial < b.serial ? a : b);
    slot.serial = ++this.serial; slot.age = 0; slot.radius = event.radius;
    slot.profile = profile; slot.lifetime = profile.life;
    slot.smoke.count = Math.max(8,Math.round(slot.smokeCapacity*profile.smoke));
    slot.debris.count = Math.max(10,Math.round(slot.debrisCapacity*profile.debris));
    slot.group.position.set(event.x, event.y, event.z); slot.group.visible = true;
    const random = mulberry32(strSeed(String(event.id ?? `${event.x},${event.y},${event.z}`)));
    slot.puffs = Array.from({ length: slot.smoke.count }, (_, i) => {
      if(!profile.mushroom){
        const angle=random()*Math.PI*2,spread=Math.sqrt(random())*profile.spread;
        return { cap:false,x:Math.cos(angle)*spread,z:Math.sin(angle)*spread,y:(.2+random()*.8)*profile.height,
          size:.12+random()*.2,shade:profile.shade+random()*.15 };
      }
      const cap = i >= Math.floor(slot.smoke.count * .35);
      const angle = random() * Math.PI * 2, spread = cap ? Math.sqrt(random()) * .83 : .08 + random() * .13;
      return { cap, x: Math.cos(angle) * spread, z: Math.sin(angle) * spread,
        y: cap ? 1.08 + random() * .31 : .15 + i / slot.smoke.count * 2.5,
        size: cap ? .24 + random() * .12 : .12 + random() * .08, shade: .50 + random() * .23 };
    });
    slot.particles = Array.from({ length: slot.debris.count }, () => {
      const angle = random() * Math.PI * 2, speed = event.radius * (.25 + random() * .8);
      return { x: Math.cos(angle) * speed, z: Math.sin(angle) * speed,
        y: 6 + random() * event.radius * .65, size: .15 + random() * .7, turn: random() * 7 };
    });
    for (let i = 0; i < slot.debris.count; i++) {
      slot.debris.setColorAt(i, this.colour.setHex([0x786249, 0x554a3d, 0x98938c, 0xbfb29a][i % 4]));
    }
    slot.debris.instanceColor.needsUpdate = true;
    this.renderSlot(slot);
    this.audio.play(event, this.camera.distanceTo(slot.group.position));
    return true;
  }

  renderSlot(slot) {
    const t = slot.age, radius = slot.radius, { dummy, colour } = this, profile=slot.profile;
    const fadeStart=profile.life*7/12;
    const rise = smooth(t / profile.rise), fade = 1 - smooth((t - fadeStart) / (profile.life-fadeStart));
    const fireSize = radius * Math.max(0, 1 - t / profile.fire) * (.18 + smooth(t / Math.min(.35,profile.fire*.4)) * .53);
    slot.fire.visible = t < profile.fire;
    slot.fire.scale.set(...profile.aspect.map(value=>Math.max(.01,fireSize*value))); slot.fire.position.y = fireSize * .35;
    slot.fire.material.opacity = (this.reducedFlash ? .38 : .85) * (1 - smooth(t / profile.fire));
    slot.fire.material.color.setHex(this.reducedFlash ? 0xc8783a : t < .16 ? 0xffefb7 : 0xff9d32);
    slot.light.intensity = this.plain || this.reducedFlash ? 0 : Math.max(0, radius/5 * (1 - t / Math.min(.7,profile.fire)));
    slot.light.distance = radius * 4; slot.light.position.y = radius * .25;
    const ringSize = radius * (.1 + t * 1.3);
    slot.ring.visible = t < profile.ring;
    slot.ring.position.y = .8 + t * .8; slot.ring.scale.setScalar(ringSize);
    slot.ring.material.opacity = (this.reducedFlash ? .2 : .65) * (1 - smooth(t / profile.ring));
    slot.smoke.visible = t > .12;
    slot.smoke.material.opacity = .92 * fade * smooth(t / Math.min(.7,profile.rise));
    for (let i = 0; i < slot.puffs.length; i++) {
      const puff = slot.puffs[i], spread = .2 + rise * .85;
      const billow = this.reducedMotion ? 0 : Math.sin(t * .65 + i) * .02;
      dummy.position.set(puff.x * radius * spread, radius * puff.y * rise + billow * radius, puff.z * radius * spread);
      dummy.scale.set(radius * puff.size * spread, radius * puff.size * (puff.cap ? .70 : 1.15), radius * puff.size * spread);
      dummy.rotation.set(i * .7, t * (this.reducedMotion ? 0 : .015), i * 1.3); dummy.updateMatrix();
      slot.smoke.setMatrixAt(i, dummy.matrix);
      // The glowing lower stem darkens into ash; the cap keeps a pale sunlit crown.
      const hot = Math.max(0, 1 - t / 3) * (puff.cap ? .22 : .65);
      colour.setRGB(puff.shade + hot * .35, puff.shade * .95 + hot * .03, puff.shade * .87 - hot * .21);
      slot.smoke.setColorAt(i, colour);
    }
    slot.smoke.instanceMatrix.needsUpdate = true; slot.smoke.instanceColor.needsUpdate = true;
    const debrisLife=Math.min(4.5,profile.life*.75);
    slot.debris.visible = t < debrisLife && !this.reducedMotion;
    slot.debris.material.opacity = 1 - smooth((t - debrisLife*.55) / (debrisLife*.45));
    if (slot.debris.visible) for (let i = 0; i < slot.particles.length; i++) {
      const p = slot.particles[i];
      dummy.position.set(p.x * t, p.y * t - 9 * t * t, p.z * t);
      dummy.scale.setScalar(p.size); dummy.rotation.set(t * p.turn, t * p.turn * .5, t * 1.7); dummy.updateMatrix();
      slot.debris.setMatrixAt(i, dummy.matrix);
    }
    slot.debris.instanceMatrix.needsUpdate = true;
  }

  update(dt, cameraPosition) {
    if (this.disposed || !Number.isFinite(dt) || dt < 0) return;
    if (cameraPosition) this.camera.copy(cameraPosition);
    for (const slot of this.slots) {
      if (slot.age >= slot.lifetime) continue;
      slot.age += Math.min(dt, .25);
      if (slot.age >= slot.lifetime) slot.group.visible = false;
      else this.renderSlot(slot);
    }
  }

  stats() {
    return { active: this.slots.filter(slot => slot.age < slot.lifetime).length, capacity: LIMIT,
      particles: this.slots.reduce((n, slot) => n + slot.smokeCapacity + slot.debrisCapacity, 0), seen: this.seen.size };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.scene.remove(this.group);
    for (const slot of this.slots) {
      for (const mesh of [slot.smoke, slot.fire, slot.ring, slot.debris]) mesh.material.dispose();
      slot.smoke.dispose(); slot.debris.dispose();
    }
    this.sphere.dispose(); this.ringGeometry.dispose(); this.debrisGeometry.dispose();
    this.audio.dispose(); this.seen.clear();
  }
}
