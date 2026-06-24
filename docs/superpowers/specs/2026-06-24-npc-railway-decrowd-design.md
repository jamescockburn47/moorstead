# De-crowd the railway: fix NPC waiting, clipping, and boarding

**Date:** 2026-06-24
**Status:** design approved, ready for implementation plan
**Scope:** `src/roster.js` (client) + `C:\Users\James\moorstead-evo-work\brain\act.py` (brain, off-repo git mirror)

## Problem

On the live Moors 1900 world the railway stations are mobbed with NPCs standing about, they clip in and out of scenery, and boarding/alighting reads as broken (teleports). Trains are infrequent (~15 min cycle), so anything that parks travellers at a platform for the whole journey accumulates a crowd.

### Root causes (verified in code)

1. **Platform loitering is a client rendering artifact.** `roster.js` `_driveRail` (wait phase, roster.js:324–332) parks every rail-state NPC at the *origin* station anchor for the **entire** logical leg, milling 2–8 blocks off it. With ~450 s between trains at a station, a whole window's worth of travellers piles up.
2. **Terminus funnelling (brain).** `act.py` `_pick_errand` (act.py:77–88) sends every *due* traveller to a **line terminus** (market/port end), and `_rail_options(..., to_market=True)` (act.py:46–61) offers the termini. Destinations concentrate on Whitby/Pickering, so those platforms and town streets crowd worst (arrivals **and** return-trip departures stack there).
3. **Clipping = DEM grounding.** All rail wait/board/alight positions ground on `geo.height()` (DEM elevation, roster.js:336), which is **blind to voxel blocks** — the platform deck, station building, walls. NPCs stand at `DEM+1`, which can be inside or below the built platform, and the position pops as they move across columns where DEM ≠ the real voxel surface. The waiting spread offset has **no obstacle check** (unlike walkers, which pass `walkableStep`), so folk stand inside the station building.
4. **Boarding teleports = schedule decoupling.** Brain rail leg = `legs × RAIL_SECONDS` = 60–240 s (roster_sim.py:37–40, world.py RAIL_SECONDS=60). The visible train calls at a given station only ~every 450 s. The brain marks "arrived" long before the slow visible train could carry the NPC, and `_driveRail`'s caller force-completes the ride when the brain leaves `rail` state (roster.js:227–230) → the NPC teleports to the destination instead of riding.

### Product decisions (locked with James, 2026-06-24)

- **Keep the world busy.** Leave `ERRAND_PERIOD = 1800` (the deliberate "plenty travelling" setting). De-crowd by *where/when* travellers render, not by cutting journey count.
- **Cap each platform at 5** visible NPCs; overflow waits in town and catches a later train.
- **Ride the real train.** Fully diegetic: wait in town → walk to the platform as the visible train nears → board on dwell → ride visibly in the coaches → alight at the destination dwell. Accept occasional graceful fades as the price of this on a slow timetable.

## Architecture

### Ownership contract (the crux)

"Ride the real train" requires the **client ride (`e.ride`) to be authoritative** once committed, **overriding the brain's premature arrival** until the *visible* train delivers the NPC.

- **Brain owns intent + endpoints:** who travels, `from → to` on which line, and the in-voice intent.
- **Client `e.ride` owns the visible journey** against the visible train, and runs to completion even as the brain races ~10× ahead.
- **On ride completion the client re-syncs** to whatever the brain now says (drop `e.ride`, adopt current state).
- **Graceful fade** (§5) is the single escape hatch when a visible ride can't be delivered.

This replaces the current lockstep-to-brain behaviour (roster.js:227–230), which is the teleport bug. The `titleForced` ride path (title-screen preview) is preserved untouched.

## Components

All client work is in `src/roster.js`. No other client file changes (the helpers it needs — `_visibleTrain`, `_nextTrainCall`, `steerWalk`, `walkableStep`, `townAnchor`, `_spread`, `geo.samplePosOn` — already exist).

### 1. `surfaceHeight(world, x, z)` — voxel-aware grounding (new, exported for the verifier)
- Scan the column for the top **solid** block (reuse the established idiom, e.g. entities.js:2572, with `isSolid` from `defs.js`), starting a few blocks above `geo.height(x,z)` and scanning down. Return `topSolidY + 1`.
- **Fallback:** if no solid block is found in range (chunk unloaded — `getBlock` returns air), return `geo.height(x,z) + 1`. This prevents a pop to `y ≈ 0`.
- Cache by rounded `(x,z)` in a `Map`, capped (clear when large, mirroring `moorsgeo` `colCache`). Platform/building geometry is effectively static; a slightly stale surface is acceptable.
- Replaces `geo.height(...) + 1` in `_lerpTo` and everywhere a rail NPC is grounded.

