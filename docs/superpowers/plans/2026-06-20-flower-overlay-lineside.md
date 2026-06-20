# Seasonal Flower Overlay + Lineside Corridor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seasonal flowers that appear/vanish by window (snowdrops → daffodils → summer wildflowers), berries/blossom that ripen on their bushes in season (bilberries; bramble white-flowers → blackberries; holly red berries in winter), a varied artificially-dense railway corridor (ferns, foxgloves, brambles, holly, bracken), and brambles that die back in winter and regrow in spring — all a deterministic client-side instanced overlay plus atlas retints. No world-data writes, no relay, no chunk re-mesh.

**Architecture:** A new `FloraLayer` renders flora as `InstancedMesh` cross-quads around the player (windowed like `src/rails.js`), reusing the season-retinted atlas via the `cutout` material. Two kinds: **scatter** flowers placed deterministically on open grass (`flora-placement.js`), and **adornments** (berries/blossom) painted onto the bush blocks they grow on, gated by season (`flora-season.js`). Both pure, headlessly tested. Brambles + holly are new persistent cutout blocks placed in a varied dense lineside band by worldgen; brambles die back via atlas retint. The overlay exposes a per-bush "picked" hook the forage sibling spec will wire (picking leaves the plant, removes only the fruit).

**Tech Stack:** three.js (`InstancedMesh`, `BufferGeometry`), vanilla ES modules, Node `.mjs` verify scripts. Atlas tiles painted procedurally in `textures.js`.

Plan 2 of 3 for the spec ([2026-06-20-seasonal-flora-snow-design.md](../specs/2026-06-20-seasonal-flora-snow-design.md)) — M3. Plan 1 (foliage colour) merged; Plan 3 = snow. Blackberry/bilberry *foraging* (pick → item, leave the plant) is the forage sibling spec.

## Verification note

Pure logic (season windows, placement, density) is TDD'd headlessly in `scripts/verify-flora.mjs`; bramble die-back tint extends `scripts/verify-foliage.mjs`. Rendering (InstancedMesh, painters) is visual — verified with the dev server via `window.game` + the season override (`game.seasonOverride = <phase>`), per the project convention. Each rendering task gives an explicit manual check.

## File structure

- `src/season.js` — +2 scalars (`brambleFlower`, `blackberry`); bilberries reuse `heatherBloom`, holly berries reuse `frost`. [modify]
- `src/defs.js` — +9 `TILE` ids, +2 `B` ids (`BRAMBLE`, `HOLLY`), +2 block defs. [modify]
- `src/textures.js` — +9 painters; deberry bilberry; clearer fern curl + foxglove spike; bramble in `SEASON_TILES` + die-back branch. [modify]
- `src/flora-season.js` — pure: active scatter flowers + active adornments (bush → tile). [create]
- `src/flora-placement.js` — pure: deterministic per-cell scatter placement (moor clump vs lineside dense). [create]
- `src/mesher.js` — export `getMaterials()`. [modify]
- `src/floraLayer.js` — instanced overlay renderer (scatter on grass; adorn bush blocks; picked-hook). [create]
- `src/main.js` — construct + update the layer. [modify]
- `src/worldgen.js` — varied dense lineside band. [modify]
- `scripts/verify-flora.mjs` — headless tests. [create]
- `scripts/verify-season.mjs`, `scripts/verify-foliage.mjs`, `package.json` — extend/wire. [modify]

---

### Task 1: Season scalars — `brambleFlower` and `blackberry`

**Files:** Modify `src/season.js` (`build()`); Test `scripts/verify-season.mjs`.

- [ ] **Step 1: Failing tests** — before the final `RESULT` log in `scripts/verify-season.mjs`:

```js
// bramble: white flowers late spring/early summer, blackberries late summer -> autumn
{
  (seasonStateAtPhase(0.24).brambleFlower > 0.9 ? ok : bad)('bramble flowers in late spring/early summer');
  (seasonStateAtPhase(0.875).brambleFlower < 0.1 ? ok : bad)('no bramble flowers in deep winter');
  (seasonStateAtPhase(0.58).blackberry > 0.8 ? ok : bad)('blackberries ripe in late summer/autumn');
  (seasonStateAtPhase(0.12).blackberry < 0.1 ? ok : bad)('no blackberries in early spring');
}
```
Add to the in-range loop: `if (s.brambleFlower < 0 || s.brambleFlower > 1) inRange = false;` and the same for `s.blackberry`.

