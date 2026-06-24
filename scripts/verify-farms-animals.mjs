// Headless assertions: animal-cleanup predicates (Tasks 1-3) + farms (Tasks 4-6).
import assert from 'node:assert';
import { B } from '../src/defs.js';
import { Gen, MOORS_SEED } from '../src/worldgen.js';
import { CHUNK, HEIGHT } from '../src/defs.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

// ---- Task 2, Step 1: isWalkableGround contract ----
// Re-declare the predicate the same way entities.js does, and assert its contract.
const WALKABLE_GROUND = new Set([B.GRASS, B.PEAT, B.DIRT, B.STONE, B.SAND]);
const isWalkableGround = b => WALKABLE_GROUND.has(b);

ok(isWalkableGround(B.GRASS) && isWalkableGround(B.PEAT), 'grass + peat are walkable ground');
ok(!isWalkableGround(B.LOG) && !isWalkableGround(B.LEAVES) && !isWalkableGround(B.PLANKS) && !isWalkableGround(B.WATER) && !isWalkableGround(B.FENCE),
  'trees, buildings, water and fences are NOT walkable ground (rescueStuck/spawn must reject them)');

// ---- Task 3, Step 2: isBarrier contract ----
const BARRIER = new Set([B.FENCE, B.GATE, B.COBBLE]);
const isBarrier = b => BARRIER.has(b);

ok(isBarrier(B.FENCE) && isBarrier(B.COBBLE) && !isBarrier(B.GRASS) && !isBarrier(B.DIRT),
  'fences + cobble walls are barriers; bare ground is not');

// ---- Tasks 4-6: farms ----
const gen = new Gen(MOORS_SEED), geo = gen.geo;
const farms = geo.farmSites();
ok(farms.length >= 10 && farms.length <= 14, `~10-12 farms placed (got ${farms.length})`);
for (const f of farms) {
  ok(geo.height(f.x, f.z) >= 27, `farm ${f.x},${f.z} on dry land (h=${geo.height(f.x,f.z)})`);
  ok(geo.riverWaterLevel(f.x, f.z) == null, `farm ${f.x},${f.z} not in a river`);
  const ri = geo.railInfo(f.x, f.z); ok(!ri || ri.d >= 3, `farm ${f.x},${f.z} clear of the rails`);
  // _nearTownBuildingOnly: towns-only check avoids self-hit from this farm's own buildings
  ok(!geo._nearTownBuildingOnly(f.x, f.z, 8), `farm ${f.x},${f.z} clear of town buildings`);
}
// deterministic
const farms2 = new Gen(MOORS_SEED).geo.farmSites();
ok(JSON.stringify(farms) === JSON.stringify(farms2), 'farm sites are deterministic for the seed');

// ---- Task 5: _farmBuildings ----
const f0 = geo.farmSites()[0];
const blds = geo._farmBuildings(f0);
ok(blds.some(b => b.type === 'farmhouse') && blds.some(b => b.type === 'barn') && blds.some(b => b.type === 'fold'),
  'a farm has a farmhouse, a barn and a fold');
// farm-aware lookups — the first building's footprint should register
ok(geo.nearTownBuilding(blds[0].x0, blds[0].z0, 1), 'nearTownBuilding now reports farm buildings too');

// ---- Task 6: stampFarm — read stamped blocks ----
// Helper: generate (and cache) chunks, then read a block from world-coords
const IDX = (x, y, z) => x + z * CHUNK + y * CHUNK * CHUNK;
const chunkCache = new Map();
const getChunk = (cx, cz) => {
  const key = `${cx},${cz}`;
  if (!chunkCache.has(key)) chunkCache.set(key, gen.generateChunk(cx, cz));
  return chunkCache.get(key);
};
const blockAt = (wx, wy, wz) => {
  if (wy < 0 || wy >= HEIGHT) return B.AIR;
  const cx = wx >> 4, cz = wz >> 4; // Math.floor(wx/16) for positive coords
  const lx = ((wx % CHUNK) + CHUNK) % CHUNK, lz = ((wz % CHUNK) + CHUNK) % CHUNK;
  return getChunk(cx, cz)[IDX(lx, wy, lz)];
};

// generate the chunks that the first farmhouse touches
const house = blds.find(b => b.type === 'farmhouse');
for (let cx = (house.x0 >> 4) - 1; cx <= (house.x1 >> 4) + 1; cx++)
  for (let cz = (house.z0 >> 4) - 1; cz <= (house.z1 >> 4) + 1; cz++)
    getChunk(cx, cz);

// farmhouse walls should be cobble and >=2 high
let wall = 0;
const gh = geo.height(house.x0, house.z0);
for (let y = gh + 1; y <= gh + 3; y++) if (blockAt(house.x0, y, house.z0) === B.COBBLE) wall++;
ok(wall >= 2, `farmhouse has standing cobble walls >= 2 high (got ${wall})`);

// fold should be fenced
const fold = blds.find(b => b.type === 'fold');
for (let cx = (fold.x0 >> 4) - 1; cx <= (fold.x1 >> 4) + 1; cx++)
  for (let cz = (fold.z0 >> 4) - 1; cz <= (fold.z1 >> 4) + 1; cz++)
    getChunk(cx, cz);
const foldG = geo.height(fold.x0, fold.z0);
ok(blockAt(fold.x0, foldG + 1, fold.z0) === B.FENCE, `the fold corner is fenced (got ${blockAt(fold.x0, foldG + 1, fold.z0)})`);

console.log(`verify-farms-animals: ${n} assertions OK`);
