# Moors 1900 — Slice 0 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a second, data-driven Moorstead world that loads the real North York Moors layout (real relief, coast, rivers, landmarks, towns-as-markers, real rail-station positions) selectable in both solo and shared, with the relay mirroring the same geography.

**Architecture:** Add a sibling geography provider `MoorsGeography` that implements the existing `world.gen.geo` interface from a committed data file (`data/moors-data.json`), selected by seed in `worldgen.js`. Shared pure maths (`geo-grid.js`) and the existing rail-path engine (extracted to `railpath.js`) are reused by both providers and mirrored to Python (`geography_moors.py`) so client and relay agree. Develop/test against a small real control-point **fixture**; swap in full OS Terrain 50 / LIDAR data last (Task 9) with no code change.

**Tech Stack:** ES modules (client, headless `node` verify scripts), Python 3 (relay/brain mirror), Vite (JSON import), existing `rails.js` / `worldgen.js` / `multiplayer.js`.

**Reference spec:** [docs/superpowers/specs/2026-06-21-moors-1900-world-design.md](../specs/2026-06-21-moors-1900-world-design.md)

---

## File Structure

| File | Responsibility | New/Modify |
|---|---|---|
| `data/moors-data.json` | committed geography data (bounds+transform, elevation grid, towns, stations, lines, coast, rivers, landmarks) | Create (fixture; real data in Task 9) |
| `src/geo-grid.js` | pure maths: OSGB↔block transform, bilinear grid sample, point-to-segment distance | Create |
| `src/railpath.js` | the rail-path engine (spline + vertical profile + spatial index + `railInfo`/`samplePos`) as provider-agnostic pure functions | Create (extracted from `geography.js`) |
| `src/geography.js` | existing stylised provider — now delegates rail-path to `railpath.js` | Modify |
| `src/moorsgeo.js` | `MoorsGeography` — the `geo` interface from `moors-data.json` | Create |
| `src/worldgen.js` | choose provider by seed | Modify (`:11`) |
| `src/main.js` | start the moors world solo; map the moors shared room → moors seed | Modify |
| `deploy/world/geo_grid.py` | Python port of `geo-grid.js` maths (parity) | Create |
| `deploy/world/geography_moors.py` | Python height mirror for the relay/brain | Create |
| `scripts/verify-geo-grid.mjs` | tests for `geo-grid.js` | Create |
| `scripts/verify-moorsgeo.mjs` | tests for `MoorsGeography`; emits `parity-sample.json` | Create |
| `scripts/verify-geo-parity.mjs` | emits a height-grid reference for the Python parity test | Create |
| `deploy/world/test_moorsgeo.py` | Python parity assertion | Create |
| `package.json` | wire the three new verify scripts into `npm run verify` | Modify |

**Coordinate convention (decided here, used everywhere):** block `x = (E − minE)/15`, block `z = (maxN − N)/15` (north = small z, south = large z, all non-negative). Elevation metres → block-Y via `y = round(SEA_BLOCK + metres/15)` where `SEA_BLOCK = WATER_LEVEL` (26, from `defs.js`).

---

## Task 1: Data fixture + schema

**Files:**
- Create: `data/moors-data.json`

A small **real control-point fixture** to develop against. Positions are approximate (regenerated precisely from OS Open Names in Task 9); the elevation grid is a coarse plausible field (replaced by OS Terrain 50 in Task 9). Heights are in **metres above sea level**.

- [ ] **Step 1: Create the data file**

