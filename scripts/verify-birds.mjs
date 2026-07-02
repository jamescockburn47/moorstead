// Starling murmuration ([32]) check — run wi': node scripts/verify-birds.mjs
//
// The contract this defends:
//   (a) determinism — two MurmurationLayer builds off the same world seed bake
//       identical per-bird aSeed buffers an' pick the identical roost village;
//   (b) tiered counts — Fine flies 600 birds, Plain 250 (const, build-time);
//   (c) the material carries uTime so registerFxMat ticks it for free;
//   (d) the gate — noon, rain, or no season each hold the flock invisible
//       (visible false, uFade 0);
//   (e) a dry autumn dusk eases uFade toward 1 an' shows the Points;
//   (f) dispose() removes frae the scene an' unregisters frae the fire tick;
//   (g) the module is headless-import-safe (the dot sprite is deferred).
//
// NO document stub here — deliberately. birds.js must import an' construct
// clean under bare Node (the canvas dot texture is built lazily an' guarded),
// so this script proves it by running without one.

import * as THREE from 'three';
import {
  MurmurationLayer, murmurationGate, duskGate, seasonGate, pickRoostVillage,
  MURMUR_COUNT_FINE, MURMUR_COUNT_PLAIN,
} from '../src/birds.js';
import { fxMatCount } from '../src/fire.js';

let failed = false;
const ok  = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// --- (g) headless import touched no document ---------------------------------
(typeof document === 'undefined' ? ok : bad)('bare Node: no document global exists (nowt stubbed)');
(typeof MurmurationLayer === 'function' ? ok : bad)('birds.js imported clean under Node (dot sprite deferred)');

// --- shared stubs -------------------------------------------------------------
// A minimal scene that records membership, so add/remove is assertable.
function stubScene() {
  const members = [];
  return {
    members,
    add(o) { members.push(o); },
    remove(o) { const i = members.indexOf(o); if (i >= 0) members.splice(i, 1); },
  };
}
const VILLAGE = { x: 100, z: 200, ground: 30, name: 'Testby' };
const stubWorld = () => ({ gen: { seed: 42, geo: { villages: [VILLAGE] } } });
const AUTUMN = { autumn: 1, season: 'autumn' };

// --- pure gate maths (the rules the layer eases toward) -----------------------
(duskGate(0.75) === 1 ? ok : bad)('duskGate peaks at dead-centre dusk (0.75)');
(duskGate(0.5) === 0 && duskGate(0.85) === 0 ? ok : bad)('duskGate is 0 at noon and past roosting time');
(seasonGate(AUTUMN) === 1 ? ok : bad)('full autumn is prime murmuration season');
(seasonGate(null) === 0 ? ok : bad)('no season -> no flock');
(murmurationGate(0.75, AUTUMN, 0) === 1 ? ok : bad)('dry autumn dusk opens the gate fully');
(murmurationGate(0.75, AUTUMN, 1) === 0 ? ok : bad)('heavy rain closes the gate');
(pickRoostVillage([VILLAGE], 42) === VILLAGE ? ok : bad)('roost pick resolves to a real village');
(pickRoostVillage([], 42) === null ? ok : bad)('empty village list -> null roost (no crash)');

// --- (a) determinism: same seed, same seeds buffer, same roost ---------------
{
  const a = new MurmurationLayer({ scene: stubScene(), world: stubWorld(), sky: { time: 0.75, rainAmount: 0 }, isFine: true });
  const b = new MurmurationLayer({ scene: stubScene(), world: stubWorld(), sky: { time: 0.75, rainAmount: 0 }, isFine: true });
  const sa = a.points.geometry.getAttribute('aSeed').array;
  const sb = b.points.geometry.getAttribute('aSeed').array;
  (sa.length === sb.length && sa.join(',') === sb.join(',')
    ? ok : bad)('two builds off seed 42 bake identical aSeed buffers');
  (JSON.stringify(a._roost) === JSON.stringify(b._roost) && a._roost.name === 'Testby'
    ? ok : bad)('both builds roost at the same village (Testby)');
  a.dispose(); b.dispose();
}

