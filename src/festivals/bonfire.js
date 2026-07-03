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
import { greenPlacement, makeFireworks, nightFactor } from '../festivalKit.js';

const RADIUS = 48; // match the host's village cull radius

// ctx = { scene, world, gen, cx, cz, season, snowAccum, objects, lit, robins, fx, fine }
export function buildBonfire(ctx) {
  const { scene, world, gen, cx, cz, objects } = ctx;
  const fine = !!ctx.fine;          // 'Fine' renderer live → fireworks + ember column
  const fx = ctx.fx || [];

  for (const v of (gen.geo.villages || [])) {
    if (Math.abs(v.x - cx) > RADIUS || Math.abs(v.z - cz) > RADIUS) continue;
    // Place on open green near the cross — but a BONFIRE is a hazard, not a maypole
    // (James 2026-07-03: fires were landing on t' rail line an' against walls). It
    // demands standing room: well clear of every building footprint an' the rails.
    // Try a generous berth first, then a tighter-but-still-safe one; if a village is
    // too hemmed in for even that, it goes without a fire — never one on the tracks.
    const fp = greenPlacement(world, v, 0, { margin: 4, railClear: 8, maxR: 20 })
            || greenPlacement(world, v, 0, { margin: 2, railClear: 6, maxR: 20 });
    if (!fp) continue;
    const groundY = gen.height(fp.x, fp.z) + 1; // block-top the pile stands on
    const g = buildBonfireStack(fp.x + 0.5, groundY, fp.z + 0.5, fine);
    scene.add(g);
    objects.push(g);

    // -- FIREWORKS ('Fine' only): a rocket pale a few strides off the pyre. One
    // pooled Points per village; rockets every 4–8 s after dark. Period-true
    // c.1900 — commercial rockets an' garden fireworks were Bonfire Night
    // staples by then (Brock's an' Pain's both sold to the public).
    if (fine) {
      const fw = makeFireworks({ seed: fp.x * 0.173 + fp.z * 0.031 });
      // launch pale: 5 blocks east, 3 south of the pyre — clear of the crowd
      const lx = fp.x + 5, lz = fp.z - 3;
      fw.position.set(lx + 0.5, gen.height(lx, lz) + 1, lz + 0.5);
      scene.add(fw);
      objects.push(fw); // ROOT — dispose() unregisters its uTime material
      // after-dark gate: uNight rides the live sky each frame (0 by day)
      fx.push(() => { fw.material.uniforms.uNight.value = nightFactor(); });
    }
  }
}

// Build the whole bonfire as ONE group rooted at the woodpile base (feet at
// groundY): a stacked-wood cone, a guy effigy leaning on it, an' the hero Fire on
// top. The group carries a dispose() that tears the Fire group down too.
function buildBonfireStack(x, groundY, z, fine = false) {
  const group = new THREE.Group();
  group.position.set(x, groundY, z);

  const matLog  = new THREE.MeshLambertMaterial({ color: 0x6b4a2a }); // brown cordwood
  const matLog2 = new THREE.MeshLambertMaterial({ color: 0x55381f }); // darker log, for variety

  // -- the woodpile: a PROPER village pyre (James 2026-07-03: the owd knee-high
  // stack under a 3-block flame read as two separate elements). Three rings of
  // crossed billets stepping in an' up to ~2 blocks — sized so the hero flame's
  // body actually envelops the wood rather than towering off a footstool.
  // bottom ring: 8 long billets crossed round the base (y≈0.35)
  const baseGeo = new THREE.BoxGeometry(1.6, 0.6, 0.38);
  const baseN = 8;
  for (let i = 0; i < baseN; i++) {
    const a = (i / baseN) * Math.PI * 2;
    const m = new THREE.Mesh(baseGeo, i % 2 ? matLog2 : matLog);
    m.position.set(Math.cos(a) * 1.0, 0.35, Math.sin(a) * 1.0);
    m.rotation.y = a + Math.PI / 2; // lie tangent, spokes of a wheel
    group.add(m);
  }
  // mid ring: 6 billets, raised an' drawn in (y≈0.95)
  const midGeo = new THREE.BoxGeometry(1.2, 0.55, 0.34);
  const midN = 6;
  for (let i = 0; i < midN; i++) {
    const a = (i / midN) * Math.PI * 2 + 0.5; // offset frae the base ring
    const m = new THREE.Mesh(midGeo, i % 2 ? matLog : matLog2);
    m.position.set(Math.cos(a) * 0.68, 0.95, Math.sin(a) * 0.68);
    m.rotation.y = a + Math.PI / 2;
    m.rotation.z = 0.2; // tipped inward toward the apex
    group.add(m);
  }
  // upper ring: 4 shorter billets, drawn in tight (y≈1.5)
  const topGeo = new THREE.BoxGeometry(0.9, 0.5, 0.3);
  const topN = 4;
  for (let i = 0; i < topN; i++) {
    const a = (i / topN) * Math.PI * 2 + 1.1;
    const m = new THREE.Mesh(topGeo, i % 2 ? matLog2 : matLog);
    m.position.set(Math.cos(a) * 0.38, 1.5, Math.sin(a) * 0.38);
    m.rotation.y = a + Math.PI / 2;
    m.rotation.z = 0.3;
    group.add(m);
  }
  // capping billet across the top (y≈1.9)
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.45, 0.3), matLog2);
  cap.position.set(0, 1.9, 0);
  cap.rotation.y = 0.4;
  group.add(cap);

  // -- the guy: a crude stick effigy slumped against the south face of the pile.
  // A simple box-figure (body, head, two arm boxes, two leg boxes) in ragged
  // browns — the straw-stuffed dummy that tops the bonfire. Leaned back into the
  // woodpile, so it reads as propped on the pyre awaiting the flame.
  const guy = buildGuy();
  guy.position.set(0, 0.95, 1.05);  // sat up on the bottom ring, toward the front
  guy.rotation.x = -0.5;            // tipped back against the pile
  group.add(guy);

  // -- the hero flame: broad/chaotic bonfire preset, embers + smoke + one warm
  // pulsing light. scale ~3 → big auto-on, but we set big:true explicit for clarity.
  // ANCHORED LOW, INSIDE the pile (flameQuad's base edge is y=0 of this group):
  // the flame body rises THROUGH the billets so the wood visibly burns — one
  // element, not a flame hovering off the apex (James 2026-07-03).
  // Under 'Fine' the fire also gets the tall EMBER COLUMN — a second pooled spark
  // stream (70 motes, ~2.6× rise, tight lanes) that glows under the bloom.
  const fire = Fire({ scale: 3.2, big: true, layers: 3, embers: true, smoke: true, light: true,
                      column: fine, seed: (x * 13.1 + z * 7.7) % 1 });
  fire.position.set(0, 0.35, 0); // rooted in the pile's heart — wood pokes through the flame bed
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
