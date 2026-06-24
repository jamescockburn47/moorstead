// Phase B.1 — render the brain's living roster. The brain owns logical state; this file
// owns ALL geometry: it maps {at|walk|rail} to a voxel position the client can draw.
import { rosterState } from './npc.js';
import { B, CHUNK } from './defs.js';

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
  const dem = geo.height(rx, rz);
  // Only trust the voxel column when its chunk is LOADED. An ungenerated chunk returns B.STONE for
  // every block (world.js getBlock — so nowt falls through the world), which would otherwise read as
  // a surface at the top of the scan and float a body ~6 blocks up. Unloaded -> ground on the DEM,
  // uncached (the chunk may load later with a real, possibly built, surface).
  if (!world.chunkAt(Math.floor(rx / CHUNK), Math.floor(rz / CHUNK))) return dem + 1;
  const key = rx + ',' + rz;
  const c = _surfCache.get(key);
  if (c !== undefined) return c;
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

const PLATFORM_OFFSET = 3;        // planks sit 2..4 blocks off the rail centre (worldgen stampStations)
const _platCache = new Map();
export function __resetPlatCache() { _platCache.clear(); }   // test hook
// A standing point ON the station platform for (line, station): step out from the rail to the
// planked side and ground on the deck. The platform may be on either (or both) sides, so probe
// both and stand on whichever reads as a built surface nearest the rail deck. null if unresolved.
export function platformPoint(world, geo, line, station) {
  const key = line + '|' + station;
  const c = _platCache.get(key); if (c) return c;
  const lp = geo.railPaths().find(l => l.name === line);
  const ln = geo.railLines().find(l => l.name === line);
  if (!lp || !ln) return null;
  const idx = ln.stops.findIndex(t => t.name === station);
  if (idx < 0) return null;
  const p = geo.samplePosOn(lp.path, lp.path.stationS[idx]);   // {x,z,deck,tx,tz}
  let best = null;
  for (const s of [1, -1]) {
    const px = p.x + (-p.tz) * PLATFORM_OFFSET * s;
    const pz = p.z + (p.tx) * PLATFORM_OFFSET * s;
    const y = surfaceHeight(world, geo, px, pz);
    const dDeck = Math.abs((y - 1) - p.deck);                  // plank side reads ~deck; open side reads ground
    if (!best || dDeck < best.dDeck) best = { x: px, y, z: pz, dDeck };
  }
  const out = { x: best.x, y: best.y, z: best.z };
  _platCache.set(key, out);
  return out;
}

// the town's anchor: its marker coordinate + standing height. null if the name is unknown.
export function townAnchor(name, geo) {
  const v = geo.villages.find(t => t.name === name);
  if (!v) return null;
  return { x: v.x, y: (v.ground != null ? v.ground : geo.height(v.x, v.z)) + 1, z: v.z };
}

