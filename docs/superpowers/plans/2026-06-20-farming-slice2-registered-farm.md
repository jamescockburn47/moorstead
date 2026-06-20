# Farming Slice 2 — Registered Farm Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player who keeps 5 head of penned stock register a farm at the Moorstead notice board for a £1 charter, becoming a "registered farmer" — the gate that Slice 3's droving unlocks.

**Architecture:** The threshold/gate logic is a pure function in `economy.js` (headless-tested, the same pattern as `priceOf`/`bookShipment`). The player gains a small persisted `farmStatus` object. The game exposes three thin helpers (head count, "am I at Moorstead?", and the register action). The parish notice board (`ui.openBoard`, already Moorstead-centric) grows a "Become a Farmer" section, and the existing pen-settle path emits head-count progress hints. Legibility (handbook + bairns milestone) ships with the mechanic.

**Tech Stack:** Vanilla ES modules, no framework. Headless tests are plain Node scripts (`scripts/verify-*.mjs`) wired into `npm run verify`. Build is Vite.

**Deploy note (read first):** Slice 2 is the *gate*; its payoff — droving — is Slice 3. A registered farm with no droving yet is an inert feature, and we do not document or ship unbuilt mechanics (James's #1 rule). So: **build, verify, and commit Slice 2 now, but deploy Slices 2 + 3 together.** This plan therefore ends at "verified + committed locally," not at deploy. The handbook copy here stops at "become a registered farmer" and says nothing about droving; Slice 3's plan adds the droving paragraph to the same handbook section.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/economy.js` | modify | `FARM_THRESHOLD`, `CHARTER_FEE`, pure `farmRegisterCheck()` |
| `scripts/verify-farm.mjs` | create | headless test of the gate + constants |
| `package.json` | modify | wire `verify-farm.mjs` into `npm run verify` (+ a `verify:farm` script) |
| `src/player.js` | modify | persist `farmStatus` in constructor/serialize/deserialize |
| `src/main.js` | modify | `farmHeadCount()`, `atMarketTown()`, `registerFarm()` + economy import |
| `src/ui.js` | modify | "Become a Farmer" section on the parish board + economy import |
| `src/entities.js` | modify | head-count progress hint on the pen-settle + economy import |
| `src/milestones.js` | modify | `flock_penned` + `farm_registered` rungs (bairns world) |

Isolation: the *gate* is one pure function with one job. The game helpers read live state and call it; the UI renders it; persistence stores only `{ registered }`. Head count is derived from `player.pets` (already persisted), never stored separately — one source of truth.

---

## Task 1: The pure farm-register gate + headless test

**Files:**
- Create: `scripts/verify-farm.mjs`
- Modify: `src/economy.js` (add constants + `farmRegisterCheck` after the SP2 block, ~line 78)
- Modify: `package.json:11` and `package.json:24`

- [ ] **Step 1: Write the failing test**

Create `scripts/verify-farm.mjs`:

```js
// Registered-farm gate check — run wi': node scripts/verify-farm.mjs
import { FARM_THRESHOLD, CHARTER_FEE, farmRegisterCheck } from '../src/economy.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// --- constants are the signed-off values (Moorstead, 5 head, £1) ---
{
  (FARM_THRESHOLD === 5 ? ok : bad)('farm threshold is 5 head');
  (CHARTER_FEE === 240 ? ok : bad)('charter fee is £1 (240d)');
}

// --- below threshold is refused, carrying the exact shortfall ---
{
  const r = farmRegisterCheck({ head: 3, registered: false, brass: 999, atMarket: true });
  (r.ok === false && r.reason === 'short' ? ok : bad)('3 head: refused as short');
  (r.need === 5 && r.have === 3 ? ok : bad)('short result carries need=5, have=3');
}

// --- at threshold but away from the market town ---
{
  const r = farmRegisterCheck({ head: 5, registered: false, brass: 999, atMarket: false });
  (r.ok === false && r.reason === 'away' ? ok : bad)('5 head but not at Moorstead: refused as away');
}

// --- at threshold, at market, but skint ---
{
  const r = farmRegisterCheck({ head: 6, registered: false, brass: 100, atMarket: true });
  (r.ok === false && r.reason === 'poor' ? ok : bad)('5+ head at market but under £1: refused as poor');
  (r.fee === 240 ? ok : bad)('poor result carries the fee');
}

// --- all conditions met ---
{
  const r = farmRegisterCheck({ head: 5, registered: false, brass: 240, atMarket: true });
  (r.ok === true ? ok : bad)('5 head, at market, £1 in purse: may register');
}

// --- already registered is a no-op ---
{
  const r = farmRegisterCheck({ head: 9, registered: true, brass: 999, atMarket: true });
  (r.ok === false && r.reason === 'already' ? ok : bad)('already registered: no re-register');
}

console.log('RESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/verify-farm.mjs`
Expected: FAIL / a crash — `farmRegisterCheck` and the constants aren't exported yet (`SyntaxError: ... does not provide an export named 'FARM_THRESHOLD'`).

- [ ] **Step 3: Implement the gate in `src/economy.js`**

Insert after the SP2 tuning block (after the `PURSE_REFILL` line, ~line 78):

```js
// --- Slice 2: registered farm status (the gate to droving) ---
export const FARM_THRESHOLD = 5;   // head of penned stock to qualify as a farm
export const CHARTER_FEE = 240;    // £1, the one-time registration charter (Moorstead board)

// Pure gate: may the player register their farm right now? Returns { ok, reason, ... }.
// reason drives both the board copy and the refusal toast:
//   'already' — already a registered farmer
//   'short'   — under the head threshold (carries need, have)
//   'away'    — not stood at the market town (Moorstead)
//   'poor'    — can't afford the charter (carries fee)
// Threshold is checked before location so the player always sees stock progress first.
export function farmRegisterCheck({ head = 0, registered = false, brass = 0, atMarket = false }) {
  if (registered) return { ok: false, reason: 'already' };
  if (head < FARM_THRESHOLD) return { ok: false, reason: 'short', need: FARM_THRESHOLD, have: head };
  if (!atMarket) return { ok: false, reason: 'away' };
  if (brass < CHARTER_FEE) return { ok: false, reason: 'poor', fee: CHARTER_FEE };
  return { ok: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/verify-farm.mjs`
Expected: all `ok`, final line `RESULT: PASS`, exit 0.

- [ ] **Step 5: Wire it into `npm run verify`**

In `package.json:11`, append to the `verify` chain (after `verify-activity.mjs`):

```
 && node scripts/verify-farm.mjs
```

And add a per-check script after `package.json:24` (`"verify:activity": ...`):

```json
    ,"verify:farm": "node scripts/verify-farm.mjs"
```

- [ ] **Step 6: Run the full suite**

Run: `npm run verify`
Expected: every script prints `RESULT: PASS`; the run exits 0 (now 14 checks).

- [ ] **Step 7: Commit**

```bash
git add src/economy.js scripts/verify-farm.mjs package.json
git commit -m "feat(farm): pure registered-farm gate + headless check (Slice 2)"
```

---

## Task 2: Persist `farmStatus` on the player

**Files:**
- Modify: `src/player.js:44` (constructor), `:335` (serialize), `:357` (deserialize)

- [ ] **Step 1: Add the field to the constructor**

After `this.bairnFresh = false;` (player.js:44):

```js
    this.farmStatus = { registered: false }; // registered-farm status (Slice 2 gate to droving)
```

- [ ] **Step 2: Add it to `serialize()`**

In the returned object (after `pets: this.pets || [],`, player.js:335):

```js
      farmStatus: this.farmStatus,
```

- [ ] **Step 3: Add it to `deserialize()`**

After `this.pets = d.pets || [];` (player.js:357):

```js
    this.farmStatus = d.farmStatus || { registered: false };
```

- [ ] **Step 4: Verify the build is clean**

Run: `npm run build`
Expected: Vite build succeeds, no errors. (Behaviour — that `registered` survives a save/reload — is verified live in Task 7.)

- [ ] **Step 5: Commit**

```bash
git add src/player.js
git commit -m "feat(farm): persist farmStatus on the player (Slice 2)"
```

---

## Task 3: Game helpers — head count, market-town check, register action

**Files:**
- Modify: `src/main.js:14` (import), and add three methods to the `Game` class (place them near the pony/economy methods, e.g. just before `mountPony`, main.js:1597)

- [ ] **Step 1: Extend the economy import**

Change `src/main.js:14` from:

```js
import { Economy, bestMarket, FREIGHT_ALLOWANCE } from './economy.js';
```

to:

```js
import { Economy, bestMarket, FREIGHT_ALLOWANCE, farmRegisterCheck, CHARTER_FEE } from './economy.js';
```

- [ ] **Step 2: Add the three methods**

Insert before `mountPony(pony)` (main.js:1597):

```js
  // ---- Slice 2: registered farm status ----
  // Head of penned stock the player keeps (sheep for now; Slice 4 widens the kinds).
  farmHeadCount() {
    return (this.player.pets || []).filter(p => p && p.kind === 'sheep').length;
  }

  // Is the player stood at the market town (Moorstead) — where a farm is registered?
  atMarketTown() {
    const geo = this.world.gen.geo;
    const m = geo.villages.find(v => /moorstead/i.test(v.name));
    if (!m) return false;
    const p = this.player.pos;
    return Math.hypot(m.x - p.x, m.z - p.z) <= 70; // within Moorstead's bounds
  }

  // Register the farm: a deliberate, paid choice at the Moorstead board. Returns true on success.
  registerFarm() {
    const r = farmRegisterCheck({
      head: this.farmHeadCount(),
      registered: this.player.farmStatus.registered,
      brass: this.economy.balance,
      atMarket: this.atMarketTown(),
    });
    if (!r.ok) {
      const msg = r.reason === 'already' ? 'Tha&rsquo;s already a registered farmer.'
        : r.reason === 'short' ? `Tha needs <b>${r.need}</b> head penned to register &mdash; tha&rsquo;s ${r.have}.`
        : r.reason === 'away' ? 'Tha registers a farm at <b>Moorstead</b>&rsquo;s notice board.'
        : `T&rsquo; charter&rsquo;s <b>${this.economy.format(r.fee)}</b> &mdash; tha&rsquo;s not got it just yet.`;
      this.ui.toast(msg, 5000);
      return false;
    }
    this.economy.spend(CHARTER_FEE);
    this.player.farmStatus.registered = true;
    this.ui.toast('🌾 <b>Tha&rsquo;s a registered farmer o&rsquo; Moorstead parish now!</b>', 7000);
    if (this.milestones) this.milestones.fire('farm_registered');
    if (this.saveNow) this.saveNow(false);
    return true;
  }
```

- [ ] **Step 3: Verify the build is clean**

Run: `npm run build`
Expected: Vite build succeeds. (Behaviour verified live in Task 7.)

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat(farm): head count, market-town check + register action (Slice 2)"
```

---

## Task 4: "Become a Farmer" on the parish notice board

**Files:**
- Modify: `src/ui.js:2` area (add an economy import line), and `ui.openBoard` (insert a section before the close button, ui.js:707)

- [ ] **Step 1: Add the economy import**

Add a new import line after `src/ui.js:2`:

```js
import { FARM_THRESHOLD, CHARTER_FEE, farmRegisterCheck } from './economy.js';
```

- [ ] **Step 2: Add the board section**

In `openBoard(fromBoard)`, immediately before `const close = this.el('button', 'mc', this.boardPanel, 'Reet, Ta');` (ui.js:707):

```js
    // ---- Become a Farmer (Slice 2): the registered-farm path, always shown for legibility ----
    {
      const g = this.game;
      const fs = g.player.farmStatus || { registered: false };
      const head = g.farmHeadCount();
      this.el('div', 'inv-title', this.boardPanel, 'Become a Farmer');
      if (fs.registered) {
        this.el('div', 'r-needs', this.boardPanel,
          '🌾 <b>Tha&rsquo;s a registered farmer o&rsquo; Moorstead parish.</b> Thi fold&rsquo;s on t&rsquo; books.');
      } else {
        const need = FARM_THRESHOLD;
        const atMkt = g.atMarketTown();
        const bal = g.economy.balance;
        this.el('div', 'r-needs', this.boardPanel,
          `Keep <b>${need} head</b> o&rsquo; stock penned in a fold, then register here for a <b>${g.economy.format(CHARTER_FEE)}</b> charter.`);
        this.el('div', 'r-needs', this.boardPanel,
          head >= need
            ? `<b style="color:#9ec27a">${head}/${need} head penned</b> &mdash; tha&rsquo;s ready to register.`
            : `<b>${head}/${need} head penned</b> &mdash; pen <b>${need - head}</b> more.`);
        const chk = farmRegisterCheck({ head, registered: false, brass: bal, atMarket: atMkt });
        if (chk.ok) {
          const row = this.el('div', 'recipe quest-row', this.boardPanel);
          row.innerHTML = `<div class="r-name"><b>Register thi farm</b><br><span class="r-needs">pay t&rsquo; ${g.economy.format(CHARTER_FEE)} charter</span></div>`;
          const b = this.el('button', 'mc chat-btn', row, 'Register');
          b.addEventListener('click', () => { if (g.registerFarm()) this.openBoard(fromBoard); });
        } else if (head >= need && !atMkt) {
          this.el('div', 'r-needs', this.boardPanel, 'Come to <b>Moorstead</b>&rsquo;s notice board to sign t&rsquo; register.');
        } else if (head >= need && chk.reason === 'poor') {
          this.el('div', 'r-needs', this.boardPanel, `Tha needs <b>${g.economy.format(CHARTER_FEE)}</b> for t&rsquo; charter (tha&rsquo;s ${g.economy.format(bal)}).`);
        }
      }
    }

```

- [ ] **Step 3: Verify the build is clean**

Run: `npm run build`
Expected: Vite build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/ui.js
git commit -m "feat(farm): Become a Farmer entry + register action on the parish board (Slice 2)"
```

---

## Task 5: Head-count progress hints + bairns milestones on penning

**Files:**
- Modify: `src/entities.js:3` (import) and the pen-settle toast (entities.js:1316-1317)
- Modify: `src/milestones.js:10-23` (two new rungs)

- [ ] **Step 1: Add the economy import to entities.js**

After `src/entities.js:3` (`import { B, I, BLOCKS, isSolid } from './defs.js';`):

```js
import { FARM_THRESHOLD } from './economy.js';
```

- [ ] **Step 2: Replace the pen-settle toast with a head-count-aware hint**

Replace entities.js:1317 (the single `this.game.ui.toast(...)` line that follows the `player.pets ... push(...)` at 1316) with:

```js
        if (this.game) {
          const head = (player.pets || []).filter(p => p && p.kind === 'sheep').length;
          const registered = player.farmStatus && player.farmStatus.registered;
          let msg = `<b>${name}</b>’s penned — she’s thi stock now.`;
          if (!registered) {
            msg += head >= FARM_THRESHOLD
              ? ` <b>${head} head!</b> Tha can register thi farm at t’ Moorstead notice board.`
              : ` <b>${head}/${FARM_THRESHOLD} head</b> — pen ${FARM_THRESHOLD - head} more to register a farm.`;
          }
          if (this.game.ui) this.game.ui.toast(msg, 4500);
          if (this.game.milestones) this.game.milestones.fire('flock_penned');
        }
```

- [ ] **Step 3: Add the two milestone rungs**

In `src/milestones.js`, add to the `MILESTONES` object (after `first_neet:`, line 22) — match the existing raw-curly-quote style:

```js
  flock_penned:    'Tha’s penned thi first stock! Keep 5 head in a fold an’ tha can register a farm at t’ Moorstead notice board.',
  farm_registered: 'Tha’s a registered farmer now! T’ parish has thi fold on t’ books.',
```

(`flock_penned` fires from the pen-settle above; `farm_registered` fires from `registerFarm()` in Task 3. Both no-op off the bairns' world, by `fire()`'s `active()` guard — adults still get the toast hint + board copy.)

- [ ] **Step 4: Verify the build is clean**

Run: `npm run build`
Expected: Vite build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/entities.js src/milestones.js
git commit -m "feat(farm): pen progress hints + farm milestones (Slice 2)"
```

---

## Task 6: Handbook — "Becomin' a registered farmer"

**Files:**
- Modify: `src/ui.js` `buildHowSections()`, the `'Sheepdog & Flock'` section (ends ~ui.js:432)

- [ ] **Step 1: Add the subsection**

In the `'Sheepdog & Flock'` template string, after the "Pennin' thi stock" `</ul>` and its `<p class="how-note">...</p>` (the line ending `thi own penned stock bide put.</p>`), insert before the closing backtick:

```html
<h3>Becomin&rsquo; a registered farmer</h3>
<ul>
<li>Once tha keeps <b>5 head</b> o&rsquo; penned stock, go to t&rsquo; <b>parish notice board at Moorstead</b> (by t&rsquo; village cross, or press <b>Q</b> when tha&rsquo;s there) an&rsquo; <b>register thi farm</b> for a <b>£1 charter</b>.</li>
<li>That makes thee a <b>registered farmer o&rsquo; Moorstead parish</b> &mdash; thi fold&rsquo;s on t&rsquo; books.</li>
</ul>
```

Do NOT mention droving here — it isn't built. Slice 3's plan adds that paragraph to this same section.

- [ ] **Step 2: Verify the build is clean**

Run: `npm run build`
Expected: Vite build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/ui.js
git commit -m "docs(farm): handbook — becoming a registered farmer (Slice 2)"
```

---

## Task 7: Full local verification (deploy held for Slice 3)

**Files:** none (verification only)

- [ ] **Step 1: Headless suite green**

Run: `npm run verify`
Expected: 14 checks, every one `RESULT: PASS`, exit 0.

- [ ] **Step 2: Build green**

Run: `npm run build`
Expected: Vite build succeeds, no errors.

- [ ] **Step 3: Drive the live preview**

Start: `npm run dev`. In the browser console:

```js
const g = window.game;
g.loginGuest();              // or the normal guest entry
g.newWorld('farmtest');
// pump a few frames so the world settles (see handoff: keep batches < ~900 frames)
for (let i = 0; i < 300; i++) g.frame();
// warp to Moorstead and grant 5 penned sheep to exercise the register flow
moorstead.warp('Moorstead');
g.player.pets = Array.from({ length: 5 }, (_, i) => ({ kind: 'sheep', name: 'Test' + i, stay: true, home: { x: 0, y: 0, z: 0 } }));
g.openBoard(true);           // the Moorstead parish board
```

Confirm: the "Become a Farmer" section shows **5/5 head penned** and a **Register** button. Click it (or `g.registerFarm()`); confirm the toast fires, `g.player.farmStatus.registered === true`, and `g.economy.balance` dropped by 240.

- [ ] **Step 4: Below-threshold + away refusals**

```js
g.player.farmStatus.registered = false;
g.player.pets = g.player.pets.slice(0, 3);   // 3 head
g.openBoard(true);                            // shows "3/5 head penned — pen 2 more", no button
```

Then warp away from Moorstead with 5 head and confirm the board shows "Come to Moorstead's notice board to sign t' register" with no button:

```js
g.player.pets = Array.from({ length: 5 }, (_, i) => ({ kind: 'sheep', name: 'T' + i, stay: true, home: { x: 0, y: 0, z: 0 } }));
moorstead.warp('Rosedale');
g.openBoard(true);
```

- [ ] **Step 5: Persistence round-trip**

Register (back at Moorstead), then `g.saveNow(true)`, reload the page, re-enter the same world, and confirm `window.game.player.farmStatus.registered === true` and the board shows "Tha's a registered farmer".

- [ ] **Step 6: Real pen hint (sanity)**

In a fresh world near spawn (do NOT teleport mid-herd — see the handoff's herding test trap), pen at least one wild sheep with the dog and confirm the toast reads "…N/5 head — pen M more to register a farm."

- [ ] **Step 7: Report, do NOT deploy**

Summarise the verification to James. **Hold the deploy** — Slices 2 + 3 ship together (registration's payoff is Slice 3's droving). The next step is the Slice 3 plan.

---

## Self-Review

**Spec coverage (§4 / §8 / §10 of the design):**
- 5-head + register at Moorstead board, £1 charter → Task 1 (gate), Task 3 (action), Task 4 (board). ✓
- `farmStatus` / `farmRegistered` persisted → Task 2. ✓
- "Become a farmer" board entry stating the path + threshold → Task 4. ✓
- Live progress hint "3/5 head penned…" → Task 5 (pen toast) + Task 4 (board). ✓
- Register-below-threshold refused with the exact shortfall → Task 1 (`short` carries need/have), Task 3 (toast), Task 4 (board copy). ✓
- Milestone-ladder rung + handbook updated → Task 5 (milestones), Task 6 (handbook). ✓
- Headless threshold logic test → Task 1 (`verify-farm.mjs`). ✓

**Placeholder scan:** none — every step carries the actual code/commands.

**Type consistency:** `farmRegisterCheck({head, registered, brass, atMarket})` and its `{ok, reason, need, have, fee}` result are used identically in Tasks 1, 3, 4. Helpers `farmHeadCount()` / `atMarketTown()` / `registerFarm()` named consistently across main.js, ui.js, and the verification. `farmStatus.registered` consistent across player.js, main.js, ui.js, entities.js. `FARM_THRESHOLD` / `CHARTER_FEE` imported wherever used.

**Out of scope (correctly):** droving, the mobile herd, the sale, per-species pricing (Slices 3/4); crosshair cues beyond the pen toast (optional polish, deferred).
