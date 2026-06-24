# Moors Phase A — Farms + Animal Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.
>
> **Commits are HELD** — James's standing rule is to commit only when he asks. So the checkpoint at the end of each task is a green `npm run verify` (and `npm run build` where client code changed), **not** a `git commit`. Do not commit.

**Goal:** Kill the bad-animal-spawn bug (beasts on trees/roofs, jumping to reach them), confine livestock with walls/fences, and add ~10–12 farmsteads across the moors as a standalone, visible world layer.

**Architecture:** Two independent parts. (1) **Animal cleanup** — a shared walkable-ground predicate fixes `rescueStuck` (the only teleport, and the source of tree/roof perching), and animals stop hopping built barriers so walls/fences actually hold them; people (villagers) are exempt. (2) **Farms** — a deterministic `farmSites()` + `stampFarm()` mirroring the existing `worksSites()`/`stampWorks()` pattern, each a farmhouse + barn + walled fold with confined livestock. All moors-gated (`geo.realWorld`); stylised world untouched.

**Tech stack:** Vanilla JS + three.js (`src/entities.js`, `src/moorsgeo.js`, `src/worldgen.js`, `src/defs.js`). Headless tests are Node `.mjs` scripts in `scripts/` using `new Gen(MOORS_SEED)`, wired into `npm run verify`. Runtime behaviour (mob movement) is checked via `preview_eval` in the running game.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/entities.js` | modify | `isWalkableGround` helper; fix `rescueStuck`; reuse the helper in the 3 spawn paths; animal barrier-no-hop confinement |
| `src/moorsgeo.js` | modify | `farmSites()` (mirror `worksSites()` @568), `_farmBuildings(site)` (mirror `_townBuildings()` @488); extend `nearTownBuilding`/`villageColumn` (@558/@548) to include farms |
| `src/worldgen.js` | modify | `stampFarm()` (mirror `stampWorks()` @973, reuse `stampBuildingColumn()` @1040); call it in the chunk pipeline (after `stampWorks` @499); spawn fold livestock |
| `scripts/verify-farms-animals.mjs` | create | headless assertions: walkable-ground predicate, farm placement, stamped farm blocks |
| `package.json` | modify | add the new verify script to the `verify` chain |

---

## Part 1 — Animal cleanup

### Task 1: `isWalkableGround` predicate (DRY the spawn checks)

**Files:** Modify `src/entities.js` (top of the module, near the other module consts).

The 3 spawn paths and `rescueStuck` each inline a "valid ground?" check (or, in `rescueStuck`, the wrong one). Extract a single predicate.

- [ ] **Step 1 — add the predicate** near the top of `src/entities.js` (after the imports):

```js
// The only blocks a land beast may stand or spawn on: open, walkable ground.
// NOT trees (LOG/LEAVES), NOT buildings (PLANKS/COBBLE/THATCH...), NOT water/bog.
const WALKABLE_GROUND = new Set([B.GRASS, B.PEAT, B.DIRT, B.STONE, B.SAND]);
function isWalkableGround(b) { return WALKABLE_GROUND.has(b); }
```

- [ ] **Step 2 — reuse it** in the three spawn scans. In `spawnNaturally` (~line 1006), `spawnNear` (~1046) and `forceSpawnGroup` (~1084), replace the inline `(b === B.GRASS || b === B.PEAT || b === B.DIRT || b === B.STONE || b === B.SAND)` with `isWalkableGround(b)`. Behaviour is identical — this is a refactor that locks the rule in one place.

- [ ] **Step 3 — checkpoint:** `npm run build` (no behaviour change, just confirm it compiles). Expected: `BUILD ok`.

### Task 2: Fix `rescueStuck` — nearest valid ground, never trees/roofs

**Files:** Modify `src/entities.js:1058` (`rescueStuck`). **Test:** `scripts/verify-farms-animals.mjs` (the pure predicate) + `preview_eval` (the integration).

The bug: `rescueStuck` pops a stuck beast to the *highest* block within 5 that isn't water/bog — which is a tree canopy or a roof. Fix: pop to the **nearest walkable ground** (using the Task 1 predicate), never foliage/buildings/water.

- [ ] **Step 1 — write the failing assertion** in `scripts/verify-farms-animals.mjs` (create it; see Task 8 for the full file — start it here):

```js
import assert from 'node:assert';
import { B } from '../src/defs.js';
// Re-declare the predicate the same way entities.js does, and assert its contract.
const WALKABLE_GROUND = new Set([B.GRASS, B.PEAT, B.DIRT, B.STONE, B.SAND]);
const isWalkableGround = b => WALKABLE_GROUND.has(b);
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
ok(isWalkableGround(B.GRASS) && isWalkableGround(B.PEAT), 'grass + peat are walkable ground');
ok(!isWalkableGround(B.LOG) && !isWalkableGround(B.LEAVES) && !isWalkableGround(B.PLANKS) && !isWalkableGround(B.WATER) && !isWalkableGround(B.FENCE),
  'trees, buildings, water and fences are NOT walkable ground (rescueStuck/spawn must reject them)');
