// innPlan() determinism + shape — run wi': node scripts/verify-inn-interior.mjs
import { MoorsGeography } from '../src/moorsgeo.js';
import { innPlan, PARLOUR_W, PARLOUR_L, PARLOUR_H } from '../src/innplan.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

const geo = new MoorsGeography();

// --- determinism: same village + seed -> byte-identical plan ---
{
  const a = innPlan(geo, 'Grosmont', 12345);
  const b = innPlan(geo, 'Grosmont', 12345);
  (a !== null ? ok : bad)('Grosmont produces a plan');
  (a && JSON.stringify(a) === JSON.stringify(b) ? ok : bad)('deterministic — same village+seed, same plan');
}

// --- different seed -> can differ (not a hard requirement of sameness) ---
{
  const a = innPlan(geo, 'Grosmont', 1);
  const c = innPlan(geo, 'Grosmont', 2);
  (a && c ? ok : bad)('two different seeds both produce a plan');
}

// --- shape: every field the rest of the program depends on is present and sane ---
{
  const p = innPlan(geo, 'Grosmont', 12345);
  (typeof p.name === 'string' && p.name.length > 0 ? ok : bad)('plan has a non-empty name');
  (p.name === 'Station Tavern' ? ok : bad)('Grosmont is named "Station Tavern" (flagship)');
  (Number.isInteger(p.origin.x) && Number.isInteger(p.origin.z) ? ok : bad)('origin is an integer (x,z)');
  (p.protectedBox.x1 > p.protectedBox.x0 && p.protectedBox.z1 > p.protectedBox.z0 ? ok : bad)('protectedBox is non-degenerate');
  (p.footprint.x0 >= p.protectedBox.x0 && p.footprint.x1 <= p.protectedBox.x1 ? ok : bad)('exterior footprint sits inside the protected box (x)');
  (p.footprint.z0 >= p.protectedBox.z0 && p.footprint.z1 <= p.protectedBox.z1 ? ok : bad)('exterior footprint sits inside the protected box (z)');
  (p.parlour.w === PARLOUR_W && p.parlour.l === PARLOUR_L && p.parlour.h === PARLOUR_H ? ok : bad)('parlour dims match the exported constants');
  (p.parlour.floorY >= 2 && p.parlour.floorY + PARLOUR_H < 20 ? ok : bad)('parlour sits at a shallow, in-bounds y (well clear of bedrock and normal terrain)');
  (p.doorSide === 'n' || p.doorSide === 's' || p.doorSide === 'e' || p.doorSide === 'w' ? ok : bad)('doorSide is one of n/s/e/w');
  (Array.isArray(p.parlour.tables) && p.parlour.tables.length === 4 ? ok : bad)('parlour has all 4 first-cut game tables');
  const games = p.parlour.tables.map(t => t.game).sort();
  (JSON.stringify(games) === JSON.stringify(['dominoes', 'draughts', 'merrils', 'shoveha']) ? ok : bad)('the 4 tables are exactly merrils/draughts/dominoes/shoveha, no dupes');
  (p.parlour.hearth.x >= 1 && p.parlour.hearth.x < PARLOUR_W - 1 ? ok : bad)('hearth sits inside the parlour, not against the outer wall corner');
}

// --- a village with no configured inn returns null, not a throw ---
{
  let threw = false, r = undefined;
  try { r = innPlan(geo, 'Nowhere Village', 1); } catch (e) { threw = true; }
  (!threw ? ok : bad)('unconfigured village does not throw');
  (r === null ? ok : bad)('unconfigured village returns null');
}

