// Per-block top-face variation (S1c) check — run wi': node scripts/verify-topvary.mjs
//
// The moor should stop reading as a grid of identical tiles: the TOP faces of the
// growing ground (grass tops, leaf canopies, peat) get a seeded brightness jitter,
// a slow dryness hue skew, and one of four UV rotations — mesh-time only, seeded
// from WORLD x/z, identical on both quality tiers. Building blocks stay perfectly
// uniform, and TOP_VARY_AMP = 0 restores today's output EXACTLY.
//
// Two layers here:
//   (1) the exported pure function topFaceVariation (identity at amp 0, variation
//       and determinism at amp 1, full rotation coverage);
//   (2) a REAL chunk built headlessly (the verify-remesh scaffolding): grass-top
//       quads in one chunk genuinely differ in vertex colour, stone tops stay grey.
//
// Rules (docs/INVARIANTS.md rule 1): headless Node only — no DOM, no WebGL, no
// network, no clocks, no unseeded Math.random.

// --- stub document BEFORE any import that touches the texture atlas ---------
global.document = {
  createElement: (tag) => {
    if (tag !== 'canvas') return {};
    const ctx2d = { clearRect: () => {}, fillRect: () => {}, drawImage: () => {}, fillStyle: '' };
    return { width: 0, height: 0, getContext: () => ctx2d };
  },
};

import { strSeed } from '../src/noise.js';
import { B, BLOCKS, CHUNK, HEIGHT } from '../src/defs.js';
import { initMaterials, getMaterials, topFaceVariation } from '../src/mesher.js';
import { ATLAS_TILES } from '../src/textures.js';
import { World } from '../src/world.js';

let failed = false;
const ok  = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

console.log('\n-- per-block top-face variation (pure function) --\n');

// --- amp 0 is EXACT identity: today's output, and the Plain/Fine parity anchor ---
{
  const identity = JSON.stringify({ r: 1, g: 1, b: 1, rot: 0 });
  const coords = [[0, 0], [10, 20], [-7, 133], [9999, -4444], [-123456, 987654]];
  (coords.every(([x, z]) => JSON.stringify(topFaceVariation(x, z, 0)) === identity)
    ? ok : bad)('amp 0 -> identity tint {1,1,1} and rotation 0 at every coord tried');
}

// --- at full amp: block-to-block variation, deterministic, all four rotations ---
{
  (topFaceVariation(10, 20).r !== topFaceVariation(11, 20).r
    ? ok : bad)('neighbouring blocks get different brightness (10,20 vs 11,20)');
  (JSON.stringify(topFaceVariation(37, -21)) === JSON.stringify(topFaceVariation(37, -21))
    ? ok : bad)('deterministic — same coords, same variation, twice (INVARIANTS.md rule 6)');
  const rots = new Set();
  for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) rots.add(topFaceVariation(x, z).rot);
  ([0, 1, 2, 3].every(r => rots.has(r)) && rots.size === 4
    ? ok : bad)(`a 32x32 sweep uses all four UV rotations and no others (saw {${[...rots].sort().join(',')}})`);
}

// --- a REAL chunk, built headlessly: the variation lands in the vertex colours ---
console.log('\n-- per-block top-face variation (real chunk mesh) --\n');

initMaterials();
const scene = { add() {}, remove() {} };
const world = new World(scene, strSeed('topvary-arena'));
world.renderDist = 1; // small streamed ring — setup settles fast
const PX = CHUNK / 2, PZ = CHUNK / 2;
const tick = (n = 1) => { for (let i = 0; i < n; i++) world.update(PX, PZ); };
const airY = (x, z) => {
  let y = HEIGHT - 2;
  while (y > 1 && world.getBlock(x, y - 1, z) === B.AIR) y--;
  return y;
};
let settle = 0;
const settled = () => {
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const c = world.chunkAt(dx, dz);
    if (!c || !c.meshes || c.dirty) return false;
  }
  return true;
};
while (!settled() && settle < 400) { tick(); settle++; }
(settled() ? ok : bad)(`world settled: 3x3 meshed and clean in ${settle} ticks`);

// two gritstone blocks placed on the surface: guaranteed exposed STONE tops
world.setBlock(PX, airY(PX, PZ), PZ, B.STONE);
world.setBlock(PX + 2, airY(PX + 2, PZ), PZ, B.STONE);
tick(4); // drain any queued remesh

// scan every UP-facing quad of a chunk's opaque mesh; recover its atlas tile from
// the UV rect (u0 = col/16 + gutter, so floor(minU*16) is the column; likewise rows)
const quadsOf = (cx, cz) => {
  const mats = getMaterials();
  const mesh = (world.chunkAt(cx, cz).meshes || []).find(m => m.material === mats.opaque);
  if (!mesh) return [];
  const g = mesh.geometry;
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
  const uv = g.getAttribute('uv'), col = g.getAttribute('color');
  const out = [];
  for (let i = 0; i < pos.count; i += 4) { // GeoBuilder pushes exactly 4 verts per quad
    if (nor.getY(i) !== 1) continue;       // top faces only
    let u0 = Infinity, v1 = -Infinity;
    for (let k = 0; k < 4; k++) { u0 = Math.min(u0, uv.getX(i + k)); v1 = Math.max(v1, uv.getY(i + k)); }
    const tile = Math.floor(u0 * ATLAS_TILES) + Math.floor((1 - v1) * ATLAS_TILES) * ATLAS_TILES;
    out.push({ tile, cols: [0, 1, 2, 3].map(k => [col.getX(i + k), col.getY(i + k), col.getZ(i + k)]) });
  }
  return out;
};
const grassTile = BLOCKS[B.GRASS].tex.t, stoneTile = BLOCKS[B.STONE].tex.t;
let grass = [], stone = [];
for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
  for (const q of quadsOf(dx, dz)) {
    if (q.tile === grassTile) grass.push(q);
    else if (q.tile === stoneTile) stone.push(q);
  }
}
(grass.length >= 2 ? ok : bad)(`the settled ring holds grass tops to compare (${grass.length} quads)`);
(stone.length >= 2 ? ok : bad)(`…and the placed gritstone shows exposed stone tops (${stone.length} quads)`);
{
  const sig = q => q.cols.map(c => c.map(v => v.toFixed(5)).join(',')).join(';');
  const distinct = new Set(grass.map(sig));
  (distinct.size >= 2 ? ok : bad)(`two GRASS_TOP quads differ in vertex colour (${distinct.size} distinct colourings)`);
  (grass.some(q => q.cols[0][0] !== q.cols[0][2])
    ? ok : bad)('the dryness skew shows: some grass top is genuinely tinted (r != b), not just dimmed');
  (stone.every(q => q.cols.every(([r, g2, b]) => r === g2 && g2 === b))
    ? ok : bad)('STONE tops stay perfectly grey (r === g === b on every vertex) — building blocks untouched');
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
