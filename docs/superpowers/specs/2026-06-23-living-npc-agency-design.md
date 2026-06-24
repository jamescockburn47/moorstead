# Living NPC Agency — Moors 1900 Design Spec

**Date:** 2026-06-23
**Goal:** Populate the Moors-1900 world with living folk who have genuine agency — the USP being that the NPCs are **AI-powered in their actions, not just their speech**. They work the economy, travel the railway in real time on their own errands, and the player meets, finds, and trades with them as a believable population.

**Scope gate:** Moors world only (`geo.realWorld`). The stylised Moorstead world keeps its current folk and is untouched. The agency *engine* is world-agnostic; the expanded population and farms are moors-only.

---

## 1. Context — what already exists

- **Speech is already AI.** `src/npc.js` is a best-effort client for the Moorstead "brain" (yorkshire_bot — FastAPI + Ollama, proxied at `/brain`): ~18 deep persona characters, a roster, per-player memory, and a facts mini-RAG (`src/facts.js`). The game runs fine when the brain is offline.
- **A scripted daily routine.** `src/villagerlife.js`: ~18 canned-voice "extra folk", roles (shepherd, fisher, monk, jet-cutter…), and a `dayPhase` home→work→social rhythm by clock.
- **Train passengers exist.** `src/trainfolk.js`: folk board between stops, natter, drop tips/parcels (canned, or the brain when on). Client-side only.
- **Economy + rail.** Trades, markets, freight chains (ironstone→calcined→pig iron, jet→carved jet), the deterministic train timetable, the `railpath` geometry, the place/station graph.

**The gap = the USP:** their *actions* are scripted (a fixed home→work→social loop, ambient passengers), not AI-decided. This spec adds an agency layer on top of the brain that already handles speech.

---

## 2. Decisions (settled in brainstorming)

| Decision | Choice |
|---|---|
| First-slice focus | **Working lives on the rails** — NPCs use the train + economy with purpose |
| Population | **Whole world populated** — procedurally scaled to towns + farms (~80–100), ~18 deep personas curated |
| Consistency | **Server-authoritative** — the EVO owns NPC truth and streams to clients |
| AI control | **LLM agent per NPC**, but **priority-driven** — LLM runs only for *active* NPCs |
| Travel | **Real-time, no teleporting** — walk roads at pace, ride trains on the timetable |
| Discoverability | **The map** — live NPC markers + minimap + station boards |
| Farms | **~10–12 farmsteads** across the dales/moor-edges for rural folk to live + work |

---

## 3. Architecture — the roster sim

A new service on the EVO, beside the brain: the **roster sim**. It owns the authoritative state of the moors population and runs each NPC as an LLM agent.

- **Logical, not voxel.** NPC state is logical — `{ id, name, role, home, place|transit, holding, money, goal, intent, mood, memoryRef }` — *not* an (x,y,z). The sim reasons over the **place graph + train timetable + economy**, all shared data. The client maps logical state to voxel positions using geometry it already has (`samplePos` for a train passenger, town/farm anchors otherwise).
- **Priority-driven agency.** Each tick the sim classifies NPCs: **active** (on an errand, in transit, near a player, or in conversation) vs **dormant** (idle/at-home/far). Active NPCs get full LLM decisions at their decision points; dormant ones run a cheap scheduled state (home by night, their patch by day) until an event promotes them. LLM cost scales with *activity*, not headcount — only the handful currently *doing* something cost calls.
- **The brain, extended.** A new `/act` endpoint alongside `/chat`: given an NPC's persona + state + world context + recent events + the action-set, it returns the next action. `/chat` is unchanged but now seeded with the NPC's live state.

---

## 4. The agent loop

NPCs decide only at **decision points** (arrived, errand finished, idle promotion) and **events** (player opens a conversation, a price swings, a deal offered). Not per tick.

