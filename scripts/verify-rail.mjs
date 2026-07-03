// Deterministic check o' t' Moors Railway — run wi': node scripts/verify-rail.mjs
// Verifies, for t' shared-moor seed (an' a few others):
//   1. t' line never crosses itself (no non-adjacent segment intersections)
//   2. no station stands in t' sea or under water
//   3. t' line corridor (±1.7 blocks) never slices through a village building
//   4. Pickering is t' southern terminus, Whitby t' seaward one (real NYMR shape)
// Also prints leg lengths an' implied speeds so pacing stays honest.
import { readFileSync } from 'node:fs';
import { strSeed } from '../src/noise.js';
import { Geography } from '../src/geography.js';
import { WATER_LEVEL } from '../src/defs.js';
import { MoorsGeography } from '../src/moorsgeo.js';
import { Rails } from '../src/rails.js';

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

  // leg lengths along t' actual alignment (spline chainage)
  const path = geo.railPath();
  const legs = [];
  for (let i = 0; i < path.stationS.length - 1; i++) {
    legs.push(path.stationS[i + 1] - path.stationS[i]);
  }
  console.log('  legs: ' + legs.map(l => Math.round(l)).join(', ') + ' blocks; line ' + Math.round(path.length) + ' end to end');

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

  // 3. corridor never slices a building (walk t' actual spline wi' offsets)
  let clipped = 0;
  for (let i = 0; i < path.pts.length - 1; i++) {
    const a = path.pts[i], b = path.pts[i + 1];
    const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
    for (const off of [-2.2, -1.1, 0, 1.1, 2.2]) {
      const x = Math.round(a.x - uz * off), z = Math.round(a.z + ux * off);
      const col = geo.villageColumn(x, z);
      if (col && col.kind === 'building') {
        if (clipped < 4) bad(`line slices a ${col.b.type} at (${x},${z}) in ${col.v.name}`);
        clipped++;
      }
    }
  }
  if (!clipped) ok('corridor clear o\' buildings');
  else console.log(`        (${clipped} clipped samples total)`);

  // 3c. engineered profile: gradients sane, deck dry, platforms level
  let badGrade = 0, wetDeck = 0, steepest = 0;
  for (let i = 1; i < path.pts.length; i++) {
    const ds = path.pts[i].s - path.pts[i - 1].s || 0.001;
    const g = Math.abs((path.pts[i].deck - path.pts[i - 1].deck) / ds);
    steepest = Math.max(steepest, g);
    if (g > 0.14) badGrade++;
    if (path.pts[i].deck < WATER_LEVEL + 1) wetDeck++;
  }
  if (badGrade) bad(`${badGrade} samples steeper than 1-in-7 (worst ${steepest.toFixed(3)})`);
  else ok(`gradients all gentle (steepest 1-in-${Math.round(1 / Math.max(steepest, 0.001))})`);
  // t' line must never double back on itsen — a reversed micro-segment
  // would spin t' train round on t' spot
  let kinks = 0;
  for (let i = 1; i < path.pts.length - 1; i++) {
    const a = path.pts[i - 1], b = path.pts[i], c = path.pts[i + 1];
    if ((b.x - a.x) * (c.x - b.x) + (b.z - a.z) * (c.z - b.z) < 0) kinks++;
  }
  if (kinks) bad(`${kinks} kinked samples — t' path doubles back on itsen`);
  else ok('line never doubles back on itsen');
  if (wetDeck) bad(`${wetDeck} samples o' deck below water`);
  else ok('deck dry t\' whole way');
  for (let si = 0; si < st.length; si++) {
    const dAlign = Math.abs(geo.samplePos(path.stationS[si]).deck - geo.height(st[si].x, st[si].z));
    if (dAlign > 1.6) bad(`${st[si].name} platform sits ${dAlign.toFixed(1)} blocks off t' deck`);
  }
  ok('platforms level wi\' t\' line');

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

