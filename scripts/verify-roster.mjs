// Headless: the logical->voxel mapping yields valid positions, and every name a sim
// state can carry resolves in moorsgeo. Mirrors the verify-*.mjs pattern.
import assert from 'node:assert';
import { Gen, MOORS_SEED } from '../src/worldgen.js';
import { B } from '../src/defs.js';
import { npcVoxelPos, townAnchor, steerWalk, walkableStep, npcActivity, surfaceHeight, __resetSurfCache, idHash, waiterRank, waitMode, PLATFORM_CAP, WAIT_LEAD, platformPoint, roadWaypoints, ridesThisLeg } from '../src/roster.js';

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const geo = new Gen(MOORS_SEED).geo;

// 'at' -> the village coordinate
const wh = geo.villages.find(v => v.name === 'Whitby');
const atP = npcVoxelPos({ state: { kind: 'at', place: 'Whitby' } }, 100, geo);
ok(Math.abs(atP.x - wh.x) < 1 && Math.abs(atP.z - wh.z) < 1, "'at' maps to the town anchor");

// 'walk' -> between the two anchors at the right fraction
const a = townAnchor('Whitby', geo), b = townAnchor('Sleights', geo);
const midT = 100, walk = { state: { kind: 'walk', from: 'Whitby', to: 'Sleights', started: midT, eta: midT + 200 } };
const wP = npcVoxelPos(walk, midT + 100, geo); // halfway
ok(Math.abs(wP.x - (a.x + b.x) / 2) < 2 && Math.abs(wP.z - (a.z + b.z) / 2) < 2, "'walk' interpolates to the midpoint");

// 'rail' -> a point on the named line's spline, in-bounds, between the stations
const rail = { state: { kind: 'rail', line: 'Whitby & Pickering', fromStn: 'Grosmont', toStn: 'Pickering', started: 0, eta: 120 } };
const rP = npcVoxelPos(rail, 60, geo);
ok(rP && isFinite(rP.x) && isFinite(rP.z), "'rail' returns a finite position on the line");
const bnd = geo.worldBounds();
ok(rP.x >= bnd.minX && rP.x <= bnd.maxX && rP.z >= bnd.minZ && rP.z <= bnd.maxZ, "'rail' position is in-world");

// name-resolution contract: an unknown place returns null (caller skips it, never crashes)
ok(npcVoxelPos({ state: { kind: 'at', place: 'Nowhere-on-Sea' } }, 0, geo) === null, 'unknown place -> null (safe)');

// population spread: two folk standing in the SAME town with DIFFERENT ids fan out to
// DIFFERENT positions, each within ~10 blocks of the anchor (so a crowd doesn't stack).
const anchorWh = townAnchor('Whitby', geo);
const p1 = npcVoxelPos({ id: 'pop-whitby-0', state: { kind: 'at', place: 'Whitby' } }, 0, geo);
const p2 = npcVoxelPos({ id: 'pop-whitby-1', state: { kind: 'at', place: 'Whitby' } }, 0, geo);
ok(Math.hypot(p1.x - p2.x, p1.z - p2.z) > 0.5, 'same-town folk with different ids spread apart');
ok(Math.hypot(p1.x - anchorWh.x, p1.z - anchorWh.z) < 10, 'spread folk stay near the town anchor');
ok(Math.hypot(p2.x - anchorWh.x, p2.z - anchorWh.z) < 10, 'spread folk stay near the town anchor (2)');
// back-compat: an 'at' state with no id still maps exactly to the anchor
const noId = npcVoxelPos({ state: { kind: 'at', place: 'Whitby' } }, 0, geo);
ok(noId.x === anchorWh.x && noId.z === anchorWh.z, 'no-id at-state maps exactly to the anchor (back-compat)');

// --- naturalistic walking: skirts obstacles, makes progress on open ground ---
const openWorld = { getBlock: () => B.AIR, chunkAt: () => ({}) };    // loaded, nothing in the way
const startA = townAnchor('Whitby', geo), goalB = townAnchor('Sleights', geo);
const mob = { pos: { x: startA.x, y: startA.y, z: startA.z }, yaw: 0 };
const d0 = Math.hypot(goalB.x - mob.pos.x, goalB.z - mob.pos.z);
for (let i = 0; i < 80; i++) steerWalk(mob, startA, goalB, 0, 10000, i * 0.5, openWorld, geo, 0.5);
ok(Math.hypot(goalB.x - mob.pos.x, goalB.z - mob.pos.z) < d0 - 5, 'steerWalk makes progress toward the goal');

