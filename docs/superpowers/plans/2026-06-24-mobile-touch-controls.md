# Mobile & Tablet Touch Controls — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full touch controls for the core gameplay loop (plus a "More" menu for the long tail) on phones/tablets, auto-shown on touch devices, with responsive menu/HUD layout — without disturbing the desktop input path.

**Architecture:** A new `src/touch.js` `TouchControls` class is an **input adapter**: it renders a DOM HUD over the canvas and, from touch gestures, writes to the SAME input bus the keyboard/mouse already feed (`game.keys`, `game.input.jumpTapped`, `game.mouseDown`, `player.yaw/pitch`, `player.hotbar`) and calls existing action methods. Movement/mining/physics code is untouched. All gesture→signal logic lives in pure, exported, headlessly-tested helpers; the DOM is thin glue.

**Tech Stack:** Vanilla ES modules + three.js (no framework), DOM overlay, CSS `@media`, headless Node assertion scripts (`scripts/verify-*.mjs`).

**Spec:** [docs/superpowers/specs/2026-06-24-mobile-touch-controls-design.md](../specs/2026-06-24-mobile-touch-controls-design.md)

**The input bus (verified):**
- `game.keys = {}` (main.js:90); `game.input = { keys: game.keys, jumpTapped }` (main.js:703) — what `player.update(dt, input, …)` reads (main.js:3782).
- `player.update` reads `keys.KeyW/KeyA/KeyS/KeyD`, `keys.KeyZ` (sprint), `keys.ShiftLeft` (sneak/fly-down), `keys.Space` (jump/fly-up), `input.jumpTapped` (player.js:94-149).
- `game.mouseDown = [l,m,r]` (main.js:91). `updateMining` polls `mouseDown[0]` each frame (main.js:2937); place-repeat polls `mouseDown[2]` (main.js:3967).
- Look (mirror `mousemove`, main.js:675-678): `player.yaw -= dx*sens; player.pitch -= dy*sens;` clamp pitch to `±(Math.PI/2 - 0.01)`.
- Actions on `game`: `openInventory()`, `openChat(v)`, `openBoard(false)`, `leaveBoat()`, `dismountPony()`, `trySleep()`, `musterFlock()`, `setRideView('seat'|'driver'|'overhead')`, `leaveDrive()`, `shovelCoal()`, `villagerInView()`, `attackOrMine(true)`, `useItem()`, `audio.setMuted(b)`.

**Testing seam:** `touch.js` must do NO DOM access at module load (only inside class methods), so `verify-touch.mjs` can import the pure helpers under Node. Helpers take injected `matchMedia`/`navigator` so detection is testable.

---

## Task 1: Pure gesture→signal helpers (TDD, headless)

**Files:**
- Create: `src/touch.js` (helpers only this task)
- Create: `scripts/verify-touch.mjs`
- Modify: `package.json` (add to the `verify` script)

- [ ] **Step 1: Write the failing test**

Create `scripts/verify-touch.mjs`:

```javascript
// Headless: the pure gesture->signal helpers. No DOM (touch.js must not touch document at import).
import assert from 'node:assert';
import { joystickToKeys, lookDelta, isTouchPrimary, touchMode } from '../src/touch.js';

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// joystickToKeys: dy<0 is "pushed up" = forward (KeyW). radius 40.
const R = 40;
const center = joystickToKeys(0, 0, R);
ok(!center.KeyW && !center.KeyA && !center.KeyS && !center.KeyD && !center.KeyZ, 'centre/deadzone -> nothing pressed');
ok(!joystickToKeys(0, -5, R).KeyW, 'inside deadzone (5 < 0.18*40) -> not forward');
const up = joystickToKeys(0, -20, R);
ok(up.KeyW && !up.KeyS && !up.KeyA && !up.KeyD && !up.KeyZ, 'half-up -> forward only, no sprint');
const fullUp = joystickToKeys(0, -40, R);
ok(fullUp.KeyW && fullUp.KeyZ, 'full-up (mag >= 0.85*40) -> forward + sprint');
const upRight = joystickToKeys(28, -28, R);
ok(upRight.KeyW && upRight.KeyD && !upRight.KeyA && !upRight.KeyS, 'up-right -> forward + right (diagonal)');
const down = joystickToKeys(0, 30, R);
ok(down.KeyS && !down.KeyW, 'pushed down -> back');
const left = joystickToKeys(-30, 0, R);
ok(left.KeyA && !left.KeyD, 'pushed left -> strafe left');

// lookDelta: yaw/pitch deltas the CALLER subtracts (mirrors mousemove). sens 0.0042.
const ld = lookDelta(100, 50, 0.0042);
ok(Math.abs(ld.dYaw - 0.42) < 1e-9 && Math.abs(ld.dPitch - 0.21) < 1e-9, 'lookDelta scales by sens');

// isTouchPrimary: coarse + no-hover => true; a fine pointer => false.
const mmTrue = (q) => ({ matches: q.includes('coarse') || q.includes('none') });
const mmFine = (q) => ({ matches: q.includes('fine') || q.includes('hover') && !q.includes('none') });
ok(isTouchPrimary(mmTrue, { maxTouchPoints: 5 }) === true, 'coarse + no-hover -> touch primary');
ok(isTouchPrimary((q) => ({ matches: q.includes('fine') }), { maxTouchPoints: 0 }) === false, 'fine pointer, no touch -> not primary');

// touchMode: explicit on/off override auto.
ok(touchMode('on', false) === true, 'mode on -> always touch');
ok(touchMode('off', true) === false, 'mode off -> never touch');
ok(touchMode('auto', true) === true && touchMode('auto', false) === false, 'mode auto -> follows detection');

console.log(`verify-touch: ${n} assertions OK`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/verify-touch.mjs`
Expected: FAIL — `src/touch.js` does not exist / does not export the helpers.

