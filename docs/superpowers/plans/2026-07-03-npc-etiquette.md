# NPC Conversation Etiquette Implementation Plan (Workstream E)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One villager voice at a time near the player — a global speech token with a quiet period, silent greet fallback for blocked speakers, no approaches while the chat window is open, and a much lower random-bark baseline.

**Architecture:** Pure decision helpers live in `src/villagerlife.js` (already the home of `villagerRemark`/`dayPhase`, guarded by verify scripts that import pure functions). `src/entities.js` wires them into the existing nosy-approach block and gains a `speakAmbient()` gate over `speak()`. `src/main.js` exposes a `chatOpen` flag. `src/roster.js` routes NPC-to-NPC banter through the same gate when near the player.

**Tech Stack:** Vanilla ES modules, Node headless verify scripts (`node scripts/verify-etiquette.mjs`), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-03-npc-movement-chat-night-inn-design.md` (Workstream E).

---

### Task 1: Pure etiquette helpers + failing verify script

**Files:**
- Modify: `src/villagerlife.js` (append at end)
- Create: `scripts/verify-etiquette.mjs`

- [ ] **Step 1: Write the failing verify script**

Create `scripts/verify-etiquette.mjs`:

```js
// Conversation etiquette: one ambient voice at a time near the player, a quiet
// period between barks, silence while the chat window is open, and a low random
// baseline. Pure-function tests + source-wiring assertions.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  canNosy, nosyWants, ambientQuietAfter,
  AMBIENT_QUIET_MIN, AMBIENT_QUIET_MAX, NOSY_RANDOM_BASE,
} from '../src/villagerlife.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

// --- canNosy: every blocker blocks ---
const base = { hasToken: false, approaching: false, chatting: false, bubble: false,
               playerDead: false, chatOpen: false, quietLeft: 0, cd: 0, dist: 5 };
ok(canNosy(base) === true, 'clear path -> may start a nosy approach');
ok(canNosy({ ...base, hasToken: true }) === false, 'token held elsewhere blocks');
ok(canNosy({ ...base, chatOpen: true }) === false, 'open chat window blocks ALL approaches');
ok(canNosy({ ...base, quietLeft: 5 }) === false, 'quiet period blocks a new approach');
ok(canNosy({ ...base, quietLeft: 3.9 }) === true, 'quiet nearly over (<=4s) -> approach may start');
ok(canNosy({ ...base, bubble: true }) === false, 'own live bubble blocks');
ok(canNosy({ ...base, chatting: true }) === false, 'engaged villager never re-approaches');
ok(canNosy({ ...base, playerDead: true }) === false, 'dead player blocks');
ok(canNosy({ ...base, cd: 1 }) === false, 'personal cooldown blocks');
ok(canNosy({ ...base, dist: 10 }) === false, 'too far blocks');
ok(canNosy({ ...base, dist: 2 }) === false, 'too close blocks');

// --- nosyWants: baseline is genuinely low, triggers still fire ---
ok(NOSY_RANDOM_BASE <= 0.05, 'random baseline cut to <=5% (was 16%)');
ok(nosyWants({ nearBuild: true }, 0.99) === true, 'building nearby always draws a look');
ok(nosyWants({ roam: true }, 0.99) === true, 'roamers still wander over');
ok(nosyWants({ sociable: 0.9 }, 0.99) === true, 'sociable folk still come');
ok(nosyWants({ sociable: 0.5 }, 0.5) === false, 'ordinary folk mostly do not');
ok(nosyWants({ sociable: 0.5 }, NOSY_RANDOM_BASE / 2) === true, 'rare random nosiness survives');

// --- quiet period: bubble life + 10..15s, monotone in rand ---
ok(ambientQuietAfter(8, 0) === 8 + AMBIENT_QUIET_MIN, 'min quiet = secs + 10');
ok(ambientQuietAfter(8, 1) === 8 + AMBIENT_QUIET_MAX, 'max quiet = secs + 15');
ok(AMBIENT_QUIET_MIN >= 10 && AMBIENT_QUIET_MAX <= 15, 'quiet window is 10-15s per spec');

