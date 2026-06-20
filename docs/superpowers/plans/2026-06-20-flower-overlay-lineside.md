# Seasonal Flower Overlay + Lineside Corridor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seasonal flowers that appear and vanish by bloom window (snowdrops → daffodils → summer wildflowers → autumn), rendered as a deterministic client-side instanced overlay (off-grid, jittered, multi-variant, clumped), plus an artificially dense railway corridor with signature brambles (white flowers → blackberries).

**Architecture:** A new `FloraLayer` renders flowers as `InstancedMesh` cross-quads around the player (same windowed pattern as `src/rails.js`), reusing the shared season-retinted atlas via the `cutout` material. Placement and bloom-window logic are pure, headlessly-tested modules (`flora-season.js`, `flora-placement.js`); the renderer is thin. Brambles are a new persistent cutout block placed densely on the lineside by worldgen; the overlay paints white flowers / blackberries over them by season. No world-data, no relay, no chunk re-mesh — everything is a deterministic function of (seed, position, season-time).

**Tech Stack:** three.js (`InstancedMesh`, `BufferGeometry`), vanilla ES modules, Node `.mjs` verify scripts. Atlas tiles painted procedurally in `textures.js`.

This is Plan 2 of 3 for the seasonal-flora-and-snow spec ([2026-06-20-seasonal-flora-snow-design.md](../specs/2026-06-20-seasonal-flora-snow-design.md)) — covers M3 (flower overlay + lineside). Plan 1 (foliage colour) is merged. Plan 3 = snow. Blackberry *foraging* (picking → edible item) is the separate forage sibling spec; this plan only places brambles and shows the berries.

## Verification note

The **pure logic** (season windows, deterministic placement, lineside density) is TDD'd headlessly in `scripts/verify-flora.mjs`. The **rendering** (InstancedMesh wiring, painters) is inherently visual: verify it with the running dev server via the `moorstead.debug`/`window.game` API and the season override (`game.seasonOverride = <phase>`), per the project's established "visual bits proven by debug-API" convention. Each rendering task lists an explicit manual check.

## File structure

- `src/season.js` — +2 scalars (`brambleFlower`, `blackberry`). [modify]
- `src/defs.js` — +6 `TILE` ids, +1 `B` id (`BRAMBLE`), +1 block def. [modify]
- `src/textures.js` — +6 tile painters. [modify]
- `src/flora-season.js` — pure: which overlay species are active for a season, and their density. [create]
- `src/flora-placement.js` — pure: deterministic per-cell instance placement (moor clump mode vs lineside dense mode). [create]
- `src/mesher.js` — export `getMaterials()`. [modify]
- `src/floraLayer.js` — the instanced overlay renderer. [create]
- `src/main.js` — construct + update the layer. [modify]
- `src/worldgen.js` — dense lineside band + bramble placement + thin persistent foxglove. [modify]
- `scripts/verify-flora.mjs` — headless tests for the pure modules + lineside density. [create]
- `scripts/verify-season.mjs` — +assertions. [modify]
- `package.json` — wire `verify:flora`. [modify]

---

### Task 1: Season scalars — `brambleFlower` and `blackberry`

**Files:** Modify `src/season.js` (`build()`); Test `scripts/verify-season.mjs`.

- [ ] **Step 1: Write the failing tests** — add before the final `RESULT` log in `scripts/verify-season.mjs`:

```js
// bramble: white flowers in late spring/early summer, blackberries late summer -> autumn
{
  (seasonStateAtPhase(0.24).brambleFlower > 0.9 ? ok : bad)('bramble flowers in late spring/early summer');
  (seasonStateAtPhase(0.875).brambleFlower < 0.1 ? ok : bad)('no bramble flowers in deep winter');
  (seasonStateAtPhase(0.58).blackberry > 0.8 ? ok : bad)('blackberries ripe in late summer/autumn');
  (seasonStateAtPhase(0.12).blackberry < 0.1 ? ok : bad)('no blackberries in early spring');
}
```

Add to the in-range loop (after the existing new-scalar checks):
```js
    if (s.brambleFlower < 0 || s.brambleFlower > 1) inRange = false;
    if (s.blackberry < 0 || s.blackberry > 1) inRange = false;
```

