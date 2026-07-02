// verify-festivalwow.mjs — the festival SPECTACLE layer ('Fine' renderer wow).
// Run wi': node scripts/verify-festivalwow.mjs
//
// Covers, headlessly (no GL — scene-graph + pure maths only):
//   1. pure particle maths (rocket arc, spark ballistics + fade, sag, ribbons,
//      night gate) — the JS mirrors of the GLSL in festivalKit.js
//   2. each festival builder produces its new 'Fine' props wi' sane pooled counts
//   3. the Plain path is UNCHANGED (fine:false → zero wow props, zero fx, zero
//      fx-registry entries)
//   4. teardown through the REAL SeasonalLayer.clear() leaves zero orphans in
//      the fire-tick fx registry
//
// Harness cribbed from verify-festival-render.mjs (document stub + mock world).

// --- stub document BEFORE any import that may trigger initMaterials ----------
global.document = {
  createElement: (tag) => {
    if (tag !== 'canvas') return {};
    const ctx2d = {
      clearRect: () => {},
      fillRect:  () => {},
      drawImage: () => {},
      fillStyle: '',
    };
    return { width: 0, height: 0, getContext: () => ctx2d };
  },
};

// --- imports (after stub) ----------------------------------------------------
import * as THREE from 'three';
import { initMaterials } from '../src/mesher.js';
import { B }             from '../src/defs.js';
import { seasonStateAtPhase } from '../src/season.js';
import { fxMatCount, Fire }   from '../src/fire.js';
import {
  rocketHeight, sparkOffset, sparkFade, sagY, ribbonPoint, nightFromSkyTime,
  makeFireworks, makeDriftMotes, makeLanternString, makeBunting, makeRibbonStreamers,
  FIREWORK_SPARKS, FIREWORK_STREAK, LANTERNS_MAX, BUNTING_FLAGS_MAX,
  RIBBON_STREAMERS, SPARK_LIVE,
} from '../src/festivalKit.js';
import { SeasonalLayer }   from '../src/seasonalLayer.js';

import { buildChristmas } from '../src/festivals/christmas.js';
import { buildBonfire }   from '../src/festivals/bonfire.js';
import { buildHarvest }   from '../src/festivals/harvest.js';
import { buildEaster }    from '../src/festivals/easter.js';
import { buildMayDay }    from '../src/festivals/mayday.js';
import { buildMidsummer } from '../src/festivals/midsummer.js';

initMaterials();

let failed = false;
const ok  = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// =============================== 1. pure maths ===============================
console.log('\n-- pooled particle maths (pure) --\n');

// rocket arc: grounded at t=0, apex at t=1, monotonic climb, eased (decelerating)
{
  const APEX = 12;
  (rocketHeight(0, APEX) === 0 ? ok : bad)('rocketHeight(0) is 0 (on the pale)');
  (Math.abs(rocketHeight(1, APEX) - APEX) < 1e-9 ? ok : bad)('rocketHeight(1) reaches the apex');
  let mono = true;
  for (let i = 1; i <= 20; i++) if (rocketHeight(i / 20, APEX) < rocketHeight((i - 1) / 20, APEX)) mono = false;
  (mono ? ok : bad)('rocket climb is monotonic');
  const early = rocketHeight(0.25, APEX), late = rocketHeight(1, APEX) - rocketHeight(0.75, APEX);
  (early > late ? ok : bad)('rocket climb is eased (fast off the pale, slow at the burst)');
  (rocketHeight(1.7, APEX) === APEX ? ok : bad)('rocketHeight clamps past t=1');
}

// spark ballistics: origin at burst, linear horizontal spread, gravity bends y
{
  let allOrigin = true, allLinear = true, allGravity = true;
  for (let s = 0; s < 12; s++) {
    const seed = (s + 0.5) / 12;
    const o0 = sparkOffset(seed, 0);
    if (Math.hypot(o0.x, o0.y, o0.z) > 1e-9) allOrigin = false;
    const oH = sparkOffset(seed, 0.5), oF = sparkOffset(seed, 1);
    // horizontal drift is linear in time: full-life radius = 2 × half-life radius
    const rH = Math.hypot(oH.x, oH.z), rF = Math.hypot(oF.x, oF.z);
    if (Math.abs(rF - 2 * rH) > 1e-6) allLinear = false;
    // gravity: y at full life falls short of the linear extrapolation of y at half life
    if (!(oF.y < 2 * oH.y - 1e-9)) allGravity = false;
  }
  (allOrigin ? ok : bad)('sparks start exactly at the burst point');
  (allLinear ? ok : bad)('spark horizontal spread is linear (ballistic, no drag)');
  (allGravity ? ok : bad)('gravity bends every spark arc downward');
  // an upward spark must come back down within ~2 lives (sanity of G vs speed)
  const up = sparkOffset(0.99, 1, SPARK_LIVE * 2); // stretch life ×2
  (up.y < sparkOffset(0.99, 0.4, SPARK_LIVE * 2).y ? ok : bad)('a rising spark falls back over a stretched life');
}

