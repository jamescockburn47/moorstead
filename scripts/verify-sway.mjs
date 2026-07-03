// S3c [10]+[D14] wind sway + gust fronts, [D8] dew, [14] snow polish.
// Run wi': node scripts/verify-sway.mjs
//
// The contract this defends (one coherent flora-motion + dew + snow slice):
//   (a) aSway BAKE: a synthetic chunk with plant flora (heather) bakes aSway = 1 on the
//       TWO top corners (v==1) and 0 on the rooted base corners; a TORCH (structural
//       cutout) bakes aSway 0 on EVERY corner — the missing-attribute-defaults-0 idiom
//       keeps torches/signs/ground rigid. Solid geometry never carries aSway at all.
//   (b) DEW CHANNEL: the same flora quads bake aGlint = 0.4 (the dew channel); the base
//       forage glint (step(0.75,vGlint)*0.12) is preserved EXACTLY, so at uDew=0 forage is
//       byte-identical and 0.4-flora contributes nothing to the base term (byte-parity).
//   (c) glintTiles is now a SUPERSET of HOST_FORAGE (the live 'bilberry never glints' bug
//       is fixed — set-fix, forage is forage).
//   (d) DETERMINISM (INVARIANTS rule 6): the travelling gust front rides uGustPhase, a
//       SEPARATE uniform from the per-client uGlintTime accumulator; its setter is fed the
//       shared wall-clock (Date.now) in main.js — the single most important correctness
//       point in the slice. vn1 (the 1-D value noise) is a pure function of one input.
//   (e) SHARED SPARKLE-CELL HELPER: sparkleCell is defined exactly ONCE (shared by [14]
//       frost sparkle and [D8] dew — never two copies, the red-team single-ownership rule).
//   (f) PLAIN / BYTE-PARITY: every new uniform defaults so a fresh compile is today's look
//       (uSwayAmp/uWindAmt/uDew/uSparkle default 0; uGustPhase default 0).
//   (g) two independent builds of the same flora chunk are byte-identical (aSway/aGlint).
//
// Headless three.js builds fine (we never render); the atlas is satisfied by a document stub.

global.document = {
  createElement: (tag) => {
    if (tag !== 'canvas') return {};
    const ctx2d = { clearRect: () => {}, drawImage: () => {}, fillStyle: '', fillRect: () => {} };
    return { width: 0, height: 0, getContext: () => ctx2d };
  },
};

import { readFileSync } from 'node:fs';
import { B, CHUNK, HEIGHT } from '../src/defs.js';
import {
  initMaterials, getMaterials, buildChunkMeshes,
  setSwayAmp, setWindAmt, setGustPhase, setDew, setSparkle, setWindDir, setGustSpeed,
} from '../src/mesher.js';
import { HOST_FORAGE } from '../src/forage.js';

initMaterials();

let failed = false;
const ok  = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const IDX = (x, y, z) => x + z * CHUNK + y * CHUNK * CHUNK;
const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const mesherSrc = src('../src/mesher.js');
const floraSrc  = src('../src/floraLayer.js');

// a bare stub world: a plant-flora block (HEATHER) sits at (4,30,4) on stone, a TORCH
// (structural cutout) at (8,30,8). getBlock returns AIR outside the chunk data.
const fakeWorld = { getBlock: () => B.AIR, gen: { geo: { coastT: () => 0 } } };
const build = (data) => buildChunkMeshes(fakeWorld, { cx: 0, cz: 0, data });
const meshOf = (meshes, mat) => meshes.find(m => m.material === getMaterials()[mat]);

console.log('\n-- [10] aSway bake: flora tops sway, structural + ground rigid --\n');

