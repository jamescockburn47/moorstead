// economy.js — brass currency, prices, regional spreads, the vendor till, and the
// spot-trade primitive. The pure data + helpers are module-level so this file can be
// imported and unit-tested headless (no THREE, no DOM), like villagerlife.js. The
// Economy class binds them to the live game (the player's wallet, toasts, audio).
import { B, I } from './defs.js';

export const STARTING_BRASS = 60; // five shillings, enough to prime the pump

// Pence -> period £sd text. 12 pence = 1 shilling, 20 shillings = £1 = 240 pence.
export function formatBrass(pence) {
  pence = Math.max(0, Math.round(pence || 0));
  const pounds = Math.floor(pence / 240);
  const shillings = Math.floor((pence % 240) / 12);
  const d = pence % 12;
  const parts = [];
  if (pounds) parts.push('£' + pounds);
  if (shillings) parts.push(shillings + 's');
  if (d || parts.length === 0) parts.push(d + 'd');
  return parts.join(' ');
}

// Base worth of a good, in pence, "at par" (before regional spread and the vendor's cut).
export const PRICES = {
  [I.COAL_LUMP]: 3, [I.RAW_IRON]: 5, [I.IRON_INGOT]: 14, [I.JET_GEM]: 40,
  [B.WOOL]: 6, [B.HEATHER]: 1, [B.BRACKEN]: 1,
  [I.BILBERRIES]: 1,
  [I.RAW_MUTTON]: 4, [I.COOKED_MUTTON]: 9,
  [I.RAW_GROUSE]: 3, [I.COOKED_GROUSE]: 8,
  [I.RAW_BEEF]: 4, [I.COOKED_BEEF]: 9,
  [I.SEA_FISH]: 3, [I.RAW_TROUT]: 3, [I.COOKED_FISH]: 10, [I.FISH_CHIPS]: 14,
  [I.AMMONITE]: 8, [I.GRYPHAEA]: 5,
  [B.PLANKS]: 2, [B.COBBLE]: 1, [B.STONEBRICK]: 4, [I.STICK]: 1,
  [B.TORCH]: 4, [B.LANTERN]: 30,
  [I.W_PICK]: 6, [I.S_PICK]: 18, [I.I_PICK]: 60,
};

// Regional spreads: a multiplier on the base price, by village. Missing village = 1 (par).
// Deliberately BIG: the spread is the wage for the journey. Held as data so new goods and
// regions slot in without code changes (the program-wide "incentives are data" principle).
const SPREAD = {
  [I.COAL_LUMP]: { rosedale: 0.5, grosmont: 0.6, whitby: 1.9, staithes: 1.9 },
  [I.JET_GEM]:   { rosedale: 0.7, goathland: 0.8, whitby: 1.9, pickering: 1.7 },
  [I.SEA_FISH]:  { whitby: 0.5, staithes: 0.5, moorstead: 1.7, rosedale: 1.8, pickering: 1.8 },
  [I.COOKED_FISH]: { whitby: 0.6, staithes: 0.6, moorstead: 1.6, rosedale: 1.7 },
  [B.WOOL]:      { moorstead: 0.6, goathland: 0.7, whitby: 1.6, pickering: 1.6 },
  [I.IRON_INGOT]:{ rosedale: 0.8, grosmont: 0.9, whitby: 1.5, staithes: 1.5 },
};
export function regionMult(village, itemId) {
  const v = (village || '').toLowerCase();
  const m = SPREAD[itemId];
  if (!m) return 1;
  for (const key of Object.keys(m)) if (v.includes(key)) return m[key];
  return 1;
}

// The vendor's cut. side 'buy' = the vendor sells TO you (dearer); 'sell' = the vendor buys
// FROM you (cheaper). The gap guarantees a round trip at one vendor is a loss.
const MARGIN = { buy: 1.25, sell: 0.85 };

// Price a vendor quotes for one unit, in whole pence. standingIdx (0..n) nudges your side.
export function priceOf(itemId, village, side, standingIdx = 0) {
  const base = PRICES[itemId];
  if (base == null) return null; // not tradeable
  const margin = MARGIN[side] || 1;
  const loyalty = side === 'buy' ? (1 - 0.02 * standingIdx) : (1 + 0.02 * standingIdx);
  return Math.max(1, Math.round(base * regionMult(village, itemId) * margin * loyalty));
}

