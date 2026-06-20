// Mining and land decay verification tests — run with: node scripts/verify-mining.mjs
import { B } from '../src/defs.js';
import { mayDigDeep, depthBandFor, isExpired } from '../src/editledger.js';
import { strSeed } from '../src/noise.js';
import { Gen } from '../src/worldgen.js';
import { miningDigGuide, parishQuarries, nearestFreeDigSites, directionLabel } from '../src/mining-guide.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// --- 1. mayDigDeep: Surface Skim and Gating ---
{
  // y >= grade - 1 (within 1-block surface skim) is always allowed
  const r1 = mayDigDeep(39, 40, null, 'wood', []);
  (r1.allowed === true ? ok : bad)('surface skim (1 block deep) is always allowed without a mine deed');

  // y < grade - 1 requires mine deed
  const r2 = mayDigDeep(38, 40, null, 'wood', []);
  (r2.allowed === false && r2.reason === 'nomine' ? ok : bad)('deep digging without mine deed is blocked');

  // mine depth limit check
  const deed = { cx: 0, cz: 0, radius: 5, depth: 10, paidUntilDay: 100, lapsedDay: null };
  const r3 = mayDigDeep(25, 40, deed, 'wood', []);
  (r3.allowed === false && r3.reason === 'depthlimit' && r3.limit === 10 ? ok : bad)('digging past licensed depth is blocked');

  // Band 1 (0 to 10 below grade): requires wood pick, no fixtures
  const rBand1 = mayDigDeep(35, 40, deed, 'wood', []);
  (rBand1.allowed === true ? ok : bad)('Band 1 allows wood pick and no fixtures');

  // Band 2 (11 to 20 below grade): requires stone pick and Pit Props
  const deedMid = { ...deed, depth: 20 };
  const rBand2_noPick = mayDigDeep(25, 40, deedMid, 'wood', [B.PIT_PROPS]);
  (rBand2_noPick.allowed === false && rBand2_noPick.reason === 'pick' ? ok : bad)('Band 2 blocks wood pick');

  const rBand2_noProp = mayDigDeep(25, 40, deedMid, 'stone', []);
  (rBand2_noProp.allowed === false && rBand2_noProp.reason === 'fixture' && rBand2_noProp.fixtureNeeded === B.PIT_PROPS ? ok : bad)('Band 2 blocks dig without Pit Props');

  const rBand2_ok = mayDigDeep(25, 40, deedMid, 'stone', [B.PIT_PROPS]);
  (rBand2_ok.allowed === true ? ok : bad)('Band 2 allows stone pick and Pit Props');

  // Band 3 (21 to 30 below grade): requires iron pick and Safety Lamp
  const deedDeep = { ...deed, depth: 30 };
  const rBand3_noPick = mayDigDeep(15, 40, deedDeep, 'stone', [B.SAFETY_LAMP]);
  (rBand3_noPick.allowed === false && rBand3_noPick.reason === 'pick' ? ok : bad)('Band 3 blocks stone pick');

  const rBand3_noLamp = mayDigDeep(15, 40, deedDeep, 'iron', []);
  (rBand3_noLamp.allowed === false && rBand3_noLamp.reason === 'fixture' && rBand3_noLamp.fixtureNeeded === B.SAFETY_LAMP ? ok : bad)('Band 3 blocks dig without Safety Lamp');

  const rBand3_ok = mayDigDeep(15, 40, deedDeep, 'iron', [B.SAFETY_LAMP]);
  (rBand3_ok.allowed === true ? ok : bad)('Band 3 allows iron pick and Safety Lamp');

  // Band 4 (31+ below grade): requires iron pick and Winch
  const deedMax = { ...deed, depth: 40 };
  const rBand4_noWinch = mayDigDeep(5, 40, deedMax, 'iron', []);
  (rBand4_noWinch.allowed === false && rBand4_noWinch.reason === 'fixture' && rBand4_noWinch.fixtureNeeded === B.WINCH ? ok : bad)('Band 4 blocks dig without Winch');

  const rBand4_ok = mayDigDeep(5, 40, deedMax, 'iron', [B.WINCH]);
  (rBand4_ok.allowed === true ? ok : bad)('Band 4 allows iron pick and Winch');
}

// --- 2. Natural cave drifts (free old workings) ---
{
  const gen = new Gen(42);
  let caveCell = null;
  outer: for (let x = -200; x <= 200 && !caveCell; x += 3) {
    for (let z = -200; z <= 200 && !caveCell; z += 3) {
      const h = gen.height(x, z);
      for (let y = 5; y < h - 4; y++) {
        if (gen.caveAt(x, y, z, h)) { caveCell = { x, y, z, h }; break outer; }
      }
    }
  }
  if (!caveCell) bad('could not find a natural cave cell in test seed');
  else {
    const { x, y, z, h } = caveCell;
    (gen.inNaturalCaveVolume(x, y, z) === true ? ok : bad)('inside natural cave air is wild-mining volume');
    // A solid block bordering cave air (typical dig face) counts too
    let wall = null;
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const wx = x + dx, wy = y + dy, wz = z + dz;
      if (!gen.caveAt(wx, wy, wz, gen.height(wx, wz)) && wy < h - 1) { wall = { x: wx, y: wy, z: wz }; break; }
    }
    (wall && gen.inNaturalCaveVolume(wall.x, wall.y, wall.z) === true ? ok : bad)('cave wall bordering drift air is wild-mining volume');
    // Solid rock below grade with no cave neighbour stays gated
    let solid = null;
    for (let sx = -200; sx <= 200 && !solid; sx += 5) {
      for (let sz = -200; sz <= 200 && !solid; sz += 5) {
        const sh = gen.height(sx, sz);
        const sy = sh - 5;
        if (sy >= 4 && !gen.inNaturalCaveVolume(sx, sy, sz)) solid = true;
      }
    }
    (solid ? ok : bad)('deep solid rock away from drifts is not wild-mining volume');
  }
}

