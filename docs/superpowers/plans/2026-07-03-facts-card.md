# Facts Card + Information Economy Implementation Plan (Workstream B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every villager chat carries a compact, game-authoritative FACTS card (name, standing, honours, true train times, true market intel) that the brain is told to trust over its own memory; the station chip stops showing times the player hasn't learned (ask a local — the info economy's first tooth); and the brain's memory pipeline gets hygiene (validated items, timestamps, per-player reputation, name-capture sanity).

**Architecture:** A new pure module `src/factscard.js` formats the card from plain data; `src/economy.js` gains a pure `marketIntel()` sourced from the real `SPREAD` table; `src/quests.js` `chatContext()` prepends the card (inside the existing 2600 cap); `src/main.js` gains `depsForStation()` + learn-on-chat wiring; `src/player.js` gains a persisted `knownTimes` set (additive field, `miningSkill` pattern, no migration). EVO side: item validation against a synced list, timestamped trade/gift facts, per-player reputation namespacing, name-capture cap, summary-defers-to-context.

**Tech Stack:** ES modules + Node verify scripts (client); Python 3 + pytest (EVO mirror `C:\Users\James\moorstead-evo-work`); scp + systemctl deploy.

**Spec:** `docs/superpowers/specs/2026-07-03-npc-movement-chat-night-inn-design.md` (Workstream B).
**Ground truth (verified 2026-07-03):** `chatContext()` = quests.js:1577-1671, 11 sections, capped 2600 (line 1669), called from main.js:2334/2353/5554/5557. `withFacts()` = npc.js:12-19. `retrieveFacts` k=2/maxChars=600. `SPREAD`/`regionMult` = economy.js:50-78; `spreadHint` = economy.js:86-103 returns `{kind:'cheap'|'dear', best}`; `SPREAD_NAMES`, `EXPORTS`, `PRICES` module-scope. Station chip = main.js:2871-2903 (`updateStationChip`, ~1Hz), `nextDeparturesAt` = main.js:2851-2870 returns `[{dest, eta, dist}]`, rendered by `stationChipHTML` = ui.js:51-62. Player fields: add in constructor + `serialize()` (player.js:425-444) + `deserialize()` (446-473), additive = no migration (miningSkill precedent). Villager: `v.charId` (brain id), `v.t.name`, `v.village`. Standing: quests.js:672-678 + `STANDINGS`; titles: `earnedTitles`/`wornTitle` quests.js:653-699. Free worlds: `game.freeWorld()` (rooms.js classification; used in main.js:2887 for fare).

**Bairns relaxation:** free worlds keep the chip always-on (no learn gate). **The card is truth-only:** every row is computed from live game state; no LLM-remembered content enters it.

---

### Task B1: `src/factscard.js` + failing verify script (TDD)

**Files:**
- Create: `src/factscard.js`
- Create: `scripts/verify-facts-card.mjs`

- [ ] **Step 1: Write the failing verify script**

Create `scripts/verify-facts-card.mjs` (house `ok`/`bad` accumulator style, like verify-etiquette):

