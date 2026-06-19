# Trade Logistics Engine — Implementation Plan (SP2 Slice A, plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the headless-testable trade-logistics engine to `economy.js`: drop-in pricing, the per-vendor brass purse that caps drop-in volume, shipment booking and timed delivery, and the freight allowance, with the player state persisted.

**Architecture:** Pure additions to the existing `src/economy.js` (the SP1 money module). New module-level price helpers (`dropInPrice`, `shipmentValue`) and new `Economy` methods (`purseOf`, `refillPurses`, `dropInSell`, `bookShipment`, `tickShipments`) that read and write trade state on the player (`shipments`, `vendorPurses`). Time is passed in as a plain number (`now`) so the engine stays headless-testable; the real game clock is wired in plan 2. **This plan changes no live gameplay** — it only adds functions and tested player state. Plan 2 wires the engine into the UI and flips the till's sell to the drop-in path.

**Tech stack:** Vanilla ES modules. Tests are plain Node scripts run with `node scripts/verify-economy.mjs`, extending the existing SP1 economy suite (no test framework, no THREE/DOM).

**Scope (plan 1):** the engine + its state + tests. **Out (plan 2):** the ship-goods UI panel, switching the SP1 till sell to `dropInSell`, the per-frame clock tick that calls `refillPurses`/`tickShipments`, farm-gate lineside booking, and distance-scaled delivery delay. **Out (later sub-projects):** the monthly fair and shared stock (Slice B), dynamic stock/restock/price-crash (SP3), floating-price shipments and player forward contracts.

---

## File structure

- **Modify `src/economy.js`** — add the trade constants, two pure price helpers, and five `Economy` methods. One file, one responsibility (money + trade), already established in SP1.
- **Modify `src/player.js`** — add `shipments`, `vendorPurses`, `pursesAt` fields and persist them.
- **Modify `scripts/verify-economy.mjs`** — extend the existing suite with the trade-engine assertions (and the fake-game stub gains the new player fields).

---

## Task 1: Drop-in and shipment price helpers

**Files:**
- Modify: `src/economy.js` (add after the existing `priceOf` function)
- Test: `scripts/verify-economy.mjs`

- [ ] **Step 1: Add the failing tests**

In `scripts/verify-economy.mjs`, add `dropInPrice, shipmentValue` to the import from `../src/economy.js`, then add before the `console.log('RESULT...` line:

```js
// --- SP2 Task 1: drop-in and shipment pricing ---
{
  const localSell = priceOf(I.COAL_LUMP, 'Rosedale Abbey', 'sell', 0);
  const drop = dropInPrice(I.COAL_LUMP, 'Rosedale Abbey', 0);
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
  // the gradient: shipping to a dear market beats a local drop-in of the same goods
  const ship = shipmentValue([[I.COAL_LUMP, 10]], 'Whitby', 0);
  const drop = dropInPrice(I.COAL_LUMP, 'Rosedale Abbey', 0) * 10;
  (ship > drop ? ok : bad)(`shipping coal to the coast beats a local drop-in (${ship}d vs ${drop}d)`);
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/verify-economy.mjs`
Expected: FAIL — `dropInPrice is not a function`.

- [ ] **Step 3: Implement the helpers and constants**

In `src/economy.js`, immediately after the `priceOf` function, add:

```js
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node scripts/verify-economy.mjs`
Expected: all `ok`, `RESULT: PASS`.

- [ ] **Step 5: Commit**

```bash
git add src/economy.js scripts/verify-economy.mjs
git commit -m "feat(economy): drop-in and shipment price helpers (SP2)"
```

---

## Task 2: Player trade state (shipments, vendor purses) with save/load

**Files:**
- Modify: `src/player.js` (constructor ~line 33, `serialize` ~line 324, `deserialize` ~line 340)
- Test: `scripts/verify-economy.mjs`

- [ ] **Step 1: Add the failing test**

In `scripts/verify-economy.mjs`, add before the `console.log('RESULT...` line:

```js
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/verify-economy.mjs`
Expected: FAIL — `a fresh player has no shipments` (fields undefined).

- [ ] **Step 3: Add the fields and persistence**

In `src/player.js` constructor, after `this.brass = STARTING_BRASS; // pence in thi purse`, add:

