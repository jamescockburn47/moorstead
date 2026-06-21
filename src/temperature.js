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
  const wintry = season && season.warmth < 0;
  if (!wintry) return 20;
  if (env.nearFire) return 20;
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

// Ease temperature toward target by `dt` seconds; warms faster than it chills.
export function stepTemperature(temp, target, dt) {
  const rate = target > temp ? 0.5 : 0.25;
  const next = temp + (target - temp) * Math.min(1, rate * dt);
  return next < 0 ? 0 : next > 20 ? 20 : next;
}
