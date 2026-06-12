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
    this.posTimer = 0;
    this.lastSent = null;
  }

  connect(room, pid, name) {
    return new Promise((resolve, reject) => {
      const url = `${WS_BASE}/ws?room=${room}&pid=${encodeURIComponent(pid)}&name=${encodeURIComponent(name || 'rambler')}`;
      this.ws = new WebSocket(url);
      this.ws.onopen = () => { this.connected = true; };
      this.ws.onmessage = e => {
        const m = JSON.parse(e.data);
        if (m.type === 'init') { this.onInit(m); resolve(m); }
        else this.handle(m);
      };
      this.ws.onclose = () => {
        this.connected = false;
        if (this.game.netActive) {
          this.game.ui.toast('Lost t\u2019 thread to t\u2019 shared moor \u2014 reconnecting...', 4000);
          setTimeout(() => { if (this.game.netActive) this.connect(room, pid, name).catch(() => {}); }, 4000);
        }
      };
      this.ws.onerror = () => reject(new Error('ws failed'));
      setTimeout(() => reject(new Error('ws timeout')), 10000);
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
    for (const [pid, p] of Object.entries(m.players)) this.addRemote(pid, p.name, p);
    g.sky.time = m.time;
  }

  handle(m) {
    const g = this.game;
    if (m.type === 'edit') {
      g.world.netEdits = g.world.netEdits || new Map();
      g.world.netEdits.set(`${m.x},${m.y},${m.z}`, m.id);
      g.world.setBlock(m.x, m.y, m.z, m.id);
    } else if (m.type === 'pos') {
      const r = this.remotes.get(m.pid);
      if (r) { r.target = m; }
    } else if (m.type === 'join') {
      this.addRemote(m.pid, m.name, { x: 0, y: 40, z: 0 });
      g.ui.toast(`<b>${m.name}</b> has come up onto t\u2019 moor.`, 4000);
    } else if (m.type === 'leave') {
      this.removeRemote(m.pid);
    } else if (m.type === 'chat') {
      g.ui.toast(`<b>${m.name}:</b> ${m.text.replace(/</g, '&lt;')}`, 7000);
      const r = this.remotes.get(m.pid);
      if (r && r.mob) g.entities.speak(r.mob, m.text, 7);
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
    if (this.remotes.has(pid)) return;
    const mob = this.game.entities.spawnVillager(null, name || 'rambler', p.x, p.y, p.z);
    mob.isRemotePlayer = true;
    mob.t.speed = 0; // we drive it frae t' network
    this.remotes.set(pid, { name, mob, target: p });
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
      if (r.target.yaw !== undefined) m.yaw = r.target.yaw;
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
    // keep t' shared clock honest now an' then
    this.timeTimer = (this.timeTimer ?? 30) - dt;
    if (this.timeTimer <= 0) { this.timeTimer = 60; this.send({ type: 'timeq' }); }
  }

  send(obj) {
    if (this.connected && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  // eph: {revert} marks a beach edit t' relay should undo after a while
  sendEdit(x, y, z, id, eph) {
    this.send(eph ? { type: 'edit', x, y, z, id, ttl: 300, revert: eph.revert } : { type: 'edit', x, y, z, id });
  }
  sendChat(text) { this.send({ type: 'chat', text }); }
  sendSleep(on) { this.send({ type: 'sleep', on: !!on }); }
  sendSave(data) { this.send({ type: 'save', data }); }

  disconnect() {
    this.connected = false;
    if (this.ws) { try { this.ws.close(); } catch { /* gone */ } }
    for (const pid of [...this.remotes.keys()]) this.removeRemote(pid);
  }
}