```js
// The FACTS card: game-authoritative context every villager chat carries. Pure
// formatter tests + market-intel truth checks against the real SPREAD table +
// source-wiring greps. LLM narrates, ledgers decide — every card row is TRUE.
import { readFileSync } from 'node:fs';
import { buildFactsCard, trainLines, FACTS_CARD_MAX } from '../src/factscard.js';
import { marketIntel } from '../src/economy.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const check = (c, m) => (c ? ok(m) : bad(m));

// --- buildFactsCard: rows in, labelled trustworthy block out ---
const card = buildFactsCard({
  playerName: 'James', standing: 'Welcomed', titles: ['Storm-Warden'],
  trainRows: ['Next trains from Grosmont: Whitby in 4 minutes, then Pickering in 12 minutes.'],
  marketRows: ['Wool is dear here; it sells cheap at Moorstead.'],
});
check(card.startsWith('GAME FACTS'), 'card carries the GAME FACTS header');
check(/trust these over anything you remember/i.test(card), 'card instructs the model to defer to it');
check(card.includes('James') && card.includes('Welcomed') && card.includes('Storm-Warden'),
      'name, standing and honours all present');
check(card.includes('Next trains from Grosmont') && card.includes('Wool is dear'),
      'train + market rows carried through');
check(buildFactsCard({}) === '', 'empty inputs -> empty card (no noise for the model)');
check(buildFactsCard({ playerName: 'X'.repeat(2000) }).length <= FACTS_CARD_MAX,
      'card never exceeds its budget');

// --- trainLines: true, compact, tellable ---
const tl = trainLines('Grosmont', [{ dest: 'Whitby', eta: 245, dist: 800 }, { dest: 'Pickering', eta: 731, dist: 1400 }]);
check(tl.length === 1 && tl[0].includes('Grosmont'), 'one line per station');
check(tl[0].includes('Whitby') && tl[0].includes('4 minutes'), 'first departure with rounded minutes');
check(tl[0].includes('Pickering') && tl[0].includes('12 minutes'), 'second departure follows');
check(trainLines('Grosmont', []).length === 0, 'no departures -> no line (never invent a time)');
check(trainLines('Grosmont', [{ dest: 'Whitby', eta: 40, dist: 800 }])[0].includes('due now'),
      'imminent train reads as due now, not 0 minutes');

// --- marketIntel: TRUE statements from the real SPREAD table ---
const whitby = marketIntel('Whitby');
check(Array.isArray(whitby) && whitby.length >= 1 && whitby.length <= 2, 'Whitby yields 1-2 intel lines');
check(whitby.every(l => typeof l === 'string' && l.length < 160), 'lines are short prose');
// Whitby: coal is DEAR (1.9), sea fish is CHEAP (0.5) per SPREAD — at least one must surface
check(whitby.some(l => /coal/i.test(l) || /fish/i.test(l) || /wool/i.test(l)), 'talks about real spread goods');
const nowhere = marketIntel('Boggle Hole');
check(Array.isArray(nowhere), 'unknown village -> array (may be empty), never throws');

// --- source wiring (lands across B1-B3; expected FAIL until then) ---
const q = readFileSync(new URL('../src/quests.js', import.meta.url), 'utf8');
check(/buildFactsCard\(/.test(q), 'quests.chatContext prepends the facts card');
const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
check(/depsForStation\(/.test(mainSrc), 'main.js exposes depsForStation for chat + chip');
check(/knownTimes/.test(mainSrc), 'main.js wires the learn-gate');
const p = readFileSync(new URL('../src/player.js', import.meta.url), 'utf8');
check(/knownTimes/.test(p), 'player persists knownTimes');

console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run it — confirm it fails** (`buildFactsCard` not found).

- [ ] **Step 3: Implement `src/factscard.js`**

```js
// The FACTS CARD — a compact, game-authoritative block prepended to every villager
// chat. Every row is computed from LIVE game state, so the brain can repeat it
// safely: LLM narrates, ledgers decide. The card is deliberately small (the model
// fumbles long context) and the header tells it to prefer these rows to its own
// recollections. Pure formatters only — callers supply plain data.
export const FACTS_CARD_MAX = 700;   // chars — the card must stay a card, not an essay

export function buildFactsCard(f) {
  const rows = [];
  if (f.playerName) rows.push(`The visitor's name is ${String(f.playerName).slice(0, 40)}.`);
  if (f.standing) rows.push(`Their standing hereabouts: ${f.standing}.`);
  if (f.titles && f.titles.length) rows.push(`Honours they carry: ${f.titles.slice(0, 3).join(', ')}.`);
  for (const t of f.trainRows || []) rows.push(t);
  for (const m of f.marketRows || []) rows.push(m);
  if (!rows.length) return '';
  let card = 'GAME FACTS (all true right now — trust these over anything you remember; '
           + 'weave them in naturally, never recite the list):\n- ' + rows.join('\n- ');
  if (card.length > FACTS_CARD_MAX) card = card.slice(0, FACTS_CARD_MAX);
  return card;
}

