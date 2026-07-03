// Wet ground ([9/17 merged] + [D6] puddles + [D10] slow dry) — run wi':
//   node scripts/verify-wetground.mjs
//
// The contract this defends:
//   (a) stepGroundWet ASYMMETRY: the ground soaks FAST while it's raining and dries SLOW
//       after — and the dry rate scales with warmth (a warm day dries quicker) and daylight
//       (overnight rain lingers to morning). Bounded in [0,1], deterministic (pure fn).
//   (b) aWet BAKE on a synthetic chunk: a top face walled one course up bakes hollowCount>0;
//       flat sand bakes a low soak-bias fraction; non-top faces (and the flat default) 0.
//   (c) [D10] wetEff shaping: at mid-decay, EXPOSED ground has dried more than SHELTERED
//       ground (AO-dark crevices hold the damp longest) — the JS twin of the shader term.
//
// Headless three.js builds fine (we never render); the one non-pure dep is the material
// atlas, satisfied by stubbing document before initMaterials (verify-water pattern).

global.document = {
  createElement: (tag) => {
    if (tag !== 'canvas') return {};
    const ctx2d = { clearRect: () => {}, fillRect: () => {}, drawImage: () => {}, fillStyle: '' };
    return { width: 0, height: 0, getContext: () => ctx2d };
  },
};

import { B, CHUNK, HEIGHT } from '../src/defs.js';
import { initMaterials, getMaterials, buildChunkMeshes, soakBias, SOAK_DEFAULT } from '../src/mesher.js';
import { stepGroundWet, wetEff } from '../src/wetness.js';
import { TILE } from '../src/defs.js';

initMaterials();

let failed = false;
const ok  = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const IDX = (x, y, z) => x + z * CHUNK + y * CHUNK * CHUNK;

console.log('\n-- wet ground: drive asymmetry + aWet bake + slow-dry shaping --\n');

// --- (a) stepGroundWet: soaks fast, dries slow, warmth/dayness scale the dry rate ------
{
  // soak: from bone dry, a second of hard rain wets the ground appreciably
  const soaked = stepGroundWet(0, 1.0, 0.5, 1.0, 1.0);
  (soaked > 0 ? ok : bad)(`rain soaks the ground in (0 -> ${soaked.toFixed(4)} after 1s of rain)`);

  // dry: from fully wet, a second of no rain dries it only a little
  const dried = 1.0 - stepGroundWet(1.0, 0, 0.5, 1.0, 1.0);
  (dried > 0 ? ok : bad)(`no rain dries the ground out (1 -> ${(1 - dried).toFixed(4)} after 1s dry)`);

  // ASYMMETRY: soaking is much faster than drying under the same conditions
  (soaked > dried * 2 ? ok : bad)(`soak is much faster than dry (soak ${soaked.toFixed(4)} >> dry ${dried.toFixed(4)})`);

  // rain gate: a mere drizzle (<=0.2) does NOT soak — it dries
  const drizzle = stepGroundWet(0.5, 0.2, 0.5, 1.0, 1.0);
  (drizzle < 0.5 ? ok : bad)(`drizzle (rainAmount 0.2) does not soak — ground dries (0.5 -> ${drizzle.toFixed(4)})`);
  const realRain = stepGroundWet(0.5, 0.21, 0.5, 1.0, 1.0);
  (realRain > 0.5 ? ok : bad)(`real rain (rainAmount 0.21) soaks (0.5 -> ${realRain.toFixed(4)})`);

  // WARMTH scales the dry rate: a warm day dries faster than a cold one
  const dryWarm = 1.0 - stepGroundWet(1.0, 0, 1.0, 1.0, 1.0);
  const dryCold = 1.0 - stepGroundWet(1.0, 0, 0.0, 1.0, 1.0);
  (dryWarm > dryCold ? ok : bad)(`warmth speeds drying (warm ${dryWarm.toFixed(4)} > cold ${dryCold.toFixed(4)})`);
  // negative warmth (a hard frost) never speeds drying beyond the cold floor
  const dryFrost = 1.0 - stepGroundWet(1.0, 0, -1.0, 1.0, 1.0);
  (Math.abs(dryFrost - dryCold) < 1e-9 ? ok : bad)('negative warmth clamps to the cold floor (only warmth helps dry)');

  // DAYNESS scales the dry rate: daytime dries faster than overnight
  const dryDay = 1.0 - stepGroundWet(1.0, 0, 0.5, 1.0, 1.0);
  const dryNight = 1.0 - stepGroundWet(1.0, 0, 0.5, 0.0, 1.0);
  (dryDay > dryNight ? ok : bad)(`daylight speeds drying — overnight rain lingers (day ${dryDay.toFixed(4)} > night ${dryNight.toFixed(4)})`);
  (dryNight > 0 ? ok : bad)('overnight still dries a little (never fully stalls)');

  // bounds + determinism
  (stepGroundWet(1.0, 1.0, 0.5, 1.0, 999) <= 1.0 ? ok : bad)('wetness never exceeds 1 (soak clamps)');
  (stepGroundWet(0.0, 0, 0.5, 1.0, 999) >= 0.0 ? ok : bad)('wetness never drops below 0 (dry clamps)');
  (stepGroundWet(0.4, 0.5, 0.3, 0.8, 0.13) === stepGroundWet(0.4, 0.5, 0.3, 0.8, 0.13) ? ok : bad)('stepGroundWet is deterministic (pure)');
}

