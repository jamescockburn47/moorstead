// The Undercroft: the multi-room warren carved below each tavern is genuinely
// reachable, sealed, furnished and rail-safe. Run wi': node scripts/verify-inn-undercroft.mjs
//
// The load-bearing check is a REACHABILITY FLOOD-FILL from the teleport drop cell,
// modelling the player's real movement (step up <=1, fall any drop, 2-high body):
// it proves you can walk from the drop to every room, every game table, the letting
// beds AND down the stair to the strongbox — the exact "can you actually get there"
// bug an eyeball or a spot-probe misses. Plus: sealed shell (the flood never escapes
// to the surface or outside the protected box), furniture present, the sunken vault
// above bedrock, and every protected-box corner clear of the running line.
import { Gen, MOORS_SEED } from '../src/worldgen.js';
import { relCell } from '../src/innplan.js';
import { B, CHUNK, HEIGHT } from '../src/defs.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const IDX = (x, y, z) => x + z * CHUNK + y * CHUNK * CHUNK;

const SOLID = id => id !== B.AIR && id !== B.WATER && id !== undefined && id !== -1;
// what the player can walk THROUGH (empty air or a cutout torch) — a body/head cell
const PASSABLE = id => id === B.AIR || id === B.TORCH;

function chunksOver(gen, box, pad = 1) {
  const cd = new Map();
  const cx0 = Math.floor((box.x0 - pad) / CHUNK), cx1 = Math.floor((box.x1 + pad) / CHUNK);
  const cz0 = Math.floor((box.z0 - pad) / CHUNK), cz1 = Math.floor((box.z1 + pad) / CHUNK);
  for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) cd.set(cx + ',' + cz, gen.generateChunk(cx, cz));
  return cd;
}
const reader = cd => (x, y, z) => {
  if (y < 0 || y >= HEIGHT) return -1;
  const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
  const d = cd.get(cx + ',' + cz);
  if (!d) return undefined;
  return d[IDX(x - cx * CHUNK, y, z - cz * CHUNK)];
};

// a valid stand cell: solid floor at fy-1, passable body at fy and fy+1
const stands = (at, x, fy, z) => SOLID(at(x, fy - 1, z)) && PASSABLE(at(x, fy, z)) && PASSABLE(at(x, fy + 1, z));

// BFS the player can actually walk, from the drop cell. Step up <=1, fall up to 4,
// 2-high body. Returns a Set of "x,fy,z" reachable stand cells.
function floodReach(at, ox, oz, floorY) {
  const start = floorY + 1;
  if (!stands(at, ox, start, oz)) return new Set(); // drop must be standable
  const seen = new Set([ox + ',' + start + ',' + oz]);
  const q = [[ox, start, oz]];
  while (q.length) {
    const [x, fy, z] = q.shift();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      // try step-up 1, level, then falling down to -4
      for (let nfy = fy + 1; nfy >= fy - 4; nfy--) {
        if (!stands(at, nx, nfy, nz)) continue;
        // stepping UP requires the head cell above the current spot be clear too
        if (nfy > fy && at(x, fy + 2, z) !== B.AIR) continue;
        const k = nx + ',' + nfy + ',' + nz;
        if (!seen.has(k)) { seen.add(k); q.push([nx, nfy, nz]); }
        break; // highest reachable landing on this column wins
      }
    }
  }
  return seen;
}
// is any orthogonal neighbour of (x,z) a reachable stand cell at feet-height fy?
const reachableBeside = (reach, x, z, fy) =>
  [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => reach.has((x + dx) + ',' + fy + ',' + (z + dz)));

const gen = new Gen(MOORS_SEED);
(gen.inns.size > 0 ? ok : bad)(`live seed builds inns (${gen.inns.size})`);