// walkability is judged at the REAL surface (surfaceHeight): open ground IS standable; a tree/wall
// (a 2-high solid that lifts the surface) and river water are NOT.
const tx = Math.round(startA.x) + 4, tz = Math.round(startA.z);
const fromY = geo.height(tx, tz) + 1;                                 // a body on open ground at the test column
const grassWith = fill => ({ chunkAt: () => ({}), getBlock: (x, y, z) => { const g = geo.height(Math.round(x), Math.round(z)); return y <= g ? B.GRASS : (y <= g + 2 ? fill : B.AIR); } });
ok(walkableStep(openWorld, geo, tx, tz, fromY), 'walkableStep accepts open walkable ground');
ok(!walkableStep(grassWith(B.LOG), geo, tx, tz, fromY), 'walkableStep rejects a tree/wall (2-high solid lifts the surface -> too steep a step)');
const riverWorld = { chunkAt: () => ({}), getBlock: (x, y, z) => (y <= geo.height(Math.round(x), Math.round(z)) ? B.WATER : B.AIR) };
ok(!walkableStep(riverWorld, geo, tx, tz, fromY), 'walkableStep rejects standing in river water');

// --- npcActivity: a truthful account of what an NPC is doing (marker `short` + chat `full`) ---
const homeAct = npcActivity({ role: 'herbwife', home: 'Lealholm', intent: 'drying my herbs',
  state: { kind: 'at', place: 'Lealholm' } });
ok(homeAct.full.includes('at home in Lealholm') && homeAct.full.includes('herbwife'), 'activity: at-home names town + trade');
ok(homeAct.full.includes('drying my herbs'), 'activity: full quotes the NPC intent');
ok(homeAct.short === 'drying my herbs', 'activity: at-home short shows the intent');

const awayAct = npcActivity({ role: 'fishwife', home: 'Whitby', intent: 'selling the catch',
  state: { kind: 'at', place: 'Pickering' } });
ok(awayAct.full.includes('away from home in Whitby') && awayAct.full.includes('Pickering'), 'activity: away names where + home');
ok(awayAct.short === 'at Pickering', 'activity: away short shows the place');

const walkAct = npcActivity({ home: 'Whitby', state: { kind: 'walk', from: 'Whitby', to: 'Sleights' } });
ok(walkAct.full.includes('walking over to Sleights') && walkAct.short === '→ Sleights', 'activity: walk names the destination');

const railAct = npcActivity({ home: 'Grosmont', intent: 'off to market',
  state: { kind: 'rail', line: 'Whitby & Pickering', fromStn: 'Grosmont', toStn: 'Pickering' } });
ok(railAct.full.includes('train to Pickering') && railAct.short === '→ Pickering (train)', 'activity: rail names the line destination');

// a committed client-side ride OVERRIDES the brain state (she's actually aboard the visible train)
const rideAct = npcActivity({ home: 'Grosmont', state: { kind: 'at', place: 'Grosmont' } },
  { phase: 'aboard', to: 'Whitby' });
ok(rideAct.short === '→ Whitby (train)' && rideAct.full.includes('on the train to Whitby'), 'activity: a committed ride overrides the brain state');

// a WAITING rider (pottering in town until the train's due) is NOT on the train yet — say so honestly
const waitAct = npcActivity({ home: 'Grosmont', state: { kind: 'at', place: 'Grosmont' } },
  { phase: 'wait', to: 'Whitby' });
ok(waitAct.short === '→ Whitby (train)' && waitAct.full.includes('waiting for the train to Whitby'), 'activity: a waiting rider is waiting for the train, not aboard it');

