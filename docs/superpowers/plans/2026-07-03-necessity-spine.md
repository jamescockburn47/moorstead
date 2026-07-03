# Necessity Spine Implementation Plan (Workstream C)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Nobody sells owt of consequence to a stranger." Four conversation-only mechanics with deterministic ledgers: **taught recipes** (iron-tier crafting locked until a craftsman/miner teaches you), **commissions** (pay the same tradesman to make it for you — come back for it), **vouching** (staking a deed needs a friend's word), **promises** (delivery contracts with deadlines; kept feeds standing, broken feeds shame). All client-side; the brain just narrates what the facts card tells it.

**Architecture:** One new pure module `src/ledgers.js` (teach tables, craft gate, commission catalogue + pricing, vouch rule, promise deadline logic) + one verify script; additive player save fields (`taught`, `commissions`, `vouches`, `promiseLog` — miningSkill pattern, no migration); chat-action buttons in `ui.renderChatActions` (the proven quest-button pattern); the deeds flow gains the vouch check; the facts card gains truth rows for all four ledgers. **Client-only — no EVO changes** (the brain learns everything via the card).

**Spec:** `docs/superpowers/specs/2026-07-03-npc-movement-chat-night-inn-design.md` (Workstream C).

**Ground truth (verified 2026-07-03):**
- `RECIPES` = defs.js:293-333, rows `{out, n, needs, bench?}` — NO tier field. `SMELTS` 336-347. Recipe list rendered + executed in ui.js:2170-2203 (`openInventory`): availability check `r.needs.every(countItem)`, click handler removes/adds items — gate BOTH there.
- Teach-gate candidates: iron tools `I.I_PICK/I_AXE/I_SHOVEL/I_SWORD` and iron-work `B.RANGE/B.SAFETY_LAMP/B.WINCH/B.STRONGBOX` (all bench+iron already).
- Chat buttons: ui.js:1103-1191 `renderChatActions` — offer button pattern `q.offerFor(v.t.name)` → `this.el('button','mc chat-btn quest-btn',this.chatQuestRow,...)` + click → handler + `renderChatLog()+renderChatActions()`.
- Roles: WARDROBE entities.js:539-640 — `craftsman`, `miner`, `trader`, `railway`, `farmer`, `publican`… NO smith. `canonicalRole()` entities.js:615-630. Villager `v.role`; `v.tier` is set after each `npc.talk` reply (main.js:2358-2362, ephemeral, not persisted).
- Deeds: fees deeds.js:7-10; board UI ui.js:1340-1418 — "Stake a claim" row calls `this.game.stakeClaim(8)` (line ~1351); mine license nearby. Gate INSIDE `game.stakeClaim`/`game.licenseMine` (find both in main.js), not just the button, so future callers inherit it.
- Jobs: quests.js:953-1016 `refreshOffers` (giver offers + `boardOffers`); builders 1032-1200; job shape `{id,giver,title,desc,offer,steps,state,turnIn,reward:{items,trust,text}}` — no quality field. `sky.day` is the day counter (used at quests.js:954). Shame exists: `quests.addShame(n, reason)` (~quests.js:680).
- Standing: `quests.standingIndex()` (0..4 = Newcomer..Treasured), thresholds [0,5,20,50,100]. Free worlds: `game.freeWorld()`.
- Facts card: `buildFactsCard(f)` in src/factscard.js (B, live) — extend with ledger rows.
- `player.shipments` `{...arrivesAt}` + `sky.day` = the established come-back-later pattern.

**Bairns relaxation:** `game.freeWorld()` bypasses ALL four gates (crafting fully open, no vouch needed, contracts never shame). Single-player adults get the full spine.

---

### Task C1: `src/ledgers.js` + verify script (TDD, pure)

**Files:** Create `src/ledgers.js`, `scripts/verify-necessity.mjs`.

- [ ] **Step 1: failing verify script** (house ok/bad style):

