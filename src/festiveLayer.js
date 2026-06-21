// festiveLayer.js — winter-gated scene layer: 3D snowman figures on village
// greens when snow is at its deepest. Mirror of floraLayer lifecycle.
import * as THREE from 'three';
import { festiveActive, deepSnow } from './festive.js';
import { SCARF_COLORS, DEFAULT_SNOWMAN } from './snowman.js';
import { hash2i } from './noise.js';
import { B } from './defs.js';

const RADIUS = 48;
const REBUILD_MOVE = 8;

export class FestiveLayer {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.objects = [];
    this.center = null;
    this.key = null;
    this.timer = 0;
    this._builtOnce = false;
  }

  update(dt, playerPos, season, snowAccum) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.4;
    const cx = Math.floor(playerPos.x), cz = Math.floor(playerPos.z);
    const key = (festiveActive(season) ? 'F' : '') + (deepSnow(snowAccum) ? 'D' : '') +
                '|' + this.world.snowmanLedger.size;
    if (this.center &&
        Math.abs(cx - this.center[0]) < REBUILD_MOVE &&
        Math.abs(cz - this.center[1]) < REBUILD_MOVE &&
        key === this.key &&
        this._builtOnce) return;
    this.build(cx, cz, season, snowAccum);
    this.center = [cx, cz];
    this.key = key;
    this._builtOnce = true;
  }

  build(cx, cz, season, snowAccum) {
    this.clear();
    if (!festiveActive(season)) return;
    const gen = this.world.gen;
    // Winter firs — one per village, whole festive season (no deep-snow gate)
    for (const v of (gen.geo.villages || [])) {
      if (Math.abs(v.x - cx) > RADIUS || Math.abs(v.z - cz) > RADIUS) continue;
      const fp = this.firPlacement(v);
      if (fp) {
        const g = this.buildFir();
        g.position.set(fp.x + 0.5, gen.height(fp.x, fp.z) + 1, fp.z + 0.5);
        this.scene.add(g);
        this.objects.push(g);
      }
    }
    // Auto-snowmen on village greens — only when snow is at its deepest
    if (deepSnow(snowAccum)) {
      for (const v of (gen.geo.villages || [])) {
        if (Math.abs(v.x - cx) > RADIUS || Math.abs(v.z - cz) > RADIUS) continue;
        let placed = 0;
        for (let r = 3; r < 14 && placed < 4; r++) {
          for (let a = 0; a < 8 && placed < 4; a++) {
            const x = v.x + Math.round(r * Math.cos(a));
            const z = v.z + Math.round(r * Math.sin(a));
            const col = gen.geo.villageColumn(x, z);
            if (!col || (col.kind !== 'green' && col.kind !== 'closes')) continue;
            const sy = gen.height(x, z);
            if (this.world.getBlock(x, sy + 1, z) !== B.AIR) continue;
            if (hash2i(x, z, gen.geo.seed ^ 0x5107) > 0.5) continue; // sparse
            const yaw = hash2i(x, z, 7) * Math.PI * 2;
            this.addSnowman(x + 0.5, sy + 1, z + 0.5, DEFAULT_SNOWMAN, yaw);
            placed++;
          }
        }
      }
    }
    // Player-built snowmen from the ledger (placed by next task; wired here for
    // completeness so the ledger is always rendered when festive + loaded)
    for (const [k, entry] of this.world.snowmanLedger) {
      const [wx, wy, wz] = k.split(',').map(Number);
      if (Math.abs(wx - cx) > RADIUS || Math.abs(wz - cz) > RADIUS) continue;
      const yaw = hash2i(wx, wz, 0xbeef) * Math.PI * 2;
      this.addSnowman(wx + 0.5, wy, wz + 0.5, entry.cfg || DEFAULT_SNOWMAN, yaw);
    }
  }

  // Return a deterministic open cell near village centre for the fir.
  // Scans expanding rings r=2..10 with 16 angle steps per radius.
  // Pass 1 prefers green/closes/path kinds (open ground); pass 2 accepts any
  // non-building column so every village style (capital, cluster, longgreen,
  // clifftop) gets a fir even when no green/closes cell exists near centre.
  // The hash-gate from the old code is removed — it rejected ~65% of valid
  // candidates and caused most villages to return null. Iteration order is
  // fixed so the result is deterministic per seed without a hash gate.
  firPlacement(v) {
    const gen = this.world.gen;
    const isPreferred = kind => kind === 'green' || kind === 'closes' || kind === 'path';
    const isOpen = (x, z, col) => {
      if (!col || col.kind === 'building') return false;
      const sy = gen.height(x, z);
      return this.world.getBlock(x, sy + 1, z) === B.AIR;
    };
    // Pass 1: preferred kinds (green/closes/path) — gives a good spot on
    // village greens and market squares first.
    for (let r = 2; r <= 10; r++) {
      for (let ai = 0; ai < 16; ai++) {
        const angle = (ai / 16) * Math.PI * 2;
        const x = v.x + Math.round(r * Math.cos(angle));
        const z = v.z + Math.round(r * Math.sin(angle));
        if (x === v.x && z === v.z) continue; // skip the stone cross
        const col = gen.geo.villageColumn(x, z);
        if (!col || !isPreferred(col.kind)) continue;
        if (!isOpen(x, z, col)) continue;
        return { x, z };
      }
    }
    // Pass 2: any non-building open column (handles village styles where the
    // centre is all closes with no explicit green/path near the cross).
    for (let r = 2; r <= 10; r++) {
      for (let ai = 0; ai < 16; ai++) {
        const angle = (ai / 16) * Math.PI * 2;
        const x = v.x + Math.round(r * Math.cos(angle));
        const z = v.z + Math.round(r * Math.sin(angle));
        if (x === v.x && z === v.z) continue;
        const col = gen.geo.villageColumn(x, z);
        if (!isOpen(x, z, col)) continue;
        return { x, z };
      }
    }
    return null; // genuinely no open cell in range (shouldn't happen in a real village)
  }

  // Build a blocky 3D conifer Group, feet at y=0, total height ≈11.
  // Three shared materials (brown trunk, green foliage, snow cap) so
  // clear()'s traverse+dispose is O(meshes) not O(1) — each mesh.material
  // points to the same object; dispose() on repeated refs is a no-op.
  buildFir() {
    const g = new THREE.Group();
    const matTrunk  = new THREE.MeshLambertMaterial({ color: 0x5a4326 });
    const matLeaf   = new THREE.MeshLambertMaterial({ color: 0x2f5d3a });
    const matSnow   = new THREE.MeshLambertMaterial({ color: 0xdfeaf2 });

    // ---- trunk: two 0.6×1 brown cubes at y=0..2 ----
    const trunkGeo = new THREE.BoxGeometry(0.6, 1, 0.6);
    const t0 = new THREE.Mesh(trunkGeo, matTrunk);
    t0.position.y = 0.5;
    g.add(t0);
    const t1 = new THREE.Mesh(trunkGeo, matTrunk);
    t1.position.y = 1.5;
    g.add(t1);

    // ---- foliage: 5 square tiers, stacked bottom→top ----
    // Tier layout (y base, half-width in blocks):
    //   tier 0: y=2, hw=3  → 7×7 fill = 49 cubes — too many; use ring hw=3 fill
    //   We budget ~40 leaf cubes total by mixing ring fills and solid small tiers.
    //
    // Chosen layout (each tier = filled square of unit cubes, hw = half-width):
    //   tier 0 (base): y=2..3,  hw=3  → (2*3+1)^2 = 49 — too dense; use hw=2 solid
    //   Keep total reasonable: hw 2,2,1,1,0 → 25+25+9+9+1 = 69 — still high.
    //   Final: widths [2,2,1,1,0] but only border ring for wide tiers saves cubes.
    //
    // Simpler & cleaner: 5 tiers, using RING for hw≥2, SOLID for hw≤1:
    //   Tier 0: hw=3, ring  → perimeter = (7^2 - 5^2) = 49-25 = 24
    //   Tier 1: hw=2, ring  → (5^2 - 3^2)             = 25- 9 = 16
    //   Tier 2: hw=2, solid → 5×5                             = 25
    //   Tier 3: hw=1, solid → 3×3                             =  9
    //   Tier 4: hw=0, solid → 1×1 (snow cap)                  =  1
    //   Total foliage: 24+16+25+9+1 = 75 — still on the high side.
    //
    // Back to the brief: "a few dozen meshes". Let's use RING for all tiers
    // (just outer shell, no interior fill) — realistic conifer silhouette + ~35:
    //   Tier 0: hw=3 ring → 24
    //   Tier 1: hw=2 ring → 16
    //   Tier 2: hw=1 ring → 8
    //   Tier 3: hw=1 solid → 9
    //   Tier 4 (snow): hw=0 → 1
    //   Total: 58 — close to brief. Use solid fills for hw≤1 (corners matter at small
    //   sizes) and ring for hw≥2. Grand total ≈ 58 meshes + 2 trunk = 60.

    // Tier definitions: [yBottom, halfWidth, ring, snow]
    const tiers = [
      { yb: 2, hw: 3, ring: true,  snow: false },
      { yb: 4, hw: 2, ring: true,  snow: false },
      { yb: 6, hw: 1, ring: false, snow: false },
      { yb: 8, hw: 1, ring: false, snow: false },
      { yb: 10, hw: 0, ring: false, snow: true  },
    ];
    const leafGeo = new THREE.BoxGeometry(1, 1, 1);

    for (const tier of tiers) {
      const mat = tier.snow ? matSnow : matLeaf;
      const { yb, hw, ring } = tier;
      const cy = yb + 0.5; // centre y of this tier's cubes
      for (let dx = -hw; dx <= hw; dx++) {
        for (let dz = -hw; dz <= hw; dz++) {
          if (ring && Math.abs(dx) < hw && Math.abs(dz) < hw) continue; // hollow interior
          const m = new THREE.Mesh(leafGeo, mat);
          m.position.set(dx, cy, dz);
          g.add(m);
        }
      }
    }

    this.dressFir(g);
    this.buildPresents(g);
    return g;
  }

  // Add ~5 wrapped present boxes around the trunk base (y≈0), as children of
  // the fir Group so clear()'s traverse disposes them automatically.
  // Each present: a BoxGeometry cube + two thin ribbon strips crossing over it.
  buildPresents(g) {
    // Present box colours (festive palette)
    const boxColors    = [0xb23b3b, 0x2f6e4f, 0xc9a13b, 0x7a4da8, 0xe8e0c8];
    // Ribbon colours: contrasting per box colour
    const ribbonColors = [0xc9a13b, 0xe8e0c8, 0xb23b3b, 0xe8e0c8, 0x7a4da8];

    // Deterministic scatter around trunk: (x offset, z offset, size, yaw)
    const presents = [
      { dx:  0.65, dz:  0.40, s: 0.45, yaw: 0.25 },
      { dx: -0.60, dz:  0.30, s: 0.55, yaw: -0.4 },
      { dx:  0.30, dz: -0.65, s: 0.40, yaw: 0.90 },
      { dx: -0.35, dz: -0.55, s: 0.50, yaw: -0.2 },
      { dx:  0.10, dz:  0.80, s: 0.42, yaw: 1.30 },
    ];

    for (let i = 0; i < presents.length; i++) {
      const { dx, dz, s, yaw } = presents[i];
      const matBox    = new THREE.MeshLambertMaterial({ color: boxColors[i] });
      const matRibbon = new THREE.MeshLambertMaterial({ color: ribbonColors[i] });

      // Box — sits on the ground (y = s/2 so base is at y=0)
      const box = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), matBox);
      box.position.set(dx, s * 0.5, dz);
      box.rotation.y = yaw;
      g.add(box);

      // Ribbon band 1: runs front-to-back over the lid (thin strip across top + sides)
      const r = 0.06; // ribbon half-thickness
      const ribbonGeo1 = new THREE.BoxGeometry(r, s + r * 2, s + r * 2);
      const rb1 = new THREE.Mesh(ribbonGeo1, matRibbon);
      rb1.position.set(dx, s * 0.5, dz);
      rb1.rotation.y = yaw;
      g.add(rb1);

      // Ribbon band 2: runs side-to-side (perpendicular cross)
      const ribbonGeo2 = new THREE.BoxGeometry(s + r * 2, s + r * 2, r);
      const rb2 = new THREE.Mesh(ribbonGeo2, matRibbon);
      rb2.position.set(dx, s * 0.5, dz);
      rb2.rotation.y = yaw;
      g.add(rb2);
    }
  }

  // Dress the fir with Victorian ornaments: real candles (MeshBasicMaterial,
  // unlit-glow), baubles, an evergreen garland helix, and a glowing star.
  // All meshes are added as children of the group so clear()'s traverse
  // disposes them automatically. Shared materials are fine — dispose() on
  // repeated refs is a Three.js no-op after the first call.
  dressFir(g) {
    // --- materials -------------------------------------------------------
    const matCandle  = new THREE.MeshBasicMaterial({ color: 0xffdf8a }); // warm unlit glow
    const matStar    = new THREE.MeshBasicMaterial({ color: 0xfff2b0 }); // pale gold glow
    const matBaubles = [
      new THREE.MeshLambertMaterial({ color: 0xb23b3b }), // red
      new THREE.MeshLambertMaterial({ color: 0xc9a13b }), // gold
      new THREE.MeshLambertMaterial({ color: 0x2f6e4f }), // deep green
      new THREE.MeshLambertMaterial({ color: 0x7a4da8 }), // plum
    ];
    const matGarland = new THREE.MeshLambertMaterial({ color: 0x244d2e }); // dark evergreen

    // --- geometries (shared across multiple meshes) -----------------------
    const candleGeo  = new THREE.ConeGeometry(0.1, 0.3, 6);
    const baubleGeo  = new THREE.SphereGeometry(0.14, 7, 5);
    const garlandGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
    const starGeo    = new THREE.OctahedronGeometry(0.4);

    // --- candles: 10, spread across the 5 tier heights -------------------
    // Each tier: [y-centre, cone-surface-radius]. Candle sits just inside the
    // branch surface so the flame tip pokes up above.
    const candleTiers = [
      { cy: 2.5, r: 2.4 },
      { cy: 4.5, r: 1.4 },
      { cy: 6.5, r: 0.9 },
      { cy: 7.5, r: 0.7 },
      { cy: 9.0, r: 0.4 },
    ];
    const candlesPerTier = [3, 2, 2, 2, 1]; // total = 10
    for (let ti = 0; ti < candleTiers.length; ti++) {
      const { cy, r } = candleTiers[ti];
      const n = candlesPerTier[ti];
      for (let i = 0; i < n; i++) {
        const angle = (i / n) * Math.PI * 2 + ti * 0.7; // stagger between tiers
        const m = new THREE.Mesh(candleGeo, matCandle);
        m.position.set(
          Math.cos(angle) * r,
          cy + 0.3, // sit above branch surface
          Math.sin(angle) * r
        );
        m.userData.flicker = true;
        g.add(m);
      }
    }

    // --- baubles: 10, spread across lower four tiers ----------------------
    const baublesPerTier = [3, 3, 2, 2]; // total = 10
    const baubleYs       = [2.8, 4.8, 6.8, 8.8];
    const baubleRadii    = [2.0, 1.2, 0.7, 0.5];
    for (let ti = 0; ti < baublesPerTier.length; ti++) {
      const n = baublesPerTier[ti];
      const r = baubleRadii[ti];
      const cy = baubleYs[ti];
      for (let i = 0; i < n; i++) {
        const angle = (i / n) * Math.PI * 2 + ti * 1.1 + 0.4;
        const m = new THREE.Mesh(baubleGeo, matBaubles[(ti + i) % matBaubles.length]);
        m.position.set(
          Math.cos(angle) * r,
          cy,
          Math.sin(angle) * r
        );
        g.add(m);
      }
    }

    // --- garland: 16 small dark-green cubes in a descending helix --------
    // Helix descends from y≈9 to y≈2.5; radius widens from top to base to
    // follow the cone profile.
    const GARLAND_N = 16;
    for (let i = 0; i < GARLAND_N; i++) {
      const t = i / (GARLAND_N - 1);          // 0..1, top→bottom
      const angle = t * Math.PI * 4.5;         // ~2.25 full turns
      const y     = 9.0 - t * 6.5;            // y: 9 → 2.5
      const r     = 0.4 + t * 2.0;            // radius: 0.4 → 2.4 (follows cone)
      const m = new THREE.Mesh(garlandGeo, matGarland);
      m.position.set(Math.cos(angle) * r, y, Math.sin(angle) * r);
      g.add(m);
    }

    // --- star: glowing octahedron at the very top, tagged for twinkle ----
    const star = new THREE.Mesh(starGeo, matStar);
    star.position.set(0, 10.5, 0);
    star.userData.flicker = true;
    g.add(star);
  }

  addSnowman(x, y, z, cfg, yaw) {
    const g = this.buildSnowman(cfg);
    g.position.set(x, y, z);
    g.rotation.y = yaw || 0;
    this.scene.add(g);
    this.objects.push(g);
  }

  buildSnowman(cfg) {
    const g = new THREE.Group();
    const snow = new THREE.MeshLambertMaterial({ color: 0xfbfdff });
    const dark = new THREE.MeshLambertMaterial({ color: 0x111111 });
    const brown = new THREE.MeshLambertMaterial({ color: 0x6b3d1e });

    // -- body spheres (feet at y=0) --
    const bot = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), snow);
    bot.position.y = 0.4;
    g.add(bot);

    const mid = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), snow);
    mid.position.y = 1.0;
    g.add(mid);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), snow);
    head.position.y = 1.5;
    g.add(head);

    // -- eyes --
    for (const ex of [-0.08, 0.08]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 5, 4), dark);
      eye.position.set(ex, 1.55, 0.19);
      g.add(eye);
    }

    // -- smile (coal dots in a small arc) --
    if (cfg.smile) {
      for (let i = 0; i < 5; i++) {
        const a = (i / 4 - 0.5) * 0.7; // arc angle
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.025, 4, 3), dark);
        dot.position.set(Math.sin(a) * 0.14, 1.42 + Math.cos(a) * 0.06 - 0.06, 0.2);
        g.add(dot);
      }
    }

    // -- nose --
    if (cfg.nose === 'carrot') {
      const orange = new THREE.MeshLambertMaterial({ color: 0xe05b00 });
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.18, 6), orange);
      nose.rotation.x = Math.PI / 2; // point along +z
      nose.position.set(0, 1.5, 0.24);
      g.add(nose);
    } else {
      // coal nub
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.04, 5, 4), dark);
      nose.position.set(0, 1.5, 0.22);
      g.add(nose);
    }

    // -- scarf --
    const scarfColor = SCARF_COLORS[cfg.scarf] != null ? SCARF_COLORS[cfg.scarf] : SCARF_COLORS[0];
    const scarfMat = new THREE.MeshLambertMaterial({ color: scarfColor });
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.045, 5, 12), scarfMat);
    scarf.rotation.x = Math.PI / 2;
    scarf.position.y = 1.24;
    g.add(scarf);

    // -- arms (two thin brown boxes angled out from mid sphere) --
    if (cfg.arms) {
      for (const side of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.08), brown);
        arm.position.set(side * 0.35, 1.02, 0.04);
        arm.rotation.z = side * 0.55; // angle outward
        g.add(arm);
      }
    }

    // -- hat --
    if (cfg.hat === 'topper') {
      const hatMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
      // brim
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 12), hatMat);
      brim.position.y = 1.74;
      g.add(brim);
      // crown
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.32, 12), hatMat);
      crown.position.y = 1.92;
      g.add(crown);
    } else if (cfg.hat === 'bobble') {
      const capColor = SCARF_COLORS[(cfg.scarf + 2) % SCARF_COLORS.length];
      const capMat = new THREE.MeshLambertMaterial({ color: capColor });
      // cap body
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.22, 10), capMat);
      cap.position.y = 1.8;
      g.add(cap);
      // pom
      const pom = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 5), snow);
      pom.position.y = 1.94;
      g.add(pom);
    }
    // cfg.hat === 'none' — nothing

    return g;
  }

  clear() {
    for (const o of this.objects) {
      this.scene.remove(o);
      o.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
    }
    this.objects.length = 0;
  }
}
