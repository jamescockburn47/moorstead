// Foraging — run wi': node scripts/verify-forage.mjs
import { SCATTER_FORAGE, activeForageables, forageYield, FORAGE_LIFESPAN } from '../src/forage.js';
import { cellInstances } from '../src/flora-placement.js';
import { seasonStateAtPhase } from '../src/season.js';
import { TILE, I } from '../src/defs.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const autumn = seasonStateAtPhase(0.66), spring = seasonStateAtPhase(0.12), winter = seasonStateAtPhase(0.875);

{
  const aut = activeForageables(autumn).map(s => s.tile);
  (aut.includes(TILE.CEP) ? ok : bad)('mushrooms forage in autumn');
  const spr = activeForageables(spring).map(s => s.tile);
  (spr.includes(TILE.WILD_GARLIC) ? ok : bad)('wild garlic forages in spring');
  (!activeForageables(autumn).map(s => s.tile).includes(TILE.WILD_GARLIC) ? ok : bad)('no garlic in autumn');
  (activeForageables(winter).length === 0 ? ok : bad)('nowt fresh to forage in deep winter');
}
{
  (forageYield(TILE.CEP) === I.CEP ? ok : bad)('cep tile yields cep');
  (forageYield(TILE.WILD_GARLIC) === I.WILD_GARLIC ? ok : bad)('garlic tile yields garlic');
}
{
  (typeof FORAGE_LIFESPAN === 'number' && FORAGE_LIFESPAN > 0 ? ok : bad)('forage regrows after a positive lifespan');
}
{
  let cells = 0;
  for (let x = 0; x < 60; x++) for (let z = 0; z < 60; z++)
    if (cellInstances(1234, x, z, 'forage', TILE.CEP).length) cells++;
  (cells > 0 && cells < 60 * 60 * 0.2 ? ok : bad)('forage placement is sparse (' + cells + '/3600 cells)');
  const a = JSON.stringify(cellInstances(1234, 7, 9, 'forage', TILE.CEP));
  const b = JSON.stringify(cellInstances(1234, 7, 9, 'forage', TILE.CEP));
  (a === b ? ok : bad)('forage placement is deterministic');
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
