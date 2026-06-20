# Winter Weather & Ice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make winter weather real — snow driven by the live moor forecast, the sky overcast only while it's actually snowing, snow that covers exterior surfaces but never interior floors, and frozen walkable/slippery becks and bogs.

**Architecture:** All client-side and deterministic. The rain→snow split + overcast are pure helpers consumed by `sky.js`. A per-column skylight pass in the mesher bakes a per-vertex `aSnowExp` flag the snow shader gates on (no interior snow). Becks/bogs get a per-vertex `aFreeze` flag (inland water + bog = 1, open sea = 0) and the liquid material ices over via a `frozen` uniform in deep winter; the player walks on and slides across frozen surfaces via a post-physics floor-clamp + low ground friction.

**Tech Stack:** three.js (`onBeforeCompile` shader injection, `Float32BufferAttribute`), vanilla ES modules, Node `.mjs` verify scripts.

Plan A of 2 for the winter spec ([2026-06-20-winter-weather-survival-design.md](../specs/2026-06-20-winter-weather-survival-design.md)) — covers M1, M2, M7 (the winter *environment*). Plan B = winter *survival* (M3–M6). Snow particles/coverage/accumulation already exist from the sophisticated-snow work.

## Verification note

Pure helpers (precip split, overcast grey, skylight exposure, frozen/freezable predicates) are TDD'd headlessly. Shader coverage, ice rendering, and the walk/slide physics are visual/interactive — verified by driving the live game (`window.game`, `game.seasonOverride`, `frame()`) and checking console errors, as established for the flora/snow work. Each visual task lists a manual check.

## File structure

- `src/snow.js` — + pure `winterPrecip()` and `overcastGrey()` helpers; + `freezableWater()`/`isFrozen()` predicates. [modify]
- `src/sky.js` — consume the precip split + overcast helper. [modify]
- `src/mesher.js` — `GeoBuilder` gains `aSnowExp` + `aFreeze` attributes; per-column skylight pass; snow shader gates on `aSnowExp`; liquid material ices via a `frozen` uniform + `aFreeze`. [modify]
- `src/defs.js` — + `TILE.ICE`. [modify]
- `src/textures.js` — + ice tile painter. [modify]
- `src/player.js` — frozen surfaces are walkable + slippery. [modify]
- `scripts/verify-winter.mjs` — headless tests for the pure helpers. [create]
- `package.json` — wire `verify:winter`. [modify]

---

### Task 1: Live-weather winter snow + overcast — pure helpers

**Files:** Modify `src/snow.js`; Create `scripts/verify-winter.mjs`.

- [ ] **Step 1: Write the failing test** — create `scripts/verify-winter.mjs`:

```js
// Winter weather/ice helpers — run wi': node scripts/verify-winter.mjs
import { winterPrecip, overcastGrey } from '../src/snow.js';
import { seasonStateAtPhase } from '../src/season.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// winter precipitation falls as snow, not rain; summer rain stays rain
{
  const winter = seasonStateAtPhase(0.875), summer = seasonStateAtPhase(0.375);
  const w = winterPrecip(winter, 0.8, 0);     // live precip 0.8 in winter
  (w.snow > 0.5 && w.rain === 0 ? ok : bad)('winter precip falls as snow, no rain (snow ' + w.snow.toFixed(2) + ')');
  const s = winterPrecip(summer, 0.8, 0);     // live precip 0.8 in summer
  (s.rain > 0.5 && s.snow === 0 ? ok : bad)('summer precip stays rain');
  const clear = winterPrecip(winter, 0, 0);   // clear winter forecast
  (clear.snow === 0 && clear.rain === 0 ? ok : bad)('clear winter = no snow, no rain (sunny snow day)');
  const offline = winterPrecip(winter, null, 0.6); // no live sample -> deterministic fallback
  (offline.snow > 0.5 ? ok : bad)('offline winter falls back to the deterministic snow clock');
}
// the sky is overcast while precipitating, clear otherwise
{
  (overcastGrey('clear', 0.6, 0) > 0.3 ? ok : bad)('snowing -> overcast');
  (overcastGrey('clear', 0, 0) === 0 ? ok : bad)('clear + no precip -> sunny (grey 0)');
  (overcastGrey('rain', 0, 0.8) > 0.3 ? ok : bad)('raining -> overcast');
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run, expect FAIL** — `node scripts/verify-winter.mjs` (helpers missing).

- [ ] **Step 3: Implement** — add to `src/snow.js`:

```js
// Split precipitation into snow (winter) vs rain (otherwise). `livePrecip` is the
// live-feed amount [0,1] or null when offline; `fallback` is the deterministic
// snow-clock value used only when offline. Returns { snow, rain }.
export function winterPrecip(season, livePrecip, fallback = 0) {
  const wintry = season && season.warmth < 0;
  const precip = (livePrecip != null) ? livePrecip : (wintry ? fallback : 0);
  if (wintry) return { snow: precip, rain: 0 };
  return { snow: 0, rain: (livePrecip != null ? livePrecip : 0) };
}

