// Phase B.1 — render the brain's living roster. The brain owns logical state; this file
// owns ALL geometry: it maps {at|walk|rail} to a voxel position the client can draw.
import { rosterState } from './npc.js';
import { B } from './defs.js';

const clamp01 = t => t < 0 ? 0 : t > 1 ? 1 : t;

// The true voxel surface at (x,z): one block ABOVE the top non-air/non-water block, so a body
// stands ON the platform deck / building floor rather than sunk into it. geo.height is DEM-only
// and blind to built blocks (platforms, walls), which is why folk clip. Falls back to the DEM
// when the column has no blocks (chunk not loaded) so an unloaded column never pops a body to y~0.
// Cached per column — built geometry is effectively static.
const _surfCache = new Map();
export function __resetSurfCache() { _surfCache.clear(); }   // test hook: stub worlds reuse columns
export function surfaceHeight(world, geo, x, z) {
  const rx = Math.round(x), rz = Math.round(z);
  const key = rx + ',' + rz;
  const c = _surfCache.get(key);
  if (c !== undefined) return c;
  const dem = geo.height(rx, rz);
  let top = null;
  for (let y = dem + 6; y >= dem - 8 && y > 0; y--) {        // built things sit at/above the DEM
    const b = world.getBlock(rx, y, rz);
    if (b !== B.AIR && b !== B.WATER) { top = y; break; }
  }
  const h = (top != null ? top : dem) + 1;
  if (_surfCache.size > 60000) _surfCache.clear();
  _surfCache.set(key, h);
  return h;
}

// the town's anchor: its marker coordinate + standing height. null if the name is unknown.
export function townAnchor(name, geo) {
  const v = geo.villages.find(t => t.name === name);
  if (!v) return null;
  return { x: v.x, y: (v.ground != null ? v.ground : geo.height(v.x, v.z)) + 1, z: v.z };
}

// deterministic small offset around the anchor, by id, so a town's folk spread out
// (FNV-1a over the id -> a stable angle + radius). ~8 villagers ring the centre.
function _spread(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  const a = (h >>> 0) / 4294967295 * Math.PI * 2;
  const r = 2 + ((h >>> 9) % 1000) / 1000 * 6;   // 2..8 blocks
  return { dx: Math.cos(a) * r, dz: Math.sin(a) * r };
}

// logical state -> {x,y,z, frac?}. Returns null if any referenced name can't be resolved
// (the caller then skips that NPC this frame rather than crashing).
export function npcVoxelPos(npc, nowEff, geo) {
  const s = npc.state;
  if (!s) return null;
  if (s.kind === 'at') {
    const anchor = townAnchor(s.place, geo);
    if (!anchor || !npc.id) return anchor;           // unknown place -> null; bare state -> exact anchor
    const { dx, dz } = _spread(npc.id);              // fan folk out so a town's crowd doesn't stack
    const x = anchor.x + dx, z = anchor.z + dz;
    return { x, y: geo.height(Math.round(x), Math.round(z)) + 1, z };
  }

  if (s.kind === 'walk') {
    const a = townAnchor(s.from, geo), b = townAnchor(s.to, geo);
    if (!a || !b) return null;
    const f = clamp01((nowEff - s.started) / Math.max(1, s.eta - s.started));
    const x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f;
    return { x, y: geo.height(Math.round(x), Math.round(z)) + 1, z, frac: f };
  }

  if (s.kind === 'rail') {
    const lp = geo.railPaths().find(l => l.name === s.line);
    const ln = geo.railLines().find(l => l.name === s.line);
    if (!lp || !ln) return null;
    const iF = ln.stops.findIndex(t => t.name === s.fromStn);
    const iT = ln.stops.findIndex(t => t.name === s.toStn);
    if (iF < 0 || iT < 0) return null;
    const sS = lp.path.stationS, sF = sS[iF], sT = sS[iT];
    const f = clamp01((nowEff - s.started) / Math.max(1, s.eta - s.started));
    const sNow = sF + (sT - sF) * f;
    const p = geo.samplePosOn(lp.path, sNow);
    return { x: p.x, y: p.deck + 1, z: p.z, frac: f };
  }
  return null;
}

