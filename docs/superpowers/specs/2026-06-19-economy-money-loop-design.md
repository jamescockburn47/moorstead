# Moorstead Economy — Sub-project 1: The Money Loop

**Date:** 2026-06-19
**Status:** Draft for review
**Part of:** the Moorstead living-economy program (5 sub-projects; this is #1, the foundation)

## The wider program (context)

The full vision is a *living* economy. It is too big for one spec, so it is carved into
five sub-projects built in dependency order:

1. **Money loop (this spec).** Currency, wallet, vendor till, brass payouts, subsistence
   sinks, big regional price spreads, the Exchange screen. Static prices. Solo-complete.
2. **Train-forced trade.** Consignment hold, station sealing, train-only movement, the
   origin-stamp provenance lock, spot and forward (appointment) selling. Depends on 1.
3. **Living market.** Stock-based dynamic pricing, vendor finite brass + restock, surge
   demand, special deals, the shared "moor market report" on the relay. Depends on 1.
4. **NPC agency.** Generalise Merlin/villager AI so NPCs pathfind, build to a plan, and
   produce goods over time — enabling hired labour and making the market truly living
   (NPC supply and demand). Extends the existing entity AI. Large.
5. **Aspiration & competition.** Money-gated assets (farm, coble, shop, grand plot,
   charter the train, hire labour), contested roles and leaderboards on the relay.

**Standing principle (program-wide):** the incentives to accumulate wealth must be real,
varied and genuinely worth chasing, and the catalogue of money-gated assets, functions and
roles is expected to keep growing over the life of the game. So everything that defines an
incentive (prices, assets, roles, services) is held as data, not hard-coded, and SP1
establishes that data-driven spine so new incentives can be added later without rework.

**Captured refinements (2026-06-19, for later sub-projects):**
- *Travel modes for trade (SP2).* Trade goods are NOT train-only after all. A player may also haul on foot, by horse, or by sea (the Whitby-Staithes coble run), but each carries far less than a freight consignment and so earns far less profit. The train stays the bulk, high-profit channel; foot, horse and sea are low-capacity, low-profit alternatives. Provenance still governs the spread (goods must actually travel from a different village to earn the import price), and the per-mode carry limit, not a ban, is what makes the railway worth using. This supersedes the earlier "train-only hard lock" framing, and SP2 must rework the provenance mechanism so it works across all travel modes, not just station-sealed rail freight.
- *Player-built settlements and rail links (SP5).* When rich and advanced enough, players can found new settlements and lay new rail links. The top of the aspiration ladder and a major world-shaping money sink; ties to NPC agency (SP4) for peopling new settlements.
- *Standing gates trade, not just price (SP3 + SP5).* Social standing should affect how MUCH a player can trade and on what terms, not only the price (which SP1 already does). Damaging towns and their surroundings lowers standing (via the existing shame system), which throttles and worsens trade: the anti-griefing lever. Better standing, earned by genuine social interaction and buttering up NPC partners, unlocks larger and better trade. Trade becomes relationship-gated, not purely transactional.

This document specs **only sub-project 1**.

## 1. Purpose & success criteria

Give every productive activity a payout in a real currency, and make being broke
genuinely limiting, so players are pulled into mining, farming, fishing, crafting, trading
and the railway. Teach the basics of supply and demand to a ten-year-old through a legible
market. Work fully solo.

Success looks like: a new player earns brass from any function within minutes; can see at a
glance why a good is cheap in one village and dear in another; can buy goods to resell;
feels being broke as slowness and lost opportunity, never as hunger; and never needs another human online.

## 2. Scope

**In:** brass currency + wallet; coal demoted to a commodity; the vendor till (buy & sell
in brass) replacing the barter table; a base-price catalogue with big regional spreads
(static); brass payouts for jobs, deliveries, bounties, goods runs and commissions;
subsistence sinks (food, tool repair, fuel, fares); buy-to-resell; the Exchange screen
showing prices across the villages.

**Out (later sub-projects):** consignment, provenance, train-forced trade, forward
appointments (SP2); dynamic stock-based pricing, vendor finite brass and restock, surge
demand, special deals, the shared market report (SP3); NPC production/building and hired
labour (SP4); aspirational assets, contested roles, leaderboards (SP5).

**Intermediate-state note:** in SP1, prices are static regional baselines and bulk
arbitrage on foot is *not yet* locked to the rail (SP2 does that). This is acceptable for
the foundation: the spreads exist to establish the incentive and teach the concept; SP2
then makes bulk hauling rail-only.

## 3. The currency

- Stored as an integer of **pence** on the player (`player.brass`). 12 pence = 1 shilling;
  20 shillings = £1 (period £sd).
- A display helper formats pence to text as **shillings and pence** ("3s 6d", "11d"),
  pounds only for large sums. Younger players learning the old £sd money is an intended,
  gentle educational outcome, not a barrier to design around (confirmed at review).
- The wallet is saved and loaded with the existing player save (`player.js`). Migration:
  a save with no `brass` field gets a starting purse (Open Decision (b)).
- **Coal (`COAL_LUMP`) is no longer money.** It stays an item, a fuel and a crafting input,
  and now carries a (regional) price like any other commodity. Every "paid in coal" code
  path (the fare, the barter swaps) is converted to brass.

## 4. Prices & regional spreads (the teaching core)

- A base-price catalogue: `PRICES[itemId] = basePence`, covering every tradeable item and
  block.
- Per-village price profile via region multipliers: `regionMult(village, itemId)`. The
  spreads are deliberately **big**, so a hauled load clearly beats the fare and the time:
  - Coal: cheap at the pit-head villages (Rosedale, Grosmont), dear at the coast (Whitby, Staithes).
  - Whitby jet: modest where it is mined, dear where it is scarce and to the carvers.
  - Fish: cheap on the coast, dear inland.
  - Wool: cheap at the farm villages, dear where there is demand.
- **Margin (buy vs sell):** a vendor sells to you dearer than it buys from you. A round trip
  at one vendor is therefore a net loss — the profit is *geographic* (buy cheap here, sell
  dear there), never local. This is the rule that makes the merchant loop the point.
- **Spread target (tuning):** a full load hauled across the line should net clearly more
  than the fare plus a fair wage for the time. Exact numbers live in a tuning table and are
  set by playtest (§14). The test in §13 asserts the spread beats the fare by the target margin.

## 5. Vendors & the till

- Each existing vendor gets a role-appropriate `sells` list (their goods) and `buys` list
  (what they purchase), replacing `tradesFor`/`doTrade` in [quests.js](../../../src/quests.js).
  Annie still deals in fish, Silas in jet, Tom in ore, Martha in cooked food, Mag broadly —
  now denominated in brass.
- **The till UI** (extends the chat-panel shop in `ui.js`): two columns — *Buy* (their goods,
  brass price, greyed if unaffordable) and *Sell* (your sellable items, what they will pay).
  Click to transact; brass and inventory update; existing toast + audio feedback.
- **Buy-to-resell:** buying a vendor's goods to haul and sell elsewhere is a first-class
  action, not a side effect. It is the merchant playstyle and the clearest supply/demand lesson.
- **Standing discount:** your standing with a vendor improves your buy and sell prices — the
  existing standing system becomes loyalty pricing.
- **NPC = player parity:** the spot-trade primitive (offer item, transact at a price) is
  identical whether the counterparty is an NPC vendor or, later, another player. SP1
  implements the NPC side against this interface so SP2 can drop players in unchanged.

## 6. Sources & sinks (the loop, solo-complete)

**Sources (earn brass), all against NPCs so solo works:**
- Sell produce and goods to vendors: ore, ingots, wool, mutton, fish, cooked food, fossils.
- Jobs, deliveries, bounties and goods runs pay brass (convert the item rewards in
  [quests.js](../../../src/quests.js) to brass, or add brass alongside; keep a few item
  rewards where they are story beats, e.g. the Dracula stake).
- Building commissions pay a wage.

**Sinks (spend brass), all use-driven, never an idle drain:**
- *Faster work:* iron tools and their **repair** (tools wear via the `dur` values in
  [defs.js](../../../src/defs.js)). Broke, you fall back to slow, free wood tools.
- *Faster travel:* train **fares**. Broke, you walk, which is slow and leaves you out on the
  night moor.
- *Trade capital:* brass to **buy goods to resell**. The lucrative merchant loop needs money
  to enter; broke, you can only sell what you gather yourself.
- *Goods & materials:* tools, blocks, dressed stone, coal, ingots, a fishing rod, cooked food
  (a convenience that restores more and saves cooking, never forced).
- *Status (light in SP1):* a donation to the church roof fund. Property, paid services and the
  big status sinks are SP5.

**Poverty: detrimental, never crippling.** Being broke must not threaten survival. A player can
always hunt and forage for food and build or borrow shelter, so hunger and exposure are
explicitly not the penalty. Poverty bites instead through friction and opportunity cost: you
work slowly (wood tools, no repairs), you travel slowly and on foot (no fares), and you are shut
out of the merchant loop (no capital to buy stock) and of paid services. Wealth buys speed,
reach and opportunity; poverty takes those away but never your life. Because the sinks are
use-driven (you pay when you act, not on a clock), an idle or skint player is never bled toward a
death spiral, and there is always a free way back up (forage, free wood tools, walk, shelter in a
village). The intent: you can survive for free, but you cannot thrive for free.

## 7. The Exchange (the teaching surface)

- A dedicated screen opened by a hotkey and a button.
- Shows, legibly for a ten-year-old:
  - A grid of **goods × villages** with current prices, colour- and arrow-coded (green =
    cheap, red = dear), so a spread is obvious at a glance ("jet's cheap at Rosedale, dear at
    Whitby — carry it there").
  - Your brass, and a one-line "what sells well where" hint.
  - Plain-English teaching tooltips: "Lots of it for sale here, so it's cheap. Somewhere
    short of it will pay more." No jargon.
- Built to **host the dynamic features later**: SP3 adds live price movement, surge-demand
  banners with countdowns, and special-deal entries to this same screen. SP1 ships the static
  grid plus the teaching hints.

## 8. Architecture & components

- **New `src/economy.js`** (no THREE, no DOM — headless-testable like `villagerlife.js`):
  owns the `brass` wallet operations (`earn`, `spend`, `canAfford`, `format`), the `PRICES`
  catalogue and `regionMult`, vendor `sells`/`buys` derivation, the spot-trade primitive
  (`price(item, village, side, standing)`), and save/load helpers.
- **`src/ui.js`:** the till panel (buy/sell), the Exchange screen, the brass HUD readout.
- **`src/player.js`:** the `brass` field; save/load; the tool repair hook (durability exists).
- **`src/quests.js`:** payouts call `economy.earn`; `tradesFor`/`doTrade` retired (or thin-
  wrapped) onto the new till.
- **Fare path** (train/rails): the fare is paid via `economy.spend`.
- **No multiplayer dependency.** SP1 is solo-complete; the relay/market-report hooks are SP3.

## 9. Data flow

- **Earn:** an activity completes → `economy.earn(player, pence)` → wallet updated → HUD refresh.
- **Sell:** till *Sell* → check item count → `price(item, village, 'sell', standing)` →
  remove item, `economy.earn` → feedback.
- **Buy:** till *Buy* → `price(item, village, 'buy', standing)` → `canAfford` → `spend`, add
  item (or `dropAtPlayer` if the pack is full) → feedback.
- `price(...)` is a pure function: `base × regionMult × sideMargin × standingDiscount`,
  rounded to whole pence. Easily unit-tested.

## 10. Error handling & edge cases

- **Never negative:** `spend` returns false if unaffordable; the till greys out unaffordable buys.
- **Pack full on buy:** drop at the player's feet (existing `dropAtPlayer`).
- **Save migration:** missing `brass` → grant the starting purse; coal already held stays as
  items (now sellable). No other save shape changes.
- **No money for repair/fare:** cannot do it — must earn or gather. Intended pressure, never a
  hard lock (free survival always exists).
- All arithmetic is integer pence; formatting happens only at display.

## 11. Solo-first guarantee

Every loop in SP1 — earn, buy, sell, spend, the Exchange — runs against NPCs and local state
only. No SP1 feature requires another live player. The multiplayer layers in later sub-projects
are strictly additive and degrade to exactly this behaviour when a player is alone, during
testing, or in a solo world.

## 12. Teachability (ten-year-old)

- The Exchange makes spreads visible at a glance (colour + arrows), no reading required.
- Plain-English hints, never jargon ("cheap here, dear there").
- The first sale and first buy each fire a one-line explanation.
- Buy-to-resell is the lesson by doing: buy cheap at A, sell dear at B, watch the profit.
  Supply and demand is learned by playing, not by being told.

## 13. Testing

- **Unit (headless, like `scripts/verify-villagers.mjs`):** pence formatting; `price()` purity
  and spreads; `earn`/`spend`/`canAfford` arithmetic never goes negative; a round trip at one
  vendor is a net loss (no free money); a cross-region haul is a net gain (arbitrage works).
- **Price-table sanity script:** every tradeable item has a price; every defined spread beats
  the fare by the target margin.
- **Manual playtest checklist:** new player earns first brass within minutes; sees and exploits
  a spread; runs dry and feels the pinch; recovers by working.

## 14. Tuning knobs (all data, set by playtest)

Starting purse; base prices; region multipliers (spread size); buy/sell margin; standing
discount curve; tool-repair costs; fare costs.

## 15. Open decisions (defaults chosen — change at review)

a. **Display: shillings and pence, DECIDED (keep).** Shillings-and-pence ("3s 6d"); children
   learning the old money is treated as part of the value, not a barrier. (Resolved at review.)
b. **Starting purse** = 5 shillings (60 pence) — enough to prime the pump, not enough to coast.
c. **Barter table fully retired** into the till (one trade system, not two).
d. **Tool repair as a vendor service** (a sink) rather than a craftable repair.
