# Moorstead 1900 — a real-layout North York Moors world

**Status:** design, awaiting review · **Date:** 2026-06-21 · **Type:** program (decomposes into slices, each its own spec → plan → build)

## 1. Intent

A new, extra Moorstead world whose **layout, coastline, rivers, landform and railway match the real North York Moors c.1900**, at **1 block = 15 m**. Not a tweak to the existing world — a second, data-driven world that loads the real geography. The existing stylised Moorstead stays untouched alongside it.

"Accurate" here means: real **relative positions** (towns, coast, stations, rivers), real **macro-relief** (the high moors and the dales broadly the right shape and height, from OS elevation), and real **landmarks** at their true sites. The *surface* is still stylised in the current voxel idiom (heather/bog/bracken, drystone, becks) — we are not reproducing 1 m crags, only the landform the eye reads as "the moors."

Period: **c.1900** (late-Victorian — consistent with Moorstead's established setting). The railway is the 1900 network, which is materially **larger** than what survives today.

## 2. Locked decisions (from brainstorming, 2026-06-21)

1. **Fidelity:** correct layout + stylised surface, but **OS-accurate macro-relief across the whole map** (not just along the line) and **real landmark positions**.
2. **Scale:** 1 block = 15 m → the National Park (~50 × 35 km) ≈ **3,300 × 2,300 blocks**.
3. **Scope:** full parallel game (towns get NPCs / economy / quests, tiered — §8).
4. **Railway:** the **full c.1900 network**, designed in first, reusing the current gradient/rail/fence/flora engine over real OS relief (§7).
5. **Trains:** **no driven trains** in this world. All trains are **scheduled, deterministic from the shared clock** — conflict-free by construction, no relay train state, no signalling/token machinery required. Players ride as passengers and book rail freight; they do not take the regulator. (Driving + token working remain a possible *future* slice; the architecture does not foreclose it.)
6. **Station houses:** a new **clean, geometric** NER-style building, distinct from the current cottages, used across the network.
7. **Access:** available as **both** a new shared world (its own relay room + seed) **and** a solo world. Same geography either way.
8. **Relay mirror:** the geography is mirrored to the relay (`geography_noise.py`) so mining-depth/deeds and NPC placement use the real landform; client and relay must agree exactly (§6.4).

## 3. Non-goals

- Not replacing the existing stylised world.
- Not 1 m / LIDAR fidelity (Terrain 50 macro-relief is the target; LIDAR is a deferred upgrade for coastal cliffs / landmark crags — §13).
- Not modelling off-map mainline destinations (Middlesbrough, Scarborough, Loftus) as towns — lines run to the world edge and trains depart/arrive "off the map."
- No driven trains, signalling, or token working in this iteration (§2.5).

## 4. Architecture overview

The whole world hangs off one seam: everything reads `world.gen.geo` through a stable interface (`height`, `coastT`, `villages`, `railway`, `railPath`, `railInfo`, `locationName`, `npcSpot`, …), constructed in one place — [`worldgen.js`](../../../src/worldgen.js) `this.geo = new Geography(seed)`.

We add a sibling provider and select it by seed/room:

```
this.geo = isMoorsWorld(seed) ? new MoorsGeography(seed, moorsData) : new Geography(seed)
```

`MoorsGeography` implements the **same interface** from a committed **data file**, so rails, entities, economy, naming and the brain work unchanged. Units (each independently understandable/testable):

| Unit | Responsibility | Depends on |
|---|---|---|
| **data pipeline** (offline script) | OS/OSM/historic sources → one compact `moors-data` file | external data (built once, committed) |
| **`moors-data`** (committed asset) | elevation grid + corridor samples; town/station/river/coast/landmark records | — |
| **`MoorsGeography`** (client) | the `geo` interface from `moors-data` | `moors-data` |
| **`geography_noise` mirror** (relay) | identical height/landform for the relay + brain | the same `moors-data` |
| **`timetable`** (client) | `trainsAt(now)` → all scheduled trains, deterministic, conflict-free | `MoorsGeography.railway()` |
| **train render** (client) | pool + cull rakes onto visible trains | `timetable`, `rails.js` |
| **world selection / wiring** | seed → provider; new shared room; solo option | `worldgen`, `multiplayer`, `main` |

## 5. Data pipeline & sources

An **offline preprocessing script** (Python, under `deploy/` or `scripts/`, run once, output committed) produces the `moors-data` asset. The game never fetches at runtime.

**Sources (licence-aware — prefer OGL to keep attribution simple and avoid ODbL share-alike):**
- **Elevation:** **OS Terrain 50** (OS OpenData, OGL) — 50 m posts; broadly-accurate landform. Interpolated to the block grid.
- **Coastline, rivers, surviving towns/stations, park boundary:** **OS OpenData** (OGL) — OS Open Rivers, OS Open Names, OS Boundary-Line, OS OpenMap-Local.
- **Dismantled 1900 lines + period station positions:** **georeferenced historic OS maps** (National Library of Scotland, late-Victorian, out of copyright / public domain) cross-checked against the railway histories (§7 sources). These lines (the two coast lines, the ironstone railway) are gone from modern data, so the historic six-inch OS is the authoritative source for their alignment.

**Attribution obligation** (record in `about.html` / credits): *"Contains OS data © Crown copyright and database right 2026"* (OGL); historic mapping © reproduced with permission / public domain per NLS terms.

**`moors-data` schema (indicative):**
- `bounds` — world extent in OSGB metres + the block-grid transform (origin, 15 m/block, rotation if any).
- `elevation` — a coarse height grid (whole map) + denser sample strips along rail corridors and around landmarks; values in metres, projected to block-Y by a documented transform.
- `towns[]` — `{name, x, z, tier, footprintHint}`.
- `stations[]` — `{name, x, z, line, hasLoop}` (1900 roster only).
- `lines[]` — `{name, kind: passenger|goods, stationRefs[], polyline?}`.
- `rivers[]`, `coastline` — polylines (block coords).
- `landmarks[]` — `{name, x, z, kind, params}` (Roseberry, Horcum, Wainstones, kilns, abbey, crosses, Wade's Causeway, Mallyan Spout, …).

## 6. Geography model

### 6.1 Elevation (whole-map, OS-driven)
`height(x,z)` interpolates the OS elevation grid (bilinear), projected metres→block-Y by the documented transform, then applies **light stylisation** (the existing micro-roughness / bog-flattening / village-flattening passes) on top — so the **macro landform is real** (high moors, dale depths, escarpments, coast) while the surface keeps the voxel idiom. The dales (Esk, Rosedale, Farndale, Bilsdale, etc.) and the high moors fall where they really are because the grid says so, not because of noise.

### 6.2 Coast, estuary & rivers
`coastT`/`coastX` derive from the real **coastline polyline** (cliffs from the OS relief, not a formula). Rivers (Esk W→E to Whitby; Rye/Dove/Seven/Derwent to the south) are carved along the real **river polylines**. The **River Esk widens to a tidal estuary / harbour at Whitby, bisecting the town** (East Cliff ↔ West Cliff — §8 morphology); becks run through the cliff villages (Hutton Beck, the Staithes and Bay Town becks). Tidal water at the estuary mouth reuses the existing sea/water handling.

### 6.3 Landmarks (real positions + forms)
Kept, but at their **true sites**, shaped by the OS relief plus the existing characteristic sculpting: **Roseberry Topping**, **the Hole of Horcum**, **the Wainstones**, **Rosedale ironstone kilns**, **Whitby Abbey** (East Cliff), **Wade's Causeway** (Wheeldale Roman road), the **moor crosses** (Young Ralph, Fat Betty/White Cross, Lilla Cross), **Mallyan Spout**. `locationName` resolves to real place-names by nearest feature.

### 6.4 Client/relay parity (critical)
`MoorsGeography` (JS) and the `geography_noise` mirror (Python) **must return identical heights/landform**, or relay-side mining-depth/deeds and brain NPC placement will disagree with the client. Achieved by: both load the **same `moors-data`** file and use the **same documented interpolation + transform**. A parity test (§12) samples a grid on both and asserts equality within tolerance.

### 6.5 Hero terrain detail at distinctive places
Terrain 50's 50 m posts (≈3.3 blocks) **smear features narrower than ~100 m** — exactly the ones that give these places their character: Whitby's harbour channel and abbey cliff, Robin Hood's Bay's ravine, the Staithes gorge, Hutton-le-Hole's undulating green. At a curated set of **hero sites** we therefore sample **Defra LIDAR (1–2 m, open data)** locally, or hand-sculpt a feature-stamp (as the current game does for Roseberry/Horcum), so the steep micro-relief actually reads. The rest of the map stays on Terrain 50. The hero-site terrain is produced in **slice 0** so the morphology of §8 has real slopes to build on.

## 7. The railway (the spine, built first)

**Network (c.1900, §11 slice 1):** the four lines that met at Whitby + the ironstone line —
- **Moors line** (NER): Pickering – Levisham – (Newton Dale per 1900 roster) – Goathland – Grosmont – Sleights – Ruswarp – Whitby. Gentle adhesion (the 1865 deviation engineered out the Beck Hole incline).
- **Esk Valley line** (NER): Grosmont – Egton – Glaisdale – Lealholm – Danby – Castleton – Commondale – Kildale – Battersby – Great Ayton – Nunthorpe – (off-map Middlesbrough).
- **Whitby–Loftus coast line** (north): Whitby – Sandsend – Staithes – (off-map Loftus). Staithes Viaduct.
- **Scarborough & Whitby coast line** (south): Whitby – Hawsker – Robin Hood's Bay – Fyling Hall – Ravenscar – (off-map Scarborough). Larpool Viaduct.
- **Rosedale Ironstone Railway** (goods): Rosedale mines – moor-top – Ingleby Incline – Battersby. **Ingleby Incline** = a separate self-acting cable-incline mechanic (full wagons down haul empties up), not a free-running train.

**Engine reuse:** the existing `geography.railPath()` spline + engineered vertical profile (1-in-8 clamp, cuttings/embankments, platform pinning) and `rails.js` (instanced rails, sleepers, **lineside fences, flora**) are reused **unchanged in shape**, now fed the **real OS relief** so gradients are authentic. Viaducts where the real lines bridged (Larpool, Staithes) are placed from the line polylines.

**Scheduling (no driving):** a `timetable` module exposes `trainsAt(now)` — a pure function of the shared clock returning every active train `{line, id, chainage, heading}`. Per-line service patterns (departure offsets, dwell, turn-back) are authored so opposing trains meet only at passing loops and no single-line section or junction (Grosmont, Battersby, Whitby) is double-occupied. Deterministic ⇒ every client agrees with **zero network traffic**; it is the current one-train code generalised to N.

**Rendering:** compute all positions each frame (cheap); maintain 3D rakes only for trains in view via a **small pool** assigned to nearest runners (like mob culling).

**Station houses:** a new **clean, geometric** building style (crisp NER station-house geometry) replacing cottage-style station buildings, applied across the network.

## 8. Towns & population — three tiers

Makes "full parallel game" tractable by concentrating depth in hubs:
- **Tier 1 — hubs, fully realised (3):** **Whitby** (coast, four-line hub, abbey/museum/fishing), **Pickering** (south terminus, market), **Grosmont** (junction + engine shed). Full building layouts + brain NPCs + economy markets + quests, at today's Moorstead depth.
- **Tier 2 — villages, light (~10):** e.g. Goathland, Levisham, Glaisdale, Lealholm, Egton, Castleton/Danby, Rosedale Abbey, Staithes, Robin Hood's Bay, Helmsley, Kirkbymoorside — a few period buildings + a station + passer-by/canned-voice NPCs + a basic vendor.
- **Tier 3 — halts & hamlets (rest):** nameboard + platform + perhaps a cottage; no economy.

Reuses the existing villages array, building types, villager AI / brain, and economy (vendor purse, shipments) — the data just describes more settlements at real positions.

### 8.1 Distinctive-place morphology (must-keep character)
Named places keep their **real form** — bespoke layout characters, *not* the generic green/cluster/longgreen stamps — and a building placer that **terraces / steps to follow the gradient** (paired with the hero terrain of §6.5). The headline characters:
- **Whitby** — the Esk **tidal estuary / harbour bisects the town** (East Cliff ↔ West Cliff), linked by a **swing bridge**, with **two piers** at the mouth; **Whitby Abbey + St Mary's stand on the East Cliff headland, visibly high** over the town (the Church Stairs climb); a **West Cliff esplanade**; red-pantiled houses climbing both banks.
- **Robin Hood's Bay** — a **stepped cliff village**: cottages terraced steeply down the Bay Bank ravine to the slipway, tightly packed, red pantiles, narrow yards.
- **Hutton-le-Hole** — cottages **scattered round a large, irregular, undulating green** with **Hutton Beck winding through it** (white-railed footbridges, free-roaming sheep) — not linear.
- **Staithes** — a fishing huddle **down in the steep-sided beck gorge** to its harbour, the viaduct high overhead (correcting today's cliff-top placement).
- **Esplanades / promenades** where real (Whitby West Cliff, Sandsend).

This adds a **morphology layer** to the town system: distinctive sites declare a bespoke character that overrides the generic styles; the slope-aware placer and §6.5 terrain are the new dependencies.

## 9. World access — shared + solo

The geography is fully **data-driven and deterministic**, so solo and shared differ only in persistence/networking, not terrain:
- **Shared:** a new relay **room** with a seed that selects `MoorsGeography` (worlds-by-token; invited players). Block edits + pockets persist relay-side as for other rooms; the **world-epoch reset gate** applies.
- **Solo:** selectable as a local world (the `newWorld`/`continueGame` path), same `MoorsGeography`, persisted in browser IndexedDB.

## 10. Period accuracy (c.1900)

The **station roster is pinned to what existed in 1900** — exclude later additions (Beck Hole reopened 1908; Ravenscar's loop 1905; Newton Dale Halt is a modern NYMR creation — verify each before inclusion). All built content stays period-correct (Victorian) per house rules. A short railway-history pass during slice 1 finalises the exact per-line station list.

## 11. Decomposition into slices (build order)

Railway-first, playable incrementally; each slice is its own spec → plan → build.
- **Slice 0 — foundation:** data pipeline + `moors-data` (incl. **hero LIDAR/sculpt** at the §6.5 sites: Whitby estuary + abbey cliff, RHB ravine, Staithes gorge, Hutton green) + `MoorsGeography` + relay mirror + world selection (shared & solo). Done = the world loads with real relief, coast, estuary, rivers, landmarks, towns-as-markers; multiplayer room + solo both work; client/relay parity green.
- **Slice 1 — the railway:** all lines + 1900 stations + deterministic multi-train timetable + pool/cull rendering + clean geometric station houses + viaducts. (The spine "designed in first.")
- **Slice 2 — hub towns:** Whitby/Pickering/Grosmont fully realised (buildings + NPCs + economy + quests) + **bespoke morphology** (Whitby estuary bisection, abbey on the high East Cliff, swing bridge, piers, West Cliff esplanade).
- **Slice 3 — villages:** Tier 2/3 population + station environs + **distinctive characters** (Robin Hood's Bay stepped descent, Hutton-le-Hole green-and-beck, Staithes gorge) via the §8.1 morphology layer.
- **Slice 4 — ironstone + coast economy:** Rosedale goods line + **Ingleby Incline** mechanic + coastal fishing/freight hooks (fish specials off Staithes, ore, day-trippers to RHB).

## 12. Testing strategy (house headless pattern, `scripts/verify-*.mjs`)

- **geo parity** — `MoorsGeography.height` vs the Python mirror over a sample grid, equal within tolerance.
- **landform sanity** — known spot heights (e.g. Urra Moor high, Esk valley low, sea at the coast) land in the right bands; named landmarks within N blocks of their real positions.
- **hero-site relief** — the §6.5 sites carry their defining gradient (Whitby abbey cliff above harbour level; the RHB ravine and Staithes gorge steep enough to terrace); the Esk estuary is open tidal water through Whitby.
- **rail gradient** — every sampled segment within the 1-in-8 clamp; platforms level; line stays in its corridor; viaducts span where expected.
- **timetable conflict-free** — over a full clock cycle, no two scheduled trains share a single-line section or junction; meets occur only at loops.
- **stations** — 1900 roster only (no post-1900 halt present).
- Plus live preview checks (board/ride a passenger train; pool/cull holds at range).

## 13. Open items / deferred

- **Exact 1900 station roster** — finalise in slice 1 via a railway-history pass (flagged in §10).
- **Exact Tier-2 village list** — recommended set in §8; confirm during slice 3.
- **LIDAR hero detail** — Defra LIDAR (1–2 m, open) is **used at the curated hero sites** (§6.5) from slice 0; a wider LIDAR pass for generally crisper relief across the whole map remains a later option.
- **Driven trains + token working** — possible future slice; out of scope now.
- **Off-map termini** — represented as edge "off-map" portals (tunnel-mouth/fade); not built as towns.

## 14. Data sources

Railway history (period network): [Whitby & Pickering Railway](https://en.wikipedia.org/wiki/Whitby_and_Pickering_Railway), [Goathland station / 1865 deviation](https://en.wikipedia.org/wiki/Goathland_railway_station), [Scarborough & Whitby Railway](https://en.wikipedia.org/wiki/Scarborough_and_Whitby_Railway), [Whitby, Redcar & Middlesbrough Union (Whitby–Loftus)](https://en.wikipedia.org/wiki/Whitby,_Redcar_and_Middlesbrough_Union_Railway), [Staithes Viaduct](https://en.wikipedia.org/wiki/Staithes_Viaduct), [Rosedale Railway](https://en.wikipedia.org/wiki/Rosedale_Railway).
Geodata: OS Terrain 50, OS Open Rivers, OS Open Names, OS Boundary-Line (all OS OpenData / OGL); historic six-inch OS mapping via the National Library of Scotland (public domain) for the dismantled lines.
