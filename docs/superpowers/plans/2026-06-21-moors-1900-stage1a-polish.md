# Moors 1900 — Stage 1a (render-only polish) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the real-Moors world read as the Moors and kill the jagged station building — clean axis-aligned station buildings, the famous moor crosses + Wade's Causeway at their true sites, all render-only (no `heightRaw` change, so no relay-parity risk).

**Architecture:** Three render-path changes. (A) The station *building* footprint is stamped on a **cardinal** basis (N/S or E/W nearest the rail tangent) instead of the diagonal tangent basis that staircased it; platforms/track stay rail-parallel. (B) Moor crosses + Wade's Causeway are added to `data/moors-data.json` (real OSGB refs) and rendered by a `realWorld`-gated branch in `worldgen.stampLandmarks` (crosses) and the existing road-surface path via `moorsgeo.onRoad` (causeway). None of this touches `heightRaw`, the relay mirror, or `verify-geo-parity`.

**Tech Stack:** Vanilla ES modules (Vite + three.js client), Python 3.13 build script (`scripts/build-moors-data.py`), headless Node verify scripts (`scripts/verify-*.mjs`, wired into `npm run verify`). Deploy = `npx vercel deploy --prod --yes` from local source.

**Spec:** [`docs/superpowers/specs/2026-06-21-moors-1900-stage1-landscape-design.md`](../specs/2026-06-21-moors-1900-stage1-landscape-design.md) (Units A, B-built, C-fingerposts).

**Preconditions (verified 2026-06-21):** OS tiles present at `C:\Users\James\moors-data-build\work\tiles\` (28 `.asc`), `openrivers.gpkg` + 42 `on_*.csv` present, Python 3.13.7 on PATH, `data/moors-data.json` git-clean (so any regenerate is reversible with `git checkout data/moors-data.json`).

---

## Task 0: Branch

- [ ] **Step 1: Create the working branch**

Run:
```bash
git -C /c/Users/James/Desktop/Moorcraft checkout -b feat/moors-1900-stage1a
```
Expected: `Switched to a new branch 'feat/moors-1900-stage1a'`. (Local only — do NOT push; James deploys from local source and commits/pushes on request.)

---

## Task 1: `stationOrient` — cardinal basis nearest a rail tangent (pure helper)

The root cause of the jagged building: `worldgen.stampStations`'s `buildOne` lays the footprint along the rail tangent (`cell(a,w)`) and rounds each cell, staircasing diagonal walls. This helper returns the world-cardinal basis nearest the tangent so the building can be a clean box. Lives in the already-pure, already-shared `railpath.js`.

**Files:**
- Modify: `src/railpath.js` (add + export `stationOrient`)
- Create: `scripts/verify-station-align.mjs`
- Modify: `package.json` (add the check to `verify`)

- [ ] **Step 1: Write the failing test**

Create `scripts/verify-station-align.mjs`:
```js
// Headless check: stationOrient snaps a rail tangent to the nearest world cardinal,
// so a station BUILDING can be stamped as a clean n/s or e/w box (Stage 1a, Unit A).
import assert from 'node:assert';
import { stationOrient } from '../src/railpath.js';

let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

// near-N/S tangent (+x = north) → long axis runs north
eq(stationOrient(0.98, 0.20).along, [1, 0], 'NNE tangent → along +x');
eq(stationOrient(-0.95, 0.31).along, [-1, 0], 'SSW tangent → along -x');
// near-E/W tangent (+z = east) → long axis runs east
eq(stationOrient(0.20, 0.98).along, [0, 1], 'ENE tangent → along +z');
eq(stationOrient(0.20, -0.98).along, [0, -1], 'WNW tangent → along -z');
// 45° tie favours the x (north) axis deterministically
eq(stationOrient(0.7, 0.7).along, [1, 0], '45° tie → along +x');
// across is the left-perpendicular of along, and both are unit cardinals
eq(stationOrient(1, 0).across, [0, -1], 'along +x → across -z');
eq(stationOrient(0, 1).across, [1, 0], 'along +z → across +x');
// zero tangent must not produce [0,0] (degenerate) — defaults to +x
eq(stationOrient(0, 0).along, [1, 0], 'zero tangent → default +x');

