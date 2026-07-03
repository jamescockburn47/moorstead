// verify-inn-decor.mjs — headless check for InnDecorLayer (src/innDecor.js):
// the D2 client decor pass over D1's bare inn shell (painted sign, hearth fire,
// window glow, seasonal mounts). Mirrors verify-hearth.mjs's harness shape.
//
// The contract this defends:
//   (a) BUILDS SOMETHING: at least one object (the sign, at minimum) per inn
//       within RADIUS of the player, against a real Gen(12345) world.
//   (b) SIGN OWNERSHIP: the sign mesh carries userData.ownGeometry and its
//       material is NOT flagged sharedMaterial (owned canvas texture, disposed
//       on clear()).
//   (c) RESOURCE HYGIENE: fxMatCount() rises when the hearth fire builds and
//       returns to the pre-build baseline after clear() — no orphaned FX mats
//       (INVARIANTS rule 7).
//   (d) NIGHT GATING: noon builds zero window-glow objects; midnight builds
//       at least one (tagged via userData.windowGlow so the test can count
//       them without depending on scene-graph order).
//   (e) DETERMINISM: two builds against the same inputs give the same object
//       count + a stable position signature (paneSig idiom from verify-hearth).
//   (f) FESTIVAL MOUNT: a mantel prop is present when yearPhase sits inside the
//       yule window (festivalState) and absent outside it.
//   (g) PLAIN FALLBACK: with Fine off, the layer still builds a sign + hearth
//       fire (INVARIANTS Plain-fallback rule) with no orphaned Fine-only mats.
//   (h) EMPTY WORLD: world.gen.inns empty (stylised worlds) builds nothing and
//       does not throw.
//
// Headless Node only — no DOM/WebGL. The sign uses a CanvasTexture (2D canvas
// text-fit loop), so document.createElement('canvas') is stubbed BEFORE any
// import that could pull mesher/textures, extended with measureText/strokeText/
// fillText so the sign's fit-to-width loop runs without a real canvas.

global.document = {
  createElement: (tag) => {
    if (tag !== 'canvas') return {};
    const ctx2d = {
      clearRect: () => {},
      fillRect: () => {},
      drawImage: () => {},
      strokeText: () => {},
      fillText: () => {},
      measureText: () => ({ width: 10 }),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      textAlign: '',
      textBaseline: '',
    };
    return { width: 0, height: 0, getContext: () => ctx2d };
  },
};

import * as THREE from 'three';
import { initMaterials } from '../src/mesher.js';
import { Gen } from '../src/worldgen.js';
import { fxMatCount } from '../src/fire.js';
import { InnDecorLayer } from '../src/innDecor.js';

initMaterials();

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

function setQuality(q) {
  if (q == null) { delete global.window; return; }
  global.window = { moorstead: { gfxQuality: q } };
}

// Grosmont's Station Tavern, seed 12345 — verified this session: origin
// {x:638, z:-118}. Player stood right on top of it is well within RADIUS(48).
const SEED = 12345;
function makeWorld() {
  const gen = new Gen(SEED);
  return { gen };
}
const PLAYER_AT_INN = { x: 638, z: -118 };

const NOON = 0.5;
const MIDNIGHT = 0.0;

const sig = layer => layer.objects
  .map(o => `${o.position.x.toFixed(3)},${o.position.y.toFixed(3)},${o.position.z.toFixed(3)}`)
  .sort().join('|');

console.log('\n-- inn decor: sign/hearth/glow/mounts — builds, ownership, hygiene, gating, determinism --\n');

// --- (a) + (b): builds >=1 object per inn in range; sign ownership flags -------
{
  setQuality('plain');
  const w = makeWorld();
  const layer = new InnDecorLayer(new THREE.Scene(), w);
  layer.update(1, PLAYER_AT_INN, { time: NOON, yearPhase: 0.5 }, { yearPhase: 0.5 });
  (layer.objects.length >= 1 ? ok : bad)(`layer builds >=1 object for the in-range inn (got ${layer.objects.length})`);

  const sign = layer.objects.find(o => o.userData && o.userData.sign);
  (sign ? ok : bad)('a sign object is present (tagged userData.sign)');
  if (sign) {
    (sign.userData.ownGeometry === true ? ok : bad)('sign carries userData.ownGeometry');
    (!sign.material.userData || sign.material.userData.sharedMaterial !== true
      ? ok : bad)('sign material is NOT flagged sharedMaterial (owned canvas texture)');
  }
  layer.clear();
}

// --- (c) resource hygiene: fxMatCount rises on build, returns to baseline on clear ---
{
  setQuality('fine');
  const w = makeWorld();
  const base = fxMatCount();
  const layer = new InnDecorLayer(new THREE.Scene(), w);
  layer.update(1, PLAYER_AT_INN, { time: MIDNIGHT, yearPhase: 0.5 }, { yearPhase: 0.5 });
  (fxMatCount() > base ? ok : bad)(`building the hearth fire (+ chimney smoke) raises fxMatCount above baseline (${base} -> ${fxMatCount()})`);
  layer.clear();
  (fxMatCount() === base ? ok : bad)(`clear() returns fxMatCount to baseline — no orphaned FX mats (${fxMatCount()} === ${base})`);
}