```js
// The necessity spine's pure rules: taught crafting gate, commission catalogue and
// pricing, vouch rule, promise deadlines. Ledgers decide; the LLM only narrates.
import { readFileSync } from 'node:fs';
import { SKILLS, skillFor, canCraft, teacherFor, commissionable, commissionPrice,
         COMMISSION_WAIT_DAYS, canVouch, promiseState } from '../src/ledgers.js';
import { RECIPES, I, B } from '../src/defs.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const check = (c, m) => (c ? ok(m) : bad(m));

// --- skills map onto real recipes ---
check(SKILLS.smithing && SKILLS.ironwork, 'two starter skills defined');
check(skillFor(I.I_PICK) === 'smithing' && skillFor(I.I_SWORD) === 'smithing', 'iron tools need smithing');
check(skillFor(B.RANGE) === 'ironwork' && skillFor(B.STRONGBOX) === 'ironwork', 'range/strongbox need ironwork');
check(skillFor(B.PLANKS) === null, 'everyday crafting is never gated');
const gated = RECIPES.filter(r => skillFor(r.out));
check(gated.length >= 6 && gated.length <= 12, `a meaningful but small gated set (${gated.length})`);
check(gated.every(r => r.bench), 'only bench recipes are ever gated (no gating hand-crafts)');

// --- canCraft: the one gate both display and execution call ---
check(canCraft(I.I_PICK, {}, false) === false, 'untaught -> cannot craft iron pick');
check(canCraft(I.I_PICK, { smithing: true }, false) === true, 'taught smithing -> can craft');
check(canCraft(I.I_PICK, {}, true) === true, 'free/bairns world -> everything open');
check(canCraft(B.PLANKS, {}, false) === true, 'ungated recipe always craftable');

// --- teachers: role + standing ---
check(teacherFor('smithing') === 'craftsman' && teacherFor('ironwork') === 'miner', 'teacher roles');
check(SKILLS.smithing.minStanding === 1 && SKILLS.ironwork.minStanding === 1, 'teaching needs Known standing');

// --- commissions: same goods, made for brass, ready later ---
check(commissionable(I.I_PICK) && commissionable(B.STRONGBOX), 'gated goods are commissionable');
check(!commissionable(B.PLANKS), 'ungated goods are not (buy or make them)');
const px = commissionPrice(I.I_PICK);
check(Number.isFinite(px) && px >= 8 && px <= 200, `commission price sane (${px}d)`);
check(commissionPrice(B.STRONGBOX) > commissionPrice(I.I_SHOVEL), 'dearer goods cost more');
check(COMMISSION_WAIT_DAYS >= 1, 'a commission is never instant');

// --- vouching ---
check(canVouch({ tier: 'Friend' }, 0) === true, 'a Friend will vouch');
check(canVouch({ tier: 'Close friend' }, 0) === true, 'a close friend certainly will');
check(canVouch({ tier: 'Acquaintance' }, 0) === false, 'an acquaintance will not');
check(canVouch({ tier: null }, 3) === true, 'Respected standing carries its own weight (no per-NPC tier needed)');
check(canVouch({ tier: null }, 2) === false, 'below Respected, tha needs a friend');

// --- promises ---
check(promiseState({ deadlineDay: 5 }, 4) === 'open', 'before the deadline: open');
check(promiseState({ deadlineDay: 5 }, 5) === 'open', 'deadline day itself still counts');
check(promiseState({ deadlineDay: 5 }, 6) === 'broken', 'past the deadline: broken');

// --- wiring greps (land across C2-C5; expected FAIL until then) ---
const u = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
check(/canCraft\(/.test(u), 'ui recipe list gates through canCraft');
const p = readFileSync(new URL('../src/player.js', import.meta.url), 'utf8');
check(/taught/.test(p) && /commissions/.test(p) && /vouches/.test(p) && /promiseLog/.test(p), 'player persists the four ledgers');
const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
check(/canVouch|vouches/.test(mainSrc), 'deed staking consults the vouch ledger');
const fc = readFileSync(new URL('../src/factscard.js', import.meta.url), 'utf8');
check(/taught|commission|promise/i.test(fc), 'facts card carries ledger rows');

console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: implement `src/ledgers.js`** — pure, data-first:

```js
// The necessity spine's ledgers and rules — "nobody sells owt of consequence to a
// stranger." Deterministic and pure: the chat brain narrates these outcomes but
// never decides them. Skills are TAUGHT in conversation by the right trade; the
// same goods can be COMMISSIONED instead; big purchases need a VOUCH; PROMISES
// have deadlines the day-clock enforces.
import { I, B, RECIPES } from './defs.js';