// --- simulation: N eager villagers, one voice at a time, never overlapping ---
{
  const mobs = Array.from({ length: 6 }, (_, i) => ({ id: i, cd: 0, bubbleT: 0 }));
  let quiet = 0, token = null, overlaps = 0, spoke = 0;
  for (let f = 0; f < 4000; f++) {           // 400s of 0.1s frames
    const dt = 0.1;
    quiet = Math.max(0, quiet - dt);
    for (const m of mobs) {
      m.cd = Math.max(0, m.cd - dt);
      m.bubbleT = Math.max(0, m.bubbleT - dt);
      if (token === m && m.approachT != null && (m.approachT -= dt) <= 0) {
        // end of approach: speak only through the gate
        if (quiet <= 0) { m.bubbleT = 8; quiet = ambientQuietAfter(8, 0.5); spoke++; }
        m.approachT = null; token = null;
      }
      if (!token && canNosy({ hasToken: false, approaching: m.approachT != null,
          chatting: false, bubble: m.bubbleT > 0, playerDead: false, chatOpen: false,
          quietLeft: quiet, cd: m.cd, dist: 5 })) {
        token = m; m.approachT = 3; m.cd = 30;
      }
    }
    if (mobs.filter(m => m.bubbleT > 0).length > 1) overlaps++;
  }
  ok(overlaps === 0, 'no two ambient bubbles ever live at once');
  ok(spoke >= 5, `the parish still talks (${spoke} barks in 400s)`);
  ok(spoke <= 25, `but not constantly (${spoke} barks in 400s)`);
}

