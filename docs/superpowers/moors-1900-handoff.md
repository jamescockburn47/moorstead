# Moorstead — "Moors 1900" world: handoff for the next agent

You are continuing a multi-slice build for **Moorstead** (a voxel game, Vite + three.js, live at **www.moorstead.app**, repo `C:\Users\James\Desktop\Moorcraft`). A new, *extra* world — **the real North York Moors as it was c.1900** — is being built **alongside** the existing stylised world (which must stay untouched). **Slice 0 (the foundation) is built and deployed live.** Your job is Slices 1–4.

## Read these first
- **Program spec:** `docs/superpowers/specs/2026-06-21-moors-1900-world-design.md` — the whole design + the slice decomposition. Read it fully.
- **Slice 0 plan:** `docs/superpowers/plans/2026-06-21-moors-1900-slice0-foundation.md`.
- **Memory:** the `moors-1900-world` auto-memory note (loaded into your context) — locked decisions + current state.

## What Slice 0 delivered (all on `main`, deployed, every defect James found is fixed)
A second, data-driven world reachable via a title-screen section **"🚂 T' Real North York Moors — 1900" → "Explore t' Real Moors"** (`ui.js`, shown once logged in) → `game.startMoorsWorld()` (solo, **transient** — `game.moorsPreview` flag makes `saveNow` bail so it never persists or clobbers the player's solo save). Also a shared room `moors1900` is wired in `joinShared`.

- **Geometry seam:** `src/moorsgeo.js` `MoorsGeography` implements the same interface as `src/geography.js` `Geography`, from `data/moors-data.json`. Selected by seed in `src/worldgen.js` (`isMoorsSeed` / `MOORS_SEED = strSeed('t-moors-1900')`). Everything downstream reads `world.gen.geo`, so rails/entities/economy work unchanged.
- **Real OS data:** `data/moors-data.json` (≈255 KB, bundled) built by `scripts/build-moors-data.py` from **OS OpenData (OGL, keyless)** — Terrain 50 (elevation), Open Names (towns + stations), Open Rivers (the Esk + 5 rivers). Raw downloads + extracted tiles live **outside the repo** at `C:\Users\James\moors-data-build\` (`terrain50.zip`, `opennames.zip`, `openrivers.zip`, `work/tiles/*.asc`, `work/on_*.csv`, `work/openrivers.gpkg`). Re-run the PowerShell extraction + `python scripts/build-moors-data.py` to regenerate the JSON; don't re-download unless needed.
- **Rail-path engine** extracted to `src/railpath.js` (`buildRailPath`/`samplePos`/`railInfo`) — shared by both worlds. Currently builds **one** line (the 'moors' line: Pickering–Levisham–Goathland–Grosmont–Sleights–Whitby).
- **Relay height mirror:** `deploy/world/geography_moors.py` + `geo_grid.py` (Python port), parity-tested.
- **`realWorld` flag** on `MoorsGeography` gates stylised-only content off (wild-quarry pits, spawned folk). Use it for any further such gating.

## CRITICAL conventions — do not break these
1. **Coordinates: `+x` = NORTH (up on the map), `+z` = EAST (right).** The engine's map (`ui.js buildBigMap`) assumes it. `build-moors-data.py to_block` = `(x=(N−minN)/15, z=(E−minE)/15)`; `blockToGrid` (in BOTH `src/geo-grid.js` and `deploy/world/geo_grid.py`) maps `bz`→easting, `bx`→northing. Sanity: Whitby is north of Pickering and east of Osmotherley; Staithes north of Whitby; Robin Hood's Bay south.
2. **1 block = 15 m.** World extent ≈ E444000–500000, N484000–521000 (OSGB) → ~3733 × 2467 blocks.
3. **Coast is DEM-driven** (`MoorsGeography.coastT` reads elevation; the sea is flood-filled from the map edges in the build and sunk to a −120 m sentinel; land clamped ≥ 0 m so nothing inland floods). Don't reintroduce a coast polyline.
4. **Surface tint** (heather/bog/pasture, drives ground block + map colour) is **elevation-driven** (`heatheriness`/`daleness`/`bogginess` from `_baseMetresToBlock`) — NOT noise. Keep it that way (noise caused "strips").
5. **Client/relay parity is mandatory:** `MoorsGeography._heightRawNoFbm` (JS) must equal `geography_moors.height_raw` (Python) — both read the same data file with the same maths. If you touch `heightRaw`, re-run `node scripts/verify-geo-parity.mjs && python deploy/world/test_moorsgeo.py`.
6. **NO DRIVEN TRAINS in this world** (James's decision). All trains are **scheduled, deterministic from the shared clock** — conflict-free by construction, zero relay train state. (This is the heart of Slice 1.)
7. **The data is the seam:** change `data/moors-data.json` via the build script for data; the consuming code reads the schema unchanged.

## Workflow (the house process)
- **Brainstorm → spec → plan → build, per slice** (the `superpowers` skill chain — brainstorming, writing-plans, then TDD via subagent-driven-development or executing-plans). Each slice gets its own `docs/superpowers/specs/` + `plans/` doc.
- **TDD:** put pure logic in headless `scripts/verify-*.mjs` checks wired into `npm run verify`. Templates: `verify-moorsgeo.mjs`, `verify-geo-grid.mjs`, `verify-geo-parity.mjs`.
- **Before deploy:** `npm run verify` (all green) + `npm run build` (exit 0).
- **Deploy is from LOCAL source, not git push:** `npx vercel deploy --prod --yes`. Verify live by fetching the bundle and grepping (see gotchas).
- **JAMES'S STANDING DIRECTIVE:** *each stage deploys live into that same "Explore t' Real Moors" UI section so he can explore for real.* So every slice ends: verify → `npm run build` → `vercel deploy --prod --yes` → confirm live; the section fills in stage by stage. He explores and reports defects; fix and redeploy.
- **Commit only when James asks** (his standing rule). Work currently sits on `main`, **not pushed to origin** (the `feat/moors-1900-world` branch is stale/behind — use `main` or a fresh branch).

## Gotchas (will waste your time otherwise)
- **`curl.exe` is broken on this box (SSL exit 35).** Use **PowerShell `Invoke-WebRequest`** for HTTP (data downloads, live-bundle checks). SSH works fine. Set `$ProgressPreference='SilentlyContinue'` before large IWR downloads or they crawl.
- **Preview screenshots time out** (a backgrounded preview tab freezes `requestAnimationFrame` and sizes the canvas 1×1). Verify the world by **pumping `game.frame()` in a loop via `preview_eval`** then checking `preview_console_logs` + `eval`'d state — not screenshots. To load it headlessly: `await game.startMoorsWorld(); for(let i=0;i<170;i++) game.frame();` then inspect.
- **OS Downloads API** (keyless, OGL): `https://api.os.uk/downloads/v1/products/<Terrain50|OpenNames|OpenRivers>/downloads?area=GB&format=...&redirect`. Sandbox blocks some file deletes — extract zips via in-memory streams, not overwriting temp files.
- **The relay** (`worldsvc`) lives at `~/moorstead/worldsvc/` on the EVO (`ssh evo-tailscale`); deploy `geography_moors.py`/`geo_grid.py` there via `scp` + restart only when the **shared** moors room + mining/deeds actually go live. The solo preview is pure client-side.

## The remaining slices (from spec §11)
- **Slice 1 — the railway network + scheduled trains + clean station houses.** Add the rest of the c.1900 network to the data + generalise the engine: the **Esk Valley line** (Grosmont–Egton–Glaisdale–Lealholm–Danby–Castleton–…–Battersby–Great Ayton–Nunthorpe), the two **lost coast lines** (Whitby–Loftus via Sandsend/Staithes with Staithes Viaduct; Scarborough & Whitby via Hawsker/Robin Hood's Bay/Ravenscar with Larpool Viaduct), and the **Rosedale Ironstone** goods line. Surviving stations → OS Open Names; closed coastal/ironstone stations → historic OS six-inch maps (NLS, public domain) / known coords. Then: a **deterministic multi-train timetable** (`trainsAt(now)` pure function of the shared clock; conflict-free meets at loops/junctions Grosmont/Battersby/Whitby), **pool+cull rendering** of N trains, and a **clean, geometric NER station-house** building style (James asked for this specifically — distinct from the cottage style). `railpath.js` currently does one line — generalise to many. Viaducts where the lines bridged. **No driving.** Pin the station roster to what existed in 1900 (exclude Beck Hole 1908, Ravenscar's 1905 loop, the modern Newton Dale Halt).
- **Slice 2 — hub towns.** Whitby / Pickering / Grosmont fully realised (building layouts + brain NPCs + economy + quests) **+ bespoke morphology** (Whitby: Esk **estuary bisecting the town**, abbey on a **visibly high East Cliff**, swing bridge, piers, West Cliff esplanade) **+ hero-LIDAR terrain** (§6.5) at those sites so the cliffs/estuary actually read (Terrain 50 @200 m smooths sub-100 m features — pull Defra LIDAR 1–2 m open data, or hand-sculpt). Re-introduce the folk here (currently suppressed by `realWorld`).
- **Slice 3 — villages.** Tier-2/3 population + **distinctive morphology** (Robin Hood's Bay stepped down its ravine, Hutton-le-Hole's cottages round an undulating beck-green, Staithes in its gorge) via a **slope-stepping building placer**.
- **Slice 4 — ironstone + coast economy.** The Rosedale ironstone goods line + the **Ingleby Incline** (1-in-5 self-acting cable incline — a special mechanic, not a free-running train) + coastal economy hooks (fish specials off Staithes, etc.).

## Deferred / known refinements (NOT defects)
- **Hero-LIDAR** for Whitby estuary/cliffs, RHB ravine, Staithes gorge (§6.5) — slices 2–3.
- **Heather over-extends onto the Tabular Hills** (real limestone farmland in the south, currently purple by elevation) — needs OS land-cover data to confine heather to true moorland; polish.
- **More real landmarks** — `build_landmarks` in the build script currently emits only Whitby Abbey + Roseberry Topping; add Hole of Horcum, Wainstones, Rosedale Kilns, Mallyan Spout etc. at real coords.
- **Check the always-on minimap** (top-right, a different renderer from the Tab "peek" map which was fixed) renders the moors world correctly (orientation/extent).
- Data grid is 200 m-downsampled (≈255 KB JSON in the bundle); finer resolution / binary encoding is a later optimisation.

**First move:** brainstorm Slice 1 with James (rail-network scope is largely decided in the spec, but confirm the station roster + the station-house look), write the spec + plan, then build TDD and deploy live into the section.