// skill -> who teaches it, what standing they want first, and the goods it unlocks
export const SKILLS = {
  smithing: { teacher: 'craftsman', minStanding: 1, label: 'smithing',
              goods: [I.I_PICK, I.I_AXE, I.I_SHOVEL, I.I_SWORD] },
  ironwork: { teacher: 'miner', minStanding: 1, label: 'iron-work',
              goods: [B.RANGE, B.SAFETY_LAMP, B.WINCH, B.STRONGBOX] },
};

const _skillByOut = new Map();
for (const [key, s] of Object.entries(SKILLS)) for (const id of s.goods) _skillByOut.set(id, key);

export function skillFor(outId) { return _skillByOut.get(outId) || null; }

// The ONE crafting gate — display and execution both call this.
export function canCraft(outId, taught, freeWorld) {
  const skill = skillFor(outId);
  if (!skill || freeWorld) return true;
  return !!(taught && taught[skill]);
}

export function teacherFor(skill) { return SKILLS[skill] ? SKILLS[skill].teacher : null; }

// Commissions: the tradesman makes a gated good FOR you — dearer than materials,
// never instant. Price: flat per-good table (kept simple and tunable; economy
// PRICES don't cover crafted tools).
export const COMMISSION_WAIT_DAYS = 1;
const COMMISSION_PRICES = {
  [I.I_PICK]: 24, [I.I_AXE]: 22, [I.I_SHOVEL]: 16, [I.I_SWORD]: 30,
  [B.RANGE]: 60, [B.SAFETY_LAMP]: 36, [B.WINCH]: 48, [B.STRONGBOX]: 80,
};
export function commissionable(outId) { return skillFor(outId) != null; }
export function commissionPrice(outId) { return COMMISSION_PRICES[outId] ?? 40; }

// Vouching: a villager who counts you a FRIEND this session will vouch; failing
// that, village-wide Respected standing (index >= 3) speaks for itself.
const VOUCH_TIERS = ['Friend', 'Close friend'];
export function canVouch(villager, standingIdx) {
  if (villager && VOUCH_TIERS.includes(villager.tier)) return true;
  return (standingIdx | 0) >= 3;
}