// spark fade: dark at both ends of life, lit in the middle, bounded 0..1
{
  (sparkFade(0) === 0 && sparkFade(1) === 0 ? ok : bad)('sparkFade is 0 at burst instant and at end of life');
  (sparkFade(-0.2) === 0 && sparkFade(1.3) === 0 ? ok : bad)('sparkFade is 0 outside the life window (recycled sparks never pop)');
  (sparkFade(0.3) > 0.9 ? ok : bad)('sparkFade holds bright through the middle of life');
  let bounded = true, dying = true;
  for (let i = 0; i <= 40; i++) {
    const f = sparkFade(i / 40);
    if (f < 0 || f > 1) bounded = false;
  }
  for (let i = 26; i <= 40; i++) if (sparkFade(i / 40) > sparkFade((i - 1) / 40) + 1e-9) dying = false;
  (bounded ? ok : bad)('sparkFade stays within [0,1]');
  (dying ? ok : bad)('sparkFade decays monotonically over the last stretch of life');
}

// sag (lantern strings + bunting): tied at both ends, deepest mid-span
{
  (sagY(0, 1) === 0 && sagY(1, 1) === 0 ? ok : bad)('sag is 0 at both tied ends');
  (Math.abs(sagY(0.5, 0.8) + 0.8) < 1e-9 ? ok : bad)('sag bottoms out at -sag mid-span');
  (Math.abs(sagY(0.25, 1) - sagY(0.75, 1)) < 1e-9 ? ok : bad)('sag is symmetric');
}

// maypole ribbons: root at the pole top, tips swing low + wide, and they MOVE
{
  const root = ribbonPoint(0, 6, 0, 0), tip = ribbonPoint(0, 6, 1, 0);
  (root.y > tip.y ? ok : bad)('ribbon descends from pole top to tip');
  (Math.hypot(tip.x, tip.z) > Math.hypot(root.x, root.z) ? ok : bad)('ribbon swings wider toward the tip');
  const tipLater = ribbonPoint(0, 6, 1, 2.0);
  (Math.hypot(tipLater.x - tip.x, tipLater.z - tip.z) > 0.1 ? ok : bad)('ribbon tip streams over time (animated)');
  const other = ribbonPoint(3, 6, 1, 0);
  (Math.hypot(other.x - tip.x, other.z - tip.z) > 0.5 ? ok : bad)('ribbons are spread round the pole');
}

// night gate: fireworks are a night show
{
  (nightFromSkyTime(0.5) === 0 ? ok : bad)('night factor is 0 at noon');
  (nightFromSkyTime(0.0) === 1 ? ok : bad)('night factor is 1 at midnight');
  const dusk = nightFromSkyTime(0.78);
  (dusk > 0 && dusk < 1 ? ok : bad)('night factor ramps through dusk (0 < dusk < 1)');
}

// ============================ 2. FX object contracts =========================
console.log('\n-- pooled FX objects --\n');

const registryBaseline = fxMatCount();

{
  const fw = makeFireworks({ seed: 0.37 });
  (fw.isPoints ? ok : bad)('fireworks is a THREE.Points (one pooled draw)');
  (FIREWORK_SPARKS >= 60 && FIREWORK_SPARKS <= 150 ? ok : bad)(`burst pool is ${FIREWORK_SPARKS} sparks (spec 60-150)`);
  (fw.geometry.getAttribute('aSeed').count === FIREWORK_SPARKS + FIREWORK_STREAK ? ok : bad)('geometry allocates exactly sparks + streak points');
  const u = fw.material.uniforms;
  (u.uTime && u.uNight && u.uPeriod && u.uApex ? ok : bad)('fireworks material carries uTime/uNight/uPeriod/uApex');
  (u.uPeriod.value >= 4 && u.uPeriod.value <= 8 ? ok : bad)(`rocket cadence ${u.uPeriod.value.toFixed(2)}s is within 4-8s`);
  (u.uNight.value === 0 ? ok : bad)('fireworks start gated dark (uNight=0) until the sky feeds it');
  (fw.material.blending === THREE.AdditiveBlending && fw.material.depthWrite === false ? ok : bad)('fireworks blend additively, no depth write');
  (fxMatCount() === registryBaseline + 1 ? ok : bad)('fireworks registers ONE material with the fire tick');
  fw.dispose();
  (fxMatCount() === registryBaseline ? ok : bad)('fireworks dispose() unregisters it');
}

