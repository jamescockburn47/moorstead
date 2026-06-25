# Walking Tracks / Roads + Mounted NPCs — Design

**Goal:** Give the c.1900 NYM world a network of walking tracks/roads that NPCs (and the player) travel along — mostly shadowing the railway, striking across the open moor to remote places, and routing *around* buildings — plus mounted NPCs who ride ponies on longer journeys.

**Architecture:** Three layers that mirror the existing rail + flora systems:
1. A deterministic road **route graph** computed from the village/station layout — a new `src/roadpath.js`, the road analogue of `src/railpath.js`.
2. A visible **`RoadLayer` overlay** drawn around the player — a clone of `src/rails.js` (instanced meshes draped on the *real* surface; **no chunk/world-data writes, no reset**). It draws the track **and its own flat wooden plank bridges over rivers + plank crossings over the rail**.
3. **NPC road-preference routing** in `src/roster.js` so folk actually walk the lanes.

A later slice adds **mounted NPCs** (reuse the pony mob + mount pose). Because bridges/crossings are overlay planes, **the entire feature is world-write-free** — nothing touches worldgen.

**Tech:** vanilla JS + three.js. Reuses `railpath.buildRailPath` routing, the `rails.js` overlay pattern, the `entities` pony mob + `main.js` mount pose, and `geo.villages` / `railInfo` / `samplePos` / `riverColumn`.

---

## Decisions locked in (from James)
- **Form:** visible surface **overlay** — no world-data writes, no multiplayer reset.
- **Network:** each village ↔ its **2 nearest neighbours + nearest station**.
- **Character:** roads **mostly shadow the railway** (run parallel, share the engineered valley corridor) **but also cross the open moor** to the remote places the rail never reached.
- **Crossings:** roads cross rivers on their **own narrow flat wooden plank bridges** (a simple plank *plane*, not voxel blocks) and cross the railway at **simple plank level-crossings** — both drawn as overlay geometry, so **nothing touches worldgen**.
- **Buildings:** roads route **around** structures — never cut a building in half.
- **Riders:** **some NPCs ride ponies** instead of walking.

---

## Component 1 — Road route graph (`src/roadpath.js`, exposed via `geo`)

The road analogue of `railpath.js`. Pure, deterministic from the seed, built once and cached.

**Nodes:** `geo.villages` (each `{x, z, ground, name, radius, buildings:[{x0,z0,x1,z1,wallH,type}]}`) plus the rail **stations** (from `geo.railLines()`). Classify each village as **rail-served** (centre within ~40 blocks of a line) or **remote** (far from any rail).

**Edges:** for each village, connect to its **2 nearest neighbours** (simple distance loop over `geo.villages` — there is no built-in helper) **+ its nearest station**. Dedupe undirected edges → a connected parish web.

**Per-edge routing** — pick the cheaper of two strategies:
- **Shadow-rail** (preferred when the rail runs roughly between the endpoints): sample the rail path between the two stations via `geo.samplePosOn(railPath, s)` and **offset the polyline a few blocks to one side** of the centreline (perpendicular `(-tz, tx)` from the tangent), reusing the rail's gentle engineered corridor. Stay clear of the four-foot (offset ≥ ~5 blocks, the flora "lineside" distance).
- **Moor-cross** (remote places / no rail between the ends): route fresh with the **same machinery as `buildRailPath`** — a Catmull-Rom spline, terrain-following, but with **road tolerances**: steeper grade allowed (~1-in-6), water treated as costly so the route crosses rivers at a **narrow, shallow-banked point** (where the lane then lays its own short wooden bridge — Component 5), crosses the railway where it runs **at grade** (not on an embankment/bridge), and **village/building avoidance** (below).