- [ ] **Step 3: Write minimal implementation**

Create `src/touch.js`:

```javascript
// touch.js — touch-screen controls for phones & tablets. An INPUT ADAPTER: it renders a DOM HUD
// over the canvas and writes to the same input bus the keyboard/mouse feed, so the desktop path is
// untouched. The gesture->signal logic lives in these pure helpers (headlessly tested); the class
// below is thin DOM glue. NO module-level DOM access — verify-touch.mjs imports this under Node.

const DEADZONE = 0.18;   // fraction of joystick radius below which we read no movement
const SPRINT_AT = 0.85;  // fraction of radius beyond which a forward push also sprints
export const LOOK_SENS = 0.0042;  // touch look sensitivity (mouse is 0.0023; touch wants more)

// Joystick knob offset (dx,dz screen px; dy<0 = pushed up = forward) -> WASD+sprint booleans.
// 8-way: an octant around the push angle sets one or two of W/A/S/D.
export function joystickToKeys(dx, dy, radius) {
  const out = { KeyW: false, KeyA: false, KeyS: false, KeyD: false, KeyZ: false };
  const mag = Math.hypot(dx, dy);
  if (mag < DEADZONE * radius) return out;
  const ang = Math.atan2(-dy, dx);            // -dy so "up" (negative screen y) is +90deg = forward
  const deg = (ang * 180 / Math.PI + 360) % 360;
  if (deg > 22.5 && deg < 157.5) out.KeyW = true;     // forward arc
  if (deg > 202.5 && deg < 337.5) out.KeyS = true;    // back arc
  if (deg > 112.5 && deg < 247.5) out.KeyA = true;    // left arc
  if (deg < 67.5 || deg > 292.5) out.KeyD = true;     // right arc
  if (mag >= SPRINT_AT * radius && out.KeyW) out.KeyZ = true;
  return out;
}

// Drag delta (screen px) -> yaw/pitch deltas the CALLER subtracts (player.yaw -= dYaw, etc.).
export function lookDelta(dx, dy, sens = LOOK_SENS) {
  return { dYaw: dx * sens, dPitch: dy * sens };
}

// Is touch the PRIMARY pointer? mm = matchMedia fn, nav = navigator-like. Injected for tests.
export function isTouchPrimary(mm, nav) {
  const coarse = mm('(pointer: coarse)').matches;
  const noHover = mm('(hover: none)').matches;
  const fine = mm('(pointer: fine)').matches;
  if (coarse && noHover) return true;
  return (nav.maxTouchPoints || 0) > 0 && !fine;
}

// Resolve the stored mode ('auto'|'on'|'off') against detection.
export function touchMode(stored, isPrimary) {
  if (stored === 'on') return true;
  if (stored === 'off') return false;
  return !!isPrimary;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/verify-touch.mjs`
Expected: PASS — `verify-touch: 14 assertions OK` (or similar count).

- [ ] **Step 5: Add to the verify suite**

In `package.json`, append ` && node scripts/verify-touch.mjs` to the end of the `"verify"` script string.

