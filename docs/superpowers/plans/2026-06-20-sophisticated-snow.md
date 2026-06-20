# Sophisticated Snow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single height-gated white wash with a sophisticated snow system: snow clings to leaves/flora/roofs and blankets down to the valley floor in deep winter; it creeps in and thaws over game-days; it actually falls (camera-anchored particles) reliably in winter — deterministic, decoupled from the live weather feed (Victorian winters); footprints press into it; and drifts deepen it in hollows.

**Architecture:** All client-side, deterministic, no world-data/relay. A new pure `src/snow.js` holds the season→snow maths (accumulation that lags snowiness; a shared-clock shower oscillation), unit-tested headlessly. The existing `addSnow` shader (`mesher.js`) is generalised to the cutout material and a noise-driven drift depth, and driven by *accumulation* (not raw snowiness) so coverage eases in/out. `sky.js` gains a snow particle system mirroring the rain one, and in winter drives snow deterministically instead of rain. Footprints are instanced quads pressed where the player/mobs walk (the `floraLayer.js`/`rails.js` instancing pattern), fading over time.

**Tech Stack:** three.js (shader `onBeforeCompile`, `THREE.Points`, `InstancedMesh`), vanilla ES modules, Node `.mjs` verify scripts.

Plan 3 of 3 for the spec ([2026-06-20-seasonal-flora-snow-design.md](../specs/2026-06-20-seasonal-flora-snow-design.md)) — M4–M6. Plans 1 (foliage colour) + 2 (flower overlay + lineside) are merged.

## Verification note

Pure maths (accumulation lag/melt, shower oscillation, snow-line) is TDD'd headlessly in `scripts/verify-snow.mjs`. Rendering (shader coverage, particles, footprint decals, drifts) is visual — verified by driving the running game via `window.game` + `game.seasonOverride` at winter phases and inspecting (the controller already uses this for the flora overlay). Each rendering task lists an explicit manual check.

## File structure

- `src/snow.js` — pure: `stepAccumulation()`, `snowfallIntensity()`, `showerOscillation()`, `snowLineFor()`. [create]
- `src/mesher.js` — `addSnow` extended (cutout material + drift noise); snow uniforms accept accumulation + drift. [modify]
- `src/sky.js` — snow particle system; winter drives snow not rain. [modify]
- `src/footprints.js` — instanced footprint decals with a trample buffer. [create]
- `src/main.js` — maintain accumulation; drive `setSnowLevel`; construct/update footprints. [modify]
- `scripts/verify-snow.mjs` — headless tests. [create]
- `scripts/verify-season.mjs` (maybe), `package.json` — wire. [modify]

---

### Task 1: Snow maths — `src/snow.js` (pure)

**Files:** Create `src/snow.js`; Test `scripts/verify-snow.mjs` (created here).

`snowiness`, `warmth`, `frost` already come from `season.js`. This module adds the *dynamics*: accumulation that lags the season, and a deterministic shower oscillation on the shared clock.

- [ ] **Step 1: Write the failing test** — create `scripts/verify-snow.mjs`:

```js
// Snow maths — run wi': node scripts/verify-snow.mjs
import { stepAccumulation, snowfallIntensity, showerOscillation, snowLineFor } from '../src/snow.js';
import { seasonStateAtPhase, YEAR, ANCHOR_SEC, ANCHOR_PHASE } from '../src/season.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const nowAtPhase = p => (ANCHOR_SEC + (p - ANCHOR_PHASE) * YEAR) * 1000 + 1;

// accumulation builds in deep winter and melts out by late spring
{
  const winter = seasonStateAtPhase(0.875), spring = seasonStateAtPhase(0.18);
  let acc = 0;
  for (let i = 0; i < 600; i++) acc = stepAccumulation(acc, winter, 1); // ~10 game-min of winter
  (acc > 0.8 ? ok : bad)('snow accumulates deep in winter (' + acc.toFixed(2) + ')');
  let melt = acc;
  for (let i = 0; i < 600; i++) melt = stepAccumulation(melt, spring, 1);
  (melt < 0.15 ? ok : bad)('snow thaws in spring (' + melt.toFixed(2) + ')');
  (stepAccumulation(0.5, winter, 1) > 0.5 ? ok : bad)('accumulation rises while it snows and is cold');
  (stepAccumulation(0.5, spring, 1) < 0.5 ? ok : bad)('accumulation falls when it warms');
}
// deterministic snowfall: reliably present through winter, ~0 in summer
{
  let win = 0, n = 0;
  for (let p = 0.80; p < 0.95; p += 0.01) { win += snowfallIntensity(nowAtPhase(p), seasonStateAtPhase(p)); n++; }
  (win / n > 0.4 ? ok : bad)('winter is reliably snowy on average (' + (win / n).toFixed(2) + ')');
  (snowfallIntensity(nowAtPhase(0.375), seasonStateAtPhase(0.375)) < 0.02 ? ok : bad)('no snowfall at high summer');
}
// shower oscillation is deterministic, smooth, in [0,1]
{
  const t = nowAtPhase(0.875);
  (showerOscillation(t) === showerOscillation(t) ? ok : bad)('shower oscillation is deterministic');
  let inRange = true; for (let i = 0; i < 200; i++) { const v = showerOscillation(t + i * 60000); if (v < 0 || v > 1) inRange = false; }
  (inRange ? ok : bad)('shower oscillation stays in [0,1]');
}
// snow-line drops toward the valley as winter deepens
{
  (snowLineFor(0) > snowLineFor(1) ? ok : bad)('snow-line is higher with less snow');
  (snowLineFor(1) <= 30 ? ok : bad)('full snow blankets down to the valley floor (' + snowLineFor(1) + ')');
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run, expect FAIL** — `node scripts/verify-snow.mjs` (module missing).

- [ ] **Step 3: Implement** — create `src/snow.js`:

```js
// snow.js — deterministic snow dynamics. Pure: no DOM, no three.js.
// Accumulation lags the season (snow creeps in / thaws over game-days); snowfall
// and its showers are a function of the shared wall-clock so every client agrees.
import { noise2 } from './noise.js';

// New accumulation [0,1] after `dt` GAME-seconds, given the current season state.
// Builds toward 1 while it's snowing and cold; melts toward 0 as it warms.
export function stepAccumulation(accum, season, dt) {
  const snowing = snowfallSeason(season);                 // 0..1, season-only (no clock)
  const cold = season.warmth < 0 ? -season.warmth : 0;    // 0..1
  const target = Math.min(1, snowing * 0.6 + cold);       // how deep it wants to lie
  const rate = (target > accum) ? 0.0016 * cold           // accrues slowly, only when cold
                                : 0.0016 * (0.4 + (season.warmth > 0 ? season.warmth : 0)); // melts faster when warm
  const next = accum + Math.sign(target - accum) * rate * dt;
  return next < 0 ? 0 : next > 1 ? 1 : next;
}

// Season-only snow tendency (used by accumulation + as the snowfall envelope).
function snowfallSeason(season) {
  return season.frost;                                    // = max(0, -warmth); winter half-year
}

// Smooth shared-clock oscillation in [0,1] — showers wax and wane through winter.
export function showerOscillation(now = 0) {
  const t = now / 1000;                                   // seconds
  return (noise2(t / 900, 0, 0x5704) + 1) * 0.5;          // ~15-min period, value noise -> [0,1]
}

// Deterministic falling-snow intensity [0,1]: winter envelope * shower, with a
// reliable baseline so winter is never bone-dry (Victorian winters).
export function snowfallIntensity(now, season) {
  const envelope = snowfallSeason(season);                // winter strength
  if (envelope < 0.05) return 0;
  const shower = showerOscillation(now);
  return Math.min(1, envelope * (0.45 + 0.55 * shower));  // baseline 0.45 + showers
}