```js
    this.shipments = [];     // goods in transit: {goods:[[id,n]], dest, brass, arrivesAt}
    this.vendorPurses = {};  // per-vendor drop-in brass remaining (key: lowercase name)
    this.pursesAt = 0;       // game-time the purses were last refilled
```

In `serialize()`, extend the brass line to:

```js
      slots: this.slots, hotbar: this.hotbar, fuelBank: this.fuelBank, brass: this.brass,
      shipments: this.shipments, vendorPurses: this.vendorPurses, pursesAt: this.pursesAt,
```

In `deserialize(d)`, after `this.brass = d.brass ?? STARTING_BRASS;`, add:

```js
    this.shipments = d.shipments || [];
    this.vendorPurses = d.vendorPurses || {};
    this.pursesAt = d.pursesAt || 0;
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node scripts/verify-economy.mjs`
Expected: all `ok`, `RESULT: PASS`.

- [ ] **Step 5: Commit**

```bash
git add src/player.js scripts/verify-economy.mjs
git commit -m "feat(player): persist trade state (shipments, vendor purses) (SP2)"
```

---

## Task 3: The vendor purse and the drop-in sale

**Files:**
- Modify: `src/economy.js` (add methods to the `Economy` class)
- Test: `scripts/verify-economy.mjs`

- [ ] **Step 1: Add the failing tests**

First extend the `fakeGame` stub in `scripts/verify-economy.mjs` so the fake player carries the new fields. In the `player: { ... }` object, add after `brass,`:

```js
      shipments: [], vendorPurses: {}, pursesAt: 0,
```

Then add before the `console.log('RESULT...` line:

```js
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
  // the purse refills over game-time
  const g = fakeGame(0, {});
  const e = new Economy(g);
  g.player.vendorPurses['annie'] = 0; g.player.pursesAt = 0;
  e.refillPurses(1); // one unit of game-time later
  (g.player.vendorPurses['annie'] > 0 ? ok : bad)(`a drained purse refills over time (now ${g.player.vendorPurses['annie']}d)`);
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/verify-economy.mjs`
Expected: FAIL — `e.dropInSell is not a function`.

- [ ] **Step 3: Implement the purse and the drop-in sale**

In `src/economy.js`, inside the `Economy` class (after the existing `doSell` method), add:

```js
  // --- SP2: drop-in selling, capped by the vendor's shallow brass purse ---
  purseOf(name) {
    const key = (name || '').toLowerCase();
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
    if (this.purseOf(name) < price) {
      this.game.ui.toast(`${(villager && villager.displayName) || 'They'}'ve no more brass to spare just now.`);
      return false;
    }
    this.game.player.removeItem(itemId, 1);
    this.game.player.vendorPurses[(name || '').toLowerCase()] -= price;
    this.earn(price);
    this.game.audio.pickup();
    return true;
  }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node scripts/verify-economy.mjs`
Expected: all `ok`, `RESULT: PASS`.

- [ ] **Step 5: Commit**

```bash
git add src/economy.js scripts/verify-economy.mjs
git commit -m "feat(economy): vendor purse and drop-in sale, capping drop-in volume (SP2)"
```

---

## Task 4: Booking and delivering shipments

**Files:**
- Modify: `src/economy.js` (add methods to the `Economy` class)
- Test: `scripts/verify-economy.mjs`

- [ ] **Step 1: Add the failing tests**

In `scripts/verify-economy.mjs`, add `FREIGHT_ALLOWANCE` to the economy import, then add before the `console.log('RESULT...` line:

```js
// --- SP2 Task 4: booking and delivering shipments ---
{
  const g = fakeGame(0, { [I.COAL_LUMP]: 20 });
  const e = new Economy(g);
  // ship 10 coal from Rosedale to Whitby (dear), at game-time now=0
  const r = e.bookShipment([[I.COAL_LUMP, 10]], 'Whitby', 'Rosedale Abbey', 0);
  (r.ok && r.brass === shipmentValue([[I.COAL_LUMP, 10]], 'Whitby', 0) ? ok : bad)(`bookShipment locks the destination value (${r.brass}d)`);
  (g.player.countItem(I.COAL_LUMP) === 10 ? ok : bad)('the shipped coal left the pack');
  (g.player.shipments.length === 1 ? ok : bad)('the shipment is recorded in transit');
  // not yet arrived
  (e.tickShipments(0.1).length === 0 && g.player.brass === 0 ? ok : bad)('a shipment in transit pays nothing yet');
  // arrives after the delay
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/verify-economy.mjs`
Expected: FAIL — `e.bookShipment is not a function`.

- [ ] **Step 3: Implement booking and delivery**

In `src/economy.js`, inside the `Economy` class (after `dropInSell`), add:

```js
  // --- SP2: book a forward shipment to a distant market; it pays on arrival ---
  bookShipment(goods, destVillage, originVillage, now) {
    if (!destVillage || destVillage === originVillage) return { ok: false, why: 'same place' };
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node scripts/verify-economy.mjs`
Expected: all `ok`, `RESULT: PASS`.

- [ ] **Step 5: Commit**

```bash
git add src/economy.js scripts/verify-economy.mjs
git commit -m "feat(economy): book and deliver forward shipments with a freight cap (SP2)"
```

---

## Done when

- `node scripts/verify-economy.mjs` passes with all the SP1 and SP2 assertions.
- The engine is complete and tested: drop-in pricing, the purse that caps drop-in volume, shipment booking with the freight cap, timed delivery, and persisted trade state.
- No live gameplay has changed yet (nothing calls the new methods in-game).

## Plan 2 (the wiring, a separate plan)

- A "ship goods" panel at a station or port: pick goods + destination, show the locked price, confirm → `bookShipment`.
- Switch the SP1 till's sell button from `doSell` to `dropInSell` (selling in person becomes the drop-in tier).
- A per-frame hook in `main.js` that calls `economy.refillPurses(gameTime)` and `economy.tickShipments(gameTime)` with the real game clock (and fixes the `now` unit, so `DELIVERY_DELAY`/`PURSE_REFILL` get real values).
- Farm-gate: allow the ship panel to open lineside (a proximity check against `rails.js`), not only at stations.
- Polish: distance-scaled delivery delay so far markets take longer; tie delivery to the train actually reaching the station so it reads as "the train brought it."

## Plan 2 acceptance criteria — from the SP1+SP2 code review (2026-06-19)

These are blocking conditions on the wiring. Numbers map to the review.

- **#2 — the till sell must be *fully replaced*, not duplicated.** Today the live till calls `doSell` (`ui.js:595`), which pays the full destination price instantly with no purse cap — strictly better than shipping, so the trade gradient is currently *inverted* and there is no reason to ship. The wiring must switch the till to `dropInSell` and leave **no** reachable path that still pays the full uncapped `doSell` price. Verify in-game: selling in person pays the penalised drop-in price, the purse taps out after a few sales, and no button pays full price.
- **#3 — feed game-days, never wall-clock.** `bookShipment`/`tickShipments`/`refillPurses` take `now = sky.day + sky.time` (the TIME CONTRACT comment at the top of the SP2 block in `economy.js` is the source of truth). Passing `performance.now()`/`Date.now()` makes delivery instant and refills a purse every frame. Verify: a shipment booked then save→reload arrives at the right game-time; a drained purse takes ~one game-day to refill, not a frame. `bookShipment`'s `originVillage` should be the player's current village (`geo.village.name`); dest/origin are now compared case-insensitively.
- **#1 — SP2 is friction, not scarcity (do not mis-tune).** Even after #2, `bookShipment` pays from an effectively infinite destination till, and brass still has no sink. The purse caps only the *local drop-in* path. `PURSE_MAX`/`PURSE_REFILL` are friction knobs, not a money sink — real scarcity (finite vendor brass, stock-based restock, oversupply price-crash) is SP3. Don't crank the purse trying to fake scarcity here.

**Already addressed in the engine (this review, tests added — `verify-economy.mjs` Tasks 5–7, 63 assertions green):**
- **#4** — `bookShipment` now rejects empty / negative / fractional / mixed-sign parcels and refuses same-place case-insensitively (money is uncheatable at the engine boundary). The ship panel must still pass positive integer counts and should surface the returned `{ok:false, why}` to the player rather than failing silently.
- **#5** — the drop-in purse is now keyed to the **vendor identity** (`vendorKey`), not the decorated display name, so "Fishwife Annie" and "Annie" share one purse. Any UI showing purse state must resolve via `vendorKey`.
- Coverage gaps closed: cross-session shipment delivery (book → save → reload → deliver), per-vendor purse independence, refill clamps at `PURSE_MAX`, and `villageOf` home/fallback. The one integration test still owed at wiring time: book → reload → deliver against the *real* game clock once `now` is wired.