// --- source wiring: entities/main/roster actually use the gate ---
const ent = readFileSync(new URL('../src/entities.js', import.meta.url), 'utf8');
ok(/speakAmbient\(/.test(ent), 'entities.js defines/uses speakAmbient');
ok(/canNosy\(/.test(ent), 'entities.js gates the nosy trigger through canNosy');
ok(!/Math\.random\(\)\s*<\s*0\.16/.test(ent), 'old 16% inline baseline is gone');
const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
ok(/this\.chatOpen\s*=\s*true/.test(mainSrc) && /this\.chatOpen\s*=\s*false/.test(mainSrc),
   'main.js tracks chatOpen across openChat/closeChat');
const ros = readFileSync(new URL('../src/roster.js', import.meta.url), 'utf8');
ok(/speakAmbient\(/.test(ros), 'roster banter near the player goes through the ambient gate');

console.log(`verify-etiquette: ${n} assertions OK`);
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node scripts/verify-etiquette.mjs`
Expected: FAIL — `canNosy` is not exported from `../src/villagerlife.js`.

- [ ] **Step 3: Implement the pure helpers**

Append to `src/villagerlife.js`:

```js
// --- conversation etiquette (spec 2026-07-03): one ambient voice at a time -------------
// A bark near the player claims a global quiet period; while it runs, would-be
// speakers greet silently instead (turn + pause, no bubble). All pure — entities.js
// supplies the state and owns the timers.
export const AMBIENT_QUIET_MIN = 10;   // seconds of hush after a bubble fades
export const AMBIENT_QUIET_MAX = 15;
export const NOSY_RANDOM_BASE = 0.04;  // was an inline 0.16 — the moor stays quiet

// May this villager START a nosy approach this frame?
export function canNosy(o) {
  if (o.hasToken || o.approaching || o.chatting || o.bubble || o.playerDead) return false;
  if (o.chatOpen) return false;                 // never crowd an open conversation
  if (o.quietLeft > 4) return false;            // let the last voice finish first
  if (o.cd > 0) return false;
  return o.dist < 9 && o.dist > 2.6;
}

// Does she WANT to come over? (same draws as before, lower random baseline)
export function nosyWants(o, rand) {
  return !!(o.nearBuild || o.roam || (o.sociable || 0.5) > 0.62 || rand < NOSY_RANDOM_BASE);
}

// How long the parish stays quiet after a bubble of `secs` seconds.
export function ambientQuietAfter(secs, rand = Math.random()) {
  return secs + AMBIENT_QUIET_MIN + rand * (AMBIENT_QUIET_MAX - AMBIENT_QUIET_MIN);
}
```

- [ ] **Step 4: Re-run the verify script**

Run: `node scripts/verify-etiquette.mjs`
Expected: still FAIL, but only on the three source-wiring assertions (entities/main/roster not yet wired). All pure-function and simulation assertions PASS.

- [ ] **Step 5: Commit**

```bash
git add src/villagerlife.js scripts/verify-etiquette.mjs
git commit -m "feat(etiquette): pure ambient-speech gate helpers + verify script"
```

---

### Task 2: `chatOpen` flag in main.js

**Files:**
- Modify: `src/main.js:2248-2270` (`openChat` / `closeChat`)

- [ ] **Step 1: Set the flag in openChat**

In `openChat(villager)` (main.js:2248), directly after `villager.chatting = true;` (line 2252), add:

```js
    this.chatOpen = true;               // etiquette: no ambient approaches mid-conversation
```

- [ ] **Step 2: Clear it in closeChat**

In `closeChat()` (main.js:2265), directly after the `chatVillager.chatting = false` line, add:

```js
    this.chatOpen = false;
```

- [ ] **Step 3: Check both edits**

Run: `node scripts/verify-etiquette.mjs`
Expected: the `main.js tracks chatOpen` assertion now PASSES (entities/roster assertions still fail).

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat(etiquette): track chatOpen across openChat/closeChat"
```

---

### Task 3: Wire the gate into entities.js

**Files:**
- Modify: `src/entities.js` — imports, class `update()`, `speak()` area (~line 2709), nosy block (lines 2884-2916)

- [ ] **Step 1: Import the helpers**

`src/entities.js` already imports from `./villagerlife.js` (it calls `villagerRemark`). Extend that import statement to also bring in `canNosy, nosyWants, ambientQuietAfter`.

- [ ] **Step 2: Add the global quiet timer and speakAmbient**

Directly under the existing `speak(mob, text, secs = 14)` method (entities.js:2709-2715), add:

```js
  // Ambient (unprompted) speech: one voice at a time across the parish. Returns false
  // when the parish is in its quiet period or the player is mid-conversation — the
  // caller then greets silently instead of speaking.
  speakAmbient(mob, text, secs = 8) {
    if ((this.ambientQuiet || 0) > 0) return false;
    if (this.game && this.game.chatOpen) return false;
    this.speak(mob, text, secs);
    this.ambientQuiet = ambientQuietAfter(secs);
    return true;
  }
```

At the top of the class's main `update(dt, ...)` method (the one `Game.frame()` calls as `entities.update`), add one line before the mob loop:

```js
    this.ambientQuiet = Math.max(0, (this.ambientQuiet || 0) - dt);
```

- [ ] **Step 3: Replace the nosy trigger condition**

Replace the trigger block at entities.js:2892-2901:

```js
    if (!this.nosyToken && !mob.nosyApproach && !mob.chatting && !mob.bubble && !player.dead && mob.nosyCd <= 0 && distP < 9 && distP > 2.6) {
      const lb = this.lastBuild;
      const nearBuild = !!(lb && (performance.now() - lb.t < 60000) &&
        Math.hypot(lb.x - mob.pos.x, lb.z - mob.pos.z) < 16 && Math.hypot(lb.x - player.pos.x, lb.z - player.pos.z) < 16);
      if (nearBuild || mob.roam || (mob.sociable || 0.5) > 0.62 || Math.random() < 0.16) {
        mob.nosyCd = 30 + Math.random() * 40;
        mob.nosyApproach = { until: 6, build: nearBuild };
        this.nosyToken = mob;
      }
    }
```

with:

```js
    if (canNosy({ hasToken: !!this.nosyToken, approaching: !!mob.nosyApproach,
        chatting: !!mob.chatting, bubble: !!mob.bubble, playerDead: !!player.dead,
        chatOpen: !!(this.game && this.game.chatOpen),
        quietLeft: this.ambientQuiet || 0, cd: mob.nosyCd, dist: distP })) {
      const lb = this.lastBuild;
      const nearBuild = !!(lb && (performance.now() - lb.t < 60000) &&
        Math.hypot(lb.x - mob.pos.x, lb.z - mob.pos.z) < 16 && Math.hypot(lb.x - player.pos.x, lb.z - player.pos.z) < 16);
      if (nosyWants({ nearBuild, roam: mob.roam, sociable: mob.sociable }, Math.random())) {
        mob.nosyCd = 30 + Math.random() * 40;
        mob.nosyApproach = { until: 6, build: nearBuild };
        this.nosyToken = mob;
      }
    }
```

- [ ] **Step 4: Silent-greet fallback at the speak moment**

Replace the arrival block at entities.js:2912-2916:

```js
      if (distP <= 3.2 || mob.nosyApproach.until <= 0) {
        if (!mob.bubble) this.speak(mob, villagerRemark({ role: mob.role, mood: mob.mood, nearBuild: mob.nosyApproach.build, outside: !mob.village, evening: latening }, Math.random), 8);
        mob.nosyApproach = null; mob.state = 'greet'; mob.stateTimer = 1.5;
        if (this.nosyToken === mob) this.nosyToken = null;
      }
```

with:

```js
      if (distP <= 3.2 || mob.nosyApproach.until <= 0) {
        // one voice at a time: if the parish is mid-natter she greets silently instead
        // (turns, pauses, gets on) — a nod, not another bark on top.
        if (!mob.bubble) this.speakAmbient(mob, villagerRemark({ role: mob.role, mood: mob.mood, nearBuild: mob.nosyApproach.build, outside: !mob.village, evening: latening }, Math.random), 8);
        mob.nosyApproach = null; mob.state = 'greet'; mob.stateTimer = 1.5;
        if (this.nosyToken === mob) this.nosyToken = null;
      }
```

- [ ] **Step 5: Run the verify script**

Run: `node scripts/verify-etiquette.mjs`
Expected: only the roster.js assertion still FAILs.

- [ ] **Step 6: Commit**

```bash
git add src/entities.js
git commit -m "feat(etiquette): global ambient-speech gate + silent greet fallback in entities"
```

---

### Task 4: Banter respects the gate near the player

**Files:**
- Modify: `src/roster.js:638-643` (the NPC-to-NPC natter speaks)

- [ ] **Step 1: Route near-player banter through speakAmbient**

The banter exchange calls `this.game.entities.speak(A, r1.reply, 6)` (roster.js:638) and `...speak(B, r2.reply, 6)` (roster.js:643). Replace both call sites so banter within earshot of the player uses the gate (far-off banter is inaudible set-dressing and may speak freely):

```js
      const _nearPlayer = (m) => {
        const p = this.game.player && this.game.player.pos;
        return p && Math.hypot(m.pos.x - p.x, m.pos.z - p.z) < 18;
      };
      const _banterSpeak = (m, text) =>
        _nearPlayer(m) ? this.game.entities.speakAmbient(m, text, 6)
                       : (this.game.entities.speak(m, text, 6), true);
```

Insert those two helpers just above the line 638 call, then change line 638 to:

```js
      if (!_banterSpeak(A, r1.reply)) return;   // parish is mid-natter — let this one lapse
```

and the line 643 speak to:

```js
      if (!this._stopped && !B.dead && r2 && r2.reply) { this._faceEachOther(B, A); _banterSpeak(B, r2.reply); }
```

- [ ] **Step 2: Run the verify script — all green**

Run: `node scripts/verify-etiquette.mjs`
Expected: `verify-etiquette: NN assertions OK`

- [ ] **Step 3: Commit**

```bash
git add src/roster.js
git commit -m "feat(etiquette): banter near the player waits its turn"
```

---

### Task 5: Full gate + in-browser sanity

- [ ] **Step 1: Run the full headless gate**

Run: `npm run verify`
Expected: all scripts green, including the new `verify-etiquette` (the runner globs `scripts/verify-*.mjs`; confirm it appears in the output list). If `verify-villagers` fails on villagerlife exports, fix forward — the new exports are additive so it should not.

- [ ] **Step 2: In-browser spot check**

Start the dev server (preview tools, config `moorcraft-dev`). On the title screen click "New Single-Player World". Then: `moorstead.debug.warp('Grosmont')`, stand in the village 60s. Confirm: at most one speech bubble at a time near you; villagers who approach during the quiet window turn to face you without a bubble; open a chat (T) and confirm nobody approaches while it is open.

- [ ] **Step 3: Commit anything amended, no deploy yet**

Deploy rides with Workstream A (single version bump), per the program sequencing.