- [ ] **Step 2: Run, expect FAIL** — `node scripts/verify-season.mjs`.

- [ ] **Step 3: Implement** — in `build()`, after the `frost:` line:

```js
    brambleFlower: bump(yearPhase, 0.24, 0.05),  // bramble blossom: late spring / early summer
    blackberry: bump(yearPhase, 0.58, 0.10),     // ripe brambles: late summer into autumn
```
(Bilberries reuse `heatherBloom`; holly berries reuse `frost` — no new scalars.)

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(season): add brambleFlower + blackberry windows` + trailer.

---

### Task 2: Tiles, painters, bramble/holly blocks, bramble die-back

**Files:** Modify `src/defs.js`, `src/textures.js`; extend `scripts/verify-foliage.mjs`.

- [ ] **Step 1: Tile ids** — in `src/defs.js` `TILE`, after `ROCK_SALT: 54,`:

```js
  BRAMBLE: 55, SNOWDROP: 56, DAFFODIL: 57, WILDFLOWER: 58, BRAMBLE_FLOWER: 59,
  BLACKBERRY: 60, BILBERRY_FRUIT: 61, HOLLY: 62, HOLLY_BERRY: 63,
```

- [ ] **Step 2: Blocks** — in `B`, after `ROCK_SALT: 53,` add `BRAMBLE: 54, HOLLY: 55,`. Add defs after `D[B.GORSE]`:

```js
D[B.BRAMBLE] = { name: 'Bramble', kind: 'cutout', tex: { t: TILE.BRAMBLE, s: TILE.BRAMBLE, b: TILE.BRAMBLE }, hard: 0.1, tool: null, drop: B.BRAMBLE };
D[B.HOLLY] = { name: 'Holly', kind: 'cutout', tex: { t: TILE.HOLLY, s: TILE.HOLLY, b: TILE.HOLLY }, hard: 0.2, tool: null, drop: B.HOLLY };
```
(Forage spec later rewires the bramble drop to a seasonal blackberry item.)

- [ ] **Step 3: Painters** — in `src/textures.js` `TILE_PAINTERS`:
  (a) **Deberry `[TILE.BILBERRY]`** — remove its dark-berry dots loop; bush shows green foliage only (berries now seasonal via overlay).
  (b) **Improve `[TILE.FERN]`** — add a clear unfurling fiddlehead curl at the top of each frond (a tight spiral of pixels) so ferns read distinctly.
  (c) **Improve `[TILE.FOXGLOVE]`** — make the spike taller and one-sided with a clear graduated column of bells, visibly different from heather's low bushy bloom.
  (d) Add painters (existing idiom: `p.clear()`, `p.px`, `shade`, `p.rng()`) for: BRAMBLE (tangled dark-green thorny mound), SNOWDROP (white nodding bell, short green stem), DAFFODIL (yellow trumpet, taller stem), WILDFLOWER (mixed warm-hue meadow tuft via `p.rng()`), BRAMBLE_FLOWER (tiny white 5-petal sprite), BLACKBERRY (dark purple-black berry cluster), BILBERRY_FRUIT (small blue-black berries), HOLLY (spiky dark-green evergreen leaves), HOLLY_BERRY (bright red berry cluster). Template (BRAMBLE):

```js
  [TILE.BRAMBLE](p) {
    p.clear();
    for (let i = 0; i < 9; i++) {
      let x = 2 + ((p.rng() * 12) | 0), y = T - 1;
      const h = 8 + ((p.rng() * 6) | 0);
      for (let s = 0; s < h; s++) { p.px(x & 15, y, shade(0x2f4a24, 0.8 + p.rng() * 0.4)); y--; x += p.rng() < 0.5 ? 0 : (p.rng() < 0.5 ? -1 : 1); }
    }
    p.dots(0x213518, 16);
  },
