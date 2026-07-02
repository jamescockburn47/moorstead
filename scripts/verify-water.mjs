// Living water ([15]) + flowing becks ([D0]) — run wi': node scripts/verify-water.mjs
//
// The contract this defends:
//   (a) aTop marks EXACTLY the liquid verts carrying the 0.12 top-drop (incl. side-face
//       top edges) — the shader may only ripple the surface, never the bed walls;
//   (b) riverFlow's tangent points DOWNSTREAM on the real Esk (water level non-increasing
//       along it, chainage s increasing) and bank fades 1 → 0 toward the channel edge;
//   (c) aFlow rides moors liquid geometry with real values; the stylised world (no
//       riverFlow on its geo) zero-fills, so behaviour collapses to the isotropic ripple;
//   (d) every water uniform exists, defaults 0 (= today's flat water, Plain-safe), and is
//       live-shared wi' the module setters;
//   (e) still exactly 3 terrain programs (one liquid cache key, no sibling handlers);
//   (f) determinism — two independent builds of the same moors chunk are byte-identical.
//
// Headless three.js builds fine (we never render); the one non-pure dep is the material
// atlas, satisfied by stubbing document before initMaterials (verify-remesh pattern).

global.document = {
  createElement: (tag) => {
    if (tag !== 'canvas') return {};
    const ctx2d = { clearRect: () => {}, fillRect: () => {}, drawImage: () => {}, fillStyle: '' };
    return { width: 0, height: 0, getContext: () => ctx2d };
  },
};

import { B, CHUNK, HEIGHT, WATER_LEVEL } from '../src/defs.js';
import { initMaterials, getMaterials, buildChunkMeshes, setWaterTime, FLOW_WRAP } from '../src/mesher.js';
import { MoorsGeography } from '../src/moorsgeo.js';
import { World } from '../src/world.js';
import { Gen, MOORS_SEED } from '../src/worldgen.js';
import { strSeed } from '../src/noise.js';

initMaterials();

let failed = false;
const ok  = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const IDX = (x, y, z) => x + z * CHUNK + y * CHUNK * CHUNK;

console.log('\n-- living water: ripple/flow bake + shader wiring --\n');

// --- (d) + (e): uniforms default 0, live setters, one liquid program ---------
{
  const mats = getMaterials();
  const keys = [mats.opaque.customProgramCacheKey(), mats.cutout.customProgramCacheKey(), mats.liquid.customProgramCacheKey()];
  (new Set(keys).size === 3 ? ok : bad)(`exactly 3 terrain programs (keys: ${keys.join(', ')})`);
  (keys[2].startsWith('liquid-ice') ? ok : bad)('liquid key stays liquid-ice-derived (ice + water share ONE handler)');

  const shader = { uniforms: {}, vertexShader: '#include <begin_vertex>', fragmentShader: '#include <color_fragment>' };
  mats.liquid.onBeforeCompile(shader);
  for (const u of ['uWaterTime', 'uRippleAmp', 'uFlowAmp', 'uGlitter', 'uFresnel', 'uFrozen']) {
    (shader.uniforms[u] && shader.uniforms[u].value === 0
      ? ok : bad)(`uniform ${u} registered on the liquid shader, defaults 0`);
  }
  (shader.vertexShader.includes('attribute float aTop') && shader.vertexShader.includes('attribute vec3 aFlow')
    ? ok : bad)('vertex shader declares aTop + aFlow');
  (shader.vertexShader.includes('transformed.y += aTop')
    ? ok : bad)('displacement is gated by aTop (only dropped surface verts ripple)');
  (shader.vertexShader.includes('modelMatrix * vec4(transformed, 1.0)')
    ? ok : bad)('ripple phase taken frae WORLD pos (modelMatrix — the addSnow idiom)');
  (shader.fragmentShader.includes('uGlitter') && shader.fragmentShader.includes('vViewPosition')
    ? ok : bad)('fragment carries world-space glitter + fresnel terms');
  ((shader.fragmentShader.match(/diffuseColor\.rgb = mix\(diffuseColor\.rgb, vec3\(0\.80, 0\.88, 0\.95\), ice\)/) ? ok : bad))('the winter ice tint survives unchanged');
  setWaterTime(4.2);
  (shader.uniforms.uWaterTime.value === 4.2 ? ok : bad)('setWaterTime drives the live module uniform');
  setWaterTime(0);
}

