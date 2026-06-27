// Gameplay-invariant checks — run wi':  node scripts/verify-invariants.mjs
//
// Unlike the other verify scripts (which check construction/seed facts), this one
// asserts SPATIAL gameplay invariants over the real simulation — the class of bug
// the headless suite couldn't see before (e.g. a tame sheep walking on a river).
//
// Two layers:
//   1. the pure invariant catalogue (src/invariants.js) — unit-tested here, and
//      reused live by moorstead.debug.audit().
//   2. an integration repro: build a real World, carve a beck, set a tame beast
//      wandering at it, step the REAL Entities.updateMobs, and assert no beast
//      ends up standing on water.
import * as THREE from 'three';
import { strSeed } from '../src/noise.js';
import { B, WATER_LEVEL, HEIGHT } from '../src/defs.js';
import { mobOverWater, auditMobs } from '../src/invariants.js';
import { World } from '../src/world.js';
import { Entities } from '../src/entities.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// ---------------------------------------------------------------------------
// 1. pure invariant: mobOverWater
// ---------------------------------------------------------------------------
console.log('== mobOverWater (pure) ==');
{
  // a stub world: solid stone everywhere except a water column at x=10
  const world = {
    getBlock(x, y, z) {
      if (y > WATER_LEVEL) return B.AIR;
      if (x === 10) return y === WATER_LEVEL ? B.WATER : B.STONE; // beck: water on top
      return B.STONE;
    },
  };
  const sheepOnLand = { type: 'sheep', t: {}, pos: { x: 5.5, y: WATER_LEVEL + 1, z: 0.5 } };
  const sheepOnWater = { type: 'sheep', t: {}, pos: { x: 10.5, y: WATER_LEVEL + 1, z: 0.5 } };
  const duckOnWater = { type: 'duck', t: { fly: true }, pos: { x: 10.5, y: WATER_LEVEL + 1, z: 0.5 } };

  (mobOverWater(world, sheepOnLand) === null ? ok : bad)('a sheep on dry land is not flagged');
  (mobOverWater(world, sheepOnWater) ? ok : bad)('a sheep standing over a water column IS flagged');
  (mobOverWater(world, duckOnWater) === null ? ok : bad)('a flier (duck) over water is not flagged (it belongs there)');

  const v = auditMobs(world, [sheepOnLand, sheepOnWater, duckOnWater]);
  (v.length === 1 && v[0].kind === 'mob-over-water' ? ok : bad)(`auditMobs returns exactly the one real violation (got ${v.length})`);
}

// ---------------------------------------------------------------------------
// 2. integration: a TAME beast must not walk onto water (real updateMobs)
// ---------------------------------------------------------------------------
// Builds a real World, flattens a test arena with a 3-wide beck, sets a tame
// sheep following the player across it, and steps the REAL Entities.updateMobs.
// On the buggy code (water-wall gated `!mob.owner`) the owned sheep crosses the
// beck and stands on water; once the wall applies to owned beasts it is held at
// the bank.
console.log('\n== tame beast must not walk on water (real updateMobs) ==');
{
  const GY = 50;                 // a flat arena floor, clear of terrain
  const z0 = 8, wx = 8;          // beck centred on x=wx, the sheep crosses west
  const isBeck = x => x >= wx - 1 && x <= wx + 1;   // 3-wide water strip

  // returns the over-water count seen for one sheep crossing, given owner flag.
  // `bridge` lays a plank deck across the beck in the sheep's row (a legitimate
  // crossing the wall must NOT block).
  function runCrossing(owner, bridge = false) {
    const scene = { add() {}, remove() {} };
    const world = new World(scene, strSeed('invariant-arena'));
    for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) world.ensureChunk(cx, cz);
    // flatten a strip and carve the beck
    for (let x = wx - 6; x <= wx + 4; x++) {
      for (let z = z0 - 1; z <= z0 + 1; z++) {
        for (let y = GY + 1; y <= GY + 6; y++) world.setBlock(x, y, z, B.AIR);
        const deck = bridge && isBeck(x) && z === z0 ? B.PLANKS : (isBeck(x) ? B.WATER : B.STONE);
        world.setBlock(x, GY, z, deck);
        world.setBlock(x, GY - 1, z, B.STONE);
      }
    }
    const ents = new Entities(scene, world);
    ents.spawnTimer = 1e9;       // no ambient spawns during the test
    const sheep = ents.spawnMob('sheep', wx + 2.5, GY + 1, z0 + 0.5);
    sheep.owner = owner;         // a tame beast
    ents.mobs = [sheep];         // isolate: just our sheep
    const player = {
      pos: { x: wx - 3.5, y: GY + 1, z: z0 + 0.5 }, dead: false, creative: false,
      heldItem: () => null, countItem: () => 0, damage() {},
    };
    let overWater = 0;
    for (let i = 0; i < 240; i++) {            // ~12s at dt=0.05
      ents.updateMobs(0.05, player, false, null);
      if (mobOverWater(world, sheep)) overWater++;
    }
    return { overWater, finalX: sheep.pos.x };
  }

  const wild = runCrossing(false);
  (wild.overWater === 0 ? ok : bad)(`a WILD sheep is held at the bank, never on water (over-water ticks: ${wild.overWater})`);

  const tame = runCrossing(true);
  (tame.overWater === 0 ? ok : bad)(`a TAME sheep is held at the bank, never on water (over-water ticks: ${tame.overWater})`);

  // the fix must not over-correct: a tame sheep CAN still cross a plank bridge
  const bridged = runCrossing(true, true);
  (bridged.overWater === 0 ? ok : bad)(`a TAME sheep on a plank bridge is never on water (over-water ticks: ${bridged.overWater})`);
  (bridged.finalX < wx - 1 ? ok : bad)(`a TAME sheep still CROSSES a plank bridge to the far bank (final x: ${bridged.finalX.toFixed(1)}, want < ${wx - 1})`);
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
