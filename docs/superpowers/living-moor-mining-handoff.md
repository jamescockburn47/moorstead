# Handoff prompt — The Living Moor: licensed mining (Slice 4) + the remaining slices

*Paste the section below to a fresh agent. It is self-contained. Everything above this line is a label.*

---

## Mission

Build the rest of Moorstead's **Living Moor** (world-sustainability) system. The design is one coherent system built in 5 slices; **Slices 1 and 2 are already built and verified**. Your priority is **Slice 4 — licensed mining** (the part James most wants — "all the mining work"), then **Slice 3 — land claims** and **Slice 5 — relay + breeding**.

The full, approved design is in `docs/superpowers/specs/2026-06-20-living-moor-design.md` — **read it first** (15 sections). This prompt summarises it and tells you exactly what is already built so you don't redo it. Two further pieces discussed this session but not built — the farming **menagerie** (Slice 4) and the **Goods Market price-board** — are captured under "Other work" near the end, so this handoff is the *complete* remaining picture.

**The make-or-break for mining:** the **depths, fees, fixtures, ore yields, and the prospecting-skill curve are balance-sensitive** — present concrete numbers and a feel-comparison and **tune them with James in the loop**, the way the droving payout was tuned. Do not silently ship balance numbers.

## What Moorstead is, and the stack

A browser voxel sandbox of the North York Moors (Vite + three.js, fully procedural, no asset files). Public client is **www.moorstead.app** on Vercel. Backend services run on a home box ("the EVO", `ssh evo-tailscale`): the villager **brain**, the multiplayer **relay** (`worldsvc`, `deploy/world/server.py`), a LAN dashboard, and **Merlin** (clint-body). It is played by children (the `bairns` room), so: never ship unverified mechanics, keep everything legible to a ten-year-old, and treat it as production. Client source of truth: `C:\Users\James\Desktop\Moorcraft`.

**A game-day = 30 real minutes** (`DAY_LENGTH=1800` in `src/sky.js`; the relay agrees). Time is **game-days** (`sky.day`, monotonic, save-persisted) — never wall-clock.

## What is already BUILT (build on it, do NOT redo it)

All on `main`, all verified, **deploy HELD** (the whole Living Moor ships together with the farming vertical once every slice lands). Headless suite is **`npm run verify` → 16 checks**.

**The farming vertical (Slices 2–3 built this session; Slice 1 herding was already live):**
- Registered farm (`farmRegisterCheck`/`CHARTER_FEE` in `economy.js`; register at the Moorstead parish board for £1) and the **drove to market** (muster penned sheep with `KeyG`, drive them with the dog, en-route stray/barghest risk, sell at the Moorstead board for `livestockPrice` 120d/head). Spec: `docs/superpowers/specs/2026-06-19-farming-droving-design.md`. Slice 4 (the menagerie — cows/horses/pigs/llamas as data) is **specced, not built**.

**Living Moor Slice 1 — the edit ledger + regrowth (BUILT, verified):**
- **`src/editledger.js`** (pure, headless, `scripts/verify-regen.mjs`): `categoryOf(was,newId)` → `harvest|dig|build`; `lifespanOf(cat,was)`; `isExpired(edit,nowDay)`; `LIFESPAN = { plant:6, tree:24, ore:24, peat:12, sapling:24 }` (game-days — **rates bias SLOW**, never perceptible within a session; tune live).
- **`src/world.js`**: `editLedger` Map (`"x,y,z"→{cat,day,by,was}`), `recordEdit`, `expireEdits(nowDay)` (reverts expired **harvest** edits via `setBlock(was)` — generalises the existing beach-heal). **Only `harvest` regrows so far** (`dig`/`build` are recorded-aware but `lifespanOf` returns Infinity for them — they get their effects in Slices 3–4). Plus the **tree feature**: `growTrees`/`placeTree` + `treeRegrowth`/`saplings` Maps.
- **`src/main.js`**: records edits at the break (`finishBreak`) and place sites; runs `expireEdits`+`growTrees`+`deedTick` **once per game-day** in `frame()`; **`fellTree(hit)`** — chopping a `B.LOG` fells the whole connected tree (no floating canopy) and marks the stump; persists the ledger + tree state + deeds in the save `meta`.
- **Trees** fell whole, then regrow **gradually**: stump → (tree lifespan) → a 2-block sapling → (sapling lifespan) → a full tree. A sapling yields one log, a mature tree five (the let-it-recover incentive).
- **Peat** is priced lowest (`PRICES[B.PEAT]=1` in `economy.js`).

