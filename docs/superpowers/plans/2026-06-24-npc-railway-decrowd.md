# De-crowd the Railway — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop NPCs mobbing the train platforms, fix them clipping into scenery, and make boarding/alighting ride the real visible train — while keeping the world busy.

**Architecture:** Client (`src/roster.js`) owns all geometry: waiting NPCs potter in their town until their train is ~due, then walk onto the platform (capped at 5/platform), board the visible train, ride in the coaches, and alight into the destination town. A committed ride is authoritative and persists past the brain's faster logical arrival; the rare undeliverable case resolves gracefully instead of teleporting. Voxel-surface grounding replaces DEM grounding so bodies stand *on* platforms/buildings, not sunk in them. The brain (`act.py`, separate repo) spreads errand destinations off the line termini so trips fan out.

**Tech Stack:** Vanilla ES modules + three.js (client); headless Node assertion scripts (`scripts/verify-*.mjs`); Python + pytest (brain). Two git repos: `C:\Users\James\Desktop\Moorcraft` (client) and `C:\Users\James\moorstead-evo-work` (brain).

**Spec:** [docs/superpowers/specs/2026-06-24-npc-railway-decrowd-design.md](../specs/2026-06-24-npc-railway-decrowd-design.md)

**Testing seam:** the headless verifier builds only `geo` (no chunk world), so the new voxel helpers take `world` as a parameter and are tested with a tiny stub world `{ getBlock }` — mirroring the existing pure `walkableStep` / `steerWalk`. Integration (the `RosterClient` methods, which need a live `game`) is verified by the helper tests plus a live preview-eval (Task 8), not by new unit tests.

---

## Task 1: `surfaceHeight` — voxel-aware grounding

**Files:**
- Modify: `src/roster.js` (add near the top imports + an exported helper)
- Test: `scripts/verify-roster.mjs`

- [ ] **Step 1: Write the failing test**

Add to `scripts/verify-roster.mjs` (after the existing imports, extend the import line and append a block). First extend the import:

```javascript
import { npcVoxelPos, townAnchor, steerWalk, walkableStep, npcActivity, surfaceHeight, __resetSurfCache } from '../src/roster.js';
import { B } from '../src/defs.js';
```

Then append:

```javascript
// --- surfaceHeight: stand ON the top built block, fall back to DEM when unloaded -------------
const stubWorld = (blocks) => ({ getBlock: (x, y, z) => (blocks[`${x},${y},${z}`] ?? B.AIR) });
__resetSurfCache();
{
  const g0 = geo.height(300, 300);                 // a real column's DEM height
  // a plank deck two blocks above the DEM, with air above it
  const w = stubWorld({ [`300,${g0 + 2},300`]: B.PLANKS });
  ok(surfaceHeight(w, geo, 300, 300) === g0 + 3, 'surfaceHeight stands on the built deck (DEM+2 block -> +3)');
  // empty column (chunk effectively unloaded) -> DEM + 1
  ok(surfaceHeight(stubWorld({}), geo, 305, 305) === geo.height(305, 305) + 1, 'surfaceHeight falls back to DEM+1 when no blocks');
  // water is not a standing surface -> falls through to DEM
  __resetSurfCache();
  ok(surfaceHeight(stubWorld({ [`310,${geo.height(310, 310) + 1},310`]: B.WATER }), geo, 310, 310) === geo.height(310, 310) + 1, 'surfaceHeight ignores water');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/verify-roster.mjs`
Expected: FAIL — `surfaceHeight` / `__resetSurfCache` are not exported (`SyntaxError: ... does not provide an export named 'surfaceHeight'`).

- [ ] **Step 3: Write minimal implementation**

In `src/roster.js`, after the `import { B } from './defs.js';` line, add:

```javascript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/verify-roster.mjs`
Expected: PASS — all assertions OK, including the three new `surfaceHeight` lines.

- [ ] **Step 5: Commit**

```bash
git add src/roster.js scripts/verify-roster.mjs
git commit -m "feat(roster): surfaceHeight — voxel-aware grounding to stop platform clipping"
```

---

## Task 2: `idHash`, `waiterRank`, `waitMode` — the platform-cap decision

**Files:**
- Modify: `src/roster.js`
- Test: `scripts/verify-roster.mjs`

- [ ] **Step 1: Write the failing test**