- [ ] **Step 2: Run, expect FAIL** — `node scripts/verify-season.mjs` → FAIL (scalars undefined).

- [ ] **Step 3: Implement** — in `src/season.js` `build()`, after the `frost:` line add:

```js
    brambleFlower: bump(yearPhase, 0.24, 0.05),  // bramble blossom: late spring / early summer
    blackberry: bump(yearPhase, 0.58, 0.10),     // ripe brambles: late summer into autumn
```

- [ ] **Step 4: Run, expect PASS** — `node scripts/verify-season.mjs` → `RESULT: PASS`.

- [ ] **Step 5: Commit** — `git add src/season.js scripts/verify-season.mjs && git commit` with message `feat(season): add brambleFlower + blackberry windows` and the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.

---

### Task 2: New atlas tiles, painters, and the bramble block

**Files:** Modify `src/defs.js` (TILE + B enums, one block def); Modify `src/textures.js` (painters).

- [ ] **Step 1: Add tile ids** — in `src/defs.js` `TILE`, after `ROCK_SALT: 54,` add:

```js
  BRAMBLE: 55, SNOWDROP: 56, DAFFODIL: 57, WILDFLOWER: 58, BRAMBLE_FLOWER: 59, BLACKBERRY: 60,
```

- [ ] **Step 2: Add the bramble block** — in `src/defs.js` `B`, after `ROCK_SALT: 53,` add `BRAMBLE: 54,`. Then add a block def alongside the other cutout flora (after `D[B.GORSE]`):

```js
D[B.BRAMBLE] = { name: 'Bramble', kind: 'cutout', tex: { t: TILE.BRAMBLE, s: TILE.BRAMBLE, b: TILE.BRAMBLE }, hard: 0.1, tool: null, drop: B.BRAMBLE };
```
(The forage sibling spec will later change `drop` to a seasonal blackberry item; for now it drops itself.)

- [ ] **Step 3: Add painters** — in `src/textures.js` `TILE_PAINTERS`, before the closing `};`, add painters in the existing procedural style (use `p.clear()`, `p.px`, `shade`, `p.rng()`). Brambles are a tangled dark-green thorny mound; SNOWDROP a small white nodding bell on a short green stem; DAFFODIL a yellow trumpet on a taller stem; WILDFLOWER a mixed-colour meadow tuft (pick among a few warm hues via `p.rng()`); BRAMBLE_FLOWER a tiny 5-petal white blossom sprite; BLACKBERRY a small cluster of dark purple-black berries. Representative template (BRAMBLE) — match this density/idiom for the others:

```js
  [TILE.BRAMBLE](p) {
    p.clear();
    for (let i = 0; i < 9; i++) {                      // tangled arching canes
      let x = 2 + ((p.rng() * 12) | 0), y = T - 1;
      const h = 8 + ((p.rng() * 6) | 0);
      for (let s = 0; s < h; s++) {
        p.px(x & 15, y, shade(0x2f4a24, 0.8 + p.rng() * 0.4));
        y--; x += p.rng() < 0.5 ? 0 : (p.rng() < 0.5 ? -1 : 1);
      }
    }
    p.dots(0x213518, 16);                              // deep shade
  },
```

- [ ] **Step 4: Verify the atlas still builds (smoke check)** — the painters run inside `buildAtlas()` which needs a canvas (DOM), so this is a dev-server check, not a Node test. Start the dev server, load the page, open the browser console and confirm no errors and the atlas built: `window.game` exists and the world renders. (No automated test for pixel art.)

- [ ] **Step 5: Commit** — `git add src/defs.js src/textures.js && git commit` message `feat(textures): bramble block + flower/berry atlas tiles` + trailer.

---

### Task 3: Bloom-window logic — `src/flora-season.js`

**Files:** Create `src/flora-season.js`; Test `scripts/verify-flora.mjs` (created here).

- [ ] **Step 1: Write the failing test** — create `scripts/verify-flora.mjs`:

```js
// Flower overlay logic — run wi': node scripts/verify-flora.mjs
import { activeFlora } from '../src/flora-season.js';
import { cellInstances } from '../src/flora-placement.js';
import { seasonStateAtPhase } from '../src/season.js';
import { TILE } from '../src/defs.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const tilesAt = phase => activeFlora(seasonStateAtPhase(phase)).map(s => s.tile);

// --- bloom windows: the right flowers show in the right season ---
{
  (tilesAt(0.97).includes(TILE.SNOWDROP) ? ok : bad)('snowdrops show in late winter');
  (!tilesAt(0.50).includes(TILE.SNOWDROP) ? ok : bad)('no snowdrops in summer');
  (tilesAt(0.12).includes(TILE.DAFFODIL) ? ok : bad)('daffodils show in spring');
  (tilesAt(0.40).includes(TILE.WILDFLOWER) ? ok : bad)('wildflowers show in summer');
  (tilesAt(0.24).includes(TILE.BRAMBLE_FLOWER) ? ok : bad)('bramble flowers show in late spring');
  (tilesAt(0.58).includes(TILE.BLACKBERRY) ? ok : bad)('blackberries show in late summer/autumn');
  (!tilesAt(0.58).includes(TILE.BRAMBLE_FLOWER) ? ok : bad)('bramble flowers gone once berries arrive');
}

// --- bramble flowers + blackberries are lineside-only species ---
{
  const bf = activeFlora(seasonStateAtPhase(0.24)).find(s => s.tile === TILE.BRAMBLE_FLOWER);
  (bf && bf.linesideOnly === true ? ok : bad)('bramble flowers are lineside-only');
  const bb = activeFlora(seasonStateAtPhase(0.58)).find(s => s.tile === TILE.BLACKBERRY);
  (bb && bb.linesideOnly === true ? ok : bad)('blackberries are lineside-only');
  const df = activeFlora(seasonStateAtPhase(0.12)).find(s => s.tile === TILE.DAFFODIL);
  (df && !df.linesideOnly ? ok : bad)('daffodils grow on the open moor too');
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run, expect FAIL** — `node scripts/verify-flora.mjs` → FAIL (modules missing).

- [ ] **Step 3: Implement** — create `src/flora-season.js`:

```js
// flora-season.js — which overlay flowers are in bloom for a given season state.
// Pure: a function of the season scalars only. No DOM, no three.js.
import { TILE } from './defs.js';

// Each entry: { tile, scalar (season field), threshold, linesideOnly }
const SPECIES = [
  { tile: TILE.SNOWDROP, scalar: 'snowdrop', threshold: 0.3, linesideOnly: false },
  { tile: TILE.DAFFODIL, scalar: 'daffodil', threshold: 0.3, linesideOnly: false },
  { tile: TILE.WILDFLOWER, scalar: 'summerBloom', threshold: 0.3, linesideOnly: false },
  { tile: TILE.BRAMBLE_FLOWER, scalar: 'brambleFlower', threshold: 0.3, linesideOnly: true },
  { tile: TILE.BLACKBERRY, scalar: 'blackberry', threshold: 0.3, linesideOnly: true },
];