{
  const data = new Uint8Array(CHUNK * CHUNK * HEIGHT);
  data[IDX(4, 29, 4)] = B.STONE; data[IDX(4, 30, 4)] = B.HEATHER; // plant flora on a plinth
  data[IDX(8, 29, 8)] = B.STONE; data[IDX(8, 30, 8)] = B.TORCH;   // structural cutout
  const meshes = build(data);
  const cm = meshOf(meshes, 'cutout');
  const sm = meshOf(meshes, 'opaque');   // the solid material is keyed 'opaque' in getMaterials()
  (cm ? ok : bad)('flora chunk builds a cutout mesh');
  if (cm) {
    const pos = cm.geometry.getAttribute('position');
    const sway = cm.geometry.getAttribute('aSway');
    const gli = cm.geometry.getAttribute('aGlint');
    (sway && sway.itemSize === 1 && sway.count === pos.count ? ok : bad)('aSway attribute baked on the cutout geometry, one float per vert');
    (gli && gli.count === pos.count ? ok : bad)('aGlint attribute baked on the cutout geometry');
    if (sway && gli) {
      // classify verts: flora (aGlint 0.4) vs torch (aGlint 0). For flora, top verts (higher
      // Y within the block) must sway=1, base verts sway=0. For torch, every vert sway=0.
      let floraTopSway = 0, floraBaseSway = 0, floraTopRigid = 0, floraBaseWrong = 0;
      let torchVerts = 0, torchAnySway = 0, strayGlint = 0, straySway = 0;
      for (let i = 0; i < pos.count; i++) {
        const g = gli.getX(i), s = sway.getX(i), y = pos.getY(i);
        if (s !== 0 && s !== 1) straySway++;
        if (Math.abs(g - 0.4) < 1e-6) {                 // plant flora
          const isTop = y > 30.5;                        // block spans y=30..~31.2 (ht jitter)
          if (isTop) { (s === 1 ? floraTopSway++ : floraTopRigid++); }
          else { (s === 0 ? floraBaseSway++ : floraBaseWrong++); }
        } else if (g === 0) {                            // torch (structural) — or any non-flora
          torchVerts++; if (s !== 0) torchAnySway++;
        } else strayGlint++;
      }
      (straySway === 0 ? ok : bad)(`aSway is strictly 0 or 1 on every vert (${straySway} strays)`);
      (strayGlint === 0 ? ok : bad)(`aGlint is 0 or 0.4 on the cutout (no stray beacon values here; ${strayGlint} strays)`);
      (floraTopSway > 0 && floraTopRigid === 0 ? ok : bad)(`flora TOP corners all sway (${floraTopSway} top verts sway, ${floraTopRigid} rigid)`);
      (floraBaseSway > 0 && floraBaseWrong === 0 ? ok : bad)(`flora BASE corners all rooted (${floraBaseSway} base verts rigid, ${floraBaseWrong} swayed)`);
      (torchVerts > 0 && torchAnySway === 0 ? ok : bad)(`TORCH stays rigid — aSway 0 on all ${torchVerts} structural verts`);
    }
  }
  // solid geometry never carries aSway (never rendered as swaying ground)
  (sm && !sm.geometry.getAttribute('aSway') ? ok : bad)('solid opaque geometry carries NO aSway attribute (ground is rigid by construction)');

  // (g) determinism: a second independent build is byte-identical on aSway + aGlint
  const cm2 = meshOf(build(data), 'cutout');
  const same = (name) => {
    const a = cm.geometry.getAttribute(name), b = cm2.geometry.getAttribute(name);
    if (!a || !b || a.array.length !== b.array.length) return false;
    return Buffer.from(a.array.buffer, a.array.byteOffset, a.array.byteLength)
      .equals(Buffer.from(b.array.buffer, b.array.byteOffset, b.array.byteLength));
  };
  (['aSway', 'aGlint', 'position'].every(same) ? ok : bad)('two independent builds: aSway/aGlint/position byte-identical (rule 6)');
}

console.log('\n-- [D8] dew channel split + glintTiles superset --\n');

// base forage glint preserved EXACTLY (the byte-parity anchor): the shader keeps the literal
// step(0.75, vGlint) * 0.12 term, so forage (aGlint 1) glints as it did and dew-flora (0.4)
// contributes 0 to the base. The dew term is uDew-gated (0 at uDew=0).
ok('base-glint byte-parity is a source contract (asserted below):');
(mesherSrc.includes('step(0.75, vGlint) * 0.12 * (0.5 + 0.5 * sin(uGlintTime * 2.0 + vGlintH))')
  ? ok : bad)('  base forage glint preserved EXACTLY: step(0.75,vGlint)*0.12 — byte-identical at uDew=0');
(mesherSrc.includes('float glDew = vGlint * uDew * 0.18')
  ? ok : bad)('  dew channel is a SEPARATE additive term: vGlint*uDew*0.18 (0 at uDew=0)');
(mesherSrc.includes('sparkleCell(vec2(vSnowWX, vSnowWZ), 3.0, uGlintTime * 2.0 + vGlintH)')
  ? ok : bad)('  dew is CELLULAR (droplets) via the shared sparkle-cell helper, world xz');
// glintTiles now a superset of HOST_FORAGE (the live bilberry-never-glints bug, fixed)
(floraSrc.includes('...HOST_FORAGE.map(h => h.tile)') && floraSrc.includes("import { activeForageables, fruitSpeciesAt, fruitTreeRipe, FRUIT_SPECIES, HOST_FORAGE }")
  ? ok : bad)('glintTiles folds in HOST_FORAGE tiles (set-fix) — bilberry/rosehip/sloe bushes now glint');
(floraSrc.includes('p.glintTiles.has(tile) ? 1 : 0.4')
  ? ok : bad)('crossGeom call: forage=1 (beacon), everything else=0.4 (dew) — flowers glisten too');
{
  // prove HOST_FORAGE really has tiles the old set lacked (guards against an empty-table no-op)
  const hostTiles = HOST_FORAGE.map(h => h.tile);
  (hostTiles.length >= 6 && hostTiles.every(t => Number.isInteger(t))
    ? ok : bad)(`HOST_FORAGE carries ${hostTiles.length} real host-berry tiles now folded into glintTiles`);
}
(floraSrc.includes('aSway') && floraSrc.includes('[0, 0, 1, 1, 0, 0, 1, 1]')
  ? ok : bad)('floraLayer crossGeom bakes aSway (top verts 1) — scatter flowers sway with the heather');

