# Foraging Plan 3 — Fruit trees (orchards)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apple, pear and plum trees growing in orchards near villages (and the odd hedgerow), bearing seasonal fruit you pick off the canopy — the tree stays and fruits again. Eat/cook/sell, glint included.

**Architecture:** Reuses the whole foraging backbone. Fruit trees are normal trees with a distinct canopy block `B.ORCHARD_LEAVES`, stamped by worldgen in orchard clusters near villages. Species (apple/pear/plum) is chosen by a low-frequency noise so an orchard tends to one fruit. Fruit is a floraLayer adornment placed on the **lowest canopy block** of each fruiting column (reachable from the ground), glinting, in late summer→autumn; the `forageLedger` + a right-click pick on the canopy yield the fruit and suppress it until it regrows. Felling clears the canopy and regrows the orchard tree.

**Tech Stack:** vanilla ES modules, three.js overlay, Node `.mjs` verify.

Plan 3 of 3 for the foraging spec ([2026-06-21-foraging-design.md](../specs/2026-06-21-foraging-design.md)). Builds on Plans 1–2 (`forage.js`, `forageLedger`, glint, the forage action, host pick). Next-free ids (from recon): blocks 58+, tiles 75+, items 119+.

## File structure

- `src/defs.js` — `B.ORCHARD_LEAVES` (58) + def; tiles 75–78 (canopy + apple/pear/plum fruit); items 119–121; `ITEM_NAMES`, `FOODS`.
- `src/textures.js` — canopy + fruit tile painters; fruit item icons.
- `src/forage.js` — `FRUIT_SPECIES`, `fruitSpeciesAt(seed,x,z)`, `fruitTreeRipe(season)`.
- `src/worldgen.js` — `fruitTreeAt(x,z)` orchard zones + fruit-canopy stamping.
- `src/floraLayer.js` — canopy fruit scan + glint + ledger suppression.
- `src/main.js` — canopy fruit pick.
- `src/world.js` + `src/main.js` + `src/editledger.js` — fell/regrow fruit-tree awareness.
- `src/economy.js` — `PRICES` + buyer.
- `scripts/verify-forage.mjs` — fruit-tree tests.

## Verification note

Pure logic (species, season) TDD'd in `verify-forage.mjs`. Orchard generation, canopy fruit render, the pick, and fell/regrow are runtime — verified via the `window.game` drive (block-id scans, instance/inventory/ledger/console-error checks).

---

### Task 1: Orchard canopy block, fruit tiles, items, art

**Files:** Modify `src/defs.js`, `src/textures.js`. Data + art.

- [ ] **Step 1: Block** — in `B`, after `HAZEL: 57,` add `ORCHARD_LEAVES: 58,`.
- [ ] **Step 2: Tiles** — in `TILE`, after `HAZEL: 74,` add `ORCHARD_LEAVES: 75, APPLE: 76, PEAR: 77, PLUM: 78,`.
- [ ] **Step 3: Items** — in `I`, after `HAZELNUT: 118,` add `APPLE: 119, PEAR: 120, PLUM: 121,`.
- [ ] **Step 4: Canopy block def** — mirror `D[B.MONKEY_LEAVES]` (a solid leaf block):
```js
D[B.ORCHARD_LEAVES] = { name: 'Orchard Leaves', kind: <same kind as MONKEY_LEAVES, e.g. 'leaves'/'solid'>, tex: { t: TILE.ORCHARD_LEAVES, s: TILE.ORCHARD_LEAVES, b: TILE.ORCHARD_LEAVES }, hard: 0.2, tool: null, drop: null };
```
(Read `D[B.MONKEY_LEAVES]`/`D[B.LEAVES]` and copy the exact `kind`/`tex` shape + whether leaves drop saplings; orchard leaves drop nothing.)
- [ ] **Step 5: Names** — `ITEM_NAMES`: `[I.APPLE]: 'Apple', [I.PEAR]: 'Pear', [I.PLUM]: 'Plum',`.
- [ ] **Step 6: Nutrition** — `FOODS`: `[I.APPLE]: 4, [I.PEAR]: 4, [I.PLUM]: 3,`.
- [ ] **Step 7: Tile painters** — `src/textures.js`: `TILE.ORCHARD_LEAVES` (lush rounded green foliage, lighter/softer than oak `TILE.LEAVES`), `TILE.APPLE` (red-green apples on a leafy spray), `TILE.PEAR` (yellow-green pears), `TILE.PLUM` (purple plums with bloom). Match the adornment painter style (`TILE.BILBERRY_FRUIT`, `TILE.HOLLY_BERRY`).
- [ ] **Step 8: Item icons** — apple/pear/plum icons (reuse tile or hand-paint, per the convention the forage items used).
- [ ] **Step 9: Build + verify** — `npm run build` (exit 0); `npm run verify` (green; sync facts if needed).
- [ ] **Step 10: Commit** — `git add src/defs.js src/textures.js && git commit -m "feat(forage): orchard canopy block, apple/pear/plum tiles, items, art"` + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 2: Fruit species + season (pure)