/** Active overlay species for a season state, with a 0..1 strength. */
export function activeFlora(season) {
  const out = [];
  for (const s of SPECIES) {
    const v = season[s.scalar] || 0;
    if (v > s.threshold) out.push({ tile: s.tile, strength: v, linesideOnly: s.linesideOnly });
  }
  return out;
}
```

- [ ] **Step 4: Run, expect PASS** — `node scripts/verify-flora.mjs` → `RESULT: PASS`.

- [ ] **Step 5: Commit** — `git add src/flora-season.js scripts/verify-flora.mjs && git commit` message `feat(flora): bloom-window species logic` + trailer.

---

### Task 4: Deterministic placement — `src/flora-placement.js`

**Files:** Create `src/flora-placement.js`; extend `scripts/verify-flora.mjs`.

- [ ] **Step 1: Write the failing tests** — append to `scripts/verify-flora.mjs` before the final `RESULT` line:

```js
// --- deterministic placement ---
{
  const a = cellInstances(12345, 10, 20, 'moor', TILE.WILDFLOWER);
  const b = cellInstances(12345, 10, 20, 'moor', TILE.WILDFLOWER);
  (JSON.stringify(a) === JSON.stringify(b) ? ok : bad)('placement is deterministic for same seed+cell');
  const c = cellInstances(999, 10, 20, 'moor', TILE.WILDFLOWER);
  (JSON.stringify(a) !== JSON.stringify(c) ? ok : bad)('different seed gives different placement');

  // instances sit inside the cell, with a yaw and a variant
  for (const inst of a) {
    if (!(inst.dx >= 0 && inst.dx < 1 && inst.dz >= 0 && inst.dz < 1)) bad('instance dx/dz inside cell');
    if (!(inst.yaw >= 0 && inst.yaw < Math.PI * 2)) bad('instance yaw in range');
  }
  ok('moor instances are jittered inside the cell with yaw + variant');

  // moor mode is patchy (some cells empty), lineside mode is dense (always several)
  let moorEmpty = 0, moorMax = 0, lineMin = 99;
  for (let cz = 0; cz < 40; cz++) {
    const moor = cellInstances(7, 5, cz, 'moor', TILE.WILDFLOWER);
    const line = cellInstances(7, 5, cz, 'lineside', TILE.BRAMBLE_FLOWER);
    if (moor.length === 0) moorEmpty++;
    moorMax = Math.max(moorMax, moor.length);
    lineMin = Math.min(lineMin, line.length);
  }
  (moorEmpty > 0 ? ok : bad)('moor placement leaves bare cells (patchy clump)');
  (lineMin >= 3 ? ok : bad)('lineside placement is dense (>=3 per cell everywhere, got min ' + lineMin + ')');
  (lineMin > moorMax || lineMin >= 3 ? ok : bad)('lineside is denser than the open moor');
}
```

- [ ] **Step 2: Run, expect FAIL** — `node scripts/verify-flora.mjs` → FAIL (`cellInstances` missing).

- [ ] **Step 3: Implement** — create `src/flora-placement.js`:

```js
// flora-placement.js — deterministic per-cell flower placement. Pure: no DOM,
// no three.js. A cell is one world block column (x,z). Returns sub-cell instances.
import { hash2i, noise2 } from './noise.js';

// distinct sub-seeds per purpose so fields don't correlate
const S_CLUMP = 0x9e10, S_COUNT = 0x2b1d, S_POS = 0x71c3, S_VAR = 0x53a7;

/**
 * Instances of one species in one cell.
 * mode 'moor'    — patchy: gated by a low-frequency clump mask, 0..2 per cell.
 * mode 'lineside'— dense: 3..6 per cell, no clump gating (artificially lush).
 * Returns [{ dx, dz, yaw, scale, variant }] with dx,dz in [0,1).
 */
export function cellInstances(seed, cx, cz, mode, tile) {
  const r = (salt, n = 0) => hash2i(cx * 2 + n, cz * 2 + (salt & 1), seed ^ salt ^ (tile << 4));
  let count;
  if (mode === 'lineside') {
    count = 3 + Math.floor(r(S_COUNT) * 4);                 // 3..6
  } else {
    const clump = noise2(cx * 0.12, cz * 0.12, seed ^ S_CLUMP ^ (tile << 4)); // [-1,1]
    if (clump < 0.15) return [];                            // bare ground between clumps
    count = 1 + Math.floor(r(S_COUNT) * 2);                 // 1..2 in a clump
  }
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({
      dx: r(S_POS + i * 3),
      dz: r(S_POS + i * 3 + 1),
      yaw: r(S_POS + i * 3 + 2) * Math.PI * 2,
      scale: 0.8 + r(S_VAR + i) * 0.4,
      variant: Math.floor(r(S_VAR + i * 2) * 3),            // 0..2 visual variants
    });
  }
  return out;
}
```

> Confirmed against `src/noise.js`: `hash2i(x, z, seed)` returns `[0,1)` and `noise2(x, z, seed)` returns `[-1,1]`.

- [ ] **Step 4: Run, expect PASS** — `node scripts/verify-flora.mjs` → `RESULT: PASS`.

- [ ] **Step 5: Commit** — message `feat(flora): deterministic clump/lineside placement` + trailer.

---

### Task 5: Export materials from the mesher

**Files:** Modify `src/mesher.js`.

- [ ] **Step 1:** After `initMaterials()` (which sets the module `materials`), add:

```js
export function getMaterials() { return materials; }
```

- [ ] **Step 2: Verify** — `node -e "import('./src/mesher.js').then(m => console.log(typeof m.getMaterials))"` prints `function`. (Importing mesher.js under Node loads three; that's fine — verify-train-view already does.)

- [ ] **Step 3: Commit** — message `feat(mesher): export getMaterials for the flora overlay` + trailer.

---

### Task 6: The overlay renderer — `src/floraLayer.js`

**Files:** Create `src/floraLayer.js`. Visual verification.

- [ ] **Step 1: Implement** — create `src/floraLayer.js`:

```js
// floraLayer.js — seasonal flowers as an instanced cutout overlay around the
// player. Decoupled from chunk meshes: deterministic from (seed, position,
// season), rebuilt only when the player moves a cell or the bloom window turns.
// No world-data, no relay, no re-mesh. Pattern mirrors src/rails.js.
import * as THREE from 'three';
import { tileUV } from './textures.js';
import { getMaterials } from './mesher.js';
import { activeFlora } from './flora-season.js';
import { cellInstances } from './flora-placement.js';

