# Workstream D4 — Pub Games: Engines, Table Play, Wagers, Bragging Board

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** All four pub games playable against a villager at the parlour tables —
sit down (camera takes the over-the-board view, ESC stands up), play through a
clean board panel, wager small brass (bairns included — never gated in free
worlds), wins recorded in a new additive `player.gameRecord` ledger that feeds
the bragging board and the facts card.

**Deviation from the handoff, flagged for James:** the handoff's "cursor picks
points/squares" implied 3D picking on a modelled board. The codebase has ZERO
free-cursor 3D picking precedent — every interactive surface is a DOM overlay
panel (openBoard, ui.js:1239-1515). D4 v1 honours the camera-takeover half
faithfully (sit down → camera over the table, ride-view pattern, ESC stands up)
and renders the BOARD as a DOM panel in the established house style. A modelled
3D board with cursor picking is a later polish slice alongside the seated NPC
mesh pose. PvP over the relay is ALSO deferred to its own slice (needs an EVO
relay change; the additive `game` message design is noted in the probe, nothing
blocks it later).

**Engines (already building in parallel):** `src/games/{merrils,draughts,
dominoes,shoveha}.js` per `src/games/ENGINE-CONTRACT.md` (pure, deterministic,
JSON-serialisable state/moves, seeded `bestMove(state, level, seed)`), each with
its own verify script. This plan's tasks assume they exist and are reviewed.

**Ground truth annex:** D4 probe (2026-07-04, this session). Key anchors:
ride camera `startRideView`/`updateRide` main.js:3990-4068; state gates listed
exhaustively (ESC 1246-1251, update 5150-5151, pointer lock 1280/1294/5461 —
a new `'gaming'` state must be added at each); interact dispatch main.js:4479-
4514; DOM panel pattern ui.js:594-595 (screens), 1040-1047 (show), 1239-1515
(openBoard structure + closeScreens/ESC); chat buttons ui.js:1104-1233
(renderChatActions — Teach/Commission/Vouch button gating + dispatch idiom);
brass `economy.spend(pence)`/`economy.earn(pence)` economy.js:322-331 (NEVER
poke player.brass directly for the wager flow); ledger additive-fields pattern
player.js:56-61/449-452/491-494; villager `role` (villagerlife.js:11-30 +
roster data) as the minimax difficulty knob (child/gossip→1, pedlar/rambler→2,
trades/constable/railway→3); factscard.js:22 row-injection point; table world
coords via the parlour local→world idiom (parlour.js:68-71); NO existing
minimax (engines own it); seeded-RNG discipline = mulberry32, never
Math.random in game-outcome logic.

---

## Task A: `gameRecord` ledger + wager flow (pure logic first)

**Files:** modify `src/player.js`, `src/ledgers.js`; test: extend
`scripts/verify-necessity.mjs`? NO — new `scripts/verify-gamerecord.mjs`
(keep concerns separate).

- `player.js`: `this.gameRecord = {}` — per-game map
  `{ merrils: {w:0,l:0,d:0}, ... }` lazily keyed + `biggestWin: 0` at top level
  → follow the EXACT additive serialize/deserialize pattern (constructor ~61,
  serialize ~452, deserialize ~494). Shape:
  `{ games: { [gameId]: {w,l,d} }, biggestWin: 0 }`.
