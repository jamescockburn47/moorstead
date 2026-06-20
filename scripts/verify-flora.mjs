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
  const sweep = (seed, mode) => { const o = []; for (let z = 0; z < 80; z++) o.push(cellInstances(seed, 5, z, mode, TILE.WILDFLOWER).length); return o; };
  const s1 = sweep(12345, 'moor');
  (JSON.stringify(s1) === JSON.stringify(sweep(12345, 'moor')) ? ok : bad)('placement is deterministic for same seed');
  (JSON.stringify(s1) !== JSON.stringify(sweep(999, 'moor')) ? ok : bad)('different seed gives different placement');
  const bare = s1.filter(n => n === 0).length, flowered = s1.filter(n => n > 0).length;
  (bare > 0 && flowered > 0 ? ok : bad)('moor placement is patchy (bare ' + bare + ', flowered ' + flowered + ')');
  (Math.min(...sweep(7, 'lineside')) >= 3 ? ok : bad)('lineside placement is dense (>=3 per cell)');
  let pop = null;
  for (let z = 0; z < 300 && !pop; z++) { const c = cellInstances(12345, 5, z, 'moor', TILE.WILDFLOWER); if (c.length) pop = c; }
  let bounds = !!pop;
  if (pop) for (const i of pop) { if (!(i.dx >= 0 && i.dx < 1 && i.dz >= 0 && i.dz < 1 && i.yaw >= 0 && i.yaw < Math.PI * 2)) bounds = false; }
  (bounds ? ok : bad)('moor instances jittered inside the cell with yaw');
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
