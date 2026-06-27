# Kids' Feedback — implementation plan (Henry 8 + James 12 playtest)

**Goal:** Work through the playtester devlog across ALL worlds, with sensible per-world tuning
(free/bairns relaxed, adult/hard keeps challenge). Then add a prominent front-page co-developer
credit and restore Henry's sheepdog Bess. Autonomous run — no check-ins.

Per-world hooks already exist: `game.freeWorld()`, `game.bairnLocked()`, `isChildrensWorld()`
(`src/rooms.js`), `decayScale`. Decisions below are grounded in the codebase map.

## Batch 1 — Survival & economy (main.js, player.js, deeds.js, economy.js, editledger.js, rooms.js)

- **BAL4 death penalty (NEW — today death loses nothing):** on death, on NON-free worlds, lose
  **half of each material stack** (round down) and **half your brass**; **keep tools and pets**.
  Free/bairns world: lose nothing (relaxed). Implement in a `applyDeathPenalty()` called from the
  death transition (`main.js:4108`). Pets live on `player.pets` (untouched). Tools = items in
  `TOOLS`; everything else stackable is "materials".
- **F6 respawn relocation:** respawn at a *different* spawn than the death spot. Shared: pick a
  different village (`findSpawnAt` with a bumped index). Solo: offset spawn. Pairs with BAL4.
- **BAL2 mining depth:** default mine depth 10→**20**; max 40→**60** (`deeds.js` makeDeed depth,
  `main.js:upgradeMine` cap); keep `depthBandFor` tiers. Free world already pick-only.
- **BAL1 resource nerf (non-free worlds only):** fishing recast cooldown (~2s), deep-sea
  double-haul 40%→20% (`main.js landFish`), `FREIGHT_ALLOWANCE` 96→**48** (`economy.js`). Free
  world: leave generous. Update verify-economy expectations if they pin these.
- **F3 building licence for the free world (Henry wants the building ritual back):** add a
  **reusable** claim/building-licence to the free starter so kids can stake homestead claims for
  fun (named plot + breeding pens via existing deedTick) without it being mandatory. Add
  `I.CLAIM_TOKEN` to `FREE_STARTER`; in free world make claim staking free/repeatable. Copy.

## Batch 2 — Landmarks, terrain, trains (landmarks.js, main.js, moorsgeo.js, worldgen.js, railpath.js)

- **B8 landmark protection bug (CONFIRMED):** `protectedAt` (`landmarks.js`) returns true for any
  built-material block above ground near a landmark, INCLUDING player builds. Fix: consult
  `world.editLedger` — if `(x,y,z)` is a player `build` edit, return false (never protected).
  Player builds near landmarks become breakable; they still decay if unclaimed.
- **B1 train ETA "0s away":** `nextCallAt` returns `0` as a not-found fallback (`main.js:1931`),
  shown as "0s". Fix: return `Infinity` when no dwell found; display "no train due" instead of 0.
- **B2 train clips building at (1464,34,2359):** train follows a pre-baked deck with no voxel
  collision. Add a rail-corridor keep-out so village building columns can't generate within ~4
  blocks of the rail spline (`worldgen` building placement; use `geo` rail-distance).
- **B4 Whitby sea drop:** the coast cliff (`moorsgeo.js` BEACH/RISE/FLAT/TAPER, ~308-320) is a
  near-vertical 1-block-per-step wall. Gentle it near towns: stretch RISE horizontally (≥2 blocks
  per vertical step) so it terraces rather than sheer-drops. Keep coast/rail verify green.
- **B3 lantern doorway guard (defensive):** ensure no interior lantern coincides with a building's
  door cell (`worldgen` stampBuildingColumn); skip/relocate if it would.

## Batch 3 — Entities & villagers (entities.js, roster.js, multiplayer.js, EVO server.py)

- **B5 animals merging:** no ground-mob separation exists. Add a cheap separation pass in
  `updateMobs` — push ground animals apart when within ~0.8 blocks.
- **B7 frozen villagers:** the `isLoaded` early-return (`entities.js:2256`) leaves villagers at
  DEM height with no physics if their chunk is late; the streamed-surface cache never invalidates
  on edits. Fix: when the chunk IS loaded, ground-snap to the real voxel surface; invalidate the
  surface cache on block edits.
- **BAL3 idle villagers:** lower platform-loitering and make idle NPCs potter/wander more
  (`roster.js` waitMode / PLATFORM_CAP / potter).
- **B6 ridden-horse/pet visibility (scoped slice):** animals are client-local. Make a remote
  player's **mount** visible: include a `mount` flag in pos updates (`multiplayer.js` + EVO
  `server.py` pos relay), render remote players on a pony when mounted. Full per-pet sync deferred.

## Batch 4 — UI, social, onboarding (ui.js, main.js, multiplayer.js, EVO server.py, milestones.js)

- **F4 dump resources:** press **Q** to drop the held hotbar stack (`dropAtPlayer`); add a trash
  affordance in the inventory (drag a stack onto a bin to discard).
- **F5 trade/share between players:** relay-routed gift — sender `{type:'gift', to, goods}`, EVO
  `server.py` forwards, receiver `addItem`s. Offer "Give" when right-clicking a remote player.
- **F7 onboarding/tutorial:** first-run intro for ALL new players (not just bairns) — a short
  welcome + auto-open the "First Day" handbook once + a couple of starter-objective toasts.
- **F1 villager dialogue made pivotal:** a floating indicator over villagers who have something to
  say (an available notice-board job / a problem), plus a first-time hint. Makes the existing
  T-to-talk AI loop visible and central.
- **F2 sell-everywhere clarity:** selling already works at every station; add clear "Sell goods
  here" affordance/copy at every station screen.

## Batch 5 — Credit + Bess + ship

- **Front-page credit (prominent):** a styled line under the title subtitle (`ui.js` ~146,
  matching `--gold`/house style): co-developed and rigorously playtested by Henry (8) and James
  (12). Mirror in `public/about.html` header.
- **Restore Bess:** Henry's save `world/saves/a96f79806fc.json` already contains
  `{kind:'dog',name:'Bess',stay:false}` — verify it's intact and, if missing/needed, re-add the
  pet record (backup first). Confirm she loads.
- Final whole-branch review, `npm run verify` + build green, merge to main, `npm run deploy`.

Deferred (noted, not this pass): full server-authoritative per-animal multiplayer sync; a complete
AI-quest "problems" system (F1 beyond the indicator); deep economy rebalance beyond the gentle
nerfs above.
