// Phase B.1 — render the brain's living roster. The brain owns logical state; this file
// owns ALL geometry: it maps {at|walk|rail} to a voxel position the client can draw.
import { rosterState } from './npc.js';
import { B } from './defs.js';

const clamp01 = t => t < 0 ? 0 : t > 1 ? 1 : t;

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
      const s = e.data.state;
      if (s && s.kind === 'walk') {
        const from = townAnchor(s.from, this.geo), to = townAnchor(s.to, this.geo);
        if (from && to) steerWalk(m, from, to, s.started, s.eta, nowEff, this.world, this.geo, dt);
      } else {
        const p = npcVoxelPos(e.data, nowEff, this.geo);   // 'at' anchor / 'rail' on the line
        if (!p) continue;
        const k = Math.min(1, dt * 6);                     // lerp idiom (as multiplayer remotes)
        m.pos.x += (p.x - m.pos.x) * k; m.pos.y += (p.y - m.pos.y) * k; m.pos.z += (p.z - m.pos.z) * k;
        const ddx = p.x - m.pos.x, ddz = p.z - m.pos.z;
        if (ddx * ddx + ddz * ddz > 0.01) m.yaw = Math.atan2(ddx, ddz);
      }
      if (e.data.intent) m.intent = e.data.intent;         // later phase surfaces this in chat/markers
    }
  }
}
