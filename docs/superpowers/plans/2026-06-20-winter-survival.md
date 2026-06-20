# Winter Survival Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make winter a survival challenge — a temperature gauge that drops outdoors in the cold, warmed by fire/shelter/a coat/hot food; cold that slows then freezes you and burns hunger faster; and scarce winter food so you must cook and stockpile.

**Architecture:** A pure `temperature.js` (target + step + hot-food set) is unit-tested headlessly; `main.js` gathers the environment factors and drives `player.temperature`; `player.js` holds the stat and applies the consequences; `ui.js` adds a temperature pip-row and a frost vignette. Winter food scarcity tunes existing spawn weights (`entities.js`) and gates fishing (`main.js`). Per-player, client-side; no relay.

**Tech Stack:** vanilla ES modules, three/DOM HUD, Node `.mjs` verify scripts.

Plan B of 2 for the winter spec ([2026-06-20-winter-weather-survival-design.md](../specs/2026-06-20-winter-weather-survival-design.md)) — M3–M6. Plan A (weather + ice) is merged. Season already reaches the player (`player.update(dt, input, audio, season)`) from Plan A.

## Verification note

The temperature model + hot-food set are TDD'd headlessly (`verify-survival.mjs`). The HUD gauge, frost vignette, cold consequences, coat, and spawn/fishing scarcity are gameplay/visual — verified via the running-game drive (`window.game`, `game.seasonOverride`, set `player.temperature`/`hunger`, `frame()`) + console-error checks. Each such task lists a manual check.

## File structure

- `src/temperature.js` — pure: `temperatureTarget(season, env)`, `stepTemperature(temp, target, dt)`, `HOT_FOODS`. [create]
- `src/player.js` — `temperature` stat + cold consequences (hunger×, no-regen, slow, freeze) + hot-food warmth on eat + coat detection. [modify]
- `src/main.js` — gather env factors + step temperature each frame. [modify]
- `src/ui.js` — temperature pip-row + frost vignette. [modify]
- `src/defs.js` — `I.WOOL_COAT` item + recipe; (uses existing `FOODS`). [modify]
- `src/textures.js` — coat item icon. [modify]
- `src/entities.js` — stronger winter spawn down-weighting. [modify]
- `scripts/verify-survival.mjs` — headless tests. [create]
- `package.json` — wire `verify:survival`. [modify]

---

### Task 1: Temperature model — `src/temperature.js` (pure)

**Files:** Create `src/temperature.js`; Create `scripts/verify-survival.mjs`.

- [ ] **Step 1: Write the failing test** — create `scripts/verify-survival.mjs`:

```js
// Winter survival model — run wi': node scripts/verify-survival.mjs
import { temperatureTarget, stepTemperature, HOT_FOODS } from '../src/temperature.js';
import { seasonStateAtPhase } from '../src/season.js';
import { I } from '../src/defs.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const winter = seasonStateAtPhase(0.875), summer = seasonStateAtPhase(0.375);
const env = (o = {}) => ({ covered: false, nearFire: false, night: false, altitude01: 0, wetness: 0, coat: false, ...o });

// summer is always warm; winter outdoors is cold
{
  (temperatureTarget(summer, env()) === 20 ? ok : bad)('summer target is fully warm');
  (temperatureTarget(winter, env()) < 8 ? ok : bad)('winter outdoors is cold (' + temperatureTarget(winter, env()).toFixed(1) + ')');
}
// warming factors raise the target; cold factors lower it
{
  const out = temperatureTarget(winter, env());
  (temperatureTarget(winter, env({ nearFire: true })) === 20 ? ok : bad)('a fire keeps you warm');
  (temperatureTarget(winter, env({ covered: true })) > out ? ok : bad)('shelter is warmer than open');
  (temperatureTarget(winter, env({ coat: true })) > out ? ok : bad)('a coat is warmer');
  (temperatureTarget(winter, env({ night: true })) < out ? ok : bad)('night is colder');
  (temperatureTarget(winter, env({ wetness: 1 })) < out ? ok : bad)('wet is colder');
  (temperatureTarget(winter, env({ altitude01: 1 })) < out ? ok : bad)('the high tops are colder');
}
// stepping eases toward target, warming faster than chilling, clamped [0,20]
{
  (stepTemperature(10, 20, 1) > 10 && stepTemperature(10, 0, 1) < 10 ? ok : bad)('temperature eases toward target');
  const warmStep = stepTemperature(10, 20, 1) - 10, chillStep = 10 - stepTemperature(10, 0, 1);
  (warmStep > chillStep ? ok : bad)('warms faster than it chills');
  (stepTemperature(19.9, 20, 100) <= 20 && stepTemperature(0.1, 0, 100) >= 0 ? ok : bad)('clamped to [0,20]');
}
// hot (cooked) foods warm you; raw foods don't
{
  (HOT_FOODS.has(I.COOKED_MUTTON) && HOT_FOODS.has(I.FISH_CHIPS) ? ok : bad)('cooked foods are hot');
  (!HOT_FOODS.has(I.BILBERRIES) && !HOT_FOODS.has(I.RAW_MUTTON) ? ok : bad)('raw/cold foods are not hot');
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run, expect FAIL** — `node scripts/verify-survival.mjs` (module missing).

- [ ] **Step 3: Implement** — create `src/temperature.js`:

```js
// temperature.js — pure winter-cold model. No DOM, no three.js.
import { I } from './defs.js';

