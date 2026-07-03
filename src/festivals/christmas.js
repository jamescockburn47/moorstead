// festivals/christmas.js — the Christmas (Christmastide) dressing for the moor.
// Moved verbatim from the old festiveLayer.build(): one decorated fir per
// village (with carol singers), door wreaths, candlelit window glow, holly
// sprigs, and hopping robins. NO snowmen (the host owns those) and NO gating
// in here — SeasonalLayer only calls this inside the Christmastide window,
// so the whole module is the festive dressing itself.
//
// Period-accurate c.1900 refit (Slice 4):
//   • The parish fir is re-sited to the chapel forecourt (not the village green)
//     — the church was the custodian of the communal tree, not the market square.
//   • No present-pile under the public tree (an anachronism; gifts were given
//     indoors on Twelfth Night, not piled publicly under a parish tree).
//   • Parlour-window trees in farmhouses + a sparse subset of cottages — the
//     domestic tree lived behind glass, lit candles glowing out into the night.
//   • The chapel is decked with holly/ivy swags along the front (z0) wall,
//     reflecting the church's actual custom of dressing with evergreen boughs.
import * as THREE from 'three';
import { hash2i } from '../noise.js';
import { B, TILE } from '../defs.js';
import { addBillboard, addWindowGlow, isOpenGround, makeLanternString, nearbyBuildingPairs } from '../festivalKit.js';

const RADIUS = 48;

// 'Fine' window pane: warmer + brighter so the ACES/bloom stack catches it.
// Plain keeps addWindowGlow's stock amber untouched.
const FINE_PANE = { color: 0xffbe55, opacity: 0.92 };

