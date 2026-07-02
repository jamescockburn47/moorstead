// verify-remesh.mjs — guards the amortised chunk-remesh queue.
//
// setBlock must rebuild the EDITED chunk immediately (instant feedback on the
// block you broke or placed), but only once a frame — and border edits owe the
// neighbour a rebuild via a dedup'd queue (world.remeshQueue) that update()
// drains at a small budget, so mining a seam or felling a tree can't rebuild
// half t' parish in one frame.
//
// Asserts:
//   (a) a mid-chunk edit rebuilds only that chunk, immediately;
//   (b) a border edit rebuilds the edited chunk immediately and QUEUES the
//       neighbour (not rebuilt yet);
//   (c) after enough update() ticks the queued neighbour rebuilds (once);
//   (d) 20 edits along a border queue each chunk at most once per drain cycle;
//   (e) a key for an unloaded chunk falls off the queue without a murmur.
//
// Headless three.js builds fine (we never render); the one non-pure dep is
// the material atlas, satisfied by stubbing document before import.
//
// Run: node scripts/verify-remesh.mjs

// --- stub document BEFORE any import that touches the texture atlas ---------
global.document = {
  createElement: (tag) => {
    if (tag !== 'canvas') return {};
    const ctx2d = { clearRect: () => {}, fillRect: () => {}, drawImage: () => {}, fillStyle: '' };
    return { width: 0, height: 0, getContext: () => ctx2d };
  },
};

import { strSeed } from '../src/noise.js';
import { B, CHUNK, HEIGHT } from '../src/defs.js';
import { initMaterials } from '../src/mesher.js';
import { World } from '../src/world.js';

initMaterials();

let failed = false;
const ok  = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// --- build a real world, small render ring, and spy on remesh ---------------
const scene = { add() {}, remove() {} };
const world = new World(scene, strSeed('remesh-arena'));
world.renderDist = 1; // keep the streamed ring small so setup settles fast

let log = []; // every remesh, as "cx,cz", in order
world.remesh = function (c) {
  log.push(c.cx + ',' + c.cz);
  return World.prototype.remesh.call(this, c);
};

const PX = CHUNK / 2, PZ = CHUNK / 2;             // player mid-chunk (0,0)
const tick = (n = 1) => { for (let i = 0; i < n; i++) world.update(PX, PZ); };
const count = k => log.filter(x => x === k).length;
// first air cell above ground in a column — somewhere a placed stone "changes" things
const airY = (x, z) => {
  let y = HEIGHT - 2;
  while (y > 1 && world.getBlock(x, y - 1, z) === B.AIR) y--;
  return y;
};

// settle: stream + mesh the 3x3 around the player until nowt's left dirty
let settle = 0;
const settled = () => {
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const c = world.chunkAt(dx, dz);
    if (!c || !c.meshes || c.dirty) return false;
  }
  return true;
};
while (!settled() && settle < 400) { tick(); settle++; }

console.log('\n-- amortised chunk-remesh queue --\n');
(settled() ? ok : bad)(`world settled: 3x3 meshed and clean in ${settle} ticks`);

// --- (a) mid-chunk edit: only the edited chunk, immediately -----------------
tick(); // fresh frame, stale stamps
log = [];
world.setBlock(PX, airY(PX, PZ), PZ, B.STONE);
(log.length === 1 && log[0] === '0,0'
  ? ok : bad)(`mid-chunk edit rebuilds only the edited chunk, immediately (rebuilt [${log}])`);
(world.remeshQueue.size === 0 ? ok : bad)(`mid-chunk edit queues nowt (queue size ${world.remeshQueue.size})`);

// --- (b) border edit: edited chunk now, neighbour queued not rebuilt --------
tick();
log = [];
world.setBlock(0, airY(0, PZ), PZ, B.STONE); // lx=0 border of chunk (0,0) -> neighbour (-1,0)
(log.length === 1 && log[0] === '0,0'
  ? ok : bad)(`border edit rebuilt [${log}] immediately — want exactly ['0,0']`);
(world.remeshQueue.has('-1,0') ? ok : bad)('border edit queued the neighbour (-1,0)');
(world.chunkAt(-1, 0).dirty === true && count('-1,0') === 0
  ? ok : bad)('the neighbour is dirty but NOT rebuilt yet');

// --- (c) the queued neighbour rebuilds on later update() ticks --------------
let drained = 0;
while (count('-1,0') === 0 && drained < 10) { tick(); drained++; }
(count('-1,0') === 1 ? ok : bad)(`neighbour rebuilt after ${drained} tick(s), exactly once (got ${count('-1,0')})`);
(!world.remeshQueue.has('-1,0') && !world.chunkAt(-1, 0).dirty
  ? ok : bad)('neighbour left the queue clean');

// --- (d) a 20-edit burst along the border: no duplicate queueing ------------
tick();
log = [];
for (let i = 0; i < 20; i++) {
  const z = 1 + (i % 14);                        // stay off the z borders
  const y = airY(0, z) + Math.floor(i / 14);     // second storey for edits 15-20
  world.setBlock(0, y, z, B.STONE);
}
(count('0,0') === 1 ? ok : bad)(`burst of 20 edits rebuilt the edited chunk once, not 20 times (got ${count('0,0')})`);
(world.remeshQueue.size === 2 && world.remeshQueue.has('-1,0') && world.remeshQueue.has('0,0')
  ? ok : bad)(`queue holds each chunk at most once: {${[...world.remeshQueue]}} — want {-1,0 and 0,0}`);
log = [];
tick(4); // plenty of budget to drain the pair
(count('-1,0') === 1 && count('0,0') === 1
  ? ok : bad)(`drain rebuilt each queued chunk exactly once (got 0,0 x${count('0,0')}, -1,0 x${count('-1,0')})`);
(world.remeshQueue.size === 0 ? ok : bad)('queue empty after the drain');

// --- (e) an unloaded chunk queued is skipped safely --------------------------
world.remeshQueue.add('99,99'); // no such chunk loaded
log = [];
try {
  tick();
  (!world.remeshQueue.has('99,99') && count('99,99') === 0
    ? ok : bad)('unloaded queued chunk dropped from the queue, never rebuilt');
} catch (e) {
  bad('update() threw on an unloaded queued chunk: ' + e.message);
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
