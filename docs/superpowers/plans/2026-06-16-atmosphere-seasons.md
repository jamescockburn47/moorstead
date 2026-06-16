# Atmosphere — Seasons Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, shared seasonal clock to Moorstead and make the sky/light and bilberry foraging respond to it — the foundation every other atmosphere feature consumes.

**Architecture:** A new pure module `src/season.js` derives the season from `Date.now()` (UTC wall-clock), exactly like the Great Fog in `sky.js`, so all clients and Merlin agree with zero server coordination. ~1 real day per season; a four-day year. `sky.js` reads the season's named scalars to tint daylight; the block-break path gates bilberry drops to late summer. No persistence, no server change, no new dependencies.

**Tech Stack:** Vanilla ES modules, three.js r166, Vite. Tests are plain-node assertion scripts (the house pattern in `scripts/verify-*.mjs`), run via `npm run verify`.

**Scope note:** This is Plan 1 of the Atmosphere cluster. It deliberately excludes the seasonal *vegetation tint* (heather → purple) and *snow-on-the-tops* shader — those are intricate (canvas re-tint + GLSL) and get their own Plan 2 with live visual verification. Live weather, soundscape and wildlife are later plans. Spec: [docs/superpowers/specs/2026-06-16-atmosphere-cluster-design.md](../specs/2026-06-16-atmosphere-cluster-design.md).

---

## File Structure

- **Create `src/season.js`** — pure season clock. Exports `seasonState(now)`, `seasonStateAtPhase(yearPhase)`, `bilberryInSeason(now)`, and the constants `YEAR`, `ANCHOR_SEC`, `ANCHOR_PHASE`. No three.js, no DOM — runs headless. One responsibility: turn time into named seasonal scalars.
- **Create `scripts/verify-season.mjs`** — house-pattern node check for the clock. Added to `npm run verify`.
- **Modify `package.json:11`** — chain the new verify script; add a `verify:season` alias.
- **Modify `src/sky.js`** — `update()` takes an optional `season` and casts the daylight warm (summer) / cool-grey (winter). Single responsibility unchanged (sky/weather rendering).
- **Modify `src/main.js`** — import `season.js`; compute the season once per frame and pass it to `sky.update`; expose a `seasonOverride` debug lever; gate bilberry-bush drops by season at the break site.

---

## Task 1: Season clock (`src/season.js`)

**Files:**
- Create: `src/season.js`
- Create test: `scripts/verify-season.mjs`
- Modify: `package.json:11` (verify chain) + new `verify:season` script

- [ ] **Step 1: Write the failing test** — create `scripts/verify-season.mjs`:

```js
// Season clock check — run wi': node scripts/verify-season.mjs
// The season is a pure function of wall-clock time: deterministic, shared by
// every client, ~1 real day per season (a four-day year). Nowt is persisted.
import {
  seasonState, seasonStateAtPhase, bilberryInSeason, YEAR, ANCHOR_SEC, ANCHOR_PHASE,
} from '../src/season.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const DAY = 86400 * 1000;

// determinism — same instant, same result
{
  const t = ANCHOR_SEC * 1000 + 12345;
  (JSON.stringify(seasonState(t)) === JSON.stringify(seasonState(t)) ? ok : bad)('seasonState is deterministic for a fixed instant');
}

// the four seasons cycle one per real day, starting from the anchor (summer)
{
  const base = ANCHOR_SEC * 1000 + 1;
  const names = [0, 1, 2, 3].map(d => seasonState(base + d * DAY).season);
  (names.join(',') === 'summer,autumn,winter,spring' ? ok : bad)('seasons cycle one per real day from the anchor (got ' + names.join(',') + ')');
}

// season by yearPhase quarter
{
  (seasonStateAtPhase(0.05).season === 'spring' ? ok : bad)('yearPhase .05 is spring');
  (seasonStateAtPhase(0.30).season === 'summer' ? ok : bad)('yearPhase .30 is summer');
  (seasonStateAtPhase(0.60).season === 'autumn' ? ok : bad)('yearPhase .60 is autumn');
  (seasonStateAtPhase(0.90).season === 'winter' ? ok : bad)('yearPhase .90 is winter');
}

// heather blooms in late summer, not spring or winter
{
  const late = seasonStateAtPhase(0.45).heatherBloom;
  const spring = seasonStateAtPhase(0.10).heatherBloom;
  const winter = seasonStateAtPhase(0.85).heatherBloom;
  (late > 0.9 ? ok : bad)('heather bloom peaks in late summer (' + late.toFixed(2) + ')');
  (spring < 0.1 && winter < 0.1 ? ok : bad)('heather is not in bloom in spring or winter');
}

// snow peaks in deep winter, never at high summer
{
  const winter = seasonStateAtPhase(0.875).snowiness;
  const summer = seasonStateAtPhase(0.375).snowiness;
  (winter > 0.9 ? ok : bad)('snow peaks in deep winter (' + winter.toFixed(2) + ')');
  (summer < 0.05 ? ok : bad)('no snow at high summer (' + summer.toFixed(2) + ')');
}

// spring is greener than winter
{
  (seasonStateAtPhase(0.18).greenness > seasonStateAtPhase(0.875).greenness ? ok : bad)('spring is greener than winter');
}

// every scalar stays in range across the whole year
{
  let inRange = true;
  for (let i = 0; i < 400; i++) {
    const s = seasonStateAtPhase(i / 400);
    if (s.yearPhase < 0 || s.yearPhase >= 1) inRange = false;
    if (s.heatherBloom < 0 || s.heatherBloom > 1) inRange = false;
    if (s.snowiness < 0 || s.snowiness > 1) inRange = false;
    if (s.greenness < 0 || s.greenness > 1) inRange = false;
    if (s.warmth < -1.0001 || s.warmth > 1.0001) inRange = false;
  }
  (inRange ? ok : bad)('all seasonal scalars stay within range across the year');
}

// bilberries bear at the bloom peak, bare in winter
{
  // exact inverse of seasonState's phase formula: a `now` (ms) at year phase p
  const nowAtPhase = p => (ANCHOR_SEC + (p - ANCHOR_PHASE) * YEAR) * 1000 + 1;
  (bilberryInSeason(nowAtPhase(0.45)) ? ok : bad)('bilberries are in season at late-summer peak');
  (!bilberryInSeason(nowAtPhase(0.85)) ? ok : bad)('bilberries are bare in winter');
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/verify-season.mjs`
Expected: FAIL — `Cannot find module '../src/season.js'` (the module does not exist yet).