Run: `npm run verify`
Expected: PASS — all scripts including `verify-touch`.

- [ ] **Step 6: Commit**

```bash
git add src/touch.js scripts/verify-touch.mjs package.json
git commit -m "feat(touch): pure gesture->signal helpers + verify-touch"
```

---

## Task 2: TouchControls skeleton — detect, mount, overlay root, wiring

**Files:**
- Modify: `src/touch.js` (add the class)
- Modify: `src/main.js` (instantiate, gate pointer-lock, tick hook)

No new headless test (DOM/integration); verified by `npm run build` + the live check in Task 9.

- [ ] **Step 1: Add the class skeleton to `src/touch.js`**

Append to `src/touch.js`:

```javascript
const MODE_KEY = 'moorcraft-touch';   // localStorage: 'auto' | 'on' | 'off'

export class TouchControls {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.root = null;
    this.zones = {};      // joystick / look zone elements
    this.btns = {};       // button elements by name
    this._mode = localStorage.getItem(MODE_KEY) || 'auto';
  }

  // Should the touch HUD be on right now? (mode override vs device detection)
  wanted() {
    const primary = isTouchPrimary(q => window.matchMedia(q), navigator);
    return touchMode(this._mode, primary);
  }

  // Build (or tear down) the HUD to match wanted(). Idempotent — safe to call repeatedly.
  sync() {
    if (this.wanted() && !this.active) this._build();
    else if (!this.wanted() && this.active) this._destroy();
  }

  cycleMode() {   // pause-menu toggle: auto -> on -> off -> auto
    this._mode = this._mode === 'auto' ? 'on' : this._mode === 'on' ? 'off' : 'auto';
    localStorage.setItem(MODE_KEY, this._mode);
    this.sync();
    return this._mode;
  }

  _build() {
    this.active = true;
    document.documentElement.classList.add('touch');
    const root = document.createElement('div');
    root.id = 'touchHud';
    root.className = 'touch-hud';
    document.getElementById('app').appendChild(root);
    this.root = root;
    // controls are added by later tasks via this._buildMove(), this._buildButtons(), etc.
    this._buildMove?.();
    this._buildLook?.();
    this._buildButtons?.();
    this._buildTop?.();
    this._buildContext?.();
    this.setState?.(this.game.state);
  }

  _destroy() {
    this.active = false;
    document.documentElement.classList.remove('touch');
    if (this.root) { this.root.remove(); this.root = null; }
    this.zones = {}; this.btns = {};
    this.game.clearKeys?.();   // don't leave any synthesised key stuck
  }

  // Per-frame hook (called from game.frame). Cheap; only does work when active.
  tick() {
    if (!this.active) return;
    this.setState?.(this.game.state);
    this.refreshContext?.();
  }

  // A small helper used by later tasks to make a labelled round button.
  _btn(name, label, cls) {
    const b = document.createElement('button');
    b.className = 'touch-btn ' + (cls || '');
    b.dataset.touch = name;
    b.innerHTML = label;
    b.addEventListener('contextmenu', e => e.preventDefault());
    this.root.appendChild(b);
    this.btns[name] = b;
    return b;
  }
}
```

- [ ] **Step 2: Wire it into `src/main.js`**

After the input setup (near main.js:703 where `this.input` is created), add:

```javascript
    this.touch = new TouchControls(this);
    this.touch.sync();
    window.addEventListener('resize', () => this.touch.sync());
```

Add the import at the top of `main.js` (with the other `./` imports):

```javascript
import { TouchControls } from './touch.js';
```

- [ ] **Step 3: Gate pointer-lock on touch**

In the `mousedown` handler (main.js:665), change the lock line so touch never requests a lock:

```javascript
      if (document.pointerLockElement !== canvas) { if (!this.touch?.active) this.lockPointer(); return; }
```

In the `pointerlockchange` handler (main.js:688), don't pause when touch is driving:

```javascript
      if (document.pointerLockElement !== canvas && this.state === 'playing' && !this.touch?.active) {
        this.pause();
      }
```

- [ ] **Step 4: Add the per-frame tick**

In `frame()` (main.js:3650), near the other per-frame updates (e.g. just before/after `this.updateMining(dt)` at main.js:3964), add:

```javascript
      if (this.touch) this.touch.tick();
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: Vite build succeeds (touch.js imported, class instantiated, no unresolved symbols).

- [ ] **Step 6: Commit**

```bash
git add src/touch.js src/main.js
git commit -m "feat(touch): TouchControls skeleton, mount/detect + pointer-lock gating"
```

---

## Task 3: Movement joystick + look drag

**Files:**
- Modify: `src/touch.js` (add `_buildMove`, `_buildLook`)

- [ ] **Step 1: Add the move + look zones to `TouchControls`**

Add these methods to the class:

```javascript
  _buildMove() {
    const z = document.createElement('div');
    z.className = 'touch-zone touch-move';
    this.root.appendChild(z);
    this.zones.move = z;
    const knob = document.createElement('div');
    knob.className = 'touch-knob';
    z.appendChild(knob);
    let id = null, ox = 0, oy = 0;
    const RADIUS = 56;   // px the knob can travel
    const setKeys = (k) => { const g = this.game; for (const key of ['KeyW','KeyA','KeyS','KeyD','KeyZ']) g.keys[key] = !!k[key]; };
    const clear = () => { id = null; knob.style.transform = 'translate(0,0)'; setKeys({}); };
    z.addEventListener('touchstart', e => {
      if (id !== null || this.game.state !== 'playing') return;
      const t = e.changedTouches[0]; id = t.identifier; ox = t.clientX; oy = t.clientY;
      e.preventDefault();
    }, { passive: false });
    z.addEventListener('touchmove', e => {
      for (const t of e.changedTouches) {
        if (t.identifier !== id) continue;
        let dx = t.clientX - ox, dy = t.clientY - oy;
        const m = Math.hypot(dx, dy); if (m > RADIUS) { dx *= RADIUS / m; dy *= RADIUS / m; }
        knob.style.transform = `translate(${dx}px,${dy}px)`;
        setKeys(joystickToKeys(dx, dy, RADIUS));
        e.preventDefault();
      }
    }, { passive: false });
    const end = e => { for (const t of e.changedTouches) if (t.identifier === id) clear(); };
    z.addEventListener('touchend', end);
    z.addEventListener('touchcancel', end);
  }

  _buildLook() {
    const z = document.createElement('div');
    z.className = 'touch-zone touch-look';
    this.root.appendChild(z);
    this.zones.look = z;
    let id = null, lx = 0, ly = 0;
    const feeding = () => ['playing', 'riding', 'driving'].includes(this.game.state);
    z.addEventListener('touchstart', e => {
      if (id !== null || !feeding()) return;
      const t = e.changedTouches[0]; id = t.identifier; lx = t.clientX; ly = t.clientY;
      e.preventDefault();
    }, { passive: false });
    z.addEventListener('touchmove', e => {
      for (const t of e.changedTouches) {
        if (t.identifier !== id) continue;
        const { dYaw, dPitch } = lookDelta(t.clientX - lx, t.clientY - ly);
        lx = t.clientX; ly = t.clientY;
        const p = this.game.player;
        p.yaw -= dYaw;
        p.pitch -= dPitch;
        p.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, p.pitch));
        e.preventDefault();
      }
    }, { passive: false });
    const end = e => { for (const t of e.changedTouches) if (t.identifier === id) id = null; };
    z.addEventListener('touchend', end);
    z.addEventListener('touchcancel', end);
  }
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/touch.js
git commit -m "feat(touch): movement joystick + drag-look zones"
```

---

## Task 4: Action buttons + hotbar + pack

**Files:**
- Modify: `src/touch.js` (add `_buildButtons`, `_buildTop`)

- [ ] **Step 1: Add the action buttons**

Add to the class:

```javascript
  _buildButtons() {
    const g = this.game;
    // press/hold helper: onDown at touchstart, onUp at touchend/cancel.
    const hold = (b, onDown, onUp) => {
      b.addEventListener('touchstart', e => { e.preventDefault(); onDown(); }, { passive: false });
      const up = e => { e.preventDefault(); onUp && onUp(); };
      b.addEventListener('touchend', up); b.addEventListener('touchcancel', up);
    };
    // Jump (hold = jump/fly-up; each tap feeds jumpTapped so player.js can double-tap-toggle fly)
    hold(this._btn('jump', 'Jump', 'big'), () => { g.keys['Space'] = true; g.input.jumpTapped = true; }, () => { g.keys['Space'] = false; });
    // Crouch (hold = sneak / fly-down)
    hold(this._btn('crouch', '<i class="ti ti-chevron-down"></i>'), () => { g.keys['ShiftLeft'] = true; }, () => { g.keys['ShiftLeft'] = false; });
    // Mine (hold = break centred block; updateMining polls mouseDown[0])
    hold(this._btn('mine', 'Mine', 'act'), () => { if (g.state !== 'playing') return; g.mouseDown[0] = true; g.breakProgress = 0; g.attackOrMine(true); }, () => { g.mouseDown[0] = false; });
    // Place (use item at crosshair; place-repeat polls mouseDown[2])
    hold(this._btn('place', 'Place', 'act'), () => { if (g.state !== 'playing') return; g.mouseDown[2] = true; g.placeRepeat = 0.4; g.useItem(); }, () => { g.mouseDown[2] = false; });
  }

  _buildTop() {
    const g = this.game;
    const tap = (b, fn) => b.addEventListener('touchstart', e => { e.preventDefault(); fn(); }, { passive: false });
    tap(this._btn('pack', '<i class="ti ti-box"></i>', 'top'), () => g.openInventory());
    tap(this._btn('more', '<i class="ti ti-menu-2"></i>', 'top'), () => this._toggleMore());
    // hotbar slot taps. #hotbar (ui.js:98) holds `.slot` divs, but ui.js renderHotbar (ui.js:1204)
    // rebuilds them via innerHTML each render — so DELEGATE one listener on the container and derive
    // the index from the touched child (per-slot listeners would die on the next re-render).
    const hb = document.getElementById('hotbar');
    if (hb) hb.addEventListener('touchstart', e => {
      const slot = e.target.closest('.slot'); if (!slot) return;
      const i = Array.prototype.indexOf.call(hb.children, slot);
      if (i >= 0) { e.preventDefault(); g.player.hotbar = i; g.ui.invDirty = true; }
    }, { passive: false });
  }

  _toggleMore() { /* filled in Task 6 */ if (this._more) { this._more.classList.toggle('open'); } }
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/touch.js
git commit -m "feat(touch): jump/crouch/mine/place buttons, pack + hotbar taps"
```

---

## Task 5: Contextual pills + riding/driving clusters

**Files:**
- Modify: `src/touch.js` (add `_buildContext`, `setState`, `refreshContext`)

- [ ] **Step 1: Add contextual + state controls**

Add to the class:

```javascript
  _buildContext() {
    const g = this.game;
    const pill = (name, label, fn) => {
      const p = document.createElement('button');
      p.className = 'touch-pill'; p.dataset.touch = name; p.hidden = true; p.innerHTML = label;
      p.addEventListener('touchstart', e => { e.preventDefault(); fn(); }, { passive: false });
      this.root.appendChild(p); this.btns[name] = p; return p;
    };
    // Only talk + mount are pills — they have cheap predicates (villagerInView / boat||mount).
    // Board + Sleep self-gate in their handlers (keyboard Q/N work anywhere), so they live in the
    // More panel (Task 6), not as always-visible pills.
    pill('talk', '<i class="ti ti-message"></i> Talk', () => { const v = g.villagerInView(); if (v) g.openChat(v); });
    pill('mount', 'Leave', () => { if (g.boat) g.leaveBoat(); else if (g.mount) g.dismountPony(); });
    // state clusters (riding / driving): shown by setState
    const cluster = (name, items) => {
      const c = document.createElement('div'); c.className = 'touch-cluster'; c.dataset.touch = name; c.hidden = true;
      for (const [label, fn] of items) { const b = document.createElement('button'); b.className = 'touch-btn'; b.innerHTML = label; b.addEventListener('touchstart', e => { e.preventDefault(); fn(); }, { passive: false }); c.appendChild(b); }
      this.root.appendChild(c); this.btns[name] = c; return c;
    };
    cluster('ride', [['Seat', () => g.setRideView('seat')], ['Driver', () => g.setRideView('driver')], ['Top', () => g.setRideView('overhead')], ['Leave', () => g.wardenLeaveTrain?.()]]);
    cluster('drive', [['Reverser', () => { if (g.drive) g.drive.reverser *= -1; }], ['Coal', () => g.shovelCoal()], ['Leave', () => g.leaveDrive()]]);
  }

  // Show the right control set for the current state; called from tick().
  setState(state) {
    if (this._state === state) return;
    this._state = state;
    const playing = state === 'playing';
    for (const n of ['jump', 'crouch', 'mine', 'place']) if (this.btns[n]) this.btns[n].hidden = !playing;
    if (this.zones.move) this.zones.move.hidden = !playing;
    if (this.btns.ride) this.btns.ride.hidden = state !== 'riding';
    if (this.btns.drive) this.btns.drive.hidden = state !== 'driving';
  }

  // Contextual pills that depend on the world (cheap checks; called each tick).
  refreshContext() {
    if (this._state !== 'playing') { for (const n of ['talk', 'mount']) if (this.btns[n]) this.btns[n].hidden = true; return; }
    const g = this.game;
    if (this.btns.talk) this.btns.talk.hidden = !g.villagerInView();
    if (this.btns.mount) this.btns.mount.hidden = !(g.boat || g.mount);
  }
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/touch.js
git commit -m "feat(touch): contextual pills + riding/driving control clusters"
```

---

## Task 6: More (☰) panel — the long tail

**Files:**
- Modify: `src/touch.js` (add `_buildMore`, fill `_toggleMore`)

- [ ] **Step 1: Add the More panel**

Add to the class, and call `this._buildMore()` at the end of `_build()` (add the call after `this._buildContext()`):

```javascript
  _buildMore() {
    const g = this.game;
    const panel = document.createElement('div');
    panel.className = 'touch-more'; panel.dataset.touch = 'morePanel';
    this.root.appendChild(panel); this._more = panel;
    const item = (label, fn) => { const b = document.createElement('button'); b.className = 'touch-more-item'; b.innerHTML = label; b.addEventListener('touchstart', e => { e.preventDefault(); fn(); panel.classList.remove('open'); }, { passive: false }); panel.appendChild(b); return b; };
    item('<i class="ti ti-volume"></i> Mute', () => { g.audio.setMuted(!g.audio.muted); g.ui.toast(g.audio.muted ? 'Sound off.' : 'Sound on.'); });
    item('<i class="ti ti-bell"></i> Muster flock', () => g.musterFlock());
    item('<i class="ti ti-clipboard-list"></i> Departures board', () => g.openBoard(false));
    item('<i class="ti ti-zzz"></i> Sleep', () => g.trySleep());
    // sheepdog whistles: set g.herdCmd like the arrow-key path (main.js:625-633)
    const whistles = [['Come bye', 'come-bye'], ['Away', 'away'], ['Walk on', 'walk-on'], ['Lie down', 'lie-down'], ['Heel', 'heel']];
    const row = document.createElement('div'); row.className = 'touch-whistles';
    for (const [label, cmd] of whistles) { const b = document.createElement('button'); b.className = 'touch-more-item'; b.textContent = label; b.addEventListener('touchstart', e => { e.preventDefault(); g.herdCmd = cmd; }, { passive: false }); row.appendChild(b); }
    panel.appendChild(row);
    item('<i class="ti ti-device-floppy"></i> Save', () => g.saveNow());
    item('<i class="ti ti-door-exit"></i> Pause menu', () => g.pause());
  }

  _toggleMore() { if (this._more) this._more.classList.toggle('open'); }