{
  const motes = makeDriftMotes({ count: 500, color: 0xffd27a });
  (motes.userData.moteCount <= 90 ? ok : bad)(`mote pool hard-caps at 90 (asked 500, got ${motes.userData.moteCount})`);
  (motes.material.uniforms.uGate.value === 0 ? ok : bad)('motes start gated dark until fed');
  motes.dispose();
  (fxMatCount() === registryBaseline ? ok : bad)('motes dispose() unregisters');
}

{
  const str = makeLanternString({ x: 0, y: 5, z: 0 }, { x: 12, y: 5, z: 2 });
  (str.userData.lanternCount >= 3 && str.userData.lanternCount <= LANTERNS_MAX ? ok : bad)(`lantern string carries ${str.userData.lanternCount} lanterns (3-${LANTERNS_MAX})`);
  let lampMat = null;
  str.traverse(c => { if (c.isMesh && c.material && c.material.emissive) lampMat = c.material; });
  (lampMat && lampMat.emissiveIntensity > 1 ? ok : bad)('lanterns are emissive above 1.0 (bloom catches them under Fine)');
  (typeof str.swayTick === 'function' ? ok : bad)('lantern string exposes swayTick(t)');
  // sway must move lanterns but stay gentle (< 0.1 blocks)
  const lamp = str.children.find(c => c.isMesh);
  const bx = lamp.position.x;
  str.swayTick(1.3);
  (lamp.position.x !== bx && Math.abs(lamp.position.x - lamp.userData.baseX) < 0.1 ? ok : bad)('sway moves lanterns gently (< 0.1 blocks)');
}

{
  const bunt = makeBunting({ x: 0, y: 4, z: 0 }, { x: 10, y: 4, z: 0 }, [0xcc2222, 0xeeeedd, 0x2255bb]);
  (bunt.userData.flagCount >= 4 && bunt.userData.flagCount <= BUNTING_FLAGS_MAX ? ok : bad)(`bunting carries ${bunt.userData.flagCount} flags (4-${BUNTING_FLAGS_MAX})`);
  let flagMesh = null;
  bunt.traverse(c => { if (c.isMesh) flagMesh = c; });
  (flagMesh && flagMesh.geometry.getAttribute('color') ? ok : bad)('bunting flags are vertex-coloured (period colours baked in)');
}

{
  const rib = makeRibbonStreamers({ topY: 6.3 });
  (rib.userData.ribbonCount === RIBBON_STREAMERS ? ok : bad)(`${RIBBON_STREAMERS} ribbon streamers on the pole`);
  (rib.material.uniforms.uTime ? ok : bad)('ribbons animate off uTime (GPU-side)');
  (fxMatCount() === registryBaseline + 1 ? ok : bad)('ribbons register with the fire tick');
  rib.dispose();
  (fxMatCount() === registryBaseline ? ok : bad)('ribbons dispose() unregisters');
}

{
  // the Fine ember column on a hero fire: a SECOND pooled ember Points
  const hero = Fire({ scale: 3, big: true, embers: true, smoke: true, column: true });
  let emberSystems = 0, column = null;
  hero.traverse(o => { if (o.isPoints) { emberSystems++; if (o.userData.emberColumn) column = o; } });
  (emberSystems === 2 ? ok : bad)('column:true adds a second ember Points (bed + column)');
  (column && column.geometry.getAttribute('aSeed').count === 70 ? ok : bad)('ember column pools exactly 70 motes');
  (column && column.material.uniforms.uRise.value > 2 ? ok : bad)('ember column rises > 2x the bed embers');
  const before = fxMatCount();
  hero.dispose();
  (fxMatCount() === before - 3 ? ok : bad)('hero dispose() releases bed + column (+ any smoke) from the tick registry');
}

// ============================ 3. mock world (render-harness crib) ============
const CX = 100, CZ = 100;
const CHAPEL = { type: 'chapel',    x0: CX - 3,  x1: CX + 3, z0: CZ - 10, z1: CZ - 6, g: 32 };
const FARM   = { type: 'farmhouse', x0: CX - 12, x1: CX - 7, z0: CZ - 5,  z1: CZ,     g: 32 };
const COT1   = { type: 'cottage',   x0: CX + 5,  x1: CX + 8, z0: CZ - 5,  z1: CZ - 2, g: 32 };
const COT2   = { type: 'cottage',   x0: CX - 6,  x1: CX - 3, z0: CZ + 4,  z1: CZ + 7, g: 32 };
const VILLAGE = { x: CX, z: CZ, buildings: [CHAPEL, FARM, COT1, COT2] };

