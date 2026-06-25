# Roads — Slice 2 (mounted NPCs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Some NPCs ride a pony along the lanes instead of walking — they appear with a mount for the journey, sit on its back, trot the road at a faster pace, and the pony is gone on arrival.

**Architecture:** Reuse the existing pony mob (`MOB_TYPES.pony` / `makePony`, `src/entities.js`) and the player mount pose (`mountPony`/`updateMount`, `src/main.js`). The roster drives the pony like it drives streamed villagers; the rider's villager mob is pinned to the pony's back. All in `src/roster.js` (+ a small entities spawn hook if needed). Builds on Slice 1's `roadWaypoints` + `surfaceHeight`.

**Reference reading:** `src/entities.js` — `MOB_TYPES.pony` (~822), `makePony` (~259), how mobs are spawned + the `streamed` flag on villagers; `src/main.js` — `mountPony`/`dismountPony`/`updateMount` (~2245-2289: the pony model y-offset, yaw sync, leg-stride animation); `src/roster.js` — the `walk` branch wiring from Slice 1 (`roadWaypoints`, `e._roadI`, `steerWalk`), `surfaceHeight`, `townAnchor`, how streamed villager mobs are created/removed.

---

### Task 1: Who rides — deterministic, role + distance weighted

**Files:** `src/roster.js`; `scripts/verify-roster.mjs`.

- [ ] **Step 1 — failing test:** `ridesThisLeg(npc, from, to, geo)` is deterministic per (id, leg); over the cast it returns true ~20–30% of the time; a `drover`/`farmer`/`gentry`/`doctor`/`parson` role rides more often than a generic villager; very short legs (< ~80 blocks) never ride.
- [ ] **Step 2 — run, fail.**
- [ ] **Step 3 — implement `ridesThisLeg`:** hash `(id + from + to)` → a stable 0..1; threshold by role weight (mounted-roles higher) and leg distance (longer → more likely), gated off for short legs. Target ~1-in-4 overall.
- [ ] **Step 4 — run, pass.**
- [ ] **Step 5 — commit** (`feat(roads): deterministic who-rides for mounted NPCs`).

### Task 2: Spawn the pony + seat the rider

**Files:** `src/roster.js` (+ `src/entities.js` if a spawn hook is needed).

- [ ] **Step 1 — implement:** when a walk leg starts and `ridesThisLeg` is true, spawn a **pony mob** (via the entities system — find the spawn path; give it the same "driven externally, own-AI-off" treatment as streamed villagers so it doesn't wander) and stash it on the entity (`e._pony`). Seat the rider: each frame, set the rider villager mob's pos to the pony's back (reuse the `updateMount` offset — model y-offset + a small seat lift) and yaw = pony yaw.
- [ ] **Step 2 — live check (preview):** a pony appears under a riding NPC and she sits on its back (not through it, not floating), facing travel.
- [ ] **Step 3 — commit** (`feat(roads): spawn + seat mounted NPCs on a pony`).

### Task 3: Trot the lane

**Files:** `src/roster.js`.

- [ ] **Step 1 — implement:** in the `walk` branch, if `e._pony`, drive the **pony** along `roadWaypoints` (same waypoint logic as Slice 1) at a **ride pace** (~3.5 b/s vs 2.2 walking) using `steerWalk` on the pony mob, grounded on `surfaceHeight`; the rider follows (Task 2 seat). Animate the pony's legs (reuse the `updateMount` stride). No lane → trot direct (still mounted).
- [ ] **Step 2 — live check:** a mounted NPC trots the lane visibly faster than a walker, tracking the road + grounded.
- [ ] **Step 3 — commit** (`feat(roads): mounted NPCs trot the lanes`).

### Task 4: Dismount + despawn on arrival

**Files:** `src/roster.js`.

- [ ] **Step 1 — implement:** when the leg ends (arrival at `to`, or the brain state leaves `walk`, or the entity is removed/streamed out), remove the pony mob from the scene (mirror the streamed-villager removal) and clear `e._pony`/seat state so she reverts to a normal walker/`at` NPC. Guard against leaks (despawn in `_remove`/teardown too).
- [ ] **Step 2 — live check:** no orphan ponies after a rider arrives or streams out; pony count stays bounded.
- [ ] **Step 3 — commit** (`feat(roads): dismount + despawn mounts on arrival`).

### Task 5: Final pass

- [ ] `npm run verify` green; `npm run build` clean; live sanity (a rider on a pony trotting a lane, dismounts on arrival, no orphans); deploy on James's go (client-only).

---

## Self-review notes
- **Spec coverage:** who-rides (T1), pony+seat (T2), road trot at ride pace (T3), despawn (T4) — covers Component 4.
- **Dials:** ride fraction (T1 threshold) + ride pace (T3) are live-tunable, like `ERRAND_PERIOD`.
- **Leak guard:** T4's despawn-in-`_remove`/teardown is the regression risk (orphan ponies) — watch pony count.
