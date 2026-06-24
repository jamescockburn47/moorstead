# Rivers v2 (core terrain/water model) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the moors rivers as **valley-floor becks on a smoothed gradient** — no perched water, no canyon at the source, no deep channels on the tops, no trench through open water, no scrambled parallel channels — reaching the sea at Whitby.

**Architecture:** The carve moves **out of `heightRaw` and into a client-side `worldgen` pass** (the minimap reads the rendered surface, not `heightRaw`, so rivers still show; flora/structures keep clear via `nearRiver`). This **removes the two-language parity burden** — the model lives only in `moorsgeo.js` (floats fine), `heightRaw`/the Python mirror go river-free, and `verify-geo-parity` stays green by having nothing river to mirror. The model: chain each river's OS segments (build script), then per river compute a profile anchored to the **valley-floor minimum** (perpendicular search → can't perch), **smoothed** (even steps), **monotonic** (downhill), **tapered to zero at the source**, **capped in depth** (no canyon), and **suppressed in open water**.

**Tech Stack:** ES modules (client), Python build script (`build-moors-data.py`, chaining only), headless Node verify + live frame-pump.

**Spec:** [`2026-06-21-moors-terrain-water-design.md`](../specs/2026-06-21-moors-terrain-water-design.md) Unit B (§3.0–3.7). **Scope:** the terrain/water model only. **Bridge/culvert rail crossings = separate follow-on plan** (this plan keeps the basic "don't flood the track" rule so the rail isn't broken meanwhile). **Branch:** continue on `feat/moors-1900-stage1a`.

**What this replaces (added in Stage 1b, this session):** `moorsgeo.js` `_riverProfile`/`_riverAt`/`riverWaterLevel` (held-level), the `heightRaw` river carve, `geography_moors.py` `_river_profile`/`_river_floor` + its `height_raw` carve, and the on-river samples in `verify-geo-parity.mjs`. v2 rewrites the JS model and **deletes** the Python river code.

---

## Task 1: Chain the river polylines + tag size (build script)

**Files:**
- Modify: `scripts/build-moors-data.py` (`build_rivers`)
- Modify: `data/moors-data.json` (regenerated)
- Modify: `scripts/verify-rivers-moors.mjs`

- [ ] **Step 1: Add the chaining test (failing)**

In `scripts/verify-rivers-moors.mjs`, add before the final `console.log`:
```js
// chained polylines: no big inter-point jump (the easting-sort scrambled multi-segment
// rivers into parallel channels — the Dove had jumps to 344 blocks near Hutton-le-Hole)
for (const r of g.data.rivers) {
  let maxJump = 0;
  for (let i = 1; i < r.points.length; i++) maxJump = Math.max(maxJump, Math.hypot(r.points[i][0] - r.points[i-1][0], r.points[i][1] - r.points[i-1][1]));
  ok(maxJump <= 25, `${r.name} chained (max jump ${Math.round(maxJump)} ≤ 25)`);
  ok(typeof r.size === 'string', `${r.name} has a size`);
}
n += g.data.rivers.length * 2;
```

- [ ] **Step 2: Run — expect failure** (`node scripts/verify-rivers-moors.mjs` → the Dove's max jump ≫25, and no `size` field).

- [ ] **Step 3: Chain + size in `build_rivers`**

In `scripts/build-moors-data.py`, replace the simplify line and the `out.append(...)`:
```js
        pts.sort(key=lambda p: p[0])           # rough downstream order (W->E for the Esk)
        keep = pts[:: max(1, len(pts) // 40)]  # simplify to ~40 points
        blkpts = [list(to_block(E, N)) for E, N in keep]
        # run the Esk's last reach on into Whitby + its tidewater ...
        if nm == "River Esk" and "whitby" in found:
            wx, wz = found["whitby"][1]
            if [wx, wz] != blkpts[-1]:
                blkpts.append([wx, wz])
        out.append({"name": nm, "points": blkpts, "dale": DALE[nm]})
```
with (chain into a single course; OS gives several segments, and an easting-sort scrambles them):
```python
        blk = [list(to_block(E, N)) for E, N in pts]
        # chain into one ordered course by greedy nearest-neighbour from the westmost point
        # (OS delivers several LineStrings; easting-sort interleaves them into parallel channels)
        if len(blk) >= 2:
            start = min(range(len(blk)), key=lambda i: blk[i][0])
            chain = [blk.pop(start)]
            while blk:
                lx, lz = chain[-1]
                j = min(range(len(blk)), key=lambda i: (blk[i][0]-lx)**2 + (blk[i][1]-lz)**2)
                chain.append(blk.pop(j))
            blk = chain
        keep = blk[:: max(1, len(blk) // 60)]   # ~60 ordered points; the model resamples evenly
        MAJOR = {"River Esk", "River Derwent", "River Rye", "River Dove", "River Seven", "River Leven"}
        out.append({"name": nm, "points": keep, "dale": DALE[nm], "size": "major" if nm in MAJOR else "beck"})
```
(The Esk reaches Whitby naturally now via chaining to its northern mouth; the explicit Whitby append is dropped — §3.6 / Task 4 verifies it reaches `coastT>0`.)

- [ ] **Step 4: Regenerate + test**

`python scripts/build-moors-data.py` then `node scripts/verify-rivers-moors.mjs`. Expected: chaining + size assertions pass (max jump ≤25 for every river). Confirm `git`-tracked elevation is unchanged: `node -e "const n=require('./data/moors-data.json');const o=JSON.parse(require('child_process').execSync('git show HEAD:data/moors-data.json'));console.log('elev same:',JSON.stringify(n.elevation)===JSON.stringify(o.elevation))"` → `true`.

- [ ] **Step 5: Commit** (held per James's rule — record only).

---

## Task 2: v2 river model in `moorsgeo.js` (client-only) + remove the 1b heightRaw carve

**Files:**
- Modify: `src/moorsgeo.js`
- Modify: `scripts/verify-rivers-moors.mjs`

- [ ] **Step 1: Add v2 model assertions (failing)**

Append to `scripts/verify-rivers-moors.mjs` (replace the old `_riverProfile`/`_riverAt` flow block from 1b with this):
```js
const esk = g._riverProfile().find(p => p.name === 'River Esk');
ok(esk.wl.every((w, i) => i === 0 || w <= esk.wl[i - 1]), 'Esk water descends (monotonic)');
// no perch: at sampled river points, water level is below the local valley floor
ok(esk.res.every((p, i) => esk.wl[i] <= esk.floor[i] - 1), 'water below valley floor (no perch)');
// source taper: the carve near the source is shallow (≤1 deep)
const src = esk.res[0]; const rc0 = g.riverColumn(src.x, src.z);
ok(rc0 && (g._baseMetresToBlock(src.x, src.z) - rc0.bed) <= 2, 'source carve shallow (no deep channel on the tops)');
// no canyon anywhere: carve depth capped
let maxCut = 0;
for (const p of esk.res) { const rc = g.riverColumn(p.x, p.z); if (rc) maxCut = Math.max(maxCut, g._baseMetresToBlock(p.x, p.z) - rc.bed); }
ok(maxCut <= 5, `carve depth capped (max ${maxCut} ≤ 5, no canyon)`);
ok(g.locationName(esk.res[10].x, esk.res[10].z) === 'Eskdale', 'names the dale');
n += 5;
```

- [ ] **Step 2: Run — expect failure** (`g._riverProfile().…res` / `g.riverColumn` not defined in the v2 shape).

- [ ] **Step 3: Replace the river model**

In `src/moorsgeo.js`, **remove** the 1b carve line in `heightRaw` (`const rv = this._riverAt(x, z); if (rv && rv.floor < h) h = rv.floor;`) so `heightRaw` is river-free. **Replace** the `segDT`-based `_riverProfile`/`_riverAt`/`riverWaterLevel`/`nearRiver` block with the v2 model. Keep the `segDT` helper. Add constants + replace the methods:
```js
const RIVER_HALF = { major: 3, beck: 2 };
const SNAP = 5;        // perpendicular search half-width for the valley floor
const FREEBOARD = 1;   // water sits this far below the valley floor
const RESAMPLE = 4;    // even chainage step
const SMOOTH_WIN = 2;  // moving-average half-window
const TAPER = 60;      // chainage over which the carve ramps up from the source
const MAXCUT = 4;      // hard cap on carve depth below local ground (no canyon)
const BED_DEPTH = 2;   // full water depth downstream
```
```js
  // resample a polyline at even spacing → [{x,z,s}] with cumulative chainage s
  _resample(pts) {
    const out = [{ x: pts[0][0], z: pts[0][1], s: 0 }];
    let s = 0;
    for (let i = 1; i < pts.length; i++) {
      const ax = pts[i - 1][0], az = pts[i - 1][1], bx = pts[i][0], bz = pts[i][1];
      const L = Math.hypot(bx - ax, bz - az); if (L < 1e-6) continue;
      for (let d = RESAMPLE; d <= L + 1e-6; d += RESAMPLE) { const t = d / L; out.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, s: s + d }); }
      s += L;
    }
    return out;
  }

  _riverProfile() {
    if (this._rprof) return this._rprof;
    this._rprof = (this.data.rivers || []).map(r => {
      const res = this._resample(r.points);
      // valley floor: min base terrain in a perpendicular band at each point
      const floor = res.map((p, i) => {
        const a = res[Math.max(0, i - 1)], b = res[Math.min(res.length - 1, i + 1)];
        let px = -(b.z - a.z), pz = (b.x - a.x); const L = Math.hypot(px, pz) || 1; px /= L; pz /= L;
        let m = Infinity;
        for (let o = -SNAP; o <= SNAP; o++) m = Math.min(m, this._baseMetresToBlock(Math.round(p.x + px * o), Math.round(p.z + pz * o)));
        return m;
      });
      // smooth (moving average) then clamp down to the real floor (never lift above land)
      const sfloor = floor.map((f, i) => {
        let sum = 0, k = 0; for (let j = -SMOOTH_WIN; j <= SMOOTH_WIN; j++) { const q = floor[i + j]; if (q !== undefined) { sum += q; k++; } }
        return Math.min(f, sum / k);
      });
      // orient source(high) → mouth(low)
      if (sfloor[0] < sfloor[sfloor.length - 1]) { res.reverse(); sfloor.reverse(); floor.reverse(); for (let i = 0, S = res[res.length - 1].s; i < res.length; i++) res[i].s = S - res[i].s; }
      // monotonic water level, below the valley floor → can't perch
      const wl = new Array(sfloor.length); wl[0] = sfloor[0] - FREEBOARD;
      for (let i = 1; i < sfloor.length; i++) wl[i] = Math.min(wl[i - 1], sfloor[i] - FREEBOARD);
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const p of res) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z; }
      return { name: r.name, dale: r.dale, size: r.size || 'beck', res, wl, floor, minX, maxX, minZ, maxZ };
    });
    return this._rprof;
  }

  // nearest river column → { bed, wl, dale } or null. Client-only (worldgen carves it).
  riverColumn(x, z) {
    let best = null;
    for (const r of this._riverProfile()) {
      const half = RIVER_HALF[r.size] || 2;
      if (x < r.minX - half || x > r.maxX + half || z < r.minZ - half || z > r.maxZ + half) continue;
      for (let i = 0; i < r.res.length - 1; i++) {
        const [d, t] = segDT(x, z, r.res[i].x, r.res[i].z, r.res[i + 1].x, r.res[i + 1].z);
        if (!best || d < best.d) best = { d, r, i, t, half };
      }
    }
    if (!best || best.d >= best.half) return null;
    const r = best.r, i = best.i, t = best.t;
    const wl = Math.round(r.wl[i] + (r.wl[i + 1] - r.wl[i]) * t);
    const s = r.res[i].s + (r.res[i + 1].s - r.res[i].s) * t;
    if (this.coastT(x, z) > 0) return null;                 // merge into the sea — no trench through the bed
    const base = this._baseMetresToBlock(x, z);
    const depth = Math.max(1, Math.round(BED_DEPTH * Math.min(1, s / TAPER))); // taper from ~0 at the source
    let bed = wl - depth;
    if (bed < base - MAXCUT) bed = base - MAXCUT;           // cap the cut — no canyon
    if (bed >= base) return null;                            // nothing to carve here
    return { bed, wl, dale: r.dale };
  }

  riverWaterLevel(x, z) { const rc = this.riverColumn(x, z); return rc ? rc.wl : null; }

  nearRiver(x, z, pad = 0) {
    for (const r of this._riverProfile()) {
      const lim = (RIVER_HALF[r.size] || 2) + pad;
      if (x < r.minX - lim || x > r.maxX + lim || z < r.minZ - lim || z > r.maxZ + lim) continue;
      for (let i = 0; i < r.res.length - 1; i++) if (segDT(x, z, r.res[i].x, r.res[i].z, r.res[i + 1].x, r.res[i + 1].z)[0] < lim) return true;
    }
    return false;
  }
```
In `locationName`, the dale line stays but uses the new method: replace `const rvn = this._riverAt(x, z); if (rvn) return rvn.dale;` with `const rvn = this.riverColumn(x, z); if (rvn) return rvn.dale;` (and, so dales still name even in the open-water/no-carve case, also accept proximity: if `this.nearRiver(x, z, 1)` return the nearest river's dale — keep it simple: `if (rvn) return rvn.dale;` is enough for the channel itself).

- [ ] **Step 4: Run — expect pass** (`node scripts/verify-rivers-moors.mjs` → monotonic, no-perch, shallow source, capped cut, dale named).

- [ ] **Step 5: Commit** (held).

---

## Task 3: Worldgen river pass (carve + water, client-only) + remove the old fill & Python carve

**Files:**
- Modify: `src/worldgen.js`
- Modify: `deploy/world/geography_moors.py` (delete the 1b river carve)
- Modify: `scripts/verify-geo-parity.mjs` (drop the on-river samples)

- [ ] **Step 1: Replace the worldgen river-water fill with the v2 carve pass**

In `src/worldgen.js`, replace the Stage-1b block (`// moor rivers: water sits in the carved channel … if (geo.realWorld && geo.riverWaterLevel) { … }`) with a carve-and-fill pass (the channel is cut client-side now; `h` is the un-carved ground):
```js
        // moor rivers (client carve): cut the beck bed into the un-carved ground and
        // run water down it. Don't flood the track gauge (rail bridges/culverts come later).
        let inRiver = false;
        if (geo.realWorld && geo.riverColumn) {
          const rc = geo.riverColumn(x, z);
          if (rc) {
            inRiver = true;
            for (let y = rc.bed + 1; y <= h + 2 && y < HEIGHT; y++) data[IDX(lx, y, lz)] = B.AIR; // clear the channel
            if (rc.bed > 0) data[IDX(lx, rc.bed, lz)] = B.GRAVEL;                                  // bed
            const tri = geo.railInfo(x, z);
            if (!(tri && tri.d < 2)) for (let y = rc.bed + 1; y <= rc.wl && y < HEIGHT; y++) data[IDX(lx, y, lz)] = B.WATER;
          }
        }
```

- [ ] **Step 2: Suppress surface veg in river columns**

The veg gate already excludes trees/boulders via `nearRiver`. For the surface-veg pass, add `inRiver` to its guard. Change:
```js
        if (!vcol && (!pool || geo.realWorld) && !onRoad && h >= WATER_LEVEL && h <= HEIGHT - 3) {
```
to:
```js
        if (!vcol && (!pool || geo.realWorld) && !onRoad && !inRiver && h >= WATER_LEVEL && h <= HEIGHT - 3) {
```
(`inRiver` is declared above the veg pass in the same column scope — confirm ordering when editing; move the river pass above the veg pass if needed.)

- [ ] **Step 3: Delete the Python river carve (heightRaw is river-free now)**

In `deploy/world/geography_moors.py`, **remove** the river block in `height_raw` (`floor = _river_floor(x, z); if floor is not None and floor < h: h = float(floor)`) and the now-unused `_seg_dt`/`_river_profile`/`_river_floor` + `RIVER_HALF`/`RIVER_DEPTH` constants. The mirror is back to base+peak+coast.

- [ ] **Step 4: Drop the on-river parity samples**

In `scripts/verify-geo-parity.mjs`, remove the river-sampling loop (added in 1b) — there's no river in `heightRaw` to check now. Revert the count assertion to `out.length >= 60`.

- [ ] **Step 5: Build + parity sanity**

`npm run build` (exit 0). Then `node scripts/verify-geo-parity.mjs && python deploy/world/test_moorsgeo.py` → `0 mismatches` (trivially — no river in heightRaw). `npm run verify` → green.

- [ ] **Step 6: Live-verify the rivers (the checks that failed before)**

Reload, enter the moors world (small evals), walk the Esk source→mouth and assert: water **below the banks** (no perch), **shallow at the source** (no deep channel), **descends** (smooth), **reaches the sea**, and **no trench in open water**:
```js
(async () => {
  const { B } = await import('/src/defs.js');
  const geo = game.world.gen.geo;
  const esk = geo._riverProfile().find(p => p.name === 'River Esk');
  Object.assign(game.player, { flying: true, creative: true });
  const out = [];
  for (let i = 0; i < esk.res.length; i += 8) {
    const p = esk.res[i]; const x = Math.round(p.x), z = Math.round(p.z);
    game.player.pos.x = x; game.player.pos.z = z; game.player.pos.y = geo.height(x, z) + 14;
    for (let k = 0; k < 45; k++) game.frame();
    let topW = null; for (let y = 60; y > 5; y--) if (game.world.getBlock(x, y, z) === B.WATER) { topW = y; break; }
    // lowest adjacent ground within 4 blocks (perch check)
    let loAdj = 99; for (let dx=-4;dx<=4;dx++) for (let dz=-4;dz<=4;dz++){ for(let y=60;y>5;y--){const b=game.world.getBlock(x+dx,y,z+dz); if(b!==B.AIR&&b!==B.WATER){ if(y<loAdj)loAdj=y; break;}}}
    out.push({ i, topWater: topW, perched: topW !== null && topW > loAdj, coastT: +geo.coastT(x, z).toFixed(2) });
  }
  const withWater = out.filter(o => o.topWater !== null).length;
  return { samples: out, withWater: withWater + '/' + out.length, anyPerched: out.some(o => o.perched), descends: out.filter(o=>o.topWater).every((o,k,a)=>k===0||o.topWater<=a[k-1].topWater) };
})()
```
Expected: `anyPerched: false`, water present along the course, `descends: true`, and the final samples show `coastT>0` (reached the sea). `preview_console_logs` → no errors. Screenshot/report to James before calling it done.

- [ ] **Step 7: Commit** (held).

---

## Task 4: Structures clear + estuary confirm

**Files:**
- Modify: `src/worldgen.js` (if any structure still ignores `nearRiver`)
- Modify: `scripts/verify-rivers-moors.mjs`

- [ ] **Step 1:** Confirm the moor-cross stamp (realWorld branch) and any station/structure placement honour `nearRiver` (trees/boulders already do). Add a guard `if (geo.nearRiver && geo.nearRiver(lm.x, lm.z, 2)) continue;` to the realWorld cross loop if absent (crosses are on dry high moor, so this is belt-and-braces).
- [ ] **Step 2:** Add an estuary assertion to `scripts/verify-rivers-moors.mjs`: the Esk's last resampled point reaches tidewater —
```js
const eskP = g._riverProfile().find(p => p.name === 'River Esk');
const mouth = eskP.res[eskP.res.length - 1];
ok(g.coastT(Math.round(mouth.x), Math.round(mouth.z)) > 0 || g.coastT(Math.round(mouth.x)+3, Math.round(mouth.z)) > 0, 'Esk mouth reaches the sea');
n += 1;
```
Run `node scripts/verify-rivers-moors.mjs`. If the mouth doesn't reach `coastT>0`, append a short march from the mouth to the nearest sea cell in `build_rivers` (Task 1) and regenerate — then re-test.

- [ ] **Step 3: Commit** (held).

---

## Wrap-up: verify, build, deploy
- [ ] `npm run verify` (green) + `python deploy/world/test_moorsgeo.py` (0 mismatches) + `npm run build` (exit 0).
- [ ] `npx vercel deploy --prod --yes`; confirm the new bundle hash via PowerShell `Invoke-WebRequest`.
- [ ] Hand to James — walk a dale (Eskdale) and the source; confirm the beck sits in the valley, runs smoothly down, emerges shallow at the top, and reaches the sea. **Rail crossings (bridge/culvert) are the next plan.**

---

## Self-Review (completed during planning)

**Spec coverage:** §3.0 chaining → Task 1. §3.1 valley-floor + smooth + monotonic profile → Task 2 (`_riverProfile`). §3.2 shallow carve + MAXCUT + source taper + no-open-water → Task 2 (`riverColumn`) + Task 3 (worldgen). §3.3 size → Task 1 (`size`) + Task 2 (`RIVER_HALF`). §3.5 structures clear → Task 4. §3.6 Esk→sea → Task 1 (chaining) + Task 4 (verify). §3.7 parity → **removed** (client-only; heightRaw river-free, Task 3). Testing §4 — no-perch / no-canyon / source-shallow / smooth / continuity / chaining / estuary all have assertions (Tasks 1-4, live Task 3 Step 6). **Rail crossings (§3.4) deliberately deferred to the follow-on plan**, with the basic "don't flood the gauge" kept (Task 3 Step 1).

**Placeholder scan:** none — model code is concrete. The only conditional is the estuary march (Task 4 Step 2), gated on a concrete `coastT` test.

**Type consistency:** `riverColumn(x,z)→{bed,wl,dale}` used by `worldgen` (Task 3) + `riverWaterLevel` + `locationName` (Task 2); `_riverProfile()` returns `{name,dale,size,res,wl,floor,bbox}` used by `riverColumn`/`nearRiver`/tests; `size` set in Task 1, read via `RIVER_HALF[size]` in Task 2; `inRiver` declared before the veg gate (Task 3 Steps 1-2). The 1b heightRaw carve + Python river code + on-river parity samples are explicitly removed (Tasks 2-4) so nothing references the old `_riverAt`.
