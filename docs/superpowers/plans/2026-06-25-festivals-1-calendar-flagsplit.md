# Festivals Slice 1 — Calendar Core + Flag Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the carol playing in autumn by introducing a deterministic festival calendar and splitting the one overloaded winter flag into `wintry` (broad, snow play) and `yuletide` (narrow Christmastide), then repointing the carol to `yuletide`.

**Architecture:** A new pure `festivals.js` maps `yearPhase` → each festival's intensity via a trapezoid window on the year circle (same deterministic, time-based idiom as `season.js`). `festive.js` gains `wintry`/`yuletide` keyed off that calendar; `snowmanMelted` moves to `wintry`. The carol's gate (`main.js`) moves from the broad `frost > 0.35` to `yuletide`; snow mechanics stay on `wintry`. Christmas *dressing* (the fir/carollers layer) keeps the broad winter gate this slice — narrowing it cleanly belongs with the scene-host refactor in Slice 2, because the same early-return currently also gates the snowmen.

**Tech Stack:** Vanilla ES modules, no new dependencies. Headless tests are plain Node `.mjs` assertion scripts (`scripts/verify-*.mjs`) chained by `npm run verify`.

**Scope note:** This is Slice 1 of the seasonal-festivals spec (`docs/superpowers/specs/2026-06-25-seasonal-festivals-design.md`). It produces working, testable software on its own: the live autumn-carol bug is fixed and the calendar foundation exists. Slices 2–11 build on it.

---

### Task 1: The festival calendar (`festivals.js`)

**Files:**
- Create: `src/festivals.js`
- Test: `scripts/verify-festivals.mjs`
- Modify: `package.json` (add the verify script + chain it)

- [ ] **Step 1: Write the failing test**

Create `scripts/verify-festivals.mjs`:

```js
// Festival calendar + flag split — run wi': node scripts/verify-festivals.mjs
import { festivalState, windowIntensity, FESTIVALS } from '../src/festivals.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// every festival is full-on at its centre and dead at the opposite side of the year
for (const f of FESTIVALS) {
  (festivalState(f.centre)[f.id] > 0.99 ? ok : bad)(f.id + ' is full intensity at its centre');
  (festivalState(f.centre + 0.5)[f.id] === 0 ? ok : bad)(f.id + ' is silent half a year away');
}

// `active` picks the festival whose window we are inside, or null between them
(festivalState(0.882).active === 'yule' ? ok : bad)('active is yule at midwinter');
(festivalState(0.650).active === 'harvest' ? ok : bad)('active is harvest at Michaelmas');
(festivalState(0.385).active === 'midsummer' ? ok : bad)('active is midsummer at the solstice');
(festivalState(0.500).active === null ? ok : bad)('no festival active between harvest and midsummer');

// windows do not collide: at each centre, only that one festival is non-zero
for (const f of FESTIVALS) {
  const others = FESTIVALS.filter(g => g.id !== f.id).every(g => festivalState(f.centre)[g.id] === 0);
  (others ? ok : bad)('no other festival overlaps ' + f.id + "'s centre");
}

// the trapezoid: 1 across the core, fading to 0 at the visible edge
{
  const f = FESTIVALS.find(x => x.id === 'yule'); // centre 0.882, 14 days
  (windowIntensity(f.centre, f.centre, f.days) === 1 ? ok : bad)('window is 1 at centre');
  (windowIntensity(f.centre + 0.04, f.centre, f.days) === 0 ? ok : bad)('window is 0 well past the edge');
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/verify-festivals.mjs`
Expected: FAIL — `Cannot find module '.../src/festivals.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/festivals.js`:

```js
// festivals.js — deterministic festival calendar for the shared moor.
//
// A pure function of yearPhase (the same clock as season.js), so every client
// and Merlin agree without server coordination. Each festival is a trapezoid
// window on the year circle: full intensity across a core, a short linear fade
// at each edge. Layers and audio gate on these intensities, never on the broad
// `frost` flag. Nowt is persisted; the calendar is computed.

const DAY = 1 / 365.25;          // one calendar day as a fraction of the year circle
export const EDGE_DAYS = 1.5;    // linear fade at each end of every window

// Centres derive from season.js's anchoring (midsummer at phase 0.375, midwinter
// 0.875). `days` is the full visible width of the window.
export const FESTIVALS = [
  { id: 'easter',    name: 'Eastertide',    centre: 0.180, days: 10 },
  { id: 'mayday',    name: 'May Day',       centre: 0.235, days: 7  },
  { id: 'midsummer', name: 'Midsummer',     centre: 0.385, days: 7  },
  { id: 'harvest',   name: 'Harvest Home',  centre: 0.650, days: 12 },
  { id: 'bonfire',   name: 'Bonfire Night', centre: 0.750, days: 7  },
  { id: 'yule',      name: 'Christmastide', centre: 0.882, days: 14 },
];

const frac = x => x - Math.floor(x);
// shortest distance between two phases on the unit circle [0,1)
function circDist(a, b) { const d = Math.abs(frac(a) - frac(b)); return d > 0.5 ? 1 - d : d; }

// Trapezoid window: 1 across the core, linear fade over EDGE_DAYS each side, 0
// beyond. `days` is the full width (intensity > 0 spans ±days/2).
export function windowIntensity(phase, centre, days) {
  const half = (days / 2) * DAY;
  const edge = Math.min(half, EDGE_DAYS * DAY);
  const core = half - edge;
  const d = circDist(phase, centre);
  if (d <= core) return 1;
  if (d >= core + edge) return 0;
  return 1 - (d - core) / edge;
}

// Map a yearPhase to every festival's intensity (0..1), plus the dominant
// festival id (`active`, highest intensity > 0, else null) and its `intensity`.
export function festivalState(yearPhase) {
  const p = frac(yearPhase);
  const out = {};
  let active = null, intensity = 0;
  for (const f of FESTIVALS) {
    const v = windowIntensity(p, f.centre, f.days);
    out[f.id] = v;
    if (v > intensity) { intensity = v; active = f.id; }
  }
  out.active = intensity > 0 ? active : null;
  out.intensity = intensity;
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/verify-festivals.mjs`
Expected: PASS (`RESULT: PASS`, exit 0).

- [ ] **Step 5: Wire the test into `package.json`**

In `package.json`, add a `verify:festivals` script alongside the others:

```json
    "verify:festivals": "node scripts/verify-festivals.mjs",
```

And append it to the chained `verify` script, right after `verify-festive.mjs`:

```
... && node scripts/verify-festive.mjs && node scripts/verify-festivals.mjs && node scripts/verify-weather.mjs ...
```

- [ ] **Step 6: Commit**