Extend the import in `scripts/verify-roster.mjs`:

```javascript
import { npcVoxelPos, townAnchor, steerWalk, walkableStep, npcActivity, surfaceHeight, __resetSurfCache, idHash, waiterRank, waitMode, PLATFORM_CAP, WAIT_LEAD } from '../src/roster.js';
```

Append:

```javascript
// --- platform cap: stable per-id rank within a (line,from) wait group ------------------------
{
  ok(idHash('amos') === idHash('amos') && idHash('amos') !== idHash('mary'), 'idHash is stable and distinguishes ids');
  const group = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const ranks = group.map(id => waiterRank(id, group));
  ok(new Set(ranks).size === group.length, 'waiterRank gives every member a distinct rank');
  ok(Math.min(...ranks) === 0 && Math.max(...ranks) === group.length - 1, 'ranks are 0..n-1');
  ok(waiterRank('a', ['a']) === 0, 'a lone waiter ranks 0');
  // waitMode: overflow potters; ranked-and-due approaches; ranked-but-early potters
  ok(waitMode(10, PLATFORM_CAP) === 'potter', 'overflow (rank>=cap) potters in town');
  ok(waitMode(10, 0) === 'approach', 'ranked and due-soon -> approach the platform');
  ok(waitMode(WAIT_LEAD + 50, 0) === 'potter', 'ranked but train far off -> potter in town');
  ok(waitMode(null, 0) === 'potter', 'no timetable answer -> potter (never crowd early)');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/verify-roster.mjs`
