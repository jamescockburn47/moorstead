// festivals.js — deterministic festival calendar for the shared moor.
//
// A pure function of yearPhase (the same clock as season.js), so every client
// and Merlin agree without server coordination. Each festival is a trapezoid
// window on the year circle: full intensity across a core, a short linear fade
// at each edge. Layers and audio gate on these intensities, never on the broad
// `frost` flag. Nowt is persisted; the calendar is computed.

const DAY = 1 / 365.25;          // one calendar day as a fraction of the year circle
export const EDGE_DAYS = 1.5;    // linear fade at each end of every window

// Centres derive from season.js's anchoring (midsummer at phase 0.375, midwinter
// 0.875). `days` is the full visible width of the window.
export const FESTIVALS = [
  { id: 'easter',    name: 'Eastertide',    centre: 0.180, days: 10 },
  { id: 'mayday',    name: 'May Day',       centre: 0.235, days: 7  },
  { id: 'midsummer', name: 'Midsummer',     centre: 0.385, days: 7  },
  { id: 'harvest',   name: 'Harvest Home',  centre: 0.650, days: 12 },
  { id: 'bonfire',   name: 'Bonfire Night', centre: 0.750, days: 7  },
  { id: 'yule',      name: 'Christmastide', centre: 0.882, days: 14 },
];

const frac = x => x - Math.floor(x);
// shortest distance between two phases on the unit circle [0,1)
function circDist(a, b) { const d = Math.abs(frac(a) - frac(b)); return d > 0.5 ? 1 - d : d; }

// Trapezoid window: 1 across the core, linear fade over EDGE_DAYS each side, 0
// beyond. `days` is the full width (intensity > 0 spans ±days/2).
export function windowIntensity(phase, centre, days) {
  const half = (days / 2) * DAY;
  const edge = Math.min(half, EDGE_DAYS * DAY);
  const core = half - edge;
  const d = circDist(phase, centre);
  if (d <= core) return 1;
  if (d >= core + edge) return 0;
  return 1 - (d - core) / edge;
}

// Map a yearPhase to every festival's intensity (0..1), plus the dominant
// festival id (`active`, highest intensity > 0, else null) and its `intensity`.
export function festivalState(yearPhase) {
  const p = frac(yearPhase);
  const out = {};
  let active = null, intensity = 0;
  for (const f of FESTIVALS) {
    const v = windowIntensity(p, f.centre, f.days);
    out[f.id] = v;
    if (v > intensity) { intensity = v; active = f.id; }
  }
  out.active = intensity > 0 ? active : null;
  out.intensity = intensity;
  return out;
}