// Cooked/hot foods give a warmth burst when eaten.
export const HOT_FOODS = new Set([
  I.COOKED_MUTTON, I.COOKED_GROUSE, I.COOKED_BEEF, I.COOKED_PORK, I.COOKED_FISH, I.FISH_CHIPS,
]);

// The temperature [0..20] the player is drifting toward, given the season + environment.
// env: { covered, nearFire, night, altitude01 (0 valley..1 tops), wetness (0..1), coat (bool) }
export function temperatureTarget(season, env) {
  const wintry = season && season.warmth < 0;
  if (!wintry) return 20;
  if (env.nearFire) return 20;                       // a fire keeps you warm
  const chill = -season.warmth;                      // 0..1, deeper in winter
  let base = chill * 22;
  if (env.covered) base *= 0.35;                     // shelter
  if (env.night) base *= 1.35;
  base *= (1 + 0.4 * (env.altitude01 || 0));         // colder on the high moor
  base *= (1 + 0.6 * (env.wetness || 0));            // wet = colder
  if (env.coat) base *= 0.5;                         // a wool coat halves the chill
  return Math.max(0, Math.min(20, 20 - base));
}

// Ease temperature toward target by `dt` seconds; warms faster than it chills.
export function stepTemperature(temp, target, dt) {
  const rate = target > temp ? 0.5 : 0.25;           // per second (exponential approach)
  const next = temp + (target - temp) * Math.min(1, rate * dt);
  return next < 0 ? 0 : next > 20 ? 20 : next;
}
```

- [ ] **Step 4: Run, expect PASS** — `node scripts/verify-survival.mjs` → `RESULT: PASS`.

- [ ] **Step 5: Commit** — `git add src/temperature.js scripts/verify-survival.mjs && git commit -m "feat(survival): pure winter temperature model"` + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.

---

### Task 2: Temperature stat, drive, and HUD gauge

**Files:** Modify `src/player.js`, `src/main.js`, `src/ui.js`. Visual.

- [ ] **Step 1: Stat** — in `src/player.js` constructor, near `this.hunger = 20;`, add `this.temperature = 20;`. Add to its serialize/deserialize if hunger is serialized there (mirror hunger).

- [ ] **Step 2: Drive it from `main.js`** — where `season` is computed and the player updated, gather env factors and step the temperature. The existing per-frame code already computes `covered` (roof scan) and `nearLight`/fire and `this.sky.isNight()`. Add (after `covered` is known and `this.season` set):

```js
      // winter cold: temperature eases toward the environment's target
      {
        const pl = this.player, pp = pl.pos;
        const altitude01 = Math.max(0, Math.min(1, (pp.y - 26) / 34));     // valley(26)..tops(60)
        const nearFire = this.world.nearLight(pp.x, pp.z, 4);
        const coat = pl.slots.some(s => s && s.id === I.WOOL_COAT);
        const target = temperatureTarget(this.season, { covered, nearFire, night: this.sky.isNight(), altitude01, wetness: pl.wetness, coat });
        pl.temperature = stepTemperature(pl.temperature, target, dt);
      }
```
Import `temperatureTarget, stepTemperature` from `./temperature.js` and ensure `I` is imported. (Use the actual local name for the covered flag / player as they appear in the file.)

- [ ] **Step 3: HUD gauge** — in `src/ui.js`, mirror the hunger pip-row. In construction (by the hearts/hunger pips), add a `this.tempEl` row of 10 `<img>` pips with a warm icon (amber thermometer) full and an icy-blue empty. In `updateHUD(player, sky)`, add:
```js
  for (let i = 0; i < 10; i++) {
    const tv = player.temperature - i * 2;
    this.tempImgs[i].src = tv >= 2 ? this.tempFull : tv >= 1 ? this.tempHalf : this.tempEmpty;
  }
  const showTemp = !player.creative && ((player.temperature < 20) || (this.game && this.game.season && this.game.season.warmth < 0));
  this.tempEl.style.visibility = showTemp ? 'visible' : 'hidden';