const RADIUS = 40;          // blocks around the player kept planted
const REBUILD_MOVE = 8;     // rebuild when the player has moved this many blocks

// a unit cross of two perpendicular quads (origin at base centre, 1 block tall),
// UV-mapped to one atlas tile
function crossGeom(tile) {
  const [u0, v0, u1, v1] = tileUV(tile);
  const g = new THREE.BufferGeometry();
  const h = 1, w = 0.5;
  const pos = [
    -w, 0, 0, w, 0, 0, w, h, 0, -w, h, 0,    // quad A (x-plane)
    0, 0, -w, 0, 0, w, 0, h, w, 0, h, -w,    // quad B (z-plane)
  ];
  const uv = [u0, v0, u1, v0, u1, v1, u0, v1, u0, v0, u1, v0, u1, v1, u0, v1];
  const idx = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export class FloraLayer {
  constructor(scene, gen) {
    this.scene = scene;
    this.gen = gen;                 // world.gen: height(x,z), railInfo(x,z), seed
    this.meshes = [];
    this.center = null;             // [cellX, cellZ]
    this.windowKey = null;          // active-species signature
    this.timer = 0;
  }

  update(dt, playerPos, season) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.4;
    if (!season) return;
    const cx = Math.floor(playerPos.x), cz = Math.floor(playerPos.z);
    const species = activeFlora(season);
    const key = species.map(s => s.tile).join(',');
    if (this.center && Math.abs(cx - this.center[0]) < REBUILD_MOVE &&
        Math.abs(cz - this.center[1]) < REBUILD_MOVE && key === this.windowKey && this.meshes.length) return;
    this.build(cx, cz, species);
    this.center = [cx, cz];
    this.windowKey = key;
  }

  build(cx, cz, species) {
    this.clear();
    if (!species.length) return;
    const mat = getMaterials().cutout;
    const seed = this.gen.seed >>> 0;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const up = new THREE.Vector3();
    for (const sp of species) {
      const placements = [];
      for (let x = cx - RADIUS; x <= cx + RADIUS; x++) {
        for (let z = cz - RADIUS; z <= cz + RADIUS; z++) {
          const ri = this.gen.geo.railInfo(x, z);
          const onLineside = ri && ri.d >= 4 && ri.d < 7;     // beyond the cleared four-foot
          if (sp.linesideOnly && !onLineside) continue;
          if (ri && ri.d < 4) continue;                        // keep the four-foot clear
          const mode = onLineside ? 'lineside' : 'moor';
          const y = this.gen.height(x, z) + 1;
          for (const inst of cellInstances(seed, x, z, mode, sp.tile)) {
            placements.push([x + inst.dx, y, z + inst.dz, inst.yaw, inst.scale]);
          }
        }
      }
      if (!placements.length) continue;
      const mesh = new THREE.InstancedMesh(crossGeom(sp.tile), mat, placements.length);
      mesh.frustumCulled = false;
      for (let i = 0; i < placements.length; i++) {
        const [px, py, pz, yaw, sc] = placements[i];
        e.set(0, yaw, 0); q.setFromEuler(e);
        m.compose(new THREE.Vector3(px, py, pz), q, new THREE.Vector3(sc, sc, sc));
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.userData.ownGeometry = true;
      this.scene.add(mesh);
      this.meshes.push(mesh);
    }
  }

  clear() {
    for (const mesh of this.meshes) {
      this.scene.remove(mesh);
      if (mesh.userData.ownGeometry && mesh.geometry) mesh.geometry.dispose();
    }
    this.meshes.length = 0;
  }
}
```

> Confirmed against `src/worldgen.js`: the `Gen` object has `gen.seed` (int) and `gen.height(x,z)`; `railInfo(x,z)` lives on `gen.geo` (returns `{d, along, deck, …}` or `null` beyond ~6m, so open-moor cells get `null` → moor mode). The code above uses `this.gen.geo.railInfo`, `this.gen.height`, `this.gen.seed` accordingly.

- [ ] **Step 2: Manual verification** — deferred to Task 7 (needs wiring to render).

- [ ] **Step 3: Commit** — message `feat(flora): instanced seasonal flower overlay renderer` + trailer.

---

### Task 7: Wire the overlay into the game

**Files:** Modify `src/main.js`. Visual verification.

- [ ] **Step 1: Import** — add near the other system imports: `import { FloraLayer } from './floraLayer.js';`

- [ ] **Step 2: Construct** — in `startWorld()`, immediately after `this.rails = new Rails(this.scene, this.world.gen.geo);`, add:

```js
    this.floraLayer = new FloraLayer(this.scene, this.world.gen);
```

- [ ] **Step 3: Update** — in the main frame loop, right after the existing `if (this.rails) this.rails.update(dt, this.player.pos);`, add:

```js
      if (this.floraLayer) this.floraLayer.update(dt, this.player.pos, this.season);
```
(`this.season` is set earlier in the loop from `seasonState()`. If the playing-state branch runs before `this.season` is assigned, pass `this.season || seasonState()`.)

- [ ] **Step 4: Manual verification (the real test of Tasks 2, 6, 7):**
  1. Start the dev server; enter a world.
  2. In the browser console: `game.seasonOverride = 0.12` (spring) — daffodils should appear scattered on the moor within a few seconds; `game.seasonOverride = 0.97` — snowdrops; `game.seasonOverride = 0.40` — summer wildflowers.
  3. Walk along the railway and set `game.seasonOverride = 0.24` — dense white bramble flowers along the lineside only; `game.seasonOverride = 0.58` — blackberries along the lineside.
  4. Confirm flowers are off-grid (jittered, varied yaw), patchy on the moor, dense lineside, and that none sit in the four-foot (track bed). Set `game.seasonOverride = null` to return to the live season.
  5. Confirm no console errors and framerate is steady while walking (overlay rebuilds without hitching).

- [ ] **Step 5: Commit** — message `feat(flora): wire the seasonal flower overlay into the game loop` + trailer.

---

### Task 8: Lineside corridor — dense brambles + thicker planting

**Files:** Modify `src/worldgen.js`.

- [ ] **Step 1: Read the lineside block** — find the verge planting (`const onVerge = ri && ri.d >= 2.4 && ri.d < 5;` … the flora scatter that follows) and the four-foot guard (`if (tri && tri.d < 4) continue;`).

- [ ] **Step 2: Implement** — widen the verge band and make brambles the signature plant. Replace the verge planting so that on the lineside (beyond the cleared four-foot, `ri.d >= 4 && ri.d < 7`) brambles dominate, with ferns/foxglove mixed in, at high density; keep the band outside the loading gauge (do not place at `ri.d < 4`). Concretely, set the lineside surface plant using the existing `hash2i`-style field already used there:

```js
      const onVerge = ri && ri.d >= 4 && ri.d < 7;   // widened band, beyond the four-foot
      if (onVerge && (surf === B.GRASS || surf === B.DIRT) && data[IDX(lx, h + 1, lz)] === B.AIR) {
        const v = hash2i(x, z, this.seed ^ 0x5a1e);
        let plant = 0;
        if (v < 0.60) plant = B.BRAMBLE;             // a near-continuous bramble band
        else if (v < 0.74) plant = B.FERN;
        else if (v < 0.82) plant = B.FOXGLOVE;
        else if (v < 0.88) plant = B.BRACKEN;
        if (plant) data[IDX(lx, h + 1, lz)] = plant;
      }
```
Keep the existing `if (tri && tri.d < 4) continue;` four-foot guard intact (do not weaken it). If the open-moor foxglove scatter is now redundant with the overlay, thin it (reduce its probability) — but that is optional polish, not required for this task.

- [ ] **Step 3: Verify clearance is preserved** — run `node scripts/verify-rail-clearance.mjs` and `node scripts/verify-train-view.mjs`. Both must still print `RESULT: PASS` (brambles sit beyond the gauge; the four-foot stays clear). If either fails, the band is too wide or too close — pull the inner edge back (raise the `ri.d >= 4` lower bound) until they pass.

- [ ] **Step 4: Commit** — message `feat(worldgen): dense lineside bramble band` + trailer.

---

### Task 9: Wire `verify-flora` into the suite

**Files:** Modify `package.json`.

- [ ] **Step 1:** Add `"verify:flora": "node scripts/verify-flora.mjs",` next to `verify:foliage`, and insert `node scripts/verify-flora.mjs` into the `verify` chain immediately after `node scripts/verify-foliage.mjs`.

- [ ] **Step 2: Run the full suite** — `npm run verify` → every check `RESULT: PASS`, exit 0 (now includes `verify-flora`).

- [ ] **Step 3: Commit** — message `test: add verify-flora to the verify suite` + trailer.

---

## Self-Review

**Spec coverage (M3 + lineside):**
- Appear/vanish flowers by window (snowdrop→daffodil→summer→bramble flower→blackberry) → Tasks 1, 3, 6. ✓
- Off-grid, jittered, multi-variant, clumped placement → Task 4 (sub-cell `dx/dz`, `yaw`, `variant`, clump mask). ✓
- Lineside artificially dense, multiple per cell, its own premise → Task 4 `'lineside'` mode + Task 8. ✓
- Signature brambles, white flowers → blackberries, lineside; foraging deferred → Tasks 2, 6 (`linesideOnly`), 8; drop left as self (sibling spec rewires). ✓
- Clearance preserved → Task 8 Step 3 (re-run rail-clearance/train-view). ✓
- Deterministic, client-side, no re-mesh/relay → whole design (pure modules + instanced overlay). ✓

**Placeholder scan:** Pure-logic tasks (1,3,4,5,9) have complete code + exact commands. Rendering tasks (2,6,7,8) have complete implementation code; their verification is explicit manual steps (unavoidable for visual output) rather than automated assertions — flagged up front in "Verification note".

**Type/name consistency:** `activeFlora(season) → [{tile, strength, linesideOnly}]` is produced in Task 3 and consumed in Task 6. `cellInstances(seed, cx, cz, mode, tile) → [{dx,dz,yaw,scale,variant}]` defined in Task 4, consumed in Task 6. `getMaterials().cutout` exported in Task 5, used in Task 6. `TILE.{BRAMBLE,SNOWDROP,DAFFODIL,WILDFLOWER,BRAMBLE_FLOWER,BLACKBERRY}` defined in Task 2, used in Tasks 3, 6. `season.brambleFlower/blackberry` defined in Task 1, used in Task 3.

**Open risks (validate during execution):**
- Property paths on the gen object (`gen.seed`, `gen.height`, `gen.railInfo` vs `gen.geo.railInfo`) — Task 6 note says to confirm against `worldgen.js`/`geography.js` and adapt.
- `hash2i`/`noise2` exact signatures/ranges — Task 4 note says to confirm against `noise.js`.
- Instance count: RADIUS 40 × dense lineside could be many instances; if the rebuild hitches (Task 7 Step 4), reduce RADIUS or throttle, or split rebuild across frames.
