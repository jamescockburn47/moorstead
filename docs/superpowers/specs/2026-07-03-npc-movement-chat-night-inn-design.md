# NPC movement, chat necessity, and the night inn — design

Date: 2026-07-03. Status: approved direction (James), spec for implementation planning.

## Problems this solves

1. **Station loitering.** The brain has no concept of train times (rail = 60s x legs of
   wall-clock in `act.py`/`world.py`), while the client runs a real deterministic
   timetable (~33 min round trip, `trainSchedule()` in `src/main.js`). The client papers
   over the gap with a ride state machine (`src/roster.js` `_driveRail`): only the top 2
   NPCs by `idHash` rank board per train call (`PLATFORM_CAP=2`), ranks 3+ potter through
   the whole cycle, hit the 720s ride timeout, resync, and the brain re-sends the same
   journey. Result: permanent visible loitering around stations.
2. **Chat is optional flavour.** No loop requires conversation: quests come off the
   notice board, trades are buttons, hints are passive. NPC "memory" is LLM-extracted
   (regex name capture, unvalidated trade facts, summary every 3 exchanges,
   per-character reputation shared across players, no forgetting) so it drifts from
   truth and instructs nothing.
3. **Crowding / all-speak-at-once.** `nosyToken` (`src/entities.js:2889`) gates the
   *approach*, not the *speech*: it releases the instant an NPC speaks, the next claims
   it the same frame, 8s bubbles overlap, nothing suppresses approaches while a chat
   window is open, and the random trigger baseline is 16%.
4. **No night loop.** Nights empty the world with nothing to do; the existing shared-world
   sleep mechanic (relay `sleepers`) needs every player simultaneously, which never
   happens organically. The inn redesign below gives sleep a quorum instead.

## Load-bearing invariant: LLM narrates, ledgers decide

Every mechanic below is a deterministic game system whose facts live in
game-authoritative ledgers and whose gates are checked in code. The local model
(llama3.2:3b today) only renders facts into dialect prose. Two hard rules:

- **The model is never the sole carrier of a number.** When a villager quotes a train
  time or a price, the authoritative value also lands as a chip / tracker / system line;
  the prose is colour.
- **Transactions are confirmed by the UI**, as system lines in the chat log
  ("Commission agreed: steel scythe, 12 brass, ready Thursday"), never by parsing model
  output.

This makes the design model-agnostic: a later fine-tune or 7–8B swap improves flavour,
never correctness.

## Workstream A — timetable as shared truth

The client timetable is already deterministic from `Date.now()`. Make the brain compute
the identical schedule and plan journeys against it.

- **Shared timetable module.** Port the timetable maths (station order per line, leg
  times, `DWELL_T=30`, epoch anchor, pingpong cycle) to a small Python module on the EVO
  (`brain/timetable.py`). New verify script `verify-timetable-parity` asserts client and
  brain agree on the next N train calls per line to the second (client maths re-run
  under Node vs a fixture generated from the Python module, or both re-implemented from
  the same published constants — implementation plan decides; parity is the contract).
- **Journey booking (brain).** When an NPC travels by rail, the brain books a specific
  train call: state becomes `{kind:'rail', line, fromStn, toStn, dep, arr}` where `dep`
  is the next call at the origin that allows walk-to-platform time and `arr` comes from
  the timetable. Until `dep - lead`, the NPC stays `at` (working) or walks to the
  station timed to arrive 60–90s before `dep`.
- **Seat ledger: 16 per train call.** The brain caps bookings per (line, direction,
  call) at 16. Nobody is ever dispatched to a train they cannot board; the client
  rank-starvation loop is retired.
- **Client ride machine simplification (`src/roster.js`).** Keyed to `dep`/`arr`: walk
  in just before `dep`, board on dwell, ride, disembark, walk into town, resume brain
  state. Remove `PLATFORM_CAP`, `waiterRank`, `waitMode`. Keep the stuck-ride timeout as
  a safety net. Old clients ignore the extra `dep`/`arr` fields (additive protocol,
  INVARIANTS rule 3).
- **16 seats visually.** Extend the coach slot maths from 8 slots to two coaches' worth
  (16), same chainage-offset scheme.
