# Moorstead Economy — Farming & Droving (the hill-farmer vertical)

**Date:** 2026-06-19
**Status:** Draft for review
**Part of:** the living-economy program. A cross-cutting vertical that spans SP2 (trade — this is the rich evolution of the deferred "farm-gate"), SP4 (animal behaviour), and SP5 (progression). It builds on the SP1+SP2 economy and the existing taming/companion/pen systems, not from scratch.

## 1. Purpose & success criteria

Let a player live the hill-farmer fantasy: gather wild Swaledales off the moor with a working sheepdog, keep a flock in a fold, earn official farm status, then **drove the live animals to the market town and sell them there** — without having to be near the railway. Atmospheric (horses, dogs, a flock moving as a body across the moor), legible to a ten-year-old, and solo-complete.

Success: a player can (1) work a sheepdog to gather a scattered flock and pen it; (2) build up to a registered farm and be told, in-game, exactly how; (3) drove the flock to market and get paid **handsomely enough that the whole undertaking is plainly worth it**. Every step is explained where the player will look.

**The financial upside is the make-or-break lever.** Droving is the most effort in the game (taming a flock, building a fold, registering, then a risky overland drive). If it doesn't pay clearly more than the easy paths, no one will do it and the whole vertical is dead weight. So the reward must sit at the very top of the income gradient — see §5.

## 2. Scope — three slices

Built in order, each its own plan → implementation → deploy:

- **Slice 1 — Herding core** (the heart, implementable now): herdable flock behaviour + a working sheepdog you command + the gather→pen loop. Proven in a field before any economics.
- **Slice 2 — Farm status** (the gate): the registered-farm threshold and the in-game path to it; unlocks droving.
- **Slice 3 — The drove + market sale**: drive the live flock to the market town and sell it; risk en route; ties into the existing economy.

**Cross-cutting (all slices): in-game legibility** (§7) — no mechanic ships without its instruction.

**Out (later / other sub-projects):** cattle droving (sheep first; cattle work differently and come later), the full emergent flocking model (§3 keeps it scripted), the monthly fair, dynamic stock/price-crash (SP3), NPC farmers (SP4).

## 3. Slice 1 — the herding core

### 3.1 The flock (scripted, swappable)

