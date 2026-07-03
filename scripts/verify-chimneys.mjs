// Chimney smoke (hearth plumes) check — run wi': node scripts/verify-chimneys.mjs
//
// The contract this defends (the plume factory itself is covered in verify-fire.mjs):
//   (a) a cold-season build raises plumes over cottage/farmhouse roofs only —
//       never a chapel/business — capped at the Plain tier headlessly
//       (isFine() is false under bare Node, so the cap is CHIMNEY_MAX_PLAIN = 3);
//   (b) broad warm daylight (summer noon; nightFactor 0 headless) builds NOWT;
//   (c) plume positions are deterministic across two independent builds
//       (hash-seeded gable corners — invariant 6, no Math.random) and sit at a
//       gable-end column above the worldgen ridge line;
//   (d) the fx ramp eases each plume's uGate 0 -> 1 (no pop), and
//   (e) SeasonalLayer.clear() releases every plume frae the fire-tick registry
//       (fxMatCount back to baseline — zero orphans).
//
// Harness cribbed from verify-festival-render.mjs / verify-festivalwow.mjs
// (document stub + mock world); no initMaterials needed — the chimney pass
// never touches the terrain atlas.

// --- stub document BEFORE any import that may lazily touch canvas ------------
global.document = {
  createElement: (tag) => {
    if (tag !== 'canvas') return {};
    const ctx2d = { clearRect: () => {}, fillRect: () => {}, drawImage: () => {}, fillStyle: '' };
    return { width: 0, height: 0, getContext: () => ctx2d };
  },
};

// --- imports (after stub) ------------------------------------------------------
import * as THREE from 'three';
import { seasonStateAtPhase } from '../src/season.js';
import { fxMatCount } from '../src/fire.js';
import { SeasonalLayer } from '../src/seasonalLayer.js';

let failed = false;
const ok  = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// --- mock world: one village, 4 hearth-worthy homes + a chapel ----------------
const CX = 100, CZ = 100, GROUND = 32, WALL_H = 4;
const CHAPEL = { type: 'chapel',    x0: 97,  x1: 103, z0: 88,  z1: 92 };
const FARM   = { type: 'farmhouse', x0: 88,  x1: 93,  z0: 95,  z1: 100 };
const COT1   = { type: 'cottage',   x0: 105, x1: 108, z0: 95,  z1: 98 };
const COT2   = { type: 'cottage',   x0: 94,  x1: 97,  z0: 104, z1: 107 };
const COT3   = { type: 'cottage',   x0: 110, x1: 113, z0: 104, z1: 107 }; // a 4th candidate — proves the cap of 3
const HOMES  = [FARM, COT1, COT2, COT3];
const VILLAGE = { x: CX, z: CZ, buildings: [CHAPEL, ...HOMES] };
const mkGen = (buildings = VILLAGE.buildings) => ({
  height: () => GROUND,
  geo: { villages: [{ x: CX, z: CZ, buildings }], seed: 0xdeadbeef },
});
const mockWorld = { gen: mkGen(), snowmanLedger: new Map(), getBlock: () => 0 };

const WINTER = seasonStateAtPhase(0.875);  // deep winter — the range is lit
const SUMMER = seasonStateAtPhase(0.375);  // high summer — noon, no fires
(WINTER.warmth < 0.15 ? ok : bad)(`deep winter is cold enough to light the range (warmth ${WINTER.warmth.toFixed(2)} < 0.15)`);
(SUMMER.warmth >= 0.15 ? ok : bad)(`high summer is warm enough to let it out (warmth ${SUMMER.warmth.toFixed(2)} >= 0.15)`);

const plumesOf = layer => layer.objects.filter(o => o.userData && o.userData.smokeMat);
const buildLayer = (season, gen = mockWorld.gen) => {
  const layer = new SeasonalLayer(new THREE.Scene(), mockWorld);
  layer.buildChimneySmoke(CX, CZ, gen, season);
  return layer;
};

