# Workstream D — The Station Tavern: full handoff brief for a fresh agent

You are building the last workstream of the NPC program: **the night inn**. This
document is self-contained — read it, then the spec section it points to, then follow
the process it prescribes. Do not re-litigate settled decisions; James approved all of
them explicitly.

## 0. Mission in one paragraph

Every town gets an inn from ONE parameterised builder — outside, a handsome but modest
stone building with its **name painted above the door**; inside (a pocket interior,
bigger than the shell — a genuine game threshold), a warm parlour with a real fire,
the village roster talking of an evening, and game tables you walk up to and play.
Cold and tiredness honestly push players indoors at night; after midnight a quorum of
players in inns triggers the shared-world sleep. Flagship: **The Station Tavern,
Grosmont** (there is NO Moorstead village in the 1900s world). Visuals are the point —
James: "visuals are key."

## 1. Authoritative sources (read in this order)

1. **The spec** — `docs/superpowers/specs/2026-07-03-npc-movement-chat-night-inn-design.md`,
   Workstream D section ("The night inn") **including** "One builder, many inns",
   "Indestructible", "Interior: genuinely nice", "Games", "Cold", "Tiredness",
   "Quorum sleep", plus "Protocol, save, and invariants impact", "Verify scripts",
   and the Risks list. The spec is the contract; this brief adds ground truth and
   process.
2. **CLAUDE.md** (repo root) + `docs/ARCHITECTURE.md` + `docs/INVARIANTS.md` +
   `docs/ADDING-A-FEATURE.md` — house rules. The 9 invariants are load-bearing.
3. **Exemplar plans from the shipped workstreams** (follow their style exactly —
   bite-sized TDD tasks, exact anchors, no placeholders, verify scripts per feature):
   `docs/superpowers/plans/2026-07-03-npc-etiquette.md`,
   `2026-07-03-timetable-truth.md`, `2026-07-03-facts-card.md`,
   `2026-07-03-necessity-spine.md`.

## 2. Program state (what's already live — build on it, don't rebuild it)

Shipped to production 2026-07-03, versions v1.1.32→v1.1.35:
- **E — etiquette**: one ambient NPC voice at a time near the player
  (`entities.speakAmbient` + global quiet period; `canNosy` etc. in villagerlife.js).
  Parlour murmur MUST route through this gate.
- **A — timetable truth**: `src/railtime.js` = pure schedule algebra; the EVO brain
  books NPCs onto real 16-seat train calls (`dep`/`arr` in roster state); client ride
  machine is dep-aware. The deterministic timetable is available for anything
  time-of-day flavoured ("last train's gone" talk).
- **B — facts card**: `src/factscard.js` — every villager chat leads with a
  game-authoritative GAME FACTS block (name, standing, honours, true train times,
  true market intel, ledgers). Anything the inn adds that NPCs should KNOW
  (game scores, wagers won, notes left) goes through card rows — never LLM memory.
- **C — necessity spine**: `src/ledgers.js` + player ledgers `taught`, `commissions`,
  `vouches`, `promiseLog`; chat action buttons (Teach/Commission/Collect/Vouch) in
  `ui.renderChatActions` — the proven pattern for the inn's interactions (rent a
  table, place a wager, leave a note). Trust from playing games feeds `v.tier` and
  standing exactly as gifts do.

**The one invariant over everything: LLM narrates, ledgers decide.** Game rules,
scores, wagers, sleep, warmth — all deterministic client/relay systems; the brain
only ever narrates from facts it is handed. The model is never the sole carrier of a
number.

## 3. Settled design decisions (James's explicit calls — do not reopen)

- **Pocket interior, not a separate scene**: the parlour is built from real voxels in
  a reserved region ~40 blocks under the village; the inn door is a threshold
  (fade to black, latch-click + hearth-crackle, teleport, fade in). Physics,
  multiplayer `pos`, saves all work unchanged for free. All other village buildings
  stay plain and cramped — the contrast IS the design.
- **One builder, many inns**: `innPlan(villageName, seed)` → deterministic plan
  (parlour dims within bounds, hearth position, snug/settle arrangement, which game
  tables where, beam rhythm, window/door positions, palette pick, exterior footprint).
  Replicating to a new town must be a data row, not code.