**Files:** Modify `src/forage.js`; extend `scripts/verify-forage.mjs`.

- [ ] **Step 1: Failing tests** — append to `scripts/verify-forage.mjs` before RESULT:
```js
// fruit trees: species deterministic by region; ripe in autumn
{
  const { FRUIT_SPECIES, fruitSpeciesAt, fruitTreeRipe } = await import('../src/forage.js');
  const a = fruitSpeciesAt(1234, 100, 100), b = fruitSpeciesAt(1234, 100, 100);
  (a.item === b.item ? ok : bad)('fruit species is deterministic per cell');
  (FRUIT_SPECIES.some(s => fruitSpeciesAt(1234, 100, 100).item === s.item) ? ok : bad)('species is one of the three');
  // an orchard-sized patch tends to a single species (low-freq noise): sample a 6x6 patch
  const items = new Set();
  for (let x = 0; x < 6; x++) for (let z = 0; z < 6; z++) items.add(fruitSpeciesAt(1234, 200 + x, 200 + z).item);
  (items.size <= 2 ? ok : bad)('a small orchard patch is mostly one species (' + items.size + ' spp)');
  (fruitTreeRipe(seasonStateAtPhase(0.66)) ? ok : bad)('fruit ripe in autumn');
  (!fruitTreeRipe(seasonStateAtPhase(0.1)) ? ok : bad)('no fruit in spring');
}
```
- [ ] **Step 2: Run, expect FAIL** — `node scripts/verify-forage.mjs`.
- [ ] **Step 3: Implement in `src/forage.js`** (add `noise2` to the noise import if needed: `import { noise2 } from './noise.js';`):
```js
export const FRUIT_SPECIES = [
  { tile: TILE.APPLE, item: I.APPLE },
  { tile: TILE.PEAR,  item: I.PEAR },
  { tile: TILE.PLUM,  item: I.PLUM },
];
// Species varies slowly across the land, so an orchard tends to one fruit.
export function fruitSpeciesAt(seed, x, z) {
  const n = noise2(x * 0.02, z * 0.02, (seed ^ 0xf20a7) >>> 0); // [-1,1]
  const idx = n < -0.2 ? 0 : n < 0.2 ? 1 : 2;
  return FRUIT_SPECIES[idx];
}
export function fruitTreeRipe(season) { return (season.seedhead || 0) > 0.25; } // late summer -> autumn
```
- [ ] **Step 4: Run, expect PASS** — `node scripts/verify-forage.mjs`.
- [ ] **Step 5: Commit** — `git add src/forage.js scripts/verify-forage.mjs && git commit -m "feat(forage): fruit-tree species + season (pure)"` + trailer.

---

### Task 3: Generate orchards

**Files:** Modify `src/worldgen.js`. Runtime.

