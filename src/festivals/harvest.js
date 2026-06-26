// festivals/harvest.js — Harvest Home (Michaelmas season) dressing for the moor.
//
// Period-accurate c.1900 NYM customs: corn stooks on the green/closes after the
// harvest is in, a woven corn dolly near the chapel cross, and the chapel itself
// dressed wi' sheaves along the front wall for the harvest festival service.
// No gating in here — SeasonalLayer only calls this inside the harvest window.
//
// ctx = { scene, world, gen, cx, cz, season, snowAccum, objects, lit, robins }
import * as THREE from 'three';
import { hash2i } from '../noise.js';
import { B, TILE } from '../defs.js';
import { addBillboard, isOpenGround } from '../festivalKit.js';

const RADIUS = 48;

// Pale straw-gold colours for all harvest props
const STRAW_GOLD   = 0xd4a94a;
const STRAW_LIGHT  = 0xe8c96a;
const STRAW_DARK   = 0x8b6b28;
const BIND_BROWN   = 0x7a5c2a;

export function buildHarvest(ctx) {
  const { scene, world, gen, cx, cz, objects } = ctx;

  for (const v of (gen.geo.villages || [])) {
    if (Math.abs(v.x - cx) > RADIUS || Math.abs(v.z - cz) > RADIUS) continue;

    // -- Corn stooks on the green and closes --
    // Scan radially, 4-20 blocks out; green/closes cells only; hash-gated;
    // cap at 6 stooks per village so the scene isn't cluttered.
    let stookCount = 0;
    for (let r = 3; r < 20 && stookCount < 6; r++) {
      for (let a = 0; a < 16 && stookCount < 6; a++) {
        const angle = (a / 16) * Math.PI * 2;
        const x = v.x + Math.round(r * Math.cos(angle));
        const z = v.z + Math.round(r * Math.sin(angle));
        const col = gen.geo.villageColumn(x, z);
        if (!isOpenGround(world, v, x, z, col)) continue;   // green/closes in the stylised world; any open ground in the real moor
        const sy = gen.height(x, z);
        // Sparse gate: place when hash <= 0.35, skip otherwise — ~35% of qualifying cells
        if (hash2i(x, z, gen.geo.seed ^ 0xe3a7) > 0.35) continue;
        const yaw = hash2i(x, z, 0x5b3c) * Math.PI * 2;
        const stook = buildStook();
        stook.rotation.y = yaw;
        stook.position.set(x + 0.5, sy + 1, z + 0.5);
        scene.add(stook);
        objects.push(stook);
        stookCount++;
      }
    }

    // -- Corn dolly near the chapel (or village centre if no chapel) --
    const chapel = (v.buildings || []).find(b => b.type === 'chapel');
    const dollyPos = chapelForecourtCell(world, v, chapel);
    if (dollyPos) {
      const dolly = buildCornDolly();
      dolly.position.set(dollyPos.x + 0.5, gen.height(dollyPos.x, dollyPos.z) + 1, dollyPos.z + 0.5);
      scene.add(dolly);
      objects.push(dolly);
    }

    // -- Deck the chapel for harvest festival --
    // Sheaves + HOLLY_SPRIG greenery swags along the front (z0) wall.
    for (const b of (v.buildings || [])) {
      if (b.type !== 'chapel') continue;
      const midX = Math.floor((b.x0 + b.x1) / 2);
      deckChapelHarvest(scene, objects, b, midX, gen);
    }
  }
}

// A corn stook: a tight cluster of 5-8 tapered pale-gold cylinders (sheaves)
// splayed outward from a common base — the classic A-frame stook silhouette.
// Each sheaf is a tapered CylinderGeometry (radiiTop < radiiBottom) for the
// bundled-straw taper. Bound near the base by a thin dark ring.
// Group root at y=0; height ≈1.0 block.
function buildStook() {
  const g = new THREE.Group();
  const matStraw  = new THREE.MeshLambertMaterial({ color: STRAW_GOLD });
  const matLight  = new THREE.MeshLambertMaterial({ color: STRAW_LIGHT });
  const matBind   = new THREE.MeshLambertMaterial({ color: BIND_BROWN });

  // 6 sheaves in a ring, each leaning slightly outward + a central upright one
  const sheafCount = 7;
  for (let i = 0; i < sheafCount; i++) {
    const isCentre = i === sheafCount - 1;
    const angle = isCentre ? 0 : (i / (sheafCount - 1)) * Math.PI * 2;
    const lean = isCentre ? 0 : 0.22; // outward lean in radians

    const geo = new THREE.CylinderGeometry(0.03, 0.07, 0.9, 6);
    const mat = i % 2 === 0 ? matStraw : matLight;
    const m = new THREE.Mesh(geo, mat);

    // Lean outward from the centre
    m.rotation.z = lean;
    m.rotation.y = angle;
    // Base at y=0, pivot around the lean
    m.position.set(
      isCentre ? 0 : Math.sin(angle) * 0.12,
      0.45,
      isCentre ? 0 : Math.cos(angle) * 0.12
    );
    g.add(m);
  }

  // Binding band near the base — a short flat cylinder at y≈0.22
  const bindGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.06, 8);
  const bind = new THREE.Mesh(bindGeo, matBind);
  bind.position.y = 0.22;
  g.add(bind);

  return g;
}

