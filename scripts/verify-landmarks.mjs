// Landmark protection check — run wi': node scripts/verify-landmarks.mjs
// Built fabric at/above ground within a landmark's radius is unbreakable, but
// tha can allus dig underneath, an' natural ground stays diggable.
import { strSeed } from '../src/noise.js';
import { Geography, WAINSTONES } from '../src/geography.js';
import { protectedAt } from '../src/landmarks.js';
import { B } from '../src/defs.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

for (const seedStr of ['t-shared-moor:bairns', 't-shared-moor', '42']) {
  const geo = new Geography(strSeed(seedStr));
  console.log(`\n== seed "${seedStr}" ==`);
  const ab = geo.abbeySite();
  const h = geo.height(ab.x, ab.z);

  (protectedAt(geo, null, ab.x, h + 1, ab.z, B.STONEBRICK) ? ok : bad)('abbey wall (dressed stone, above ground) is protected');
  (!protectedAt(geo, null, ab.x, h - 3, ab.z, B.STONEBRICK) ? ok : bad)('you can dig UNDERNEATH the abbey');
  (!protectedAt(geo, null, ab.x, h + 1, ab.z, B.DIRT) ? ok : bad)('natural ground at the abbey stays breakable (landscaping)');
  (!protectedAt(geo, null, ab.x + 600, h + 1, ab.z + 200, B.STONEBRICK) ? ok : bad)('dressed stone far from any landmark is breakable');

  const wh = geo.height(WAINSTONES.x, WAINSTONES.z);
  (protectedAt(geo, null, WAINSTONES.x, wh + 1, WAINSTONES.z, B.STONE) ? ok : bad)('the Wainstones crag is protected');
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
