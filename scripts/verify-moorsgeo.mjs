// MoorsGeography from data/moors-data.json — run wi': node scripts/verify-moorsgeo.mjs
// Assertions are data-agnostic (look features up by name / test relationships) so
// they hold for both the control-point fixture and the real OS data.
import { MoorsGeography } from '../src/moorsgeo.js';
import { WATER_LEVEL } from '../src/defs.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const geo = new MoorsGeography();

// settlements + stations come from the data
{
  (geo.villages.length >= 6 ? ok : bad)(`settlements loaded (${geo.villages.length})`);
  const wh = geo.villages.find(v => v.name === 'Whitby');
  (wh ? ok : bad)('Whitby present');
  const st = geo.railway();
  (st.length >= 2 && st[0].name === 'Pickering' && st.some(s => s.name === 'Whitby') ? ok : bad)('moors line: Pickering-first, Whitby present');
}
// Whitby sits on the coast: sea to its east, dry land to its west
{
  const wh = geo.villages.find(v => v.name === 'Whitby');
  (geo.coastT(wh.x + 280, wh.z) > 0.5 ? ok : bad)('open sea east of Whitby (coastT > 0.5)');
  (geo.coastT(wh.x - 160, wh.z) === 0 ? ok : bad)('dry land west of Whitby (coastT 0)');
  (Number.isInteger(geo.height(wh.x, wh.z)) ? ok : bad)('height returns an integer block-Y');
}
// real landform: high moor well above sea, sea present
{
  let max = -Infinity, min = Infinity;
  for (let x = 200; x < 3600; x += 200)
    for (let z = 200; z < 2400; z += 200) {
      const h = geo.heightRaw(x, z);
      if (h > max) max = h; if (h < min) min = h;
    }
  (max > WATER_LEVEL + 15 ? ok : bad)(`high moor stands well above sea (max block ${Math.round(max)})`);
  (min <= WATER_LEVEL ? ok : bad)(`sea present at/below water level (min block ${Math.round(min)})`);
}
// landmark naming + a railPath that runs through every station
{
  const ab = geo.data.landmarks.find(l => l.name.includes('Abbey'));
  (ab && geo.locationName(ab.x, ab.z).includes('Abbey') ? ok : bad)('abbey site names as the Abbey');
  const p = geo.railPath();
  (p.length > 100 && p.stationS.length === geo.railway().length ? ok : bad)('railPath builds with a chainage per station');
}

console.log(failed ? '\nMOORSGEO: FAIL' : '\nMOORSGEO: all good');
process.exit(failed ? 1 : 0);