// --- (b) aWet bake: hollow column bakes hol>0; sand low bias; non-top 0 ---------------
{
  // soakBias table sanity (pure)
  (soakBias(TILE.SAND) === 0.1 ? ok : bad)('soakBias: sand drinks poorly (0.1)');
  (soakBias(TILE.GRAVEL) === 0.85 && soakBias(TILE.DIRT) === 0.85 ? ok : bad)('soakBias: gravel/dirt pool readily (0.85)');
  (soakBias(TILE.STONE) === 0.7 ? ok : bad)('soakBias: stone/cobble a touch less (0.7)');
  (soakBias(TILE.GRASS_TOP) === 0.45 ? ok : bad)('soakBias: grass drinks it in (0.45)');
  (soakBias(999) === SOAK_DEFAULT ? ok : bad)(`soakBias: unlisted tile takes the default (${SOAK_DEFAULT})`);

  // Synthetic chunk. A flat sand pad and a walled dirt pit, both floored at y=30.
  const data = new Uint8Array(CHUNK * CHUNK * HEIGHT);
  // flat sand top at (2,30,2) — no walls, so hollowCount 0, bias 0.1 -> aWet 0.1
  data[IDX(2, 30, 2)] = B.SAND;
  // dirt top at (8,30,8) surrounded by dirt walls one course UP on all 4 sides -> hollowCount 4
  data[IDX(8, 30, 8)] = B.DIRT;
  data[IDX(7, 31, 8)] = B.DIRT; data[IDX(9, 31, 8)] = B.DIRT;
  data[IDX(8, 31, 7)] = B.DIRT; data[IDX(8, 31, 9)] = B.DIRT;

  const fakeWorld = { getBlock: () => B.AIR, gen: { geo: { coastT: () => 0 } } };
  const meshes = buildChunkMeshes(fakeWorld, { cx: 0, cz: 0, data });
  const sm = meshes.find(m => m.material === getMaterials().opaque);
  if (!sm) { bad('synthetic ground chunk builds a solid mesh'); }
  else {
    ok('synthetic ground chunk builds a solid mesh');
    const pos = sm.geometry.getAttribute('position');
    const norm = sm.geometry.getAttribute('normal');
    const wet = sm.geometry.getAttribute('aWet');
    (wet && wet.itemSize === 1 && wet.count === pos.count ? ok : bad)('aWet present, one float per solid vert');

    // gather aWet by (world XZ) on UP-facing (top) verts vs side/bottom verts
    let sandTopWet = null, pitTopWet = null, nonTopNonZero = 0;
    for (let i = 0; i < pos.count; i++) {
      const up = norm.getY(i) > 0.5;               // top face
      const w = wet.getX(i);
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (!up) { if (w !== 0) nonTopNonZero++; continue; }
      // sand pad top sits at y=31 (block y=30); pit FLOOR top also at y=31, but the
      // surrounding wall tops are at y=32 — filter on y so we read the floor, not a wall.
      if (x >= 2 && x <= 3 && z >= 2 && z <= 3 && y < 31.5) sandTopWet = w;
      if (x >= 8 && x <= 9 && z >= 8 && z <= 9 && y < 31.5) pitTopWet = w;
    }
    (nonTopNonZero === 0 ? ok : bad)(`non-top faces bake aWet 0 (${nonTopNonZero} non-top verts carried a value)`);
    (sandTopWet !== null ? ok : bad)('sand top face found');
    (pitTopWet !== null ? ok : bad)('walled pit top face found');
    if (sandTopWet !== null) {
      (Math.floor(sandTopWet) === 0 ? ok : bad)(`flat sand bakes hollowCount 0 (aWet ${sandTopWet})`);
      (Math.abs((sandTopWet % 1) - 0.1) < 1e-5 ? ok : bad)(`flat sand bakes the low sand soak-bias 0.1 (frac ${(sandTopWet % 1).toFixed(3)})`);
    }
    if (pitTopWet !== null) {
      (Math.floor(pitTopWet) === 4 ? ok : bad)(`walled pit bakes hollowCount 4 (aWet ${pitTopWet})`);
      (Math.abs((pitTopWet % 1) - 0.85) < 1e-5 ? ok : bad)(`pit floor (dirt) bakes the dirt soak-bias 0.85 (frac ${(pitTopWet % 1).toFixed(3)})`);
    }
    if (sandTopWet !== null && pitTopWet !== null) {
      (pitTopWet > sandTopWet ? ok : bad)('the hollow pit reads far wetter than the flat pad (puddle collects in the dip)');
    }
  }
}