// True next-train lines for a station, from the live deterministic timetable
// (deps = [{dest, eta, dist}] as main.js nextDeparturesAt returns). One compact
// line; no departures -> no line, so a time is never invented.
export function trainLines(station, deps) {
  const good = (deps || []).filter(d => d && d.dest && Number.isFinite(d.eta));
  if (!good.length) return [];
  const fmt = s => s <= 60 ? 'due now' : `in ${Math.round(s / 60)} minutes`;
  const parts = good.slice(0, 2).map(d => `${d.dest} ${fmt(d.eta)}`);
  return [`Next trains from ${station}: ${parts.join(', then ')}. You may tell the visitor these times.`];
}
```

- [ ] **Step 4: Implement `marketIntel` in `src/economy.js`**

Append near `spreadHint` (economy.js:86-103), as a module-level export (pure — reads only the module tables):

```js
// True market talk for a village: which SPREAD goods are dear/cheap HERE, and where
// the other end of the trade is. Sourced from the same tables the tills use, so a
// villager repeating it is always right. Returns 0..max short prose lines.
export function marketIntel(village, max = 2) {
  const out = [];
  for (const idStr of Object.keys(SPREAD)) {
    const id = +idStr;
    const hint = spreadHint(id, village);
    if (!hint) continue;
    const name = (ITEM_NAMES[id] || 'goods').toLowerCase();
    out.push(hint.kind === 'dear'
      ? `${name[0].toUpperCase()}${name.slice(1)} fetches a dear price here${hint.best ? `; it's bought cheap over at ${hint.best}` : ''}.`
      : `${name[0].toUpperCase()}${name.slice(1)} is cheap here${hint.best ? `; it sells dear at ${hint.best}` : ''}.`);
    if (out.length >= max) break;
  }
  return out;
}
```

Check `ITEM_NAMES` is already imported in economy.js (it imports from defs.js — confirm the exact import line and extend it if `ITEM_NAMES` isn't in it). Note `spreadHint`'s `best` for the **cheap** case is the *dear* market (where to sell), and for the **dear** case `spreadHint` finds the best *other* market — read spreadHint (economy.js:86-103) carefully: it returns where the multiplier is HIGH elsewhere. So for `kind:'dear'` the `best` is another high market, NOT a cheap source — the "bought cheap over at" phrasing above would be FALSE. Fix the dear-case phrasing to stay truthful with what spreadHint returns: `"; folk pay well for it at ${hint.best} an' all"` (another dear market) — or omit `best` for the dear case entirely (simplest true option). Implement the OMIT version:

```js
    out.push(hint.kind === 'dear'
      ? `${cap(name)} fetches a dear price here.`
      : `${cap(name)} is cheap here${hint.best ? `; it sells dear at ${hint.best}` : ''}.`);
```
(with a tiny local `const cap = s => s[0].toUpperCase() + s.slice(1);`)

- [ ] **Step 5: Run the verify script** — pure sections PASS; the 4 wiring checks still FAIL (B2/B3 land them). Confirm exactly that split.

- [ ] **Step 6: Commit** — `feat(chat): facts-card formatters + true market intel from SPREAD`

---

### Task B2: Client wiring — card into chatContext, train intel, learn-gate

**Files:**
- Modify: `src/quests.js` (chatContext, line 1577), `src/main.js` (depsForStation helper + updateStationChip gate + learn-on-reply), `src/player.js` (knownTimes field), `src/ui.js` (unlearned chip variant)

- [ ] **Step 1: `depsForStation(name)` helper in main.js**

Extract from `updateStationChip` (main.js:2871-2903) the schedule-picking logic into a reusable method placed just above it:

```js
  // Next departures for a station by NAME, on whichever line carries it (main or
  // branch) — the one lookup chat intel and the chip both use.
  depsForStation(name, want = 2) {
    const geo = this.world && this.world.gen && this.world.gen.geo;
    if (!geo) return null;
    const main = geo.railway();
    let idx = main.findIndex(s => s.name === name);
    if (idx >= 0) return this.nextDeparturesAt(t => this.trainSchedule(t), main, geo.railPath().stationS, idx, want);
    for (const bt of (this.branchTrains || [])) {
      idx = bt.stations.findIndex(s => s.name === name);
      if (idx >= 0) return this.nextDeparturesAt(t => this.trainScheduleFor(bt.path, bt.stations, t), bt.stations, bt.path.stationS, idx, want);
    }
    return null;
  }
```

Then refactor `updateStationChip` to call it (`const deps = this.depsForStation(st.name, 2) || [];`) — behaviour identical. (Verify the exact `nextDeparturesAt` signature at main.js:2851 and the branch-line structure in the current `updateStationChip` body before writing — mirror what's there, don't invent.)

- [ ] **Step 2: `knownTimes` on the player**

`src/player.js`: constructor `this.knownTimes = {};` (station name -> true). Add `knownTimes: this.knownTimes || {},` to `serialize()` and `this.knownTimes = d.knownTimes || {};` to `deserialize()`. Additive — no SAVE_VERSION bump (miningSkill precedent).

- [ ] **Step 3: Learn-gate the chip**

In `updateStationChip`, after `st` is resolved and before computing deps: 

```js
    const gated = !this.player.creative && !this.freeWorld() && !this.player.knownTimes[st.name];
    if (gated) { this.ui.stationChipHTML = stationChipUnknownHTML(st.name); return; }