Expected: FAIL — `idHash` / `waiterRank` / `waitMode` not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/roster.js`, replace the existing `_spread` hash preamble so the FNV-1a lives in one place. Find (roster.js:17-23):

```javascript
function _spread(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  const a = (h >>> 0) / 4294967295 * Math.PI * 2;
  const r = 2 + ((h >>> 9) % 1000) / 1000 * 6;   // 2..8 blocks
  return { dx: Math.cos(a) * r, dz: Math.sin(a) * r };
}
```

Replace with:

```javascript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/verify-roster.mjs`
Expected: PASS — including the new platform-cap assertions.

- [ ] **Step 5: Commit**

```bash
git add src/roster.js scripts/verify-roster.mjs
git commit -m "feat(roster): per-id waiter rank + waitMode for the 5/platform cap"
```

---

## Task 3: `platformPoint` — where to stand on the platform

**Files:**
- Modify: `src/roster.js`
- Test: `scripts/verify-roster.mjs`

- [ ] **Step 1: Write the failing test**

Extend the import:

```javascript
import { npcVoxelPos, townAnchor, steerWalk, walkableStep, npcActivity, surfaceHeight, __resetSurfCache, idHash, waiterRank, waitMode, PLATFORM_CAP, WAIT_LEAD, platformPoint } from '../src/roster.js';
```

Append (uses the main line + a mid-line station, places a plank deck on one side in a stub world):

```javascript
// --- platformPoint: resolve the station and stand on the plank deck beside the rail ----------
{
  const line = 'Whitby & Pickering';
  const lp = geo.railPaths().find(l => l.name === line);
  const ln = geo.railLines().find(l => l.name === line);
  ok(lp && ln, 'main line resolves in railPaths + railLines');
  const station = ln.stops[Math.floor(ln.stops.length / 2)].name;   // a mid-line stop
  const p = geo.samplePosOn(lp.path, lp.path.stationS[ln.stops.findIndex(t => t.name === station)]);
  const deck = Math.round(p.deck);
  // build a plank deck 3 blocks to the +normal side of the rail, level with the deck
  const PLAT = 3;
  const sx = Math.round(p.x + (-p.tz) * PLAT), sz = Math.round(p.z + (p.tx) * PLAT);
  __resetSurfCache();
  const w = stubWorld({ [`${sx},${deck},${sz}`]: B.PLANKS });
  const pt = platformPoint(w, geo, line, station);
  ok(pt && Math.hypot(pt.x - sx, pt.z - sz) < 1.5, 'platformPoint picks the planked side');
  ok(pt.y === deck + 1, 'platformPoint stands one above the plank deck');
  ok(platformPoint(w, geo, 'No Such Line', station) === null, 'unknown line -> null (safe)');
  ok(platformPoint(w, geo, line, 'Nowhere') === null, 'unknown station -> null (safe)');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/verify-roster.mjs`
Expected: FAIL — `platformPoint` not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/roster.js`, add after `surfaceHeight`:

```javascript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/verify-roster.mjs`
Expected: PASS — including the four new `platformPoint` lines.

- [ ] **Step 5: Commit**

```bash
git add src/roster.js scripts/verify-roster.mjs
git commit -m "feat(roster): platformPoint — stand on the plank deck beside the rail"
```

---

## Task 4: Ground shared locomotion on the surface + extract `_potterAt`

**Files:**
- Modify: `src/roster.js` (`steerWalk` grounding line, `_lerpTo`, new `_potterAt` method)

This is a refactor: change DEM grounding to `surfaceHeight` in the shared walkers, and lift the `'at'` amble into a reusable method. No new unit test (the change is grounding + extraction; the regression guard is the existing `npm run verify` plus Task 8 live check).

- [ ] **Step 1: Ground `steerWalk` on the surface**

In `src/roster.js`, in `steerWalk`, find (roster.js:128):

```javascript
  mob.pos.y = geo.height(Math.round(nx), Math.round(nz)) + 1;        // follow the ground
```

Replace with:

```javascript
  mob.pos.y = surfaceHeight(world, geo, nx, nz);                     // follow the built surface, not just DEM
```

- [ ] **Step 2: Ground `_lerpTo` on the surface**

Find `_lerpTo` (roster.js:335-339):

```javascript
  _lerpTo(m, tx, tz, k, face) {
    const ty = this.geo.height(Math.round(tx), Math.round(tz)) + 1;
    m.pos.x += (tx - m.pos.x) * k; m.pos.y += (ty - m.pos.y) * k; m.pos.z += (tz - m.pos.z) * k;
    if (face) { const ddx = tx - m.pos.x, ddz = tz - m.pos.z; if (ddx * ddx + ddz * ddz > 0.04) m.yaw = Math.atan2(ddx, ddz); }
  }
```

Replace the `ty` line:

```javascript
  _lerpTo(m, tx, tz, k, face) {
    const ty = surfaceHeight(this.world, this.geo, tx, tz);
    m.pos.x += (tx - m.pos.x) * k; m.pos.y += (ty - m.pos.y) * k; m.pos.z += (tz - m.pos.z) * k;
    if (face) { const ddx = tx - m.pos.x, ddz = tz - m.pos.z; if (ddx * ddx + ddz * ddz > 0.04) m.yaw = Math.atan2(ddx, ddz); }
  }
```

- [ ] **Step 3: Extract `_potterAt` from the `'at'` branch**

Add this method to `RosterClient` (place it just above `_lerpTo`):

```javascript
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
```

(The `update()` `'at'` branch is rewritten to call this in Task 6 — leave the old inline block in place until then so the file stays runnable.)

- [ ] **Step 4: Run the full verifier to confirm no regression**

Run: `npm run verify`
Expected: PASS — every `verify-*` script green, including `verify-roster` (the grounding change keeps flat-terrain results identical because `surfaceHeight` falls back to `geo.height + 1` where nothing is built).

- [ ] **Step 5: Commit**

```bash
git add src/roster.js
git commit -m "refactor(roster): ground walkers on surfaceHeight + extract _potterAt"
```

---

## Task 5: Rewrite `_driveRail` — wait in town, walk on, ride the real train, alight into town

**Files:**
- Modify: `src/roster.js` (`_driveRail` and new helpers `_walkTo`, `_atPlatform`, `_resolveToBrain`)

Integration logic; verified by the helper tests (Tasks 1–3) + live (Task 8). Replace the whole `_driveRail` method (roster.js:291-333) and add three helpers.

- [ ] **Step 1: Add the helper methods**

Add to `RosterClient`, just above `_lerpTo`:

```javascript
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
```

- [ ] **Step 2: Replace `_driveRail`**

Replace the entire method (roster.js:291-333) with:

```javascript
  // Drive a committed rail journey (e.ride) against the VISIBLE train. The ride is authoritative
  // and persists past the brain's faster logical arrival: she waits in town, walks onto the
  // platform as the train nears (capped per platform), boards when it dwells, rides in the coaches,
  // and alights into the destination town. A 720s timeout resolves a stuck ride gracefully.
  _driveRail(e, m, dt, rankMap) {
    const ride = e.ride;
    ride.t += dt;
    const grp = m.model && m.model.group;
    const vt = this._visibleTrain(ride.line);

    // board / alight transitions, read off the visible train's dwell
    if (vt && vt.dwelling) {
      if (ride.phase === 'wait' && vt.station === ride.from && this._atPlatform(m, ride)) ride.phase = 'aboard';
      else if (ride.phase === 'aboard' && vt.station === ride.to) ride.phase = 'done';
    }
    // safety net: never wait forever (sparse timetable ~ minutes; 720s ~ 1.6 cycles)
    if (ride.t > 720 && ride.phase !== 'aboard') { this._resolveToBrain(e, m); return; }

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
    if (mode === 'potter') { this._potterAt(m, a, this._nowEff(), dt); return; }
    this._walkTo(m, platformPoint(this.world, this.geo, ride.line, ride.from) || a, dt);   // approach the platform
  }
```

- [ ] **Step 3: Verify the module still parses + helpers still pass**

Run: `node scripts/verify-roster.mjs`
Expected: PASS — the file imports cleanly and all helper assertions still hold (this task changed methods, not the exported helpers).

- [ ] **Step 4: Commit**

```bash
git add src/roster.js
git commit -m "feat(roster): ride the real train — wait in town, walk on, board, alight into town"
```

---

## Task 6: Rewrite `update()` — rank map, commit-once, persist past brain arrival

**Files:**
- Modify: `src/roster.js` (`update`, roster.js:202-267)

- [ ] **Step 1: Replace the `update` method body**

Replace the whole `update(dt)` method (roster.js:202-267) with:

```javascript
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
```

- [ ] **Step 2: Verify the module parses + helpers pass**

Run: `node scripts/verify-roster.mjs`
Expected: PASS — clean import, all assertions hold.

- [ ] **Step 3: Build to catch any syntax/bundve error**

Run: `npm run build`
Expected: Vite build succeeds (no unresolved symbols; `_potterAt`, `platformPoint`, `waitMode`, `waiterRank`, `surfaceHeight` all defined).

- [ ] **Step 4: Commit**

```bash
git add src/roster.js
git commit -m "feat(roster): commit-once rides + platform rank map; drop the force-complete teleport"
```

---

## Task 7: Extend the verifier — cap grouping + surface grounding contract

**Files:**
- Modify: `scripts/verify-roster.mjs`

- [ ] **Step 1: Add the platform-cap contract assertions**

Append to `scripts/verify-roster.mjs`:

```javascript
// --- platform cap contract: at most PLATFORM_CAP approachers per (line,from) ------------------
{
  const ids = Array.from({ length: 9 }, (_, i) => `pop-cap-${i}`);
  const approaching = ids.filter(id => waitMode(5, waiterRank(id, ids)) === 'approach');
  ok(approaching.length === PLATFORM_CAP, `at most ${PLATFORM_CAP} approach a busy platform (got ${approaching.length})`);
  const overflow = ids.filter(id => waiterRank(id, ids) >= PLATFORM_CAP);
  ok(overflow.every(id => waitMode(5, waiterRank(id, ids)) === 'potter'), 'overflow folk potter in town instead');
}
```

- [ ] **Step 2: Run the verifier**

Run: `node scripts/verify-roster.mjs`
Expected: PASS — prints the assertion count (now ~30+) and exits 0.

- [ ] **Step 3: Run the whole suite**

Run: `npm run verify`
Expected: PASS — all `verify-*` scripts green.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-roster.mjs
git commit -m "test(roster): assert the 5/platform cap contract"
```

---

## Task 8: Live verification on the moors world (preview-eval)

**Files:** none (verification only)

The integrated `RosterClient` behaviour can't be unit-tested headlessly (it needs a live `game`). Verify it in the running client per the EVO-stack debug pattern.

- [ ] **Step 1: Start the dev server and open the moors world**

Run: `npm run dev` (preview tooling), then in-page: `game.loginGuest(); game.newWorld('x')` and let it reach `playing`. The streamed roster needs the brain; point the `/brain` proxy at production (default) so `/api/roster/state` returns the live ~106 NPCs.

- [ ] **Step 2: Assert no platform is mobbed**

In the dev console, count streamed mobs standing within ~6 blocks of each station versus pottering in town. Expected: **≤5** converged on any one platform; the rest milling around their town anchors. Sample script:

```javascript
const rc = game.rosterClient;
const near = {};
for (const [, e] of rc.npcs) {
  const r = e.ride; if (!r || r.phase !== 'wait') continue;
  (near[r.line + '|' + r.from] ??= []).push(e.data.id);
}
console.table(Object.entries(near).map(([k, v]) => ({ platform: k, waiting: v.length })));
// then, for any platform, count how many are actually AT it (approachers) vs pottering in town:
const atPlat = [...rc.npcs.values()].filter(e => e.ride && e.ride.phase === 'wait'
  && e.mob && e.mob.activityShort && e.mob.activityShort.includes('train')).length;
```

Expected: each `waiting` group's *approachers* (those actually at the platform) ≤ 5.

- [ ] **Step 3: Watch one full journey**

Pick a waiting NPC, `moorstead.warp(<their from-station>)`, and watch: potter in town → walk onto the platform as the train nears → board on dwell → ride in a coach → alight and walk into the destination town. Confirm **no teleport pop** and that they stand **on** the platform planks (not sunk).

- [ ] **Step 4: Confirm grounding (no clipping)**

For a few waiting/alighting NPCs, compare `e.mob.pos.y` to `geo.height(x,z)+1` at a station with a raised platform — the mob's `y` should match the **plank deck** (higher), proving voxel grounding. Spot-check that nobody stands inside the station building.

- [ ] **Step 5: Record the result**

No commit. Note pass/fail in the session; if anything regresses, return to the relevant task. (Per spec: rare graceful fades on the 720s stuck case are expected, not a regression.)

---

## Task 9: Brain — spread errand destinations off the termini

**Repo:** `C:\Users\James\moorstead-evo-work`
**Files:**
- Modify: `brain/act.py` (`_pick_errand`, new `_errand_destinations`; keep `ERRAND_PERIOD = 1800`)
- Test: `brain/test_act.py`

- [ ] **Step 1: Write the failing test**

Append to `brain/test_act.py`:

```python
def test_pick_errand_spreads_off_the_termini():
    """A due errand no longer always funnels to a line terminus: across NPCs and across errand
    periods the destinations fan out over the line's stops, so the market ends don't mob."""
    line = next(l for l, s in world.LINES.items() if len(s) >= 4)
    stops = world.LINES[line]
    termini = {stops[0], stops[-1]}
    place = stops[len(stops) // 2]                       # a mid-line station on `line`
    dests = set()
    for i in range(40):
        npc = rs.NPC(id=f"e{i}", name="E", role="drover", place=place)
        e = act._pick_errand(npc, now=float(act.ERRAND_PERIOD * i))
        if e and e["action"] == "boardTrain":
            dests.add(e["params"]["dest"])
    assert dests - termini, f"every errand still funnels to a terminus: {dests}"
    assert len(dests) >= 3, f"destinations not spread enough: {dests}"


def test_pick_errand_is_deterministic():
    """Same npc + same errand period -> same destination (reproducible run-to-run)."""
    npc = rs.NPC(id="amos", name="Amos", role="jet-cutter", place=world.LINES[next(iter(world.LINES))][0])
    a = act._pick_errand(npc, now=5000.0)
    b = act._pick_errand(npc, now=5000.0)
    assert a == b
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `C:\Users\James\moorstead-evo-work`): `python -m pytest brain/test_act.py -k pick_errand -v`
Expected: FAIL — `_pick_errand()` currently takes one arg (`TypeError: _pick_errand() got an unexpected keyword argument 'now'`).

- [ ] **Step 3: Implement the spread**

In `brain/act.py`, replace `_pick_errand` (act.py:77-88) with:

```python
def _errand_destinations(place):
    """(line, dest) pairs worth an errand from `place`: every other stop on each line through
    `place`. Spreads trips across the line's stops instead of always the two termini."""
    out = []
    for line, stops in world.LINES.items():
        if place in stops:
            for st in stops:
                if st != place:
                    out.append((line, st))
    return out


def _pick_errand(npc, now=0.0):
    """A purposeful errand from npc.place: ride the train to a station on one of her lines, chosen
    deterministically and varied per errand period so successive trips differ and the cast fans
    out across stations (no longer all funnelling to the market/port termini). Falls back to a
    walk to the nearest neighbour, else None if stuck."""
    dests = _errand_destinations(npc.place)
    if dests:
        k = (_h(npc.id) + int(now // ERRAND_PERIOD)) % len(dests)
        line, dest = dests[k]
        return {"action": "boardTrain", "params": {"line": line, "dest": dest}}
    nbrs = _neighbours(npc.place, k=1)
    if nbrs:
        return {"action": "goTo", "params": {"place": nbrs[0]}}
    return None
```

Then update the one call site in `decide()` (act.py:295) from `errand = _pick_errand(npc)` to:

```python
            errand = _pick_errand(npc, now)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest brain/test_act.py -k pick_errand -v`
Expected: PASS — both new tests green.

- [ ] **Step 5: Run the full brain suite (no regressions)**

Run: `python -m pytest brain/test_act.py brain/test_roster_sim.py -v`
Expected: PASS — all existing tests still green (the `test_decide_errand_day_sets_off_*` path still yields a `boardTrain`/`walk`).

- [ ] **Step 6: Commit (brain repo)**

```bash
cd /c/Users/James/moorstead-evo-work
git add brain/act.py brain/test_act.py
git commit -m "feat(act): spread errand destinations off the line termini (de-crowd platforms)"
```

---

## Task 10: Deploy the brain change (live — confirm with James first)

**Files:** none (deploy only). This touches the live EVO brain; **do not run without James's go-ahead.**

- [ ] **Step 1: Back up the live brain file**

Run: `ssh -o BatchMode=yes evo-tailscale 'cp ~/moorstead/yorkshire_bot/brain/act.py ~/moorstead/yorkshire_bot/brain/act.py.bak-errandspread-$(date +%Y%m%d-%H%M%S)'`

- [ ] **Step 2: Copy the updated file**

Run: `scp -o BatchMode=yes "C:\Users\James\moorstead-evo-work\brain\act.py" evo-tailscale:moorstead/yorkshire_bot/brain/act.py`

- [ ] **Step 3: Restart + smoke-test**

Run: `ssh -o BatchMode=yes evo-tailscale 'sudo -n systemctl restart moorstead-brain.service && sleep 3 && curl -s localhost:8010/api/roster/state | head -c 200'`
Expected: a JSON snapshot with `npcs` — service healthy.

- [ ] **Step 4: Confirm live spread**

Over the next ~10 min (ramp time), sample `https://www.moorstead.app/brain/api/roster/state` and confirm rail destinations are no longer concentrated on the two termini.

---

## Self-Review

**Spec coverage:**
- §Ownership decouple (commit-once, persist past arrival) → Tasks 5 + 6. ✓
- §Waiting lifecycle (potter / walk / cap 5 / LEAD) → Tasks 2, 5, 6 + verifier Task 7. ✓
- §Alighting (step off, walk into town) → Task 5 (`done` branch). ✓
- §Clipping (`surfaceHeight`, obstacle-aware standing) → Tasks 1, 4 (grounding) + `_potterAt`/`walkableStep` reuse + `platformPoint` (Task 3). ✓
- §Graceful fade → Task 5 (`_resolveToBrain`). ✓
- §Brain destination spread (keep ERRAND_PERIOD) → Task 9. ✓
- §`titleForced` preserved → Task 5 (bypass branch). ✓
- §Verification (verify-roster + brain pytest + live) → Tasks 7, 8, 9, 10. ✓

**Placeholder scan:** none — every code/test step carries full code and exact commands.

**Type/name consistency:** `surfaceHeight(world, geo, x, z)`, `platformPoint(world, geo, line, station)`, `waiterRank(id, groupIds)`, `waitMode(due, rank)`, `_potterAt(m, anchor, nowEff, dt)`, `_walkTo(m, to, dt, pace)`, `_atPlatform(m, ride)`, `_resolveToBrain(e, m)`, `PLATFORM_CAP`, `WAIT_LEAD` — used identically across Tasks 1–8. Brain `_pick_errand(npc, now)` + `_errand_destinations(place)` consistent across Task 9. ✓

**Scope:** one coherent feature across two repos; client (Tasks 1–8) and brain (Tasks 9–10) are independently testable and committable. ✓