**Building avoidance (James's requirement).** `buildRailPath` already has village-avoidance vias + "building-clearance relaxation" (railpath.js:64–98). Roads, unlike rail, *enter* villages (to the green/centre) — so the road threads to the centre but **nudges its control points out of every building bounding box** (`geo.villageAt(x,z).buildings`, each `{x0,z0,x1,z1}`) plus a 1-block margin. A post-route pass walks the polyline and, for any point inside a building's inflated bbox, pushes it to the nearest box edge. (Tested headlessly — see Testing.)

**Output / API (on `geo`, like the rail ones):**
- `geo.roadPaths()` → `[{ from, to, kind:'shadow'|'moor', path:{pts,length}, bridges:[{s0,s1}], crossings:[{s}] }]`, cached. `pts[i] = {x, z, s, deck}` (`deck` = surface height; on a bridge span it is the flat plank level). `bridges` = chainage spans where the path crosses water; `crossings` = chainages where it meets the rail.
- `geo.roadInfo(x, z)` → `{d, along, deck} | null` — distance to the nearest road within ~4 blocks; for the overlay, NPC snapping, and keeping flora off the road (mirror `floraLayer`'s `railInfo(x,z).d < 4` skip).

## Component 2 — Road overlay (`src/roads.js` `RoadLayer`, clone of `rails.js`)

Pure visual, no world writes. Same lifecycle as `Rails`:
- `constructor(scene, geo)`; `update(dt, playerPos)` rebuilds when the player moves > `REBUILD_MOVE` (~80 blocks); `build(path, centerS)` lays a `WINDOW` (~260 blocks) of road either side; `clear()` disposes meshes.
- **Track surface:** a **packed-earth lane ~2–3 blocks wide** swept along the spline as a ribbon mesh (the `rails.js` ballast-ribbon technique, 117–158), draped on the **real `surfaceHeight`** at each point (not the DEM — same lesson as the NPC walk fix), worn/darker at the edges. A **moor lane**, not a turnpike — maybe fine cobble approaching a village green.
- Keep off the rail four-foot (routing offsets) and out of buildings (routing avoids them).
- Built **with** Component 5's bridges/crossings (below), so the whole road including its water/rail spans is one overlay.
- **Wiring:** construct once at world init and call `roads.update(dt, player.pos)` in the frame loop, exactly where `rails` + `floraLayer` are (main.js).

## Component 3 — NPC road-preference routing (`src/roster.js`)

Make walking NPCs follow the lanes. When an NPC walks between two places (the brain `walk` state, or home↔platform legs), route **home → nearest road node → along the road polyline → road node nearest the destination → short free leg → destination**, instead of a straight cross-country line. Implementation: a thin wrapper over the existing `steerWalk` that feeds it road-polyline waypoints in sequence (and falls back to direct `steerWalk` when no road connects the pair). This is what makes you *see* folk on the lanes — and with the tree/river clipping already fixed, it reads properly.

## Component 4 — Mounted NPCs (`src/entities.js` + `src/roster.js`) — Slice 2

Some NPCs ride rather than walk. Reuse the existing pony mob (`MOB_TYPES.pony` / `makePony`, entities.js:259–308, 822–825) and the player mount pose (`main.js` `updateMount` 2278–2289: model y-offset, yaw sync, leg stride).

- **Who rides:** a deterministic fraction of overland (walk-leg) travellers, weighted by **role** (drovers, farmers, gentry, doctor on rounds, parson) and **distance** (longer journeys ride). Target ~1-in-4 of walking travellers — a dial, like `ERRAND_PERIOD`.
- **The horse:** for MVP the pony **appears with the rider for the journey** (spawned as part of her committed walk, like the de-crowd rail ride) and is removed on arrival — no stables to model yet.
- **Movement & pose:** the pony mob follows the **road** spline at a **ride pace** (~3.5 b/s vs 2.2 walking); the rider's villager mob is pinned to the pony's back (reuse the mount offset/yaw). Both grounded on the real surface.

## Component 5 — Bridges & rail crossings (overlay planes, part of Slice 1)

Roads cross water and rail with their own **simple overlay geometry — no worldgen, no voxel blocks, no terrain regen**:
- **River bridge:** a **flat wooden plank plane** ~2–3 blocks wide spanning the river at the lane's deck level (a thin textured quad from bank to bank, optionally a couple of slim posts/handrails). The router picks a **narrow** crossing so the span stays short and the flat plank reads right.
- **Rail crossing:** a **simple plank level-crossing** where the lane meets the line at grade — a flat plank plane across the four-foot at the rail deck height. (No gates for MVP.)

Both are emitted by `RoadLayer` from the path's `bridges` / `crossings` spans (Component 1), alongside the track ribbon. Because they're flat planes, **the entire feature stays world-write-free — no epoch/reset concern at all.**

---

## Scope

**Slice 1 (core roads — all overlay, no worldgen):** route graph (neighbours + station, shadow-rail + moor-cross, **building avoidance**) + `RoadLayer` overlay **incl. its own flat wooden plank river-bridges + plank rail-crossings** + NPC foot-routing.
**Slice 2 (riders):** mounted NPCs on the roads.

**Deferred (YAGNI):** holloways / sunken lanes, multiple road tiers (turnpike vs footpath), player-laid paths, milestones/signposts, crossing gates, stables/horse ownership, dedicated moor-farm road-only nodes.

## Testing

- **Headless `scripts/verify-roads.mjs`** (added to `npm run verify`): graph is **connected** (every village reachable); **no road point lies inside a building bbox** (the avoidance requirement — the key regression guard); endpoints reach village centres / stations; shadow-rail segments stay within ~a few blocks of the rail and clear of the four-foot; moor-cross segments avoid steep steps and open water **except across a declared `bridges` span**; each `bridges` span actually straddles a `geo.riverColumn`. Pure geometry over `geo`, no GPU — same style as `verify-rail.mjs`.
- **Live (preview eval):** the overlay renders along the spline on the real surface; a flat plank bridge spans a river; `geo.roadInfo` non-null on the track; an NPC `walk` leg follows the road waypoints; (Slice 2) a rider sits on its pony and both track the lane.

## Risks
- **Routing complexity** (terrain + building-avoid + shadow-rail) — mitigated by reusing `buildRailPath`.
- **Performance** of the overlay rebuild + per-frame NPC road-snapping — mitigated by caching + the `rails.js` window/rebuild-on-move pattern.
- **Flat plank bridges over wide/awkward gaps** — keep spans short by routing to narrow crossings; if a chosen crossing is too wide or the banks too uneven for a flat plane, fall the router back to the next-narrowest point.
- **Rider tuning** — the who-rides fraction and pace are dials to tune live.
