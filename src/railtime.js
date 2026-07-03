// Pure rail schedule maths — shared by the Game's live trains, the verify scripts,
// and (via scripts/export-timetable.mjs -> brain-sync/timetable.json) the EVO brain,
// so client and brain read the SAME deterministic timetable from the wall clock.
export const RAIL_VMAX = 11;  // blocks a second flat out — t' pace of a heritage steamer
export const RAIL_ACC = 0.18; // gentle acceleration: she works up to speed an' brakes early
export const DWELL_T = 30;    // thirty seconds stood at each platform, doors open

// where is she an' how fast, tt seconds into a leg o' length len?
// (trapezoid speed profile: accelerate, cruise, brake — closed form, so
// every client computes t' same train frae t' same wall clock)
export function runProfile(len, tt) {
  const dFull = RAIL_VMAX * RAIL_VMAX / (2 * RAIL_ACC);
  let vPeak, tA;
  if (len >= 2 * dFull) { vPeak = RAIL_VMAX; tA = RAIL_VMAX / RAIL_ACC; }
  else { vPeak = Math.sqrt(RAIL_ACC * len); tA = vPeak / RAIL_ACC; }
  const dA = 0.5 * RAIL_ACC * tA * tA;
  const tCruise = vPeak >= RAIL_VMAX ? (len - 2 * dA) / RAIL_VMAX : 0;
  const tTotal = 2 * tA + tCruise;
  let dist, v;
  if (tt <= tA) { dist = 0.5 * RAIL_ACC * tt * tt; v = RAIL_ACC * tt; }
  else if (tt <= tA + tCruise) { dist = dA + (tt - tA) * vPeak; v = vPeak; }
  else { const tb = Math.max(0, tTotal - tt); dist = len - 0.5 * RAIL_ACC * tb * tb; v = RAIL_ACC * tb; }
  return { dist: Math.max(0, Math.min(len, dist)), v: Math.max(0, v), tTotal };
}
export function legTime(len) { return runProfile(len, 0).tTotal; }
