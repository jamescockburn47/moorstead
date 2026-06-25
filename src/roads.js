// The parish lanes made visible: a packed-earth ribbon draped along the road
// alignment (roadpath.js), dressed in a window round the player and struck when
// tha's far frae the lane — same as the permanent way (rails.js), only earth not
// steel. Where a lane meets a beck it gets a flat plank bridge; where it crosses
// the line, a plank level-crossing. The track DRAPES on the real voxel surface
// (surfaceHeight) so it hugs the moor instead of clipping through the hills.
import * as THREE from 'three';
import { surfaceHeight } from './roster.js';

const WINDOW = 220;        // chainage either side o' t' player kept dressed (lanes are shorter than lines)
const REBUILD_MOVE = 80;   // rebuild when t' player's drifted this far
const TRACK_W = 1.25;      // half-width o' the lane ribbon — a ~2.5-block packed-earth track
const BRIDGE_W = 1.25;     // half-width o' a plank bridge deck (~2.5 wide, bank to bank)
const CROSS_W = 1.6;       // half-width o' a plank level-crossing (a touch wider than the four-foot)

export class RoadLayer {
  constructor(scene, world, geo) {
    this.scene = scene;
    this.world = world;          // chunk world — surfaceHeight needs it for the REAL (built/raised) surface
    this.geo = geo;
    this.meshes = [];
    this.timer = 0;
    this.lastPos = null;
    this.earthMat = new THREE.MeshLambertMaterial({ color: 0x6e5a3e });  // packed-earth lane
    this.plankMat = new THREE.MeshLambertMaterial({ color: 0x8a6a44 });  // oak planking (bridges + crossings)
    this.railMat = new THREE.MeshLambertMaterial({ color: 0x5a4632 });   // slim bridge handrail
    this.railGeom = new THREE.BoxGeometry(0.08, 0.1, 1);
  }

  // nearest chainage on a given path to a point — coarse stride scan, only for t' window
  nearestSOn(path, px, pz) {
    const pts = path.pts;
    let best = 0, bd = Infinity;
    for (let i = 0; i < pts.length; i += 4) {
      const d = Math.hypot(pts[i].x - px, pts[i].z - pz);
      if (d < bd) { bd = d; best = i; }
    }
    return { s: pts[best].s, d: bd };
  }

  // is chainage s inside any bridge span on this edge? (its deck is already the flat plank)
  onBridge(edge, s) {
    for (const b of edge.bridges) if (s >= b.s0 - 0.01 && s <= b.s1 + 0.01) return true;
    return false;
  }

