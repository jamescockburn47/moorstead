// innPlan() determinism + shape + the SURFACE shell (gable roof, windows, chimney,
// walkable door forecourt). The big underground warren it teleports into is guarded
// separately by verify-inn-undercroft.mjs (reachability flood-fill, seal, furniture,
// rail-clearance). Run wi': node scripts/verify-inn-interior.mjs
import { MoorsGeography } from '../src/moorsgeo.js';
import { innPlan, relCell, PARLOUR_H } from '../src/innplan.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// A tavern door must be walkable: stampInns carves a 3-wide × 2-deep cobbled
// forecourt cleared to head+1 out from the surface door. Assert every forecourt
// cell is clear at body+head with solid footing, and the door block survived.
function checkForecourt(plan, at, g, B, label) {
  const { x0: fx0, z0: fz0, x1: fx1, z1: fz1 } = plan.footprint;
  const mX = Math.round((fx0 + fx1) / 2), mZ = Math.round((fz0 + fz1) / 2);
  const doorP = plan.doorSide === 'n' ? [mX, fz0] : plan.doorSide === 's' ? [mX, fz1]
    : plan.doorSide === 'e' ? [fx1, mZ] : [fx0, mZ];
  const [odx, odz] = plan.doorSide === 'n' ? [0, -1] : plan.doorSide === 's' ? [0, 1]
    : plan.doorSide === 'e' ? [1, 0] : [-1, 0];
  const lat = (plan.doorSide === 'n' || plan.doorSide === 's') ? [[-1, 0], [0, 0], [1, 0]] : [[0, -1], [0, 0], [0, 1]];
  let okAll = true;
  for (let step = 1; step <= 2; step++) for (const [lx, lz] of lat) {
    const sx = doorP[0] + odx * step + lx, sz = doorP[1] + odz * step + lz;
    if (at(sx, g + 1, sz) !== B.AIR) okAll = false;
    if (at(sx, g + 2, sz) !== B.AIR) okAll = false;
    if (at(sx, g, sz) === B.AIR) okAll = false;
  }
  (okAll ? ok : bad)(`door forecourt 3-wide×2-deep clear + footing${label} [${plan.village} door ${plan.doorSide}]`);
  (at(doorP[0], g + 1, doorP[1]) === B.INN_DOOR ? ok : bad)(`surface door block survives the forecourt carve${label} [${plan.village}]`);
}

const geo = new MoorsGeography();

// --- determinism: same village + seed -> byte-identical plan ---
{
  const a = innPlan(geo, 'Grosmont', 12345);
  const b = innPlan(geo, 'Grosmont', 12345);
  (a !== null ? ok : bad)('Grosmont produces a plan');
  (a && JSON.stringify(a) === JSON.stringify(b) ? ok : bad)('deterministic — same village+seed, same plan');
  const c = innPlan(geo, 'Grosmont', 1), d = innPlan(geo, 'Grosmont', 2);
  (c && d ? ok : bad)('two different seeds both produce a plan');
}

