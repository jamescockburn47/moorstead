# Foraging Plan 1 — Scattered ground forage + the forage backbone

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Find and pick scattered ground forage — mushrooms, wild garlic, sorrel — by spotting a faint glint, then cook (fried mushrooms) and sell them. Establishes the whole foraging backbone: forageable tables, the `forageLedger` (pick leaves no block and regrows), the glint shader, and the forage action.

**Architecture:** Forageables render through the existing `floraLayer` instanced overlay (seasonal, deterministic) with a new per-geometry **glint** injected into the cutout material. Picking is a *use* action on the targeted surface cell: a deterministic check (same placement the overlay uses) says whether a ripe, un-picked forageable is there; if so it yields an item and records the cell in a new `world.forageLedger`, which suppresses the overlay and expires (regrows) after a few game-days. No new world blocks; no re-mesh.

**Tech Stack:** vanilla ES modules, three.js (InstancedMesh + onBeforeCompile), Node `.mjs` verify scripts.

Plan 1 of 3 for the foraging spec ([2026-06-21-foraging-design.md](../specs/2026-06-21-foraging-design.md)). Reuses: `floraLayer.js`/`flora-placement.js`/`flora-season.js` (overlay), `mesher.js` cutout material (`addSnow` injection pattern), `world.js` `editLedger` (mirror for `forageLedger`), the `finishBreak` harvest path, `economy.js` trade, range `SMELTS`.

## File structure

- `src/forage.js` (new) — pure: `SCATTER_FORAGE` table, `activeForageables(season)`, `forageYield(tile)`, `FORAGE_LIFESPAN`.
- `src/flora-placement.js` — add a sparse `'forage'` placement mode.
- `src/defs.js` — new `I.*` items, `TILE.*`, `ITEM_NAMES`, `FOODS`, `SMELTS`.
- `src/textures.js` — tile painters + item-icon painters.
- `src/world.js` — `forageLedger` + `recordForage`/`isForaged`/`expireForage` + (de)serialize.
- `src/mesher.js` — glint injection into the cutout material + `setGlintTime`.
- `src/floraLayer.js` — render forage scatter (glint geometry; consult `world.isForaged`).
- `src/main.js` — forage *use* action; `expireForage`; drive glint time.
- `src/economy.js` — `PRICES` + a forager vendor's `buys`.
- `scripts/verify-forage.mjs` (new) + `package.json`.

## Verification note

Pure logic (tables, placement, ledger) is TDD'd in `verify-forage.mjs`. The glint, overlay rendering, and the forage interaction are visual/runtime — verified via the running-game drive (`window.game`, `game.seasonOverride`, eval of instance/attribute/inventory/ledger state + console-error checks), as throughout the seasonal/winter work. Each such task lists a manual check.

---

### Task 1: New forage items, tiles, nutrition, cooking, art

**Files:** Modify `src/defs.js`, `src/textures.js`. Data + art only — no logic.

