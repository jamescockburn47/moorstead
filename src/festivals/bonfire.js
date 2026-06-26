// festivals/bonfire.js — the Bonfire Night (5th November) dressing for the moor.
//
// One communal bonfire per village, built on the green by the cross: a piled
// cone of brown logs wi' a crude "guy" effigy slumped against it, an' a big
// HERO flame licking off the top — broad, chaotic, wi' rising embers, a drifting
// smoke plume an' a warm pulsing light (all GPU-animated off the shared fire
// tick in main.js; see fire.js). Period-true for c.1900 — Guy Fawkes bonfires on
// the village green were long-established by then.
//
// Same ctx shape as buildChristmas:
//   ctx = { scene, world, gen, cx, cz, season, snowAccum, objects, lit, robins }
// Everything built is pushed to ctx.objects for SeasonalLayer teardown. The Fire
// group exposes its own dispose() (frees ember/smoke geometry + de-registers its
// light), which SeasonalLayer.clear() now calls.
import * as THREE from 'three';
import { B } from '../defs.js';
import { Fire } from '../fire.js';
import { greenPlacement } from '../festivalKit.js';

const RADIUS = 48; // match the host's village cull radius

// ctx = { scene, world, gen, cx, cz, season, snowAccum, objects, lit, robins }
export function buildBonfire(ctx) {
  const { scene, world, gen, cx, cz, objects } = ctx;

  for (const v of (gen.geo.villages || [])) {
    if (Math.abs(v.x - cx) > RADIUS || Math.abs(v.z - cz) > RADIUS) continue;
    // Place on an open green cell near the cross — the same scan the fir used
    // before it moved to the chapel forecourt (green/closes/path first, then any
    // open non-building cell). The bonfire belongs on the communal green.
    const fp = greenPlacement(world, v);
    if (!fp) continue;
    const groundY = gen.height(fp.x, fp.z) + 1; // block-top the pile stands on
    const g = buildBonfireStack(fp.x + 0.5, groundY, fp.z + 0.5);
    scene.add(g);
    objects.push(g);
  }
}

// Build the whole bonfire as ONE group rooted at the woodpile base (feet at
// groundY): a stacked-wood cone, a guy effigy leaning on it, an' the hero Fire on
// top. The group carries a dispose() that tears the Fire group down too.
function buildBonfireStack(x, groundY, z) {
  const group = new THREE.Group();
  group.position.set(x, groundY, z);

  const matLog  = new THREE.MeshLambertMaterial({ color: 0x6b4a2a }); // brown cordwood
  const matLog2 = new THREE.MeshLambertMaterial({ color: 0x55381f }); // darker log, for variety

  // -- the woodpile: a few brown cubes piled into a rough cone. Bottom ring of
  // crossed logs, a smaller mid ring, a capping billet — reads as a stacked pyre.
  const logGeo = new THREE.BoxGeometry(1, 0.55, 0.34); // a cordwood billet
  // bottom ring: 5 billets crossed round the base (y≈0.3)
  const baseN = 5;
  for (let i = 0; i < baseN; i++) {
    const a = (i / baseN) * Math.PI * 2;
    const m = new THREE.Mesh(logGeo, i % 2 ? matLog2 : matLog);
    m.position.set(Math.cos(a) * 0.45, 0.3, Math.sin(a) * 0.45);
    m.rotation.y = a + Math.PI / 2; // lie tangent, spokes of a wheel
    group.add(m);
  }
  // mid ring: 4 shorter billets, raised an' drawn in (y≈0.75)
  const midGeo = new THREE.BoxGeometry(0.8, 0.5, 0.30);
  const midN = 4;
  for (let i = 0; i < midN; i++) {
    const a = (i / midN) * Math.PI * 2 + 0.6; // offset frae the base ring
    const m = new THREE.Mesh(midGeo, i % 2 ? matLog : matLog2);
    m.position.set(Math.cos(a) * 0.30, 0.78, Math.sin(a) * 0.30);
    m.rotation.y = a + Math.PI / 2;
    m.rotation.z = 0.18; // tipped inward toward the apex
    group.add(m);
  }
  // capping billet across the top (y≈1.1)
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.28), matLog2);
  cap.position.set(0, 1.12, 0);
  cap.rotation.y = 0.4;
  group.add(cap);

  // -- the guy: a crude stick effigy slumped against the south face of the pile.
  // A simple box-figure (body, head, two arm boxes, two leg boxes) in ragged
  // browns — the straw-stuffed dummy that tops the bonfire. Leaned back into the
  // woodpile, so it reads as propped on the pyre awaiting the flame.
  const guy = buildGuy();
  guy.position.set(0, 0.55, 0.55);  // sat on the bottom ring, toward the front
  guy.rotation.x = -0.5;            // tipped back against the pile
  group.add(guy);

  // -- the hero flame: broad/chaotic bonfire preset, embers + smoke + one warm
  // pulsing light. scale ~3 → big auto-on, but we set big:true explicit for clarity.
  // Sits at the woodpile apex.
  const fire = Fire({ scale: 3, big: true, layers: 3, embers: true, smoke: true, light: true, seed: (x * 13.1 + z * 7.7) % 1 });
  fire.position.set(0, 1.2, 0); // apex of the pile, frae which the flame licks up
  group.add(fire);

  // The group owns a Fire subgroup wi' its own teardown (ember/smoke geometry +
  // light de-registration). SeasonalLayer.clear() calls this before its generic
  // traverse, so the hero registries don't leak across a rebuild.
  group.dispose = () => { if (typeof fire.dispose === 'function') fire.dispose(); };

  return group;
}

// A crude Guy Fawkes effigy, feet at y=0, height ≈1.0 — a ragged box-figure of
// the straw man. Drab sacking browns; deliberately rough (it's a dummy to burn).
function buildGuy() {
  const g = new THREE.Group();
  const matRag  = new THREE.MeshLambertMaterial({ color: 0x7a6a4a }); // sacking/straw
  const matRag2 = new THREE.MeshLambertMaterial({ color: 0x5b4a33 }); // darker rag
  const matHead = new THREE.MeshLambertMaterial({ color: 0xc9b489 }); // straw-stuffed head

  // body — a stuffed sack
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.42, 0.18), matRag);
  body.position.y = 0.42;
  g.add(body);

  // head — a pale straw ball with a battered hat
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 7, 5), matHead);
  head.position.y = 0.74;
  g.add(head);
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.12, 8), matRag2);
  hat.position.y = 0.86;
  g.add(hat);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.03, 8), matRag2);
  brim.position.y = 0.81;
  g.add(brim);

  // arms — two ragged boxes flung out (a floppy scarecrow)
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.34, 0.08), matRag2);
    arm.position.set(side * 0.2, 0.46, 0.02);
    arm.rotation.z = side * 0.8; // flung outward
    g.add(arm);
  }

  // legs — two stubby straw legs
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.3, 0.09), matRag);
    leg.position.set(side * 0.08, 0.15, 0);
    g.add(leg);
  }
  return g;
}

// (greenPlacement now lives in festivalKit.js — shared with mayday + with a real-Moors open-ground
// fallback, since geo.villageColumn returns null there and the old green-only gate built nothing.)