// --- shape: every field the rest of the program depends on ---
{
  const p = innPlan(geo, 'Grosmont', 12345);
  (p.name === 'Station Tavern' ? ok : bad)('Grosmont is named "Station Tavern" (flagship)');
  (Number.isInteger(p.origin.x) && Number.isInteger(p.origin.z) ? ok : bad)('origin is an integer (x,z)');
  (p.doorSide === 'n' || p.doorSide === 's' || p.doorSide === 'e' || p.doorSide === 'w' ? ok : bad)('doorSide is one of n/s/e/w');
  (p.footprint.x0 < p.footprint.x1 && p.footprint.z0 < p.footprint.z1 ? ok : bad)('surface footprint is non-degenerate');
  (p.protectedBox.x1 > p.protectedBox.x0 && p.protectedBox.z1 > p.protectedBox.z0 ? ok : bad)('protectedBox is non-degenerate');
  (Array.isArray(p.protectedRects) && p.protectedRects.length >= 6 ? ok : bad)('protectedRects has a rect per room + the surface shell');
  // every protectedRect sits inside the bounding protectedBox (the box encloses them)
  const encl = p.protectedRects.every(r => r.x0 >= p.protectedBox.x0 && r.x1 <= p.protectedBox.x1 && r.z0 >= p.protectedBox.z0 && r.z1 <= p.protectedBox.z1);
  (encl ? ok : bad)('every protected rect sits inside the bounding protectedBox');
  (Array.isArray(p.parlour.rooms) && p.parlour.rooms.length === 6 ? ok : bad)('the undercroft has 6 rooms');
  (p.parlour.rooms.some(r => r.name === 'tap') && p.parlour.rooms.some(r => r.name === 'letting') ? ok : bad)('rooms include a tap room and a letting wing');
  (Array.isArray(p.parlour.tables) && p.parlour.tables.length === 4 ? ok : bad)('4 game tables');
  const games = p.parlour.tables.map(t => t.game).sort();
  (JSON.stringify(games) === JSON.stringify(['dominoes', 'draughts', 'merrils', 'shoveha']) ? ok : bad)('the 4 tables are exactly merrils/draughts/dominoes/shoveha, no dupes');
  (p.parlour.h === PARLOUR_H ? ok : bad)('parlour clear height matches the exported constant');
  (p.parlour.floorY >= 2 && p.parlour.vaultFloorY >= 1 ? ok : bad)('main floor is shallow-underground and the vault sits above bedrock (y>=1)');
}

// --- a village with no configured inn returns null, not a throw ---
{
  let threw = false, r;
  try { r = innPlan(geo, 'Nowhere Village', 1); } catch (e) { threw = true; }
  (!threw && r === null ? ok : bad)('unconfigured village returns null, does not throw');
}

// --- pinned snapshot (seed 12345): siting is UNCHANGED by the undercroft rebuild
// (scanSite untouched), so these must still hold — an accidental siting change trips here ---
{
  const p = innPlan(geo, 'Grosmont', 12345);
  (p.origin.x === 1419 && p.origin.z === 2632 ? ok : bad)(`origin pinned (1419,2632) — got (${p.origin.x},${p.origin.z})`);
  (p.groundY === 32 ? ok : bad)(`groundY pinned (32) — got ${p.groundY}`);
  (p.doorSide === 'e' ? ok : bad)(`doorSide pinned (e) — got ${p.doorSide}`);
  (p.footprint.x0 === 1415 && p.footprint.z0 === 2629 && p.footprint.x1 === 1423 && p.footprint.z1 === 2635
    ? ok : bad)('footprint pinned (1415,2629)-(1423,2635)');
}