- [ ] **Step 1: Items** — in `src/defs.js` `I`, after `WOOL_COAT: 108,` add:
```js
  CEP: 109, CHANTERELLE: 110, COOKED_MUSHROOMS: 111, WILD_GARLIC: 112, SORREL: 113,
```
- [ ] **Step 2: Tiles** — in `TILE`, after `ICE: 64,` add world tiles for the three pickable plants (cooked mushrooms is an item icon only):
```js
  CEP: 65, CHANTERELLE: 66, WILD_GARLIC: 67, SORREL: 68,
```
- [ ] **Step 3: Names** — in `ITEM_NAMES` add: `[I.CEP]: 'Cep', [I.CHANTERELLE]: 'Chanterelle', [I.COOKED_MUSHROOMS]: 'Fried Mushrooms', [I.WILD_GARLIC]: 'Wild Garlic', [I.SORREL]: 'Sorrel',`.
- [ ] **Step 4: Nutrition** — in `FOODS` add: `[I.CEP]: 2, [I.CHANTERELLE]: 2, [I.COOKED_MUSHROOMS]: 6, [I.WILD_GARLIC]: 1, [I.SORREL]: 1,`.
- [ ] **Step 5: Cooking** — in `SMELTS` add a cep/chanterelle → fried mushrooms entry. SMELTS take a single input; add two: `{ in: I.CEP, out: I.COOKED_MUSHROOMS, label: 'Fry t’ mushrooms' }, { in: I.CHANTERELLE, out: I.COOKED_MUSHROOMS, label: 'Fry t’ mushrooms' },`. Then add `I.COOKED_MUSHROOMS` to `HOT_FOODS` in `src/temperature.js` (it's a hot dish — warms in winter).
- [ ] **Step 6: Tile painters** — in `src/textures.js`, add atlas painters for `TILE.CEP` (brown-capped fat stalk), `TILE.CHANTERELLE` (golden funnel), `TILE.WILD_GARLIC` (broad green leaves + tiny white star flowers), `TILE.SORREL` (slim green leaves). Match the existing cutout-plant painter style (e.g. how `TILE.FOXGLOVE`/`TILE.BILBERRY` are drawn).
- [ ] **Step 7: Item icons** — add item-icon painters (`ITEM_ICON_PAINTERS` or the icon registry) for `I.CEP`, `I.CHANTERELLE`, `I.COOKED_MUSHROOMS` (mushrooms in a pan), `I.WILD_GARLIC`, `I.SORREL`, in the existing 32px icon style.
- [ ] **Step 8: Build** — `npm run build` (exit 0) and `npm run verify` (still green; nothing references the new ids yet).
- [ ] **Step 9: Commit** — `git add src/defs.js src/textures.js src/temperature.js && git commit -m "feat(forage): mushroom/garlic/sorrel items, tiles, nutrition, cooking, icons"` + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 2: Pure forage tables + sparse placement mode

**Files:** Create `src/forage.js`; Modify `src/flora-placement.js`; Create `scripts/verify-forage.mjs`.

- [ ] **Step 1: Write the failing test** — create `scripts/verify-forage.mjs`:
```js
// Foraging — run wi': node scripts/verify-forage.mjs
import { SCATTER_FORAGE, activeForageables, forageYield, FORAGE_LIFESPAN } from '../src/forage.js';
import { cellInstances } from '../src/flora-placement.js';
import { seasonStateAtPhase } from '../src/season.js';
import { TILE, I } from '../src/defs.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const autumn = seasonStateAtPhase(0.66), spring = seasonStateAtPhase(0.12), winter = seasonStateAtPhase(0.875);

// season windows
{
  const aut = activeForageables(autumn).map(s => s.tile);
  (aut.includes(TILE.CEP) ? ok : bad)('mushrooms forage in autumn');
  const spr = activeForageables(spring).map(s => s.tile);
  (spr.includes(TILE.WILD_GARLIC) ? ok : bad)('wild garlic forages in spring');
  (!activeForageables(autumn).map(s => s.tile).includes(TILE.WILD_GARLIC) ? ok : bad)('no garlic in autumn');
  (activeForageables(winter).length === 0 ? ok : bad)('nowt fresh to forage in deep winter');
}
// yield mapping
{
  (forageYield(TILE.CEP) === I.CEP ? ok : bad)('cep tile yields cep');
  (forageYield(TILE.WILD_GARLIC) === I.WILD_GARLIC ? ok : bad)('garlic tile yields garlic');
}
// lifespan is a positive number of game-days
{
  (typeof FORAGE_LIFESPAN === 'number' && FORAGE_LIFESPAN > 0 ? ok : bad)('forage regrows after a positive lifespan');
}
// 'forage' placement mode is sparse + deterministic
{
  let cells = 0;
  for (let x = 0; x < 60; x++) for (let z = 0; z < 60; z++)
    if (cellInstances(1234, x, z, 'forage', TILE.CEP).length) cells++;
  (cells > 0 && cells < 60 * 60 * 0.2 ? ok : bad)('forage placement is sparse (' + cells + '/3600 cells)');
  const a = JSON.stringify(cellInstances(1234, 7, 9, 'forage', TILE.CEP));
  const b = JSON.stringify(cellInstances(1234, 7, 9, 'forage', TILE.CEP));
  (a === b ? ok : bad)('forage placement is deterministic');
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run, expect FAIL** — `node scripts/verify-forage.mjs` (module missing).

- [ ] **Step 3: Create `src/forage.js`:**
```js
// forage.js — pure forageable tables. No DOM, no three.js.
//   Scattered ground forage: standalone plants picked off open ground (no host bush).
import { TILE, I } from './defs.js';

// scalar/threshold pick the season window (season.js bumps). habitat reserved for later refinement.
export const SCATTER_FORAGE = [
  { tile: TILE.CEP,         item: I.CEP,         scalar: 'seedhead',    threshold: 0.3, habitat: 'wood' },
  { tile: TILE.CHANTERELLE, item: I.CHANTERELLE, scalar: 'seedhead',    threshold: 0.3, habitat: 'wood' },
  { tile: TILE.WILD_GARLIC, item: I.WILD_GARLIC, scalar: 'daffodil',    threshold: 0.3, habitat: 'wood' },
  { tile: TILE.SORREL,      item: I.SORREL,      scalar: 'summerBloom', threshold: 0.3, habitat: 'dale' },
];

export const FORAGE_LIFESPAN = 4; // game-days until a picked forageable regrows

export function activeForageables(season) {
  return SCATTER_FORAGE.filter(s => (season[s.scalar] || 0) > s.threshold)
    .map(s => ({ tile: s.tile, item: s.item }));
}

export function forageYield(tile) {
  const s = SCATTER_FORAGE.find(f => f.tile === tile);
  return s ? s.item : null;
}
```
(If `season.js` lacks a clear autumn scalar, `seedhead` (autumn seed-heads, peak ≈0.66) is the autumn window; confirm it exists and peaks in autumn — it was added in the foliage work.)

- [ ] **Step 4: Add the `'forage'` mode** to `src/flora-placement.js` `cellInstances` — sparser than `'moor'` (keen-eye rare). Inside the function, before the `else` moor branch, handle forage:
```js
  if (mode === 'forage') {
    const clump = noise2(cx * 0.08, cz * 0.08, seed ^ S_CLUMP ^ (tile << 4));
    if (clump < 0.6) return [];          // rarer, more scattered than flowers
    if (r(S_COUNT) < 0.7) return [];
    count = 1;
  } else if (mode === 'lineside') {
    count = 3 + Math.floor(r(S_COUNT) * 4);
  } else {
    const clump = noise2(cx * 0.10, cz * 0.10, seed ^ S_CLUMP ^ (tile << 4));
    if (clump < 0.5) return [];
    if (r(S_COUNT) < 0.55) return [];
    count = 1;
  }
```
(Restructure the existing if/else to add the `'forage'` branch first; keep `'lineside'`/moor exactly as they are.)

- [ ] **Step 5: Run, expect PASS** — `node scripts/verify-forage.mjs` → `RESULT: PASS`.
- [ ] **Step 6: Commit** — `git add src/forage.js src/flora-placement.js scripts/verify-forage.mjs && git commit -m "feat(forage): pure forageable tables + sparse placement mode"` + trailer.

---

### Task 3: `forageLedger` — pick records, regrows

**Files:** Modify `src/world.js`; extend `scripts/verify-forage.mjs`.

- [ ] **Step 1: Add the failing tests** — append to `scripts/verify-forage.mjs` before the RESULT line:
```js
// forageLedger: record -> isForaged true; expires (regrows) after FORAGE_LIFESPAN days
{
  const { World } = await import('../src/world.js');
  const w = new World(1234);
  w.recordForage(5, 41, 9, 10);
  (w.isForaged(5, 41, 9) ? ok : bad)('a picked cell reads as foraged');
  (!w.isForaged(6, 41, 9) ? ok : bad)('an unpicked cell reads as not foraged');
  w.expireForage(10 + FORAGE_LIFESPAN);
  (!w.isForaged(5, 41, 9) ? ok : bad)('forage regrows after its lifespan');
}
```
(Confirm `World`'s constructor signature from `world.js`; adapt the `new World(...)` call to match. If `World` needs more than a seed, construct it the way `verify-resources.mjs` / other verify scripts do.)

- [ ] **Step 2: Run, expect FAIL** — `node scripts/verify-forage.mjs` (`recordForage` undefined).

- [ ] **Step 3: Implement** in `src/world.js`, mirroring `editLedger`. In the constructor add `this.forageLedger = new Map();`. Add methods:
```js
  recordForage(x, y, z, day) { this.forageLedger.set(`${x},${y},${z}`, day); }
  isForaged(x, y, z) { return this.forageLedger.has(`${x},${y},${z}`); }
  expireForage(nowDay) {
    for (const [k, day] of this.forageLedger)
      if (nowDay - day >= FORAGE_LIFESPAN) this.forageLedger.delete(k);
  }
```
Import `FORAGE_LIFESPAN` from `./forage.js`. If `world.js` serializes `editLedger` (a save/load path), serialize `forageLedger` the same way (an array of `[key, day]`); if `editLedger` is session-only, leave `forageLedger` session-only too (match the existing pattern).

- [ ] **Step 4: Run, expect PASS** — `node scripts/verify-forage.mjs` → `RESULT: PASS`.
- [ ] **Step 5: Commit** — `git add src/world.js scripts/verify-forage.mjs && git commit -m "feat(forage): forageLedger records picks and regrows them"` + trailer.

---

### Task 4: Glint shader on the cutout material

**Files:** Modify `src/mesher.js`. Visual.

- [ ] **Step 1: Glint uniform + injection** — in `src/mesher.js`, add a time uniform and extend the cutout material's injection. Add near `snowUniforms`:
```js
const glintUniform = { uGlintTime: { value: 0 } };
export function setGlintTime(t) { glintUniform.uGlintTime.value = t; }
```
Change `addSnow` to optionally inject glint (a material has only one `onBeforeCompile`, so glint must ride along with snow on the cutout material). Give it a third param `glint = false`:
```js
function addSnow(mat, key = 'terrain-snow', glint = false) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSnowLine = snowUniforms.uSnowLine;
    shader.uniforms.uSnowAmt = snowUniforms.uSnowAmt;
    // ... existing snow vertex/fragment injection unchanged ...
    if (glint) {
      shader.uniforms.uGlintTime = glintUniform.uGlintTime;
      shader.vertexShader = 'attribute float aGlint;\nvarying float vGlint;\nvarying float vGlintH;\n' + shader.vertexShader
        .replace('#include <begin_vertex>',
          '#include <begin_vertex>\n  vGlint = aGlint;\n  vGlintH = transformed.x * 1.7 + transformed.z * 2.3;');
      shader.fragmentShader = 'uniform float uGlintTime;\nvarying float vGlint;\nvarying float vGlintH;\n' + shader.fragmentShader
        .replace('#include <color_fragment>',
          '#include <color_fragment>\n  float gl = vGlint * 0.12 * (0.5 + 0.5 * sin(uGlintTime * 2.0 + vGlintH));\n  diffuseColor.rgb += gl;');
    }
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}
```
(Keep the existing snow vertex/fragment `.replace(...)` lines exactly; only add the `if (glint) { ... }` block and the third param.)

- [ ] **Step 2: Enable glint on the cutout material** — change its construction:
```js
    cutout: addSnow(new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide }), 'snow-cutout-glint', true),
