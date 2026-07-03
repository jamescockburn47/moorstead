# Workstream D3 — Parlour Life: Evening Crowd, Murmur, Opening Hours, Innkeeper Rows

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The parlour fills of an evening — roster villagers whose village has an inn
sit at the tables after dusk, talking one-voice-at-a-time through the etiquette gate,
with pot-clink and low laughter when you're inside; the door refuses entry in the
morning (in voice); and the innkeeper's facts card gains presence-gated rows (who's
in tonight, season/weather) when you're physically in the parlour.

**Settled decisions honoured (handoff §3/§4 — do not reopen):** the crowd is
CLIENT-side cosmetic placement (like `_spread`), NOT brain state — brain night-gating
is a separately-tracked deferred task. Truthfulness holds because the activity label
is ALSO client-derived (`npcActivity`, roster.js:241-267): reposition + relabel
together and nothing anywhere claims the NPC is elsewhere. All murmur goes through
`entities.speakAmbient` (E gate). Opening hours: opens after lunch (~13:00,
sky.time ≈ 0.54), shut mornings, open through the night.

**Deviation from the addendum, deliberate:** the bragging-board RENDER moves from D3
to D4 — its win-record data only exists once D4's games land, and stamping the board
prop + its UI + its data in one slice is cleaner than a placeholder. The addendum
explicitly allows the empty state; we go one further and ship it with D4. The
innkeeper presence-gated rows stay in D3 (this plan).

**Architecture:** a new pure module `src/parlour.js` owns all decidable logic
(headlessly verifiable): `innOpen(skyTime)`, `parlourSeatFor(id, plan)`
(deterministic seat/stand spot from id hash, like `_spread` roster.js:128-133),
`parlourCrowd(npcIds, villageName)` (which NPCs go to the pub tonight — hash-picked,
capped at 5), `MURMUR_LINES` (period Yorkshire pub lines pool) and
`playerInParlour(pos, plan)`. `roster.js` consumes it in the update path (position
override + walk-freeze + activityShort when parloured); `main.js` consumes
`innOpen` in the INN_DOOR interact branch (toast refusal in voice) and drives
murmur + `potClink`/`pubLaugh` SFX when the player is inside; `quests.js`
`chatContext` + `factscard.js` gain `innkeeperRows` gated on `playerInParlour`.

**Ground truth annex:** the D3 probe report (2026-07-03, this session) — key anchors:
`npcVoxelPos` roster.js:202-235 ('at' branch + `_spread` at 208); update loop
roster.js:494-604 (activity set at 510, village at 511); `speakAmbient`
entities.js:2720-2725 (returns false when gated — callers must tolerate);
`ambientQuietAfter` villagerlife.js:137-139; `dayPhase` villagerlife.js:36-40
(evening = skyT > 0.78 || < 0.15); `inEveningWindow` hearthLayer.js:50-54;
`potClink`/`pubLaugh` audio.js:685-698 (NOT voice-gated — SFX free);
INN_DOOR dispatch main.js:4491-4496, hint 5538; `crossThreshold` main.js:2528-2561;
`buildFactsCard` factscard.js:8-27 (add `innkeeperRows` loop after marketRows);
`chatContext` call site quests.js:1728-1740; verify-eveninglife.mjs guards the
EXTRA_FOLK doorstep routine — roster NPCs are a different population, no conflict,
but the full gate must stay green.

---

## Task 1: `src/parlour.js` + roster routing + seated rendering

**Files:** Create `src/parlour.js`; modify `src/roster.js`; test
`scripts/verify-inn-parlour.mjs` (new).

**parlour.js exports (pure, no THREE/DOM):**
- `innOpen(skyTime)` — false during the morning-closed window `[0.20, 0.54)`,
  true otherwise (open through the night; 0.54 ≈ 13:00 per handoff).
- `eveningAtInn(skyTime)` — the crowd window: `skyTime >= 0.70 || skyTime < 0.15`
  (folk drift in from early evening, gone before dawn; deliberately wider than
  dayPhase's 'home' 0.78 so the pub fills BEFORE folk vanish indoors).
- `parlourCrowd(ids, salt)` — deterministic subset (FNV-hash like roster's
  `idHash`, threshold-picked), max `PARLOUR_CAP = 5`, stable across frames.
- `parlourSeatFor(id, plan)` — world-space spot: hash picks one of the 4 tables
  (sit "at" it: the bench cell beside it, from `plan.furnish.benches[i]`) or one
  of 2 standing spots near the servery; returns `{x, y, z, table, game}` with
  y = `plan.parlour.floorY + 1`.
- `playerInParlour(pos, plan)` — inside the parlour interior box at parlour depth
  (y within floorY..floorY+h, x/z within the interior bounds).
- `MURMUR_LINES` — ~14 period Yorkshire pub lines (no anachronisms, no named
  real people; talk of weather, trains, iron, sheep, the fire, the ale).

**roster.js integration (the seam — keep it small):** in `update(dt)` where an
'at'-kind NPC's anchor/spread position drives the mob (around roster.js:494-604,
and/or in `npcVoxelPos`'s 'at' branch — implementer picks the cleanest single
point after reading), add: if the NPC's village has an inn
(`game.world.gen.inns.get(village)`), `eveningAtInn(sky.time)`, and the NPC id is
in `parlourCrowd(...)` for that inn → override the rendered target position to
`parlourSeatFor(id, plan)`, set `mob.walkPhase = 0` each frame while parloured
(legs still), set `mob.activityShort = 'playing ' + game` (table seats) or
`'having a quiet pint'` (standing), and mark `mob.parloured = plan` for Task 2.
When the window ends, the override simply stops applying — the normal anchor
logic resumes (teleport-out is fine; folk 'went home').

