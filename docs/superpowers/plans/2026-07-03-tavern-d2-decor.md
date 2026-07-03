# Workstream D2 — Tavern Decor: Gable, Sign, Parlour Furnishing, Seasonal Mounts, Strongbox

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn D1's bare shell into a period-correct pub: gabled slate roof + windows +
chimney outside, painted "Station Tavern" sign, a furnished parlour (hearth fire with
real flame/smoke/light, settle benches, four game tables, hatch/servery, strongbox),
warm window glow after dark, and seasonal dressing mount points driven by the existing
festival machinery.

**Design authority:** `docs/superpowers/2026-07-03-pub-interior-design-research.md`
(committed). The binding corrections from it: hatch/servery NOT a bar counter; plain
coal register-grate hearth (a stone hearth + real fire FX reads right in voxels) NOT
an inglenook-mythology set piece; chalked/boarded game tables NOT carved; paraffin-lamp
warm light; limewash-pale interior reads = keep stonebrick but light it warm; NO horse
brasses; small windows.

**Architecture:** Two halves. (1) **Worldgen** — `stampInns` gains a gabled roof
(copying `stampStations` `buildOne`'s roofY formula, worldgen.js:746-769), window
blocks, a chimney, and parlour furniture blocks (benches, table blocks, servery,
strongbox) — all deterministic voxels, protected by the existing protectedBox rule
for free. (2) **Client decor layer** — a new `src/innDecor.js` (`InnDecorLayer`),
constructed in Game beside `seasonalLayer`/`hearthLayer` and called each frame:
builds per-inn scene props (painted sign via CanvasTexture on a PlaneGeometry —
NOT a Sprite; hearth `Fire({smoke, light})`; night window-glow quads via
`addWindowGlow`; festival dressing at fixed mount points keyed on `festivalState`).
Follows `HearthLayer`'s throttled-rebuild/teardown contract exactly
(`userData.sharedMaterial`/`ownGeometry` flags, `fxMatCount` balance).

**Ground truth:** the D2 probe report (2026-07-03) — all anchors verified:
`stampInns` as shipped at worldgen.js:632-679; gable precedent worldgen.js:746-769;
`Fire(opts)` fire.js:438-532 (registers its own FX mats when smoke/light set);
`addWindowGlow` festivalKit.js:100-117; `nightFactor()` festivalKit.js:154-160;
`festivalState` dispatch seasonalLayer.js:104-189 + `FESTIVAL_BUILDERS` line 39;
teardown contract seasonalLayer.js:368-386; `makeNameplate` canvas pattern
entities.js:886-924 (NOT exported — copy the technique, don't import);
strongbox worldgen placement Just Works (openStrongbox auto-inits at main.js:1778,
interact at 4479, spill-on-break 4340 — but breaking is impossible inside the
protected box); verify stubs from verify-hearth.mjs / verify-festival-render.mjs
(document.createElement('canvas') stub before importing mesher/textures).

---

## Task 1: Worldgen — gable, windows, chimney, parlour furniture, strongbox

**Files:**
- Modify: `src/worldgen.js` (`stampInns` only)
- Modify: `src/innplan.js` (add furniture/mount-point positions to the plan object)
- Test: extend `scripts/verify-inn-interior.mjs`

**Plan-object additions (innplan.js).** The plan gains a `furnish` section — pure
data, derived deterministically from existing fields (no new RNG draws BEFORE the
existing ones — append draws after the tables shuffle so existing plans' geometry
is unchanged; verify-inn-interior's determinism assertion guards this):

```js
    furnish: {
      // parlour-interior coords (same space as parlour.hearth/tables)
      servery: { x: PARLOUR_W - 2, z: Math.floor(PARLOUR_L / 2) },   // hatch/servery counter cell against the east wall
      strongbox: { x: PARLOUR_W - 2, z: PARLOUR_L - 2 },             // the tavern strongbox (addendum §1)
      benches: tables.map(t => ({ x: t.x, z: t.z + 1 })),            // one settle/bench beside each game table
      // seasonal dressing mount points (world-space resolved by the decor layer):
      mounts: {
        mantel: { x: Math.floor(PARLOUR_W / 2), z: 2 },              // above the hearth
        doorOut: true,                                                // exterior door lintel (wreath)
        windows: true,                                                // exterior sills
      },
    },
```

- [ ] **Step 1 (TDD): extend verify-inn-interior.mjs** — assertions (against
`new Gen(12345)` + the generated Grosmont chunk(s), same pattern as the existing
worldgen block; note the furniture may span two chunks — generate BOTH chunks
covering protectedBox like the D1 straddle handling, and probe via a helper that
picks the right chunk's data for a world coord):
  - roof: the ridge cell (footprint centre-x column, any z inside) sits HIGHER than
    the eaves cell (footprint edge) — gable not flat: probe
    `roofYAt(fx-centre) > roofYAt(fx0)` by scanning y upward for B.SLATE.
  - windows: at least 2 B.WINDOW cells at groundY+2 on the footprint perimeter.
  - chimney: a column of B.RBRICK (or B.STONEBRICK — whichever Task chooses, assert
    that id) rising above the ridge peak at one gable end.
  - parlour: B.STRONGBOX at the plan's furnish.strongbox world cell; B.BENCH at each
    furnish.benches cell; table cells hold B.PLANKS at floorY+1 (a table block);
    servery cell holds B.PLANKS at floorY+1.
  - determinism: `innPlan(geo,'Grosmont',12345)` still byte-identical across two
    calls INCLUDING furnish; and origin/doorSide/footprint UNCHANGED vs a pinned
    literal snapshot of the v1.1.36 values (origin 1418,2592 / groundY 28 /
    doorSide 's' for the production seed is NOT what verify uses — verify uses seed
    12345; pin whatever the pre-change plan yields by computing it BEFORE editing
    and hard-coding those numbers into the assertion).
- [ ] **Step 2:** run — new assertions fail (flat roof, no windows, no furniture).
- [ ] **Step 3: implement.** In `stampInns`:
  - Replace the flat-roof line with the gable loop (probe report §9's adapted
    snippet: ridge along the LONGER footprint axis — for 9×7 that's x — peak =
    `g+wallH+1+Math.round((shorter half))`… CARE: ridge should run along the LONG
    axis so the gable triangles fill the SHORT ends. For footprint 9(x)×7(z): ridge
    is a line of constant z? No — ridge runs ALONG x (the long axis), height varies
    with |wz - zc|, gable-end triangles fill at wx=fx0/fx1. Derive carefully and
    make the verify assertion match the chosen orientation.)
  - Clear interior air up to the new roof underside (the old wallH ceiling is gone;
    the loft space above g+wallH can stay AIR — cosy low room, tall roof outside:
    simplest correct move is to keep a flat interior CEILING at g+wallH+1 as
    STONEBRICK under the gable — i.e. the gable is a closed loft shell above an
    unchanged interior. That keeps the D1 interior contract (and verify) intact.)
  - Windows: 2 per long wall at g+2, skipping the door column.
  - Chimney: 1-block RBRICK column at one gable end, from roof to peak+2 (matches
    stampStations' chimney idiom, worldgen.js:766-768).
  - Parlour furniture from `p.furnish`: tables = B.PLANKS at floorY+1 on each
    parlour.tables cell; benches = B.BENCH at floorY+1 at furnish.benches cells
    (skip any cell that would collide with a wall/door/hearth — bounds-check
    against the interior box); servery = B.PLANKS at floorY+1; strongbox =
    B.STRONGBOX at floorY+1 at its cell. (floorY+1 = ON the floor — floor cells
    are solid at floorY.)
- [ ] **Step 4:** verify-inn-interior + verify-inn-protection + full `npm run verify`
    green. If items.json staleness trips (no new item names here — BENCH/PLANKS/
    STRONGBOX/WINDOW/RBRICK all exist), investigate honestly.
- [ ] **Step 5:** commit `feat(tavern): gabled roof, windows, chimney, furnished parlour, tavern strongbox`.

## Task 2: Client decor layer — sign, hearth fire, window glow, seasonal mounts

**Files:**
- Create: `src/innDecor.js`
- Modify: `src/main.js` (construct + frame-call the layer, next to hearthLayer)
- Test: create `scripts/verify-inn-decor.mjs`

**Design (follow HearthLayer's shape):** `InnDecorLayer(scene, world)` with
`update(dt, playerPos, sky, season)` → throttled rebuild (0.4s) keyed on
`(nearestInnKey, festivalState.active, isFine(), nightBucket)`; `clear()` per the
seasonalLayer teardown contract. Per inn within RADIUS (48):

1. **Painted sign** (always): canvas → `THREE.CanvasTexture` → `PlaneGeometry(3, 0.75)`
   + `MeshBasicMaterial({map, transparent:false})`, dark board bg `#2a1c10`, warm
   cream serif lettering `#e8c96a`, positioned flush above the exterior door
   (doorSide-oriented, 0.06 off the wall face), `userData.ownGeometry = true`
   (material owned → no sharedMaterial flag). PLUS a small hanging bracket sign:
   same texture reused, half scale, perpendicular to the wall at the door's side,
   `rotation.y` perpendicular.
2. **Hearth fire** (always): `Fire({scale: 0.6, layers: isFine() ? 2 : 1, seed,
   smoke: false, light: isFine()})` positioned at the hearth cell inside the parlour
   (world coords, floorY+1 + 0.2). Fire() self-registers its FX mats; push the
   group to objects — its dispose() unregisters. (Smoke false: the parlour is
   underground; the chimney smoke outside comes free from seasonalLayer's existing
   cottage chimney pass only if the tavern registers as a building — it doesn't, so
   ALSO add one `makeSmoke(0.5)` plume at the chimney top outside, gated
   `Math.max(cold?1:0, nightFactor())` exactly like seasonalLayer.js:199-262;
   registerFxMat + dispose-unregister per the contract.)
3. **Window glow** (night only): `addWindowGlow(scene, objects, ...)` on each
   exterior window cell placed by Task 1, when `nightFactor() > 0.1`, warm
   `0xffce6b`. Rebuild key's nightBucket (`Math.round(nightFactor()*4)`) refreshes
   opacity steps without per-frame writes.
4. **Paraffin-lamp glow inside** (always, subtle): 2 small amber `addWindowGlow`-style
   quads on the parlour walls (reuse addWindowGlow with yaw facing inward — it's
   just an unlit amber quad; cheap and period-right).
5. **Seasonal mounts** (keyed on `festivalState(season.yearPhase).active`): yule →
   holly billboard (addBillboard, TILE.HOLLY exists as a block tile) on the mantel
   mount + wreath (holly billboard) on the exterior door lintel; harvest → wheat/
   sheaf billboard on the mantel; mayday/midsummer → wildflower billboard; none →
   nothing. Keep it to ONE prop per mount per festival — restraint reads better and
   the festival builders remain the spectacle owners.

**verify-inn-decor.mjs** (copy verify-hearth.mjs's stub pattern exactly —
document.createElement('canvas') stub BEFORE importing anything that pulls
mesher/textures; the canvas stub needs measureText for the sign's fit loop — extend
the ctx2d stub with `measureText: () => ({width: 10})`, `strokeText`, `fillText`):
- layer builds ≥ 1 object per inn in range (sign at minimum) on a synthetic world
  with a real `Gen(12345)`;
- sign object exists with ownGeometry flag; NO sharedMaterial flag (owned mat);
- `fxMatCount()` rises on build (fire) and returns to baseline after `clear()` —
  the no-leak assertion (INVARIANTS resource hygiene);
- night gating: build with a sky time at noon → no window-glow objects; at midnight
  → glow objects present (count them via a userData tag);
- determinism: two builds at the same inputs give the same object count + positions
  signature (verify-hearth's paneSig pattern);
- festival mount: build with yearPhase in the yule window → mantel prop present;
  out of window → absent.
- Plain fallback: with Fine off, layer still builds sign + fire (fewer layers) and
  registers no Fine-only mats beyond Fire's own (INVARIANTS Plain fallback).

- [ ] **Step 1:** write verify-inn-decor.mjs (failing).
- [ ] **Step 2:** implement src/innDecor.js.
- [ ] **Step 3:** wire into main.js — construct after hearthLayer (search
  `new HearthLayer(` in main.js), call `this.innDecor.update(dt, this.player.pos,
  this.sky, this.season)` in frame() adjacent to `hearthLayer.update` (find the
  exact call), and `clear()` wherever hearthLayer is cleared/rebuilt on world change.
- [ ] **Step 4:** package.json: add `verify:inndecor` + append to the verify chain.
  ARCHITECTURE.md: add the `Inn decor layer` row (`src/innDecor.js`, constructed
  main.js:<line>, guard verify-inn-decor).
- [ ] **Step 5:** full gate + `npm run build` green; commit
  `feat(tavern): inn decor layer — painted sign, hearth fire, window glow, seasonal mounts`.

## Task 3: proof pass + deploy (controller does this)

In-browser at Grosmont: gable + chimney + windows visible; sign legible above the
door; parlour has fire (flame + warm light), benches/tables/servery/strongbox;
strongbox opens (27 slots) and survives a death (items not carried); windows glow
after `setSeason`/time to night; yule dressing via `moorstead.debug.festival('yule')`
if wired, else setSeason to the yule window. Screenshots. Then deploy.

## Non-goals (later slices)
Games interactivity (D4 — tables are props only in D2), NPC parlour crowd (D3),
notes board (D6), music (D7), chill/fatigue (D5). No relay changes. No new block
ids (everything reuses existing blocks). No minClientVersion bump (worldgen visual
drift between client versions is accepted, same as D1's precedent).