// Sky greyness [0,1]: overcast while it actively snows or rains, else the
// weather-state base (so a clear winter forecast reads sunny).
export function overcastGrey(weather, snow, rain) {
  const base = { clear: 0, misty: 0.13, rain: 0.52, fog: 0.68 }[weather] || 0;
  return Math.max(base, snow * 0.6, rain * 0.5);
}
```

- [ ] **Step 4: Run, expect PASS** — `node scripts/verify-winter.mjs` → `RESULT: PASS`.

- [ ] **Step 5: Wire into `src/sky.js`** — import the helpers (`import { winterPrecip, overcastGrey, snowfallIntensity } from './snow.js';`). In `update()`, replace the existing `snowFall`/`targetRain` lines (added by the snow work) with:

```js
    const live = (this.liveRain != null) ? this.liveRain : null;
    const { snow: snowFall, rain: rainTarget } = winterPrecip(season, live, season ? snowfallIntensity(Date.now(), season) : 0);
    const targetRain = rainTarget;
```
Then change the `grey` computation (currently `{clear:0,...}[this.weather]`) to:
```js
    const grey = overcastGrey(this.weather, snowFall, this.rainAmount);
```
(Leave the rest of the rain/snow particle animation as-is — it already consumes `snowFall`/`targetRain`.)

- [ ] **Step 6: Build + manual check** — `npm run build`; dev server, `game.seasonOverride = 0.875` with a live sample present → if the moor forecast has precip, it snows + sky greys; force a clear state and the sky stays blue/sunny with lying snow. (At minimum: no console errors, `game.sky` snow behaves, sky greys when `snowFall>0`.)

- [ ] **Step 7: Commit** — `git add src/snow.js src/sky.js scripts/verify-winter.mjs && git commit -m "feat(winter): live-forecast snow + overcast-only-while-snowing"` + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.

---

### Task 2: Exterior-only snow coverage — skylight pass

**Files:** Modify `src/mesher.js`. Visual.

The mesher's `GeoBuilder` accumulates `pos/norm/uv/col`; `quad(corners, normal, uvRect, aos, light)` pushes per-vertex. Add a per-vertex `aSnowExp` (1 = sky-exposed, 0 = under cover) and gate the snow shader on it.

- [ ] **Step 1: Extend `GeoBuilder`** — in its constructor add `this.exp = [];`. Change `quad(corners, normal, uvRect, aos, light, exp = 1)` to push the exposure once per corner inside the vertex loop: `this.exp.push(exp, exp, exp, exp);` (4 vertices). In `build(material)`, after the `color` setAttribute add:
```js
    g.setAttribute('aSnowExp', new THREE.Float32BufferAttribute(this.exp, 1));
