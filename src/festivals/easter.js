// festivals/easter.js — Eastertide dressing for the moor.
//
// Period-accurate c.1900 NYM customs: pace-eggs (hard-boiled eggs dyed or
// decorated wi' patterns, traditional in North Yorkshire) scattered on the
// green for rolling, and the chapel dressed in spring-white greenery for the
// Easter service. No gating in here — SeasonalLayer calls this only inside the
// Eastertide window (yearPhase ≈ 0.180).
//
// ctx = { scene, world, gen, cx, cz, season, snowAccum, objects, lit, robins }
import * as THREE from 'three';
import { hash2i } from '../noise.js';
import { B, TILE } from '../defs.js';
import { addBillboard, isOpenGround } from '../festivalKit.js';

const RADIUS = 48;

// Pace-egg colours — bright but plausible for naturally-dyed eggs c.1900:
// onion-skin orange/red, woad blue, weld yellow, walnut brown, madder crimson.
const EGG_COLORS = [
  0xd46030,  // onion-skin orange-red
  0xc8a028,  // weld yellow
  0x8b1a24,  // madder crimson
  0x3a6030,  // weld green (overdy)
  0x4a5878,  // woad blue-grey
  0xb87840,  // walnut brown
  0xe8c060,  // pale yolk yellow
  0x9a3030,  // deeper red-brown
];

// Wildflower palette for the 'Fine' colour scatter — primroses, violets,
// daisies, celandines: the flowers actually out at Eastertide on the moor edge.
const WILDFLOWER_COLORS = [0xf2e28a, 0x8a6fb8, 0xf5f0e0, 0xf0c040, 0xd88ab0];

export function buildEaster(ctx) {
  const { scene, world, gen, cx, cz, objects } = ctx;
  const fine = !!ctx.fine;

  for (const v of (gen.geo.villages || [])) {
    if (Math.abs(v.x - cx) > RADIUS || Math.abs(v.z - cz) > RADIUS) continue;

    // -- Pace-eggs on the green and closes --
    // Scatter 4-8 eggs per village on green/closes cells, sitting on the grass.
    // deterministically placed (hash-gated), in a low scatter near the centre.
    let eggCount = 0;
    for (let r = 2; r < 18 && eggCount < 8; r++) {
      for (let a = 0; a < 16 && eggCount < 8; a++) {
        const angle = (a / 16) * Math.PI * 2;
        const x = v.x + Math.round(r * Math.cos(angle));
        const z = v.z + Math.round(r * Math.sin(angle));
        const col = gen.geo.villageColumn(x, z);
        if (!isOpenGround(world, v, x, z, col)) continue;   // green/closes in the stylised world; any open ground in the real moor
        const sy = gen.height(x, z);
        // Sparse gate: place when hash <= 0.30, skip otherwise — ~30% of qualifying cells
        if (hash2i(x, z, gen.geo.seed ^ 0x7be4) > 0.30) continue;
        // Pick colour deterministically from the palette
        const colorIdx = Math.floor(hash2i(x, z, 0x4e9a) * EGG_COLORS.length);
        const yaw = hash2i(x, z, 0xa3c1) * Math.PI * 2;
        const egg = buildPaceEgg(EGG_COLORS[colorIdx]);
        egg.rotation.y = yaw;
        // Lay the egg on its side — tip slightly, random yaw already set
        egg.rotation.z = 0.35 + hash2i(x, z, 0x2f8b) * 0.5;
        egg.position.set(x + 0.5, sy + 1.06, z + 0.5);
        scene.add(egg);
        objects.push(egg);
        eggCount++;
      }
    }

    // -- 'Fine': spring GARLANDS on cottage doors — a small evergreen-and-
    // flower hoop over each lintel (cottages / shops / pubs), kept gentle.
    if (fine) {
      for (const b of (v.buildings || [])) {
        if (b.type !== 'cottage' && b.type !== 'shop' && b.type !== 'pub') continue;
        const midX = Math.floor((b.x0 + b.x1) / 2);
        const doorY = gen.height(midX, b.z0) + 2.2; // just above the lintel
        const garland = buildDoorGarland(hash2i(b.x0, b.z0, 0x15c9));
        garland.position.set(midX + 0.5, doorY, b.z0 - 0.12);
        scene.add(garland);
        objects.push(garland);
      }
    }

    // -- 'Fine': a WILDFLOWER colour scatter near the green — little clumps of
    // primrose/violet/daisy colour lifting the spring grass. Cap 14 per village.
    if (fine) {
      let flowerCount = 0;
      for (let r = 2; r < 16 && flowerCount < 14; r++) {
        for (let a = 0; a < 14 && flowerCount < 14; a++) {
          const angle = (a / 14) * Math.PI * 2 + 0.22;
          const x = v.x + Math.round(r * Math.cos(angle));
          const z = v.z + Math.round(r * Math.sin(angle));
          const col = gen.geo.villageColumn(x, z);
          if (!isOpenGround(world, v, x, z, col)) continue;
          const hv = hash2i(x, z, gen.geo.seed ^ 0x33d1);
          if (hv > 0.28) continue;
          const sy = gen.height(x, z);
          const clump = buildWildflowerClump(hv);
          clump.position.set(x + 0.5, sy + 1, z + 0.5);
          scene.add(clump);
          objects.push(clump);
          flowerCount++;
        }
      }
    }

    // -- Deck the chapel in spring-white greenery --
    // Pale-green / white sprig billboards along the front (z0) wall +
    // a single small sprig arrangement above the door.
    for (const b of (v.buildings || [])) {
      if (b.type !== 'chapel') continue;
      const midX = Math.floor((b.x0 + b.x1) / 2);
      deckChapelEaster(scene, objects, b, midX, gen);
    }
  }
}