**verify-inn-parlour.mjs:** determinism (same ids+salt → same crowd, same seats);
cap ≤ 5; seats land INSIDE the parlour interior box of a real `Gen(12345)`
Grosmont plan and on distinct cells; `innOpen` boundaries (0.19 open→false at
0.20, 0.53 false, 0.54 true, 0.9 true, 0.05 true); `eveningAtInn` boundaries;
`playerInParlour` true at a seat cell / false at the surface door; MURMUR_LINES
all non-empty strings, no duplicates.

Steps: verify script first (fails on missing module) → parlour.js → roster.js
seam → verify + full gate green → commit
`feat(tavern): evening parlour crowd — deterministic seats, client-side routing`.

## Task 2: murmur + SFX + opening hours + innkeeper rows

**Files:** modify `src/main.js`, `src/quests.js`, `src/factscard.js`; extend
`scripts/verify-inn-parlour.mjs` + `scripts/verify-facts.mjs` if it pins card
layout (read it first).

1. **Murmur (main.js frame loop, near the existing ambient/audio ticks):** when
   `playerInParlour(player.pos, anyPlan)` and there are parloured mobs: on a slow
   timer (10-20s randomised), pick one parloured mob and call
   `entities.speakAmbient(mob, line, 6)` with a `MURMUR_LINES` pick (seeded by
   day+index is unnecessary — Math.random is fine for ambience, it's not
   game-state); tolerate `false` (parish busy). On a separate slower timer,
   `audio.potClink(0.2)` / occasionally `audio.pubLaugh(0.18)` — SFX are not
   voice-gated. Nothing fires when the player is outside the parlour.
2. **Opening hours (main.js INN_DOOR branch, 4491-4496):** before
   `crossThreshold`, if entering from the surface (`hit.y >= p.groundY`) and
   `!innOpen(this.sky.time)` → `this.ui.toast('T’ tavern’s shut of a
   morning, love — back after t’ dinner bell.', 4000)` and return. Exiting
   from inside is ALWAYS allowed (never trap a player who slept over).
3. **Innkeeper rows (quests.js chatContext + factscard.js):** factscard.js
   `buildFactsCard` gains `for (const r of f.innkeeperRows || []) rows.push(r);`
   after the market rows. quests.js `chatContext` (1728-1740): when
   `playerInParlour(game.player.pos, plan)` for the plan of the village this
   villager belongs to, push rows: `'INN TONIGHT: ' + <names of parloured mobs
   in this inn, comma-joined>` (from the roster's parloured set — client-truthful)
   and `'SEASON: <season name>, <weather-coming hint if an existing helper
   exposes one — read sky/season for what's available; omit if nothing exists,
   do NOT invent a forecast>'`. Empty parlour → the INN TONIGHT row says
   'nobbut thee'. NOT gated to innkeeper-role NPCs in v1 — any villager chatted
   to INSIDE the parlour gets the rows (there is no innkeeper NPC yet; note this
   in the code comment).
4. **Verify:** extend verify-inn-parlour.mjs — innOpen boundary cases already in
   Task 1; add: buildFactsCard with innkeeperRows renders them in the output
   string; chatContext gating is exercised if quests.chatContext is headlessly
   constructible (read how verify-facts.mjs drives it — copy its harness; if it
   can't be driven headlessly, assert the factscard.js seam only and say so).

Full gate + build green → commit
`feat(tavern): pub murmur through the etiquette gate, opening hours in voice, innkeeper facts rows`.

## Task 3 (controller): proof pass + deploy

Fresh world, warp Grosmont, `sky.time = 0.85`: parlour has ≤5 seated villagers,
legs still, labels reading 'playing merrils'/'having a quiet pint'; murmur bubbles
one-at-a-time only while inside; potClink audible inside; door refuses at
sky.time 0.3 with the toast, opens at 0.6; chat with a villager inside → GAME
FACTS shows INN TONIGHT row. Screenshots. Merge, deploy, memory.

## Non-goals
Brain/roster server changes (deferred night-gating task); bragging board (moved
to D4); games interactivity (D4); notes board (D6); sleeping at the inn (D6);
seated MESH pose (legs-frozen standing at the bench cell is the honest v1 —
a real sit pose is D4 polish alongside the game-table camera).