```

In `src/ui.js`, next to `stationChipHTML` (ui.js:51-62), add + export:

```js
// Before the times are learned the chip nudges the player to ASK — the information
// economy's first tooth: a local tells you the times, then the chip carries them.
export function stationChipUnknownHTML(name) {
  return `<div class="tq station">⏱ <b>${name}</b> — tha'll want to ask a body for t' train times.</div>`;
}
```
(Import it in main.js alongside the existing `stationChipHTML` import.)

- [ ] **Step 4: Card assembly + train intel in `chatContext` (quests.js:1577)**

At the TOP of `chatContext(villager)` (before `const parts = []` fills), build the card and make it `parts[0]`:

```js
    // The FACTS card leads: compact, game-true, and the model is told to trust it.
    const g = this.game;
    const stationName = villager.village || null;
    const deps = stationName && g.depsForStation ? g.depsForStation(stationName, 2) : null;
    const card = buildFactsCard({
      playerName: g.player && g.player.name,
      standing: this.standingLabel(),
      titles: this.earnedTitleList(),
      trainRows: deps ? trainLines(stationName, deps) : [],
      marketRows: g.econ ? marketIntel(stationName || '') : [],
    });
    if (card) parts.push(card);
```

Imports at the top of quests.js: `import { buildFactsCard, trainLines } from './factscard.js';` and `import { marketIntel } from './economy.js';` (check quests.js's existing import of economy — it may import the Economy class instance via game; `marketIntel` is a pure module export so a direct import is correct). Keep the existing 2600 cap — the card's 700 budget fits within it; verify by eye that the cap line (quests.js:1669) still slices at 2600.

`villager.village` is the settlement name (entities.js:1470) — station names match town names in this world (Grosmont, Goathland, ...). `depsForStation` returns null for a town with no station: no train row, correct.

- [ ] **Step 5: Learn on reply**

In `main.js` `sendChat()` (~line 2330-2380): after a successful `npc.talk`/`talkGeneric` reply for villager `v`, add:

```js
      // She's told thee t' times — the chip carries them now (info economy: learned by asking).
      const stn = v.village && this.player && !this.player.knownTimes[v.village]
        && this.depsForStation && this.depsForStation(v.village, 1) ? v.village : null;
      if (stn) { this.player.knownTimes[stn] = true; this.ui.toast(`Tha knows t' ${stn} train times now — t' chip'll show 'em.`, 5000); }
```

(Place it in the same success path that renders the reply; find the exact post-await lines by reading sendChat first.)

- [ ] **Step 6: Run `node scripts/verify-facts-card.mjs`** — ALL checks pass now (wiring greps included). Then `npm run verify` (the script gets wired into the gate in this step: add `node scripts/verify-facts-card.mjs` to package.json's verify chain after `verify-facts.mjs`) and `npm run build` — both green.

- [ ] **Step 7: Commit** — `feat(chat): facts card leads every chat; train times learned by asking`

---

### Task B3: EVO brain hygiene

**Files (EVO mirror repo `C:\Users\James\moorstead-evo-work`):**
- Modify: `brain/memory.py` (timestamps + validation), `brain/reputation.py` (per-player), `brain/app.py` (summary prompt + name cap wiring as needed)
- Create: `brain/known_items.py` OR `brain/items.json` sync (see Step 1), `brain/tests/test_hygiene.py`
- Client: Create `scripts/export-items.mjs`, `brain-sync/items.json`

- [ ] **Step 1 (client): export the item-name list**

`scripts/export-items.mjs`: import `ITEM_NAMES` from `../src/defs.js`, write `brain-sync/items.json` as a sorted array of lowercased names (same normalisation main.js applies before `npc.trade`/`gift`: strip `raw |roast ` prefix — bake that in). Wire a staleness check into `verify-facts-card.mjs` (same regenerate-and-compare pattern as verify-timetable-parity; brain-sync/*.json is already LF-pinned by .gitattributes). Commit with the generated file. Copy to `C:\Users\James\moorstead-evo-work\brain\items.json`.

- [ ] **Step 2 (EVO, TDD): `brain/tests/test_hygiene.py`**

```python
import json, os, time
from brain import memory

def test_trade_fact_validates_item_and_stamps_ts(tmp_path, monkeypatch):
    from brain import config
    monkeypatch.setattr(config, "MEMORY_DIR", str(tmp_path))
    m = memory.new_memory()
    memory.record_trade_fact(m, "wool", 3, "sell")          # real item
    memory.record_trade_fact(m, "xx_junk_zz", 1, "sell")    # junk — rejected
    trades = m["facts"]["trades"]
    assert any(t["item"] == "wool" for t in trades)
    assert not any(t["item"] == "xx_junk_zz" for t in trades)
    assert all("ts" in t for t in trades)

