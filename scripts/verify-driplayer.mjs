// Eave-drip check — run wi': node scripts/verify-driplayer.mjs
//
// [D9] drips frae the eaves (src/dripLayer.js): after a shower passes, cottage
// eaves keep dripping for a few minutes — one capped THREE.Points for the whole
// window, motion entirely GPU-side (onBeforeCompile on the PointsMaterial), the
// draw call fading in/out off the wet-ground drive.
//
// The contract this defends:
//   (a) DETERMINISM: two builds against the same synthetic world/seed produce
//       IDENTICAL position / aSeed / aFallH typed arrays AND identical drawRange
//       count (no Math.random; hash2i off world seed + building footprint).
//   (b) CAP: drawRange.count <= cap — 600 Fine, 300 Plain — and a world with more
//       emitters than the cap forces the `break outer` path yet still respects it.
//   (c) uTime CONTRACT: the material carries a uniform named uTime (NOT uDripT —
//       the red-team fix, so registerFxMat/tickFires can drive it); construct
//       raises fxMatCount() by 1, dispose() returns it to baseline; tickFires(t)
//       writes material.uniforms.uTime.value === t.
//   (d) DRIVE -> VISIBILITY: dry -> material.visible false; wet + no rain ->
//       visible; wet + heavy rain -> false (still pelting); wet + frozen -> false
//       (an eave grows an icicle, not a drip).
//   (e) ROOFLESS -> NO EMITTERS: a building with roof:null (a fold/fence) drips
//       nowt — the layer gates emitters on b.roof.
//   (f) HEADLESS-SAFE IMPORT: importing the module touches no document/GL at
//       module scope (the droplet CanvasTexture is a lazy singleton, guarded on
//       `typeof document === 'undefined'`), so it imports clean under Node.
//
// Headless Node only. We deliberately DO NOT stub document: dropletTexture()
// returns null when document is absent (PointsMaterial({map:null}) is fine), which
// is exactly the property (f) asserts — the layer must construct with no DOM.

import * as THREE from 'three';
import { DripLayer } from '../src/dripLayer.js';
import { fxMatCount, tickFires } from '../src/fire.js';

let failed = false;
const ok  = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// Real caps mirrored from dripLayer.js:27,142 (Plain halves POINT_CAP).
const CAP_FINE = 600;
const CAP_PLAIN = 300;

// (f) is proven simply by this module having imported without a document stub in
// scope — if dripLayer touched document at module load, the import above would
// have thrown. Assert it explicitly for the record.
(typeof document === 'undefined'
  ? ok : bad)('module imported with NO document in scope (headless-safe: no DOM/GL at import)');

// --- synthetic world: the surface DripLayer.build() reads ---------------------
// gen.height(); gen.geo.{seed, villages, _townBuildings}. Buildings carry the real
// record shape (x0/z0/x1/z1/g/type/wallH/roof) — roof gates emitter siting.
function makeWorld(seed, buildings) {
  const geo = {
    seed,
    villages: [{ x: 0, z: 0, radius: 60, buildings: null }],
    _townBuildings(v) { if (v._bld) return v._bld; v._bld = buildings; return buildings; },
  };
  return { gen: { geo, height: () => 32 } };
}
function cottage(bx, bz, roof = 'pantile') {
  return { x0: bx, z0: bz, x1: bx + 3, z1: bz + 3, g: 32, type: 'cottage', wallH: 4, roof, wall: 'cobble', biz: false };
}
// N roofed cottages, 6 apart, all inside RADIUS(48).
function roofedRow(n, roof = 'pantile') {
  const out = [];
  for (let i = 0; i < n && out.length < n; i++) out.push(cottage(-40 + i * 6, 0, roof));
  return out;
}

const arr = a => Array.from(a);
const drawCount = l => l.geometry.drawRange.count;

console.log('\n-- eave drips: determinism + cap + uTime naming + drive visibility + roofless --\n');

// --- (a) determinism: identical typed arrays + drawRange across two builds -----
{
  const blds = roofedRow(8);
  const a = new DripLayer(new THREE.Scene(), makeWorld(0xD11B, blds.map(b => ({ ...b }))));
  const b = new DripLayer(new THREE.Scene(), makeWorld(0xD11B, blds.map(b => ({ ...b }))));
  a.update(1, { x: 0, z: 0 }, { groundWet: 1, rainAmount: 0, frozen: false });
  b.update(1, { x: 0, z: 0 }, { groundWet: 1, rainAmount: 0, frozen: false });
  const na = drawCount(a), nb = drawCount(b);
  (na > 0 && na === nb ? ok : bad)(`two builds, same seed -> identical drawRange count (${na} === ${nb})`);
  const posEq  = JSON.stringify(arr(a.geometry.attributes.position.array)) === JSON.stringify(arr(b.geometry.attributes.position.array));
  const seedEq = JSON.stringify(arr(a.geometry.attributes.aSeed.array))    === JSON.stringify(arr(b.geometry.attributes.aSeed.array));
  const fallEq = JSON.stringify(arr(a.geometry.attributes.aFallH.array))   === JSON.stringify(arr(b.geometry.attributes.aFallH.array));
  (posEq ? ok : bad)('position typed arrays are byte-identical across builds');
  (seedEq ? ok : bad)('aSeed typed arrays are byte-identical across builds');
  (fallEq ? ok : bad)('aFallH typed arrays are byte-identical across builds');
  a.dispose(); b.dispose();
}

