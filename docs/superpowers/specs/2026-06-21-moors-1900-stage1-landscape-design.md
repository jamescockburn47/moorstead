# Moorstead 1900 — Stage 1: the landscape (rivers, dales, landmarks & clean buildings)

**Status:** design, awaiting review · **Date:** 2026-06-21 · **Type:** stage spec (child of the moors-1900 program)
**Parent program spec:** [`2026-06-21-moors-1900-world-design.md`](2026-06-21-moors-1900-world-design.md)
**Handoff:** [`docs/superpowers/moors-1900-handoff.md`](../moors-1900-handoff.md) · **Memory:** `moors-1900-world`

## 0. Where this sits (re-decomposition)

The program spec decomposed into Slices 0–4 (0 = foundation, built; 1 = railway; 2 = Whitby/hubs; 3 = villages; 4 = ironstone/economy). After Slice 0 shipped, James re-prioritised toward **identifiability first** and pulled Whitby forward. The work is now staged by what makes the world *read as the real Moors fastest*, and by a clean technical seam (render-only vs. parity-gated):

| New stage | Content | Maps to program |
|---|---|---|
| **Stage 1 (this spec)** | rivers, dales, landmarks, clean buildings, naming | §6.2 rivers + §6.3 landmarks + the deferred "more real landmarks" item + the building-discipline fix |
| Stage 2 | full c.1900 rail network + scheduled trains + NER station houses + viaducts | program Slice 1 |
| Stage 3 | Whitby estuary/cliffs/morphology + hero-terrain | program Slice 2 |
| Stage 4 | economy/farming/mining import, period-adapted | program Slice 4 + the economy program |

The program spec remains the source of truth for locked decisions and conventions; this spec only details Stage 1.

## 1. Goal

The **empty** moors world reads as unmistakably the North York Moors *before a single train runs*: the dales are real valleys with **named rivers** in them, the famous **landmarks** stand at their true sites in recognisable form, you can **see where you are**, and the few buildings present are **clean**, not jagged.

**Explicitly NOT in Stage 1** (later stages): the rail network, station houses, Whitby's estuary/cliffs, the economy. The building-discipline *fix* is here only because it repairs what's already on screen (the jagged Pickering station) and its helper is the foundation Stage 2's station houses are built on — so it is not throwaway.

## 2. Two deploys (split on the parity seam)

Per James's standing directive, each deploys live into the "Explore t' Real Moors" section.

- **1a — render-only.** Touches only the worldgen render path (block-stamping) and naming. **No `heightRaw` change ⇒ no relay mirror, no `verify-geo-parity` gate.** Fast, low-risk. Unit A, Unit B-built (crosses + causeway), Unit C (fingerposts + the existing landmark/village naming).
- **1b — parity-gated.** Changes the deterministic `heightRaw` (river channels + terrain landmarks), so it is mirrored into `deploy/world/geography_moors.py` and gated by `verify-geo-parity`. Unit B-terrain, Unit D (incl. the dale naming, which depends on the river polylines).

## 3. Unit A — axis-aligned building discipline (1a)

**Root cause of the jagged building.** Village buildings (`worldgen.js stampBuildingColumn`) are already world-axis-aligned boxes (`b.x0/x1/z0/z1`) and render cleanly. The *station* building (`stampStations` → `buildOne`, and the `stampTrainshed`/`stampFootbridge` helpers) lay their footprint along the **rail tangent** via `cell(a,w)` = `sp.x + ux·a + px·w` with `ux,uz = sp.tx,sp.tz`, then `Math.round` each cell to the grid. Where the line runs diagonally — as at Pickering — that rounding staircases the walls and skips/duplicates cells, producing the jagged, holey mess.

**Fix.** Introduce a small orientation helper used for the *building* (not the platform):
- **Cardinal snap:** from the rail tangent at the station, choose the long axis as N/S if `|tx| ≥ |tz|`, else E/W. The building footprint is then stamped on the **world x/z grid** (constant-x and constant-z walls), seated at the platform deck level `g` (as now — the vertical seating is already flat; only the horizontal footprint was diagonal).
- **Platforms, track, lamps, the departures board stay rail-parallel** (`cell()`). A stepped platform edge meeting a square building reads as authentic railway architecture; the wedge between the skewed platform and the square building is paved (`B.PLANKS`/`B.COBBLE`).
- Lives in the **shared** `stampStations`, so both the moors world and the existing stylised world get clean station buildings; nothing else in the existing world changes.

**Testability.** Extract the footprint maths as a **pure function** — `stationFootprint(samplePos) → { axis, x0, x1, z0, z1 }` — so a headless check can assert all four walls lie on constant x or constant z (axis-aligned, no diagonal stepping) for a range of tangents. The voxel stamping consumes it.