```

- [ ] **Step 2 — run it, expect FAIL** (the script doesn't exist / isn't wired yet): `node scripts/verify-farms-animals.mjs` → fails until the file + predicate are right. Once the two `ok()`s pass, this guards the rule.

- [ ] **Step 3 — rewrite `rescueStuck`** (`src/entities.js:1058`) to pick the nearest walkable ground:

```js
  rescueStuck(mob) {
    const sx = Math.floor(mob.pos.x), sz = Math.floor(mob.pos.z);
    let best = null, bestD = 1e9;
    for (let dx = -5; dx <= 5; dx++) for (let dz = -5; dz <= 5; dz++) {
      const x = sx + dx, z = sz + dz;
      if (!this.world.isLoaded(x, z)) continue;
      for (let y = HEIGHT - 2; y > 1; y--) {
        const b = this.world.getBlock(x, y, z);
        if (b === B.AIR) continue;
        // only a column whose TOP surface is walkable ground counts — so a beast is never
        // popped onto a tree canopy or a roof, only onto honest ground; nearest wins, not highest.
        if (isWalkableGround(b) && this.world.getBlock(x, y + 1, z) === B.AIR) {
          const d = dx * dx + dz * dz;
          if (d < bestD) { bestD = d; best = { x, z, y }; }
        }
        break;
      }
    }
    if (best) { mob.pos.x = best.x + 0.5; mob.pos.z = best.z + 0.5; mob.pos.y = best.y + 1.05; mob.vel.x = mob.vel.y = mob.vel.z = 0; return true; }
    return false;
  }
```

- [ ] **Step 4 — run the headless assertions:** `node scripts/verify-farms-animals.mjs` → PASS.

- [ ] **Step 5 — runtime check via preview.** `npm run build`, then in the running game `preview_eval`: spawn a beast, force it stuck near a tree/building, run frames, and assert it never lands on a non-ground block:

```js
(async () => {
  await game.startMoorsWorld();
  const { B } = await import('/src/defs.js');
  const e = game.entities;
  // drop a sheep beside a tree, jam it, trigger the rescue, then read the block under it
  const x = 1415, z = 2606; // Grosmont — has buildings + trees nearby
  const m = e.spawnMob('sheep', x + 0.5, 60, z + 0.5);
  if (!m) return 'no spawn';
  for (let i = 0; i < 30; i++) game.frame();
  e.rescueStuck(m);
  const fy = Math.floor(m.pos.y - 0.1);
  const under = game.world.getBlock(Math.floor(m.pos.x), fy, Math.floor(m.pos.z));
  return { landedOn: under, onGround: [B.GRASS, B.PEAT, B.DIRT, B.STONE, B.SAND].includes(under), notTreeOrRoof: ![B.LOG, B.LEAVES, B.PLANKS, B.THATCH, B.COBBLE].includes(under) };
})()
```

Expected: `onGround: true`, `notTreeOrRoof: true`.

### Task 3: Animals don't hop built barriers (walls/fences confine them; people pass)

**Files:** Modify `src/entities.js` — the hop-up at ~1694, and add an `isAnimal`/`isBarrier` helper. **Test:** `verify-farms-animals.mjs` (the `isBarrier` predicate) + `preview_eval` (the confinement).

The hop (`if (mob.hitWall && mob.onGround && moving) mob.vel.y = 7.5`) lets a beast hop a 1-block wall and escape a fold. Gate it: an **animal** won't hop a **built barrier** (fence/gate/cobble wall); terrain hops and people (villagers) hop as before.

- [ ] **Step 1 — add predicates** near the Task 1 helper in `src/entities.js`:

```js
// Built stock barriers a beast must not hop out over (walls + hurdles + gates).
const BARRIER = new Set([B.FENCE, B.GATE, B.COBBLE]);
function isBarrier(b) { return BARRIER.has(b); }
// People (villagers) cross walls/fences/water freely; only true beasts are penned.
function isAnimal(mob) { return mob.type !== 'villager' && mob.type !== 'coble'; }
```

- [ ] **Step 2 — add the `isBarrier` assertion** to `scripts/verify-farms-animals.mjs`:

```js
const BARRIER = new Set([B.FENCE, B.GATE, B.COBBLE]);
const isBarrier = b => BARRIER.has(b);
ok(isBarrier(B.FENCE) && isBarrier(B.COBBLE) && !isBarrier(B.GRASS) && !isBarrier(B.DIRT),
  'fences + cobble walls are barriers; bare ground is not');
