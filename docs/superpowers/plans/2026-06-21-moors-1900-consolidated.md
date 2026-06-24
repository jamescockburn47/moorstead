# Moors 1900 — Consolidated Plan (landscape · branch railways · buildings)

> **For agentic workers:** execute stage by stage; build + verify + deploy each slice before the next. Steps use `- [ ]`. Commit only when James asks.

**Goal:** Finish the real-layout c.1900 North York Moors world — sculpt the dramatic coast, lay the full 1900 branch-rail network, and populate all 22 towns with period-accurate buildings (Whitby the showpiece).

**Architecture:** Three subsystems on the existing real-OS engine (`moorsgeo.js` height/coast/rail, `worldgen.js` chunk stamping, `data/moors-data.json`, `geography_moors.py` relay mirror). Built in dependency order: **landscape → railways → buildings**, because cliffs/gullies decide where the lines and streets go. Each subsystem is its own sub-plan below and produces working, deployable software on its own.

**Tech stack:** Vite + three.js client; JS worldgen with a Python height mirror (parity-guarded by `verify-geo-parity.mjs` + `deploy/world/test_moorsgeo.py`); headless `verify-*.mjs` assertions; deploy via `vercel --prod`.

**Branch:** `feat/moors-1900-stage1a` (everything uncommitted until James asks).

**Dependency order & why:**
1. **Landscape (coastal morphology)** — authoritative terrain; the rail re-fit and street layouts must read real cliffs/gullies.
2. **Branch railways** — re-fit to the corrected terrain; viaducts cross the new gullies; stations seed where town building-density concentrates.
3. **Buildings** — perch on the cliffs (Whitby), line the streets, step down the ravines; need both terrain and rail fixed first.

