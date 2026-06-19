# Moorstead Economy — Sub-project 2: Trade Logistics (Slice A)

**Date:** 2026-06-19
**Status:** Draft for review
**Part of:** the Moorstead living-economy program. This is SP2, the trade-logistics layer that sits on the SP1 money loop. This document specs **Slice A** (the core sell paths); the monthly fair and shared stock are **Slice B**, a later spec.

## 1. Purpose & success criteria

Make *how* and *where* you sell matter, so the railway and the ports become the backbone of commerce and the regional price spreads from SP1 are actually worth exploiting. A player should have a clear, honest gradient: ship goods properly and earn the full spread, or sell on the spot for less. No anti-cheat machinery beyond that gradient.

Success: a player can buy or produce goods in one place, **book a shipment** by rail or sea to a market where they sell dear, and collect the proceeds on delivery without babysitting the cargo; or, when they can't be bothered, **sell on the spot** as a drop-in for a worse price. The choice is obvious and the maths rewards the effort. Works fully solo.

## 2. Scope

**In (Slice A):**
- Booked shipment by rail or sea: a forward sale at a price locked when you book, goods delivered by the next service, brass paid on arrival, you never travel with it.
- Drop-in sale: sell from your pack on the spot at the local price minus a penalty.
- The price gradient (booked beats drop-in) as the only anti-cheat.
- Farm-gate booking: originate a shipment from a pen or farm within reach of the line.
- Pending shipments persist across save/load.
- A shallow, slowly-refilling brass purse on each village vendor, so drop-in selling cannot scale into a bulk income route (see §4). This is the minimal local version; full dynamic stock with restock and oversupply price-crashes is SP3.

**Out (later):**
- The monthly fair and shared cross-player stock (Slice B).
- Finite per-vendor stock with restock and dynamic prices that move with supply and demand (SP3); Slice A keeps SP1's static regional prices.
- Floating shipments that take the spot price on arrival rather than a locked price (a later refinement).
- Forward contracts with a specific *player* buyer (later, once Slice B's shared market exists).

## 3. The two ways to sell

**Booked shipment (rail or sea), the best price.**
- Available at a station, at a port (Whitby, Staithes), or anywhere within reach of the rail line (the farm-gate case, see §6).
- You pick goods from your pack and a destination market. The panel shows the price you will get: the destination's export sell-price (SP1's `priceOf(item, destinationVillage, 'sell', standing)`), which is high where the good is scarce. You confirm.
- On confirm: the goods leave your pack immediately and a pending shipment is recorded. You owe nothing and carry nothing.
- The brass lands in your purse when the shipment arrives, after the delivery delay (the time the next service takes to reach the destination). A toast tells you ("Your shipment to Whitby sold for 14s").
- Sea shipments run only between the coastal ports (Whitby and Staithes) on the coble route; rail shipments run the line between any two stations.
- The destination must be a **different** village (you cannot "ship" to where you stand).

**Drop-in (foot, horse, or just standing at a vendor), the worse price.**
- The SP1 till's sell button becomes the drop-in: it sells from your pack, immediately, to the vendor in front of you, at the **local** price (`priceOf(item, currentVillage, 'sell', standing)`) reduced by a drop-in penalty.
- No booking, no delay, no travel. The convenience tier, deliberately the worst rate.

## 4. The price gradient (and why it is the whole anti-cheat)

- Best: a booked shipment to the market where the good is dearest, paid at that market's export sell-price.
- Worst: a drop-in at wherever you are, paid local sell-price minus the penalty.
- Because the high price is only ever reached by booking a shipment that genuinely moves the goods to another market, there is nothing to game. A drop-in is always available but always worse, so no one is forced to ship and no one profits by faking it. This is what replaces the sealed hold and origin stamps we considered earlier.
- Tuning target: a booked run to a strong market should clearly beat a drop-in of the same goods, after the delivery wait, by enough that shipping feels worth the bother. Numbers live in the tuning table (§11).

**Why bulk can't take the lazy route.** A worse per-unit price alone would not stop a player who mines a mountain of coal or jet from simply drop-in-selling the lot. So a village vendor has a shallow brass purse that refills slowly: drop-in selling draws it down, and once it is low the vendor pays a pittance or declines until it recovers. A vendor will take a little off your hands, never a wagonload. Bulk income therefore has nowhere to go but a shipment to a market (or, later, the fair), which has the deep pockets to absorb it. Mining a mountain only pays if you ship it; the drop-in stays small change.

## 5. Booking and delivery

- `economy.bookShipment(goods, destinationVillage)`:
  - Validates: destination is a different village; goods are in the pack; a sensible per-shipment size cap (§11).
  - Computes the locked total: sum of `priceOf(item, destinationVillage, 'sell', standing)` over the goods, at the moment of booking.
  - Removes the goods from the pack; appends a record to the player's `shipments`.
