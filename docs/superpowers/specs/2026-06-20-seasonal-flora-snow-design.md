# Seasonal flora & sophisticated snow — design

- **Date:** 2026-06-20
- **Status:** Approved in brainstorm; pending spec review
- **Author:** James + Claude

## Problem

Seasons read as "always the same". Two gaps:

1. **Tree foliage never changes.** `SEASON_TILES` (src/textures.js) tints only moor
   ground flora (grass, heather, bracken, fern, bilberry, gorse). `TILE.LEAVES` /
   `TILE.MONKEY_LEAVES` are excluded and `seasonShiftPx` has no leaf branch, so
   canopy is the same colour all year. The title-screen flyover is also hardcoded
   to a warm-autumn look (`seasonStateAtPhase(0.6)`), so the landing scene never
   varies (left as-is by design).
2. **Flora is static, sparse in variety, and grid-regular.** Wildflowers are placed
   as block-aligned cutouts at worldgen; they neither bloom nor fade with the
   season, they're too dense, and they read as regular rows. Snow is a single
   height-gated white wash on terrain only, tied to the live real-world weather
   feed — so winter is bleak and unreliable.

## Goals

- Tree foliage turns with the season (spring flush → summer green → autumn gold/rust → winter brown); monkey puzzle stays evergreen (faint winter frost only).
- Stronger, clearly-readable seasonal colour on heather/bracken/grass — naturalistic but unmistakable.
- Seasonal flowers that **appear and vanish** by bloom window: snowdrops (late winter), daffodils (early spring), summer wildflowers **including foxgloves**, autumn seedheads/rosehips.
- Flora **patchier and less dense**; flowers **off-grid** — jittered position, random rotation, several variants per species, naturally clumped.
- **Sophisticated snow:** lies on everything (leaves, flora, roofs) and down to the valley floor in deep winter; gradual onset and thaw; **real falling snow**; footprints; drifts.
- **Reliable, deterministic winter snow** — Victorian-era reliable winters, driven by the season clock, **not** the live weather feed.
- **Lusher railway corridor** — significantly thicker flora and foliage (denser verges, hedgerow, brambles, trackside copses) along the moors line, without fouling the train's clearance or window sightlines.

## Non-goals

- No real snow **blocks** / walkable accumulation (no voxel-data snow, no collision changes). Depth is a non-destructive visual.
- No relay/multiplayer sync for flora or snow, no persistence.
- No change to the title-screen flyover's fixed seasonal look.
- Live weather (Open-Meteo) stays as-is for non-winter rain/fog/mist; only winter precipitation is decoupled.
- **Fruit-tree foraging is out of scope here** — apples/plums/blackberries, picking, edible items, trading and fruit regrowth are a separate sibling spec (see Related work). This spec only provides the season scalars and flora/tree placement it builds on.

## Backbone principle

Everything seasonal is a **deterministic, client-side function of (world seed, position, season-time)** — the same shared-clock idiom as `season.js`, the Great Fog, the train, and `weather-live.js`'s hour indexing. No relay traffic, nothing persisted. Every client (and Merlin) sees the same moor with zero coordination. Flowers and snow are visual/decorative: they never touch world data or the edit-ledger.

This is what makes the ambitious choices affordable — appear/vanish flowers and four-part snow cost nothing in multiplayer because no client ever has to tell another what it's showing.

## Components

### 1. Season signal — `src/season.js` (extend)

Add pure scalars built with the existing `bump()` idiom, all in `[0,1]`, all unit-tested:

- `snowdrop` — bump at late winter (~phase 0.97).
- `daffodil` — bump at early spring (~0.12).
- `summerBloom` — broad bump across summer (~0.35) — drives foxgloves and summer wildflowers.
- `seedhead` — bump at autumn (~0.62), overlapping `autumn`.
- `frost` — rises with winter (mirror of `warmth < 0`), for atmosphere and faint evergreen frosting.

No new state; pure functions of `yearPhase`.

### 2. Persistent flora colour — `src/textures.js` (extend, atlas retint, no re-mesh)