```
(New cache key `'snow-cutout-glint'` so the program recompiles with the new attribute. Geometry without `aGlint` defaults the attribute to 0 — chunk cutouts stay un-glinted, exactly like `aSnowExp`.)

- [ ] **Step 3: Build + manual check** — `npm run build` (exit 0). Dev server: no GLSL/console errors; existing flora/snow/ice still render. (Glint isn't visible yet — no geometry sets `aGlint`; Task 5 does.)
- [ ] **Step 4: Commit** — `git add src/mesher.js && git commit -m "feat(forage): faint glint injection on the cutout material"` + trailer.

---

### Task 5: Render forage scatter in the overlay (glinting, suppressed when picked)

**Files:** Modify `src/floraLayer.js`. Visual.

- [ ] **Step 1: Imports** — in `src/floraLayer.js` add `import { activeForageables, forageYield } from './forage.js';` and `import { cellInstances } from './flora-placement.js';` (already imported).

- [ ] **Step 2: Glint geometry** — change `crossGeom(tile)` to `crossGeom(tile, glint = 0)` and add an `aGlint` attribute (one float per the 8 vertices) after the colour attribute:
```js
  g.setAttribute('aGlint', new THREE.Float32BufferAttribute(new Array(8).fill(glint), 1));
```

- [ ] **Step 3: Render forage in `build()`** — after the existing scatter block (the `if (scatter.length && top === B.AIR && surf === B.GRASS && !inVillage)` loop), add a forage loop on the same open-grass cells, suppressed by the ledger, tagged as glinting. Track which tiles glint so the mesh build sets the attribute:
```js
    const forage = activeForageables(season);
    const glintTiles = new Set(forage.map(f => f.tile));
    // ... inside the x,z loop, alongside the scatter block: ...
        if (forage.length && top === B.AIR && surf === B.GRASS && !gen.geo.inVillage(x, z, 1)
            && !this.world.isForaged(x, surfY + 1, z)) {
          for (const f of forage)
            for (const inst of cellInstances(seed, x, z, 'forage', f.tile))
              add(f.tile, x + inst.dx, surfY + 1, z + inst.dz, inst.yaw, inst.scale);
        }
