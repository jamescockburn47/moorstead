# Seasonal Foliage Colour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make tree foliage and moor flora visibly change with the season — leaves turn gold/rust in autumn and brown in winter, monkey puzzle stays evergreen, and the existing heather/bracken/grass shifts read clearly.

**Architecture:** Extend the existing deterministic season clock (`season.js`) with new bloom/frost scalars, then extend the atlas-retint path (`textures.js`: `SEASON_TILES` + `seasonShiftPx`) to colour leaves and strengthen the moor-flora tints. No re-meshing — `retintAtlasForSeason` already repaints these tiles each season bucket. All colour maths is a pure pixel function, unit-tested headlessly under Node.

**Tech Stack:** Vanilla ES modules, three.js (CanvasTexture atlas), Node `.mjs` verify scripts (the project's headless test convention: `console.log('  ok'/'  FAIL')` + `RESULT: PASS/FAIL` + `process.exit`).

This is Plan 1 of 3 for the seasonal-flora-and-snow spec ([2026-06-20-seasonal-flora-snow-design.md](../specs/2026-06-20-seasonal-flora-snow-design.md)). Plan 2 = flower overlay + lineside corridor (M3); Plan 3 = snow (M4–M6). This plan covers M1 (season signal) + M2 (foliage colour).

---

### Task 1: Season signal — bloom & frost scalars

**Files:**
- Modify: `src/season.js` (the `build()` function, ~lines 22-34)
- Test: `scripts/verify-season.mjs` (extend)

- [ ] **Step 1: Write the failing tests**

Add this block to `scripts/verify-season.mjs`, immediately before the final `console.log('\nRESULT: ...` line:

```js
// new flower/frost windows peak in the right season and are quiet out of season
{
  (seasonStateAtPhase(0.97).snowdrop > 0.9 ? ok : bad)('snowdrops peak in late winter');
  (seasonStateAtPhase(0.45).snowdrop < 0.1 ? ok : bad)('no snowdrops in late summer');
  (seasonStateAtPhase(0.12).daffodil > 0.9 ? ok : bad)('daffodils peak in early spring');
  (seasonStateAtPhase(0.70).daffodil < 0.1 ? ok : bad)('no daffodils in autumn');
  (seasonStateAtPhase(0.37).summerBloom > 0.9 ? ok : bad)('summer blooms (foxgloves) peak in summer');
  (seasonStateAtPhase(0.875).summerBloom < 0.1 ? ok : bad)('no summer blooms in deep winter');
  (seasonStateAtPhase(0.66).seedhead > 0.85 ? ok : bad)('seedheads peak in autumn');
  (seasonStateAtPhase(0.12).seedhead < 0.1 ? ok : bad)('no seedheads in spring');
  (seasonStateAtPhase(0.875).frost > 0.9 ? ok : bad)('frost peaks in deep winter');
  (seasonStateAtPhase(0.375).frost < 0.05 ? ok : bad)('no frost at high summer');
}
```

Also extend the existing in-range loop (the block with `for (let i = 0; i < 400; i++)`) by adding these lines inside the loop, after the existing `s.autumn` check:

```js
    if (s.snowdrop < 0 || s.snowdrop > 1) inRange = false;
    if (s.daffodil < 0 || s.daffodil > 1) inRange = false;
    if (s.summerBloom < 0 || s.summerBloom > 1) inRange = false;
    if (s.seedhead < 0 || s.seedhead > 1) inRange = false;
    if (s.frost < 0 || s.frost > 1) inRange = false;
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/verify-season.mjs`
Expected: FAIL — lines like `FAIL  snowdrops peak in late winter` (scalars are `undefined`, so `undefined > 0.9` is false).

- [ ] **Step 3: Add the scalars to `build()`**

In `src/season.js`, inside the object returned by `build(yearPhase)`, add these properties after the existing `autumn:` line:

```js
    snowdrop: bump(yearPhase, 0.97, 0.04),     // late winter, just before spring
    daffodil: bump(yearPhase, 0.12, 0.05),     // early spring
    summerBloom: bump(yearPhase, 0.37, 0.10),  // foxgloves + summer wildflowers
    seedhead: bump(yearPhase, 0.66, 0.08),     // late-autumn seedheads / rosehips
    frost: Math.max(0, -Math.cos((yearPhase - 0.375) * Math.PI * 2)), // = max(0, -warmth)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node scripts/verify-season.mjs`
Expected: PASS — `RESULT: PASS`, all the new lines show `ok`.

- [ ] **Step 5: Commit**

```bash
git add src/season.js scripts/verify-season.mjs
git commit -m "feat(season): add snowdrop/daffodil/summerBloom/seedhead/frost scalars"
```

---

### Task 2: Foliage seasonal colour — leaves turn, monkey puzzle evergreen, stronger moor tints

**Files:**
- Modify: `src/textures.js` (`SEASON_TILES` ~line 496; `seasonShiftPx` ~lines 504-520)
- Create: `scripts/verify-foliage.mjs`

- [ ] **Step 1: Write the failing test file**

Create `scripts/verify-foliage.mjs`:

```js
// Foliage seasonal-colour check — run wi': node scripts/verify-foliage.mjs
// seasonShiftPx is a pure pixel function: it mutates an [r,g,b,a] array in place.
// We feed it a representative base pixel per tile and assert the colour shifts
// the right way across the year. No canvas/WebGL needed.
import { seasonShiftPx } from '../src/textures.js';
import { TILE } from '../src/defs.js';
import { seasonStateAtPhase } from '../src/season.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// apply the seasonal shift to a fresh base pixel at a given year phase
const shift = (tile, base, phase) => {
  const d = [base[0], base[1], base[2], 255];
  seasonShiftPx(tile, d, 0, seasonStateAtPhase(phase));
  return d;
};
const LEAF = [63, 85, 39];      // TILE.LEAVES speckle base (0x3f5527)
const HEATH = [120, 90, 110];   // a heathery base
const BRACK = [95, 110, 60];    // a bracken/fern green base
const GRASS = [90, 120, 55];    // a grass base

// deciduous leaves turn through the year
{
  const summer = shift(TILE.LEAVES, LEAF, 0.375);
  (summer[1] > summer[0] && summer[1] > summer[2] ? ok : bad)('summer leaves stay green (green dominant)');
  const autumn = shift(TILE.LEAVES, LEAF, 0.625);
  (autumn[0] > autumn[1] ? ok : bad)('autumn leaves turn gold/rust (red overtakes green)');
  (autumn[0] > summer[0] ? ok : bad)('autumn leaves are redder than summer');
  const winter = shift(TILE.LEAVES, LEAF, 0.875);
  (winter[1] - winter[2] < summer[1] - summer[2] ? ok : bad)('winter leaves are browner/less green than summer');
}

// monkey puzzle is evergreen: it does NOT turn gold in autumn
{
  const mpAutumn = shift(TILE.MONKEY_LEAVES, LEAF, 0.625);
  (mpAutumn[1] >= mpAutumn[0] ? ok : bad)('monkey puzzle stays green in autumn (no gold turn)');
}

// stronger moor tints (these thresholds fail at the OLD blend amounts, pass at the new)
{
  const heather = shift(TILE.HEATHER, HEATH, 0.45);
  (heather[2] >= 155 && heather[1] < heather[0] && heather[1] < heather[2] ? ok : bad)('heather purples strongly at bloom');
  const bracken = shift(TILE.BRACKEN, BRACK, 0.625);
  (bracken[0] >= 135 ? ok : bad)('bracken rusts strongly in autumn');
  const grassSummer = shift(TILE.GRASS_TOP, GRASS, 0.375);
  const grassWinter = shift(TILE.GRASS_TOP, GRASS, 0.875);
  const spread = c => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
  (spread(grassWinter) < spread(grassSummer) ? ok : bad)('winter grass is paler/desaturated vs summer');
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/verify-foliage.mjs`
Expected: FAIL — first an import error (`seasonShiftPx` is not exported), or once exported, failures on the leaf and "stronger" lines (no leaf branch; old blend amounts below the new thresholds).

- [ ] **Step 3: Export `seasonShiftPx` and extend it**

In `src/textures.js`:

(a) Export the function — change its declaration:

```js
export function seasonShiftPx(tile, d, i, s) {
```

(b) Add `TILE.LEAVES` and `TILE.MONKEY_LEAVES` to `SEASON_TILES`:

```js
const SEASON_TILES = [TILE.GRASS_TOP, TILE.GRASS_SIDE, TILE.HEATHER, TILE.BRACKEN, TILE.FERN, TILE.BILBERRY, TILE.GORSE, TILE.LEAVES, TILE.MONKEY_LEAVES];
```

(c) Strengthen the existing heather and bracken/fern blends, and add the leaf branches. Replace the current `if (tile === TILE.HEATHER) {...}` / `else if (tile === TILE.BRACKEN || tile === TILE.FERN) {...}` lines and append the two new branches, so the body reads:

```js
  const winter = s.warmth < 0 ? -s.warmth : 0;
  if (tile === TILE.HEATHER) {
    blendPx(d, i, 150, 74, 168, s.heatherBloom * 0.82);  // late-summer bloom: the whole plant purples
    blendPx(d, i, 92, 74, 56, winter * 0.45);            // winter: browned off
  } else if (tile === TILE.BRACKEN || tile === TILE.FERN) {
    blendPx(d, i, 156, 86, 38, s.autumn * 0.72);         // autumn rust
    blendPx(d, i, 120, 100, 74, winter * 0.4);           // dead-brown in winter
  } else if (tile === TILE.GRASS_TOP || tile === TILE.GRASS_SIDE) {
    blendPx(d, i, 96, 132, 58, s.greenness * 0.22);      // spring/summer flush
    desatPx(d, i, winter * 0.5); blendPx(d, i, 150, 148, 118, winter * 0.28); // winter: pale an' strawy
  } else if (tile === TILE.GORSE) {
    desatPx(d, i, winter * 0.3);
  } else if (tile === TILE.BILBERRY) {
    blendPx(d, i, 150, 80, 50, s.autumn * 0.35); desatPx(d, i, winter * 0.4);
  } else if (tile === TILE.LEAVES) {
    blendPx(d, i, 96, 150, 60, s.greenness * 0.20);      // spring/summer flush
    blendPx(d, i, 178, 116, 38, s.autumn * 0.6);         // autumn gold -> rust
    desatPx(d, i, winter * 0.45); blendPx(d, i, 120, 100, 74, winter * 0.4); // winter: brown, bare-looking
  } else if (tile === TILE.MONKEY_LEAVES) {
    desatPx(d, i, winter * 0.18);                        // evergreen: only a faint winter frost
  }
```

> Note: the GRASS / GORSE / BILBERRY branches above are unchanged from the original except grass winter desat `0.4 -> 0.5` and the pale-blend `0.22 -> 0.28`; reproduce them exactly as shown so nothing is lost.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/verify-foliage.mjs`
Expected: PASS — `RESULT: PASS`, every line `ok`.

- [ ] **Step 5: Commit**

```bash
git add src/textures.js scripts/verify-foliage.mjs
git commit -m "feat(textures): seasonal leaf turn + evergreen monkey puzzle + stronger moor tints"
```

---

### Task 3: Wire the new check into `npm run verify`

**Files:**
- Modify: `package.json` (the `scripts` block, ~lines 11-29)

- [ ] **Step 1: Add the script and chain entry**

In `package.json`, add a `verify:foliage` script next to `verify:season`:

```json
    "verify:foliage": "node scripts/verify-foliage.mjs",
```

And insert `verify-foliage` into the long `verify` chain, immediately after `verify-season.mjs`:

```
... && node scripts/verify-season.mjs && node scripts/verify-foliage.mjs && node scripts/verify-weather.mjs && ...
```

- [ ] **Step 2: Run the full suite to verify everything passes**

Run: `npm run verify`
Expected: every sub-check prints `RESULT: PASS` and the command exits 0. In particular `verify-season` and `verify-foliage` both pass.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "test: add verify-foliage to the verify suite"
```

---

## Self-Review

**Spec coverage (M1 + M2 of the spec):**
- M1 "season signal — add bloom/frost scalars, unit-tested" → Task 1. ✓ (snowdrop, daffodil, summerBloom, seedhead, frost; `verify-season` extended.)
- M2 "leaves turn (spring flush / autumn gold-rust / winter brown); monkey puzzle evergreen; stronger heather/bracken/grass" → Task 2. ✓
- Spec testing note "extend verify-season; new headless checks join `npm run verify`" → Tasks 1 & 3. ✓
- Out of scope for this plan (deferred to Plans 2/3): flower overlay, lineside, snow. Stated in header. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step has an exact command + expected result. ✓

**Type/name consistency:** `seasonShiftPx(tile, d, i, s)` signature is used identically in the test (Task 2 Step 1) and the implementation (Task 2 Step 3). Scalar names (`snowdrop`, `daffodil`, `summerBloom`, `seedhead`, `frost`) match between `build()` (Task 1 Step 3) and the tests (Task 1 Step 1). `TILE.LEAVES` / `TILE.MONKEY_LEAVES` match between `SEASON_TILES`, the `seasonShiftPx` branches, and the test. ✓

**Threshold sanity (fail-at-old / pass-at-new):** heather bloom blue channel: old `0.7` ⇒ ~150.6 (fails `>=155`), new `0.82` ⇒ ~157.6 (passes). Bracken autumn red: old `0.6` ⇒ ~131.6 (fails `>=135`), new `0.72` ⇒ ~138.9 (passes). Leaf autumn from base (63,85,39) at `0.6` ⇒ ~(132,104,38): red>green ✓ and redder than summer ✓. ✓
