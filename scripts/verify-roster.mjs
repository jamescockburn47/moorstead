// Headless: the logical->voxel mapping yields valid positions, and every name a sim
// state can carry resolves in moorsgeo. Mirrors the verify-*.mjs pattern.
import assert from 'node:assert';
import { Gen, MOORS_SEED } from '../src/worldgen.js';
import { B } from '../src/defs.js';
import { npcVoxelPos, townAnchor, steerWalk, walkableStep, npcActivity, surfaceHeight, __resetSurfCache, idHash, waiterRank, waitMode, PLATFORM_CAP, WAIT_LEAD, platformPoint } from '../src/roster.js';

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
const openWorld = { getBlock: () => B.AIR };                         // nothing in the way
const startA = townAnchor('Whitby', geo), goalB = townAnchor('Sleights', geo);
const mob = { pos: { x: startA.x, y: startA.y, z: startA.z }, yaw: 0 };
const d0 = Math.hypot(goalB.x - mob.pos.x, goalB.z - mob.pos.z);
for (let i = 0; i < 80; i++) steerWalk(mob, startA, goalB, 0, 10000, i * 0.5, openWorld, geo, 0.5);
ok(Math.hypot(goalB.x - mob.pos.x, goalB.z - mob.pos.z) < d0 - 5, 'steerWalk makes progress toward the goal');

// a 2-high solid column (building / wall / tree) is NOT standable; open ground IS
const gAt = (x, z) => geo.height(Math.round(x), Math.round(z));
const solidWorld = { getBlock: (x, y, z) => (y > gAt(x, z) ? B.COBBLE : B.GRASS) };
const fg = gAt(startA.x, startA.z);
ok(!walkableStep(solidWorld, geo, startA.x + 4, startA.z, fg), 'walkableStep rejects a 2-high solid (no walking through buildings/trees)');
ok(walkableStep(openWorld, geo, startA.x + 4, startA.z, fg), 'walkableStep accepts open walkable ground');

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
  const w = stubWorld({ [`${sx},${deck},${sz}`]: B.PLANKS });
  const pt = platformPoint(w, geo, line, station);
  ok(pt && Math.hypot(pt.x - sx, pt.z - sz) < 1.5, 'platformPoint picks the planked side');
  ok(pt.y === deck + 1, 'platformPoint stands one above the plank deck');
  ok(platformPoint(w, geo, 'No Such Line', station) === null, 'unknown line -> null (safe)');
  ok(platformPoint(w, geo, line, 'Nowhere') === null, 'unknown station -> null (safe)');
}

console.log(`verify-roster: ${n} assertions OK`);