// --- (a) winter: plumes on homes only, Plain-capped at 3 ----------------------
const base = fxMatCount();
const layerA = buildLayer(WINTER);
const plumesA = plumesOf(layerA);
(plumesA.length === 3 ? ok : bad)(`winter build raises exactly 3 plumes headless (Plain cap; 4 homes offered, got ${plumesA.length})`);
(plumesA.length >= 1 && plumesA.length <= 3 ? ok : bad)('plume count sits in the 1..3 Plain band');
(fxMatCount() === base + plumesA.length ? ok : bad)('every plume registers its material wi\' the fire tick');
{
  // every plume must sit at a gable-end column of SOME cottage/farmhouse, a
  // touch above the worldgen ridge (g + wallH + 1 + floor((z1-z0)/2) + 0.6) —
  // which also proves none landed on the chapel.
  let allSited = true;
  for (const p of plumesA) {
    const home = HOMES.find(b =>
      (p.position.x === b.x0 + 1.5 || p.position.x === b.x1 - 0.5) &&
      p.position.y === GROUND + WALL_H + 1 + Math.floor((b.z1 - b.z0) / 2) + 0.6 &&
      p.position.z >= b.z0 && p.position.z <= b.z1 + 1);
    if (!home) allSited = false;
  }
  (allSited ? ok : bad)('every plume sits at a home\'s gable-end chimney above the ridge (chapel untouched)');
  (plumesA.every(p => typeof p.dispose === 'function') ? ok : bad)('every plume carries a dispose() (unregisters its material)');
}

// --- (c) determinism: a second independent build lands identical plumes -------
{
  const layerB = buildLayer(WINTER);
  const posOf = ps => ps.map(p => [p.position.x, p.position.y, p.position.z])
    .sort((a, b) => a[0] - b[0] || a[2] - b[2]);
  (JSON.stringify(posOf(plumesA)) === JSON.stringify(posOf(plumesOf(layerB)))
    ? ok : bad)('two independent builds site identical plumes (hash-seeded, no Math.random)');
  const phasesEqual = plumesA.map(p => p.material.uniforms.uPhase.value).sort().join(',') ===
    plumesOf(layerB).map(p => p.material.uniforms.uPhase.value).sort().join(',');
  (phasesEqual ? ok : bad)('per-house puff phases are deterministic too');
  layerB.clear();
}

// --- (d) the fx ramp eases uGate in (cold gate = 1, nightFactor 0 headless) ---
{
  (plumesA.every(p => p.material.uniforms.uGate.value === 0) ? ok : bad)('plumes start hidden (uGate 0, ramped in — no pop)');
  for (let i = 0; i < 100; i++) for (const fx of layerA._fx) fx(i * 0.1, 0.1);
  (plumesA.every(p => p.material.uniforms.uGate.value > 0.9)
    ? ok : bad)('the fx ramp eases every plume\'s uGate toward 1 in the cold');
}

// --- (e) clear() drops the registry back to baseline --------------------------
layerA.clear();
(fxMatCount() === base ? ok : bad)('clear() unregisters every plume (fx registry back to baseline, zero orphans)');
(layerA.objects.length === 0 ? ok : bad)('clear() empties the dressing object list');

// --- (b) summer noon: no fires lit, nowt built ---------------------------------
{
  const layer = buildLayer(SUMMER);
  (plumesOf(layer).length === 0 ? ok : bad)('summer noon builds no plumes (warm + broad daylight)');
  (fxMatCount() === base ? ok : bad)('and registers nowt wi\' the fire tick');
  layer.clear();
}

// --- homes-only filter: a chapel-only village raises no smoke -----------------
{
  const layer = buildLayer(WINTER, mkGen([CHAPEL]));
  (plumesOf(layer).length === 0 ? ok : bad)('a village of only a chapel gets no hearth plume (cottage/farmhouse only)');
  layer.clear();
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
