# Bairns' World: survival progression, reset, and landmark protection

**Date:** 2026-06-14
**Status:** Design — awaiting review
**Topic:** Make the kids' multiplayer world (`bairns` room) a survival progression they have to earn, restore it to pristine after the kids destroyed Whitby Abbey, and protect landmarks from future destruction.

---

## Problem

The kids tested Moorstead and built in the `bairns` world, but it's boring: they're playing in **Creative mode**, which hands them every block and tool for free (the "creative cupboard"), plus flight and immunity. None of the existing survival economy — mine → craft → smelt → better tools, hunger, quests, reputation — actually bites, because Creative bypasses all of it. They also demolished Whitby Abbey, a generated landmark.

The survival system already exists and is good. The work is to **stop the kids opting out of it**, **give them direction**, **reset their world to pristine**, and **make landmarks indestructible** going forward.

## Decisions (settled with James)

1. **Difficulty: Adventurer.** Hunger matters, monsters prowl at night, but villages/lit areas are safe havens and death keeps your inventory and returns you to your village. *This is essentially the game's existing survival default* — no new survival system is built.
2. **Lock Creative in the bairns' world.** Kids in that room cannot switch to Creative. Wardens (James) keep full access everywhere.
3. **Pull-along: both.** A first-hour milestone ladder to hook them, handing off to the existing quest arc.
4. **Reset depth: full** — clear the world *and* the kids' pockets so they start genuinely bare-handed. Everything backed up first.
5. **Landmark protection: global**, built-fabric only, dig-underneath stays open. Ordinary village cottages remain breakable; only major landmarks + a village's centrepiece are locked.
6. **Materials made genuinely findable** — ores become followable veins at reachable depths, and wood is guaranteed near every spawn. Global (a straight improvement for all worlds).
7. **One block per click** — placement is edge-triggered; the accidental multi-place is fixed. Global.

## Non-goals

- No new "difficulty config" or "game mode" system (YAGNI). Rules are room-scoped predicates, matching the existing client-authoritative + client-side-warden-check patterns.
- No server-side enforcement of the Creative lock or landmark protection. The threat model is young kids on the official client; the server reset undoes existing damage, the client rules prevent new damage.
- No change to adult shared worlds or single-player *behaviour/UI*, except the global improvements that benefit everyone: landmark protection, richer/findable materials (worldgen), and the one-block-per-click placement fix.
- Creative is **not** removed; it's hidden/forced-off only inside the bairns room for non-wardens.

---

## Design

Five units, each independently testable.

### 1. Bairns survival lock

A single predicate on the game:

```
bairnLocked() = this.netActive && (this.netRoom === 'bairns') && !this.isAdmin()
```

When locked:
- **Force survival.** Set `player.creative = false` (and `player.flying = false`). Asserted in two places, because a kid's state can arrive either way:
  - after `startWorld()` inside `joinShared()` ([main.js:1049](src/main.js:1049)), and
  - after the relay restores saved pockets in `connectNet()` ([main.js:1068](src/main.js:1068)) — `sv.player` could carry `creative:true` from before the lock existed.
- **Hide the toggle.** The "Toggle Creative Mode" button ([ui.js:146](src/ui.js:146)) is hidden when `bairnLocked()`. Add `ui.setCreativeButtonVisible(show)`; call it on world entry and on pause-menu open.
- **Guard the handler.** The `btnCreative` click handler ([main.js:332](src/main.js:332)) early-returns if `bairnLocked()` (defence in depth, in case the button is shown stale).

Wardens are exempt at every check via `isAdmin()` ([main.js:475](src/main.js:475)), so James can still fly in and fix things or drop a kit from the admin panel — this doubles as the safety valve if a child gets genuinely stuck.

### 2. Difficulty — adopt existing survival as Adventurer

The current survival ruleset already *is* Adventurer; verify and apply two small kid-friendly softeners, nothing more:

- **Already correct, leave as-is:** starvation floors at 1 HP and never kills outright ([player.js:186](src/player.js:186)); night barghests/boggarts spawn ([entities.js:372](src/entities.js:372)); hostiles never spawn `inVillage` or `nearLight` ([entities.js:567](src/entities.js:567)); death keeps `slots` and respawns at the village ([player.js:290](src/player.js:290)).
- **Softener 1:** extend the "gentler first nights" window from day ≤ 2 to **day ≤ 3** ([entities.js:552](src/entities.js:552), [560](src/entities.js:560)) — half hostile caps and a chance to skip, giving little players longer to find their feet.
- **Softener 2:** confirm death-item-loss stays **off** (it is; no change). Documented here so it isn't "fixed" later by accident.