```

- [ ] **Step 4: Bramble die-back (atlas retint)** — add `TILE.BRAMBLE` to `SEASON_TILES`, and a branch in `seasonShiftPx` (after the existing ones):

```js
  } else if (tile === TILE.BRAMBLE) {
    blendPx(d, i, 96, 132, 58, s.greenness * 0.18);                         // spring/summer green
    desatPx(d, i, winter * 0.5); blendPx(d, i, 110, 92, 64, winter * 0.5);  // winter die-back: brown/bare
  }
```
Holly stays evergreen — do NOT add it to `SEASON_TILES`.

- [ ] **Step 5: Failing test for die-back** — in `scripts/verify-foliage.mjs`, add (base `BRAM = [70,100,45]`):

```js
{
  const shiftB = (phase) => { const d = [70,100,45,255]; seasonShiftPx(TILE.BRAMBLE, d, 0, seasonStateAtPhase(phase)); return d; };
  const summer = shiftB(0.375), winter = shiftB(0.875);
  (winter[1] - winter[2] < summer[1] - summer[2] ? ok : bad)('brambles die back browner in winter than summer');
}
```
(`TILE` and `seasonStateAtPhase` are already imported in verify-foliage.) Run `node scripts/verify-foliage.mjs` → FAIL before Step 4's branch, PASS after.

- [ ] **Step 6: Smoke check** — start the dev server; confirm no console errors, the world renders, bilberry bushes show green (no berries), ferns show a curl, foxgloves a tall spike.

- [ ] **Step 7: Commit** — `feat(textures): bramble/holly blocks, flower-berry tiles, clearer fern+foxglove, bramble die-back; deberry bilberry` + trailer.

---

### Task 3: Bloom logic — `src/flora-season.js`

**Files:** Create `src/flora-season.js`; Test `scripts/verify-flora.mjs` (created here).

- [ ] **Step 1: Failing test** — create `scripts/verify-flora.mjs`:

```js
// Flower overlay logic — run wi': node scripts/verify-flora.mjs
import { activeScatter, activeAdornments } from '../src/flora-season.js';
import { cellInstances } from '../src/flora-placement.js';
import { seasonStateAtPhase } from '../src/season.js';
import { TILE, B } from '../src/defs.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const scatterAt = p => activeScatter(seasonStateAtPhase(p)).map(s => s.tile);
const adornAt = p => activeAdornments(seasonStateAtPhase(p));