```json
{
  "_note": "Slice-0 control-point FIXTURE. Positions approximate, elevation coarse. Replaced by OS Terrain 50 / Open Names in Task 9. Heights in metres ASL.",
  "transform": { "minE": 445000, "minN": 488000, "maxE": 512000, "maxN": 522000, "metresPerBlock": 15 },
  "elevation": {
    "cols": 12, "rows": 7,
    "_layout": "row-major, row 0 = north (maxN), col 0 = west (minE); each cell spans (maxE-minE)/(cols-1) east and (maxN-minN)/(rows-1) north",
    "metres": [
      0,  60, 180, 300, 360, 380, 300, 200, 120,  40,   0,   0,
      0,  90, 250, 380, 420, 400, 360, 280, 200, 120,  20,   0,
      40,140, 300, 410, 440, 420, 380, 320, 240, 160,  60,   0,
      30,120, 260, 360, 400, 380, 340, 300, 220, 140,  80,  40,
      20, 80, 180, 280, 320, 300, 260, 220, 180, 120,  90,  60,
      15, 50, 120, 200, 240, 220, 190, 160, 130, 100,  80,  70,
      10, 30,  70, 120, 150, 140, 120, 100,  90,  80,  70,  60
    ]
  },
  "towns": [
    { "name": "Whitby",            "x": 3720, "z": 720,  "tier": 1 },
    { "name": "Pickering",         "x": 2320, "z": 2040, "tier": 1 },
    { "name": "Grosmont",          "x": 3120, "z": 800,  "tier": 1 },
    { "name": "Goathland",         "x": 3000, "z": 1160, "tier": 2 },
    { "name": "Staithes",          "x": 3000, "z": 360,  "tier": 2 },
    { "name": "Robin Hood's Bay",  "x": 3880, "z": 1120, "tier": 2 },
    { "name": "Castleton",         "x": 1880, "z": 760,  "tier": 2 },
    { "name": "Helmsley",          "x": 760,  "z": 2280, "tier": 2 }
  ],
  "stations": [
    { "name": "Pickering",  "x": 2300, "z": 2010, "line": "moors",  "hasLoop": true },
    { "name": "Levisham",   "x": 2380, "z": 1720, "line": "moors",  "hasLoop": true },
    { "name": "Goathland",  "x": 3010, "z": 1150, "line": "moors",  "hasLoop": true },
    { "name": "Grosmont",   "x": 3120, "z": 800,  "line": "moors",  "hasLoop": true },
    { "name": "Sleights",   "x": 3460, "z": 760,  "line": "moors",  "hasLoop": false },
    { "name": "Whitby",     "x": 3700, "z": 700,  "line": "moors",  "hasLoop": true }
  ],
  "lines": [
    { "name": "Whitby & Pickering", "kind": "passenger", "stations": ["Pickering","Levisham","Goathland","Grosmont","Sleights","Whitby"] }
  ],
  "coast": [ [3000,360],[3180,520],[3520,620],[3720,700],[3880,1120],[3960,1360],[4040,1800] ],
  "rivers": [
    { "name": "Esk", "points": [[1880,760],[2200,720],[2600,740],[3120,800],[3460,760],[3700,720]] }
  ],
  "landmarks": [
    { "name": "Whitby Abbey",      "x": 3760, "z": 700,  "kind": "abbey" },
    { "name": "Roseberry Topping", "x": 600,  "z": 360,  "kind": "peak", "params": { "height": 320, "radius": 30 } }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add data/moors-data.json
git commit -m "feat(moors): slice-0 control-point geography fixture"
```

---

## Task 2: `geo-grid.js` pure maths (TDD)

**Files:**
- Create: `src/geo-grid.js`
- Test: `scripts/verify-geo-grid.mjs`

- [ ] **Step 1: Write the failing test**

```js
// scripts/verify-geo-grid.mjs
import { bilinear, pointToSegment } from '../src/geo-grid.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

// bilinear over a 2x2 grid (cols=2, rows=2): [[0,10],[20,30]] row-major, row0=north
{
  const grid = { cols: 2, rows: 2, metres: [0, 10, 20, 30] };
  (near(bilinear(grid, 0, 0), 0) ? ok : bad)('corner (0,0) = 0');
  (near(bilinear(grid, 1, 0), 10) ? ok : bad)('corner (1,0) = 10');
  (near(bilinear(grid, 0, 1), 20) ? ok : bad)('corner (0,1) = 20');
  (near(bilinear(grid, 0.5, 0.5), 15) ? ok : bad)('centre = 15');
  (near(bilinear(grid, 5, 5), 30) ? ok : bad)('clamps past the far corner to 30');
}
// point-to-segment distance
{
  (near(pointToSegment(0, 0, -1, 0, 1, 0), 0) ? ok : bad)('on the segment = 0');
  (near(pointToSegment(0, 3, -1, 0, 1, 0), 3) ? ok : bad)('above the midpoint = 3');
  (near(pointToSegment(2, 0, -1, 0, 1, 0), 1) ? ok : bad)('past the end clamps to the endpoint');
}

console.log(failed ? '\nGEO-GRID: FAIL' : '\nGEO-GRID: all good');
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run it — expect FAIL (module missing)**

Run: `node scripts/verify-geo-grid.mjs`
Expected: `ERR_MODULE_NOT_FOUND` for `../src/geo-grid.js`.

- [ ] **Step 3: Implement `src/geo-grid.js`**

```js
// Pure geography maths shared by MoorsGeography (JS) and the relay mirror (Python
// port lives in deploy/world/geo_grid.py — keep the two in lockstep). No deps.

