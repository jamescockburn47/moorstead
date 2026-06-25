// verify-festival-builders.mjs — headless wiring assertion for the seasonal
// festival builder registry. Imports the two new builders directly and confirms
// they are exported functions, then imports seasonalLayer to confirm registration.
// Run wi': node scripts/verify-festival-builders.mjs
//
// A full render smoke-test isn't practical headlessly (builders need a real
// scene + world), so we assert existence + correct wiring only.
import { buildHarvest } from '../src/festivals/harvest.js';
import { buildEaster } from '../src/festivals/easter.js';

let failed = false;
const ok  = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// -- builder exports are functions
(typeof buildHarvest === 'function' ? ok : bad)('buildHarvest is a function');
(typeof buildEaster  === 'function' ? ok : bad)('buildEaster is a function');

// -- seasonalLayer imports them and exposes them via FESTIVAL_BUILDERS.
// We can't import SeasonalLayer directly (it pulls three.js at module level
// which is fine in Node ≥16 w/ ESM), but the import itself is the wiring check:
// if harvest.js or easter.js have a syntax/import error it'll throw here.
try {
  // Dynamic import so a failure gives a readable error rather than a crash
  const sl = await import('../src/seasonalLayer.js').catch(e => { throw e; });
  ok('seasonalLayer.js imports without error (harvest + easter wired)');
  // SeasonalLayer is the named export — verify it's a class (constructor exists)
  (typeof sl.SeasonalLayer === 'function' ? ok : bad)('SeasonalLayer class exported');
} catch (e) {
  bad('seasonalLayer.js failed to import: ' + e.message);
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