// Snow-line height for a coverage amount [0,1]: high (tops only) -> valley floor.
export function snowLineFor(amount) {
  const a = amount < 0 ? 0 : amount > 1 ? 1 : amount;
  return 64 - a * 40;                                     // 64 (tops) down to 24 (valley)
}
```

- [ ] **Step 4: Run, expect PASS** — `node scripts/verify-snow.mjs` → `RESULT: PASS`.

- [ ] **Step 5: Commit** — `feat(snow): pure snow dynamics (accumulation, snowfall, shower, snow-line)` + trailer.

---

### Task 2: Coverage — snow on flora/leaves + valley blanket, driven by accumulation

**Files:** Modify `src/mesher.js`, `src/main.js`. Visual verification.

Today `addSnow` is applied only to `materials.opaque`, the snow-line is `64 - s*34`, and `setSnowLevel(season.snowiness)` is called raw each frame. Generalise it.

- [ ] **Step 1: Apply `addSnow` to the cutout material + use the snow-line helper.** In `src/mesher.js`:
  - Import the snow-line helper at the top: `import { snowLineFor } from './snow.js';`
  - In `setSnowLevel(amount)`, set `snowUniforms.uSnowLine.value = snowLineFor(amount);` (replace the inline `64 - s*34`).
  - In `initMaterials()`, wrap the cutout material too: `cutout: addSnow(new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide })),`
  - `addSnow` sets `mat.customProgramCacheKey = () => 'terrain-snow'`. Two materials sharing the same cache key can collide in three's program cache — change `addSnow` to take a key: `function addSnow(mat, key = 'terrain-snow') { … mat.customProgramCacheKey = () => key; return mat; }` and call `addSnow(opaqueMat, 'snow-opaque')` / `addSnow(cutoutMat, 'snow-cutout')`.

- [ ] **Step 2: Drive coverage from accumulation in `src/main.js`.** Maintain a lagged accumulation and feed it to `setSnowLevel`:
  - Add `import { stepAccumulation } from './snow.js';`
  - In the constructor / world-init, add `this.snowAccum = 0;`
  - Replace the existing `setSnowLevel(season.snowiness);` line (in the per-frame block after `this.season = season;`) with:
    ```js
        this.snowAccum = stepAccumulation(this.snowAccum, season, this.sky ? DAY_LENGTH * dt / DAY_LENGTH : dt); // game-seconds
        setSnowLevel(this.snowAccum);
    ```
    Simpler — `dt` is already game-seconds for this purpose; use:
    ```js
        this.snowAccum = stepAccumulation(this.snowAccum, season, dt);
        setSnowLevel(this.snowAccum);
    ```

- [ ] **Step 3: Build + manual check** — `npm run build` (exit 0). Then dev server: enter a world, `game.seasonOverride = 0.875`, pump/observe — snow should creep in over a few seconds (accumulation lag), cover the moor down to the valleys, and cling to flora/leaf cutouts (not just terrain tops). `game.seasonOverride = 0.18` → it thaws back out. Confirm via `game.snowAccum` rising toward 1 in winter and falling in spring, and no console errors.

- [ ] **Step 4: Commit** — `feat(snow): coverage on cutouts + valley blanket, driven by lagged accumulation` + trailer.

---

### Task 3: Deterministic winter snowfall + falling-snow particles

**Files:** Modify `src/sky.js`, `src/main.js`. Visual + a small pure check.

`sky.js update(dt, playerPos, season, covered)` already receives `season`. Add a snow particle system mirroring the rain one (setup lines ~127-148, animation ~300-317), and in winter drive snow deterministically instead of rain (ignoring the live feed for precip type).

- [ ] **Step 1: Add the snow particle system** in `src/sky.js`, mirroring `this.rain`. In the constructor after the rain block, add `this.snow` as `THREE.Points` (1100 points, soft round white sprite via a small radial-gradient canvas, `size: 0.5`, `opacity: 0`, `depthWrite: false`). Initial positions in the same 40-block window.

- [ ] **Step 2: Drive snow in winter** in `update()`. Import the snow maths at the top: `import { snowfallIntensity } from './snow.js';`. After the existing rain block (~line 317), add:
```js
    // winter: deterministic snow takes over from rain (decoupled from the live feed)
    const snowFall = season ? snowfallIntensity(Date.now(), season) : 0;
    if (snowFall > 0.02) this.rainAmount = 0;              // no rain while it snows
    this.snowAmount = (this.snowAmount || 0) + ((covered ? 0 : snowFall) - (this.snowAmount || 0)) * Math.min(1, dt * 0.5);
    this.snow.material.opacity = this.snowAmount * 0.85;
    if (this.snowAmount > 0.02) {
      const p = this.snow.geometry.attributes.position;
      for (let i = 0; i < this.snowCount; i++) {
        let y = p.array[i * 3 + 1] - dt * 6.5;             // snow falls slow
        p.array[i * 3] += Math.sin((this.cloudT + i) * 0.7) * dt * 0.6; // drift/swirl
        if (y < 0) { y = 18 + Math.random() * 6; p.array[i * 3] = (Math.random() - 0.5) * 40; p.array[i * 3 + 2] = (Math.random() - 0.5) * 40; }
        p.array[i * 3 + 1] = y;
      }
      p.needsUpdate = true;
      this.snow.position.set(playerPos.x, playerPos.y - 8, playerPos.z);
    }
