// MoorsGeography from data/moors-data.json — run wi': node scripts/verify-moorsgeo.mjs
import { MoorsGeography } from '../src/moorsgeo.js';
import { WATER_LEVEL } from '../src/defs.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const geo = new MoorsGeography();

// height: sea at the coast, high on the central moor, integer block-Y
{
  const wh = geo.villages.find(v => v.name === 'Whitby');
  (geo.height(wh.x + 80, wh.z) <= WATER_LEVEL + 1 ? ok : bad)('sea just off Whitby is at/under water level');
  (geo.height(1800, 760) > geo.height(wh.x, wh.z) ? ok : bad)('central moor stands above the coast town');
  (Number.isInteger(geo.height(1800, 760)) ? ok : bad)('height returns an integer block-Y');
}
// villages + stations come from the data, at their given positions
{
  (geo.villages.length >= 6 ? ok : bad)('villages loaded from data');
  const st = geo.railway();
  (st.find(s => s.name === 'Whitby') && st.find(s => s.name === 'Pickering') ? ok : bad)('real stations present');
  (st[0].name === 'Pickering' ? ok : bad)('moors line ordered Pickering-first');
}
// coastT rises 0 -> 1 going out to sea
{
  const wh = geo.villages.find(v => v.name === 'Whitby');
  (geo.coastT(wh.x - 200, wh.z) === 0 ? ok : bad)('inland of Whitby is dry (coastT 0)');
  (geo.coastT(wh.x + 200, wh.z) > 0.5 ? ok : bad)('out to sea is coastT > 0.5');
}
// landmark naming + a railPath that runs through every station
{
  (geo.locationName(3760, 700).includes('Abbey') ? ok : bad)('abbey site names as the Abbey');
  const p = geo.railPath();
  (p.length > 100 && p.stationS.length === geo.railway().length ? ok : bad)('railPath builds with a chainage per station');
}

console.log(failed ? '\nMOORSGEO: FAIL' : '\nMOORSGEO: all good');
process.exit(failed ? 1 : 0);