// A plain-English account of what this NPC is doing right now — `short` for the floating marker,
// `full` for chat. Grounded in the REAL state (where + mode + destination) so a body can ask and
// get the truth, with the LLM's own intent quoted as the voice. `ride` is the client-side committed
// rail journey, which overrides the brain state while she's actually aboard the visible train.
export function npcActivity(d, ride) {
  const st = (d && d.state) || {};
  const intent = ((d && d.intent) || '').trim();
  const home = (d && d.home) || st.place || '';
  const riding = ride && ride.phase && ride.phase !== 'done';
  let where, short;
  if (riding) {
    where = `on the train to ${ride.to}`;
    short = `→ ${ride.to} (train)`;
  } else if (st.kind === 'rail') {
    where = `taking the ${st.line} train to ${st.toStn}`;
    short = `→ ${st.toStn} (train)`;
  } else if (st.kind === 'walk') {
    where = `walking over to ${st.to}`;
    short = `→ ${st.to}`;
  } else {                                            // 'at'
    const place = st.place || home || 'the village';
    if (home && place !== home) { where = `at ${place}, away from home in ${home}`; short = `at ${place}`; }
    else { where = `at home in ${place}, working as a ${(d && d.role) || 'villager'}`; short = intent || (d && d.role) || ''; }
  }
  const full = intent ? `${where} — in your own words: "${intent}"` : where;
  return { full, short };
}

// --- naturalistic walking ----------------------------------------------------------------
// A person can stand at (x,z): walkable surface, gentle slope, and NOT blocked by a 2-high
// solid column (a building, a drystone wall, or a tree) — those they walk AROUND. They don't
// cross open water (a later phase adds fords / level crossings). Trees + buildings are
// voxel-world blocks (not in geo), so this needs the chunk `world`, not just geo terrain.
export function walkableStep(world, geo, x, z, fromG) {
  const rx = Math.round(x), rz = Math.round(z);
  const g = geo.height(rx, rz);
  if (g == null || Math.abs(g - fromG) > 1.3) return false;          // off-map or too steep a step
  if (world.getBlock(rx, g, rz) === B.WATER) return false;            // not across open water
  const a1 = world.getBlock(rx, g + 1, rz), a2 = world.getBlock(rx, g + 2, rz);
  if (a1 !== B.AIR && a2 !== B.AIR) return false;                     // 2-high solid -> go around
  return true;
}

// Steer a walking mob toward its destination anchor, skirting buildings/walls/trees and
// following the ground, paced to arrive by `eta`. Mutates mob.pos/yaw. The streamed mob's
// own wander AI is off (it's driven here, like a ridden pony / remote player), so this owns
// its locomotion. Server keeps the LOGICAL leg + eta; the client owns HOW it walks there.
export function steerWalk(mob, from, to, started, eta, now, world, geo, dt) {
  const dx = to.x - mob.pos.x, dz = to.z - mob.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1.2) { mob.pos.x = to.x; mob.pos.z = to.z; mob.pos.y = to.y; return; } // arrived
  const remain = Math.max(1, eta - now);
  const speed = Math.max(1.2, Math.min(3.0, dist / remain));         // blocks/sec, paced to the eta
  const goal = Math.atan2(dx, dz);
  const fromG = geo.height(Math.round(mob.pos.x), Math.round(mob.pos.z));
  // context steering: take the most direct heading (fanned out from the goal) that's walkable
  let best = null;
  for (const off of [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4]) {
    const h = goal + off;
    const lx = mob.pos.x + Math.sin(h) * 1.6, lz = mob.pos.z + Math.cos(h) * 1.6;  // look-ahead
    if (walkableStep(world, geo, lx, lz, fromG)) { best = h; break; }
  }
  if (best == null) best = goal;          // boxed in -> head at the goal; rescue recovers later
  const step = speed * dt;
  const nx = mob.pos.x + Math.sin(best) * step, nz = mob.pos.z + Math.cos(best) * step;
  mob.pos.x = nx; mob.pos.z = nz;
  mob.pos.y = geo.height(Math.round(nx), Math.round(nz)) + 1;        // follow the ground
  mob.yaw = best;
}

// Polls the brain's roster, holds logical state, and drives one villager mob per NPC.
// Moors + brain gated. Degrades cleanly: if a poll fails, streamed mobs are removed and
// the existing scripted crowd remains.
export class RosterClient {
  constructor(game) {
    this.game = game;
    this.geo = game.world.gen.geo;
    this.world = game.world;      // chunk world — steerWalk needs it for tree/building obstacles
    this.npcs = new Map();       // id -> { data, mob }
    this.serverNow = 0; this.recvAt = 0; this.active = false;
    this._pollMs = 1500;
  }

