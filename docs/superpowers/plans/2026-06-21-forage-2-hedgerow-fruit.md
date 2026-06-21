# Foraging Plan 2 — Host-borne hedgerow fruit

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Berries and hedgerow fruit you pick off the bush, leaving the plant standing to regrow: bilberries + blackberries (re-homed from break-to-destroy), plus rosehips, sloes, elderberries and hazelnuts on hedgerow bushes. Cook/eat/sell.

**Architecture:** Reuses the Plan 1 backbone whole. Host fruit is a floraLayer **adornment** rendered on its host bush block in season; the `forageLedger` + the `fruitPicked` hook (already present) suppress a picked bush's fruit and regrow it. A new host-bush branch in the right-click forage action picks the fruit and records the bush cell — the bush block is never removed. Breaking a bush with a tool (left-click) still clears it, but no longer hands out fruit.

**Tech Stack:** vanilla ES modules, three.js overlay, Node `.mjs` verify.

Plan 2 of 3 for the foraging spec ([2026-06-21-foraging-design.md](../specs/2026-06-21-foraging-design.md)). Builds directly on Plan 1 (`forage.js`, `forageLedger`, glint, the forage action). Next-free ids (from recon): blocks 56+, tiles 69+, items 114+.

## File structure

- `src/defs.js` — new items (114–118), host blocks (`B.BLACKTHORN` 56, `B.HAZEL` 57), adorn + bush tiles (69–74), defs, `ITEM_NAMES`, `FOODS`.
- `src/textures.js` — tile + item-icon painters.
- `src/forage.js` — `HOST_FORAGE` table + `activeHostForage` + `hostForageFor`.
- `src/flora-season.js` — drive `activeAdornments` from `HOST_FORAGE` + the decorative-only adornments.
- `src/floraLayer.js` — wire `fruitPicked` to the `forageLedger`.
- `src/main.js` — host-bush forage pick; re-home bilberry break.
- `src/worldgen.js` — place blackthorn + hazel; nudge dog-rose/elder so fruit is findable.
- `src/economy.js` — `PRICES` + buyer.
- `scripts/verify-forage.mjs` — host-forage tests.

## Verification note

Pure tables/ledger TDD'd in `verify-forage.mjs`. Adornment render, the host pick, suppression/regrow, and worldgen placement are runtime — verified via the `window.game` drive (instance/inventory/ledger/console-error checks), per the established method.

---

### Task 1: Items, host blocks, tiles, nutrition, art

**Files:** Modify `src/defs.js`, `src/textures.js`. Data + art.

