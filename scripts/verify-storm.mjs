// Headless: the Dracula boss-battle storm's pure choices (Slice 2 Task 2.3).
//
// The storm itself is visual (the controller smoke-tests in-game), but the pure
// decisions — rain-vs-snow by season, and the flash/thunder schedule — are
// testable. Mirrors the verify-*.mjs pattern (a counter; a single OK line).
import assert from 'node:assert';
import { stormPrecip, nextFlashInterval, thunderDelay, boltStrands, BOLT_MAX_POINTS } from '../src/storm.js';
import { seasonStateAtPhase } from '../src/season.js';

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// --- season -> precipitation: snow in winter, rain otherwise ---
// (winter check mirrors snow.js: season.warmth < 0.)
{
  // a deep-winter season (warmth < 0) snows; high summer (warmth > 0) rains.
  const winter = seasonStateAtPhase(0.875); // deep winter
  const summer = seasonStateAtPhase(0.375); // high summer
  ok(winter.warmth < 0, `the winter phase is wintry (warmth ${winter.warmth.toFixed(2)} < 0)`);
  ok(summer.warmth > 0, `the summer phase is warm (warmth ${summer.warmth.toFixed(2)} > 0)`);
  ok(stormPrecip(winter) === 'snow', `stormPrecip(winter) === 'snow'`);
  ok(stormPrecip(summer) === 'rain', `stormPrecip(summer) === 'rain'`);
  // spring/autumn (warmth >= 0 at the equinoxes' warm side) read as rain
  ok(stormPrecip(seasonStateAtPhase(0.375)) === 'rain', `stormPrecip(high summer) === 'rain'`);
  // null/undefined season is safe and defaults to rain (never crashes mid-init)
  ok(stormPrecip(null) === 'rain', `stormPrecip(null) defaults to 'rain' (no crash)`);
  ok(stormPrecip(undefined) === 'rain', `stormPrecip(undefined) defaults to 'rain'`);
  // and string-shaped season literals (per the task) resolve sensibly via warmth:
  // a hand-built {warmth} works too, proving the check is on warmth, not the label.
  ok(stormPrecip({ warmth: -0.5 }) === 'snow', `stormPrecip({warmth:-0.5}) === 'snow'`);
  ok(stormPrecip({ warmth: 0.5 }) === 'rain', `stormPrecip({warmth:0.5}) === 'rain'`);
}

// --- the lightning flash schedule: every interval lands in ~4–12 s ---
{
  // with rnd at the extremes, the interval spans its documented band for each index
  for (let i = 0; i < 12; i++) {
    const lo = nextFlashInterval(i, () => 0);
    const hi = nextFlashInterval(i, () => 1);
    ok(lo >= 4 - 1e-9, `flash interval #${i} floor >= 4s (${lo.toFixed(2)})`);
    ok(hi <= 12 + 1e-9, `flash interval #${i} ceiling <= 12s (${hi.toFixed(2)})`);
    ok(hi >= lo, `flash interval #${i} ceiling >= floor`);
  }
  // the base wanders by index (not a constant), so the rhythm isn't metronomic
  const bases = [0, 1, 2].map(i => nextFlashInterval(i, () => 0));
  ok(new Set(bases).size === 3, `the flash base varies by index (${bases.map(b => b.toFixed(1)).join(',')})`);
}

// --- the thunder delay: near strikes crack promptly, far ones rumble late ---
{
  // index%4===0 is a near strike (0.2–0.6s); others are far (0.8–2.5s)
  for (let i = 0; i < 12; i++) {
    const lo = thunderDelay(i, () => 0);
    const hi = thunderDelay(i, () => 1);
    const near = (i % 4) === 0;
    if (near) {
      ok(lo >= 0.2 - 1e-9 && hi <= 0.6 + 1e-9, `near thunder #${i} cracks in 0.2–0.6s (${lo.toFixed(2)}–${hi.toFixed(2)})`);
    } else {
      ok(lo >= 0.8 - 1e-9 && hi <= 2.5 + 1e-9, `far thunder #${i} rumbles in 0.8–2.5s (${lo.toFixed(2)}–${hi.toFixed(2)})`);
    }
  }
  // a near strike is always sooner than a far one (so the cue genuinely tracks distance)
  ok(thunderDelay(0, () => 1) < thunderDelay(1, () => 0),
    `the longest near delay is shorter than the shortest far delay`);
}