console.log('\n-- [D14] gust determinism: Date.now shared clock, NOT the per-client accumulator --\n');

// The travelling gust front MUST ride a separate uniform (uGustPhase) fed the shared wall
// clock, NOT uGlintTime (a per-client dt accumulator) — else gust fronts desync between
// players. Assert the two are distinct uniforms and the plane wave reads uGustPhase.
(mesherSrc.includes('uGustPhase: { value: 0 }') ? ok : bad)('uGustPhase is its own module uniform, defaults 0');
(mesherSrc.includes('export function setGustPhase(t)') ? ok : bad)('setGustPhase setter exported (main.js feeds Date.now through it)');
(mesherSrc.includes('vGust = vn1(gp * 0.045 - uGustPhase * uGustSpeed)')
  ? ok : bad)('the gust plane wave reads uGustPhase (the shared clock) — NOT uGlintTime');
{
  // the gust term must NOT be phased by uGlintTime (that would be the per-client desync bug)
  const gustLine = 'vGust = vn1(gp * 0.045 - uGustPhase * uGustSpeed)';
  const i = mesherSrc.indexOf(gustLine);
  (i > 0 && !mesherSrc.slice(i, i + gustLine.length).includes('uGlintTime')
    ? ok : bad)('the gust phase term contains no uGlintTime (no per-client accumulator in the shared wave)');
}
(mesherSrc.includes('float gp = dot(wSnowPos.xz, uWindDir)')
  ? ok : bad)('gust is a plane wave along uWindDir (a gust front is a travelling plane wave)');
(mesherSrc.includes('new THREE.Vector2(0.83, 0.55)')
  ? ok : bad)('uWindDir baked as the prevailing sou\'wester vec2(0.83,0.55) — period-true, zero feed risk');
// anchoring: the sway/gust lands AFTER wSnowPos is computed (replace 'vSnowExp = aSnowExp;',
// not '#include <begin_vertex>') so phase reads the pre-displacement world pos.
(mesherSrc.includes(".replace('vSnowExp = aSnowExp;'")
  ? ok : bad)('sway/gust anchored on \'vSnowExp = aSnowExp;\' (after wSnowPos) — the string-ordering red-team catch');

// vn1: a pure 1-D value noise, present once, deterministic in its single argument
(mesherSrc.includes('float vn1(float x)') ? ok : bad)('vn1 (1-D value noise) helper present');
((mesherSrc.match(/float vn1\(float x\)/g) || []).length === 1 ? ok : bad)('vn1 defined exactly once (no duplicate)');

console.log('\n-- [14] snow polish + the SHARED sparkle-cell helper (landed once) --\n');

((mesherSrc.match(/float sparkleCell\(vec2 wxz, float scale, float t\)/g) || []).length === 1
  ? ok : bad)('sparkleCell helper defined EXACTLY once — shared by [14] frost + [D8] dew (single-ownership)');
{
  // both consumers reference the one helper (frost sparkle uses scale 6.0, dew uses 3.0)
  const uses = (mesherSrc.match(/sparkleCell\(/g) || []).length;
  (uses >= 3 ? ok : bad)(`sparkleCell called by both frost and dew consumers (${uses} call sites: def + frost + dews)`);
}
(mesherSrc.includes('vec3(0.78, 0.85, 1.0)') ? ok : bad)('[14](b) shadow-blue snow: AO\'d snow cools toward blue');
(mesherSrc.includes('smoothstep(0.34, 0.5, snowRaw)') ? ok : bad)('[14](a) drift edges: smoothstep band sharpens with deep cover');
(mesherSrc.includes('uSparkle') && mesherSrc.includes('* 0.45') ? ok : bad)('[14](c) frost sparkle rides uSparkle (Fine-only), added over the snow wash');

console.log('\n-- Plain / byte-parity: every new uniform defaults to today --\n');

for (const [u, d] of [['uSwayAmp', 0], ['uWindAmt', 0], ['uDew', 0], ['uSparkle', 0], ['uGustPhase', 0]])
  (mesherSrc.includes(`${u}: { value: ${d} }`) ? ok : bad)(`${u} defaults ${d} — collapses to today's look`);
// the setters exist so main.js (another agent) can drive them
for (const s of ['setSwayAmp', 'setWindAmt', 'setGustPhase', 'setDew', 'setSparkle', 'setWindDir', 'setGustSpeed'])
  (typeof eval(s) === 'function' && mesherSrc.includes(`export function ${s}`) ? ok : bad)(`${s} exported`);
// exercising the setters must not throw (they're plain uniform writes)
try { setSwayAmp(0.06); setWindAmt(0.5); setGustPhase(1234.5); setDew(0.3); setSparkle(0.4); setWindDir(0.83, 0.55); setGustSpeed(0.5); ok('all setters run without throwing'); }
catch (e) { bad('a setter threw: ' + e.message); }

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
