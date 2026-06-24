# Repopulate the Moors 1900 World (v2 launch) — Program Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each slice task-by-task. Slices use checkbox (`- [ ]`) steps. This is a PROGRAM of 5 shippable slices; **Slice 1 is detailed to task level here. Slices 2–5 are scoped roadmap entries — each gets its own task-level plan (its own doc) when it starts**, after that subsystem's recon. Do not try to build 2–5 from this doc alone.

**Goal:** Make the real-Ordnance-Survey Moors 1900 world (v2, `geo.realWorld`) a populated, playable game — people, economy, quests — so it can become the live default world without players landing in a beautiful but empty sandbox.

**Architecture:** Build on the B.1 roster spine (already built). v2's NPCs come from the server-authoritative **roster sim** (not the old `villagerlife` crowd, which is deliberately gated off for `realWorld`). Expand the scripted 6-NPC cast to a procedural ~80–100 population; wire the NPC-dependent layers (vendors/markets/trade, quests, droving payout) to the roster NPCs in the moors world; then cut v2 over to the default and deploy.

**Tech Stack:** Brain — Python/FastAPI (`moorstead-evo-work/brain`, now git-tracked). Client — JS ES modules + three.js (`Moorcraft/src`). Headless `npm run verify` + brain `pytest`. EVO deploy = scp + `systemctl restart` (brain) and Vercel (client).

---

## Why this plan exists (the audit)

A v1→v2 mechanics-parity audit (2026-06-23) found v2's **world** is solid (terrain, rail + trains, landmarks, mining + licensed deeds, foraging, weather, farm sites) but its **people-dependent layers are unwired**:

| Layer | v2 status | Cause |
|---|---|---|
| Villager population | MISSING | `main.js:1004 spawnVillagers()` early-returns for `realWorld` ("population is a later slice"); roster is v2's NPC system (`roster.js:102`) but not deployed/expanded |
| Vendors / markets / trade | BROKEN | no NPCs to sell to (`economy.js`) |
| Quests | BROKEN | quest-givers are NPCs (`quests.js`) |
| Droving payout | BROKEN | the drove needs a market-town vendor (NPC) |
| Mining/deeds, foraging, rail, landmarks, farms, weather | WIRED | world-agnostic or v2-tuned |

The fix is to finish the living-NPC program for the moors world. Design references: `docs/superpowers/specs/2026-06-23-living-npc-agency-design.md` (§5 action-set, §7 population model, §10 player interaction), the B.1 plan `2026-06-23-moors-phase-b1-roster-spine.md`, and the economy/farming/mining handoffs under `docs/superpowers/`.

---

## Standing rules (READ FIRST)

- **Do NOT `git commit` the CLIENT (`Moorcraft`) repo** — James commits the game. The BRAIN repo (`moorstead-evo-work`) IS git-tracked; commit brain work there with clear messages.
- **Deploys are flagged, deliberate actions.** Brain → scp + `sudo -n systemctl restart moorstead-brain.service` (back up first: `cp x x.bak-YYYYMMDD-tag`). Client → Vercel. Verify live after every deploy. Don't auto-deploy without it being the explicit step.
- **Do NOT make v2 the live default until it is populated** (Slice 5). The `newWorld` blank→1900 change is already in the client code but NOT deployed; keep it that way until Slice 5.
- **Period-accurate** (Victorian / c.1900): names, trades, content.
- **Grounding/auditability discipline:** NPCs answer world facts only from their notes; never invent (the `hardening.py` GROUNDING rule + the game-facts RAG). New NPC-facing facts (vendors, quests) get corpus entries so NPCs answer about them truthfully.
- **Verify before claiming done:** brain `pytest`, `npm run verify`, `npm run build`, and a live check after deploy.

---

## File structure (by slice)

