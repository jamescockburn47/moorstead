import { escHtml } from './escape.js';

// T' Shared Moor: one world for everyone, relayed through t' EVO.
// Terrain is deterministic frae t' shared seed; t' server keeps block edits,
// player positions an' a village chat line. (WebSockets can't ride Vercel
// rewrites, so we connect straight to t' tunnel.)
const WS_BASE = location.hostname === 'localhost'
  ? 'wss://moorstead.sovren.xyz'
  : 'wss://moorstead.sovren.xyz';

export class Net {
  constructor(game) {
    this.game = game;
    this.connected = false;
    this.remotes = new Map(); // pid -> {name, mob}
    this.leaving = new Map(); // pid -> timeout: a grace afore we let a dropped soul go
    this.keepTimer = null;    // a steady keepalive that survives a backgrounded tab
    this.reTimer = null;      // the scheduled reconnect
    this.posTimer = 0;
    this.lastSent = null;
    this.reconnectAttempt = 0;
    this.staleAfterMs = 60000; // heard nowt back this long => half-open, force a reconnect
    // ---- connection diagnostics (observability-first, like the Bot Council) ----
    // every lifecycle event is timestamped + classified so we can SEE why the
    // thread drops, not guess. Read it live with `netDiag()` in the console, or
    // frae the Parish Warden panel.
    this.diag = {
      room: null, pid: null, sessionStart: 0,
      events: [],                 // ring buffer of recent lifecycle events
      connects: 0, drops: 0, dropsByKind: {},
      lastDrop: null, lastOpenAt: 0, lastCloseAt: 0, lastMsgAt: 0,
      downtimeMs: 0, lastRtt: null, pingAt: 0, forcedStale: false,
    };
  }

  log(kind, detail) {
    this.diag.events.push({ t: Date.now(), kind, detail: detail ?? null });
    if (this.diag.events.length > 80) this.diag.events.shift();
  }

  // closed-set taxonomy of WHY the socket closed (James's house style) — so a run
  // of drops aggregates into a dominant cause we can act on.
  classifyClose(ev) {
    if (this.diag.forcedStale) { this.diag.forcedStale = false; return 'stale-no-traffic'; }
    const hidden = typeof document !== 'undefined' && document.hidden;
    const ageMs = this.diag.lastMsgAt ? Date.now() - this.diag.lastMsgAt : 0;
    switch (ev.code) {
      case 1000: return 'clean';
      case 1001: return 'server-going-away';
      case 1011: return 'server-error';
      case 1012: case 1013: return 'server-restart';
      case 1006: return hidden ? 'drop-while-hidden' : (ageMs > 45000 ? 'idle-timeout' : 'network-drop');
      default: return ev.code >= 4000 ? `app-${ev.code}` : `code-${ev.code}`;
    }
  }

  // the keepalive beat: prove the line's alive, measure RTT, an' catch a half-open
  // socket (connected in name only) afore the OS takes minutes to notice.
  keepalive() {
    if (!this.connected || !this.ws || this.ws.readyState !== 1) return;
    const now = Date.now();
    if (this.diag.lastMsgAt && now - this.diag.lastMsgAt > this.staleAfterMs) {
      this.log('stale', { msgAgeMs: now - this.diag.lastMsgAt });
      this.diag.forcedStale = true;
      try { this.ws.close(4001, 'stale'); } catch { /* gone */ }
      return;
    }
    this.diag.pingAt = now;
    this.send({ type: 'timeq' });
  }

