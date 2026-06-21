# Festive Winter Plan 1 — Deeper snow + festive scaffold + snowmen

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make deep winter read thicker (whiter, snow on roofs/caps), stand up the winter-gated `festiveLayer`, and deliver snowmen — auto ones on the greens only when snow is deepest, plus snowmen players build anywhere and customise.

**Architecture:** A pure `festive.js` (winter + deep-snow gating) and `snowman.js` (customisation + melt) are unit-tested. `festiveLayer.js` mirrors `floraLayer`'s windowed rebuild but builds small 3D figure Groups. A `world.snowmanLedger` persists player snowmen (pos → config), swept away in the spring thaw. The mesher's snow shader is strengthened. Client-side, deterministic, no relay.

**Tech Stack:** vanilla ES modules, three.js (Group/Mesh figures + onBeforeCompile), Node `.mjs` verify.

Plan 1 of 4 for the festive-winter spec ([2026-06-21-festive-winter-design.md](../specs/2026-06-21-festive-winter-design.md)). Reuses: `floraLayer.js` (windowed overlay idiom), `world.js` `forageLedger` (mirror for `snowmanLedger`), `mesher.js` `addSnow` (deepen), `entities.js` box-figure helpers, the right-click use-action in `main.js` (forage branches). Next-free ids: B 59, TILE 79, I 122. Setting is **Victorian** — keep it period-accurate.

## File structure

- `src/festive.js` (new) — pure: `festiveActive(season)`, `deepSnow(snowAccum)`, `snowmanMelted(season)`.
- `src/snowman.js` (new) — pure: customisation model (`SCARF_COLORS`, `HATS`, `NOSES`, `DEFAULT_SNOWMAN`, `cycleSnowman`).
- `src/world.js` — `snowmanLedger` + record/get/remove/melt + (de)serialize.
- `src/mesher.js` — deeper-snow shader.
- `src/festiveLayer.js` (new) — windowed layer: builds snowman figures (auto + player); teardown.
- `src/main.js` — construct/drive/teardown `festiveLayer`; scoop/build/customise interaction; melt sweep.
- `src/defs.js` / `src/textures.js` — snowball item + snowman-part colours/tiles + icon.
- `scripts/verify-festive.mjs` (new) + `package.json`.

## Verification note

Pure logic (gating, customisation, ledger) TDD'd in `verify-festive.mjs`. The deeper snow, the 3D snowman figures, auto-placement, and the build/customise interaction are visual/runtime — verified via the `window.game` drive (instance/ledger/console-error checks) as throughout this codebase. Each such task lists a manual check.

---

### Task 1: Snowball item + snowman-part definitions + art

**Files:** Modify `src/defs.js`, `src/textures.js`. Data + art.

- [ ] **Step 1: Item** — in `src/defs.js` `I`, after the last item (`PLUM: 121,`), add `SNOWBALL: 122,`.
- [ ] **Step 2: Name** — `ITEM_NAMES`: `[I.SNOWBALL]: 'Snowball',`.
- [ ] **Step 3: Tile** — in `TILE`, after the last (`PLUM: 78,`), add `SNOWBALL: 79,` (used for the item icon; the 3D snowman uses plain materials, not tiles).
- [ ] **Step 4: Tile painter** — in `src/textures.js`, add a painter for `TILE.SNOWBALL` (a simple white snowball with soft shading), matching the existing painter style.
- [ ] **Step 5: Item icon** — register the `I.SNOWBALL` icon (reuse its tile, per the convention the forage items used).
- [ ] **Step 6: Build + verify** — `npm run build` (exit 0); `npm run verify` (green; sync facts if a check trips).
- [ ] **Step 7: Commit** — `git add src/defs.js src/textures.js && git commit -m "feat(festive): snowball item + icon"` + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 2: Pure gating + snowman customisation model

**Files:** Create `src/festive.js`, `src/snowman.js`, `scripts/verify-festive.mjs`.