function villageColumn(x, z) {
  for (const b of VILLAGE.buildings) {
    if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return { kind: 'building' };
  }
  const dist = Math.max(Math.abs(x - CX), Math.abs(z - CZ));
  if (dist <= 12) return { kind: 'green' };
  return null;
}
// Midsummer's hilltop scan walks a 16-block grid from (CX, CZ), so the synthetic
// summit MUST land on that grid: CX+48, CZ+48 (dist ≈ 68 > VILLAGE_EXCL 32).
function mockHeight(x, z) {
  const hx = CX + 48, hz = CZ + 48;
  if (x === hx && z === hz) return 50;
  return 32;
}
const mockWorld = { getBlock: () => B.AIR, snowmanLedger: new Map(), gen: null };
const mockGen = { height: mockHeight, geo: { villages: [VILLAGE], villageColumn, seed: 0xdeadbeef } };
mockWorld.gen = mockGen;

const YEARPHASE = { yule: 0.88, bonfire: 0.60, harvest: 0.57, easter: 0.18, mayday: 0.25, midsummer: 0.37 };
const BUILDERS = {
  yule: buildChristmas, bonfire: buildBonfire, harvest: buildHarvest,
  easter: buildEaster, mayday: buildMayDay, midsummer: buildMidsummer,
};

function runBuilder(id, fine) {
  const scene = new THREE.Scene();
  const objects = [], lit = [], robins = [], fx = [];
  const ctx = {
    scene, world: mockWorld, gen: mockGen, cx: CX, cz: CZ,
    season: seasonStateAtPhase(YEARPHASE[id]), snowAccum: 1,
    objects, lit, robins, fx, fine,
  };
  BUILDERS[id](ctx);
  return { scene, objects, fx };
}

function wowTally(objects) {
  const tally = {};
  for (const o of objects) {
    o.traverse(c => { if (c.userData && c.userData.wow) tally[c.userData.wow] = (tally[c.userData.wow] || 0) + 1; });
  }
  return tally;
}

// ============================ 4. Fine path: the new props ====================
console.log('\n-- Fine path per festival --\n');

const preBuildRegistry = fxMatCount();

{
  const { objects, fx } = runBuilder('bonfire', true);
  const tally = wowTally(objects);
  (tally.fireworks === 1 ? ok : bad)('bonfire(Fine): one fireworks launch site per village');
  let column = false;
  for (const o of objects) o.traverse(c => { if (c.userData.emberColumn) column = true; });
  (column ? ok : bad)('bonfire(Fine): the pyre carries the tall ember column');
  (fx.length >= 1 ? ok : bad)('bonfire(Fine): a uNight feed is registered in ctx.fx');
  // teardown through the REAL SeasonalLayer.clear()
  const layer = new SeasonalLayer(new THREE.Scene(), mockWorld);
  layer.objects.push(...objects);
  layer.clear();
  (fxMatCount() === preBuildRegistry ? ok : bad)('bonfire(Fine): SeasonalLayer.clear() leaves ZERO fx-registry orphans');
  (layer.objects.length === 0 ? ok : bad)('bonfire(Fine): clear() empties the object ledger');
}

{
  const { objects, fx } = runBuilder('yule', true);
  const tally = wowTally(objects);
  (tally.lanternString >= 1 && tally.lanternString <= 3 ? ok : bad)(`yule(Fine): ${tally.lanternString || 0} lantern string(s) between buildings (1-3)`);
  let lanternsTotal = 0;
  for (const o of objects) if (o.userData.wow === 'lanternString') lanternsTotal += o.userData.lanternCount;
  (lanternsTotal > 0 && lanternsTotal <= 3 * LANTERNS_MAX ? ok : bad)(`yule(Fine): ${lanternsTotal} lanterns total (pooled, <= ${3 * LANTERNS_MAX})`);
  (fx.length >= 2 ? ok : bad)('yule(Fine): candle glimmer + lantern sway callbacks registered');
  // glimmer actually brightens the candle materials over the bloom threshold
  const glims = [];
  for (const o of objects) o.traverse(c => {
    if (c.isMesh && c.material && c.material.userData && c.material.userData.glimmer && glims.indexOf(c.material) < 0) glims.push(c.material);
  });
  (glims.length >= 1 ? ok : bad)('yule(Fine): fir candles/star are glimmer-tagged');
  const c0 = glims[0].color.clone();
  for (const f of fx) f(0.35, 0.016); // one animation step
  (glims[0].color.r !== c0.r || glims[0].color.g !== c0.g ? ok : bad)('yule(Fine): a tick actually moves the candle glimmer');
  const layer = new SeasonalLayer(new THREE.Scene(), mockWorld);
  layer.objects.push(...objects);
  layer.clear();
  (fxMatCount() === preBuildRegistry ? ok : bad)('yule(Fine): teardown leaves zero orphans');
}