// --- SP2 trade-logistics tuning (all adjustable) ---
// TIME CONTRACT: the `now` passed to bookShipment/tickShipments/refillPurses is GAME-DAYS,
// i.e. (sky.day + sky.time) — monotonic and save-persisted, so a shipment booked before a
// save still arrives after reload. Never wall-clock (performance.now/Date.now): milliseconds
// would make delivery effectively instant and refill a purse to full every frame.
export const DROP_IN_PENALTY = 0.6;   // a drop-in pays this fraction of the local sell price
export const FREIGHT_ALLOWANCE = 96;  // max units a merchant may ship at once (Slice A fixed; SP5 upgrades it)
export const DELIVERY_DELAY = 0.5;    // game-days a shipment takes to arrive (half a day)
export const PURSE_MAX = 120;         // a village vendor's drop-in purse cap, in pence
export const PURSE_REFILL = 120;      // pence a purse recovers per game-day, toward PURSE_MAX (≈ one day to refill)

// What a vendor pays for one unit sold on the spot: the local sell price, penalised.
export function dropInPrice(itemId, village, standingIdx = 0) {
  const p = priceOf(itemId, village, 'sell', standingIdx);
  return p == null ? null : Math.max(1, Math.round(p * DROP_IN_PENALTY));
}

// Total locked brass for a parcel of goods sold at the destination market.
// goods is [[itemId, count], ...]. Returns null if any good is not tradeable.
export function shipmentValue(goods, destVillage, standingIdx = 0) {
  let total = 0;
  for (const [id, n] of goods) {
    const p = priceOf(id, destVillage, 'sell', standingIdx);
    if (p == null) return null;
    total += p * n;
  }
  return total;
}

// What each villager sells (to you) and buys (from you). Keyed by lowercase substring of the
// name, so "Owd Tom" matches "tom". Roles shape the stock; "mag" is the general dealer.
// Data, not code — the roster and stock grow over time without touching the engine.
export const VENDORS = {
  james:  { sells: [B.WOOL, I.COOKED_MUTTON],            buys: [I.BILBERRIES, B.WOOL, B.HEATHER] },
  glinda: { sells: [B.WOOL, B.LANTERN],                  buys: [B.HEATHER, I.AMMONITE] },
  harry:  { sells: [I.BILBERRIES],                       buys: [I.AMMONITE, I.GRYPHAEA, I.RAW_GROUSE] },
  martha: { sells: [I.COOKED_MUTTON, I.COOKED_GROUSE, I.FISH_CHIPS], buys: [I.RAW_MUTTON, I.RAW_GROUSE] },
  tom:    { sells: [I.RAW_IRON, I.COAL_LUMP, I.S_PICK],  buys: [I.COAL_LUMP, I.RAW_IRON, I.JET_GEM] },
  briggs: { sells: [I.COAL_LUMP],                        buys: [B.WOOL, I.AMMONITE, I.COAL_LUMP] },
  ned:    { sells: [I.SEA_FISH],                         buys: [B.WOOL, I.SEA_FISH, I.RAW_TROUT] },
  annie:  { sells: [I.FISH_CHIPS, I.COOKED_FISH],        buys: [I.SEA_FISH, I.RAW_TROUT, I.AMMONITE, I.JET_GEM] },
  silas:  { sells: [],                                   buys: [I.JET_GEM, I.AMMONITE] },
  mag:    { sells: [I.W_PICK, I.S_PICK, I.STICK, B.PLANKS], buys: [B.WOOL, I.GRYPHAEA, I.IRON_INGOT, I.JET_GEM, I.COAL_LUMP, I.AMMONITE] },
  joe:    { sells: [I.COAL_LUMP],                        buys: [I.COOKED_MUTTON, I.FISH_CHIPS] },
  wassell:{ sells: [],                                   buys: [I.COOKED_MUTTON] },
};

export function vendorFor(name) {
  const n = (name || '').toLowerCase();
  for (const key of Object.keys(VENDORS)) if (n.includes(key)) return VENDORS[key];
  return null;
}

// The stable vendor identity (the matched roster key), used to key the drop-in purse so it
// tracks the vendor, not a decorated display name like "Fishwife Annie". Null = no vendor.
export function vendorKey(name) {
  const n = (name || '').toLowerCase();
  for (const key of Object.keys(VENDORS)) if (n.includes(key)) return key;
  return null;
}

export class Economy {
  constructor(game) { this.game = game; }

  format(pence) { return formatBrass(pence); }
  get balance() { return this.game.player.brass || 0; }
  canAfford(pence) { return this.balance >= pence; }

  earn(pence) {
    this.game.player.brass = this.balance + Math.max(0, Math.round(pence));
    this.game.ui.invDirty = true;
  }
  spend(pence) {
    if (!this.canAfford(pence)) return false;
    this.game.player.brass = this.balance - pence;
    this.game.ui.invDirty = true;
    return true;
  }

  // the village the deal happens in: the villager's home, else the player's current village
  villageOf(villager) {
    if (villager && villager.t && villager.t.village) return villager.t.village;
    return this.game.geo && this.game.geo.village ? this.game.geo.village.name : '';
  }
  standing() { return this.game.quests ? this.game.quests.standingIndex() : 0; }