// 'Fine' only: a small spring garland hoop for a cottage door — a green torus
// hung vertically against the wall wi' a few wildflower dots round it.
function buildDoorGarland(seed) {
  const g = new THREE.Group();
  const matGreen = new THREE.MeshLambertMaterial({ color: 0x4a7a40 }); // fresh spring green
  const RING_R = 0.3;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(RING_R, 0.055, 5, 14), matGreen);
  // TorusGeometry lies in the XY plane — already vertical, flat against a z-facing wall
  g.add(ring);
  const FLOWER_N = 6;
  for (let i = 0; i < FLOWER_N; i++) {
    const a = (i / FLOWER_N) * Math.PI * 2 + seed * 6.28;
    const mat = new THREE.MeshLambertMaterial({ color: WILDFLOWER_COLORS[(i + Math.floor(seed * 5)) % WILDFLOWER_COLORS.length] });
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 5, 4), mat);
    dot.position.set(Math.cos(a) * RING_R, Math.sin(a) * RING_R, 0.03);
    g.add(dot);
  }
  g.userData.wow = 'doorGarland';
  return g;
}

// 'Fine' only: a tiny wildflower clump — 3-5 colour dots on wee green stems,
// ~0.25 blocks tall. Cheap Lambert spheres; the colour is the point.
function buildWildflowerClump(seed) {
  const g = new THREE.Group();
  const matStem = new THREE.MeshLambertMaterial({ color: 0x3e6e34 });
  const n = 3 + Math.floor(seed * 3); // 3..5 flowers
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + seed * 9;
    const rx = Math.cos(a) * 0.14, rz = Math.sin(a) * 0.14;
    const h = 0.14 + ((seed * 13 + i) % 1) * 0.1;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, h, 4), matStem);
    stem.position.set(rx, h / 2, rz);
    g.add(stem);
    const mat = new THREE.MeshLambertMaterial({ color: WILDFLOWER_COLORS[(i + Math.floor(seed * 7)) % WILDFLOWER_COLORS.length] });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.045, 5, 4), mat);
    head.position.set(rx, h + 0.03, rz);
    g.add(head);
  }
  g.userData.wow = 'wildflowers';
  return g;
}