console.log(`verify-station-align: ${n} assertions OK`);
```

- [ ] **Step 2: Run it to verify it fails**

Run:
```bash
node scripts/verify-station-align.mjs
```
Expected: FAIL — `SyntaxError`/`TypeError` that `stationOrient` is not exported by `railpath.js`.

- [ ] **Step 3: Add the helper**

In `src/railpath.js`, add this exported function (top-level, near the other exports):
```js
// Cardinal basis (n/s or e/w) nearest a rail tangent. A station BUILDING stamped on
// this basis is a clean world-axis box even where the line runs diagonally — stamping
// on the raw tangent and rounding is what staircases the walls. Platforms stay
// rail-parallel; only the building uses this. `along` is the long axis, `across` its
// left-perpendicular; both are unit cardinals. Ties (45°) favour +x deterministically.
export function stationOrient(tx, tz) {
  const along = Math.abs(tx) >= Math.abs(tz) ? [Math.sign(tx) || 1, 0] : [0, Math.sign(tz) || 1];
  const across = [along[1], -along[0]];
  return { along, across };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run:
```bash
node scripts/verify-station-align.mjs
```
Expected: `verify-station-align: 8 assertions OK`.

- [ ] **Step 5: Wire into `npm run verify`**

In `package.json`, find the `"verify"` script and append ` && node scripts/verify-station-align.mjs` to its command (same pattern as the existing `verify-*` entries). Then run:
```bash
npm run verify
```
Expected: all checks green, including `verify-station-align: 8 assertions OK`.

- [ ] **Step 6: Commit**

```bash
git add src/railpath.js scripts/verify-station-align.mjs package.json
git commit -m "feat(moors-1a): stationOrient cardinal-basis helper + test"
```

---

## Task 2: Stamp the station building as a cardinal box (fixes the jagged building)

Swap `buildOne`'s footprint from the diagonal `cell()` to a cardinal `boxCell()`. Platforms, track, lamps, the departures board, the trainshed and footbridge **keep `cell()`** (they follow/span the rails). Only `buildOne`'s own stamping changes.

**Files:**
- Modify: `src/worldgen.js` (`stampStations`, the `buildOne` closure)

- [ ] **Step 1: Import the helper**

At the top of `src/worldgen.js`, add `stationOrient` to the existing `railpath.js` import. Find the line importing from `./railpath.js` and add `stationOrient` to its named imports (e.g. `import { buildRailPath, samplePos, railInfo, stationOrient } from './railpath.js';`). If `worldgen.js` does not already import from `railpath.js`, add: `import { stationOrient } from './railpath.js';`

- [ ] **Step 2: Define `boxCell` alongside `cell`**

In `stampStations`, immediately after the existing line:
```js
      const ux = sp.tx, uz = sp.tz, px = uz, pz = -ux;
      const cell = (a, w) => [Math.round(sp.x + ux * a + px * w), Math.round(sp.z + uz * a + pz * w)];
```
add:
```js
      // The BUILDING is stamped on a world-cardinal basis (n/s or e/w) so it's a clean
      // box, not a staircased diagonal. Platforms/track/furniture keep `cell` (rail-parallel).
      const { along: bAl, across: bAc } = stationOrient(ux, uz);
      const bX = Math.round(sp.x), bZ = Math.round(sp.z);
      const boxCell = (a, w) => [bX + bAl[0] * a + bAc[0] * w, bZ + bAl[1] * a + bAc[1] * w];
```

- [ ] **Step 3: Use `boxCell` inside `buildOne`**

Inside the `buildOne` closure, replace **every** `cell(` call with `boxCell(`. There are three:
1. In the main `for (let a…) for (let w…)` loop: `const [wx, wz] = cell(a, sd * w);` → `const [wx, wz] = boxCell(a, sd * w);`
2. In the `fr` helper: `const fr = (a, w, y, id) => { const [wx, wz] = cell(a, sd * w); put(wx, y, wz, id); };` → `…const [wx, wz] = boxCell(a, sd * w);…`
3. The chimney: `const [chx, chz] = cell(a0 + 1, sd * Math.round(wc));` → `const [chx, chz] = boxCell(a0 + 1, sd * Math.round(wc));`

Leave `stampTrainshed`, `stampFootbridge`, the platform loop, lanterns, signpost, and the departures board **untouched** (they correctly use `cell`).

- [ ] **Step 4: Build to verify no syntax error**

Run:
```bash
npm run build
```
Expected: exit 0 (Vite build succeeds).

- [ ] **Step 5: Live-verify the building is now a clean box**

The moors world's Pickering station is the photographed offender. Verify via the frame-pump harness (screenshots time out on a backgrounded tab). Start the preview (`preview_start`), then `preview_eval`:
```js
await game.startMoorsWorld();
for (let i = 0; i < 200; i++) game.frame();
// teleport to Pickering and look down the platform
const p = game.world.gen.geo.railway().find(s => s.name === 'Pickering');
game.player.pos.set(p.x, game.world.gen.geo.height(p.x, p.z) + 30, p.z);
for (let i = 0; i < 60; i++) game.frame();
({ chunks: game.world.meshedCount?.() ?? 'n/a', errors: 0 });
```
Then `preview_console_logs` (expect zero errors) and a `preview_screenshot` in a foreground tab if available. Expected: the station building reads as a clean rectangular slate building aligned to N/S or E/W, no diagonal staircasing or holes. (Note for Stage 2: the trainshed/platform still follow the diagonal rail — the rail-kink fixes that co-alignment later.)

- [ ] **Step 6: Commit**

```bash
git add src/worldgen.js
git commit -m "fix(moors-1a): stamp station building as a cardinal box (kills the jagged station)"
```

---

## Task 3: Add moor crosses + Wade's Causeway to the data (build script + regenerate)

Real landmarks at true OSGB references. Test-first: the verify asserts the data carries them; then we emit them and regenerate.

**Files:**
- Create: `scripts/verify-landmarks-moors.mjs`
- Modify: `scripts/build-moors-data.py` (`build_landmarks`)
- Modify: `data/moors-data.json` (regenerated artefact)
- Modify: `package.json` (add the check to `verify`)

- [ ] **Step 1: Write the failing test**

Create `scripts/verify-landmarks-moors.mjs`:
```js
// Headless check: the real-Moors data carries the Stage-1a built landmarks (moor crosses
// + Wade's Causeway) at their true OSGB positions, and MoorsGeography renders/names them.
import assert from 'node:assert';
import { MoorsGeography } from '../src/moorsgeo.js';

const g = new MoorsGeography();
const t = g.data.transform;
// Same transform as build-moors-data.py to_block: +x = north, +z = east.
const toBlock = (E, N) => [Math.round((N - t.minN) / t.metresPerBlock), Math.round((E - t.minE) / t.metresPerBlock)];
const find = (name) => g.data.landmarks.find(l => l.name === name);
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const near = (lm, E, N, tol, m) => { const [x, z] = toBlock(E, N); ok(lm && Math.hypot(lm.x - x, lm.z - z) <= tol, m); };

// crosses present, kind 'cross', at their real grid refs (±2 blocks = ±30 m)
near(find('Young Ralph Cross'), 468200, 502000, 2, 'Young Ralph Cross @ NZ 682 020');
near(find('Fat Betty'),         468230, 501580, 2, 'Fat Betty @ NZ 6823 0158');
near(find('Lilla Cross'),       488930, 498740, 2, 'Lilla Cross @ SE 8893 9874');
ok(['Young Ralph Cross', 'Fat Betty', 'Lilla Cross'].every(nm => find(nm)?.kind === 'cross'), 'crosses are kind:cross');

// Wade's Causeway: a 'causeway' polyline; onRoad true on it, false well away
const cau = g.data.landmarks.find(l => l.kind === 'causeway');
ok(cau && Array.isArray(cau.points) && cau.points.length >= 2, "Wade's Causeway polyline present");
ok(g.onRoad(cau.points[0][0], cau.points[0][1]) === true, 'onRoad true on the causeway');
ok(g.onRoad(cau.points[0][0] + 40, cau.points[0][1] + 40) === false, 'onRoad false 40 blocks off');
ok(g.locationName(cau.points[0][0], cau.points[0][1]) === 'Wade’s Causey', 'names the causeway');

// build-script kinds are all handled by a consumer (drift guard)
const handled = new Set(['abbey', 'hill', 'peak', 'hollow', 'tor', 'cross', 'causeway']);
ok(g.data.landmarks.every(l => handled.has(l.kind)), 'all landmark kinds are known');

console.log(`verify-landmarks-moors: ${n} assertions OK`);
```

- [ ] **Step 2: Run it to verify it fails**

Run:
```bash
node scripts/verify-landmarks-moors.mjs
```
Expected: FAIL — `Young Ralph Cross` not found (data lacks crosses), and/or `g.onRoad is not a function` (added in Task 5; for now the cross asserts must fail first). This proves the test bites.

- [ ] **Step 3: Emit the landmarks in the build script**

In `scripts/build-moors-data.py`, replace the body of `build_landmarks(found)` (after the existing Roseberry block, before `return lm`) by appending the crosses + causeway. Insert before `return lm`:
```python
    # --- moor crosses (real OSGB refs; Fat Betty is the white one) ---
    # Young Ralph Cross, Blakey Ridge — the National Park's emblem (≈ NZ 682 020)
    if in_bounds(468200, 502000):
        x, z = to_block(468200, 502000)
        lm.append({"name": "Young Ralph Cross", "x": x, "z": z, "kind": "cross"})
    # Fat Betty / White Cross, ≈450 m S on the Rosedale road (≈ NZ 6823 0158)
    if in_bounds(468230, 501580):
        x, z = to_block(468230, 501580)
        lm.append({"name": "Fat Betty", "x": x, "z": z, "kind": "cross", "params": {"white": True}})
    # Lilla Cross, Fylingdales Moor — oldest Christian monument on the moors (≈ SE 8893 9874)
    if in_bounds(488930, 498740):
        x, z = to_block(488930, 498740)
        lm.append({"name": "Lilla Cross", "x": x, "z": z, "kind": "cross"})

    # --- Wade's Causeway: the Wheeldale Roman road, a short stone-paved line over
    # Wheeldale Moor (≈ SE 805 973 → SE 812 987). Polyline in block coords. ---
    causeway_osgb = [(480450, 497300), (480650, 497900), (480820, 498400), (481150, 498650)]
    pts = [list(to_block(E, N)) for (E, N) in causeway_osgb if in_bounds(E, N)]
    if len(pts) >= 2:
        lm.append({"name": "Wade's Causeway", "kind": "causeway", "points": pts,
                   "x": pts[0][0], "z": pts[0][1]})
```
(`x`/`z` on the causeway record are the head point so `locationName`'s landmark scan still has a coordinate; the polyline `points` drive `onRoad`.)

- [ ] **Step 4: Regenerate the data file (reversible)**

Run:
```bash
cd /c/Users/James/Desktop/Moorcraft && python scripts/build-moors-data.py
```
Expected stdout ends with a `landmarks: N (...)` line listing Whitby Abbey, Roseberry Topping, Young Ralph Cross, Fat Betty, Lilla Cross, Wade's Causeway, and `wrote …/moors-data.json`.

- [ ] **Step 5: Confirm ONLY landmarks changed (parity-safety check)**

The build is deterministic; adding landmark records must not alter elevation/towns/stations/rivers (those feed `heightRaw`/the relay). Verify:
```bash
node -e "const n=require('./data/moors-data.json'); const cp=require('child_process'); const o=JSON.parse(cp.execSync('git show HEAD:data/moors-data.json').toString()); const strip=d=>{const{landmarks,_note,...rest}=d;return JSON.stringify(rest);}; console.log(strip(n)===strip(o) ? 'OK: only landmarks changed' : 'DRIFT: non-landmark data changed — investigate');"
```
Expected: `OK: only landmarks changed`. If `DRIFT`, stop and investigate (do not proceed) — restore with `git checkout data/moors-data.json`.

- [ ] **Step 6: Run the landmark check (still expects Task 5's `onRoad`)**

Run:
```bash
node scripts/verify-landmarks-moors.mjs
```
Expected: the cross + causeway-data + drift-guard assertions PASS; the `g.onRoad`/`locationName` assertions still FAIL (those land in Task 5). Leave them — Task 5 finishes this file's green. Do **not** wire it into `npm run verify` until Task 5.

- [ ] **Step 7: Commit**

```bash
git add scripts/build-moors-data.py scripts/verify-landmarks-moors.mjs data/moors-data.json
git commit -m "feat(moors-1a): emit moor crosses + Wade's Causeway in moors-data (real OSGB)"
```

---

## Task 4: Render the moor crosses (real-world branch in `stampLandmarks`)

Young Ralph and Fat Betty sit within one 96-block cell, so the stylised `crossAt` 96-grid (one cross per cell) would drop one. Instead, iterate the data list directly for the real world. `geo.data.landmarks` is already public; `geo.realWorld` gates it (the stylised `Geography` has neither, so the branch is skipped there).

**Files:**
- Modify: `src/worldgen.js` (`stampLandmarks`)

- [ ] **Step 1: Add the real-world cross branch**

In `src/worldgen.js` `stampLandmarks`, immediately after the `const put = …` helper and **before** the existing stylised `// --- moor crosses (96-grid …` loop, add:
```js
    // Real-Moors crosses: fixed at their true sites (data list), not the 96-grid —
    // adjacent crosses (Young Ralph + Fat Betty) share a cell, so iterate directly.
    if (geo.realWorld && geo.data && geo.data.landmarks) {
      for (const lm of geo.data.landmarks) {
        if (lm.kind !== 'cross') continue;
        if (lm.x < x0 - 2 || lm.x > x0 + CHUNK + 1 || lm.z < z0 - 2 || lm.z > z0 + CHUNK + 1) continue;
        const h = geo.height(lm.x, lm.z);
        const white = (lm.params && lm.params.white) || /Betty/.test(lm.name);
        const mat = white ? B.WOOL : B.STONE;
        put(lm.x, h + 1, lm.z, B.STONE);
        put(lm.x, h + 2, lm.z, B.STONE);
        put(lm.x, h + 3, lm.z, mat);
        put(lm.x + 1, h + 3, lm.z, mat);
        put(lm.x - 1, h + 3, lm.z, mat);
        put(lm.x, h + 4, lm.z, mat);
      }
    }
```
(The stylised `crossAt` loop below stays as-is — moors `crossAt` returns null and the stylised cross constants are at negative coords outside the moors world, so it never fires there.)

- [ ] **Step 2: Build**

Run:
```bash
npm run build
```
Expected: exit 0.

- [ ] **Step 3: Live-verify the crosses stand at their sites**

`preview_eval`:
```js
await game.startMoorsWorld();
for (let i = 0; i < 200; i++) game.frame();
const ralph = game.world.gen.geo.data.landmarks.find(l => l.name === 'Young Ralph Cross');
game.player.pos.set(ralph.x, game.world.gen.geo.height(ralph.x, ralph.z) + 8, ralph.z);
for (let i = 0; i < 80; i++) game.frame();
game.world.gen.geo.locationName(ralph.x, ralph.z);
```
Then `preview_console_logs` (zero errors). Expected: a stone cross stands at Ralph's site with the white (wool) Fat Betty just to the south; no errors.

- [ ] **Step 4: Commit**

```bash
git add src/worldgen.js
git commit -m "feat(moors-1a): render moor crosses at their real sites"
```

---

## Task 5: Wade's Causeway — `onRoad` + naming

Un-stub `moorsgeo.onRoad` to follow the causeway polyline; the existing surface code (`worldgen.js`: `const onRoad = geo.onRoad(x, z) …` → cobble/gravel) then paves it, and `locationName` names it. Finishes `verify-landmarks-moors`.

**Files:**
- Modify: `src/moorsgeo.js` (`onRoad`, `locationName`, a `segDist` helper)
- Modify: `package.json` (add `verify-landmarks-moors` to `verify`)

- [ ] **Step 1: Add a point-to-segment distance helper**

In `src/moorsgeo.js`, at module scope (next to `smoothstep`), add:
```js
// point-to-segment distance in the block plane (for the causeway; rivers reuse it in 1b)
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  let t = l2 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}
```

- [ ] **Step 2: Replace the `onRoad` stub**

In `src/moorsgeo.js`, replace `onRoad() { return false; }` with:
```js
  onRoad(x, z) {
    if (this._causeway === undefined) {
      const c = this.data.landmarks.find(l => l.kind === 'causeway');
      this._causeway = (c && c.points) || null;
    }
    const pts = this._causeway;
    if (!pts) return false;
    for (let i = 0; i < pts.length - 1; i++) {
      if (segDist(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) < 1.6) return true;
    }
    return false;
  }
```

- [ ] **Step 3: Name the causeway**

In `src/moorsgeo.js` `locationName`, add this line immediately before the final `return this.heightRaw(...) >= … ? 'T’ High Moor' : 'T’ Dale';`:
```js
    if (this.onRoad(x, z)) return 'Wade’s Causey';
```

- [ ] **Step 4: Run the landmark check — now fully green**

Run:
```bash
node scripts/verify-landmarks-moors.mjs
```
Expected: `verify-landmarks-moors: 11 assertions OK` (crosses + causeway + naming + drift guard all pass).

- [ ] **Step 5: Wire into `npm run verify` and run the full suite**

In `package.json`, append ` && node scripts/verify-landmarks-moors.mjs` to the `"verify"` command. Then:
```bash
npm run verify
```
Expected: all green, including `verify-station-align` and `verify-landmarks-moors`. Critically, `verify-geo-parity` must still pass (we changed no `heightRaw`).

- [ ] **Step 6: Live-verify the road paves + names**

`preview_eval`:
```js
await game.startMoorsWorld();
for (let i = 0; i < 200; i++) game.frame();
const cau = game.world.gen.geo.data.landmarks.find(l => l.kind === 'causeway');
const m = cau.points[1];
game.player.pos.set(m[0], game.world.gen.geo.height(m[0], m[1]) + 6, m[1]);
for (let i = 0; i < 80; i++) game.frame();
game.world.gen.geo.locationName(m[0], m[1]); // → "Wade’s Causey"
```
`preview_console_logs` (zero errors). Expected: a cobbled/gravel line crosses Wheeldale Moor; the HUD location reads "Wade's Causey".

- [ ] **Step 7: Commit**

```bash
git add src/moorsgeo.js package.json
git commit -m "feat(moors-1a): Wade's Causeway paving + naming via moors onRoad"
```

---

## Task 6 (optional, James can cut): moor waymark signposts

Atmospheric moor furniture — un-stub `moorsgeo.signAt` so the existing waymark-stamping (`worldgen.js`: `const sp = geo.signAt(gx, gz)` → `B.SIGNPOST`) places guideposts on the open high moor, mirroring the stylised world's guards (dry, not boggy, not in a village). No data change, no parity impact.

**Files:**
- Modify: `src/moorsgeo.js` (`signAt`)

- [ ] **Step 1: Replace the `signAt` stub**

In `src/moorsgeo.js`, replace `signAt() { return null; }` with:
```js
  signAt(cellX, cellZ) {
    const h1 = fbm2(cellX * 1.7 + 0.3, cellZ * 1.7 + 9.1, 1, this.seed ^ 0x516e);
    if (h1 < 0.55) return null; // sparse
    const x = cellX * 96 + 12 + Math.floor(((h1 * 7919) % 1) * 72);
    const z = cellZ * 96 + 12 + Math.floor(((h1 * 6131) % 1) * 72);
    if (this._baseMetresToBlock(x, z) <= WATER_LEVEL + 1) return null; // not in water
    if (this.coastT(x, z) > 0) return null;                            // not at sea
    if (this.bogginess(x, z) > 0.5) return null;                       // not in deep bog
    if (this.inVillage(x, z, 12)) return null;                         // clear of towns
    return { x, z };
  }
```

- [ ] **Step 2: Build + live-verify**

Run `npm run build` (exit 0). Then `preview_eval` a wander across open moor and confirm occasional signposts appear on dry high ground, none in bog/sea/town, zero console errors.

- [ ] **Step 3: Commit**

```bash
git add src/moorsgeo.js
git commit -m "feat(moors-1a): moor waymark signposts on the open tops"
```

---

## Wrap-up: verify, build, deploy 1a

- [ ] **Step 1: Full verify + build**

```bash
npm run verify && npm run build
```
Expected: every check green; Vite build exits 0.

- [ ] **Step 2: Deploy live into the "Explore t' Real Moors" section**

```bash
npx vercel deploy --prod --yes
```
Then confirm the new bundle is live (PowerShell `Invoke-WebRequest` — `curl.exe` is broken on this box) and frame-pump-explore the deployed build. Report the bundle hash.

- [ ] **Step 3: Hand back to James to explore + report defects.** Fix-and-redeploy into the same section per his standing directive. Commit/merge to `main` and push only when he asks.

---

## Self-Review (completed during planning)

**Spec coverage (Stage 1a slice of the spec):** Unit A (axis-aligned building) → Tasks 1-2. Unit B-built crosses → Tasks 3-4. Unit B-built causeway → Tasks 3, 5. Unit C fingerposts → Task 6 (the SIGNPOST block has no text, so "showing place-names" is satisfied by `locationName` on the HUD, not the post itself — noted honestly). Parity-free guarantee → Task 3 Step 5 drift guard + Task 5 Step 5 `verify-geo-parity`. Deferred to 1b (rivers, terrain-landmark sculpt incl. the Roseberry `hill`/`peak` fix, dale naming) — correctly **not** in this plan.

**Placeholder scan:** none — every code/step is concrete.

**Type/name consistency:** `stationOrient(tx,tz) → {along,across}` used identically in Tasks 1-2; `boxCell` defined and consumed in Task 2; `segDist` defined in Task 5 Step 1 and used in Step 2; `geo.realWorld`/`geo.data.landmarks` used consistently (Task 4); landmark `kind` strings (`cross`,`causeway`) match between build script (Task 3), the drift-guard set (Task 3 test), and consumers (Tasks 4-5). Assertion count in `verify-landmarks-moors` (11) matches the test body.

**Risks carried from the spec:** §11.1 (consumer shapes) resolved — read the cross/road stamping and `crossAt`/`onRoad` signatures before planning. §11.2 (peak-sculpt parity) does **not** affect 1a (no `heightRaw` change) — it's a 1b concern.