// --- (b) tiered counts: Fine 600, Plain 250 -----------------------------------
{
  const fine = new MurmurationLayer({ scene: stubScene(), world: stubWorld(), sky: { time: 0.75, rainAmount: 0 }, isFine: true });
  const plain = new MurmurationLayer({ scene: stubScene(), world: stubWorld(), sky: { time: 0.75, rainAmount: 0 }, isFine: false });
  (MURMUR_COUNT_FINE === 600 && fine.points.geometry.getAttribute('position').count === 600
    ? ok : bad)('Fine flies 600 birds (position attribute count)');
  (MURMUR_COUNT_PLAIN === 250 && plain.points.geometry.getAttribute('position').count === 250
    ? ok : bad)('Plain flies 250 birds');
  // --- (c) the registerFxMat contract: a uTime uniform to tick -----------------
  (fine.mat.uniforms.uTime && fine.mat.uniforms.uTime.value === 0
    ? ok : bad)('material carries uTime (ticked for free off tickFires)');
  fine.dispose(); plain.dispose();
}

// --- (d) gated off: noon / rain / no season -> invisible, uFade 0 ------------
{
  const noon = new MurmurationLayer({ scene: stubScene(), world: stubWorld(), sky: { time: 0.5, rainAmount: 0 }, isFine: false });
  noon.update(0.1, AUTUMN);
  (noon.points.visible === false && noon.mat.uniforms.uFade.value === 0
    ? ok : bad)('noon: flock invisible, uFade 0 (even in autumn)');
  noon.dispose();

  const wet = new MurmurationLayer({ scene: stubScene(), world: stubWorld(), sky: { time: 0.75, rainAmount: 1 }, isFine: false });
  wet.update(0.1, AUTUMN);
  (wet.points.visible === false && wet.mat.uniforms.uFade.value === 0
    ? ok : bad)('heavy rain at dusk: flock invisible, uFade 0');
  wet.dispose();

  const noSeason = new MurmurationLayer({ scene: stubScene(), world: stubWorld(), sky: { time: 0.75, rainAmount: 0 }, isFine: false });
  noSeason.update(0.1, null);
  (noSeason.points.visible === false && noSeason.mat.uniforms.uFade.value === 0
    ? ok : bad)('no season available: flock invisible, uFade 0');
  noSeason.dispose();
}

// --- (e) dry autumn dusk: repeated update() eases uFade toward 1 --------------
{
  const layer = new MurmurationLayer({ scene: stubScene(), world: stubWorld(), sky: { time: 0.75, rainAmount: 0 }, isFine: false });
  let monotone = true, prev = 0;
  for (let i = 0; i < 200; i++) {
    layer.update(0.1, AUTUMN);
    const f = layer.mat.uniforms.uFade.value;
    if (f < prev - 1e-9) monotone = false;
    prev = f;
  }
  (layer.points.visible === true ? ok : bad)('dry autumn dusk: flock visible');
  (prev > 0.9 ? ok : bad)(`uFade converges toward 1 (${prev.toFixed(3)} after 20s)`);
  (monotone ? ok : bad)('the fade-in is a monotone ease (settles in, never pops back)');
  layer.dispose();
}

// --- (f) dispose(): out of the scene, out of the fire-tick registry ----------
{
  const scene = stubScene();
  const before = fxMatCount();
  const layer = new MurmurationLayer({ scene, world: stubWorld(), sky: { time: 0.75, rainAmount: 0 }, isFine: true });
  (fxMatCount() === before + 1 ? ok : bad)('construction registers exactly one fx material');
  (scene.members.length === 1 ? ok : bad)('construction adds exactly one Points to the scene');
  layer.dispose();
  (scene.members.length === 0 ? ok : bad)('dispose() removes the Points from the scene');
  (fxMatCount() === before ? ok : bad)('dispose() unregisters from the fire tick (zero orphans)');
  (layer.points === null && layer.mat === null ? ok : bad)('dispose() nulls points + mat');
  let threw = false;
  try { layer.update(0.1, AUTUMN); } catch { threw = true; }
  (!threw ? ok : bad)('update() after dispose is a safe no-op');
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
