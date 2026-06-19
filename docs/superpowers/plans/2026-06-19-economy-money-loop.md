# Economy Money Loop — Implementation Plan (SP1, slice A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real brass currency with a per-vendor till so every good can be bought and sold for money at prices that differ by village, replacing the old barter swaps.

**Architecture:** A new headless-testable module `src/economy.js` holds the pure money logic (pence formatting, a base-price catalogue, regional price spreads, the price function, and per-vendor sell/buy lists) plus an `Economy` class that binds those to the live game (the player's `brass` wallet, buying and selling). The player gains a `brass` field that saves and loads. The chat panel's barter buttons become buy/sell buttons, and the HUD shows the player's brass.

**Tech stack:** Vanilla ES modules, three.js game (DOM UI in `ui.js`). Tests are plain Node scripts run with `node scripts/verify-*.mjs`, following the existing `scripts/verify-villagers.mjs` pattern (no test framework). The money module is written with no THREE/DOM imports so it can be imported and tested headless.

**Scope of this plan (slice A):** currency, wallet, save/load, prices + spreads, the till (buy/sell), the brass HUD readout. **Deferred to a follow-up plan (slice B):** the dedicated Exchange screen (the price grid + teaching tooltips), converting quest/job rewards from items to brass, and paying the train fare in brass. This slice is independently shippable: a player can already earn brass by selling produce to vendors and spend it buying goods, with real geographic spreads.

---

## File structure

- **Create `src/economy.js`** — the money module. Module-level pure exports (`formatBrass`, `PRICES`, `regionMult`, `priceOf`, `VENDORS`, `vendorFor`, `STARTING_BRASS`) and the game-bound `Economy` class. One responsibility: money and prices.
- **Create `scripts/verify-economy.mjs`** — headless tests for the pure money logic and the `Economy` class (with a fake-game stub), mirroring `scripts/verify-villagers.mjs`.
- **Modify `src/player.js`** — add the `brass` field; persist it in `serialize`/`deserialize` with a starting-purse migration.
- **Modify `src/main.js`** — instantiate `this.economy` on the game.
- **Modify `src/ui.js`** — replace the barter buttons in `renderChatActions` with buy/sell buttons; add a brass readout to the HUD.

The old barter API in `src/quests.js` (`tradesFor`, `doTrade`) is left in place but no longer called by the UI after this slice; a later cleanup task (Task 8) deletes it.

---

## Task 1: Money formatting (`formatBrass`)

**Files:**
- Create: `src/economy.js`
- Test: `scripts/verify-economy.mjs`

- [ ] **Step 1: Write the failing test**

Create `scripts/verify-economy.mjs`:

```js
// Economy logic check — run wi': node scripts/verify-economy.mjs
import { formatBrass } from '../src/economy.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const eq = (got, want, m) => (got === want ? ok : bad)(`${m} (got ${JSON.stringify(got)})`);

// pence -> £sd (12d = 1s, 20s = £1 = 240d)
eq(formatBrass(0), '0d', 'zero is 0d');
eq(formatBrass(11), '11d', 'pence under a shilling');
eq(formatBrass(12), '1s', 'exactly a shilling');
eq(formatBrass(18), '1s 6d', 'shillings and pence');
eq(formatBrass(60), '5s', 'the starting purse reads 5s');
eq(formatBrass(294), '£1 4s 6d', 'pounds, shillings and pence');
eq(formatBrass(-5), '0d', 'never negative');

console.log('RESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/verify-economy.mjs`
Expected: error `Cannot find module '../src/economy.js'` (the module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `src/economy.js`:

```js
// economy.js — brass currency, prices, regional spreads, the vendor till, and the
// spot-trade primitive. The pure data + helpers are module-level so this file can be
// imported and unit-tested headless (no THREE, no DOM), like villagerlife.js. The
// Economy class binds them to the live game (the player's wallet, toasts, audio).
import { B, I, itemName } from './defs.js';

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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node scripts/verify-economy.mjs`
Expected: all `ok`, `RESULT: PASS`.

- [ ] **Step 5: Commit**

```bash
git add src/economy.js scripts/verify-economy.mjs
git commit -m "feat(economy): brass currency formatting (pence -> £sd)"
```

---

## Task 2: Prices and regional spreads (`PRICES`, `regionMult`, `priceOf`)

**Files:**
- Modify: `src/economy.js`
- Test: `scripts/verify-economy.mjs`

- [ ] **Step 1: Add the failing tests**

Append to `scripts/verify-economy.mjs` (above the `RESULT` line), and add `priceOf, PRICES` to the import from `../src/economy.js`:

```js
import { I } from '../src/defs.js';

// every good with a base price can be priced at a village
(PRICES[I.COAL_LUMP] > 0 ? ok : bad)('coal has a base price');
(priceOf(I.PARCEL, 'Whitby', 'buy') === null ? ok : bad)('a non-tradeable item has no price');

// regional spreads: coal is cheap at the pit-head, dear at the coast
{
  const atKiln = priceOf(I.COAL_LUMP, 'Rosedale Abbey', 'sell');
  const atCoast = priceOf(I.COAL_LUMP, 'Whitby', 'sell');
  (atCoast > atKiln ? ok : bad)(`coal sells dearer at the coast than the pit-head (${atKiln}d vs ${atCoast}d)`);
}

// the margin rule: a round trip at ONE vendor is a loss (no free money)
{
  const buyHere = priceOf(I.JET_GEM, 'Whitby', 'buy');
  const sellHere = priceOf(I.JET_GEM, 'Whitby', 'sell');
  (sellHere < buyHere ? ok : bad)(`round trip at one vendor loses (buy ${buyHere}d, sell ${sellHere}d)`);
}

// arbitrage works: buy cheap at the source, sell dear elsewhere, net gain
{
  const buyAtKiln = priceOf(I.COAL_LUMP, 'Rosedale Abbey', 'buy');
  const sellAtCoast = priceOf(I.COAL_LUMP, 'Whitby', 'sell');
  (sellAtCoast > buyAtKiln ? ok : bad)(`hauling coal kiln->coast pays (buy ${buyAtKiln}d, sell ${sellAtCoast}d)`);
}

// standing improves your side of the deal
{
  const plain = priceOf(I.IRON_INGOT, 'Pickering', 'sell', 0);
  const valued = priceOf(I.IRON_INGOT, 'Pickering', 'sell', 4);
  (valued >= plain ? ok : bad)(`good standing sells no worse (${plain}d -> ${valued}d)`);
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/verify-economy.mjs`
Expected: FAIL — `priceOf is not a function` / `PRICES` undefined.

- [ ] **Step 3: Implement prices, spreads and the price function**

Append to `src/economy.js`:

```js
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node scripts/verify-economy.mjs`
Expected: all `ok`, `RESULT: PASS`.

- [ ] **Step 5: Commit**

```bash
git add src/economy.js scripts/verify-economy.mjs
git commit -m "feat(economy): base prices, regional spreads, and the price function"
```

---

## Task 3: Vendor sell/buy catalogues (`VENDORS`, `vendorFor`)

**Files:**
- Modify: `src/economy.js`
- Test: `scripts/verify-economy.mjs`

- [ ] **Step 1: Add the failing tests**

Append to `scripts/verify-economy.mjs` (add `vendorFor, VENDORS` to the economy import):

```js
// vendor lookup is by lowercase substring of the villager's name
{
  const tom = vendorFor('Owd Tom');
  (tom && tom.buys.includes(I.JET_GEM) ? ok : bad)('Owd Tom buys jet');
  (vendorFor('Driver Wassell') ? ok : bad)('a line villager is a vendor');
  (vendorFor('nobody at all') === null ? ok : bad)('an unknown name is no vendor');
}
// every vendor good has a price (no un-priceable stock or wants)
{
  let priced = true;
  for (const v of Object.values(VENDORS))
    for (const id of [...v.sells, ...v.buys]) if (PRICES[id] == null) priced = false;
  (priced ? ok : bad)('every vendor good has a base price');
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/verify-economy.mjs`
Expected: FAIL — `vendorFor is not a function`.

- [ ] **Step 3: Implement the vendor catalogues**

Append to `src/economy.js`:

```js
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node scripts/verify-economy.mjs`
Expected: all `ok`, `RESULT: PASS`.

- [ ] **Step 5: Commit**

```bash
git add src/economy.js scripts/verify-economy.mjs
git commit -m "feat(economy): per-vendor sell/buy catalogues"
```

---

## Task 4: The `Economy` class (wallet ops + the spot trade)

**Files:**
- Modify: `src/economy.js`
- Test: `scripts/verify-economy.mjs`

- [ ] **Step 1: Add the failing tests (with a fake-game stub)**

Append to `scripts/verify-economy.mjs` (add `Economy, STARTING_BRASS` to the economy import):

```js
// a tiny fake game/player so the game-bound class can be tested headless
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
  // sell a jet at Whitby: removes the jet, adds its sell price in brass
  const g = fakeGame(0, { [I.JET_GEM]: 1 });
  const e = new Economy(g);
  const v = { t: { name: 'fishwife annie', village: 'Whitby' } };
  const got = e.doSell(v, I.JET_GEM);
  (got && g.player.brass === priceOf(I.JET_GEM, 'Whitby', 'sell') && g.player.countItem(I.JET_GEM) === 0 ? ok : bad)
    (`doSell pays the sell price and takes the good (purse ${g.player.brass}d)`);
}
{
  // buy coal at Rosedale: deducts the buy price, adds the good
  const g = fakeGame(50);
  const e = new Economy(g);
  const v = { t: { name: 'owd tom', village: 'Rosedale Abbey' } };
  const p = priceOf(I.COAL_LUMP, 'Rosedale Abbey', 'buy');
  const got = e.doBuy(v, I.COAL_LUMP);
  (got && g.player.brass === 50 - p && g.player.countItem(I.COAL_LUMP) === 1 ? ok : bad)
    (`doBuy charges the buy price and gives the good (paid ${p}d)`);
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/verify-economy.mjs`
Expected: FAIL — `Economy is not a constructor`.

- [ ] **Step 3: Implement the `Economy` class**

Append to `src/economy.js`:

```js
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node scripts/verify-economy.mjs`
Expected: all `ok`, `RESULT: PASS`.

- [ ] **Step 5: Commit**

```bash
git add src/economy.js scripts/verify-economy.mjs
git commit -m "feat(economy): Economy class — wallet ops and the spot buy/sell trade"
```

---

## Task 5: The player's brass wallet (field + save/load + migration)

**Files:**
- Modify: `src/player.js:11-39` (constructor), `src/player.js:319-347` (serialize/deserialize)
- Test: `scripts/verify-economy.mjs`

- [ ] **Step 1: Add the failing test**

Append to `scripts/verify-economy.mjs` (add an import line at the top: `import { Player } from '../src/player.js';`):

```js
// the wallet saves and loads; old saves with no wallet get the starting purse
{
  const p = new Player({ getBlock() { return 0; }, isLoaded() { return true; } });
  (p.brass === STARTING_BRASS ? ok : bad)(`a fresh player starts with ${STARTING_BRASS}d`);
  p.brass = 123;
  const saved = p.serialize();
  (saved.brass === 123 ? ok : bad)('serialize writes brass');
  const p2 = new Player({ getBlock() { return 0; }, isLoaded() { return true; } });
  p2.deserialize(saved);
  (p2.brass === 123 ? ok : bad)('deserialize restores brass');
  const p3 = new Player({ getBlock() { return 0; }, isLoaded() { return true; } });
  p3.deserialize({ pos: { x: 0, y: 0, z: 0 } }); // an old save, no brass field
  (p3.brass === STARTING_BRASS ? ok : bad)('an old save migrates to the starting purse');
}
```

Note: `Player`'s constructor only stores the `world` arg and reads no blocks at construction, so the stub above is enough; `deserialize` touches only plain fields.

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/verify-economy.mjs`
Expected: FAIL — `a fresh player starts with 60d` (p.brass is `undefined`).

- [ ] **Step 3: Add the brass field and persistence**

In `src/player.js`, import the starting purse — change the top import line:

```js
import { B, BLOCKS, FOODS, TOOLS, maxStack, isLiquid } from './defs.js';
import { STARTING_BRASS } from './economy.js';
```

In the constructor (after `this.fuelBank = 0;`, around line 32), add:

```js
    this.brass = STARTING_BRASS; // pence in thi purse
```

In `serialize()` (around line 324, alongside `fuelBank`), add `brass`:

```js
      slots: this.slots, hotbar: this.hotbar, fuelBank: this.fuelBank, brass: this.brass,
```

In `deserialize(d)` (around line 340, after `this.fuelBank = ...`), add the migrating line:

```js
    this.brass = d.brass ?? STARTING_BRASS;
```

Note: `economy.js` imports only pure data from `defs.js`, and `player.js` already imports `defs.js`, so importing `STARTING_BRASS` from `economy.js` creates no THREE/DOM dependency and no import cycle that runs code at load (both modules only define values/classes at import).

- [ ] **Step 4: Run it to verify it passes**

Run: `node scripts/verify-economy.mjs`
Expected: all `ok`, `RESULT: PASS`.

- [ ] **Step 5: Commit**

```bash
git add src/player.js scripts/verify-economy.mjs
git commit -m "feat(player): brass wallet field with save/load and starting-purse migration"
```

---

## Task 6: Wire the Economy into the game

**Files:**
- Modify: `src/main.js` (near `this.quests = new Quests(this);`, line 282)

- [ ] **Step 1: Add the import**

At the top of `src/main.js`, with the other module imports, add:

```js
import { Economy } from './economy.js';
```

- [ ] **Step 2: Instantiate it on the game**

Immediately after `this.quests = new Quests(this);` (line 282), add:

```js
    this.economy = new Economy(this);
```

(`economy` needs `this.player`, `this.ui` and `this.quests`, all created by this point; it only reads them at call time, so order beyond this is not critical.)

- [ ] **Step 3: Smoke-check the module loads**

Run the dev server and confirm no console error at boot:

Run: `npm run dev` (or the project's dev command), open the preview, check the browser console shows no `economy` import/Reference errors and the game reaches the title screen.

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat(economy): instantiate Economy on the game"
```

---

## Task 7: The till — buy/sell buttons in the chat panel

**Files:**
- Modify: `src/ui.js:544-587` (`renderChatActions`)

This replaces the barter-swap buttons (the `for (const t of q.tradesFor(...))` loop) with buy and sell buttons priced in brass. The quest "Tek t' job" / "Hand ower" buttons above are left untouched.

- [ ] **Step 1: Replace the barter loop**

In `src/ui.js`, in `renderChatActions()`, replace the whole `for (const t of q.tradesFor(v.t.name)) { ... }` block (lines ~573-586) with:

```js
    const econ = this.game.economy;
    if (econ) {
      for (const { id, price } of econ.buyList(v)) {
        const b = this.el('button', 'mc chat-btn trade-btn', this.chatQuestRow,
          `Buy ${itemName(id)} — <b>${econ.format(price)}</b>`);
        if (econ.canAfford(price)) {
          b.addEventListener('click', () => {
            if (econ.doBuy(v, id)) {
              v.chatLog.push({ who: 'sys', text: `Bought ${itemName(id)} for ${econ.format(price)}.` });
              this.renderChatLog(); this.renderChatActions();
            }
          });
        } else {
          b.classList.add('locked');
          this.bindTooltip(b, `Tha needs ${econ.format(price)} for that.`);
        }
      }
      for (const { id, price } of econ.sellList(v)) {
        const b = this.el('button', 'mc chat-btn trade-btn', this.chatQuestRow,
          `Sell ${itemName(id)} — <b>${econ.format(price)}</b>`);
        b.addEventListener('click', () => {
          if (econ.doSell(v, id)) {
            v.chatLog.push({ who: 'sys', text: `Sold ${itemName(id)} for ${econ.format(price)}.` });
            this.renderChatLog(); this.renderChatActions();
          }
        });
      }
    }
```

The buy/sell lists are recomputed on every `renderChatActions()`, so after a sale the held-items filter drops sold-out goods and prices reflect the new standing/purse.

- [ ] **Step 2: Verify in the preview**

Run the dev server, walk to a vendor (e.g. Owd Tom or Fishwife Annie), open chat (right-click), and confirm: buy buttons show their goods with a brass price; sell buttons appear only for goods you are carrying; clicking buy deducts brass and adds the item; clicking sell removes the item and adds brass; an unaffordable buy is greyed with a tooltip. Use the preview snapshot/click tools to drive this and confirm the chat log lines appear.

- [ ] **Step 3: Commit**

```bash
git add src/ui.js
git commit -m "feat(ui): the till — buy/sell goods for brass in the chat panel"
```

---

## Task 8: Brass on the HUD, and retire the dead barter code

**Files:**
- Modify: `src/ui.js:68` (HUD build), `src/ui.js:786` (HUD refresh on invDirty)
- Modify: `src/quests.js:1098-1194` (remove `tradesFor`/`doTrade`)

- [ ] **Step 1: Add the brass readout element**

In `src/ui.js` `buildDOM()`, just after the stats row is created (`const stats = this.el('div', '', this.hud); stats.id = 'stats';`, line 68), add:

```js
    this.brassEl = this.el('div', '', stats); this.brassEl.id = 'brass';
```

- [ ] **Step 2: Refresh it when the inventory/purse changes**

In `src/ui.js`, find the `if (this.invDirty) { this.renderHotbar(player); this.invDirty = false; }` block (line 786) and add the brass update inside it:

```js
    if (this.invDirty) {
      this.renderHotbar(player);
      if (this.brassEl && this.game.economy) this.brassEl.textContent = '♁ ' + this.game.economy.format(player.brass);
      this.invDirty = false;
    }
```

(`earn`/`spend` already set `invDirty = true`, so the readout updates on every transaction. The `♁` is a stand-in coin glyph; swap for a styled coin icon later.)

- [ ] **Step 3: Verify in the preview**

Run the dev server; confirm the HUD shows the starting purse (5s) and that buying/selling at a vendor updates the number immediately.

- [ ] **Step 4: Remove the now-unused barter API**

In `src/quests.js`, delete the `tradesFor(villagerName) { ... }` method and the `doTrade(trade) { ... }` method (the block from the `// ---------------- barter ----------------` comment through the end of `doTrade`, lines ~1098-1194). Nothing calls them after Task 7.

- [ ] **Step 5: Verify nothing references the removed methods**

Run: `grep -rn "tradesFor\|doTrade" src/`
Expected: no matches (the UI now uses `economy.buyList`/`sellList`/`doBuy`/`doSell`).

- [ ] **Step 6: Run the economy tests once more**

Run: `node scripts/verify-economy.mjs`
Expected: `RESULT: PASS`.

- [ ] **Step 7: Commit**

```bash
git add src/ui.js src/quests.js
git commit -m "feat(ui): brass on the HUD; retire the old barter swaps"
```

---

## Done when

- `node scripts/verify-economy.mjs` passes.
- A player can sell produce to a vendor for brass and buy goods with it, with prices that differ by village (coal cheap at Rosedale, dear at Whitby).
- Brass shows on the HUD and persists across save/load; an old save loads with the starting purse.
- No references to the old `tradesFor`/`doTrade` remain.

## Deferred to slice B (a second plan)

- The dedicated **Exchange screen**: the goods-by-village price grid, colour/arrow coded, with the plain-English teaching tooltips (the legibility-for-a-ten-year-old surface).
- **Brass payouts:** convert job/delivery/bounty/commission rewards in `quests.js` from items to brass (keeping the story-beat item rewards).
- **Fares in brass:** charge the train fare via `economy.spend` instead of coal.
- Tool-repair-for-brass as a vendor service (the use-driven poverty sink).