### 3. Milestone ladder (first hour)

A small fire-once achievement tracker, active in the bairns room. Each milestone shows a celebratory toast (existing `ui.toast`) + a chime (`audio.craft`/`audio.pickup`), fires at most once per player, and persists.

**New module `src/milestones.js`:** a list of `{ id, when, text }` and a `Milestones` tracker with `fire(id)` (no-op if already done) and `serialize()/deserialize()`. Persistence rides on `player.serialize()`/`deserialize()` (a `milestonesDone` array) so it round-trips through *both* IndexedDB meta and the relay per-pid save.

Hooks reuse existing event points — no new plumbing:
- block break → `onBlockBroken` call site ([main.js:1515](src/main.js:1515))
- block place → `onBlockPlaced` call site ([main.js:1622](src/main.js:1622))
- craft output → craft handler ([ui.js:970](src/ui.js:970))
- smelt output (cooked food / ingot) → smelt handler ([ui.js:1087](src/ui.js:1087))
- mob kill → `entities.onKill` ([main.js:233](src/main.js:233))
- night survived → on `sky.day` increment while alive

**The ladder (concrete; this is the part to redline):**

| # | id | Fires on | Toast (Yorkshire voice) |
|---|----|----------|----|
| 1 | `first_log` | break `LOG` | "Tha's felled thi first tree! Make some planks frae it." |
| 2 | `first_planks` | craft `PLANKS` | "Planks! Tha can build wi' these — or make sticks an' a bench." |
| 3 | `first_bench` | craft `BENCH` | "A joiner's bench — now tha can make proper tools." |
| 4 | `first_pick` | craft `W_PICK` | "Thi first pick! Now stone's thine for t' taking." |
| 5 | `into_stone` | break `STONE` | "Tha's hewing stone now. Stone tools last longer." |
| 6 | `stone_tools` | craft any `S_*` tool | "Gritstone tools — tougher than wood." |
| 7 | `first_light` | place `TORCH`/`LANTERN` | "A light! T' dark things keep their distance frae a flame." |
| 8 | `hot_scran` | smelt any cooked food | "Summat warm in thi belly — that keeps thi strength up." |
| 9 | `iron_won` | break `IRON_ORE` or smelt `IRON_INGOT` | "Ironstone! Smelt it at t' range an' tha's on thi way." |
| 10 | `iron_tools` | craft any `I_*` tool | "Iron tools — top o' t' toolbox. Tha's earned that." → *quest steer* |
| 11 | `stood_ground` | kill a `barghest`/`boggart` | "Tha saw it off! T' moor's a bit safer for thi pluck." |
| 12 | `first_neet` | survived a night | "Tha's seen a neet through on t' moors. Not bad, that." → *quest steer* |

### 4. Quest steering (hand-off)

On the first of `iron_tools` or `first_neet`, fire a one-time *quest steer* toast:

> "T' village folk have jobs for them as'll do 'em — find a notice board, or have a word wi' a villager who looks like they've summat on their mind."

No new quest content: the arc's first chapter (`arc1`, giver James) is already offerable at standing 0 ([quests.js:51](src/quests.js:51)), and the notice board already carries deliveries/hunts/treasure. This is signposting, not a new system.

### 5. Landmark protection (global)

**New `protectedAt(geo, world, x, y, z, id)`** (in `src/landmarks.js`, using `geo`), enforced in the break path. A block is protected iff **all three** hold:

1. **Within a landmark's radius.** Reuse the proximity pattern from [`placeName()`](src/geography.js:787): Abbey (`abbeySite()`, ~38), Whitby museum (`museumSite()`, ~10), Rosedale kilns + ruined arch (`KILNS`, ~42), the Wainstones (`WAINSTONES`, ~14), Roseberry summit (`ROSEBERRY`, ~32), named moor crosses incl. Fat Betty (`crossAt`, ~3), NYMR stations (`nearStation`, ~14), and a village's centrepiece — minster/cross/notice board (village core, ~6). Radii are initial values, tunable in the plan.
2. **Block is built fabric** — `STONEBRICK, COBBLE, SLATE, ST_CREAM, ST_RED, RBRICK, WINDOW, PLANKS, LOG, BENCH, RANGE, LANTERN, BOARD, SIGNPOST`. Natural soil, plants, water, and ore are **not** protected.
3. **At or above ground** — `y >= geo.height(x, z)`. Everything strictly below stays breakable.

