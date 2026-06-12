// T' permanent way made visible: steel rails an' oak sleepers swept along
// t' line's spline as real geometry (instanced), dressed in a window round
// t' player an' struck when tha's far frae t' line. Smooth curves, smooth
// gradients — nowt blocky about her.
import * as THREE from 'three';

const WINDOW = 260;        // chainage either side o' t' player kept dressed
const REBUILD_MOVE = 80;   // rebuild when t' player's drifted this far along
const SLEEPER_EVERY = 1.6;
const GAUGE = 0.72;        // rail offset either side o' centre

export class Rails {
  constructor(scene, geo) {
    this.scene = scene;
    this.geo = geo;
    this.center = null;
    this.meshes = [];
    this.timer = 0;
    this.railGeom = new THREE.BoxGeometry(0.14, 0.16, 1);
    this.sleeperGeom = new THREE.BoxGeometry(1.9, 0.12, 0.5);
    this.railMat = new THREE.MeshLambertMaterial({ color: 0x787c84 });
    this.sleeperMat = new THREE.MeshLambertMaterial({ color: 0x4a3a2c });
  }

  // nearest chainage to a point — coarse stride scan, it's only for t' window
  nearestS(px, pz) {
    const pts = this.geo.railPath().pts;
    let best = 0, bd = Infinity;
    for (let i = 0; i < pts.length; i += 6) {
      const d = Math.hypot(pts[i].x - px, pts[i].z - pz);
      if (d < bd) { bd = d; best = i; }
    }
    return { s: pts[best].s, d: bd };
  }

  update(dt, playerPos) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.5;
    const near = this.nearestS(playerPos.x, playerPos.z);
    if (near.d > 320) { this.clear(); return; }
    if (this.center !== null && Math.abs(near.s - this.center) < REBUILD_MOVE && this.meshes.length) return;
    this.build(near.s);
  }

  build(centerS) {
    this.clear();
    this.center = centerS;
    const path = this.geo.railPath();
    const pts = path.pts;
    const s0 = Math.max(0, centerS - WINDOW), s1 = Math.min(path.length, centerS + WINDOW);
    // gather t' samples in window
    let i0 = 0; while (i0 < pts.length - 1 && pts[i0].s < s0) i0++;
    let i1 = i0; while (i1 < pts.length - 1 && pts[i1].s < s1) i1++;
    if (i1 - i0 < 2) return;

    const seg = i1 - i0;
    const rails = new THREE.InstancedMesh(this.railGeom, this.railMat, seg * 2);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ');
    const up = new THREE.Vector3(0, 1, 0);
    let ri = 0;
    for (let i = i0; i < i1; i++) {
      const a = pts[i], b = pts[i + 1];
      const ds = Math.max(b.s - a.s, 0.001);
      const tx = (b.x - a.x) / ds, tz = (b.z - a.z) / ds;
      const yaw = Math.atan2(b.x - a.x, b.z - a.z);
      const pitch = -Math.atan2(b.deck - a.deck, ds);
      e.set(pitch, yaw, 0);
      q.setFromEuler(e);
      for (const side of [-1, 1]) {
        const ox = tz * side * GAUGE, oz = -tx * side * GAUGE;
        m.compose(
          new THREE.Vector3((a.x + b.x) / 2 + ox, (a.deck + b.deck) / 2 + 1.18, (a.z + b.z) / 2 + oz),
          q,
          new THREE.Vector3(1, 1, Math.hypot(b.x - a.x, b.z - a.z, b.deck - a.deck) + 0.06)
        );
        rails.setMatrixAt(ri++, m);
      }
    }
    rails.count = ri;
    rails.instanceMatrix.needsUpdate = true;
    this.scene.add(rails);
    this.meshes.push(rails);

    const nSleep = Math.floor((s1 - s0) / SLEEPER_EVERY);
    const sleepers = new THREE.InstancedMesh(this.sleeperGeom, this.sleeperMat, nSleep);
    let si = 0;
    for (let k = 0; k < nSleep; k++) {
      const sp = this.geo.samplePos(s0 + k * SLEEPER_EVERY);
      e.set(-Math.atan(sp.grade), Math.atan2(sp.tx, sp.tz), 0);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(sp.x, sp.deck + 1.06, sp.z), q, new THREE.Vector3(1, 1, 1));
      sleepers.setMatrixAt(si++, m);
    }
    sleepers.count = si;
    sleepers.instanceMatrix.needsUpdate = true;
    this.scene.add(sleepers);
    this.meshes.push(sleepers);
  }

  clear() {
    for (const mesh of this.meshes) {
      this.scene.remove(mesh);
      mesh.dispose();
    }
    this.meshes = [];
    this.center = null;
  }

  dispose() {
    this.clear();
    this.railGeom.dispose();
    this.sleeperGeom.dispose();
    this.railMat.dispose();
    this.sleeperMat.dispose();
  }
}