// ctx = { scene, world, gen, cx, cz, season, snowAccum, objects, lit, robins, fx, fine }
export function buildChristmas(ctx) {
  const { scene, world, gen, cx, cz, objects, lit, robins } = ctx;
  const fine = !!ctx.fine;
  const fx = ctx.fx || [];

  // Winter firs — one per village, whole festive season (no deep-snow gate)
  for (const v of (gen.geo.villages || [])) {
    if (Math.abs(v.x - cx) > RADIUS || Math.abs(v.z - cz) > RADIUS) continue;
    const fp = chapelFirPlacement(world, v);
    if (fp) {
      const g = buildFir();
      g.position.set(fp.x + 0.5, gen.height(fp.x, fp.z) + 1, fp.z + 0.5);
      scene.add(g);
      objects.push(g);
      g.traverse(c => { if (c.isMesh && c.userData.flicker) lit.push(c); });

      // -- 'Fine': the tree candles actually GLIMMER — the unlit candle/star
      // materials pulse above white so the bloom catches each waver. One fx
      // callback per fir; the materials are per-fir so teardown disposes them.
      if (fine) {
        const glims = [];
        g.traverse(c => {
          if (c.isMesh && c.material && c.material.userData && c.material.userData.glimmer &&
              glims.indexOf(c.material) < 0) glims.push(c.material);
        });
        const bases = glims.map(m => m.color.clone());
        fx.push(t => {
          for (let i = 0; i < glims.length; i++) {
            // candlelight waver: 1.1×..1.8× base — over the bloom threshold at the peaks
            const k = 1.1 + 0.35 * (1 + Math.sin(t * 4.3 + i * 2.1)) * (0.7 + 0.3 * Math.sin(t * 9.7 + i));
            glims[i].color.copy(bases[i]).multiplyScalar(k);
          }
        });
      }

      // -- 'Fine': LANTERN STRINGS — catenaries of warm emissive lanterns strung
      // between the buildings round the parish tree, swaying gently. Up to 3
      // strings per village, ≤9 lanterns each (pooled meshes, no per-frame alloc).
      if (fine) {
        const pairs = nearbyBuildingPairs(v, fp.x, fp.z, 3, 18);
        for (let pi = 0; pi < pairs.length; pi++) {
          const [a, b] = pairs[pi];
          const ax = (a.x0 + a.x1) / 2, az = (a.z0 + a.z1) / 2;
          const bx = (b.x0 + b.x1) / 2, bz = (b.z0 + b.z1) / 2;
          const p0 = { x: ax + 0.5, y: gen.height(Math.round(ax), Math.round(az)) + 3.6, z: az + 0.5 };
          const p1 = { x: bx + 0.5, y: gen.height(Math.round(bx), Math.round(bz)) + 3.6, z: bz + 0.5 };
          if (Math.hypot(p1.x - p0.x, p1.z - p0.z) < 3) continue; // same stoop — skip
          const str = makeLanternString(p0, p1, { seed: pi * 0.37 });
          scene.add(str);
          objects.push(str);
          fx.push(t => str.swayTick(t));
        }
      }

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
        const carol = buildCaroller(ci);
        // Face toward the fir centre
        carol.rotation.y = Math.atan2(fp.x - cx2, fp.z - cz2);
        carol.position.set(cx2 + 0.5, cy, cz2 + 0.5);
        scene.add(carol);
        objects.push(carol);
      }
    }
  }

  // -- Door wreaths on cottages (whole festive season, no deep-snow gate) --
  // -- Parlour-window trees on farmhouses + sparse cottages                --
  // -- Church greenery (holly swags) on the chapel front wall              --
  for (const v of (gen.geo.villages || [])) {
    if (Math.abs(v.x - cx) > RADIUS || Math.abs(v.z - cz) > RADIUS) continue;
    for (const b of (v.buildings || [])) {
      const midX = Math.floor((b.x0 + b.x1) / 2);

      // ---- chapel: holly/ivy greenery swags along front wall ----
      if (b.type === 'chapel') {
        deckChapel(scene, objects, b, midX, gen);
        continue; // no wreath or generic window-glow on the chapel
      }

      // ---- door wreaths (cottage / shop / pub) ----
      if (b.type !== 'cottage' && b.type !== 'shop' && b.type !== 'pub' && b.type !== 'farmhouse') continue;

      // Wreath: south wall (lowest z = b.z0), centred on x — not on farmhouse
      // (farmhouses are larger; visual clutter; they get the parlour tree instead)
      if (b.type !== 'farmhouse') {
        const doorX = midX + 0.5;
        const doorZ = b.z0;
        const doorY = gen.height(midX, doorZ) + 2; // head height above ground
        addBillboard(scene, objects, TILE.WREATH, doorX, doorY, doorZ - 0.15, 0);
      }

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
          addWindowGlow(scene, objects, glowX, glowY, glowZ, yaw, fine ? FINE_PANE : undefined);
        }
      }

      // -- Parlour-window tree: farmhouse (always) + ~1-2 cottages per village --
      // The domestic tree lived in the best parlour, small + lit, visible through
      // the front window. Placed just inside the south (z0) wall at window height.
      const wantsParlourTree = b.type === 'farmhouse' ||
        (b.type === 'cottage' && hash2i(b.x0, b.z0, gen.geo.seed ^ 0xc7d3) < 0.18);
      if (wantsParlourTree) {
        addParlourTree(scene, objects, lit, b, g, fine);
      }
    }
  }

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
        if (!isOpenGround(world, v, x, z, col)) continue;   // green/closes in the stylised world; any open ground in the real moor
        const sy = gen.height(x, z);
        // deterministic sparse gate — different offsets for holly vs robin
        const hval = hash2i(x, z, gen.geo.seed ^ 0xb4c7);
        if (hollyCount < 5 && hval < 0.22) {
          const yaw = hash2i(x, z, 0x4f3a) * Math.PI * 2;
          addBillboard(scene, objects, TILE.HOLLY_SPRIG, x + 0.5, sy + 1, z + 0.5, yaw);
          hollyCount++;
        } else if (robinCount < 4 && hval > 0.78 && hval < 0.92) {
          const yaw = hash2i(x, z, 0x9e2b) * Math.PI * 2;
          const groundY = sy + 1;
          const robin = buildRobin();
          robin.rotation.y = yaw;
          robin.position.set(x + 0.5, groundY, z + 0.5);
          robin.userData.groundY = groundY;
          robin.userData.hopPhase = robinCount * 1.3 + r * 0.4; // vary per bird
          scene.add(robin);
          objects.push(robin);
          robins.push(robin);
          robinCount++;
        }
      }
    }
  }
}

// The fir's base tier is hw=3 (see the carol-singer comment in buildChristmas),
// so a valid site needs every cell within FIR_CLEAR of the trunk clear of ALL
// building footprints — the old single-cell check let the canopy wedge into a
// snicket between two walls (James's screenshot, 2026-07-03).
const FIR_CLEAR = 4;
function clearOfBuildings(v, x, z, r = FIR_CLEAR) {
  return !(v.buildings || []).some(b =>
    x >= b.x0 - r && x <= b.x1 + r && z >= b.z0 - r && z <= b.z1 + r);
}

