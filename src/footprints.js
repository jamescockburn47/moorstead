// footprints.js — pressed prints in the snow where folk and beasts walk.
// TrampleBuffer is pure (testable); Footprints renders them as instanced pressed
// patches with a dedicated material (NOT the atlas cutout material). Each print
// keeps the walker's heading so trails read as tracks, and fades per-instance
// (instanceColor toward snow-white) over its life rather than blinking out.
import * as THREE from 'three';
import { printOnSnow } from './snow.js';

const STEP = 1.2;   // min blocks between prints
const LIFE = 420;   // seconds a print lasts — a well-trod path holds through t' morning
const CAP = 768;    // enough for several long trails before the oldest give way

export class TrampleBuffer {
  constructor(cap = CAP) { this.cap = cap; this.prints = []; }
  mark(x, z, now) {
    const last = this.prints[this.prints.length - 1];
    if (last && Math.hypot(last.x - x, last.z - z) < STEP) return;
    // heading from the previous print, so the pressed patch lies along the walk
    const h = last ? Math.atan2(x - last.x, z - last.z) : 0;
    this.prints.push({ x, z, t: now, h });
    if (this.prints.length > this.cap) this.prints.shift();
  }
  alive(now) { return this.prints.filter(p => now - p.t < LIFE); }
  // age fraction [0,1] for a print at `now` — 0 fresh, 1 about to vanish
  age(p, now) { const a = (now - p.t) / LIFE; return a < 0 ? 0 : a > 1 ? 1 : a; }
}

const FOOT_GEOM = new THREE.PlaneGeometry(0.45, 0.6).rotateX(-Math.PI / 2); // longer than wide — a trodden patch, not a tile
const FOOT_MAT = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false });
const FRESH = new THREE.Color(0x5a6278);  // pressed shadow-blue, fresh trodden
const FADED = new THREE.Color(0xf4f7ff);  // drifted back to snow-white (≈ invisible at 0.4 alpha on snow)

export class Footprints {
  constructor(scene, world) { this.scene = scene; this.world = world; this.buf = new TrampleBuffer(); this.mesh = null; this.timer = 0; }
  update(dt, now, walkers, snowAccum = 1) {
    this.snowAccum = snowAccum;
    for (const w of walkers) this.buf.mark(w.x, w.z, now);
    this.timer -= dt; if (this.timer > 0) return; this.timer = 0.3;
    this.rebuild(now);
  }
  rebuild(now) {
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.dispose(); this.mesh = null; }
    // only press prints into ground the snow wash actually covers — below the
    // snow-line the grass is bare and a print reads as a pale ghost on green
    const accum = this.snowAccum ?? 1;
    const live = this.buf.alive(now).filter(p =>
      printOnSnow(this.world.gen.height(Math.floor(p.x), Math.floor(p.z)) + 1, accum));
    if (!live.length) return;
    const mesh = new THREE.InstancedMesh(FOOT_GEOM, FOOT_MAT, live.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    const pos = new THREE.Vector3();
    const col = new THREE.Color();
    for (let i = 0; i < live.length; i++) {
      const p = live[i], y = this.world.gen.height(Math.floor(p.x), Math.floor(p.z)) + 1.02;
      q.setFromAxisAngle(up, p.h);
      pos.set(p.x, y, p.z);
      m.compose(pos, q, one);
      mesh.setMatrixAt(i, m);
      // per-instance fade: fresh prints press dark, old ones drift back to white
      mesh.setColorAt(i, col.lerpColors(FRESH, FADED, this.buf.age(p, now)));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.mesh = mesh;
  }
  clear() { if (this.mesh) { this.scene.remove(this.mesh); this.mesh.dispose(); this.mesh = null; } this.buf.prints.length = 0; }
}
