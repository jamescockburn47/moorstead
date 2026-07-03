// [19] GPU precipitation check — run wi': node scripts/verify-precip.mjs
//
// T' fall itself lives in t' vertex shader now (PRECIP_VERT_MOVE): a STATIC seeded
// base field, wind slant, sway, squall band an' a density threshold — t' owd CPU
// per-particle loops are GONE. Pure pieces (buildPrecipField, windGust, windHeading,
// winterPrecip) are tested functionally; t' shader/uniform wiring is source-level
// (headless Node has no GL). Contract under guard: seeded determinism (invariant 6),
// exact-count Plain culling that thins but never shortens t' column, shared-clock
// wind every client agrees on, an' t' pooled no-alloc hot path.

import { readFileSync } from 'node:fs';
import {
  buildPrecipField, windGust, windHeading,
  RAIN_MAX, RAIN_PLAIN, SNOW_MAX, SNOW_PLAIN,
  RAIN_FALL, SNOW_FALL, RAIN_SPAN, SNOW_SPAN,
} from '../src/sky.js';
import { winterPrecip } from '../src/snow.js';

let failed = false;
const ok  = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const skySrc = readFileSync(new URL('../src/sky.js', import.meta.url), 'utf8');

// --- t' fall speeds are t' owd CPU loops' exact speeds (today's look, made static) ---
{
  (RAIN_FALL === 22 ? ok : bad)('RAIN_FALL is 22 blocks/s — t\' CPU loop\'s exact speed');
  (SNOW_FALL === 6.5 ? ok : bad)('SNOW_FALL is 6.5 blocks/s — t\' CPU loop\'s exact speed');
  (RAIN_PLAIN < RAIN_MAX && SNOW_PLAIN < SNOW_MAX ? ok : bad)('Plain counts sit under t\' Fine maxima (uDensity culls down, never up)');
}

// --- seeded base field: deterministic, byte-identical, no Math.random (invariant 6) ---
const rainA = (() => {
  const realRandom = Math.random;
  Math.random = () => { throw new Error('buildPrecipField must not consult Math.random (invariant 6)'); };
  let A, B, SA, SB;
  try {
    A = buildPrecipField(RAIN_MAX, RAIN_SPAN, 0, 0x5261);        // t' constructor's real rain args
    B = buildPrecipField(RAIN_MAX, RAIN_SPAN, 0, 0x5261);
    SA = buildPrecipField(SNOW_MAX, SNOW_SPAN, -28, 0x534E);     // …an' its real snow args
    SB = buildPrecipField(SNOW_MAX, SNOW_SPAN, -28, 0x534E);
  } finally { Math.random = realRandom; }
  ok('base fields built wi\' Math.random poisoned — nowt unseeded in t\' rigs');
  (A.pos.length === RAIN_MAX * 3 && A.seed.length === RAIN_MAX
    && SA.pos.length === SNOW_MAX * 3 && SA.seed.length === SNOW_MAX
    ? ok : bad)('field shape: pos is count×3, aSeed is count');
  (Buffer.from(A.pos.buffer).equals(Buffer.from(B.pos.buffer))
    && Buffer.from(A.seed.buffer).equals(Buffer.from(B.seed.buffer))
    ? ok : bad)('rain field byte-identical across calls (deterministic — same seed, same storm)');
  (Buffer.from(SA.pos.buffer).equals(Buffer.from(SB.pos.buffer))
    && Buffer.from(SA.seed.buffer).equals(Buffer.from(SB.seed.buffer))
    ? ok : bad)('snow field byte-identical across calls');

  // snow density: t' same exact-count contract on t' snow rig
  const sThr = SNOW_PLAIN / SNOW_MAX;
  let sc = 0;
  for (let i = 0; i < SNOW_MAX; i++) if (SA.seed[i] < sThr) sc++;
  (sc === SNOW_PLAIN ? ok : bad)(`snow uDensity threshold culls to EXACTLY SNOW_PLAIN (${sc} of ${SNOW_MAX})`);
  return A;
})();

// --- stratified density: Plain's cull is exact-count, an' thins wi'out shortenin' ---
{
  const thr = RAIN_PLAIN / RAIN_MAX;   // uDensity on Plain; shader keeps aSeed < uDensity
  let cnt = 0, sumS = 0, sumAll = 0, minS = Infinity, maxS = -Infinity;
  for (let i = 0; i < RAIN_MAX; i++) {
    const y = rainA.pos[i * 3 + 1];
    sumAll += y;
    if (rainA.seed[i] < thr) { cnt++; sumS += y; if (y < minS) minS = y; if (y > maxS) maxS = y; }
  }
  (cnt === RAIN_PLAIN ? ok : bad)(`stratified aSeed culls to EXACTLY RAIN_PLAIN survivors (${cnt} of ${RAIN_MAX})`);
  const meanAll = sumAll / RAIN_MAX, meanS = sumS / cnt;
  const dev = Math.abs(meanS - meanAll) / meanAll;
  (dev < 0.04 ? ok : bad)(`survivors' mean height within 4% of t' full column's (${(dev * 100).toFixed(1)}% — thinned evenly, aSeed decorrelated frae y)`);
  (minS < RAIN_SPAN * 0.05 && maxS > RAIN_SPAN * 0.95
    ? ok : bad)(`Plain cull never SHORTENS t' column (survivors span ${minS.toFixed(1)}..${maxS.toFixed(1)} of 0..${RAIN_SPAN})`);
}