// --- worldgen actually carves the plan into chunk data ---
{
  const { Gen } = await import('../src/worldgen.js');
  const { B, CHUNK } = await import('../src/defs.js');
  const IDX = (x, y, z) => x + z * CHUNK + y * CHUNK * CHUNK;
  const gen = new Gen(12345);
  const plan = gen.inns.get('Grosmont');
  (plan ? ok : bad)('Gen builds a Grosmont inn plan at construction time');
  if (plan) {
    const cx = Math.floor(plan.origin.x / CHUNK), cz = Math.floor(plan.origin.z / CHUNK);
    const data = gen.generateChunk(cx, cz);
    const lx = ((plan.origin.x % CHUNK) + CHUNK) % CHUNK;
    const lz = ((plan.origin.z % CHUNK) + CHUNK) % CHUNK;
    // the parlour interior directly under the origin should be hollow at floor+1
    (data[IDX(lx, plan.parlour.floorY + 1, lz)] === B.AIR ? ok : bad)('parlour interior is hollowed out (AIR) at floor+1 under the origin');
    (data[IDX(lx, plan.parlour.floorY, lz)] !== B.AIR ? ok : bad)('parlour floor is solid, not AIR');
    // the ceiling one above the interior clear height should be solid too (a sealed room, not a shaft to the void)
    (data[IDX(lx, plan.parlour.floorY + plan.parlour.h + 1, lz)] !== B.AIR ? ok : bad)('parlour ceiling is solid, not AIR');
  }
}

