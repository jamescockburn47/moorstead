// Animal rest/sleep check — run wi': node scripts/verify-animalrest.mjs
import {
  REST_SPECIES, REST_STEADY_SHARE, restPhaseDuration, shouldWake, alertDuration,
  reachedHuddle, WAKE_RADIUS, WAKE_CLOSE, HUDDLE_SETTLE_DIST,
} from '../src/animalrest.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
// seeded PRNG so the population-share test is deterministic
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- the species scoped in ---
{
  for (const s of ['sheep', 'cow', 'llama', 'pony', 'pig']) (REST_SPECIES.has(s) ? ok : bad)(`${s} is a resting species`);
  for (const s of ['dog', 'cat', 'rat', 'bull', 'hare', 'grouse', 'barghest', 'villager', 'coble'])
    (!REST_SPECIES.has(s) ? ok : bad)(`${s} does NOT rest (companion/guard/prey/hostile/no-AI)`);
}

// --- the "at least half" contract James asked for ---
{
  (REST_STEADY_SHARE >= 0.5 ? ok : bad)(`day duty-cycle spends >=50% resting (${(REST_STEADY_SHARE * 100).toFixed(0)}%)`);
  (REST_STEADY_SHARE < 1 ? ok : bad)('but not ALL of the time — some are always up and about');
}

// --- duty-cycle phase durations are sane and deterministic under a seeded rand ---
{
  const rand = mulberry32(42);
  const restD = restPhaseDuration(true, rand);
  const activeD = restPhaseDuration(false, rand);
  (restD > 0 && restD < 200 ? ok : bad)(`resting phase duration is a sane positive span (${restD.toFixed(1)}s)`);
  (activeD > 0 && activeD < 200 ? ok : bad)(`active phase duration is a sane positive span (${activeD.toFixed(1)}s)`);
  (restPhaseDuration(true, () => 0) === restPhaseDuration(true, () => 0) ? ok : bad)('deterministic given the same rand stream');
  // averaged over many draws, resting phases really do run longer than active ones
  let restSum = 0, activeSum = 0, N = 500;
  const r2 = mulberry32(7);
  for (let i = 0; i < N; i++) { restSum += restPhaseDuration(true, r2); activeSum += restPhaseDuration(false, r2); }
  (restSum / N > activeSum / N ? ok : bad)('resting bouts average longer than active bouts (the >=half contract in practice)');
}

// --- wake roll: always at point-blank, chance-based near, never far ---
{
  (shouldWake(0.5, 1, () => 0.99) === true ? ok : bad)('point-blank range always wakes a bedded beast');
  (shouldWake(WAKE_CLOSE - 0.01, 1, () => 0.99) === true ? ok : bad)('just inside the close radius always wakes');
  (shouldWake(WAKE_RADIUS + 5, 1, () => 0) === false ? ok : bad)('well outside the wake radius never wakes, however lucky the roll');
  (shouldWake(4, 1, () => 0) === true ? ok : bad)('near but not close: a favourable roll wakes it');
  (shouldWake(4, 1, () => 0.999) === false ? ok : bad)('near but not close: an unfavourable roll leaves it dozing — "sometimes stand"');
  (shouldWake(4, 0, () => 0.0001) === false ? ok : bad)('zero elapsed time never rolls a wake (dt scales the chance)');
}

// --- alert duration is a sane positive span, so a startled beast can't instantly re-settle ---
{
  const a = alertDuration(() => 0), b = alertDuration(() => 1);
  (a > 0 && b > a && b < 20 ? ok : bad)(`alert duration is a sane bounded span (${a.toFixed(1)}..${b.toFixed(1)}s)`);
}

// --- huddle arrival ---
{
  (reachedHuddle({ x: 0, z: 0 }, { x: 1, z: 0 }) === true ? ok : bad)('within the settle distance counts as arrived');
  (reachedHuddle({ x: 0, z: 0 }, { x: HUDDLE_SETTLE_DIST + 1, z: 0 }) === false ? ok : bad)('still short of the huddle point keeps walking');
  (reachedHuddle({ x: 5, z: 5 }, { x: 5, z: 5 }) === true ? ok : bad)('standing on the centroid itself has arrived');
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
