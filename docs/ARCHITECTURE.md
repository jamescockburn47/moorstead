# Moorstead — the module map

**Read this before changing anything. It tells you which file owns what, what it
exposes, and which verify script guards it — so you can change one thing without
reading the whole codebase.**

Moorstead is a Vite + Three.js voxel game. `src/main.js` holds the `Game` class,
which constructs and drives every subsystem. Client only; the relay + brain run on
the EVO (see [CLAUDE.md](../CLAUDE.md)). Everything is procedural — no asset files.

## How to use this map

1. Find the row for what you want to change. Edit **that file**.
2. Run its **guard** script (`node scripts/verify-<x>.mjs`) plus the full gate
   (`npm run verify`). Green = safe. That gate is the contract — see
   [INVARIANTS.md](INVARIANTS.md).
3. Adding something new rather than changing? Follow
   [ADDING-A-FEATURE.md](ADDING-A-FEATURE.md).

## Subsystems (all constructed in `Game`, `src/main.js`)

| Subsystem | File | Owns | Constructed | Guard |
|---|---|---|---|---|
| Orchestration / frame loop | `src/main.js` | the `Game` class, input, camera, render, the per-frame `frame()` loop, most feature wiring | — | most scripts touch it indirectly |
| Definitions | `src/defs.js` | block ids `B`, item ids `I`, tile ids `TILE`, `RECIPES`, `SMELTS`, `ITEM_NAMES`, `TOOLS`, `FOODS`, `CREATIVE_ITEMS` — **the data tables** | — | `verify-resources`, `verify-mining` |
| World / voxels | `src/world.js` | chunk store, streaming, `setBlock`, edit ledger, deeds store, remesh queue | main.js:536 | `verify-remesh`, `verify-regen`, `verify-deeds` |
| Meshing | `src/mesher.js` | greedy face+AO meshing; the 3 shared Lambert materials (opaque/cutout/liquid) | (by world) | `verify-flora-rebuild`, `verify-roadperf` |
| Terrain gen | `src/worldgen.js`, `src/moorsgeo.js`, `src/geography.js` | heightfield, villages, stations, rivers, coast from OS-map data | (by world) | `verify-moorsgeo`, `verify-geo-parity`, `verify-rivers-moors`, `verify-coast-moors`, `verify-landmarks-moors` |
| Entities / mobs | `src/entities.js` | mob + villager meshes, AI state machine, drops, particles, **NPC wardrobe** | main.js:552 | `verify-villagers`, `verify-eveninglife`, `verify-npclooks`, `verify-menagerie`, `verify-herding` |
| Living NPC roster | `src/roster.js` | server-driven streamed NPCs (`game.rosterClient`), surface/platform geometry, render thinning | main.js:554 | `verify-roster` |
| Villager flavour | `src/villagerlife.js` | greet/nosy remark pools, `villagerRemark` | (by entities) | `verify-villagers` |
| Brain client | `src/npc.js` | `/brain` calls: `talk`, `talkGeneric`, `rosterState`, `standing`, `gift`, `gazette` | — | (live) `verify-live` |
| Player | `src/player.js` | inventory slots, brass, physics state, `serialize`/`deserialize`, home base | — | `verify-survival` |
| Physics | `src/physics.js` | AABB collision, DDA raycast, `moveEntity` | — | (via survival/mining) |
| Sky / lighting | `src/sky.js` | sun/moon light curves, dome, clouds, stars, fog, `lanternFlicker`, quality light tiers | main.js:560 | `verify-season`, `verify-weather`, `verify-graphics` |
| Renderer quality | `src/main.js` (`applyQuality`, `setupComposer`, `GradeShader`) | ACES, shadows, bloom, grade, Fine/Plain toggle | — | `verify-graphics` |
| Quests | `src/quests.js` | arc definitions, offers, standing, honours, HUD tracker, chat context | main.js:568 | `verify-quests`, `verify-dracula`, `verify-honours`, `verify-storm` |
| Economy | `src/economy.js` | prices, regional `SPREAD`, `spreadHint`, formatting | main.js:569 | `verify-economy`, `verify-economy-v2` |
| Milestones | `src/milestones.js` | first-hour onboarding ladder (bairns full / adults lite) | main.js:570 | `verify-uxflow` |
| Deeds | `src/deeds.js` | claim/mine fee, upkeep, lapse, membership (pure) | — | `verify-deeds` |
| Rail | `src/train.js`, `src/rails.js`, `src/railpath.js` | timetable, train motion, ride/drive | — | `verify-rail`, `verify-rail-clearance`, `verify-train-view`, `verify-rail-efficiency`, `verify-station-align` |
| Roads | `src/roads.js`, `src/roadpath.js` | lane graph, plank bridges, NPC lane-following | — | `verify-roads`, `verify-roadperf` |
| Flora | `src/floraLayer.js`, `src/flora-*.js` | instanced cross-quad plants, seasonal tint | main.js:576 | `verify-flora`, `verify-foliage`, `verify-flora-rebuild` |
| Seasonal / festivals | `src/seasonalLayer.js`, `src/festivals.js`, `src/festivalKit.js` | festival calendar + dressing/props | main.js:578 | `verify-festivals`, `verify-festival-builders`, `verify-festival-render`, `verify-festivalwow` |
| Fire | `src/fire.js`, `src/fireLayer.js` | flame meshes + animation, capped nearest-N | main.js:580 | `verify-fire` |
| Weather / seasons | `src/season.js`, `src/snow.js`, `src/weather-live.js`, `src/storm.js`, `src/temperature.js` | season phase, snow accumulation, live weather, Dracula storm | — | `verify-snow`, `verify-winter`, `verify-weather`, `verify-storm` |
| Audio | `src/audio.js`, `src/carols.js`, `src/carolBox.js` | procedural SFX + festival music | main.js:176 | `verify-carols`, `verify-festival-audio` |
| UI / HUD | `src/ui.js` | all DOM: handbook, notice board, chat, inventory, panels, toasts, tracker, station chip, gazette, tradin' post, honours | main.js:177 | `verify-uxflow`, `verify-gazette-stalls`, `verify-sketchbook` |
| Touch | `src/touch.js` | mobile/tablet input adapter + HUD | main.js:1011 | `verify-touch` |
| Multiplayer | `src/multiplayer.js` | relay WebSocket (`game.net`), message handler, reconnect, stalls | main.js:2247 | `verify-live` (needs network) |
| Save | `src/save.js` | IndexedDB persistence, `SAVE_VERSION`, `migrateSave` | — | `verify-econrobust` |
| Rooms | `src/rooms.js` | free/survival/bairns world classification, starter packs | — | `verify-free-worlds` |
| Facts / game-facts | `src/facts.js`, `src/game-facts.js` | brain RAG context, known-facts | — | `verify-facts` |
| Telemetry / feedback | `src/telemetry.js`, `src/feedback.js` | error/feedback POST, `reportQuiet` | — | `verify-econrobust` |
| Update check | `src/update-check.js` | version compare, force-reload floor | — | `verify-update` |
| Invariants | `src/invariants.js` | cross-cutting scene-graph sanity | — | `verify-invariants` |

## The frame loop (`Game.frame()`, `src/main.js`)

Per frame, in order (playing state): `world.update` → `sky.update` → `rails.update`
→ `roads.update` → `rosterClient.update` → `entities.update` → `player.update` →
`deedTick` (throttled) → `floraLayer/seasonalLayer/fireLayer.update` →
`footprints.update` → `storm.update` → `net.update` → `quests.update` →
`updateStationChip` → `ui.updateTracker` → `audio.update` → render (`renderFrame`,
which switches composer under Fine / plain `renderer.render` under Plain).

**This is the god-object seam.** Each `.update(dt)` call is effectively a system.
A future refactor turns this list into a registry; until then, a subsystem is
"registered" by being constructed in `Game` and called here.

## The relay protocol (`src/multiplayer.js` `handle()`)

Message types the client accepts: `edit`, `deeds`, `pos`, `join`, `leave`, `chat`,
`time`, `sleepers`, `wake`, `where`, `gift`, `fx`, `stalls`, `stallreturn`,
`stalldone`, `stallerr` (+ `init`, `full`, `time` in `onmessage`). **Unknown types
fall through harmlessly** — see [INVARIANTS.md](INVARIANTS.md) rule 3.
