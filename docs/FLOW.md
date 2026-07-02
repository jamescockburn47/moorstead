# Moorstead — game flow notes (2026-07-02)

An analysis of how a session *feels* minute to minute and week to week, written after
a full technical + playability review and the wave of changes shipped the same day
(contextual nudges, station chip, trade hints, strongbox, Hob arc, evening village
life, Gazette, Tradin' Post, sketchbook, honours roll). Those changes closed most of
the feedback loops; what follows is the next layer — pacing and motivation, not bugs.

## The core insight: the day/night cycle is the game's metronome, but only danger syncs to it

Dusk is the one moment the game grabs the player by the collar (get home / light a
torch). Nothing else in the day has a beat. Villagers now have a daily rhythm
(work → green at midday → doorstep at dusk → abed); the player has none. The single
highest-leverage flow change is to give the PLAYER's day the same shape:

1. **The dawn beat.** On each new day, one bundled toast: day number, one market fact
   ("wool's dear in Whitby"), the next train, and one live hook (a new board job, a
   Gazette issue, the hob wanting its cream). All of that state already exists —
   economy spreads, timetable, quest offers. One toast, four reasons to form a plan.
   The plan is the flow: a player who wakes with an intention is *playing*; one who
   wakes into silence is wandering.
2. **Midday as the social hour.** Villagers already gather on the green at midday
   ('social' phase). Make it worth attending: trades slightly keener on the green at
   midday, gossip clues only dropped there, board jobs refreshed at noon. The player
   learns the village breathes, and schedules around it.
3. **Dusk as the deadline.** Already strong. The find-shelter key and strongbox give
   it counterplay now. Leave it be.
4. **Night as the reward window, not just the threat.** The Hob offering, the Dracula
   arc, the barghest honour are all night-gated — night is already where the *story*
   lives. Add a "lantern route": a chain of lit waymarks between Moorstead and one
   neighbouring village, so night travel is a learnable skill with a visible safe
   path. Risk becomes a choice instead of a lottery, which is what makes kids brave.

## Session punctuation: give a sitting a beginning and an end

Kids play 20–60 minute sittings. The game has a strong opening beat (title flyover →
spawn) and no closing one. When the player sleeps or quits: an **end-of-day card** —
brass earned, blocks won, folk spoken to, quest steps done, one forward hook
("tomorrow: t' 9 o'clock to Whitby, an' Glinda's expecting thee"). The counters
exist (activity digest, economy ledger, quest state). Closure + a reason to return
is the whole retention loop in one screen, and it costs a panel.

## Travel is dead air between the good bits

Real-scale moors mean minutes of holding W. The railway is the designed answer, and
the station chip now makes it legible. Two gaps:
- **Route suggestion:** when a quest target is >400m away and a rail leg would cover
  most of it, the tracker should say so ("t' train frae Goathland gets thee nigh
  there"). Pathing already knows stations and distances.
- **Walking needs micro-content:** forage glints, waymark lore lines, one-line
  folklore encounters on the long lonnins. The moor should *mutter* occasionally.
  (The roster's travelling NPCs already cross paths with you — a passing "how do" from
  a rider was shipped in the hail system; extend to a rare shared-road event: a
  drover who'll pay for a hand, a pedlar with an odd item.)

## The mid-game project ladder is invisible

First hour (now): log → planks → bench → board → first arcs. Strong. The designed
mid-game is farming (pen 5 → register farm → drove to market — the best brass in the
game) and the deep-mine licence, but nothing points at either unless you stumble in.
One steer each: after the first arc completes, James mentions the living to be made
droving; after the first iron tool, the lad mentions the deep seams want a licence.
Two lines of dialogue turn hidden systems into a visible ladder:
**tools → farm → drove → licence → deep mine → jet/iron trade → honours.**

## Make reputation a spectacle, not a number

Standing now toasts its changes, and the Roll of Honour lists titles. The next step
is making OTHER people see it: the Gazette should print honours ("a rambler now
styled *Friend o' t' Hob* has done t' dale a service") — titles are pseudonymous so
it's privacy-safe, and being *in the paper* is exactly the reward an 8-year-old
plays another week for. Server-side: the brain needs a small honours feed; client
POSTs title-earned events (no names, just title + village) to a brain endpoint the
gazette generator reads.

## Small frictions worth sanding (each ≤1h)

- **Batch crafting** — if crafting is click-per-item, add shift-click ×5 (check ui.js).
- **Mood surfacing** — mobs carry `mood`; a word in the chat header ("Mary's chuffed /
  mardy today") makes the brain's state legible and chats feel alive.
- **Clue journal** — folk drop riddle clues (arc `clues`); kids forget them. A "heard
  tell" tab in the quest journal that records clue lines when spoken.
- **Weather foreshadowing** — storms gate the Dracula boss; a shepherd's "red sky"
  line the evening before a storm makes weather a plan-around, and it's period-true.

## What NOT to do

- Don't add minimaps-of-everything or fast travel: the scale and the walk-vs-train
  decision IS the game's texture. Make travel legible, not free.
- Don't gamify the villagers (daily-quest icons over heads). The brain's naturalism
  is the moat; keep discovery conversational.
- Don't punctuate with modal popups. Every beat above is a toast, a panel you open
  yourself, or a line of NPC dialogue. The moor stays quiet; that's its character.

## Suggested order

1. Dawn beat (small; all data exists)
2. End-of-day card (small-medium)
3. Mid-game steers — two dialogue lines + two one-shot toasts (small)
4. Gazette honours feed (medium; touches brain + client)
5. Route suggestion in tracker (small-medium)
6. Lantern route (medium; worldgen)
7. Clue journal, mood surfacing, batch craft, weather line (each small)