- [ ] **Step 3: Write `src/season.js`**

```js
// season.js — deterministic seasonal clock for the shared moor.
//
// Season is a pure function of wall-clock time (Date.now()), so every client
// and Merlin agree without any server coordination — the same idiom the Great
// Fog uses (sky.js) and the train. ~1 real day per season; a four-day year.
// Nowt is persisted: the season is computed, never stored.

export const YEAR = 4 * 86400;                        // seconds: four real days
export const ANCHOR_SEC = Date.UTC(2026, 5, 16) / 1000; // 2026-06-16 00:00 UTC
export const ANCHOR_PHASE = 0.27;                     // early summer at the anchor

const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const frac = x => x - Math.floor(x);

// wrap-around Gaussian bump on the year circle: 1 at centre c, width w
function bump(phase, c, w) {
  let d = Math.abs(phase - c);
  if (d > 0.5) d = 1 - d;
  return Math.exp(-(d * d) / (2 * w * w));
}

function build(yearPhase) {
  const idx = Math.min(3, Math.floor(yearPhase * 4));
  return {
    yearPhase,
    season: SEASONS[idx],
    seasonT: frac(yearPhase * 4),
    heatherBloom: bump(yearPhase, 0.45, 0.06),    // peak in late summer (~August)
    snowiness: bump(yearPhase, 0.875, 0.08),      // peak in deep winter
    greenness: 0.5 + 0.5 * Math.cos((yearPhase - 0.18) * Math.PI * 2),
    warmth: Math.cos((yearPhase - 0.375) * Math.PI * 2), // -1 winter .. +1 summer
  };
}

export function seasonState(now = Date.now()) {
  return build(frac((now / 1000 - ANCHOR_SEC) / YEAR + ANCHOR_PHASE));
}

// Build a season directly from a year phase [0,1) — for tests and the debug lever.
export function seasonStateAtPhase(yearPhase) {
  return build(frac(yearPhase));
}

// Bilberries bear only in late summer (the heather-bloom window).
export function bilberryInSeason(now = Date.now()) {
  return seasonState(now).heatherBloom > 0.4;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/verify-season.mjs`
Expected: every line `ok`, final line `RESULT: PASS`, exit 0.

- [ ] **Step 5: Wire it into `npm run verify`** — edit `package.json:11` to append the new script, and add the alias below the existing `verify:landmarks` line.

Change line 11 from:
```json
    "verify": "node scripts/verify-rail.mjs && node scripts/verify-rail-clearance.mjs && node scripts/verify-train-view.mjs && node scripts/verify-resources.mjs && node scripts/verify-landmarks.mjs",
```
to:
```json
    "verify": "node scripts/verify-rail.mjs && node scripts/verify-rail-clearance.mjs && node scripts/verify-train-view.mjs && node scripts/verify-resources.mjs && node scripts/verify-landmarks.mjs && node scripts/verify-season.mjs",
```
and add after the `"verify:landmarks": ...` line:
```json
    "verify:season": "node scripts/verify-season.mjs",
```
(ensure the preceding line keeps its trailing comma and JSON stays valid).