// --- surfaceHeight: stand ON the top built block, fall back to DEM when unloaded -------------
// stub world: getBlock from a sparse map; chunkAt reports the chunk loaded (default) or not.
const stubWorld = (blocks, loaded = true) => ({ getBlock: (x, y, z) => (blocks[`${x},${y},${z}`] ?? B.AIR), chunkAt: () => (loaded ? {} : null) });
__resetSurfCache();
{
  const g0 = geo.height(300, 300);                 // a real column's DEM height
  // a deck = a top block WITH footing below it (a real platform/ground always has solid beneath).
  const w = stubWorld({ [`300,${g0 + 2},300`]: B.PLANKS, [`300,${g0 + 1},300`]: B.STONE });
  ok(surfaceHeight(w, geo, 300, 300) === g0 + 3, 'surfaceHeight stands on the built deck (block+footing at DEM+2 -> +3)');
  // empty column (chunk loaded, all air) -> DEM + 1
  ok(surfaceHeight(stubWorld({}), geo, 305, 305) === geo.height(305, 305) + 1, 'surfaceHeight falls back to DEM+1 when the loaded column is all air');
  // water is not a standing surface -> ignored
  __resetSurfCache();
  ok(surfaceHeight(stubWorld({ [`310,${geo.height(310, 310) + 1},310`]: B.WATER }), geo, 310, 310) === geo.height(310, 310) + 1, 'surfaceHeight ignores water');
  // UNLOADED chunk returns B.STONE everywhere (so nowt falls through) — must DEM-ground, not read it.
  __resetSurfCache();
  ok(surfaceHeight({ getBlock: () => B.STONE, chunkAt: () => null }, geo, 321, 321) === geo.height(321, 321) + 1, 'surfaceHeight DEM-grounds an UNLOADED solid column');
  // RAISED ground far above the DEM (THE bug: ~14% of columns sit >6 above the DEM and buried NPCs).
  // ground top at DEM+10 with footing -> stand at DEM+11, not capped near the DEM.
  __resetSurfCache();
  const gr = geo.height(330, 330);
  ok(surfaceHeight(stubWorld({ [`330,${gr + 10},330`]: B.STONE, [`330,${gr + 9},330`]: B.STONE }, true), geo, 330, 330) === gr + 11, 'surfaceHeight finds RAISED ground well above the DEM (embankment/cliff)');
  // ROOF skipped: a roof block high up (AIR below it) over a deck lower down (footing below) -> the
  // deck, not the roof — so covered-station platforms ground on the platform, not the shed roof.
  __resetSurfCache();
  const gp = geo.height(332, 332);
  ok(surfaceHeight(stubWorld({ [`332,${gp + 8},332`]: B.STONE, [`332,${gp + 1},332`]: B.PLANKS, [`332,${gp},332`]: B.STONE }, true), geo, 332, 332) === gp + 2, 'surfaceHeight skips a roof (air below) and stands on the deck beneath it');
}

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
  const w = stubWorld({ [`${sx},${deck},${sz}`]: B.PLANKS, [`${sx},${deck - 1},${sz}`]: B.STONE });  // plank + footing
  const pt = platformPoint(w, geo, line, station);
  ok(pt && Math.hypot(pt.x - sx, pt.z - sz) < 1.5, 'platformPoint picks the planked side');
  ok(pt.y === deck + 1, 'platformPoint stands one above the plank deck');
  ok(platformPoint(w, geo, 'No Such Line', station) === null, 'unknown line -> null (safe)');
  ok(platformPoint(w, geo, line, 'Nowhere') === null, 'unknown station -> null (safe)');
}

// --- platform cap contract: at most PLATFORM_CAP approachers per (line,from) ------------------
{
  const ids = Array.from({ length: 9 }, (_, i) => `pop-cap-${i}`);
  const approaching = ids.filter(id => waitMode(5, waiterRank(id, ids)) === 'approach');
  ok(approaching.length === PLATFORM_CAP, `at most ${PLATFORM_CAP} approach a busy platform (got ${approaching.length})`);
  const overflow = ids.filter(id => waiterRank(id, ids) >= PLATFORM_CAP);
  ok(overflow.every(id => waitMode(5, waiterRank(id, ids)) === 'potter'), 'overflow folk potter in town instead');
}

