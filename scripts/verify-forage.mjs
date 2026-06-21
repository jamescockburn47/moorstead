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

// forageLedger: record -> isForaged true; expires (regrows) after FORAGE_LIFESPAN days
{
  const { World } = await import('../src/world.js');
  // World(scene, seed, savedChunks) — pass a null-ish scene; constructor never touches it directly.
  const w = new World(null, 1234);
  w.recordForage(5, 41, 9, 10);
  (w.isForaged(5, 41, 9)  ? ok : bad)('a picked cell reads as foraged');
  (!w.isForaged(6, 41, 9) ? ok : bad)('an unpicked cell reads as not foraged');
  w.expireForage(10 + FORAGE_LIFESPAN);
  (!w.isForaged(5, 41, 9) ? ok : bad)('forage regrows after its lifespan');
}

// host-borne fruit: active in season, maps bush -> item
{
  const { HOST_FORAGE, activeHostForage, hostForageFor } = await import('../src/forage.js');
  const { B } = await import('../src/defs.js');
  const lateSummer = seasonStateAtPhase(0.45), aut = seasonStateAtPhase(0.66), win = seasonStateAtPhase(0.9);
  (hostForageFor(B.BILBERRY_BUSH, lateSummer) ? ok : bad)('bilberries ripe in late summer');
  (hostForageFor(B.HAZEL, aut)?.item != null ? ok : bad)('hazelnuts ripe in autumn');
  (hostForageFor(B.BLACKTHORN, win)?.item != null ? ok : bad)('sloes hang on after frost');
  (!hostForageFor(B.BILBERRY_BUSH, win) ? ok : bad)('no bilberries in deep winter');
  (HOST_FORAGE.every(h => h.bush != null && h.item != null && h.tile != null) ? ok : bad)('every host-forage entry has bush+item+tile');
}

// fruit trees: species deterministic by region; ripe in autumn
{
  const { FRUIT_SPECIES, fruitSpeciesAt, fruitTreeRipe } = await import('../src/forage.js');
  const a = fruitSpeciesAt(1234, 100, 100), b = fruitSpeciesAt(1234, 100, 100);
  (a.item === b.item ? ok : bad)('fruit species is deterministic per cell');
  (FRUIT_SPECIES.some(s => fruitSpeciesAt(1234, 100, 100).item === s.item) ? ok : bad)('species is one of the three');
  const items = new Set();
  for (let x = 0; x < 6; x++) for (let z = 0; z < 6; z++) items.add(fruitSpeciesAt(1234, 200 + x, 200 + z).item);
  (items.size <= 2 ? ok : bad)('a small orchard patch is mostly one species (' + items.size + ' spp)');
  (fruitTreeRipe(seasonStateAtPhase(0.66)) ? ok : bad)('fruit ripe in autumn');
  (!fruitTreeRipe(seasonStateAtPhase(0.1)) ? ok : bad)('no fruit in spring');
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
