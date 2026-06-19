# Moorstead Living-Economy Program — Overview & Handoff

**Living index. Last updated 2026-06-19.** This is the entry point for the economy work. Read it first, then the per-sub-project specs in `specs/` and plans in `plans/`.

## Why this exists

Moorstead is a browser voxel game (Vite + three.js, fully procedural) with AI villagers. There was no real economy: no currency, ad-hoc coal-as-money, a hand-authored barter table, and weak incentives to use most of the game's functions (mining, farming, fishing, crafting, the railway). The goal is a **living economy** that gives every function a payout and a purpose, teaches supply and demand (legibly enough for a ten-year-old), and works for a single solo player as well as a busy shared world.

The NPC fine-tuning effort (see the `finetune/` tree and the `moorstead-npc-finetune` memory) is **paused** until this economy exists, because a model that can explain the game's functions is worth little until players have a reason to use them.

## Status at a glance

| Sub-project | Scope | Status |
|---|---|---|
| **SP1 Money loop** | brass currency, vendor till, regional prices, subsistence sinks, the Exchange teaching screen | **Built + live + merged to main.** (Exchange screen + brass payouts/fares were carved to a later slice.) |
| **SP2 Trade logistics** | book rail/sea shipments, drop-in sales, vendor purse, freight cap, farm-gate | **Rail slice live + verified.** Clock tick, drop-in till, station ship-panel wired + playtested (commit ce54627). Remaining: farm-gate, sea/coble, multi-item parcels, delay tuning. |
| **SP3 Living market** | dynamic stock-based pricing, vendor restock, oversupply price-crash, shared "moor market report" | Designed in principle, not specced. |
| **SP4 NPC agency** | NPCs that pathfind, build, and produce/consume goods (extends the existing villager AI + Merlin) | Future. Unlocks hired labour and real NPC demand. |
| **SP5 Aspiration & competition** | money-gated assets (farm, coble, shop, grand plot, charter/own rail), player-built settlements + rail links, contested roles + leaderboards | Future. The reason to get rich. |

Build order: SP1 → SP2 → SP3 → SP4 → SP5, with SP4 a large parallel track.

## Locked design decisions

- **Currency = brass**, stored as integer pence on the player, displayed £sd ("3s 6d"). Children learning the old money is an intended educational outcome. Coal is demoted from money to an ordinary tradeable commodity.
- **Hybrid multiplayer model:** a player's money and prices are their own and uncheatable. A shared, non-authoritative "moor market report" on the existing relay gives the collective feel (SP3). Merchant **stock** is shared only at the monthly fair (SP2 Slice B); ordinary village vendors are per-player.
- **Pricing engine = stock-based** (SP3): vendor stock + finite brass + restock, so supply and demand emerge and oversupplying a market crashes its price.
- **Solo-first:** every loop must work with zero other live players. NPCs are full counterparties; trading an NPC is functionally identical to trading a player.
- **Trade is train-incentivised, not train-locked.** You may haul by foot, horse, or the Whitby-Staithes coble, but a booked rail/sea shipment pays the best price and the gradient is the only anti-cheat (no sealed holds or origin stamps).

## Cross-cutting principles (hold the whole program to these)

- **Real, varied, evolving wealth incentives.** There must be genuine, plural, money-gated things worth getting rich for, and the catalogue is expected to grow, so incentives (prices, assets, roles, services) are held as **data, not hard-coded**.
- **Goods need a reason to be bought beyond reselling**, or the market is a hollow loop. Goods need real utility (fuel, tools, materials, food) and NPCs must actually consume them, so demand is real (SP3/SP4). *This is a known gap until SP3/SP4.*
- **Poverty is detrimental but never crippling, and never via hunger.** Food and shelter are always free (forage, hunt, build, borrow). Being broke means slow work (wood tools), no fast travel, and no trade capital; all sinks are use-driven so an idle player is never bled into a death spiral. "Survive for free, but you can't thrive for free."
- **Standing gates trade, not just price.** It already shifts prices (SP1); it should also cap trade volume and terms, damaging towns lowers standing (the existing shame system) and throttles trade (anti-griefing), and buttering up NPC partners unlocks bigger/better trade (relationship-gated trade) (SP3/SP5).
- **Legible to a ten-year-old.** The Exchange screen, plain-English hints, learning by doing (buy cheap here, sell dear there).

