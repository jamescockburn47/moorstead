// verify-inn-protection.mjs — inn shells refuse player edits, locally and via relay.
//
// Tavern spec: "Indestructible, both shells" — an inn's protected box (walls, roof,
// underground parlour) must reject every setBlock, place or break, at any y, and
// the relay 'edit' handler must skip its netEdits bookkeeping too — not just be
// blocked downstream by setBlock — so a rejected edit can't be replayed into a
// freshly-generated chunk by ensureChunk's netEdits pass.
//
// Run: node scripts/verify-inn-protection.mjs

// --- stub document BEFORE any import that touches the texture atlas ---------
global.document = {
  createElement: (tag) => {
    if (tag !== 'canvas') return {};
    const ctx2d = { clearRect: () => {}, fillRect: () => {}, drawImage: () => {}, fillStyle: '' };
    return { width: 0, height: 0, getContext: () => ctx2d };
  },
};
// multiplayer.js reads location.hostname at module load to pick the relay URL
global.location = { hostname: 'verify-headless' };

import { initMaterials } from '../src/mesher.js';
import { World } from '../src/world.js';
import { B } from '../src/defs.js';

initMaterials();

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

console.log('\n-- inn shell edit protection --\n');

const scene = { add() {}, remove() {} };
const world = new World(scene, 12345, new Map());
const plan = world.gen.inns.get('Grosmont');
(plan ? ok : bad)('Grosmont inn plan exists on the World’s Gen instance');

if (plan) {
  const { x0, z0 } = plan.protectedBox;
  const cx = Math.floor(x0 / 16), cz = Math.floor(z0 / 16);
  world.ensureChunk(cx, cz); // load the chunk so setBlock doesn't early-return on "no chunk"

  // --- a block INSIDE the protected box cannot be placed or broken ---
  const before = world.getBlock(x0, plan.groundY, z0);
  world.setBlock(x0, plan.groundY, z0, B.AIR); // attempted "break"
  (world.getBlock(x0, plan.groundY, z0) === before ? ok : bad)('cannot break a block inside the inn’s protected box');
  const beforeAbove = world.getBlock(x0, plan.groundY + 5, z0);
  world.setBlock(x0, plan.groundY + 5, z0, B.STONE); // attempted "place" into air above the roof
  (world.getBlock(x0, plan.groundY + 5, z0) === beforeAbove ? ok : bad)('cannot place a block inside the inn’s protected box');

  // --- a block just OUTSIDE the box is unaffected (protection isn't over-wide) ---
  const ox = x0 - 3, oz = z0;
  world.ensureChunk(Math.floor(ox / 16), Math.floor(oz / 16));
  world.setBlock(ox, plan.groundY, oz, B.STONE);
  (world.getBlock(ox, plan.groundY, oz) === B.STONE ? ok : bad)('editing 3 blocks outside the protected box still works normally');

  // --- incoming relay 'edit' messages targeting the protected box are ignored ---
  // (defence-in-depth: setBlock already refuses, but the handler must also skip
  // its netEdits bookkeeping so a rejected edit isn't replayed into fresh chunks
  // by ensureChunk's netEdits pass)
  {
    const { Net } = await import('../src/multiplayer.js');
    const fakeGame = {
      world,
      ui: { toast() {}, boardScreen: { className: 'hidden' } },
      state: 'playing',
      sky: { time: 0 },
    };
    const net = new Net(fakeGame);
    const before3 = world.getBlock(x0, plan.groundY, z0);
    net.handle({ type: 'edit', x: x0, y: plan.groundY, z: z0, id: 0 });
    (world.getBlock(x0, plan.groundY, z0) === before3
      ? ok : bad)('relay edit into the protected box left the block unchanged');
    const bookedKey = `${x0},${plan.groundY},${z0}`;
    (!world.netEdits || !world.netEdits.has(bookedKey)
      ? ok : bad)('relay edit into the protected box was NOT booked into netEdits (would replay on regen otherwise)');
  }
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
