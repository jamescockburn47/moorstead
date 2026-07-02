// snow.js — deterministic snow dynamics. Pure: no DOM, no three.js.
// Accumulation lags the season (snow creeps in / thaws over game-days); snowfall
// and its showers are a function of the shared wall-clock so every client agrees.
import { noise2 } from './noise.js';

// How deep snow wants to lie [0,1] for a season — the steady-state cover. Used
// both as the accumulation goal and as the seed when a world loads (or the warden
// flips the season), so winter is snowy at once rather than after game-days of creep.
export function accumulationTarget(season) {
  const snowing = season.frost;                           // 0..1, winter half-year (= max(0,-warmth))
  const cold = season.warmth < 0 ? -season.warmth : 0;    // 0..1
  return Math.min(1, snowing * 0.6 + cold);
}

// New accumulation [0,1] after `dt` GAME-seconds, given the current season state.
// Builds toward the target while it's snowing and cold; melts toward 0 as it warms.
export function stepAccumulation(accum, season, dt) {
  const cold = season.warmth < 0 ? -season.warmth : 0;    // 0..1
  const target = accumulationTarget(season);              // how deep it wants to lie
  const rate = (target > accum) ? 0.0016 * cold            // accrues slowly, only when cold
                                : 0.003 * (0.4 + (season.warmth > 0 ? season.warmth : 0));  // melts faster when warm
  const next = accum + Math.sign(target - accum) * rate * dt;
  return next < 0 ? 0 : next > 1 ? 1 : next;
}

// Smooth shared-clock oscillation in [0,1] — showers wax and wane through winter.
export function showerOscillation(now = 0) {
  const t = now / 1000;                                   // seconds
  return (noise2(t / 900, 0, 0x5704) + 1) * 0.5;          // ~15-min period, value noise -> [0,1]
}

// Deterministic falling-snow intensity [0,1]: winter envelope * shower, with a
// reliable baseline so winter is never bone-dry (Victorian winters).
export function snowfallIntensity(now, season) {
  const envelope = season.frost;                          // winter strength
  if (envelope < 0.05) return 0;
  const shower = showerOscillation(now);
  return Math.min(1, envelope * (0.45 + 0.55 * shower));  // baseline 0.45 + showers
}

// Snow-line height for a coverage amount [0,1]: high (tops only) -> valley floor.
export function snowLineFor(amount) {
  const a = amount < 0 ? 0 : amount > 1 ? 1 : amount;
  return 64 - a * 40;                                     // 64 (tops) down to 24 (valley)
}

// Split precipitation into snow (winter) vs rain (otherwise). `livePrecip` is the
// live-feed amount [0,1] or null when offline; `fallback` is the deterministic
// snow-clock value used only when offline. Returns { snow, rain }.
// POOLED return ([19] hygiene): sky.update calls this every frame, and a fresh
// object per call was a steady GC drip. The module-level object is mutated and
// returned — read or destructure it straight away, never retain it across calls.
const _precip = { snow: 0, rain: 0 };
export function winterPrecip(season, livePrecip, fallback = 0) {
  const wintry = season && season.warmth < 0;
  const precip = (livePrecip != null) ? livePrecip : (wintry ? fallback : 0);
  if (wintry) { _precip.snow = precip; _precip.rain = 0; }
  else { _precip.snow = 0; _precip.rain = (livePrecip != null ? livePrecip : 0); }
  return _precip;
}

// A water/bog cell freezes in deep winter if it's an inland beck or a bog — never
// the open sea. `coastT` in [0,1]: 0 inland, 1 open sea.
export function freezableWater(block, coastT, B) {
  if (block === B.BOG) return true;
  if (block === B.WATER) return coastT <= 0.15;
  return false;
}
export function isFrozen(season) { return !!season && season.warmth < -0.4; }

// Sky greyness [0,1]: overcast while it actively snows or rains, else the
// weather-state base (so a clear winter forecast reads sunny).
export function overcastGrey(weather, snow, rain) {
  const base = { clear: 0, misty: 0.13, rain: 0.52, fog: 0.68 }[weather] || 0;
  return Math.max(base, snow * 0.6, rain * 0.5);
}