- [ ] **Step 1: Write the failing test** — create `scripts/verify-festive.mjs`:
```js
// Festive winter — run wi': node scripts/verify-festive.mjs
import { festiveActive, deepSnow, snowmanMelted } from '../src/festive.js';
import { SCARF_COLORS, HATS, NOSES, DEFAULT_SNOWMAN, cycleSnowman } from '../src/snowman.js';
import { seasonStateAtPhase } from '../src/season.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const winter = seasonStateAtPhase(0.875), summer = seasonStateAtPhase(0.375), spring = seasonStateAtPhase(0.18);

// gating
(festiveActive(winter) ? ok : bad)('festive is on in winter');
(!festiveActive(summer) ? ok : bad)('festive is off in summer');
(deepSnow(0.9) && !deepSnow(0.5) ? ok : bad)('auto-snowmen only when snow is deepest');
(snowmanMelted(spring) && !snowmanMelted(winter) ? ok : bad)('player snowmen melt in the thaw, not mid-winter');

// customisation model cycles each part and round-trips
{
  let c = { ...DEFAULT_SNOWMAN };
  const s0 = c.scarf; c = cycleSnowman(c, 'scarf');
  (c.scarf === (s0 + 1) % SCARF_COLORS.length ? ok : bad)('scarf colour cycles');
  c = cycleSnowman(c, 'hat'); (HATS.includes(c.hat) ? ok : bad)('hat cycles within HATS');
  c = cycleSnowman(c, 'nose'); (NOSES.includes(c.nose) ? ok : bad)('nose cycles within NOSES');
  const a = c.arms; c = cycleSnowman(c, 'arms'); (c.arms === !a ? ok : bad)('arms toggle');
  (cycleSnowman(c, 'scarf') !== c ? ok : bad)('cycle returns a new object (no mutation)');
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run, expect FAIL** — `node scripts/verify-festive.mjs` (modules missing).

- [ ] **Step 3: Create `src/festive.js`:**
```js
// festive.js — pure winter-festive gating. No DOM, no three.js.
// The whole winter is festive; auto-snowmen need the deepest snow; player snowmen melt in the thaw.
export function festiveActive(season) { return !!season && season.frost > 0.35; }
export function deepSnow(snowAccum) { return (snowAccum || 0) > 0.85; }
export function snowmanMelted(season) { return !festiveActive(season); }
```

- [ ] **Step 4: Create `src/snowman.js`:**
```js
// snowman.js — pure snowman customisation model. No DOM, no three.js.
export const SCARF_COLORS = [0xb23b3b, 0x2f6e4f, 0x2a4d8f, 0x7a4da8, 0xc9a13b]; // red, green, blue, plum, gold
export const HATS = ['none', 'topper', 'bobble'];   // bare, Victorian top hat, bobble cap
export const NOSES = ['carrot', 'coal'];
export const DEFAULT_SNOWMAN = { scarf: 0, hat: 'topper', nose: 'carrot', arms: true, smile: true };

// Return a NEW config with `part` cycled/toggled. parts: scarf|hat|nose|arms|smile.
export function cycleSnowman(cfg, part) {
  const c = { ...cfg };
  if (part === 'scarf') c.scarf = (c.scarf + 1) % SCARF_COLORS.length;
  else if (part === 'hat') c.hat = HATS[(HATS.indexOf(c.hat) + 1) % HATS.length];
  else if (part === 'nose') c.nose = NOSES[(NOSES.indexOf(c.nose) + 1) % NOSES.length];
  else if (part === 'arms') c.arms = !c.arms;
  else if (part === 'smile') c.smile = !c.smile;
  return c;
}
```

- [ ] **Step 5: Run, expect PASS** — `node scripts/verify-festive.mjs` → `RESULT: PASS`.
- [ ] **Step 6: Commit** — `git add src/festive.js src/snowman.js scripts/verify-festive.mjs && git commit -m "feat(festive): pure gating + snowman customisation model"` + trailer.

---

### Task 3: `snowmanLedger` — player snowmen persist + melt

**Files:** Modify `src/world.js`; extend `scripts/verify-festive.mjs`.

- [ ] **Step 1: Failing tests** — append to `scripts/verify-festive.mjs` before the RESULT line:
```js
// snowmanLedger: record -> get; melts in the spring thaw
{
  const { World } = await import('../src/world.js');
  const w = new World(1234);   // match the real constructor (see verify-resources.mjs)
  w.recordSnowman(3, 28, 7, { ...DEFAULT_SNOWMAN, scarf: 2 }, 800);
  (w.getSnowman(3, 28, 7)?.cfg.scarf === 2 ? ok : bad)('a built snowman is remembered');
  w.meltSnowmen(seasonStateAtPhase(0.875));  // deep winter -> stays
  (w.getSnowman(3, 28, 7) ? ok : bad)('snowmen survive mid-winter');
  w.meltSnowmen(seasonStateAtPhase(0.18));   // spring -> melts
  (!w.getSnowman(3, 28, 7) ? ok : bad)('snowmen melt in spring');
}
```
(Adapt `new World(1234)` to the real constructor — mirror `verify-resources.mjs`/`verify-forage.mjs`.)

- [ ] **Step 2: Run, expect FAIL** — `node scripts/verify-festive.mjs`.

- [ ] **Step 3: Implement** in `src/world.js`, mirroring `forageLedger`. Constructor: `this.snowmanLedger = new Map();`. Methods:
```js
  recordSnowman(x, y, z, cfg, day) { this.snowmanLedger.set(`${x},${y},${z}`, { cfg, day }); }
  getSnowman(x, y, z) { return this.snowmanLedger.get(`${x},${y},${z}`) || null; }
  removeSnowman(x, y, z) { this.snowmanLedger.delete(`${x},${y},${z}`); }
  meltSnowmen(season) { if (snowmanMelted(season)) this.snowmanLedger.clear(); }