// Re-site the parish fir to the chapel forecourt (south / z0 face).
// Scans candidate cells south of the chapel front, picks the first open-ground
// cell whose WHOLE canopy footprint clears every building. Falls back to the
// green/open-ground scan (also clearance-checked) if the forecourt is hemmed in.
function chapelFirPlacement(world, v) {
  const gen = world.gen;
  const chapel = (v.buildings || []).find(b => b.type === 'chapel');
  if (chapel) {
    const centreX = Math.floor((chapel.x0 + chapel.x1) / 2);
    // start FIR_CLEAR out so the canopy clears the chapel wall itself
    for (let dz = FIR_CLEAR; dz <= FIR_CLEAR + 5; dz++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = centreX + dx;
        const z = chapel.z0 - dz; // south of the front (south = lower z in this world)
        if (!clearOfBuildings(v, x, z)) continue;
        const sy = gen.height(x, z);
        if (world.getBlock(x, sy + 1, z) === B.AIR) return { x, z };
      }
    }
    // chapel found but forecourt is hemmed in — fall back below
  }
  // fallback: green/path/any-open scan, same clearance rule
  return firPlacement(world, v);
}

// Return a deterministic open cell near the village for the fir — expanding
// rings out to the village edge, so a tight-packed centre pushes the tree OUT
// toward the green/edge rather than wedging it between roofs.
// Scans expanding rings with 16 angle steps per radius.
// Pass 1 prefers green/closes/path kinds (open ground); pass 2 accepts any
// non-building column so every village style (capital, cluster, longgreen,
// clifftop) gets a fir even when no green/closes cell exists near centre.
// The hash-gate from the old code is removed — it rejected ~65% of valid
// candidates and caused most villages to return null. Iteration order is
// fixed so the result is deterministic per seed without a hash gate.
function firPlacement(world, v) {
  const gen = world.gen;
  const isPreferred = kind => kind === 'green' || kind === 'closes' || kind === 'path';
  const isOpen = (x, z, col) => {
    if (!col || col.kind === 'building') return false;
    const sy = gen.height(x, z);
    return world.getBlock(x, sy + 1, z) === B.AIR;
  };
  const maxR = Math.max(14, Math.round(v.radius || 14)); // out to the village edge
  // Pass 1: preferred kinds (green/closes/path) — gives a good spot on
  // village greens and market squares first. Canopy clearance enforced.
  for (let r = 4; r <= maxR; r++) {
    for (let ai = 0; ai < 16; ai++) {
      const angle = (ai / 16) * Math.PI * 2;
      const x = v.x + Math.round(r * Math.cos(angle));
      const z = v.z + Math.round(r * Math.sin(angle));
      if (x === v.x && z === v.z) continue; // skip the stone cross
      const col = gen.geo.villageColumn(x, z);
      if (!col || !isPreferred(col.kind)) continue;
      if (!clearOfBuildings(v, x, z)) continue;
      if (!isOpen(x, z, col)) continue;
      return { x, z };
    }
  }
  // Pass 2: any non-building open column (handles village styles where the
  // centre is all closes with no explicit green/path near the cross).
  for (let r = 4; r <= maxR; r++) {
    for (let ai = 0; ai < 16; ai++) {
      const angle = (ai / 16) * Math.PI * 2;
      const x = v.x + Math.round(r * Math.cos(angle));
      const z = v.z + Math.round(r * Math.sin(angle));
      if (x === v.x && z === v.z) continue;
      const col = gen.geo.villageColumn(x, z);
      if (!clearOfBuildings(v, x, z)) continue;
      if (!isOpen(x, z, col)) continue;
      return { x, z };
    }
  }
  return null; // genuinely no open cell in range (shouldn't happen in a real village)
}

// Place holly/ivy greenery swags along the chapel's front (south, z0) wall.
// Several HOLLY_SPRIG billboards at head height across the front face, plus
// one centred over the door arch — period church would dress with evergreen
// boughs hung from the eaves and the porch, not a tree.
function deckChapel(scene, objects, b, midX, gen) {
  const wallY = gen.height(midX, b.z0) + 2.4; // slightly above head height — eave level
  const doorY = gen.height(midX, b.z0) + 2.8; // a touch higher over the door arch

  // One sprig every 2 blocks across the south face (not corner cells)
  for (let wx = b.x0 + 1; wx <= b.x1 - 1; wx += 2) {
    const yaw = hash2i(wx, b.z0, 0xd3c9) * Math.PI * 2;
    addBillboard(scene, objects, TILE.HOLLY_SPRIG, wx + 0.5, wallY, b.z0 - 0.1, yaw);
  }

  // Extra sprig centred over the door — slightly higher (porch arch)
  const doorYaw = hash2i(midX, b.z0, 0xa7f1) * Math.PI * 2;
  addBillboard(scene, objects, TILE.HOLLY_SPRIG, midX + 0.5, doorY, b.z0 - 0.1, doorYaw);
}