- **Day cycle in the brain.** The brain derives day phase from the same deterministic
  clock (same formula as client `dayPhase`). No departures at night; errands weighted
  morning-out / afternoon-home, replacing the flat 30-minute churn; at night NPCs route
  indoors (parlour for inn villages — see D).

## Workstream B — chat as the information economy

Every fact in chat is true, sourced from game state via the existing `context`
parameter, kept short and structured (respect the 2800-char cap — small models fumble
long context).

- **Train intel.** NPCs quote real next departures (from A). The station chip / tracker
  stops showing times the player hasn't learned; asking a porter or local is the natural
  way in. Once told, the chip carries the authoritative time.
- **Market intel.** "Wool's dear in Whitby" drawn truthfully from `src/economy.js`
  `SPREAD` tables; chat becomes how you learn where to sell.
- **Directions and leads.** Quest clues stay conversation-only; the tracker says "ask
  the parson at Goathland" rather than dropping a marker; the good jobs (folklore,
  well-paying) are offered only in conversation — the notice board keeps the dull ones.
- **The facts card (game-authoritative memory).** The client supplies a compact,
  auditable per-player card on every talk call: name, standing, honours, taught skills,
  open commissions, promises (kept/broken), vouches, trade summary. All NPCs read the
  same card, so they are consistent with each other and with reality. LLM-side memory
  (summary, recent turns) is demoted to conversational colour.
- **Brain memory hygiene.** Validate gift/trade items against the item list; timestamp
  facts; per-player (not shared per-character) reputation; name-capture validation
  (length cap, sane pattern); staleness decay; summary prompt told to prefer the facts
  card over its own beliefs on any conflict.

## Workstream C — the necessity spine: "nobody sells owt of consequence to a stranger"

Standing/trust (already tracked) starts gating real things. Five verbs so chat never
feels like one repeated toll-gate:

1. **Taught knowledge.** Top-tier recipes/skills are not discoverable; they are taught
   in conversation by the person whose trade it is (smith → steel tempering, fisherwife
   → smoking fish, parson → reading old inscriptions which unlocks folklore clues).
   Untaught recipes are absent from the crafting list. Ledger: per-player taught list.
2. **Commissions.** Top-tier goods are never in stock; the player asks the craftsman to
   make one, agrees price and pickup ("come back on t' Thursday train" — a real
   timetable time from A). Ledger: commission entries (item, price, ready-at, state).
3. **Vouching.** One or two big purchases (land deeds / farm registration, market
   stall, a pony of your own) require a named villager with sufficient trust to vouch.
   Ledger: voucher records.
