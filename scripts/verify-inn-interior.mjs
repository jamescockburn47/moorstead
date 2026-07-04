// innPlan() determinism + shape — run wi': node scripts/verify-inn-interior.mjs
import { MoorsGeography } from '../src/moorsgeo.js';
import { innPlan, PARLOUR_W, PARLOUR_L, PARLOUR_H } from '../src/innplan.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// A tavern door must be walkable: stampInns carves a 3-wide × 2-deep cobbled
// forecourt cleared to head+1 out from the door. Assert every forecourt cell is
// clear at body+head with solid footing, and the door block survived — this is
// the guard that catches a proud terrain bank, a cutout scrub, OR (crucially) a
// later stamp (station/terrace) overwriting the approach. `at(wx,wy,wz)` routes
// a world coord to the right generated chunk. Reused for seed 12345 AND the live
// MOORS_SEED (the gap that let the real Grosmont door ship walled).
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
    if (at(sx, g + 1, sz) !== B.AIR) okAll = false;   // body height clear
    if (at(sx, g + 2, sz) !== B.AIR) okAll = false;   // head height clear
    if (at(sx, g, sz) === B.AIR) okAll = false;       // solid footing (the cobble step)
  }
  (okAll ? ok : bad)(`door forecourt 3-wide×2-deep clear + footing${label} [${plan.village} door ${plan.doorSide}]`);
  (at(doorP[0], g + 1, doorP[1]) === B.INN_DOOR ? ok : bad)(`door block survives the forecourt carve${label} [${plan.village}]`);
}

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

  // pinned snapshot of the seed-12345 plan — a determinism/back-compat tripwire.
  // Re-pinned 2026-07-04 when scanSite gained rail/station/works clearance +
  // outward doors (James: "pubs must be offset from all structures and train
  // lines"), which deliberately re-sited every pub; these are the NEW intended
  // values, so an ACCIDENTAL future geometry change still trips this.
  const pinned = innPlanD2(geo, 'Grosmont', 12345);
  (pinned && pinned.origin.x === 1419 && pinned.origin.z === 2632 ? ok : bad)('D2: origin matches pinned snapshot (1419,2632)');
  (pinned && pinned.groundY === 32 ? ok : bad)('D2: groundY matches pinned snapshot (32)');
  (pinned && pinned.doorSide === 'e' ? ok : bad)('D2: doorSide matches pinned snapshot (e, faces outward)');
  (pinned && pinned.footprint.x0 === 1415 && pinned.footprint.z0 === 2629 && pinned.footprint.x1 === 1423 && pinned.footprint.z1 === 2635
    ? ok : bad)('D2: footprint matches pinned snapshot (1415,2629)-(1423,2635)');

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

    // --- door approach is walkable (James, live 2026-07-04: a terrain bank one
    // block proud of the tavern floor walled the doorway off; the single-file
    // 2-cell slot was reachable but cramped, so it's now a 3-wide × 2-deep
    // cobbled forecourt cleared to head+1). checkForecourt is reused by the
    // live-seed pass at the bottom of this file — a Gen(12345) check alone let
    // the real MOORS_SEED door orientation ship unguarded. ---
    checkForecourt(plan, at, g, B, ' (seed 12345)');

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

// --- LIVE-SEED door-reachability pass (James, 2026-07-04): the checks above run
// on Gen(12345), but production runs MOORS_SEED. At 12345 the doors face
// elsewhere, so the real Grosmont south-into-the-station-bank door was never
// guarded and shipped walled. Assert the forecourt is clear for EVERY inn at the
// real seed, so a siting/carve regression that re-walls a live door fails here. ---
{
  const { Gen, MOORS_SEED } = await import('../src/worldgen.js');
  const { B, CHUNK, HEIGHT } = await import('../src/defs.js');
  const IDX = (x, y, z) => x + z * CHUNK + y * CHUNK * CHUNK;
  const gen = new Gen(MOORS_SEED);
  (gen.inns.size > 0 ? ok : bad)(`live seed builds inns (${gen.inns.size})`);
  for (const plan of gen.inns.values()) {
    const { x0: pbx0, z0: pbz0, x1: pbx1, z1: pbz1 } = plan.protectedBox;
    const cx0 = Math.floor((pbx0 - 2) / CHUNK), cx1 = Math.floor((pbx1 + 2) / CHUNK);
    const cz0 = Math.floor((pbz0 - 2) / CHUNK), cz1 = Math.floor((pbz1 + 2) / CHUNK);
    const cd = new Map();
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) cd.set(`${cx},${cz}`, gen.generateChunk(cx, cz));
    const at = (wx, wy, wz) => {
      if (wy < 0 || wy >= HEIGHT) return B.AIR;
      const cx = Math.floor(wx / CHUNK), cz = Math.floor(wz / CHUNK);
      const data = cd.get(`${cx},${cz}`); if (!data) return undefined;
      return data[IDX(wx - cx * CHUNK, wy, wz - cz * CHUNK)];
    };
    checkForecourt(plan, at, plan.groundY, B, ' (LIVE seed)');
  }

  // --- siting: every pub is offset from rails and stations (James 2026-07-04:
  // the Pickering pub had generated on the track in front of the grand station).
  // scanSite now rejects rail-near / station-near sites; guard that here. ---
  const geo = gen.geo;
  for (const plan of gen.inns.values()) {
    const o = plan.origin;
    const ri = typeof geo.railInfo === 'function' ? geo.railInfo(o.x, o.z) : null;
    (!ri || ri.d >= 8 ? ok : bad)(`siting: ${plan.village} pub is well clear of the rails (dist ${ri ? ri.d.toFixed(1) : '∞'})`);
    const st = typeof geo.nearStation === 'function' ? geo.nearStation(o.x, o.z, 20) : null;
    (!st ? ok : bad)(`siting: ${plan.village} pub is clear of any station (within 20)`);
  }
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
