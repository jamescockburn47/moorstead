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
import { addBillboard, isOpenGround, makeDriftMotes, nightFactor } from '../festivalKit.js';

const RADIUS = 48;

// Pale straw-gold colours for all harvest props
const STRAW_GOLD   = 0xd4a94a;
const STRAW_LIGHT  = 0xe8c96a;
const STRAW_DARK   = 0x8b6b28;
const BIND_BROWN   = 0x7a5c2a;

export function buildHarvest(ctx) {
  const { scene, world, gen, cx, cz, objects } = ctx;
  const fine = !!ctx.fine;
  const fx = ctx.fx || [];

  for (const v of (gen.geo.villages || [])) {
    if (Math.abs(v.x - cx) > RADIUS || Math.abs(v.z - cz) > RADIUS) continue;

    // -- Corn stooks on the green and closes --
    // Scan radially, 4-20 blocks out; green/closes cells only; hash-gated;
    // cap at 6 stooks per village so the scene isn't cluttered.
    // Under 'Fine' each stook becomes a CLUSTER — two smaller companions lean
    // in beside it (how a harvested close actually stood; Plain keeps the six).
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
        if (fine) {
          // two companions, scaled down, offset round the primary — a stook row
          const offs = [
            { dx: 0.95, dz: 0.25, s: 0.8 },
            { dx: -0.55, dz: 0.85, s: 0.7 },
          ];
          for (let oi = 0; oi < offs.length; oi++) {
            const o = offs[oi];
            const side = buildStook();
            side.scale.setScalar(o.s);
            side.rotation.y = yaw + 0.7 + oi;
            side.position.set(x + 0.5 + o.dx, sy + 1, z + 0.5 + o.dz);
            scene.add(side);
            objects.push(side);
          }
        }
        stookCount++;
      }
    }

    // -- 'Fine': a warm LAMPLIT PRODUCE TABLE near the chapel — the harvest-
    // festival table of marrows, apples an' turnips under a storm lantern, with
    // one warm point-light so the whole spread glows come evening.
    if (fine) {
      const chapelB = (v.buildings || []).find(b => b.type === 'chapel');
      const tablePos = chapelForecourtCell(world, v, chapelB);
      if (tablePos) {
        const table = buildProduceTable();
        table.position.set(tablePos.x + 0.5, gen.height(tablePos.x, tablePos.z) + 1, tablePos.z + 0.5);
        table.rotation.y = hash2i(tablePos.x, tablePos.z, 0x77aa) * Math.PI * 2;
        scene.add(table);
        objects.push(table);
      }
    }

    // -- 'Fine': drifting CHAFF MOTES by day over the green — threshing dust
    // an' straw-chaff in the air. Gated on daylight (uGate = 1 - nightFactor).
    if (fine) {
      const chaff = makeDriftMotes({ count: 70, color: 0xe8d9a0, radius: 8, height: 3.2, speed: 1.4, size: 1.8 });
      chaff.position.set(v.x + 0.5, gen.height(v.x, v.z) + 1.2, v.z + 0.5);
      scene.add(chaff);
      objects.push(chaff); // ROOT — dispose() unregisters its uTime material
      fx.push(() => { chaff.material.uniforms.uGate.value = 1 - nightFactor(); });
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

// 'Fine' only: the harvest-festival PRODUCE TABLE — a plank trestle laid wi'
// period produce (marrows, apples, turnips, a sheaf) under a storm lantern.
// The lantern body is warm-emissive (pops the bloom) and one small PointLight
// pools warm lamplight over the spread. Root at y=0; ~1.1 blocks tall.
// The light needs no registry — scene.remove(group) on teardown takes it out.
function buildProduceTable() {
  const g = new THREE.Group();
  const matWood  = new THREE.MeshLambertMaterial({ color: 0x6b4a2a });
  const matWood2 = new THREE.MeshLambertMaterial({ color: 0x55381f });

  // trestle: a plank top on two leg pairs
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.8), matWood);
  top.position.y = 0.72;
  g.add(top);
  for (const sx of [-0.65, 0.65]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.7, 0.7), matWood2);
    leg.position.set(sx, 0.36, 0);
    g.add(leg);
  }

  // produce: marrows (long green), apples (red/russet), turnips (cream-purple)
  const matMarrow = new THREE.MeshLambertMaterial({ color: 0x4a7030 });
  const matApple  = new THREE.MeshLambertMaterial({ color: 0xa83424 });
  const matRusset = new THREE.MeshLambertMaterial({ color: 0xb07a34 });
  const matTurnip = new THREE.MeshLambertMaterial({ color: 0xdcc8a8 });
  const marrow = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.5, 7), matMarrow);
  marrow.rotation.z = Math.PI / 2;
  marrow.position.set(-0.35, 0.85, 0.12);
  g.add(marrow);
  const appleSpots = [
    { x: 0.18, z: 0.18, m: matApple }, { x: 0.34, z: 0.02, m: matRusset },
    { x: 0.22, z: -0.2, m: matApple }, { x: 0.48, z: 0.2, m: matRusset },
  ];
  for (const s of appleSpots) {
    const a = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), s.m);
    a.position.set(s.x, 0.83, s.z);
    g.add(a);
  }
  for (const s of [{ x: -0.15, z: -0.22 }, { x: 0.02, z: 0.24 }]) {
    const t = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), matTurnip);
    t.scale.set(1, 0.8, 1);
    t.position.set(s.x, 0.83, s.z);
    g.add(t);
  }
  // a small sheaf stood at the table end
  const sheaf = buildWallSheaf();
  sheaf.position.set(0.68, 0.76, -0.2);
  g.add(sheaf);

  // the storm lantern: dark frame + warm-emissive glass body, hung off a crook
  const crook = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 5), matWood2);
  crook.position.set(-0.75, 0.55, -0.3);
  g.add(crook);
  const matLampGlass = new THREE.MeshLambertMaterial({
    color: 0x2c1d10,
    emissive: new THREE.Color(0xffa845),
    emissiveIntensity: 2.2, // over the bloom threshold — warm lamplit glow
  });
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 0.14), matLampGlass);
  lamp.position.set(-0.75, 1.12, -0.3);
  g.add(lamp);
  const light = new THREE.PointLight(0xffa845, 0.9, 6, 2);
  light.position.set(-0.75, 1.1, -0.3);
  g.add(light);

  g.userData.wow = 'produceTable';
  return g;
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
