// festivals/mayday.js — May Day dressing for the moor. (spec §7)
//
// Victorian-revival custom, period-accurate c.1900 NYM: a beribboned maypole
// on the village green, and a flower garland swag around the base of the stone
// cross. No fairground nonsense — a simple dressed pole wi' spiralling ribbons
// in Maytime colours, and a greenery ring on the cross.
//
// Same ctx shape as all festival builders:
//   ctx = { scene, world, gen, cx, cz, season, snowAccum, objects, lit, robins }
// Everything pushed to ctx.objects for SeasonalLayer teardown. One maypole per
// village, deterministic placement on an open green cell near the centre.
import * as THREE from 'three';
import { hash2i } from '../noise.js';
import { B } from '../defs.js';

const RADIUS = 48;

// Bright Maytime palette — red, white, blue, yellow, green, pink
const RIBBON_COLORS = [
  0xcc2222, // red
  0xeeeedd, // cream/white
  0x2255bb, // blue
  0xddcc22, // yellow
  0x33aa44, // green
  0xdd55aa, // pink
];

// ctx = { scene, world, gen, cx, cz, season, snowAccum, objects, lit, robins }
export function buildMayDay(ctx) {
  const { scene, world, gen, cx, cz, objects } = ctx;

  for (const v of (gen.geo.villages || [])) {
    if (Math.abs(v.x - cx) > RADIUS || Math.abs(v.z - cz) > RADIUS) continue;

    // -- Maypole on an open green cell near the centre (not on the cross) --
    const fp = greenPlacement(world, v);
    if (fp) {
      const groundY = gen.height(fp.x, fp.z) + 1;
      const pole = buildMaypole(fp.x, fp.z);
      pole.position.set(fp.x + 0.5, groundY, fp.z + 0.5);
      scene.add(pole);
      objects.push(pole);
    }

    // -- Garland ring around the stone cross base (at v.x, v.z) --
    const crossY = gen.height(v.x, v.z) + 1;
    const garland = buildCrossGarland();
    garland.position.set(v.x + 0.5, crossY, v.z + 0.5);
    scene.add(garland);
    objects.push(garland);
  }
}