// --- 3. Scattered moor quarries (stampQuarry old workings) ---
{
  const gen = new Gen(strSeed('t-shared-moor'));
  const qx = -312, qz = 519, qy = 28;
  (gen.wildQuarryAt(qx, qz) !== null ? ok : bad)('shared-moor wild quarry exists near moor fringe test coords');
  (gen.inWildQuarryVolume(qx, qy, qz) === true ? ok : bad)('pit floor below grade inside wild quarry is free to dig');
  (gen.inOldWorkingsVolume(qx, qy, qz) === true ? ok : bad)('wild quarry counts as old workings');
  (gen.inWildQuarryVolume(-313, 514, 28) === false ? ok : bad)('solid moor outside quarry footprint stays gated');
}

// --- 4. Prospecting Level Math ---
{
  const calcLvl = xp => Math.floor(Math.sqrt(xp / 10));
  (calcLvl(0) === 0 ? ok : bad)('XP 0 is level 0');
  (calcLvl(80) === 2 ? ok : bad)('XP 80 is level 2');
  (calcLvl(90) === 3 ? ok : bad)('XP 90 is level 3 (required for Jet)');
  (calcLvl(350) === 5 ? ok : bad)('XP 350 is level 5');
  (calcLvl(360) === 6 ? ok : bad)('XP 360 is level 6 (required for Polyhalite)');
}

// --- 5. Build & Dig Decay ---
{
  // A build edit inside active claim never expires
  const activeClaim = { kind: 'claim', cx: 10, cz: 10, radius: 8, lapsedDay: null };
  const buildEdit = { cat: 'build', day: 1, was: B.STONEBRICK };
  (isExpired(buildEdit, 100, [activeClaim], 1, 10, 40, 10, null) === false ? ok : bad)('build inside active claim never decays');

  // A build edit outside claims expires after 30 days
  (isExpired(buildEdit, 30, [], 1, 10, 40, 10, null) === false ? ok : bad)('build outside claim at 29 days does not decay');
  (isExpired(buildEdit, 32, [], 1, 10, 40, 10, null) === true ? ok : bad)('build outside claim past 30 days decays');

  // A build edit inside lapsed claim has a grace + gradual decay duration
  const lapsedClaim = { kind: 'claim', cx: 10, cz: 10, radius: 8, lapsedDay: 5 };
  // grace = 7, duration = 14, coordHash ranges [0, 1]. So decay between 5 + 7 = 12 and 5 + 7 + 14 = 26.
  (isExpired(buildEdit, 11, [lapsedClaim], 1, 10, 40, 10, null) === false ? ok : bad)('build inside lapsed claim within grace does not decay');
  (isExpired(buildEdit, 27, [lapsedClaim], 1, 10, 40, 10, null) === true ? ok : bad)('build inside lapsed claim past grace + duration decays');
  
  // mode-based decay scale (2x slower in bairns world)
  (isExpired(buildEdit, 20, [lapsedClaim], 2, 10, 40, 10, null) === false ? ok : bad)('lapsed claim decay is 2x slower in bairns world');

  // A dig edit inside active mine and depth envelope never expires
  const activeMine = { kind: 'mine', cx: 10, cz: 10, radius: 5, depth: 20, lapsedDay: null };
  const digEdit = { cat: 'dig', day: 1, was: B.STONE };
  const hFunc = () => 40;
  (isExpired(digEdit, 100, [activeMine], 1, 10, 30, 10, hFunc) === false ? ok : bad)('dig inside active mine envelope never backfills');
  
  // A dig edit outside mine envelope backfills after 24 days
  (isExpired(digEdit, 24, [], 1, 10, 30, 10, hFunc) === false ? ok : bad)('dig outside mine at 23 days does not backfill');
  (isExpired(digEdit, 26, [], 1, 10, 30, 10, hFunc) === true ? ok : bad)('dig outside mine past 24 days backfills');
}

// --- 6. Mining guide (map + directions) ---
{
  const gen = new Gen(strSeed('t-shared-moor'));
  const deeds = [
    { id: 'quarry_moorstead', kind: 'quarry', by: 'parish', cx: 40, cz: 60, radius: 10, lapsedDay: null },
  ];
  (parishQuarries(deeds).length === 1 ? ok : bad)('parish quarries list extracts from deeds');
  (directionLabel(100, 0) === 'north' ? ok : bad)('directionLabel north');
  (directionLabel(0, 100) === 'east' ? ok : bad)('directionLabel east');
  const wild = gen.listWildQuarries();
  (wild.length > 20 ? ok : bad)('shared moor has scattered wild quarry pits');
  const near = nearestFreeDigSites(gen, deeds, -313, 514, 2);
  (near.length >= 2 ? ok : bad)('nearest free sites returns parish + wild options');
  const guide = miningDigGuide('nomine', { pos: { x: -313, y: 37, z: 514 } }, { gen, deeds });
  (guide.message.includes('Mine Entrance') && guide.highlights.length >= 1 ? ok : bad)('nomine guide mentions licence and highlights free sites');
}

console.log('RESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
