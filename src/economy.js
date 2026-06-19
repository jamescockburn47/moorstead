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
export const DROP_IN_PENALTY = 0.6;   // a drop-in pays this fraction of the local sell price
export const FREIGHT_ALLOWANCE = 96;  // max units a merchant may ship at once (Slice A fixed; SP5 upgrades it)
export const DELIVERY_DELAY = 0.5;    // game-time a shipment takes to arrive (unit fixed when wired in plan 2)
export const PURSE_MAX = 120;         // a village vendor's drop-in purse cap, in pence
export const PURSE_REFILL = 120;      // pence a purse recovers per unit of game-time, toward PURSE_MAX

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
}