```

- [ ] **Step 3 — run, expect PASS** after Step 4 wiring: `node scripts/verify-farms-animals.mjs`.

- [ ] **Step 4 — gate the hop** at `src/entities.js:1694`:

```js
      // hop up single blocks — but a penned beast won't hop a built barrier (wall/hurdle/gate),
      // so walls and folds actually hold stock. Terrain still hops; people cross freely.
      if (mob.hitWall && mob.onGround && (Math.abs(wishX) > 0.1 || Math.abs(wishZ) > 0.1)) {
        const ax = Math.floor(mob.pos.x + wishX * 0.6), az = Math.floor(mob.pos.z + wishZ * 0.6);
        const ahead = this.world.getBlock(ax, Math.floor(mob.pos.y) + 1, az);
        if (!(isAnimal(mob) && isBarrier(ahead))) mob.vel.y = 7.5;
      }
```

- [ ] **Step 5 — runtime check.** `npm run build`, then `preview_eval`: pen a sheep inside a 2×2 cobble/fence ring and confirm it can't escape over ~6s of frames:

```js
(async () => {
  await game.startMoorsWorld();
  const { B } = await import('/src/defs.js');
  const g = game.world, e = game.entities;
  const x = 1604, z = 2204; const gy = g.gen.height(x, z);
  // build a small fenced fold and drop a sheep in it
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (Math.abs(dx) === 2 || Math.abs(dz) === 2) g.setBlock(x + dx, gy + 1, z + dz, B.FENCE);
  const m = e.spawnMob('sheep', x + 0.5, gy + 1.1, z + 0.5);
  m.wanderYaw = 0; m.state = 'wander';
  for (let i = 0; i < 360; i++) game.frame(); // ~6s
  return { stillInside: Math.abs(m.pos.x - x) < 2.5 && Math.abs(m.pos.z - z) < 2.5, at: Math.round(m.pos.x) + ',' + Math.round(m.pos.z) };
})()
```

Expected: `stillInside: true` (the sheep stays penned).

---

## Part 2 — Farms

### Task 4: `farmSites()` — pick ~10–12 farmstead sites

**Files:** Modify `src/moorsgeo.js` (add after `worksSites()` @568). **Test:** `verify-farms-animals.mjs`.

Mirror the structure of `worksSites()` (@568): a deterministic scan of candidate cells, keeping ones that are dry, roughly flat, above the waterline, clear of rails (`railInfo` d ≥ 3), clear of rivers (`riverWaterLevel == null`), and clear of town buildings (`nearTownBuilding`). Spread them with a minimum spacing so they dot the dales rather than clump.

- [ ] **Step 1 — write the failing test** in `scripts/verify-farms-animals.mjs`:

```js
import { Gen, MOORS_SEED } from '../src/worldgen.js';
const gen = new Gen(MOORS_SEED), geo = gen.geo;
const farms = geo.farmSites();
ok(farms.length >= 10 && farms.length <= 14, `~10-12 farms placed (got ${farms.length})`);
for (const f of farms) {
  ok(geo.height(f.x, f.z) >= 27, `farm ${f.x},${f.z} on dry land`);
  ok(geo.riverWaterLevel(f.x, f.z) == null, `farm ${f.x},${f.z} not in a river`);
  const ri = geo.railInfo(f.x, f.z); ok(!ri || ri.d >= 3, `farm ${f.x},${f.z} clear of the rails`);
  ok(!geo.nearTownBuilding(f.x, f.z, 8), `farm ${f.x},${f.z} clear of town buildings`);
}
// deterministic
const farms2 = new Gen(MOORS_SEED).geo.farmSites();
ok(JSON.stringify(farms) === JSON.stringify(farms2), 'farm sites are deterministic for the seed');
```

- [ ] **Step 2 — run, expect FAIL** (`geo.farmSites is not a function`): `node scripts/verify-farms-animals.mjs`.

- [ ] **Step 3 — implement `farmSites()`** in `src/moorsgeo.js` (mirror `worksSites()` @568; cache on `this._farmSites`). Scan the data extent on a coarse grid, score-and-keep dry/flat/clear cells, enforce a min spacing (~120 blocks) and a count cap (12), in the dales/moor-edges (prefer cells 40–160 blocks from a town centre — near enough to belong to the parish, far enough to be isolated holdings):

```js
  farmSites() {
    if (this._farmSites) return this._farmSites;
    const out = [];
    if (!this.realWorld || !this.worldBounds) { this._farmSites = out; return out; }
    const { minX, maxX, minZ, maxZ } = this.worldBounds();
    const flat = (x, z) => { const h = this.height(x, z); let mx = 0; for (const [dx, dz] of [[6,0],[-6,0],[0,6],[0,-6]]) mx = Math.max(mx, Math.abs(this.height(x+dx, z+dz) - h)); return mx <= 3; };
    const nearTown = (x, z) => this.villages.some(v => Math.hypot(v.x - x, v.z - z) < 40);
    const inParish = (x, z) => this.villages.some(v => { const d = Math.hypot(v.x - x, v.z - z); return d >= 40 && d <= 170; });
    const far = (x, z) => out.every(f => Math.hypot(f.x - x, f.z - z) > 120);
    // deterministic sweep on a 24-block grid
    for (let x = minX + 30; x < maxX - 30 && out.length < 12; x += 24) {
      for (let z = minZ + 30; z < maxZ - 30 && out.length < 12; z += 24) {
        if (this.height(x, z) < 28) continue;                 // dry land, above the becks
        if (this.coastT(x, z) > 0) continue;                  // not the shore
        if (this.riverWaterLevel(x, z) != null) continue;     // not in a river
        const ri = this.railInfo(x, z); if (ri && ri.d < 6) continue; // well clear of the line
        if (!flat(x, z)) continue;
        if (nearTown(x, z) || !inParish(x, z)) continue;
        if (this.nearTownBuilding(x, z, 10)) continue;
        if (!far(x, z)) continue;
        out.push({ x, z, seed: (x * 73856093) ^ (z * 19349663) });
      }
    }
    this._farmSites = out;
    return out;
  }