## 4. Unit B — the landmark layer (data-driven; 1a built + 1b terrain)

Keep the seam (program §6.3, §7 conventions): landmarks live in `data/moors-data.json`, emitted by `build-moors-data.py build_landmarks` at **true OSGB grid references**, and the consumers read the data list rather than the three hardcoded `geography.js` constants (`ROSEBERRY`/`WAINSTONES`/`KILNS`).

**`kind` vocabulary** (and which path renders it):

| kind | render path | deploy | sculpt/stamp |
|---|---|---|---|
| `peak` | `moorsgeo.heightRaw` sculpt loop (+ Python mirror) | 1b | cone rise toward a summit height |
| `hollow` | same | 1b | carved bowl (depth below local base) |
| `tor` | same | 1b | cluster of small rough rises + boulder blocks |
| `cross` | un-stub `moorsgeo.crossAt`, reuse worldgen cross stamp | 1a | standing stone cross |
| `causeway` | un-stub `moorsgeo.onRoad`/`signAt`, reuse worldgen road stamp | 1a | stone-paved line along a polyline |

**Bug to fix in passing:** `build_landmarks` currently emits Roseberry as `kind:"hill"`, but the sculpt loop only fires on `kind:"peak"` — so Roseberry likely isn't sculpting. Reconcile to one vocabulary and add a **drift guard** to the verify (build-script kinds ⊆ consumer-handled kinds).

**The Stage 1 set** (exact OSGB refs sourced and commented in the build script at build time — *not guessed*; approximate grid square given here for orientation):

| Landmark | kind | approx. grid sq. | deploy |
|---|---|---|---|
| Roseberry Topping | peak | NZ 57/12 | 1b |
| Captain Cook's Monument, Easby Moor | peak | NZ 59/10 | 1b |
| Hole of Horcum | hollow | SE 85/93 | 1b |
| The Wainstones, Hasty Bank | tor | NZ 55/03 | 1b |
| The Bridestones, Staindale | tor | SE 87/90 | 1b |
| Young Ralph Cross, Blakey Ridge | cross | NZ 68/02 | 1a |
| Fat Betty (White Cross) | cross | NZ 68/01 | 1a |
| Lilla Cross, Fylingdales Moor | cross | SE 88/98 | 1a |
| Wade's Causeway (Wheeldale Roman road) | causeway | SE 80/97 | 1a |

**Deferred by design:** Whitby Abbey → Stage 3 (needs East Cliff hero-terrain); Rosedale ironstone kilns → Stage 4; Mallyan Spout / Falling Foss waterfalls → later (need a beck+cliff sculpt).

## 5. Unit C — naming & fingerposts (1a)

The names already resolve (`moorsgeo.locationName` falls through landmarks → villages → coast → high-moor/dale). Stage 1:
- **Fingerposts (1a):** a small stamped white guidepost at village/crossroads approaches showing the nearest place-names (the classic moorland direction post). Render-only, deterministic placement near village markers.
- **Dale names (1b, ships with Unit D):** `locationName` returns the **dale** for proximity to a river polyline — Eskdale, Rosedale, Farndale, Ryedale, Bilsdale, Riccaldale, the Leven valley. Needs the river polylines present, so it rides with Unit D, not 1a.

## 6. Unit D — rivers & dales (1b)

**Why it's needed:** the six rivers in the data (Esk, Murk Esk, Derwent, Rye, Dove, Seven) are **stored but dormant** — `moorsgeo.js` has no river handling at all (no carve, no water, no naming), so they're invisible. Terrain 50 already encodes the broad **dales** (wider than its ~200 m smoothing), so we do **not** re-carve valleys — only the **river channel** the downsample smoothed away.

- **Incise + water:** a **distance-to-polyline** carve along each river — nearest river segment distance `d`; if `d < channelWidth`, lower the column toward a channel floor (`localBase − depth`) with a smooth shoulder. This is **new code** (the stylised world makes valleys from noise fields, not polylines, so there is nothing to mirror), but it is deterministic distance maths, so parity is achievable. Water (`B.WATER`) is stamped **client-side** in the channel, **following the terrain down** from moor to coast (not a flat sea-level fill — the Esk at Castleton runs ~150 m up).
- **Parity:** the channel carve changes `heightRaw`, so a **matching polyline-distance carve is added to `geography_moors.py`** (both read the same river polylines from `moors-data`), gated by `verify-geo-parity`. Water placement, being render-only, does not affect parity.
- **Naming:** `locationName` near a river returns the **dale** name (Unit C).
- **Add the missing rivers:** re-extract OS Open Rivers within bounds to add **Leven** (the Esk Valley line follows it), **Seph** (Bilsdale), **Riccal** (Riccaldale), and the **Tees** sliver that falls inside the northern bound. Keep them as named polylines in block coords.
- **Performance:** `heightRaw` is hot, and ~9 rivers × ~40 pts is ~360 segments. Reject by **per-river bounding-box** before per-segment distance, and rely on the existing `colCache`. If still hot, bucket segments into a coarse grid. (Flag in the plan; measure with the frame-pump harness.)