// --- (a): synthetic chunk — aTop set on dropped verts ONLY -------------------
{
  const data = new Uint8Array(CHUNK * CHUNK * HEIGHT);
  data[IDX(8, 30, 8)] = B.WATER;                      // free-standing: all 6 faces emit
  data[IDX(4, 30, 4)] = B.WATER; data[IDX(4, 31, 4)] = B.WATER; // stacked pair: side faces mid-column
  const fakeWorld = { getBlock: () => B.AIR, gen: { geo: { coastT: () => 0 } } };
  const meshes = buildChunkMeshes(fakeWorld, { cx: 0, cz: 0, data });
  const lm = meshes.find(m => m.material === getMaterials().liquid);
  if (!lm) bad('synthetic water chunk builds a liquid mesh');
  else {
    ok('synthetic water chunk builds a liquid mesh');
    const pos = lm.geometry.getAttribute('position');
    const top = lm.geometry.getAttribute('aTop');
    const flow = lm.geometry.getAttribute('aFlow');
    (top && top.itemSize === 1 && top.count === pos.count ? ok : bad)('aTop present, one float per vert');
    (flow && flow.itemSize === 3 && flow.count === pos.count ? ok : bad)('aFlow present, vec3 per vert');
    let match = true, dropped = 0, sideTops = 0;
    const norm = lm.geometry.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) {
      const isDropped = Math.abs(pos.getY(i) - Math.round(pos.getY(i))) > 1e-4; // y+1-0.12
      if (isDropped) dropped++;
      if ((top.getX(i) === 1) !== isDropped) match = false;
      if (isDropped && norm.getY(i) === 0) sideTops++; // dropped corner on a SIDE face
    }
    (match ? ok : bad)('aTop === 1 exactly on the 0.12-dropped verts, 0 everywhere else');
    (dropped > 0 && sideTops > 0
      ? ok : bad)(`side-face top edges dropped AND flagged (${sideTops} side-face verts ripple wi' the surface — no cracks)`);
    let allZero = true;
    for (let i = 0; i < flow.count * 3; i++) if (flow.array[i] !== 0) allZero = false;
    (allZero ? ok : bad)('no riverFlow on the geo -> aFlow zero-fills (typeof guard, worldgen idiom)');
  }
}

// --- (b): the Esk runs downhill — tangent down-gradient, chainage downstream --
{
  const g = new MoorsGeography(MOORS_SEED);
  const esk = g._riverProfile().find(p => p.name === 'River Esk');
  (esk ? ok : bad)('the River Esk profile exists in the real moors geo');
  let tested = 0, wlOK = 0, sPairs = 0, sInc = 0, unit = true, bankOK = true;
  for (let i = Math.floor(esk.res.length * 0.3); i < esk.res.length - 3; i += 5) {
    const p = esk.res[i];
    const f = g.riverFlow(p.x, p.z);
    if (!f) continue;
    tested++;
    if (Math.abs(Math.hypot(f.tx, f.tz) - 1) > 1e-6) unit = false;
    if (!(f.bank > 0 && f.bank <= 1)) bankOK = false;
    // step ~6 blocks along the tangent: WHERE the stepped point is still on the river
    // (a tight meander can put it off-channel — that answers null and proves nowt),
    // chainage must grow and the water level must not rise. Every comparable pair counts.
    const q = { x: p.x + f.tx * 6, z: p.z + f.tz * 6 };
    const f2 = g.riverFlow(q.x, q.z);
    if (f2) { sPairs++; if (f2.s > f.s) sInc++; }
    const rcA = g.riverColumn(Math.round(p.x), Math.round(p.z));
    const rcB = g.riverColumn(Math.round(q.x), Math.round(q.z));
    if (rcA && rcB) { if (rcB.wl <= rcA.wl) wlOK++; else { bad(`water level RISES along the tangent at (${Math.round(p.x)},${Math.round(p.z)}): ${rcA.wl} -> ${rcB.wl}`); wlOK = -1e9; } }
  }
  (tested >= 20 ? ok : bad)(`riverFlow answers along the Esk (${tested} mid/lower-course points)`);
  (unit ? ok : bad)('tangent is unit length at every tested point');
  (bankOK ? ok : bad)('bank stays in (0, 1] at every tested point');
  (sPairs >= 20 && sInc === sPairs
    ? ok : bad)(`chainage s increases along the tangent in EVERY comparable pair (${sInc}/${sPairs})`);
  (wlOK >= 10 ? ok : bad)(`water level non-increasing along the tangent everywhere comparable (${Math.max(0, wlOK)} comparisons)`);
  // mid-channel bank ~1; 10 blocks perpendicular is off-river
  const mid = esk.res[Math.floor(esk.res.length * 0.5)];
  const fm = g.riverFlow(mid.x, mid.z);
  (fm && fm.bank > 0.6 ? ok : bad)(`centreline bank near 1 (got ${fm && fm.bank.toFixed(2)})`);
  (g.riverFlow(mid.x - fm.tz * 10, mid.z + fm.tx * 10) === null ? ok : bad)('10 blocks abeam of the channel -> null (off-river)');
  // determinism of the flow field itself
  const fa = g.riverFlow(mid.x, mid.z), fb = g.riverFlow(mid.x, mid.z);
  (JSON.stringify(fa) === JSON.stringify(fb) ? ok : bad)('riverFlow deterministic — same column, same answer');
}