// Grid coords: gx in [0..cols-1] east, gz in [0..rows-1] south-from-north (row 0 = north).
export function bilinear(grid, gx, gz) {
  const { cols, rows, metres } = grid;
  const cx = Math.max(0, Math.min(cols - 1, gx));
  const cz = Math.max(0, Math.min(rows - 1, gz));
  const x0 = Math.floor(cx), z0 = Math.floor(cz);
  const x1 = Math.min(cols - 1, x0 + 1), z1 = Math.min(rows - 1, z0 + 1);
  const fx = cx - x0, fz = cz - z0;
  const at = (x, z) => metres[z * cols + x];
  const top = at(x0, z0) + (at(x1, z0) - at(x0, z0)) * fx;
  const bot = at(x0, z1) + (at(x1, z1) - at(x0, z1)) * fx;
  return top + (bot - top) * fz;
}

// shortest distance from (px,pz) to segment (ax,az)->(bx,bz)
export function pointToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const L2 = dx * dx + dz * dz || 1e-9;
  let t = ((px - ax) * dx + (pz - az) * dz) / L2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

// nearest distance from (px,pz) to a polyline (array of [x,z])
export function pointToPolyline(px, pz, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = pointToSegment(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (d < best) best = d;
  }
  return best;
}

// block coords -> grid coords, given the data transform
export function blockToGrid(transform, grid, bx, bz) {
  const { minE, minN, maxE, maxN, metresPerBlock } = transform;
  const E = minE + bx * metresPerBlock;
  const N = maxN - bz * metresPerBlock;
  const gx = (E - minE) / (maxE - minE) * (grid.cols - 1);
  const gz = (maxN - N) / (maxN - minN) * (grid.rows - 1);
  return [gx, gz];
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `node scripts/verify-geo-grid.mjs`
Expected: all `ok`, `GEO-GRID: all good`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/geo-grid.js scripts/verify-geo-grid.mjs
git commit -m "feat(moors): geo-grid pure maths (bilinear, segment distance)"
```

---

## Task 3: Extract the rail-path engine to `railpath.js`

The rail-path engine in `geography.js` (`railPath`, `samplePos`, `railInfo`) depends only on a station list, a `height(x,z)` function, and the villages array — so it can serve both providers. Extract it verbatim into provider-agnostic functions; have `geography.js` call them. No behaviour change — the existing rail verify scripts must stay green.

**Files:**
- Create: `src/railpath.js`
- Modify: `src/geography.js` (`railPath`/`samplePos`/`railInfo` → thin delegators)

- [ ] **Step 1: Create `src/railpath.js`**

Move the bodies of `Geography.railPath`, `Geography.samplePos`, `Geography.railInfo` (currently [geography.js:409-676](../../../src/geography.js)) into pure functions:

```js
// The permanent way, provider-agnostic. Lifted verbatim from geography.js so both
// the stylised and the real-Moors worlds share one proven engine.
//   stations: [{name,x,z}]   heightFn: (x,z)=>blockY   villages: [{x,z,radius,buildings}]
import { WATER_LEVEL } from './defs.js';

export function buildRailPath(stations, heightFn, villages) {
  /* ...exact body of the current Geography.railPath, with:
       this.railway()      -> stations
       this.villages       -> villages
       this.height(x,z)    -> heightFn(x,z)
     returns { pts, cells, length, stationS }  (unchanged shape) ... */
}

export function samplePos(path, s) { /* exact body of Geography.samplePos, using `path` not this.railPath() */ }
export function railInfo(path, x, z) { /* exact body of Geography.railInfo, using `path` not this.railPath() */ }
```

- [ ] **Step 2: Update `geography.js` to delegate**

```js
import { buildRailPath, samplePos as rpSample, railInfo as rpInfo } from './railpath.js';
// ...
railPath() { return this._path || (this._path = buildRailPath(this.railway(), (x, z) => this.height(x, z), this.villages)); }
samplePos(s) { return rpSample(this.railPath(), s); }
railInfo(x, z) { return rpInfo(this.railPath(), x, z); }
```

- [ ] **Step 3: Run the existing rail tests — expect PASS (no regression)**

Run: `npm run verify:rail && npm run verify:clearance && npm run verify:train`
Expected: all PASS (identical output to before the extraction).

- [ ] **Step 4: Commit**

```bash
git add src/railpath.js src/geography.js
git commit -m "refactor(moors): extract rail-path engine to railpath.js (no behaviour change)"
```

---

## Task 4: `MoorsGeography` core (TDD)

**Files:**
- Create: `src/moorsgeo.js`
- Test: `scripts/verify-moorsgeo.mjs`

Implements the `geo` interface from `moors-data.json`. **Towns are markers in Slice 0** (name/position/radius; no building layouts — those arrive in slices 2–3), so `villageColumn`/`npcHome` return marker-level/`null` and are filled later.

- [ ] **Step 1: Write the failing test**

```js
// scripts/verify-moorsgeo.mjs
import { writeFileSync } from 'node:fs';
import { MoorsGeography } from '../src/moorsgeo.js';
import { WATER_LEVEL } from '../src/defs.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const geo = new MoorsGeography();

// height: sea at the coast, high on the central moor, integer block-Y
{
  const wh = geo.villages.find(v => v.name === 'Whitby');
  (geo.height(wh.x + 80, wh.z) <= WATER_LEVEL + 1 ? ok : bad)('sea just off Whitby is at/under water level');
  (geo.height(1800, 760) > geo.height(wh.x, wh.z) ? ok : bad)('central moor stands above the coast town');
  (Number.isInteger(geo.height(1800, 760)) ? ok : bad)('height returns an integer block-Y');
}
// villages + stations come from the data, at their given positions
{
  (geo.villages.length >= 6 ? ok : bad)('villages loaded from data');
  const st = geo.railway();
  (st.find(s => s.name === 'Whitby') && st.find(s => s.name === 'Pickering') ? ok : bad)('real stations present');
  (st[0].name === 'Pickering' ? ok : bad)('moors line ordered Pickering-first');
}
// coastT rises 0->1 going out to sea
{
  const wh = geo.villages.find(v => v.name === 'Whitby');
  (geo.coastT(wh.x - 200, wh.z) === 0 ? ok : bad)('inland of Whitby is dry (coastT 0)');
  (geo.coastT(wh.x + 200, wh.z) > 0.5 ? ok : bad)('out to sea is coastT > 0.5');
}
// landmark naming + a railPath that runs
{
  (geo.locationName(3760, 700).includes('Abbey') ? ok : bad)('abbey site names as the Abbey');
  const p = geo.railPath();
  (p.length > 100 && p.stationS.length === geo.railway().length ? ok : bad)('railPath builds with a chainage per station');
}

// emit a parity sample for the Python mirror (Task 7)
{
  const pts = [];
  for (let bx = 200; bx <= 3800; bx += 400)
    for (let bz = 200; bz <= 2200; bz += 400)
      pts.push([bx, bz, geo.heightRaw(bx, bz)]);   // heightRaw = pre-village-flatten, mirrored
  writeFileSync(new URL('./parity-sample.json', import.meta.url), JSON.stringify(pts));
}

console.log(failed ? '\nMOORSGEO: FAIL' : '\nMOORSGEO: all good');
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run it — expect FAIL (module missing)**

Run: `node scripts/verify-moorsgeo.mjs`
Expected: `ERR_MODULE_NOT_FOUND` for `../src/moorsgeo.js`.

- [ ] **Step 3: Implement `src/moorsgeo.js`**

```js
// The real North York Moors, c.1900 — the geo interface driven by data/moors-data.json.
// Same surface as geography.js Geography, so worldgen/rails/entities consume it unchanged.
// Towns are MARKERS in Slice 0; building layouts + morphology arrive in slices 2-3.
import data from '../data/moors-data.json';
import { HEIGHT, WATER_LEVEL } from './defs.js';
import { fbm2 } from './noise.js';
import { bilinear, blockToGrid, pointToPolyline } from './geo-grid.js';
import { buildRailPath, samplePos as rpSample, railInfo as rpInfo } from './railpath.js';

function smoothstep(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }

export class MoorsGeography {
  constructor(seed = 0) {
    this.seed = seed | 0;
    this.data = data;
    this.colCache = new Map();
    this.villages = data.towns.map(t => ({
      x: t.x, z: t.z, name: t.name, tier: t.tier,
      radius: t.tier === 1 ? 48 : 28, style: 'marker', buildings: [],
      ground: Math.max(this._baseMetresToBlock(t.x, t.z), WATER_LEVEL + 2),
    }));
    this.village = this.villages[0];
  }

  _baseMetresToBlock(x, z) {
    const [gx, gz] = blockToGrid(this.data.transform, this.data.elevation, x, z);
    const m = bilinear(this.data.elevation, gx, gz);
    return Math.floor(WATER_LEVEL + m / this.data.transform.metresPerBlock);
  }

  // ---------- coast ----------
  coastDist(x, z) { return pointToPolyline(x, z, this.data.coast); }
  // 0 inland .. 1 open sea, by signed side of the coast polyline (east = sea)
  coastT(x, z) {
    const d = this.coastDist(x, z);
    const seaward = x > this._coastXAt(z);
    if (!seaward) return 0;
    return smoothstep(d / 64);
  }
  _coastXAt(z) {
    // interpolate the coast polyline's x at this z
    const c = this.data.coast;
    for (let i = 0; i < c.length - 1; i++) {
      const [x0, z0] = c[i], [x1, z1] = c[i + 1];
      if ((z >= z0 && z <= z1) || (z >= z1 && z <= z0)) {
        const t = (z - z0) / ((z1 - z0) || 1);
        return x0 + (x1 - x0) * t;
      }
    }
    return c[c.length - 1][0];
  }
  coastX(z) { return this._coastXAt(z); }

  // ---------- height ----------
  heightRaw(x, z) {
    let h = this._baseMetresToBlock(x, z);
    // light micro-roughness so the stylised surface isn't glassy (deterministic)
    h += fbm2(x * 0.03 + 11.1, z * 0.03 + 7.7, 2, this.seed ^ 0x5117) * 1.5;
    // landmark sculpt (peaks)
    for (const lm of this.data.landmarks) {
      if (lm.kind === 'peak') {
        const r = Math.hypot(x - lm.x, z - lm.z), R = lm.params.radius;
        if (r < R) {
          const cone = (WATER_LEVEL + lm.params.height / this.data.transform.metresPerBlock) - (r / R) * 14;
          h = Math.max(h, cone);
        }
      }
    }
    // coast: drop to sea east of the coastline
    const t = this.coastT(x, z);
    if (t > 0) h = (h * (1 - t)) + (WATER_LEVEL - 9) * t;
    return Math.max(5, Math.min(HEIGHT - 6, h));
  }

  height(x, z) {
    const key = x + ',' + z;
    const c = this.colCache.get(key);
    if (c !== undefined) return c;
    let h = this.heightRaw(x, z);
    for (const v of this.villages) {
      const d = Math.hypot(x - v.x, z - v.z);
      if (d < v.radius) { h = (h + v.ground) / 2; break; } // gentle marker flatten (slice 0)
    }
    h = Math.floor(h);
    if (this.colCache.size > 80000) this.colCache.clear();
    this.colCache.set(key, h);
    return h;
  }

  // ---------- railway (reusing the proven engine) ----------
  railway() { return this.data.stations.filter(s => s.line === 'moors'); }
  railPath() { return this._path || (this._path = buildRailPath(this.railway(), (x, z) => this.height(x, z), this.villages)); }
  samplePos(s) { return rpSample(this.railPath(), s); }
  railInfo(x, z) { return rpInfo(this.railPath(), x, z); }
  nearStation(x, z, r = 8) { return this.railway().find(s => Math.hypot(s.x - x, s.z - z) < r) || null; }

  // ---------- villages (markers in slice 0) ----------
  inVillage(x, z, pad = 0) { return this.villages.some(v => Math.hypot(x - v.x, z - v.z) < v.radius + pad); }
  villageAt(x, z) { return this.villages.find(v => Math.hypot(x - v.x, z - v.z) < v.radius) || null; }
  villageColumn() { return null; }   // no building layouts yet (slices 2-3)
  npcHome() { return null; }          // ditto
  npcSpot(name, v = this.village) { return [v.x, v.z]; }

  // ---------- naming ----------
  locationName(x, z) {
    for (const lm of this.data.landmarks) if (Math.hypot(x - lm.x, z - lm.z) < 36) return lm.name;
    for (const v of this.villages) if (Math.hypot(x - v.x, z - v.z) < v.radius + 4) return v.name;
    if (this.coastT(x, z) > 0.75) return 'T’ North Sea';
    if (this.coastT(x, z) > 0.02) return 'T’ Heritage Coast';
    return this.heightRaw(x, z) >= WATER_LEVEL + 18 ? 'T’ High Moor' : 'T’ Dale';
  }
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `node scripts/verify-moorsgeo.mjs`
Expected: all `ok`, `MOORSGEO: all good`, and `scripts/parity-sample.json` written.

- [ ] **Step 5: Commit**

```bash
git add src/moorsgeo.js scripts/verify-moorsgeo.mjs
git commit -m "feat(moors): MoorsGeography from data (height, coast, stations, markers)"
```

---

## Task 5: Select the provider by seed

**Files:**
- Modify: `src/worldgen.js:4` (import), `src/worldgen.js:11` (construction)

- [ ] **Step 1: Add a seed predicate + import**

In `src/worldgen.js`, after the existing geography import:

```js
import { Geography } from './geography.js';
import { MoorsGeography } from './moorsgeo.js';
export const MOORS_SEED = 0x4d4f4f52; // "MOOR" — the real-Moors world id
export function isMoorsSeed(seed) { return (seed | 0) === (MOORS_SEED | 0); }
```

- [ ] **Step 2: Choose the provider**

Replace `this.geo = new Geography(seed);` ([worldgen.js:11](../../../src/worldgen.js)) with:

```js
this.geo = isMoorsSeed(seed) ? new MoorsGeography(seed) : new Geography(seed);
```

- [ ] **Step 3: Verify the full suite still passes (stylised world untouched)**

Run: `npm run verify`
Expected: all existing scripts PASS; `verify-geo-grid` + `verify-moorsgeo` not yet wired (added in Task 8).

- [ ] **Step 4: Commit**

```bash
git add src/worldgen.js
git commit -m "feat(moors): select MoorsGeography for the MOORS_SEED world"
```

---

## Task 6: Wire the world — solo + shared

**Files:**
- Modify: `src/main.js` (`newWorld`/title entry for solo; `joinShared` room→seed for shared)

The moors world is reached two ways. The strings (`'t-moors-1900'` seed, room `moors1900`) map to `MOORS_SEED` via `strSeed`. Confirm `strSeed('t-moors-1900')` — if it doesn't equal `MOORS_SEED`, set `MOORS_SEED = strSeed('t-moors-1900')` in Task 5 instead of a literal (keep one source of truth).

- [ ] **Step 1: Make `MOORS_SEED` the hash of the world string**

In `src/worldgen.js`, replace the literal with the derived value so the seed strings used by main.js select the provider:

```js
import { strSeed } from './noise.js';
export const MOORS_SEED = strSeed('t-moors-1900');
```

- [ ] **Step 2: Solo entry**

In `src/main.js`, add a moors-world start (reuse the `newWorld` path but with the fixed seed string; wire to a title button `btnMoors` if present, else a console/debug entry for now):

```js
async startMoorsWorld() {
  if (this.net) { this.net.disconnect(); this.net = null; }
  this.netActive = false;
  const { clearSave } = await import('./save.js');
  await clearSave();
  this.startWorld(strSeed('t-moors-1900'), null, new Map());
}
```

Expose it on the dev handle in `buildDebug` (so it's testable now without UI): `startMoors: () => G.startMoorsWorld()`.

- [ ] **Step 3: Shared entry (room → seed)**

In `joinShared` ([main.js:1550](../../../src/main.js)), the room→seed mapping currently does `ss(room === 'moor' ? 't-shared-moor' : 't-shared-moor:' + room)`. Add the moors room:

```js
const seedStr = room === 'moor' ? 't-shared-moor'
  : room === 'moors1900' ? 't-moors-1900'
  : 't-shared-moor:' + room;
this.startWorld(ss(seedStr), null, new Map());
```

(Players reach it with a `moors1900`-room token via the existing worlds-by-token ledger; no relay change needed beyond Task 7's height mirror.)

- [ ] **Step 4: Live load check (solo)**

Run the dev server, open the preview, and in the console: `window.game.loginGuest?.(); window.moorstead.startMoors?.()` (or `window.game.startMoorsWorld()`), pump to `playing`. Confirm: no errors; `window.game.world.gen.geo.constructor.name === 'MoorsGeography'`; `window.game.world.gen.geo.locationName(3760,700)` mentions the Abbey; the train line exists (`window.game.world.gen.geo.railway().length === 6`).

- [ ] **Step 5: Commit**

```bash
git add src/main.js src/worldgen.js
git commit -m "feat(moors): reach the moors world solo (startMoorsWorld) and shared (room moors1900)"
```

---

## Task 7: Relay mirror + parity (Python)

**Files:**
- Create: `deploy/world/geo_grid.py`, `deploy/world/geography_moors.py`, `deploy/world/test_moorsgeo.py`
- Create: `scripts/verify-geo-parity.mjs`

The relay's `is_expired` uses `geography.height` for mine-depth; the moors world needs the same heights server-side. Mirror the **heightRaw** maths exactly and assert parity against the JS reference.

- [ ] **Step 1: Port the maths — `deploy/world/geo_grid.py`**

```python
"""Python port of src/geo-grid.js — keep in lockstep."""
def bilinear(grid, gx, gz):
    cols, rows, metres = grid["cols"], grid["rows"], grid["metres"]
    cx = max(0.0, min(cols - 1, gx)); cz = max(0.0, min(rows - 1, gz))
    x0 = int(cx); z0 = int(cz)
    x1 = min(cols - 1, x0 + 1); z1 = min(rows - 1, z0 + 1)
    fx = cx - x0; fz = cz - z0
    at = lambda x, z: metres[z * cols + x]
    top = at(x0, z0) + (at(x1, z0) - at(x0, z0)) * fx
    bot = at(x0, z1) + (at(x1, z1) - at(x0, z1)) * fx
    return top + (bot - top) * fz

def block_to_grid(tr, grid, bx, bz):
    E = tr["minE"] + bx * tr["metresPerBlock"]
    N = tr["maxN"] - bz * tr["metresPerBlock"]
    gx = (E - tr["minE"]) / (tr["maxE"] - tr["minE"]) * (grid["cols"] - 1)
    gz = (tr["maxN"] - N) / (tr["maxN"] - tr["minN"]) * (grid["rows"] - 1)
    return gx, gz
```

- [ ] **Step 2: Port `heightRaw` — `deploy/world/geography_moors.py`**

Port the base-grid + landmark-peak + coast parts of `MoorsGeography.heightRaw` (the relay does **not** need the fbm micro-roughness for mine-depth — but parity must match, so the JS test compares `heightRaw` WITHOUT the fbm term; see Step 4). Implement `height_raw(x, z)` reading the same `data/moors-data.json` (path relative to repo root; on the EVO it's deployed alongside).

```python
import json, math
from pathlib import Path
from geo_grid import bilinear, block_to_grid
DATA = json.loads((Path(__file__).resolve().parents[2] / "data" / "moors-data.json").read_text())
WATER_LEVEL = 26; HEIGHT = 64
def _base(x, z):
    gx, gz = block_to_grid(DATA["transform"], DATA["elevation"], x, z)
    return math.floor(WATER_LEVEL + bilinear(DATA["elevation"], gx, gz) / DATA["transform"]["metresPerBlock"])
def height_raw(x, z):
    h = float(_base(x, z))
    for lm in DATA["landmarks"]:
        if lm.get("kind") == "peak":
            r = math.hypot(x - lm["x"], z - lm["z"]); R = lm["params"]["radius"]
            if r < R:
                cone = (WATER_LEVEL + lm["params"]["height"] / DATA["transform"]["metresPerBlock"]) - (r / R) * 14
                h = max(h, cone)
    return max(5, min(HEIGHT - 6, h))
```

- [ ] **Step 3: JS emits the parity reference — `scripts/verify-geo-parity.mjs`**

```js
import { writeFileSync } from 'node:fs';
import { MoorsGeography } from '../src/moorsgeo.js';
const geo = new MoorsGeography();
const out = [];
for (let bx = 200; bx <= 3800; bx += 400)
  for (let bz = 200; bz <= 2200; bz += 400)
    out.push([bx, bz, geo._heightRawNoFbm ? geo._heightRawNoFbm(bx, bz) : null]);
writeFileSync(new URL('../deploy/world/parity-ref.json', import.meta.url), JSON.stringify(out));
console.log('wrote parity-ref.json (' + out.length + ' samples)');
```

Add a `_heightRawNoFbm(x,z)` to `MoorsGeography` (heightRaw minus the fbm line) so client/relay compare the deterministic base+landmark+coast only:

```js
_heightRawNoFbm(x, z) { const f = this._noFbm; this._noFbm = true; const h = this.heightRaw(x, z); this._noFbm = f; return h; }
```

…and guard the fbm line in `heightRaw`: `if (!this._noFbm) h += fbm2(...) * 1.5;`

- [ ] **Step 4: Python parity assertion — `deploy/world/test_moorsgeo.py`**

```python
import json, math
from pathlib import Path
import geography_moors as gm
ref = json.loads((Path(__file__).resolve().parent / "parity-ref.json").read_text())
fails = []
for bx, bz, jsh in ref:
    py = math.floor(gm.height_raw(bx, bz))
    if abs(py - math.floor(jsh)) > 0:
        fails.append((bx, bz, jsh, py))
print(f"  checked {len(ref)} samples, {len(fails)} mismatches")
for f in fails[:8]:
    print("  FAIL", f)
raise SystemExit(1 if fails else 0)
```

- [ ] **Step 5: Run the parity chain — expect PASS**

Run: `node scripts/verify-geo-parity.mjs && python deploy/world/test_moorsgeo.py`
Expected: reference written; Python prints `0 mismatches`, exit 0.

- [ ] **Step 6: Commit**

```bash
git add deploy/world/geo_grid.py deploy/world/geography_moors.py deploy/world/test_moorsgeo.py scripts/verify-geo-parity.mjs src/moorsgeo.js
git commit -m "feat(moors): relay height mirror + client/relay parity test"
```

---

## Task 8: Wire verify scripts into `npm run verify`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Append the three scripts to the `verify` chain and add aliases**

Add ` && node scripts/verify-geo-grid.mjs && node scripts/verify-moorsgeo.mjs && node scripts/verify-geo-parity.mjs` to the end of the `verify` value, and:

```json
"verify:geogrid": "node scripts/verify-geo-grid.mjs",
"verify:moorsgeo": "node scripts/verify-moorsgeo.mjs",
"verify:geoparity": "node scripts/verify-geo-parity.mjs"
```

- [ ] **Step 2: Run the whole suite — expect PASS**

Run: `npm run verify`
Expected: every script PASS, including the three new ones.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "test(moors): wire geo-grid/moorsgeo/parity into npm run verify"
```

---

## Task 9: Swap the fixture for real OS data (data task — not unit-tested)

This is the one non-TDD phase: replace the fixture in `data/moors-data.json` with real Ordnance Survey data. The **code does not change** — it already consumes the schema. Verified visually + by the landform-sanity assertions, not by exact equality.

- [ ] **Step 1: Acquire (all OGL / public domain):**
  - **Elevation:** OS Terrain 50 (ASC grid) for tiles NZ/SE covering the park — https://osdatahub.os.uk/downloads/open/Terrain50
  - **Towns + stations (surviving):** OS Open Names — https://osdatahub.os.uk/downloads/open/OpenNames
  - **Rivers / coast / boundary:** OS Open Rivers, OS Boundary-Line — same portal
  - **Dismantled 1900 lines + station sites:** georeference from NLS historic six-inch OS maps — https://maps.nls.uk (public domain), cross-checked against the spec §14 railway sources.

- [ ] **Step 2: Process** with a one-off script `scripts/build-moors-data.mjs` (or Python): read the Terrain 50 ASC grid, crop to `transform` bounds, downsample to the chosen grid resolution (e.g. 200 m posts → cols/rows), and project town/station/river/coast features (OSGB eastings/northings) into block coords via the documented transform. Write `data/moors-data.json` in the **same schema**. Keep the resolution modest first (the bilinear sampler interpolates).

- [ ] **Step 3: Re-run the suite — expect PASS** (landform-sanity bands, parity, station roster):

Run: `npm run verify && node scripts/verify-geo-parity.mjs && python deploy/world/test_moorsgeo.py`
Expected: PASS — sea at the coast, high central moor, named landmarks within tolerance of real positions, parity green.

- [ ] **Step 4: Live visual check** (solo): load the moors world, screenshot from above the Esk valley and the coast; confirm the layout reads as the real Moors (Whitby on the coast NE, Pickering S, the high moors central, the Esk valley running E to Whitby).

- [ ] **Step 5: Add attribution** to `public/about.html`: *"Contains OS data © Crown copyright and database right 2026"* + NLS historic-map credit.

- [ ] **Step 6: Commit**

```bash
git add data/moors-data.json scripts/build-moors-data.mjs public/about.html
git commit -m "feat(moors): real OS Terrain 50 + Open Names geography data"
```

---

## Self-Review

**Spec coverage (§ → task):** geography seam §4 → T4/T5; data pipeline §5 → T1/T9; elevation §6.1 → T2/T4/T9; coast+estuary §6.2 → T4 (estuary water in slice 2 morphology); landmarks §6.3 → T4 (sculpt) /T9 (positions); client-relay parity §6.4 → T7; hero terrain §6.5 → **deferred to a slice-0 follow-on data task (noted below)**; railway engine reuse §7 → T3; towns-as-markers §8 → T4; shared+solo §9 → T6. Rail timetable §7, town morphology §8.1, period roster §10 are **slices 1–3**, not slice 0 — correct.

**Gap noted:** §6.5 hero LIDAR/sculpt is part of the spec's slice 0 but is a data-acquisition task with no clean unit test; it is **explicitly carried as an extension of Task 9** (sample Defra LIDAR at the hero sites and hand-place the estuary channel / abbey cliff / RHB ravine / Staithes gorge into the elevation overrides). Flagged for the executor; does not block the seam.

**Placeholder scan:** Task 3 references "exact body of …" for the rail-path extraction — this is a verbatim code move, not a placeholder (source lines cited). All new logic (geo-grid, MoorsGeography, the parity ports) is shown in full.

**Type consistency:** `bilinear(grid, gx, gz)`, `blockToGrid(transform, grid, bx, bz)`, `pointToPolyline(px,pz,pts)`, `buildRailPath(stations, heightFn, villages)→{pts,cells,length,stationS}`, `MoorsGeography.heightRaw/height/coastT/railway/railPath`, `MOORS_SEED`/`isMoorsSeed` — names used consistently across JS and the Python port (`bilinear`, `block_to_grid`, `height_raw`).

---

## Execution Handoff

Done = `npm run verify` green (incl. the three new scripts), the moors world loads solo and shared with `MoorsGeography`, client/relay heights agree, towns/coast/stations/landmarks at their data positions. Tasks 1–8 are the testable seam; Task 9 swaps in the real OS data; the §6.5 hero terrain is a flagged extension of Task 9.