### 2. `_platformPoint(line, station)` — where to stand (new)
- Resolve the line path (`geo.railPaths().find(...).path`) and the station chainage `path.stationS[idx]`.
- `p = geo.samplePosOn(path, s)` gives `{x, z, deck, tx, tz}` (tangent + normal). Offset laterally to the platform side: `x + (-tz) * OFFSET, z + tx * OFFSET` (≈2 blocks). **Determine the platform-side sign empirically:** probe both lateral offsets with `surfaceHeight`; the platform side is the one standing on built platform blocks (resolves above the track deck / passes `walkableStep`). Cache the chosen sign per station.
- Ground with `surfaceHeight`. Return `{x, y, z}`.
- Cache per `(line, station)` — static geometry.

### 3. `_potterAt(m, anchor, nowEff, dt)` — town amble (extracted)
- Lift the existing `'at'` amble (roster.js:251–264) verbatim into a shared helper: re-aim every 5–13 s within a small radius, obstacle-checked via `walkableStep`, grounded via `surfaceHeight`.
- Used by both the `'at'` branch **and** the rail-`wait`-not-due branch, so waiting travellers potter in their town exactly like resting folk.

### 4. Rewritten `_driveRail(e, m, dt)` lifecycle

Phase `wait`:
- `due = _nextTrainCall(line, from)`.
- **Rank** = this NPC's index among all phase-`wait` NPCs sharing `(line, from)`, ordered by stable id-hash. Built once per frame at the top of `update()` into a `Map<"line|from", id[]>` (O(N log N), ~100 NPCs).
- `rank ≥ PLATFORM_CAP (5)` → **overflow:** `_potterAt(townAnchor(from))`. Never approaches. Stays committed and pottering; once the 5 ahead board and leave the `wait` group, the per-frame rank map drops this NPC below 5 and it becomes eligible for the **next** train (~one cycle later, well inside the 720 s timeout).
- `rank < 5`:
  - `due > LEAD (75 s)` → `_potterAt(from-town anchor)` — *off* the platform. **This is what empties the platforms.**
  - `due ≤ 75 s` → `steerWalk` toward `_platformPoint(line, from)`; on arrival stand there with a small per-id along-platform spread, obstacle-checked.
- Board when `vt.dwelling && vt.station === from` **and** the NPC is within ~2 blocks of the platform point → `phase = 'aboard'`.

Phase `aboard` (unchanged geometry, roster.js:301–315): ride visibly in the coaches; slot 1..8 behind the loco; grounded on the train deck.

Phase transition `aboard → done`: when `vt.dwelling && vt.station === to`.

Phase `done` (alighting): place on the **destination platform** (`_platformPoint(line, to)`, grounded), then `steerWalk` toward `townAnchor(to)` so they clear the platform into town. When within arrival distance, **drop `e.ride`** → next frame re-syncs to brain state.

### 5. Graceful fade — `_resolveToBrain(e, m)` (new), replaces teleport
The committed ride is **authoritative and persists past the brain's arrival** (§6) — a brain that has marked "arrived" does **not** trigger a fade, because that is the normal case (brain leg 60–240 s ≪ ~450 s train gap) and the NPC is correctly still waiting for / aboard the real train. Fade is the rare escape hatch, triggered only when the visible ride is genuinely undeliverable:
- the **720 s safety timeout** (roster.js:299) — couldn't board within ~1.6 train cycles (e.g. line/direction mismatch, or a data fault). This single condition subsumes "the train will never dwell at `from`."

Behaviour: resolve to the brain's current `npcVoxelPos`. If the jump is more than a few blocks, **hide-and-reappear** (`grp.visible = false` for the transition frame, then show at the new position) — no cross-map slide, no teleport-through-scenery. Near the player, prefer a quick opacity/scale fade (deferred polish; hide-and-reappear is the MVP). Drop `e.ride`.

**Why fades are rare in practice:** a committed NPC potters in `from`-town, boards the next correctly-directed visible train (≤ ~one cycle), rides to `to`, alights, walks into town, drops the ride, and re-syncs — and by then the brain almost always already says `at <to>`, so the re-sync is seamless (no fade). Fades only occur on the genuine 720 s stuck case.

### 6. Caller change in `update()` (roster.js:227–242)
- **Remove the force-complete** at roster.js:227–230 (the teleport bug).
- **Commit-once, persist-until-done:** create `e.ride` from brain `rail` state **only when `!e.ride`** (no active ride). Once committed, the ride is authoritative and `_driveRail` runs it to completion (`done`) or timeout — **never overwrite a live `e.ride`** if the brain enters a new `rail` leg meanwhile, and **do not** clear/force-done it when the brain leaves `rail`.
- **On completion** (`done` reached, or fade): drop `e.ride`, then the next frame adopts the brain's **current** state fresh (`at` → potter, `walk` → steerWalk, `rail` → commit a new ride). Because the brain has usually already arrived at `to`, this re-sync is seamless.
- `titleForced` keeps its existing guard and path.
- Build the per-frame `(line|from) → id[]` rank map (phase-`wait` NPCs only) before the NPC loop.

