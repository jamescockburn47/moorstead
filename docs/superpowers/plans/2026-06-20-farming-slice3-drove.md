# Farming Slice 3 — The Drove + Market Sale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A registered farmer musters a penned flock into a mobile herd, droves it (dog + whistles, Slice 1 mechanics) overland to the Moorstead mart, loses head if it strays or is preyed on at night, and sells what arrives for **120d/head** — the most lucrative sale in the game.

**Architecture:** Reuses Slice 1's herding wholesale. Two surgical changes to `entities.js` let the dog drive the player's *own* sheep once "mustered" (`droving` flag): include them in the flock, and stop them auto-following the player so they can be driven and can stray. A pure `livestockPrice`/`droveValue` in `economy.js` (headless-tested, incl. the income-gradient inequality). A throttled drove-risk pass loses strayed/strung-out head. The sale lives on the Moorstead parish board beside registration. Persistence is free: muster flips only the *live mob*, never the saved `pets` record, so a reload reverts an in-progress drove to penned (the spec's "safest").

**Tech Stack:** Vanilla ES modules. Headless tests are plain Node (`scripts/verify-farm.mjs`, extended). Build is Vite.

**Deploy note:** Still held. Slices 2 + 3 deploy together, *after* world regeneration lands (James's sequence, 2026-06-20). This plan ends at "verified + committed locally."

---

## Design choices baked in — FLAG FOR JAMES'S REVIEW

The economic payout (120d/head) is locked. These three are my proposed defaults for the *mechanics*; easy to change, each isolated to one task:

1. **Muster trigger = `KeyG`** ("gather for market"), with a crosshair hint, gated on being a registered farmer with a working dog present. (`KeyM` is taken by mute.) Alternative: right-click a penned sheep.
2. **Sell on the Moorstead parish board** (`ui.openBoard`, where registration already lives) — certain to be at Moorstead and co-locates all "farm business." The spec says "beside the Goods Market boards"; this is a near-equivalent, reliable surface. Alternative: the station Goods-Market tab (only if Moorstead is a rail station — unverified).
3. **Risk model = stray/predation on *strung-out* head** (distance from the player), not new predator-vs-sheep pathfinding: a droving sheep more than ~22m from you accumulates a stray timer and is lost (by day it wanders off; at night, faster, and a nearby barghest claims it). "Keep them bunched, move by day" emerges from the existing AI. **Rates are tuning defaults — confirm live with James, like the payout.**

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/economy.js` | modify | `LIVESTOCK_PRICE`, `livestockPrice()`, `droveValue()` |
| `scripts/verify-farm.mjs` | modify | extend with drove pricing + the gradient inequality |
| `src/main.js` | modify | `KeyG` muster handler, `musterFlock()`, `sellDrove()`, crosshair cues, economy import |
| `src/entities.js` | modify | `herd()` drives `droving` owned sheep; exclude them from auto-follow; re-pen guard; the drove-risk pass; `droveHeadNear()` helper |
| `src/ui.js` | modify | "Sell thi droved flock" on the parish board |
| `src/milestones.js` | modify | `first_drove` rung |
| `src/ui.js` (handbook) | modify | "Drovin' to market" subsection in Sheepdog & Flock |
| `public/about.html` | modify | droving paragraph (James's voice, NO em-dashes) |

---

## Task 1: Livestock pricing + the income-gradient test (pure)

**Files:**
- Modify: `src/economy.js` (after the `farmRegisterCheck` block from Slice 2)
- Modify: `scripts/verify-farm.mjs` (add a drove section)

- [ ] **Step 1: Write the failing test** — append to `scripts/verify-farm.mjs`, just before the final `console.log('RESULT: ...')` line:

```js
// --- Slice 3: livestock pricing + the income gradient ---
import { LIVESTOCK_PRICE, livestockPrice, droveValue, priceOf } from '../src/economy.js';
import { I } from '../src/defs.js';
{
  (LIVESTOCK_PRICE === 120 ? ok : bad)('livestock price is a flat 120d (10s) per head');
  (livestockPrice(0) === 120 ? ok : bad)('per-head at standing 0 is 120d');
  (livestockPrice(5) > livestockPrice(0) ? ok : bad)('standing lifts the per-head price');
  (droveValue(5, 0) === 600 ? ok : bad)('a 5-head drove = £2 10s (600d)');
  (droveValue(8, 0) === 960 ? ok : bad)('an 8-head drove = £4 (960d)');
  (droveValue(0, 0) === 0 ? ok : bad)('no head delivered = no pay');
  // the gradient inequality: even a minimum 5-head drove tops the best reliable coal rail haul
  const coalHaul = 96 * priceOf(I.COAL_LUMP, 'whitby', 'sell', 0);
  (droveValue(5, 0) > coalHaul ? ok : bad)(`5-head drove (${droveValue(5,0)}) tops a 96-coal rail haul (${coalHaul})`);
}
```

Note: ES module `import`s hoist to the top regardless of where they're written, so this runs fine appended near the end.

- [ ] **Step 2: Run it, expect FAIL**

Run: `node scripts/verify-farm.mjs`
Expected: crash — `does not provide an export named 'LIVESTOCK_PRICE'`.

- [ ] **Step 3: Implement in `src/economy.js`** — after the `farmRegisterCheck` function (Slice 2 block):

```js
// --- Slice 3: the drove — live-animal market value (signed off 2026-06-20) ---
export const LIVESTOCK_PRICE = 120; // flat 10s per head at the Moorstead mart; NOT wool-spread-derived

// Per-head live price, lifted only by farm standing (reuses the ±2%/idx loyalty curve).
export function livestockPrice(standingIdx = 0) {
  return Math.max(1, Math.round(LIVESTOCK_PRICE * (1 + 0.02 * standingIdx)));
}

// Total brass for a droved flock delivered to the mart: pays per head that ARRIVES.
export function droveValue(head, standingIdx = 0) {
  return Math.max(0, Math.floor(head)) * livestockPrice(standingIdx);
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `node scripts/verify-farm.mjs`
Expected: all `ok`, `RESULT: PASS`.

- [ ] **Step 5: Full suite + commit**

Run: `npm run verify` (expect 14 checks all PASS — verify-farm is unchanged in count, just richer).

```bash
git add src/economy.js scripts/verify-farm.mjs
git commit -m "feat(drove): livestock price + drove value + gradient test (Slice 3)"
```

---

## Task 2: Drive the player's own sheep + re-pen guard (entities.js)

This is the core integration. Three surgical edits.

**Files:** Modify `src/entities.js`

- [ ] **Step 1: Include mustered (droving) owned sheep in the herded flock**

In `herd()` (entities.js:1278), change the flock filter:

```js
    const flock = this.mobs.filter(m => m && !m.dead && (!m.owner || m.droving) && m.type === 'sheep' &&
      Math.hypot(m.pos.x - dog.pos.x, m.pos.z - dog.pos.z) < HERD_RADIUS);
```

- [ ] **Step 2: Stop droving sheep auto-following the player**

In the movement tree (entities.js:1441), exclude droving sheep from the follow case so they fall through to herd/wander (driveable, and able to stray):

```js
      } else if (((mob.owner && !mob.droving) || t.follower) && distP < (mob.owner ? FOLLOW_RANGE : 26) && !player.dead) {
```

- [ ] **Step 3: Re-pen guard — an already-owned sheep driven into a fold re-anchors without duplicating its record**

In `herd()`'s pen-settle loop (entities.js:1311-1318), replace the body of the `for (const m of flock)` block that handles a sheep crossing into the fold so it branches on ownership. Replace from `const name = chooseName(...)` through the closing of the per-sheep block with:

```js
        if (m.owner) {
          // a droved-back beast settling home again — re-anchor, don't re-register
          m.stay = true; m.droving = false; m.home = { x: m.pos.x, y: m.pos.y, z: m.pos.z }; m.herding = false;
          const rec = (player.pets || []).find(p => p.name === m.petName);
          if (rec) { rec.stay = true; rec.home = { ...m.home }; }
          continue;
        }
        const name = chooseName(Math.random, (player.pets || []).map(p => p.name));
        this.makeCompanion(m, name);
        m.stay = true; m.home = { x: m.pos.x, y: m.pos.y, z: m.pos.z }; m.herding = false;
        (player.pets || (player.pets = [])).push({ kind: 'sheep', name, stay: true, home: { ...m.home } });
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

(The `if (m.owner) {...continue}` branch is the only new part; the rest is the existing Slice 2 body, shown in full because the engineer may read tasks out of order.)

- [ ] **Step 4: Build + commit**

Run: `npm run build` (expect success).

```bash
git add src/entities.js
git commit -m "feat(drove): a working dog drives mustered owned sheep + re-pen guard (Slice 3)"
```

---

## Task 3: Muster — release penned stock into a droving herd (main.js)

**Files:** Modify `src/main.js` (economy import already extended in Slice 2; add `droveValue`, `livestockPrice` for the sale in Task 5 — add them here)

- [ ] **Step 1: Extend the economy import** (main.js:14) to add the drove helpers:

```js
import { Economy, bestMarket, FREIGHT_ALLOWANCE, farmRegisterCheck, CHARTER_FEE, livestockPrice, droveValue } from './economy.js';
```

- [ ] **Step 2: Add `musterFlock()`** near the farm helpers (after `registerFarm()`):

```js
  // ---- Slice 3: the drove ----
  // Muster the penned stock near thee into a mobile, driveable herd (KeyG). Registered farmers only;
  // needs a working dog to actually drive them. Flips only the LIVE mobs — the saved pets records keep
  // stay+home, so a reload reverts an in-progress drove to penned (safest).
  musterFlock() {
    if (!this.player.farmStatus.registered) {
      this.ui.toast('Tha registers a farm at <b>Moorstead</b> first, then tha can drove thi flock.', 5000);
      return;
    }
    const dog = this.entities.mobs.find(m => m && !m.dead && m.owner && m.type === 'dog');
    if (!dog) { this.ui.toast('Tha needs a <b>working dog</b> to drove a flock.', 4000); return; }
    const p = this.player.pos;
    let n = 0;
    for (const m of this.entities.mobs) {
      if (!m || m.dead || !m.owner || m.type !== 'sheep' || !m.stay) continue;
      if (Math.hypot(m.pos.x - p.x, m.pos.z - p.z) > 20) continue;
      m.stay = false; m.droving = true; m.herding = false; n++;
    }
    if (!n) { this.ui.toast('No penned stock close by to muster. Stand by thi fold.', 4000); return; }
    this.ui.toast(`🐑 <b>Mustered ${n} head.</b> Drove ’em to <b>Moorstead’s mart</b> wi’ thi dog — keep ’em bunched.`, 6000);
  }
```

- [ ] **Step 3: Bind `KeyG`** in the `playing`-state keydown handler. After the `KeyM` mute line (main.js:464):

```js
        if (e.code === 'KeyG') { this.musterFlock(); return; }
```

- [ ] **Step 4: Build + commit**

Run: `npm run build`.

```bash
git add src/main.js
git commit -m "feat(drove): muster penned stock into a driveable herd, KeyG (Slice 3)"
```

---

## Task 4: En-route risk — strays + night predation (entities.js)

**Files:** Modify `src/entities.js` (a new pass in `updateMobs`, called where `isNight` is in scope)

- [ ] **Step 1: Add the drove-risk pass.** In `updateMobs(dt, player, isNight, audio)`, right after `this.herd(dt, player);` (entities.js:1360):

```js
    this.droveRisk(dt, player, isNight);
```

- [ ] **Step 2: Implement `droveRisk()`** as a method on `Entities` (place near `herd()`):

```js
  // En-route risk: a droving sheep strung out far from thee strays off — slow by day, fast at
  // neet, and a barghest in the dark will have her. Bunched + daytime = safe. You're paid for
  // what ARRIVES; never a hard fail. (All four numbers are tuning — confirm live with James.)
  droveRisk(dt, player) {
    const STRAY_DIST = 22;        // strung-out threshold (m from the player)
    const GRACE_DAY = 10;         // seconds strung out before a daytime stray is lost
    const GRACE_NIGHT = 4;        // … much less after dark
    const BARGHEST_REACH = 12;    // a night-thing this close to a strayed beast takes her at once
    const night = this.game && this.game.sky && this.game.sky.isNight();
    for (const m of this.mobs) {
      if (!m || m.dead || !m.droving) continue;
      const d = Math.hypot(m.pos.x - player.pos.x, m.pos.z - player.pos.z);
      if (d <= STRAY_DIST) { m.strayT = 0; continue; }
      m.strayT = (m.strayT || 0) + dt;
      let lost = m.strayT > (night ? GRACE_NIGHT : GRACE_DAY);
      let toBarghest = false;
      if (night && !lost) {
        for (const h of this.mobs) {
          if (h.dead || h.type !== 'barghest') continue;
          if (Math.hypot(h.pos.x - m.pos.x, h.pos.z - m.pos.z) < BARGHEST_REACH) { lost = true; toBarghest = true; break; }
        }
      }
      if (lost) {
        if (player.pets) player.pets = player.pets.filter(p => p.name !== m.petName);
        m.dead = true; this.scene.remove(m.model.group);
        if (this.game && this.game.ui) {
          this.game.ui.toast(toBarghest
            ? `🐺 A barghest had <b>${m.petName}</b> out o’ thi flock in t’ dark.`
            : `<b>${m.petName}</b> strayed off on t’ moor — gone frae thi drove.`, 5000);
        }
      }
    }
  }
```

- [ ] **Step 3: Build + commit**

Run: `npm run build`.

```bash
git add src/entities.js
git commit -m "feat(drove): en-route risk — strays + night predation on a strung-out flock (Slice 3)"
```

---

## Task 5: The yard sale at the Moorstead mart (ui.js + main.js)

**Files:** Modify `src/main.js` (`sellDrove()`, a `droveHeadNear()` helper), `src/ui.js` (board entry)

- [ ] **Step 1: Add `droveHeadNear()` + `sellDrove()`** to `main.js` (after `musterFlock()`):

```js
  // Droving sheep within the mart yard (near thee). Used by the board to offer the sale.
  droveHeadNear() {
    const p = this.player.pos;
    return this.entities.mobs.filter(m => m && !m.dead && m.droving && m.type === 'sheep' &&
      Math.hypot(m.pos.x - p.x, m.pos.z - p.z) <= 25);
  }

  // Sell every droved head in the yard: pays per head, leads them off, drops them from thi stock.
  sellDrove() {
    if (!this.atMarketTown()) { this.ui.toast('Tha sells a droved flock at <b>Moorstead’s mart</b>.', 4000); return false; }
    const herd = this.droveHeadNear();
    if (!herd.length) { this.ui.toast('Tha’s no flock in t’ yard to sell. Drove ’em in first.', 4000); return false; }
    const pay = droveValue(herd.length, this.economy.standing());
    for (const m of herd) {
      if (this.player.pets) this.player.pets = this.player.pets.filter(p => p.name !== m.petName);
      m.dead = true; this.entities.scene.remove(m.model.group);
    }
    this.economy.earn(pay);
    this.ui.toast(`💷 <b>Sold ${herd.length} head at Moorstead mart for ${this.economy.format(pay)}.</b>`, 7000);
    if (this.milestones) this.milestones.fire('first_drove');
    if (this.saveNow) this.saveNow(false);
    return true;
  }
```

- [ ] **Step 2: Offer the sale on the parish board.** In `ui.openBoard` (the Slice 2 "Become a Farmer" block), inside the `if (fs.registered) { ... }` branch, after the "registered farmer" line, add the sale offer:

```js
        const g2 = this.game;
        const inYard = g2.atMarketTown() ? g2.droveHeadNear().length : 0;
        if (inYard > 0) {
          const pay = g2.economy.format(droveValue(inYard, g2.economy.standing()));
          const row = this.el('div', 'recipe quest-row', this.boardPanel);
          row.innerHTML = `<div class="r-name"><b>Sell thi droved flock</b><br><span class="r-needs">${inYard} head in t&rsquo; yard &mdash; fetches <b>${pay}</b></span></div>`;
          const sb = this.el('button', 'mc chat-btn trade-btn', row, 'Sell at t’ mart');
          sb.addEventListener('click', () => { if (g2.sellDrove()) this.openBoard(fromBoard); });
        }
```

This needs `droveValue` imported in ui.js — extend the Slice 2 economy import (ui.js):

```js
import { FARM_THRESHOLD, CHARTER_FEE, farmRegisterCheck, droveValue } from './economy.js';
```

- [ ] **Step 3: Build + commit**

Run: `npm run build`.

```bash
git add src/main.js src/ui.js
git commit -m "feat(drove): sell the droved flock at the Moorstead mart (Slice 3)"
```

---

## Task 6: Legibility — milestone, crosshair cues, handbook, about.html

**Files:** Modify `src/milestones.js`, `src/main.js` (crosshair), `src/ui.js` (handbook), `public/about.html`

- [ ] **Step 1: Milestone rung.** In `src/milestones.js` `MILESTONES`, after `farm_registered:`:

```js
  first_drove:     'Tha droved a flock to market! That’s t’ best brass on t’ moor — an’ tha can do it again.',
```

- [ ] **Step 2: Crosshair cues.** Find the crosshair-hint builder in `main.js` (grep for the existing dog-command / taming hint — search `come-bye` or `crosshair`). Add, in the same place those hints are assembled:
  - When a registered farmer stands near penned stock with a working dog and nothing is mustered: `Press G to muster thi flock for market`.
  - While any sheep is `droving`: `Drove thi flock to Moorstead’s mart — keep ’em bunched`.

Concrete predicate helpers already exist (`this.farmHeadCount()`, `this.atMarketTown()`); add the cue strings next to the existing dog-whistle reminder using the same toast/hint channel. (The exact hint plumbing is local to the existing crosshair code — match its pattern; do not invent a new HUD element.)

- [ ] **Step 3: Handbook subsection.** In `ui.js` `buildHowSections()` `'Sheepdog & Flock'`, after the "Becomin' a registered farmer" `</ul>` (added in Slice 2), insert:

```html
<h3>Drovin&rsquo; to market</h3>
<ul>
<li>A registered farmer can <b>muster</b> a penned flock (<b>G</b>, stood by thi fold) into a drove, then <b>drive ’em to t’ Moorstead mart</b> wi’ thi dog — same whistles as ever.</li>
<li><b>Sell t’ live flock</b> at t’ Moorstead notice board for <b>10s a head</b> — t’ best brass on t’ moor, far more than wool an’ mutton sold piecemeal.</li>
<li><b>Keep ’em bunched an’ move by day.</b> A beast strung out on t’ moor strays off — an’ after dark t’ <b>barghest</b> teks ’em. Tha’s paid for what gets there.</li>
</ul>
```

- [ ] **Step 4: about.html.** Grep `public/about.html` for the existing farm/penning sentence (search `penned` or `sheepdog`). After that paragraph, add one paragraph in James's first-person voice, **plain English, NO em-dashes, no AI tells**:

```html
<p>Once you have five head penned you can register a farm at the Moorstead notice board for a pound. After that you can muster the flock, drove it across the moor to the Moorstead mart with your dog, and sell the live animals there. It pays far better than wool and mutton, but a flock that strings out will lose stragglers to the moor and to the barghest after dark, so keep them together and travel by day.</p>
```

- [ ] **Step 5: Build + commit**

Run: `npm run build`.

```bash
git add src/milestones.js src/main.js src/ui.js public/about.html
git commit -m "docs(drove): milestone, crosshair cues, handbook + about.html droving (Slice 3)"
```

---

## Task 7: Full local verification (deploy held)

**Files:** none

- [ ] **Step 1: Headless + build green**

Run: `npm run verify` (14 checks PASS, incl. the drove pricing + gradient inequality) and `npm run build` (clean).

- [ ] **Step 2: Drive the live preview.** Start `npm run dev`; in the console reproduce the Slice 2 entry (loginGuest → newWorld → pump ~550 frames in two batches until `state==='playing'`), then:

```js
const g = window.game;
// be a registered farmer at Moorstead with a dog and 6 penned sheep
g.player.farmStatus = { registered: true };
moorstead && moorstead.warp ? moorstead.warp('Moorstead') : null;
// spawn a working dog companion + 6 penned sheep near the player via restorePets
g.player.pets = [{kind:'dog',name:'Moss'}, ...Array.from({length:6},(_,i)=>({kind:'sheep',name:'D'+i,stay:true,home:{x:g.player.pos.x+i,y:g.player.pos.y,z:g.player.pos.z}}))];
g.entities.mobs = g.entities.mobs.filter(m=>!m.owner); // clear any prior companions
g.entities.restorePets(g.player.pets, g.player);
for (let i=0;i<60;i++) g.frame();
g.musterFlock();
g.frame();
({ droving: g.entities.mobs.filter(m=>m.droving).length, head: g.farmHeadCount() });
```

Confirm `musterFlock()` flips 6 sheep to `droving` and toasts. (`farmHeadCount()` still counts them — records untouched — which is correct: the drove reverts to penned on reload.)

- [ ] **Step 3: Sell the drove.** With the droving sheep near the player at Moorstead:

```js
const before = g.economy.balance;
const ok = g.sellDrove();
({ ok, paid: g.economy.balance - before, drovingLeft: g.entities.mobs.filter(m=>m.droving&&!m.dead).length, petsLeft: g.player.pets.filter(p=>p.kind==='sheep').length });
```

Confirm `ok===true`, `paid===720` (6 × 120), no droving sheep left, and the 6 sheep records are gone from `pets`.

- [ ] **Step 4: Risk (strays).** Muster a fresh set, walk/teleport the player ~30m away, pump frames > the day grace, confirm a strung-out sheep is dropped from the drove with a toast and removed from `pets`. (Keep the player in one loaded area — don't teleport mid-herd repeatedly; see the handoff's herding test trap.)

- [ ] **Step 5: Reload reverts an in-progress drove.** Muster, `g.saveNow(true)`, reload, re-enter the world; confirm the sheep are back **penned** (`stay`, at home) and `droving` is empty — the spec's safest behaviour, free from the record-untouched design.

- [ ] **Step 6: Console clean.** `preview_console_logs` level error → none.

- [ ] **Step 7: Report; do NOT deploy.** Summarise to James, including the realised income gradient (a full drove vs a coal rail haul) and the risk feel. Deploy stays held for the joint farming+regeneration release.

---

## Self-Review

**Spec coverage (§5 / §9 / §10):**
- Muster off the fold as a mobile herd → Task 3 (`musterFlock`) + Task 2 (drove integration). ✓
- Drove with Slice 1 dog/whistles → Task 2 (`herd()` includes `droving`). ✓
- 120d/head, paid per head delivered, standing-lifted → Task 1 (`livestockPrice`/`droveValue`), Task 5 (`sellDrove`). ✓
- Sell-on-delivery yard, instant, led off → Task 5. ✓
- Risk: stray + barghest at night, never a hard fail, paid for what arrives → Task 4. ✓
- Reload reverts to penned (safest) → free from the muster-flips-mob-not-record design; verified Task 7 Step 5. ✓
- Income gradient ends drop-in < rail < drove → Task 1 inequality test. ✓
- Legibility (milestone, crosshair, handbook, about.html) → Task 6. ✓

**Placeholder scan:** Task 6 Step 2 (crosshair) points at the existing hint plumbing rather than quoting it (the exact code wasn't read); the cue strings + predicates are given. All other steps carry full code.

**Type consistency:** `m.droving` flag, `livestockPrice(standingIdx)`, `droveValue(head, standingIdx)`, `droveHeadNear()`, `sellDrove()`, `musterFlock()` used consistently across economy.js, main.js, entities.js, ui.js. `pets` records matched/removed by `name` throughout (muster never touches records; loss + sale filter by `p.name !== m.petName`).

**Flagged for review:** the three design choices at the top (muster trigger, sell surface, risk defaults). The risk rates are the live-tuning knob, like the payout.
