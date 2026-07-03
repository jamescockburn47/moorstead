// Hearthlight check — run wi': node scripts/verify-hearth.mjs
//
// [5] Hearthlight (src/hearthLayer.js): lit cottage windows after dark. A
// windowed overlay layer in the SeasonalLayer mould — materialises a village's
// dwellings itself, picks facade window cells, and lights a hash-seeded, one-by-
// one-winking-out subset of households through the evening/night window.
//
// The contract this defends:
//   (a) DETERMINISM: two builds against the same synthetic world/seed at the same
//       night hour produce IDENTICAL sets of pane world-positions (no Math.random;
//       hash2i off world seed + building footprint). INVARIANTS rule 6.
//   (b) PER-VILLAGE CAP: a village with 10+ dwellings never lights more than the
//       cap — LIT_MAX_FINE (8) under Fine, LIT_MAX_PLAIN (4) under Plain.
//   (c) uTime CONTRACT: Fine panes are ShaderMaterials carrying uniforms.uTime
//       (the registerFxMat contract); building N panes raises fxMatCount() by N,
//       and clear() returns it to the pre-build baseline (no orphaned flicker mats,
//       INVARIANTS rule 7).
//   (d) DAYTIME GATE: a build at noon (sky.time 0.5) produces zero panes.
//   (e) BEDTIME PROGRESSION: pane count at a later night hour is <= the count at an
//       earlier one (households wink out as the night wears on), plus the
//       window-origin regression guard the layer's hourOf() must satisfy
//       (hourOf(EVENING_START) === 0 — hashing over hours-INTO-the-window, not a
//       raw clock, so households aren't all "asleep" the instant dusk opens).
//
// Headless Node only: no DOM, no WebGL. HearthLayer needs no document (panes are
// MeshBasic/ShaderMaterial, no CanvasTexture), so we import it directly and drive
// it against a synthetic gen/geo/world stub — the same document-free shape the
// layer actually reads (world.gen.geo.{villages,_townBuildings,seed}, gen.height).
// isFine() reads window.moorstead.gfxQuality, so we flip Fine/Plain by stubbing
// that global (Plain is the safe default when window is absent).

import * as THREE from 'three';
import { HearthLayer, hourOf, inEveningWindow, bedtimeHour, facadePanes } from '../src/hearthLayer.js';
import { fxMatCount } from '../src/fire.js';

let failed = false;
const ok  = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// The real constants, mirrored here so the cap assertion states the number it
// defends (kept in step wi' hearthLayer.js:62-63 — a divergence is a real bug).
const LIT_MAX_FINE = 8;
const LIT_MAX_PLAIN = 4;
const EVENING_START = 0.72; // hearthLayer.js:24
const NOON = 0.5;
const NIGHT_EARLY = 0.75;   // just after dusk — hourOf ~0-1
const NIGHT_LATE = 0.18;    // deep into the night window — hourOf large, more abed

// --- Fine/Plain toggle: isFine() reads window.moorstead.gfxQuality ------------
function setQuality(q) {
  if (q == null) { delete global.window; return; }
  global.window = { moorstead: { gfxQuality: q } };
}

// --- synthetic world: exactly the surface HearthLayer.build() reads -----------
// gen.height() — flat ground; gen.geo.villages — one village of N cottages laid
// out as clean 4x4 boxes on a grid (real _townBuildings cottage shape, incl. the
// window-cell rule facadePanes walks: (x+z)%3===0 on the non-corner perimeter);
// gen.geo._townBuildings(v) — materialises v.buildings lazily, as the real geo does.
function makeWorld(seed, nCottages) {
  const buildings = [];
  // Greedily place nCottages 4x4 boxes, >=6 apart on x, each at an x0 whose
  // footprint actually yields facade window cells (facadePanes' (wx+wz)%3===0
  // rule fires only for x0 NOT congruent to the doorway/corner class) — so every
  // dwelling is a real candidate to be lit and the cap/determinism tests aren't
  // silently measuring an empty scene. All inside RADIUS(48) of origin.
  const genForPick = { height: () => 32 };
  let bx = -40, lastX = -999;
  while (buildings.length < nCottages && bx <= 40) {
    const b = { x0: bx, z0: 0, x1: bx + 3, z1: 3, g: 32,
      type: 'cottage', wallH: 4, roof: 'pantile', wall: 'cobble', biz: false };
    if (bx - lastX >= 6 && facadePanes(genForPick, b).length > 0) {
      buildings.push(b); lastX = bx;
    }
    bx++;
  }
  if (buildings.length < nCottages) throw new Error(`makeWorld: only placed ${buildings.length}/${nCottages} lit-capable cottages`);
  const geo = {
    seed,
    villages: [{ x: 0, z: 0, radius: 40, buildings: null }],
    _townBuildings(v) {
      if (v._bld) return v._bld;
      v._bld = buildings;
      return buildings;
    },
  };
  const gen = { geo, height: () => 32 };
  return { gen };
}

