// Deterministic check o' t' Moors Railway — run wi': node scripts/verify-rail.mjs
// Verifies, for t' shared-moor seed (an' a few others):
//   1. t' line never crosses itself (no non-adjacent segment intersections)
//   2. no station stands in t' sea or under water
//   3. t' line corridor (±1.7 blocks) never slices through a village building
//   4. Pickering is t' southern terminus, Whitby t' seaward one (real NYMR shape)
// Also prints leg lengths an' implied speeds so pacing stays honest.
import { strSeed } from '../src/noise.js';
import { Geography } from '../src/geography.js';
import { WATER_LEVEL } from '../src/defs.js';

const SEEDS = ['t-shared-moor', 'owt', 'nowt', '42'];

function segInt(a, b, c, d) {
  // proper intersection of segments ab an' cd
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x));
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

let failed = false;
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const ok = m => console.log('  ok    ' + m);

for (const seedStr of SEEDS) {
  const geo = new Geography(strSeed(seedStr));
  const st = geo.railway();
  console.log(`\n== seed "${seedStr}" ==`);
  console.log('  stations: ' + st.map(s => `${s.name}(${s.x},${s.z})`).join(' -> '));

  // leg lengths an' speeds
  const legs = [];
  for (let i = 0; i < st.length - 1; i++) {
    legs.push(Math.hypot(st[i + 1].x - st[i].x, st[i + 1].z - st[i].z));
  }
  console.log('  legs: ' + legs.map(l => Math.round(l)).join(', ') + ' blocks');

  // 1. self-intersection
  let crossings = 0;
  for (let i = 0; i < st.length - 1; i++) {
    for (let j = i + 2; j < st.length - 1; j++) {
      if (segInt(st[i], st[i + 1], st[j], st[j + 1])) {
        crossings++;
        bad(`line crosses itself: leg ${st[i].name}->${st[i + 1].name} X leg ${st[j].name}->${st[j + 1].name}`);
      }
    }
  }
  if (!crossings) ok('no self-crossings');

  // 2. stations on dry land
  for (const s of st) {
    const ct = geo.coastT(s.x, s.z);
    const h = geo.height(s.x, s.z); // post-flatten: what t' game actually builds
    if (ct > 0.35) bad(`${s.name} station is in t' sea (coastT=${ct.toFixed(2)})`);
    else if (h <= WATER_LEVEL) bad(`${s.name} station is under water (h=${h.toFixed(1)})`);
  }
  ok('stations checked against sea an\' water');

  // 3. corridor never slices a building (centreline ± perpendicular offsets)
  let clipped = 0;
  for (let i = 0; i < st.length - 1; i++) {
    const a = st[i], b = st[i + 1];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    const ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
    for (let t = 0; t <= L; t += 1) {
      for (const off of [-1.5, 0, 1.5]) {
        const x = Math.round(a.x + ux * t - uz * off);
        const z = Math.round(a.z + uz * t + ux * off);
        const col = geo.villageColumn(x, z);
        if (col && col.kind === 'building') {
          if (clipped < 4) bad(`leg ${a.name}->${b.name} slices a ${col.b.type} at (${x},${z}) in ${col.v.name}`);
          clipped++;
        }
      }
    }
  }
  if (!clipped) ok('corridor clear o\' buildings');
  else console.log(`        (${clipped} clipped samples total)`);

  // 3b. every village stands on dry ground — t' whole disk flattens to t'
  // centre's height, an' shared-moor folk spawn across ALL villages
  let wetVillage = false;
  for (const v of geo.villages) {
    if (v.ground <= WATER_LEVEL + 1) {
      bad(`${v.name} village ground is wet/under water (ground=${v.ground}, water=${WATER_LEVEL})`);
      wetVillage = true;
    }
  }
  if (!wetVillage) ok('every village stands on dry ground');

  // 4. NYMR shape: right stations, right order, right ends
  const want = ['Pickering', 'Levisham', 'Moorstead', 'Goathland', 'Grosmont', 'Whitby'];
  if (st.map(s => s.name).join('|') !== want.join('|')) {
    bad('station order is not t\' real NYMR: ' + st.map(s => s.name).join(' -> '));
  } else ok('station order matches t\' real NYMR (Moorstead standing in for Newton Dale)');
  const p = st.find(s => s.name === 'Pickering'), w = st.find(s => s.name === 'Whitby');
  if (!p || !w) bad('Pickering or Whitby missing from t\' line');
  else {
    if (st.indexOf(p) !== 0 && st.indexOf(p) !== st.length - 1) bad('Pickering is not a terminus');
    if (st.indexOf(w) !== 0 && st.indexOf(w) !== st.length - 1) bad('Whitby is not a terminus');
    const southmost = st.reduce((m, s) => (s.z > m.z ? s : m));
    if (southmost !== p) bad(`southern-most station is ${southmost.name}, expected Pickering (real NYMR runs south->north)`);
    else ok('Pickering is t\' southern terminus');
    const seamost = st.reduce((m, s) => (s.x > m.x ? s : m));
    if (seamost !== w) bad(`seaward-most station is ${seamost.name}, expected Whitby`);
    else ok('Whitby is t\' seaward terminus');
  }
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
