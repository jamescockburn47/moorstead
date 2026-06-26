// festivals/midsummer.js — Midsummer (St John's Eve) dressing for the moor.
// (spec §8)
//
// Period-accurate c.1900 NYM custom: hilltop fires on the high moor, a survival
// of the St John's Eve beacon tradition in the north. Distinct from the Bonfire
// Night green-sited fire — these burn on open moorland summits, visible across
// the dales. A light greenery dressing around the village cross signals the
// season; the real drama is the three hilltop fires on the ridge-tops.
//
// Fire-crackle audio already gates on midsummer in main.js — no wiring here.
// Same ctx shape:
//   ctx = { scene, world, gen, cx, cz, season, snowAccum, objects, lit, robins }
import * as THREE from 'three';
import { hash2i } from '../noise.js';
import { B, TILE } from '../defs.js';
import { addBillboard, isOpenGround } from '../festivalKit.js';
import { Fire } from '../fire.js';

const RADIUS       = 48;  // village cull
const FIRE_RADIUS  = 80;  // scan radius for hilltop candidates (blocks)
const FIRE_GRID    = 16;  // coarse grid step — keeps candidate count small
const FIRE_CAP     = 3;   // max hilltop fires per call
// A candidate must be at least this many blocks above the average of its 4
// cardinal neighbours to count as a local maximum on the open moor.
const SUMMIT_RISE  = 4;
// Exclusion: don't site a hilltop fire within this range of any village centre
// (keeps them reading as moor-top beacons, separate from the village bonfires).
const VILLAGE_EXCL = 32;

// ctx = { scene, world, gen, cx, cz, season, snowAccum, objects, lit, robins }
export function buildMidsummer(ctx) {
  const { scene, world, gen, cx, cz, objects } = ctx;

  // -- Hilltop fires on the high moor --
  // Scan a coarse grid centred on the player for local height maxima that are:
  //   - Clearly above their cardinal neighbours (SUMMIT_RISE threshold)
  //   - On open ground (block above ground level is AIR)
  //   - Not too close to any village centre (VILLAGE_EXCL exclusion)
  // Among all qualifying candidates pick the top-3 by height, cap at FIRE_CAP.

  const candidates = [];
  for (let dx = -FIRE_RADIUS; dx <= FIRE_RADIUS; dx += FIRE_GRID) {
    for (let dz = -FIRE_RADIUS; dz <= FIRE_RADIUS; dz += FIRE_GRID) {
      const x = cx + dx;
      const z = cz + dz;
      const h = gen.height(x, z);

      // Must be open at ground+1 (no block crowding the summit)
      if (world.getBlock(x, h + 1, z) !== B.AIR) continue;

      // Local maximum check: all 4 cardinal neighbours must be lower by SUMMIT_RISE
      const hN = gen.height(x,           z - FIRE_GRID);
      const hS = gen.height(x,           z + FIRE_GRID);
      const hW = gen.height(x - FIRE_GRID, z);
      const hE = gen.height(x + FIRE_GRID, z);
      const minNeighbour = Math.min(hN, hS, hW, hE);
      if (h - minNeighbour < SUMMIT_RISE) continue;

      // Village exclusion: not within VILLAGE_EXCL blocks of any village centre
      let nearVillage = false;
      for (const v of (gen.geo.villages || [])) {
        if (Math.hypot(x - v.x, z - v.z) < VILLAGE_EXCL) { nearVillage = true; break; }
      }
      if (nearVillage) continue;

      candidates.push({ x, z, h });
    }
  }

  // Sort by height descending, take the top FIRE_CAP summits
  candidates.sort((a, b) => b.h - a.h);
  const fires = candidates.slice(0, FIRE_CAP);

  for (const { x, z, h } of fires) {
    const groundY = h + 1; // block top to stand the woodpile on
    const stack = buildMidsummerStack(x + 0.5, groundY, z + 0.5);
    scene.add(stack);
    objects.push(stack);
  }

  // -- Village greenery dressing: a few sprigs around the green/cross --
  // Subtle — a light midsummer token, not an elaborate village scene.
  for (const v of (gen.geo.villages || [])) {
    if (Math.abs(v.x - cx) > RADIUS || Math.abs(v.z - cz) > RADIUS) continue;

    // A small greenery ring on the cross base
    const crossY = gen.height(v.x, v.z) + 1;
    const crossSprig = buildMidsummerSprig();
    crossSprig.position.set(v.x + 0.5, crossY, v.z + 0.5);
    scene.add(crossSprig);
    objects.push(crossSprig);

    // A few holly-sprig billboards on the green — sparse (up to 4 per village)
    let sprigCount = 0;
    for (let r = 2; r < 14 && sprigCount < 4; r++) {
      for (let a = 0; a < 12 && sprigCount < 4; a++) {
        const angle = (a / 12) * Math.PI * 2;
        const x = v.x + Math.round(r * Math.cos(angle));
        const z = v.z + Math.round(r * Math.sin(angle));
        if (x === v.x && z === v.z) continue;
        const col = gen.geo.villageColumn(x, z);
        if (!isOpenGround(world, v, x, z, col)) continue;   // green/closes in the stylised world; any open ground in the real moor
        const sy = gen.height(x, z);
        // Sparse deterministic gate — ~20%
        if (hash2i(x, z, gen.geo.seed ^ 0x4d72) > 0.20) continue;
        const yaw = hash2i(x, z, 0x8f3b) * Math.PI * 2;
        addBillboard(scene, objects, TILE.HOLLY_SPRIG, x + 0.5, sy + 1, z + 0.5, yaw);
        sprigCount++;
      }
    }
  }
}