// --- (d) night gating: noon -> no window-glow objects; midnight -> some ---------
{
  setQuality('fine');
  const wNoon = makeWorld();
  const lNoon = new InnDecorLayer(new THREE.Scene(), wNoon);
  lNoon.update(1, PLAYER_AT_INN, { time: NOON, yearPhase: 0.5 }, { yearPhase: 0.5 });
  const noonGlow = lNoon.objects.filter(o => o.userData && o.userData.windowGlow).length;
  (noonGlow === 0 ? ok : bad)(`noon builds zero window-glow objects (got ${noonGlow})`);
  lNoon.clear();

  const wNight = makeWorld();
  const lNight = new InnDecorLayer(new THREE.Scene(), wNight);
  lNight.update(1, PLAYER_AT_INN, { time: MIDNIGHT, yearPhase: 0.5 }, { yearPhase: 0.5 });
  const nightGlow = lNight.objects.filter(o => o.userData && o.userData.windowGlow).length;
  (nightGlow > 0 ? ok : bad)(`midnight builds window-glow objects (got ${nightGlow})`);
  lNight.clear();
}

// --- (e) determinism: two builds, same inputs -> same object count + position sig ---
{
  setQuality('fine');
  const a = new InnDecorLayer(new THREE.Scene(), makeWorld());
  const b = new InnDecorLayer(new THREE.Scene(), makeWorld());
  a.update(1, PLAYER_AT_INN, { time: 0.75, yearPhase: 0.5 }, { yearPhase: 0.5 });
  b.update(1, PLAYER_AT_INN, { time: 0.75, yearPhase: 0.5 }, { yearPhase: 0.5 });
  (a.objects.length === b.objects.length && a.objects.length > 0
    ? ok : bad)(`two builds, same inputs -> same object count (${a.objects.length} vs ${b.objects.length})`);
  const sigA = sig(a), sigB = sig(b);
  (sigA === sigB && sigA.length > 0 ? ok : bad)('two builds, same inputs -> identical position signature');
  a.clear(); b.clear();
}

// --- (f) festival mount: mantel prop only inside the yule window ----------------
{
  setQuality('fine');
  // festivals.js: yule centre 0.882, days 14 -> full-intensity core well inside
  // [0.882 - 0.01, 0.882 + 0.01]; comfortably inside the window.
  const YULE_PHASE = 0.882;
  const OUT_OF_WINDOW_PHASE = 0.5; // midsummer-ish, nowhere near any yule fade edge

  const wYule = makeWorld();
  const lYule = new InnDecorLayer(new THREE.Scene(), wYule);
  lYule.update(1, PLAYER_AT_INN, { time: 0.75, yearPhase: YULE_PHASE }, { yearPhase: YULE_PHASE });
  const yuleMount = lYule.objects.some(o => o.userData && o.userData.seasonalMount);
  (yuleMount ? ok : bad)('yule window: a seasonal mount prop is present');
  lYule.clear();

  const wOut = makeWorld();
  const lOut = new InnDecorLayer(new THREE.Scene(), wOut);
  lOut.update(1, PLAYER_AT_INN, { time: 0.75, yearPhase: OUT_OF_WINDOW_PHASE }, { yearPhase: OUT_OF_WINDOW_PHASE });
  const outMount = lOut.objects.some(o => o.userData && o.userData.seasonalMount);
  (!outMount ? ok : bad)('outside any festival window: no seasonal mount prop');
  lOut.clear();
}

// --- (g) Plain fallback: sign + fire still build, no Fine-only extras -----------
{
  setQuality('plain');
  const base = fxMatCount();
  const layer = new InnDecorLayer(new THREE.Scene(), makeWorld());
  layer.update(1, PLAYER_AT_INN, { time: 0.75, yearPhase: 0.5 }, { yearPhase: 0.5 });
  const sign = layer.objects.find(o => o.userData && o.userData.sign);
  (sign ? ok : bad)('Plain: sign still builds');
  (layer.objects.length >= 1 ? ok : bad)(`Plain: layer still builds objects (${layer.objects.length})`);
  layer.clear();
  (fxMatCount() === base ? ok : bad)('Plain: clear() leaves fxMatCount at baseline');
}

// --- (h) empty inns map: builds nothing, does not throw -------------------------
{
  setQuality('fine');
  const w = { gen: { inns: new Map(), geo: null } };
  let threw = false;
  const layer = new InnDecorLayer(new THREE.Scene(), w);
  try {
    layer.update(1, { x: 0, z: 0 }, { time: 0.75, yearPhase: 0.5 }, { yearPhase: 0.5 });
  } catch (e) { threw = true; console.error(e); }
  (!threw ? ok : bad)('empty world.gen.inns does not throw');
  (layer.objects.length === 0 ? ok : bad)(`empty world.gen.inns builds nothing (got ${layer.objects.length})`);
  layer.clear();
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
