// T' permanent way made visible: steel rails an' oak sleepers swept along
// t' line's spline as real geometry (instanced), dressed in a window round
// t' player an' struck when tha's far frae t' line. Smooth curves, smooth
// gradients — nowt blocky about her.
//
// T' earthworks (ballast crown + embankment/cutting skirts) are dressed in t'
// TERRAIN ATLAS — grass-sided banks (t' same GRASS_TOP tile + topFaceVariation
// tint as t' moor itsen), gravel ballast on t' crest, stone up t' cutting faces —
// so t' line seats into t' hue-varied voxel ground instead o' reading as flat
// grey CAD wedges. An' where t' line CROSSES water (t' same bridgeZone/overSea
// signal worldgen.js stamps its open arches wi'), t' skirt is struck entirely:
// t' beck runs open under t' span, carried on dressed-stone masonry piers
// (voxel-course instanced boxes on t' STONEBRICK tile) down to t' bed.
import * as THREE from 'three';
import { TILE } from './defs.js';
import { tileUV } from './textures.js';
import { getMaterials, topFaceVariation } from './mesher.js';
import { hash2i } from './noise.js';

const WINDOW = 260;        // chainage either side o' t' player kept dressed
const REBUILD_MOVE = 80;   // rebuild when t' player's drifted this far along
const SLEEPER_EVERY = 1.6;
const GAUGE = 0.72;        // rail offset either side o' centre
const PIER_EVERY = 6;      // masonry pier cadence under a bridge span (worldgen's sea-viaduct rhythm)

// t' four tile rotations (mesher's UV_ROT idiom) — breaks t' repeat on banded earthworks
const UV_ROT4 = [
  (u, v) => [u, v],
  (u, v) => [v, 1 - u],
  (u, v) => [1 - u, 1 - v],
  (u, v) => [1 - v, u],
];

