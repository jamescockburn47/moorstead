// touch.js — touch-screen controls for phones & tablets. An INPUT ADAPTER: it renders a DOM HUD
// over the canvas and writes to the same input bus the keyboard/mouse feed, so the desktop path is
// untouched. The gesture->signal logic lives in these pure helpers (headlessly tested); the class
// below is thin DOM glue. NO module-level DOM access — verify-touch.mjs imports this under Node.

const DEADZONE = 0.18;   // fraction of joystick radius below which we read no movement
const SPRINT_AT = 0.85;  // fraction of radius beyond which a forward push also sprints
export const LOOK_SENS = 0.0042;  // touch look sensitivity (mouse is 0.0023; touch wants more)

// Joystick knob offset (dx,dy screen px; dy<0 = pushed up = forward) -> WASD+sprint booleans.
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

// Resolve the stored mode ('auto'|'on'|'off') against detection. A touch device may
// opt out ('off'); a COMPUTER (non-touch-primary) is auto-detect ONLY — a stored 'on'
// can't force the HUD on, so a stray setting (or a synced profile) never lumbers a
// desktop player with on-screen sticks.
export function touchMode(stored, isPrimary) {
  if (stored === 'off') return false;
  if (stored === 'on') return !!isPrimary;  // 'on' is honoured only on a touch device
  return !!isPrimary;                         // auto
}

const MODE_KEY = 'moorcraft-touch';   // localStorage: 'auto' | 'on' | 'off'

