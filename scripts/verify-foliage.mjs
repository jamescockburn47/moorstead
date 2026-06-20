// Foliage seasonal-colour check — run wi': node scripts/verify-foliage.mjs
// seasonShiftPx is a pure pixel function: it mutates an [r,g,b,a] array in place.
// We feed it a representative base pixel per tile and assert the colour shifts
// the right way across the year. No canvas/WebGL needed.
import { seasonShiftPx } from '../src/textures.js';
import { TILE } from '../src/defs.js';
import { seasonStateAtPhase } from '../src/season.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// apply the seasonal shift to a fresh base pixel at a given year phase
const shift = (tile, base, phase) => {
  const d = [base[0], base[1], base[2], 255];
  seasonShiftPx(tile, d, 0, seasonStateAtPhase(phase));
  return d;
};
const LEAF = [63, 85, 39];      // TILE.LEAVES speckle base (0x3f5527)
const HEATH = [120, 90, 110];   // a heathery base
const BRACK = [95, 110, 60];    // a bracken/fern green base
const GRASS = [90, 120, 55];    // a grass base

// deciduous leaves turn through the year
{
  const summer = shift(TILE.LEAVES, LEAF, 0.375);
  (summer[1] > summer[0] && summer[1] > summer[2] ? ok : bad)('summer leaves stay green (green dominant)');
  const autumn = shift(TILE.LEAVES, LEAF, 0.625);
  (autumn[0] > autumn[1] ? ok : bad)('autumn leaves turn gold/rust (red overtakes green)');
  (autumn[0] > summer[0] ? ok : bad)('autumn leaves are redder than summer');
  const winter = shift(TILE.LEAVES, LEAF, 0.875);
  (winter[1] - winter[2] < summer[1] - summer[2] ? ok : bad)('winter leaves are browner/less green than summer');
}

// monkey puzzle is evergreen: in autumn it must NOT turn gold the way deciduous leaves do
{
  const mpAutumn = shift(TILE.MONKEY_LEAVES, LEAF, 0.625);
  const leafAutumn = shift(TILE.LEAVES, LEAF, 0.625);
  (mpAutumn[1] >= mpAutumn[0] ? ok : bad)('monkey puzzle stays green in autumn (green still dominant)');
  (mpAutumn[0] < leafAutumn[0] ? ok : bad)('monkey puzzle is far less red than deciduous leaves in autumn');
}

// stronger moor tints (these thresholds fail at the OLD blend amounts, pass at the new)
{
  const heather = shift(TILE.HEATHER, HEATH, 0.45);
  (heather[2] >= 155 && heather[1] < heather[0] && heather[1] < heather[2] ? ok : bad)('heather purples strongly at bloom');
  const bracken = shift(TILE.BRACKEN, BRACK, 0.625);
  (bracken[0] >= 135 ? ok : bad)('bracken rusts strongly in autumn');
  const grassSummer = shift(TILE.GRASS_TOP, GRASS, 0.375);
  const grassWinter = shift(TILE.GRASS_TOP, GRASS, 0.875);
  const spread = c => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
  (spread(grassWinter) < spread(grassSummer) ? ok : bad)('winter grass is paler/desaturated vs summer');
}

{
  const shiftB = (phase) => { const d = [70,100,45,255]; seasonShiftPx(TILE.BRAMBLE, d, 0, seasonStateAtPhase(phase)); return d; };
  const summer = shiftB(0.375), winter = shiftB(0.875);
  (winter[1] - winter[2] < summer[1] - summer[2] ? ok : bad)('brambles die back browner in winter than summer');
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