```

NOTE: confirm the exact method names (`g.musterFlock`, `g.saveNow`, `g.pause`, `g.herdCmd`) exist on the game — they're referenced from the keyboard handlers (main.js:550/601/603/660). If a name differs, use the real one.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/touch.js
git commit -m "feat(touch): More panel (mute, muster, whistles, sleep, save)"
```

---

## Task 7: Pause-menu toggle (auto / on / off)

**Files:**
- Modify: `src/ui.js` (add the button to the pause panel)
- Modify: `src/main.js` (wire it)

- [ ] **Step 1: Add the button in `ui.js`**

In `ui.js`, in the pause panel construction (after `this.btnCreative = this.el('button', 'mc', pp, 'Toggle Creative Mode');`, ui.js:224), add:

```javascript
    this.btnTouch = this.el('button', 'mc', pp, 'Touch controls: Auto');
```

- [ ] **Step 2: Wire it in `main.js`**

In the setup where the other pause buttons are wired (near `ui.btnCreative.addEventListener(...)`, main.js:551), add:

```javascript
    ui.btnTouch.addEventListener('click', () => {
      const mode = this.touch.cycleMode();
      ui.btnTouch.innerHTML = 'Touch controls: ' + mode.charAt(0).toUpperCase() + mode.slice(1);
    });
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/ui.js src/main.js
git commit -m "feat(touch): pause-menu toggle to force touch auto/on/off"
```