- A shipment record: `{ goods: [[id, n], ...], dest, brass, arrivesAt }` where `arrivesAt` is a game-clock time computed from the route length.
- The economy ticks shipments on the game clock (or on each train arrival at a station): when `now >= arrivesAt`, credit `brass` to the player via `economy.earn`, remove the record, and toast the sale.
- Locked price: the `brass` is fixed at booking, so the market moving in transit does not change what you get. (The floating variant is deferred.)

## 6. Farm-gate

- A player who has set up a pen or farm out of town should not have to cart produce into a village to send it elsewhere.
- Booking is therefore available not only at stations and ports but **anywhere within a set distance of the rail line** (a proximity check against the permanent way in `rails.js`). The fiction: a carter collects from the lineside.
- This covers the wool, leather, meat and livestock a farmer wants to sell. Anything truly off the line waits for the fair (Slice B).

## 7. Per-player village stock

- Village vendors keep SP1's static regional prices and per-player stock (no shared state, no dynamic pricing yet). The one change Slice A makes to in-person trade is the drop-in penalty on selling (§3); buying from a vendor is unchanged from SP1.
- The finite-stock-with-flow-and-dynamic-prices model (selling stocks the vendor, prices move with supply) is SP3. The shared cross-player stock is the fair, Slice B. Slice A does not implement either; it only adds the shipment and drop-in paths on top of SP1's till.

## 8. Architecture & components

- **`src/economy.js`** gains: `bookShipment`, the booked-vs-drop-in price helpers (`shipmentPrice`, `dropInPrice`), the `shipments` list, the clock tick that delivers them, and save/load of pending shipments. No THREE/DOM, still headless-testable.
- **`src/player.js`**: `shipments` persisted in `serialize`/`deserialize` (a pending shipment must survive a save).
- **`src/ui.js`**: a "Ship goods" panel opened at a station, a port, or lineside (pick goods, pick destination, see the locked price, confirm); the existing till sell button now sells at the drop-in price; a small "in transit" readout of pending shipments.
- **train/clock hook** (`main.js` / `rails.js`): deliver shipments when their `arrivesAt` passes, ideally tied to the service actually reaching the destination so it feels like the train brought it.
- No multiplayer in Slice A; it is solo-complete (the destination market is the regional price, no other player needed).

## 9. Data flow

- Book: station/port/lineside UI -> `economy.bookShipment(goods, dest)` -> goods removed, shipment recorded with locked brass + arrival time -> confirmation toast.
- Deliver: clock tick / train arrival -> any shipment past `arrivesAt` -> `economy.earn(brass)` -> record removed -> "sold" toast -> HUD updates.
- Drop-in: till sell -> `economy.dropInPrice(item, currentVillage, standing)` -> remove item, `economy.earn` -> feedback (the SP1 path, now penalised).

## 10. Error handling & edge cases

- Booking to your current village, or with goods you no longer hold: refused with a clear message.
- Save/load mid-transit: pending shipments serialize with their `arrivesAt` on the game clock; on load, any already past due deliver at once.
- Pack full is not a concern (booking removes goods; delivery pays brass, not items).
- A shipment whose destination becomes unreachable (no path): still delivers on the timer (the fiction is the carter got through); we do not strand the player's goods.
- All brass integer pence; the locked total is computed once, at booking.

## 11. Tuning knobs

The drop-in penalty; the per-shipment size cap; the delivery delay per route length; the village vendor's brass purse size and how fast it refills (this sets how much drop-in trade a vendor absorbs before bulk must be shipped); and (carried from SP1) the regional spreads that set how much a good gains by being shipped to the right market.

## 12. Testing

- **Headless (extend `scripts/verify-economy.mjs`):** a booked shipment to a dear market beats a drop-in of the same goods (the gradient holds); the drop-in penalty is applied; booking to the current village is refused; `bookShipment` removes the goods and records the locked brass; a shipment past its arrival time credits exactly that brass and clears; pending shipments survive serialize/deserialize; selling in bulk to one village vendor as drop-ins hits steeply diminishing returns as its purse drains, while shipping the same bulk to a market pays in full (drop-in cannot replace shipping for volume).
- **Live (preview):** book a shipment at a station and confirm the goods leave the pack and the brass arrives after the wait; sell a drop-in and confirm it pays less than the same goods shipped; book from the lineside near a pen (farm-gate).

## 13. Open decisions (defaults chosen, change at review)

a. **Locked price at booking** (not floating on arrival). Confirmed in design; floating is a later refinement.
b. **Delivery delay** approximated from route length, tied to train arrival where practical, so it reads as "the train brought it." Exact timing is a tuning value.
c. **Farm-gate reach** defined as a distance from the rail line; the exact distance is a tuning value, and roads are not required in Slice A.