The flock has a **centroid** and a single **target point**. Pressure sources nudge the target *away* from themselves; the sheep path to the target with cohesion (stay bunched) and separation (don't stack). Each sheep blends this into its existing `wishX/wishZ` move-intent. Calm sheep graze and drift.

This is **scripted** (a centroid + target), chosen for v1 over an emergent per-sheep model: cheap, predictable, easy to tune. It lives behind a **fixed `pressure → target` interface** so the model can later be swapped for the emergent/hybrid per-sheep version (flight zones, organic splitting) **without touching the dog commands or the gather→pen loop**. That swap is explicitly a future option, not this slice.

### 3.2 The working dog

A sheepdog is the existing companion **dog** (tamed with meat) with a "working" job turned on. You command its *intent*; it runs the geometry itself, applying pressure to the flock:

- **come-bye / away** — flank anticlockwise / clockwise around the flock (the dog arcs wide to the far side).
- **walk-on** — move straight in, pressing the flock off it.
- **lie-down / that'll-do** — stop / release pressure (the flock settles).

Input: the **arrow keys** as whistle commands (← come-bye, → away, ↑ walk-on, ↓ lie-down), since WASD is the player's own movement and arrows are otherwise free. A **heel key (H)** recalls her to you. (Alternative considered: a hold-to-open whistle radial — deferred; arrows are faster and need no menu.)

### 3.3 The player and the horse

You are the *broad* pressure, the dog the *precise* one. On the moorland pony (the existing mount) you cover ground, cut off a break, and hold a side; the dog does the flanking on command. On foot you can still herd, just slower.

### 3.4 The gather→pen loop (the demonstrable v1)

Prerequisites: a tamed sheepdog at heel, sheep within reach, and a **fold** — a fenced enclosure the player builds (fence blocks + a gap for the gate already exist).

The loop: gather scattered sheep into a bunch with the dog, drive them through the gate into the fold. **Penned** is detected **zone-based** — when every target sheep is inside the fold's footprint — which is simpler and more robust than true geometric containment, while the fence still does the physical work of holding them.

**The payoff, and the bridge to Slice 2:** on a successful pen, the gathered sheep **settle as stay-at-home stock**, reusing the existing `owner` + `stay` + `home` system, anchored to the fold. Herding is therefore how you *stock your farm* — gather wild Swaledales, pen them, and they're now your kept flock that counts toward farm status.

### 3.5 Failure & feel

Under the scripted model, mishandling — pressing too hard, flanking from the wrong side — makes the flock overshoot and scatter loosely around the target, costing time to re-gather. (The *dramatic* split-the-flock failure is what the future emergent model would add; under scripted it's a softer setback.) Recoverable, never punishing.

## 4. Slice 2 — farm status (the registered farm)

The gate to droving. **Threshold: keep 5 head of tamed stock penned in a fenced fold, then register at the market town's notice board.** Registration is a deliberate step (not automatic) and costs a small brass fee (a charter), so becoming a registered farmer is a choice the player makes, with agency.

- Reaching it: tame and pen 5 head (via Slice 1's loop), then visit the **market town** — a single designated livestock-market settlement (which one is fixed in Slice 2/3; it's the same place you later drove the flock to) — and register at its notice board, paying the charter.
- Unlocks: **droving to market** (Slice 3).
- Stated in-game (see §7): a "Become a farmer" board entry spelling out the path and the threshold, plus a live progress hint as you build up — *"3/5 head penned — pen 2 more, then register at t' market board."*
- Persisted on the player (`farmStatus` / `farmRegistered`).

(Fee amount and whether standing affects it are tuning values, set at implementation.)

## 5. Slice 3 — the drove + market sale

The farmer's "needn't be near the line" path — the physical alternative to the rail ship-panel.

- A registered farmer can take a penned flock **off the fold as a mobile herd** and drove it (horse + dog, Slice 1 mechanics) overland to the **market town**.
- At the market, sell the live herd / **book a price** → brass, integrating with the existing economy (live-animal value via `priceOf`/a livestock price; reuse the SP2 sale/booking primitives where they fit).
- **The payout — top of the gradient (the make-or-break).** Droving is the highest-effort, highest-risk sale, so it must pay the most. A live, healthy beast at the livestock market is worth more than her wool and a joint of mutton sold piecemeal: define a `livestockPrice` that carries a **drover's premium** over the sum of the animal's products. Reward scales with head delivered, and farm reputation/standing lifts it (SP5). The full income gradient is therefore: drop-in (worst) < rail shipment < **a droved flock at market (best)**. **Tuning target:** a successful drove of a full flock clearly out-earns the same time spent on any other path (e.g. mining + rail-shipping coal) — a memorable payday that funds the next aspiration (more stock, a better fold, a coble, a shop). Losing head en route is the counterweight that keeps it honest, not a way to make it stingy.
- **Risk en route** (what makes it a journey, not a menu): sheep stray if you lose control, the **barghest** and other night-things prey on a strung-out flock, bogs and the high moor are hazards. Losing head means losing value. Good droving — keeping them bunched, moving by day — pays.
- Relation to the rail ship-panel: both are "get goods to market." Rail suits anyone near a station; droving suits the off-line farmer and is the atmospheric, hands-on route. Neither is forced.

## 6. Architecture & components

- **`src/herding.js`** (NEW, headless-testable, no THREE/DOM) — the pure scripted flock model behind the `pressure → target` interface, plus pure helpers: the pressure→target nudge, the "all N inside the fold zone?" check, and the dog-command→intent mapping. This is the isolated, swappable unit; the rest of the game talks to it through that interface.
- **`src/entities.js`** — the flock/dog AI hooks: sheep consume the herding model's target in their move-intent; the dog's commanded-intent → movement; reuse of the companion/`stay`/`home` systems for penning.
- **`src/main.js`** — command input (arrow-key whistles, heel), the gather→pen completion + "settle as stock", the drove, and the crosshair hints.
- **`src/ui.js`** — the "Become a farmer" board entry, the registration action at the market board, the command reference, and progress hints.
- **`src/player.js`** — `farmStatus` (head penned, registered) persisted in serialize/deserialize.
- **`src/economy.js`** — live-animal market value for the drove sale (Slice 3).

Isolation principle: the herding *model* is a pure module with one job, swappable without disturbing input, penning, or economics.

## 7. In-game legibility (cross-cutting mandate)

The taming bug (a working mechanic that read as "broken" purely because nothing told the player how) is the rule's origin: **no player-facing mechanic or threshold ships without its in-game instruction, and existing instructions are audited for staleness as we go.** Surfaces:

- **Crosshair hints** — dog commands ("← come-bye / → away, ↑ walk on, ↓ lie down"), the taming/feed hints (already shipped this session), and a "drive the flock" cue.
- **Milestone ladder** (`milestones.js`) — tame a beast → work a dog → pen a flock → **register your farm** → first drove to market.
- **Notice-board / journal** — a "Become a farmer" entry stating the path and the **registered-farm threshold explicitly** (5 head + register).
- **Live progress hints** — "3/5 head penned…", "registered! tha can drove to market now", etc.
- **Command reference** — the whistle keys shown when you have a working dog at heel.

Every threshold the design introduces must be visible to the player at the moment it's relevant.

## 8. Data flow

- **Gather:** dog command (arrow) → `herding` maps to intent → dog applies pressure → `herding.pressureToTarget` moves the flock target → sheep path to target → flock moves as a body.
- **Pen:** flock inside fold zone → `herding.allPenned` true → sheep set `owner`+`stay`+`home` → farm head count updates → progress hint.
- **Register:** at the market board, head ≥ 5 → pay charter → `player.farmStatus.registered = true` → droving unlocked → toast + board entry update.
- **Drove/sell:** lead the flock to the market → sell live herd → `economy.earn` → flock consumed → toast.

## 9. Error handling & edge cases

- No dog at heel: commands do nothing; a hint explains you need a working dog.
- Fold not closed / sheep outside: penning simply isn't complete; the progress hint shows how many are in.
- Trying to register below threshold: refused with the exact shortfall ("tha needs 5 head penned; tha's 3").
- Droving without farm status: not offered; the board tells you how to qualify.
- Losing head en route (predation/straying): the herd shrinks; the sale pays for what arrives. Never a hard fail.
- Save/load mid-everything: penned stock already persist; `farmStatus` persists; an in-progress drove is the one new transient — on reload the flock reverts to penned (safest), or persists if cheap (decided at implementation).

## 10. Testing

- **Headless (`scripts/verify-herding.mjs`, new):** the pure model — pressure→target nudges away from the source; cohesion pulls a scattered set toward the centroid; `allPenned` is true only when all N are inside the zone; the dog-command→intent mapping is correct; the farm-status threshold logic (count, ≥5, registered gate) is correct.
- **Live (preview):** scatter a flock, work the dog through all four commands, drive them through the gate, confirm all penned + settled as stock; build to 5 head and register at the board; drove a flock to market and confirm the sale + the risk (a strung-out flock loses head).

## 11. Open decisions (defaults chosen; change at review)

a. **Flock model scripted for v1**, behind a swappable pressure→target interface (confirmed).
b. **Dog commands on arrow keys** as whistles; heel on H (default; radial deferred).
c. **Farm threshold = 5 head penned + register at the market board for a small fee** (confirmed; fee amount is tuning).
d. **Sheep only** for Slice 1–3; cattle later.
e. **Drove risk** (predation/stray/bog) is real but never a hard fail — you're paid for what arrives.
f. **Fold** = player-built fenced enclosure, zone-detected; not true geometric containment.
g. **Financial upside tops the gradient (James's requirement):** a droved flock is the single most lucrative sale in the game, sized so the whole effort is plainly worth it. The exact `livestockPrice` + drover's premium are Slice-3 tuning, measured against the §5 target (must clearly out-earn any other income path).