// A small woven corn dolly: a compact box-figure in pale gold, ≈0.5 block tall.
// Head (small sphere), body (box), two short arm stubs — the straw harvest figure
// hung in the chapel or propped by the cross as a charm for next year's grain.
function buildCornDolly() {
  const g = new THREE.Group();
  const matStraw = new THREE.MeshLambertMaterial({ color: STRAW_GOLD });
  const matDark  = new THREE.MeshLambertMaterial({ color: STRAW_DARK });

  // Body — woven straw bundle, tallish thin box
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.22, 0.10), matStraw);
  body.position.y = 0.18;
  g.add(body);

  // Head — small sphere
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.07, 7, 5), matDark);
  head.position.y = 0.36;
  g.add(head);

  // Arms — two short stubs
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.06), matStraw);
    arm.position.set(side * 0.11, 0.20, 0);
    arm.rotation.z = side * 0.5;
    g.add(arm);
  }

  // Binding band at the waist
  const waist = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 7), matDark);
  waist.position.y = 0.13;
  g.add(waist);

  return g;
}

// Place the corn dolly in the chapel forecourt (south of z0) — same approach as
// christmas.js chapelFirPlacement but for a single small cell. Falls back to
// scanning green/closes near village centre if no chapel or forecourt is blocked.
function chapelForecourtCell(world, v, chapel) {
  const gen = world.gen;
  if (chapel) {
    const centreX = Math.floor((chapel.x0 + chapel.x1) / 2);
    for (let dz = 1; dz <= 4; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = centreX + dx;
        const z = chapel.z0 - dz;
        const inBuilding = (v.buildings || []).some(b => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1);
        if (inBuilding) continue;
        const sy = gen.height(x, z);
        if (world.getBlock(x, sy + 1, z) === B.AIR) return { x, z };
      }
    }
  }
  // Fallback: first open green/closes cell near centre
  for (let r = 2; r <= 8; r++) {
    for (let ai = 0; ai < 12; ai++) {
      const angle = (ai / 12) * Math.PI * 2;
      const x = v.x + Math.round(r * Math.cos(angle));
      const z = v.z + Math.round(r * Math.sin(angle));
      const col = gen.geo.villageColumn(x, z);
      if (!col || (col.kind !== 'green' && col.kind !== 'closes')) continue;
      const sy = gen.height(x, z);
      if (world.getBlock(x, sy + 1, z) === B.AIR) return { x, z };
    }
  }
  return null;
}

// Deck the chapel front wall for harvest festival:
//   - Small sheaf meshes at regular intervals across the front (z0) wall
//   - HOLLY_SPRIG greenery billboards between them (mixed harvest swag look)
//   - A lone corn dolly silhouette over the door
// Matches the christmas.js deckChapel() signature so future refactors can unify.
function deckChapelHarvest(scene, objects, b, midX, gen) {
  const wallY = gen.height(midX, b.z0) + 2.4;  // eave height
  const doorY = gen.height(midX, b.z0) + 2.9;  // above porch arch

  // Alternate: sheaf mesh at even x, holly billboard at odd x
  for (let wx = b.x0 + 1; wx <= b.x1 - 1; wx++) {
    if (wx % 2 === 0) {
      // Mini wall-sheaf: a tiny stook tipped flat against the wall face
      const sheaf = buildWallSheaf();
      sheaf.position.set(wx + 0.5, wallY, b.z0 - 0.15);
      sheaf.rotation.x = Math.PI / 2; // lay flat against the south wall, facing out
      scene.add(sheaf);
      objects.push(sheaf);
    } else {
      // Greenery sprig billboard
      const yaw = hash2i(wx, b.z0, 0xc8d4) * Math.PI * 2;
      addBillboard(scene, objects, TILE.HOLLY_SPRIG, wx + 0.5, wallY, b.z0 - 0.1, yaw);
    }
  }

  // Corn dolly silhouette above the door — a small wall sheaf centred
  const doorSheaf = buildWallSheaf();
  doorSheaf.position.set(midX + 0.5, doorY, b.z0 - 0.15);
  doorSheaf.rotation.x = Math.PI / 2;
  scene.add(doorSheaf);
  objects.push(doorSheaf);
}

// A small flat sheaf intended to be mounted against a wall face.
// Even simpler than buildStook: just a thin box bundle + bind ring, ~0.5 scale.
function buildWallSheaf() {
  const g = new THREE.Group();
  const matStraw = new THREE.MeshLambertMaterial({ color: STRAW_GOLD });
  const matLight = new THREE.MeshLambertMaterial({ color: STRAW_LIGHT });
  const matBind  = new THREE.MeshLambertMaterial({ color: BIND_BROWN });

  // Main bundle — a broad flat box (read as a bundle of stalks)
  const bundle = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.44, 0.08), matStraw);
  bundle.position.y = 0.22;
  g.add(bundle);

  // Ears at top — a slightly wider, shorter box in lighter gold
  const ears = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.07), matLight);
  ears.position.y = 0.47;
  g.add(ears);

  // Binding band
  const bind = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.06, 0.10), matBind);
  bind.position.y = 0.12;
  g.add(bind);

  return g;
}