def test_gift_fact_validates_and_stamps(monkeypatch, tmp_path):
    from brain import config
    monkeypatch.setattr(config, "MEMORY_DIR", str(tmp_path))
    m = memory.new_memory()
    memory.record_gift_fact(m, "heather")
    memory.record_gift_fact(m, "totally made up thing")
    gifts = m["facts"]["gifts_received"]
    assert any((g["item"] if isinstance(g, dict) else g) == "heather" for g in gifts)
    assert len([g for g in gifts if "made up" in str(g)]) == 0

def test_player_name_capture_is_sane():
    assert memory.sane_player_name("Bess") == "Bess"
    assert memory.sane_player_name("Supercalifragilisticexpialidocious"*3) is None
    assert memory.sane_player_name("x" ) is None            # too short
    assert memory.sane_player_name("DROP TABLE;--") is None # non-name characters
```

Adapt the assertions to memory.py's REAL current shapes (read `record_trade_fact`/`record_gift_fact`/`new_memory` first — the explorer mapped them at memory.py:144-182; gifts may be plain strings today, in which case migrate new entries to `{item, ts}` dicts while still reading old strings). Implement: load `items.json` once in memory.py (`_KNOWN_ITEMS = set(json.load(...))`, tolerate absence → validation off, log once); reject unknown items in both recorders; stamp `"ts": time.time()`; add `sane_player_name(s)` (2-24 chars, `^[A-Za-z][A-Za-z' -]+$`) and use it in the name-capture path (app.py/memory.capture facts — find the regex site).

- [ ] **Step 3 (EVO): per-player reputation**

`brain/reputation.py` currently stores per character shared across players (explorer's finding). Namespace its storage by `player_id` the same way memory.py does (`players/{player_id}/...`), defaulting to the legacy path when player_id is None. Read reputation.py fully first; keep the change additive (legacy files still readable). Add a test: two different player_ids applying events to the same character read back independent scores.

- [ ] **Step 4 (EVO): summary defers to the card**

In the summary-regeneration prompt (`app.py` `_update_memory_summary`, ~line 101-132): add one sentence — "If anything you remember conflicts with the GAME FACTS block in the conversation, the GAME FACTS are correct — drop the conflicting memory." Locate the exact prompt string and append.

- [ ] **Step 5:** `python -m pytest brain/tests/test_hygiene.py brain/tests/test_timetable.py brain/tests/test_booking.py brain/test_roster_sim.py brain/test_act.py -q` — all green (do NOT run the 6 known-broken persona/art tests). Commit EVO repo: `feat(brain): memory hygiene — validated items, timestamps, per-player reputation, sane names`.

---

### Task B4: Deploy — brain then client

Same runbook as Workstream A's Task 8 (proven 2026-07-03):
1. Back up on EVO: `ssh evo-tailscale 'cd ~/moorstead/yorkshire_bot/brain && for f in memory.py reputation.py app.py; do cp $f $f.bak-$(date +%Y%m%d)-factscard; done'`
2. scp changed brain files + `items.json` + new tests; inline smoke-test with `/home/james/moorstead/venv/bin/python` (no pytest on box — run the validation functions directly); `sudo -n systemctl restart moorstead-brain`; confirm `active` + no tracebacks in journalctl.
3. Client: merge branch → `npm run verify` on main → push → `npm run deploy` → `verify:live` green.
4. In-browser: open a chat with a Grosmont villager; confirm the reply can quote the real next train; confirm the chip was hidden pre-chat and populated post-chat; confirm a market line matches SPREAD truth. Free world: chip always on.

---

## Verify scripts (new/changed)
`verify-facts-card` (card formatter truth + market intel + items export staleness + wiring), wired into the gate. EVO: `test_hygiene.py`.

## Explicitly deferred to Workstream C
The spec's remaining B items — tracker saying "ask the parson at Goathland" instead of
markers, and splitting the good jobs off the notice board into conversation-only offers —
are gameplay-tuning siblings of the necessity spine and land with C's ledgers, not here.
Quest clues are already conversation-only today (quests.js clue-holder mechanism).

## Risks
- **Card bloat**: 700-char budget + chatContext's 2600 cap enforced; verify asserts the budget.
- **spreadHint dear-case semantics**: `best` is another HIGH market — the plan's Step B1.4 already corrects the phrasing to stay truthful; reviewer must re-check the final strings against SPREAD.
- **Gift-fact shape migration** (strings → dicts): read-both, write-new; test covers both.
- **Learn-gate frustration**: creative + free worlds bypass; one toast teaches the mechanic.