// Build a Victorian-revival maypole Group, base at y=0:
//   - A pale wood CylinderGeometry pole (~7 blocks tall)
//   - A greenery garland ring (TorusGeometry) near the top with flower dots
//   - 6 spiralling ribbon strips descending from just below the top to a wider
//     base radius, in bright alternating Maytime colours
function buildMaypole(wx, wz) {
  const group = new THREE.Group();

  const matPole    = new THREE.MeshLambertMaterial({ color: 0xd4bc8a }); // pale weathered wood
  const matGarland = new THREE.MeshLambertMaterial({ color: 0x3a7a3a }); // fresh greenery
  const matFlower  = [
    new THREE.MeshLambertMaterial({ color: 0xee4488 }), // pink
    new THREE.MeshLambertMaterial({ color: 0xffffcc }), // cream white
    new THREE.MeshLambertMaterial({ color: 0xffee22 }), // yellow
  ];

  const POLE_HEIGHT = 7.0;
  const POLE_R      = 0.12;

  // -- Pole: a single pale CylinderGeometry, feet at y=0, top at y=POLE_HEIGHT --
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(POLE_R * 0.7, POLE_R, POLE_HEIGHT, 8),
    matPole
  );
  pole.position.y = POLE_HEIGHT / 2;
  group.add(pole);

  // -- Garland ring: a TorusGeometry at y ≈ POLE_HEIGHT - 0.5 (just below top)
  // Green torus + 6 small flower-dot spheres spaced around it.
  const GARLAND_Y  = POLE_HEIGHT - 0.55;
  const GARLAND_R  = 0.65; // ring radius out from pole axis
  const garlandTorus = new THREE.Mesh(
    new THREE.TorusGeometry(GARLAND_R, 0.10, 5, 16),
    matGarland
  );
  garlandTorus.rotation.x = Math.PI / 2; // lie horizontally
  garlandTorus.position.y = GARLAND_Y;
  group.add(garlandTorus);

  // Flower dots on the garland ring
  const FLOWER_COUNT = 6;
  for (let i = 0; i < FLOWER_COUNT; i++) {
    const a = (i / FLOWER_COUNT) * Math.PI * 2;
    const mat = matFlower[i % matFlower.length];
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.08, 5, 4), mat);
    dot.position.set(
      Math.cos(a) * GARLAND_R,
      GARLAND_Y,
      Math.sin(a) * GARLAND_R
    );
    group.add(dot);
  }

  // -- Spiralling ribbons: 6 long thin quads descending from just below the
  // garland to the ground in a helix. Each ribbon is a thin tapered BoxGeometry
  // angled outward and rotated around the pole axis.
  //
  // We model each ribbon as a sequence of RIBBON_SEGS small box segments placed
  // along the helix path so they form a visible curling strand. The helix radius
  // grows from ~POLE_R at the top to ~RIBBON_BASE_R at the bottom, giving the
  // classic tent-shape that reads unmistakably as a maypole.
  const RIBBON_N       = 6;
  const RIBBON_SEGS    = 10;  // segments per ribbon along the helix
  const RIBBON_BASE_R  = 1.8; // radius at ground
  const RIBBON_TOP_Y   = POLE_HEIGHT - 0.7;
  const RIBBON_W       = 0.06;
  const RIBBON_H       = 0.55; // height of each segment box

  // Shared geometry for every ribbon segment — one allocation instead of ~60
  const segGeo = new THREE.BoxGeometry(RIBBON_W, RIBBON_H, RIBBON_W * 0.5);

  for (let ri = 0; ri < RIBBON_N; ri++) {
    const mat = new THREE.MeshLambertMaterial({ color: RIBBON_COLORS[ri % RIBBON_COLORS.length] });
    // Deterministic twist offset per ribbon so they don't all start at the same angle
    const startAngle = (ri / RIBBON_N) * Math.PI * 2;

    for (let si = 0; si < RIBBON_SEGS; si++) {
      const t = si / RIBBON_SEGS;          // 0 = top, 1 = bottom
      const t1 = (si + 1) / RIBBON_SEGS;  // next segment

      // Helix: angle advances by ~3/4 turn from top to bottom across all segments
      const angle = startAngle + t * Math.PI * 1.5;
      const angle1 = startAngle + t1 * Math.PI * 1.5;
      const mid_angle = (angle + angle1) * 0.5;

      const r  = POLE_R + t  * (RIBBON_BASE_R - POLE_R);
      const r1 = POLE_R + t1 * (RIBBON_BASE_R - POLE_R);
      const mid_r = (r + r1) * 0.5;

      const y  = RIBBON_TOP_Y * (1 - t);
      const y1 = RIBBON_TOP_Y * (1 - t1);
      const mid_y = (y + y1) * 0.5;

      // Position of this segment: midpoint along the helix arc
      const px = Math.cos(mid_angle) * mid_r;
      const pz = Math.sin(mid_angle) * mid_r;

      // Segment mesh reuses the shared segGeo
      const seg = new THREE.Mesh(segGeo, mat);
      seg.position.set(px, mid_y, pz);

      // Orient the segment: yaw tangent to the helix circle + slight inward tilt
      const tangentAngle = mid_angle + Math.PI / 2;
      seg.rotation.y = tangentAngle;
      // Tilt inward toward the pole (negative because going down)
      const dr = r1 - r;
      const dy = y1 - y;
      const tiltAngle = Math.atan2(-dr, -dy) - Math.PI / 2;
      seg.rotation.z = tiltAngle * 0.5; // half-tilt reads well at this scale

      group.add(seg);
    }
  }

  return group;
}

// Build a small flower garland ring for the stone cross base: a low green torus
// with a few flower dots, sitting on the ground around the cross foot.
// Height ~ 0.25 blocks so it doesn't clash with the cross geometry above.
function buildCrossGarland() {
  const g = new THREE.Group();

  const matGreen = new THREE.MeshLambertMaterial({ color: 0x3a7a3a }); // greenery
  const matFlowerA = new THREE.MeshLambertMaterial({ color: 0xee4488 });
  const matFlowerB = new THREE.MeshLambertMaterial({ color: 0xffffcc });
  const matFlowerC = new THREE.MeshLambertMaterial({ color: 0xffee22 });
  const FLOWER_MATS = [matFlowerA, matFlowerB, matFlowerC];

  // Ring: low torus lying flat around the cross foot
  const RING_R = 0.55;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(RING_R, 0.09, 5, 16),
    matGreen
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.12; // just above ground
  g.add(ring);

  // A cluster of flower dots distributed around the ring
  const FLOWER_N = 8;
  for (let i = 0; i < FLOWER_N; i++) {
    const a = (i / FLOWER_N) * Math.PI * 2;
    const mat = FLOWER_MATS[i % FLOWER_MATS.length];
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.06, 5, 4), mat);
    dot.position.set(Math.cos(a) * RING_R, 0.15, Math.sin(a) * RING_R);
    g.add(dot);
  }

  return g;
}

// Return a deterministic open green cell near village centre for the maypole.
// Same two-pass approach as bonfire.js greenPlacement: prefer green/closes/path,
// fall back to any non-building open column. Skip the stone cross at (v.x, v.z).
function greenPlacement(world, v) {
  const gen = world.gen;
  const isPreferred = kind => kind === 'green' || kind === 'closes' || kind === 'path';
  const isOpen = (x, z, col) => {
    if (!col || col.kind === 'building') return false;
    const sy = gen.height(x, z);
    return world.getBlock(x, sy + 1, z) === B.AIR;
  };
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
  return null;
}