// Promises: kept before (or on) the deadline day, broken after it.
export function promiseState(promise, day) {
  return day > promise.deadlineDay ? 'broken' : 'open';
}
```

Check the real exact ids exist in defs (I.I_PICK etc. — ground truth says they do). Run script: pure checks PASS, 4 wiring greps FAIL. Commit: `feat(necessity): pure ledgers — skills, commissions, vouching, promises`.

---

### Task C2: Player ledger fields + facts-card rows

**Files:** `src/player.js`, `src/factscard.js`, `src/quests.js` (card assembly site).

- `player.js` constructor: `this.taught = {}; this.commissions = []; this.vouches = []; this.promiseLog = { kept: 0, broken: 0 };` + serialize/deserialize (additive, `|| {}`/`|| []` defaults).
- `factscard.js` `buildFactsCard(f)`: new optional inputs `taught` (array of labels), `commissions` (array of `{item, readyAtDay, ready}`), `promises` (`{kept, broken}`), `vouchedBy` (names). Rows (each only when non-empty):
  - `They have been taught: smithing, iron-work.`
  - `Open commission: an iron pick with <giver>, ready day <n><' — READY to collect' if ready>.`
  - `Their word: <kept> promises kept<, <broken> broken>.` (broken only when > 0)
- `quests.js` card assembly (the B block at top of chatContext): pass the new fields from `g.player` (taught labels via SKILLS, commissions mapped with `ready: g.sky.day >= c.readyAtDay`, promiseLog, vouches names).
- Extend `verify-facts-card.mjs` with 2-3 assertions for the new rows (pure). Run verify-necessity (player grep goes green) + verify-facts-card + quests guard. Commit.

---

### Task C3: Crafting gate in the UI

**Files:** `src/ui.js` (openInventory recipe loop, 2170-2203).

- Import `canCraft` (+ `skillFor`, `teacherFor`, `SKILLS`) into ui.js. In the recipe loop: `const taughtOk = canCraft(r.out, g.player.taught, g.freeWorld());`
  - If `!taughtOk`: render the row LOCKED (the trade-button `locked` class pattern already exists at ui.js:1145-1189) with needs-text replaced by `Ask a ${teacherFor(skillFor(r.out))} to teach thee ${SKILLS[skillFor(r.out)].label}.` and NO click handler.
  - Execution guard: even in the enabled path, first line of the click handler: `if (!canCraft(r.out, g.player.taught, g.freeWorld())) return;`
- SMELTS untouched (not gated).
- Run: verify-necessity (ui grep green), `verify-uxflow`, full inventory-adjacent guards (`verify-resources`, `verify-mining`, `verify-survival`). Commit.

---

### Task C4: Teach / Commission / Vouch chat actions

**Files:** `src/ui.js` (renderChatActions), `src/quests.js` (handlers), `src/main.js` (only if a helper fits better there).

Handlers on quests (they know standing + have `this.game`):

```js
  // --- necessity spine: what this villager can do for the visitor, in conversation ---
  teachableBy(v) {           // -> skill key or null
    for (const [key, s] of Object.entries(SKILLS)) {
      if (s.teacher === canonicalRole(v.role) && !this.game.player.taught[key]
          && this.standingIndex() >= s.minStanding) return key;
    }
    return null;
  }
  teach(v, key) {
    this.game.player.taught[key] = true;
    v.chatLog.push({ who: 'sys', text: `${v.displayName || v.t.name} shows thee the way of ${SKILLS[key].label}. Tha can craft it thissen now.` });
    this.game.ui.toast(`Tha's learned ${SKILLS[key].label}!`, 6000);
  }
  commissionOffer(v) {       // -> {item, price} or null  (first gated good the player CAN'T craft)
    if (canonicalRole(v.role) !== 'craftsman' && canonicalRole(v.role) !== 'miner') return null;
    for (const [key, s] of Object.entries(SKILLS)) {
      if (s.teacher !== canonicalRole(v.role) || this.game.player.taught[key]) continue;
      const item = s.goods[0];
      const open = this.game.player.commissions.some(c => c.item === item && c.state === 'open');
      if (!open) return { item, price: commissionPrice(item) };
    }
    return null;
  }
  placeCommission(v, offer) {
    const p = this.game.player;
    if (p.brass < offer.price) { this.game.ui.toast("Tha's not got the brass for that."); return false; }
    p.brass -= offer.price;
    p.commissions.push({ id: 'c' + Date.now(), item: offer.item, price: offer.price,
                         giver: v.t.name, readyAtDay: this.game.sky.day + COMMISSION_WAIT_DAYS, state: 'open' });
    v.chatLog.push({ who: 'sys', text: `Commission agreed: ${itemName(offer.item)}, ${offer.price}d — ready day ${this.game.sky.day + COMMISSION_WAIT_DAYS}. Come back for it.` });
    return true;
  }
  commissionReady(v) {       // -> commission or null
    return this.game.player.commissions.find(c => c.state === 'open' && c.giver === v.t.name
      && this.game.sky.day >= c.readyAtDay) || null;
  }
  collectCommission(v, c) {
    c.state = 'done';
    this.game.player.addItem(c.item, 1);
    v.chatLog.push({ who: 'sys', text: `${v.displayName || v.t.name} hands ower thi ${itemName(c.item)}. Good work an' all.` });
  }
  askVouch(v) {
    if (!canVouch(v, this.standingIndex())) return false;
    const p = this.game.player;
    if (!p.vouches.some(x => x.by === v.t.name)) p.vouches.push({ by: v.t.name, day: this.game.sky.day });
    v.chatLog.push({ who: 'sys', text: `${v.displayName || v.t.name} gives thee their word. Tha can stake a claim now.` });
    return true;
  }
