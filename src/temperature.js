// temperature.js — pure winter-cold model. No DOM, no three.js.
import { I } from './defs.js';

// Cooked/hot foods give a warmth burst when eaten.
export const HOT_FOODS = new Set([
  I.COOKED_MUTTON, I.COOKED_GROUSE, I.COOKED_BEEF, I.COOKED_PORK, I.COOKED_FISH, I.FISH_CHIPS,
  I.COOKED_MUSHROOMS,
]);

// The temperature [0..20] the player drifts toward, given the season + environment.
// env: { covered, nearFire, night, altitude01 (0 valley..1 tops), wetness (0..1), coat (bool) }
export function temperatureTarget(season, env) {
  if (env.nearFire) return 20;
  const wintry = season && season.warmth < 0;
  if (wintry) {
    // chill in (0,1]; scale to max drop of 15 so base outdoor stays above 0.
    const chill = -season.warmth;
    let drop = chill * 15;
    if (env.covered) drop *= 0.35;
    if (env.coat)    drop *= 0.5;
    if (env.night)   drop *= 1.35;
    drop *= (1 + 0.4 * (env.altitude01 || 0));
    drop *= (1 + 0.6 * (env.wetness    || 0));
    return Math.max(0, Math.min(20, 20 - drop));
  }
  // Not wintry, but still not a warm season (spring/autumn shoulder): nights
  // bite a little even outside proper winter (D5 spec — general night-chill).
  // Summer (season.warmth >= 0.5) stays mild regardless of night. Winter's own
  // (already-harsher, x1.35) night handling above is unchanged by this branch.
  if (env.night && season && season.warmth < 0.5) {
    let drop = 4;
    if (env.covered) drop *= 0.35;
    if (env.coat)    drop *= 0.5;
    drop *= (1 + 0.4 * (env.altitude01 || 0));
    drop *= (1 + 0.6 * (env.wetness    || 0));
    return Math.max(0, Math.min(20, 20 - drop));
  }
  return 20;
}

// Pure misery classification the game code reads instead of scattering
// thresholds. 'none' (>=12): no penalty. 'chilled' (<12): hunger burns faster
// (existing rule, player.js). 'stiff' (<6): movement x0.75 (existing) AND
// tool-swing progress x0.75 (new, Task 2 hook). 'perishing' (<=0): movement
// x0.6, tools x0.5, frequent shiver toasts — cold's WORST bite is now misery,
// never death (the freeze-damage block this used to gate is removed; see the
// plan's "one deliberate balance change").
export const MISERY_TIERS = ['none', 'chilled', 'stiff', 'perishing'];
export function miseryOf(temp) {
  if (temp <= 0) return 'perishing';
  if (temp < 6) return 'stiff';
  if (temp < 12) return 'chilled';
  return 'none';
}

// Morning boundary, in day-fraction terms (matches roster.js/main.js's existing
// "morning ~ sky.time crossing 0.25" convention — see the plan's ground-truth annex).
export const MORNING_SKYTIME = 0.25;

// Given the current sky time (0..1 day-fraction) AS A MONOTONIC day+time VALUE
// (i.e. `sky.day + sky.time`, the same axis main.js already uses for shipment/
// trade timestamps — see main.js:3209/5610-5611), the monotonic timestamp of the
// next morning boundary STRICTLY after it. Wrap-safe by construction because the
// input is already unwrapped (day never resets): if `now`'s fractional part is
// still short of 0.25, morning lands later TODAY; otherwise it's tomorrow's,
// i.e. `Math.floor(now) + 1 + 0.25`. Used for "warmed through till morning": a
// buff whose expiry must survive the midnight day-rollover without going stale.
export function warmedThroughUntil(now) {
  const day = Math.floor(now);
  const frac = now - day;
  return frac < MORNING_SKYTIME ? day + MORNING_SKYTIME : day + 1 + MORNING_SKYTIME;
}

// Is `now` (same monotonic day+time axis as above) still before a stored
// warmedThroughUntil expiry? Trivial once both sides share the same unwrapped
// axis — this exists so callers (player.js) don't have to re-derive the
// monotonic form or worry about the wrap themselves.
export function skyTimeIsBefore(now, warmedUntil) {
  return warmedUntil != null && now < warmedUntil;
}

// Ease temperature toward target by `dt` seconds; warms faster than it chills.
export function stepTemperature(temp, target, dt) {
  const rate = target > temp ? 0.5 : 0.25;
  const next = temp + (target - temp) * Math.min(1, rate * dt);
  return next < 0 ? 0 : next > 20 ? 20 : next;
}