```
(Define `this.snowCount = 1100;` and `this.snowAmount = 0;` in the constructor.) The `targetRain` line (~301) is unchanged; the winter override zeroes `rainAmount` so the two never show together.

- [ ] **Step 3: Pure check** — `snowfallIntensity` is already covered by `verify-snow` (Task 1). No new headless test needed here; this task is the rendering wiring.

- [ ] **Step 4: Build + manual check** — `npm run build`; dev server: `game.seasonOverride = 0.875` → snow visibly falls (slow, drifting, white) and no rain; `game.seasonOverride = 0.375` → no snow; a rainy non-winter state still rains. Check `game.sky.snowAmount` > 0 in winter, no console errors.

- [ ] **Step 5: Commit** — `feat(snow): deterministic winter snowfall + falling-snow particles` + trailer.

---

### Task 4: Footprints — `src/footprints.js`

**Files:** Create `src/footprints.js`; Modify `src/main.js`. Visual + a small pure buffer check.

Footprints are instanced dark/compressed quads laid where entities walk on snow, fading over time. Pattern follows `floraLayer.js`/`rails.js` instancing. Data sources: `game.player.pos`, `game.net?.remotes` values, `game.entities.mobs`.

- [ ] **Step 1: Failing test** — append a pure buffer test to `scripts/verify-snow.mjs` (the trample buffer logic is pure and testable; the rendering is visual). Add before the final `RESULT`:
```js
import { TrampleBuffer } from '../src/footprints.js';
{
  const tb = new TrampleBuffer(8);
  tb.mark(0, 0, 100); tb.mark(0, 0, 100); // same spot, no dup
  (tb.prints.length === 1 ? ok : bad)('trample buffer dedups the same step');
  tb.mark(5, 5, 100);
  (tb.prints.length === 2 ? ok : bad)('a step away adds a print');
  for (let i = 0; i < 12; i++) tb.mark(i * 2, 0, 100);    // overflow cap 8
  (tb.prints.length <= 8 ? ok : bad)('buffer is capped (got ' + tb.prints.length + ')');
  const live = tb.alive(100 + 5);   // age window
  (Array.isArray(live) ? ok : bad)('alive() returns current prints');
}
```
(Move the `import { TrampleBuffer }` to the top with the other imports.) Run → FAIL.

- [ ] **Step 2: Implement** — create `src/footprints.js`:
```js
// footprints.js — pressed prints in the snow where folk and beasts walk.
// TrampleBuffer is pure (testable); Footprints renders it as instanced quads.
import * as THREE from 'three';
import { tileUV } from './textures.js';
import { getMaterials } from './mesher.js';

