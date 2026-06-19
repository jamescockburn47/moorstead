// Economy logic check — run wi': node scripts/verify-economy.mjs
import { formatBrass, priceOf, PRICES, vendorFor, VENDORS, Economy, STARTING_BRASS, dropInPrice, shipmentValue, FREIGHT_ALLOWANCE, DELIVERY_DELAY, PURSE_MAX } from '../src/economy.js';
import { I } from '../src/defs.js';
import { Player } from '../src/player.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const eq = (got, want, m) => (got === want ? ok : bad)(`${m} (got ${JSON.stringify(got)})`);

// --- Task 1: pence -> £sd (12d = 1s, 20s = £1 = 240d) ---
eq(formatBrass(0), '0d', 'zero is 0d');
eq(formatBrass(11), '11d', 'pence under a shilling');
eq(formatBrass(12), '1s', 'exactly a shilling');
eq(formatBrass(18), '1s 6d', 'shillings and pence');
eq(formatBrass(60), '5s', 'the starting purse reads 5s');
eq(formatBrass(294), '£1 4s 6d', 'pounds, shillings and pence');
eq(formatBrass(-5), '0d', 'never negative');

// --- Task 2: prices and regional spreads ---
(PRICES[I.COAL_LUMP] > 0 ? ok : bad)('coal has a base price');
(priceOf(I.PARCEL, 'Whitby', 'buy') === null ? ok : bad)('a non-tradeable item has no price');
{
  const atKiln = priceOf(I.COAL_LUMP, 'Rosedale Abbey', 'sell');
  const atCoast = priceOf(I.COAL_LUMP, 'Whitby', 'sell');
  (atCoast > atKiln ? ok : bad)(`coal sells dearer at the coast than the pit-head (${atKiln}d vs ${atCoast}d)`);
}
{
  const buyHere = priceOf(I.JET_GEM, 'Whitby', 'buy');
  const sellHere = priceOf(I.JET_GEM, 'Whitby', 'sell');
  (sellHere < buyHere ? ok : bad)(`round trip at one vendor loses (buy ${buyHere}d, sell ${sellHere}d)`);
}
{
  const buyAtKiln = priceOf(I.COAL_LUMP, 'Rosedale Abbey', 'buy');
  const sellAtCoast = priceOf(I.COAL_LUMP, 'Whitby', 'sell');
  (sellAtCoast > buyAtKiln ? ok : bad)(`hauling coal kiln->coast pays (buy ${buyAtKiln}d, sell ${sellAtCoast}d)`);
}
{
  const plain = priceOf(I.IRON_INGOT, 'Pickering', 'sell', 0);
  const valued = priceOf(I.IRON_INGOT, 'Pickering', 'sell', 4);
  (valued >= plain ? ok : bad)(`good standing sells no worse (${plain}d -> ${valued}d)`);
}

// --- Task 3: vendor catalogues ---
{
  const tom = vendorFor('Owd Tom');
  (tom && tom.buys.includes(I.JET_GEM) ? ok : bad)('Owd Tom buys jet');
  (vendorFor('Driver Wassell') ? ok : bad)('a line villager is a vendor');
  (vendorFor('nobody at all') === null ? ok : bad)('an unknown name is no vendor');
}
{
  let priced = true;
  for (const v of Object.values(VENDORS))
    for (const id of [...v.sells, ...v.buys]) if (PRICES[id] == null) priced = false;
  (priced ? ok : bad)('every vendor good has a base price');
}

// --- Task 4: the Economy class (with a fake game/player) ---
function fakeGame(brass = STARTING_BRASS, held = {}) {
  const slots = Object.entries(held).map(([id, n]) => ({ id: +id, n }));
  return {
    player: {
      brass,
      countItem(id) { return slots.filter(s => s.id === id).reduce((a, s) => a + s.n, 0); },
      addItem(id, n) { slots.push({ id, n }); return 0; },
      removeItem(id, n) { for (const s of slots) if (s.id === id) { const t = Math.min(n, s.n); s.n -= t; n -= t; } return n; },
    },
    ui: { invDirty: false, toast() {} },
    audio: { pickup() {} },
    dropAtPlayer() {},
    quests: { standingIndex: () => 0 },
  };
}
{
  const g = fakeGame(20);
  const e = new Economy(g);
  (e.canAfford(10) && !e.canAfford(99) ? ok : bad)('canAfford checks the purse');
  (e.spend(10) && g.player.brass === 10 ? ok : bad)('spend deducts brass');
  (e.spend(999) === false && g.player.brass === 10 ? ok : bad)('overspend is refused, purse unchanged');
  e.earn(5); (g.player.brass === 15 ? ok : bad)('earn adds brass');
}
{
  const g = fakeGame(0, { [I.JET_GEM]: 1 });
  const e = new Economy(g);
  const v = { t: { name: 'fishwife annie', village: 'Whitby' } };
  const got = e.doSell(v, I.JET_GEM);
  (got && g.player.brass === priceOf(I.JET_GEM, 'Whitby', 'sell') && g.player.countItem(I.JET_GEM) === 0 ? ok : bad)
    (`doSell pays the sell price and takes the good (purse ${g.player.brass}d)`);
}
{
  const g = fakeGame(50);
  const e = new Economy(g);
  const v = { t: { name: 'owd tom', village: 'Rosedale Abbey' } };
  const p = priceOf(I.COAL_LUMP, 'Rosedale Abbey', 'buy');
  const got = e.doBuy(v, I.COAL_LUMP);
  (got && g.player.brass === 50 - p && g.player.countItem(I.COAL_LUMP) === 1 ? ok : bad)
    (`doBuy charges the buy price and gives the good (paid ${p}d)`);
}

