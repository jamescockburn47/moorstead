// Headless: the Ironstone value chain (Moors industry Slice 1). The deep-industry framework —
// staged goods (raw -> calcined -> pig iron), the WORKS that convert them, the per-town spreads,
// the Teesside export — plus the Rosedale ironstone seam and the works sites in the world.
import assert from 'node:assert';
import { PRICES, regionMult, convertAt, bestMarket, WORKS, priceOf } from '../src/economy.js';
import { Gen, MOORS_SEED } from '../src/worldgen.js';
import { B, I } from '../src/defs.js';

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// ---- the chain prices step up ----
ok(PRICES[I.RAW_IRON] < PRICES[I.CALCINED_IRONSTONE] && PRICES[I.CALCINED_IRONSTONE] < PRICES[I.PIG_IRON],
  'chain prices step up: raw ironstone < calcined < pig iron');

// ---- spreads: where each stage is cheap/dear ----
ok(regionMult('Rosedale Abbey', I.CALCINED_IRONSTONE) < 1, 'calcined ore cheap where it is calcined (Rosedale)');
ok(regionMult('Pickering', I.PIG_IRON) > 1 && regionMult('Grosmont', I.PIG_IRON) < 1,
  'pig iron dear at the market towns, cheap at the furnace');

// ---- the WORKS convert correctly ----
const kiln = WORKS.find(w => w.kind === 'kiln'), furnace = WORKS.find(w => w.kind === 'furnace');
ok(kiln && furnace, 'a calcining kiln and a blast furnace are defined');
const ck = convertAt(kiln, 10, 999); ok(ck.ok && ck.used === 9 && ck.made === 6, 'kiln calcines 3:2 (10 ironstone -> 6 calcined, 9 used)');
const cf = convertAt(furnace, 5, 999); ok(cf.ok && cf.used === 4 && cf.made === 2, 'furnace smelts 2:1 (5 calcined -> 2 pig, 4 used)');
ok(!convertAt(kiln, 2, 999).ok, 'a works refuses under one batch of input');
ok(!convertAt(kiln, 10, 1).ok, 'a works refuses without the brass for the toll');

// ---- the Teesside export is the calcined market ----
const bm = bestMarket(I.CALCINED_IRONSTONE, 'Rosedale Abbey', ['Rosedale Abbey', 'Grosmont', 'Pickering', 'Whitby']);
ok(bm && bm.export && bm.village === 'Teesside', 'calcined ore exports to Teesside (the bulk destination)');

// ---- the pig-iron chain out-earns the bulk export (the furnace is worth the effort) ----
const bulk = 2 * bm.perUnit - kiln.toll;                       // 2 calcined sold at Teesside
const pigChain = priceOf(I.PIG_IRON, 'Pickering', 'sell') - kiln.toll - furnace.toll; // those 2 -> 1 pig, sold
ok(pigChain > bulk, `pig-iron chain (${pigChain}) pays more than the Teesside bulk (${bulk})`);

// ---- geography: works sited + the Rosedale seam ----
const gen = new Gen(MOORS_SEED), geo = gen.geo;
const sites = geo.worksSites();
ok(sites.some(s => s.kind === 'kiln') && sites.some(s => s.kind === 'furnace'), 'both works are sited in the world');
for (const s of sites) { const ri = geo.railInfo(s.x, s.z); ok(geo.height(s.x, s.z) >= 27 && (!ri || ri.d >= 3), `works on dry land, clear of rails: ${s.name}`); }
const ros = geo.villages.find(v => v.name.includes('Rosedale'));
const count = (cx, cz) => { let c = 0; for (let dx = -16; dx <= 16; dx += 4) for (let dz = -16; dz <= 16; dz += 4) for (let y = 12; y < 34; y += 4) if (gen.oreAt(cx + dx, y, cz + dz) === B.IRON_ORE) c++; return c; };
const near = count(ros.x, ros.z), far = count(1790, 3046);
ok(near > far * 3 && near > 10, `ironstone is the Rosedale field (near ${near} >> far ${far})`);

// ---- period-accurate mining: anachronisms gone, jet at Whitby, coal scarce ----
let anach = 0;
for (let x = 2200; x <= 2400; x += 12) for (let z = 2200; z <= 2400; z += 12) for (let y = 8; y < 46; y += 4) {
  const b = gen.oreAt(x, y, z); if (b === B.POLYHALITE || b === B.ROCK_SALT || b === B.ALUM_SHALE) anach++;
}
ok(anach === 0, 'no polyhalite / rock salt / alum in the 1900 Moors (anachronistic or long defunct)');
const whitby = geo.villages.find(v => v.name === 'Whitby');
const jet = (cx, cz) => { let c = 0; for (let dx = -16; dx <= 16; dx += 4) for (let dz = -16; dz <= 16; dz += 4) for (let y = 8; y < 20; y += 3) if (gen.oreAt(cx + dx, y, cz + dz) === B.JET_ORE) c++; return c; };
ok(jet(whitby.x, whitby.z) > 0 && jet(ros.x, ros.z) === 0, 'jet is the Whitby field, not scattered inland');
let coalN = 0, coalT = 0;
for (let x = 600; x <= 900; x += 12) for (let z = 2000; z <= 2300; z += 12) for (let y = 10; y < 48; y += 5) { coalT++; if (gen.oreAt(x, y, z) === B.COAL_ORE) coalN++; }
ok(coalN / coalT < 0.05, `moor coal is scarce (${(100 * coalN / coalT).toFixed(1)}%), not an abundant seam`);

// ---- the jet chain reuses the same framework ----
ok(PRICES[I.CARVED_JET] > PRICES[I.JET_GEM], 'carved jet worth more than raw jet (the carver adds the value)');
const jetshop = WORKS.find(w => w.kind === 'jetshop');
ok(jetshop && jetshop.in === I.JET_GEM && jetshop.out === I.CARVED_JET, 'a Whitby jet works carves raw jet -> carved jet');
const cj = convertAt(jetshop, 5, 999); ok(cj.ok && cj.used === 5 && cj.made === 5, 'jet shop carves 1:1 (5 raw -> 5 carved)');
const jetSite = sites.find(s => s.kind === 'jetshop');
ok(jetSite && Math.hypot(jetSite.x - whitby.x, jetSite.z - whitby.z) < 90, 'the jet works is sited at Whitby');

console.log(`verify-industry-ironstone: ${n} assertions OK`);