{
  (scatterAt(0.97).includes(TILE.SNOWDROP) ? ok : bad)('snowdrops show in late winter');
  (!scatterAt(0.50).includes(TILE.SNOWDROP) ? ok : bad)('no snowdrops in summer');
  (scatterAt(0.12).includes(TILE.DAFFODIL) ? ok : bad)('daffodils show in spring');
  (scatterAt(0.40).includes(TILE.WILDFLOWER) ? ok : bad)('wildflowers show in summer');
}
{
  const bil = adornAt(0.45).find(a => a.tile === TILE.BILBERRY_FRUIT);
  (bil && bil.bush === B.BILBERRY_BUSH ? ok : bad)('bilberries ripen on bilberry bushes in late summer');
  (!adornAt(0.10).some(a => a.tile === TILE.BILBERRY_FRUIT) ? ok : bad)('no bilberries in early spring');
  const bf = adornAt(0.24).find(a => a.tile === TILE.BRAMBLE_FLOWER);
  (bf && bf.bush === B.BRAMBLE ? ok : bad)('bramble flowers on brambles in late spring');
  const bb = adornAt(0.58).find(a => a.tile === TILE.BLACKBERRY);
  (bb && bb.bush === B.BRAMBLE ? ok : bad)('blackberries on brambles in late summer/autumn');
  (!adornAt(0.58).some(a => a.tile === TILE.BRAMBLE_FLOWER) ? ok : bad)('bramble flowers gone once berries arrive');
  const holly = adornAt(0.875).find(a => a.tile === TILE.HOLLY_BERRY);
  (holly && holly.bush === B.HOLLY ? ok : bad)('holly berries on holly in deep winter');
  (!adornAt(0.40).some(a => a.tile === TILE.HOLLY_BERRY) ? ok : bad)('no holly berries in summer');
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run, expect FAIL** (modules missing).

- [ ] **Step 3: Implement** — create `src/flora-season.js`:

```js
// flora-season.js — which overlay flora are active for a given season state.
// Pure: a function of the season scalars only. No DOM, no three.js.
//   scatter   — standalone flowers placed on open grass.
//   adornment — berries/blossom rendered on a specific bush block, in season.
import { TILE, B } from './defs.js';

const SCATTER = [
  { tile: TILE.SNOWDROP, scalar: 'snowdrop', threshold: 0.3 },
  { tile: TILE.DAFFODIL, scalar: 'daffodil', threshold: 0.3 },
  { tile: TILE.WILDFLOWER, scalar: 'summerBloom', threshold: 0.3 },
];
const ADORN = [
  { tile: TILE.BILBERRY_FRUIT, scalar: 'heatherBloom', threshold: 0.4, bush: B.BILBERRY_BUSH },
  { tile: TILE.BRAMBLE_FLOWER, scalar: 'brambleFlower', threshold: 0.3, bush: B.BRAMBLE },
  { tile: TILE.BLACKBERRY, scalar: 'blackberry', threshold: 0.3, bush: B.BRAMBLE },
  { tile: TILE.HOLLY_BERRY, scalar: 'frost', threshold: 0.4, bush: B.HOLLY },
];

export function activeScatter(season) {
  return SCATTER.filter(s => (season[s.scalar] || 0) > s.threshold).map(s => ({ tile: s.tile }));
}
export function activeAdornments(season) {
  return ADORN.filter(s => (season[s.scalar] || 0) > s.threshold).map(s => ({ tile: s.tile, bush: s.bush }));
}
```

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(flora): scatter + bush-adornment bloom logic (incl. holly)` + trailer.

---

### Task 4: Deterministic scatter placement — `src/flora-placement.js`

**Files:** Create `src/flora-placement.js`; extend `scripts/verify-flora.mjs`.

- [ ] **Step 1: Failing tests** — append to `scripts/verify-flora.mjs` before the final `RESULT` line:

```js
{
  const a = cellInstances(12345, 10, 20, 'moor', TILE.WILDFLOWER);
  const b = cellInstances(12345, 10, 20, 'moor', TILE.WILDFLOWER);
  (JSON.stringify(a) === JSON.stringify(b) ? ok : bad)('placement is deterministic for same seed+cell');
  (JSON.stringify(a) !== JSON.stringify(cellInstances(999, 10, 20, 'moor', TILE.WILDFLOWER)) ? ok : bad)('different seed gives different placement');
  for (const inst of a) {
    if (!(inst.dx >= 0 && inst.dx < 1 && inst.dz >= 0 && inst.dz < 1)) bad('instance dx/dz inside cell');
    if (!(inst.yaw >= 0 && inst.yaw < Math.PI * 2)) bad('instance yaw in range');
  }
  ok('moor instances jittered inside the cell with yaw + variant');
  let moorEmpty = 0, lineMin = 99;
  for (let cz = 0; cz < 40; cz++) {
    if (cellInstances(7, 5, cz, 'moor', TILE.WILDFLOWER).length === 0) moorEmpty++;
    lineMin = Math.min(lineMin, cellInstances(7, 5, cz, 'lineside', TILE.WILDFLOWER).length);
  }
  (moorEmpty > 0 ? ok : bad)('moor placement leaves bare cells (patchy clump)');
  (lineMin >= 3 ? ok : bad)('lineside placement is dense (>=3 per cell, got min ' + lineMin + ')');
}
```

- [ ] **Step 2: Run, expect FAIL** (`cellInstances` missing).

- [ ] **Step 3: Implement** — create `src/flora-placement.js`:

```js
// flora-placement.js — deterministic per-cell scatter placement. Pure: no DOM,
// no three.js. A cell is one world block column (x,z). Returns sub-cell instances.
import { hash2i, noise2 } from './noise.js';

const S_COUNT = 0x2b1d, S_POS = 0x71c3, S_VAR = 0x53a7, S_CLUMP = 0x9e10;

export function cellInstances(seed, cx, cz, mode, tile) {
  const r = (salt, n = 0) => hash2i(cx * 2 + n, cz * 2 + (salt & 1), seed ^ salt ^ (tile << 4));
  let count;
  if (mode === 'lineside') {
    count = 3 + Math.floor(r(S_COUNT) * 4);                 // 3..6
  } else {
    const clump = noise2(cx * 0.12, cz * 0.12, seed ^ S_CLUMP ^ (tile << 4)); // [-1,1]
    if (clump < 0.15) return [];
    count = 1 + Math.floor(r(S_COUNT) * 2);                 // 1..2
  }
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({
      dx: r(S_POS + i * 3), dz: r(S_POS + i * 3 + 1),
      yaw: r(S_POS + i * 3 + 2) * Math.PI * 2,
      scale: 0.8 + r(S_VAR + i) * 0.4,
      variant: Math.floor(r(S_VAR + i * 2) * 3),
    });
  }
  return out;
}
```
> Confirmed against `src/noise.js`: `hash2i → [0,1)`, `noise2 → [-1,1]`.

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(flora): deterministic clump/lineside scatter placement` + trailer.

