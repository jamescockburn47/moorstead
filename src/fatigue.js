// fatigue.js — pure tiredness model. No DOM, no three.js, no world/room lookups.
// Fatigue [0..20] climbs with time awake + exertion, caps WITHOUT collapse (spec:
// D5 handoff — relief is sleep (full, deferred to D6), hearth doze (partial, this
// slice), or it just caps and sits there being unpleasant). See docs/superpowers/
// plans/2026-07-04-tavern-d5-chill-fatigue.md Task 1.

export const FATIGUE_MAX = 20;

// Rates are fatigue-per-real-dt-second, the same units player.js already ticks
// hunger/exhaustion/temperature in (survival ticks run off real dt seconds, not
// a documented "game day" length — there is no such constant in this codebase
// to divide by). "~20 over 2.5 game days" (plan wording) is calibrated here as
// ~20 fatigue over a long play session (~3.5 real hours), the same order of
// magnitude as existing survival accrual (player.js's hunger exhaustion climbs
// 0.012-0.10/s). RATE_EXERT (sprinting/mining) is 5x RATE_AWAKE per the plan.
export const RATE_AWAKE = 20 / (3.5 * 60 * 60);   // ~0.00159/s — just being up and about
export const RATE_EXERT = RATE_AWAKE * 5;          // ~0.00794/s — sprinting or mining on top
export const DOZE_RATE = 2 / 60;                   // hearth doze: -2 fatigue per minute

export function fatigueTier(f) {
  if (f >= FATIGUE_MAX) return 'spent';
  if (f >= 15) return 'flagging';
  if (f >= 10) return 'weary';
  return 'fresh';
}

// ease fatigue down by dt seconds of hearth-doze relief; never below 0.
export function applyDoze(fatigue, dt) {
  return Math.max(0, fatigue - DOZE_RATE * dt);
}

// 0..1 sway multiplier the camera bob/sway code adds on top of wind sway.
// 'fresh' = none; ramps through 'weary'; strong by 'flagging'/'spent'. Monotonic
// non-decreasing in fatigue by construction (each band picks up where the last left off).
export function swayAmpFor(fatigue) {
  const tier = fatigueTier(fatigue);
  if (tier === 'fresh') return 0;
  if (tier === 'weary') return (fatigue - 10) / 5 * 0.4; // 0..0.4 across the weary band
  return 0.4 + Math.min(1, (fatigue - 15) / 5) * 0.6; // 0.4..1.0 across flagging..spent
}

// speed multiplier from fatigue tier alone (stacks with miseryOf's chill multiplier
// at the call site — this module doesn't know about temperature). 'fresh'/'weary' = no
// penalty; 'flagging' = x0.9; 'spent' = x0.85. Childrens/free worlds skip this entirely
// via bairnsScale at the caller.
export function fatigueSpeedMul(fatigue) {
  const tier = fatigueTier(fatigue);
  if (tier === 'flagging') return 0.9;
  if (tier === 'spent') return 0.85;
  return 1;
}

// Bairns/free worlds: gentler by design. Takes a plain boolean (rooms.js's
// isChildrensWorld/freeWorld idiom lives at the CALLER — this module stays pure
// and takes no world/room object). chill: halves the extra night-chill drop;
// fatigue: 0 multiplier on speed penalties (cosmetic-only there — sway/yawns
// still show, kids like seeing it, but no penalty per the plan).
export function bairnsScale(isChildrens) {
  return isChildrens ? { chill: 0.5, fatigue: 0 } : { chill: 1, fatigue: 1 };
}