```bash
git add src/festivals.js scripts/verify-festivals.mjs package.json
git commit -m "feat(festivals): deterministic festival calendar (trapezoid windows)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Split the winter flag (`festive.js`)

**Files:**
- Modify: `src/festive.js` (whole file)
- Modify: `scripts/verify-festivals.mjs` (add split-guarantee assertions)
- Modify: `scripts/verify-festive.mjs:2,11,12` (rename the importer that used `festiveActive`)

- [ ] **Step 1: Write the failing test**

Append to `scripts/verify-festivals.mjs`, before the `console.log('\nRESULT...` line:

```js
// --- flag split: wintry (broad) vs yuletide (narrow Christmastide) ---
import { wintry, yuletide } from '../src/festive.js';
import { seasonStateAtPhase } from '../src/season.js';

// the bug fix: phase 0.70 is mid-autumn and frost-cold, so the OLD gate played
// the carol there. wintry stays true (snow play), yuletide is false (no carol).
{
  const autumn = seasonStateAtPhase(0.70);
  (wintry(autumn) ? ok : bad)('0.70 (autumn) is wintry — snow play unaffected');
  (!yuletide(autumn) ? ok : bad)('0.70 (autumn) is NOT yuletide — carol stays silent');
}
(yuletide(seasonStateAtPhase(0.882)) ? ok : bad)('midwinter is yuletide');
(!yuletide(seasonStateAtPhase(0.50)) ? ok : bad)('high summer is not yuletide');

// invariant: yuletide is a strict subset of wintry, sampled across the year.
// (Guarantees narrowing the carol can never break snowballs/snowmen.)
{
  let subset = true, wintryMatchesFrost = true;
  for (let i = 0; i < 500; i++) {
    const s = seasonStateAtPhase(i / 500);
    if (yuletide(s) && !wintry(s)) subset = false;
    if (wintry(s) !== (s.frost > 0.35)) wintryMatchesFrost = false;
  }
  (subset ? ok : bad)('yuletide ⊂ wintry across the whole year');
  (wintryMatchesFrost ? ok : bad)('wintry is exactly the old frost > 0.35 (no snow-play regression)');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/verify-festivals.mjs`
Expected: FAIL — `wintry`/`yuletide` are not exported by `festive.js` yet (`SyntaxError: ... does not provide an export named 'wintry'`).

- [ ] **Step 3: Write minimal implementation**

Replace the entire contents of `src/festive.js` with:

```js
// festive.js — pure winter/Christmas gating. No DOM, no three.js.
import { festivalState } from './festivals.js';

// Broad cold season: snow lies underfoot, snowballs can be scooped, snowmen
// persist. This is exactly the old `festiveActive` threshold (frost > 0.35).
export function wintry(season) { return !!season && season.frost > 0.35; }

// Narrow Christmastide: the carol + Christmas dressing only. A strict subset of
// `wintry` (asserted in tests), so narrowing it never breaks snow play.
export function yuletide(season) { return !!season && festivalState(season.yearPhase).yule > 0.5; }

// Auto-snowmen need the deepest snow.
export function deepSnow(snowAccum) { return (snowAccum || 0) > 0.85; }

// Snowmen melt in the spring thaw — keyed to the broad cold season, not
// Christmas, so they last all winter.
export function snowmanMelted(season) { return !wintry(season); }
```

- [ ] **Step 4: Keep the existing festive test green (rename its importer)**

In `scripts/verify-festive.mjs`, line 2, change the import from `festiveActive` to `wintry`:

```js
import { wintry, deepSnow, snowmanMelted } from '../src/festive.js';
```

And on lines 11–12 replace the two `festiveActive(...)` calls with `wintry(...)`:

```js
(wintry(winter) ? ok : bad)('winter is the cold season');
(!wintry(summer) ? ok : bad)('summer is not the cold season');
```

- [ ] **Step 5: Run both tests to verify they pass**

Run: `node scripts/verify-festivals.mjs && node scripts/verify-festive.mjs`
Expected: both print `RESULT: PASS` (exit 0).

- [ ] **Step 6: Do NOT commit yet (atomic with Task 3)**

Removing `festiveActive` breaks `festiveLayer.js` and `main.js` until Task 3 repoints them, so committing `festive.js` alone would leave a non-building commit. Leave the changes staged-but-uncommitted and go straight to Task 3, which commits `festive.js` + the repoints **together** in one building commit.

---

### Task 3: Repoint the call sites (carol → yuletide, snow → wintry)

`festiveActive` is now gone; three files import it. This task repoints them in one commit so the build is never broken. The carol moves to `yuletide` (the fix); everything else is a no-op rename to `wintry`.

**Files:**
- Modify: `src/main.js:33` (import), `:3305` (snowball scoop → wintry), `:4169` (carol → yuletide)
- Modify: `src/festiveLayer.js:4` (import), `:51` and `:68` (`festiveActive` → `wintry`)

- [ ] **Step 1: Repoint `festiveLayer.js` (no behaviour change)**

Line 4, change the import:

```js
import { wintry, deepSnow } from './festive.js';
```

Line 51, in the rebuild `key`, replace `festiveActive(season)` with `wintry(season)`:

```js
    const key = (wintry(season) ? 'F' : '') + (deepSnow(snowAccum) ? 'D' : '') +
```

Line 68, the build early-return, replace `festiveActive(season)` with `wintry(season)`:

```js
    if (!wintry(season)) return;
```

(Dressing stays on the broad winter gate this slice; Slice 2 separates dressing from snowmen and narrows dressing to `yuletide`.)

- [ ] **Step 2: Repoint `main.js`**

Line 33, change the import:

```js
import { deepSnow, wintry, yuletide } from './festive.js';
```

Line ~3305, the snowball scoop — replace `festiveActive(this.season)` with `wintry(this.season)`:

```js
      if (!sm && (!_fh || !isPlaceable(_fh.id)) && deepSnow(this.snowAccum) && wintry(this.season)) {
```

Line ~4169, the carol gate — replace `festiveActive(this.season)` with `yuletide(this.season)` (**the fix**):

```js
      const festVol = yuletide(this.season)
        ? Math.max(0, 1 - nearestVillageDist / 60) * 0.55
        : 0;
```

- [ ] **Step 3: Verify no reference to `festiveActive` remains**

Run: `grep -rn "festiveActive" src/ scripts/`
Expected: no output (all call sites repointed; the symbol is fully retired).

- [ ] **Step 4: Run the full headless suite**

Run: `npm run verify`
Expected: every script prints `RESULT: PASS`; the run exits 0. (Confirms `festivals` + `festive` pass and nothing else regressed.)

- [ ] **Step 5: Commit (atomic — Task 2 split + Task 3 repoints in one building commit)**

```bash
git add src/festive.js src/festiveLayer.js src/main.js scripts/verify-festivals.mjs scripts/verify-festive.mjs
git commit -m "feat(festivals): split winter flag; carol->yuletide, snow->wintry

Replaces festiveActive with wintry (broad cold season; snow play) and
yuletide (narrow Christmastide; carol). Fixes the carol playing in
autumn: at phase 0.70 the world is wintry but no longer yuletide, so the
carol is silent until midwinter. Dressing-narrowing is deferred to Slice
2 (it shares the snowmen early-return).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Live smoke-check (the bug is actually fixed)

Confirm in the running game that the carol is silent in autumn and the calendar reads correctly. The preview screenshot tool has been flaky this session, but `preview_eval` works — use it.

**Files:** none (verification only).

- [ ] **Step 1: Ensure the dev server is running**

Use `preview_start` with config `moorcraft-dev` (port 5173) if not already up. Navigate to `/` (the game), not the prototypes.

- [ ] **Step 2: Assert the calendar + gates via the game's modules**

Run via `preview_eval` (the game exposes `moorstead`/`window.game`; import the pure modules directly):

```js
(async () => {
  const { festivalState } = await import('/src/festivals.js');
  const { wintry, yuletide } = await import('/src/festive.js');
  const { seasonStateAtPhase } = await import('/src/season.js');
  const autumn = seasonStateAtPhase(0.70), midwinter = seasonStateAtPhase(0.882);
  return {
    autumn_yule: festivalState(0.70).yule,          // expect 0
    autumn_wintry: wintry(autumn),                  // expect true
    autumn_yuletide: yuletide(autumn),              // expect false  <- the fix
    midwinter_yuletide: yuletide(midwinter),        // expect true
    midwinter_active: festivalState(0.882).active,  // expect "yule"
  };
})()
```
Expected: `{ autumn_yule: 0, autumn_wintry: true, autumn_yuletide: false, midwinter_yuletide: true, midwinter_active: "yule" }`.

- [ ] **Step 3: Confirm no console errors on boot**

Use `preview_console_logs` (level `error`). Expected: no errors from `festivals.js`/`festive.js`/`main.js`/`festiveLayer.js`.

- [ ] **Step 4: (Optional) drive the season to autumn and confirm the carol is silent**

If a season debug lever exists (`moorstead.debug` / a season override), set the world to mid-autumn (phase ~0.70) near a village and confirm `game.festiveMusic` is stopped / volume 0. Otherwise rely on Step 2's gate assertion. Do not block the task on this if no lever exists — note it and move on.

- [ ] **Step 5: Final commit (if any verification tweaks were needed)**

Only if Steps 1–4 surfaced a fix. Otherwise nothing to commit — Slice 1 is complete.

---

## Self-review notes (done while writing)

- **Spec coverage:** Implements spec Plan 1 (`festivals.js`, `festive.js` split, retarget carol→`yuletide`/snow→`wintry`, `verify-festivals.mjs`). Dressing-narrowing is explicitly deferred to Slice 2 (it is entangled with the snowmen early-return); flagged in the architecture note so it isn't lost.
- **Type consistency:** `festivalState(phase)` returns `{<id>:number, active:string|null, intensity:number}`; `wintry(season)`/`yuletide(season)` take the `season` object (use `season.frost` and `season.yearPhase` respectively). `windowIntensity(phase, centre, days)`. Names match across Tasks 1–3.
- **No placeholders:** every code + command step is concrete. Line numbers (`main.js:3305/4169`) are from the spec's references and may drift by a few lines — match on the quoted code, not the number.