const lerp3 = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];

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
    // ONE material for all t' earthworks (crown, skirts, piers): t' live terrain atlas
    // (season retints flow through — it's t' same texture object mesher's opaque pass
    // holds) modulated by vertex colour. Headless (verify under Node) initMaterials
    // hasn't run, so t' map is null an' t' material simply carries vertex colours —
    // geometry an' attributes are identical either way. DoubleSide: t' skirt ribbon's
    // winding mirrors wi' t' side o' t' line, an' banks read frae both banks.
    const mats = getMaterials();
    this.earthMat = new THREE.MeshLambertMaterial({
      map: mats ? mats.opaque.map : null, vertexColors: true, side: THREE.DoubleSide,
    });
    this.fenceMat = new THREE.MeshLambertMaterial({ color: 0x6b5a44 });    // timber lineside fence
    this.postGeom = new THREE.BoxGeometry(0.12, 0.72, 0.12);              // a fence post, under a block high
    this.fenceRailGeom = new THREE.BoxGeometry(0.06, 0.1, 1);
    // one dressed-stone course for t' bridge piers: box UVs remapped onto t' atlas's
    // STONEBRICK tile so every course reads as a block o' t' same masonry worldgen
    // stamps for t' abutments; a flat colour attribute (earthMat wants one) sits it
    // a touch into t' shade under t' deck
    this.pierGeom = new THREE.BoxGeometry(1.06, 1, 1.3);
    {
      const [u0, v0, u1, v1] = tileUV(TILE.STONEBRICK);
      const uv = this.pierGeom.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
      const c = new Float32Array(this.pierGeom.attributes.position.count * 3).fill(0.85);
      this.pierGeom.setAttribute('color', new THREE.BufferAttribute(c, 3));
    }
  }

  // Is this column part o' a water crossing? T' EXACT signal worldgen.js stampRail
  // uses for its open arches: bridgeZone = nearRiver(pad 3) an' overSea = coastT>0.5,
  // real-Moors world only — so t' overlay an' t' stamped blocks always agree on where
  // t' bridge is (no skirt walling a channel t' blocks left open).
  crossingAt(x, z) {
    const g = this.geo;
    if (!g.realWorld) return false;
    const rx = Math.round(x), rz = Math.round(z);
    if (g.nearRiver && g.nearRiver(rx, rz, 3)) return true;
    if (g.coastT && g.coastT(rx, rz) > 0.5) return true;
    return false;
  }

  // nearest chainage on a given path to a point — coarse stride scan, it's only for t' window
  nearestSOn(path, px, pz) {
    const pts = path.pts;
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
    // dress every line near the player; rebuild only when she's drifted far enough
    if (this.lastPos && Math.hypot(playerPos.x - this.lastPos.x, playerPos.z - this.lastPos.z) < REBUILD_MOVE && this.meshes.length) return;
    this.clear();
    let any = false;
    for (const { path } of this.geo.railPaths()) {
      const near = this.nearestSOn(path, playerPos.x, playerPos.z);
      if (near.d <= 320) { this.build(path, near.s); any = true; }
    }
    this.lastPos = any ? { x: playerPos.x, z: playerPos.z } : null;
  }

  build(path, centerS) {
    const pts = path.pts;
    const s0 = Math.max(0, centerS - WINDOW), s1 = Math.min(path.length, centerS + WINDOW);
    // gather t' samples in window
    let i0 = 0; while (i0 < pts.length - 1 && pts[i0].s < s0) i0++;
    let i1 = i0; while (i1 < pts.length - 1 && pts[i1].s < s1) i1++;
    if (i1 - i0 < 2) return;

    const seg = i1 - i0;
    const rails = new THREE.InstancedMesh(this.railGeom, this.railMat, seg * 2);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ');
    const one = new THREE.Vector3(1, 1, 1);
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
    rails.userData.kind = 'rails';
    this.scene.add(rails);
    this.meshes.push(rails);

    // smooth ballast crown — a continuous trackbed ribbon swept along t' spline,
    // laid OWER t' stepped voxel ballast so t' line reads smooth, not blocky.
    // Dressed in t' atlas GRAVEL tile, banded across (~a block a band, so texel
    // density matches t' ground) wi' a seeded per-column tint — loose stone, not paint.
    {
      const pos = [], col = [], uv = [];
      const W = 2.3, Y = 1.05, BANDS = 4;
      const [cu0, cv0, cu1, cv1] = tileUV(TILE.GRAVEL);
      const vert = (p, c, u, v) => { pos.push(p[0], p[1], p[2]); col.push(c[0], c[1], c[2]); uv.push(u, v); };
      const bTint = (x, z) => { const j = 0.9 + hash2i(Math.round(x), Math.round(z), 11) * 0.16; return [j, j * 0.99, j * 0.96]; };
      for (let i = i0; i < i1; i++) {
        const a = pts[i], b = pts[i + 1];
        const ds = Math.max(b.s - a.s, 0.001);
        const nx = (b.z - a.z) / ds, nz = -(b.x - a.x) / ds; // unit perpendicular
        for (let k = 0; k < BANDS; k++) {
          const w0 = -W + (2 * W * k) / BANDS, w1 = -W + (2 * W * (k + 1)) / BANDS;
          const a0 = [a.x + nx * w0, a.deck + Y, a.z + nz * w0], a1 = [a.x + nx * w1, a.deck + Y, a.z + nz * w1];
          const b0 = [b.x + nx * w0, b.deck + Y, b.z + nz * w0], b1 = [b.x + nx * w1, b.deck + Y, b.z + nz * w1];
          // rotation keyed frae WORLD coords (path samples are fixed by t' route),
          // so t' dressing is identical on every client an' every rebuild
          const rot = (hash2i(Math.round(a.x * 2) + k * 53, Math.round(a.z * 2) - k * 19, 31) * 4) | 0;
          const uvOf = (uF, vF) => { const r = UV_ROT4[rot](uF, vF); return [cu0 + (cu1 - cu0) * r[0], cv0 + (cv1 - cv0) * r[1]]; };
          const ca0 = bTint(a0[0], a0[2]), ca1 = bTint(a1[0], a1[2]), cb0 = bTint(b0[0], b0[2]), cb1 = bTint(b1[0], b1[2]);
          const u00 = uvOf(0, 0), u10 = uvOf(1, 0), u11 = uvOf(1, 1), u01 = uvOf(0, 1);
          vert(a0, ca0, ...u00); vert(b0, cb0, ...u10); vert(b1, cb1, ...u11);
          vert(a0, ca0, ...u00); vert(b1, cb1, ...u11); vert(a1, ca1, ...u01);
        }
      }
      if (pos.length) {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geom.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        geom.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geom.computeVertexNormals();
        const crown = new THREE.Mesh(geom, this.earthMat);
        crown.userData.ownGeometry = true;
        crown.userData.kind = 'crown';
        this.scene.add(crown);
        this.meshes.push(crown);
      }
    }

    // earthwork skirts: banks frae t' ballast edge down to t' land (embankments),
    // or rock faces up to t' lip (cuttings) — no stepped cubes. GRASS-SIDED now:
    // banded ~a block a course onto t' GRASS_TOP tile wi' t' terrain's own
    // topFaceVariation tint (so t' bank matches t' moor's hue drift), darkened
    // toward t' foot so it seats into t' ground; cuttings take t' STONE tile.
    // An' where t' line crosses water — worldgen's bridgeZone/overSea signal —
    // t' skirt is STRUCK: no grey wall damming t' beck, t' span stays open.
    {
      const pos = [], col = [], uv = [], nor = [];
      const gRect = tileUV(TILE.GRASS_TOP), sRect = tileUV(TILE.STONE);
      let qn = [0, 1, 0];   // current quad's analytic normal (set per band, shared by its two tris)
      const vert = (p, c, u, v) => { pos.push(p[0], p[1], p[2]); col.push(c[0], c[1], c[2]); uv.push(u, v); nor.push(qn[0], qn[1], qn[2]); };
      const tintAt = (p, t, cutting) => {
        const rx = Math.round(p[0]), rz = Math.round(p[2]);
        const seat = 1 - 0.26 * t;                     // darker toward t' foot — seats t' bank in
        if (cutting) { const j = (0.82 + hash2i(rx, rz, 5) * 0.18) * seat; return [j, j, j * 0.97]; }
        const v = topFaceVariation(rx, rz);            // t' moor's own hue drift
        return [v.r * seat, v.g * seat, v.b * seat];
      };
      // T' skirt is built frae a per-sample EDGE LINE, wi' t' probed ground SMOOTHED
      // along t' ribbon (railpath's own deck-smoothing idiom). T' raw probe rounds to
      // a single column 2 blocks out, so on diagonals it staggers step to step an' t'
      // foot line used to fold an' tear — dark pockets along t' crest. Two ±1-sample
      // passes read as one continuous engineered bank instead.
      for (const side of [-1, 1]) {
        const tops = [], ghs = [], perps = [];
        for (let i = i0; i <= i1; i++) {
          const pPrev = pts[Math.max(0, i - 1)], pNext = pts[Math.min(pts.length - 1, i + 1)];
          const dx = pNext.x - pPrev.x, dz = pNext.z - pPrev.z, L = Math.hypot(dx, dz) || 1;
          perps.push([dz / L, -dx / L]);                         // unit perp at THIS sample
        }
        // smooth t' perpendicular along t' window: t' polyline direction steps at
        // every vertex, an' a kink whips t' 2.3-out crest edge sideways in one
        // sample — t' strip twisted past vertical (a folded dark triangle at t'
        // crest). Averaged an' renormalised, t' edge glides round curves.
        for (let pass = 0; pass < 2; pass++) {
          const sm = perps.map(p => p.slice());
          for (let k = 1; k < perps.length - 1; k++) {
            sm[k][0] = (perps[k - 1][0] + 2 * perps[k][0] + perps[k + 1][0]) / 4;
            sm[k][1] = (perps[k - 1][1] + 2 * perps[k][1] + perps[k + 1][1]) / 4;
          }
          for (let k = 0; k < perps.length; k++) {
            const L = Math.hypot(sm[k][0], sm[k][1]) || 1;
            perps[k][0] = sm[k][0] / L; perps[k][1] = sm[k][1] / L;
          }
        }
        for (let i = i0; i <= i1; i++) {
          const k = i - i0, p = pts[i];
          const nx = perps[k][0], nz = perps[k][1];
          const tx = p.x + nx * side * 2.3, tz = p.z + nz * side * 2.3;
          tops.push([tx, p.deck + 0.95, tz]);
          ghs.push(this.geo.height(Math.round(tx + nx * side * 2), Math.round(tz + nz * side * 2)) + 1.02);
        }
        for (let pass = 0; pass < 3; pass++) {
          const sm = ghs.slice();
          for (let k = 1; k < ghs.length - 1; k++) sm[k] = (ghs[k - 1] + 2 * ghs[k] + ghs[k + 1]) / 4;
          for (let k = 0; k < ghs.length; k++) ghs[k] = sm[k];
        }
        // hem line: how far out t' bank runs at each sample (~45 degrees, capped),
        // run past t' probed ground so t' foot can SINK 0.75 below it — t' smoothed
        // line can ride above t' true voxel surface in dips, an' a floating hem
        // reads as a shadowed tear; buried, t' bank always seats into t' moor.
        // T' hem may only RETREAT at ≤0.5 blocks per block o' chainage (forward an'
        // back, railpath's gradient-clamp idiom): where a bank ends sharply t' strip
        // used to twist past vertical in one step — a folded-over dark triangle.
        const runs = [];
        for (let k = 0; k < tops.length; k++) runs.push(Math.min(11, Math.abs(tops[k][1] - ghs[k]) + 1.2));
        for (let k = 1; k < runs.length; k++) {
          const ds = pts[i0 + k].s - pts[i0 + k - 1].s;
          runs[k] = Math.max(runs[k], runs[k - 1] - 0.5 * ds);
        }
        for (let k = runs.length - 2; k >= 0; k--) {
          const ds = pts[i0 + k + 1].s - pts[i0 + k].s;
          runs[k] = Math.max(runs[k], runs[k + 1] - 0.5 * ds);
        }
        // formation BENCH: a 0.85-block flat berm at crest height afore t' 45° descent.
        // Worldgen's stamped shoulder (an' natural crest undulation) can stand a
        // half-block proud just outside t' 2.3 line — block sides used to poke
        // through t' descending face as dark notches. T' bench roofs them ower.
        const BENCH = 0.85;
        const edgeAt = (k) => {
          const dh = tops[k][1] - ghs[k];
          const run = runs[k];
          const bx = tops[k][0] + perps[k][0] * side * BENCH, bz = tops[k][2] + perps[k][1] * side * BENCH;
          return {
            top: tops[k],
            bench: [bx, tops[k][1], bz],
            foot: [bx + perps[k][0] * side * run, ghs[k] - 0.75, bz + perps[k][1] * side * run],
            dh,
          };
        };
        for (let i = i0; i < i1; i++) {
          const k = i - i0;
          const a = pts[i], b = pts[i + 1];
          const ea = edgeAt(k), eb = edgeAt(k + 1);
          if (Math.abs(ea.dh) < 0.15 && Math.abs(eb.dh) < 0.15) continue;   // truly at grade — nowt to dress
          // bridge span: strike t' skirt where t' centreline OR t' skirt foot stands
          // in t' crossing zone — t' water (or t' stamped abutment stone) shows through
          if (this.crossingAt(a.x, a.z) || this.crossingAt(b.x, b.z)
            || this.crossingAt(ea.foot[0], ea.foot[2]) || this.crossingAt(eb.foot[0], eb.foot[2])) continue;
          const cutting = (Math.abs(ea.dh) >= Math.abs(eb.dh) ? ea.dh : eb.dh) < 0;
          const rect = cutting ? sRect : gRect;
          const bands = Math.max(1, Math.min(10, Math.ceil(Math.max(Math.abs(ea.dh), Math.abs(eb.dh)))));
          // ONE analytic outward normal per skirt strip: t' banded ruled quads are
          // subtly twisted, an' computeVertexNormals gave each triangle its own facet
          // — an alternating dark sawtooth along t' crest. T' cross o' t' along-track
          // tangent an' t' mean downslope reads as one smooth bank instead.
          const Tv = [b.x - a.x, b.deck - a.deck, b.z - a.z];
          const qnOf = (Dv) => {
            const cx = side > 0 ? Tv[1] * Dv[2] - Tv[2] * Dv[1] : Dv[1] * Tv[2] - Dv[2] * Tv[1];
            const cy = side > 0 ? Tv[2] * Dv[0] - Tv[0] * Dv[2] : Dv[2] * Tv[0] - Dv[0] * Tv[2];
            const cz = side > 0 ? Tv[0] * Dv[1] - Tv[1] * Dv[0] : Dv[0] * Tv[1] - Dv[1] * Tv[0];
            const cl = Math.hypot(cx, cy, cz) || 1;
            return [cx / cl, cy / cl, cz / cl];
          };
          // t' bench berm first (flat, crest height, grass even by cuttings — buried there)
          qn = qnOf([
            (ea.bench[0] - ea.top[0] + eb.bench[0] - eb.top[0]) / 2, 0,
            (ea.bench[2] - ea.top[2] + eb.bench[2] - eb.top[2]) / 2,
          ]);
          {
            const ca = tintAt(ea.top, 0, false), cb = tintAt(eb.top, 0, false);
            const u0b = gRect[0], v0b = gRect[1], u1b = gRect[2], v1b = gRect[3];
            if (side > 0) {
              vert(ea.top, ca, u0b, v1b); vert(eb.top, cb, u1b, v1b); vert(eb.bench, cb, u1b, v0b);
              vert(ea.top, ca, u0b, v1b); vert(eb.bench, cb, u1b, v0b); vert(ea.bench, ca, u0b, v0b);
            } else {
              vert(eb.top, cb, u1b, v1b); vert(ea.top, ca, u0b, v1b); vert(ea.bench, ca, u0b, v0b);
              vert(eb.top, cb, u1b, v1b); vert(ea.bench, ca, u0b, v0b); vert(eb.bench, cb, u1b, v0b);
            }
          }
          qn = qnOf([
            (ea.foot[0] - ea.bench[0] + eb.foot[0] - eb.bench[0]) / 2,
            (ea.foot[1] - ea.bench[1] + eb.foot[1] - eb.bench[1]) / 2,
            (ea.foot[2] - ea.bench[2] + eb.foot[2] - eb.bench[2]) / 2,
          ]);
          for (let k = 0; k < bands; k++) {
            const t0 = k / bands, t1 = (k + 1) / bands;
            const a0 = lerp3(ea.bench, ea.foot, t0), a1 = lerp3(ea.bench, ea.foot, t1);
            const b0 = lerp3(eb.bench, eb.foot, t0), b1 = lerp3(eb.bench, eb.foot, t1);
            const rot = (hash2i(Math.round(a0[0] * 2) + k * 41, Math.round(a0[2] * 2) - k * 23, 37) * 4) | 0;
            const uvOf = (uF, vF) => { const r = UV_ROT4[rot](uF, vF); return [rect[0] + (rect[2] - rect[0]) * r[0], rect[1] + (rect[3] - rect[1]) * r[1]]; };
            const ca0 = tintAt(a0, t0, cutting), ca1 = tintAt(a1, t1, cutting);
            const cb0 = tintAt(b0, t0, cutting), cb1 = tintAt(b1, t1, cutting);
            const u00 = uvOf(0, 0), u10 = uvOf(1, 0), u11 = uvOf(1, 1), u01 = uvOf(0, 1);
            if (side > 0) {
              vert(a0, ca0, ...u00); vert(b0, cb0, ...u10); vert(b1, cb1, ...u11);
              vert(a0, ca0, ...u00); vert(b1, cb1, ...u11); vert(a1, ca1, ...u01);
            } else {           // mirrored side — flip winding so normals face out o' t' bank
              vert(b0, cb0, ...u10); vert(a0, ca0, ...u00); vert(a1, ca1, ...u01);
              vert(b0, cb0, ...u10); vert(a1, ca1, ...u01); vert(b1, cb1, ...u11);
            }
          }
        }
      }
      if (pos.length) {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geom.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        geom.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geom.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));   // analytic — see qn above
        const skirt = new THREE.Mesh(geom, this.earthMat);
        skirt.userData.ownGeometry = true;
        skirt.userData.kind = 'skirt';
        this.scene.add(skirt);
        this.meshes.push(skirt);
      }
    }

    // bridge piers: t' block world carves t' open arch an' lays t' stone deck slab
    // (worldgen stampRail), but a BECK crossing gets no stamped piers — so t' overlay
    // carries t' span down to t' bed in dressed-stone courses, three abreast, at a
    // fixed chainage cadence (multiples o' PIER_EVERY along t' route — window- an'
    // client-independent). Sea viaducts keep their STAMPED piers: nowt drawn there,
    // so t' overlay never fights t' blocks.
    {
      const spots = [];
      if (this.geo.realWorld) {
        for (let s = Math.ceil(s0 / PIER_EVERY) * PIER_EVERY; s <= s1; s += PIER_EVERY) {
          const sp = this.geo.samplePosOn(path, s);
          if (!this.crossingAt(sp.x, sp.z)) continue;
          const rx = Math.round(sp.x), rz = Math.round(sp.z);
          if (this.geo.coastT && this.geo.coastT(rx, rz) > 0.5) continue;   // sea piers are stamped blocks
          const rc = this.geo.riverColumn ? this.geo.riverColumn(rx, rz) : null;
          const base = rc ? rc.bed : this.geo.height(rx, rz);   // channel: down to t' bed; dry relief span: to t' ground
          const top = Math.floor(sp.deck) - 1;                  // flush under t' stamped deck slab (at deck-1)
          if (top - base < 3) continue;                         // squat ends are stamped abutment stone already
          spots.push({ x: sp.x, z: sp.z, tx: sp.tx, tz: sp.tz, base, top });
        }
      }
      if (spots.length) {
        let n = 0; for (const p of spots) n += (p.top - p.base) * 3;
        const piers = new THREE.InstancedMesh(this.pierGeom, this.earthMat, n);
        let pi = 0;
        for (const p of spots) {
          e.set(0, Math.atan2(p.tx, p.tz), 0); q.setFromEuler(e);
          const nx = p.tz, nz = -p.tx;                          // unit perp across t' line
          for (const off of [-1.06, 0, 1.06]) {
            for (let y = p.base; y < p.top; y++) {
              m.compose(new THREE.Vector3(p.x + nx * off, y + 0.5, p.z + nz * off), q, one);
              piers.setMatrixAt(pi++, m);
            }
          }
        }
        piers.count = pi;
        piers.instanceMatrix.needsUpdate = true;
        piers.userData.kind = 'piers';
        this.scene.add(piers);
        this.meshes.push(piers);
      }
    }

    const nSleep = Math.floor((s1 - s0) / SLEEPER_EVERY);
    const sleepers = new THREE.InstancedMesh(this.sleeperGeom, this.sleeperMat, nSleep);
    let si = 0;
    for (let k = 0; k < nSleep; k++) {
      const sp = this.geo.samplePosOn(path,s0 + k * SLEEPER_EVERY);
      e.set(-Math.atan(sp.grade), Math.atan2(sp.tx, sp.tz), 0);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(sp.x, sp.deck + 1.06, sp.z), q, new THREE.Vector3(1, 1, 1));
      sleepers.setMatrixAt(si++, m);
    }
    sleepers.count = si;
    sleepers.instanceMatrix.needsUpdate = true;
    sleepers.userData.kind = 'sleepers';
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
        const sp = this.geo.samplePosOn(path,s0 + k * EVERY);
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
      posts.count = pi; posts.instanceMatrix.needsUpdate = true; posts.userData.kind = 'posts'; this.scene.add(posts); this.meshes.push(posts);
      frails.count = fri; frails.instanceMatrix.needsUpdate = true; frails.userData.kind = 'frails'; this.scene.add(frails); this.meshes.push(frails);
    }

    // (stone overbridges are now real voxel masonry, stamped into cuttings by
    //  worldgen.stampBridges — so they're textured an' lit like t' rest o' t' world)
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
    this.earthMat.dispose();   // t' shared atlas texture belongs to mesher — Material.dispose leaves it be
    this.fenceMat.dispose();
    this.postGeom.dispose();
    this.fenceRailGeom.dispose();
    this.pierGeom.dispose();
  }
}
