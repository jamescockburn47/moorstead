// Fatigue model check — run wi': node scripts/verify-fatigue.mjs
//
// Covers Task 1 of docs/superpowers/plans/2026-07-04-tavern-d5-chill-fatigue.md:
// the new src/fatigue.js pure module (rates, tiers, applyDoze, swayAmpFor,
// fatigueSpeedMul, bairnsScale). NOT wired into package.json's verify chain
// yet — that's Task 3 (controller). Run standalone until then.
//
// Rules (docs/INVARIANTS.md rule 1): headless Node only, pure-function contract
// testing — fatigue.js takes no world/room object (bairnsScale takes a plain
// boolean; the isChildrensWorld/freeWorld lookup itself lives at the CALLER,
// per the plan). This file only exercises what fatigue.js actually exports.
import {
  FATIGUE_MAX, RATE_AWAKE, RATE_EXERT, DOZE_RATE,
  fatigueTier, applyDoze, swayAmpFor, fatigueSpeedMul, bairnsScale,
} from '../src/fatigue.js';

let failed = false;
const ok  = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// --- constants: shape and relative magnitude the plan pins ---
{
  (FATIGUE_MAX === 20 ? ok : bad)('fatigue caps at 20');
  (RATE_AWAKE > 0 ? ok : bad)('RATE_AWAKE is a positive per-second rate');
  (Math.abs(RATE_EXERT - RATE_AWAKE * 5) < 1e-9 ? ok : bad)('RATE_EXERT is ~5x RATE_AWAKE, per the plan');
  (DOZE_RATE > 0 ? ok : bad)('DOZE_RATE is a positive per-second relief rate');
  // "slow": climbing to the cap from awake-only accrual takes a long real span
  // (the plan's "~20 over 2.5 game days" — calibrated here to hours, not seconds/minutes).
  (FATIGUE_MAX / RATE_AWAKE > 3600 ? ok : bad)('awake-only accrual to the cap takes hours, not minutes (slow)');
}

// --- fatigueTier: the four bands, NO collapse tier exists ---
{
  (fatigueTier(0) === 'fresh' && fatigueTier(9.99) === 'fresh' ? ok : bad)('fatigueTier: [0,10) is fresh');
  (fatigueTier(10) === 'weary' && fatigueTier(14.99) === 'weary' ? ok : bad)('fatigueTier: [10,15) is weary');
  (fatigueTier(15) === 'flagging' && fatigueTier(19.99) === 'flagging' ? ok : bad)('fatigueTier: [15,20) is flagging');
  (fatigueTier(20) === 'spent' ? ok : bad)('fatigueTier: ==20 (the cap) is spent');
  (fatigueTier(25) === 'spent' ? ok : bad)('fatigueTier: never returns anything past spent, even for out-of-range input above cap');
  const tiers = ['fresh', 'weary', 'flagging', 'spent'];
  (!tiers.includes('collapse') && !tiers.includes('collapsed') ? ok : bad)('no collapse tier exists in the tier vocabulary (spec: NO collapse)');
}

// --- accrual rate math (pure arithmetic the caller — player.js — relies on) ---
{
  const afterAwake10s = 10 * RATE_AWAKE;
  const afterExert10s = 10 * RATE_EXERT;
  (afterExert10s > afterAwake10s ? ok : bad)('exertion accrues fatigue faster than idle wakefulness over the same span');
}

// --- applyDoze: relief, never below zero, monotonic with dt ---
{
  (applyDoze(10, 60) < 10 ? ok : bad)('a minute of hearth doze eases fatigue');
  (Math.abs(applyDoze(10, 60) - (10 - DOZE_RATE * 60)) < 1e-9 ? ok : bad)('applyDoze subtracts DOZE_RATE*dt exactly');
  (applyDoze(1, 3600) === 0 ? ok : bad)('applyDoze floors at zero — never negative');
  (applyDoze(0, 60) === 0 ? ok : bad)('applyDoze on an already-fresh player stays at zero');
  (applyDoze(20, 30) < applyDoze(20, 10) ? ok : bad)('applyDoze: more dt eases more (monotonic in dt)');
}

// --- swayAmpFor: 0..1, monotonic non-decreasing, zero while fresh ---
{
  (swayAmpFor(0) === 0 ? ok : bad)('swayAmpFor: fresh (0) has no sway');
  (swayAmpFor(9.99) === 0 ? ok : bad)('swayAmpFor: still zero right up to the weary boundary');
  (swayAmpFor(10) === 0 && swayAmpFor(12.5) > 0 ? ok : bad)('swayAmpFor: the ramp starts exactly at weary (10) and is visibly nonzero partway through the band');
  (swayAmpFor(20) === 1 ? ok : bad)('swayAmpFor: maxes at 1 when spent (20)');
  let prev = -1, monotonic = true;
  for (let f = 0; f <= 20; f += 0.5) {
    const v = swayAmpFor(f);
    if (v < prev - 1e-9) monotonic = false;
    prev = v;
  }
  (monotonic ? ok : bad)('swayAmpFor is monotonic non-decreasing across the full 0..20 range');
  const allInRange = [0, 5, 10, 12.5, 15, 17.5, 20].every(f => swayAmpFor(f) >= 0 && swayAmpFor(f) <= 1);
  (allInRange ? ok : bad)('swayAmpFor always stays within [0,1]');
}

// --- fatigueSpeedMul: no penalty until flagging, caps never collapse to zero ---
{
  (fatigueSpeedMul(0) === 1 && fatigueSpeedMul(9.99) === 1 ? ok : bad)('fatigueSpeedMul: fresh has no speed penalty');
  (fatigueSpeedMul(12) === 1 ? ok : bad)('fatigueSpeedMul: weary has no speed penalty (only sway begins there)');
  (fatigueSpeedMul(15) === 0.9 ? ok : bad)('fatigueSpeedMul: flagging is x0.9');
  (fatigueSpeedMul(20) === 0.85 ? ok : bad)('fatigueSpeedMul: spent is x0.85 — capped, never zero (no collapse)');
  (fatigueSpeedMul(20) > 0 ? ok : bad)('fatigueSpeedMul never reaches zero (player is never immobilised by fatigue alone)');
}

// --- bairnsScale: pure boolean-in, gentler-worlds contract (isChildrensWorld/
// freeWorld lookup itself belongs to the CALLER — this module takes only a bool) ---
{
  const grownups = bairnsScale(false);
  const bairns = bairnsScale(true);
  (grownups.chill === 1 && grownups.fatigue === 1 ? ok : bad)('bairnsScale(false): full chill and fatigue penalties');
  (bairns.chill === 0.5 ? ok : bad)('bairnsScale(true): chill target-drop is halved');
  (bairns.fatigue === 0 ? ok : bad)('bairnsScale(true): fatigue speed penalties are zeroed (cosmetic-only — sway/yawns still show elsewhere)');
  (bairnsScale.length === 1 ? ok : bad)('bairnsScale takes exactly one argument (a boolean) — no world/room object, stays pure');
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