```
(Reuse the existing pip image helper `pixURL(PIX.?, color)`; pick a thermometer/snowflake glyph from PIX or a simple coloured pip. Place the row under the hunger row.)

- [ ] **Step 4: Build + manual check** — `npm run build`; dev server, `game.seasonOverride = 0.875`, walk outdoors: the temperature row drains; stand by a fire / go indoors / `game.player.slots[0]={id:I.WOOL_COAT,n:1}`: it recovers. No console errors.

- [ ] **Step 5: Commit** — `git add src/player.js src/main.js src/ui.js && git commit -m "feat(survival): temperature stat, environment drive, HUD gauge"` + trailer.

---

### Task 3: Cold consequences + frost vignette

**Files:** Modify `src/player.js`, `src/ui.js`. Visual.

- [ ] **Step 1: Consequences in `player.js`** — in the survival `update` (where hunger drains and regen happens), key off `this.temperature`:
  - **Chilly (`temperature < 12`):** multiply the hunger-drain (exhaustion) accrual by ~1.6, and block regen (add `&& this.temperature >= 12` to the regen condition alongside the existing `hunger>=16 && wetness<0.6`).
  - **Cold (`temperature < 6`):** reduce movement — where `speed` is finalised, add `if (this.temperature < 6) speed *= 0.75;`.
  - **Freezing (`temperature <= 0`):** mirror the starvation damage — accumulate a `this._freezeT` timer and `this.damage(1, 'frozen')` every 4 s while `temperature <= 0`.

Concretely, near the starvation block add:
```js
    if (this.temperature <= 0) {
      this._freezeT = (this._freezeT || 0) + dt;
      if (this._freezeT >= 4) { this._freezeT = 0; this.damage(1, 'froze to death on t’ moor'); }
    } else this._freezeT = 0;
```
and gate regen + scale hunger drain as above.

- [ ] **Step 2: Frost vignette in `ui.js`** — there's an existing damage (`hurtFlash`) red vignette. Add a parallel cold vignette: when `player.temperature < 6`, draw a blue-white edge vignette with intensity `(6 - temperature) / 6`. Mirror the hurtFlash draw (same overlay element/canvas, blue tint), updated in `updateHUD`/the render overlay.

- [ ] **Step 3: Build + manual check** — `npm run build`; dev server, `game.seasonOverride=0.875`; set `game.player.temperature = 5` → screen frosts + you move slower; `game.player.temperature = 0` → you take freezing damage over time (watch hearts drop); warm up → it stops. Hunger drains faster while chilly. No console errors.

- [ ] **Step 4: Commit** — `git add src/player.js src/ui.js && git commit -m "feat(survival): cold slows then freezes; faster hunger; frost vignette"` + trailer.

---

### Task 4: Wool coat + hot food

**Files:** Modify `src/defs.js`, `src/textures.js`, `src/player.js`. Visual + the model already knows `HOT_FOODS`/`coat`.

- [ ] **Step 1: Coat item + recipe** — in `src/defs.js`, add `WOOL_COAT: <next free I id>,` to `I` (read the enum for the next free integer after the current max, e.g. 108). Add it to `ITEM_NAMES`. Add a crafting recipe following the existing RECIPES pattern (read defs.js to find it) — e.g. **3× `B.WOOL` → 1× `I.WOOL_COAT`** at the joiner's bench (or wherever wool recipes live). If recipes are shaped/shapeless, match the existing convention.

- [ ] **Step 2: Coat icon** — in `src/textures.js`, add an item-icon painter for `I.WOOL_COAT` (a simple cream/grey coat shape), following the existing item-icon style.

- [ ] **Step 3: Hot-food warmth on eat** — in `src/player.js` `eat(...)`, after restoring hunger, if the eaten item is a hot food add a warmth burst:
```js
    if (HOT_FOODS.has(s.id)) this.temperature = Math.min(20, this.temperature + 6);