const scene = new THREE.Scene ? new THREE.Scene() : { add() {}, remove() {} };
// count only meshes THIS layer added (it tags nothing special, but it's the sole
// adder into our fresh scene, so scene children === live panes)
const paneCount = layer => layer.objects.length;
// stable, order-independent signature of the pane world-positions
const paneSig = layer => layer.objects
  .map(o => `${o.position.x.toFixed(4)},${o.position.y.toFixed(4)},${o.position.z.toFixed(4)}`)
  .sort().join('|');

console.log('\n-- hearthlight: determinism + per-village cap + uTime + daytime gate + bedtime --\n');

// --- (a) determinism: same world/seed/hour -> identical pane position sets -----
{
  setQuality('plain');
  const wA = makeWorld(0xBEEF, 12);
  const wB = makeWorld(0xBEEF, 12);
  const a = new HearthLayer(new THREE.Scene(), wA);
  const b = new HearthLayer(new THREE.Scene(), wB);
  a.update(1, { x: 0, z: 0 }, { time: NIGHT_EARLY });
  b.update(1, { x: 0, z: 0 }, { time: NIGHT_EARLY });
  const sigA = paneSig(a), sigB = paneSig(b);
  (sigA === sigB && sigA.length > 0
    ? ok : bad)(`two builds, same seed/hour -> identical pane position sets (${a.objects.length} panes)`);

  // rebuild the SAME layer at the SAME hour is idempotent in position set too
  const first = paneSig(a);
  a.center = null; a._builtOnce = false; a.timer = 0; // force a fresh build
  a.update(1, { x: 0, z: 0 }, { time: NIGHT_EARLY });
  (paneSig(a) === first ? ok : bad)('re-building the same layer at the same hour is position-stable');
  a.clear(); b.clear();
}

// --- (b) per-village cap: 10+ dwellings never exceed the lit cap --------------
{
  // Plain cap (4)
  setQuality('plain');
  const wP = makeWorld(0x1234, 12); // 12 dwellings, well over any cap
  const lp = new HearthLayer(new THREE.Scene(), wP);
  // build at hour 0 (EVENING_START) so NO household has passed bedtime yet — this
  // is the worst case for the cap (every dwelling wants to be lit).
  lp.update(1, { x: 0, z: 0 }, { time: EVENING_START });
  const litP = lp.objects.length / 3; // up to 3 panes per lit dwelling
  (Math.ceil(litP) <= LIT_MAX_PLAIN
    ? ok : bad)(`Plain: 12 dwellings light at most ${LIT_MAX_PLAIN} (lit ~${Math.ceil(litP)}, ${lp.objects.length} panes)`);
  lp.clear();

  // Fine cap (8)
  setQuality('fine');
  const wF = makeWorld(0x1234, 12);
  const lf = new HearthLayer(new THREE.Scene(), wF);
  lf.update(1, { x: 0, z: 0 }, { time: EVENING_START });
  const litF = lf.objects.length / 3;
  (Math.ceil(litF) <= LIT_MAX_FINE
    ? ok : bad)(`Fine: 12 dwellings light at most ${LIT_MAX_FINE} (lit ~${Math.ceil(litF)}, ${lf.objects.length} panes)`);
  (Math.ceil(litF) <= 12
    ? ok : bad)('cap never exceeds the number of dwellings that exist');
  lf.clear();
}