  start() {
    if (this._timer || !this.geo.realWorld) return;
    const poll = async () => {
      if (this._stopped) return;
      const snap = await rosterState();
      if (this._stopped) return;        // stopped mid-poll -> don't spawn or reschedule
      if (snap && Array.isArray(snap.npcs)) {
        this.serverNow = snap.now;
        this.recvAt = performance.now() / 1000;
        this.active = true;
        this._sync(snap.npcs);
      } else if (this.active) {
        this._teardown();        // brain went away -> drop streamed folk, fall back
        this.active = false;
      }
      this._timer = setTimeout(poll, this._pollMs);
    };
    poll();
  }

  // Stop polling and drop all streamed folk — called on world teardown so a stale client
  // can't keep polling or spawn ghost mobs into the next world.
  stop() {
    this._stopped = true;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    this._teardown();
    this.active = false;
  }

  _nowEff() { return this.serverNow + (performance.now() / 1000 - this.recvAt); }

  _sync(list) {
    const seen = new Set();
    for (const d of list) {
      seen.add(d.id);
      let e = this.npcs.get(d.id);
      if (!e) {
        const p0 = npcVoxelPos(d, this._nowEff(), this.geo) || { x: this.geo.villages[0].x, y: 64, z: this.geo.villages[0].z };
        const mob = this.game.entities.spawnVillager(d.id, d.name, p0.x, p0.y, p0.z, { role: d.role, roam: false, streamed: true });
        e = { data: d, mob };
        this.npcs.set(d.id, e);
      } else {
        e.data = d;
      }
    }
    for (const [id, e] of this.npcs) if (!seen.has(id)) { this._remove(e); this.npcs.delete(id); }
  }

  _remove(e) {
    if (!e.mob) return;
    this.game.entities.scene.remove(e.mob.model.group);   // codebase despawn idiom (no removeMob helper)
    e.mob.dead = true;                                     // culled from entities.mobs next frame
  }
  _teardown() { for (const [, e] of this.npcs) this._remove(e); this.npcs.clear(); }

  // called each frame: drive each streamed mob. 'walk' uses naturalistic steering (skirts
  // buildings / walls / trees); 'at' + 'rail' track the authoritative point directly.
  update(dt) {
    if (!this.active) return;
    const nowEff = this._nowEff();
    for (const [, e] of this.npcs) {
      const m = e.mob; if (!m) continue;
      const grp = m.model && m.model.group;
      // What she's up to right now — drives the floating marker AND what she says if asked (chat).
      const act = npcActivity(e.data, e.ride);
      m.activity = act.full; m.activityShort = act.short;
      if (!m.village) m.village = e.data.home || (e.data.state && e.data.state.place) || null;
      // Hailed: while a player has her in conversation, turn to face them and hold. She addresses
      // you when spoken to, but never breaks off to greet you unprompted — so folk get on with their
      // work and don't crowd you. Her errand (ride timer included) resumes when the chat closes.
      if (m.chatting) {
        const pl = this.game.player;
        if (pl && pl.pos) {
          const dx = pl.pos.x - m.pos.x, dz = pl.pos.z - m.pos.z;
          if (dx * dx + dz * dz > 0.01) m.yaw = Math.atan2(dx, dz);
        }
        continue;
      }
      // A committed rail journey overrides the brain state until she's delivered. The brain's rail
      // leg finishes faster than the slow visible train reaches her exact stop, so when the brain
      // says the leg is done, ALIGHT at the destination (else 'done' rarely fired and folk rode on
      // forever, never getting off).
      if (e.ride && e.ride.phase !== 'done' && !e.ride.titleForced) {
        const brainRail = e.data.state && e.data.state.kind === 'rail';
        if (!brainRail) { if (e.ride.phase === 'aboard') e.ride.phase = 'done'; else e.ride = null; }
      }
      if (e.ride && e.ride.phase !== 'done') { this._driveRail(e, m, dt); continue; }
      const s = e.data.state;
      if (s && s.kind === 'rail') {
        if (!e.ride || e.ride.line !== s.line || e.ride.from !== s.fromStn || e.ride.to !== s.toStn) {
          e.ride = { line: s.line, from: s.fromStn, to: s.toStn, phase: 'wait', t: 0 };   // begin a journey
        }
        this._driveRail(e, m, dt);
        continue;
      }
      // not travelling by rail: make sure she's shown (she may have just alighted) + clear the ride
      if (grp && !grp.visible) grp.visible = true;
      e.ride = null;
      if (s && s.kind === 'walk') {
        const from = townAnchor(s.from, this.geo), to = townAnchor(s.to, this.geo);
        if (from && to) steerWalk(m, from, to, s.started, s.eta, nowEff, this.world, this.geo, dt);
      } else {
        // 'at': potter gently about her patch so the town looks alive, not frozen — a slow wander
        // around her anchor (+ per-id spread), re-aimed every few seconds within a small radius.
        const p = npcVoxelPos(e.data, nowEff, this.geo);   // 'at' anchor + per-id spread
        if (!p) continue;
        if (m._ambleT == null || nowEff > m._ambleT) {
          m._ambleT = nowEff + 5 + Math.random() * 8;      // re-aim every 5–13s (a few steps, then a pause)
          const r = Math.random() * 2.2, ang = Math.random() * Math.PI * 2;
          const cx = p.x + Math.cos(ang) * r, cz = p.z + Math.sin(ang) * r;
          const fromG = this.geo.height(Math.round(p.x), Math.round(p.z));
          if (walkableStep(this.world, this.geo, cx, cz, fromG)) { m._ambleDX = Math.cos(ang) * r; m._ambleDZ = Math.sin(ang) * r; }
          else { m._ambleDX = 0; m._ambleDZ = 0; } // wall / tree / water / steep — don't amble into it
        }
        const tx = p.x + (m._ambleDX || 0), tz = p.z + (m._ambleDZ || 0);
        const k = Math.min(1, dt * 1.6);                   // amble slowly so the leg-swing reads as walking, not gliding
        m.pos.x += (tx - m.pos.x) * k; m.pos.z += (tz - m.pos.z) * k;
        m.pos.y += (this.geo.height(Math.round(m.pos.x), Math.round(m.pos.z)) + 1 - m.pos.y) * k;
        const ddx = tx - m.pos.x, ddz = tz - m.pos.z;
        if (ddx * ddx + ddz * ddz > 0.02) m.yaw = Math.atan2(ddx, ddz);
      }
    }
  }