  // [{ id, price }] this villager will sell to you / buy from you (the latter filtered to held)
  buyList(villager) {
    const v = vendorFor(villager && villager.t && villager.t.name);
    if (!v) return [];
    const village = this.villageOf(villager), s = this.standing();
    return v.sells.map(id => ({ id, price: priceOf(id, village, 'buy', s) })).filter(x => x.price != null);
  }
  sellList(villager) {
    const v = vendorFor(villager && villager.t && villager.t.name);
    if (!v) return [];
    const village = this.villageOf(villager), s = this.standing();
    return v.buys
      .filter(id => this.game.player.countItem(id) > 0)
      .map(id => ({ id, price: priceOf(id, village, 'sell', s) })).filter(x => x.price != null);
  }

  doBuy(villager, itemId) {
    const price = priceOf(itemId, this.villageOf(villager), 'buy', this.standing());
    if (price == null) return false;
    if (!this.spend(price)) {
      this.game.ui.toast(`Tha's not the brass for that (${formatBrass(price)}).`);
      return false;
    }
    const left = this.game.player.addItem(itemId, 1);
    if (left > 0) this.game.dropAtPlayer(itemId, left);
    this.game.audio.pickup();
    return true;
  }
  doSell(villager, itemId) {
    if (this.game.player.countItem(itemId) < 1) return false;
    const price = priceOf(itemId, this.villageOf(villager), 'sell', this.standing());
    if (price == null) return false;
    this.game.player.removeItem(itemId, 1);
    this.earn(price);
    this.game.audio.pickup();
    return true;
  }

  // --- SP2: drop-in selling, capped by the vendor's shallow brass purse ---
  purseOf(name) {
    const key = vendorKey(name) || (name || '').toLowerCase();
    const purses = this.game.player.vendorPurses;
    if (purses[key] == null) purses[key] = PURSE_MAX;
    return purses[key];
  }
  refillPurses(now) {
    const purses = this.game.player.vendorPurses;
    const dt = Math.max(0, now - (this.game.player.pursesAt || 0));
    if (dt <= 0) return;
    for (const k of Object.keys(purses)) purses[k] = Math.min(PURSE_MAX, purses[k] + PURSE_REFILL * dt);
    this.game.player.pursesAt = now;
  }
  dropInSell(villager, itemId) {
    if (this.game.player.countItem(itemId) < 1) return false;
    const price = dropInPrice(itemId, this.villageOf(villager), this.standing());
    if (price == null) return false;
    const name = villager && villager.t && villager.t.name;
    const key = vendorKey(name) || (name || '').toLowerCase();
    if (this.purseOf(name) < price) {
      this.game.ui.toast(`${(villager && villager.displayName) || 'They'}'ve no more brass to spare just now.`);
      return false;
    }
    this.game.player.removeItem(itemId, 1);
    this.game.player.vendorPurses[key] -= price;
    this.earn(price);
    this.game.audio.pickup();
    return true;
  }

  // --- SP2: book a forward shipment to a distant market; it pays on arrival ---
  bookShipment(goods, destVillage, originVillage, now) {
    // Validate the parcel at the engine boundary: counts arrive from UI and a
    // shipment mints brass, so a malformed parcel must never book (uncheatable money).
    if (!Array.isArray(goods) || goods.length === 0) return { ok: false, why: 'nothing to ship' };
    for (const g of goods) {
      if (!Array.isArray(g) || g.length < 2 || !Number.isInteger(g[1]) || g[1] <= 0)
        return { ok: false, why: 'bad quantity' };
    }
    const norm = s => (s || '').trim().toLowerCase();
    if (!destVillage || norm(destVillage) === norm(originVillage)) return { ok: false, why: 'same place' };
    const units = goods.reduce((a, g) => a + g[1], 0);
    if (units > FREIGHT_ALLOWANCE) return { ok: false, why: 'over freight allowance' };
    for (const [id, n] of goods) if (this.game.player.countItem(id) < n) return { ok: false, why: 'goods not held' };
    const brass = shipmentValue(goods, destVillage, this.standing());
    if (brass == null) return { ok: false, why: 'not tradeable' };
    for (const [id, n] of goods) this.game.player.removeItem(id, n);
    const shipment = { goods, dest: destVillage, brass, arrivesAt: now + DELIVERY_DELAY };
    this.game.player.shipments.push(shipment);
    return { ok: true, brass, arrivesAt: shipment.arrivesAt };
  }
  tickShipments(now) {
    const all = this.game.player.shipments;
    const due = all.filter(s => now >= s.arrivesAt);
    for (const s of due) {
      this.earn(s.brass);
      this.game.ui.toast(`Thi shipment reached ${s.dest}: sold for ${formatBrass(s.brass)}.`);
    }
    if (due.length) this.game.player.shipments = all.filter(s => now < s.arrivesAt);
    return due;
  }
}
