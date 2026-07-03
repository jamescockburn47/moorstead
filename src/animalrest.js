// animalrest.js — pure resting/sleeping maths for grazing livestock (no THREE, no DOM),
// unit-tested headless via scripts/verify-animalrest.mjs. Two clocks share one contract:
// by day each wild beast runs its own duty cycle (so the flock doesn't flop down or
// spring up in lockstep — some are always up grazing while others doze); by night the
// whole herd gathers to its own kind and beds down together. Either way, a body drawing
// near can startle a bedded beast up — never a certainty, some just doze through it —
// via the SAME wake roll day or night.

// Livestock that graze/spawn in flocks (MOB_TYPES `group` entries) and can plausibly lie
// down: not dog/cat/rat (companions, owner-driven), not bull (stands guard), not the
// game birds (already have their own shy/flush behaviour).
export const REST_SPECIES = new Set(['sheep', 'cow', 'llama', 'pony', 'pig']);

// Duty-cycle phase lengths (seconds), day only. The resting run outlasts the active run,
// so averaged over the population at least half are bedded down at any moment.
const REST_MIN = 25, REST_MAX = 70;
const ACTIVE_MIN = 15, ACTIVE_MAX = 40;
const REST_MEAN = (REST_MIN + REST_MAX) / 2, ACTIVE_MEAN = (ACTIVE_MIN + ACTIVE_MAX) / 2;
// steady-state fraction of the day-duty-cycle spent resting — derived from the phase
// lengths above so the two can't drift apart; used both as the spawn-time seed chance
// and as the verified "at least half" contract.
export const REST_STEADY_SHARE = REST_MEAN / (REST_MEAN + ACTIVE_MEAN);

export function restPhaseDuration(resting, rand = Math.random) {
  return resting ? REST_MIN + rand() * (REST_MAX - REST_MIN) : ACTIVE_MIN + rand() * (ACTIVE_MAX - ACTIVE_MIN);
}

// Startle roll for a bedded-down beast: always wakes at point-blank range; otherwise a
// per-second chance while inside the wake radius, so a body passing at a distance mostly
// doesn't rouse the flock, lingering close usually does, and some don't wake at all.
export const WAKE_RADIUS = 6;
export const WAKE_CLOSE = 2.2;
export const WAKE_CHANCE_PER_SEC = 0.35;
export function shouldWake(distP, dt, rand = Math.random) {
  if (distP < WAKE_CLOSE) return true;
  if (distP < WAKE_RADIUS) return rand() < WAKE_CHANCE_PER_SEC * dt;
  return false;
}

// How long a startled beast stays properly alert before it's willing to settle again —
// stops it waking and instantly re-bedding on the very same tick at night.
const ALERT_MIN = 4, ALERT_MAX = 8;
export function alertDuration(rand = Math.random) { return ALERT_MIN + rand() * (ALERT_MAX - ALERT_MIN); }

// Search radius (blocks) for "same kind, nearby" when finding who to huddle with, and
// how close to that huddle centroid counts as arrived-and-can-bed-down.
export const HUDDLE_SEARCH_R = 20;
export const HUDDLE_SETTLE_DIST = 2.5;

export function reachedHuddle(pos, target, settleDist = HUDDLE_SETTLE_DIST) {
  return Math.hypot(target.x - pos.x, target.z - pos.z) <= settleDist;
}
