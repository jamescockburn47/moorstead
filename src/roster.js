// Phase B.1 — render the brain's living roster. The brain owns logical state; this file
// owns ALL geometry: it maps {at|walk|rail} to a voxel position the client can draw.
import { rosterState, talkGeneric } from './npc.js';
import { B, CHUNK, WATER_LEVEL } from './defs.js';
import { reportQuiet } from './feedback.js';
import { idHash, innOpen, eveningAtInn, parlourCrowd, parlourSeatFor } from './parlour.js';
import { moveEntity, boxCollides } from './physics.js';

// re-exported so existing callers of roster.js's idHash keep working — the
// hash itself now lives in parlour.js (D3 2026-07-03) so parlour.js can stay
// free of roster.js's THREE-adjacent imports (world.js, defs.js) while both
// modules share the exact same stable FNV-1a hash.
export { idHash };

const clamp01 = t => t < 0 ? 0 : t > 1 ? 1 : t;

// How much of the brain's served roster to actually render. The world got heavy (frames stalling),
// so the crowd is thinned: the cut falls on the anonymous 'pop-' background FIRST (deterministic by
// id-hash → the SAME folk hidden every poll and on every client, no flicker), and the curated/named
// deep cast is always kept. 0.6 = render ~60% (a 40% cut). Live-tunable dial; 1 = render everyone.
export const RENDER_FRACTION = 0.78;

// "Within earshot of the player" — the one shared definition both the banter scheduler
// (_maybeBanter, picks candidate pairs) and the banter runner (_runBanter, gates each line
// through the ambient-speak etiquette) must agree on, so a pair can never be picked as
// "near enough to matter" by one and treated as "far, speak freely" by the other.
const NEAR_PL2 = 22 * 22;

// The true voxel surface at (x,z): one block ABOVE the top non-air/non-water block, so a body
// stands ON the platform deck / building floor rather than sunk into it. geo.height is DEM-only
// and blind to built blocks (platforms, walls), which is why folk clip. Falls back to the DEM
// when the column has no blocks (chunk not loaded) so an unloaded column never pops a body to y~0.
// Cached per column — built geometry is effectively static.
const _surfCache = new Map();
export function __resetSurfCache() { _surfCache.clear(); }   // test hook: stub worlds reuse columns
// Invalidate the surface cache for a single column (call after any block edit near an NPC).
// Passing no args clears the whole cache (safe; it just re-scans on next access).
export function invalidateSurfCache(x, z) {
  if (x === undefined) { _surfCache.clear(); return; }
  _surfCache.delete(Math.round(x) + ',' + Math.round(z));
}
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
  // Find the GROUND: the topmost solid block that has a solid block DIRECTLY below it. Scanning from
  // well above the DEM finds RAISED ground (embankments, the steep coast, harbour builds — the old
  // dem+6 ceiling buried bodies in it, ~14% of columns), and the solid-below test skips roofs, bridge
  // decks, tree canopies and overhangs (solid with AIR below), so a body grounds on the floor, never
  // the roof (which a naive higher ceiling would do at covered stations like Pickering's trainshed).
  let surf = null;
  for (let y = dem + 24; y >= dem - 16 && y > 1; y--) {
    const b = world.getBlock(rx, y, rz);
    if (b === B.AIR || b === B.WATER) continue;
    const below = world.getBlock(rx, y - 1, rz);
    if (below !== B.AIR && below !== B.WATER) { surf = y; break; }
  }
  const h = (surf != null ? surf : dem) + 1;
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

// The parish lane between two town anchors, oriented from->to, or null if no lane joins them.
// A road edge's path endpoints (path.pts[0]/[last]) ARE the two node centres (nudged out of the
// buildings), so we match the two anchors against each edge's two ends and take the best-fitting
// edge within tolerance. Returns the edge's pts re-ordered to run FROM `from` TO `to` (reversed if
// the edge was stored to->from), so a walker can follow them in order. Pure; geo caches the net.
const ROAD_MATCH_TOL = 36;     // an anchor must sit within this of an edge end to count as that end
export function roadWaypoints(from, to, geo) {
  if (!from || !to || typeof geo.roadPaths !== 'function') return null;
  let best = null;
  for (const e of geo.roadPaths()) {
    const pts = e.path && e.path.pts;
    if (!pts || pts.length < 2) continue;
    const p0 = pts[0], p1 = pts[pts.length - 1];
    const d00 = Math.hypot(p0.x - from.x, p0.z - from.z), d11 = Math.hypot(p1.x - to.x, p1.z - to.z);
    const d01 = Math.hypot(p0.x - to.x, p0.z - to.z), d10 = Math.hypot(p1.x - from.x, p1.z - from.z);
    const fwd = Math.max(d00, d11), rev = Math.max(d01, d10);   // worst-end fit for each orientation
    const fit = Math.min(fwd, rev);
    if (fit <= ROAD_MATCH_TOL && (!best || fit < best.fit)) best = { pts, reversed: rev < fwd, fit };
  }
  if (!best) return null;
  return best.reversed ? best.pts.slice().reverse() : best.pts;
}