```

- [ ] **Step 4 — run, expect PASS:** `node scripts/verify-farms-animals.mjs`. If the count is off, widen/narrow the grid step (24) or the parish band (40–170). Re-run until 10–12.

### Task 5: `_farmBuildings(site)` + farm-aware column lookups

**Files:** Modify `src/moorsgeo.js` (add `_farmBuildings`, mirroring `_townBuildings` @488; extend `nearTownBuilding` @558 and `villageColumn` @548). **Test:** `verify-farms-animals.mjs`.

Each farm gets a deterministic footprint: a **farmhouse** (a small `biz`-style building), a **barn** beside it, and a **walled fold** (a fenced rectangle) for stock — laid out from the site seed. Then trees/spawns must know farms exist, exactly as they know town buildings.

- [ ] **Step 1 — failing test:**

```js
const f0 = geo.farmSites()[0];
const blds = geo._farmBuildings(f0);
ok(blds.some(b => b.kind === 'farmhouse') && blds.some(b => b.kind === 'barn') && blds.some(b => b.kind === 'fold'),
  'a farm has a farmhouse, a barn and a fold');
// farm-aware lookups
ok(geo.nearTownBuilding(blds[0].x0, blds[0].z0, 1), 'nearTownBuilding now reports farm buildings too');
```

- [ ] **Step 2 — run, expect FAIL.**

- [ ] **Step 3 — implement `_farmBuildings(site)`** in `src/moorsgeo.js`, mirroring `_townBuildings(v)` (@488) — deterministic from `site.seed`, cached on `site._bld`. Return building boxes `{x0,x1,z0,z1, kind, wall, roof}` plus a `fold` box (the fenced pen). Keep the footprint small (a holding, not a town):

```js
  _farmBuildings(site) {
    if (site._bld) return site._bld;
    const r = mulberry32(site.seed >>> 0);          // same RNG helper villages use
    const { x, z } = site;
    const blds = [];
    // farmhouse: ~6x5, fronting roughly south
    blds.push({ x0: x - 3, x1: x + 3, z0: z - 2, z1: z + 3, kind: 'farmhouse', wall: 'COBBLE', roof: 'slate' });
    // barn: ~5x4, set a few blocks to one side
    const bx = x + 7 + ((r() * 3) | 0);
    blds.push({ x0: bx, x1: bx + 5, z0: z - 2, z1: z + 2, kind: 'barn', wall: 'PLANKS', roof: 'slate' });
    // fold: a fenced pen for stock, on the other side of the yard
    const fx = x - 12 - ((r() * 4) | 0);
    blds.push({ x0: fx, x1: fx + 8, z0: z - 4, z1: z + 4, kind: 'fold', wall: 'FENCE', roof: null });
    site._bld = blds;
    return blds;
  }