// A pace-egg: a slightly elongated sphere (egg shape) in one vivid colour.
// Scale: x/z ≈ 0.18, y ≈ 0.22 — sits visibly on the ground without looking huge.
// A thin pale stripe band is painted on (a slightly wider, flat disc mid-egg)
// — evokes the wrapped-onion-skin dye technique.
function buildPaceEgg(color) {
  const g = new THREE.Group();
  const matEgg   = new THREE.MeshLambertMaterial({ color });
  // Stripe in a complementary / contrasting pale tone
  const stripeColor = blendWithWhite(color, 0.45);
  const matStripe = new THREE.MeshLambertMaterial({ color: stripeColor });

  // Egg body — a sphere scaled to egg proportions
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.11, 9, 7), matEgg);
  body.scale.set(1.0, 1.25, 1.0); // elongate on y for egg shape
  body.position.y = 0.0;
  g.add(body);

  // Decorative stripe band — a thin flat torus around the equator
  const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.10, 0.022, 5, 14), matStripe);
  stripe.rotation.x = Math.PI / 2;
  stripe.position.y = 0.0;
  g.add(stripe);

  return g;
}

// Mix a hex colour toward white by `t` (0=original, 1=white).
// Used to derive the egg stripe from the base colour.
function blendWithWhite(hex, t) {
  const r = ((hex >> 16) & 0xff);
  const gr = ((hex >> 8) & 0xff);
  const b_ = (hex & 0xff);
  const lerp = (a, bb) => Math.round(a + (bb - a) * t);
  return (lerp(r, 255) << 16) | (lerp(gr, 255) << 8) | lerp(b_, 255);
}

// Deck the chapel for Easter in spring-white:
//   - HOLLY_SPRIG billboards (the only atlas tile available; greenery reads fine
//     in spring given the season is post-frost, and period churches used ivy,
//     box, and early greenery for Easter dressing)
//   - Small pale sprig mesh clusters for variety — white/pale-green colour
//   - Slightly higher placement than the winter swag (Easter = light, airy)
function deckChapelEaster(scene, objects, b, midX, gen) {
  const wallY = gen.height(midX, b.z0) + 2.5;  // eave height — slight lift
  const doorY = gen.height(midX, b.z0) + 2.85; // porch arch

  // Alternate sprigs and small mesh sprig-clusters along the front wall
  for (let wx = b.x0 + 1; wx <= b.x1 - 1; wx++) {
    if (wx % 2 === 0) {
      // Billboard sprig (holly_sprig atlas tile — reads as leafy greenery)
      const yaw = hash2i(wx, b.z0, 0xf1d3) * Math.PI * 2;
      addBillboard(scene, objects, TILE.HOLLY_SPRIG, wx + 0.5, wallY, b.z0 - 0.1, yaw);
    } else {
      // Pale spring sprig mesh — small pale-green/white box cluster
      const sprig = buildSpringSprig();
      sprig.position.set(wx + 0.5, wallY, b.z0 - 0.14);
      scene.add(sprig);
      objects.push(sprig);
    }
  }

  // Centred arrangement above the door — a fuller billboard
  const doorYaw = hash2i(midX, b.z0, 0x3c8e) * Math.PI * 2;
  addBillboard(scene, objects, TILE.HOLLY_SPRIG, midX + 0.5, doorY, b.z0 - 0.1, doorYaw);
}

// A tiny spring sprig mesh: a small cluster of pale-green/white box leaves
// mounted flat against the wall. ~0.3 block wide.
// Much smaller + lighter than a Christmas swag — evokes box, ivy, or early foliage.
function buildSpringSprig() {
  const g = new THREE.Group();
  const matLeaf  = new THREE.MeshLambertMaterial({ color: 0xa8c898 }); // pale spring green
  const matWhite = new THREE.MeshLambertMaterial({ color: 0xecf4e8 }); // white-green

  // A few small leaf boxes splayed from a centre
  const leaves = [
    { x: 0,     y: 0.04,  z: 0, rx: 0,    ry: 0,   s: 0.16 },
    { x: -0.08, y: 0.06,  z: 0, rx: 0.3,  ry: 0.4, s: 0.11 },
    { x:  0.08, y: 0.06,  z: 0, rx: -0.3, ry:-0.4, s: 0.11 },
    { x:  0,    y: 0.10,  z: 0, rx: 0.5,  ry: 0,   s: 0.09 },
  ];
  for (let i = 0; i < leaves.length; i++) {
    const { x, y, z, rx, ry, s } = leaves[i];
    const mat = i % 2 === 0 ? matLeaf : matWhite;
    const m = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.5, s * 0.3), mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    g.add(m);
  }

  return g;
}