// --- the forked bolt (item 36): seeded, arena-anchored, allocation-free ---
{
  const arena = { x: 1824, z: 3079, r: 16 };   // the shipped draculaArena() spot
  const groundAt = () => 27;                    // East Cliff clifftop height
  const seed = 12345;
  // Math.random is POISONED for the whole block: the bolt's shape must come
  // exclusively frae mulberry32(index ^ worldSeed) — invariant 6.
  const realRandom = Math.random;
  Math.random = () => { throw new Error('boltStrands touched Math.random'); };
  try {
    for (let i = 0; i < 24; i++) {
      const ptsA = new Float32Array(BOLT_MAX_POINTS * 3), countsA = [0, 0, 0];
      const ptsB = new Float32Array(BOLT_MAX_POINTS * 3), countsB = [0, 0, 0];
      boltStrands(i, seed, arena, groundAt, ptsA, countsA);
      boltStrands(i, seed, arena, groundAt, ptsB, countsB);
      // determinism: two calls write the identical floats + counts
      ok(ptsA.join(',') === ptsB.join(','), `strike #${i}: two calls lay identical point buffers`);
      ok(countsA.join(',') === countsB.join(','), `strike #${i}: two calls report identical strand counts`);
      // trunk: 8..12 segments -> 9..13 points
      ok(countsA[0] >= 9 && countsA[0] <= 13, `strike #${i}: trunk has 9-13 points (${countsA[0]})`);
      // first branch always forks (4..6 points); second is absent or 4..6
      ok(countsA[1] >= 4 && countsA[1] <= 6, `strike #${i}: first branch has 4-6 points (${countsA[1]})`);
      ok(countsA[2] === 0 || (countsA[2] >= 4 && countsA[2] <= 6),
        `strike #${i}: second branch is 0 or 4-6 points (${countsA[2]})`);
      const total = countsA[0] + countsA[1] + countsA[2];
      ok(total <= BOLT_MAX_POINTS, `strike #${i}: ${total} points fit BOLT_MAX_POINTS (${BOLT_MAX_POINTS})`);
      // trunk endpoints exact: cloud base y=120 down to groundAt - 1.5
      ok(ptsA[1] === 120, `strike #${i}: trunk starts at cloud base y=120 (${ptsA[1]})`);
      const tip = (countsA[0] - 1) * 3;
      ok(ptsA[tip + 1] === 27 - 1.5, `strike #${i}: trunk tip buried at groundAt - 1.5 (${ptsA[tip + 1]})`);
      // the strike point is hashed near the arena (just outside to ~1.5r beyond)
      const d = Math.hypot(ptsA[tip] - arena.x, ptsA[tip + 2] - arena.z);
      ok(d <= arena.r * 1.5 + 1e-3, `strike #${i}: tip lands within 1.5r of the arena (${d.toFixed(1)} <= ${arena.r * 1.5})`);
      // the trunk only ever descends (a walk down the sky, no kinks upward)
      let descending = true;
      for (let p = 1; p < countsA[0]; p++) if (ptsA[p * 3 + 1] >= ptsA[(p - 1) * 3 + 1]) descending = false;
      ok(descending, `strike #${i}: trunk y is strictly decreasing`);
    }
    // the world seed genuinely folds into the shape: two worlds, two bolts
    const pts1 = new Float32Array(BOLT_MAX_POINTS * 3), c1 = [0, 0, 0];
    const pts2 = new Float32Array(BOLT_MAX_POINTS * 3), c2 = [0, 0, 0];
    boltStrands(0, 111, arena, groundAt, pts1, c1);
    boltStrands(0, 222, arena, groundAt, pts2, c2);
    ok(pts1.join(',') !== pts2.join(','), 'different worldSeed (111 vs 222) lays a different bolt');
  } finally {
    Math.random = realRandom;
  }
}

console.log(`verify-storm: ${n} assertions OK`);