```
Import `snowmanMelted` from `./festive.js`. If `world.js` (de)serializes `forageLedger`/`editLedger` in the save path, serialize `snowmanLedger` the same way (`[...map]` out, `new Map(arr)` in); match the existing pattern.

- [ ] **Step 4: Run, expect PASS** — `node scripts/verify-festive.mjs`.
- [ ] **Step 5: Commit** — `git add src/world.js scripts/verify-festive.mjs && git commit -m "feat(festive): snowmanLedger persists player snowmen, melts in spring"` + trailer.

---

### Task 4: Deeper snow

**Files:** Modify `src/mesher.js`. Visual.

- [ ] **Step 1: Strengthen the snow wash** — in `addSnow` (the fragment injection), make deep winter read thicker: (a) a **whiter** blanket at high `uSnowAmt` (push the mix toward a brighter white and a higher max factor), and (b) snow on **less-vertical** faces so it lies on **roofs and structure tops** (lower the up-face `smoothstep` threshold, e.g. from `smoothstep(0.2, 0.75, vSnowUp)` toward `smoothstep(0.05, 0.55, vSnowUp)`). Keep the snow-line gate. Example replacement for the snow fragment line:
```glsl
  float snow = uSnowAmt * drift * vSnowExp * smoothstep(uSnowLine, uSnowLine + 10.0, vSnowY) * smoothstep(0.05, 0.55, vSnowUp);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.96, 0.98, 1.0), clamp(snow * 1.25, 0.0, 1.0));