- [ ] **Step 1: `fruitTreeAt`** — add a method (near `treeAt`, recon `worldgen.js:75`):
```js
  fruitTreeAt(x, z) {
    const h = this.geo.height(x, z);
    if (h <= WATER_LEVEL || h > 38) return false;
    if (this.geo.coastT(x, z) > 0) return false;
    if (this.geo.inVillage(x, z, 2)) return false;        // not in the village itself
    if (!this.geo.inVillage(x, z, 16)) return false;       // only the ring just outside it
    const clump = noise2(x * 0.06, z * 0.06, (this.seed ^ 0x0ac2) >>> 0);
    if (clump < 0.45) return false;                        // one or two orchard patches, not a full ring
    return hash2i(x, z, this.seed ^ 0x0ac1) < 0.10;        // fruit trees within the patch
  }
```
(Use the real `noise2`/`hash2i` imports already in worldgen. Tune the 0.45/0.10 live so orchards read as small clusters of a handful of trees, not a forest.)
- [ ] **Step 2: Stamp the fruit canopy** — give `stampTree` an optional fruit flag so the canopy uses `B.ORCHARD_LEAVES`:
```js
  stampTree(data, lx, base, lz, th, fruit = false) {
    const canopy = fruit ? B.ORCHARD_LEAVES : B.LEAVES;
    // ... existing put() ; trunk loop unchanged (B.LOG) ...
    // replace the two B.LEAVES canopy writes + the cap with `canopy`:
    //   put(lx + dx, base + th - 1 + dy, lz + dz, canopy, true);
    //   put(lx, base + th + 1, lz, canopy, true);
  }
```
- [ ] **Step 3: Wire into the gen pipeline** — find where `treeAt` drives `stampTree` in the chunk-gen loop. Before/alongside the normal tree check, add the orchard branch:
```js
        if (this.fruitTreeAt(wx, wz)) {
          this.stampTree(data, lx, base, lz, 4, true);   // a fruit tree
        } else {
          const th = this.treeAt(wx, wz);
          if (th) this.stampTree(data, lx, base, lz, th /*, false*/);
        }
```
(Match the real variable names — `wx/wz` world coords, `lx/lz` local, `base` the surface y the existing code uses. Keep the existing normal-tree call shape; only add the fruit branch.)
- [ ] **Step 4: Build + live check** — `npm run build` (exit 0); `node scripts/verify-resources.mjs` (update its expectations only if it enumerates leaf/tree blocks — read it). Drive the game: spawn near a village, scan for `B.ORCHARD_LEAVES` (58) + `B.LOG` clusters just outside the village; report counts found and that they cluster near villages, not in deep wilderness. No console errors.
- [ ] **Step 5: Commit** — `git add src/worldgen.js && git commit -m "feat(forage): generate fruit-tree orchards near villages"` + trailer.

---

### Task 4: Render canopy fruit (glinting, suppressed when picked)

**Files:** Modify `src/floraLayer.js`. Visual.

- [ ] **Step 1: Imports** — add `fruitSpeciesAt, fruitTreeRipe, FRUIT_SPECIES` to the `./forage.js` import.
- [ ] **Step 2: Canopy scan in `build()`** — near the top of `build()` add `const fruitRipe = fruitTreeRipe(season);` and add the fruit tiles to the glint set: `const glintTiles = new Set([...activeForageables(season).map(f=>f.tile), ...FRUIT_SPECIES.map(s=>s.tile)]);` (merge with the existing `glintTiles` if Plan 1 already declares one). Inside the `x,z` loop, after the bush adornment block, add a bounded vertical scan for the **lowest** canopy block:
```js
        if (fruitRipe) {
          for (let dy = 2; dy <= 8; dy++) {
            if (this.world.getBlock(x, surfY + dy, z) === B.ORCHARD_LEAVES) {
              if (!this.world.isForaged(x, surfY + dy, z) && hash2i(x, z, seed ^ 0x0f18) < 0.6) {
                const sp = fruitSpeciesAt(seed, x, z);
                add(sp.tile, x + 0.5, surfY + dy, z + 0.5, hash2i(x, z, seed ^ (sp.tile << 6)) * Math.PI * 2, 1);
              }
              break;  // fruit hangs at the lowest (reachable) canopy block only
            }
          }
        }
```
(`B` is imported in floraLayer. The `break` ensures one fruit cell per canopy column = the lowest canopy block, the key the pick will match. ~60% of canopy columns bear visible fruit — tune the 0.6.)
- [ ] **Step 3: Build + live check** — `npm run build`. Drive the game, autumn (`game.seasonOverride = 0.66`), near an orchard: confirm fruit adornment meshes exist with `aGlint=1` (the fruit tiles), positioned at canopy height; out of season none. Eval: count meshes whose tile ∈ {APPLE,PEAR,PLUM} and confirm ≥1 near an orchard. No console errors.
- [ ] **Step 4: Commit** — `git add src/floraLayer.js && git commit -m "feat(forage): render glinting fruit on orchard canopies"` + trailer.