## What is built (code map)

- **`src/economy.js`** (headless-testable, no THREE/DOM) owns it all: `formatBrass` (£sd), `PRICES` + `regionMult` + `priceOf` (regional spreads), `VENDORS`/`vendorFor`, and the `Economy` class. SP1 methods: `earn`/`spend`/`canAfford`, `buyList`/`sellList`, `doBuy`/`doSell`. SP2 engine: `dropInPrice`/`shipmentValue`, `purseOf`/`refillPurses`/`dropInSell` (vendor purse, keyed by `vendorKey` to the vendor not the display name, caps drop-in volume), `bookShipment`/`tickShipments` (forward shipments, freight cap `FREIGHT_ALLOWANCE`, delivery on a game-time tick; parcels validated at the boundary — positive integer counts, case-insensitive same-place). Tuning constants live at the top, under a TIME CONTRACT note.
- **`src/player.js`** holds the wallet (`brass`, with starting-purse migration) and trade state (`shipments`, `vendorPurses`, `pursesAt`), all persisted in `serialize`/`deserialize`.
- **`src/ui.js`** has the till (buy/sell buttons in the chat panel, replacing the old barter) and the brass HUD readout (`updateHUD`).
- **`src/main.js`** instantiates `this.economy = new Economy(this)`.
- **`src/quests.js`** had its barter table (`tradesFor`/`doTrade`) removed; payouts still grant items (converting some to brass is a later slice).
- **Tests:** `scripts/verify-economy.mjs`, run with `node scripts/verify-economy.mjs` (63 assertions, all green; +13 from the 2026-06-19 SP1+SP2 review — parcel validation, vendor-keyed purse, and the previously-untested cross-session delivery / purse independence / refill clamp / `villageOf` paths). Mirrors the `scripts/verify-villagers.mjs` pattern: plain Node, no framework.

## What is NOT built yet (the path forward)

1. **SP2 plan 2 (wiring) — rail slice DONE (commit ce54627), live-verified.** The trade engine is now playable on the railway: the clock tick (`now = sky.day + sky.time`) delivers shipments and refills purses, the in-person till sells at the drop-in price (`dropInSell`, not `doSell`), and the station board has a "Ship goods by rail" panel routing each good to its dearest market. **Remaining SP2 wiring:** farm-gate lineside booking (proximity to `rails.js`), sea/coble shipping (Whitby↔Staithes), multi-item parcels + a free goods/destination picker, and delivery-delay tuning / train-arrival tie-in. See the marked checklist at the bottom of `plans/2026-06-19-trade-logistics-engine.md`.
2. **SP2 Slice B:** the monthly fair (a recurring shared marketplace + the catch-all for isolated sellers) and shared cross-player stock.
3. **SP1 leftovers:** the Exchange teaching screen, converting job rewards to brass, the train fare in brass.
4. **SP3, SP4, SP5** per the table above.

## Repo and deploy state (updated 2026-06-19, post-deploy)

- All of the above, plus the SP1+SP2 review hardening, is **committed and pushed to `origin/main`** and **deployed to production**. **Git push does NOT auto-deploy** (the GitHub link is metadata-only — verified: a push registered no build): deploy with `npx vercel deploy --prod --yes` from the repo root (Vercel CLI auth is stored locally; `.vercel/` sets the project), or `deploy/ship.ps1`. The current build is **live at www.moorstead.app** (apex `moorstead.app`/`moorcraft.app` 308-redirect there; `/about.html` returns 200). Full deploy flow is in the `moorcraft-evo-stack` memory.
- `public/about.html` is now **tracked and deployed** — the `/about.html` 404 risk is closed.
- The game's live tunnel may be **down** (it was taken down for the earlier fine-tune run; restore with `sudo systemctl start sovren-cloudflared` on the EVO box; see the `moorcraft-evo-stack` memory). Unrelated to the economy code.

## Spec/plan index

- SP1 spec: `specs/2026-06-19-economy-money-loop-design.md` (also holds the program standing-principle + the captured SP2/SP5 refinements).
- SP1 plan: `plans/2026-06-19-economy-money-loop.md`.
- SP2 spec: `specs/2026-06-19-trade-logistics-design.md`.
- SP2 engine plan (built): `plans/2026-06-19-trade-logistics-engine.md`.
