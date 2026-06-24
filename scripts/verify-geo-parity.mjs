// Emit the deterministic height reference for the relay parity test + sanity-check it.
// The cross-language assertion is deploy/world/test_moorsgeo.py (run on relay deploys);
// this JS side keeps the reference fresh and catches a broken MoorsGeography early.
import { writeFileSync } from 'node:fs';
import { MoorsGeography } from '../src/moorsgeo.js';
import { HEIGHT } from '../src/defs.js';

const geo = new MoorsGeography();
const out = [];
for (let bx = 200; bx <= 3800; bx += 400)
  for (let bz = 200; bz <= 2200; bz += 400)
    out.push([bx, bz, geo._heightRawNoFbm(bx, bz)]);
writeFileSync(new URL('../deploy/world/parity-ref.json', import.meta.url), JSON.stringify(out));

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
(out.length >= 60 ? ok : bad)(`emitted ${out.length} reference samples`);
(out.every(([, , h]) => h >= 5 && h <= HEIGHT - 6) ? ok : bad)('all heights within [5, HEIGHT-6]');
(out.every(([, , h]) => Number.isFinite(h)) ? ok : bad)('all heights finite');

console.log(failed ? '\nGEO-PARITY(js): FAIL' : '\nGEO-PARITY(js): reference written + sane');
process.exit(failed ? 1 : 0);
