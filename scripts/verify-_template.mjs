// <Feature> check — run wi': node scripts/verify-<name>.mjs
//
// Copy this file to scripts/verify-<name>.mjs, fill it in, then wire it into the
// gate: append `&& node scripts/verify-<name>.mjs` to the "verify" chain in
// package.json and add a "verify:<name>" entry. See docs/ADDING-A-FEATURE.md.
//
// Rules (see docs/INVARIANTS.md rule 1): headless Node only — no DOM, no WebGL, no
// network (except verify-live), no clocks, no unseeded Math.random. Test the
// CONTRACT (the rule a player relies on), not the implementation. If your logic
// lives inside a DOM/GL method, extract it as an exported pure function and import
// it here — that is the established pattern (spreadHint, lanternFlicker,
// trackerHTML, outfitSpecFor, migrateSave all did this).

import { thingUnderTest } from '../src/yourmodule.js';

let failed = false;
const ok  = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// --- <invariant this block defends, in plain English> ---
{
  (thingUnderTest('input') === 'expected' ? ok : bad)('a plain-English statement of the rule');
  // determinism: the same input twice yields the same result (see INVARIANTS.md rule 6)
  (JSON.stringify(thingUnderTest('x')) === JSON.stringify(thingUnderTest('x')) ? ok : bad)('deterministic — same input, same output');
}

// --- teardown / no-leak (for anything that adds scene objects) ---
// {
//   const before = countSceneObjects();
//   build(); teardown();
//   (countSceneObjects() === before ? ok : bad)('teardown leaves zero orphans');
// }

// --- Plain-path unchanged (for anything gated on Fine graphics) ---
// {
//   (plainPathConfig() === originalConfig ? ok : bad)('Plain path is byte-for-byte today');
// }

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