- **Slice 1 (deploy):** no new files — deploy existing B.1 (`brain/{roster_api,roster_sim,world}.py`, `brain/moors-data.json`, the `brain/app.py` wiring) to the EVO; deploy the client (`src/roster.js`, `src/npc.js`, `src/main.js`, `src/entities.js`) to Vercel.
- **Slice 2 (population):** `brain/population.py` (procedural generator), modify `brain/roster_sim.py` (`build_cast` → seed the generated population), `scripts/verify-roster.mjs` (population-count assertions).
- **Slice 3 (economy):** `brain/roster_sim.py` (NPC `sell`/`buy`/`workTrade` executors + intents), `src/roster.js`/`src/npc.js` (trade-with-NPC UI hook), `src/economy.js` (route market trades through roster NPCs / town stalls), corpus entries in `src/game-facts.js`.
- **Slice 4 (act + quests + droving):** `brain/act.py` (LLM `/act` per the spec §4–5), modify `brain/roster_sim.py` (priority-driven activation), `src/quests.js` (quest-givers resolve to roster NPCs in v2), `src/main.js` (droving payout via a market-town roster vendor).
- **Slice 5 (discoverability + cutover):** `src/ui.js` (map/minimap NPC markers, station boards), `src/main.js` (un-gate the v2-default `newWorld` path is already done — flip the title/menu + shared-room if chosen), deploy.

---

## Slice 1 — Deploy the roster: make v2 not-empty (DETAILED)

**Outcome:** the B.1 scripted cast (6 NPCs) walks the dales and rides the lines in the LIVE v2 world. This is the foundation; everything else lands on a roster that's actually serving.

**Files:** deploy-only (see above). No code changes (B.1 is built + locally verified).

- [ ] **Step 1: Pre-flight — confirm B.1 is green locally**

Run (brain): `cd /c/Users/James/moorstead-evo-work && python -m pytest brain/test_roster_sim.py -v`
Expected: 12 passed.
Run (client): `cd /c/Users/James/Desktop/Moorcraft && npm run verify` → all green incl. `verify-roster: 8 assertions OK`; `npm run build` → built.

- [ ] **Step 2: Back up the EVO brain files the deploy will touch**

```bash
ssh evo-tailscale 'cd ~/moorstead/yorkshire_bot/brain && cp app.py app.py.bak-$(date +%Y%m%d)-roster'
```

- [ ] **Step 3: Deploy the roster modules + the app.py wiring to the EVO**

```bash
scp /c/Users/James/moorstead-evo-work/brain/{roster_api,roster_sim,world}.py evo-tailscale:~/moorstead/yorkshire_bot/brain/
scp /c/Users/James/moorstead-evo-work/brain/moors-data.json evo-tailscale:~/moorstead/yorkshire_bot/brain/
scp /c/Users/James/moorstead-evo-work/brain/app.py evo-tailscale:~/moorstead/yorkshire_bot/brain/app.py
```
(`app.py` already has the 3-line roster wiring and the grounding rule shipped earlier; it diffs from the EVO baseline only by those lines — confirmed.)

- [ ] **Step 4: Restart the brain and verify the endpoint live**

```bash
ssh evo-tailscale 'sudo -n systemctl restart moorstead-brain.service && sleep 2 && systemctl is-active moorstead-brain.service'
ssh evo-tailscale 'curl -s http://127.0.0.1:8010/api/roster/state | head -c 400'
```
Expected: `active`, and JSON with `npcs` (≥4), `now`, `seq`. Poll twice a few seconds apart → `now` advances and at least one NPC's `state` changes.

- [ ] **Step 5: Deploy the client (so the roster client polls the live endpoint)**