```

- [ ] **Step 2: Compute per-column skylight in `buildChunkMeshes`** — at the top of the function (after `data` is available), compute the highest opaque block per column:
```js
  const skyTop = new Int16Array(CHUNK * CHUNK).fill(-1);
  for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
    for (let y = HEIGHT - 1; y >= 0; y--) {
      if (isOpaque(data[lx + lz * CHUNK + y * CHUNK * CHUNK])) { skyTop[lx + lz * CHUNK] = y; break; }
    }
  }
  const exposedAt = (lx, y, lz) => (y >= skyTop[lx + lz * CHUNK] ? 1 : 0);
```

- [ ] **Step 3: Pass exposure on the snow-relevant quads** — for the **solid** up-face (and the **cutout** flora) pass `exposedAt(...)`:
  - In the cutout branch, both `cutout.quad(...)` calls get a trailing arg `exposedAt(lx, y, lz)`.
  - In the solid-face loop, the `solid.quad(...)` call gets a trailing arg: for the up-face (`f === 3`) use `exposedAt(lx, y, lz)`, else `0` (only up-faces take snow anyway): `solid.quad(..., FACE_LIGHT[f], f === 3 ? exposedAt(lx, y, lz) : 0)`.
  - (Liquid quads keep the default `exp = 1`; they don't use the snow shader.)

- [ ] **Step 4: Gate the snow shader on `aSnowExp`** — in `addSnow`, add the attribute → varying → factor:
  - Vertex: prepend `attribute float aSnowExp;\nvarying float vSnowExp;\n` and in the `begin_vertex` injection add `  vSnowExp = aSnowExp;`
  - Fragment: prepend `varying float vSnowExp;\n` and change the snow factor line to multiply by it: `float snow = uSnowAmt * drift * vSnowExp * smoothstep(uSnowLine, uSnowLine + 10.0, vSnowY) * smoothstep(0.2, 0.75, vSnowUp);`

- [ ] **Step 5: Build + manual check** — `npm run build`; dev server, `game.seasonOverride = 0.875`, `game.snowAccum = 1`: roofs + open ground whiten; **go inside a cottage** — the interior floor stays un-snowed. No console/GLSL errors.

- [ ] **Step 6: Commit** — `git add src/mesher.js && git commit -m "feat(winter): skylight pass so snow covers exteriors but not interior floors"` + trailer.

---

### Task 3: Frozen-water ice visual — tile + freezable flag + liquid ice shader

**Files:** Modify `src/defs.js`, `src/textures.js`, `src/snow.js`, `src/mesher.js`. Visual.

- [ ] **Step 1: Add the ice tile** — in `src/defs.js` `TILE`, after the last entry (`HOLLY_BERRY: 63`) add `ICE: 64,`. In `src/textures.js` `TILE_PAINTERS`, add a painter:
```js
  [TILE.ICE](p) {
    p.clear();
    p.speckle(0xb8d0e0, 0.10);                 // pale blue-white sheet
    for (let i = 0; i < 5; i++) {              // a few cracks/glints
      let x = (p.rng() * T) | 0, y = (p.rng() * T) | 0;
      for (let s = 0; s < 4; s++) { p.px(x & 15, y & 15, shade(0xdff0ff, 1)); x += p.rng() < 0.5 ? 1 : 0; y += 1; }
    }
  },
