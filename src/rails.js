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
    this.skirtMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.ballastMat = new THREE.MeshLambertMaterial({ color: 0x6b6258 }); // smooth trackbed crown
    this.fenceMat = new THREE.MeshLambertMaterial({ color: 0x6b5a44 });    // timber lineside fence
    this.postGeom = new THREE.BoxGeometry(0.12, 0.72, 0.12);              // a fence post, under a block high
    this.fenceRailGeom = new THREE.BoxGeometry(0.06, 0.1, 1);
    this.bridgeMat = new THREE.MeshLambertMaterial({ vertexColors: true }); // stone overbridge (coursed, vertex-shaded)
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

    // smooth ballast crown — a continuous trackbed ribbon swept along t' spline,
    // laid OWER t' stepped voxel ballast so t' line reads smooth, not blocky
    {
      const pos = [], W = 2.3, Y = 1.05;
      const vert = p => pos.push(p[0], p[1], p[2]);
      for (let i = i0; i < i1; i++) {
        const a = pts[i], b = pts[i + 1];
        const ds = Math.max(b.s - a.s, 0.001);
        const nx = (b.z - a.z) / ds, nz = -(b.x - a.x) / ds; // unit perpendicular
        const aL = [a.x + nx * W, a.deck + Y, a.z + nz * W], aR = [a.x - nx * W, a.deck + Y, a.z - nz * W];
        const bL = [b.x + nx * W, b.deck + Y, b.z + nz * W], bR = [b.x - nx * W, b.deck + Y, b.z - nz * W];
        vert(aL); vert(bL); vert(bR);
        vert(aL); vert(bR); vert(aR);
      }
      if (pos.length) {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geom.computeVertexNormals();
        const crown = new THREE.Mesh(geom, this.ballastMat);
        crown.userData.ownGeometry = true;
        this.scene.add(crown);
        this.meshes.push(crown);
      }
    }

    // earthwork skirts: smooth banks frae t' ballast edge down to t' land
    // (embankments), or rock faces up to t' lip (cuttings) — no stepped cubes
    {
      const pos = [], col = [];
      const earth = [0.38, 0.34, 0.26], stone = [0.42, 0.42, 0.40];
      const vert = (p, c) => { pos.push(p[0], p[1], p[2]); col.push(c[0], c[1], c[2]); };
      const edgePoint = (pt, nx, nz, side) => {
        const topX = pt.x + nx * side * 2.3, topZ = pt.z + nz * side * 2.3;
        const topY = pt.deck + 0.95;
        const gh = this.geo.height(Math.round(topX + nx * side * 2), Math.round(topZ + nz * side * 2)) + 1.02;
        const dh = topY - gh;
        if (Math.abs(dh) < 0.9) return null;
        const run = Math.min(10, Math.abs(dh)); // ~45 degrees, capped
        return {
          top: [topX, topY, topZ],
          foot: [topX + nx * side * run, gh, topZ + nz * side * run],
          c: dh > 0 ? earth : stone,
        };
      };
      for (let i = i0; i < i1; i++) {
        const a = pts[i], b = pts[i + 1];
        const ds = Math.max(b.s - a.s, 0.001);
        const nx = (b.z - a.z) / ds, nz = -(b.x - a.x) / ds; // unit-ish perp
        for (const side of [-1, 1]) {
          const ea = edgePoint(a, nx, nz, side), eb = edgePoint(b, nx, nz, side);
          if (!ea || !eb) continue;
          // two triangles: top-a, top-b, foot-b / top-a, foot-b, foot-a
          vert(ea.top, ea.c); vert(eb.top, eb.c); vert(eb.foot, eb.c);
          vert(ea.top, ea.c); vert(eb.foot, eb.c); vert(ea.foot, ea.c);
        }
      }
      if (pos.length) {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geom.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        geom.computeVertexNormals();
        const skirt = new THREE.Mesh(geom, this.skirtMat);
        skirt.userData.ownGeometry = true;
        this.scene.add(skirt);
        this.meshes.push(skirt);
      }
    }

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

    // --- lineside fencing: a low post-an'-rail fence either side, kept under a block
    //     high so she reads as a fence (not a tunnel) an' keeps folk an' beasts off t' line ---
    {
      const FOFF = 2.55, FH = 0.72, EVERY = 3.0, idq = new THREE.Quaternion();
      const nP = Math.floor((s1 - s0) / EVERY);
      const posts = new THREE.InstancedMesh(this.postGeom, this.fenceMat, Math.max(1, nP * 2));
      const frails = new THREE.InstancedMesh(this.fenceRailGeom, this.fenceMat, seg * 2);
      let pi = 0, fri = 0;
      for (let k = 0; k < nP; k++) {
        const sp = this.geo.samplePos(s0 + k * EVERY);
        for (const side of [-1, 1]) {
          m.compose(new THREE.Vector3(sp.x + sp.tz * side * FOFF, sp.deck + 1.0 + FH / 2, sp.z - sp.tx * side * FOFF), idq, new THREE.Vector3(1, 1, 1));
          posts.setMatrixAt(pi++, m);
        }
      }
      for (let i = i0; i < i1; i++) {
        const a = pts[i], b = pts[i + 1];
        const ds = Math.max(b.s - a.s, 0.001);
        const tx = (b.x - a.x) / ds, tz = (b.z - a.z) / ds;
        e.set(0, Math.atan2(b.x - a.x, b.z - a.z), 0); q.setFromEuler(e);
        const segLen = Math.hypot(b.x - a.x, b.z - a.z) + 0.06;
        for (const side of [-1, 1]) {
          m.compose(new THREE.Vector3((a.x + b.x) / 2 + tz * side * FOFF, (a.deck + b.deck) / 2 + 1.0 + FH - 0.06, (a.z + b.z) / 2 - tx * side * FOFF), q, new THREE.Vector3(1, 1, segLen));
          frails.setMatrixAt(fri++, m);
        }
      }
      posts.count = pi; posts.instanceMatrix.needsUpdate = true; this.scene.add(posts); this.meshes.push(posts);
      frails.count = fri; frails.instanceMatrix.needsUpdate = true; this.scene.add(frails); this.meshes.push(frails);
    }

    // --- stone overbridges (as on t' real NYMR): a coursed-stone ARCH carried ower
    //     t' line — solid abutments, a stepped arch ring, spandrel walls, a road
    //     deck an' parapets; t' train runs through t' arched portal beneath ---
    {
      const bpos = [], bcol = [];
      // deterministic coursing: jitter a base stone colour per block so she reads
      // as weathered masonry, not a flat grey slab
      const shade = (base, seed) => {
        const f = Math.sin(seed * 12.9898) * 43758.5453; const j = f - Math.floor(f);
        const m = 0.84 + j * 0.30; return [base[0] * m, base[1] * m, base[2] * m];
      };
      const pushBox = (cx, cy, cz, w, h, d, yaw, col) => {
        const hx = w / 2, hy = h / 2, hz = d / 2, c = Math.cos(yaw), s = Math.sin(yaw);
        const C = (sx, sy, sz) => { const lx = sx * hx, lz = sz * hz; return [cx + lx * c + lz * s, cy + sy * hy, cz - lx * s + lz * c]; };
        const v = [C(-1,-1,-1), C(1,-1,-1), C(1,1,-1), C(-1,1,-1), C(-1,-1,1), C(1,-1,1), C(1,1,1), C(-1,1,1)];
        const F = [[0,1,2,3], [5,4,7,6], [4,0,3,7], [1,5,6,2], [3,2,6,7], [0,4,5,1]];
        for (const f of F) { const [a, b, cc, dd] = f; bpos.push(...v[a], ...v[b], ...v[cc], ...v[a], ...v[cc], ...v[dd]); }
        for (let k = 0; k < 36; k++) bcol.push(col[0], col[1], col[2]);
      };
      const STONE = [0.56, 0.50, 0.41], SPAN = [0.60, 0.55, 0.46], ROAD = [0.45, 0.41, 0.35];
      const SP = 230, clearW = 3.0, clearH = 4.4, R = 3.0, PIER = 2.4, DEPTH = 4.2, SINK = 3.5;
      for (let bk = Math.floor(s0 / SP); bk <= Math.ceil(s1 / SP); bk++) {
        const h = ((bk * 2654435761) >>> 0) / 4294967296;
        if (h > 0.6) continue;                                   // a stone bridge ower t' line every third o' a mile or so
        const sb = bk * SP + (h - 0.275) * 130;                  // jittered along t' line
        if (sb < s0 + 10 || sb > s1 - 10) continue;
        const sp = this.geo.samplePos(sb);
        if (this.geo.coastT && this.geo.coastT(sp.x, sp.z) > 0.05) continue; // not out ower t' sands
        const yaw = Math.atan2(sp.tx, sp.tz);
        const px = sp.tz, pz = -sp.tx;                           // unit perpendicular (across t' line)
        const base = sp.deck + 1.0;
        const springY = base + clearH, crownY = springY + R, deckY = crownY + 0.5;
        // a box spanning perp u0..u1 an' height y0..y1, full depth along t' line
        const slab = (u0, u1, y0, y1, col, seed) => {
          const uc = (u0 + u1) / 2, yc = (y0 + y1) / 2;
          pushBox(sp.x + px * uc, yc, sp.z + pz * uc, Math.abs(u1 - u0), Math.abs(y1 - y0), DEPTH, yaw, shade(col, seed));
        };
        // 1) abutment piers, grounded into t' banking, up to t' springline
        slab(-(clearW + PIER), -clearW, base - SINK, springY, STONE, sb + 1);
        slab(clearW, clearW + PIER, base - SINK, springY, STONE, sb + 2);
        // 2) stepped arch ring round t' portal
        const N = 13;
        for (let k = 0; k <= N; k++) {
          const a = Math.PI * k / N, u = R * Math.cos(a), y = springY + R * Math.sin(a);
          pushBox(sp.x + px * u, y, sp.z + pz * u, 1.5, 1.5, DEPTH, yaw, shade(STONE, sb + 10 + k));
        }
        // 3) spandrel walls — fill frae t' arch extrados up to t' deck
        for (let u = -R; u <= R + 0.01; u += 0.7) {
          const y0 = springY + Math.sqrt(Math.max(0, R * R - u * u));
          if (y0 < deckY) slab(u - 0.4, u + 0.4, y0, deckY + 0.02, SPAN, sb + 40 + u);
        }
        // 4) road deck across t' top, an' 5) parapets down each side o' t' road
        const HW = clearW + PIER + 0.3;
        slab(-HW, HW, deckY, deckY + 1.0, ROAD, sb + 70);
        for (const o of [-1, 1]) {
          const off = o * (DEPTH / 2 - 0.25);
          pushBox(sp.x + sp.tx * off, deckY + 1.0 + 0.55, sp.z + sp.tz * off, HW * 2, 1.1, 0.45, yaw, shade(STONE, sb + 80 + o));
        }
      }
      if (bpos.length) {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(bpos, 3));
        geom.setAttribute('color', new THREE.Float32BufferAttribute(bcol, 3));
        geom.computeVertexNormals();
        const bridges = new THREE.Mesh(geom, this.bridgeMat);
        bridges.userData.ownGeometry = true;
        this.scene.add(bridges); this.meshes.push(bridges);
      }
    }
  }

  clear() {
    for (const mesh of this.meshes) {
      this.scene.remove(mesh);
      if (mesh.userData.ownGeometry) mesh.geometry.dispose();
      else if (mesh.dispose) mesh.dispose();
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
    this.skirtMat.dispose();
    this.ballastMat.dispose();
    this.fenceMat.dispose();
    this.postGeom.dispose();
    this.fenceRailGeom.dispose();
    this.bridgeMat.dispose();
  }
}