for (const p of gen.inns.values()) {
  const par = p.parlour, fY = par.floorY, ph = par.h;
  const rc = (f, l) => relCell(p.origin, p.doorSide, f, l);
  const cd = chunksOver(gen, p.protectedBox, 2);
  const at = reader(cd);
  const tag = `[${p.village} ${p.doorSide}]`;

  // --- 1. safe teleport landing: drop cell clear, solid floor, 2-high headroom ---
  {
    const o = rc(0, 0);
    const okDrop = at(o.x, fY, o.z) !== B.AIR && at(o.x, fY + 1, o.z) === B.AIR && at(o.x, fY + 2, o.z) === B.AIR;
    (okDrop ? ok : bad)(`drop cell is clear over a solid floor ${tag}`);
  }

  // --- 2. every room interior hollow (floor + ceiling solid), except the vault pit
  // + its treads, which deliberately open the floor to descend to the strongroom ---
  {
    const vaultCells = new Set();
    for (let f = par.vault.pit.f0; f <= par.vault.pit.f1; f++) for (let l = par.vault.pit.l0; l <= par.vault.pit.l1; l++) vaultCells.add(f + ',' + l);
    for (const [f, l] of par.vault.treads) vaultCells.add(f + ',' + l);
    let hollow = true, sealed = true;
    for (const r of par.rooms) {
      for (let f = r.f0; f <= r.f1; f++) for (let l = r.l0; l <= r.l1; l++) {
        const w = rc(f, l);
        if (!vaultCells.has(f + ',' + l) && at(w.x, fY, w.z) === B.AIR) sealed = false; // floor solid
        if (at(w.x, fY + ph + 1, w.z) === B.AIR) sealed = false;    // ceiling solid
        for (let y = fY + 1; y <= fY + ph; y++) if (at(w.x, y, w.z) === undefined) hollow = false;
      }
    }
    (sealed ? ok : bad)(`every room has a solid floor and ceiling ${tag}`);
    (hollow ? ok : bad)(`every room interior is generated (no void) ${tag}`);
  }

  // --- 3. REACHABILITY: walk from the drop to every interactive thing ---
  {
    const o = rc(0, 0);
    const reach = floodReach(at, o.x, o.z, fY);
    (reach.size > 0 ? ok : bad)(`flood-fill starts from a standable drop ${tag}`);

    // sealed shell: the walk never escapes to the surface or outside the box
    let escaped = false;
    for (const k of reach) {
      const [x, fy, z] = k.split(',').map(Number);
      if (fy >= p.groundY) escaped = true;
      if (x < p.protectedBox.x0 || x > p.protectedBox.x1 || z < p.protectedBox.z0 || z > p.protectedBox.z1) escaped = true;
    }
    (!escaped ? ok : bad)(`the undercroft is sealed — the walk never reaches the surface or outside the box ${tag}`);

    // each game table reachable from beside it (player stands at feetY=fY+1)
    let tablesReach = true;
    for (const t of par.tables) { const w = rc(t.f, t.l); if (!reachableBeside(reach, w.x, w.z, fY + 1)) tablesReach = false; }
    (tablesReach ? ok : bad)(`all 4 game tables are reachable on foot ${tag}`);

    // every letting bed reachable
    let bedsReach = true;
    for (const bd of p.furnish.beds) { const w = rc(bd.f, bd.l); if (!reachableBeside(reach, w.x, w.z, fY + 1)) bedsReach = false; }
    (bedsReach ? ok : bad)(`all letting beds are reachable on foot ${tag}`);

    // the range/hearth reachable
    { const w = rc(par.hearth.f, par.hearth.l); (reachableBeside(reach, w.x, w.z, fY + 1) ? ok : bad)(`the range is reachable on foot ${tag}`); }

    // the exit door reachable (stand beside it)
    { const w = rc(-2, 0); (reachableBeside(reach, w.x, w.z, fY + 1) ? ok : bad)(`the exit door is reachable on foot ${tag}`); }

    // THE VAULT: strongbox reachable down the stair (player stands at pit-floor feetY = vaultFloorY+1)
    { const s = p.furnish.strongbox; const w = rc(s.f, s.l); (reachableBeside(reach, w.x, w.z, par.vaultFloorY + 1) ? ok : bad)(`the strongbox is reachable down the vault stair ${tag}`); }
  }

  // --- 4. furniture present ---
  {
    let tOk = true; for (const t of par.tables) { const w = rc(t.f, t.l); if (at(w.x, fY + 1, w.z) !== B.PLANKS) tOk = false; }
    (tOk ? ok : bad)(`4 game tables (PLANKS) stamped ${tag}`);
    { const w = rc(par.hearth.f, par.hearth.l); (at(w.x, fY + 1, w.z) === B.RANGE ? ok : bad)(`cast-iron range stamped at the hearth ${tag}`); }
    { const s = p.furnish.strongbox; const w = rc(s.f, s.l); (at(w.x, s.y, w.z) === B.STRONGBOX ? ok : bad)(`the one strongbox sits in the vault at y${s.y} ${tag}`); }
    let bOk = true; for (const bd of p.furnish.beds) { const w = rc(bd.f, bd.l); if (at(w.x, fY + 1, w.z) !== B.WOOL) bOk = false; }
    (bOk ? ok : bad)(`${p.furnish.beds.length} letting beds (WOOL) stamped ${tag}`);
    { const w = rc(-2, 0); (at(w.x, fY + 1, w.z) === B.INN_DOOR ? ok : bad)(`interior exit door stamped ${tag}`); }
  }

  // --- 5. vault above bedrock; cap below the surface ---
  {
    const s = p.furnish.strongbox; const w = rc(s.f, s.l);
    (at(w.x, par.vaultFloorY, w.z) !== B.AIR && par.vaultFloorY >= 1 ? ok : bad)(`vault floor sits above bedrock (y${par.vaultFloorY}) ${tag}`);
    // a solid rock cap between the ceiling and the surface (no shaft up)
    const c = rc(0, 0);
    let capOk = p.groundY - (fY + ph + 1) >= 4;
    for (let y = fY + ph + 1; y < p.groundY; y++) if (at(c.x, y, c.z) === B.AIR) capOk = false;
    (capOk ? ok : bad)(`solid rock cap between the ceiling and the surface ${tag}`);
  }

  // --- 6. rail/station clearance: every REAL protected rect corner clear of the line
  // (the per-room rects, not the phantom-cornered bounding box) ---
  {
    const geo = gen.geo;
    let railOk = true, minD = Infinity;
    for (const r of p.protectedRects) {
      for (const [x, z] of [[r.x0, r.z0], [r.x1, r.z0], [r.x0, r.z1], [r.x1, r.z1]]) {
        if (typeof geo.railInfo === 'function') { const ri = geo.railInfo(x, z); if (ri) { minD = Math.min(minD, ri.d); if (ri.d < 3) railOk = false; } }
      }
    }
    (railOk ? ok : bad)(`every room rect corner is >=3 from the rail (min ${minD === Infinity ? '∞' : minD.toFixed(1)}) ${tag}`);
    const st = typeof geo.nearStation === 'function' ? geo.nearStation(p.origin.x, p.origin.z, 4) : null;
    (!st ? ok : bad)(`the undercroft footprint is clear of any station ${tag}`);
  }
}

// --- determinism: two builds byte-identical (incl. the whole parlour + furnish) ---
{
  const a = new Gen(MOORS_SEED).inns.get('Grosmont');
  const b = new Gen(MOORS_SEED).inns.get('Grosmont');
  (JSON.stringify(a) === JSON.stringify(b) ? ok : bad)('deterministic — two Gen(MOORS_SEED) builds give an identical Grosmont plan');
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
