// Menagerie and droving verification script — run with: node scripts/verify-menagerie.mjs
import { MOB_TYPES } from '../src/entities.js';
import { I, SMELTS, FOODS, ITEM_NAMES } from '../src/defs.js';
import { livestockPrice, droveValue, LIVESTOCK_PRICES } from '../src/economy.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const eq = (got, want, m) => (got === want ? ok : bad)(`${m} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);

console.log('Running Menagerie & Droving verification...');

// --- Task 1: Mob definitions & droveable flags ---
{
  eq(MOB_TYPES.sheep?.droveable, true, 'sheep is droveable');
  eq(MOB_TYPES.cow?.droveable, true, 'cow is droveable');
  eq(MOB_TYPES.llama?.droveable, true, 'llama is droveable');
  eq(MOB_TYPES.pony?.droveable, true, 'pony is droveable');
  eq(!!MOB_TYPES.bull?.droveable, false, 'bull is NOT droveable');
  eq(!!MOB_TYPES.pig?.droveable, false, 'pig is NOT droveable');
}

// --- Task 2: Llama taming ---
{
  eq(MOB_TYPES.llama?.tameable, true, 'llama is tameable');
  eq(MOB_TYPES.llama?.tameFood?.includes(I.BILBERRIES), true, 'llama likes bilberries');
}

// --- Task 3: Pork definitions & Pig drops ---
{
  eq(ITEM_NAMES[I.RAW_PORK], 'Raw Pork', 'Raw pork registered');
  eq(ITEM_NAMES[I.COOKED_PORK], 'Roast Pork', 'Roast pork registered');
  eq(FOODS[I.RAW_PORK], 3, 'Raw pork is food (+3)');
  eq(FOODS[I.COOKED_PORK], 8, 'Roast pork is food (+8)');

  const porkSmelt = SMELTS.find(s => s.in === I.RAW_PORK && s.out === I.COOKED_PORK);
  eq(!!porkSmelt, true, 'raw pork smelts to roast pork');

  const pigDrops = MOB_TYPES.pig?.drops || [];
  const porkDrop = pigDrops.find(d => d[0] === I.RAW_PORK);
  eq(!!porkDrop, true, 'pig drops raw pork');
  eq(porkDrop ? porkDrop[1] : 0, 1, 'pig drops minimum 1 pork');
}

// --- Task 4: Per-species pricing & droveValue ---
{
  eq(LIVESTOCK_PRICES.sheep, 120, 'sheep base price is 120d');
  eq(LIVESTOCK_PRICES.llama, 110, 'llama base price is 110d');
  eq(LIVESTOCK_PRICES.pig, 150, 'pig base price is 150d');
  eq(LIVESTOCK_PRICES.cow, 340, 'cow base price is 340d');
  eq(LIVESTOCK_PRICES.pony, 540, 'pony base price is 540d');

  // standing tests
  eq(livestockPrice(0), 120, 'livestockPrice(0) defaults to sheep, standing 0 = 120d');
  eq(livestockPrice(5), 132, 'livestockPrice(5) defaults to sheep, standing 5 = 132d');
  eq(livestockPrice('cow', 0), 340, 'livestockPrice("cow", 0) = 340d');
  eq(livestockPrice('cow', 5), 374, 'livestockPrice("cow", 5) = 374d');
  eq(livestockPrice('pony', 0), 540, 'livestockPrice("pony", 0) = 540d');

  // drove value tests
  eq(droveValue(5, 0), 600, '5 sheep drove at standing 0 = 600d');
  eq(droveValue(5, 5), 660, '5 sheep drove at standing 5 = 660d');

  // mixed flock as types array
  const mixedTypes = ['sheep', 'cow', 'pony', 'llama'];
  eq(droveValue(mixedTypes, 0), 120 + 340 + 540 + 110, 'mixed types array value at standing 0 = 1110d');

  // mixed flock as mob objects
  const mixedMobs = [
    { type: 'sheep' },
    { type: 'cow' },
    { type: 'pony' },
    { type: 'llama' }
  ];
  eq(droveValue(mixedMobs, 0), 120 + 340 + 540 + 110, 'mixed mob objects value at standing 0 = 1110d');
  eq(droveValue(mixedMobs, 5), 132 + 374 + 594 + 121, 'mixed mob objects value at standing 5 = 1221d');
}

console.log('RESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