// --- (c) [D10] wetEff: exposed dries before sheltered at mid-decay --------------------
{
  // shel 0 = fully open/sunlit; shel 1 = a deep AO'd crevice
  const g = 0.5; // mid-decay
  const exposed = wetEff(g, 0.0);
  const sheltered = wetEff(g, 1.0);
  (sheltered > exposed ? ok : bad)(`at mid-decay the sheltered crevice stays wetter than the open top (shel ${sheltered.toFixed(4)} > exposed ${exposed.toFixed(4)})`);
  // the ordering holds across the whole decay, never crosses
  let monotone = true;
  for (let gg = 0.05; gg < 1.0; gg += 0.05) if (wetEff(gg, 1.0) < wetEff(gg, 0.0)) monotone = false;
  (monotone ? ok : bad)('sheltered ground is wetter than exposed at EVERY decay level (exponent shaping never inverts)');
  // endpoints: bone dry and fully wet agree regardless of shelter
  (Math.abs(wetEff(0, 0.5)) < 1e-9 ? ok : bad)('fully dried (groundWet 0) is dry everywhere, sheltered or not');
  (Math.abs(wetEff(1, 0.5) - 1) < 1e-9 ? ok : bad)('fully wet (groundWet 1) is wet everywhere, sheltered or not');
  (wetEff(2, 0.5) === wetEff(1, 0.5) && wetEff(-1, 0.5) === wetEff(0, 0.5) ? ok : bad)('wetEff clamps groundWet + shel to [0,1]');
}

console.log('');
if (failed) { console.error('verify-wetground: FAILED'); process.exit(1); }
console.log('verify-wetground: all checks passed');
