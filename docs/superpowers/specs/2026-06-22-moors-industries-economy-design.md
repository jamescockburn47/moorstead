# Moors 1900 — Industries & Economy (design spec)

**Status:** brainstormed + validated 2026-06-22. Awaiting James's review before the implementation plan.
**Scope of THIS spec:** the value-chain *framework* + the **Ironstone** exemplar (the first buildable slice). Other industries and the later economic layers are roadmapped at the end, each its own future spec.

---

## 1. Goal

Bring the main game's living-economy and production systems into the real-layout Moors 1900 world, re-thought to suit the expanded dynamics of the real map: 20+ real towns, a real 3-line rail network (Whitby the hub, the Esk Valley up the dale, the Coast Line along the shore), and real distances. The organising idea is **deep, authentic 1900 industries expressed as value chains**, with the railway as the circulatory system that carries goods up the chain and across the map.

## 2. Decisions locked in the brainstorm

1. **Spine = deep industries.** The re-think centres on authentic 1900 livelihoods as real value chains (raw to processed to finished), not gather-and-sell. Trade-network depth, a living NPC economy, and a capitalist/ownership layer are deferred layers (Section 8), not the starting point.
2. **Player loop = extract & trade the chain.** The player wins the *raw* material, then the value steps up at real-place **works**; profit comes from carrying the good up the chain and across the map by rail to where each stage is dearest. The player is a producer-trader, not (yet) an operator or owner of the works.
3. **First hero chain = Ironstone.** It is what the railways were built to carry, and it exercises every part of the framework.
4. **Ironstone finishes BOTH ways:** a revived on-map furnace (local, you see pig iron made and sold) AND a Teesside export (rail calcined ore north to the map edge, sold off-map to Middlesbrough for bulk freight).

## 3. The framework — industries as value chains

Three pieces, all built on top of `economy.js` (which already gives us period brass, per-town price spreads, the vendor margin, and the `bookShipment`/`bestMarket` freight system).

### 3.1 Staged goods (data)
A good can have **stages**: raw to processed to finished, each a distinct tradeable item with its own base worth (dearer up the chain), and its own per-town spreads. Held as data, exactly like the existing `PRICES`/`SPREAD`, so new chains slot in without code changes ("incentives are data").

### 3.2 Works (the new primitive)
A **works** is a real-place facility that converts one stage to the next. Held as data:
```
{ name, site:{x,z} or town, in:itemId, out:itemId, ratio:[inN,outN], toll }
```
- The player brings the raw good to the works and **converts** it (paying a small `toll`, or the works taking a cut). Out comes the next-stage good, which is lighter and/or worth more per unit.
- A works is a physical structure at its true location (the calcining-kiln arches at Rosedale; the furnace at the ironworks), interacted with like the station departures board (stand at it, right-click, a convert panel opens). The structure is stamped by worldgen at the site.
- This is the one genuinely new mechanic. Everything else extends existing systems.

### 3.3 Rail freight (extend, don't rebuild)
The existing shipment system (`bookShipment` → arrives at the destination market after `DELIVERY_DELAY` game-days; `bestMarket`; drop-in purses) is extended to the **real towns** and the **chain goods**. The player ships processed goods to the dearest market by rail. A special off-map **export sink** (Teesside) is added as a destination at the network's NW edge.

### 3.4 The player's loop
WIN raw (mine / later: catch, shear, harvest) → CONVERT at a works (value step) → SHIP by rail to the dearest market for that stage (the next works, the export, or a town) → profit on the value gained plus the freight spread.

## 4. The Ironstone chain (the exemplar)

### 4.1 Goods
- **Raw ironstone** — heavy, low worth. (New item, or map to existing `RAW_IRON`; plan decides — leaning new item `IRONSTONE` to avoid disturbing stylised-world iron crafting.)
- **Calcined ore** — roasted, ~⅓ lighter, dearer per unit. (New item `CALCINED_ORE`.)
- **Pig iron** — smelted, dearest. (New item `PIG_IRON`, or map to `IRON_INGOT`.)