```

(Imports into quests.js: `SKILLS, canVouch, commissionPrice, COMMISSION_WAIT_DAYS` from ledgers.js, `canonicalRole` from entities.js — CHECK what quests.js already imports from entities.js and extend; `itemName` from defs.js likewise.)

Buttons in `renderChatActions` (after the turn-in block, ui.js ~1130), each following the offer-button pattern exactly (sys-line + `renderChatLog()` + `renderChatActions()`):
- `Teach me <label>` when `q.teachableBy(v)`.
- `Commission: <itemName> (<price>d)` when `q.commissionOffer(v)`; disabled/locked style when brass short.
- `Collect thi <itemName>` when `q.commissionReady(v)`.
- `Ask to vouch for thee` when `!g.freeWorld() && g.player.vouches.length === 0 && canVouch(v, q.standingIndex())` (only shown while unvouched — no button spam).

Run verify-necessity + uxflow + quests guards; full gate; build. Commit.

---

### Task C5: Promises (delivery contracts) + deed vouch gate + job split

**Files:** `src/quests.js`, `src/main.js` (stakeClaim/licenseMine), `src/ui.js` (board note).

- **Contract builder** in quests.js (pattern: buildDelivery at ~1140s): `buildContract(giver, rng)` — deliver N×item (from the giver-trade's buys) by `deadlineDay = sky.day + 2`, reward = above-market brass + trust; `quality: 'good'`; offered ONLY via giver offers (never boardOffers). On turn-in before deadline: `player.promiseLog.kept++`. In `quests.update()`, sweep active contracts: `promiseState(inst, sky.day) === 'broken'` → fail it, `promiseLog.broken++`, `addShame(2, 'Tha broke thi word to ' + giver + '.')`, remove from active.
- **Good jobs conversation-only:** add `quality: 'dull'` to the three board builders (deliver/hunt/treasure) and `quality: 'good'` to lostLamb/sparkle/contract; assert in refreshOffers that `boardOffers` only ever receives `quality==='dull'` builders (one-line guard + verify grep).
- **Deed vouch gate** in `game.stakeClaim` and `game.licenseMine` (find both in main.js): first lines —
```js
    if (!this.freeWorld() && !this.player.creative && !this.player.vouches.length && this.quests.standingIndex() < 3) {
      this.ui.toast("T' parish won't register a deed for a stranger — ask a friend to vouch for thee first.", 6000);
      return false;
    }
```
- Board UI: when the stake row would be gated, show the same message as the row's needs-text (read ui.js:1340-1418 and mirror the existing disabled patterns).
- Run: verify-necessity ALL green now; verify-quests; verify-deeds; full gate; build. Commit.

---

### Task C6: Full gate + in-browser sanity + deploy (client only)

- `npm run verify` + `npm run build` green on the branch; merge to main; gate again; push; `npm run deploy`.
- In-browser (dev, New SP World): craft list shows iron pick LOCKED with "Ask a craftsman…"; find a craftsman (Moorstead/Grosmont), Teach button appears at Known standing (use `moorstead.debug` or gift to bump if needed — for the smoke test `game.quests` standing can be inspected; creative-mode bypass must NOT unlock taught, only freeWorld does — verify chip behaviour separately); commission flow: place (brass deducted, sys line with ready day), `moorstead.debug.setSeason`? no — advance day via sleep or `game.sky.day++` in console, Collect button appears; vouch: ask friend-tier villager (set `v.tier='Friend'` in console for the smoke), stake claim succeeds; without vouch it toasts the refusal. Contract: accept from a trader, check tracker shows deadline, let it lapse (sky.day++) → shame toast + promiseLog.broken.
- Confirm facts card rows appear in `game.quests.chatContext(v)` output.

## Risks
- **Standing threshold friction**: teaching needs Known (5 trust) — a fresh player must chat/gift a little first; that IS the design (know the face), and free worlds bypass. Watch kid playtest.
- **v.tier ephemerality**: vouch needs a Friend-tier this session (or Respected standing). If that's too grindy live, the dial is `VOUCH_TIERS`/standing index in one place (ledgers.js).
- **Commission catalogue = first ungated good of the role** — deliberately minimal v1; a picker UI can come later.
- **No EVO deploy** — brain narrates the new card rows with zero server change.