function _spread(id) {
  const h = idHash(id);
  const a = h / 4294967295 * Math.PI * 2;
  const r = 2 + ((h >>> 9) % 1000) / 1000 * 6;   // 2..8 blocks
  return { dx: Math.cos(a) * r, dz: Math.sin(a) * r };
}

// --- mounted NPCs (roads Slice 2): who saddles up for a walk leg --------------------------------
// Some folk ride a pony along the lanes rather than walk shanks's pony. Deterministic per
// (id, leg) so a body's whole journey is mounted-or-not (no flicker), ~1-in-4 over the cast.
// Mounted trades (drovers move stock, farmers + gentry keep a pony, the doctor + parson ride a
// round) saddle up more often than a townsfolk villager. Short hops are always walked — you don't
// fetch a pony to nip next door. `from`/`to` are town names, as the walk branch passes them.
const RIDE_MIN_DIST = 80;          // blocks: legs shorter than this are always walked
export const RIDE_PACE = 3.5;      // blocks/sec a mounted NPC trots a lane (vs ~2.2 walking) — live-tunable
const RIDE_SEAT_LIFT = 1.0;        // blocks the rider sits above the pony's standing pos (on her back)
const RIDE_BASE = 0.225;           // a generic villager's chance on a ride-eligible leg
// trades that keep/ride a pony — each adds to the base chance (tuned so the cast lands ~20–30%).
const RIDE_ROLE_BONUS = { drover: 0.22, farmer: 0.16, gentry: 0.18, doctor: 0.14, parson: 0.13, carrier: 0.20, squire: 0.18 };
export function ridesThisLeg(npc, from, to, geo) {
  const a = townAnchor(from, geo), b = townAnchor(to, geo);
  if (!a || !b) return false;                                  // unknown place -> walk (safe)
  const dist = Math.hypot(a.x - b.x, a.z - b.z);
  if (dist < RIDE_MIN_DIST) return false;                      // short hop -> always walk
  const id = (npc && npc.id) || '';
  const u = idHash(id + '|' + from + '>' + to) / 4294967296;   // stable 0..1 for this (id, leg)
  const roleBonus = (npc && RIDE_ROLE_BONUS[npc.role]) || 0;
  // a gentle distance ramp: a longer haul is a touch more likely to be worth saddling up for,
  // saturating by ~600 blocks so cross-moor treks don't all ride.
  const distBonus = 0.10 * clamp01((dist - RIDE_MIN_DIST) / 520);
  return u < (RIDE_BASE + roleBonus + distBonus);
}

export const PLATFORM_CAP = 2;     // most NPCs allowed to gather on one platform at once (reduced to cut loitering)
export const WAIT_LEAD = 45;       // seconds before a train is due that a ranked NPC walks to the platform (reduced from 75)

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

// --- booked journeys (timetable-truth brains send dep/arr; spec 2026-07-03) ----------
// With a booking there is no lottery: she potters in town until the lead window,
// walks in to arrive just before her train, and boards on the dwell. The ranked
// waitMode above remains ONLY as the fallback for a dep-less (older) brain.
export const RAIL_WAIT_LEAD = 75;   // seconds before dep to set off for the platform
export function railWaitMode(nowSec, dep, lead = RAIL_WAIT_LEAD) {
  if (dep == null) return null;
  return (dep - nowSec) <= lead ? 'approach' : 'potter';
}

// seat 1..16 across the two coaches, stable per NPC
export function rideSlot(id) { return 1 + (idHash(id) % 16); }
// metres behind the loco lead for a slot — 16 seats spread down the rake
export function slotBack(slot) { return 11 + slot * 0.42; }

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
export function walkableStep(world, geo, x, z, fromY, ford = false) {
  const rx = Math.round(x), rz = Math.round(z);
  if (geo.height(rx, rz) == null) return false;                      // off the map
  // Judge walkability at the REAL surface, not the DEM. geo.height was blind to built/raised ground,
  // tree trunks and carved rivers, so folk stepped straight INTO them (the tree/river clipping). A
  // step of more than ~1 block up or down is a wall, trunk, cliff or river bank to walk AROUND; water
  // underfoot is a river/ford; a solid just overhead is a low branch or eave. Any of those -> go round.
  // `ford` (a road-walker crossing a beck or the line on foot): allow water underfoot AND a bigger
  // bank step, so she wades the lane straight across instead of refusing the river/embankment.
  const s = surfaceHeight(world, geo, rx, rz);
  if (Math.abs(s - fromY) > (ford ? 3.2 : 1.3)) return false;
  if (!ford && (world.getBlock(rx, s, rz) === B.WATER || world.getBlock(rx, s - 1, rz) === B.WATER)) return false;
  const head = world.getBlock(rx, s + 1, rz);
  if (head !== B.AIR && head !== B.WATER) return false;
  return true;
}

// The player's own movement constants (player.js), so streamed folk obey the SAME
// constraints the player does: they can't walk through walls, can't float onto roofs,
// and step up one block — but no higher — exactly like a person on foot.
const NPC_GRAVITY = 26, NPC_JUMP = 8.6, NPC_STEP_UP_CLEAR = 1.25;

