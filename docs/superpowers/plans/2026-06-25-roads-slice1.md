# Roads — Slice 1 (core roads) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A deterministic road network drawn as a pure surface overlay — villages↔neighbours+station, shadowing the rail where parallel and crossing the moor to remote places, routing around buildings, with its own flat wooden plank bridges over rivers and plank crossings over the rail — that NPCs walk along.

**Architecture:** `src/roadpath.js` (route graph + routing, the analogue of `railpath.js`) → exposed via `geo.roadPaths()`/`geo.roadInfo()` → drawn by `src/roads.js` `RoadLayer` (clone of `src/rails.js`, draped on the real `surfaceHeight`) → NPCs prefer roads in `src/roster.js`. No worldgen, no world-data writes.

**Tech Stack:** vanilla JS + three.js. Reuse `railpath.buildRailPath` (Catmull-Rom + terrain-follow + village/building avoidance), `rails.js` (instanced ribbon overlay, window/rebuild-on-move), `geo.villages`/`samplePosOn`/`railInfo`/`riverColumn`/`nearRiver`.

**Reference reading before starting:** `src/railpath.js` (whole file — the routing to mirror), `src/rails.js` (whole file — the overlay to clone), `src/floraLayer.js:82-119` (the `railInfo(x,z).d<4` clearance pattern), `src/roster.js` `steerWalk`/`townAnchor`/`surfaceHeight` (NPC driving), `src/geography.js` `railPath()`/`villages`/`inVillage`/`villageAt`/`riverColumn`/`nearRiver`.

---

### Task 1: Road network graph — nodes + edges

**Files:** Create `src/roadpath.js`; Test `scripts/verify-roads.mjs`.

- [ ] **Step 1 — Write the failing test.** In `scripts/verify-roads.mjs`, build a `Geography` for the real-Moors seed (copy the harness header from `scripts/verify-rail.mjs`), call `buildRoadNet(geo)`, assert: every village appears in ≥1 edge; the edge graph is **connected** (BFS from village 0 reaches all); each village has an edge to a station node.
- [ ] **Step 2 — Run it, see it fail** (`node scripts/verify-roads.mjs` → `buildRoadNet is not a function`).
- [ ] **Step 3 — Implement `buildRoadNet(geo)`** in `roadpath.js`: nodes = `geo.villages` + station points (`geo.railLines()` stops mapped to positions via the rail path). Edges: for each village, its 2 nearest neighbours (distance loop) + nearest station; dedupe undirected. Return `{nodes, edges}` (edges carry `{from, to}` node refs, no geometry yet).
- [ ] **Step 4 — Run, see pass.**
- [ ] **Step 5 — Commit** (`feat(roads): road network graph (nodes + edges)`).

### Task 2: Per-edge routing — shadow-rail + moor-cross

**Files:** `src/roadpath.js`; `scripts/verify-roads.mjs`.

- [ ] **Step 1 — Failing test:** after routing, assert every edge has a `path` with `pts` whose ends sit within ~`radius` of the two node centres; a **shadow** edge's mid-point is within ~12 blocks of `geo.railInfo(midx,midz).d`; a **moor** edge's points step ≤ road-grade between consecutive samples.
- [ ] **Step 2 — Run, fail.**
- [ ] **Step 3 — Implement per-edge routing.** Classify `kind`: **shadow** if `geo.railInfo` is small at both ends AND a rail chainage span links them — then sample the rail path between the two stations and offset perpendicular `(-tz,tx)` by ~`ROAD_OFFSET` (≥5). Else **moor**: route with a `buildRailPath`-style Catmull-Rom through the ends, terrain-following on `geo.height`, road grade `~1-in-6`. Store `pts[i]={x,z,s,deck}` (`deck`=`geo.height` for now). Attach `path` to each edge.
- [ ] **Step 4 — Run, pass.**
- [ ] **Step 5 — Commit** (`feat(roads): shadow-rail + moor-cross edge routing`).

### Task 3: Building avoidance (the key guard)

**Files:** `src/roadpath.js`; `scripts/verify-roads.mjs`.

- [ ] **Step 1 — Failing test:** assert **no** `pts` point of any edge lies inside any `geo.villages[].buildings[]` bbox inflated by 1 (`x0-1..x1+1`, `z0-1..z1+1`). This is the regression guard for "roads don't cut buildings in half."
- [ ] **Step 2 — Run, fail** (raw routes clip buildings).
- [ ] **Step 3 — Implement `nudgeOutOfBuildings(pts, geo)`** run as a post-pass per edge: for each point inside an inflated building bbox, push it to the nearest bbox edge (compare the 4 edge distances, move to the closest + margin); re-smooth the polyline (one averaging pass) so the nudge isn't a kink. Apply in the edge loop.
- [ ] **Step 4 — Run, pass.**
- [ ] **Step 5 — Commit** (`feat(roads): route around buildings`).

### Task 4: Bridge + rail-crossing detection, and `roadInfo`

**Files:** `src/roadpath.js`; `scripts/verify-roads.mjs`.

- [ ] **Step 1 — Failing test:** assert each edge exposes `bridges:[{s0,s1}]` and `crossings:[{s}]`; every `bridges` span straddles water (`geo.riverColumn` truthy somewhere in `[s0,s1]`); `roadInfo(net,x,z)` returns `{d,along,deck}` within ~2 blocks of a known on-track point and `null` well off it.
- [ ] **Step 2 — Run, fail.**
- [ ] **Step 3 — Implement:** scan each `path` by chainage; a contiguous run where `geo.riverColumn(x,z)` is truthy → a `bridges` span (set those `pts.deck` to a flat plank level = max bank height +1); a point where the path crosses the rail centreline (`geo.railInfo(x,z).d < ~2`) → a `crossings` entry. Add a `cells` spatial index (copy `railpath.js` `cells`) and `roadInfo(net,x,z)` (mirror `railInfo`).
- [ ] **Step 4 — Run, pass.**
- [ ] **Step 5 — Commit** (`feat(roads): river-bridge + rail-crossing spans, roadInfo`).