// --- (c) + (f): moors liquid carries aFlow; two builds byte-identical --------
{
  // find an Esk chunk that actually carves water, frae the profile (no magic numbers)
  const g = new MoorsGeography(MOORS_SEED);
  const esk = g._riverProfile().find(p => p.name === 'River Esk');
  let cx = null, cz = null;
  for (let i = Math.floor(esk.res.length * 0.45); i < esk.res.length; i++) {
    const p = esk.res[i];
    const rc = g.riverColumn(Math.round(p.x), Math.round(p.z));
    if (rc && rc.wl > rc.bed) { cx = Math.floor(p.x / CHUNK); cz = Math.floor(p.z / CHUNK); break; }
  }
  (cx !== null ? ok : bad)(`found a water-bearing Esk chunk (${cx},${cz})`);

  const scene = { add() {}, remove() {} };
  const buildOnce = () => {
    const w = new World(scene, MOORS_SEED);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) w.ensureChunk(cx + dx, cz + dz);
    return buildChunkMeshes(w, w.chunkAt(cx, cz));
  };
  const m1 = buildOnce();
  const lm = m1.find(m => m.material === getMaterials().liquid);
  if (!lm) bad('moors Esk chunk builds a liquid mesh');
  else {
    ok('moors Esk chunk builds a liquid mesh');
    const pos = lm.geometry.getAttribute('position');
    const top = lm.geometry.getAttribute('aTop');
    const flow = lm.geometry.getAttribute('aFlow');
    (flow && flow.itemSize === 3 && flow.count === pos.count ? ok : bad)('aFlow present on moors liquid geometry');
    let nonZero = 0, sane = true, wrapOK = true, topMatch = true;
    for (let i = 0; i < flow.count; i++) {
      const fx = flow.getX(i), fz = flow.getY(i), fs = flow.getZ(i);
      const mag = Math.hypot(fx, fz);
      if (mag > 1e-4) nonZero++;
      if (mag > 1 + 1e-4) sane = false;                      // |tangent·bank| <= 1
      if (fs < 0 || fs >= FLOW_WRAP + 1e-4) wrapOK = false;  // chainage wrapped to [0, 50π)
      const isDropped = Math.abs(pos.getY(i) - Math.round(pos.getY(i))) > 1e-4;
      if ((top.getX(i) === 1) !== isDropped) topMatch = false;
    }
    (nonZero > 0 ? ok : bad)(`beck verts carry real flow (${nonZero}/${flow.count} non-zero)`);
    (sane ? ok : bad)('flow magnitude (tangent x bank) never exceeds 1');
    (wrapOK ? ok : bad)('chainage phase baked wrapped to [0, 50pi) — float32-safe on the long Esk');
    (topMatch ? ok : bad)('moors liquid: aTop rule holds on real river geometry too');

    // (f) determinism: a second, fully independent world builds byte-identical buffers
    const m2 = buildOnce();
    const lm2 = m2.find(m => m.material === getMaterials().liquid);
    const same = (name) => {
      const a = lm.geometry.getAttribute(name), b = lm2.geometry.getAttribute(name);
      if (!a || !b || a.array.length !== b.array.length) return false;
      return Buffer.from(a.array.buffer, a.array.byteOffset, a.array.byteLength)
        .equals(Buffer.from(b.array.buffer, b.array.byteOffset, b.array.byteLength));
    };
    (['position', 'aTop', 'aFlow', 'aFreeze', 'color', 'uv'].every(same)
      ? ok : bad)('two independent builds of the same chunk are byte-identical (position/aTop/aFlow/aFreeze/color/uv)');
  }
}

// --- (c) stylised world: geo has no riverFlow at all -------------------------
{
  const gen = new Gen(strSeed('owt-stylised'));
  (typeof gen.geo.riverFlow === 'undefined' ? ok : bad)('stylised Geography has NO riverFlow — the mesher guard zero-fills');
  // and its real sea liquid meshes wi' all-zero flow
  const scene = { add() {}, remove() {} };
  const w = new World(scene, strSeed('owt-stylised'));
  const seaX = Math.round(w.gen.geo.coastX(8)) + 120; // well out to sea
  const cx = Math.floor(seaX / CHUNK), cz = 0;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) w.ensureChunk(cx + dx, cz + dz);
  const meshes = buildChunkMeshes(w, w.chunkAt(cx, cz));
  const lm = meshes.find(m => m.material === getMaterials().liquid);
  if (!lm) bad('stylised sea chunk builds a liquid mesh');
  else {
    ok('stylised sea chunk builds a liquid mesh');
    const flow = lm.geometry.getAttribute('aFlow');
    let allZero = true;
    for (let i = 0; i < flow.array.length; i++) if (flow.array[i] !== 0) allZero = false;
    (allZero ? ok : bad)('stylised liquid aFlow is all zeros — behaviour collapses to [15]');
  }
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