---

### Task 5: Pick fruit off the canopy

**Files:** Modify `src/main.js`. Interaction.

- [ ] **Step 1: Canopy pick branch** — add `fruitSpeciesAt, fruitTreeRipe` to the `./forage.js` import in main.js. In the right-click forage handler (alongside the scatter + host-bush branches), add a canopy branch. When the player aims at an `B.ORCHARD_LEAVES` block, find the **lowest** canopy block in that column (the same cell the overlay fruits) and pick it:
```js
    // Orchard fruit: right-click an orchard canopy to pick the fruit; the tree stays.
    if (hit && hit.id === B.ORCHARD_LEAVES && fruitTreeRipe(this.season) && (!_fh || !isPlaceable(_fh.id))) {
      const surfY = this.world.gen.height(hit.x, hit.z);
      let fy = null;
      for (let dy = 2; dy <= 8; dy++) {
        if (this.world.getBlock(hit.x, surfY + dy, hit.z) === B.ORCHARD_LEAVES) { fy = surfY + dy; break; }
      }
      if (fy != null && !this.world.isForaged(hit.x, fy, hit.z)) {
        const sp = fruitSpeciesAt(this.world.gen.seed >>> 0, hit.x, hit.z);
        this.world.recordForage(hit.x, fy, hit.z, this.sky.day);
        this.player.addItem(sp.item, 1);
        this.ui.invDirty = true;
        if (this.floraLayer) this.floraLayer.center = null;
        this.ui.toast(`Picked ${itemName(sp.item)}.`);
        return;
      }
    }
```
(Reuse `_fh`. The `fy` found here equals the overlay's lowest-canopy cell, so the picked fruit suppresses correctly. Guarded by `fruitTreeRipe` so out-of-season canopies aren't pickable.)
- [ ] **Step 2: Build + live check** — `npm run build`. Drive the game, autumn, at an orchard: aim at an `B.ORCHARD_LEAVES` (58) block, invoke the pick → an apple/pear/plum is added, the canopy block is STILL present, `isForaged(x,fy,z)` true, fruit overlay gone for that column; advance days + `expireForage` → regrows. No console errors.
- [ ] **Step 3: Commit** — `git add src/main.js && git commit -m "feat(forage): pick fruit off orchard canopies (tree stays)"` + trailer.

---

### Task 6: Felling + regrowth keep the orchard

**Files:** Modify `src/editledger.js`, `src/main.js`, `src/world.js`. Runtime.