---

### Task 5: Export materials from the mesher

**Files:** Modify `src/mesher.js`.

- [ ] **Step 1:** After `initMaterials()`, add: `export function getMaterials() { return materials; }`
- [ ] **Step 2: Verify** — `node -e "import('./src/mesher.js').then(m => console.log(typeof m.getMaterials))"` prints `function`.
- [ ] **Step 3: Commit** — `feat(mesher): export getMaterials for the flora overlay` + trailer.

---

### Task 6: The overlay renderer — `src/floraLayer.js`

**Files:** Create `src/floraLayer.js`. Visual verification.

- [ ] **Step 1: Implement** — create `src/floraLayer.js`:

```js
// floraLayer.js — seasonal flora as an instanced cutout overlay around the
// player. Scatter flowers on open grass (deterministic) + adornments
// (berries/blossom) on the bush blocks they grow on, in season. Decoupled from
// chunk meshes; rebuilt only on player-cell move or bloom-window change. No
// world-data writes, no relay, no re-mesh. Pattern mirrors src/rails.js.
import * as THREE from 'three';
import { tileUV } from './textures.js';
import { getMaterials } from './mesher.js';
import { activeScatter, activeAdornments } from './flora-season.js';
import { cellInstances } from './flora-placement.js';
import { hash2i } from './noise.js';
import { B } from './defs.js';

const RADIUS = 40;
const REBUILD_MOVE = 8;

function crossGeom(tile) {
  const [u0, v0, u1, v1] = tileUV(tile);
  const g = new THREE.BufferGeometry();
  const h = 1, w = 0.5;
  const pos = [-w, 0, 0, w, 0, 0, w, h, 0, -w, h, 0, 0, 0, -w, 0, 0, w, 0, h, w, 0, h, -w];
  const uv = [u0, v0, u1, v0, u1, v1, u0, v1, u0, v0, u1, v0, u1, v1, u0, v1];
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  g.computeVertexNormals();
  return g;
}

export class FloraLayer {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;          // world.gen (height, geo.railInfo, seed) + getBlock
    this.meshes = [];
    this.center = null;
    this.windowKey = null;
    this.timer = 0;
    // forage sibling spec sets this to (x,z,bush)=>bool to hide picked fruit; null = show all
    this.fruitPicked = null;
  }

  update(dt, playerPos, season) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.4;
    if (!season) return;
    const cx = Math.floor(playerPos.x), cz = Math.floor(playerPos.z);
    const key = activeScatter(season).map(s => s.tile).join(',') + '|' +
                activeAdornments(season).map(a => a.tile).join(',');
    if (this.center && Math.abs(cx - this.center[0]) < REBUILD_MOVE &&
        Math.abs(cz - this.center[1]) < REBUILD_MOVE && key === this.windowKey && this.meshes.length) return;
    this.build(cx, cz, season);
    this.center = [cx, cz];
    this.windowKey = key;
  }

  build(cx, cz, season) {
    this.clear();
    const scatter = activeScatter(season);
    const adorn = activeAdornments(season);
    if (!scatter.length && !adorn.length) return;
    const gen = this.world.gen;
    const seed = gen.seed >>> 0;
    const byTile = new Map();
    const add = (tile, x, y, z, yaw, sc) => {
      let a = byTile.get(tile); if (!a) byTile.set(tile, a = []);
      a.push([x, y, z, yaw, sc]);
    };
    for (let x = cx - RADIUS; x <= cx + RADIUS; x++) {
      for (let z = cz - RADIUS; z <= cz + RADIUS; z++) {
        const ri = gen.geo.railInfo(x, z);
        if (ri && ri.d < 4) continue;                       // keep the four-foot clear
        const surfY = gen.height(x, z);
        const top = this.world.getBlock(x, surfY + 1, z);
        if (adorn.length && top) {
          for (const a of adorn) if (top === a.bush) {
            if (this.fruitPicked && this.fruitPicked(x, z, a.bush)) continue; // forage suppression
            const yaw = hash2i(x, z, seed ^ (a.tile << 6)) * Math.PI * 2;
            add(a.tile, x + 0.5, surfY + 1, z + 0.5, yaw, 1);
          }
        }
        if (scatter.length && top === B.AIR) {
          const mode = (ri && ri.d >= 4 && ri.d < 7) ? 'lineside' : 'moor';
          for (const sp of scatter)
            for (const inst of cellInstances(seed, x, z, mode, sp.tile))
              add(sp.tile, x + inst.dx, surfY + 1, z + inst.dz, inst.yaw, inst.scale);
        }
      }
    }
    const mat = getMaterials().cutout;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (const [tile, places] of byTile) {
      const mesh = new THREE.InstancedMesh(crossGeom(tile), mat, places.length);
      mesh.frustumCulled = false;
      for (let i = 0; i < places.length; i++) {
        const [px, py, pz, yaw, sc] = places[i];
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
> Confirmed: `world.gen.seed`, `world.gen.height(x,z)`, `world.gen.geo.railInfo(x,z)` (→ `{d,…}`|`null`), `world.getBlock(x,y,z)` all exist; worldgen writes surface flora at `height+1`.

- [ ] **Step 2:** Manual verification deferred to Task 7.
- [ ] **Step 3: Commit** — `feat(flora): instanced overlay renderer (scatter + adornments + picked hook)` + trailer.

---

### Task 7: Wire the overlay into the game

**Files:** Modify `src/main.js`. Visual verification.

- [ ] **Step 1: Import** — `import { FloraLayer } from './floraLayer.js';`
- [ ] **Step 2: Construct** — in `startWorld()`, after `this.rails = new Rails(this.scene, this.world.gen.geo);`:

```js
    this.floraLayer = new FloraLayer(this.scene, this.world);
