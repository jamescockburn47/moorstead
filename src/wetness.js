// wetness.js — deterministic ground-wetness dynamics ([D6]/[D10] drive).
// Pure: no DOM, no three.js. Mirrors snow.js's stepAccumulation asymmetry idiom —
// the ground soaks FAST while it's raining and dries SLOW after, and the dry rate
// scales with warmth (a warm day dries quicker) and daylight (overnight rain lingers
// to morning). Deterministic: rainAmount is the shared live-feed/shared-clock sample,
// warmth is the shared season clock, dayness the shared sun curve — every client agrees.

// New ground-wetness [0,1] after `dt` GAME-seconds.
//   w          — current wetness [0,1]
//   rainAmount — live precipitation [0,1] (sky.rainAmount)
//   warmth     — season.warmth [-1,1]; only the warm (positive) part speeds drying
//   dayness    — sun curve [0,1]; overnight (dayness→0) drying nearly stalls
// Soaks toward 1 at ~0.004/s whenever it's raining harder than a drizzle (rainAmount>0.2);
// otherwise dries toward 0 at ~0.0009/s * (0.4 + warmth) * (0.5 + dayness*0.5) — the
// stepAccumulation asymmetric-rates precedent (snow.js:17-24). Result stays in [0,1].
export function stepGroundWet(w, rainAmount, warmth, dayness, dt) {
  const raining = rainAmount > 0.2;
  let next;
  if (raining) {
    // soak in — driven up toward 1, faster in heavier rain (rainAmount is the ceiling
    // pull) but never below the 0.004/s base so a steady shower always wets through.
    const soak = 0.004 * (0.6 + 0.4 * (rainAmount > 1 ? 1 : rainAmount));
    next = w + soak * dt;
  } else {
    // dry out — slow, and slower still overnight or in the cold
    const warm = warmth > 0 ? warmth : 0;             // only warmth helps dry
    const day = dayness < 0 ? 0 : dayness > 1 ? 1 : dayness;
    const dry = 0.0009 * (0.4 + warm) * (0.5 + day * 0.5);
    next = w - dry * dt;
  }
  return next < 0 ? 0 : next > 1 ? 1 : next;
}

// [D10] shelter-shaped drying, exposed as a JS twin of the shader's wetEff so a verify
// script can assert the ordering without a GL context. `shel` in [0,1] is the shelter
// signal (0 = fully open/sunlit, 1 = a deep AO'd crevice). Exposed ground (shel→0) uses
// exponent 1.7 so it crosses the visibility floor early; sheltered ground (shel→1) uses
// 0.45 so AO-dark corners hold near-full wetness until the very end. Same maths the
// addSnow fragment runs: pow(uGroundWet, mix(1.7, 0.45, shel)).
export function wetEff(groundWet, shel) {
  const g = groundWet < 0 ? 0 : groundWet > 1 ? 1 : groundWet;
  const s = shel < 0 ? 0 : shel > 1 ? 1 : shel;
  return Math.pow(g, 1.7 + (0.45 - 1.7) * s);
}