```
Then where the per-tile `InstancedMesh` is built, pass the glint flag:
```js
      const mesh = new THREE.InstancedMesh(crossGeom(tile, glintTiles.has(tile) ? 1 : 0), mat, places.length);
```
(`glintTiles` must be in scope at the mesh-build loop — declare it near the top of `build()`.)

- [ ] **Step 4: Build + manual check** — `npm run build`. Dev server: `game.seasonOverride = 0.66` (autumn) → mushrooms/sorrel appear sparsely on open grass with a gentle shimmer; `game.seasonOverride = 0.875` (winter) → none. Eval check: an autumn forage `InstancedMesh` exists and its geometry has an `aGlint` attribute with value 1; no console errors.
- [ ] **Step 5: Commit** — `git add src/floraLayer.js && git commit -m "feat(forage): render glinting forage scatter, suppressed when picked"` + trailer.

---

### Task 6: The forage action (pick where you look) + regrow + glint time

**Files:** Modify `src/main.js`. Interaction.

- [ ] **Step 1: A deterministic "forageable here?" helper** — add a method on the game (near `finishBreak`) that mirrors the overlay's placement so picking agrees with what's drawn:
```js
  forageableAt(x, z) {
    if (!this.season) return null;
    const gen = this.world.gen, seed = gen.seed >>> 0;
    const surfY = gen.height(x, z);
    if (this.world.getBlock(x, surfY + 1, z) !== B.AIR || this.world.getBlock(x, surfY, z) !== B.GRASS) return null;
    if (gen.geo.inVillage(x, z, 1)) return null;
    if (this.world.isForaged(x, surfY + 1, z)) return null;
    for (const f of activeForageables(this.season))
      if (cellInstances(seed, x, z, 'forage', f.tile).length) return { item: f.item, y: surfY + 1 };
    return null;
  }
