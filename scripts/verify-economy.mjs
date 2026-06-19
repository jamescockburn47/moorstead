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
      shipments: [], vendorPurses: {}, pursesAt: 0,
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

// Wrap a real Player (so serialize/deserialize is genuinely exercised) in a minimal game.
function gameWith(player) {
  return {
    player,
    ui: { invDirty: false, toast() {} },
    audio: { pickup() {} },
    dropAtPlayer() {},
    quests: { standingIndex: () => 0 },
    geo: { village: { name: 'Whitby' } },
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

// --- SP2 Task 3: the vendor purse caps drop-in volume ---
{
  const g = fakeGame(0, { [I.JET_GEM]: 50 });
  const e = new Economy(g);
  const v = { t: { name: 'fishwife annie', village: 'Whitby' }, displayName: 'Annie' };
  let sales = 0, refusals = 0;
  for (let i = 0; i < 50; i++) (e.dropInSell(v, I.JET_GEM) ? sales++ : refusals++);
  (sales > 0 && refusals > 0 ? ok : bad)(`drop-in sells a few then the purse is tapped (${sales} sold, ${refusals} refused)`);
  (g.player.brass <= PURSE_MAX ? ok : bad)(`drop-in income is capped by the purse (earned ${g.player.brass}d, cap ${PURSE_MAX}d)`);
  (g.player.countItem(I.JET_GEM) === 50 - sales ? ok : bad)('only the sold jet left the pack');
}
{
  const g = fakeGame(0, {});
  const e = new Economy(g);
  g.player.vendorPurses['annie'] = 0; g.player.pursesAt = 0;
  e.refillPurses(1);
  (g.player.vendorPurses['annie'] > 0 ? ok : bad)(`a drained purse refills over time (now ${g.player.vendorPurses['annie']}d)`);
}

// --- SP2 Task 4: booking and delivering shipments ---
{
  const g = fakeGame(0, { [I.COAL_LUMP]: 20 });
  const e = new Economy(g);
  const r = e.bookShipment([[I.COAL_LUMP, 10]], 'Whitby', 'Rosedale Abbey', 0);
  (r.ok && r.brass === shipmentValue([[I.COAL_LUMP, 10]], 'Whitby', 0) ? ok : bad)(`bookShipment locks the destination value (${r.brass}d)`);
  (g.player.countItem(I.COAL_LUMP) === 10 ? ok : bad)('the shipped coal left the pack');
  (g.player.shipments.length === 1 ? ok : bad)('the shipment is recorded in transit');
  (e.tickShipments(0.1).length === 0 && g.player.brass === 0 ? ok : bad)('a shipment in transit pays nothing yet');
  const delivered = e.tickShipments(0 + DELIVERY_DELAY);
  (delivered.length === 1 && g.player.brass === r.brass && g.player.shipments.length === 0 ? ok : bad)(`on arrival the brass lands and the shipment clears (purse ${g.player.brass}d)`);
}
{
  const g = fakeGame(0, { [I.COAL_LUMP]: 5 });
  const e = new Economy(g);
  (e.bookShipment([[I.COAL_LUMP, 5]], 'Rosedale Abbey', 'Rosedale Abbey', 0).ok === false ? ok : bad)('cannot ship to where you stand');
  (e.bookShipment([[I.COAL_LUMP, 999]], 'Whitby', 'Rosedale Abbey', 0).ok === false ? ok : bad)('over the freight allowance is refused');
  (e.bookShipment([[I.COAL_LUMP, 5]], 'Whitby', 'Rosedale Abbey', 0).ok === true ? ok : bad)('a valid shipment within allowance books');
}

// --- SP2 Task 5: bookShipment rejects malformed parcels (money is uncheatable) ---
{
  const g = fakeGame(0, { [I.COAL_LUMP]: 200 });
  const e = new Economy(g);
  (e.bookShipment([], 'Whitby', 'Rosedale Abbey', 0).ok === false ? ok : bad)('an empty parcel is refused');
  (e.bookShipment([[I.COAL_LUMP, -5]], 'Whitby', 'Rosedale Abbey', 0).ok === false ? ok : bad)('a negative quantity is refused');
  (e.bookShipment([[I.COAL_LUMP, 2.5]], 'Whitby', 'Rosedale Abbey', 0).ok === false ? ok : bad)('a fractional quantity is refused');
  (e.bookShipment([[I.COAL_LUMP, 100], [I.COAL_LUMP, -50]], 'Whitby', 'Rosedale Abbey', 0).ok === false ? ok : bad)('a +/- parcel that nets under the cap is still refused');
  (e.bookShipment([[I.COAL_LUMP, 5]], 'Whitby', 'whitby', 0).ok === false ? ok : bad)('the same place is refused case-insensitively');
  (g.player.countItem(I.COAL_LUMP) === 200 && g.player.shipments.length === 0 ? ok : bad)('a refused booking removes no goods and records no shipment');
}

// --- SP2 Task 6: the drop-in purse is keyed to the vendor, not the raw name ---
{
  const g = fakeGame(0, { [I.JET_GEM]: 5 });
  const e = new Economy(g);
  const v = { t: { name: 'Fishwife Annie', village: 'Whitby' }, displayName: 'Annie' };
  e.dropInSell(v, I.JET_GEM);
  (g.player.vendorPurses['annie'] != null ? ok : bad)('the purse is keyed to the vendor (annie)');
  (g.player.vendorPurses['fishwife annie'] == null ? ok : bad)('the purse is not keyed to the decorated display name');
}

// --- SP2 Task 7: coverage gaps the review flagged (existing behaviour, pinned) ---
{
  // a shipment booked, saved, reloaded, then delivered in the next session
  const stub = { getBlock() { return 0; }, isLoaded() { return true; } };
  const p1 = new Player(stub); p1.addItem(I.COAL_LUMP, 20);
  const e1 = new Economy(gameWith(p1));
  const r = e1.bookShipment([[I.COAL_LUMP, 10]], 'Whitby', 'Rosedale Abbey', 0);
  const p2 = new Player(stub); p2.deserialize(p1.serialize());
  const before = p2.brass;
  const e2 = new Economy(gameWith(p2));
  const delivered = e2.tickShipments(DELIVERY_DELAY);
  (delivered.length === 1 && p2.brass === before + r.brass && p2.shipments.length === 0 ? ok : bad)
    (`a shipment booked before a save delivers after reload (purse ${p2.brass}d)`);
}
{
  // draining one vendor's purse must leave another's untouched
  const g = fakeGame(0, { [I.JET_GEM]: 50 });
  const e = new Economy(g);
  const annie = { t: { name: 'fishwife annie', village: 'Whitby' }, displayName: 'Annie' };
  for (let i = 0; i < 50; i++) e.dropInSell(annie, I.JET_GEM);
  (e.purseOf('owd tom') === PURSE_MAX ? ok : bad)('draining one vendor purse leaves another full');
}
{
  // a refill must clamp at the cap regardless of how long it has been
  const g = fakeGame(0, {});
  const e = new Economy(g);
  g.player.vendorPurses['annie'] = PURSE_MAX - 5; g.player.pursesAt = 0;
  e.refillPurses(100);
  (g.player.vendorPurses['annie'] === PURSE_MAX ? ok : bad)('a refill clamps at the cap, never above');
}
{
  // the deal's village: the villager's home if known, else where the player stands
  const g = fakeGame(0, {});
  g.geo = { village: { name: 'Staithes' } };
  const e = new Economy(g);
  (e.villageOf({ t: { name: 'annie' } }) === 'Staithes' ? ok : bad)('villageOf falls back to the player village');
  (e.villageOf({ t: { name: 'annie', village: 'Whitby' } }) === 'Whitby' ? ok : bad)('villageOf prefers the villager home');
}

console.log('RESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