**Living Moor Slice 2 — the deeds backbone (BUILT, verified) — THIS is what mining stands on:**
- **`src/deeds.js`** (pure, headless, `scripts/verify-deeds.mjs`): `deedFee(kind,radius,depth)`, `weeklyUpkeep(kind,radius,depth)`, `inDeed(deeds,x,z,kind?)` (cylinder membership of **active** deeds), `isLapsed(deed,nowDay,grace)`, `DEED` constants. A deed = `{ id, kind:'claim'|'mine', by, cx, cz, radius, depth, paidUntilDay, lapsedDay }`.
- **`src/world.js`**: `this.deeds = []` (persisted in `meta.deeds`).
- **`src/main.js`**: `stakeClaim(radius)`, `settleUp(id)`, `deedTick()` (marks lapsed past `paidUntilDay+grace`; settling revives). 
- **`src/ui.js`**: a **"Thi Deeds"** section on the parish board (`openBoard`) — stake a claim where you stand, see deeds + upkeep, settle up.
- **NB:** the deed system is **abstract** — staking a claim does **nothing yet** (build-protection is Slice 3; mine-permission is Slice 4). You wire the effects.

## Slice 4 — licensed mining (YOUR PRIORITY). Spec §5, §13, §14 f/i/j/k/m.

Open-cast is prevented **structurally**. Build, in order, each TDD-first and verified:

1. **The 1-block-deep rule (the core control).** In the break path (`finishBreak` / the mining gate in `main.js`), refuse breaking a block more than **one below the ORIGINAL seed grade** of that column — `grade = world.gen.height(x,z)`, the **fixed** seed height, **NOT** the current dug level — *unless* the player is inside a licensed mine's shaft envelope. This is the elegant part: measuring from the original grade means free digging can only **skim** the surface, so it blocks strip-pits **and** landscape-wrecking quarries with one rule. Put the pure check in `editledger.js` or a new pure module (`mayDigDeep(y, grade, mines, heldPick, fixtures)`) and headless-test it. Refused breaks show a hint ("tha can only dig deep inside a licensed mine").
2. **A mine = an entrance + a licence (a deed).** A new **mine-entrance** block (placeable); buying a **mining licence** stakes a `kind:'mine'` deed (reuse `stakeClaim`'s pattern → a `stakeMine` using `deedFee('mine',…)`/`weeklyUpkeep`). The licence opens a **shaft envelope** (a cylinder + depth beneath the entrance); `inDeed(world.deeds, x, z, 'mine')` + a depth check gates deep breaks.
3. **Depth bands = better picks + paid fixtures (James's call).** Each deeper band needs BOTH a minimum **pick tier** (wood→gritstone→iron, already in `defs.js`) AND an installed **purchased fixture** — new items/blocks **pit-props → safety lamp → winch**. Cost rises with depth; the **shallow coal band stays cheap** (a child's first mine isn't over-gated), the **deep jet band dear**.
4. **The researched NY Moors ore palette (spec §15 has sources).** Existing: coal/ironstone/jet in `worldgen.oreAt` (depth-gated `y<48`/`y<34`/`y<20`). **Add:** **alum shale** (coastal cliffs, shallow) and **potash/polyhalite + rock salt** (deepest, NE/Boulby coast — the modern precious prize). Distribute by region + depth in `oreAt`. New ore/product items in `defs.js`/`textures.js`.
5. **Prospecting skill.** `player.miningSkill` (XP from mining, persisted). The **precious finds (jet, polyhalite) yield only to a skilled prospector** — scale the effective ore-richness threshold in `oreAt` by skill, or gate the precious block at break. Triple gate for the deep prize: **licence + equipment + skill**.
6. **Designated public quarries** (spec §5, §6, §14m). Worldgen-placed **public** zones (a `kind:'quarry'`, `by:'parish'` deed-like region, free, no upkeep, never lapses) at rocky sites near settlements, where the skim limit is lifted for **building stone** and the rock **regenerates**. You **cannot open a quarry anywhere** — outside a quarry or a mine, the original-grade skim holds. Beck `cobble`/`gravel` is a light free top-up.
7. **Old workings free-but-exhausted.** Existing mine structures are free to explore (already cut, no licence); thin the ore near old workings (reframe today's `nearKilns` boost in `oreAt` into a worked-out *thinning*).
8. **Legibility + new blocks' textures.** New blocks (mine entrance, fixtures, alum, polyhalite) need atlas tiles drawn in `textures.js` (procedural — study an existing block first). Mining cues (refused-break hint, the licence/fixture UI, a band-floor hint), handbook tab, about.html paragraph (James's voice, **no em-dashes**).

## Slice 3 — land claims (after mining, or in parallel). Spec §6, §7, §14n.

Apply deeds to surface land: a `build` edit inside an **active** claim never expires; outside any claim it decays. Wire `inDeed(world.deeds, x, z, 'claim')` into `world.expireEdits` so `build` edits gain a finite lifespan **only when unclaimed**. Lapse → **gradual reclamation** (build edits crumble a few at a time over many days, reclaimable if you settle up in time). **Decay is world-mode-aware: the bairns world decays ~2× slower** — `decayScale = game.bairnLocked() ? 2 : 1` applied to the grace + reclamation timing. The starter croft + villages are permanent system claims.

## Slice 5 — relay (authoritative shared heal) + breeding. Spec §3, §8, §13.

Today the regen is **client-only**, so on the **shared bairns moor** the relay re-sends locally-dropped edits → it doesn't actually heal there. `deploy/world/server.py` must store edit metadata + run the **same** expiry pass server-side (port the pure `editledger.js` rules) + persist deeds, so the shared moor heals authoritatively and the edit dict stays bounded. (A lighter first step: have the relay honour the client's revert message — `sendEdit` already carries one.) Plus **kept-stock breeding**: a maintained claim with ≥2 same-species head occasionally yields a lamb/calf (reuse the lamb mob + `pets`/`stay`/`home`).

## Process — follow these

1. **Brainstorming/tuning gate:** the design is approved, but mining's **numbers are balance-sensitive**. Before finalising the depths/fees/fixtures/yields/skill-curve, present concrete values + a feel-comparison and get James's sign-off — don't just ship them. Otherwise build to the spec.
2. **TDD:** put pure logic (the dig-gate, mine-fee maths, skill→yield curve, ore-by-depth rules) in pure modules and write a `scripts/verify-*.mjs` FIRST (plain Node, `ok`/`bad`, ends `RESULT: PASS/FAIL`, `process.exit`), watch it fail, implement, watch it pass, wire into `npm run verify`.
3. **Legibility is a hard rule:** no player-facing mechanic ships without its in-game telling (hint/handbook/about.html). about.html in James's first-person voice, **no em-dashes, no AI tells**.
4. **Verify before claiming done:** `npm run verify` green; `npm run build` green; drive the live preview to prove each mechanic (see gotchas).
5. **Deploy stays HELD.** The whole Living Moor + the farming vertical deploy together at the end (`npx vercel deploy --prod --yes`, then verify the live bundle). Do not deploy without James asking.

## Hard constraints (do not violate)

- **Production, kids play it.** Verify everything live before claiming done. Never ship an unverified balance change.
- **Accuracy (James's #1 rule):** never document a mechanic that isn't wired. No invented authorities anywhere.
- **James's voice prose (about.html, write-ups): NO em-dashes, no AI tells, first-person, plain English.** In-game dialect UI uses `&mdash;` entities deliberately — that's fine and separate.
- **Rates bias SLOW** (§14b): healing/decay never perceptible within a session; all rates are isolated constants; bairns world decays ~2× slower. Start slow; it's easier to speed up than to walk back a moor that cycled too fast.
- **Secrets / git:** the repo is **public**. Live invite codes stay on the EVO only. **Never `git add -A`**. See `SECURITY.md`. Deploy only when asked. The repo works directly on `main` (James's workflow).

## Gotchas worth knowing

- **The dig-gate must measure from the ORIGINAL seed grade** (`world.gen.height`, fixed), not the current top block — that is the whole control. Get this wrong and players can pit/gouge.
- **Time = game-days, never wall-clock.** `now = sky.day` (+ `sky.time`). The per-game-day tick lives in `frame()` (`regenDay !== this._lastExpireDay`).
- **Preview driving:** `window.game`, `g.loginGuest()`, `g.newWorld(name)`, pump `g.frame()`. Editing a file **HMR-reloads the page to the title screen** and **re-creates the world**, so new constructor fields (like `world.deeds`) only exist after a fresh `newWorld`. `newWorld` defers a tick (the first ~250-frame batch stays 'title'; pump ~300 more to reach 'playing'). >~900 synchronous frames times out the 30s eval — pump in batches. Verify regrowth/decay by advancing `g.sky.day += N` then calling the tick directly (`g.world.expireEdits(g.sky.day)` etc.) rather than waiting real time.
- **Textures are procedural** (`textures.js` draws each atlas tile in code) — copy an existing block's tile and adapt; don't expect image files.
- **`npm run verify` is currently 16 checks** — each new pure module adds one.
- **Don't reinvent:** the deeds backbone (`deeds.js` + `world.deeds` + `stakeClaim`/`settleUp`) and the edit-ledger revert (`setBlock(was)`) already exist — the mine licence is just a `kind:'mine'` deed, and reversion is "forget the edit".

## Other work discussed this session but not yet built (beyond the Living Moor)

Fold these into the same coordinated deploy.

**Farming Slice 4 — the wider menagerie (specced, NOT built).** Spec: `docs/superpowers/specs/2026-06-19-farming-droving-design.md` §6, §14 d/i/k. Generalise the built sheep drove to the rest of the livestock **as data** — a `droveable` flag on the mob def + a per-species `livestockPrice`, reusing the built muster→drove→Moorstead-yard-sale loop and the `herd()` filter. Per-species (tune the value ladder **live with James**, anchored on sheep = 120d): **cattle** (Dale Cow — the classic cattle drove, ~340d, slow + big), **horses** (Moorland Pony — a horse fair, ~540d, but the pony **stays a rideable mount** so you sell spares), **pigs** (Saddleback — **sty stock sold individually, not droved**, ~150d, keep the truffle-snuffle), **llamas** (Pack Llama — wool stock ~110d). The **Dale Bull is excluded** (a goring hazard). Two real-state fixes it must carry: the llama **isn't `tameable` today** (add it); the pig drops `RAW_BEEF` as a pork stand-in (add pork, or leave — decide at build).

**The Goods Market price-board + limited-time offers (SP3 incentive layer — discussed, NOT yet specced).** James's idea: the Goods Market board today only reflects what the player holds — make it an **incentive engine**. Show where **every** good sells dear (the full `PRICES × SPREAD` in `economy.js`, including goods not yet held) so the player gets a goal ("jet's fetching a fortune at Whitby — go mine some"), plus **limited-time 'wanted' offers / surge demand** that motivate gathering a specific item. This is **SP3** of the economy program, pulled forward. Two tiers: (1) a cheap UI win — the price board over data that already exists; (2) the dynamic-offers engine (new state on game-days, the shared "moor market report" over the relay). **Keep it gentle and legible for the bairns** — no 50-row matrix, no anxious countdown timers. **Not yet designed — start with the brainstorming skill → a spec.** Tracked as the market-board task.

**Deploy coordination:** the farming vertical (Slices 2–3 **built**, Slice 4 to build), the whole Living Moor (Slices 1–2 built, 3–5 to build), and ideally the market board ship in **one coordinated deploy** once built + verified — `npx vercel deploy --prod --yes`, then verify the live bundle (curl the homepage, grep `assets/index-*.js` for a string unique to your change). Players cache hard (Ctrl+Shift+R). Deploy only when James asks.

**Explicitly OUT / future (do not scope-creep into these):** the monthly fair; NPC farmers / NPC agency (SP4); player-foundable settlements + new rail (SP5); weather/seasonal erosion; soil fertility / crop rotation; the full emergent per-sheep flocking model. The specs note these as later sub-projects.

## References

- **Spec (authoritative):** `docs/superpowers/specs/2026-06-20-living-moor-design.md` (§5 mining, §6 deeds, §7 maintenance, §13 slices, §14 decisions, §15 ore sources).
- **Slice 1 plan (done, a model):** `docs/superpowers/plans/2026-06-20-living-moor-slice1-ledger-regrowth.md`.
- **Farming spec (built):** `docs/superpowers/specs/2026-06-19-farming-droving-design.md`.
- **Memory:** `moorstead-economy` (the program + what's built/queued), `moorcraft-evo-stack` (hosts/ports/deploy).
- **Pure cores to extend:** `src/editledger.js`, `src/deeds.js`. **Wiring:** `src/world.js`, `src/main.js`, `src/ui.js`, `src/worldgen.js` (`oreAt`/`treeAt`), `src/defs.js`/`src/textures.js` (new blocks), `src/player.js` (`miningSkill`), `deploy/world/server.py` (Slice 5 relay).