  // The visible scheduled train on a line, or null: { x, z, station (the stop she's calling at while
  // dwelling, else null), dwelling }. Reads the game's live train state (main line + branch trains).
  _visibleTrain(lineName) {
    const g = this.game, geo = this.geo;
    const mainName = (geo.railPaths().find(l => l.path === geo.railPath()) || {}).name;
    if (lineName === mainName) {
      const ts = g.trainState; if (!ts || !ts.s) return null;
      const st = geo.railway()[ts.s.i];
      return { x: ts.x, z: ts.z, station: (ts.s.mode === 'dwell' && st) ? st.name : null, dwelling: ts.s.mode === 'dwell',
               path: geo.railPath(), chainage: ts.s.s, dir: ts.s.dir };
    }
    const bt = (g.branchTrains || []).find(b => b.name === lineName);
    if (!bt || !bt.state || !bt.state.s) return null;
    const st = bt.stations[bt.state.s.i];
    return { x: bt.state.x, z: bt.state.z, station: (bt.state.s.mode === 'dwell' && st) ? st.name : null, dwelling: bt.state.s.mode === 'dwell',
             path: bt.path, chainage: bt.state.s.s, dir: bt.state.s.dir };
  }

  // Drive a committed rail journey (e.ride) against the visible train: wait on the origin platform;
  // board when the train dwells there; ride VISIBLY in the coaches (on the rail deck behind the
  // loco); alight (reappear on the platform) at the destination when the train dwells there. A
  // timeout stops her waiting forever if the two schedules never line up.
  _driveRail(e, m, dt) {
    const ride = e.ride;
    ride.t += dt;
    const vt = this._visibleTrain(ride.line);
    if (vt && vt.dwelling) {
      if (ride.phase === 'wait' && vt.station === ride.from) ride.phase = 'aboard';
      else if (ride.phase === 'aboard' && vt.station === ride.to) ride.phase = 'done';
    }
    if (ride.t > 720) ride.phase = 'done';                  // safety net: never wait forever (sparse timetable ~ minutes)
    const grp = m.model && m.model.group;
    if (ride.phase === 'aboard') {
      // Ride VISIBLY, as a passenger in the coaches: sit on the rail deck behind the loco (the
      // carriage zone), so folk are actually seen aboard the moving train rather than vanishing.
      if (grp && !grp.visible) grp.visible = true;
      if (vt && vt.path && vt.chainage != null) {
        const poseFwd = vt.dir === 0 ? 1 : -1;
        if (e.ride.slot == null) e.ride.slot = 1 + (Math.round(Math.abs(_spread(e.data.id).dx * 7)) % 8); // 1..8 along the rake
        const back = 11 + e.ride.slot * 0.75;               // ~12..17 m behind the loco lead — within the two coaches
        const cr = Math.max(0, Math.min(vt.path.length, vt.chainage - back * poseFwd));
        const sp = this.geo.samplePosOn(vt.path, cr);
        const lat = (e.ride.slot % 2 ? 0.55 : -0.55);
        m.pos.x = sp.x + (-sp.tz) * lat; m.pos.z = sp.z + sp.tx * lat; m.pos.y = sp.deck + 1.0;
        if (sp.tx || sp.tz) m.yaw = Math.atan2(sp.tx * poseFwd, sp.tz * poseFwd);
      }
      return;
    }
    if (grp && !grp.visible) grp.visible = true;
    if (ride.phase === 'done') {                            // alighted — stand on the destination platform
      const a = townAnchor(ride.to, this.geo); if (!a) return;
      const sp = _spread(e.data.id);
      this._lerpTo(m, a.x + sp.dx, a.z + sp.dz, Math.min(1, dt * 6), true);
      return;
    }
    // waiting at the origin — she KNOWS the timetable: mills about nearby until the train is
    // nearly due, then converges on the platform to board. So the platform fills as the train
    // approaches instead of folk standing frozen there for ages.
    const a = townAnchor(ride.from, this.geo); if (!a) return;
    const due = this._nextTrainCall(ride.line, ride.from);
    const soon = due != null && due <= 40;
    const sp = _spread(e.data.id);
    const fx = soon ? 0.25 : 1;                             // tight on the platform when due; dispersed/milling otherwise
    this._lerpTo(m, a.x + sp.dx * fx, a.z + sp.dz * fx, Math.min(1, dt * (soon ? 3.5 : 1.5)), true);
  }