---

## Task 8: Responsive CSS + viewport

**Files:**
- Modify: `style.css` (HUD styles + `@media`)
- Modify: `index.html` (viewport)

- [ ] **Step 1: Viewport**

In `index.html`, replace the viewport meta with:

```html
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
```

- [ ] **Step 2: HUD + responsive styles**

Append to `style.css`:

```css
/* ---- touch controls ---- */
html.touch .game { touch-action: none; }
.touch-hud { position: absolute; inset: 0; z-index: 30; pointer-events: none; touch-action: none; }
.touch-hud > * { pointer-events: auto; }
.touch-zone { position: absolute; bottom: 0; touch-action: none; }
.touch-move { left: 0; width: 45%; height: 60%; }
.touch-look { right: 0; width: 55%; height: 70%; }
.touch-knob { position: absolute; left: 50%; top: 50%; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%; background: rgba(255,255,255,.85); }
.touch-move::before { content: ''; position: absolute; left: calc(env(safe-area-inset-left) + 24px); bottom: calc(env(safe-area-inset-bottom) + 28px); width: 112px; height: 112px; border: 2px solid rgba(255,255,255,.5); border-radius: 50%; }
.touch-move .touch-knob { left: calc(env(safe-area-inset-left) + 80px); bottom: calc(env(safe-area-inset-bottom) + 84px); top: auto; }
.touch-btn { position: absolute; width: 64px; height: 64px; border-radius: 50%; border: 1.5px solid rgba(255,255,255,.6); background: rgba(255,255,255,.16); color: #fff; font: 500 13px/1 sans-serif; touch-action: none; }
.touch-btn.big { width: 78px; height: 78px; }
.touch-btn[data-touch=jump]   { right: calc(env(safe-area-inset-right) + 28px); bottom: calc(env(safe-area-inset-bottom) + 96px); }
.touch-btn[data-touch=mine]   { right: calc(env(safe-area-inset-right) + 104px); bottom: calc(env(safe-area-inset-bottom) + 70px); background: rgba(216,90,48,.5); }
.touch-btn[data-touch=place]  { right: calc(env(safe-area-inset-right) + 36px); bottom: calc(env(safe-area-inset-bottom) + 20px); background: rgba(29,158,117,.5); }
.touch-btn[data-touch=crouch] { right: calc(env(safe-area-inset-right) + 112px); bottom: calc(env(safe-area-inset-bottom) + 18px); width: 52px; height: 52px; }
.touch-btn.top { position: absolute; top: calc(env(safe-area-inset-top) + 10px); width: 46px; height: 40px; border-radius: 10px; }
.touch-btn[data-touch=pack] { right: calc(env(safe-area-inset-right) + 64px); }
.touch-btn[data-touch=more] { right: calc(env(safe-area-inset-right) + 10px); }
.touch-pill { position: absolute; top: calc(env(safe-area-inset-top) + 10px); left: calc(env(safe-area-inset-left) + 10px); height: 36px; padding: 0 14px; border-radius: 999px; border: 1px solid rgba(255,255,255,.5); background: rgba(13,27,38,.6); color: #fff; font: 500 13px/1 sans-serif; }
.touch-cluster { position: absolute; right: calc(env(safe-area-inset-right) + 20px); bottom: calc(env(safe-area-inset-bottom) + 20px); display: flex; gap: 10px; }
.touch-cluster button { min-width: 64px; height: 48px; border-radius: 12px; border: 1.5px solid rgba(255,255,255,.6); background: rgba(255,255,255,.16); color: #fff; }
.touch-more { position: absolute; right: calc(env(safe-area-inset-right) + 10px); top: 60px; width: 220px; max-height: 70%; overflow: auto; display: none; flex-direction: column; gap: 6px; padding: 10px; border-radius: 12px; background: rgba(13,27,38,.92); border: 1px solid rgba(255,255,255,.3); }
.touch-more.open { display: flex; }
.touch-more-item { min-height: 44px; border-radius: 8px; border: 1px solid rgba(255,255,255,.25); background: rgba(255,255,255,.08); color: #fff; }
.touch-whistles { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }

@media (max-width: 820px), (pointer: coarse) {
  .overlay .panel { width: min(92vw, 460px); max-height: 86vh; overflow: auto; }
  .panel .mc, .panel button { min-height: 44px; font-size: 16px; }
  #stats { transform: scale(.9); transform-origin: top left; }
}
```