### 4.2 Places & works
- **Mine** — ironstone seams in the moor around **Rosedale** (and optionally the Cleveland/NW edge). Worldgen places ore blocks in those seams; the player digs them to raw ironstone. Reuses the existing ore-mining path.
- **Calcining kilns at Rosedale** — a works: raw ironstone → calcined ore, ratio ~3:2 (the weight loss is the whole historical point — calcine before paying rail freight). Stamped as the iconic moor-top kiln arches at the real site.
- **Local furnace (Glaisdale or Grosmont ironworks)** — a works: calcined ore → pig iron. Stamped as a furnace structure at a real early-ironworks site. The on-map finish.
- **Teesside export** — a market sink at the NW network edge (Battersby direction): rail calcined ore there for a steady bulk price (off-map Middlesbrough furnaces). The historical bulk route and a reliable freight income.

### 4.3 Spreads (the wage for the journey)
Raw ironstone cheap at the Rosedale pit-head; calcined ore dearer (and dearest at the furnace and at Teesside); pig iron dearest at the furnace town and the market towns. Tuned as `SPREAD` data over the real towns.

### 4.4 The loop, concretely
Mine ironstone at Rosedale (cheap, heavy) → convert at the Rosedale kilns to calcined ore (lighter, dearer) → rail it: either to the local furnace (convert to pig iron, sell dear) or north to Teesside (bulk sale). Profit = value gained at each works + the freight spread to the dear market.

## 5. Architecture (how it maps onto the code)

- **`economy.js`** — add the chain-good base prices; extend `SPREAD` to the real towns and the new goods; add the **works** data + a pure `convert()` helper (input, ratio, toll → output + brass effect); add the **Teesside export** as a `bestMarket` destination. All pure/headless-testable, matching the file's existing discipline.
- **`moorsgeo.js`** — declare the works **sites** (Rosedale kilns, the furnace town) and the ironstone **seam regions**, as data keyed to real coordinates (like the towns/landmarks).
- **`worldgen.js`** — stamp the ironstone seams (ore blocks in the Rosedale moor) and the works structures (kiln arches, furnace) at their sites; keep them clear of rails/water like the town buildings.
- **UI / interaction** — the works convert-panel, reusing the station-board interaction pattern (`nearStation`-style proximity + right-click).
- **`defs.js`** — the new item ids (ironstone, calcined ore, pig iron) + their textures.
- The whole thing is **moors-only** (`geo.realWorld`); the stylised world's economy is untouched.

## 6. Data flow

mine (worldgen ore → player inventory: raw ironstone) → works convert (economy `convert()`: raw → calcined, toll) → rail freight (`bookShipment` to the furnace/Teesside/town; arrives after delay; brass paid at the dest sell price) → optional second works (calcined → pig iron) → sale.

## 7. Testing (headless, in `npm run verify`)

A new `verify-industry-ironstone.mjs` asserting:
- Price ordering: raw ironstone < calcined ore < pig iron (at par).
- `convert()`: correct ratio + toll; raw→calcined and calcined→pig iron.
- Spreads: raw cheap at Rosedale; calcined dearest at the furnace/Teesside; pig iron dear at the market towns.
- The Teesside export pays a sane bulk rate and is reachable as a `bestMarket` destination.
- Works sites resolve to real coordinates and are placed clear of rails/water.

## 8. Roadmap (future specs, not this one)

- **Slice 1 — Ironstone** (this spec).
- **Slice 2+ — the other hero chains**, reusing the framework: **Jet** (raw → carved mourning jewellery at the Whitby shops), **Coast fishing** (herring → cured/kippered at the harbour smokehouses → railed inland), **Sheep / wool / dale farming** (graze & shear; dale crops, cattle, dairy → market).
- **Later layers** (each a deliberate step up in simulation): **trade-network depth** (routing, the Whitby hub, freight vs passenger workings), **living economy** (NPCs work the chains and run goods by rail; prices move on real supply & demand), **capitalist layer** (own the works, hire NPCs, invest in the railway and mines via a stock market).

## 9. Open questions for the plan

- Exact item mapping: new `IRONSTONE`/`CALCINED_ORE`/`PIG_IRON` vs reusing `RAW_IRON`/`IRON_INGOT`. (Lean: new items, moors-only.)
- Which town hosts the on-map furnace (Glaisdale vs Grosmont). (Both had real early ironworks.)
- Whether the player converts at a works for a toll, or sells raw in and buys processed back (two framings of the same value step). (Lean: convert-for-a-toll — keeps the good in the player's hands to ship on.)
- How the Teesside export is surfaced (a marked siding at the NW edge / Battersby).