- `src/ledgers.js`: add pure helpers `recordGameResult(gameRecord, gameId,
  result /*'w'|'l'|'d'*/, wagerWon)` (mutates-and-returns the record, clamps,
  updates biggestWin) and `gameStatsRows(gameRecord)` → facts-card sentence
  rows ("At t' tables they've won 3 an' lost 1 at merrils."; "Biggest wager
  won: 8d."). Use economy.format? — ledgers.js purity: take a preformatted
  string or format pence inline simply ("8d" style — read how factscard rows
  format brass elsewhere; keep consistent).
- Wager rules (pure, in ledgers.js): `wagerAllowed(brass, wager)` (wager > 0,
  integer pence, ≤ brass, ≤ WAGER_MAX = 12 /*small stakes — a shilling*/);
  NEVER gated on freeWorld (James: bairns wager too).
- verify-gamerecord.mjs: additive save round-trip (serialize→deserialize
  preserves), recordGameResult accumulation + biggestWin, gameStatsRows
  wording, wagerAllowed bounds.

## Task B: the game session — state machine + camera + panel

**Files:** create `src/gameTable.js` (session controller — pure-ish state,
driving both camera intent and panel data); modify `src/main.js`, `src/ui.js`,
`src/defs.js`? NO new block — table lookup by coords (probe §9 approach 2:
a `tableAt(x,z)` helper over `world.gen.inns`, living in gameTable.js).
Test: `scripts/verify-gametable.mjs`.

- **Interact:** in main.js's interact dispatch (before B.SIGNPOST), if the hit
  block is a parlour table cell (`tableAt(hit.x, hit.z)` — match world coords
  against every inn's 4 table cells at floorY+1, must ALSO be
  `playerInParlour`): open the challenge flow.
- **Challenge flow:** pick the opponent: prefer a parloured mob at THIS table's
  bench (roster mobs carry `_parlourIdx` — index maps 1:1 to tables), else any
  parloured mob in this inn, else a named "passing local" fallback (no mob —
  still playable; the brain isn't involved). Wager prompt: a small DOM row in
  the game panel (stepper 0..WAGER_MAX, default 2d; 0 = friendly game).
  Spend the wager via `economy.spend` at game start; `economy.earn(wager*2)`
  on win; nothing back on loss; wager returned on draw. Toast each outcome.
- **State machine:** new `this.state = 'gaming'` — additions at EVERY gate the
  probe listed: ESC handler (stand up = end session, resign if mid-game after
  a confirm-free forfeit toast — keep simple: ESC mid-game forfeits the wager,
  the panel says so up front), update-loop branch (camera hold), pointer-lock
  gates (unlocked while gaming), save/pause interactions (read each listed
  line and handle deliberately; document each in the commit).
- **Camera:** on sit-down, snapshot player pos/yaw/pitch; take the ride-view
  idiom (updateRide's per-frame override) to hold a fixed over-the-board pose:
  eye ~1.6 above the table cell, pitch -0.9, yaw facing across the table
  toward the opponent's bench. Restore the snapshot on stand-up. (The player
  never moves — no teleport, no physics fight: hold pos each frame like the
  ride does.)
- **Panel (ui.js):** `gameScreen`/`gamePanel` following boardScreen exactly
  (constructor, show() list, closeScreens teardown). `openGameTable(session)`
  renders: title ("Merrils — versus Jabez Trattles — wager 2d"), a BOARD
  rendered from engine state (text/unicode grid in a `<pre>`-ish monospace div
  — merrils points as ○●·, draughts 8×8 with ⛀⛂, dominoes hands as tiles
  [6|4], shove beds as bars), and the LEGAL MOVES as buttons (from
  `legalMoves(state)` — for merrils/draughts group by from-point with a
  two-step pick UX if the list is long: first click a piece button, then a
  destination button; dominoes/shoveha are flat lists). NPC replies via
  `bestMove(state, level, seed)` after a short delay (500ms setTimeout) with
  the level from the opponent's role (probe §6 table) and seed =
  `strSeed(npcId) ^ world seed ^ session counter`.
- **Session end:** winner/draw → `recordGameResult`, brass settle, toast,
  panel shows the result + a "Sit back" (rematch, new wager prompt) and
  "Stand up" button; facts-card trust: chatting after a game — add the
  result into the villager chat context is D-later (LLM narration of games is
  3B's "banter can't be wrong" duty — defer, note it).
- `verify-gametable.mjs` (headless): tableAt finds all 4 tables of the real
  Gen(12345) Grosmont plan and rejects non-table cells; session reducer logic
  (start→moves→forfeit/win paths as pure functions if you structure
  gameTable.js's session as a reducer — DO structure it that way:
  `newSession(gameId, opts)`, `sessionMove(session, move)`,
  `sessionForfeit(session)` pure over engine calls, with main.js/ui.js only
  driving IO); wager settle arithmetic; NPC-move determinism.

## Task C: bragging board + facts rows + wiring

**Files:** modify `src/innDecor.js` (board plane), `src/quests.js` (facts),
`src/factscard.js` (row loop), `package.json` (verify chain: gamerecord,
gametable, merrils, draughts, dominoes, shoveha), `docs/ARCHITECTURE.md`.

- **Board render:** a second canvas plane (the sign technique, innDecor.js
  makeSignTexture pattern) on the parlour wall above the servery: 4 lines,
  "TAVERN GAMES" + the player's own record from `gameStatsRows` (the
  local player's — per-room standings need relay persistence, deferred with
  PvP; say so in a comment). Rebuild key includes a gameRecord revision
  counter bumped on recordGameResult (cheap: `player._gameRecRev = (…||0)+1`).
- **Facts:** `gameStatsRows(player.gameRecord)` wired into chatContext's
  card fields (like innkeeperRows — the villager can brag/console honestly).
- Full gate green; ARCHITECTURE.md rows for games/, gameTable, board.

## Task D (controller): reviews, proof pass, merge, deploy

Engine reviews (one reviewer over all four vs the contract), integration
review, in-browser proof (sit at each of the 4 Grosmont tables, play a few
moves of each, forfeit one to check wager loss, win one vs level-1 if
feasible — else verify the flow to first NPC reply, ESC restore, record/board
update), merge, deploy.

## Non-goals
PvP relay `game` type (own slice, EVO change); 3D modelled boards + cursor
picking (polish slice); LLM table-talk between moves (needs brain wiring —
deferred with a note in FLOW.md); per-room shared standings (needs relay
persistence — deferred with PvP); seated player/NPC mesh poses.
