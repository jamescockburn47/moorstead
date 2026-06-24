# Moors 1900 — Stage 1b (rivers, flowing downhill) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the moors-world rivers visible and **flow strictly downhill** — carve each river's channel along its real gradient and run water down it from the tops to the sea, stepping down reach by reach, with the dales named (Eskdale, Rosedale, Farndale…).

**Architecture:** Each river gets a **monotonic descending water profile** (integer block heights, computed once from the OS polyline + the DEM). `heightRaw` is carved down to a channel floor below that profile within a narrow band — done **identically in `moorsgeo.js` (JS) and `geography_moors.py` (Python)** so client/relay parity stays exact. The profile and carve are **integer-valued**, so JS and Python match to the bit (the parity test asserts ≤1e-6). Water is filled in the channel client-side (`worldgen.js`) from the carved floor up to the profile level — render-only, no parity impact. `locationName` returns the dale near a river.

**Tech Stack:** ES modules (client), Python 3.13 (relay mirror + build script), headless Node verify scripts, `npx vercel deploy --prod --yes`.

**Spec:** [`2026-06-21-moors-1900-stage1-landscape-design.md`](../specs/2026-06-21-moors-1900-stage1-landscape-design.md) §6 Unit D. **Scope:** rivers only. The terrain-landmark sculpt (Roseberry `hill`→`peak` fix, Hole of Horcum, the tors) is the *other* half of 1b and gets its own short follow-on plan — kept separate so this ships the rivers James asked for first.

**Key facts established (2026-06-21):**
- Today all water sits at the global `WATER_LEVEL = 26` (`worldgen.js`: `if (h < WATER_LEVEL) fill to 26`). Moor rivers are far above that, so they render dry — this is why they're invisible.
- Rivers in `data/moors-data.json`: `{name, points:[[x,z]…]}` in block coords (Esk, Murk Esk, Derwent, Rye, Dove, Seven). `build_rivers` sorts points by easting and simplifies to ~40.
- `MoorsGeography.heightRaw` (JS, [moorsgeo.js](../../../src/moorsgeo.js)) = base + peak-landmarks + coast; mirrored by `geography_moors.height_raw` (Python). A `segDist(px,pz,ax,az,bx,bz)` helper already exists in `moorsgeo.js` (added in 1a for the causeway).
- Parity: `scripts/verify-geo-parity.mjs` emits `deploy/world/parity-ref.json` (60 samples, **step 400 — misses narrow channels**); `deploy/world/test_moorsgeo.py` asserts Python==JS within 1e-6.

---

## Task 1: Add the missing rivers + dale names to the data

**Files:**
- Modify: `scripts/build-moors-data.py` (`build_rivers`)
- Modify: `data/moors-data.json` (regenerated)
- Create: `scripts/verify-rivers-moors.mjs`
- Modify: `package.json`

- [ ] **Step 1: Discover the exact OS watercourse names in-bounds**

The OS Open Rivers layer names rivers in a `watercourse_name` column; we must use the exact strings. Run:
```bash
cd /c/Users/James/Desktop/Moorcraft && python -c "
import sqlite3, struct
from pathlib import Path
import importlib.util
spec = importlib.util.spec_from_file_location('b','scripts/build-moors-data.py'); b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
con = sqlite3.connect(str(b.WORK/'openrivers.gpkg'))
names = {}
for nm, blob in con.execute('SELECT watercourse_name, geometry FROM watercourse_link WHERE watercourse_name IS NOT NULL'):
    pts = b.parse_gpkg_linestring(blob)
    if any(b.in_bounds(E,N) for E,N in pts): names[nm] = names.get(nm,0)+1
for nm in sorted(names): print(repr(nm), names[nm])
"
```
Expected: a list including `'River Esk'`, `'River Leven'`, `'River Seph'`, `'River Riccal'`, `'River Tees'` (or close variants). **Record the exact strings** for Leven, Seph, Riccal, Tees as they appear; use them verbatim in Step 2. (If a name is absent in-bounds, drop it and note so in the commit.)

