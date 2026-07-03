# Tavern pressure/incentive addendum — Workstream D

Addendum to `docs/superpowers/2026-07-03-tavern-handoff.md` and
`docs/superpowers/specs/2026-07-03-npc-movement-chat-night-inn-design.md`
(Workstream D, "The night inn"). This does not reopen any settled decision in
those documents — it adds three small, additive features to sharpen the
push/pull balance the handoff already describes (cold + tiredness = push;
fire, games, wagers, notes = pull).

James's brief: players should be both pressurised (cold/tiredness genuinely
push them indoors) and incentivised (real reasons to choose the tavern over
just toughing it out) — including a way to protect goods from death loss.

## 1. Tavern strongbox

**Ground truth (verified 2026-07-03):** death-safe storage already exists —
the oak strongbox (`src/defs.js:153-156`, `B.STRONGBOX`; craft 6 planks + 1
iron ingot). 27 item slots + a brass bank. Contents survive death because
they are not carried on the player, so `applyDeathPenalty()`
(`src/main.js:3296-3310`, halves brass + material stacks on death in
non-free worlds) never touches them. Persistence is local-only: keyed by
room name in browser localStorage (`src/main.js:1769-1803`,
`netBoxStorageKey`/`persistNetStrongboxes`/`loadNetStrongboxes`); solo
worlds use the save file. Breaking a strongbox spills its contents as
drops — no locks, anyone can open or break one.

**Design:** `innPlan()` places exactly one standard strongbox prop in the
parlour (same item definition, same 27 slots + brass bank, same
local-persistence key scheme — no new storage layer, no relay change). The
only new behaviour is protection: the tavern strongbox sits inside the
inn's indestructible pocket region (handoff §3, "Indestructible, both
shells"), so unlike a home strongbox it cannot be broken and looted by
another player. It is not a bigger or better box than a home strongbox —
it is a break-proof one that requires no crafting and is always reachable
without building anything, which is the actual incentive to route through
the tavern before a risky trip (mining, dark moor, festival bosses):
deposit before you go, collect after.

No new save fields, no new relay message type, no fee. Placement is part
of the deterministic `innPlan()` output like any other furnished prop —
belongs in slice D2 (decor + template variation).

## 2. Bragging board

**Design:** a board prop in the parlour (same nameplate/canvas-texture
technique as the notes board, entities.js `makeNameplate`/`makeBubble`
pattern, ~970) rendering a read-only, computed standings table: most wins
per game (merrils/draughts/dominoes/shove ha'penny), the single biggest
wager won at this inn, and the current season's top player by this inn's
win count. All numbers are derived directly from the existing ledger data
introduced in Workstream C (`src/ledgers.js`) plus the new per-game win
records D4 will add to the same ledger pattern — the board performs no
computation of its own beyond sorting/formatting what the ledgers already
hold. No new persistence: it reads, it does not write.

This feeds `factscard.js` (Workstream B): standings the board shows become
GAME FACTS rows the innkeeper and other NPCs can reference in chat ("tha
beat everyone at merrils this Martinmas"), so gossip about who's winning
stays truthful — the number always comes from the ledger, the LLM only
narrates it. Belongs in slice D3 (parlour life) once D4's win-tracking
ledger fields exist; can ship with placeholder/empty state before D4 lands
and populate once it does.

## 3. Innkeeper as broker

**Design:** the innkeeper NPC's facts-card block (`factscard.js`, B) gains
rows that populate only while the requesting player is physically inside
the inn's pocket region — a presence gate on data that already exists
elsewhere in the game state, not a new subsystem:

- which roster NPCs are currently present in the parlour, and where they
  are next headed (reuses `railtime.js`/A's dep/arr booking data, already
  available on roster state)
- local market intel (whatever price/stock facts B already surfaces
  elsewhere, scoped to this village)
- season/weather-coming (derived from `sky.js` season state, already
  computed each frame)

None of this is new data — it is data the client already has, conditionally
exposed only when `player is inside inn region` is true, which rewards
showing up in person over chatting with the innkeeper from outside (if
that's even reachable) or relying on another NPC's card for the same
facts. Belongs in slice D3, gated on the same location check D3 already
needs for "is player inside this inn" (parlour-crowd routing, opening
hours).

## Non-goals (explicitly out of scope for this addendum)

- No fee/economic sink on the tavern strongbox — it competes with the home
  strongbox on convenience/protection, not as a new brass drain. (A future
  addendum could add an innkeeper-service fee variant if James wants a
  brass sink; not requested here.)
- No relay-side persistence changes for the strongbox or bragging board —
  both reuse existing local/ledger persistence exactly as-is.
- No new save-shape fields anywhere in this addendum (INVARIANTS: additive
  only, avoid save-shape changes).

## Slice mapping

Folds into the handoff's existing slicing (§5.3), no new slices:
- **D2** (decor + template variation): tavern strongbox placement.
- **D3** (parlour life): bragging board render + innkeeper broker rows,
  both gated on the same inside-inn location check D3 already implements.
- **D4** (games): must add per-game win records to `ledgers.js` in a shape
  the bragging board can read — call this out explicitly in the D4 plan
  task list so it isn't missed.