export class TouchControls {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.root = null;
    this.zones = {};      // joystick / look zone elements
    this.btns = {};       // button elements by name
    try { this._mode = localStorage.getItem(MODE_KEY) || 'auto'; } catch { this._mode = 'auto'; /* storage blocked */ }
  }

  // Should the touch HUD be on right now? (mode override vs device detection)
  wanted() {
    const primary = isTouchPrimary(q => window.matchMedia(q), navigator);
    return touchMode(this._mode, primary);
  }

  // Only a touch-primary device gets the manual on/off toggle. A computer is
  // auto-detect only, so we hide the toggle there entirely.
  manualToggleAllowed() {
    return isTouchPrimary(q => window.matchMedia(q), navigator);
  }

  // Build (or tear down) the HUD to match wanted(). Idempotent — safe to call repeatedly.
  sync() {
    if (this.wanted() && !this.active) this._build();
    else if (!this.wanted() && this.active) this._destroy();
  }

  cycleMode() {   // pause-menu toggle: auto -> on -> off -> auto
    this._mode = this._mode === 'auto' ? 'on' : this._mode === 'on' ? 'off' : 'auto';
    try { localStorage.setItem(MODE_KEY, this._mode); } catch { /* storage blocked — mode stays for this session only */ }
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
    this._buildMove?.();
    this._buildLook?.();
    this._buildButtons?.();
    this._buildTop?.();
    this._buildContext?.();
    this._buildMore?.();
    this._buildMap?.();
    this.setState?.(this.game.state);
  }

  _destroy() {
    this.active = false;
    document.documentElement.classList.remove('touch');
    if (this._hbEl && this._hbTap) { this._hbEl.removeEventListener('touchstart', this._hbTap); this._hbEl = null; this._hbTap = null; }
    if (this._mapBox) {                                        // map listeners live on #minimap-box / #big-map (outside the root)
      this._mapBox.removeEventListener('touchstart', this._mapDown);
      this._mapBox.removeEventListener('touchmove', this._mapMove);
      this._mapBox.removeEventListener('touchend', this._mapCancel);
      this._mapBox.removeEventListener('touchcancel', this._mapCancel);
      this._mapBox = null;
    }
    if (this._mapOverlay) { this._mapOverlay.removeEventListener('touchstart', this._mapClose); this._mapOverlay.style.pointerEvents = 'none'; this._mapOverlay = null; }
    this.game.touchMapOpen = false;
    if (this.root) { this.root.remove(); this.root = null; }   // root's own children (buttons/zones/pills/more) detach with it
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
    // hotbar slot taps. #hotbar holds `.slot` divs, but ui.js rebuilds them via innerHTML each
    // render — so DELEGATE one listener on the container and derive the index from the touched child.
    const hb = document.getElementById('hotbar');
    if (hb) {
      this._hbEl = hb;        // #hotbar lives OUTSIDE the touch root, so _destroy must detach this by hand
      this._hbTap = e => {
        const slot = e.target.closest('.slot'); if (!slot) return;
        const i = Array.prototype.indexOf.call(hb.children, slot);
        if (i >= 0) { e.preventDefault(); g.player.hotbar = i; g.ui.invDirty = true; }
      };
      hb.addEventListener('touchstart', this._hbTap, { passive: false });
    }
  }

  _toggleMore() { if (this._more) this._more.classList.toggle('open'); }

  // Long-press the minimap to open the whole-moor map (the desktop "hold Tab to peek"); tap to close.
  // The map overlay (#big-map) is normally pointer-events:none (a peek); we make it tappable only
  // while opened by touch, then restore it, so the desktop peek is unchanged.
  _buildMap() {
    const g = this.game;
    const box = document.getElementById('minimap-box');
    const overlay = g.ui && g.ui.mapOverlay;
    if (!box || !overlay) return;
    let timer = null, sx = 0, sy = 0;
    this._mapBox = box; this._mapOverlay = overlay;
    this._mapCancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
    this._mapDown = e => {
      if (g.state !== 'playing') return;
      const t = e.changedTouches[0]; sx = t.clientX; sy = t.clientY; this._mapCancel();
      timer = setTimeout(() => { timer = null; g.touchMapOpen = true; overlay.style.pointerEvents = 'auto'; }, 450);
    };
    this._mapMove = e => { const t = e.changedTouches[0]; if (Math.hypot(t.clientX - sx, t.clientY - sy) > 12) this._mapCancel(); };
    this._mapClose = e => { e.preventDefault(); g.touchMapOpen = false; overlay.style.pointerEvents = 'none'; };
    box.addEventListener('touchstart', this._mapDown, { passive: true });
    box.addEventListener('touchmove', this._mapMove, { passive: true });
    box.addEventListener('touchend', this._mapCancel);
    box.addEventListener('touchcancel', this._mapCancel);
    overlay.addEventListener('touchstart', this._mapClose, { passive: false });
  }

  _buildContext() {
    const g = this.game;
    const pill = (name, label, fn) => {
      const p = document.createElement('button');
      p.className = 'touch-pill'; p.dataset.touch = name; p.hidden = true; p.innerHTML = label;
      p.addEventListener('touchstart', e => { e.preventDefault(); fn(); }, { passive: false });
      this.root.appendChild(p); this.btns[name] = p; return p;
    };
    // Only talk + mount are pills — they have cheap predicates (villagerInView / boat||mount).
    // Board + Sleep self-gate in their handlers (keyboard Q/N work anywhere), so they live in More.
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
    // sheepdog whistles: set g.herdCmd like the arrow-key path
    const whistles = [['Come bye', 'come-bye'], ['Away', 'away'], ['Walk on', 'walk-on'], ['Lie down', 'lie-down'], ['Heel', 'heel']];
    const row = document.createElement('div'); row.className = 'touch-whistles';
    for (const [label, cmd] of whistles) { const b = document.createElement('button'); b.className = 'touch-more-item'; b.textContent = label; b.addEventListener('touchstart', e => { e.preventDefault(); g.herdCmd = cmd; }, { passive: false }); row.appendChild(b); }
    panel.appendChild(row);
    item('<i class="ti ti-device-floppy"></i> Save', () => g.saveNow());
    item('<i class="ti ti-door-exit"></i> Pause menu', () => g.pause());
  }
}