- [ ] **Step 2: Write the failing data test**

Create `scripts/verify-rivers-moors.mjs`:
```js
// Headless: the moors data carries the rivers (incl. the added Leven/Seph/Riccal),
// each with a dale name and an in-bounds polyline.
import assert from 'node:assert';
import { MoorsGeography } from '../src/moorsgeo.js';

const g = new MoorsGeography();
const t = g.data.transform;
const W = (t.maxN - t.minN) / t.metresPerBlock, D = (t.maxE - t.minE) / t.metresPerBlock;
const byName = Object.fromEntries(g.data.rivers.map(r => [r.name, r]));
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

for (const nm of ['River Esk', 'River Leven', 'River Seph', 'River Riccal']) ok(byName[nm], `river present: ${nm}`);
ok(g.data.rivers.every(r => typeof r.dale === 'string' && r.dale.length), 'every river has a dale name');
ok(byName['River Esk'].dale === 'Eskdale', 'Esk → Eskdale');
ok(byName['River Seven'].dale === 'Rosedale', 'Seven → Rosedale');
ok(byName['River Dove'].dale === 'Farndale', 'Dove → Farndale');
ok(g.data.rivers.every(r => r.points.every(([x, z]) => x >= -2 && x <= W + 2 && z >= -2 && z <= D + 2)), 'all river points in bounds');

console.log(`verify-rivers-moors: ${n} assertions OK`);
```

- [ ] **Step 3: Run it — expect failure**

Run: `node scripts/verify-rivers-moors.mjs`
Expected: FAIL — `river present: River Leven` (not in data yet) or `every river has a dale name` (no `dale` field yet).

- [ ] **Step 4: Extend `build_rivers`**

In `scripts/build-moors-data.py`, replace the `build_rivers` river-name loop. Change the tuple list and attach a dale name. Replace:
```python
    for nm in ("River Esk", "Murk Esk", "River Derwent", "River Rye", "River Dove", "River Seven"):
        pts = []
        for (blob,) in con.execute(
                "SELECT geometry FROM watercourse_link WHERE watercourse_name=?", (nm,)):
            for E, N in parse_gpkg_linestring(blob):
                if in_bounds(E, N):
                    pts.append((E, N))
        if len(pts) < 4:
            continue
        pts.sort(key=lambda p: p[0])           # rough downstream order (W->E for the Esk)
        keep = pts[:: max(1, len(pts) // 40)]  # simplify to ~40 points
        out.append({"name": nm, "points": [list(to_block(E, N)) for E, N in keep]})
```
with (use the exact names confirmed in Step 1 — adjust if any differ):
```python
    DALE = {
        "River Esk": "Eskdale", "Murk Esk": "Eskdale", "River Derwent": "the Derwent valley",
        "River Rye": "Ryedale", "River Dove": "Farndale", "River Seven": "Rosedale",
        "River Leven": "the Leven valley", "River Seph": "Bilsdale",
        "River Riccal": "Riccaldale", "River Tees": "Teesdale",
    }
    for nm in DALE:
        pts = []
        for (blob,) in con.execute(
                "SELECT geometry FROM watercourse_link WHERE watercourse_name=?", (nm,)):
            for E, N in parse_gpkg_linestring(blob):
                if in_bounds(E, N):
                    pts.append((E, N))
        if len(pts) < 4:
            continue
        pts.sort(key=lambda p: p[0])           # rough downstream order (W->E for the Esk)
        keep = pts[:: max(1, len(pts) // 40)]  # simplify to ~40 points
        out.append({"name": nm, "points": [list(to_block(E, N)) for E, N in keep], "dale": DALE[nm]})
```

- [ ] **Step 5: Regenerate + confirm**