(Selectors confirmed against `ui.js`: panels use `.overlay` + `.panel`, buttons use `.mc` (ui.js:143/219/222), the stat HUD is `#stats` (ui.js:79). If the inventory grid needs its own reflow, grep `ui.js` for the invScreen grid class and add it here.)

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add style.css index.html
git commit -m "feat(touch): responsive @media menus, HUD styles, safe-area + viewport"
```

---

## Task 9: Live verification (preview, mobile emulation)

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server + emulate a touch device**

Use the preview tooling. Reload, then drive the moors world (per the EVO-stack notes: `game.loginGuest(); game.newWorld('x')`, pump `game.frame()` a few times). Force touch on: `game.touch.cycleMode()` until mode is `on` (or set `localStorage['moorcraft-touch']='on'` then `game.touch.sync()`).

- [ ] **Step 2: Assert the overlay exists and is wired**

In the console: `document.getElementById('touchHud')` is present; `document.documentElement.classList.contains('touch')` is true; the joystick, look zone, jump/mine/place/crouch buttons, pack/more exist.

- [ ] **Step 3: Synthesise gestures and assert bus writes**

Dispatch synthetic `touchstart`/`touchmove` on the look zone and assert `game.player.yaw` changes; on the move zone bottom-left and assert `game.keys.KeyW` (or appropriate) flips true then false on `touchend`; tap mine and assert `game.mouseDown[0]` true then false. Example:

```javascript
const fire = (el, type, x, y, id=1) => { const t = new Touch({ identifier:id, target:el, clientX:x, clientY:y }); el.dispatchEvent(new TouchEvent(type, { changedTouches:[t], bubbles:true, cancelable:true })); };
const look = document.querySelector('.touch-look'); const y0 = game.player.yaw;
fire(look, 'touchstart', 600, 300); fire(look, 'touchmove', 660, 300);
console.log('yaw changed:', game.player.yaw !== y0);
```

(If `Touch`/`TouchEvent` constructors aren't available in the preview engine, verify instead by reading state after `preview` touch actions, or confirm visually with a screenshot at mobile size.)

- [ ] **Step 4: Assert desktop is unaffected**

Set mode `off` (`game.touch.cycleMode()` to off / `localStorage` + `sync()`), confirm `#touchHud` is removed, `html` has no `touch` class, and keyboard/mouse still work (no console errors, pointer-lock still engages on click).