```

(Confirm the `mulberry32` import already used by `_townBuildings`; reuse the same one. Match `_townBuildings`' building-box field names exactly so `stampBuildingColumn` and `nearTownBuilding` accept them.)

- [ ] **Step 4 — make `nearTownBuilding` (@558) and `villageColumn` (@548) farm-aware.** After their village loop, add a farm loop:

```js
    for (const f of this.farmSites())
      for (const b of this._farmBuildings(f))
        if (x >= b.x0 - pad && x <= b.x1 + pad && z >= b.z0 - pad && z <= b.z1 + pad) return true; // nearTownBuilding
```

(and the analogous block returning the building in `villageColumn`). This makes the tree-skip (worldgen) and the spawn checks treat farms like town buildings — no trees through the farmhouse, no beasts spawning on the barn roof (which Task 2 already prevents).

- [ ] **Step 5 — run, expect PASS:** `node scripts/verify-farms-animals.mjs`.

### Task 6: `stampFarm()` — build the farmsteads into the world

**Files:** Modify `src/worldgen.js` (add `stampFarm`, mirroring `stampWorks` @973 and reusing `stampBuildingColumn` @1040; call it in the chunk pipeline after `stampWorks` @499). **Test:** `verify-farms-animals.mjs` (block-reads).

- [ ] **Step 1 — failing test** (read the stamped world via `generateChunk`, like `verify-industry-ironstone.mjs` reads works):

```js
const f = geo.farmSites()[0];
const blds = geo._farmBuildings(f);
const house = blds.find(b => b.kind === 'farmhouse');
// generate the chunks under the farmhouse, then read its walls
const CH = 16; for (let cx = (house.x0 >> 4) - 1; cx <= (house.x1 >> 4) + 1; cx++) for (let cz = (house.z0 >> 4) - 1; cz <= (house.z1 >> 4) + 1; cz++) gen.generateChunk(cx, cz);
let wall = 0; const g = geo.height(house.x0, house.z0);
for (let y = g + 1; y <= g + 3; y++) if (gen.blockAt(house.x0, y, house.z0) === B.COBBLE) wall++;
ok(wall >= 2, 'farmhouse has standing cobble walls (>=2 high)');
const fold = blds.find(b => b.kind === 'fold');
ok(gen.blockAt(fold.x0, geo.height(fold.x0, fold.z0) + 1, fold.z0) === B.FENCE, 'the fold is fenced');
```

(Use whatever single-block read `verify-industry-ironstone.mjs` uses — `gen.oreAt`/`gen.blockAt`/`gen.generateChunk` then read; match that file's exact API.)

- [ ] **Step 2 — run, expect FAIL.**

- [ ] **Step 3 — implement `stampFarm(data, cx, cz)`** in `src/worldgen.js`, mirroring `stampWorks` (@973): for each farm whose building footprints intersect this chunk, stamp the farmhouse + barn via `stampBuildingColumn` (@1040, the same call `stampVillage` uses @892), and stamp the fold as a 2-high `FENCE`/`COBBLE` ring on the ground (so Task 3 confines stock). Clear trees inside footprints (the tree-skip already honours `nearTownBuilding`, now farm-aware). Gate to `this.geo.realWorld`.

```js
  stampFarm(data, cx, cz) {
    if (!this.geo.realWorld) return;
    const x0 = cx * 16, z0 = cz * 16;
    for (const f of this.geo.farmSites()) {
      for (const b of this.geo._farmBuildings(f)) {
        if (b.x1 < x0 - 1 || b.x0 > x0 + 16 || b.z1 < z0 - 1 || b.z0 > z0 + 16) continue; // not in this chunk
        if (b.kind === 'fold') {
          // a 2-high fenced ring on the ground — penned, un-hoppable
          for (let x = b.x0; x <= b.x1; x++) for (let z = b.z0; z <= b.z1; z++) {
            if (x !== b.x0 && x !== b.x1 && z !== b.z0 && z !== b.z1) continue; // ring only
            const lx = x - x0, lz = z - z0; if (lx < 0 || lx > 15 || lz < 0 || lz > 15) continue;
            const g = this.geo.height(x, z);
            data.set(lx, g + 1, lz, B.FENCE); data.set(lx, g + 2, lz, B.FENCE);
          }
        } else {
          // farmhouse / barn — reuse the town building stamper, column by column
          for (let x = b.x0; x <= b.x1; x++) for (let z = b.z0; z <= b.z1; z++) {
            const lx = x - x0, lz = z - z0; if (lx < 0 || lx > 15 || lz < 0 || lz > 15) continue;
            this.stampBuildingColumn(data, lx, lz, x, z, b, this.geo.height(x, z));
          }
        }
      }
    }
  }