Together this means: the abbey's walls, arches and floor are locked, but you can tunnel **under** it and landscape the natural ground around it freely — exactly "dig underneath anything you want."

**Enforcement:** in the break tick, before `breakProgress` accrues ([main.js:~1485](src/main.js:1485)), if `protectedAt(...)` and `!isAdmin()`, refuse: zero progress + a throttled toast — "That's a protected landmark, love — tha can dig under it, but tha can't break it." Wardens exempt so James can repair/edit.

**Scope:** global (all rooms). The reset (server) undoes existing abbey damage; this rule (client) prevents new damage.

### 6. Material availability (worldgen)

The problem is in `oreAt` ([worldgen.js:98](src/worldgen.js:98)): ore is rolled from `hash3i(x,y,z)` — **per-block white noise**, so every ore is an isolated single block, not a vein. Combined with deep, thin bands this makes resources tedious to find — jet worst of all (`y<16`, 0.5%, scattered) while the quest needs three. Trees ([treeAt](src/worldgen.js:28)) only grow where `woodiness > 0.4`; a spawn far from a copse stalls step 1 of the ladder, since wood gates everything.

Changes (global — a straight improvement for every world):
- **Veins, not specks.** Replace the per-block roll with a low-frequency 3D noise (e.g. `fbm3(x*0.18, y*0.18, z*0.18, …)`) thresholded per ore, so ore forms followable veins (~3–6 blocks). Find one iron and its neighbours are there too.
- **Reachable bands.** Lift the shallow bands so ordinary digging finds them: coal `y<48`, iron `y<34` (keep Rosedale's extra richness), jet `y<20`. Jet stays the deep prize, but within a child's patience.
- **Caves do the surfacing.** Caves already carve AIR ([worldgen.js:132](src/worldgen.js:132)); veins beside a cave show in its walls, so lantern-lit exploration (which the jet quest already nudges) reveals ore without blind tunnelling.
- **Wood near home.** Guarantee a small copse within ~40 blocks of every village spawn (nudge `woodiness`/`treeAt`), preserving the open-moor-between-woods character.
- **Jet for the quest.** Richer jet near the Rosedale kilns — lore-true "deep seams of the ironstone men" — so the three-jet chapter has a findable source.

**Targets (asserted by the census script), within 64 blocks of a spawn and ≤12 blocks dig-depth:** a reachable copse; ≥20 coal; ≥15 iron; and ≥3 jet obtainable within a reasonable deep-explore near caves/Rosedale. Constants are tuned against these numbers, not guessed.

*Note:* ore/tree are deterministic terrain, so this regenerates sub-surface and trees under existing edits (expected, per project notes). Ship **before** the bairns reset so the kids' fresh world uses the better distribution; adult worlds gain richer ore too.

### 7. One block per click (placement)

Bug: on right-mousedown, `placeRepeat` is set to **0** ([main.js:400](src/main.js:400)); the held-repeat loop then sees `placeRepeat -= dt ≤ 0` on the very next frame and places a second block ~16 ms later, a third at 0.22 s ([main.js:1867](src/main.js:1867)). A normal click lays 2–3 blocks — exactly the "shonky" feel.

Fix (global): placement is strictly **edge-triggered — one block per mousedown**. Remove the immediate repeat; a new block needs a new click (up then down). Left-click mining keeps its continuous behaviour (expected, and not complained about).

Optional, **off by default:** a *deliberate* hold-to-lay-a-line behind a long initial delay (~0.4 s), so a normal click can never multi-place. Left off unless you want it for adult building.

---

## World reset (operational runbook)

A one-time, destructive, **backed-up** action on the EVO relay. Run **after** the code above is deployed, so the abbey returns into a world where it can't be re-destroyed and kids can't re-enter Creative. Requires James's explicit go-ahead at run time.

Relay storage ([deploy/world/server.py](deploy/world/server.py)): per-room edits at `/home/james/moorstead/world/bairns.json`; per-player pockets at `/home/james/moorstead/world/saves/<pid>.json` (pid = `a<acct>`). Terrain + buildings + abbey are deterministic from the seed, so clearing edits regenerates everything pristine.

Steps (via `evo-tailscale`, works off-LAN):
1. **Identify** bairns accounts from the dash (`/api/overview` or `codes.json`, room = `bairns`) → list of `a<acct>` pids.
2. **Stop** the relay service (kill MainPID; `Restart=always` brings it back, so coordinate — or back up first then remove then bounce).
3. **Back up:** `cp world/bairns.json world/bairns.json.bak-2026-06-14`; `tar` the matching `world/saves/a*.json` for bairns pids → `world/bairns-saves.bak-2026-06-14.tar`.
4. **Clear:** remove `world/bairns.json`; remove the bairns pids' `world/saves/<pid>.json`.
5. **Restart** the relay. On reconnect, the bairns room loads with no edits (pristine world) and no saved pockets (bare-handed start).
6. **Verify:** `/status` shows `bairns` with `edits: 0`; a warden walk-through confirms the abbey is whole.

Backups are retained (the repo's `game.old` rollback habit) so the reset is reversible.

---

## Rollout / sequencing

1. Build & verify units 1–7 locally (headless tests below) — including the resource census, since the worldgen change must land before the reset.
2. Deploy client (`.\deploy\ship.ps1`, or manual Tailscale scp + `vercel deploy --prod` if off-LAN, per project notes).
3. Confirm live bundle carries the change (fetch `moorstead.app`, grep bundle for a unique string).
4. Run the world-reset runbook with James's go-ahead.
5. Hand the kids back in (Ctrl+Shift+R to beat the cached bundle).

## Testing / verification

Following the project's headless-where-possible pattern (`scripts/verify-*.mjs`, pure-CPU):

- **`scripts/verify-landmarks.mjs`** — for each landmark, assert `protectedAt` is **true** for a built block at/above ground within radius, and **false** for (a) the same column below ground, (b) a natural block (grass/dirt/ore) within radius, (c) any block outside radius. Pure geography + worldgen, no GPU.
- **`scripts/verify-bairn-lock.mjs`** — construct game state with `netRoom='bairns'`, load a player blob with `creative:true`; assert post-enforce `player.creative===false` and the button is hidden; assert `isAdmin()` bypasses both.
- **Milestones unit** — simulate the trigger events; assert each milestone fires exactly once and persists across `serialize()`→`deserialize()`.
- **`scripts/verify-resources.mjs`** — resource census across several seeds and every village spawn; assert the §6 targets (reachable copse; ≥20 coal, ≥15 iron within radius/depth; ≥3 jet obtainable). Reports the numbers so tuning is evidence-based. Pure-CPU worldgen.
- **Placement unit** — one `mousedown` → exactly one `setBlock`; the button held for N frames still yields one placement (no auto-repeat). With the optional hold-variant on, first repeat only after ≥0.4 s.
- **Manual smoke** — in a local bairns-room sim: confirm no Creative button, hunger/night behave at Adventurer, milestone toasts appear in order, abbey blocks refuse to break while sub-abbey blocks dig, a single click lays one block, and starter materials are findable near spawn.

## Files touched

- `src/main.js` — `bairnLocked()`; enforce in `joinShared`/`connectNet`; guard `btnCreative`; landmark check + milestone hooks in the break/place paths; quest-steer trigger; **placement edge-trigger fix** (one block per click).
- `src/ui.js` — `setCreativeButtonVisible()`; (milestones reuse `toast`).
- `src/player.js` — `milestonesDone` in serialize/deserialize.
- `src/entities.js` — extend gentle-nights window to day ≤ 3.
- `src/defs.js` — `LANDMARK_MATERIALS` set / `isBuiltMaterial()`.
- `src/geography.js` — `landmarkAt(x,z)` helper (landmark + protect radius), extending the `placeName` pattern.
- `src/worldgen.js` — `oreAt` vein noise + reachable bands; `treeAt`/`woodiness` copse-near-spawn guarantee.
- `src/milestones.js` *(new)* — milestone defs + tracker.
- `src/landmarks.js` *(new)* — `protectedAt()`.
- `scripts/verify-landmarks.mjs`, `scripts/verify-bairn-lock.mjs`, `scripts/verify-resources.mjs` *(new)*.
- Operational runbook above — no code; executed on the EVO relay.