- [ ] **Step 6: Run the whole verify suite**

Run: `npm run verify`
Expected: all six scripts pass; final season block prints `RESULT: PASS`; exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/season.js scripts/verify-season.mjs package.json
git commit -m "feat(season): deterministic shared season clock + verify script"
```

---

## Task 2: Seasonal sky & light (`src/sky.js`, `src/main.js`)

**Files:**
- Modify: `src/sky.js:127` (signature) and insert before `src/sky.js:201`
- Modify: `src/main.js` (import; compute + pass season at the `sky.update` call ~line 1897; add `seasonOverride` lever)

The only caller of `sky.update` is `src/main.js:1897` (verified by grep); the new third argument defaults to `null`, so nothing else breaks.

- [ ] **Step 1: Add the `season` parameter to `Sky.update`** — in `src/sky.js`, change line 127 from:

```js
  update(dt, playerPos) {
```
to:
```js
  update(dt, playerPos, season = null) {
```

- [ ] **Step 2: Apply the seasonal cast** — in `src/sky.js`, immediately before line 201 (`this.scene.background = sky;`), insert:

```js
    // seasonal cast — summer warms the daylight, winter cools and greys it.
    // Scaled by `dayness` so it only tints the lit sky, not the night.
    if (season) {
      const w = season.warmth; // -1 (deep winter) .. +1 (high summer)
      const tint = new THREE.Color().setHSL(w >= 0 ? 0.09 : 0.58, 0.4, 0.5);
      sky = sky.clone().lerp(tint, 0.07 * Math.abs(w) * dayness);
      this.ambient.intensity *= (1 + w * 0.05);
      this.sun.intensity *= (1 + w * 0.04);
    }
```
(`dayness`, `this.ambient`, `this.sun` are all in scope here — see lines 161-163.)

- [ ] **Step 3: Import and compute the season in `src/main.js`** — add to the top-of-file imports (alongside the other `./` module imports):

```js
import { seasonState, seasonStateAtPhase, bilberryInSeason } from './season.js';
```

- [ ] **Step 4: Pass the season into `sky.update`** — in `src/main.js`, replace line 1897:

```js
      const msg = this.sky.update(dt, this.player.pos);
```
with:
```js
      const season = (this.seasonOverride != null)
        ? seasonStateAtPhase(this.seasonOverride)
        : seasonState();
      this.season = season; // cached for other systems + the debug API
      const msg = this.sky.update(dt, this.player.pos, season);
```

- [ ] **Step 5: Initialise the debug lever** — in the `Game` constructor (where other instance fields are set), add:

```js
    this.seasonOverride = null; // dev: set 0..1 to force a year phase (see window.moorstead.setSeason)
    this.season = null;
```
Then, wherever the dev handle is wired (`window.moorstead` / `moorstead.debug`), add a setter — search `src/main.js` for `setSeason` is absent, so add near the other debug helpers:

```js
    setSeason: (p) => { game.seasonOverride = (p == null ? null : Math.max(0, Math.min(0.999, p))); return game.seasonOverride; },
```
(If the debug object's exact shape differs, add `setSeason` alongside the existing `warp`/`viewProbe` helpers noted in the project memory. If you cannot locate it cleanly, expose `window.setSeason = p => { game.seasonOverride = p; }` as a minimal fallback so Step 7 can force seasons.)

- [ ] **Step 6: Build and verify nothing regressed**

Run: `npm run build`
Expected: Vite build succeeds, no errors.

Run: `npm run verify`
Expected: all pass (this change does not affect the headless checks, but confirm).

- [ ] **Step 7: Live visual check** (this is a rendering change — verify by eye, do not assume)

Use the preview tooling:
1. `preview_start` (Vite dev server).
2. In the page console (via `preview_eval`): `game.loginGuest(); game.newWorld('x')`, let it reach `playing`.
3. Force winter: `preview_eval` → `window.moorstead.setSeason(0.875)` (or `window.setSeason(0.875)`), then `preview_screenshot`. Expect a colder, greyer daylight cast.
4. Force high summer: `window.moorstead.setSeason(0.375)`, `preview_screenshot`. Expect a warmer cast.
5. Reset: `window.moorstead.setSeason(null)`.

Confirm summer vs winter screenshots visibly differ in warmth. If the tint is too strong/weak, adjust the `0.07` lerp factor in Step 2.

- [ ] **Step 8: Commit**

```bash
git add src/sky.js src/main.js
git commit -m "feat(season): cast daylight warm in summer, cool-grey in winter"
```

---

## Task 3: Bilberry seasonal gate (`src/main.js`)

**Files:**
- Modify: `src/main.js:1571-1573` (the block-break drop site)

Bilberries (`B.BILBERRY_BUSH → I.BILBERRIES`, defs.js:95) should only drop in late summer; out of season the bush is bare. `B` and `bilberryInSeason` are both in scope (B is already imported; `bilberryInSeason` was imported in Task 2 Step 3).

- [ ] **Step 1: Gate the drop** — in `src/main.js`, replace lines 1571-1573:

```js
    if (!this.player.creative && !noDrop && def.drop !== null && def.drop !== undefined) {
      this.entities.spawnDrop(hit.x + 0.5, hit.y + 0.4, hit.z + 0.5, def.drop, 1);
    }
```
with:
```js
    if (!this.player.creative && !noDrop && def.drop !== null && def.drop !== undefined) {
      const inSeason = this.season ? this.season.heatherBloom > 0.4 : bilberryInSeason();
      const bareBilberry = hit.id === B.BILBERRY_BUSH && !inSeason;
      if (bareBilberry) {
        this.ui.toast('Nobbut bare twigs — bilberries aren’t out yet. Coom back i’ late summer.', 2500);
      } else {
        this.entities.spawnDrop(hit.x + 0.5, hit.y + 0.4, hit.z + 0.5, def.drop, 1);
      }
    }
```
This reuses the per-frame cached `this.season` (set in Task 2) so the debug season lever drives foraging too, and falls back to `bilberryInSeason()` (real wall-clock) before the first frame. `B` is already imported in main.js; `bilberryInSeason` was imported in Task 2 Step 3.

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: success.

Run: `npm run verify`
Expected: all pass.

- [ ] **Step 3: Live check**

1. `preview_start`; reach `playing` (Task 2 Step 7).
2. Force summer: `window.moorstead.setSeason(0.45)`. Find/spawn a bilberry bush and break it → expect berries to drop (the `BILBERRIES` item).
3. Force winter: `window.moorstead.setSeason(0.875)`. Break a bilberry bush → expect NO berries and the "bare twigs" toast.
4. Reset: `window.moorstead.setSeason(null)`.

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat(season): bilberries only bear in late summer"
```

---

## Self-Review

**1. Spec coverage (this plan's slice):**
- Season clock (spec §4) → Task 1. ✅ pure module + named scalars + verify script.
- Seasonal sky/light (spec §5a) → Task 2. ✅
- Bilberry seasonality (spec §6) → Task 3. ✅
- Deferred to later plans (correctly out of this plan): vegetation atlas tint + snow shader (§5b/§5c → Plan 2), live weather (§6→ wait, §6 is weather... correction: live weather is spec §6 in the *cluster* doc numbering? No — in the cluster spec, weather is Pillar 3 / §6 is bilberry. Vegetation/snow = §5b/§5c. Live weather = §6 heading "Pillar 3"). Soundscape (§7) and wildlife (§8) → later plans. ✅ All intentionally excluded with a scope note.

**2. Placeholder scan:** No "TBD/TODO/handle edge cases". The `nowAtPhase` test helper is the exact inverse of `seasonState`'s phase formula (offsets `ANCHOR_SEC` by `(p − ANCHOR_PHASE)·YEAR`), so phase-based assertions hit the intended phases. The debug-handle wiring in Task 2 Step 5 has a stated fallback (`window.setSeason`) so it is never blocking.

**3. Type/name consistency:** `seasonState`, `seasonStateAtPhase`, `bilberryInSeason`, `YEAR`, `ANCHOR_SEC`, `ANCHOR_PHASE` are defined in Task 1's `season.js` and used consistently in the test and Tasks 2-3. The season object's fields (`yearPhase`, `season`, `seasonT`, `heatherBloom`, `snowiness`, `greenness`, `warmth`) are referenced identically everywhere. `this.season` / `this.seasonOverride` are introduced in Task 2 and reused in Task 3.

---

## Notes for the next plans
- **Plan 2 (vegetation tint + snow):** `buildAtlas()` in textures.js builds one shared `CanvasTexture`; a `retintAtlasForSeason(season)` re-paints the heather/grass/bracken/bilberry tile rects on the existing `atlasCanvas` and sets `texture.needsUpdate = true` (no chunk re-mesh). Snow = an `onBeforeCompile` on the shared `materials.opaque` (mesher.js:11) injecting a world-Y → white mix under a `uSnowLine`/`uSnowAmt` uniform driven by `season.snowiness`. The `seasonOverride` lever from Task 2 makes both live-verifiable without waiting a real day.
- The cached `this.season` (Task 2) is the hand-off point for soundscape and wildlife plans (`audio.update`/`updateMobs` will read it).