```

(Match the exact `data.set`/`stampBuildingColumn` signatures used by `stampVillage`/`stampWorks` in this file — copy their call shape.)

- [ ] **Step 4 — call it in the pipeline.** In the chunk-generation method, right after the `stampWorks(data, cx, cz)` call (@499): add `this.stampFarm(data, cx, cz);`.

- [ ] **Step 5 — run the headless test:** `node scripts/verify-farms-animals.mjs` → PASS. Then `npm run build` and `preview_eval` to eyeball a farm:

```js
(async () => { await game.startMoorsWorld(); const f = game.world.gen.geo.farmSites()[0];
  game.player.pos = { x: f.x, y: 60, z: f.z }; game.player.flying = true; game.state = 'playing';
  for (let i = 0; i < 150; i++) game.frame(); return { farmAt: f.x + ',' + f.z }; })()
```

(then `preview_screenshot` to confirm the farmhouse + barn + fenced fold render on solid ground.)

### Task 7: Livestock in the folds

**Files:** Modify `src/worldgen.js` or `src/entities.js` spawn seeding (wherever village/works ambient spawns are triggered). **Test:** `preview_eval`.

Seed a few sheep (and the odd cow) inside each farm's fold so the holdings look worked — confined by Task 3's barrier rule.

- [ ] **Step 1 — find where ambient mobs are seeded** near villages (search `spawnNaturally`/the spawn timer in `entities.js:1464`, or a worldgen hook). Add, when a farm fold is loaded and under-populated, a small flock inside it via `forceSpawnGroup(type, foldCx, foldCz, n)` (which Task 1/2 made ground-safe). Keep it deterministic-ish and capped (e.g., 3–5 sheep per fold, 1 cow at some).

- [ ] **Step 2 — runtime check via preview:** stand at a farm (the Task 6 eval), run frames, and assert sheep are present and stay inside the fold bounds over ~10s:

```js
(async () => { await game.startMoorsWorld(); const f = game.world.gen.geo.farmSites()[0];
  game.player.pos = { x: f.x, y: 50, z: f.z }; game.player.flying = true; game.state = 'playing';
  for (let i = 0; i < 600; i++) game.frame();
  const fold = game.world.gen.geo._farmBuildings(f).find(b => b.kind === 'fold');
  const sheep = game.entities.mobs.filter(m => m && m.type === 'sheep');
  const inFold = sheep.filter(m => m.pos.x >= fold.x0 && m.pos.x <= fold.x1 && m.pos.z >= fold.z0 && m.pos.z <= fold.z1);
  return { sheepNear: sheep.length, stayedInFold: inFold.length }; })()