// Drive a streamed NPC one physics step through the SAME gate the player uses
// (physics.moveEntity: per-axis AABB collision + ground detection), given a wish
// velocity (vx,vz). Adds gravity so it can never float onto a roof, and an AUTO-HOP
// over a single-block rise (a person on foot steps up; an NPC can't press Space, so
// we hop it for them when it bumps a climbable step). Replaces the old direct
// pos-write + surfaceHeight-snap that let NPCs clip walls, stand on roofs and teleport.
// Cosmetic (the brain owns logical state), so it needn't be deterministic run-to-run.
export function npcMove(mob, vx, vz, world, dt) {
  // an unloaded chunk reads as solid stone everywhere (world.js getBlock) — running
  // collision there would wedge the body; hold position until it streams in.
  if (typeof world.isLoaded === 'function' && !world.isLoaded(mob.pos.x, mob.pos.z)) {
    if (vx || vz) mob.yaw = Math.atan2(vx, vz);
    return;
  }
  if (!mob.vel) mob.vel = { x: 0, y: 0, z: 0 };
  if (mob.passGate === undefined) mob.passGate = true; // folk pass field gates, like the farmer
  const px = mob.pos.x, pz = mob.pos.z;
  mob.vel.x = vx; mob.vel.z = vz;
  // auto-step: bumped a wall last frame, on the ground, and a body's height is clear one
  // block up -> hop the 1-block rise (mirrors the player's mounted step-hop, player.js).
  if (mob.hitWall && mob.onGround &&
      !boxCollides(world, mob.pos.x, mob.pos.y + NPC_STEP_UP_CLEAR, mob.pos.z, mob.hw, 0.6, mob.passGate)) {
    mob.vel.y = NPC_JUMP; mob.onGround = false;
  }
  mob.vel.y -= NPC_GRAVITY * dt;
  mob.vel.y = Math.max(mob.vel.y, -50);
  moveEntity(world, mob, dt);
  // wade on the surface, don't crawl the bed: the lanes are BRIDGELESS fords (roads.js),
  // so float the feet to just below a beck/river surface rather than sinking through the
  // non-solid water to the bed and walking along it submerged.
  const fx = Math.round(mob.pos.x), fz = Math.round(mob.pos.z), fyc = Math.floor(mob.pos.y);
  if (world.getBlock(fx, fyc, fz) === B.WATER) {
    let top = fyc; while (world.getBlock(fx, top + 1, fz) === B.WATER) top++;
    const surf = top + 1;                                // world y of the water surface
    if (mob.pos.y < surf - 0.35) { mob.pos.y = surf - 0.35; if (mob.vel.y < 0) mob.vel.y = 0; mob.onGround = true; }
  }
  if (vx || vz) mob.yaw = Math.atan2(vx, vz);
  // stuck watchdog: with hard collision a walker can wedge against a collider with no
  // clip-through escape (rail travellers have a timeout rescue; walkers/potterers didn't).
  // Accrue no-progress time here; the caller (_unstickDriven) snaps it free on threshold.
  if ((vx || vz) && Math.hypot(mob.pos.x - px, mob.pos.z - pz) < 0.02) mob._stuckT = (mob._stuckT || 0) + dt;
  else mob._stuckT = 0;
}