```
Import `HOT_FOODS` from `./temperature.js`. (Coat warmth is already handled — `main.js` Task 2 reads `slots.some(... I.WOOL_COAT)` into the `coat` factor.)

- [ ] **Step 4: Build + manual check** — `npm run build`; dev server: craft the coat from wool (or `game.player.slots[0]={id:I.WOOL_COAT,n:1}`), confirm in winter it halves the chill (temperature target higher); eat a cooked food and watch temperature jump +6. No console errors.

- [ ] **Step 5: Commit** — `git add src/defs.js src/textures.js src/player.js && git commit -m "feat(survival): wool coat (carry to keep warm) + hot-food warmth"` + trailer.

---

### Task 5: Winter food scarcity

**Files:** Modify `src/entities.js`, `src/main.js`.

- [ ] **Step 1: Fewer grazers/grouse in winter** — in `src/entities.js`, the spawn code already down-weights in winter (`season.warmth < 0` skip chance) and weights types by `greenness`. Strengthen it so meat is genuinely scarce in deep winter: raise the winter skip chance (e.g. `Math.random() < (-season.warmth) * 0.55`) and cut the grazer weights (sheep/cow/pig/grouse) when `season.warmth < 0`. Keep crows (carrion) as-is. Read the current weighting block and tune; don't remove spawning entirely.

- [ ] **Step 2: Fishing gated in winter** — in `src/main.js` `updateFishing` (the cast/catch path), if `this.season && this.season.warmth < -0.4` (becks frozen, Plan A), block casting onto frozen water with a toast ("T' beck's froze over — nowt's biting") and otherwise reduce the winter catch rate. (Foraged berries are already off in winter via the existing `bilberryInSeason`/flora-season gates — no change.)

- [ ] **Step 3: Build + manual check** — `npm run build`; `node scripts/verify-resources.mjs` (census still passes — it's seasonless gen). Dev server, winter: noticeably fewer sheep/grouse spawn; fishing on a frozen beck is blocked. (Spawn rates are feel-tuning — expect iteration.)

- [ ] **Step 4: Commit** — `git add src/entities.js src/main.js && git commit -m "feat(survival): winter food scarcity (fewer grazers, fishing gated)"` + trailer.

---

### Task 6: Wire `verify-survival` into the suite

**Files:** Modify `package.json`.

- [ ] **Step 1:** Add `"verify:survival": "node scripts/verify-survival.mjs",` next to `verify:winter`, and insert `node scripts/verify-survival.mjs` into the `verify` chain right after `node scripts/verify-winter.mjs`.
- [ ] **Step 2: Run** `npm run verify` → all `RESULT: PASS`, exit 0.
- [ ] **Step 3: Commit** — `git add package.json && git commit -m "test: add verify-survival to the verify suite"` + trailer.

---

## Self-Review

**Spec coverage (M3–M6):** temperature gauge + dynamics (T1 model, T2 stat/drive/HUD); cold slow→freeze + faster hunger + frost vignette (T3); coat + hot food (T4); food scarcity — fewer grazers + fishing gate, berries already off (T5); verify wired (T6). Pure model TDD'd.

**Placeholder scan:** pure task (T1) has complete code + commands; gameplay/visual tasks (T2–T5) give complete code for the logic and explicit manual checks for HUD/vignette/feel/spawns (can't go through CI). The few "read the file for the exact anchor/next-free-id" notes are necessary lookups, not placeholders — the code to write is fully specified.

**Type/name consistency:** `temperatureTarget(season, env)`, `stepTemperature(temp, target, dt)`, `HOT_FOODS` defined in T1 and consumed in T2 (main.js drive), T4 (eat). `player.temperature` set in T2, read in T3 (consequences) + ui.js (HUD/vignette). `I.WOOL_COAT` defined T4, read in T2's `coat` factor + T4 eat — note T2 references `I.WOOL_COAT` before T4 defines it, so **either define `I.WOOL_COAT` in T2 or execute T4's defs.js edit alongside T2's main.js coat line**; simplest is to add the `I.WOOL_COAT` enum entry in T2 (the recipe/icon stay in T4). (Adjust during execution: add the enum id in T2.)

**Open risks (validate during execution):**
- **`I.WOOL_COAT` ordering:** add the enum id in Task 2 (so the `coat` factor compiles) even though the recipe/icon land in Task 4 — noted above.
- **Recipe system shape:** the coat recipe must match the existing RECIPES convention (shaped vs shapeless, where wool recipes live) — read defs.js before adding.
- **HUD pip art:** reuse the existing `pixURL`/`PIX` glyphs; if no thermometer glyph exists, a coloured pip (amber→blue) is fine for v1.
- **Balancing:** chill rate (0.25/s), thresholds (12/6/0), hunger ×1.6, freeze 1HP/4s, spawn reductions, coat halving — all feel-tuning; expect a pass after playing a winter.
- **`covered`/`nearLight`/`isNight` locals:** use the actual names/availability at the main.js insertion point (the recon confirms all three exist in that block).