```

Expected: some sheep, and they stay within the fold (Task 3 holds them).

### Task 8: Wire the verify script + final green

**Files:** `package.json`, `scripts/verify-farms-animals.mjs` (already created across Tasks 2–6).

- [ ] **Step 1 — add to the verify chain** in `package.json`: append `&& node scripts/verify-farms-animals.mjs` to the `verify` script (after `verify-industry-ironstone.mjs`).
- [ ] **Step 2 — final checkpoint:** `npm run verify` (all green, incl. the new script) and `npm run build` (`BUILD ok`). Do **not** commit (James's rule) — report green and stop.

---

## Self-review

**Spec coverage** (against §6 + §9 + Phase A of the spec):
- Spawn on valid ground only → Tasks 1, 2 (predicate + `rescueStuck` + reused in all 3 spawn paths). ✓
- Never leap large distances → Task 2 (nearest-ground, no highest-surface teleport; the only teleport in the code). ✓
- Animals confined by walls/fences → Task 3 (barrier-no-hop). Tracks + rivers already confined (lineside push @1659, water-shy @1671) and unchanged. ✓
- People pass → Task 3 gates the new rule to `isAnimal` (villagers exempt); full people-pathing is Phase B, noted. ✓
- ~10–12 farmsteads, farmhouse + barn + walled fold, clear of rails/rivers/towns → Tasks 4, 5, 6. ✓
- Livestock held in folds → Tasks 6 (2-high fold) + 7 + 3. ✓
- Moors-gated → `farmSites`/`stampFarm` guard on `realWorld`; stylised untouched. ✓
- Tests → Task 8 (headless) + the per-task `preview_eval` (runtime). ✓

**Placeholder scan:** the farm building/stamp code says "match the exact signature used by `stampVillage`/`stampWorks`/`_townBuildings`" — this is a deliberate *follow-the-established-pattern* instruction with the exact source locations given (@488/@882/@973/@1040), not a vague TODO. The executor reads those four functions first.

**Type consistency:** `isWalkableGround`/`isBarrier`/`isAnimal` used identically across Tasks 1–3; `_farmBuildings` returns the same `{x0,x1,z0,z1,kind,wall,roof}` box shape `_townBuildings` uses and `stampBuildingColumn` consumes; `farmSites()` items `{x,z,seed}` used in 4/5/6 consistently.

**First action for the executor:** read `worksSites` (moorsgeo:568), `_townBuildings` (moorsgeo:488), `stampWorks` (worldgen:973), `stampBuildingColumn` (worldgen:1040), and `verify-industry-ironstone.mjs`, to copy their exact shapes before writing Tasks 4–6.