```
- [ ] **Step 3: Update** — after `if (this.rails) this.rails.update(dt, this.player.pos);`:

```js
      if (this.floraLayer) this.floraLayer.update(dt, this.player.pos, this.season);
```
(If this branch can run before `this.season` is set, use `this.season || seasonState()`.)

- [ ] **Step 4: Manual verification (the real test of Tasks 2, 6, 7):**
  1. Dev server; enter a world. No console errors.
  2. `game.seasonOverride = 0.12` → daffodils on the moor; `0.97` → snowdrops; `0.40` → summer wildflowers (denser along the line).
  3. `game.seasonOverride = 0.45` → bilberries on bilberry bushes; `0.24` → white blossom on lineside brambles; `0.58` → blackberries on brambles; `0.875` → red holly berries on lineside holly + brambles visibly died-back (browner).
  4. Confirm: scatter flowers off-grid/jittered, patchy on the moor, dense lineside; berries on actual bushes; nothing in the four-foot; steady framerate walking. `game.seasonOverride = null` restores live season.
- [ ] **Step 5: Commit** — `feat(flora): wire the seasonal overlay into the game loop` + trailer.

---

### Task 8: Varied dense lineside band

**Files:** Modify `src/worldgen.js`.

- [ ] **Step 1: Read** the verge planting (`const onVerge = ri && ri.d >= 2.4 && ri.d < 5;` …) and the four-foot guard (`if (tri && tri.d < 4) continue;`).

- [ ] **Step 2: Implement** — widen the band and plant a **varied** mix (never bramble-dominated), beyond the cleared four-foot:

```js
      const onVerge = ri && ri.d >= 4 && ri.d < 7;   // widened band, beyond the four-foot
      if (onVerge && (surf === B.GRASS || surf === B.DIRT) && data[IDX(lx, h + 1, lz)] === B.AIR) {
        const v = hash2i(x, z, this.seed ^ 0x5a1e);
        let plant = 0;
        if (v < 0.22) plant = B.BRAMBLE;        // brambles
        else if (v < 0.46) plant = B.FERN;      // thick ferns
        else if (v < 0.62) plant = B.FOXGLOVE;  // foxglove spikes
        else if (v < 0.74) plant = B.HOLLY;     // evergreen winter anchor
        else if (v < 0.84) plant = B.BRACKEN;   // bracken
        if (plant) data[IDX(lx, h + 1, lz)] = plant;   // ~16% bare for breathing room
      }
