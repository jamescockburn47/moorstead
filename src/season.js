// season.js — deterministic seasonal clock for the shared moor.
//
// Season is a pure function of wall-clock time (Date.now()), so every client
// and Merlin agree without any server coordination — the same idiom the Great
// Fog uses (sky.js) and the train. ~1 real day per season; a four-day year.
// Nowt is persisted: the season is computed, never stored.

export const YEAR = 4 * 86400;                        // seconds: four real days
export const ANCHOR_SEC = Date.UTC(2026, 5, 16) / 1000; // 2026-06-16 00:00 UTC
export const ANCHOR_PHASE = 0.27;                     // early summer at the anchor

const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const frac = x => x - Math.floor(x);

// wrap-around Gaussian bump on the year circle: 1 at centre c, width w
function bump(phase, c, w) {
  let d = Math.abs(phase - c);
  if (d > 0.5) d = 1 - d;
  return Math.exp(-(d * d) / (2 * w * w));
}

function build(yearPhase) {
  const idx = Math.min(3, Math.floor(yearPhase * 4));
  return {
    yearPhase,
    season: SEASONS[idx],
    seasonT: frac(yearPhase * 4),
    heatherBloom: bump(yearPhase, 0.45, 0.06),    // peak in late summer (~August)
    snowiness: bump(yearPhase, 0.875, 0.08),      // peak in deep winter
    greenness: 0.5 + 0.5 * Math.cos((yearPhase - 0.18) * Math.PI * 2),
    warmth: Math.cos((yearPhase - 0.375) * Math.PI * 2), // -1 winter .. +1 summer
  };
}

export function seasonState(now = Date.now()) {
  return build(frac((now / 1000 - ANCHOR_SEC) / YEAR + ANCHOR_PHASE));
}

// Build a season directly from a year phase [0,1) — for tests and the debug lever.
export function seasonStateAtPhase(yearPhase) {
  return build(frac(yearPhase));
}

// Bilberries bear only in late summer (the heather-bloom window).
export function bilberryInSeason(now = Date.now()) {
  return seasonState(now).heatherBloom > 0.4;
}
