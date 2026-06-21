# Foraging — Design

> A keen-eye foraging layer for Moorstead: berries, mushrooms, wild herbs, nuts, and fruit-tree harvests scattered across the moor, dale, and wood. Spot the faint glint, pick the fruit (the plant stays and regrows), then eat it, cook it, or sell it. Foraging is the autumn glut you stockpile against the winter scarcity already built.

## 1. Purpose & success criteria

- **Variety with a keen eye.** Many forageables across habitats and seasons, found by *looking* — each ripe forageable carries a faint glint so an attentive player spots it; there is no HUD marker or map ping.
- **Pick the fruit, keep the plant.** Harvesting takes the fruit/mushroom only. The bush/tree/plant remains and the forageable regrows next season (or after a few days). This re-homes today's bilberry behaviour, which wrongly destroys the whole bush.
- **All safe.** Everything pickable is edible. No poison/sickness system.
- **Seasonal & woven into winter.** Mushrooms, nuts, hips and tree fruit peak in autumn; herbs in spring/summer; sloes/hips/elderberries linger toward winter. Little fresh forage in deep winter — the autumn glut is what you cook and stockpile.
- **Uses:** eat raw (modest), **cook at the range** (more nourishing, warming in winter), or **sell to villagers**.

Non-goals (v1): poison/lookalikes; cultivation/planting of forageables; a forager skill/levelling; new biomes.

## 2. Architecture

Foraging reuses three systems already in the codebase, plus one small new ledger:

1. **`floraLayer.js` overlay (existing)** renders all forageables as instanced cutout quads, windowed around the player, with deterministic per-cell placement and seasonal appear/vanish. It already has the `fruitPicked(x,z,bush)` hook (built for exactly this) and `activeAdornments(season)` / `activeScatter(season)` tables. We extend it with forageable species and a **glint**.
2. **The harvest/use raycast (existing, `main.js`)** already harvests bilberry bushes (break → `entities.spawnDrop` → `player.addItem`, season-gated). We generalise it into a **forage action** that picks the looked-at forageable without destroying its host.
3. **Trade + cooking (existing)** — `economy.js` `VENDORS`/`PRICES` and the range `SMELTS` take new entries with no structural change.
4. **`forageLedger` (new, on `world`)** — a `Map` of picked positions → game-day, mirroring `editLedger`. It suppresses a picked forageable's overlay (via `fruitPicked`) and **expires (regrows)** after a short lifespan, so picking is persistent and shared without destroying the host block. This is the one genuinely new mechanism.

### Two kinds of forageable, one overlay

- **Host-borne fruit** sits on a persistent world block (a bush or tree): bilberries on `B.BILBERRY_BUSH`, blackberries on `B.BRAMBLE`, rosehips on `B.DOG_ROSE`, sloes on a new `B.BLACKTHORN`, elderberries on `B.ELDER`, and apples/pears/plums on new fruit-tree canopy blocks. These are floraLayer **adornments** (the existing `ADORN` mechanism): the fruit tile renders on the host block when in season and unpicked.
- **Scattered ground forage** has no host bush: mushrooms, wild garlic, sorrel, hazelnuts (hazelnuts may host on a hazel bush — see §4). These are floraLayer **scatter** instances placed deterministically on suitable surface cells (grass/wood-floor, habitat-gated), appearing only in their season.

Both are picked by the same forage action and recorded the same way (`forageLedger`). Neither places or removes a persistent block on pick — the difference is purely which cell/host the overlay instance sits on.

### Data flow (pick)

```
look at cell ──► forage action (main.js)
   │  is there a ripe, unpicked forageable here this season?
   │     • host-borne: block at cell is a known host AND its adornment is active AND not in forageLedger
   │     • scattered:  deterministic placement says a forageable is here AND active AND not in forageLedger
   ├─ yes ─► player.addItem(forageItem) ; world.recordForage(x,y,z, day) ; audio.pickup() ; toast
   │          floraLayer re-window ► fruitPicked()/scatter check hides that instance
   └─ no  ─► fall through to normal break/use
```

Regrowth: `world.expireForage(nowDay)` (called alongside `expireEdits`) deletes ledger entries older than `LIFESPAN.forage` game-days, and any entry whose forageable is now out of season is moot (the overlay is hidden by the season gate anyway). On the next window rebuild the forageable reappears.

### Glint (the "keen eye")

Ripe, unpicked forageable instances carry a **faint additive glint** — a gentle brightness pulse so they catch the eye without a marker. Implemented in the floraLayer cutout material via `onBeforeCompile`: a per-instance `aGlint` attribute (1 for ripe forageables, 0 otherwise) drives a slow time-based emissive shimmer (`+= aGlint * 0.10 * (0.5 + 0.5*sin(uTime*2 + hash))`). Subtle by design — readable in daylight, a soft sparkle at dusk. Distinct `customProgramCacheKey` (same pattern as snow/ice injections). No new draw calls.

