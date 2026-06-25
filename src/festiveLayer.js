// festiveLayer.js — winter-gated scene layer: 3D snowman figures on village
// greens when snow is at its deepest. Mirror of floraLayer lifecycle.
import * as THREE from 'three';
import { wintry, deepSnow } from './festive.js';
import { SCARF_COLORS, DEFAULT_SNOWMAN } from './snowman.js';
import { hash2i } from './noise.js';
import { B, TILE } from './defs.js';
import { tileUV } from './textures.js';
import { getMaterials } from './mesher.js';

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
    this._lit = [];
    this._robins = [];
    this._t = 0;
  }

  update(dt, playerPos, season, snowAccum) {
    // Flicker runs every frame, before the rebuild early-out
    this._t += dt;
    for (let i = 0; i < this._lit.length; i++) {
      const m = this._lit[i];
      const k = 0.82 + 0.18 * Math.sin(this._t * 6 + i * 1.7); // candlelight breathing
      m.scale.setScalar(k);
    }

    // Robin hop animation — tiny vertical bob on a per-bird phase offset
    for (let i = 0; i < this._robins.length; i++) {
      const r = this._robins[i];
      const phase = r.userData.hopPhase || 0;
      // Bob: gentle sine wave at ~2Hz, amplitude 0.06 blocks
      r.position.y = r.userData.groundY + 0.06 * Math.abs(Math.sin(this._t * 2.1 + phase));
      // Occasional side-to-side tilt to sell the hop feel
      r.rotation.z = 0.08 * Math.sin(this._t * 2.1 + phase);
    }

    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.4;
    const cx = Math.floor(playerPos.x), cz = Math.floor(playerPos.z);
    const key = (wintry(season) ? 'F' : '') + (deepSnow(snowAccum) ? 'D' : '') +
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
    this._lit = [];
    this._robins = [];
    this.clear();
    if (!wintry(season)) return;
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
        g.traverse(c => { if (c.isMesh && c.userData.flicker) this._lit.push(c); });

        // -- carol singers: 4 children clustered tightly to one side of the
        // fir, clear of the foliage footprint (base tier hw=3, so ≥4 blocks
        // off trunk). Cluster centre is at dz=+4.5 (south side), singers
        // spaced ~0.7 blocks apart in a tight 2×2 bunch, all facing the tree.
        const carolOffsets = [
          { dx: -0.35, dz: 4.2 },
          { dx:  0.35, dz: 4.2 },
          { dx: -0.35, dz: 4.9 },
          { dx:  0.35, dz: 4.9 },
        ];
        for (let ci = 0; ci < carolOffsets.length; ci++) {
          const { dx, dz } = carolOffsets[ci];
          const cx2 = fp.x + dx;
          const cz2 = fp.z + dz;
          const cy  = gen.height(Math.round(cx2), Math.round(cz2)) + 1;
          const carol = this.buildCaroller(ci);
          // Face toward the fir centre
          carol.rotation.y = Math.atan2(fp.x - cx2, fp.z - cz2);
          carol.position.set(cx2 + 0.5, cy, cz2 + 0.5);
          this.scene.add(carol);
          this.objects.push(carol);
        }
      }
    }
    // Auto-snowmen on village greens — only when snow is at its deepest.
    // Spread across the whole village (wider radius 4-28), exclude within 6
    // blocks of the fir so none cluster under the tree. Place 4-6 per village.
    if (deepSnow(snowAccum)) {
      for (const v of (gen.geo.villages || [])) {
        if (Math.abs(v.x - cx) > RADIUS || Math.abs(v.z - cz) > RADIUS) continue;
        const fp = this.firPlacement(v);
        let placed = 0;
        for (let r = 4; r < 28 && placed < 5; r++) {
          for (let a = 0; a < 16 && placed < 5; a++) {
            const angle = (a / 16) * Math.PI * 2;
            const x = v.x + Math.round(r * Math.cos(angle));
            const z = v.z + Math.round(r * Math.sin(angle));
            // Exclude cells within 6 blocks of the fir tree
            if (fp && Math.hypot(x - fp.x, z - fp.z) < 6) continue;
            const col = gen.geo.villageColumn(x, z);
            if (!col || (col.kind !== 'green' && col.kind !== 'closes')) continue;
            const sy = gen.height(x, z);
            if (this.world.getBlock(x, sy + 1, z) !== B.AIR) continue;
            if (hash2i(x, z, gen.geo.seed ^ 0x5107) > 0.45) continue; // sparse
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

    // -- Door wreaths on cottages (whole festive season, no deep-snow gate) --
    let windowGlowCount = 0;
    for (const v of (gen.geo.villages || [])) {
      if (Math.abs(v.x - cx) > RADIUS || Math.abs(v.z - cz) > RADIUS) continue;
      for (const b of (v.buildings || [])) {
        if (b.type !== 'cottage' && b.type !== 'shop' && b.type !== 'pub') continue;
        // Door: south wall (lowest z = b.z0), centred on x
        const midX = Math.floor((b.x0 + b.x1) / 2);
        const doorX = midX + 0.5;
        const doorZ = b.z0;           // south face of building
        const doorY = gen.height(midX, doorZ) + 2; // head height above ground
        // Place wreath just in front of the door, facing south (outward)
        this.addBillboard(TILE.WREATH, doorX, doorY, doorZ - 0.15, 0);

        // -- Candlelit window glow (Victorian: unlit warm MeshBasicMaterial) --
        // Mirror the worldgen window rule from stampBuildingColumn:
        //   perimeter cells, not corner, not doorway, (x+z)%3===0 → B.WINDOW at g+2
        // Each qualifying cell gets a warm quad facing outward from the wall.
        const g = gen.height(midX, Math.floor((b.z0 + b.z1) / 2));
        const glowY = g + 2.5; // centred on the window block (g+2, height 1)
        for (let wx = b.x0; wx <= b.x1; wx++) {
          for (let wz = b.z0; wz <= b.z1; wz++) {
            const onPerim = wx === b.x0 || wx === b.x1 || wz === b.z0 || wz === b.z1;
            if (!onPerim) continue;
            const corner = (wx === b.x0 || wx === b.x1) && (wz === b.z0 || wz === b.z1);
            if (corner) continue;
            // doorway: south wall (z===b.z0), centre x
            const isDoor = (wz === b.z0) && (wx === midX);
            if (isDoor) continue;
            if ((wx + wz) % 3 !== 0) continue;

            // Determine which wall this perimeter cell is on → outward yaw + offset
            // yaw=0 faces south (-z), yaw=π faces north (+z),
            // yaw=π/2 faces west (-x), yaw=-π/2 / 3π/2 faces east (+x)
            let glowX, glowZ, yaw;
            if (wz === b.z0) {
              // south wall — face outward (south = -z direction, yaw=0)
              glowX = wx + 0.5;
              glowZ = wz - 0.05;
              yaw   = 0;
            } else if (wz === b.z1) {
              // north wall — face outward (north = +z direction, yaw=π)
              glowX = wx + 0.5;
              glowZ = wz + 1.05;
              yaw   = Math.PI;
            } else if (wx === b.x0) {
              // west wall — face outward (west = -x direction, yaw=π/2)
              glowX = wx - 0.05;
              glowZ = wz + 0.5;
              yaw   = Math.PI / 2;
            } else {
              // east wall — face outward (east = +x direction, yaw=-π/2)
              glowX = wx + 1.05;
              glowZ = wz + 0.5;
              yaw   = -Math.PI / 2;
            }
            this.addWindowGlow(glowX, glowY, glowZ, yaw);
            windowGlowCount++;
          }
        }
      }
    }
    this._windowGlowCount = windowGlowCount;

    // -- Robins & holly sprigs on village greens (whole festive season) --
    // Robins are now 3D hopping bird groups (not billboards). Holly stays billboard.
    for (const v of (gen.geo.villages || [])) {
      if (Math.abs(v.x - cx) > RADIUS || Math.abs(v.z - cz) > RADIUS) continue;
      let hollyCount = 0, robinCount = 0;
      for (let r = 2; r < 16 && (hollyCount < 5 || robinCount < 4); r++) {
        for (let a = 0; a < 12; a++) {
          const x = v.x + Math.round(r * Math.cos((a / 12) * Math.PI * 2));
          const z = v.z + Math.round(r * Math.sin((a / 12) * Math.PI * 2));
          const col = gen.geo.villageColumn(x, z);
          if (!col || (col.kind !== 'green' && col.kind !== 'closes')) continue;
          const sy = gen.height(x, z);
          if (this.world.getBlock(x, sy + 1, z) !== B.AIR) continue;
          // deterministic sparse gate — different offsets for holly vs robin
          const hval = hash2i(x, z, gen.geo.seed ^ 0xb4c7);
          if (hollyCount < 5 && hval < 0.22) {
            const yaw = hash2i(x, z, 0x4f3a) * Math.PI * 2;
            this.addBillboard(TILE.HOLLY_SPRIG, x + 0.5, sy + 1, z + 0.5, yaw);
            hollyCount++;
          } else if (robinCount < 4 && hval > 0.78 && hval < 0.92) {
            const yaw = hash2i(x, z, 0x9e2b) * Math.PI * 2;
            const groundY = sy + 1;
            const robin = this.buildRobin();
            robin.rotation.y = yaw;
            robin.position.set(x + 0.5, groundY, z + 0.5);
            robin.userData.groundY = groundY;
            robin.userData.hopPhase = robinCount * 1.3 + r * 0.4; // vary per bird
            this.scene.add(robin);
            this.objects.push(robin);
            this._robins.push(robin);
            robinCount++;
          }
        }
      }
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

  // Build a small child caroller figure Group, feet at y=0, height ≈1.6.
  // Roughly 0.7× the scale of a snowman. i selects coat colour (0..3).
  buildCaroller(i) {
    const g = new THREE.Group();

    // Coat colours — festive wool palette, one per child
    const coatColor = [0xb23b3b, 0x2f6e4f, 0x2a4d8f, 0x7a4da8][i % 4];
    const matCoat = new THREE.MeshLambertMaterial({ color: coatColor });
    const matSkin = new THREE.MeshLambertMaterial({ color: 0xd8ab8a });
    const matHat  = new THREE.MeshLambertMaterial({ color: 0x222222 });
    const matBook = new THREE.MeshLambertMaterial({ color: 0xf0ead8 });

    // -- body: coat box, feet at y=0, top at y=0.5 --
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.2), matCoat);
    body.position.y = 0.25;
    g.add(body);

    // -- head: skin sphere, centred at y≈0.7 --
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), matSkin);
    head.position.y = 0.7;
    g.add(head);

    // -- winter cap: small dark cylinder on top of head --
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.12, 0.15, 8), matHat);
    cap.position.y = 0.88;
    g.add(cap);

    // -- songbook: a thin pale box held up at chest height, angled slightly --
    const book = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.13, 0.03), matBook);
    book.position.set(0, 0.42, 0.13);
    g.add(book);

    // -- hat brim: thin disc just below cap (gives it a top-hat silhouette) --
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.03, 8), matHat);
    brim.position.y = 0.82;
    g.add(brim);

    return g;
  }

  // Build a tiny robin, feet at y=0, ~0.3 tall — a wee 3D bird that hops on the
  // ground (animated in update()). Brown body, orange-red breast, beak, legs.
  buildRobin() {
    const g = new THREE.Group();
    const matBody   = new THREE.MeshLambertMaterial({ color: 0x6b4a2f }); // brown
    const matBreast = new THREE.MeshLambertMaterial({ color: 0xc4502a }); // robin red-breast
    const matBeak   = new THREE.MeshLambertMaterial({ color: 0x2a2118 });
    const matLeg    = new THREE.MeshLambertMaterial({ color: 0x3a2a1a });

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), matBody);
    body.scale.set(1, 0.9, 1.2); body.position.y = 0.16; g.add(body);

    const breast = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), matBreast);
    breast.position.set(0, 0.14, 0.08); g.add(breast);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), matBody);
    head.position.set(0, 0.27, 0.08); g.add(head);

    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.08, 6), matBeak);
    beak.rotation.x = Math.PI / 2; beak.position.set(0, 0.27, 0.17); g.add(beak);

    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.11), matBody);
    tail.position.set(0, 0.17, -0.13); tail.rotation.x = -0.4; g.add(tail);

    for (const dx of [-0.04, 0.04]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.08, 0.015), matLeg);
      leg.position.set(dx, 0.04, 0.02); g.add(leg);
    }
    return g;
  }

  // Build a blocky stepped-pyramid conifer Group, feet at y=0, total height ≈7.
  // Each green layer is ONE BLOCK TALL (BoxGeometry(1,1,1) unit cubes), footprint
  // shrinking by one block per side each layer up — a classic blocky voxel spruce.
  // Layer footprints bottom→top: 5×5, 4×4, 3×3, 2×2, 1×1, snow cap 1×1.
  // Green cube count: 25+16+9+4+1 = 55 + 1 snow = 56 total foliage cubes.
  // One shared green MeshLambertMaterial, one shared snow material — cheap.
  buildFir() {
    const g = new THREE.Group();
    const matTrunk = new THREE.MeshLambertMaterial({ color: 0x5a4326 });
    const matLeaf  = new THREE.MeshLambertMaterial({ color: 0x2f5d3a });
    const matSnow  = new THREE.MeshLambertMaterial({ color: 0xdfeaf2 });

    // ---- trunk: one brown unit cube, y=0..1 ----
    const trunk = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), matTrunk);
    trunk.position.y = 0.5;
    g.add(trunk);

    // ---- foliage: single-block-tall square layers, each layer one row of unit cubes.
    // Layer 0 (y=1): 5×5  (half-width=2, x/z from -2 to +2)
    // Layer 1 (y=2): 4×4  (hw=1.5, x/z offsets: -1.5,-0.5,+0.5,+1.5 → use -2,-1,0,1)
    //   Note: 4×4 has no centre — offsets [-1.5, -0.5, 0.5, 1.5] from centre.
    // Layer 2 (y=3): 3×3  (offsets -1, 0, +1)
    // Layer 3 (y=4): 2×2  (offsets -0.5, +0.5)
    // Layer 4 (y=5): 1×1  (offset 0,0)
    // Snow cap (y=6): 1×1 snow material
    //
    // For even-sized layers (4×4, 2×2) cubes are centred at half-integer offsets
    // so the layer itself is centred on x=0,z=0.
    const geoUnit = new THREE.BoxGeometry(1, 1, 1);

    const layers = [
      { yb: 1, size: 5, snow: false },
      { yb: 2, size: 4, snow: false },
      { yb: 3, size: 3, snow: false },
      { yb: 4, size: 2, snow: false },
      { yb: 5, size: 1, snow: false },
      { yb: 6, size: 1, snow: true  }, // snow-dusted peak
    ];

    for (const layer of layers) {
      const mat = layer.snow ? matSnow : matLeaf;
      const half = (layer.size - 1) / 2; // offset from centre to first/last cube centre
      for (let xi = 0; xi < layer.size; xi++) {
        for (let zi = 0; zi < layer.size; zi++) {
          const cx = -half + xi; // cube centre x
          const cz = -half + zi; // cube centre z
          const m = new THREE.Mesh(geoUnit, mat);
          m.position.set(cx, layer.yb + 0.5, cz);
          g.add(m);
        }
      }
    }

    this.dressFir(g);
    this.buildPresents(g);
    return g;
  }

  // Add ~22 wrapped present boxes piled in a ring/heap around the trunk base (y≈0).
  // Three rings: inner (r≈0.9, 6 presents), mid (r≈1.6, 9 presents), outer (r≈2.4, 7 presents).
  // Presents sit within the 5×5 footprint outer edge (±2.5) — outer ring at r≈2.4 is safe.
  // Each present: BoxGeometry cube + two perpendicular ribbon strips.
  buildPresents(g) {
    const boxColors    = [0xb23b3b, 0x2f6e4f, 0xc9a13b, 0x7a4da8, 0xe8e0c8, 0xc25c2a];
    const ribbonColors = [0xc9a13b, 0xe8e0c8, 0xb23b3b, 0xe8e0c8, 0x7a4da8, 0xc9a13b];

    // 22 presents across three rings — deterministic positions.
    const presents = [
      // --- inner ring r≈0.9 (6 presents, tight around trunk) ---
      { dx:  0.80, dz:  0.40, s: 0.40, yaw:  0.30 },
      { dx: -0.75, dz:  0.50, s: 0.38, yaw: -0.50 },
      { dx:  0.40, dz: -0.80, s: 0.35, yaw:  0.85 },
      { dx: -0.50, dz: -0.70, s: 0.42, yaw: -0.20 },
      { dx:  0.85, dz: -0.35, s: 0.36, yaw:  1.10 },
      { dx: -0.80, dz: -0.35, s: 0.38, yaw: -0.70 },
      // --- mid ring r≈1.6 (9 presents) ---
      { dx:  1.55, dz:  0.50, s: 0.48, yaw:  0.60 },
      { dx:  1.10, dz: -1.20, s: 0.44, yaw:  1.20 },
      { dx: -1.50, dz:  0.80, s: 0.50, yaw: -0.45 },
      { dx: -1.30, dz: -1.10, s: 0.42, yaw:  0.80 },
      { dx:  0.30, dz:  1.60, s: 0.46, yaw:  1.35 },
      { dx: -0.25, dz: -1.65, s: 0.44, yaw: -0.95 },
      { dx:  1.55, dz: -0.70, s: 0.40, yaw:  0.40 },
      { dx: -1.60, dz: -0.60, s: 0.52, yaw: -0.30 },
      { dx:  0.60, dz:  1.50, s: 0.38, yaw:  0.70 },
      // --- outer ring r≈2.3 (7 presents) ---
      { dx:  2.20, dz:  0.60, s: 0.50, yaw:  0.55 },
      { dx:  1.60, dz: -1.65, s: 0.46, yaw:  1.05 },
      { dx: -2.10, dz:  0.90, s: 0.48, yaw: -0.50 },
      { dx: -1.80, dz: -1.50, s: 0.44, yaw:  0.75 },
      { dx:  0.20, dz:  2.25, s: 0.45, yaw:  1.25 },
      { dx: -0.40, dz: -2.20, s: 0.52, yaw: -0.85 },
      { dx:  2.15, dz: -0.50, s: 0.42, yaw:  0.30 },
    ];

    for (let i = 0; i < presents.length; i++) {
      const { dx, dz, s, yaw } = presents[i];
      const ci = i % boxColors.length;
      const matBox    = new THREE.MeshLambertMaterial({ color: boxColors[ci] });
      const matRibbon = new THREE.MeshLambertMaterial({ color: ribbonColors[ci] });

      // Box — sits on the ground (y = s/2 so base is at y=0)
      const box = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), matBox);
      box.position.set(dx, s * 0.5, dz);
      box.rotation.y = yaw;
      g.add(box);

      // Ribbon band 1: runs front-to-back
      const r = 0.05;
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

  // Dress the fir with Victorian ornaments re-fitted to the NEW half-size stepped tree:
  // foliage y=1..6, layer footprints 5×5/4×4/3×3/2×2/1×1/snowcap.
  // Outer edges (cube centres ± 0.5): layer0 edge at ±2.5, layer1 at ±2.0,
  // layer2 at ±1.5, layer3 at ±1.0, layer4/5 at ±0.5.
  // ~28 candles spread densely on perimeters of each layer, offset 0.3 proud
  // of the layer outer face so they show from outside.
  dressFir(g) {
    // --- materials -------------------------------------------------------
    const matCandle  = new THREE.MeshBasicMaterial({ color: 0xffdf8a }); // warm candlelight
    const matStar    = new THREE.MeshBasicMaterial({ color: 0xfff2b0 }); // pale gold glow
    const matBaubles = [
      new THREE.MeshLambertMaterial({ color: 0xb23b3b }), // red
      new THREE.MeshLambertMaterial({ color: 0xc9a13b }), // gold
      new THREE.MeshLambertMaterial({ color: 0x2f6e4f }), // deep green
      new THREE.MeshLambertMaterial({ color: 0x7a4da8 }), // plum
    ];
    const matGarland = new THREE.MeshLambertMaterial({ color: 0x244d2e }); // dark evergreen

    // --- geometries (shared) ---------------------------------------------
    const candleGeo  = new THREE.ConeGeometry(0.07, 0.20, 6);  // smaller for tighter tree
    const baubleGeo  = new THREE.SphereGeometry(0.10, 7, 5);
    const garlandGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
    const starGeo    = new THREE.OctahedronGeometry(0.28);

    // --- candles: dense perimeter of each layer --------------------------
    // For each layer we place candles on the 4 outer edges/corners, proud of the
    // surface by 0.3 units so they project outward and are clearly visible.
    // Layer outer extents (cube-face edge, cube centre ± 0.5):
    //   layer0 y=1..2, outer face at ±2.5 → r≈2.8
    //   layer1 y=2..3, outer face at ±2.0 → r≈2.3
    //   layer2 y=3..4, outer face at ±1.5 → r≈1.8
    //   layer3 y=4..5, outer face at ±1.0 → r≈1.3
    //   layer4 y=5..6, outer face at ±0.5 → r≈0.8
    // We use a circular approximation — n candles evenly spread at radius r,
    // one candle per edge-unit (perimeter ≈ 4*side) so density is high.
    const candleTiers = [
      { cy: 1.7, r: 2.8, n: 8 },  // layer0 (5×5) — 8 candles around perimeter
      { cy: 2.7, r: 2.3, n: 7 },  // layer1 (4×4)
      { cy: 3.7, r: 1.8, n: 6 },  // layer2 (3×3)
      { cy: 4.7, r: 1.3, n: 5 },  // layer3 (2×2)
      { cy: 5.7, r: 0.8, n: 2 },  // layer4 (1×1)
    ];
    // Total candles: 8+7+6+5+2 = 28, one per layer perimeter segment, staggered between tiers.
    for (let ti = 0; ti < candleTiers.length; ti++) {
      const { cy, r, n } = candleTiers[ti];
      for (let i = 0; i < n; i++) {
        const angle = (i / n) * Math.PI * 2 + ti * 0.61; // stagger tiers
        const m = new THREE.Mesh(candleGeo, matCandle);
        m.position.set(
          Math.cos(angle) * r,
          cy,
          Math.sin(angle) * r
        );
        m.userData.flicker = true;
        g.add(m);
      }
    }

    // --- baubles: outer perimeter, offset from candle angles --------------
    const baubleSpecs = [
      { cy: 1.5, r: 2.7, n: 4 },
      { cy: 2.5, r: 2.2, n: 3 },
      { cy: 3.5, r: 1.7, n: 3 },
      { cy: 4.5, r: 1.2, n: 2 },
    ];
    for (let ti = 0; ti < baubleSpecs.length; ti++) {
      const { cy, r, n } = baubleSpecs[ti];
      for (let i = 0; i < n; i++) {
        const angle = (i / n) * Math.PI * 2 + ti * 1.1 + 0.5;
        const m = new THREE.Mesh(baubleGeo, matBaubles[(ti + i) % matBaubles.length]);
        m.position.set(Math.cos(angle) * r, cy, Math.sin(angle) * r);
        g.add(m);
      }
    }

    // --- garland: 14 small cubes in a descending helix -------------------
    // Helix descends y=6 → y=1.5; radius follows outer edge profile top→bottom.
    const GARLAND_N = 14;
    for (let i = 0; i < GARLAND_N; i++) {
      const t = i / (GARLAND_N - 1);    // 0..1
      const angle = t * Math.PI * 4.0;  // ~2 full turns
      const y = 6.0 - t * 4.5;          // y: 6 → 1.5
      const r = 0.6 + t * 2.1;          // radius: 0.6 → 2.7
      const m = new THREE.Mesh(garlandGeo, matGarland);
      m.position.set(Math.cos(angle) * r, y, Math.sin(angle) * r);
      g.add(m);
    }

    // --- star: glowing octahedron at the very top, tagged for twinkle ----
    const star = new THREE.Mesh(starGeo, matStar);
    star.position.set(0, 7.1, 0);
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

  // Place a warm candlelight glow quad over a window cell, facing outward.
  // Uses a NEW per-mesh MeshBasicMaterial (unlit, warm amber) sized to cover one
  // window pane. The material is NOT flagged sharedMaterial, so clear() disposes it.
  addWindowGlow(x, y, z, yaw) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffce6b,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      side: THREE.DoubleSide, // visible from outside whichever wall it sits on
    });
    const geo = new THREE.PlaneGeometry(0.7, 0.75);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.y = yaw;
    mesh.position.set(x, y, z);
    mesh.frustumCulled = false;
    mesh.userData.ownGeometry = true;
    // Do NOT set sharedMaterial — this material is per-mesh and must be disposed.
    this.scene.add(mesh);
    this.objects.push(mesh);
  }

  // Build a flat cutout quad for TILE tile and add it to the scene + this.objects.
  // Reuses floraLayer's crossGeom approach: two crossed quads with the atlas UV,
  // the shared cutout material, and white vertex colours so the texture shows as-is.
  addBillboard(tile, x, y, z, yaw) {
    const [u0, v0, u1, v1] = tileUV(tile);
    const h = 1, w = 0.5;
    const pos = [-w, 0, 0, w, 0, 0, w, h, 0, -w, h, 0, 0, 0, -w, 0, 0, w, 0, h, w, 0, h, -w];
    const uv  = [u0, v0, u1, v0, u1, v1, u0, v1, u0, v0, u1, v0, u1, v1, u0, v1];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color',    new THREE.Float32BufferAttribute(new Array(24).fill(1), 3));
    geo.setAttribute('aGlint',   new THREE.Float32BufferAttribute(new Array(8).fill(0), 1));
    geo.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, getMaterials().cutout);
    mesh.frustumCulled = false;
    mesh.rotation.y = yaw;
    mesh.position.set(x, y, z);
    mesh.userData.ownGeometry = true;
    mesh.userData.sharedMaterial = true; // cutout material is shared — don't dispose it
    this.scene.add(mesh);
    this.objects.push(mesh);
  }

  clear() {
    for (const o of this.objects) {
      this.scene.remove(o);
      o.traverse(c => {
        if (c.geometry) c.geometry.dispose();
        // Only dispose materials that the object owns (not the shared cutout material)
        if (c.material && !c.userData.sharedMaterial) c.material.dispose();
      });
    }
    this.objects.length = 0;
    this._lit = [];
  }
}