```bash
cd /c/Users/James/Desktop/Moorcraft && npm run build && npx vercel deploy --prod --yes
```
(Per the EVO-stack notes, Vercel rebuilds from local source. The `/brain` proxy is already production. The client roster + grounding are in this build. The v2-as-default `newWorld` change is ALSO in this build — acceptable now only if Slice 5's cutover is intended; if NOT, revert the `newWorld` edit before this deploy. See Slice 5.)

- [ ] **Step 6: Live verify in the moors world**

Load `moorstead.app`, hard-refresh, start the moors world. Confirm: the 6 cast NPCs are present and moving (walking/riding); chat works and is grounded; brain-down still degrades. Note: with only the 6 scripted cast, the world is *sparsely* peopled — Slice 2 fills it.

**Slice 1 checkpoint:** roster live in v2 prod; the cast visibly lives. Brain repo unchanged (already committed); no client commit (James commits).

---

## Slice 2 — Procedural population (~80–100) [SCOPED — own plan at start]

**Goal:** fill the towns and farms with a deterministic procedural population so v2 feels inhabited, per spec §7 (market towns ~8–10, mid towns ~5–6, halts ~3–4, each farm a family of 2–4; ~80–100 total; the ~18 deep personas remain the curated standouts).

**Key work:** `brain/population.py` — seed-deterministic generator producing NPCs (period Yorkshire name, role fitting the place, home building, scripted daily activity) scaled to `world.TOWNS` + farm sites; `roster_sim.build_cast()` seeds from it; activities use the existing scripted policy (no LLM yet). Client renders them via the existing `RosterClient` (no client change expected beyond perf check at ~100 mobs).

**Acceptance:** roster serves ~80–100 NPCs; `verify-roster` asserts population counts per settlement + every NPC resolves to a voxel position; client holds 60fps with the full population (perf check); deterministic across runs.

---

## Slice 3 — NPC economy in v2 (vendors / markets / trade) [SCOPED — own plan at start]

**Goal:** close the economy loop — players can sell/buy with roster NPCs (or town market stalls staffed by them), so mining/foraging/farming have a payout in v2.

**Key work:** roster NPC `sell`/`buy`/`workTrade` executors + `intent` (spec §5); a trade-with-NPC client hook (extend the existing trade UI / `trainfolk` parcel pattern); route `economy.js` market trades through a designated market-town roster vendor (Pickering/Whitby) so prices + brass move; add corpus facts so NPCs answer "where do I sell X" truthfully.

**Acceptance:** a player can sell ore/jet/forage/livestock to a moors NPC and receive brass; market prices respond; droving has a buyer (overlaps Slice 4); the grounding sweep still ≥ baseline.

---

## Slice 4 — LLM `/act` + quests + droving payout for v2 [SCOPED — own plan at start]

**Goal:** the spec's real agency (B.2) plus the quest + droving turn-ins that need NPCs.

**Key work:** `brain/act.py` — the `/act` endpoint (persona + state + world context + action-set → validated next action, with the safe `wait` fallback), priority-driven activation (LLM only for active NPCs) on the tier you affirmed (4B casual / 27B on engagement); wire `src/quests.js` quest-givers to resolve to roster NPCs/locations in v2; wire the droving payout in `src/main.js` to a market-town roster vendor.

**Acceptance:** active NPCs make LLM-decided errands (validated, never wedging); at least the existing quest arcs are acceptable + completable in v2; a drove can be sold; load-tested via `loadtest_brain.py` before deploy; the action validation + grounding hold.

---

## Slice 5 — Discoverability + cutover to v2-default [SCOPED — own plan at start]

**Goal:** players can find the folk, and v2 becomes the live default.

**Key work:** map/minimap NPC markers + station departure boards (spec §8, on the existing `drawBigMapDots`); confirm the `newWorld` blank→1900 default (already in code) + optionally the title backdrop, the menu labels, and — IF chosen — the shared multiplayer room → 1900 (resets players: epoch bump per the world-reset runbook); final full verify + deploy; announce v2.

**Acceptance:** a new player on `moorstead.app` lands in a populated, tradeable, questable 1900 moors; discoverability works; degrades cleanly; the stylised world remains reachable via a typed seed.

---

## Self-review (against the audit)

- Population MISSING → Slices 1 (cast live) + 2 (full population). ✓
- Vendors/markets/trade BROKEN → Slice 3. ✓
- Quests BROKEN → Slice 4. ✓
- Droving payout BROKEN → Slices 3/4. ✓
- "Don't ship empty v2" → cutover deferred to Slice 5 (default change stays code-only until then). ✓
- Wired layers (mining/deeds, foraging, rail, landmarks, farms) → untouched. ✓

Each slice produces a working, shippable increment. Slices 2–5 must each be expanded into a task-level plan (its own `docs/superpowers/plans/` doc) before building, after reconnoitring that subsystem's current code.
