// Registered-farm gate check — run wi': node scripts/verify-farm.mjs
import { FARM_THRESHOLD, CHARTER_FEE, farmRegisterCheck, LIVESTOCK_PRICE, livestockPrice, droveValue, priceOf } from '../src/economy.js';
import { I } from '../src/defs.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// --- constants are the signed-off values (Moorstead, 5 head, £1) ---
{
  (FARM_THRESHOLD === 5 ? ok : bad)('farm threshold is 5 head');
  (CHARTER_FEE === 240 ? ok : bad)('charter fee is £1 (240d)');
}

// --- below threshold is refused, carrying the exact shortfall ---
{
  const r = farmRegisterCheck({ head: 3, registered: false, brass: 999, atMarket: true });
  (r.ok === false && r.reason === 'short' ? ok : bad)('3 head: refused as short');
  (r.need === 5 && r.have === 3 ? ok : bad)('short result carries need=5, have=3');
}

// --- at threshold but away from the market town ---
{
  const r = farmRegisterCheck({ head: 5, registered: false, brass: 999, atMarket: false });
  (r.ok === false && r.reason === 'away' ? ok : bad)('5 head but not at Moorstead: refused as away');
}

// --- at threshold, at market, but skint ---
{
  const r = farmRegisterCheck({ head: 6, registered: false, brass: 100, atMarket: true });
  (r.ok === false && r.reason === 'poor' ? ok : bad)('5+ head at market but under £1: refused as poor');
  (r.fee === 240 ? ok : bad)('poor result carries the fee');
}

// --- all conditions met ---
{
  const r = farmRegisterCheck({ head: 5, registered: false, brass: 240, atMarket: true });
  (r.ok === true ? ok : bad)('5 head, at market, £1 in purse: may register');
}

// --- already registered is a no-op ---
{
  const r = farmRegisterCheck({ head: 9, registered: true, brass: 999, atMarket: true });
  (r.ok === false && r.reason === 'already' ? ok : bad)('already registered: no re-register');
}

// --- Slice 3: livestock pricing + the income gradient ---
{
  (LIVESTOCK_PRICE === 120 ? ok : bad)('livestock price is a flat 120d (10s) per head');
  (livestockPrice(0) === 120 ? ok : bad)('per-head at standing 0 is 120d');
  (livestockPrice(5) > livestockPrice(0) ? ok : bad)('standing lifts the per-head price');
  (droveValue(5, 0) === 600 ? ok : bad)('a 5-head drove = £2 10s (600d)');
  (droveValue(8, 0) === 960 ? ok : bad)('an 8-head drove = £4 (960d)');
  (droveValue(0, 0) === 0 ? ok : bad)('no head delivered = no pay');
  const coalHaul = 96 * priceOf(I.COAL_LUMP, 'whitby', 'sell', 0);
  (droveValue(5, 0) > coalHaul ? ok : bad)(`5-head drove (${droveValue(5,0)}) tops a 96-coal rail haul (${coalHaul})`);
}

console.log('RESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