// stable FNV-1a over the id — deterministic run-to-run (Math.imul keeps it 32-bit).
export function idHash(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function _spread(id) {
  const h = idHash(id);
  const a = h / 4294967295 * Math.PI * 2;
  const r = 2 + ((h >>> 9) % 1000) / 1000 * 6;   // 2..8 blocks
  return { dx: Math.cos(a) * r, dz: Math.sin(a) * r };
}

export const PLATFORM_CAP = 5;     // most NPCs allowed to gather on one platform at once
export const WAIT_LEAD = 75;       // seconds before a train is due that a ranked NPC walks to the platform

// This id's rank (0 = first) among the ids waiting for the SAME (line, from). Deterministic by
// id-hash, with the id string as a tiebreak, so the set of approachers is stable frame-to-frame.
export function waiterRank(id, groupIds) {
  const mine = idHash(id);
  let r = 0;
  for (const other of groupIds) {
    if (other === id) continue;
    const h = idHash(other);
    if (h < mine || (h === mine && other < id)) r++;
  }
  return r;
}

// What a waiting NPC should do this frame: approach the platform only if within the cap AND the
// train is nearly due; otherwise potter in town (keeps platforms empty until a train is coming).
export function waitMode(due, rank) {
  if (rank >= PLATFORM_CAP) return 'potter';
  if (due != null && due <= WAIT_LEAD) return 'approach';
  return 'potter';
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
  const aboard = ride && ride.phase === 'aboard';
  const waiting = ride && ride.phase === 'wait';
  let where, short;
  if (aboard) {
    where = `on the train to ${ride.to}`;
    short = `→ ${ride.to} (train)`;
  } else if (waiting) {
    where = `waiting for the train to ${ride.to}`;
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
  mob.pos.y = surfaceHeight(world, geo, nx, nz);                     // follow the built surface, not just DEM
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

  update(dt) {
    if (!this.active) return;
    const nowEff = this._nowEff();
    // group the folk waiting for each (line|from) so the platform stays capped at PLATFORM_CAP.
    const rankMap = new Map();
    for (const [, e] of this.npcs) {
      if (e.ride && e.ride.phase === 'wait') {
        const key = e.ride.line + '|' + e.ride.from;
        let g = rankMap.get(key); if (!g) { g = []; rankMap.set(key, g); }
        g.push(e.data.id);
      }
    }
    for (const [, e] of this.npcs) {
      const m = e.mob; if (!m) continue;
      const grp = m.model && m.model.group;
      const act = npcActivity(e.data, e.ride);
      m.activity = act.full; m.activityShort = act.short;
      if (!m.village) m.village = e.data.home || (e.data.state && e.data.state.place) || null;
      // Hailed: face the player and hold; her errand (ride timer included) resumes when chat closes.
      if (m.chatting) {
        const pl = this.game.player;
        if (pl && pl.pos) {
          const dx = pl.pos.x - m.pos.x, dz = pl.pos.z - m.pos.z;
          if (dx * dx + dz * dz > 0.01) m.yaw = Math.atan2(dx, dz);
        }
        continue;
      }
      // A committed ride OWNS her until it completes or times out — the brain's faster logical
      // arrival does NOT cut it short (that was the old teleport). _driveRail clears e.ride itself.
      if (e.ride) { this._driveRail(e, m, dt, rankMap); continue; }
      const s = e.data.state;
      if (s && s.kind === 'rail') {                         // commit a NEW ride (only when ride-less)
        e.ride = { line: s.line, from: s.fromStn, to: s.toStn, phase: 'wait', t: 0 };
        this._driveRail(e, m, dt, rankMap);
        continue;
      }
      if (grp && !grp.visible) grp.visible = true;
      if (s && s.kind === 'walk') {
        const from = townAnchor(s.from, this.geo), to = townAnchor(s.to, this.geo);
        if (from && to) steerWalk(m, from, to, s.started, s.eta, nowEff, this.world, this.geo, dt);
      } else {                                              // 'at': potter about her patch
        const p = npcVoxelPos(e.data, nowEff, this.geo);
        if (p) this._potterAt(m, p, nowEff, dt);
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

  // Drive a committed rail journey (e.ride) against the VISIBLE train. The ride is authoritative
  // and persists past the brain's faster logical arrival: she waits in town, walks onto the
  // platform as the train nears (capped per platform), boards when it dwells, rides in the coaches,
  // and alights into the destination town. A 720s timeout resolves a stuck ride gracefully.
  _driveRail(e, m, dt, rankMap) {
    const ride = e.ride;
    if (ride._phase !== ride.phase) { ride._phase = ride.phase; ride.t = 0; }   // each phase gets its own clock
    ride.t += dt;
    const grp = m.model && m.model.group;
    const vt = this._visibleTrain(ride.line);

    // board / alight transitions, read off the visible train's dwell
    if (vt && vt.dwelling) {
      if (ride.phase === 'wait' && vt.station === ride.from && this._atPlatform(m, ride)) ride.phase = 'aboard';
      else if (ride.phase === 'aboard' && vt.station === ride.to) ride.phase = 'done';
    }
    // safety net: never wait OR ride forever — each phase resolves within ~1.6 train cycles, so a
    // train that never dwells at `from` (couldn't board) OR never reaches `to` (stuck aboard) both
    // fall back gracefully. The short 'done' walk clears the ride long before its clock runs out.
    if (ride.t > 720) { this._resolveToBrain(e, m); return; }

    if (ride.phase === 'aboard') {
      // ride VISIBLY as a passenger in the coaches: sit on the rail deck behind the loco.
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

    if (ride.phase === 'done') {                            // alighted — walk off the platform into town
      const town = townAnchor(ride.to, this.geo);
      if (!town) { e.ride = null; return; }
      if ((m.pos.x - town.x) ** 2 + (m.pos.z - town.z) ** 2 < 9) { e.ride = null; return; }  // home in town -> resync
      this._walkTo(m, town, dt);
      return;
    }

    // phase 'wait'
    const a = townAnchor(ride.from, this.geo); if (!a) return;
    if (ride.titleForced) {                                 // title preview: converge straight on to board the watched train
      this._walkTo(m, platformPoint(this.world, this.geo, ride.line, ride.from) || a, dt);
      return;
    }
    const due = this._nextTrainCall(ride.line, ride.from);
    const group = (rankMap && rankMap.get(ride.line + '|' + ride.from)) || [e.data.id];
    const mode = waitMode(due, waiterRank(e.data.id, group));
    if (mode === 'potter') {                                // wait in town, dispersed like resting folk (not clumped on the marker)
      const sp = _spread(e.data.id);
      this._potterAt(m, { x: a.x + sp.dx, z: a.z + sp.dz }, this._nowEff(), dt);
      return;
    }
    this._walkTo(m, platformPoint(this.world, this.geo, ride.line, ride.from) || a, dt);   // approach the platform
  }

  // Walk a streamed mob toward a point at a steady pace, grounded on the built surface.
  _walkTo(m, to, dt, pace = 2.2) {
    const ty = surfaceHeight(this.world, this.geo, to.x, to.z);
    const dist = Math.hypot(to.x - m.pos.x, to.z - m.pos.z);
    steerWalk(m, null, { x: to.x, y: ty, z: to.z }, 0, Math.max(1, dist / pace), 0, this.world, this.geo, dt);
  }

  // Has she reached the boarding spot for this ride's origin platform? (true if unresolved, so a
  // missing platform never blocks boarding).
  _atPlatform(m, ride) {
    const pp = platformPoint(this.world, this.geo, ride.line, ride.from);
    if (!pp) return true;
    return (m.pos.x - pp.x) ** 2 + (m.pos.z - pp.z) ** 2 < 6;
  }

  // The visible ride couldn't be delivered (720s stuck): drop the ride and place her at whatever
  // the brain now says, instantly (no slide across the map / through scenery). The next frame's
  // state branch then drives her normally from there.
  _resolveToBrain(e, m) {
    const p = npcVoxelPos(e.data, this._nowEff(), this.geo);
    e.ride = null;
    if (!p) return;
    m.pos.x = p.x; m.pos.z = p.z; m.pos.y = surfaceHeight(this.world, this.geo, p.x, p.z);
    const grp = m.model && m.model.group; if (grp) grp.visible = true;
  }

  // Potter gently about a patch so a town looks alive, not frozen: a slow wander around `anchor`
  // (+ obstacle check), re-aimed every 5–13s. Used by resting 'at' folk AND by rail travellers
  // who are waiting for a train that isn't due yet (so they wait in town, not on the platform).
  _potterAt(m, anchor, nowEff, dt) {
    if (m._ambleT == null || nowEff > m._ambleT) {
      m._ambleT = nowEff + 5 + Math.random() * 8;
      const r = Math.random() * 2.2, ang = Math.random() * Math.PI * 2;
      const cx = anchor.x + Math.cos(ang) * r, cz = anchor.z + Math.sin(ang) * r;
      const fromG = this.geo.height(Math.round(anchor.x), Math.round(anchor.z));
      if (walkableStep(this.world, this.geo, cx, cz, fromG)) { m._ambleDX = Math.cos(ang) * r; m._ambleDZ = Math.sin(ang) * r; }
      else { m._ambleDX = 0; m._ambleDZ = 0; }
    }
    const tx = anchor.x + (m._ambleDX || 0), tz = anchor.z + (m._ambleDZ || 0);
    const k = Math.min(1, dt * 1.6);
    m.pos.x += (tx - m.pos.x) * k; m.pos.z += (tz - m.pos.z) * k;
    m.pos.y += (surfaceHeight(this.world, this.geo, m.pos.x, m.pos.z) - m.pos.y) * k;
    const ddx = tx - m.pos.x, ddz = tz - m.pos.z;
    if (ddx * ddx + ddz * ddz > 0.02) m.yaw = Math.atan2(ddx, ddz);
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
