// footprints.js — pressed prints in the snow where folk and beasts walk.
// TrampleBuffer is pure (testable); Footprints renders them as instanced dark
// patches with a dedicated material (NOT the atlas cutout material).
import * as THREE from 'three';

const STEP = 1.2;   // min blocks between prints
const LIFE = 90;    // seconds a print lasts

export class TrampleBuffer {
  constructor(cap = 256) { this.cap = cap; this.prints = []; }
  mark(x, z, now) {
    const last = this.prints[this.prints.length - 1];
    if (last && Math.hypot(last.x - x, last.z - z) < STEP) return;
    this.prints.push({ x, z, t: now });
    if (this.prints.length > this.cap) this.prints.shift();
  }
  alive(now) { return this.prints.filter(p => now - p.t < LIFE); }
}

const FOOT_GEOM = new THREE.PlaneGeometry(0.5, 0.5).rotateX(-Math.PI / 2);
const FOOT_MAT = new THREE.MeshBasicMaterial({ color: 0x3a3a46, transparent: true, opacity: 0.32, depthWrite: false });

export class Footprints {
  constructor(scene, world) { this.scene = scene; this.world = world; this.buf = new TrampleBuffer(256); this.mesh = null; this.timer = 0; }
  update(dt, now, walkers) {
    for (const w of walkers) this.buf.mark(w.x, w.z, now);
    this.timer -= dt; if (this.timer > 0) return; this.timer = 0.3;
    this.rebuild(now);
  }
  rebuild(now) {
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh = null; }
    const live = this.buf.alive(now);
    if (!live.length) return;
    const mesh = new THREE.InstancedMesh(FOOT_GEOM, FOOT_MAT, live.length);
    const m = new THREE.Matrix4();
    for (let i = 0; i < live.length; i++) {
      const p = live[i], y = this.world.gen.height(Math.floor(p.x), Math.floor(p.z)) + 1.02;
      m.makeTranslation(p.x, y, p.z);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.mesh = mesh;
  }
  clear() { if (this.mesh) { this.scene.remove(this.mesh); this.mesh = null; } this.buf.prints.length = 0; }
}
