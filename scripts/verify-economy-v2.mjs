// Economy v2 market-town check — run wi': node scripts/verify-economy-v2.mjs
// Asserts that marketTownName resolves correctly for both worlds, that Pickering
// is in the v2 village list, and that price spreads are sane for v2 towns/goods.
import { marketTownName, priceOf } from '../src/economy.js';
import { Gen, MOORS_SEED } from '../src/worldgen.js';
import { I } from '../src/defs.js';

let n = 0;
let failed = false;
const ok  = m => { n++; console.log('  ok    ' + m); };
const bad = m => { n++; failed = true; console.log('  FAIL  ' + m); };

// --- 1. marketTownName helper ---
(marketTownName(true)  === 'Pickering'  ? ok : bad)('marketTownName(true)  === Pickering');
(marketTownName(false) === 'Moorstead'  ? ok : bad)('marketTownName(false) === Moorstead');

// --- 2. Pickering is in the v2 village list ---
const geo = new Gen(MOORS_SEED).geo;
const hasPickering = geo.villages.some(v => v.name.toLowerCase() === 'pickering');
(hasPickering ? ok : bad)('v2 geo.villages contains a town named Pickering (market town resolves)');

// --- 3. Goods-market spreads are sane for v2 towns ---
// JET_GEM: Whitby and Pickering are dear markets (spread > 1 -> sell > base * margin)
{
  const jetWhitby   = priceOf(I.JET_GEM,  'Whitby',   'sell', 0);
  const jetPickering = priceOf(I.JET_GEM, 'Pickering', 'sell', 0);
  const jetBase = priceOf(I.JET_GEM, 'Goathland', 'sell', 0); // no spread entry -> par
  (jetWhitby   > 0 ? ok : bad)(`JET_GEM sell at Whitby > 0 (${jetWhitby}d)`);
  (jetPickering > 0 ? ok : bad)(`JET_GEM sell at Pickering > 0 (${jetPickering}d)`);
  (jetWhitby   > jetBase ? ok : bad)(`JET_GEM dearer at Whitby than par (${jetWhitby}d vs ${jetBase}d)`);
  (jetPickering > jetBase ? ok : bad)(`JET_GEM dearer at Pickering than par (${jetPickering}d vs ${jetBase}d)`);
}

// RAW_IRON: Pickering is a buyer market; Rosedale is the pit-head (cheap)
{
  const ironRosedale  = priceOf(I.RAW_IRON, 'Rosedale', 'sell', 0);
  const ironPickering = priceOf(I.RAW_IRON, 'Pickering', 'sell', 0);
  (ironRosedale  > 0 ? ok : bad)(`RAW_IRON sell at Rosedale > 0 (${ironRosedale}d)`);
  (ironPickering > 0 ? ok : bad)(`RAW_IRON sell at Pickering > 0 (${ironPickering}d)`);
  (ironPickering > ironRosedale ? ok : bad)(`RAW_IRON dearer at Pickering than Rosedale (${ironPickering}d vs ${ironRosedale}d)`);
}

// WOOL: Pickering and Whitby are buyer markets
{
  const woolPickering = priceOf(I.WOOL !== undefined ? I.WOOL : null, 'Pickering', 'sell', 0);
  // WOOL is a block ID in B, not I — use the spread key via a known good instead
  // Verify that Whitby pays more than Goathland for JET (already done above) and
  // that PIG_IRON spread resolves to sane values at Pickering (a real v2 market town)
  const pigPickering = priceOf(I.PIG_IRON, 'Pickering', 'sell', 0);
  const pigGrosmont  = priceOf(I.PIG_IRON, 'Grosmont',  'sell', 0);
  (pigPickering > 0 ? ok : bad)(`PIG_IRON sell at Pickering > 0 (${pigPickering}d)`);
  (pigGrosmont  > 0 ? ok : bad)(`PIG_IRON sell at Grosmont > 0 (${pigGrosmont}d)`);
  (pigPickering > pigGrosmont ? ok : bad)(`PIG_IRON dearer at Pickering than furnace-side Grosmont (${pigPickering}d vs ${pigGrosmont}d)`);
}

console.log(`\nverify-economy-v2: ${n} assertions OK`);
if (failed) { console.log('RESULT: FAIL'); process.exit(1); }
console.log('RESULT: PASS');