Run: `python scripts/build-moors-data.py`
Expected: the `rivers:` line now lists Esk, Murk Esk, Derwent, Rye, Dove, Seven **plus Leven, Seph, Riccal** (and Tees if in-bounds). Then:
```bash
node scripts/verify-rivers-moors.mjs
```
Expected: `verify-rivers-moors: N assertions OK`.

- [ ] **Step 6: Wire into verify**

In `package.json`, append ` && node scripts/verify-rivers-moors.mjs` to `"verify"`, and add `"verify:riversmoors": "node scripts/verify-rivers-moors.mjs"`. Run `npm run verify` — all green. (Parity check still passes; we haven't carved yet.)

---

## Task 2: River profile + channel carve in `moorsgeo.js` (JS)

The heart of "flows downhill". A per-river monotonic descending water profile (integers), and `heightRaw` carved down to a channel floor below it.

**Files:**
- Modify: `src/moorsgeo.js`
- Modify: `scripts/verify-rivers-moors.mjs` (add carve/flow assertions)

- [ ] **Step 1: Add failing flow assertions**

Append to `scripts/verify-rivers-moors.mjs` (before the final `console.log`):
```js
// the Esk's water profile descends monotonically source→mouth and the channel
// floor sits below the water line (so water is contained + always runs downhill)
const prof = g._riverProfile().find(p => p.name === 'River Esk');
ok(prof && prof.wl.length === prof.pts.length, 'Esk profile built');
ok(prof.wl.every((w, i) => i === 0 || w <= prof.wl[i - 1]), 'Esk water level never rises (downhill)');
// sample the carve at a midstream point: ground is carved below the local water level
const mid = prof.pts[Math.floor(prof.pts.length / 2)];
const rv = g._riverAt(mid[0], mid[1]);
ok(rv && rv.floor < rv.wl, 'channel floor below water level at midstream');
ok(g.height(mid[0], mid[1]) <= rv.floor, 'heightRaw carved to (or below) the channel floor on the river');
ok(g.locationName(mid[0], mid[1]) === 'Eskdale', 'names the dale on the Esk');
n += 5;
```

- [ ] **Step 2: Run — expect failure**

Run: `node scripts/verify-rivers-moors.mjs`
Expected: FAIL — `g._riverProfile is not a function`.

- [ ] **Step 3: Add the profile + `_riverAt` + carve + naming**

In `src/moorsgeo.js`, add a segment distance+parameter helper at module scope, next to the existing `segDist` (added in 1a):
```js
// point-to-segment: returns [distance, t] where t in [0,1] is the projection param
function segDT(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  let t = l2 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return [Math.hypot(px - (ax + t * dx), pz - (az + t * dz)), t];
}
```
Add carve constants near the top of the file (after the imports):
```js
const RIVER_HALF = 2;   // channel half-width in blocks (≈5 wide)
const RIVER_DEPTH = 3;  // channel floor sits this far below the water line
```
Add these methods to the `MoorsGeography` class (e.g. just before `locationName`):
```js
  // Per-river monotonic descending water profile (integer block heights), built once.
  // base[] is the DEM ground at each polyline point; oriented source(high)→mouth(low);
  // wl[i] = min(wl[i-1], base[i]) so the water surface never rises — it only runs downhill.
  _riverProfile() {
    if (this._rprof) return this._rprof;
    this._rprof = (this.data.rivers || []).map(r => {
      let pts = r.points.map(p => [p[0], p[1]]);
      let base = pts.map(p => this._baseMetresToBlock(p[0], p[1]));
      if (base.length >= 2 && base[0] < base[base.length - 1]) { pts.reverse(); base.reverse(); }
      const wl = new Array(base.length);
      wl[0] = base[0];
      for (let i = 1; i < base.length; i++) wl[i] = Math.min(wl[i - 1], base[i]);
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [x, z] of pts) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; }
      return { name: r.name, dale: r.dale, pts, wl, minX, maxX, minZ, maxZ };
    });
    return this._rprof;
  }

  // nearest river within RIVER_HALF → {floor, wl, dale}, else null. floor/wl are integers.
  _riverAt(x, z) {
    let best = null;
    for (const r of this._riverProfile()) {
      if (x < r.minX - RIVER_HALF || x > r.maxX + RIVER_HALF || z < r.minZ - RIVER_HALF || z > r.maxZ + RIVER_HALF) continue;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [d, t] = segDT(x, z, r.pts[i][0], r.pts[i][1], r.pts[i + 1][0], r.pts[i + 1][1]);
        if (!best || d < best.d) best = { d, r, ni: t >= 0.5 ? i + 1 : i };
      }
    }
    if (!best || best.d >= RIVER_HALF) return null;
    const wl = best.r.wl[best.ni];
    return { floor: wl - RIVER_DEPTH, wl, dale: best.r.dale };
  }

  // water surface level at a river column (for worldgen to fill), else null
  riverWaterLevel(x, z) { const rv = this._riverAt(x, z); return rv ? rv.wl : null; }
```
Then carve in `heightRaw` — add immediately **after** the peak-landmark loop and **before** the coast block (`const t = this.coastT(x, z);`):
```js
    // river channel: carve the ground down to the channel floor (below the descending
    // water profile) so the beck runs downhill in its bed. Integer-valued → parity-exact.
    const rv = this._riverAt(x, z);
    if (rv && rv.floor < h) h = rv.floor;
```
Finally, name the dale — in `locationName`, add this **after** the landmark/village/coast checks and **before** the high-moor/dale fallback:
```js
    const rvn = this._riverAt(x, z);
    if (rvn) return rvn.dale;
```

- [ ] **Step 4: Run — expect pass**

Run: `node scripts/verify-rivers-moors.mjs`
Expected: `verify-rivers-moors: N assertions OK` (profile monotonic, floor below water, heightRaw carved, dale named).

- [ ] **Step 5: Commit-point check (no commit yet — James's rule)**

Run `npm run verify`. Expected: green **except** `verify-geo-parity` may still pass on the JS side (it only sanity-checks ranges), but the Python mirror is now out of sync — that's Task 3. Do not deploy until Task 3 restores parity.

---

## Task 3: Mirror the carve in `geography_moors.py` + extend the parity check

`heightRaw` changed, so the Python mirror must carve identically, and the parity reference must include on-river samples (the step-400 grid misses channels).

**Files:**
- Modify: `deploy/world/geography_moors.py`
- Modify: `scripts/verify-geo-parity.mjs`

- [ ] **Step 1: Port the profile + carve to Python**

In `deploy/world/geography_moors.py`, add constants near the top (after `HEIGHT = 64`):
```python
RIVER_HALF = 2
RIVER_DEPTH = 3
```
Add a segment helper + a cached profile + a carve lookup (module scope), mirroring the JS exactly:
```python
def _seg_dt(px, pz, ax, az, bx, bz):
    dx, dz = bx - ax, bz - az
    l2 = dx * dx + dz * dz
    t = (((px - ax) * dx + (pz - az) * dz) / l2) if l2 else 0.0
    t = max(0.0, min(1.0, t))
    return math.hypot(px - (ax + t * dx), pz - (az + t * dz)), t

_RPROF = None
def _river_profile():
    global _RPROF
    if _RPROF is not None:
        return _RPROF
    _RPROF = []
    for r in DATA.get("rivers", []):
        pts = [[p[0], p[1]] for p in r["points"]]
        base = [_base(p[0], p[1]) for p in pts]
        if len(base) >= 2 and base[0] < base[-1]:
            pts.reverse(); base.reverse()
        wl = [0] * len(base)
        wl[0] = base[0]
        for i in range(1, len(base)):
            wl[i] = min(wl[i - 1], base[i])
        xs = [p[0] for p in pts]; zs = [p[1] for p in pts]
        _RPROF.append({"pts": pts, "wl": wl, "minX": min(xs), "maxX": max(xs), "minZ": min(zs), "maxZ": max(zs)})
    return _RPROF

def _river_floor(x, z):
    best = None
    for r in _river_profile():
        if x < r["minX"] - RIVER_HALF or x > r["maxX"] + RIVER_HALF or z < r["minZ"] - RIVER_HALF or z > r["maxZ"] + RIVER_HALF:
            continue
        pts = r["pts"]
        for i in range(len(pts) - 1):
            d, t = _seg_dt(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])
            if best is None or d < best[0]:
                best = (d, r, i + 1 if t >= 0.5 else i)
    if best is None or best[0] >= RIVER_HALF:
        return None
    return best[1]["wl"][best[2]] - RIVER_DEPTH
```
Then carve in `height_raw` — add **after** the peak loop and **before** `t = coast_t(x, z)`:
```python
    floor = _river_floor(x, z)
    if floor is not None and floor < h:
        h = float(floor)
```

- [ ] **Step 2: Add on-river samples to the parity reference**

In `scripts/verify-geo-parity.mjs`, after the existing grid loop that builds `out`, add river-channel samples so the parity test actually exercises the carve:
```js
// also sample ON each river (the 400-grid steps past narrow channels), so the
// parity check covers the carve. Use polyline vertices — they're on the centreline.
for (const r of geo.data.rivers || [])
  for (let i = 0; i < r.points.length; i += 3)
    out.push([r.points[i][0], r.points[i][1], geo._heightRawNoFbm(r.points[i][0], r.points[i][1])]);
```
Update the sanity assertion that hard-codes 60 — change:
```js
(out.length === 60 ? ok : bad)(`emitted ${out.length} reference samples`);
```
to:
```js
(out.length >= 60 ? ok : bad)(`emitted ${out.length} reference samples`);
```

- [ ] **Step 3: Regenerate the reference + run both sides**

Run:
```bash
node scripts/verify-geo-parity.mjs && python deploy/world/test_moorsgeo.py
```
Expected: JS prints `reference written + sane`; Python prints `checked N samples, 0 mismatches` and `PARITY: client/relay heights agree`. If there are mismatches, the JS and Python carve diverge — diff the two `_riverAt`/`_river_floor` implementations until identical (they must use the same ops; both are integer-valued so any mismatch is a logic difference, not float drift).

- [ ] **Step 4: Full verify**

Run `npm run verify`. Expected: all green including `verify-geo-parity` and `verify-rivers-moors`.

---

## Task 4: Fill the water in `worldgen.js` (client) + verify downhill flow

**Files:**
- Modify: `src/worldgen.js` (the per-column surface loop)

- [ ] **Step 1: Add the moors river-water fill**

In `src/worldgen.js`, find the sea/beck fill:
```js
        // t' sea, tarns and becks
        if (h < WATER_LEVEL) {
          for (let y = h + 1; y <= WATER_LEVEL; y++) data[IDX(lx, y, lz)] = B.WATER;
        }
```
Add immediately after it:
```js
        // moor rivers: water sits in the carved channel at its local (descending)
        // level — h is the carved channel floor here, so the beck runs downhill.
        if (geo.realWorld && geo.riverWaterLevel) {
          const wl = geo.riverWaterLevel(x, z);
          if (wl !== null && wl > h) {
            for (let y = h + 1; y <= wl; y++) data[IDX(lx, y, lz)] = B.WATER;
            data[IDX(lx, h, lz)] = B.GRAVEL; // bed
          }
        }
```
(Filling water at `h+1` makes the existing veg gate at the column — which requires `data[IDX(lx, h+1, lz)] === B.AIR` — skip naturally, so no heather/grass grows in the river.)

- [ ] **Step 2: Build**

Run `npm run build`. Expected: exit 0.

- [ ] **Step 3: Live-verify the rivers run downhill, contained and continuous**

Reload the preview, enter the moors world (small evals to avoid the 30s frame-load timeout — start world in one eval, then sample in another). Then sample the Esk's water surface along its length and assert it descends and is continuous:
```js
// after: await game.startMoorsWorld(); pump ~60 frames in a prior eval
(async () => {
  const { B } = await import('/src/defs.js');
  const geo = game.world.gen.geo;
  const prof = geo._riverProfile().find(p => p.name === 'River Esk');
  // walk every ~5th polyline point; teleport, mesh, read the top water block
  const samples = [];
  for (let i = 0; i < prof.pts.length; i += 5) {
    const [x, z] = prof.pts[i];
    game.player.pos.x = x; game.player.pos.z = z; game.player.pos.y = geo.height(x, z) + 12;
    Object.assign(game.player, { flying: true, creative: true });
    for (let k = 0; k < 50; k++) game.frame();
    let topWater = null;
    for (let y = 60; y > 5; y--) if (game.world.getBlock(x, y, z) === B.WATER) { topWater = y; break; }
    samples.push({ i, x, z, wl: geo.riverWaterLevel(x, z), topWater });
  }
  const levels = samples.map(s => s.topWater).filter(v => v !== null);
  const monotonic = levels.every((v, k) => k === 0 || v <= levels[k - 1]);
  return { samples, waterColumnsFound: levels.length + '/' + samples.length, descendsDownhill: monotonic };
})()
```
Expected: most/all sampled columns have a water block (`waterColumnsFound` high), and `descendsDownhill: true` (the Esk's surface never rises as you go downstream). Also `preview_console_logs` shows zero errors. (If a backgrounded-tab eval times out, restart the preview server and retry in smaller steps — this is a known harness quirk, not a code fault.)

---

## Task 5: Full verify, build, deploy 1b

- [ ] **Step 1:** `npm run verify` (all green) — including `verify-geo-parity`, `verify-rivers-moors`, and the 1a checks.
- [ ] **Step 2:** `python deploy/world/test_moorsgeo.py` → `PARITY: client/relay heights agree`.
- [ ] **Step 3:** `npm run build` (exit 0).
- [ ] **Step 4:** `npx vercel deploy --prod --yes`; confirm the new bundle hash live via PowerShell `Invoke-WebRequest` (curl.exe is broken on this box).
- [ ] **Step 5:** Hand to James — explore the dales (Eskdale, Rosedale, Farndale…) and confirm the becks run downhill and read right. Commit/merge only when he asks.

---

## Self-Review (completed during planning)

**Spec coverage (Unit D):** incise + water → Tasks 2,4. Strictly-downhill → the monotonic `wl` profile (Task 2 Step 3) + the live monotonic assertion (Task 4). Parity (carve mirrored, parity-gated) → Task 3, with on-river samples closing the coarse-grid gap. Naming (dales) → Task 2 + Task 1. Missing rivers (Leven/Seph/Riccal/Tees) → Task 1. Performance (bbox reject) → `_riverAt`/`_river_floor` bbox guard. **Deferred (own follow-on plan):** terrain-landmark sculpt (Roseberry `hill`→`peak`, Horcum hollow, Wainstones/Bridestones tors) — flagged in the spec as the other half of 1b.

**Placeholder scan:** none — all code is concrete. The one runtime-discovered value (exact OS watercourse names) is resolved by an explicit query step (Task 1 Step 1) before use, not guessed.

**Type/name consistency:** `_riverProfile()` returns `{name,dale,pts,wl,minX..maxZ}` used identically by `_riverAt` (JS) and `_river_profile`/`_river_floor` (Python); `riverWaterLevel` (JS-only) feeds `worldgen`; `RIVER_HALF`/`RIVER_DEPTH` defined in both languages with the same values (2/3); the carve formula `floor = wl - RIVER_DEPTH`, `if (floor < h) h = floor` is identical JS/Python; integers throughout → parity exact (≤1e-6).

**Risk carried:** if OS lacks `River Seph`/`River Riccal` exactly in-bounds, Task 1 Step 1 surfaces the real names (or their absence) before the data test asserts them — adjust the `DALE` keys + the test's expected list together if so.
