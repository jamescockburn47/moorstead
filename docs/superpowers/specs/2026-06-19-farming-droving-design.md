# Moorstead Economy — Farming & Droving (the hill-farmer vertical)

**Date:** 2026-06-19
**Status:** Slice 1 built & live. Slices 2–3 tuning signed off by James 2026-06-20 — market town = **Moorstead**, charter fee = **£1 (240d)**, live price = **120d/head** (flat, standing-lifted), arrival = **sell-on-delivery yard**.
**Part of:** the living-economy program. A cross-cutting vertical that spans SP2 (trade — this is the rich evolution of the deferred "farm-gate"), SP4 (animal behaviour), and SP5 (progression). It builds on the SP1+SP2 economy and the existing taming/companion/pen systems, not from scratch.

## 1. Purpose & success criteria

Let a player live the hill-farmer fantasy: gather wild Swaledales off the moor with a working sheepdog, keep a flock in a fold, earn official farm status, then **drove the live animals to the market town and sell them there** — without having to be near the railway. Atmospheric (horses, dogs, a flock moving as a body across the moor), legible to a ten-year-old, and solo-complete.

Success: a player can (1) work a sheepdog to gather a scattered flock and pen it; (2) build up to a registered farm and be told, in-game, exactly how; (3) drove the flock to market and get paid **handsomely enough that the whole undertaking is plainly worth it**. Every step is explained where the player will look.

**The financial upside is the make-or-break lever.** Droving is the most effort in the game (taming a flock, building a fold, registering, then a risky overland drive). If it doesn't pay clearly more than the easy paths, no one will do it and the whole vertical is dead weight. So the reward must sit at the very top of the income gradient — see §5.

## 2. Scope — four slices

Built in order, each its own plan → implementation → deploy:

- **Slice 1 — Herding core** (the heart, implementable now): herdable flock behaviour + a working sheepdog you command + the gather→pen loop. Proven in a field before any economics.
- **Slice 2 — Farm status** (the gate): the registered-farm threshold and the in-game path to it; unlocks droving.
- **Slice 3 — The drove + market sale**: drive the live flock to the market town and sell it; risk en route; ties into the existing economy.
- **Slice 4 — The wider menagerie** (§6): generalise the vertical to cows (the cattle drove), horses/ponies (a horse fair; mounts stay rideable), pigs (sty stock, sold individually), and llamas (made keepable). As data — a `droveable` flag + per-species price — not new code. Built after the sheep slices prove the loop.

**Cross-cutting (all slices): in-game legibility** (§8) — no mechanic ships without its instruction.

**Out (later / other sub-projects):** the full emergent flocking model (§3 keeps it scripted), the monthly fair, dynamic stock/price-crash (SP3), NPC farmers (SP4).

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

Prerequisites: a tamed sheepdog at heel, sheep within reach, and a **fold** — a fenced enclosure the player builds from the new fence and one-way gate blocks (§3.6).

The loop: gather scattered sheep into a bunch with the dog and drive them toward the gate. The one-way gate opens to let them in from outside and shuts behind them, so a *fully* enclosed pen is reachable — **this fixes the enclosure paradox** (a sealed pen with no opening could never be entered, yet an opening would let the flock escape). **Penned** is detected by `foldAt` (the herding engine): the fences and the gate bound a flood-fill, and a head is penned when it stands on a fold cell (`allPennedCells`). The fences do the physical work of holding them; the one-way gate keeps them from wandering back out.

**The payoff, and the bridge to Slice 2:** on a successful pen, the gathered sheep **settle as stay-at-home stock**, reusing the existing `owner` + `stay` + `home` system, anchored to the fold. Herding is therefore how you *stock your farm* — gather wild Swaledales, pen them, and they're now your kept flock that counts toward farm status.

### 3.5 Failure & feel