- **Name on the front wall**: painted sign board above the door (procedural
  canvas-texture lettering — the established nameplate/bubble technique in
  entities.js `makeNameplate`/`makeBubble`) PLUS a hanging bracket sign. Names:
  genuine c.1900 village pubs where they existed — **Station Tavern (Grosmont,
  flagship)**; candidates to confirm during implementation: Board Inn (Lealholm),
  Duke of Wellington (Danby), Birch Hall Inn (Beck Hole), White Swan (Pickering),
  Postgate (Egton) — seeded period-plausible generator otherwise ("The Black Bull" /
  "Plough" / "Fleece" school), never two identical names on the moor.
- **Seasonal dressing hooks**: the plan exposes mount points (mantel, beams, door,
  windows, tables) dressed per season by the EXISTING seasonal/festival machinery —
  reuse the `src/festivalKit.js` prop pattern and `src/seasonalLayer.js`, don't
  duplicate. Winter: holly/ivy/extra candles, taller hearth fire, snow on sills,
  Christmas wreath. Spring: May garlands, blossom jars. Harvest: sheaves, corn
  dollies. Summer: moor wildflowers. Exterior warm window glow after dark.
- **Indestructible, both shells**: exterior footprint + margin AND the whole pocket
  region refuse player edits (place AND break) in `world.setBlock`, and incoming
  relay `edit` messages targeting the regions are ignored client-side. Region
  derivation deterministic from worldgen so all clients agree.
- **Games, first cut**: merrils (Nine Men's Morris — the authentic Yorkshire name,
  flagship game), draughts, dominoes, shove ha'penny. Tables are interactive props:
  approach + interact → **camera takeover to an over-the-board view** (same pattern
  as the train-ride view in main.js), cursor picks points/squares, ESC stands up.
  Rules engines = pure modules with verify scripts. Vs NPC: deterministic minimax
  (difficulty per persona), brain supplies table talk between moves (banter can't be
  wrong — ideal 3B duty). PvP: ONE new additive relay message type `game`
  (table id, move, seq) — turn-based, tiny, unknown-type fallthrough preserved.