  update(dt, playerPos) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.5;
    // dress every lane near the player; rebuild only when she's drifted far enough
    if (this.lastPos && Math.hypot(playerPos.x - this.lastPos.x, playerPos.z - this.lastPos.z) < REBUILD_MOVE && this.meshes.length) return;
    this.clear();
    let any = false;
    for (const edge of this.geo.roadPaths()) {
      const near = this.nearestSOn(edge.path, playerPos.x, playerPos.z);
      if (near.d <= 300) { this.build(edge, near.s); any = true; }
    }
    this.lastPos = any ? { x: playerPos.x, z: playerPos.z } : null;
  }

  build(edge, centerS) {
    const path = edge.path, pts = path.pts;
    const s0 = Math.max(0, centerS - WINDOW), s1 = Math.min(path.length, centerS + WINDOW);
    let i0 = 0; while (i0 < pts.length - 1 && pts[i0].s < s0) i0++;
    let i1 = i0; while (i1 < pts.length - 1 && pts[i1].s < s1) i1++;
    if (i1 - i0 < 2) return;

    // --- the packed-earth track: a continuous ribbon swept along the alignment, each edge
    //     vertex sat on the REAL voxel surface so the lane drapes over the ground (never the
    //     DEM, which is blind to embankments/built ground and would sink the track into hills).
    //     Bridge spans are skipped here — the plank deck below covers them at the flat level.
    {
      const pos = [];
      const vert = p => pos.push(p[0], p[1], p[2]);
      const Y = 0.06;   // a whisker proud o' the surface so the ribbon never z-fights the ground
      for (let i = i0; i < i1; i++) {
        const a = pts[i], b = pts[i + 1];
        if (this.onBridge(edge, (a.s + b.s) / 2)) continue;  // planks cover the beck, not earth
        const ds = Math.max(b.s - a.s, 0.001);
        const nx = (b.z - a.z) / ds, nz = -(b.x - a.x) / ds;   // unit perpendicular in plan
        const ay = surfaceHeight(this.world, this.geo, a.x, a.z) + Y;
        const by = surfaceHeight(this.world, this.geo, b.x, b.z) + Y;
        const aL = [a.x + nx * TRACK_W, ay, a.z + nz * TRACK_W], aR = [a.x - nx * TRACK_W, ay, a.z - nz * TRACK_W];
        const bL = [b.x + nx * TRACK_W, by, b.z + nz * TRACK_W], bR = [b.x - nx * TRACK_W, by, b.z - nz * TRACK_W];
        vert(aL); vert(bL); vert(bR);
        vert(aL); vert(bR); vert(aR);
      }
      if (pos.length) this._addRibbon(pos, this.earthMat);
    }

    // --- plank bridges: a flat plank deck across each beck span, sat at the span's flat plank
    //     `deck` (roadpath flattened pts.deck within [s0,s1]), bank to bank, with two slim
    //     handrail lines either side so she reads as a footbridge, not a slab.
    for (const span of edge.bridges) {
      // gather the samples inside the span (inclusive of the flanking bank points for a clean join)
      let j0 = 0; while (j0 < pts.length - 1 && pts[j0].s < span.s0) j0++;
      let j1 = j0; while (j1 < pts.length - 1 && pts[j1].s < span.s1) j1++;
      j0 = Math.max(0, j0 - 1); j1 = Math.min(pts.length - 1, j1 + 1);
      if (j1 - j0 < 1) continue;
      const pos = [];
      const vert = p => pos.push(p[0], p[1], p[2]);
      const railL = [], railR = [];
      for (let i = j0; i < j1; i++) {
        const a = pts[i], b = pts[i + 1];
        const ds = Math.max(b.s - a.s, 0.001);
        const nx = (b.z - a.z) / ds, nz = -(b.x - a.x) / ds;
        const ay = a.deck + 1.04, by = b.deck + 1.04;   // plank top a block proud o' the flattened deck floor
        const aL = [a.x + nx * BRIDGE_W, ay, a.z + nz * BRIDGE_W], aR = [a.x - nx * BRIDGE_W, ay, a.z - nz * BRIDGE_W];
        const bL = [b.x + nx * BRIDGE_W, by, b.z + nz * BRIDGE_W], bR = [b.x - nx * BRIDGE_W, by, b.z - nz * BRIDGE_W];
        vert(aL); vert(bL); vert(bR);
        vert(aL); vert(bR); vert(aR);
        railL.push({ x: a.x + nx * BRIDGE_W, y: ay, z: a.z + nz * BRIDGE_W, b: { x: b.x + nx * BRIDGE_W, y: by, z: b.z + nz * BRIDGE_W } });
        railR.push({ x: a.x - nx * BRIDGE_W, y: ay, z: a.z - nz * BRIDGE_W, b: { x: b.x - nx * BRIDGE_W, y: by, z: b.z - nz * BRIDGE_W } });
      }
      if (pos.length) this._addRibbon(pos, this.plankMat);
      this._addHandrails([...railL, ...railR]);
    }

    // --- level crossings: a single plank plane laid across the rail at the RAIL deck height
    //     (sampled off the line, not the lane), so road and rail meet flush.
    for (const cr of edge.crossings) {
      const rp = this._railDeckAt(cr.s, pts);
      if (!rp) continue;
      // orient the plank to the LANE's heading at this chainage so it spans across the rails
      const sp = this.geo.samplePosOn(path, cr.s);   // {x,z,tx,tz,deck}
      const tx = sp.tx, tz = sp.tz;                  // unit tangent o' the lane
      const nx = -tz, nz = tx;                       // perpendicular (across the lane = along nowt useful)
      const y = rp.deck + 1.04;
      const half = 2.2;   // span the crossing a couple o' blocks along the lane so it covers both rails + cess
      const aX = sp.x - tx * half, aZ = sp.z - tz * half;
      const bX = sp.x + tx * half, bZ = sp.z + tz * half;
      const aL = [aX + nx * CROSS_W, y, aZ + nz * CROSS_W], aR = [aX - nx * CROSS_W, y, aZ - nz * CROSS_W];
      const bL = [bX + nx * CROSS_W, y, bZ + nz * CROSS_W], bR = [bX - nx * CROSS_W, y, bZ - nz * CROSS_W];
      const pos = [];
      const vert = p => pos.push(p[0], p[1], p[2]);
      vert(aL); vert(bL); vert(bR);
      vert(aL); vert(bR); vert(aR);
      this._addRibbon(pos, this.plankMat);
    }
  }

  // rail deck under the lane at chainage s — the road crosses the line here, so the plank
  // sits at the LINE's deck. Scans every line for the one nearest the lane column.
  _railDeckAt(s, pts) {
    let lo = 0; while (lo < pts.length - 1 && pts[lo].s < s) lo++;
    const p = pts[Math.min(lo, pts.length - 1)];
    if (typeof this.geo.railPaths !== 'function') return null;
    let best = null;
    for (const { path } of this.geo.railPaths()) {
      const info = nearestOnPath(path, p.x, p.z);   // railInfo is single-path; scan every line directly
      if (info && (!best || info.d < best.d)) best = info;
    }
    return best;
  }

  _addRibbon(pos, mat) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geom.computeVertexNormals();
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.ownGeometry = true;
    this.scene.add(mesh);
    this.meshes.push(mesh);
  }

  // two slim handrail lines from a list of {x,y,z,b:{x,y,z}} segment ends, raised a touch
  _addHandrails(segs) {
    if (!segs.length) return;
    const rails = new THREE.InstancedMesh(this.railGeom, this.railMat, segs.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ');
    const HAND = 0.5;   // handrail height above the deck
    let n = 0;
    for (const s of segs) {
      const dx = s.b.x - s.x, dy = s.b.y - s.y, dz = s.b.z - s.z;
      const len = Math.hypot(dx, dy, dz) + 0.04;
      const yaw = Math.atan2(dx, dz), pitch = -Math.atan2(dy, Math.hypot(dx, dz) || 0.001);
      e.set(pitch, yaw, 0); q.setFromEuler(e);
      m.compose(
        new THREE.Vector3((s.x + s.b.x) / 2, (s.y + s.b.y) / 2 + HAND, (s.z + s.b.z) / 2),
        q, new THREE.Vector3(1, 1, len));
      rails.setMatrixAt(n++, m);
    }
    rails.count = n;
    rails.instanceMatrix.needsUpdate = true;
    this.scene.add(rails);
    this.meshes.push(rails);
  }

  clear() {
    for (const mesh of this.meshes) {
      this.scene.remove(mesh);
      if (mesh.userData.ownGeometry) mesh.geometry.dispose();
      else if (mesh.dispose) mesh.dispose();
    }
    this.meshes = [];
    this.lastPos = null;
  }

  dispose() {
    this.clear();
    this.earthMat.dispose();
    this.plankMat.dispose();
    this.railMat.dispose();
    this.railGeom.dispose();
  }
}

// nearest point on a single rail path to (x,z): {x,z,deck,d} | null — a coarse stride scan,
// only used to find the deck height for a level crossing (not a hot path).
function nearestOnPath(path, x, z) {
  const pts = path.pts;
  let best = null;
  for (let i = 0; i < pts.length - 1; i += 2) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const L2 = dx * dx + dz * dz || 0.001;
    let t = ((x - a.x) * dx + (z - a.z) * dz) / L2;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + dx * t, pz = a.z + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (!best || d < best.d) best = { x: px, z: pz, deck: a.deck + (b.deck - a.deck) * t, d };
  }
  return best;
}
