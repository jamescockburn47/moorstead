# Handoff prompt — Farming vertical, Slices 2 & 3 (registered farm + drove to market)

*Paste the section below to a fresh agent. It is self-contained. Everything above this line is a label.*

---

## Mission

Build the next two slices of Moorstead's **hill-farmer vertical**: **Slice 2 — registered farm status**, and **Slice 3 — droving a live flock to the market town and selling it for the game's most lucrative payout**. Slice 1 (the herding core) is already built and live. The full, approved design is in `docs/superpowers/specs/2026-06-19-farming-droving-design.md` — read it first; this prompt summarises and adds what has changed since.

The make-or-break: **droving must clearly out-earn every other income path** (James's explicit, repeated requirement). It is the highest-effort, highest-risk activity in the game; if it doesn't pay the most, the whole vertical is dead weight. The payout numbers are balance-sensitive — **tune them with James in the loop** (present the proposed `livestockPrice` + drover's premium and a side-by-side income-gradient comparison for his sign-off; don't just ship a number).

## What Moorstead is, and the stack

A browser voxel sandbox of the North York Moors (Vite + three.js, fully procedural, no asset files). Public client is **www.moorstead.app** on Vercel. Backend services run on a home box ("the EVO", `ssh evo-tailscale` = james@100.90.66.54, passwordless sudo): the villager **brain** (FastAPI :8010, gemma MoE via llama.cpp), the multiplayer **relay** (worldsvc :8096), the LAN-only **dashboard** (:8095), and **Merlin** (clint-body). It is played by children (the `bairns` room), so: never ship unverified mechanics, keep everything legible to a ten-year-old, and treat it as production.

Client source of truth (git): `C:\Users\James\Desktop\Moorcraft`. Deploy + verify flow is in `README.md` "Deploying" and the `moorcraft-evo-stack` / `moorstead-npc-memory` memories.

## What is already BUILT (build on it, don't redo it)

**Slice 1 — herding core (live):**
- `src/herding.js` (pure, headless-testable): `flockCentroid`, `driveTarget(centroid, pressures, drive)`, `dogGoal(command, ...)`, `commandFromKey` (ArrowLeft=come-bye, ArrowRight=away, ArrowUp=walk-on, ArrowDown=lie-down), `foldAt(seedX, seedZ, isFence, maxCells=600)` → `{enclosed, cells, bounds}`, `allPenned`, `allPennedCells`. Tests: `scripts/verify-herding.mjs`.
- `src/entities.js`: `herd(dt, player)` (gathers loose un-owned sheep within `HERD_RADIUS=18` of the owned dog, drives them toward the gate), `foldScan(player)` (flood-fills gates → `this.foldCells`/`this.gateCells`, throttled), per-mob `passGate` one-way gate logic.
- `src/physics.js`: `boxCollides(..., passGate)` — `B.GATE` is non-solid to a body whose `passGate` is true; per-animal `passGate` is true only when OUTSIDE the fold (walk in, can't get out); the player's `passGate` is always true.
- `src/defs.js`: `B.FENCE=45` (Sheep Hurdle, recipe 1 plank + 2 sticks → 3), `B.GATE=46` (Field Gate, recipe 2 planks + 2 sticks → 1).
- `src/main.js`: arrow-key whistle capture (`this.herdCmd`) + H=heel; pen trigger settles sheep as `owner`+`stay` kept stock (pushed to `player.pets`).
- Handbook tab "Sheepdog & Flock" in `src/ui.js buildHowSections()`; about.html describes it. **These describe ONLY penning — they do NOT mention a registered farm or droving, because those aren't built. When you build Slices 2/3, update them.**

**Economy (live, `src/economy.js`):** brass currency (£sd, integer pence), regional price spreads (`priceOf`, `regionMult`, `SPREAD`), drop-in spot-sell (`dropInPrice`/`dropInSell`, vendor purse cap), rail shipment (`bookShipment`/`tickShipments`, `FREIGHT_ALLOWANCE=96`, `DELIVERY_DELAY=0.5` game-days, pays full price on arrival), `bestMarket`. Income gradient TODAY: drop-in (worst) < rail shipment (good). Droving must sit ABOVE rail shipment. NB a full-price in-person sell (`sellList`/`doSell`) exists but is **unwired** — in person it's always the drop-in.

**Pets/stock:** penned sheep + tamed beasts live on `player.pets` (persisted in `player.serialize`/`deserialize`). Each has `owner`, `stay`, `home`, a `type`/`petKind`.

**NPC memory (live, 2026-06-20, see `moorstead-npc-memory` memory):** per-player recall, durable transcripts, trade memory, and a "nosey" activity digest (`src/activity.js`) injected into villager/Merlin context. When you add droving, the activity digest and trade memory are natural places to make NPCs react ("heard you droved a fine flock to market").

## Slice 2 — registered farm status

The gate to droving. **Threshold: 5 head of tamed stock penned in a fenced fold, then register at the market town's notice board, paying a small brass charter fee.** Registration is deliberate (not automatic), giving the player agency.

- A single designated **market town** (fix which settlement in Slice 2; it's the same place droving targets — Pickering is the natural choice: it's "t' capital, minster, market an' all" per the handbook, southern terminus).
- Persist on the player: `farmStatus` / `farmRegistered` (in `serialize`/`deserialize`).
- **In-game legibility (mandatory — no threshold ships without its instruction):**
  - A "Become a farmer" notice-board / journal entry stating the path + the threshold explicitly ("5 head penned + register at t' market board").
  - A live progress hint: "3/5 head penned — pen 2 more, then register at t' market board."
  - Register-below-threshold is refused with the exact shortfall.
  - A milestone-ladder rung (bairns world) and the "Sheepdog & Flock" handbook tab updated.
- Files: `src/player.js` (persist), `src/main.js` (head-count + register flow + hints), `src/ui.js` (board entry + handbook), `src/economy.js` (charter fee), `scripts/verify-*.mjs` (threshold logic).

## Slice 3 — the drove + market sale

The "needn't be near the railway" path — the physical, atmospheric alternative to the rail ship-panel.

- A registered farmer takes a penned flock **off the fold as a mobile herd** and droves it (Slice 1 dog/horse mechanics) overland to the market town.
- At the market, sell the live herd → brass. Define `livestockPrice` (a live healthy beast is worth more than its wool + mutton sold piecemeal) carrying a **drover's premium**. Reward scales with head delivered; farm standing lifts it.
- **The income gradient must end: drop-in < rail shipment < a droved flock at market (best).** Tuning target: a full-flock drove clearly out-earns the same time mining + rail-shipping coal — a memorable payday. **Confirm the numbers with James.**
- **Risk en route** (makes it a journey, not a menu): sheep stray if you lose control; the barghest and night-things prey on a strung-out flock; bogs/high moor are hazards. Losing head = losing value. You're paid for what ARRIVES — never a hard fail.
- Files: `src/economy.js` (`livestockPrice` + premium + the sale), `src/entities.js`/`src/main.js` (the mobile herd + drove + arrival/sale), `src/ui.js` (the sale UI + hints), legibility surfaces as above.

## Process — follow these

1. **Brainstorming gate:** the design is approved, but Slice 3's economic balance is the sensitive part. Re-confirm the **payout tuning** (and the market-town choice + charter fee) with James before finalising — present numbers + the gradient comparison. Otherwise build to the spec.
2. **TDD** (this codebase's pattern): write a `scripts/verify-*.mjs` headless check FIRST (plain Node, `ok`/`bad` helpers, ends `RESULT: PASS/FAIL`, `process.exit`), watch it fail, implement, watch it pass. Wire it into `npm run verify`. Pure logic (head-count threshold, `livestockPrice`, the gradient inequality) is all headless-testable — keep it in pure modules (`economy.js`, `herding.js`).
3. **In-game legibility is a hard, cross-cutting rule** (§7 of the spec): no player-facing mechanic or threshold ships without its in-game instruction, and audit existing instructions for staleness as you go. Update the handbook tab, about.html (in James's first-person voice, **no em-dashes, no AI tells**), and the in-world hints together with the code.
4. **Verify before deploy:** `npm run verify` must be green; `npm run build` must be green; drive the live preview (see gotchas) to prove the loop end to end.
5. **Deploy** (Slices 2/3 are client-only — no brain/EVO change needed unless you add NPC reactions): `npx vercel deploy --prod --yes`, then verify the live bundle (curl the homepage, grep the `assets/index-*.js` for a string unique to your change). Players cache hard — note that Ctrl+Shift+R is needed to see it.

## Hard constraints (do not violate)

- **Production, kids play it.** Verify everything live before claiming done. Never ship an unverified balance change.
- **Accuracy (James's #1 rule):** never document a mechanic that isn't wired. The current handbook/about.html deliberately omit the registered farm + droving because they aren't built — that's correct; only add them once reachable.
- **James's voice prose (about.html, write-ups): NO em-dashes, no AI tells, first-person, plain English.** In-game dialect UI uses `&mdash;` entities deliberately — that's fine and separate.
- **Secrets / git:** the repo is PRIVATE. `moorstead keys.md` is gitignored. **Never `git add -A`** (it sweeps `finetune/`, `__pycache__`, secrets, scratch). Stage explicit paths. Commit messages end with the Co-Authored-By trailer; deploy only when asked.

## Gotchas worth knowing

- **Time = game-days, never wall-clock:** `now = sky.day + sky.time`. Shipments/delays use it. A drove's duration (if persisted) should too.
- **Preview driving:** `window.game`, `g.loginGuest()`, `g.newWorld(name)`, pump `g.frame()`. `newWorld` defers a tick so the first ~240-frame batch stays 'title'; >900 synchronous frames times out the 30s eval. Use `moorstead.warp('Pickering')` / the `moorstead.debug` API.
- **Herding test-environment trap (learned the hard way):** moving the player unloads chunks and can leave `foldScan` sampling at the wrong height (foldCells:0, mobs freeze on bad terrain). Test herding in a clean fresh world near spawn, not by teleporting the tester around. Multi-sheep funnelling through a 1-wide gate is the known rough edge (a wider gate / active play completes it).
- **The one-way gate already resolves the sealed-pen paradox** — don't reinvent it; reuse `passGate` + `foldAt`.
- **`npm run verify` is currently 13 checks** — your new one makes 14.

## References

- Spec: `docs/superpowers/specs/2026-06-19-farming-droving-design.md` (authoritative; §4 Slice 2, §5 Slice 3, §5/§11g the payout requirement, §7 legibility).
- Plans: `docs/superpowers/plans/2026-06-19-herding-engine.md` (Slice 1, done), `2026-06-19-trade-logistics-engine.md`.
- Program index: `docs/superpowers/economy-program.md` ("Farming vertical — status").
- Memories: `moorcraft-evo-stack` (hosts/ports/deploy), `moorstead-npc-memory` (NPC reactions you can hook), `moorstead-economy`.