// Build a midsummer hilltop bonfire stack (small woodpile + hero Fire).
// Modelled on bonfire.js's buildBonfireStack but simpler — no guy effigy,
// smaller woodpile (a hilltop beacon is a practical fire, not a village ceremony),
// and the same hero Fire({ big:true }) preset. Group base at groundY.
function buildMidsummerStack(x, groundY, z) {
  const group = new THREE.Group();
  group.position.set(x, groundY, z);

  const matLog  = new THREE.MeshLambertMaterial({ color: 0x6b4a2a });
  const matLog2 = new THREE.MeshLambertMaterial({ color: 0x55381f });
  const logGeo  = new THREE.BoxGeometry(1.0, 0.50, 0.30);

  // Bottom ring of crossed logs — 4 billets in a tight cross
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const m = new THREE.Mesh(logGeo, i % 2 ? matLog2 : matLog);
    m.position.set(Math.cos(a) * 0.38, 0.26, Math.sin(a) * 0.38);
    m.rotation.y = a + Math.PI / 2;
    group.add(m);
  }

  // Capping billet at the apex
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.38, 0.25), matLog2);
  cap.position.set(0, 0.70, 0);
  cap.rotation.y = 0.5;
  group.add(cap);

  // Hero beacon fire: big, embers, smoke, light — same call as bonfire.js
  const fire = Fire({ scale: 3, big: true, layers: 3, embers: true, smoke: true, light: true,
                      seed: (x * 11.3 + z * 9.1) % 1 });
  fire.position.set(0, 0.9, 0); // sit the flame at the pile apex
  group.add(fire);

  // Expose dispose() so SeasonalLayer.clear() can release the hero fire's embers
  // and point-light before the generic traverse, same pattern as bonfire.js.
  group.dispose = () => { if (typeof fire.dispose === 'function') fire.dispose(); };

  return group;
}

// A tiny greenery sprig for the cross base / green dressing:
// a compact cluster of small dark-green and flower-yellow boxes, ~0.25 blocks.
// Period-appropriate midsummer herb and flower decoration — St John's wort,
// elder, orpine — rendered as a small colourful cluster.
function buildMidsummerSprig() {
  const g = new THREE.Group();
  const matGreen  = new THREE.MeshLambertMaterial({ color: 0x2e7040 }); // deep summer green
  const matFlower = new THREE.MeshLambertMaterial({ color: 0xf5e040 }); // St John's wort yellow

  // Small leaf pads
  const leaves = [
    { x: 0,     y: 0.08, z: 0,     s: 0.14 },
    { x: -0.07, y: 0.10, z: 0.05,  s: 0.10 },
    { x:  0.07, y: 0.10, z: -0.05, s: 0.10 },
    { x:  0,    y: 0.15, z: 0,     s: 0.08 },
  ];
  for (const { x, y, z, s } of leaves) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.3, s), matGreen);
    m.position.set(x, y, z);
    g.add(m);
  }

  // A few small flower dots (St John's wort star-flowers)
  const flowerPositions = [
    { x:  0.04, y: 0.19, z:  0.04 },
    { x: -0.05, y: 0.17, z: -0.03 },
    { x:  0.0,  y: 0.21, z: -0.05 },
  ];
  for (const { x, y, z } of flowerPositions) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.035, 4, 3), matFlower);
    dot.position.set(x, y, z);
    g.add(dot);
  }

  return g;
}