```
(The cutout material also runs `addSnow`, so leaves/bushes get capped automatically — confirm capped foliage looks right, not whitened on the sides.)

- [ ] **Step 2: Build + manual check** — `npm run build`. Dev server: `game.seasonOverride = 0.875` → snow reads markedly thicker/whiter, lies on cottage roofs, caps trees/bushes; valley covered. Compare `0.78` (lighter) vs `0.875` (deep). No GLSL/console errors.
- [ ] **Step 3: Commit** — `git add src/mesher.js && git commit -m "feat(festive): deeper winter snow (whiter, on roofs, capped foliage)"` + trailer.

---

### Task 5: `festiveLayer` scaffold + snowman figures + auto-snowmen

**Files:** Create `src/festiveLayer.js`; Modify `src/main.js`. Visual.

- [ ] **Step 1: The layer** — create `src/festiveLayer.js`, mirroring `floraLayer.js`'s lifecycle (constructor `(scene, world)`; `update(dt, playerPos, season, snowAccum)` rebuilds on cell-move ≥ 8, or when the festive key changes — the key = `festiveActive`+`deepSnow`+snowman-ledger size; `build(...)`; `clear()` removes + disposes all built objects). It holds `this.objects = []` (Groups/Meshes added to the scene).
- [ ] **Step 2: Snowman figure builder** — add `buildSnowman(cfg)` returning a `THREE.Group`: two-three stacked white spheres (`SphereGeometry` + `MeshLambertMaterial({color:0xfbfdff})`) for the body/head; small coal eyes (dark spheres) + a mouth of coal dots if `cfg.smile`; a nose (`cfg.nose==='carrot'` orange cone, else a coal nub); a scarf band (`SCARF_COLORS[cfg.scarf]`); stick arms (thin brown boxes) if `cfg.arms`; a hat per `cfg.hat` (`'topper'` = black cylinder + brim; `'bobble'` = coloured cap + white pom; `'none'`). Import `SCARF_COLORS` from `./snowman.js`. Keep it small (a handful of meshes per snowman).
- [ ] **Step 3: Auto-snowmen on greens** — in `build()`, when `festiveActive(season) && deepSnow(snowAccum)`, for each village within `RADIUS` of the player (use `this.world.gen.geo.villages`), place a few snowmen on **green** cells near the centre (use `gen.geo.villageColumn(x,z).kind === 'green'` or `'closes'`, surface is grass, not a building/path), positioned + lightly rotated deterministically (hash on x,z so they're stable). Each uses `DEFAULT_SNOWMAN` (auto ones aren't customised). Set each Group's position to the cell surface (`gen.height(x,z)+1`).
- [ ] **Step 4: Wire into `main.js`** — construct `this.festiveLayer = new FestiveLayer(this.scene, this.world)` where `floraLayer` is constructed (and clear/rebuild it on teardown the same way). Each frame (near the `floraLayer.update` call), call `this.festiveLayer.update(dt, this.player.pos, this.season, this.snowAccum)`. Import `FestiveLayer`.
- [ ] **Step 5: Build + live check** — `npm run build`. Drive the game: teleport near a village (`game.world.gen.geo.villages[0]`), `game.seasonOverride = 0.875` and `game.snowAccum = 1`, pump frames → auto-snowmen appear on the green (count `festiveLayer.objects`); set `game.snowAccum = 0.5` + rebuild → they vanish (deep-snow gate); `game.seasonOverride = 0.375` → none (summer). No console errors. Report counts.
- [ ] **Step 6: Commit** — `git add src/festiveLayer.js src/main.js && git commit -m "feat(festive): festiveLayer + 3D snowman figures + deep-snow auto-snowmen"` + trailer.

---

### Task 6: Player-built, customisable snowmen

**Files:** Modify `src/main.js`, `src/festiveLayer.js`. Interaction.

- [ ] **Step 1: Scoop snowballs** — in the right-click use-action handler (where the forage branches live), add: when the player right-clicks with an **empty hand** (or non-placeable) onto a snow-covered surface in deep snow (`deepSnow(this.snowAccum)` and the targeted top is open ground), give `I.SNOWBALL` (`this.player.addItem(I.SNOWBALL, 1)`), a toast ("Scooped a snowball."), and return. Place this branch so it doesn't shadow the forage picks (forage first, then scoop). Import `deepSnow` from `./festive.js`.
- [ ] **Step 2: Build a snowman** — when the player uses **`I.SNOWBALL`** (held) on the ground (right-click placing), if they have ≥3 snowballs, consume 3, compute the target cell (the surface above the looked-at block), and `this.world.recordSnowman(x, y, z, { ...DEFAULT_SNOWMAN }, this.sky.day)`; invalidate the festive layer (`this.festiveLayer.center = null`); toast "Built a snowman — right-click to dress it." Import `DEFAULT_SNOWMAN` from `./snowman.js`.
- [ ] **Step 3: Customise** — when the player right-clicks an **existing player snowman** (a cell in `snowmanLedger`), cycle a part and re-render: `const s = this.world.getSnowman(x,y,z); if (s) { this.world.recordSnowman(x,y,z, cycleSnowman(s.cfg, nextPart()), s.day); this.festiveLayer.center = null; }`. Cycle through parts on successive clicks (track a small per-cell index, or cycle 'scarf'→'hat'→'nose'→'arms'→'smile' round-robin). Import `cycleSnowman` from `./snowman.js`. (Detecting "right-clicked a snowman": check whether the targeted cell/adjacent cell is in `snowmanLedger`.)
- [ ] **Step 4: Render player snowmen** — in `festiveLayer.build()`, in addition to auto-snowmen, iterate `this.world.snowmanLedger` and `buildSnowman(entry.cfg)` at each recorded position (these show whenever present, independent of the deep-snow gate — they persist until melt). 
- [ ] **Step 5: Melt sweep** — in `main.js`, where `expireForage`/`expireEdits` run on the day tick, add `this.world.meltSnowmen(this.season);` so player snowmen clear in the spring thaw; invalidate the festive layer when that happens.
- [ ] **Step 6: Build + live check** — `npm run build`. Drive the game in deep winter: scoop 3 snowballs (`game.player.addItem(122,3)` to shortcut), build a snowman (exercise the build branch) → it appears + is in `snowmanLedger`; right-click it → its config changes (scarf/hat cycles) + the figure updates; `game.seasonOverride=0.18` + run `game.world.meltSnowmen(game.season)` → it's gone. No console errors. Report the ledger + render before/after.
- [ ] **Step 7: Commit** — `git add src/main.js src/festiveLayer.js && git commit -m "feat(festive): build + customise your own snowmen; melt in spring"` + trailer.

---

### Task 7: Wire `verify-festive` into the suite

**Files:** Modify `package.json`.

- [ ] **Step 1:** Add `"verify:festive": "node scripts/verify-festive.mjs",` next to `verify:forage`, and insert `node scripts/verify-festive.mjs` into the `verify` chain after `node scripts/verify-forage.mjs`.
- [ ] **Step 2: Run** `npm run verify` → all `RESULT: PASS`, exit 0.
- [ ] **Step 3: Commit** — `git add package.json && git commit -m "test: add verify-festive to the verify suite"` + trailer.

---

## Self-Review

**Spec coverage (Plan 1 slice):** deeper snow ✓ T4; festive scaffold (`festive.js`/`festiveLayer.js`/`snowman.js`/`snowmanLedger`) ✓ T2/T3/T5; auto-snowmen deep-snow-gated ✓ T5; player-built customisable snowmen + melt ✓ T6; tests ✓ T2/T3/T7. Fir, atmosphere, carol, Merlin are Plans 2–4.

**Placeholder scan:** pure tasks (T2,T3) complete with code + commands; visual/interaction tasks (T4–T6) give complete logic + explicit manual checks for the 3D figures/snow/interaction (can't screenshot the backgrounded tab). "Match the real constructor / use-action handler / villages accessor" are necessary lookups, not placeholders.

**Type/name consistency:** `festiveActive`/`deepSnow`/`snowmanMelted` (T2) used in T3 (`world.js`), T5 (gating), T6 (scoop). `SCARF_COLORS`/`HATS`/`NOSES`/`DEFAULT_SNOWMAN`/`cycleSnowman` (T2) used in T5 (`buildSnowman`), T6 (build/customise). `snowmanLedger`/`recordSnowman`/`getSnowman`/`removeSnowman`/`meltSnowmen` (T3) used in T6. `I.SNOWBALL` (T1) used in T6. `festiveLayer` (T5) driven in T6.

**Open risks (validate during execution):**
- **Use-action ordering:** scoop/build/customise must slot among the existing forage + place branches without shadowing them — forage picks first, then snowman-customise (on a snowman cell), then scoop (empty hand on snow), then place (held snowball). Keep `isPlaceable`/empty-hand gates consistent.
- **3D figure cost:** keep snowmen to a handful of small meshes each; instance later if counts grow (Plan 4 polish). Teardown must dispose geometries/materials (mirror `floraLayer.clear`).
- **`villages` accessor + green detection:** confirm `gen.geo.villages` + `villageColumn(x,z).kind` are the right names; place auto-snowmen only on open green/closes grass.
- **Save parity:** `snowmanLedger` (de)serialization matches whatever `forageLedger`/`editLedger` do; if those are session-only, player snowmen reset on reload (acceptable v1; melt still works in-session).
- **Snowball-scoop gating:** only in deep snow (`deepSnow(snowAccum)`) so it's a winter action, not a year-round one.
- **Deeper-snow on cutout sides:** lowering the up-face threshold could whiten near-vertical foliage faces — verify capped trees look right; clamp if odd.