1. Sim detects a decision point/event for an active NPC.
2. Build context: persona + current state + world (time, place, who/what's near, the next trains, market prices) + recent events + memory + the **action-set**.
3. `brain./act` → `{ action, params, intent }`. `intent` (e.g., "taking jet to Pickering, prices are up") is stored.
4. Sim **validates** the action (whitelist + legality) and **executes** it against the logical world; on illegal/timeout it falls back to a safe `wait`/continue so the sim never wedges.
5. State streamed to clients; `intent` seeds any chat that follows.

---

## 5. Action-set (the agent's tools)

A whitelist the LLM must choose from, each with a server-side executor `(state, params) → state` and validation:

- `goTo(place)` — walk a road to a place (sets a transit).
- `boardTrain(line, dest)` — go to the station, wait, ride to `dest` (transit on the timetable).
- `workTrade()` — work their trade at their patch (mine / fish / carve / farm / drove), producing goods over time.
- `sell(good, market)` / `buy(good)` — trade at a market town; moves real money + nudges market prices.
- `giveParcel(to)` — hand a parcel for delivery down the line (existing trainfolk parcel hook).
- `say(to, line)` — speak (routes through the brain voice).
- `wait(reason)` — idle / rest / safe fallback.

Validation enforces affordability, that a train actually runs, that they're where the action needs them, etc. The set is the *only* way an NPC affects the world — no arbitrary effects.

---

## 6. Real-time travel, pathfinding & confinement

Every journey is physical and takes real time:

- **Walking:** the place graph carries road distances; the sim advances the NPC along the road at a walking pace with a real ETA. `transit = { from, to, mode:'walk', frac, eta }`.
- **Rail:** `boardTrain` sends them to the platform, waits for the scheduled service, then rides for the journey duration — and *that* is when the player can meet them aboard. `transit = { line, fromStn, toStn, mode:'rail', boardedAtSec }`.
- Clients render the moving NPC the whole way: walkers interpolated along the road, riders drawn in the carriage via the same `samplePos` the train uses. An errand genuinely *takes time* (walk → wait → ride → walk).

**People cross what beasts cannot.** Pathing must be robust — an NPC never gets stuck:

- **NPCs (people) cross rivers, drystone walls, and train tracks freely** — fords, gates/stiles, level crossings; none of these is an obstacle to a person. Local movement steps over/through them toward the next waypoint; a stuck-detector (no forward progress for a few seconds) re-paths or nudges, so normal travel never wedges and never needs a teleport.
- **Animals are confined by them.** Livestock and wild beasts are **blocked by rivers, walls, and tracks** — a walled field actually holds its stock, sheep keep to their moor, and nothing strays onto the line. This is what makes the farm walls meaningful and period-correct, and it's the inverse of the NPC rule (people pass, beasts don't).

**Spawn cleanup (a present bug to kill).** Animals must spawn on **solid, walkable surface ground only** — never on top of trees, buildings, walls, or water — and must **never leap large distances** to reach a spawn point or a target (per-step movement clamped to a sane stride; no teleport-leaps). This fixes the current behaviour of beasts perched on trees/roofs and jumping across gaps.

---

## 7. Population model

A deterministic generator fills the moors from a seed:

- **Per settlement, scaled to size:** market towns (Whitby, Pickering) ~8–10; mid towns (Grosmont, Staithes, Rosedale Abbey, Goathland) ~5–6; dale halts (Egton, Glaisdale, Lealholm, Danby, Castleton, Ravenscar, Robin Hood's Bay, Sandsend, Sleights) ~3–4; **each farm a family of 2–4**. Target ~80–100 total.
- Each folk: a **period Yorkshire name**, a **role/trade** fitting the place (coast → fisher/cobble; Whitby → jet-cutter/cooper; Rosedale → collier/ironstone; farm → farmer/drover/shepherd; rail towns → platelayer/porter), a **home building**, and the agency.
- **Deep personas curated:** the existing ~18 brain characters remain the rich, hand-authored standouts (deep persona + memory). Procedural folk use **role/canned chat** for now (trainfolk-style); later the brain can voice them from a generated persona card.

---

## 8. Discoverability — the map

The player finds folk by looking at the world:

- **Tab map:** live NPC markers, each named with their current intent ("Amos — jet to Pickering"). Built on the existing `drawBigMapDots` (where train markers already live).
- **Minimap:** nearby named folk show as dots.
- **Station departure boards:** list who's catching which train, so you can plan to be aboard.

---

## 9. Farms — a world layer

- ~10–12 farmsteads scattered through the dales and moor-edges (away from the towns): a **farmhouse + barn + walled fields/fold**, period-correct isolated holdings. Placed in worldgen like the town buildings, on solid valley/edge ground clear of rails/rivers.
- The rural NPCs (farmers, drovers, shepherds) **live and work** at them; they hook into the existing farm-register / droving economy.
- Stands alone — enriches the world immediately, independent of the agency sim.

---

## 10. Player interaction

- **Talk:** routes to the brain (deep folk) or canned/role voice (procedural), seeded with the NPC's live state, so they speak from what they're actually doing. The conversation is itself an **event** the agent can react to (offer to buy their jet on the train → they re-decide).
- **Trade:** you can buy an NPC's goods (e.g., their jet, on the train) instead of letting them sell at market — competing with the economy.
- **Seat fix (folded in):** the server assigns each train passenger a **unique** carriage seat authoritatively, so two NPCs/players can never share one (kills the current `seatOffset` hash collision).

---

## 11. Degradation

If the roster sim or brain is down, clients fall straight back to today's scripted villagers + canned `trainfolk` — the game always works, brain or no brain. The expanded population is server-driven; the fallback is the existing client-local crowd.

---

## 12. Testing

- **Headless sim test:** run the roster sim against a **mock LLM** (scripted action sequences). Assert every action executes legally, NPCs move/trade correctly, transits resolve, no bad state.
- **Pure executors:** the action executors are `(state, params) → state`, unit-tested in isolation.
- **Population generator:** deterministic from seed → snapshot test (counts per settlement, every NPC has a home, roles fit the place).
- **Client render:** headless check that a streamed logical state maps to a valid voxel position (on the train / at a town anchor).
- **Movement rules:** headless checks that animal spawn points are valid surface ground (never on trees/buildings/walls/water), that beasts are blocked at rivers/walls/tracks while people pass through, and that no single movement step exceeds the sane stride (no leaps).

---

## 13. Build phases (decomposition)

Sizable, so it builds in independent slices, each shippable:

- **A — Farms + animal cleanup.** First the quick world-fix: animals spawn only on valid surface ground (no trees/roofs/walls/water) and stop leaping, plus the confinement rules (rivers/walls/tracks block beasts but pass people). Then the worldgen farmsteads across the moors + the rural folk's homes — their walled fields now actually hold stock. Stands alone; visible immediately.
- **B — The roster sim.** Server agent loop + logical state + priority-driven LLM + real-time travel + the population generator + streaming to clients (the engine). Brain `/act` endpoint.
- **C — Player-facing.** Map/minimap/board discoverability, full passenger chat with live state, trade-with-NPC, and the seat-bug fix.

Build A → B → C; A is independent and ships on its own.

---

## 14. Risks / open questions

- **LLM load at scale:** mitigated by priority-driven activation, but needs a cap on concurrent active agents + a queue. To tune on the EVO.
- **Brain `/act` reliability:** the sim must be robust to slow/garbage LLM output (timeouts + the `wait` fallback). Action validation is the safety net.
- **Streaming volume:** ~80–100 NPCs' deltas — stream only those near *any* connected player at full rate, the rest at a trickle.
- **Road graph for walking:** needs place-to-place road distances; if no road network exists, walkers go cross-country at first (refine later).
- **Procedural chat quality:** canned/role voice for ~80 folk risks repetition; the brain-from-persona-card upgrade is the path, deferred.
