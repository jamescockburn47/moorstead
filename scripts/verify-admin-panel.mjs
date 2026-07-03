// Admin panel + Parish Warden redesign — pure-logic checks. Run wi': node scripts/verify-admin-panel.mjs
//
// Headless Node only (docs/INVARIANTS.md rule 1) — these three functions are the ONLY
// testable-without-DOM/GL/network logic the feature adds; the panel rebuild itself and the
// EVO endpoint are verified live/manually (see the plan's Task 7/9 verification steps).

import { festivalBands } from '../src/festivals.js';

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

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