## 3. Components & files

| File | Responsibility | Change |
|---|---|---|
| `src/forage.js` (new) | Pure forageable tables: species (item, host/scatter, tile, season scalar+threshold, habitat, glint), `activeForageables(season)`, `forageYield(...)`, `FORAGE_LIFESPAN`. Unit-tested. | create |
| `src/flora-season.js` | Add forage adornments + scatter entries (or import from `forage.js`). | modify |
| `src/floraLayer.js` | Render forage species; `aGlint` attribute; consult `forageLedger` via `fruitPicked`/a scatter-picked check. | modify |
| `src/mesher.js` | Glint shader injection on the cutout material (`aGlint` + `uTime`). | modify |
| `src/world.js` | `forageLedger` Map; `recordForage`, `isForaged`, `expireForage`; (de)serialize alongside `editLedger`. | modify |
| `src/main.js` | Forage action in the harvest/use raycast; call `expireForage`; drive `uTime`. | modify |
| `src/defs.js` | New `I.*` items (109+), `TILE.*` (65+), block defs for new hosts (blackthorn, hazel, fruit-tree blocks), `FOODS`, `SMELTS` (cooked forage), `ITEM_NAMES`, `B.*`. | modify |
| `src/textures.js` | Tile painters + item-icon painters for every new forageable + cooked variant + host. | modify |
| `src/worldgen.js` | Place new hosts (blackthorn/hazel in hedgerows; fruit trees in orchards near villages + occasional hedgerow); habitat cells for scatter are derived, not stamped. | modify |
| `src/economy.js` | `PRICES` for forage goods; a greengrocer/forager villager `buys`. | modify |
| `scripts/verify-forage.mjs` (new) | Headless tests: forage tables, season windows, yield, ledger expiry. | create |
| `package.json` | Wire `verify:forage`. | modify |

## 4. Forageables (variety, habitat, season)

Seasons are expressed against existing `season.js` scalars (e.g. `heatherBloom`, `summerBloom`, `frost`, `daffodil`) plus a couple of new bumps if needed (e.g. an `autumn`/`mush` scalar). Thresholds tuned in planning. Indicative set (v1):

**Host-borne fruit (pick, plant stays):**
- **Bilberries** — host `B.BILBERRY_BUSH`, late summer (`heatherBloom`). *Re-homed from today's destroy-the-bush behaviour.*
- **Blackberries** — host `B.BRAMBLE`, late summer→autumn (`blackberry`). *(overlay already exists; wire the pick.)*
- **Rosehips** — host `B.DOG_ROSE`, autumn→winter. Vitamin-rich; sellable; cook into a syrup? (v1: eat/sell.)
- **Sloes** — host new `B.BLACKTHORN` (hedgerow), autumn→winter. Bitter raw (low FOODS), better sold.
- **Elderberries** — host `B.ELDER`, early autumn.
- **Apples / Pears / Plums** — host new fruit-tree canopy blocks, late summer→autumn. The headline forage (see §5).
- **Hazelnuts** — host on a new `B.HAZEL` bush in hedgerows, autumn. Storable; sellable. (Host-borne, so it ships in Plan 2 with the other hedgerow forage.)

**Scattered ground forage (pick, regrows):**
- **Mushrooms** (e.g. *Cep* + *Chanterelle*, two tiles) — wood floor + damp moor/dale edges, autumn. The classic keen-eye find; cook for good nourishment.
- **Wild garlic** — wood edges/shady dale, spring. Flavour/cook.
- **Sorrel** — dale pasture/verges, spring→summer. Eat/cook.

Each forageable: a new `I.*` item, a tile, an icon, a `FOODS` value (raw, modest), optional `SMELTS` cooked variant, a `PRICES` entry. Exact roster trimmed/confirmed in planning (YAGNI — start with the strongest of each category and grow).

## 5. Fruit trees

New tree variant generated by worldgen:
- **Placement:** small **orchards** near villages (a cluster of fruit trees on pasture) plus the **occasional hedgerow fruit tree**. Apple/pear/plum chosen deterministically by position.
- **Form:** reuse the tree-stamp machinery with a fruit-tree trunk + a canopy leaf block tagged as a fruit-tree canopy (so the overlay knows to adorn it). Distinct from monkey-puzzle/oak/etc.
- **Fruit:** a seasonal **adornment** on the canopy (late summer→autumn) — apples/pears/plums render on the outer canopy blocks, with the glint. Picking yields the fruit; the tree (trunk + canopy) stays; fruit regrows next season.
- **Reach:** fruit on the lower canopy is pickable from the ground / by climbing; high fruit may require getting up to it (acceptable — part of the forage).