// 5. t' rails OVERLAY earthworks (real-Moors world): where t' line crosses a beck
//    t' embankment skirt must be STRUCK (no grey wall damming t' channel) an'
//    masonry piers must carry t' span down to t' bed; everywhere else t' skirt
//    is atlas-textured an' hue-varied, not flat grey. Built headlessly at t'
//    Murk Esk crossing by Grosmont an' inspected buffer by buffer.
console.log('\n== rails overlay: bridges an\' earthworks (real-Moors world) ==');
{
  const mg = new MoorsGeography();
  const line = mg.railPaths().find(l => l.name === 'Whitby & Pickering') || mg.railPaths()[0];
  const main = line.path;

  // find every water-channel crossing along t' line, then pick t' one nearest Grosmont
  const gros = mg.data.stations.find(s => /grosmont/i.test(s.name)) || { x: 1415, z: 2606 };
  const crossings = [];
  for (const p of main.pts) {
    const rc = mg.riverColumn(Math.round(p.x), Math.round(p.z));
    if (rc) crossings.push({ s: p.s, x: p.x, z: p.z, deck: p.deck, wl: rc.wl, bed: rc.bed });
  }
  if (!crossings.length) bad('main line never crosses a river channel — no bridge to verify');
  else ok(`main line crosses water at ${crossings.length} spline samples`);
  const target = crossings.reduce((m, c) =>
    Math.hypot(c.x - gros.x, c.z - gros.z) < Math.hypot(m.x - gros.x, m.z - gros.z) ? c : m, crossings[0]);
  console.log(`  Esk crossing by Grosmont: (${Math.round(target.x)},${Math.round(target.z)}) s=${Math.round(target.s)} deck=${target.deck.toFixed(1)} wl=${target.wl} bed=${target.bed}`);
  if (target.deck < target.wl + 3.5) bad(`deck barely clears t' water (deck ${target.deck.toFixed(1)} vs wl ${target.wl}) — bridge clearance regressed`);
  else ok('deck rides clear o\' t\' water (riverFn lift held)');

  // build t' overlay window centred on t' crossing, headless (stub scene)
  const scene = { add() {}, remove() {} };
  const rails = new Rails(scene, mg);
  rails.build(main, target.s);
  const kinds = {};
  for (const msh of rails.meshes) kinds[msh.userData.kind] = msh;

  // 5a. NO skirt geometry over t' water channel — t' beck runs open under t' span
  const skirt = kinds.skirt;
  if (!skirt) bad('no skirt mesh built in t\' window (embankments missing entirely)');
  else {
    const pa = skirt.geometry.attributes.position;
    let wet = 0, sample = '';
    for (let i = 0; i < pa.count; i++) {
      const rx = Math.round(pa.getX(i)), rz = Math.round(pa.getZ(i));
      if (mg.riverColumn(rx, rz)) { wet++; if (!sample) sample = `(${rx},${rz})`; }
    }
    if (wet) bad(`${wet} skirt vertices stand IN t' river channel ${sample} — t' skirt dams t' beck`);
    else ok(`skirt clear o' t' channel (${pa.count} verts inspected)`);
    // 5b. t' skirt is textured + hue-varied, not flat grey
    if (!skirt.geometry.attributes.uv) bad('skirt has no UV attribute — atlas dressing missing');
    else ok('skirt carries atlas UVs');
    const ca = skirt.geometry.attributes.color;
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < ca.count; i++) { const r = ca.getX(i); if (r < mn) mn = r; if (r > mx) mx = r; }
    if (mx - mn < 0.05) bad(`skirt vertex colours near-uniform (${mn.toFixed(3)}..${mx.toFixed(3)}) — still reads flat`);
    else ok(`skirt hue-varied (r ${mn.toFixed(2)}..${mx.toFixed(2)})`);
    if (skirt.material.vertexColors !== true) bad('skirt material lost vertexColors');
    else ok('skirt material modulates by vertex colour');
  }

  // 5c. crown (ballast) textured too
  const crown = kinds.crown;
  if (!crown) bad('no ballast crown mesh built');
  else if (!crown.geometry.attributes.uv) bad('crown has no UV attribute — ballast is paint again');
  else ok('ballast crown carries atlas UVs');

  // 5d. masonry piers stand in t' crossing, under t' deck, down to t' bed
  const piers = kinds.piers;
  if (!piers || !piers.count) bad('no bridge piers built at t\' Esk crossing');
  else {
    const arr = piers.instanceMatrix.array;
    let inChannel = 0, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < piers.count; i++) {
      const x = arr[i * 16 + 12], y = arr[i * 16 + 13], z = arr[i * 16 + 14];
      if (Math.hypot(x - target.x, z - target.z) > 12) continue;   // only t' target crossing
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      if (mg.riverColumn(Math.round(x), Math.round(z))) inChannel++;
    }
    if (!inChannel) bad('no pier course stands in t\' water channel — span carried on nowt');
    else ok(`${inChannel} pier courses in t' channel (${piers.count} total in window)`);
    if (maxY > target.deck) bad(`pier course above t' deck (y=${maxY.toFixed(1)} vs deck ${target.deck.toFixed(1)})`);
    else ok('piers stop flush under t\' deck slab');
    if (minY > target.wl) bad(`piers stop above t' water (lowest course y=${minY.toFixed(1)} vs wl ${target.wl}) — they don't reach t' bed`);
    else ok('piers reach down through t\' water to t\' bed');
  }

  // 5e. determinism: a second build at t' same chainage is byte-identical
  const rails2 = new Rails(scene, mg);
  rails2.build(main, target.s);
  const skirt2 = rails2.meshes.find(msh => msh.userData.kind === 'skirt');
  if (skirt && skirt2) {
    const p1 = skirt.geometry.attributes.position.array, p2 = skirt2.geometry.attributes.position.array;
    let same = p1.length === p2.length;
    if (same) for (let i = 0; i < p1.length; i++) if (p1[i] !== p2[i]) { same = false; break; }
    if (!same) bad('skirt geometry differs between two builds at t\' same chainage — non-deterministic');
    else ok('skirt build deterministic (rebuild byte-identical)');
  }
  rails.clear(); rails2.clear();

  // 5f. source literals: t' dressing comes frae t' shared atlas + terrain variation,
  //     an' nowt in t' overlay rolls Math.random
  const railsSrc = readFileSync(new URL('../src/rails.js', import.meta.url), 'utf8');
  for (const lit of ['TILE.GRASS_TOP', 'TILE.GRAVEL', 'TILE.STONEBRICK', 'topFaceVariation', 'crossingAt']) {
    if (!railsSrc.includes(lit)) bad(`rails.js lost '${lit}' — t' earthwork dressing regressed`);
  }
  if (railsSrc.includes('Math.random')) bad('rails.js uses Math.random — build-time determinism broken');
  else ok('earthwork dressing literals present, no Math.random');
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
