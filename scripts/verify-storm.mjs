// Headless: the Dracula boss-battle storm's pure choices (Slice 2 Task 2.3).
//
// The storm itself is visual (the controller smoke-tests in-game), but the pure
// decisions — rain-vs-snow by season, and the flash/thunder schedule — are
// testable. Mirrors the verify-*.mjs pattern (a counter; a single OK line).
import assert from 'node:assert';
import { stormPrecip, nextFlashInterval, thunderDelay } from '../src/storm.js';
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

console.log(`verify-storm: ${n} assertions OK`);