// Build a small lit parlour-window tree Group, placed just inside the south
// (z0) face of the building at window height, with a warm glow quad in front
// of it. The tree is a miniature stepped conifer (~1 block tall, 3 layers of
// green MeshLambertMaterial boxes + a tiny warm cap) — the parlour tree lived
// inside and was small enough to fit on a side-table. The glow reads from
// outside as a lit, ornamented tree silhouette behind glass.
function addParlourTree(scene, objects, lit, b, groundY, fine = false) {
  // Position: just inside the south wall (z = b.z0 + 0.6) at window height (groundY + 2)
  // Centred on the building's x (the main front window bay).
  const midX = (b.x0 + b.x1) / 2 + 0.5;
  const treeZ = b.z0 + 0.6;
  const treeY = groundY + 2;   // window-sill height — sits on the table, in the window

  const treeGroup = new THREE.Group();

  const matLeaf  = new THREE.MeshLambertMaterial({ color: 0x2f5d3a }); // deep fir green
  const matStar  = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });   // pale gold, unlit (flickers)

  // Three stepped layers, each 0.3 tall — bottom→top: 3×3, 2×2, 1×1 footprint
  // Each layer is a single flat box (rather than individual unit cubes) at this scale;
  // the silhouette reads clearly from outside as a Christmas-tree outline.
  const geoUnit = new THREE.BoxGeometry(1, 1, 1);
  const layers = [
    { yOff: 0.15, size: 0.55, h: 0.30 }, // base tier — widest
    { yOff: 0.50, size: 0.38, h: 0.28 }, // mid
    { yOff: 0.82, size: 0.22, h: 0.25 }, // top
  ];
  for (const { yOff, size, h } of layers) {
    const geo = new THREE.BoxGeometry(size, h, size * 0.5);
    const m = new THREE.Mesh(geo, matLeaf);
    m.position.set(0, yOff, 0);
    treeGroup.add(m);
  }

  // Tiny star at the top — tagged flicker so the SeasonalLayer animates it
  const starGeo = new THREE.OctahedronGeometry(0.075);
  const star = new THREE.Mesh(starGeo, matStar);
  star.position.set(0, 1.10, 0);
  star.userData.flicker = true;
  treeGroup.add(star);

  treeGroup.position.set(midX, treeY, treeZ);
  scene.add(treeGroup);
  objects.push(treeGroup);
  treeGroup.traverse(c => { if (c.isMesh && c.userData.flicker) lit.push(c); });

  // Warm glow quad just outside the south wall — reads as light spilling out
  // through the window from the lit parlour tree.
  addWindowGlow(scene, objects, midX, treeY + 0.4, b.z0 - 0.05, 0, fine ? FINE_PANE : undefined);
}

// Build a small child caroller figure Group, feet at y=0, height ≈1.6.
// Roughly 0.7× the scale of a snowman. i selects coat colour (0..3).
function buildCaroller(i) {
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
function buildRobin() {
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
function buildFir() {
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

  dressFir(g);
  // NOTE: buildPresents() is defined below but no longer called here.
  // The present-pile was anachronistic for c.1900 — gifts were given indoors,
  // not stacked under a public tree. The function is retained for reference.
  return g;
}

// buildPresents: defined but no longer called (removed from buildFir in Slice 4).
// Retained as dead code rather than deleted, in case a future slice wants a
// private indoor gift-pile scene.
// Add ~22 wrapped present boxes piled in a ring/heap around the trunk base (y≈0).
// Three rings: inner (r≈0.9, 6 presents), mid (r≈1.6, 9 presents), outer (r≈2.4, 7 presents).
function buildPresents(g) { // eslint-disable-line no-unused-vars
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
function dressFir(g) {
  // --- materials -------------------------------------------------------
  const matCandle  = new THREE.MeshBasicMaterial({ color: 0xffdf8a }); // warm candlelight
  const matStar    = new THREE.MeshBasicMaterial({ color: 0xfff2b0 }); // pale gold glow
  // tagged for the 'Fine' glimmer pulse (buildChristmas collects these; on Plain
  // the tag is inert and the colours stay exactly as above)
  matCandle.userData.glimmer = true;
  matStar.userData.glimmer = true;
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