  _lerpTo(m, tx, tz, k, face) {
    const ty = this.geo.height(Math.round(tx), Math.round(tz)) + 1;
    m.pos.x += (tx - m.pos.x) * k; m.pos.y += (ty - m.pos.y) * k; m.pos.z += (tz - m.pos.z) * k;
    if (face) { const ddx = tx - m.pos.x, ddz = tz - m.pos.z; if (ddx * ddx + ddz * ddz > 0.04) m.yaw = Math.atan2(ddx, ddz); }
  }

  // Seconds until the VISIBLE train next calls (dwells) at `stationName` on `lineName`, or null.
  // Computed from the deterministic schedule (same the train runs on) and cached ~3s per stop so
  // ~100 folk checking the timetable each frame stays cheap.
  _nextTrainCall(lineName, stationName) {
    this._callCache = this._callCache || new Map();
    const key = lineName + '|' + stationName;
    const nowMs = performance.now();
    const c = this._callCache.get(key);
    if (c && nowMs - c.at < 3000) return c.due == null ? null : Math.max(0, c.due - (nowMs - c.at) / 1000);
    const g = this.game, geo = this.geo;
    const mainName = (geo.railPaths().find(l => l.path === geo.railPath()) || {}).name;
    let schedFn, stops;
    if (lineName === mainName) { schedFn = t => g.trainSchedule(t); stops = geo.railway(); }
    else {
      const bt = (g.branchTrains || []).find(b => b.name === lineName);
      if (!bt) { this._callCache.set(key, { at: nowMs, due: null }); return null; }
      schedFn = t => g.trainScheduleFor(bt.path, bt.stations, t); stops = bt.stations;
    }
    const idx = stops.findIndex(s => s.name === stationName);
    if (idx < 0) { this._callCache.set(key, { at: nowMs, due: null }); return null; }
    const now = Date.now() / 1000;
    let due = null;
    for (let dt = 0; dt < 900; dt += 3) { const s = schedFn(now + dt); if (s.mode === 'dwell' && s.i === idx) { due = dt; break; } }
    this._callCache.set(key, { at: nowMs, due });
    return due;
  }
}