- [ ] **Step 5: Screenshot for the record**

Resize the preview to mobile (e.g. 820×400 landscape), screenshot the HUD over the world. No commit (verification only). Note pass/fail; if anything regresses, return to the relevant task.

---

## Self-Review

**Spec coverage:**
- Input-adapter architecture (write to existing bus) → Tasks 2-6 (all writes go to `game.keys`/`input`/`mouseDown`/`player`). ✓
- Pure helpers + headless test → Task 1. ✓
- Detection + auto/on/off + pause toggle → Tasks 2 (`wanted`/`sync`), 7 (toggle). ✓
- Joystick (8-way + sprint), drag-look → Task 3 (uses Task 1 helpers). ✓
- Jump/crouch/mine/place via bus, hotbar, pack → Task 4. ✓
- Contextual pills + riding/driving clusters → Task 5. ✓
- More panel (long tail) → Task 6. ✓
- Responsive `@media` + viewport + safe-area → Task 8. ✓
- Pointer-lock bypass on touch → Task 2 Step 3. ✓
- Live verification (gestures, desktop unaffected) → Task 9. ✓

**Placeholder scan:** the three NOTE blocks (hotbar markup, board/sleep predicates, menu selectors) are deliberate "confirm against real markup" instructions with a concrete fallback each — not open TODOs. All code steps carry full code.

**Type/name consistency:** `game.keys` / `game.input.jumpTapped` / `game.mouseDown` / `game.player.yaw|pitch|hotbar` / `game.ui.invDirty` used identically across tasks. `joystickToKeys`/`lookDelta`/`isTouchPrimary`/`touchMode` signatures match Task 1. Class methods (`_build`, `_buildMove`, `_buildLook`, `_buildButtons`, `_buildTop`, `_buildContext`, `_buildMore`, `setState`, `refreshContext`, `tick`, `sync`, `cycleMode`, `_btn`, `_toggleMore`) are defined once and called consistently.

**Scope:** one feature, one new file + thin wiring + CSS; single plan. The DOM/gesture tasks aren't unit-testable headlessly (only Task 1 is) — they build incrementally with `npm run build` gates and a consolidated live check (Task 9), which the spec's testing section already states.