```
Keep the existing `if (tri && tri.d < 4) continue;` four-foot guard.

- [ ] **Step 3: Verify clearance** — run `node scripts/verify-rail-clearance.mjs` and `node scripts/verify-train-view.mjs`; both must still `RESULT: PASS`. If either fails, raise the `ri.d >= 4` inner bound until they pass.

- [ ] **Step 4: Commit** — `feat(worldgen): varied dense lineside band (ferns/foxgloves/brambles/holly)` + trailer.

---

### Task 9: Wire `verify-flora` into the suite

**Files:** Modify `package.json`.

- [ ] **Step 1:** Add `"verify:flora": "node scripts/verify-flora.mjs",` next to `verify:foliage`, and insert `node scripts/verify-flora.mjs` into the `verify` chain right after `node scripts/verify-foliage.mjs`.
- [ ] **Step 2: Run** `npm run verify` → all `RESULT: PASS`, exit 0.
- [ ] **Step 3: Commit** — `test: add verify-flora to the verify suite` + trailer.

---

## Self-Review

**Spec coverage:** scatter flowers by window (T1,3,4,6); off-grid/jittered/clumped (T4); lineside dense + multiple-per-cell (T4 lineside mode, T8); **varied** lineside, never bramble-only (T8); thick ferns curl + foxglove spike (T2); **holly** evergreen + winter red berries (T2,3,8); **brambles die back winter / regrow spring** (T2 die-back branch); bilberries seasonal on the bush (T2 deberry, T3, T6); **foraging leaves the plant** (T6 `fruitPicked` hook, wired by forage spec); clearance preserved (T8 S3); deterministic/no-relay/no-remesh (whole design).

**Placeholder scan:** pure tasks (1,3,4,5,9) complete code + commands; rendering tasks (2,6,7,8) complete code + explicit manual checks (visual output can't go through CI).

**Type/name consistency:** `activeScatter→[{tile}]`, `activeAdornments→[{tile,bush}]` (T3) consumed in T6; `cellInstances(seed,cx,cz,mode,tile)→[{dx,dz,yaw,scale,variant}]` (T4) used T6; `getMaterials().cutout` (T5) used T6; `FloraLayer(scene, world)` (T7) matches T6; new `TILE.*`/`B.*` (T2) used in T3/6/8; `season.brambleFlower/blackberry` (T1), bilberry→`heatherBloom`, holly→`frost`.

**Open risks:** `railInfo` per-cell across the window each rebuild — if it hitches (T7 S4), cache the lineside test or shrink RADIUS / lengthen throttle (rebuilds are throttled, not per-frame). Instance counts on the dense lineside × RADIUS 40 — reduce RADIUS or split rebuild across frames if needed. Holly/bramble blocks are new cutout flora — confirm `isCutout` covers them via the `kind: 'cutout'` def (it keys off `kind`, so it should).
