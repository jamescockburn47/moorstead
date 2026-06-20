// Flower overlay logic — run wi': node scripts/verify-flora.mjs
import { activeScatter, activeAdornments } from '../src/flora-season.js';
import { seasonStateAtPhase } from '../src/season.js';
import { cellInstances } from '../src/flora-placement.js';
import { TILE, B } from '../src/defs.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const scatterAt = p => activeScatter(seasonStateAtPhase(p)).map(s => s.tile);
const adornAt = p => activeAdornments(seasonStateAtPhase(p));

{
  (scatterAt(0.97).includes(TILE.SNOWDROP) ? ok : bad)('snowdrops show in late winter');
  (!scatterAt(0.50).includes(TILE.SNOWDROP) ? ok : bad)('no snowdrops in summer');
  (scatterAt(0.12).includes(TILE.DAFFODIL) ? ok : bad)('daffodils show in spring');
  (scatterAt(0.40).includes(TILE.WILDFLOWER) ? ok : bad)('wildflowers show in summer');
}
{
  const bil = adornAt(0.45).find(a => a.tile === TILE.BILBERRY_FRUIT);
  (bil && bil.bush === B.BILBERRY_BUSH ? ok : bad)('bilberries ripen on bilberry bushes in late summer');
  (!adornAt(0.10).some(a => a.tile === TILE.BILBERRY_FRUIT) ? ok : bad)('no bilberries in early spring');
  const bf = adornAt(0.24).find(a => a.tile === TILE.BRAMBLE_FLOWER);
  (bf && bf.bush === B.BRAMBLE ? ok : bad)('bramble flowers on brambles in late spring');
  const bb = adornAt(0.58).find(a => a.tile === TILE.BLACKBERRY);
  (bb && bb.bush === B.BRAMBLE ? ok : bad)('blackberries on brambles in late summer/autumn');
  (!adornAt(0.58).some(a => a.tile === TILE.BRAMBLE_FLOWER) ? ok : bad)('bramble flowers gone once berries arrive');
  const holly = adornAt(0.875).find(a => a.tile === TILE.HOLLY_BERRY);
  (holly && holly.bush === B.HOLLY ? ok : bad)('holly berries on holly in deep winter');
  (!adornAt(0.40).some(a => a.tile === TILE.HOLLY_BERRY) ? ok : bad)('no holly berries in summer');
}

{
  const a = cellInstances(12345, 10, 20, 'moor', TILE.WILDFLOWER);
  const b = cellInstances(12345, 10, 20, 'moor', TILE.WILDFLOWER);
  (JSON.stringify(a) === JSON.stringify(b) ? ok : bad)('placement is deterministic for same seed+cell');
  (JSON.stringify(a) !== JSON.stringify(cellInstances(999, 10, 20, 'moor', TILE.WILDFLOWER)) ? ok : bad)('different seed gives different placement');
  for (const inst of a) {
    if (!(inst.dx >= 0 && inst.dx < 1 && inst.dz >= 0 && inst.dz < 1)) bad('instance dx/dz inside cell');
    if (!(inst.yaw >= 0 && inst.yaw < Math.PI * 2)) bad('instance yaw in range');
  }
  ok('moor instances jittered inside the cell with yaw + variant');
  let moorEmpty = 0, lineMin = 99;
  for (let cz = 0; cz < 40; cz++) {
    if (cellInstances(7, 5, cz, 'moor', TILE.WILDFLOWER).length === 0) moorEmpty++;
    lineMin = Math.min(lineMin, cellInstances(7, 5, cz, 'lineside', TILE.WILDFLOWER).length);
  }
  (moorEmpty > 0 ? ok : bad)('moor placement leaves bare cells (patchy clump)');
  (lineMin >= 3 ? ok : bad)('lineside placement is dense (>=3 per cell, got min ' + lineMin + ')');
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