Fruit trees are their own plan (§7, Plan 3) because they touch worldgen tree generation, a new canopy-adornment path, and reach/pick nuances.

## 6. Cooking, trade, nutrition

- **Raw nutrition (`FOODS`)** modest (berries ~3, mushrooms raw ~2, herbs ~1–2, fruit ~3). Encourages cooking.
- **Cooking (`SMELTS` at `B.RANGE`)** — raw→cooked for the cookable ones: *fried mushrooms* (raw mushroom → cooked, ~6, and a `HOT_FOODS` member so it warms in winter), a *forager's stew* if we want a multi-input recipe (deferred unless the range supports multi-input cleanly — v1 keeps single-input smelts). Cooked forage joins `HOT_FOODS` (from the winter spec) where it's a hot dish.
- **Trade (`economy.js`)** — add forage items to `PRICES` (low unit values: berries 1–2, mushrooms 2–3, nuts 2, sloes/hips 1, fruit 2) and to a **greengrocer/forager villager's `buys`** so foraging is an income. Reuse the existing `doSell` flow unchanged.

## 7. Decomposition into plans

This spec is broad; it ships as **three independent, individually-deployable plans**, in order:

- **Plan 1 — Scattered ground forage + the forage mechanism.** `forage.js` tables; `forageLedger` (record/expire/serialize); the forage action in `main.js`; mushrooms + wild garlic + sorrel as scatter overlay species with the glint; cook (fried mushrooms) + trade; `verify-forage.mjs`. Establishes the whole picking/regrow/glint backbone end-to-end on the simplest forageables. **Deployable: you can find and pick mushrooms/herbs, cook and sell them.**
- **Plan 2 — Host-borne fruit (pick-keeps-plant).** Re-home bilberry + wire blackberry picks to leave the plant via `forageLedger`/`fruitPicked`; add hedgerow hosts (blackthorn/hazel/dog-rose where missing) + rosehips/sloes/elderberries/hazelnuts; trade. **Deployable: berries & hedgerow forage, bushes survive harvest, regrow seasonally.**
- **Plan 3 — Fruit trees.** Apple/pear/plum orchards + hedgerow trees; canopy fruit adornment + glint + pick; trade. **Deployable: orchards you can forage.**

Each plan: branch off main → subagent-driven TDD tasks → spec + quality reviews → final whole-branch review → `npm run verify` (all green) → build → deploy → push, matching the foliage/snow/winter cadence.

## 8. Testing

- **Headless (`verify-forage.mjs`)**, TDD'd: `activeForageables(season)` returns the right species per season (mushrooms in autumn, garlic in spring, none of the summer berries in deep winter); `forageYield` maps species→item; `FORAGE_LIFESPAN`/`expireForage` regrows after N days; ledger record/isForaged round-trips; placement determinism (same seed+cell ⇒ same forageable). Imports three.js/defs/season fine under Node.
- **Live drive (`window.game`)** for the visual/interaction layer: glint present on ripe instances (attribute set; no GLSL/console errors), forage action yields an item + suppresses the instance + leaves the host block, regrow after advancing days, no teardown leaks (overlay + ledger cleared/persisted on reload). Screenshots can't run on the backgrounded tab; verify via eval (instance/attribute/inventory/ledger state + console-error checks), the method used throughout the seasonal/winter work.

## 9. Risks & open calls (resolve in planning)

- **Forage action trigger.** Cleanest is: the existing harvest/break ray, when it targets a ripe forageable, *forages* instead of breaking the host. Must not block breaking the *bush itself* with a tool when the player actually wants to clear it (e.g. require empty-hand/secondary-use to forage vs. tool to cut). Decide the exact input in Plan 1 and keep it consistent for Plans 2–3.
- **Scattered-forage pick targeting.** Overlay instances sit at cell centres on top of a surface block; the ray hits the surface block. Plan 1 computes "is there a ripe forageable on the targeted surface cell?" deterministically (same function the overlay uses) — no per-instance raycast needed.
- **`forageLedger` persistence/scale.** Mirror `editLedger` (same save path + windowed relevance). Entries are tiny and expire; unbounded growth is bounded by expiry. Confirm the world save includes it (or accept session-local if `editLedger` is session-local).
- **Glint intensity** must stay faint (keen eye, not Christmas lights) — tune live; gate to ripe forageables only.
- **Fruit-tree reach** — high canopy fruit may be awkward to pick; Plan 3 favours low/outer canopy and accepts some unreachable fruit.
- **Roster size** — start minimal per category (YAGNI), expand once the backbone is proven.
