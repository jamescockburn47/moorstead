# Moors Ironstone — Slice 1 Implementation Plan

> **Executor:** self (Claude), with James reviewing. Steps use checkboxes for tracking.
> **Commits are HELD** per James's standing rule — the `commit` step in each task is deferred; I batch-commit only when James asks. Treat each as a "verify + checkpoint".

**Goal:** Build the first deep-industry value chain — ironstone — in the Moors 1900 world: mine ironstone near Rosedale → calcine it at the moor-top kilns → rail the calcined ore to the Grosmont furnace (→ pig iron) or export it to Teesside, profiting on the value gained at each works plus the freight spread.

**Architecture:** Extend the already-live `Economy` (period brass, per-town `SPREAD`, the `bookShipment`/`bestMarket` freight system, the station board as market UI). Add one new primitive — a **works** (a real-place processor that converts a raw good to the next stage for a toll). Place ironstone seams + the works structures via worldgen at their true sites. Moors-only (`geo.realWorld`); the stylised economy is untouched. All economy logic stays pure/headless-testable.

**Tech Stack:** JS (`economy.js`, `defs.js`, `moorsgeo.js`, `worldgen.js`, `ui.js`, `main.js`), the existing headless verify harness (`npm run verify`).

---

## File structure

- `src/defs.js` — three new item ids + defs + tiles (IRONSTONE, CALCINED_IRONSTONE, PIG_IRON).
- `src/economy.js` — chain-good base prices; real-town spreads; the **works** data + pure `convert()`; the Teesside export market.
- `src/moorsgeo.js` — declare ironstone **seam regions** + **works sites** (Rosedale kilns, Grosmont furnace), keyed to real coords; a `nearWorks(x,z)` helper.
- `src/worldgen.js` — stamp ironstone ore in the seams; stamp the kiln + furnace structures; keep clear of rails/water/buildings.
- `src/ui.js` + `src/main.js` — the works convert+ship panel (reuse the station-board proximity + right-click pattern).
- `scripts/verify-industry-ironstone.mjs` — new headless test, added to `npm run verify`.

---

### Task 1 — New items
**Files:** `src/defs.js` (modify), `src/textures.js` (tiles if needed).
- [ ] Add `IRONSTONE`, `CALCINED_IRONSTONE`, `PIG_IRON` to the `I` item enum + their `D` defs (name, stackable, tile) following the existing `RAW_IRON`/`JET_GEM` pattern; add tiles (rusty-brown ironstone, grey calcined, dark pig iron).
- [ ] Verify: items resolve via `itemName()` and have tiles; build passes.
- [ ] Checkpoint.

### Task 2 — Chain-good prices + real-town spreads
**Files:** `src/economy.js` (modify).
- [ ] Add to `PRICES`: ironstone (cheap, ~3), calcined ore (~7), pig iron (~18) — strictly increasing.
- [ ] Extend `SPREAD` over the real towns: ironstone cheap at Rosedale; calcined dear at Grosmont + the market towns; pig iron dear at the market towns (Pickering/Whitby) and the dales. (Stylised-village keys left intact.)
- [ ] Test (in the new verify): `PRICES` ordering raw<calcined<pig; `regionMult` gives Rosedale the cheap ironstone and Grosmont the dear calcined.
- [ ] Checkpoint.

### Task 3 — The works primitive
**Files:** `src/economy.js` (modify).
- [ ] Add `WORKS` data: `{ name, town, in, out, ratio:[inN,outN], toll }` — Rosedale calcining kiln (`IRONSTONE`→`CALCINED_IRONSTONE`, 3:2, small toll) and Grosmont furnace (`CALCINED_IRONSTONE`→`PIG_IRON`, 2:1, toll).
- [ ] Add a pure `convert(works, heldCount, brass)` → `{ outCount, tollPaid, ok, reason }` (floors to whole ratio units, checks brass for the toll).
- [ ] Test: ironstone→calcined and calcined→pig at the right ratios/tolls; insufficient input/brass refused.
- [ ] Checkpoint.

### Task 4 — Teesside export sink
**Files:** `src/economy.js` (modify).
- [ ] Add a `Teesside` market entry (off-map): a bulk buyer of `CALCINED_IRONSTONE` at a steady rate, included as a `bestMarket` candidate for calcined ore only.
- [ ] Test: `bestMarket(CALCINED_IRONSTONE, …)` returns Teesside at a sane bulk per-unit; it isn't offered for unrelated goods.
- [ ] Checkpoint.

### Task 5 — Ironstone seams (terrain)
**Files:** `src/moorsgeo.js` (modify), `src/worldgen.js` (modify).
- [ ] Declare ironstone **seam region(s)** as data near Rosedale (a centre + radius), and a `geo.ironstoneAt(x,z)` test (realWorld-only).
- [ ] In worldgen, place `IRONSTONE` ore blocks within the seams (a band at a sensible depth in the moor), deterministic, clear of rivers/rails/town-buildings.
- [ ] Test (headless chunk-gen): ironstone ore present in the Rosedale seam, absent far away; none under rails/water/buildings.
- [ ] Checkpoint.

### Task 6 — Works structures
**Files:** `src/moorsgeo.js` (modify), `src/worldgen.js` (modify).
- [ ] Declare works **sites**: the calcining kilns at Rosedale (the iconic arched bank of kilns) and a furnace at Grosmont. Add `geo.worksAt(x,z)` / `nearWorks`.
- [ ] In worldgen, stamp the kiln arches (a row of stone arches into a bank) and the Grosmont furnace (a tall stone furnace stack + cast house); clear surrounding trees like the abbey/town.
- [ ] Test (headless chunk-gen): the kiln + furnace blocks present at their sites.
- [ ] Checkpoint.

### Task 7 — The works convert + ship interaction
**Files:** `src/ui.js` (modify), `src/main.js` (modify).
- [ ] At a works (proximity + right-click, reusing the station-board pattern), open a panel: **Convert** (turn held raw → processed, paying the toll) and, at the Rosedale kiln, **Ship** the calcined ore (book a freight shipment to the best market — Grosmont or Teesside) via the existing `bookShipment`/`bestMarket`.
- [ ] At Grosmont, **Convert** calcined → pig iron and sell/ship pig iron.
- [ ] Verify in-game (block-read / eval): the panel converts and books a shipment correctly.
- [ ] Checkpoint.

### Task 8 — Wrap
**Files:** `scripts/verify-industry-ironstone.mjs` (create), `package.json` (modify).
- [ ] Finish `verify-industry-ironstone.mjs` (Tasks 2–6 assertions) and add it to `npm run verify`.
- [ ] Full `npm run verify` green; `npm run build`; headless chunk-read of the Rosedale seam + kilns + Grosmont furnace; deploy.
- [ ] Report to James; hold commit until asked.

---

## Notes / follow-ups (not Slice 1)
- The visible **Rosedale Railway** (moor-top mineral line, Rosedale → Blakey → Battersby incline → off-map Teesside) — ideally surveyed by James.
- Jet, coast fishing, sheep/wool/farming chains reuse this exact framework (items + spreads + works + freight).
- Later layers: trade-network depth, living NPC economy, capitalist/ownership + stock market.