### Brain: spread destinations off the termini

File: `C:\Users\James\moorstead-evo-work\brain\act.py` (keep `ERRAND_PERIOD = 1800`).

- **`_pick_errand(npc)`** (act.py:77–88): instead of always the terminus, choose from a **varied candidate set** — the line termini **and** intermediate market/worthwhile stations on lines through `npc.place` — selected deterministically by `(_h(npc.id) + errand_count)` so an NPC's successive errands differ and the cast fans across stations. Still "a real reason to go"; just not always the same two ends.
- **`_rail_options(place, to_market=True)`** (act.py:46–61): keep the termini, **also** offer intermediate market stations so the LLM itself can spread.
- Journey *count* is unchanged (world stays busy); destination *concentration* drops.

## Data flow

```
brain /api/roster/state (1.5 s poll, npc.js rosterState)
  → RosterClient._sync: spawn/update one streamed mob per NPC
  → RosterClient.update(dt) each frame:
       build (line|from)→id[] rank map
       per NPC:
         chatting?            → face player, hold
         e.ride committed?    → _driveRail (authoritative; persists past brain arrival)
         else brain 'rail'?   → commit e.ride {wait} (only if no active ride), _driveRail
         else brain 'walk'?   → steerWalk
         else brain 'at'?     → _potterAt
  _driveRail ride machine:
       wait  → potter-in-town (overflow / due>LEAD) | walk-to-platform (rank<5 & due≤LEAD)
       board → aboard (visible train dwells at `from`, NPC on platform)
       aboard→ ride in coaches → done (dwells at `to`)
       done  → step off, walk into town → drop ride → resync
       can't-deliver → _resolveToBrain (graceful fade)
```

## Tunables

| Name | Value | Where | Note |
|------|-------|-------|------|
| `PLATFORM_CAP` | 5 | roster.js | max visible NPCs converging per platform |
| `LEAD` | 75 s | roster.js | how early a ranked NPC walks to the platform |
| `PLATFORM_OFFSET` | ~2 blocks | roster.js | lateral offset from track to platform-side standing point |
| `ERRAND_PERIOD` | 1800 s | act.py | **unchanged** — keeps the world busy |
| `RAIL_SECONDS` | 60 | world.py | brain leg time (read-only here; explains decoupling) |

## Error handling / edge cases

- **Chunk unloaded:** `surfaceHeight` falls back to `geo.height` (no y≈0 pop).
- **Unknown station/anchor:** existing null guards (`townAnchor` → null → skip frame) retained.
- **Brain offline:** existing `_teardown`/fallback-crowd path retained.
- **Re-sync after a ride:** usually seamless (the brain already says `at <to>`, the platform the NPC just alighted on); only if the brain has moved far on does it hide-and-reappear — never a teleport-through-scenery.
- **`titleForced` rides:** untouched.
- **`from` far from current town:** if `townAnchor(from)` is implausibly far from the mob, fall back to converge-in-place rather than a long walk.

## Testing & verification

- **`scripts/verify-roster.mjs`** (headless, in `npm run verify`): extend to assert
  - waiting/standing positions ground on the **voxel surface** (a built platform column resolves above its DEM height);
  - no standing spot fails `walkableStep` (nobody inside a building/on the rails);
  - the rank map caps a `(line, from)` group's approachers at 5.
- **Brain:** `pytest brain/test_act.py brain/test_roster_sim.py` stays green; **add** a test asserting `_pick_errand` / repeated errands spread across non-terminus stations (not all termini).
- **Live (preview-eval on the moors world):** count platform occupants (≤5), confirm travellers potter in town until ~LEAD, watch one full board → ride → alight with correct grounding, confirm no teleport pop.

## Risks

- **Rare graceful fades** only on the 720 s stuck case (§5) — not on normal brain arrival, so the common path rides and re-syncs seamlessly. Flagged so a fade isn't mistaken for a regression.
- **Walk-to-platform assumes `from` ≈ current town** — true for outbound (leave from home) and return (leave from terminus town); covered by the far-anchor fallback.
- **Per-frame rank map** is O(N log N) at ~100 NPCs — negligible, but built once per frame, not per NPC.

## Out of scope

- Reducing journey count / `ERRAND_PERIOD` (explicitly kept busy).
- Model tiering, relay-side roster streaming (separate scaling work).
- Real economy/goods movement on errands (still narrated; parked separately).
- Opacity/scale fade polish (MVP is hide-and-reappear).