4. **Promises/contracts.** Delivery deals negotiated in chat ("20 fleeces by Friday's
   train, above market"). Kept/broken outcomes are game-recorded and feed standing,
   prices, and vouching willingness. Ledger: promise records.
5. **Play (see D).** Games at the inn build trust with the NPC you play.

Bairns/free worlds relax thresholds sharply: the first friendly conversation in a
village unlocks that village's basics.

## Workstream D — the night inn

### Threshold: pocket interior

- The inn interior is a **pocket built in the existing voxel world**, in a reserved
  region deep underground beneath the village (no sky/weather/fog to suppress;
  enclosure free). The front door is a threshold interaction: fade to black, latch-click
  + hearth-crackle, teleport down, fade in. Outside: a handsome but modest stone
  building. Inside: a ~21x13 parlour with a high beamed ceiling — genuinely bigger on
  the inside.
- Physics, collision, save/reload position, footprints suppression and — critically —
  **multiplayer come free** (players in the parlour are just players at world
  coordinates; relay `pos` unchanged). NPC night routing (A) resolves to parlour
  coordinates, so the roster visibly files in at dusk.
- Every other building stays plain and cramped, deliberately: the contrast is what
  makes the inn door read as a game threshold.
- Rollout: flagship first — **The Station Tavern, Grosmont** (the village's genuine
  pub, apt for the junction village; there is no Moorstead village in the 1900s world).
  Then a per-village template with seeded variation (layout, hearth position, which
  game tables), each inn named (real pub names where they exist, period-plausible
  otherwise).
- **Opening hours:** the inn opens after lunch (~13:00 game time) and stays open
  through the night; mornings it is shut (door interaction says so, in voice).
- **Player notes.** Players can leave short written notes for each other at the inn
  (a board by the door or notes on tables): per-inn, persisted via the relay
  (additive message type alongside `game`, or the stalls-style persistence — the
  implementation plan decides), readable by any player in that world. Period framing:
  pinned paper notes, pencil.

### Indestructible

The inn must be impossible to destroy or mine into, in both shells:

- Exterior footprint + a guard margin, and the entire interior pocket region, are
  **edit-protected**: `world.setBlock` refuses player edits there (place and break),
  and incoming relay `edit` messages targeting the region are ignored client-side.
  Deterministic region definition from worldgen so all clients agree.
- Verify script `verify-inn-protection` asserts: edits inside both regions are refused;
  edits just outside succeed; region derivation is deterministic per seed.

### Interior: genuinely nice

- Voxel shell + procedural prop dressing in the `src/festivalKit.js` style (no asset
  files; procedural-only identity holds): flagstone floor, oak settles and long tables,
  dark panelling, pewter on the mantel, beams, an inglenook hearth driven by
  `src/fire.js`, oil lamps and candles (period-correct) as warm point lights with a
  Plain-mode fallback per INVARIANTS.
- **People around, talking.** At night the parlour holds the village roster: ambient
  murmur handled under workstream E rules (quieter cadence indoors, one audible bark at
  a time near the player, background hum otherwise), NPC-to-NPC talk rendered as
  gesture + occasional short bubbles, table talk from seated NPCs.
- **Folk music — faint, and genuine.** Melodies are real, public-domain period
  Yorkshire folk tunes researched online and transcribed to note data (candidates: On
  Ilkla Moor Baht 'at, Scarborough Fair, the Lyke Wake Dirge — a North York Moors
  piece — Elsie Marley, The Dalesman's Litany; final tune list confirmed against
  sources during implementation). Rendered through the proven struck/plucked
  procedural voices (music box / bells / FM pluck, NOT brass/choir — the prior
  synth-music failure is documented), exactly as the carols pipeline renders real
  MIDI. Mixed **faint** — under the crackle and murmur, felt more than heard. **Hard
  gate: James listens and approves before integration** (same listen-gate as carols).

### Games

- First cut: **merrils** (Nine Men's Morris — the authentic Yorkshire name), **draughts**,
  **dominoes**, **shove ha'penny**.
- Tables are interactive props: approach + interact → camera glides to an over-the-board
  view (same camera-takeover pattern as the train ride view), cursor picks
  points/squares, ESC stands up.
- Rules engines are pure functions with verify scripts (`verify-merrils`,
  `verify-draughts`, `verify-dominoes`; shove ha'penny is physics-flavoured, verified
  for scoring maths).
- **PvP over the relay**: one new additive message type `game` (table id, move,
  seq). Turn-based, tiny messages, no timing sensitivity; unknown-type fallthrough
  preserved for old clients.
- **Vs NPC**: deterministic minimax opponents (difficulty per NPC persona); the brain
  supplies table talk between moves — banter can't be wrong, ideal 3B duty.
- **Stakes**: small brass wagers vs NPCs and players — bairns included (wagering is
  part of the fun; stakes are inherently small). Winning/playing builds trust with
  that NPC (feeds C).

### Cold: the honest push indoors

- A chill meter driven by `src/temperature.js`: outside after dark it climbs (faster in
  winter/wind/wet). As it rises: movement and tool swings slow, breath fogs, subtle
  frost vignette. **No health damage — misery, not death.**
- The parlour fire clears chill fast and grants a "warmed through" buff into the
  morning. Any interior + fire helps; the inn is best.
- Bairns/free worlds get a much gentler chill curve.

### Tiredness: the honest push toward sleep

A fatigue meter alongside chill, pushing the player toward shelter and bed on its own
terms rather than waiting for the midnight quorum:

- Fatigue climbs with time spent awake (a slow background rise) and faster with
  exertion (mining, fighting, hauling, running). It resets on sleeping.
- As it rises: vision blurs softly at the edges, footstep pace flags, an occasional
  yawn animation/sound, and — high enough — camera sway. **No damage, no forced
  collapse, no blackout: misery and clumsiness, not incapacitation.**
- Resolution is any of: sleeping (quorum sleep, below), sitting a while by a hearth
  (partial relief, no full reset — a doze, not a night's rest), or simply time (fatigue
  caps rather than compounds forever, so it's a nudge, not a punishing clock).
- **Feeds quorum sleep directly**: a tired player is the one who most wants the
  suggestion to fire, and heading indoors for warmth (cold) and rest (fatigue)
  together are why players cluster at the inn well before midnight, not just at it.
- Bairns/free worlds: fatigue rises much slower, or is cosmetic-only (yawns, no blur) —
  tuned alongside the chill relaxation.

### Quorum sleep

The shared-world sleep mechanic returns, anchored on the inns:

- **After midnight**, if **more than 50% of online players** in the world are inside
  an inn, a sleep suggestion fires world-wide (uses the existing relay
  `sleepers`/`wake` plumbing plus a quorum check — relay-side count, additive).
- The remaining players go on a visible **shelter timer** (a few minutes, tuned in
  implementation): reach an inn — or their own home — before it runs out.
- When the timer expires (or everyone is sheltered), **all players sleep** and the
  night skips to morning.
- Players caught outside are **not killed**: they wake where they were, hungry and
  cold (chill high, hunger drained) — a rough night on the moor, nothing worse.
- Single-player keeps the classic sleep (quorum of one).

## Workstream E — conversation etiquette

- One **speech** token (not approach token): held until the bubble fades plus a 10–15s
  global quiet period. NPCs who would have spoken **wave or nod instead** (silent
  gesture).
- Personal space: approachers stop at ~3 blocks on an arc; no approach while another
  NPC is engaged or the player's chat window is open.
- Random baseline trigger cut sharply (16% → ~4%); build-triggered curiosity kept.

## Protocol, save, and invariants impact

- Relay: new message types `game` (table moves) and inn notes (or stalls-style
  persistence), plus a quorum-sleep extension to the existing `sleepers` flow; all
  other changes ride existing types or the brain HTTP API. Additive; unknown types
  fall through (INVARIANTS rule 3).
- Roster state: `rail` gains `dep`/`arr`; old clients ignore them.
- Save: new per-player fields (taught list, commissions, promises, vouches, chill,
  fatigue). Additive save-version bump with forward-refuse per INVARIANTS.
- No `minClientVersion` bump required for any of this.

## Verify scripts (new)

`verify-timetable-parity`, `verify-seats` (booking cap 16, no starved traveller),
`verify-facts-card` (card shape + truth vs game state), `verify-necessity`
(taught/commission/vouch/promise ledger gates), `verify-inn-protection`,
`verify-inn-interior` (pocket geometry, threshold round-trip, Plain fallback),
`verify-merrils` / `verify-draughts` / `verify-dominoes`, `verify-chill`,
`verify-fatigue` (rise/exertion/decay curve, bairns relaxation, no forced collapse),
`verify-quorum-sleep` (50% trigger, shelter timer, caught-out wake state),
`verify-inn-notes` (persistence round-trip shape),
`verify-etiquette` (speech token exclusivity, suppression while chatting).

## Sequencing

1. **E — etiquette** (half-day, pure client, zero protocol risk). Ship first.
2. **A — timetable truth** (brain + client + parity verify). Kills the loitering.
3. **B + C — facts card, information economy, necessity ledgers** (client context work
   + brain hygiene; ledger gates client-side).
4. **D — the inn** (biggest: pocket builder, protection, decor, games, chill, notes,
   quorum sleep, PvP relay type). Flagship: The Station Tavern, Grosmont; music last,
   behind the listen-gate.

## Risks

- **3B model misquoting supplied facts** — mitigated by chip-echo of all numbers and
  short structured context; residual risk is cosmetic.
- **Pocket-region collisions** with mining/caves — region is reserved at worldgen,
  protection guard refuses edits; verify script covers derivation determinism.
- **Music** — history of failure; gated on James's ear before integration, and the inn
  ships silent-but-crackling if the tunes aren't right yet.
- **Kids' worlds** — necessity thresholds and the chill curve have explicit bairns
  relaxations named in their ledger/config; wagers stay enabled everywhere.
- **Quorum sleep griefing** — a majority parking in the inn could force-sleep the
  minority repeatedly; mitigated by once-per-night firing and the harmless caught-out
  outcome.