```

- [ ] **Step 2: Freezable / frozen predicates** — add to `src/snow.js`:
```js
// A water/bog cell freezes in deep winter if it's an inland beck or a bog —
// never the open sea. `coastT` in [0,1]: 0 inland, 1 open sea.
export function freezableWater(block, coastT, B) {
  if (block === B.BOG) return true;            // bog pools always freeze
  if (block === B.WATER) return coastT <= 0.15; // inland becks only
  return false;
}
// Deep enough winter for ice.
export function isFrozen(season) { return !!season && season.warmth < -0.4; }
```

- [ ] **Step 3: Bake `aFreeze` on liquid + ice the liquid material** — in `src/mesher.js`:
  - `GeoBuilder.quad` already gained an `exp` arg (Task 2). Add one more trailing arg `frz = 0` and push it to a new `this.frz = []` (constructor) as `this.frz.push(frz, frz, frz, frz);`; in `build` add `g.setAttribute('aFreeze', new THREE.Float32BufferAttribute(this.frz, 1));`
  - In the liquid branch, compute freezable per cell and pass it: `const frz = freezableWater(id, this.gen ? 0 : 0, B);` — but the mesher needs `coastT`. The chunk has `world`; use `world.gen.geo.coastT(x0 + lx, z0 + lz)`. So: `const frz = freezableWater(id, world.gen.geo.coastT(x0 + lx, z0 + lz), B) ? 1 : 0;` and pass it as the trailing arg to `liquid.quad(cs, dir, uvr, [3,3,3,3], FACE_LIGHT[f], 1, frz)` (exp defaults to 1 for liquid; frz is the new arg). Import `freezableWater` + `B` is already imported.
  - Add a `frozen` uniform + ice injection to the liquid material via an `addIce(mat)` mirroring `addSnow` (own cache key `'liquid-ice'`):
```js
const iceUniform = { uFrozen: { value: 0 } };
export function setFrozen(frozen) { iceUniform.uFrozen.value = frozen ? 1 : 0; }
function addIce(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFrozen = iceUniform.uFrozen;
    shader.vertexShader = 'attribute float aFreeze;\nvarying float vFreeze;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vFreeze = aFreeze;');
    shader.fragmentShader = 'uniform float uFrozen;\nvarying float vFreeze;\n' + shader.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\n  float ice = uFrozen * vFreeze;\n  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.80, 0.88, 0.95), ice);');
  };
  mat.customProgramCacheKey = () => 'liquid-ice';
  return mat;
}
```
   Apply `addIce` to the liquid material in `initMaterials` (also bump its `opacity` toward 1 when frozen is acceptable as-is for v1). Export `setFrozen`.
  - Drive it from `src/main.js` each frame near `setSnowLevel`: `setFrozen(isFrozen(season));` (import `setFrozen` from mesher, `isFrozen` from snow).

- [ ] **Step 4: Build + manual check** — `npm run build`; dev server, `game.seasonOverride = 0.875`: an inland beck / bog surface renders as pale ice; the coast/sea stays open water. No console/GLSL errors.

- [ ] **Step 5: Commit** — `git add src/defs.js src/textures.js src/snow.js src/mesher.js src/main.js && git commit -m "feat(winter): becks + bogs ice over in deep winter (inland only)"` + trailer.

---

### Task 4: Walkable + slippery ice — player physics

**Files:** Modify `src/player.js`. Visual/interactive + the predicates are tested in Task 3's helpers.

Frozen becks/bogs should be standable (you don't sink) and slippery (you slide). Reuse `freezableWater`/`isFrozen` from `snow.js`.

- [ ] **Step 1: Detect standing on a frozen surface** — in `src/player.js`, import `{ freezableWater, isFrozen }` from `./snow.js`. The player can reach the season via `this.world.game.season` or a passed season; confirm the available path (the game sets `game.season`; player has `this.world`; if needed thread `season` into `update`). Add a helper:
```js
  onFrozenSurface(season) {
    if (!isFrozen(season)) return false;
    const x = Math.floor(this.pos.x), z = Math.floor(this.pos.z), y = Math.floor(this.pos.y - 0.05);
    const b = this.world.getBlock(x, y, z);
    if (b !== B.WATER && b !== B.BOG) return false;
    return freezableWater(b, this.world.gen.geo.coastT(x, z), B);
  }