- Add `TILE.LEAVES` to `SEASON_TILES` with a real leaf-turn branch in `seasonShiftPx`: spring/summer green flush (`greenness`), autumn gold→rust (`autumn`), winter brown + desaturate (`warmth<0`).
- `TILE.MONKEY_LEAVES`: **not** seasonally turned; only a faint winter frost-desaturation via `frost`.
- Strengthen the existing heather / bracken / grass shifts so each season is obvious (raise blend amounts; widen the autumn/winter range). Keep within the naturalistic NYM palette.
- Optional: finer retint cadence (more than the current 40 buckets) so the turn is perceptible at session edges. Cheap.

### 3. Seasonal flower overlay — `src/floraLayer.js` (new)

A client-side **instanced cutout overlay**, decoupled from chunk meshes.

- **Placement is deterministic** from seed+position: a low-frequency *clump mask* noise carves patches with bare ground between (delivers "patchy, less dense"); within a clump, instances are scattered at **sub-block jittered positions** (off-centre), each with **random yaw** and one of **several variants** per species. No grid alignment.
- **Bloom-window gating:** each species renders only when its season scalar is high — snowdrop → daffodil → summer (foxgloves + wildflowers) → autumn seedheads/rosehips. When the active window changes (a few times per real day), rebuild the instance buffers. No chunk re-mesh, no world-data change.
- Foxgloves move here as a summer-blooming overlay flower; the dense persistent `B.FOXGLOVE` block scatter in worldgen is thinned accordingly.
- **Decorative, not harvestable** (overlay quads, not blocks). The persistent block flora (heather, gorse, fern, etc.) stay real, harvestable blocks — but their worldgen density is reduced and clumped to match the patchier look.
- Renders around the player within view distance; recycles instances as the player moves (same pattern as `src/rails.js`).

### 4. Snow — `src/mesher.js` (extend) + `src/snow.js` (new) + `src/sky.js` (extend)

Non-destructive, layered, all client-side:

- **Coverage (shader):** generalise the existing `addSnow` injection beyond the opaque terrain material to the **cutout material** (leaves + flora) and **building/roof** materials, gated to up-facing faces. The snow-line drops from the tops to the **valley floor** at deep winter.
- **Onset / melt (`snow.js`):** an `accumulation` scalar that lags `snowiness` — it builds while it's snowing and `warmth<0`, and thaws as `warmth` rises (spring). Drives coverage depth/whiteness so snow **creeps in and recedes over game-days**, slushy at the melting edges. Pure, testable.
- **Deterministic seasonal snowfall (`snow.js` + `sky.js`):** snowfall intensity is a function of the season clock — `winterStrength * showerOscillation(now)`, where `showerOscillation` is smooth value-noise on the shared clock so showers wax and wane, but **winter is reliably snowy** (Victorian winters). In winter this **takes precedence over the live weather feed**; other seasons keep current behaviour. Render **falling snow particles** (distinct from rain: slower, swirling, wind-affected) when snowfall > 0; reuse the `sky.js` particle scaffolding.
- **Footprints:** a small transient **trample-buffer** of recent positions (local player + visible relayed players + nearby mobs), rendered as compressed/darker decals on the snow surface. No voxel data; fades over time.
- **Drifts (depth):** noise-driven vertical offset / parallax on the snow shader so cover looks deeper in hollows and lee slopes. Visual only.

### 5. Winter atmosphere (anti-bleak)

Evergreen contrast (monkey puzzle, holly + red berries), rosehips/haws on hedgerow flora, frosted seedheads (overlay), low warm winter light, chimney wood-smoke, and the already season-gated winter birds (`src/entities.js`). Winter reads crisp and alive, not dead.

### 6. Lineside corridor — `src/worldgen.js` (extend)

The railway already plants a narrow verge (`geo.railInfo(x,z).d`, flora on `d 2.4–5`). Thicken it significantly so the line runs through lush green corridors:

- Widen the planted band and raise density — hedgerow, brambles, ferns and flowers on the verges and cutting tops, denser than the open moor.
- Add trackside copses and hedgerow trees (regular species; fruit trees arrive with the forage sibling spec), placed by the same clumped, patchy distribution as the rest of the moor.
- **Clearance constraint:** nothing is placed inside the loading-gauge envelope or where it would block the train's window sightlines. The cleared four-foot (`d < 4`) stays clear, new planting sits beyond the gauge, and `verify-rail-clearance` + `verify-train-view` must still pass.
- Seasonal colour and flowers on the corridor come free from Layers 1–3; this is purely a density/placement change to worldgen.

## Determinism, multiplayer, performance

- All visuals are pure functions of (seed, position, season-time); no relay, no persistence; clients agree implicitly.
- Instanced flora + shader snow are GPU-cheap; flora recycles around the player; buffers rebuild only on window change.
- Degrades gracefully if WebGL shader hooks are unavailable (falls back to flat colour / no drift), mirroring the existing snow fallback.

## Testing

- **Extend `scripts/verify-season.mjs`:** new bloom-window curves peak in the right season and are near-zero out of season (snowdrop ≠ summer, daffodil in spring, foxglove/`summerBloom` in summer, `seedhead` in autumn); `frost` tracks winter.
- **New `scripts/verify-flora.mjs`:** placement determinism (same seed+pos ⇒ same clumps/variants/jitter), clump mask produces bare gaps, window gating shows exactly one bloom set per window.
- **New `scripts/verify-snow.mjs`:** accumulation builds in winter and thaws in spring (monotonic within season); deterministic snowfall is reliably > baseline through winter and ~0 in summer; coverage gating math.
- **Visual bits** (shader coverage, particles, decals) proven via the existing `moorstead.debug` API + pixel-probe pattern, not pixels in CI.
- All new checks join `npm run verify`.

## Milestones (incremental within this spec)

- **M1 — Season signal:** add bloom/frost scalars + extend `verify-season`.
- **M2 — Foliage colour:** leaves turn, stronger heather/bracken/grass tints, monkey puzzle evergreen.
- **M3 — Flower overlay + lineside thickening:** `floraLayer.js` — deterministic clumped, off-grid, jittered, multi-variant, window-gated flowers (snowdrop→daffodil→summer/foxglove→seedhead); thin/cluster persistent block flora; thicken the railway corridor (denser verges, hedgerow, brambles, trackside copses) within clearance; `verify-flora` (+ re-run `verify-rail-clearance`/`verify-train-view`).
- **M4 — Snow coverage:** shader on leaves/flora/roofs + valley blanket; accumulation onset/melt; `verify-snow`.
- **M5 — Snowfall + footprints:** deterministic seasonal snowfall decoupled from live weather; snow particles; trample-buffer footprints.
- **M6 — Drifts + atmosphere:** shader drift depth; holly/berries/rosehips/wood-smoke/winter-bird polish.

## Related work (sibling spec)

**Forageable fruit & orchards** — to be brainstormed next. Apple/plum trees, bramble/blackberry, with blossom in spring and fruit ripening in late summer/autumn driven by *this* spec's season scalars, picked into edible items via the existing bilberry-forage + edit-ledger regrowth pattern, sold to villagers. It depends on this spec (season signal, tree/flora placement, lineside corridor) but mutates world state and adds items/trading, so it's specced and built separately.

## Risks / open questions

- **Foxglove interpretation:** assumed foxgloves become summer-blooming **overlay** flowers (appear/vanish), and the persistent `B.FOXGLOVE` block scatter is thinned. Confirm at spec review if you'd rather keep foxgloves as harvestable blocks that only *flower* seasonally.
- **Flower clump tuning** (density, clump size, variants-per-species) is a feel parameter — expect iteration in M3.
- **Footprints for remote players** depend on relayed positions already in hand; no new sync, but trail fidelity is best for the local player.
- **Window-change rebuild cost** for the flora overlay should be measured; if a hitch shows, stagger the rebuild across frames.