// --- shared-clock wind: deterministic, bounded, alive — every client leans as one ---
{
  (windGust(123456) === windGust(123456) && windHeading(987654) === windHeading(987654)
    ? ok : bad)('windGust/windHeading deterministic in `now` — same instant, same wind on every client');
  let gMin = Infinity, gMax = -Infinity, hMin = Infinity, hMax = -Infinity;
  for (let ms = 0; ms <= 3600e3; ms += 5000) {   // an hour o' shared clock, 5 s steps
    const g = windGust(ms), h = windHeading(ms);
    if (g < gMin) gMin = g; if (g > gMax) gMax = g;
    if (h < hMin) hMin = h; if (h > hMax) hMax = h;
  }
  (gMin >= 0.35 && gMax <= 1 ? ok : bad)(`gust bounded [0.35, 1] ower t' hour — never fully calm on t' tops (got ${gMin.toFixed(2)}..${gMax.toFixed(2)})`);
  (hMin >= 0.79 - 0.9 && hMax <= 0.79 + 0.9
    ? ok : bad)(`heading a prevailin' sou'wester, backin'/veerin' within 0.79 ± 0.9 rad (got ${hMin.toFixed(2)}..${hMax.toFixed(2)})`);
  (gMax - gMin > 0.1 && hMax - hMin > 0.1 ? ok : bad)('gust an\' heading both actually MOVE across an hour (not constants)');
}

// --- winterPrecip poolin' ([19] hygiene): one module object, mutated per call ---
{
  const a = winterPrecip({ warmth: -0.6, frost: 0.8 }, 0.7, 0);
  const firstSnow = a.snow, firstRain = a.rain;
  const b = winterPrecip({ warmth: 0.5, frost: 0 }, 0.3, 0);
  (a === b ? ok : bad)('winterPrecip returns t\' SAME pooled object both calls (no per-frame alloc)');
  (firstSnow === 0.7 && firstRain === 0 ? ok : bad)('first call: wintry live precip falls as snow (0.7 snow / 0 rain)');
  (b.snow === 0 && b.rain === 0.3 ? ok : bad)('second call updates t\' same object in place (summer: 0 snow / 0.3 rain)');
}

// --- source wiring: CPU loops gone, one program, uniforms wrapped an' driven ---
{
  (!skySrc.includes('for (let i = 0; i < this.rainCount')
    && !skySrc.includes('for (let i = 0; i < this.snowCount')
    && !skySrc.includes('position.needsUpdate')
    ? ok : bad)('t\' owd CPU per-particle loops an\' attribute re-uploads are GONE frae sky.js');
  (skySrc.includes("customProgramCacheKey = () => 'precip-fall'")
    ? ok : bad)('rain an\' snow share ONE compiled program (precip-fall cache key)');
  (skySrc.includes('addPrecipMotion(this.rain.material, this._rainU, this._precipShared)')
    && skySrc.includes('addPrecipMotion(this.snow.material, this._snowU, this._precipShared)')
    ? ok : bad)('both rigs ride t\' same injector wi\' shared squall/sway uniforms');
  (skySrc.includes('uSquall: { value: 0 }')
    ? ok : bad)('uSquall defaults 0 — uniform curtain = today\'s look on a fresh compile');
  (skySrc.includes('transformed.y += step(uDensity, aSeed) * 1.0e6;')
    ? ok : bad)('density cull in-shader: surplus points fly 1e6 up — clipped, degenerate');
  (skySrc.includes('this.liveWind = live.windiness')
    ? ok : bad)('real Goathland windiness cached frae t\' live feed (finally consumed)');
  (skySrc.includes('u.uDensity.value = fine ? 1 : RAIN_PLAIN / RAIN_MAX')
    && skySrc.includes('u.uDensity.value = fine ? 1 : SNOW_PLAIN / SNOW_MAX')
    ? ok : bad)('uDensity driven Fine=1 / Plain=today\'s exact counts, both rigs');
  (skySrc.includes('Math.min(wSpd, 7)')
    ? ok : bad)('snow wind speed capped at 7 — t\' slope stays sane (≤ ~1.1)');
  (skySrc.includes('u.uCycle.value = Math.floor(fall / RAIN_SPAN) % 1024')
    && skySrc.includes('u.uCycle.value = Math.floor(fall / SNOW_SPAN) % 1024')
    ? ok : bad)('uCycle wrapped % 1024 CPU-side — t\' respawn hash\'s sin() args stay small');
  (skySrc.includes('const SWAY_WRAP = Math.PI * 2 / 0.7')
    && skySrc.includes('sh.uSwayT.value = nowS % SWAY_WRAP')
    ? ok : bad)('sway clock wrapped at 2π/0.7 — every sway sinusoid completes whole cycles, no float32 drift');
  (skySrc.includes('opacity * vAlpha')
    ? ok : bad)('squall band thins alpha in t\' fragment stage (opacity * vAlpha)');
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