// Steer a walking mob toward its destination anchor, skirting buildings/walls/trees and
// following the ground, paced to arrive by `eta`. Mutates mob.pos/yaw. The streamed mob's
// own wander AI is off (it's driven here, like a ridden pony / remote player), so this owns
// its locomotion. Server keeps the LOGICAL leg + eta; the client owns HOW it walks there.
// `pace` (blocks/sec), when given, overrides the eta-paced speed. It now drives the mob
// through npcMove (real collision + gravity + step-up), not a direct pos write.
export function steerWalk(mob, from, to, started, eta, now, world, geo, dt, pace, ford = false) {
  const dx = to.x - mob.pos.x, dz = to.z - mob.pos.z;
  const dist = Math.hypot(dx, dz);
  const remain = Math.max(1, eta - now);
  const speed = pace != null ? pace : Math.max(1.2, Math.min(3.0, dist / remain));  // fixed ride pace, or eta-paced
  const goal = Math.atan2(dx, dz);
  // context steering: take the most direct heading (fanned out from the goal) that looks
  // walkable ahead, so folk skirt obstacles BEFORE bumping; collision is the hard backstop.
  const fromY = Math.round(mob.pos.y);
  let best = null;
  for (const off of [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4]) {
    const h = goal + off;
    const lx = mob.pos.x + Math.sin(h) * 1.6, lz = mob.pos.z + Math.cos(h) * 1.6;  // look-ahead
    if (walkableStep(world, geo, lx, lz, fromY, ford)) { best = h; break; }
  }
  if (best == null) best = goal;          // boxed in -> head at the goal; collision + rescue recover
  // ease off near the anchor so we settle on it rather than shoving through it
  const v = dist >= 0.8 ? speed : 0;
  npcMove(mob, Math.sin(best) * v, Math.cos(best) * v, world, dt);
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
        this._misses = 0;
        this._sync(snap.npcs);
      } else if (this.active) {
        // don't mass-despawn ~80 folk on one dropped poll — a real outage is several
        // in a row (~5s at the 1.5s cadence). Then fall back, and SAY so: quiet
        // villagers with no explanation read as "the game's broken".
        this._misses = (this._misses || 0) + 1;
        if (this._misses >= 3) {
          this._teardown();        // brain went away -> drop streamed folk, fall back
          this.active = false;
          this._misses = 0;
          this.game.ui?.toast('T&rsquo; village brain&rsquo;s having a nap &mdash; folk&rsquo;ll walk but won&rsquo;t talk while it wakes.', 8000);
        }
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

  // Thin the served roster to lighten the world — but ONLY the anonymous 'pop-' crowd that's AT HOME
  // (idle in a village). EVERY traveller (walking, riding, or on a rail leg) is kept, so the boarding/
  // walking/riding activity always shows; the named/curated cast is kept too. Stable id-hash gate →
  // the SAME at-home folk hidden every poll an' on every client (no churn). Tunable via RENDER_FRACTION.
  _thin(list) {
    if (RENDER_FRACTION >= 1) return list;
    const cut = Math.round((1 - RENDER_FRACTION) * 100);   // % of the at-home crowd to hide
    return list.filter(d => {
      if (!d.id || !d.id.startsWith('pop-')) return true;                 // named/curated cast — always shown
      if (d.state && d.state.kind && d.state.kind !== 'at') return true;  // travellers (walk/rail) — always shown
      return (idHash(d.id) % 100) >= cut;                                 // thin the idle at-home crowd, stable per id
    });
  }

  _sync(fullList) {
    const list = this._thin(fullList);
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
    this._despawnMount(e);                                 // leak guard: never strand a pony
    if (!e.mob) return;
    this.game.entities.scene.remove(e.mob.model.group);   // codebase despawn idiom (no removeMob helper)
    e.mob.dead = true;                                     // culled from entities.mobs next frame
  }
  _teardown() { for (const [, e] of this.npcs) this._remove(e); this.npcs.clear(); }

  // ---- seabed guard (client-side; James's call, 2026-07-03) --------------------------------
  // The brain streams LOGICAL waypoints, and a walk leg's straight line (or a coast town's
  // crowd-spread) can land a body over open sea — grounding then marched her along the SEA BED
  // ("I saw an NPC walking on the bottom of the sea"). Until the brain keeps its waypoints on
  // land (server-side fix, EVO roster_sim), a body stood on a sub-sea column is simply not
  // drawn; she pops back the moment her cell is dry land again. A fordable RIVER column stays
  // visible — road legs wade becks at the water surface (steerWalk's ford clamp), which reads
  // right. Cheap for ~100 NPCs: one geo.height lookup only when she CHANGES CELL, cached on
  // the entry (zero lookups while she stands still).
  _subSea(e, m) {
    const rx = Math.round(m.pos.x), rz = Math.round(m.pos.z);
    const key = rx + ',' + rz;
    if (e._seaKey === key) return e._seaSub;
    e._seaKey = key;
    const g = this.geo.height(rx, rz);          // sea: worldgen fills water where terrain < WATER_LEVEL
    e._seaSub = g != null && g < WATER_LEVEL &&
      !(typeof this.geo.riverColumn === 'function' && this.geo.riverColumn(rx, rz));
    return e._seaSub;
  }

  // ---- mounted NPCs (roads Slice 2) ----
  // Spawn a pony under a riding NPC for this leg. It's CONTROLLED, not wild: `ridden` makes the
  // entities AI skip it (no wander/gravity/distance-despawn — exactly as a player-ridden pony is
  // posed by the game, entities.js:1780), and `rosterMount` keeps it out of the wild-spawn cap and
  // un-hijackable by the player. We pose it ourselves each frame from the walk branch.
  _spawnMount(e, at) {
    if (e._pony) return e._pony;
    const y = surfaceHeight(this.world, this.geo, at.x, at.z);
    const pony = this.game.entities.spawnMob('pony', at.x, y, at.z);
    pony.ridden = true;          // entities AI leaves a ridden pony to its driver (us)
    pony.rosterMount = true;     // not a wild pony: excluded from the spawn cap, can't be mounted
    if (pony.label) pony.label.material.opacity = 0;   // no "right-click to ride" on an NPC's mount
    e._pony = pony;
    return pony;
  }

  // Seat the rider villager mob on the pony's back, facing travel. Mirrors updateMount's pose
  // (main.js): the rider sits a seat-lift above the pony's standing pos and shares its yaw. The
  // streamed-villager dressing in entities.js then draws the model at mob.pos/yaw, so the rider
  // rides ON the back (not through it, not floating).
  _seatRider(e) {
    const pony = e._pony, m = e.mob; if (!pony || !m) return;
    m.pos.x = pony.pos.x; m.pos.z = pony.pos.z;
    m.pos.y = pony.pos.y + RIDE_SEAT_LIFT;               // up on her back
    m.yaw = pony.yaw;                                    // face the way the pony trots
  }

  // Draw + animate the driven pony (the entities AI skips a `ridden` mob, so we own its model).
  // group sits a touch below the standing pos; the legs stride from a walkPhase advanced by how far
  // she moved this frame. FACING: pony.yaw is steerWalk's atan2(dx,dz) — the SAME convention a wild
  // pony is drawn in (entities.js: rotation.y = atan2(vel), no offset) and makePony is head-to-+Z —
  // so the model is posed at exactly pony.yaw. (updateMount adds +π because it poses off the PLAYER's
  // *camera* yaw, a different source; copying that here trotted the pony, and the rider, backwards.)
  _strideMount(pony, dt) {
    const g = pony.model.group;
    const lp = pony._lastPos || pony.pos;
    const sp = Math.hypot(pony.pos.x - lp.x, pony.pos.z - lp.z) / Math.max(dt, 0.001);
    pony._lastPos = { x: pony.pos.x, y: pony.pos.y, z: pony.pos.z };
    g.position.set(pony.pos.x, pony.pos.y - 0.15, pony.pos.z);
    g.rotation.y = pony.yaw;
    pony.walkPhase = (pony.walkPhase || 0) + Math.min(sp, 8) * dt * 0.9;
    const swing = Math.sin(pony.walkPhase) * Math.min(1, sp / 3) * 0.5;
    if (pony.model.legs) pony.model.legs.forEach((l, i) => { l.rotation.x = (i % 2 === 0 ? swing : -swing); });
  }

  // Remove an NPC's pony and clear all seat state (mirrors the streamed-villager removal idiom).
  // Idempotent — safe to call on a leg end, a brain-state change, removal or teardown.
  _despawnMount(e) {
    const pony = e && e._pony; if (!pony) return;
    if (!pony.dead) {
      this.game.entities.scene.remove(pony.model.group);
      pony.dead = true;                                  // culled from entities.mobs next frame
    }
    e._pony = null;
  }

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
      const s = e.data.state;
      // A committed ride shows the VISIBLE journey, but the BRAIN is the source of truth for where she
      // should be — a ride must not outlive its leg and strand her loitering at a station. Once ABOARD
      // (or walking off at 'done') the visible trip finishes past the brain's faster logical arrival;
      // but a 'wait' that no longer matches a LIVE brain rail leg to the same place is dropped at once —
      // she never boarded and the brain has moved her on, so she stops hanging about the platform. This
      // is what stops dozens of stale waits piling up at stations when trains run slower than the brain.
      if (e.ride) {
        const matches = s && s.kind === 'rail' && e.ride.line === s.line && e.ride.from === s.fromStn && e.ride.to === s.toStn;
        if (e.ride.phase !== 'wait' || matches) { if (e._pony) this._despawnMount(e); this._driveRail(e, m, dt, rankMap); continue; }
        e.ride = null;                                       // stale wait — fall through to her current brain state
      }
      if (s && s.kind === 'rail') {                         // commit a NEW ride (only when ride-less)
        if (e._pony) this._despawnMount(e);                 // off the lane onto the rails — no orphan pony
        e.ride = { line: s.line, from: s.fromStn, to: s.toStn, phase: 'wait', t: 0,
                   dep: s.dep != null ? s.dep : null, arr: s.arr != null ? s.arr : null };
        this._driveRail(e, m, dt, rankMap);
        continue;
      }
      if (s && s.kind === 'walk') {
        const from = townAnchor(s.from, this.geo), to = townAnchor(s.to, this.geo);
        if (from && to) {
          // reset the lane index when a NEW walk leg starts (changed from/to/started), so she
          // never resumes a stale waypoint from her last errand. Decide ride-or-walk ONCE per leg
          // (stable, no per-frame re-roll): saddle a pony up front, or drop a stale one from a past leg.
          const legKey = s.from + '>' + s.to + '@' + s.started;
          if (e._roadLeg !== legKey) {
            e._roadLeg = legKey; e._roadI = 0;
            // resolve the lane ONCE per leg — it's stable for the whole leg. (It was being recomputed
            // every frame for every walker, and a reverse-stored edge re-allocated a full copy of its
            // path each time: needless work + GC churn across the moor.)
            e._roadLane = roadWaypoints(from, to, this.geo);
            if (ridesThisLeg(e.data, s.from, s.to, this.geo)) this._spawnMount(e, m.pos);
            else this._despawnMount(e);
          }
          // mounted -> drive the PONY along the lane at a trot; the rider follows on her back.
          // afoot -> drive the rider mob herself, exactly as before.
          const drv = e._pony || m;
          const pace = e._pony ? RIDE_PACE : undefined;
          const lane = e._roadLane;
          if (lane) {
            // follow the lane: steer to the current waypoint; advance once within a couple of blocks;
            // past the last waypoint, make for the final `to` anchor (the lane ends near it). `ford`=true
            // so she wades the beck + steps over the line on foot rather than refusing the crossing.
            let i = e._roadI | 0;
            if (i < lane.length) {
              const wp = lane[i];
              const goal = { x: wp.x, y: surfaceHeight(this.world, this.geo, wp.x, wp.z), z: wp.z };
              if ((drv.pos.x - wp.x) ** 2 + (drv.pos.z - wp.z) ** 2 < 4) { e._roadI = ++i; }   // ~2 blocks -> next
              steerWalk(drv, from, goal, s.started, s.eta, nowEff, this.world, this.geo, dt, pace, true);
            } else {
              steerWalk(drv, from, to, s.started, s.eta, nowEff, this.world, this.geo, dt, pace, true);
            }
          } else {
            steerWalk(drv, from, to, s.started, s.eta, nowEff, this.world, this.geo, dt, pace, true);   // no lane -> direct (still mounted)
          }
          if (e._pony) {
            // arrival: the moment the pony reaches the destination anchor she's dismounted on the
            // spot — the rider swings down at the town edge and the pony's gone (no waiting on the
            // next brain poll to drop her). Otherwise: stride the legs + keep the rider seated.
            if ((e._pony.pos.x - to.x) ** 2 + (e._pony.pos.z - to.z) ** 2 < 4) {
              this._seatRider(e);                            // last seated frame at the anchor
              this._despawnMount(e);                         // ...then down she gets, pony away
              m.pos.y = surfaceHeight(this.world, this.geo, m.pos.x, m.pos.z);   // stand on the ground, not the saddle
            } else {
              this._strideMount(e._pony, dt); this._seatRider(e);
            }
          }
          // rescue a wedged walker/pony: hard collision can trap it and (unlike a rail
          // traveller) there's no timeout to save it — snap it free on the stuck threshold.
          if (this._unstickDriven(drv, e, nowEff) && e._pony) this._seatRider(e);
        }
      } else {                                              // 'at': potter about her patch — afoot, drop any leg pony
        if (e._pony) this._despawnMount(e);
        const parlourPlan = this._parlourPlanFor(m, e);
        if (parlourPlan) {
          // Evening at the pub (D3, client-side cosmetic — see parlour.js header):
          // teleport-to-seat on entering the window, legs stilled, activity relabelled
          // to match where she's actually drawn. Truthful because both the position
          // AND the label change together (same idiom as _spread's fan-out).
          const seat = parlourSeatFor(m._parlourIdx, parlourPlan);
          m.pos.x = seat.x; m.pos.y = seat.y; m.pos.z = seat.z;
          m.walkPhase = 0;
          m.activityShort = seat.table ? ('playing ' + seat.game) : 'having a quiet pint';
          m.parloured = parlourPlan;
        } else {
          m.parloured = null;
          const p = npcVoxelPos(e.data, nowEff, this.geo);
          if (p) { this._potterAt(m, p, nowEff, dt); this._unstickDriven(m, e, nowEff); }
        }
      }
      // seabed guard: after this frame's drive, a body grounded on a sub-sea column is hidden
      // (her leg pony an' all) rather than drawn strolling the sea bed; this also owns the
      // visible=true restore for walkers/potterers — she shows again the moment she's on dry
      // land (or back off a rail leg). See _subSea for the cost + the river-ford exemption.
      const vis = !this._subSea(e, m);
      if (grp) grp.visible = vis;
      if (e._pony && e._pony.model) e._pony.model.group.visible = vis;
    }
    this._maybeBanter(dt);                                  // ambient NPC↔NPC natter when a player's nearby
  }

  // ---- ambient NPC↔NPC banter (LLM-voiced, but gated to keep the brain cool) ----
  // James: "llm chat when a player is near, one convo at a time." So it fires ONLY when a player is
  // within earshot, never more than ONE exchange in flight, with a cooldown after. Two idle neighbours
  // trade a line or two through the brain's existing generic passer-by voice (no new endpoint, no
  // stored memory). The hard gates mean at most ~2 generic calls per ~30s while watched — negligible
  // load on the box, exactly what James asked for.
  _maybeBanter(dt) {
    if (this._banterCool > 0) this._banterCool -= dt;
    if (this._banterBusy) return;                          // one convo at a time
    this._banterScan = (this._banterScan || 0) - dt;
    if (this._banterScan > 0 || this._banterCool > 0) return;
    this._banterScan = 2.5;                                 // hunt for a pair every ~2.5s
    const pl = this.game.player; if (!pl || !pl.pos) return;
    const NEAR_EACH2 = 14;                                  // ~3.7 blocks apart (NEAR_PL2 is module-level, shared with _runBanter)
    const cands = [];
    for (const [, e] of this.npcs) {
      const m = e.mob, s = e.data && e.data.state;
      if (!m || m.chatting || m.bubble) continue;           // not mid player-chat, not already speaking
      if (m.parloured) continue;                            // D3: teleported to the parlour — her banter partner near the player's real position would be a lie
      if (s && s.kind !== 'at') continue;                   // only idle, at-home folk natter
      if ((m.pos.x - pl.pos.x) ** 2 + (m.pos.z - pl.pos.z) ** 2 > NEAR_PL2) continue;
      cands.push(e);
    }
    for (let i = 0; i < cands.length; i++) {
      for (let j = i + 1; j < cands.length; j++) {
        const a = cands[i].mob, b = cands[j].mob;
        if ((a.pos.x - b.pos.x) ** 2 + (a.pos.z - b.pos.z) ** 2 <= NEAR_EACH2) {
          this._runBanter(cands[i], cands[j]);
          return;
        }
      }
    }
  }

  _faceEachOther(m, other) {
    const dx = other.pos.x - m.pos.x, dz = other.pos.z - m.pos.z;
    if (dx * dx + dz * dz > 0.01) m.yaw = Math.atan2(dx, dz);
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // Run ONE short exchange between two neighbours through the generic brain voice. A opens; B replies
  // to what A actually said (so it reads as a real natter, not two monologues). Fully guarded — a brain
  // hiccup or a despawn just ends it, and the lock + cooldown are always released in `finally`.
  async _runBanter(eA, eB) {
    this._banterBusy = true;
    try {
      const A = eA.mob, B = eB.mob;
      const home = e => e.data.home || (e.data.state && e.data.state.place) || 'the village';
      const pa = { name: eA.data.name, role: eA.data.role, village: home(eA), mood: 'content' };
      const pb = { name: eB.data.name, role: eB.data.role, village: home(eB), mood: 'content' };
      this._faceEachOther(A, B); this._faceEachOther(B, A);
      const ctxA = `You are ${pa.name}, a ${pa.role} in ${pa.village}. You meet your neighbour ${pb.name}, a ${pb.role}. Greet them or pass ONE brief neighbourly remark — a single short sentence, in character, North York Moors about 1900. No stage directions, no asterisks.`;
      const r1 = await talkGeneric(pa, `${pb.name} the ${pb.role} stops beside you.`, null, ctxA);
      if (this._stopped || A.dead || B.dead || !r1 || !r1.reply) return;
      const _nearPlayer = (m) => {
        const p = this.game.player && this.game.player.pos;
        if (!p) return false;
        const dx = m.pos.x - p.x, dz = m.pos.z - p.z;
        return dx * dx + dz * dz <= NEAR_PL2;   // same "within earshot" band _maybeBanter already selected on
      };
      const _banterSpeak = (m, text) =>
        _nearPlayer(m) ? this.game.entities.speakAmbient(m, text, 6)
                       : (this.game.entities.speak(m, text, 6), true);
      if (!_banterSpeak(A, r1.reply)) return;   // parish is mid-natter — let this one lapse
      await this._sleep(2800);
      if (this._stopped || A.dead || B.dead) return;
      const ctxB = `You are ${pb.name}, a ${pb.role} in ${pb.village}. Your neighbour ${pa.name} just said: "${r1.reply}". Reply briefly in character — a single short sentence, North York Moors about 1900. No stage directions, no asterisks.`;
      const r2 = await talkGeneric(pb, r1.reply, null, ctxB);
      if (!this._stopped && !B.dead && r2 && r2.reply) { this._faceEachOther(B, A); _banterSpeak(B, r2.reply); }
    } catch (e) { reportQuiet('banter', e); /* brain didn't answer — let the natter lapse quietly, but count it on the ledger */ }
    finally {
      this._banterBusy = false;
      this._banterCool = 25 + Math.random() * 25;           // a breather before the next one
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
    // safety net: never wait OR ride forever. MUST exceed one full line cycle,
    // or a terminus passenger (dwelt once per ~17-min round trip) times out and
    // warps off BEFORE her train comes back — the reason booked NPCs never
    // boarded (James 2026-07-04). Longest cycle measured ~1301s (Whitby&Pickering),
    // so 1500s gives a whole cycle to catch the one dwell, plus margin.
    if (ride.t > 1500) { this._resolveToBrain(e, m); return; }

    if (ride.phase === 'aboard') {
      // ride VISIBLY as a passenger in the coaches: sit on the rail deck behind the loco.
      if (grp && !grp.visible) grp.visible = true;
      if (vt && vt.path && vt.chainage != null) {
        const poseFwd = vt.dir === 0 ? 1 : -1;
        if (e.ride.slot == null) e.ride.slot = rideSlot(e.data.id); // 1..16 across the two coaches
        const back = slotBack(e.ride.slot);                 // ~11.4..17.7 m behind the loco lead — 16 seats down the rake
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
    // Keep ride.dep aimed at a train the VISIBLE service can actually make: the
    // brain's booked dep is its LOGICAL departure and often doesn't line up with
    // when the one visible train next dwells at `from`. Re-aim to the real next
    // dwell when the booked dep is already past (she'd have missed it) or is
    // further out than a whole cycle (a terminus booking that would strand her).
    // Reset the phase clock only when the TARGET dwell actually changes, so the
    // 1500s timeout still tracks the current attempt without being reset every
    // frame. (James 2026-07-04: booked but never boarded.)
    const nowSec = Date.now() / 1000;
    if (ride.dep == null || nowSec > ride.dep + 30 || ride.dep - nowSec > 1400) {
      const due = this._nextTrainCall(ride.line, ride.from);
      if (due != null) {
        const target = Math.round(nowSec + due);
        if (ride._aimDwell == null || Math.abs(target - ride._aimDwell) > 5) { ride._aimDwell = target; ride.t = 0; }
        ride.dep = nowSec + due;
      }
    }
    // Booked journey: no lottery, no platform cap — she times her walk to the train.
    const bm = railWaitMode(Date.now() / 1000, ride.dep);
    if (bm === 'potter') {
      const sp = _spread(e.data.id);
      this._potterAt(m, { x: a.x + sp.dx, z: a.z + sp.dz }, this._nowEff(), dt);
      return;
    }
    if (bm === 'approach') {
      this._walkTo(m, platformPoint(this.world, this.geo, ride.line, ride.from) || a, dt);
      return;
    }
    // (bm === null: dep-less legacy brain — ranked waitMode below still applies)
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
    // board if NEAR the dwelling train, not pixel-perfect on the platform: some villages (the coast
    // ones especially) sit right on the platform, so a body milling there is a few blocks off — a
    // strict ~2-block gate made it miss the train it was plainly stood beside. 8 blocks.
    return (m.pos.x - pp.x) ** 2 + (m.pos.z - pp.z) ** 2 < 64;
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

  // A walker/potterer wedged by hard collision (no clip-through escape, and no rail
  // timeout to save it — that only fires for e.ride): after ~7s of no progress (tracked
  // by npcMove as _stuckT) snap it to the brain's current voxel position, past whatever
  // it caught on, and carry on. Rare; the alternative is a body frozen against a wall.
  _unstickDriven(drv, e, nowEff) {
    if ((drv._stuckT || 0) <= 7) return false;
    const p = npcVoxelPos(e.data, nowEff, this.geo);
    if (p) {
      drv.pos.x = p.x; drv.pos.z = p.z;
      drv.pos.y = surfaceHeight(this.world, this.geo, p.x, p.z);
      if (drv.vel) { drv.vel.x = 0; drv.vel.y = 0; drv.vel.z = 0; }
    }
    drv._stuckT = 0;
    return true;
  }

  // D3: is this 'at'-kind NPC in the pub tonight? Her village needs a plan (an
  // inn), it needs to be the evening crowd window, and her id needs to be one
  // of tonight's PARLOUR_CAP drawn from parlourCrowd (salted per-village, so a
  // different pub's crowd is independent). Returns the plan (truthy) with
  // m._parlourIdx set to her stable seat index, or null when she's not in.
  // Cached per mob per poll interval (m._parlourCheckAt) — parlourCrowd/hash
  // work is cheap but there's no need to redo it every frame for ~100 NPCs.
  // COUPLING (review 2026-07-03): the crowd is computed from THIS CLIENT's
  // post-_thin() roster. Today that's identical on every client because
  // RENDER_FRACTION is a global constant and the thinning cut is id-hashed —
  // but if render fraction ever becomes per-client (perf slider), two players
  // in the same parlour would see DIFFERENT drinkers. If that ships, feed
  // parlourCrowd the UN-thinned id list instead.
  _parlourPlanFor(m, e) {
    const village = m.village;
    if (!village) return null;
    const inns = this.game.world && this.game.world.gen && this.game.world.gen.inns;
    const plan = inns && inns.get(village);
    if (!plan) return null;
    const sky = this.game.sky;
    if (!sky || !eveningAtInn(sky.time)) return null;
    if (m._parlourCheckAt == null || performance.now() - m._parlourCheckAt > 5000) {
      m._parlourCheckAt = performance.now();
      const townIds = [];
      for (const [, o] of this.npcs) {
        if (o.data && (o.data.home === village || (o.data.state && o.data.state.place === village))) townIds.push(o.data.id);
      }
      const crowd = parlourCrowd(townIds, village);
      const idx = crowd.indexOf(e.data.id);
      m._parlourIdx = idx >= 0 ? idx : -1;
    }
    return m._parlourIdx >= 0 ? plan : null;
  }

  // Potter gently about a patch so a town looks alive, not frozen: a slow wander around `anchor`
  // (+ obstacle check), re-aimed every 5–13s. Used by resting 'at' folk AND by rail travellers
  // who are waiting for a train that isn't due yet (so they wait in town, not on the platform).
  _potterAt(m, anchor, nowEff, dt) {
    if (m._ambleT == null || nowEff > m._ambleT) {
      m._ambleT = nowEff + 4 + Math.random() * 7;
      const r = Math.random() * 5.0, ang = Math.random() * Math.PI * 2;
      const cx = anchor.x + Math.cos(ang) * r, cz = anchor.z + Math.sin(ang) * r;
      const fromG = this.geo.height(Math.round(anchor.x), Math.round(anchor.z));
      if (walkableStep(this.world, this.geo, cx, cz, fromG)) { m._ambleDX = Math.cos(ang) * r; m._ambleDZ = Math.sin(ang) * r; }
      else { m._ambleDX = 0; m._ambleDZ = 0; }
    }
    const tx = anchor.x + (m._ambleDX || 0), tz = anchor.z + (m._ambleDZ || 0);
    const dx = tx - m.pos.x, dz = tz - m.pos.z, d = Math.hypot(dx, dz);
    const spd = d > 0.4 ? Math.min(1.1, d * 1.4) : 0;   // a gentle amble; settle when arrived
    npcMove(m, d > 0.001 ? dx / d * spd : 0, d > 0.001 ? dz / d * spd : 0, this.world, dt);
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
    // scan a FULL pingpong cycle (~2x one-way): a TERMINUS is only dwelt at once per round trip,
    // so a 900s window missed it (-> due=null -> the NPC pottered forever and never boarded).
    for (let dt = 0; dt < 1900; dt += 3) { const s = schedFn(now + dt); if (s.mode === 'dwell' && s.i === idx) { due = dt; break; } }
    this._callCache.set(key, { at: nowMs, due });
    return due;
  }
}