// --- (b) cap: Fine (600) + Plain (300), and the over-cap break path ------------
{
  // A handful of buildings can't overflow the cap; to force `break outer` we need
  // more emitters than the cap. Each building yields MIN_EMIT..MAX_EMIT (2..6)
  // emitters, so >300 buildings guarantees >600 emitters. Pack them tight but all
  // in-range (within RADIUS 48 of origin): a dense grid of 1x1-ish roofed boxes.
  const many = [];
  for (let gx = -44; gx <= 44 && many.length < 400; gx += 4)
    for (let gz = -44; gz <= 44 && many.length < 400; gz += 4)
      many.push(cottage(gx, gz));

  const lf = new DripLayer(new THREE.Scene(), makeWorld(0xCAFE, many.map(b => ({ ...b }))));
  lf.update(1, { x: 0, z: 0 }, { groundWet: 1, rainAmount: 0, frozen: false });
  (drawCount(lf) <= CAP_FINE ? ok : bad)(`Fine drawRange <= ${CAP_FINE} even over-subscribed (got ${drawCount(lf)})`);
  (drawCount(lf) === CAP_FINE ? ok : bad)(`over-cap world saturates the Fine cap exactly (break path hit: ${drawCount(lf)} === ${CAP_FINE})`);
  (lf.geometry.attributes.position.array.length === CAP_FINE * 3
    ? ok : bad)('Fine geometry is allocated at exactly the cap (no growth)');
  lf.dispose();

  const lp = new DripLayer(new THREE.Scene(), makeWorld(0xCAFE, many.map(b => ({ ...b }))), { plain: true });
  lp.update(1, { x: 0, z: 0 }, { groundWet: 1, rainAmount: 0, frozen: false });
  (drawCount(lp) <= CAP_PLAIN ? ok : bad)(`Plain drawRange <= ${CAP_PLAIN} even over-subscribed (got ${drawCount(lp)})`);
  (drawCount(lp) === CAP_PLAIN ? ok : bad)(`over-cap world saturates the Plain cap exactly (${drawCount(lp)} === ${CAP_PLAIN})`);
  (lp.cap === CAP_PLAIN ? ok : bad)(`opts.plain halves the cap (${lp.cap} === ${CAP_PLAIN})`);
  lp.dispose();
}

// --- (c) uTime naming + fx registry balance + tickFires drives it --------------
{
  const base = fxMatCount();
  const l = new DripLayer(new THREE.Scene(), makeWorld(0x7EA, roofedRow(4)));
  // the uniform MUST be named uTime (NOT uDripT) — registerFxMat only ever drives uTime
  (l.material.uniforms && l.material.uniforms.uTime && !l.material.uniforms.uDripT
    ? ok : bad)('material carries uniforms.uTime (and NOT uDripT — the red-team naming fix)');
  (fxMatCount() === base + 1
    ? ok : bad)(`construct registered exactly one fx material (${base} -> ${fxMatCount()})`);
  // tickFires writes uTime.value on every registered material — including this one
  tickFires(42.5);
  (l.material.uniforms.uTime.value === 42.5
    ? ok : bad)(`tickFires(t) writes material.uniforms.uTime.value === t (got ${l.material.uniforms.uTime.value})`);
  l.dispose();
  (fxMatCount() === base
    ? ok : bad)(`dispose() unregistered the material — fxMatCount back to baseline (${fxMatCount()} === ${base})`);
}

// --- (d) drive -> visibility: dry/rain/frozen all suppress; wet+no-rain shows --
{
  const l = new DripLayer(new THREE.Scene(), makeWorld(0xDECA, roofedRow(6)));
  // the fade is a smoothed ease (this._amt), so settle each state with a few dts.
  const settle = (drive) => { for (let i = 0; i < 40; i++) l.update(0.1, { x: 0, z: 0 }, drive); };

  settle({ groundWet: 0, rainAmount: 0, frozen: false });
  (l.material.visible === false ? ok : bad)('dry ground -> drips settle invisible');

  settle({ groundWet: 1, rainAmount: 0, frozen: false });
  (l.material.visible === true ? ok : bad)('wet ground, rain stopped -> drips become visible');

  settle({ groundWet: 1, rainAmount: 1, frozen: false });
  (l.material.visible === false ? ok : bad)('wet ground but still pelting hard -> drips suppressed');

  settle({ groundWet: 1, rainAmount: 0, frozen: true });
  (l.material.visible === false ? ok : bad)('wet ground but frozen -> no drip (icicle, not a drop)');
  l.dispose();
}

// --- (e) roofless buildings contribute no emitters ----------------------------
{
  // A roofed cottage next to a roofless fold (roof:null): only the roofed one drips.
  const roofed = new DripLayer(new THREE.Scene(), makeWorld(0xF01D, [cottage(-10, 0, 'pantile')]));
  roofed.update(1, { x: 0, z: 0 }, { groundWet: 1, rainAmount: 0, frozen: false });
  const roofedN = drawCount(roofed);
  (roofedN > 0 ? ok : bad)(`a roofed cottage drips (${roofedN} emitters)`);
  roofed.dispose();

  const roofless = new DripLayer(new THREE.Scene(), makeWorld(0xF01D, [cottage(-10, 0, null)]));
  roofless.update(1, { x: 0, z: 0 }, { groundWet: 1, rainAmount: 0, frozen: false });
  (drawCount(roofless) === 0
    ? ok : bad)(`a roofless building (roof:null) contributes no emitters (got ${drawCount(roofless)})`);
  roofless.dispose();

  // mixed: identical footprints, one roofed one not -> exactly the roofed one's count
  const mixed = new DripLayer(new THREE.Scene(), makeWorld(0xF01D, [cottage(-10, 0, 'pantile'), cottage(10, 0, null)]));
  mixed.update(1, { x: 0, z: 0 }, { groundWet: 1, rainAmount: 0, frozen: false });
  (drawCount(mixed) === roofedN
    ? ok : bad)(`in a mixed village only the roofed building drips (${drawCount(mixed)} === ${roofedN})`);
  mixed.dispose();
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