  // a plain-object snapshot of the connection's health an' recent history
  report() {
    const now = Date.now(), d = this.diag;
    return {
      state: this.connected ? 'connected' : (this.game.netActive ? 'reconnecting' : 'offline'),
      room: d.room,
      uptimeSec: this.connected && d.lastOpenAt ? Math.round((now - d.lastOpenAt) / 1000) : 0,
      sessionAgeSec: d.sessionStart ? Math.round((now - d.sessionStart) / 1000) : 0,
      connects: d.connects, drops: d.drops, dropsByKind: { ...d.dropsByKind },
      lastDrop: d.lastDrop,
      lastMsgAgeSec: d.lastMsgAt ? Math.round((now - d.lastMsgAt) / 1000) : null,
      lastRttMs: d.lastRtt,
      reconnectAttempt: this.reconnectAttempt,
      totalDowntimeSec: Math.round(d.downtimeMs / 1000),
      remotes: this.remotes.size,
      recent: d.events.slice(-24).map(e => ({ ago: Math.round((now - e.t) / 1000) + 's', kind: e.kind, detail: e.detail })),
    };
  }

  connect(room, pid, name, token) {
    this.diag.room = room; this.diag.pid = pid;
    if (!this.diag.sessionStart) this.diag.sessionStart = Date.now();
    clearTimeout(this.reTimer);
    this.log('connecting', { room, attempt: this.reconnectAttempt });
    return new Promise((resolve, reject) => {
      let url = `${WS_BASE}/ws?room=${encodeURIComponent(room)}&pid=${encodeURIComponent(pid)}&name=${encodeURIComponent(name || 'rambler')}`;
      if (token) url += `&token=${encodeURIComponent(token)}`;
      let settled = false;
      this.ws = new WebSocket(url);
      this.ws.onopen = () => {
        const now = Date.now();
        this.connected = true;
        this.lastSent = null; // force a position resend after (re)connect
        if (this.diag.lastCloseAt) this.diag.downtimeMs += now - this.diag.lastCloseAt;
        this.diag.connects++; this.diag.lastOpenAt = now; this.diag.lastMsgAt = now;
        this.log('open', this.diag.connects > 1 ? `reconnected (#${this.diag.connects})` : 'first');
        this.reconnectAttempt = 0;
        // A keepalive on a real timer — NOT the rAF loop, which pauses in a
        // backgrounded tab. ~25s beats the relay's idle cap even when a hidden
        // tab throttles us to ~once a minute, so we stop dropping (an' flapping).
        clearInterval(this.keepTimer);
        this.keepTimer = setInterval(() => this.keepalive(), 25000);
      };
      this.ws.onmessage = e => {
        this.diag.lastMsgAt = Date.now();
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.type === 'time' && this.diag.pingAt) { this.diag.lastRtt = Date.now() - this.diag.pingAt; this.diag.pingAt = 0; }
        if (m.type === 'full') {
          this.game.ui?.toast(`T\u2019 room\u2019s full (${m.max} at once) \u2014 finding thee another patch o\u2019 moor\u2026`, 6000);
          this.game.refreshAuth?.().then(() => {
            const g = this.game;
            if (g.netActive && g.auth?.room && g.auth.room !== this.diag.room) {
              g.netRoom = g.auth.room;
              g.ui?.toast(`Sent to <b>${escHtml(g.auth.room)}</b> where there\u2019s room.`, 5000);
            }
          });
          if (!settled) { settled = true; reject(new Error('room full')); }
          return;
        }
        if (m.type === 'init') { this.onInit(m); if (!settled) { settled = true; resolve(m); } }
        else this.handle(m);
      };
      this.ws.onclose = (ev) => {
        this.connected = false;
        clearInterval(this.keepTimer);
        const now = Date.now();
        const kind = this.classifyClose(ev);
        const rec = {
          kind, code: ev.code, reason: (ev.reason || '').slice(0, 80), wasClean: !!ev.wasClean,
          hidden: !!(typeof document !== 'undefined' && document.hidden),
          msgAgeMs: this.diag.lastMsgAt ? now - this.diag.lastMsgAt : null,
          upMs: this.diag.lastOpenAt ? now - this.diag.lastOpenAt : null,
        };
        this.diag.drops++; this.diag.dropsByKind[kind] = (this.diag.dropsByKind[kind] || 0) + 1;
        this.diag.lastDrop = rec; this.diag.lastCloseAt = now;
        this.log('close', rec);
        if (!settled) { settled = true; reject(new Error('ws closed')); }
        if (ev.code === 4003 && this.game.ui) {
          this.game.ui.toast('Thi session’s expired or isn’t welcome here — log in again wi’ thi invite.', 8000);
          if (this.game.logout) this.game.logout();
        }
        if (this.game.netActive) {
          this.reconnectAttempt = Math.min(this.reconnectAttempt + 1, 6);
          const delay = Math.min(30000, 800 * 2 ** (this.reconnectAttempt - 1)) + Math.random() * 700; // backoff + jitter
          this.log('reconnect-scheduled', { inMs: Math.round(delay), attempt: this.reconnectAttempt });
          if (this.reconnectAttempt <= 1 && ev.code !== 4003) this.game.ui.toast('Lost t’ thread to t’ shared moor — reconnecting…', 3500);
          if (ev.code !== 4003) this.reTimer = setTimeout(() => {
            if (this.game.netActive) {
              const t = this.game.auth && this.game.auth.token;
              this.connect(room, pid, name, t).catch(() => {});
            }
          }, delay);
        }
      };
      this.ws.onerror = () => { this.log('error', 'ws error'); if (!settled) { settled = true; reject(new Error('ws failed')); } };
      setTimeout(() => { if (!settled) { settled = true; reject(new Error('ws timeout')); } }, 10000);
    });
  }

  onInit(m) {
    const g = this.game;
    this.savedState = m.save || null;
    g.world.netEdits = g.world.netEdits || new Map();
    for (const [x, y, z, id] of m.edits) {
      g.world.netEdits.set(`${x},${y},${z}`, id);
      g.world.setBlock(x, y, z, id); // applies now if t' chunk's loaded
    }
    if (m.deeds) {
      g.world.deeds = m.deeds;
    }
    for (const [pid, p] of Object.entries(m.players)) this.addRemote(pid, p.name, p);
    g.sky.time = m.time;
  }

  handle(m) {
    const g = this.game;
    if (m.type === 'edit') {
      g.world.netEdits = g.world.netEdits || new Map();
      g.world.netEdits.set(`${m.x},${m.y},${m.z}`, m.id);
      g.world.setBlock(m.x, m.y, m.z, m.id);
    } else if (m.type === 'deeds') {
      g.world.deeds = m.deeds;
      if (g.state === 'board' || g.ui.boardScreen.className.indexOf('hidden') === -1) {
        g.ui.openBoard(true);
      }
    } else if (m.type === 'pos') {
      const r = this.remotes.get(m.pid);
      if (r) { r.target = m; }
    } else if (m.type === 'join') {
      // a flap (a backgrounded tab dropping an' coming straight back) cancels its
      // pending leave an' makes no fuss — only a genuinely new soul is announced.
      const pend = this.leaving.get(m.pid);
      if (pend) { clearTimeout(pend); this.leaving.delete(m.pid); }
      const fresh = this.addRemote(m.pid, m.name, { x: 0, y: 40, z: 0 });
      if (fresh) g.ui.toast(`<b>${escHtml(m.name)}</b> has come up onto t’ moor.`, 4000);
    } else if (m.type === 'leave') {
      // hold off — idle tabs drop an' return constantly. Only let her go if she's
      // still away after a grace, so folk don't blink in an' out (nor re-announce).
      if (this.leaving.has(m.pid) || !this.remotes.has(m.pid)) return;
      this.leaving.set(m.pid, setTimeout(() => { this.leaving.delete(m.pid); this.removeRemote(m.pid); }, 25000));
    } else if (m.type === 'chat') {
      if (m.pid && m.pid === this.diag.pid) return; // don't echo our OWN words back (we already showed "Thee:")
      g.ui.toast(`<b>${escHtml(m.name)}:</b> ${escHtml(m.text)}`, 16000);
      const r = this.remotes.get(m.pid);
      if (r && r.mob) g.entities.speak(r.mob, m.text, 18);
    } else if (m.type === 'time') {
      g.sky.time = m.time;
    } else if (m.type === 'sleepers') {
      // who's kipping: t' neet only passes when everybody's abed
      if (g.onSleepers) g.onSleepers(m.n, m.total);
    } else if (m.type === 'wake') {
      if (g.onWake) g.onWake();
    } else if (m.type === 'where') {
      // warden's map o' who's where (t' relay only answers wardens)
      if (this.onWhere) this.onWhere(m.players || []);
    } else if (m.type === 'fx') {
      // a flourish frae a warden nearby (landing thump an' t' like)
      if (g.remoteFx) g.remoteFx(m);
    }
  }

  requestWhere(cb) { this.onWhere = cb; this.send({ type: 'where' }); }
  sendFx(kind, x, y, z) { this.send({ type: 'fx', kind, x, y, z }); }

  addRemote(pid, name, p) {
    if (this.remotes.has(pid)) return false;
    const mob = this.game.entities.spawnVillager(pid, name || 'rambler', p.x, p.y, p.z);
    mob.isRemotePlayer = true;
    mob.t.speed = 0; // we drive it frae t' network
    this.remotes.set(pid, { name, mob, target: p });
    return true;
  }

  removeRemote(pid) {
    const r = this.remotes.get(pid);
    if (r) {
      this.game.entities.scene.remove(r.mob.model.group);
      r.mob.dead = true;
      this.remotes.delete(pid);
    }
  }

  update(dt) {
    if (!this.connected) return;
    const g = this.game;
    // smooth remote players toward their last reported spot
    for (const r of this.remotes.values()) {
      if (!r.target) continue;
      const m = r.mob;
      const k = Math.min(1, dt * 8);
      m.pos.x += (r.target.x - m.pos.x) * k;
      m.pos.y += (r.target.y - m.pos.y) * k;
      m.pos.z += (r.target.z - m.pos.z) * k;
      // ease the heading round (shortest way) instead of snapping — stops Merlin
      // an' other remotes twitchin' as their reported yaw jumps about
      if (r.target.yaw !== undefined) {
        if (m.yaw === undefined) m.yaw = r.target.yaw;
        else { let dy = r.target.yaw - m.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2; m.yaw += dy * Math.min(1, dt * 6); }
      }
    }
    // send our position ~5Hz when it's changed
    this.posTimer -= dt;
    if (this.posTimer <= 0) {
      this.posTimer = 0.2;
      const p = g.player.pos;
      const s = `${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)},${g.player.yaw.toFixed(2)}`;
      if (s !== this.lastSent) {
        this.lastSent = s;
        this.send({ type: 'pos', x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), yaw: +g.player.yaw.toFixed(2) });
      }
    }
    // (the shared clock is kept honest by the keepalive's timeq, on a real timer)
  }

  send(obj) {
    if (this.connected && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  sendEdit(x, y, z, id, was = 0, cat = 'build', day = 0, by = '') {
    this.send({ type: 'edit', x, y, z, id, was, cat, day, by });
  }
  sendDeeds(deeds) { this.send({ type: 'deeds', deeds }); }
  sendChat(text) { this.send({ type: 'chat', text }); }
  sendSleep(on) { this.send({ type: 'sleep', on: !!on }); }
  sendSave(data) { this.send({ type: 'save', data }); }

  disconnect() {
    this.connected = false;
    clearInterval(this.keepTimer);
    clearTimeout(this.reTimer);
    for (const t of this.leaving.values()) clearTimeout(t);
    this.leaving.clear();
    this.log('disconnect', 'left the moor');
    if (this.ws) { try { this.ws.close(1000, 'left'); } catch { /* gone */ } }
    for (const pid of [...this.remotes.keys()]) this.removeRemote(pid);
  }
}