- [ ] **Step 1: Items** — in `I`, after `SORREL: 113,` add:
```js
  BLACKBERRY: 114, ROSEHIP: 115, SLOE: 116, ELDERBERRY: 117, HAZELNUT: 118,
```
- [ ] **Step 2: Host blocks** — in `B`, after `HOLLY: 55,` add `BLACKTHORN: 56, HAZEL: 57,`.
- [ ] **Step 3: Tiles** — in `TILE`, after `SORREL: 68,` add:
```js
  ROSEHIP: 69, SLOE: 70, ELDERBERRY: 71, HAZELNUT: 72, BLACKTHORN: 73, HAZEL: 74,
```
- [ ] **Step 4: Block defs** — add cutout bush defs, mirroring `D[B.DOG_ROSE]`/`D[B.ELDER]`:
```js
D[B.BLACKTHORN] = { name: 'Blackthorn', kind: 'cutout', tex: { t: TILE.BLACKTHORN, s: TILE.BLACKTHORN, b: TILE.BLACKTHORN }, hard: 0.1, tool: null, drop: B.BLACKTHORN };
D[B.HAZEL]      = { name: 'Hazel',      kind: 'cutout', tex: { t: TILE.HAZEL, s: TILE.HAZEL, b: TILE.HAZEL },             hard: 0.1, tool: null, drop: B.HAZEL };
```
(Match the exact `tex` shape the other cutout bushes use — recon shows `tex: TILE.X` shorthand on some; copy a working neighbour's shape.)
- [ ] **Step 5: Re-home bilberry drop** — change `D[B.BILBERRY_BUSH].drop` from `I.BILBERRIES` to `null` (berries now come from foraging, not breaking).
- [ ] **Step 6: Names** — in `ITEM_NAMES` add: `[I.BLACKBERRY]: 'Blackberries', [I.ROSEHIP]: 'Rosehips', [I.SLOE]: 'Sloes', [I.ELDERBERRY]: 'Elderberries', [I.HAZELNUT]: 'Hazelnuts',`.
- [ ] **Step 7: Nutrition** — in `FOODS` add: `[I.BLACKBERRY]: 3, [I.ROSEHIP]: 2, [I.SLOE]: 1, [I.ELDERBERRY]: 2, [I.HAZELNUT]: 3,`.
- [ ] **Step 8: Tile painters** — in `src/textures.js`, add painters for `TILE.ROSEHIP` (red-orange hips on a thorny spray), `TILE.SLOE` (blue-black sloes with a dusty bloom), `TILE.ELDERBERRY` (drooping cluster of tiny near-black berries), `TILE.HAZELNUT` (clusters of pale-green nuts in leafy husks), `TILE.BLACKTHORN` (dark twiggy bush), `TILE.HAZEL` (rounded green hedge bush). Match the existing cutout-plant/adornment painter style (e.g. `TILE.BILBERRY_FRUIT`, `TILE.HOLLY_BERRY`).
- [ ] **Step 9: Item icons** — add icons for `I.BLACKBERRY`, `I.ROSEHIP`, `I.SLOE`, `I.ELDERBERRY`, `I.HAZELNUT` (reuse their tile or hand-paint, following the convention the Plan 1 forage items used).
- [ ] **Step 10: Build + verify** — `npm run build` (exit 0), `npm run verify` (still green; if a facts/economy check references block/item counts, run `node scripts/sync-facts.mjs` if present + re-run).
- [ ] **Step 11: Commit** — `git add src/defs.js src/textures.js && git commit -m "feat(forage): hedgerow fruit items + blackthorn/hazel blocks, tiles, nutrition, art"` + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 2: `HOST_FORAGE` table + adornment refactor

**Files:** Modify `src/forage.js`, `src/flora-season.js`; extend `scripts/verify-forage.mjs`.

- [ ] **Step 1: Failing tests** — append to `scripts/verify-forage.mjs` before the RESULT line:
```js
// host-borne fruit: active in season, maps bush -> item
{
  const { HOST_FORAGE, activeHostForage, hostForageFor } = await import('../src/forage.js');
  const { B } = await import('../src/defs.js');
  const lateSummer = seasonStateAtPhase(0.45), aut = seasonStateAtPhase(0.66), win = seasonStateAtPhase(0.9);
  (hostForageFor(B.BILBERRY_BUSH, lateSummer) ? ok : bad)('bilberries ripe in late summer');
  (hostForageFor(B.HAZEL, aut)?.item != null ? ok : bad)('hazelnuts ripe in autumn');
  (hostForageFor(B.BLACKTHORN, win)?.item != null ? ok : bad)('sloes hang on after frost');
  (!hostForageFor(B.BILBERRY_BUSH, win) ? ok : bad)('no bilberries in deep winter');
  (HOST_FORAGE.every(h => h.bush != null && h.item != null && h.tile != null) ? ok : bad)('every host-forage entry has bush+item+tile');
}
```
- [ ] **Step 2: Run, expect FAIL** — `node scripts/verify-forage.mjs`.
- [ ] **Step 3: Add `HOST_FORAGE` to `src/forage.js`:**
```js
import { TILE, I, B } from './defs.js';   // add B to the existing import

// Host-borne fruit: an adornment on a host bush; picking yields `item`, the bush stays.
export const HOST_FORAGE = [
  { bush: B.BILBERRY_BUSH, tile: TILE.BILBERRY_FRUIT, item: I.BILBERRIES, scalar: 'heatherBloom', threshold: 0.4 },
  { bush: B.BRAMBLE,       tile: TILE.BLACKBERRY,     item: I.BLACKBERRY, scalar: 'blackberry',   threshold: 0.3 },
  { bush: B.DOG_ROSE,      tile: TILE.ROSEHIP,        item: I.ROSEHIP,    scalar: 'frost',        threshold: 0.3 },
  { bush: B.BLACKTHORN,    tile: TILE.SLOE,           item: I.SLOE,       scalar: 'frost',        threshold: 0.3 },
  { bush: B.ELDER,         tile: TILE.ELDERBERRY,     item: I.ELDERBERRY, scalar: 'seedhead',     threshold: 0.3 },
  { bush: B.HAZEL,         tile: TILE.HAZELNUT,       item: I.HAZELNUT,   scalar: 'seedhead',     threshold: 0.3 },
];

export function activeHostForage(season) {
  return HOST_FORAGE.filter(h => (season[h.scalar] || 0) > h.threshold);
}
export function hostForageFor(bush, season) {
  return activeHostForage(season).find(h => h.bush === bush) || null;
}
```
- [ ] **Step 4: Refactor `flora-season.js`** so adornments come from `HOST_FORAGE` plus the decorative-only ones (bramble flower, holly berry — not forageable):
```js
import { TILE, B } from './defs.js';
import { HOST_FORAGE } from './forage.js';

const SCATTER = [ /* unchanged */ ];
const ADORN_DECOR = [
  { tile: TILE.BRAMBLE_FLOWER, scalar: 'brambleFlower', threshold: 0.3, bush: B.BRAMBLE },
  { tile: TILE.HOLLY_BERRY,    scalar: 'frost',         threshold: 0.4, bush: B.HOLLY },
];

export function activeScatter(season) { /* unchanged */ }
export function activeAdornments(season) {
  const fruit = HOST_FORAGE.filter(h => (season[h.scalar] || 0) > h.threshold).map(h => ({ tile: h.tile, bush: h.bush }));
  const decor = ADORN_DECOR.filter(s => (season[s.scalar] || 0) > s.threshold).map(s => ({ tile: s.tile, bush: s.bush }));
  return [...fruit, ...decor];
}
```
(Removes the old hard-coded bilberry/blackberry ADORN entries — now sourced from `HOST_FORAGE` — and keeps bramble-flower/holly-berry decorative.)
- [ ] **Step 5: Run, expect PASS** — `node scripts/verify-forage.mjs`.
- [ ] **Step 6: Commit** — `git add src/forage.js src/flora-season.js scripts/verify-forage.mjs && git commit -m "feat(forage): HOST_FORAGE table; drive adornments from it"` + trailer.

---

### Task 3: Suppress picked fruit via the ledger

**Files:** Modify `src/floraLayer.js`. Visual.

- [ ] **Step 1: Wire `fruitPicked`** — in the `FloraLayer` constructor, replace `this.fruitPicked = null;` with a ledger-backed check (the adornment renders at the bush cell `surfY+1`):
```js
    this.fruitPicked = (x, z, bush) => this.world.isForaged(x, this.world.gen.height(x, z) + 1, z);
```
(The existing adornment loop already calls `this.fruitPicked(x, z, a.bush)` to skip rendering. New host-fruit adornments flow through the same path, so a foraged bush's fruit disappears until it regrows.)
- [ ] **Step 2: Build + manual check** — `npm run build`. Dev server: `game.seasonOverride = 0.45` (bilberry season) → bilberry bushes show fruit; `game.world.recordForage(x, game.world.gen.height(x,z)+1, z, game.sky.day)` for a berried bush cell + `game.floraLayer.center=null` → that bush's fruit vanishes; advance days + `expireForage` → it returns. No console errors.
- [ ] **Step 3: Commit** — `git add src/floraLayer.js && git commit -m "feat(forage): suppress picked host fruit via the forageLedger"` + trailer.

---

### Task 4: Host-bush forage pick + re-home bilberry break

**Files:** Modify `src/main.js`. Interaction.

- [ ] **Step 1: Host pick branch** — in the right-click forage handler (near the existing `// Forage pick:` scatter block), add a host-bush branch. Import `hostForageFor` from `./forage.js` (alongside `activeForageables`). Place it before or after the scatter block, inside the same use-action handler:
```js
    // Host-bush forage: right-click a berried bush to pick the fruit; the bush stays.
    if (hit && this.season && (!_fh || !isPlaceable(_fh.id))) {
      const h = hostForageFor(hit.id, this.season);
      if (h && !this.world.isForaged(hit.x, hit.y, hit.z)) {
        this.world.recordForage(hit.x, hit.y, hit.z, this.sky.day);
        this.player.addItem(h.item, 1);
        this.ui.invDirty = true;
        if (this.floraLayer) this.floraLayer.center = null;
        this.ui.toast(`Picked ${itemName(h.item)}.`);
        return;
      }
    }
```
(The bush block's `hit.y` equals `gen.height(x,z)+1` — the same key `fruitPicked` checks, so the picked fruit is suppressed. `_fh` is the held-item local already computed in this handler; reuse it.)
- [ ] **Step 2: Re-home bilberry break** — in `finishBreak`, remove the bilberry-specific block (the `inSeason`/`bareBilberry` toast + special drop). Bilberry bush now has `drop: null` (Task 1), so the generic `def.drop !== null` guard already skips its drop. Delete the now-dead `bareBilberry` branch and its `else`-wrapper so the generic ore/skill logic runs for real ores only. (Keep the ore prospecting-skill logic intact; only remove the bilberry special-case.)
- [ ] **Step 3: Build + manual check** — `npm run build`. Dev server, `game.seasonOverride=0.45`: aim at a bilberry bush, right-click → `I.BILBERRIES` added, the bush block still there (`game.world.getBlock` unchanged), fruit overlay gone, `isForaged` true; left-click (break) the bush → bush clears, no berry drop. Autumn (`0.66`): pick blackberries off bramble, elderberries off elder. No console errors.
- [ ] **Step 4: Commit** — `git add src/main.js && git commit -m "feat(forage): pick fruit off bushes (bush stays); breaking no longer drops berries"` + trailer.

---

### Task 5: Generate blackthorn + hazel; make hedgerow fruit findable

**Files:** Modify `src/worldgen.js`.

- [ ] **Step 1: Hedgerow blackthorn + hazel** — in the lineside verge ladder (recon: `worldgen.js:306-315`, the `if (v < 0.22) plant = B.BRAMBLE ...` chain), add blackthorn and hazel to the hedgerow mix, e.g. extend the ladder so a slice of cells become `B.BLACKTHORN` and `B.HAZEL` (keep total ≤ 1.0; trim the bare remainder). Example: after the holly branch, `else if (v < 0.80) plant = B.BLACKTHORN; else if (v < 0.88) plant = B.HAZEL;`.
- [ ] **Step 2: Dale hedgerow** — in the dale pasture/fringe block (recon: `worldgen.js:337-346`, where `B.DOG_ROSE`/`B.ELDER` are placed at ~1%/0.6%), add a small chance of `B.BLACKTHORN` and `B.HAZEL` (e.g. another `else if (r < ...)` slice) so hedgerow fruit grows in the dale too, and optionally nudge dog-rose/elder up slightly so rosehips/elderberries are findable. Keep densities modest.
- [ ] **Step 3: Build + verify** — `npm run build` (exit 0); `node scripts/verify-resources.mjs` (the census is seasonless gen — confirm it still passes; if it asserts specific plant counts it may need the new bushes added to its expectations — read it and update if so). Dev server, walk the lineside/dale in autumn: blackthorn (sloes) + hazel (nuts) + dog-rose (hips) appear and are pickable. No console errors.
- [ ] **Step 4: Commit** — `git add src/worldgen.js && git commit -m "feat(forage): generate blackthorn + hazel in hedgerows"` + trailer.

---

### Task 6: Trade — sell hedgerow fruit

**Files:** Modify `src/economy.js`.

- [ ] **Step 1: Prices** — in `PRICES` add: `[I.BLACKBERRY]: 2, [I.ROSEHIP]: 2, [I.SLOE]: 1, [I.ELDERBERRY]: 2, [I.HAZELNUT]: 3,`.
- [ ] **Step 2: Buyer** — add these to the food trader's `buys` (the `james` vendor that already buys `I.BILBERRIES` + the Plan 1 forage). Read `VENDORS` and append.
- [ ] **Step 3: Build + verify** — `npm run build` (exit 0); `npm run verify` green (sync facts if needed).
- [ ] **Step 4: Commit** — `git add src/economy.js && git commit -m "feat(forage): sell hedgerow fruit to the food trader"` + trailer.

---

### Task 7: Verify pass

**Files:** none beyond confirming.

- [ ] **Step 1:** `npm run verify` → all `RESULT: PASS` (the host-forage checks from Task 2 included), exit 0.
- [ ] **Step 2:** If anything is red, fix and re-run. No commit needed unless a fix was made.

---

## Self-Review

**Spec coverage (Plan 2 slice):** bush berries pick-keeps-plant (bilberry re-home + blackberry) ✓ T1/T2/T4; hips/sloes/elderberries/hazelnuts on hedgerow hosts ✓ T1/T2/T5; ledger suppression + regrow ✓ T3 (reuses Plan 1); cook/eat (FOODS) ✓ T1; trade ✓ T6; tests ✓ T2/T7. Fruit trees are Plan 3.

**Placeholder scan:** data + pure tasks have complete code; the visual/interaction/worldgen tasks give complete code for the logic + explicit manual checks. The "match the neighbour's `tex` shape", "find the lineside ladder", "read VENDORS", "check verify-resources expectations" notes are necessary lookups, not placeholders.

**Type/name consistency:** `HOST_FORAGE`/`activeHostForage`/`hostForageFor` (T2) consumed by `flora-season.js` (T2) + `main.js` pick (T4). `fruitPicked` ledger wiring (T3) suppresses the adornments `activeAdornments` emits (T2). New `I.*`/`B.*`/`TILE.*` (T1) referenced throughout. Bilberry `drop: null` (T1) makes the T4 break re-home a deletion, not a behaviour conflict. Reuses Plan 1's `forageLedger`/`recordForage`/`isForaged`/`expireForage` unchanged.

**Open risks (validate during execution):**
- **Bilberry drop removal breakage:** bilberries are used in quests/taming/trade — those obtain bilberries by other means (rewards/feeding); only the *break-the-bush* source is removed (replaced by the better forage source). Confirm no code relied on breaking bilberry bushes for berries (recon found none beyond finishBreak).
- **Holly berries stay decorative** (toxic in reality) — intentionally NOT in `HOST_FORAGE`; only bramble-flower/holly-berry remain decorative adornments.
- **Bush-cell key agreement:** host pick records `(hit.x, hit.y, hit.z)` (the bush block); `fruitPicked` checks `(x, gen.height(x,z)+1, z)`. These match only when the bush sits one above the surface (the only place the overlay draws it) — confirm during T3/T4 live check.
- **`verify-resources` expectations:** new bushes may shift the census; update its expected set if it enumerates plants.
- **Lineside density:** don't over-fill the hedgerow (it's already brambly) — keep blackthorn/hazel modest so the four-foot stays clear and it doesn't read as a wall.