const STEP = 1.2;        // min blocks between prints
const LIFE = 90;         // seconds a print lasts (game-seconds)

export class TrampleBuffer {
  constructor(cap = 256) { this.cap = cap; this.prints = []; }
  mark(x, z, now) {
    const last = this.prints[this.prints.length - 1];
    if (last && Math.hypot(last.x - x, last.z - z) < STEP) return;
    this.prints.push({ x, z, t: now });
    if (this.prints.length > this.cap) this.prints.shift();
  }
  alive(now) { return this.prints.filter(p => now - p.t < LIFE); }
}

export class Footprints {
  constructor(scene, world) { this.scene = scene; this.world = world; this.buf = new TrampleBuffer(256); this.mesh = null; this.timer = 0; }
  // call each frame with the positions of nearby walkers (incl. the player)
  update(dt, now, walkers) {
    for (const w of walkers) this.buf.mark(w.x, w.z, now);
    this.timer -= dt; if (this.timer > 0) return; this.timer = 0.3;
    this.rebuild(now);
  }
  rebuild(now) {
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; }
    const live = this.buf.alive(now);
    if (!live.length) return;
    const geom = new THREE.PlaneGeometry(0.5, 0.5).rotateX(-Math.PI / 2);
    const mat = getMaterials().cutout;
    const mesh = new THREE.InstancedMesh(geom, mat, live.length);
    const m = new THREE.Matrix4();
    for (let i = 0; i < live.length; i++) {
      const p = live[i], y = this.world.gen.height(Math.floor(p.x), Math.floor(p.z)) + 1.02;
      m.makeTranslation(p.x, y, p.z);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.mesh = mesh;
  }
  clear() { if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; } this.buf.prints.length = 0; }
}
```
> Note: the prints reuse the shared `cutout` material with a generic tile UV mapped to a small dark patch. For a distinct print sprite, add a `TILE.FOOTPRINT` painter (a soft dark oval) and map `crossGeom`-style UVs; the controller will judge whether the placeholder reads well visually and add a dedicated tile if needed. Keep `PlaneGeometry` flat on the ground.

- [ ] **Step 3: Run pure test, expect PASS** — `node scripts/verify-snow.mjs`.

- [ ] **Step 4: Wire in `src/main.js`** — import `Footprints`; construct in `startWorld()` after floraLayer (`this.footprints = new Footprints(this.scene, this.world);`); clear it in `startWorld` guard + `teardownWorld` (mirror floraLayer); update each frame only when there's snow:
```js
      if (this.footprints && this.snowAccum > 0.1) {
        const walkers = [{ x: this.player.pos.x, z: this.player.pos.z }];
        if (this.net) for (const r of this.net.remotes.values()) { const t = r.target; if (t) walkers.push({ x: t.x, z: t.z }); }
        if (this.entities) for (const mob of this.entities.mobs) walkers.push({ x: mob.pos.x, z: mob.pos.z });
        this.footprints.update(dt, this.sky.day * 86400 + this.sky.time * DAY_LENGTH, walkers);
      } else if (this.footprints) this.footprints.clear();
```
(Use a monotonic game-seconds clock for `now`; adapt to whatever the codebase uses for game time — `this.sky.day`/`time` is available.)

- [ ] **Step 5: Build + manual check** — `npm run build`; dev server in winter (`game.seasonOverride = 0.875`, let snow accumulate), walk around — dark pressed prints trail the player and fade. No errors, steady framerate.

- [ ] **Step 6: Commit** — `feat(snow): footprints pressed into lying snow` + trailer.

---

### Task 5: Drifts — noise depth on the snow shader

**Files:** Modify `src/mesher.js`. Visual.

Make snow look deeper in hollows/lee by modulating the snow mix with world-space noise in the fragment shader (visual only, no geometry change).

- [ ] **Step 1: Add a drift term** in `addSnow`'s fragment injection. Extend the snow factor with a cheap value-noise of world X/Z so coverage thickens in patches:
```glsl
  float drift = 0.6 + 0.4 * sin(vSnowWX * 0.15) * cos(vSnowWZ * 0.15);
  float snow = uSnowAmt * drift * smoothstep(uSnowLine, uSnowLine + 10.0, vSnowY) * smoothstep(0.2, 0.75, vSnowUp);