// --- Task 5: the player's brass wallet (field + save/load + migration) ---
{
  const stub = { getBlock() { return 0; }, isLoaded() { return true; } };
  const p = new Player(stub);
  (p.brass === STARTING_BRASS ? ok : bad)(`a fresh player starts with ${STARTING_BRASS}d`);
  p.brass = 123;
  const saved = p.serialize();
  (saved.brass === 123 ? ok : bad)('serialize writes brass');
  const p2 = new Player(stub);
  p2.deserialize(saved);
  (p2.brass === 123 ? ok : bad)('deserialize restores brass');
  const p3 = new Player(stub);
  p3.deserialize({ pos: { x: 0, y: 0, z: 0 } });
  (p3.brass === STARTING_BRASS ? ok : bad)('an old save migrates to the starting purse');
}

// --- SP2 Task 1: drop-in and shipment pricing ---
{
  const localSell = priceOf(I.JET_GEM, 'Whitby', 'sell', 0);
  const drop = dropInPrice(I.JET_GEM, 'Whitby', 0);
  (drop < localSell ? ok : bad)(`drop-in pays less than the local sell price (${drop}d vs ${localSell}d)`);
  (drop >= 1 ? ok : bad)('drop-in never rounds below a penny');
  (dropInPrice(I.PARCEL, 'Whitby', 0) === null ? ok : bad)('a non-tradeable good has no drop-in price');
}
{
  const goods = [[I.COAL_LUMP, 10], [I.JET_GEM, 2]];
  const v = shipmentValue(goods, 'Whitby', 0);
  const expect = priceOf(I.COAL_LUMP, 'Whitby', 'sell', 0) * 10 + priceOf(I.JET_GEM, 'Whitby', 'sell', 0) * 2;
  (v === expect ? ok : bad)(`shipmentValue sums the destination sell prices (${v}d)`);
  (shipmentValue([[I.PARCEL, 1]], 'Whitby', 0) === null ? ok : bad)('a parcel of a non-tradeable good has no shipment value');
}
{
  const ship = shipmentValue([[I.COAL_LUMP, 10]], 'Whitby', 0);
  const drop = dropInPrice(I.COAL_LUMP, 'Rosedale Abbey', 0) * 10;
  (ship > drop ? ok : bad)(`shipping coal to the coast beats a local drop-in (${ship}d vs ${drop}d)`);
}

// --- SP2 Task 2: player trade state persists ---
{
  const stub = { getBlock() { return 0; }, isLoaded() { return true; } };
  const p = new Player(stub);
  (Array.isArray(p.shipments) && p.shipments.length === 0 ? ok : bad)('a fresh player has no shipments');
  (p.vendorPurses && typeof p.vendorPurses === 'object' ? ok : bad)('a fresh player has a vendorPurses map');
  p.shipments.push({ goods: [[I.COAL_LUMP, 3]], dest: 'Whitby', brass: 30, arrivesAt: 5 });
  p.vendorPurses['tom'] = 42; p.pursesAt = 9;
  const saved = p.serialize();
  const p2 = new Player(stub); p2.deserialize(saved);
  (p2.shipments.length === 1 && p2.shipments[0].dest === 'Whitby' ? ok : bad)('shipments survive save/load');
  (p2.vendorPurses['tom'] === 42 && p2.pursesAt === 9 ? ok : bad)('vendor purses survive save/load');
  const p3 = new Player(stub); p3.deserialize({ pos: { x: 0, y: 0, z: 0 } });
  (p3.shipments.length === 0 && p3.pursesAt === 0 ? ok : bad)('an old save migrates to empty trade state');
}

console.log('RESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