### Task 5: Expose on `geo`

**Files:** `src/geography.js`; `scripts/verify-roads.mjs`.

- [ ] **Step 1 — Failing test:** `geo.roadPaths()` returns the routed edges (cached — same ref on 2nd call); `geo.roadInfo(x,z)` delegates.
- [ ] **Step 2 — Run, fail.**
- [ ] **Step 3 — Implement** `roadPaths()` (lazy-build `buildRoadNet(this)` once, cache on `this._roadNet`) and `roadInfo(x,z)` on the `Geography` class, mirroring `railPath()`/`railInfo()`.
- [ ] **Step 4 — Run, pass; add `verify-roads.mjs` to `npm run verify`** (package.json verify script list).
- [ ] **Step 5 — Commit** (`feat(roads): expose geo.roadPaths/roadInfo + npm run verify`).

### Task 6: `RoadLayer` overlay — the track ribbon

**Files:** Create `src/roads.js`.

- [ ] **Step 1 — Implement `RoadLayer`** by cloning `src/rails.js`: `constructor(scene, geo)`, `update(dt, playerPos)` (rebuild on >REBUILD_MOVE), `build(path, centerS)` (WINDOW window), `clear()`. Draw the **packed-earth track** as the ballast-style ribbon (rails.js 94-115) ~2.5 blocks wide, draped on `surfaceHeight(world,geo,x,z)` per point (import from `roster.js` or geo), earth-brown material, no world writes.
- [ ] **Step 2 — Wire into `main.js`:** construct `this.roads = new RoadLayer(scene, geo)` next to `this.rails`; call `this.roads.update(dt, this.player.pos)` in the frame loop next to `this.rails.update` (main.js ~3776) and the warden-ride path (~3703).
- [ ] **Step 3 — Live verify (preview):** the lane renders along a known edge on the real surface (screenshot / `geo.roadInfo` non-null under the visible track).
- [ ] **Step 4 — Commit** (`feat(roads): RoadLayer track overlay`).

### Task 7: Plank bridges + rail crossings (overlay planes)

**Files:** `src/roads.js`.

- [ ] **Step 1 — Implement** in `RoadLayer.build`: for each `path.bridges` span, emit a **flat wooden plank plane** (a quad ribbon at the span's flat `deck`, ~2.5 wide, plank texture/colour, two slim post lines optional) from bank to bank; for each `path.crossings`, emit a **plank plane** across the four-foot at the rail deck height (`geo.samplePosOn` deck at that chainage).
- [ ] **Step 2 — Live verify:** a plank bridge spans a river edge; a crossing sits flat over the rails.
- [ ] **Step 3 — Commit** (`feat(roads): plank river-bridges + rail crossings`).

### Task 8: Keep flora off the roads

**Files:** `src/floraLayer.js`.

- [ ] **Step 1 — Implement:** in the scatter loop (floraLayer.js ~108), add `const rd = gen.geo.roadInfo(x,z); if (rd && rd.d < 3) continue;` so flowers don't sprout through the lane (mirror the existing `railInfo` four-foot skip).
- [ ] **Step 2 — Live verify:** no flora instances on the track.
- [ ] **Step 3 — Commit** (`feat(roads): keep flora off the lane`).

### Task 9: NPCs prefer the roads

**Files:** `src/roster.js`.

- [ ] **Step 1 — Implement road-routing for the `walk` state.** Add `roadWaypoints(from, to, geo)` → if an edge connects the two place-anchors, return the road `pts` (trimmed to the segment between the nearest on-path points to `from`/`to`); else `null`. In `update()`'s `walk` branch, if waypoints exist, `steerWalk` toward the current waypoint and advance the index on arrival; else fall back to the existing direct `steerWalk(from,to)`.
- [ ] **Step 2 — Live verify (preview):** a streamed NPC on a `walk` leg between two road-linked villages tracks the lane (sample its path vs `geo.roadInfo`), not a straight diagonal; still grounded (no clipping).
- [ ] **Step 3 — Run `npm run verify`** (roster + roads assertions green) and **commit** (`feat(roads): NPCs walk the lanes`).

### Task 10: Final pass

- [ ] **Step 1 — `npm run verify`** all green; **Step 2 — `npm run build`** clean; **Step 3 — live sanity** (overlay + a bridge + an NPC on the lane, one screenshot); **Step 4 — deploy** per the EVO/Vercel flow on James's go (client-only — no brain, no world reset).

---

## Self-review notes
- **Spec coverage:** graph (T1), shadow+moor routing (T2), building avoidance (T3), bridges+crossings (T4,T7), geo API (T5), overlay (T6,T7), flora clearance (T8), NPC routing (T9) — all spec components covered; mounted NPCs are Slice 2 (separate plan).
- **Type consistency:** `path.pts={x,z,s,deck}`, `bridges=[{s0,s1}]`, `crossings=[{s}]`, `roadInfo→{d,along,deck}|null` used consistently T1→T9.
- **Key guard:** T3's "no point inside a building bbox" test is the explicit regression check for James's requirement.
