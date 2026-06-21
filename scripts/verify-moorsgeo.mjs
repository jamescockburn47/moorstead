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
// orientation: +x = north, +z = east (matches the engine's map). Whitby is north of
// Pickering and on the east coast; Osmotherley is west.
{
  const wh = geo.villages.find(v => v.name === 'Whitby');
  const pk = geo.villages.find(v => v.name === 'Pickering');
  (wh.x > pk.x ? ok : bad)('Whitby is north of Pickering (+x = north)');
  const os = geo.villages.find(v => v.name === 'Osmotherley');
  (!os || os.z < wh.z ? ok : bad)('Osmotherley is west of Whitby (+z = east)');
  (Number.isInteger(geo.height(wh.x, wh.z)) ? ok : bad)('height returns an integer block-Y');
}
// real landform: high moor well above sea, and open sea present
{
  let max = -Infinity, min = Infinity, anySea = false;
  for (let x = 100; x < 2400; x += 150)
    for (let z = 100; z < 3700; z += 150) {
      const h = geo.heightRaw(x, z);
      if (h > max) max = h; if (h < min) min = h;
      if (geo.coastT(x, z) > 0.6) anySea = true;
    }
  (max > WATER_LEVEL + 15 ? ok : bad)(`high moor stands well above sea (max block ${Math.round(max)})`);
  (anySea ? ok : bad)('open sea present (coastT > 0.6 somewhere)');
  (min <= WATER_LEVEL ? ok : bad)(`sea floor below water level (min block ${Math.round(min)})`);
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