```

- [ ] **Step 2: Walkable floor clamp** — after the normal movement/`moveEntity` step, if `onFrozenSurface(season)` and the player is at/just below the ice top, clamp `pos.y` to the top of that block (`Math.floor(pos.y) + 1`... i.e. the cell's top), zero downward velocity, and set `this.onGround = true`. This makes the frozen cell solid-on-top without changing world data. (Do NOT apply the existing water/bog speed penalty when on frozen surface — gate the `speed *= 0.3 / 0.55` lines on `!onFrozen`.)

- [ ] **Step 3: Slippery friction** — when on a frozen surface, lower the ground acceleration so velocity changes slowly (you skid). Where the code sets `accel = this.onGround || this.flying ? 18 : 5`, change to `const accel = onFrozen ? 3 : (this.onGround || this.flying ? 18 : 5);` (compute `onFrozen = this.onFrozenSurface(season)` once per frame). Low accel = momentum carries = slide.

- [ ] **Step 4: Build + manual check** — `npm run build`; dev server, `game.seasonOverride = 0.875`, walk onto a frozen beck/bog: you stand on it (don't sink), and movement skids/carries momentum. Walk to the coast — open sea is NOT walkable (you still swim). No console errors; confirm you can't stand on unfrozen water (set `game.seasonOverride = 0.375` → the beck is liquid again and you sink/swim).

- [ ] **Step 5: Commit** — `git add src/player.js && git commit -m "feat(winter): walk on + slide across frozen becks and bogs"` + trailer.

---

### Task 5: Wire `verify-winter` into the suite

**Files:** Modify `package.json`.

- [ ] **Step 1:** Add `"verify:winter": "node scripts/verify-winter.mjs",` next to `verify:snow`, and insert `node scripts/verify-winter.mjs` into the `verify` chain right after `node scripts/verify-snow.mjs`.
- [ ] **Step 2: Run** `npm run verify` → all `RESULT: PASS`, exit 0.
- [ ] **Step 3: Commit** — `git add package.json && git commit -m "test: add verify-winter to the verify suite"` + trailer.

---

## Self-Review

**Spec coverage (M1, M2, M7):** live-forecast winter snow + overcast-only-while-snowing (T1); exterior-only coverage via skylight `aSnowExp` (T2); frozen inland becks/bogs ice visual (T3) + walkable/slippery physics (T4); sea stays liquid (T3 `freezableWater` coastT gate + T4). Pure helpers TDD'd; `verify-winter` wired (T5). Survival (M3–M6) is Plan B.

**Placeholder scan:** pure tasks (T1, and the predicates in T3) have complete code + commands; visual/physics tasks (T2, T3 shader, T4) have complete code + explicit manual checks (shaders/physics can't go through CI).

**Type/name consistency:** `winterPrecip(season, livePrecip, fallback) → {snow, rain}`, `overcastGrey(weather, snow, rain)`, `freezableWater(block, coastT, B) → bool`, `isFrozen(season) → bool`, `setFrozen(bool)` defined in T1/T3 and consumed in sky.js/mesher.js/player.js/main.js consistently. `GeoBuilder.quad(corners, normal, uvRect, aos, light, exp=1, frz=0)` — the two new trailing args are added in T2 (exp) then T3 (frz); every existing `quad(...)` call keeps working via the defaults, and the snow/liquid calls pass the new args explicitly. `TILE.ICE = 64` (next free after 63).

**Open risks (validate during execution):**
- `GeoBuilder.quad` arg order: `exp` (T2) then `frz` (T3) are appended with defaults so existing calls are unaffected — confirm no call passes positional args past `light` already.
- `coastT` threshold (`<= 0.15`) for "inland beck" — confirm becks freeze but the bay/sea doesn't on the real map; tune if the coast transition differs.
- Season access in `player.js` — confirm whether `update` receives `season` or must read `this.world.game.season`; thread it cleanly.
- Walkable-ice clamp must not let you stand on *unfrozen* water (gate strictly on `isFrozen` + `freezableWater`) and must coexist with the existing swim physics — the manual check (summer beck = swim) guards this.
- `skyTop` is per-column within the chunk (full-height data) — correct; confirm the cutout flora exposure reads right (open flora exposed, roofed flora not).
