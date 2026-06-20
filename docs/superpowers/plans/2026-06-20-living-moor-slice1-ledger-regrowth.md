# Living Moor Slice 1 — Edit Ledger + Flora/Ore/Peat Regrowth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make harvested resources grow back — cut heather, fell a tree, mine a seam, or cut peat, and days later the moor has healed itself; peat also gains the lowest market price.

**Architecture:** A pure `editledger.js` classifies each edit (`harvest`/`dig`/`build`) and says when a harvest edit expires (per-block lifespan, in game-days). The world keeps a sparse **edit ledger** (`"x,y,z" → {cat, day, by, was}`) recorded at the existing break/place sites; once per game-day a lazy pass reverts expired harvest edits by **setting the cell back to what was there** (`was`) — exactly the existing beach-heal trick, generalised from wall-clock minutes to game-days. The ledger persists in the save so regrowth survives a reload.

**Tech Stack:** Vanilla ES modules. Headless tests are plain Node (`scripts/verify-*.mjs`). Persistence is IndexedDB via `src/save.js`. Build is Vite.

**Scope (Slice 1 of 5):** Only **harvest** edits regrow (plants, trees, ore, peat). `dig` (terrain backfill) and `build` (claim-gated decay) are *recorded-aware* but do **not** expire yet — they land in Slices 3–4 with the claims/mining context. No mining restrictions, no claims, no relay here; this is single-player "the moor heals". Deploy stays held (the whole Living Moor ships together; shared-moor healing needs Slice 5's relay pass).

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/editledger.js` | create | pure: block classification, `categoryOf`, `lifespanOf`, `isExpired` |
| `scripts/verify-regen.mjs` | create | headless test of the ledger logic |
| `package.json` | modify | wire `verify-regen.mjs` into `npm run verify` |
| `src/world.js` | modify | the `editLedger` map, `recordEdit`, `expireEdits` |
| `src/main.js` | modify | record edits at break/place; run `expireEdits` once per game-day; persist the ledger |
| `src/economy.js` | modify | peat gains the lowest price |

Isolation: all the decision logic (what's a harvest, how long it lives, has it expired) is the pure `editledger.js`; `world.js` is a thin consumer that reverts cells; `main.js` wires the hooks. The revert mechanism (`setBlock(was)`) is the exact one the beach-heal already uses.

---

## Task 1: The pure edit ledger + headless test

**Files:**
- Create: `src/editledger.js`
- Create: `scripts/verify-regen.mjs`
- Modify: `package.json:11` and `package.json:24`

- [ ] **Step 1: Write the failing test** — create `scripts/verify-regen.mjs`:

```js
// Edit-ledger regrowth check — run wi': node scripts/verify-regen.mjs
import { B } from '../src/defs.js';
import { categoryOf, lifespanOf, isExpired, LIFESPAN } from '../src/editledger.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// --- categoryOf: placing is a build; breaking classifies the old block ---
{
  (categoryOf(B.GRASS, B.PLANKS) === 'build' ? ok : bad)('placing any block = build');
  (categoryOf(B.HEATHER, B.AIR) === 'harvest' ? ok : bad)('cutting heather = harvest');
  (categoryOf(B.LOG, B.AIR) === 'harvest' ? ok : bad)('felling a log = harvest');
  (categoryOf(B.COAL_ORE, B.AIR) === 'harvest' ? ok : bad)('mining a coal seam = harvest');
  (categoryOf(B.PEAT, B.AIR) === 'harvest' ? ok : bad)('cutting peat = harvest');
  (categoryOf(B.STONE, B.AIR) === 'dig' ? ok : bad)('digging stone = dig');
  (categoryOf(B.DIRT, B.AIR) === 'dig' ? ok : bad)('digging dirt = dig');
  (categoryOf(B.PLANKS, B.AIR) === 'build' ? ok : bad)('removing planks = build');
}

// --- lifespanOf: harvest blocks regrow on their own clock; dig/build never (Slice 1) ---
{
  (lifespanOf('harvest', B.HEATHER) === LIFESPAN.plant ? ok : bad)('plants regrow in LIFESPAN.plant days');
  (lifespanOf('harvest', B.LOG) === LIFESPAN.tree ? ok : bad)('trees regrow in LIFESPAN.tree days');
  (lifespanOf('harvest', B.JET_ORE) === LIFESPAN.ore ? ok : bad)('ore regrows in LIFESPAN.ore days');
  (lifespanOf('harvest', B.PEAT) === LIFESPAN.peat ? ok : bad)('peat regrows in LIFESPAN.peat days');
  (lifespanOf('dig', B.STONE) === Infinity ? ok : bad)('dig does not expire in Slice 1');
  (lifespanOf('build', B.PLANKS) === Infinity ? ok : bad)('build does not expire in Slice 1');
}

// --- isExpired: only past its lifespan, and only harvest ---
{
  const heather = { cat: 'harvest', day: 10, was: B.HEATHER };
  (isExpired(heather, 10 + LIFESPAN.plant - 0.01) === false ? ok : bad)('not expired before its lifespan');
  (isExpired(heather, 10 + LIFESPAN.plant) === true ? ok : bad)('expired at its lifespan');
  const wall = { cat: 'build', day: 10, was: B.PLANKS };
  (isExpired(wall, 9999) === false ? ok : bad)('a build never expires in Slice 1');
}

console.log('RESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
```

(Plain Node, ES imports — run it before implementing to watch it fail.)

- [ ] **Step 2: Run it, expect FAIL**

Run: `node scripts/verify-regen.mjs`
Expected: crash — `Cannot find module '../src/editledger.js'`.

- [ ] **Step 3: Implement `src/editledger.js`**

```js
// editledger.js — the pure heart of world regeneration. No THREE, no DOM: classifies each
// block edit and says when a harvested resource has grown back. Reversion itself ("forget the
// edit, the resource is back") lives in world.js; this module only decides.
import { B } from './defs.js';

// What kind of edit was this? Placing anything is a build; breaking is classified by what WAS there.
const PLANTS = new Set([B.HEATHER, B.BRACKEN, B.TUSSOCK, B.BILBERRY_BUSH, B.GORSE, B.FERN, B.FOXGLOVE, B.DOG_ROSE, B.ELDER]);
const TREES  = new Set([B.LOG, B.LEAVES, B.MONKEY_LEAVES]);
const ORES   = new Set([B.COAL_ORE, B.IRON_ORE, B.JET_ORE]);
const HARVEST = new Set([...PLANTS, ...TREES, ...ORES, B.PEAT]); // natural resources that regrow
const TERRAIN = new Set([B.STONE, B.DIRT, B.GRASS, B.GRAVEL, B.COBBLE, B.SAND]); // natural ground

// game-days a harvested resource takes to grow back (Slice 1 defaults; tune live with James)
export const LIFESPAN = { plant: 4, tree: 12, ore: 8, peat: 7 };

export function categoryOf(was, newId) {
  if (newId !== B.AIR) return 'build';      // a placement
  if (HARVEST.has(was)) return 'harvest';   // cut a resource
  if (TERRAIN.has(was)) return 'dig';       // dug natural ground
  return 'build';                           // removed a placed block
}

export function lifespanOf(cat, was) {
  if (cat !== 'harvest') return Infinity;   // dig + build do not regrow in Slice 1
  if (TREES.has(was)) return LIFESPAN.tree;
  if (ORES.has(was)) return LIFESPAN.ore;
  if (was === B.PEAT) return LIFESPAN.peat;
  return LIFESPAN.plant;                     // plants
}

// An edit is { cat, day, by, was }. Expired once `nowDay` has passed its lifespan.
export function isExpired(edit, nowDay) {
  const life = lifespanOf(edit.cat, edit.was);
  return Number.isFinite(life) && (nowDay - edit.day) >= life;
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `node scripts/verify-regen.mjs`
Expected: all `ok`, `RESULT: PASS`.

- [ ] **Step 5: Wire into `npm run verify`**

In `package.json:11`, append to the `verify` chain: ` && node scripts/verify-regen.mjs`.
After `package.json:24` (`"verify:farm": ...`), add: `,"verify:regen": "node scripts/verify-regen.mjs"`.

- [ ] **Step 6: Run the suite**

Run: `npm run verify`
Expected: every script `RESULT: PASS`, exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/editledger.js scripts/verify-regen.mjs package.json
git commit -m "feat(regen): pure edit ledger — categoryOf/lifespanOf/isExpired + headless check (Living Moor Slice 1)"
```

---

## Task 2: The edit ledger in `world.js`

**Files:** Modify `src/world.js` (import, constructor field, two methods)

- [ ] **Step 1: Import the ledger logic.** At the top of `src/world.js`, after the existing defs import (world.js:2), add:

```js
import { categoryOf, isExpired } from './editledger.js';
```

- [ ] **Step 2: Add the ledger field.** In the `World` constructor (world.js:15, near `this.savedChunks = ...`), add:

```js
    this.editLedger = savedChunks && savedChunks._ledger ? savedChunks._ledger : new Map(); // "x,y,z" -> { cat, day, by, was }
```

(Belt-and-braces; the real restore happens in Task 4 via the save meta. The `_ledger` hop is harmless if absent.)

- [ ] **Step 3: Add `recordEdit` and `expireEdits`.** Add these methods to the `World` class (anywhere after `setBlock`):

```js
  // Record a block change so a harvested resource can grow back later. Only HARVEST edits are
  // tracked in Slice 1; a place/dig over a cell supersedes any pending regrowth there.
  recordEdit(x, y, z, was, newId, day, by) {
    const k = `${x},${y},${z}`;
    if (categoryOf(was, newId) === 'harvest') this.editLedger.set(k, { cat: 'harvest', day, by, was });
    else this.editLedger.delete(k);
  }

  // Lazy regrowth: revert every expired harvest edit by putting back what was there (`was`) —
  // the same trick as the beach heal, on game-days. Only touches loaded chunks; skips a cell that
  // has since changed (someone built there). Returns how many regrew.
  expireEdits(nowDay) {
    let n = 0;
    for (const [k, e] of this.editLedger) {
      if (!isExpired(e, nowDay)) continue;
      const [x, y, z] = k.split(',').map(Number);
      if (!this.isLoaded(x, z)) continue;          // grows back next time its chunk is loaded
      if (this.getBlock(x, y, z) !== B.AIR) { this.editLedger.delete(k); continue; } // summat's there now
      this.setBlock(x, y, z, e.was);               // the resource is back
      this.editLedger.delete(k);
      if (this.netEdits) this.netEdits.delete(k);
      n++;
    }
    return n;
  }
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: success (no syntax/import errors).

- [ ] **Step 5: Commit**

```bash
git add src/world.js
git commit -m "feat(regen): world edit ledger + recordEdit + lazy expireEdits (Living Moor Slice 1)"
```

---

## Task 3: Wire the hooks in `main.js`

**Files:** Modify `src/main.js` (the break site ~2335, the place site ~2453, the frame loop near `processBeachReverts`)

- [ ] **Step 1: Record on break.** In the break path, immediately after the existing `sendEdit(..., 0, ...)` line (main.js:2335), add:

```js
    this.world.recordEdit(hit.x, hit.y, hit.z, hit.id, 0, this.sky.day, this.player.name || '');
```

(`hit.id` is the block that was there; `0` is `B.AIR` — the break.)

- [ ] **Step 2: Record on place.** In the place path, immediately after the place `sendEdit(px, py, pz, held.id, ...)` line (main.js:~2453), add:

```js
    this.world.recordEdit(px, py, pz, cur, held.id, this.sky.day, this.player.name || '');
```

(`cur` is what was there before; `held.id` is the placed block. This supersedes any pending regrowth on that cell.)

- [ ] **Step 3: Run expiry once per game-day.** Find where `this.processBeachReverts()` is called in the per-frame `frame()` method (grep `processBeachReverts`). Right after it, add:

```js
      const today = Math.floor(this.sky.day);
      if (today !== this._lastExpireDay) { this._lastExpireDay = today; this.world.expireEdits(this.sky.day); }
```

(Once-a-game-day is plenty for day-scale regrowth and keeps it cheap.)

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "feat(regen): record edits at break/place + run regrowth once per game-day (Living Moor Slice 1)"
```

---

## Task 4: Persist the ledger in the save

**Files:** Modify `src/main.js` (the save `meta` assembly ~360 and the load path ~262)

- [ ] **Step 1: Save the ledger.** In the `meta` object built before `saveGame(...)` (main.js:360-368), add a field (a Map isn't JSON-able, so store its entries):

```js
      editLedger: [...this.world.editLedger],
```

- [ ] **Step 2: Restore the ledger on load.** Where the saved game is applied after `loadGame()` (main.js:~262 onward, where `saved.meta` is read and the world is built), set the ledger from meta. Right after the world is constructed/assigned, add:

```js
    if (saved && saved.meta && saved.meta.editLedger) this.world.editLedger = new Map(saved.meta.editLedger);
```

(If `editLedger` is absent in an older save, the world keeps its empty Map — safe.)

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: success. (Round-trip behaviour is verified live in Task 6.)

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat(regen): persist the edit ledger in the save so regrowth survives reload (Living Moor Slice 1)"
```

---

## Task 5: Peat gains the lowest price

**Files:** Modify `src/economy.js` (the `PRICES` table, ~line 23-35)

- [ ] **Step 1: Price peat at the floor.** In the `PRICES` object in `src/economy.js`, add an entry (peat is the cheapest tradeable — the bulk fuel):

```js
  [B.PEAT]: 1,
```

(1 is the price floor — `priceOf` never returns below 1 — so peat is the lowest-priced good, matching heather/bracken. It is already a fuel in `FUELS`; this makes it sellable too. Cutting peat is already a `harvest` edit from Tasks 1–3, so peat banks regrow.)

- [ ] **Step 2: Confirm the suite still passes**

Run: `npm run verify`
Expected: all `RESULT: PASS` (the economy check imports `PRICES`; peat being present must not break it).

- [ ] **Step 3: Commit**

```bash
git add src/economy.js
git commit -m "feat(regen): peat gains the lowest market price (Living Moor Slice 1)"
```

---

## Task 6: Full verification (deploy held)

**Files:** none

- [ ] **Step 1: Headless + build green**

Run: `npm run verify` (all PASS, now incl. `verify-regen`) and `npm run build` (clean).

- [ ] **Step 2: Drive the live preview — regrowth.** Start `npm run dev`; in the browser console reproduce the standard entry (loginGuest → newWorld → pump ~550 frames in two batches until `state==='playing'`), then:

```js
const g = window.game;
// cut a patch: break a few blocks via the world directly + record harvest edits as the break path would
const p = g.player.pos, X = Math.floor(p.x)+2, Z = Math.floor(p.z), Y = g.world.gen.height(X, Z);
const was = g.world.getBlock(X, Y, Z);
g.world.setBlock(X, Y, Z, 0);                                   // "cut" it
g.world.recordEdit(X, Y, Z, was, 0, g.sky.day, 'me');          // as the break hook does
({ cut: was, nowAir: g.world.getBlock(X,Y,Z) === 0, ledger: g.world.editLedger.size });
```

Confirm the cell is air and the ledger has the entry.

- [ ] **Step 3: Advance game-days and watch it heal.**

```js
const g = window.game;
g.sky.day += 13;                                  // past every harvest lifespan
const regrew = g.world.expireEdits(g.sky.day);
const X = [...g.world.editLedger.keys()];          // should be empty now
({ regrew, ledgerEmpty: g.world.editLedger.size === 0 });      // expect regrew >= 1, ledgerEmpty true
```

Confirm `regrew >= 1` and the cut cell is no longer air (the resource is back — `g.world.getBlock(X,Y,Z)` from Step 2 equals `was`).

- [ ] **Step 4: Peat price.** Covered by the headless suite (`PRICES[B.PEAT] = 1`, the economy check still passing). In-game, optionally confirm a vendor who buys peat now quotes a price for it.

- [ ] **Step 5: Persistence round-trip.** Cut a block + `recordEdit` (Step 2), `g.saveNow(true)`, reload the page, re-enter the same world, and confirm `window.game.world.editLedger.size >= 1` (the ledger came back) — so regrowth survives a reload.

- [ ] **Step 6: Console clean.** `preview_console_logs` level error → none.

- [ ] **Step 7: Report; do NOT deploy.** Summarise to James. Deploy stays held — the Living Moor ships as one piece once Slices 2–5 land (the shared bairns moor needs Slice 5's relay pass).

---

## Self-Review

**Spec coverage (Living Moor §3, §4, §13 Slice 1):**
- Edit metadata `{cat, day, by, was}` → Task 1 (record shape) + Task 2 (`recordEdit`). ✓
- `categoryOf` / `lifespanOf` / `isExpired` pure + headless → Task 1. ✓
- Reversion = put back what was there (the beach-heal trick, on game-days) → Task 2 (`expireEdits` → `setBlock(was)`). ✓
- Lazy expiry once per game-day, loaded chunks only, skip-if-changed → Task 2/3. ✓
- Flora/ore/peat regrow; dig/build do not yet → Task 1 (`lifespanOf` Infinity for dig/build). ✓
- Surface peat cut + regrow + lowest price → peat ∈ HARVEST (Task 1), priced (Task 5). ✓
- Persist so it survives reload → Task 4. ✓

**Out of scope (correctly, later slices):** the 1-block-deep rule, licensed mining, designated quarries, deeds/claims, build decay, dig backfill, breeding, the relay's authoritative shared-moor heal. Slice 1 is single-player "the moor heals".

**Placeholder scan:** none — every step carries real code. (Task 1 Step 1 calls out the one import-line tidy explicitly.)

**Type consistency:** the edit record `{ cat, day, by, was }` is identical across `editledger.js` (`isExpired`/`lifespanOf` read `edit.cat`, `edit.was`), `world.js` (`recordEdit` writes it, `expireEdits` reads it), and the save (`[...editLedger]` ↔ `new Map(...)`). `categoryOf(was, newId)` and `isExpired(edit, nowDay)` signatures match every call site.