// --- the SURFACE shell: gable roof, windows, chimney, walkable forecourt (Gen 12345) ---
{
  const { Gen } = await import('../src/worldgen.js');
  const { B, CHUNK, HEIGHT } = await import('../src/defs.js');
  const IDX = (x, y, z) => x + z * CHUNK + y * CHUNK * CHUNK;
  const gen = new Gen(12345);
  const plan = gen.inns.get('Grosmont');
  (plan ? ok : bad)('Gen(12345) builds a Grosmont plan');

  if (plan) {
    const { x0: pbx0, z0: pbz0, x1: pbx1, z1: pbz1 } = plan.protectedBox;
    const chunkData = new Map();
    for (let cx = Math.floor(pbx0 / CHUNK); cx <= Math.floor(pbx1 / CHUNK); cx++)
      for (let cz = Math.floor(pbz0 / CHUNK); cz <= Math.floor(pbz1 / CHUNK); cz++)
        chunkData.set(`${cx},${cz}`, gen.generateChunk(cx, cz));
    const at = (wx, wy, wz) => {
      if (wy < 0 || wy >= HEIGHT) return B.AIR;
      const cx = Math.floor(wx / CHUNK), cz = Math.floor(wz / CHUNK);
      const data = chunkData.get(`${cx},${cz}`); if (!data) return undefined;
      return data[IDX(wx - cx * CHUNK, wy, wz - cz * CHUNK)];
    };

    const { x0: fx0, z0: fz0, x1: fx1, z1: fz1 } = plan.footprint;
    const wallH = 3, g = plan.groundY, midZ = Math.round((fz0 + fz1) / 2);
    const roofYAt = (wx, wz) => { for (let y = HEIGHT - 1; y > g; y--) if (at(wx, y, wz) === B.SLATE) return y; return -1; };
    const ridgeY = roofYAt(Math.round((fx0 + fx1) / 2), midZ);
    const eaveLongWallY = roofYAt(Math.round((fx0 + fx1) / 2), fz0);
    (ridgeY > 0 && eaveLongWallY > 0 && ridgeY > eaveLongWallY ? ok : bad)('surface roof is gabled — ridge sits higher than the eave');

    let windowCount = 0;
    for (let wx = fx0; wx <= fx1; wx++) for (let wz = fz0; wz <= fz1; wz++) {
      const perim = (wx === fx0 || wx === fx1 || wz === fz0 || wz === fz1);
      if (perim && at(wx, g + 2, wz) === B.WINDOW) windowCount++;
    }
    (windowCount >= 2 ? ok : bad)(`at least 2 windows on the surface shell (found ${windowCount})`);

    let chimneyFound = false;
    for (let wx = fx0; wx <= fx1 && !chimneyFound; wx++) for (let wz = fz0; wz <= fz1; wz++) {
      let col = 0, top = -1;
      for (let y = g + wallH + 1; y < HEIGHT; y++) { if (at(wx, y, wz) === B.RBRICK) { col++; top = y; } else if (col > 0) break; }
      if (col > 0 && top > ridgeY) { chimneyFound = true; break; }
    }
    (chimneyFound ? ok : bad)('a chimney (RBRICK column) rises above the surface ridge');

    checkForecourt(plan, at, g, B, ' (seed 12345)');
  }
}

// --- LIVE-SEED forecourt + siting: every inn's surface door is walkable and the
// pub is clear of rails/stations at the REAL production seed ---
{
  const { Gen, MOORS_SEED } = await import('../src/worldgen.js');
  const { B, CHUNK, HEIGHT } = await import('../src/defs.js');
  const IDX = (x, y, z) => x + z * CHUNK + y * CHUNK * CHUNK;
  const gen = new Gen(MOORS_SEED);
  (gen.inns.size > 0 ? ok : bad)(`live seed builds inns (${gen.inns.size})`);
  const g2 = gen.geo;
  for (const plan of gen.inns.values()) {
    const { x0: pbx0, z0: pbz0, x1: pbx1, z1: pbz1 } = plan.protectedBox;
    const cd = new Map();
    for (let cx = Math.floor((pbx0 - 2) / CHUNK); cx <= Math.floor((pbx1 + 2) / CHUNK); cx++)
      for (let cz = Math.floor((pbz0 - 2) / CHUNK); cz <= Math.floor((pbz1 + 2) / CHUNK); cz++)
        cd.set(`${cx},${cz}`, gen.generateChunk(cx, cz));
    const at = (wx, wy, wz) => {
      if (wy < 0 || wy >= HEIGHT) return B.AIR;
      const cx = Math.floor(wx / CHUNK), cz = Math.floor(wz / CHUNK);
      const data = cd.get(`${cx},${cz}`); if (!data) return undefined;
      return data[IDX(wx - cx * CHUNK, wy, wz - cz * CHUNK)];
    };
    checkForecourt(plan, at, plan.groundY, B, ' (LIVE seed)');
    const ri = typeof g2.railInfo === 'function' ? g2.railInfo(plan.origin.x, plan.origin.z) : null;
    (!ri || ri.d >= 8 ? ok : bad)(`siting: ${plan.village} origin clear of the rails (dist ${ri ? ri.d.toFixed(1) : '∞'})`);
    (!(typeof g2.nearStation === 'function' && g2.nearStation(plan.origin.x, plan.origin.z, 20)) ? ok : bad)(`siting: ${plan.village} clear of any station`);
  }
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
