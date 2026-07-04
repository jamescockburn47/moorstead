// Admin panel + Parish Warden redesign — pure-logic checks. Run wi': node scripts/verify-admin-panel.mjs
//
// Headless Node only (docs/INVARIANTS.md rule 1) — these three functions are the ONLY
// testable-without-DOM/GL/network logic the feature adds; the panel rebuild itself and the
// EVO endpoint are verified live/manually (see the plan's Task 7/9 verification steps).

import { festivalBands } from '../src/festivals.js';
import { overrideWeatherState } from '../src/sky.js';
import { bigMapScreenToWorld } from '../src/ui.js';

let failed = false;
const ok  = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// --- festivalBands: real window geometry, proportional to each festival's actual length ---
{
  const bands = festivalBands();
  (bands.length === 6 ? ok : bad)('all six festivals produce a band');
  const byId = Object.fromEntries(bands.map(b => [b.id, b]));
  (byId.bonfire && byId.harvest ? ok : bad)('bonfire and harvest bands both present');
  // Harvest (12 days) must be a wider band than Bonfire (7 days) — true-width, not decorative.
  (byId.harvest.width > byId.bonfire.width ? ok : bad)('wider festivals get wider bands (Harvest > Bonfire)');
  for (const b of bands) {
    (b.left >= 0 && b.left + b.width <= 1.001 ? ok : bad)(`${b.id} band stays inside the year [0,1]`);
    (Math.abs((b.left + b.width / 2) - b.centre) < 1e-9 ? ok : bad)(`${b.id} band is centred on its festival's centre phase`);
  }
  // determinism (INVARIANTS rule 6) — same catalogue, same output every time
  (JSON.stringify(festivalBands()) === JSON.stringify(festivalBands()) ? ok : bad)('deterministic — no Math.random');
}

// --- overrideWeatherState: Rain/Snow gets a REAL synthetic rainAmount, not just a label ---
{
  const clear = overrideWeatherState('clear');
  (clear.weather === 'clear' && clear.liveRain === null ? ok : bad)('Clear override carries no rain amount');
  const rain = overrideWeatherState('rain');
  (rain.weather === 'rain' && rain.liveRain > 0 ? ok : bad)(
    'Rain/Snow override forces a real rainAmount — winterPrecip only falls back to snow when ALREADY wintry, so without this a summer preview of Rain would silently produce nothing'
  );
  const fog = overrideWeatherState('fog');
  (fog.weather === 'fog' && fog.liveFog === null ? ok : bad)('Fog override carries no forced fog distance (the weather string alone already drives baseFog for misty/fog)');
}

// --- bigMapScreenToWorld: inverts buildBigMap()'s own w2x/w2y projection exactly ---
{
  // A representative transform shape — the real one is built by ui.js's buildBigMap() from
  // world bounds; this is deliberately a plain object so the test needs no DOM/canvas at all.
  const xf = { s: 0.42, offH: 60, offV: 40, minZ: -1200, maxX: 900 };
  // Forward-project a known world point the SAME way buildBigMap() does, then invert it.
  const wx = 150, wz = -300;
  const sx = xf.offH + (wz - xf.minZ) * xf.s;
  const sy = xf.offV + (xf.maxX - wx) * xf.s;
  const back = bigMapScreenToWorld(xf, sx, sy);
  (Math.abs(back.x - wx) < 1 && Math.abs(back.z - wz) < 1 ? ok : bad)('inverts a forward-projected point back to (within rounding)');
  // determinism
  (JSON.stringify(bigMapScreenToWorld(xf, 100, 100)) === JSON.stringify(bigMapScreenToWorld(xf, 100, 100)) ? ok : bad)('deterministic');
}

// --- LIVE-SEED map click round-trip (James 2026-07-04: warden map click landed
// wrong). Build the REAL transform buildBigMap() would at MOORS_SEED (same maths,
// no DOM: a 900x760 canvas over the world bounds), forward-project every village
// to a map pixel, invert it, and assert it lands back on that village — so a
// coordinate/axis regression in the click path fails the gate, not the player. ---
{
  const { Gen, MOORS_SEED } = await import('../src/worldgen.js');
  const geo = new Gen(MOORS_SEED).geo;
  const W = 900, H = 760;
  const { minX, maxX, minZ, maxZ } = geo.worldBounds();
  const wwX = maxX - minX, wwZ = maxZ - minZ;
  const s = Math.min(W / wwZ, H / wwX);
  const offH = (W - wwZ * s) / 2, offV = (H - wwX * s) / 2;
  const xf = { s, offH, offV, minZ, maxX };
  const w2x = (x, z) => offH + (z - minZ) * s, w2y = (x, z) => offV + (maxX - x) * s;
  let allBack = true;
  for (const v of geo.villages) {
    const back = bigMapScreenToWorld(xf, w2x(v.x, v.z), w2y(v.x, v.z));
    if (Math.abs(back.x - v.x) > 1 || Math.abs(back.z - v.z) > 1) allBack = false;
  }
  (allBack ? ok : bad)(`live-seed: every village's map pixel inverts back to it (${geo.villages.length} towns)`);
  // a deliberately-wrong axis (swap x/z in the inverse) must NOT round-trip — proves the check has teeth
  const v0 = geo.villages[0];
  const swapped = bigMapScreenToWorld({ s, offH, offV, minZ: minX, maxX: maxZ }, w2x(v0.x, v0.z), w2y(v0.x, v0.z));
  (Math.abs(swapped.x - v0.x) > 1 || Math.abs(swapped.z - v0.z) > 1 ? ok : bad)('a wrong transform does NOT round-trip (the check can fail)');
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