// --- (c) uTime contract: Fine panes register on the fire tick; clear() balances -
{
  setQuality('fine');
  const w = makeWorld(0x77AA, 12);
  const base = fxMatCount();
  const l = new HearthLayer(new THREE.Scene(), w);
  l.update(1, { x: 0, z: 0 }, { time: EVENING_START });
  const panes = l.objects.length;
  (panes > 0 ? ok : bad)(`Fine build produced panes to check (${panes})`);
  // every Fine pane material carries uniforms.uTime (the registerFxMat contract)
  const allHaveUTime = l.objects.every(o => o.material.uniforms && o.material.uniforms.uTime);
  (allHaveUTime ? ok : bad)('every Fine pane material carries uniforms.uTime (registerFxMat contract)');
  (fxMatCount() === base + panes
    ? ok : bad)(`constructing Fine panes raised fxMatCount by the pane count (+${panes}: ${base} -> ${fxMatCount()})`);
  l.clear();
  (fxMatCount() === base
    ? ok : bad)(`clear() returned fxMatCount to baseline — no orphaned flicker mats (${fxMatCount()} === ${base})`);

  // Plain panes are shared MeshBasic — they must NOT touch the fx registry at all
  setQuality('plain');
  const base2 = fxMatCount();
  const lp = new HearthLayer(new THREE.Scene(), makeWorld(0x77AA, 12));
  lp.update(1, { x: 0, z: 0 }, { time: EVENING_START });
  (fxMatCount() === base2
    ? ok : bad)('Plain panes register nothing on the fire tick (steady amber, no uTime)');
  lp.clear();
  (fxMatCount() === base2 ? ok : bad)('Plain clear() leaves the fx registry untouched');
}

// --- (d) daytime gate: noon builds zero panes ---------------------------------
{
  setQuality('fine');
  const l = new HearthLayer(new THREE.Scene(), makeWorld(0x9001, 12));
  l.update(1, { x: 0, z: 0 }, { time: NOON });
  (l.objects.length === 0 ? ok : bad)(`noon (sky.time ${NOON}) builds zero panes (got ${l.objects.length})`);
  (!inEveningWindow(NOON) ? ok : bad)('inEveningWindow(noon) is false — the daytime gate is closed');
  l.clear();
}

// --- (e) bedtime progression + the hourOf window-origin regression guard -------
{
  setQuality('plain');
  // The regression guard the layer itself must satisfy: hour 0 IS the instant the
  // window opens (EVENING_START), so bedtimes hash over hours-INTO-the-window.
  (hourOf(EVENING_START) === 0
    ? ok : bad)(`hourOf(EVENING_START) === 0 — bedtimes hash over hours-into-the-window (got ${hourOf(EVENING_START)})`);
  (hourOf(EVENING_START) < hourOf(NIGHT_LATE)
    ? ok : bad)(`the hour ticks up through the night (hourOf dusk ${hourOf(EVENING_START)} < late ${hourOf(NIGHT_LATE)})`);

  // Pane count is monotone NON-INCREASING as the night wears on: households only
  // ever wink out (bedtime is a fixed threshold `hour` climbs past), never light
  // back up. Sweep the whole lit window at a fixed position/seed.
  const w = makeWorld(0x5EED, 14);
  let prev = Infinity, monotone = true, sawSome = false, sawFewer = false;
  const hours = [EVENING_START, 0.78, 0.85, 0.95, 0.02, 0.10, 0.18];
  for (const t of hours) {
    const l = new HearthLayer(new THREE.Scene(), w);
    l.update(1, { x: 0, z: 0 }, { time: t });
    const c = l.objects.length;
    if (c > 0) sawSome = true;
    if (c < prev && prev !== Infinity) sawFewer = true;
    if (c > prev) monotone = false;
    prev = c;
    l.clear();
  }
  (monotone ? ok : bad)('pane count never RISES as the night wears on (households only wink out)');
  (sawSome ? ok : bad)('some households are lit at some point in the window (the effect is visible)');
  (sawFewer ? ok : bad)('households do wink out over the night (later hour < earlier hour at least once)');
}

// --- (f) facadePanes purity: deterministic, and honours the window-cell rule ----
{
  const gen = { height: () => 32 };
  const b = { x0: 0, z0: 0, x1: 3, z1: 3 };
  const p1 = JSON.stringify(facadePanes(gen, b));
  const p2 = JSON.stringify(facadePanes(gen, b));
  (p1 === p2 ? ok : bad)('facadePanes is deterministic (same building -> same panes, same order)');
  const bedA = bedtimeHour(0, 3, 0xBEEF);
  (bedA === bedtimeHour(0, 3, 0xBEEF) ? ok : bad)('bedtimeHour is a pure deterministic draw');
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