// --- D2: gable roof, windows, chimney, furnished parlour, strongbox ---
{
  const { Gen } = await import('../src/worldgen.js');
  const { B, CHUNK, HEIGHT } = await import('../src/defs.js');
  const { innPlan: innPlanD2 } = await import('../src/innplan.js');
  const IDX = (x, y, z) => x + z * CHUNK + y * CHUNK * CHUNK;

  // pinned snapshot of the PRE-D2 plan for `geo` (seed 0) + seed 12345 (computed
  // with the code as it stood before this task — origin/doorSide/footprint must
  // be byte-identical after adding `furnish`, since furnish is derived data
  // appended after all existing RNG draws, not a new draw before them)
  const pinned = innPlanD2(geo, 'Grosmont', 12345);
  (pinned && pinned.origin.x === 1420 && pinned.origin.z === 2593 ? ok : bad)('D2: origin unchanged vs pinned pre-change snapshot (1420,2593)');
  (pinned && pinned.groundY === 28 ? ok : bad)('D2: groundY unchanged vs pinned pre-change snapshot (28)');
  (pinned && pinned.doorSide === 'w' ? ok : bad)('D2: doorSide unchanged vs pinned pre-change snapshot (w)');
  (pinned && pinned.footprint.x0 === 1416 && pinned.footprint.z0 === 2590 && pinned.footprint.x1 === 1424 && pinned.footprint.z1 === 2596
    ? ok : bad)('D2: footprint unchanged vs pinned pre-change snapshot (1416,2590)-(1424,2596)');

  // --- the actual worldgen probes use Gen(12345)'s OWN internal geo (a different
  // seed than the pinned-snapshot `geo` above — Gen seeds MoorsGeography with its
  // own seed) so the carved chunk data matches plan.origin etc. exactly ---
  const gen = new Gen(12345);
  const plan = gen.inns.get('Grosmont');
  (plan ? ok : bad)('D2: Gen(12345) builds a Grosmont plan');

  if (plan) {
    // furnish section present + deterministic (two calls, byte-identical, including furnish)
    const a = gen.inns.get('Grosmont');
    const b = innPlanD2(gen.geo, 'Grosmont', 12345);
    (plan.furnish ? ok : bad)('D2: plan has a furnish section');
    (JSON.stringify(a) === JSON.stringify(b) ? ok : bad)('D2: deterministic — plan (including furnish) is byte-identical across calls');

    // --- generate every chunk overlapping protectedBox, and probe world coords
    // through a helper that routes to the right chunk's data (the structure can
    // straddle chunk boundaries) ---
    const { x0: pbx0, z0: pbz0, x1: pbx1, z1: pbz1 } = plan.protectedBox;
    const cx0 = Math.floor(pbx0 / CHUNK), cx1 = Math.floor(pbx1 / CHUNK);
    const cz0 = Math.floor(pbz0 / CHUNK), cz1 = Math.floor(pbz1 / CHUNK);
    const chunkData = new Map();
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
      chunkData.set(`${cx},${cz}`, gen.generateChunk(cx, cz));
    }
    const at = (wx, wy, wz) => {
      if (wy < 0 || wy >= HEIGHT) return B.AIR;
      const cx = Math.floor(wx / CHUNK), cz = Math.floor(wz / CHUNK);
      const data = chunkData.get(`${cx},${cz}`);
      if (!data) return undefined; // outside the generated set — shouldn't happen for in-box probes
      const lx = wx - cx * CHUNK, lz = wz - cz * CHUNK;
      return data[IDX(lx, wy, lz)];
    };

    // --- roof: gable, not flat — ridge (footprint centre) higher than eaves (footprint edge) ---
    const { x0: fx0, z0: fz0, x1: fx1, z1: fz1 } = plan.footprint;
    const wallH = 3, g = plan.groundY;
    const midZ = Math.round((fz0 + fz1) / 2);
    const roofYAt = (wx, wz) => {
      for (let y = HEIGHT - 1; y > g; y--) { if (at(wx, y, wz) === B.SLATE) return y; }
      return -1;
    };
    const ridgeY = roofYAt(Math.round((fx0 + fx1) / 2), midZ);
    const eaveY = roofYAt(fx0, midZ); // gable end wall — climbs straight to the ridge height there too;
                                        // use a LONG-wall edge cell instead, which is genuinely low (eave)
    const eaveLongWallY = roofYAt(Math.round((fx0 + fx1) / 2), fz0);
    (ridgeY > 0 && eaveLongWallY > 0 ? ok : bad)('D2: roof cells found (ridge + eave)');
    (ridgeY > eaveLongWallY ? ok : bad)('D2: roof is gabled — ridge (centre) sits higher than the eave (long-wall edge)');

    // --- windows: at least 2 B.WINDOW cells at groundY+2 on the footprint perimeter ---
    let windowCount = 0;
    for (let wx = fx0; wx <= fx1; wx++) for (let wz = fz0; wz <= fz1; wz++) {
      const perim = (wx === fx0 || wx === fx1 || wz === fz0 || wz === fz1);
      if (perim && at(wx, g + 2, wz) === B.WINDOW) windowCount++;
    }
    (windowCount >= 2 ? ok : bad)(`D2: at least 2 windows on the footprint perimeter (found ${windowCount})`);

    // --- chimney: a column of B.RBRICK rising above the ridge peak at one gable end ---
    let chimneyFound = false;
    for (let wx = fx0; wx <= fx1; wx++) for (let wz = fz0; wz <= fz1; wz++) {
      let col = 0, top = -1;
      for (let y = g + wallH + 1; y < HEIGHT; y++) {
        if (at(wx, y, wz) === B.RBRICK) { col++; top = y; } else if (col > 0) break;
      }
      if (col > 0 && top > ridgeY) { chimneyFound = true; break; }
    }
    (chimneyFound ? ok : bad)('D2: a chimney (RBRICK column) rises above the ridge peak');

    // --- parlour furniture ---
    const { floorY, w: pw, l: pl } = plan.parlour;
    const ix0 = plan.origin.x - Math.floor(pw / 2), iz0 = plan.origin.z - Math.floor(pl / 2);
    const toWorld = (local) => ({ x: ix0 + local.x, z: iz0 + local.z });

    const sb = toWorld(plan.furnish.strongbox);
    (at(sb.x, floorY + 1, sb.z) === B.STRONGBOX ? ok : bad)('D2: strongbox block sits at the plan\'s furnish.strongbox cell');

    let benchesOk = true;
    for (const b of plan.furnish.benches) {
      const w = toWorld(b);
      if (at(w.x, floorY + 1, w.z) !== B.BENCH) benchesOk = false;
    }
    (benchesOk ? ok : bad)('D2: a bench sits at every furnish.benches cell');

    let tablesOk = true;
    for (const t of plan.parlour.tables) {
      const w = toWorld(t);
      if (at(w.x, floorY + 1, w.z) !== B.PLANKS) tablesOk = false;
    }
    (tablesOk ? ok : bad)('D2: a table block (PLANKS) sits at every game-table cell');

    const sv = toWorld(plan.furnish.servery);
    (at(sv.x, floorY + 1, sv.z) === B.PLANKS ? ok : bad)('D2: servery cell holds a table block (PLANKS)');

    // --- full-grid roof/ceiling/seal scan (review 2026-07-03: sampled probes let
    // two write-order aliasing bugs through — scan EVERY footprint cell instead) ---
    {
      const gableHalf = Math.floor((fz1 - fz0) / 2);
      const ridgeYExpect = g + wallH + 1 + gableHalf;
      const chimneyX = fx0; // chimney gable end
      let ceilOk = true, roofOk = true, sealOk = true, chimOk = true;
      for (let wx = fx0; wx <= fx1; wx++) for (let wz = fz0; wz <= fz1; wz++) {
        const interior = (wx > fx0 && wx < fx1 && wz > fz0 && wz < fz1);
        const roofY = g + wallH + 1 + (gableHalf - Math.abs(wz - midZ));
        // (i) every INTERIOR cell keeps a stone ceiling at g+wallH+1 (the D1 contract)
        if (interior && at(wx, g + wallH + 1, wz) !== B.STONEBRICK) ceilOk = false;
        // (ii) the roof skin is SLATE at its computed height on every cell
        if (at(wx, roofY, wz) !== B.SLATE) roofOk = false;
        // (iii) sealed: no AIR anywhere from the ceiling level up to the roof skin
        // on the perimeter columns (interior loft air is fine — it is enclosed)
        if (!interior) {
          for (let y = g + wallH + 1; y <= roofY; y++) {
            if (at(wx, y, wz) === B.AIR) sealOk = false;
          }
        }
      }
      // (iv) chimney: RBRICK column ridgeY+1..ridgeY+3 at the gable end, ON intact slate
      for (let y = ridgeYExpect + 1; y <= ridgeYExpect + 3; y++) {
        if (at(chimneyX, y, midZ) !== B.RBRICK) chimOk = false;
      }
      const chimneyBaseSlate = at(chimneyX, ridgeYExpect, midZ) === B.SLATE;
      (ceilOk ? ok : bad)('D2 full-grid: every interior cell keeps its stone ceiling at g+wallH+1');
      (roofOk ? ok : bad)('D2 full-grid: slate roof skin complete at every footprint cell');
      (sealOk ? ok : bad)('D2 full-grid: perimeter columns sealed ceiling-to-roof (no AIR leak)');
      (chimOk && chimneyBaseSlate ? ok : bad)('D2 full-grid: chimney column ridgeY+1..+3 sits ON intact ridge slate');
    }
  }

  // --- D6: t' inn notes board — a B.BOARD cell exists somewhere on the
  // parlour wall, near the exit door, at floorY+2 ---
  {
    const gen2 = new Gen(12345);
    const plan2 = gen2.inns.get('Grosmont');
    if (plan2) {
      const { floorY, wallThick: wt, w: pw, l: pl } = plan2.parlour;
      const ix0 = plan2.origin.x - Math.floor(pw / 2), iz0 = plan2.origin.z - Math.floor(pl / 2);
      const px0 = ix0 - wt, px1 = px0 + pw + 2 * wt - 1;
      const pz0 = iz0 - wt, pz1 = pz0 + pl + 2 * wt - 1;
      const exitPos = plan2.doorSide === 'n' ? [plan2.origin.x, pz0] : plan2.doorSide === 's' ? [plan2.origin.x, pz1]
        : plan2.doorSide === 'e' ? [px1, plan2.origin.z] : [px0, plan2.origin.z];
      const cx = Math.floor(plan2.origin.x / CHUNK), cz = Math.floor(plan2.origin.z / CHUNK);
      const chunkData2 = new Map();
      for (let dcx = -1; dcx <= 1; dcx++) for (let dcz = -1; dcz <= 1; dcz++) {
        chunkData2.set(`${cx + dcx},${cz + dcz}`, gen2.generateChunk(cx + dcx, cz + dcz));
      }
      const at2 = (wx, wy, wz) => {
        const ccx = Math.floor(wx / CHUNK), ccz = Math.floor(wz / CHUNK);
        const d = chunkData2.get(`${ccx},${ccz}`);
        if (!d) return undefined;
        return d[IDX(wx - ccx * CHUNK, wy, wz - ccz * CHUNK)];
      };
      let boardFound = false;
      const onNS = plan2.doorSide === 'n' || plan2.doorSide === 's';
      for (const off of [2, -2]) {
        const bx = onNS ? exitPos[0] + off : exitPos[0];
        const bz = onNS ? exitPos[1] : exitPos[1] + off;
        if (at2(bx, floorY + 2, bz) === B.BOARD) { boardFound = true; break; }
      }
      (boardFound ? ok : bad)('D6: a notes board (B.BOARD) sits on the parlour wall near the exit door at floorY+2');
    }
  }
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