// --- roadWaypoints: a road-linked village pair yields an oriented lane; an unlinked pair, null ---
{
  // Castleton <-> Danby are joined by a parish lane; Castleton / Egton are not (no shared edge).
  const A = townAnchor('Castleton', geo), B = townAnchor('Danby', geo);
  const lane = roadWaypoints(A, B, geo);
  ok(Array.isArray(lane) && lane.length >= 2, 'roadWaypoints returns a lane for a road-linked pair (Castleton->Danby)');
  // oriented from->to: first waypoint hugs the `from` anchor, last hugs the `to` anchor
  ok(Math.hypot(lane[0].x - A.x, lane[0].z - A.z) < Math.hypot(lane[0].x - B.x, lane[0].z - B.z),
    'roadWaypoints is oriented from->to (first waypoint nearest the from anchor)');
  ok(Math.hypot(lane[lane.length - 1].x - B.x, lane[lane.length - 1].z - B.z) <
     Math.hypot(lane[lane.length - 1].x - A.x, lane[lane.length - 1].z - A.z),
    'roadWaypoints last waypoint nearest the to anchor');
  // the reverse leg re-orients (first waypoint now nearest the new from = Danby)
  const rev = roadWaypoints(B, A, geo);
  ok(rev && Math.hypot(rev[0].x - B.x, rev[0].z - B.z) < Math.hypot(rev[0].x - A.x, rev[0].z - A.z),
    'roadWaypoints re-orients for the reverse leg');
  // an unconnected pair -> null (she falls back to a direct walk, no phantom lane)
  ok(roadWaypoints(townAnchor('Castleton', geo), townAnchor('Egton', geo), geo) === null,
    'roadWaypoints null for an unconnected village pair (Castleton / Egton)');
}

// --- ridesThisLeg: who saddles up for a leg — deterministic, role + distance weighted ----------
{
  // A long, road-linked leg (Castleton<->Danby ~139 blocks) is ride-eligible; from/to are town NAMES
  // exactly as the walk branch passes them (s.from, s.to).
  const FROM = 'Castleton', TO = 'Danby';
  // determinism: same (id, leg) -> same answer, every call.
  const a1 = ridesThisLeg({ id: 'amos', role: 'villager' }, FROM, TO, geo);
  const a2 = ridesThisLeg({ id: 'amos', role: 'villager' }, FROM, TO, geo);
  ok(a1 === a2, 'ridesThisLeg is deterministic for a given (id, leg)');
  // a cast of plain villagers: ~20–30% ride over the whole cast (target ~1-in-4).
  const cast = Array.from({ length: 400 }, (_, i) => ({ id: `pop-ride-${i}`, role: 'villager' }));
  const frac = cast.filter(c => ridesThisLeg(c, FROM, TO, geo)).length / cast.length;
  ok(frac > 0.20 && frac < 0.30, `~1-in-4 of the cast ride a long leg (got ${(frac * 100).toFixed(1)}%)`);
  // role weighting: a mounted-trade role rides MORE often than a generic villager over the same ids.
  const rideRate = role => cast.filter(c => ridesThisLeg({ id: c.id, role }, FROM, TO, geo)).length / cast.length;
  const villager = rideRate('villager');
  for (const role of ['drover', 'farmer', 'gentry', 'doctor', 'parson']) {
    ok(rideRate(role) > villager, `a ${role} rides more often than a generic villager (${(rideRate(role) * 100).toFixed(0)}% vs ${(villager * 100).toFixed(0)}%)`);
  }
  // short-leg gate: a near-zero leg (same place) never rides, whatever the id or role.
  ok(cast.every(c => !ridesThisLeg(c, FROM, FROM, geo)), 'a zero-length leg never rides');
  ok(!ridesThisLeg({ id: 'pop-ride-1', role: 'drover' }, FROM, FROM, geo), 'even a drover never rides a zero-length leg');
  // short-leg gate at the ~80-block threshold: a stub geo with two villages ~50 blocks apart -> none ride;
  // the same ids on a ~200-block pair -> some ride (so the gate is distance, not a blanket off).
  const stubGeo = pts => ({ villages: Object.entries(pts).map(([name, p]) => ({ name, x: p.x, z: p.z, ground: 64 })), height: () => 64 });
  const near = stubGeo({ A: { x: 0, z: 0 }, B: { x: 50, z: 0 } });
  ok(cast.every(c => !ridesThisLeg(c, 'A', 'B', near)), 'a sub-80-block leg never rides (short-leg gate)');
  const far = stubGeo({ A: { x: 0, z: 0 }, B: { x: 200, z: 0 } });
  ok(cast.some(c => ridesThisLeg(c, 'A', 'B', far)), 'a long leg on the same ids does ride (gate is distance, not blanket-off)');
  // unknown place -> never rides (safe; caller just walks).
  ok(!ridesThisLeg({ id: 'amos', role: 'drover' }, 'Nowhere', TO, geo), 'an unknown place never rides (safe)');
}

console.log(`verify-roster: ${n} assertions OK`);