- **Wagers: small brass stakes, and BAIRNS WAGER TOO** (James: "the bairns should be
  able to wager" — do NOT gate wagers in free worlds). Playing/winning builds trust
  with that NPC (feeds the C ledgers).
- **Player notes**: pinned paper notes at the inn (board by the door), per-inn,
  persisted via the relay (additive message type or stalls-style persistence — relay
  already persists stalls; study that), readable by any player in the world.
- **Opening hours**: opens after lunch (~13:00 game time, i.e. sky.time ≈ 0.54),
  shut mornings — the door interaction says so in voice. Open through the night.
- **Cold**: chill meter driven by `src/temperature.js` — climbs outside after dark
  (faster winter/wind/wet); slows movement and tool swings, breath fog, subtle frost
  vignette. **Misery, not death — no health damage.** Parlour fire clears it fast +
  "warmed through" buff into morning. James: "cold should actually drive people
  indoors" — make it a real push, tuned gentler in bairns worlds.
- **Tiredness/fatigue**: rises with time awake + exertion; blur edges, flagging pace,
  yawns, camera sway at high fatigue. **No forced collapse.** Relief: sleep (full),
  hearth doze (partial), or it simply caps. Feeds quorum sleep. Bairns: much slower
  or cosmetic-only.
- **Quorum sleep**: after midnight, >50% of online players inside inns → world-wide
  sleep suggestion (relay-side count — extends the existing `sleepers`/`wake` flow);
  visible shelter timer for the rest; then all sleep, night skips. Caught outside =
  wake where they were, hungry and cold, NOT killed. Single-player keeps classic
  sleep (quorum of one). Guard vs griefing: once per night.
- **Music — HARD GATE**: faint, genuine, public-domain period Yorkshire tunes
  (On Ilkla Moor Baht 'at, the Lyke Wake Dirge, Scarborough Fair, Elsie Marley, The
  Dalesman's Litany — confirm sources during implementation), transcribed to note
  data and rendered through the PROVEN struck/plucked procedural voices (music box /
  bells / FM pluck — NEVER brass/choir; prior synth music failed, see the
  procedural-audio memory + `src/carols.js` real-MIDI pipeline as the model). Mixed
  faint, under crackle and murmur. **James listens and approves before it merges** —
  ship the inn silent-but-crackling if the tunes aren't right yet. Music is the LAST
  slice.

## 4. Ground truth + this-session gotchas (verified 2026-07-03 — trust these)

**Client:**
- Frame loop / god-object seam: `Game.frame()` in src/main.js (ARCHITECTURE.md maps
  every subsystem + its verify guard). New systems = constructed in Game + called in
  frame() + row in ARCHITECTURE.md.
- `world.js` owns `setBlock` + the edit ledger — the protection hook point. Relay
  `edit` handling is in `src/multiplayer.js` `handle()` (message types listed in
  ARCHITECTURE.md; unknown types fall through harmlessly — INVARIANTS rule 3).
- **Day clock is NOT wall-clock**: `sky.time` integrates `dt/DAY_LENGTH` (sky.js:936,
  DAY_LENGTH=1800 at sky.js:9) and in the shared world is overwritten by the relay's
  broadcast (`multiplayer.js:218,274`). Inn hours + "after midnight" checks must read
  `game.sky.time` client-side; the QUORUM count is relay-side, and **worldsvc owns
  the shared day clock** (sky.js:10 says relay's server.py has DAY_LENGTH) — read it
  on the box before writing the quorum logic. This is also why the brain's
  night-gating (deferred Task 6 of workstream A) hasn't shipped — same clock issue.
- `game.freeWorld()` = bairns/free classification (rooms.js). Creative does NOT
  bypass gameplay gates (C precedent) — but wagers are NOT gated anywhere.
- Camera takeover exemplar: the train ride/drive view in main.js; `moorstead.debug.*`
  helpers exist for testing (`warp('Grosmont')`, `setSeason`, `festival(id)`).
- Villager/NPC night routing: workstream A's brain sends NPCs home at night is NOT
  yet implemented (deferred with Task 6) — the parlour crowd can be CLIENT-side for
  now: route rendered roster NPCs whose village has an inn into the parlour after
  dusk (client cosmetic placement, like `_spread`), without touching brain state.
  Their bubbles must go through `entities.speakAmbient` (E's gate).
- Fire: `src/fire.js` + `fireLayer` (capped nearest-N flames) — the hearth uses this.
- Props: `src/festivalKit.js` builders + `seasonalLayer.js` per-season dressing.
- Sign lettering: canvas → THREE.CanvasTexture, see `makeNameplate`/`makeBubble` in
  entities.js (~970).
- Audio: `src/audio.js` procedural SFX; `src/carols.js`/`carolBox.js` = the real-MIDI
  → struck-voices pipeline to imitate for folk tunes; there's an established
  crackle for fires (verify-festival-audio, verify-hearth exist).
- Save: additive player fields need constructor + serialize + deserialize only
  (miningSkill pattern); chill/fatigue values belong there. Forward-refuse rules in
  INVARIANTS if the save SHAPE changes (avoid — stay additive).

**Process gotchas discovered this session (will bite you otherwise):**
- `preview_start` (config `moorcraft-dev`) roots vite in the MAIN checkout, not your
  worktree. For in-browser checks of worktree code: temporarily add a launch config
  to the MAIN repo's `.claude/launch.json` with `cwd` pointed at the worktree
  (port 5199 worked), verify you're served the right code (probe a new field), and
  RESTORE launch.json after (checkout — beware CRLF churn making it look dirty).
- `npm run verify` is a hand-maintained `&&` chain in package.json — new verify
  scripts MUST be added there or they silently never run.
- Verify-script house style: `ok`/`bad`/`check` accumulator, per-line output,
  `RESULT: PASS|FAIL`, `process.exit(failed?1:0)` — NOT assert-throw.
- `grep -c` exits 1 on zero matches — don't chain it with `&&` in shell one-liners.
- `package-lock.json` version-field drift recurs after every deploy version bump —
  commit it as a chore before deploying (deploy gates on a clean tree).
- Generated JSON committed to the repo must be pinned LF in `.gitattributes`
  (`brain-sync/*.json` already is) or autocrlf breaks byte-compare staleness checks.
- Deploy: `npm run deploy` gates on clean/on-main/pushed; patch-bumps; runs
  verify:live post-deploy. Full runbook proven in this session (workstreams A/B).

**EVO box (only needed for the relay pieces — quorum sleep, `game` type, notes):**
- `ssh evo-tailscale`; passwordless `sudo -n`. Relay = `moorstead-world` unit,
  source `~/moorstead/worldsvc/server.py` — **NOT in any local mirror; SSH-read it
  first, `cp server.py server.py.bak-YYYYMMDD-tag` before editing.** It already has
  a patched verify-room allowance (server.py.bak-20260702-verifyroom exists).
- Brain = `moorstead-brain` unit, `~/moorstead/yorkshire_bot/brain/`, venv python
  `/home/james/moorstead/venv/bin/python`, NO pytest on the box — test in the local
  mirror (`C:\Users\James\moorstead-evo-work`, house import style
  `from brain import X`, 6 pre-existing env-only test failures are NOT yours), then
  scp + inline smoke with the venv python + restart + journalctl check.
- `npm run verify:live` from the client = production network checks incl. a real
  relay WebSocket round-trip; run after any relay change.

## 5. Process requirements (how the four shipped workstreams were built — do the same)

1. **Ground-truth probes BEFORE planning.** Read the actual code at every anchor you
   intend to touch (or dispatch an Explore agent). Every plan correction this session
   came from a probe: don't trust remembered line numbers or assumed APIs.
2. **Write implementation plan(s)** to `docs/superpowers/plans/` per the
   writing-plans discipline: bite-sized TDD tasks, complete code in steps, exact
   anchors, expected verify splits, no placeholders. Commit the plan.
3. **Slice D into separately deployable sub-plans** — suggested slicing:
   - **D1**: `innPlan()` builder + pocket carve + threshold teleport + edit
     protection (verify-inn-interior, verify-inn-protection). Flagship Grosmont only.
   - **D2**: decor + template variation + name signs + seasonal mount points
     (extend verify-inn-interior; verify-festival guards must stay green).
   - **D3**: parlour life — client-side NPC night routing into the parlour, seated
     poses at tables, ambient murmur through the E gate; opening hours on the door.
   - **D4**: games — rules engines first (verify-merrils/draughts/dominoes pure),
     then table interaction + camera view vs minimax NPC + wagers/trust, then PvP
     via the relay `game` type (relay change; additive; verify:live).
   - **D5**: cold chill + tiredness (verify-chill, verify-fatigue; player fields
     additive; HUD touches).
   - **D6**: quorum sleep + inn notes (relay work on worldsvc — backup first;
     verify-quorum-sleep, verify-inn-notes; bump nothing breaking).
   - **D7**: folk music behind the LISTEN-GATE (James must approve by ear).
   Deploy after each slice lands green (client-only slices: `npm run deploy`;
   relay slices: scp + restart + verify:live first).
4. **Worktree per slice or per couple of slices** (`git worktree add
   .worktrees/feat-<name> -b feat/<name>`; `.worktrees/` is gitignored).
5. **Subagent-driven development**: fresh implementer per task with the FULL task
   text + ground truth in the prompt; spec-compliance review then code-quality
   review (independent verification, don't trust reports); implementer fixes; you
   verify everything independently yourself before marking done. This caught real
   bugs every single workstream (FP parity breaks, radius split-brain, state leaks
   on death, grammar in LLM-facing strings) — do not skip reviews.
6. **Update ARCHITECTURE.md** with new subsystem rows + guards as you add them, and
   append memory notes to the auto-memory (`npc-program.md`) at each ship.

## 6. Explicitly out of scope for D (tracked elsewhere — don't absorb)

- Brain night-gating / errand day-phase (deferred Task 6 of workstream A — needs the
  worldsvc day-clock read; a natural companion to D6 but its own small plan).
- The hail-path ambient-gate chip (task_996e064a) and gift_prefs re-keying chip
  (task_2ce8fd81) — already spawned as separate follow-ups.
- Any new items/blocks for the games beyond procedural props; any minClientVersion
  bump (nothing in D is protocol-breaking if the new types stay additive).

## 7. Definition of done for D

Grosmont's Station Tavern: name-signed outside, threshold works both ways with no
save/multiplayer glitches, interior warm and dressed for the current season, roster
folk inside of an evening talking one-voice-at-a-time, all four games playable vs NPC
(and merrils/draughts vs another player over the relay), wagers moving brass and
trust, notes persisting, cold + tiredness honestly pulling players in at night,
quorum sleep working in a two-player test, template stamped onto at least a second
town (e.g. the Board Inn, Lealholm) purely by data, full verify gate green with all
new scripts wired in, deployed, verify:live green, and an in-browser proof pass of
the whole loop. Music only if the listen-gate has passed.