**Open choices for James** (call these and I'll lock them; defaults in **bold**):
- Branch lines to include: **Esk Valley, Scarborough & Whitby (coast S), Whitby–Loftus (coast N), Rosedale ironstone (goods)** — the real on-map ~1900 network. (Drop/add any.)
- Rosedale line: **goods-only** (kilns/depots, no passenger stations, no scheduled trains) vs full passenger. 
- Building bespoke-ness: **generic generator for all 22 + bespoke hero for Whitby** (and light hero touches for Pickering market + the ravine villages) vs bespoke for more towns (slower).
- Whitby abbey: **ruined** (the real 1900 state — roofless shell on the East Cliff) vs whole.

---

# Stage 1 — Coastal & valley morphology

Full design in [`docs/superpowers/specs/2026-06-21-coastal-morphology-design.md`](../specs/2026-06-21-coastal-morphology-design.md). Locked: **whole Heritage Coast**, **authoritative** (heightRaw + Python mirror). Three sculpt layers after the peak cones, before the sea-blend.

**Files:** `src/moorsgeo.js` (heightRaw), `deploy/world/geography_moors.py` (mirror), `data/moors-data.json` (+ `scripts/build-moors-data.py` for new landmarks), `scripts/verify-coast-moors.mjs` (new).

### Slice 1A — sculpt plumbing + Whitby cliffs
- [ ] Add `cliff` landmark kind: flat-top mesa, steep convex face, `h = max(h, …)`. Params `{top, plateauR, radius}`.
- [ ] Add Whitby **East Cliff** (~abbey 1802,3038, `top≈6`) and **West Cliff** (W of the Esk mouth) landmarks in `build-moors-data.py` → regenerate `moors-data.json`.
- [ ] Mirror the `cliff` sculpt in `geography_moors.py height_raw`.
- [ ] `verify-coast-moors.mjs`: Whitby clifftop = a flat ≥4×4 plateau within 1 block of `WL+top`, a sea column within ~12 blocks, face slope ≥3 b/block. Parity ref still sane.
- [ ] Build + `npm run verify` green; live-check the cliffs flank the harbour without damming the estuary; deploy.

### Slice 1B — gully villages
- [ ] Add `gully` landmark kind: project to mouth→head axis, `min`-cut the channel, `max`-raise the rims. Params `{head:[x,z], depth, halfWidth, rim}`.
- [ ] Add gullies for **Robin Hood's Bay, Staithes, Runswick, Sandsend**; mirror in Python.
- [ ] Verify: along each axis rim−floor ≥ depth−1, side slope ≥2 b/block. Build/verify/deploy.

### Slice 1C — general coast + open cliffs + town reconciliation
- [ ] Coast-distance field from `data.elevation` (coarse, cached, identical JS/Python); amplify coastal land near the shore + tighten `coastT` ramp (≈/4).
- [ ] Add **Boulby, Ravenscar** open-coast cliffs.
- [ ] Reconcile the town flatten (`height()`): buildable shelf without erasing cliffs — clamp so flatten never cuts a cliff/gully by >1 step; verify per coastal town.
- [ ] Verify whole-coast (steeper shore, dales unchanged) + parity (`test_moorsgeo.py`). Build/verify/deploy.

---

# Stage 2 — Branch railway network

**Design.** Today `railway()` builds one path from `data.stations` where `line==='moors'`. Generalise to **N lines**, each its own spline via the proven `buildRailPath`, re-fitted to the Stage-1 terrain, crossing gullies/rivers on the existing **deck-lift + open-arch viaduct** system (Larpool over the Esk, Staithes over the beck).

**The ~1900 on-map network** (add to `data.lines` + `data.stations`):
| Line | kind | on-map stations |
|---|---|---|
| Whitby & Pickering | passenger | *(built)* Pickering, Levisham, Goathland, Grosmont, Sleights, Whitby |
| Esk Valley | passenger | Grosmont*, Egton, Glaisdale, Lealholm, Danby, Castleton, Kildale, Battersby(edge) |
| Scarborough & Whitby (coast S) | passenger | Whitby*, Hawsker, Robin Hood's Bay, Fyling Hall, Ravenscar |
| Whitby–Loftus (coast N) | passenger | Whitby West Cliff, Sandsend, Kettleness, Staithes, Hinderwell, Loftus(edge) |
| Rosedale ironstone | goods | Bank Top, Blakey Jct, Rosedale West/East (kilns, no passenger halts) |

`*` shared station.

**Files:** `data/moors-data.json` (+ `build-moors-data.py`), `src/moorsgeo.js` (multi-line), `src/worldgen.js` (stamp all paths), `src/rails.js` (render all paths if it iterates one), `scripts/verify-rail-moors.mjs` (new/extend).

### Slice 2A — multi-line engine
- [ ] `railLines()` → `data.lines` mapped to ordered station lists; `railPaths()` → `lines.map(l => buildRailPath(stationsFor(l), height, villages, true, riverFn))`, cached.
- [ ] `railInfo(x,z)` → min `d` across all paths (return the nearest line's info); `samplePos`/`nearStation` line-aware.
- [ ] `worldgen.js` rail pass + `rails.js` render iterate **all** paths (embankment, bridges, ballast, sleepers, gauge-clear per path).
- [ ] Verify the built Whitby & Pickering line is byte-for-byte unchanged (regression) before adding lines. Build/verify/deploy.

### Slice 2B — Esk Valley + coast lines
- [ ] Add Esk Valley stations/line (runs the dale beside the Esk; shares Grosmont–Whitby alignment sensibly — separate path, may parallel).
- [ ] Add Scarborough & Whitby + Whitby–Loftus coast lines on the Stage-1 clifftops; **viaducts** at the RHB & Staithes gullies and Larpool over the Esk (bridge system; tune deck-lift for tall viaducts).
- [ ] Cardinal-boxed stations (reuse the station/trainshed stampers) at each halt.
- [ ] Verify: every line continuous, grade ≤ clamp, viaducts span the gullies (open arch + water/valley under), no line in the sea/through a cliff. Build/verify/deploy.

### Slice 2C — Rosedale ironstone + schedules
- [ ] Rosedale goods line on the moor tops (Bank Top–Blakey–Rosedale), with calcining-kiln stamps at the railheads (a period landmark).
- [ ] Extend the scheduled-train system to the new passenger lines (timetable per line) if in scope this stage, else flag for a later pass.
- [ ] Verify + deploy.

---

# Stage 3 — Buildings (all towns; Whitby hero)

**Design.** Replace `villageColumn(){return null}` with a real generator. Three parts: (1) a **period block/stamper kit**, (2) a **per-settlement layout generator** feeding the existing `{kind:'building', b, v}` contract, (3) **bespoke hero** layouts for Whitby (and light touches for Pickering + the ravine villages). Regional palettes by location.

**New blocks/tiles:** `PANTILE` (red pantile roof) in `defs.js` + a procedural tile in `textures.js`. (Walls reuse STONEBRICK gritstone / RBRICK red brick; roofs SLATE inland, PANTILE coast.)

**Period stampers** (extend `stampBuildingColumn`; all cardinal-oriented per the earlier jaggies fix):
- 2-storey option (`wallH` 6–7), **chimney stacks + pots** (a key period signature), dressed **quoins**, **multi-pane/sash** windows in regular bays.
- Kinds: `cottage` (long low dale), `terrace` (joined rows), `shop` (shopfront), `inn`, `farmhouse`+`byre`, `chapel` (Methodist), `townhouse` (3-storey Whitby), plus reused `station`; specials `abbey`, `church`.
- Roof material chosen by region: coast/older → PANTILE; inland/newer → SLATE; steep pitch.

**Layout generator** (`moorsgeo.js`, per town, seeded, lazy into `v.buildings`):
- Classify each town: `market-town` (Pickering), `dale-green` (Hutton-le-Hole, Goathland, Lealholm…), `coastal-terrace` (Whitby, RHB, Staithes, Sandsend), `rail-village` (Grosmont).
- Place plots on flat-enough, **dry** (`!nearRiver`, `coastT===0` unless coastal), **off-rail** (`railInfo.d` clear), non-cliff (slope) ground; cardinal-oriented; no-overlap (track placed boxes); deterministic.
- Style geometry: green-ring + lane / market-place + streets / terraces stepping the contours to the harbour.
- Density & mix by tier: cottages + a chapel + an inn + a shop or two + edge farms; tier-1 denser.

**Files:** `src/defs.js`, `src/textures.js` (PANTILE), `src/worldgen.js` (stampers), `src/moorsgeo.js` (`villageColumn` + layout gen + `npcSpot`/`npcHome` for moors), `scripts/verify-buildings-moors.mjs` (new).

### Slice 3A — period kit + generic layout (all towns populated)
- [ ] Add `PANTILE` block + tile + texture; verify it renders.
- [ ] Extend `stampBuildingColumn`: 2-storey, chimney+pots, quoins, sash bays, regional roof (param `b.roof`).
- [ ] Generic layout generator + moors `villageColumn()`; every town gets a believable cluster of period buildings on valid ground.
- [ ] Verify: each town has ≥ N non-overlapping buildings, all on dry/off-rail/non-cliff ground, cardinal-oriented, none in the river/sea/track. Build/verify/deploy.

### Slice 3B — settlement styles + regional palettes
- [ ] Per-style layout geometry (market-town / dale-green / coastal-terrace / rail-village) + greens/market-place/lanes via `villageColumn` kinds.
- [ ] Regional material palettes (moorland gritstone+slate / coastal stone+pantile / town +red brick).
- [ ] Verify styles read distinctly; spot-check Pickering (market place), a dale-green, a coast town. Build/verify/deploy.

### Slice 3C — Whitby hero (+ light hero touches)
- [ ] Bespoke Whitby: terraces climbing the **East & West Cliffs** (Stage-1 terrain), harbour quays along the Esk mouth, the **199 steps**, **St Mary's** + the ruined **abbey** on the East Cliff, the swing bridge.
- [ ] Light hero touches: Pickering market place + church; the ravine cottages stepping down RHB/Staithes.
- [ ] Verify Whitby reads as Whitby (cliffs + harbour + abbey + terraces); no floating/clipping buildings on the steep ground. Build/verify/deploy.

---

# Cross-cutting

- **Verification:** keep the whole `npm run verify` suite green at every slice; add `verify-coast-moors`, extend `verify-rail-moors`, add `verify-buildings-moors`; parity (`test_moorsgeo.py`) after any heightRaw change.
- **Stylised world untouched:** every change gated behind `geo.realWorld` / the moors data; main-game `Geography` path unchanged (its `villageColumn`, single rail line, no cliffs).
- **In-game verification before claiming** (per James's standing note): block-level checks + screenshots, honest reporting of partial completion.
- **Commits:** held until James asks; then commit per stage and merge `feat/moors-1900-stage1a` → `main`.