- [ ] **Step 1: Felling clears the canopy** — `B.ORCHARD_LEAVES` must count as wood so felling removes it. In `src/main.js` `fellTree`, add it to the `isWood` test: `const isWood = id => id === B.LOG || id === B.LEAVES || id === B.MONKEY_LEAVES || id === B.ORCHARD_LEAVES;`. In `src/editledger.js`, add `B.ORCHARD_LEAVES` to the `TREES` set (so it's categorised like other foliage).
- [ ] **Step 2: Regrow as a fruit tree** — `fellTree` records the stump in `world.treeRegrowth`; `growTrees`→`placeTree` currently hardcodes `B.LEAVES`. Make the regrown tree keep its kind:
  - In `fellTree`, when any felled block was `B.ORCHARD_LEAVES`, mark the stump as fruit — e.g. record the stump in a new `world.fruitStumps` Set (`world.fruitStumps.add(bx+','+by+','+bz)`), OR change the `treeRegrowth` value to `{ day, fruit:true }`. Pick whichever is least invasive (read `world.js`).
  - In `world.js` `placeTree`, accept a `fruit` flag and use `B.ORCHARD_LEAVES` for the canopy when set; in `growTrees`, pass the stored kind (and the intermediate sapling cap can use the right leaf too). (de)serialize `fruitStumps` alongside `treeRegrowth`/`saplings` if those are persisted.
- [ ] **Step 3: Build + live check** — `npm run build`; `npm run verify` green. Drive the game: fell a fruit tree (`fellTree` on an orchard `B.LOG`) → trunk + `B.ORCHARD_LEAVES` canopy all cleared (no floating leaves), a `B.LOG` drop spawned; the stump is recorded as a fruit stump; advancing the regrow cycle (`sky.day += 48; world.growTrees(sky.day)`) regrows an orchard tree (`B.ORCHARD_LEAVES` canopy, not oak). No console errors.
- [ ] **Step 4: Commit** — `git add src/editledger.js src/main.js src/world.js && git commit -m "feat(forage): orchards survive felling — clear canopy, regrow as fruit trees"` + trailer.

---

### Task 7: Trade — sell orchard fruit

**Files:** Modify `src/economy.js`.

- [ ] **Step 1: Prices** — `PRICES`: `[I.APPLE]: 2, [I.PEAR]: 2, [I.PLUM]: 2,`.
- [ ] **Step 2: Buyer** — append `I.APPLE, I.PEAR, I.PLUM` to the `james` vendor's `buys`.
- [ ] **Step 3: Build + verify** — `npm run build` (exit 0); `npm run verify` green (sync facts if needed).
- [ ] **Step 4: Commit** — `git add src/economy.js && git commit -m "feat(forage): sell orchard fruit to the food trader"` + trailer.

---

### Task 8: Verify pass

- [ ] **Step 1:** `npm run verify` → all `RESULT: PASS`, exit 0.
- [ ] **Step 2:** Fix anything red and re-run; commit only if a fix was made.

---

## Self-Review

**Spec coverage (Plan 3 slice):** apple/pear/plum fruit trees ✓ T1/T2/T3; orchards near villages + hedgerow-reachable ✓ T3; canopy fruit adornment + glint + pick-keeps-tree ✓ T4/T5; regrow/fell integrity ✓ T6; cook/eat (FOODS) ✓ T1; trade ✓ T7; tests ✓ T2/T8. Completes the foraging program.

**Placeholder scan:** data + pure tasks complete; runtime tasks give complete code + live checks. The "match MONKEY_LEAVES kind", "find the gen tree call site", "least-invasive stump marking", "read verify-resources" notes are necessary lookups, not placeholders.

**Type/name consistency:** `FRUIT_SPECIES`/`fruitSpeciesAt`/`fruitTreeRipe` (T2) consumed by `floraLayer` (T4) + `main.js` pick (T5). `B.ORCHARD_LEAVES` (T1) stamped in worldgen (T3), scanned in T4/T5, felled/regrown in T6. The **lowest-canopy cell** is computed identically in T4 (overlay) and T5 (pick) so the ledger key agrees. Reuses `forageLedger`/`recordForage`/`isForaged`/`expireForage` + the glint unchanged.

**Open risks (validate during execution):**
- **Overlay/pick canopy-cell agreement:** both scan `surfY+2..+8` for the first `B.ORCHARD_LEAVES`; they must use the identical loop so the picked cell is the fruited cell. Verify in T5 live.
- **Vertical-scan cost:** the overlay now scans up to ~7 blocks per window column on rebuild (throttled, on-move only). Acceptable; if a hitch shows, gate the scan to columns with a tree (e.g. skip when `getBlock(x,surfY+2,z)===AIR && ...`) — but most columns short-circuit quickly. Watch for jank in T4.
- **`stampTree` signature change:** adding the `fruit` param must not break existing callers (default `false`). Confirm all `stampTree` call sites.
- **Regrow species (T6):** the least-invasive marking (a `fruitStumps` Set vs an object value in `treeRegrowth`) depends on the real `world.js` shape + whether it's serialized — read before choosing; ensure save/load parity.
- **Orchard density (T3):** tune `clump`/`hash` thresholds so orchards are small, readable clusters near villages — not a ring around every village, not a forest.
- **Reach:** fruit sits on the lowest canopy (~surfY+4); pickable from the ground. Higher canopy bears no overlay fruit (intentional — keeps it reachable).
- **Canopy block kind:** `B.ORCHARD_LEAVES` should mesh like `B.LEAVES`/`B.MONKEY_LEAVES` (same opacity/cutout treatment) so trees look right and the snow/season passes treat it consistently.