```
Import `activeForageables` from `./forage.js` and `cellInstances` from `./flora-placement.js`.

- [ ] **Step 2: Wire it into the *use* action** — find the right-click / use-item handler (grep for the secondary-action path, e.g. `useItem`, `onUse`, `rightClick`, or where placing happens on right-click). At the start of that handler, before the default place/use behaviour, when the player targets a block whose column has a forageable, forage it instead:
```js
    const fa = this.forageableAt(hit.x, hit.z);
    if (fa) {
      this.player.addItem(fa.item, 1);
      this.world.recordForage(hit.x, fa.y, hit.z, this.sky.day);
      this.floraLayer.center = null;              // force overlay rebuild so the picked plant vanishes
      this.audio.pickup();
      this.ui.toast('Foraged ' + itemName(fa.item) + '.', 1500);
      return;                                     // don't also place/use
    }
```
(Use the real targeted-block variable name; `itemName` is exported from defs.js. Only forage when the use action would otherwise do nothing harmful — guard so it doesn't fire while placing a block from the hotbar if that conflicts; if needed, gate on empty-hand / non-placeable held item.)

- [ ] **Step 3: Regrow + glint time each frame** — where `expireEdits` is called each frame/day, add `this.world.expireForage(this.sky.day);`. Where the frame updates time-driven shaders (near `setSnowLevel`/`setFrozen`), add `setGlintTime(this.sky.t || performance.now() / 1000);` (import `setGlintTime` from `./mesher.js`; use the game's existing clock if there is one, else elapsed seconds).

- [ ] **Step 4: Build + manual check** — `npm run build`. Dev server, `game.seasonOverride = 0.66`: aim at a glinting mushroom and use → it's added to inventory (`game.player.slots` has the item), the plant disappears, a toast shows; the cell reads `game.world.isForaged(...) === true`. Advance days (`game.sky.day += 4; game.world.expireForage(game.sky.day); game.floraLayer.center=null`) → it regrows. No console errors.
- [ ] **Step 5: Commit** — `git add src/main.js && git commit -m "feat(forage): forage action picks where you look; regrow + glint time"` + trailer.

---

### Task 7: Trade — sell forage to a villager

**Files:** Modify `src/economy.js`.

- [ ] **Step 1: Prices** — in `PRICES` add: `[I.CEP]: 3, [I.CHANTERELLE]: 3, [I.COOKED_MUSHROOMS]: 7, [I.WILD_GARLIC]: 2, [I.SORREL]: 2,`.
- [ ] **Step 2: A buyer** — add the forage items to a fitting villager's `buys` in `VENDORS` (the cook/greengrocer-type, e.g. `james` who already buys `I.BILBERRIES`, or whichever vendor is the food buyer): add `I.CEP, I.CHANTERELLE, I.WILD_GARLIC, I.SORREL, I.COOKED_MUSHROOMS`. Read `VENDORS` and pick the food-trade villager.
- [ ] **Step 3: Build + verify** — `npm run build` (exit 0); `npm run verify` green (if a `verify-economy`/facts check exists, ensure it still passes; sync facts if the repo has `scripts/sync-facts.mjs` and economy feeds it).
- [ ] **Step 4: Commit** — `git add src/economy.js && git commit -m "feat(forage): sell foraged goods to the food trader"` + trailer.

---

### Task 8: Wire `verify-forage` into the suite

**Files:** Modify `package.json`.

- [ ] **Step 1:** Add `"verify:forage": "node scripts/verify-forage.mjs",` next to `verify:survival`, and insert `node scripts/verify-forage.mjs` into the `verify` chain right after `node scripts/verify-survival.mjs`.
- [ ] **Step 2: Run** `npm run verify` → all `RESULT: PASS`, exit 0 (~24 checks).
- [ ] **Step 3: Commit** — `git add package.json && git commit -m "test: add verify-forage to the verify suite"` + trailer.

---

## Self-Review

**Spec coverage (Plan 1 slice):** scattered ground forage (mushrooms/garlic/sorrel) ✓ T1/T2/T5; the forage mechanism (deterministic placement, `forageLedger` record/regrow, pick-leaves-no-block) ✓ T2/T3/T6; glint/keen-eye ✓ T4/T5; cook ✓ T1 (SMELTS + HOT_FOODS); trade ✓ T7; tests wired ✓ T8. Host-borne fruit + fruit trees are Plans 2–3 (out of scope here).

**Placeholder scan:** pure tasks (T2, T3) have complete code + commands; visual/interaction tasks (T4–T7) give complete code for the logic and explicit manual checks for glint/overlay/pick/trade (can't screenshot the backgrounded tab). The "find the use-item handler" / "confirm World constructor" / "pick the food vendor" notes are necessary lookups, not placeholders — the code to write is fully specified.

**Type/name consistency:** `SCATTER_FORAGE`/`activeForageables`/`forageYield`/`FORAGE_LIFESPAN` (T2) consumed in T3 (`world.js` imports `FORAGE_LIFESPAN`), T5 + T6 (`activeForageables`/`forageYield`/`cellInstances`). `forageLedger`/`recordForage`/`isForaged`/`expireForage` (T3) consumed in T5 (`isForaged` suppression), T6 (`recordForage`/`expireForage`). `aGlint` attribute set in T5 geometry, read by the T4 shader. `setGlintTime` (T4) called in T6. New `I.*`/`TILE.*` (T1) referenced everywhere. `'forage'` placement mode (T2) used in T5/T6.

**Open risks (validate during execution):**
- **Use-action wiring (T6):** the exact secondary-action handler must be located; the forage check must not hijack legitimate block-placement. Gate on empty-hand / non-placeable held item if there's a conflict.
- **`seedhead` autumn scalar:** confirm it exists in `season.js` and peaks in autumn; if not, use the nearest autumn bump or add one.
- **`World` constructor (T3 test):** match how other verify scripts construct it.
- **Habitat (v1 simplification):** forage scatters on open moor grass (not yet wood-floor/damp-specific); habitat refinement is deferred (noted in spec). Sparseness (the `'forage'` mode) carries the keen-eye feel for now.
- **Glint intensity (0.12):** tune live to "faint, catches the eye" — not garish.
- **Save/load:** `forageLedger` persistence mirrors whatever `editLedger` does; if `editLedger` is session-only, picks reset on reload (acceptable v1; regrow still works in-session).