## 7. Data changes (`scripts/build-moors-data.py`)

- `build_landmarks`: emit the full Stage 1 set with real OSGB refs + `kind` + params; reconcile the `kind` vocabulary; record each coordinate's source in a comment.
- Rivers: include Leven, Seph, Riccal, Tees-sliver in the Open Rivers extraction; attach a `dale` name to each river record.
- Regenerate `data/moors-data.json` (re-run the PowerShell extraction + `python scripts/build-moors-data.py`; raw tiles live outside the repo at `C:\Users\James\moors-data-build\`).
- Schema additions are **additive** (new landmark kinds, river `dale` field) — the foundation schema is unchanged otherwise.

## 8. Client/relay parity (1b only)

`MoorsGeography._heightRawNoFbm` (JS) must equal `geography_moors.height_raw` (Python) over a sample grid. The river carve and the terrain-landmark sculpt are added to **both**; `verify-geo-parity.mjs` → `deploy/world/test_moorsgeo.py` must stay green. The relay (`geography_moors.py`/`geo_grid.py`) is only deployed to the EVO when the **shared** moors room goes live (Stage 2+); Stage 1's solo preview is pure client-side, but parity is still verified locally so the mirror never drifts.

## 9. Testing (house headless pattern, `scripts/verify-*.mjs`, wired into `npm run verify`)

- **`verify-landmarks-moors.mjs`** (new): every landmark within N blocks of its real OSGB position; each `kind` produces its defining relief (peak rises, hollow sinks, tor is rough) / structure (cross present, causeway polyline in bounds); build-script `kind`s ⊆ consumer-handled kinds (drift guard).
- **`verify-rivers-moors.mjs`** (new): all expected rivers present and within bounds; the channel sits **below** the surrounding terrain along the polyline; `locationName` returns the right dale at sample points; the Esk reaches the coast.
- **Station footprint** check (extend `verify-rail` or new): `stationFootprint` is axis-aligned for a range of tangents (all walls constant-x or constant-z).
- **`verify-geo-parity`**: stays green after the river carve + terrain-landmark sculpt are mirrored.
- **Live (frame-pump) checks:** `await game.startMoorsWorld(); for(let i=0;i<170;i++) game.frame();` then inspect — rivers visible with water, a clean station building, crosses/causeway present, `locationName` shows dales. (Screenshots time out on a backgrounded tab — verify via `eval`'d state + `preview_console_logs`.)

## 10. Deploy

For **each** of 1a then 1b: `npm run verify` (all green) → `npm run build` (exit 0) → `npx vercel deploy --prod --yes` → confirm live by fetching the bundle hash + frame-pump explore. (Deploy is Vercel-from-local-source, not git push.) James explores and reports defects; fix and redeploy into the same section.

## 11. Risks / unknowns to resolve in the plan

1. **`crossAt`/`onRoad` consumer shape** — confirm exactly how `worldgen.js` consumes `geo.crossAt(gx,gz)` (the 96-grid lookup) and `geo.onRoad`/`signAt`, so the moors un-stub feeds them the right shape.
2. **Is the existing peak sculpt already mirrored** in `geography_moors.py`? If not, fixing Roseberry + adding kinds is a larger parity change than expected.
3. **River carve vs. the rail corridor** — Stage 2's rail must sit *beside* (not in) a carved channel; carving rivers first (1b) is the right order, but note the constraint for Stage 2.
4. **River-carve performance** in hot `heightRaw` — measure; bbox-reject first, bucket if needed.
5. **Water down-the-channel** — the algorithm for a river surface that descends with the terrain (local pooling vs. a monotonic profile) needs a concrete rule; simplest is `waterTop = channelFloor + depth` per column, accepting small steps.

## 12. Forward note — Stage 2 coupling (the rail "kink")

Captured so it isn't lost: in Stage 2, **locally straighten the rail to its nearest cardinal through each station** (a small kink on approach), so the rail-parallel platform and the world-axis-aligned NER station house become **co-aligned** — no wedge, no skew, the way real stations sit on straight, level track. James explicitly authorised kinking the line to seat a squared building. Unit A's `stationFootprint` helper is the foundation; Stage 2 adds the approach-alignment and the NER style.
