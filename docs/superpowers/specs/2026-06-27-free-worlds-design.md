# Free Worlds — relaxed-survival shared kids' world (Slice 1: `bairns-free`)

**Date:** 2026-06-27
**Status:** Approved design, ready for implementation plan
**Origin:** Henry says the game is too hard, the building licences too restrictive, and they
"disappear from the inventory." We want a freer, more fun version of the worlds with less
restriction, *in addition to* the existing harder versions.

## Problem (confirmed in code)

The survival economy that frustrates a young player:

1. **Builds crumble.** A placed block outside a land claim decays after 30 game-days; inside a
   lapsed claim it gradually crumbles. ([editledger.js:49-63](../../../src/editledger.js))
   On `bairns` this is already 2× slower and claims no longer lapse, but "build in the wrong
   spot → it disappears" still bites.
2. **The licence is one-use and vanishes.** `CLAIM_TOKEN` ("Claim Stake") is a single-use
   starting token, consumed the moment you stake your one free 8 m claim
   ([main.js:3260](../../../src/main.js)). After that every further claim costs brass
   (60p + radius²·2), so a child who spent theirs has no free way to protect new builds. This is
   exactly "too restrictive / disappears from inventory." It is *working as designed* — the fix
   is a different mode, not a bug fix.
3. **General survival friction.** Deep mining needs a mine licence + pick tier + pit-prop/lamp/
   winch fixtures; the `bairns` world wipes you to bare hands on entry
   ([main.js:836](../../../src/main.js)).

## Decisions (locked)

- **Shape:** a *dedicated* free world — a new shared room, not a difficulty toggle on an
  existing one. The existing `bairns` room is untouched and remains the "harder version."
- **Feel:** *relaxed survival* — still gather + craft (the fun loop). No flying, no infinite
  creative cupboard (those stay warden-only).
- **First slice:** the shared kids' world. Room id **`bairns-free`**.
- **Mining:** keep pick-tier progression (wood → stone → iron to dig deeper). Drop the mine
  licence requirement and the pit-prop/lamp/winch fixtures.
- **Entry:** grant a **starter pack** instead of the bare-hands wipe.

## Architecture

### The one new primitive: free-world classification

A `FREE_ROOMS` set and a `baseRoom(room)` helper that strips the relay's shard suffix (the
relay shards a full room as `bairns-free-2` once it hits 15 players —
[server.py MAX_PLAYERS=15]). A single predicate `game.freeWorld()` returns true when
`baseRoom(netRoom)` is in `FREE_ROOMS`.

```
FREE_ROOMS = { 'bairns-free' }                 // extend later: 'moor-free', etc.
baseRoom(room)  → room with trailing /-\d+$/ stripped
game.freeWorld() → netActive && FREE_ROOMS.has(baseRoom(netRoom))
```

**Fold-in fix:** `bairnLocked()` currently tests `netRoom === 'bairns'` exactly, so it returns
false on the `bairns-2` shard — a latent bug. Since we are adding shard-aware room
classification anyway, route `bairnLocked()` through `baseRoom()` too. `bairns-free` is its own
base name, so it is **not** a bairns room and **not** subject to bairns rules — free rules
supersede.

### What `freeWorld()` lifts