Under the scripted model, mishandling — pressing too hard, flanking from the wrong side — makes the flock overshoot and scatter loosely around the target, costing time to re-gather. (The *dramatic* split-the-flock failure is what the future emergent model would add; under scripted it's a softer setback.) Recoverable, never punishing.

### 3.6 Fence and gate blocks (new)

The fold needs two new blocks — neither exists today (the "lineside fence" is only rendered scenery; there is no buildable fence, so "fence her in" has had nothing to build with).

- **Fence** (`B.FENCE`): a thin, stock-proof barrier. It blocks both animals and the player (so the gate is the only way through) but renders as a thin post-and-rail, not a full wall. The voxel renderer only knows solid cubes and passable cutout-crosses, so this needs a small addition — a **`barrier` flag** that collides like a solid yet draws thin. Craftable from wood at the bench. It is a boundary for fold detection (`foldAt`'s `isFence` returns true for it).
- **Gate** (`B.GATE`) — the one-way livestock gate that makes a *sealed* fold usable:
  - **A boundary for fold detection**, so a ring of fences with a gate still reads as fully enclosed (the interior doesn't leak out the gateway).
  - **One-way for animals:** it opens (becomes passable) for an animal approaching from the **outside** — they walk in — and stays shut for an animal on the **inside**, so penned stock can't wander off. Inside vs outside is read from the detected fold: the gate's interior side is the one facing the fold's cells; a lone gate with no enclosure yet simply opens for any approaching animal.
  - **Always passable by the player**, both ways — it's the farmer's door.
  - Collision is therefore **conditional** (per entity, per side), a special case in physics that the solid/cutout binary can't express; the gate visibly swings.

Implementation (Plan 2): add the block ids + atlas tiles + `BLOCKS` defs + bench recipes in `defs.js`/`textures.js`; the `barrier` collision and the gate's conditional passability in `physics.js`; `foldAt`'s `isFence` predicate treats both `B.FENCE` and `B.GATE` as boundaries. Fancier custom fence/gate geometry (proper swinging hurdle) is later polish; the `barrier`-flag thin fence + a swinging-gate visual is the v1.

## 4. Slice 2 — farm status (the registered farm)

The gate to droving. **Threshold: keep 5 head of tamed stock penned in a fenced fold, then register at the Moorstead market notice board.** Registration is a deliberate step (not automatic) and costs a **£1 (240d) charter fee**, so becoming a registered farmer is a choice the player makes, with agency.

- Reaching it: tame and pen 5 head (via Slice 1's loop), then visit **Moorstead** — the designated livestock-market settlement (the central village hub; the same place you later drove the flock to) — and register at its notice board, paying the £1 charter.
- Unlocks: **droving to market** (Slice 3).
- Stated in-game (see §8): a "Become a farmer" board entry spelling out the path and the threshold, plus a live progress hint as you build up — *"3/5 head penned — pen 2 more, then register at t' market board."*
- Persisted on the player (`farmStatus` / `farmRegistered`).

(Charter fee fixed at £1 / 240d, signed off 2026-06-20. Whether standing affects it is a minor tuning value, set at implementation.)

## 5. Slice 3 — the drove + market sale

The farmer's "needn't be near the line" path — the physical alternative to the rail ship-panel.

- A registered farmer can take a penned flock **off the fold as a mobile herd** and drove it (horse + dog, Slice 1 mechanics) overland to **Moorstead** — the drove runs from an outlying moor fold down into the central village. The penned stock are un-anchored from `home`/`stay` into a driven herd for the journey.
- **Arrival — a sell-on-delivery yard** (James's call, 2026-06-20): a marked market yard beside Moorstead's Goods Market boards. Drove the herd into the yard; a **"sell flock" action sells every head inside the yard instantly** and the mart's drovers lead them off (they despawn). The sale is instantaneous, so there is no window for the flock to wander — no market-pen containment logic is needed. Pays per head via `economy.earn`.
- **The payout — top of the gradient (the make-or-break).** Droving is the highest-effort, highest-risk sale, so it must pay the most. A live, healthy beast at the livestock market is worth more than her wool and a joint of mutton sold piecemeal: define a `livestockPrice` that carries a **drover's premium** over the sum of the animal's products. **Signed off 2026-06-20: a flat 120d (10s) per head** — standalone, NOT derived from the wool spread (Moorstead's wool multiplier is only 0.6, which would underpay the agreed number), lifted only by standing. A Swaledale's piecemeal products (`drops` = 1–2 wool + 1–2 mutton) are worth ~20d sold at full price, so 120d is roughly a 6× drover's premium. Reward scales linearly with head delivered, and farm reputation/standing lifts it (SP5). The full income gradient is therefore: drop-in (worst) < rail shipment < **a droved flock at market (best)**. **Tuning target (met):** the best reliable rail haul today is ~96 coal at 5d = **480d (£2)**; a drove pays **5 head = £2 10s (600d), 8 head = £4 (960d)** — clearly on top even at the 5-head minimum and even after losing a head or two. By contrast, slaughtering an 8-head flock and rail-shipping its wool+mutton nets only ~160d *and destroys the flock*. A memorable payday that funds the next aspiration (more stock, a better fold, a coble, a shop). Losing head en route is the counterweight that keeps it honest, not a way to make it stingy.
- **Risk en route** (what makes it a journey, not a menu): sheep stray if you lose control, the **barghest** and other night-things prey on a strung-out flock, bogs and the high moor are hazards. Losing head means losing value. Good droving — keeping them bunched, moving by day — pays.
- Relation to the rail ship-panel: both are "get goods to market," but **live animals cannot be freighted by rail — only their slaughtered products can.** Droving is therefore the *only* way to realise the live-beast premium; rail suits goods, droving suits live stock and the off-line farmer. Neither is forced.

## 6. Slice 4 — the wider menagerie (cows, horses, pigs, llamas)

Generalise the sheep vertical to the rest of the livestock **as data, not new code paths** (James's call, 2026-06-20), built after Slices 2-3 prove the loop. The engine change is small: the herding/penning loop currently hard-codes `m.type === 'sheep'`; replace that with a **`droveable` flag** on the mob def and give each species a **`livestockPrice`** plus a herd/utility profile. The registered-farm threshold, the fold, the drove, and the sell-on-delivery yard are all reused unchanged — penned head of any kept species counts toward farm status, and a drove may be single-species or mixed.

**Per-species process (each a profile, the same loop):**

- **Cattle — Dale Cow** (already a tameable pasture herd, slow at 1.2): the classic cattle drove. Herds and pens exactly like sheep, slower to move, far dearer per head — the big-value drove. *~340d/head (≈3× sheep).* The **Dale Bull is excluded** as stock: it gores (aggro, dmg 4), so it stays a hazard, not a droveable beast.
- **Horses — Moorland Pony** (already the mount, tameable): gather half-wild ponies and drove them to a **horse fair** at the Moorstead mart to sell — **ponies stay rideable**, so you are selling your spares and the mount role is untouched. Top of the ladder. *~540d/head (≈4–5× sheep).*
- **Pigs — Saddleback** (barely flock, group [1-3]; has the truffle-snuffle ability): **sty stock, not a herd drove.** Kept and fattened in the fold, the snuffle ability retained, **sold per head at the mart** rather than droved as a flock (a forced pig flock would read oddly in play). *~150d/head.*
- **Llamas — Pack Llama** (wool, herds [2-3]): **needs `tameable: true` added** (it isn't today); then it is keepable wool stock, droveable and sellable like sheep. *~110d/head (wool only, no meat).* A pack/cargo role (tie to trade logistics) is a later option, not this slice.

**Value ladder (tuning, confirm at build, same as the sheep payout): llama ≈110 ≤ sheep 120 < pig ≈150 < cow ≈340 < horse ≈540.** Bigger or more-useful beasts pay more, so cattle and horse droves are the aspirational big paydays above the sheep entry, and every drove still tops the income gradient (§5) with headroom.

**Fixes this slice carries:** the llama gains `tameable: true`; the pig's `RAW_BEEF` drop is a stand-in for pork (add a pork item or leave it — decide at build). Legibility (§8) applies as ever: each newly keepable species needs its taming hint, its mart price shown, and a handbook/ladder line.

**Still out (later):** the emergent per-sheep flocking model (§3), the monthly fair, dynamic stock/price-crash (SP3), NPC farmers (SP4).

## 7. Architecture & components

- **`src/herding.js`** (NEW, headless-testable, no THREE/DOM) — the pure scripted flock model behind the `pressure → target` interface, plus pure helpers: the pressure→target nudge, the "all N inside the fold zone?" check, and the dog-command→intent mapping. This is the isolated, swappable unit; the rest of the game talks to it through that interface.
- **`src/entities.js`** — the flock/dog AI hooks: sheep consume the herding model's target in their move-intent; the dog's commanded-intent → movement; reuse of the companion/`stay`/`home` systems for penning.
- **`src/main.js`** — command input (arrow-key whistles, heel), the gather→pen completion + "settle as stock", the drove, and the crosshair hints.
- **`src/ui.js`** — the "Become a farmer" board entry, the registration action at the market board, the command reference, and progress hints.
- **`src/player.js`** — `farmStatus` (head penned, registered) persisted in serialize/deserialize.
- **`src/economy.js`** — live-animal market value for the drove sale (Slice 3).

Isolation principle: the herding *model* is a pure module with one job, swappable without disturbing input, penning, or economics.

## 8. In-game legibility (cross-cutting mandate)

The taming bug (a working mechanic that read as "broken" purely because nothing told the player how) is the rule's origin: **no player-facing mechanic or threshold ships without its in-game instruction, and existing instructions are audited for staleness as we go.** Surfaces:

- **Crosshair hints** — dog commands ("← come-bye / → away, ↑ walk on, ↓ lie down"), the taming/feed hints (already shipped this session), and a "drive the flock" cue.
- **Milestone ladder** (`milestones.js`) — tame a beast → work a dog → pen a flock → **register your farm** → first drove to market.
- **Notice-board / journal** — a "Become a farmer" entry stating the path and the **registered-farm threshold explicitly** (5 head + register).
- **Live progress hints** — "3/5 head penned…", "registered! tha can drove to market now", etc.
- **Command reference** — the whistle keys shown when you have a working dog at heel.

Every threshold the design introduces must be visible to the player at the moment it's relevant.

## 9. Data flow

- **Gather:** dog command (arrow) → `herding` maps to intent → dog applies pressure → `herding.pressureToTarget` moves the flock target → sheep path to target → flock moves as a body.
- **Pen:** flock inside fold zone → `herding.allPenned` true → sheep set `owner`+`stay`+`home` → farm head count updates → progress hint.
- **Register:** at the market board, head ≥ 5 → pay charter → `player.farmStatus.registered = true` → droving unlocked → toast + board entry update.
- **Drove/sell:** un-anchor penned stock into a mobile herd → drove to Moorstead → herd enters the **sell-on-delivery yard** → "sell flock" action → `livestockPrice` (120d) × head in the yard → `economy.earn` → herd led off (despawn) → toast.

## 10. Error handling & edge cases

- No dog at heel: commands do nothing; a hint explains you need a working dog.
- Fold not closed / sheep outside: penning simply isn't complete; the progress hint shows how many are in.
- Trying to register below threshold: refused with the exact shortfall ("tha needs 5 head penned; tha's 3").
- Droving without farm status: not offered; the board tells you how to qualify.
- Losing head en route (predation/straying): the herd shrinks; the sale pays for what arrives. Never a hard fail.
- Save/load mid-everything: penned stock already persist; `farmStatus` persists; an in-progress drove is the one new transient — on reload the flock reverts to penned (safest), or persists if cheap (decided at implementation).

## 11. Testing

- **Headless (`scripts/verify-herding.mjs`, new):** the pure model — pressure→target nudges away from the source; cohesion pulls a scattered set toward the centroid; `allPenned` is true only when all N are inside the zone; the dog-command→intent mapping is correct; the farm-status threshold logic (count, ≥5, registered gate) is correct.
- **Live (preview):** scatter a flock, work the dog through all four commands, drive them through the gate, confirm all penned + settled as stock; build to 5 head and register at the board; drove a flock to market and confirm the sale + the risk (a strung-out flock loses head).

## 12. Open decisions (defaults chosen; change at review)

a. **Flock model scripted for v1**, behind a swappable pressure→target interface (confirmed).
b. **Dog commands on arrow keys** as whistles; heel on H (default; radial deferred).
c. **Farm threshold = 5 head penned + register at the Moorstead market board, £1 (240d) charter** (confirmed 2026-06-20; fee fixed).
d. **Sheep only** for Slices 1–3; the wider menagerie (cattle, horses, pigs, llamas) is **Slice 4** — see (k) and §6.
e. **Drove risk** (predation/stray/bog) is real but never a hard fail — you're paid for what arrives.
f. **Fold** = player-built fenced enclosure, zone-detected; not true geometric containment.
g. **Financial upside tops the gradient (James's requirement):** a droved flock is the single most lucrative sale in the game. **`livestockPrice` fixed 2026-06-20 at a flat 120d/head** (standing-lifted, not wool-spread-derived), giving 5 head = £2 10s, 8 head = £4 against the £2 best coal run — clearly out-earns every other income path per the §5 target.
h. **Fence + one-way gate blocks (James's call):** a new `barrier`-flag fence (thin, but collides) and a one-way auto-gate (opens for an animal from outside, shut from inside, always open to the player, counts as a fold boundary). The gate resolves the sealed-pen paradox — animals get in but can't get out. v1 uses the `barrier` flag + a swinging-gate visual; bespoke fence geometry is later polish.
i. **Market town = Moorstead** (James's call, 2026-06-20), not Pickering: the central village hub is the auction market and the drove runs moor-fold → village. `livestockPrice` is flat (standing-lifted only) so Moorstead's low wool spread (0.6) doesn't underpay the agreed 120d/head.
j. **Arrival = a sell-on-delivery yard** beside Moorstead's Goods Market boards (James's call, 2026-06-20): the "sell flock" action sells all head in the yard instantly and they're led off — instantaneous, so no market-pen containment is needed and the flock can't wander. Live animals can't be rail-freighted, so droving is the only route for live stock.
k. **The wider menagerie is Slice 4** (James, 2026-06-20): cows/horses/pigs/llamas generalised as data (a `droveable` flag + per-species `livestockPrice`), built after the sheep slices. Horses sell at a fair but keep the mount role; pigs are sty stock sold individually (they don't flock); the bull is excluded as a hazard; the llama must be made `tameable`. Value ladder llama ≤ sheep < pig < cow < horse, tuned at build. Detail in §6.