{
  const { objects } = runBuilder('mayday', true);
  const tally = wowTally(objects);
  (tally.ribbons === 1 ? ok : bad)('mayday(Fine): streaming ribbon set on the maypole');
  (tally.bunting >= 1 ? ok : bad)(`mayday(Fine): ${tally.bunting || 0} bunting line(s) in period colours`);
  const layer = new SeasonalLayer(new THREE.Scene(), mockWorld);
  layer.objects.push(...objects);
  layer.clear();
  (fxMatCount() === preBuildRegistry ? ok : bad)('mayday(Fine): teardown leaves zero orphans');
}

{
  const { objects, fx } = runBuilder('midsummer', true);
  const tally = wowTally(objects);
  (tally.motes >= 1 ? ok : bad)('midsummer(Fine): golden evening motes over the green');
  let column = false;
  for (const o of objects) o.traverse(c => { if (c.userData.emberColumn) column = true; });
  (column ? ok : bad)('midsummer(Fine): hilltop beacon carries the ember column');
  (fx.length >= 1 ? ok : bad)('midsummer(Fine): mote uGate feed registered');
  const layer = new SeasonalLayer(new THREE.Scene(), mockWorld);
  layer.objects.push(...objects);
  layer.clear();
  (fxMatCount() === preBuildRegistry ? ok : bad)('midsummer(Fine): teardown leaves zero orphans');
}

{
  const fineRun  = runBuilder('harvest', true);
  const plainRun = runBuilder('harvest', false);
  const tally = wowTally(fineRun.objects);
  (tally.produceTable === 1 ? ok : bad)('harvest(Fine): one lamplit produce table by the chapel');
  (tally.motes >= 1 ? ok : bad)('harvest(Fine): daytime chaff motes');
  (fineRun.objects.length > plainRun.objects.length ? ok : bad)('harvest(Fine): stook clusters add props over the Plain build');
  let lampLight = null;
  for (const o of fineRun.objects) o.traverse(c => { if (c.isPointLight) lampLight = c; });
  (lampLight ? ok : bad)('harvest(Fine): the produce table carries one warm point-light');
  const layer = new SeasonalLayer(new THREE.Scene(), mockWorld);
  layer.objects.push(...fineRun.objects, ...plainRun.objects);
  layer.clear();
  (fxMatCount() === preBuildRegistry ? ok : bad)('harvest(Fine): teardown leaves zero orphans');
}

{
  const { objects } = runBuilder('easter', true);
  const tally = wowTally(objects);
  (tally.doorGarland >= 1 ? ok : bad)(`easter(Fine): ${tally.doorGarland || 0} spring garland(s) on cottage doors`);
  (tally.wildflowers >= 1 && tally.wildflowers <= 14 ? ok : bad)(`easter(Fine): ${tally.wildflowers || 0} wildflower clump(s) near the green (<= 14)`);
  const layer = new SeasonalLayer(new THREE.Scene(), mockWorld);
  layer.objects.push(...objects);
  layer.clear();
  (fxMatCount() === preBuildRegistry ? ok : bad)('easter(Fine): teardown leaves zero orphans');
}

// ============================ 5. Plain path unchanged ========================
console.log('\n-- Plain path unchanged --\n');

for (const id of Object.keys(BUILDERS)) {
  const { objects, fx } = runBuilder(id, false);
  const tally = wowTally(objects);
  const wowCount = Object.values(tally).reduce((a, b) => a + b, 0);
  (wowCount === 0 ? ok : bad)(`${id}(Plain): zero wow props (${JSON.stringify(tally)})`);
  (fx.length === 0 ? ok : bad)(`${id}(Plain): zero fx callbacks`);
  (objects.length >= 1 ? ok : bad)(`${id}(Plain): the stock dressing still builds (${objects.length} objects)`);
  // tear the Plain build down too (bonfire/midsummer hero fires register ember
  // mats regardless of quality — the stock behaviour) so the registry check below
  // isolates leaks rather than counting live fires.
  const layer = new SeasonalLayer(new THREE.Scene(), mockWorld);
  layer.objects.push(...objects);
  layer.clear();
}
(fxMatCount() === preBuildRegistry ? ok : bad)('after every build is torn down the fx registry is back at baseline');

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