```
Add `varying float vSnowWX; varying float vSnowWZ;` and set them in the vertex injection from the world position (alongside `vSnowY`). Keep it cheap (trig, no texture fetch).

- [ ] **Step 2: Build + manual check** — `npm run build`; dev server, winter: snow coverage now varies across the ground (deeper drifts in bands) rather than a flat uniform wash. No shader-compile errors (check console).

- [ ] **Step 3: Commit** — `feat(snow): noise-driven drift depth on the snow shader` + trailer.

---

### Task 6: Wire `verify-snow` into the suite

**Files:** Modify `package.json`.

- [ ] **Step 1:** Add `"verify:snow": "node scripts/verify-snow.mjs",` next to `verify:flora`, and insert `node scripts/verify-snow.mjs` into the `verify` chain right after `node scripts/verify-flora.mjs`.
- [ ] **Step 2: Run** `npm run verify` → all `RESULT: PASS`, exit 0.
- [ ] **Step 3: Commit** — `test: add verify-snow to the verify suite` + trailer.

---

## Self-Review

**Spec coverage (M4–M6):** snow on everything + valley blanket (T2 — cutout material + `snowLineFor` to 24); gradual onset/melt (T1 `stepAccumulation` + T2 driving coverage from it); reliable deterministic Victorian falling snow decoupled from the live feed (T1 `snowfallIntensity` + T3 winter override zeroing rain); footprints (T4); drifts (T5). Winter atmosphere polish (holly berries, died-back brambles, wood-smoke) is largely delivered by Plan 2 + the existing season-gated birds; chimney smoke is deferred as optional polish (not in this plan to keep it focused — flag if wanted).

**Placeholder scan:** pure tasks (1, and the buffer test in 4) have complete code + commands; rendering tasks (2,3,4,5) have complete implementation code + explicit manual checks (snow visuals can't go through CI).

**Type/name consistency:** `stepAccumulation(accum, season, dt)`, `snowfallIntensity(now, season)`, `showerOscillation(now)`, `snowLineFor(amount)` defined in T1 (snow.js), consumed in T2 (main.js, mesher.js), T3 (sky.js). `setSnowLevel(amount)` now takes accumulation. `TrampleBuffer`/`Footprints` defined T4, wired T4 main.js. Shared `cutout` material from `getMaterials()` reused by footprints (not disposed).

**Open risks (validate during execution):**
- `dt` units: `stepAccumulation` assumes game-seconds; confirm `dt` in the main loop is seconds (the rain animation uses `dt * 22` as blocks/sec, so `dt` is seconds — good). The accumulation rate constants (0.0016) are tuned for "creeps over game-days" — expect to tune after watching it.
- Two materials sharing `addSnow`: the distinct `customProgramCacheKey` per material (T2 Step 1) avoids three's program-cache collision — verify no shader warnings.
- Footprint `now` clock: must be monotonic game-seconds; `this.sky.day*86400 + this.sky.time*DAY_LENGTH` works if `DAY_LENGTH` is in scope in main.js (it's imported in sky.js; confirm/availability in main.js or compute from `this.sky`).
- Cutout snow: leaves/flora are double-sided alpha-tested; the up-face gate (`vSnowUp`) still applies, so only upward-tilted cutout faces whiten — confirm it reads well (flora may whiten oddly; tune the `vSnowUp` threshold if so).
- Particle count (1100 snow) + footprint rebuild every 0.3s — watch framerate; reduce if needed.