All keyed off the single predicate. Survival mechanics that stay ON: gather, craft, pick-tier
progression, hunger/health (unchanged), mobs, quests (minus the dark Dracula arc, already
excluded on kids' worlds).

| Restriction | Survival (today) | Free world |
|---|---|---|
| Build decay | placed blocks expire (30 d / claim-scaled) | **never expire** |
| Dig backfill | digs backfill after 24 d | **never backfill** |
| Deep digging | requires active mine deed + depth envelope | **allowed anywhere**, pick-tier still gates depth |
| Mine fixtures | props (>10 m) / lamp (>20 m) / winch (>30 m) required | **not required** |
| Claims / deeds | needed to protect builds; fees + weekly upkeep + lapse | **not needed** for anything; staking still allowed but optional (e.g. stock pens) |
| Entry | bare-hands pocket wipe | **starter pack**, no wipe |
| Map | — | **same** moors-1900 NYM world |

Implementation touch-points:

- **`editledger.js` `isExpired`** — when `free`, the `build` branch returns `false` (never
  expires) and the `dig` branch returns `false`. Thread a `free` flag in from the caller
  (world.js decay pass), alongside the existing `decayScale`.
- **`editledger.js` `mayDigDeep`** — when `free`, skip the `nomine`, `fixture` checks; keep the
  `depthlimit` removed (no mine → no limit) and keep the `pick` check (pick-tier progression).
  Cleanest: pass `free` and short-circuit to pick-only gating. Depth is then bounded only by
  pick tier, mirroring the existing `depthBandFor` ladder.
- **`main.js` `deedTick` / decay caller** — pass `free` so the world-regen pass honours it.
- **`main.js` `enforceBairnRules`** — on a free world, **skip the pocket wipe**; instead, if the
  player has never been granted the free-world starter pack (`player.freeStarter` flag, persists
  like `bairnFresh`), fill a starter pack once. Creative cupboard stays hidden (relaxed, not
  creative). `creativeLocked()` still true (no creative for non-wardens on any shared world).
- **Seed mapping** ([main.js:1760](../../../src/main.js)) — add `bairns-free` to the set that
  loads the `t-moors-1900` seed, so it is the same map as `bairns`/`moor`.

### Starter pack

Granted once per account on first free-world entry (flag `player.freeStarter`, same persistence
pattern as `player.bairnFresh`). Concrete contents (ids from [defs.js](../../../src/defs.js)):

- `I.W_PICK` ×1, `I.W_AXE` ×1, `I.W_SHOVEL` ×1 — dig/chop/mine immediately
- `B.PLANKS` ×32 — build straight away
- `B.LOG` ×16 — craft more planks/sticks/tools
- `B.TORCH` ×8 — light for night/caves

Modest on purpose: enough that a 7-year-old isn't stuck, not so much that gathering becomes
pointless. Tunable.

### Server side (EVO — data only, no relay/app code change)

- The relay creates rooms lazily and allowlists nothing
  ([server.py:116,226](evo:~/moorstead/worldsvc/server.py)), so `bairns-free` exists the moment
  someone joins. Its edits/deeds live in their own per-room file — a fresh, independent world on
  the shared moors-1900 terrain.
- Repoint Henry's code in `dash/codes.json` from `{"room":"bairns"}` to `{"room":"bairns-free"}`
  (or via the LAN-only `POST /api/setroom`). `ROOM_RE = ^[a-z0-9-]{1,24}$` accepts it.
- Back up `codes.json` before editing (`cp codes.json codes.json.bak-YYYYMMDD-freeworld`).
- Optional: `dash/app.py` `_pick_room` shards a *base* name — `bairns-free` shards cleanly to
  `bairns-free-2`; no change needed unless we want a different cap. Leave as-is.

### Help / copy

- `game-facts.js` deeds entry ([:60](../../../src/game-facts.js)) — add a free-world note: on
  the free moor, builds never crumble and you don't need a claim or a licence.
- `ui.js` mode-scaling help ([:388](../../../src/ui.js)) — describe the free world's rules.
- A welcome toast on first free-world entry (replacing the bare-hands toast) explaining the
  relaxed rules and the starter pack.

## Testing (headless verify gate — project requires it)

New `scripts/verify-free-worlds.mjs` (Node, no DOM/THREE — mirrors existing pure-module tests):

1. `baseRoom('bairns-free-2') === 'bairns-free'`; `freeWorld`-style predicate true for
   `bairns-free` and its shards, false for `bairns`, `bairns-2`, `moor`.
2. `bairnLocked` is shard-aware: true for `bairns` and `bairns-2`, false for `bairns-free`.
3. `isExpired` with `free=true`: a `build` edit 999 days old → not expired; a `dig` edit
   999 days old → not expired. With `free=false` and no claim → expired (regression guard).
4. `mayDigDeep` with `free=true`: deep dig with no mine deed → allowed when pick tier suffices;
   still **denied** when the pick is too weak for the depth band (pick-tier preserved).
5. Starter-pack grant: first free entry fills the pack and sets `freeStarter`; second entry is a
   no-op (idempotent), and does **not** wipe earned inventory.

Wire into `npm run verify`. Must be green before deploy.

## Scope boundary / explicit follow-ups (NOT this slice)

- Kid-facing free/hard **world picker** for non-wardens (today only the warden has `pickWorld`).
- Free variants of the **adult** worlds (`moor-free`, `dale-free`, …).
- Free **individual** (single-player) world. Note: single-player already permits the creative
  toggle today, so a relaxed-survival individual mode is a smaller, separate piece.
- Resource-regrowth tuning (faster plant/tree/ore regrowth) for free worlds, if kids run dry.

## Files touched (this slice)

- `src/deeds.js` or a small new `src/rooms.js` — `FREE_ROOMS`, `baseRoom`, classification
  helpers (pure module, easy to verify).
- `src/editledger.js` — `free` flag through `isExpired` + `mayDigDeep`.
- `src/main.js` — `freeWorld()`, shard-aware `bairnLocked()`, decay caller, `enforceBairnRules`
  starter pack + wipe skip, seed mapping.
- `src/player.js` — `freeStarter` flag (persisted).
- `src/game-facts.js`, `src/ui.js` — copy.
- `scripts/verify-free-worlds.mjs` — tests; registered in the verify runner.
- EVO `dash/codes.json` — repoint Henry's code (data, backed up first).
