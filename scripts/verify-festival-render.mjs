// verify-festival-render.mjs — headless RENDER smoke-test for all 6 festival
// builders. Each builder is called against a mock ctx and asserted to:
//   (a) not throw
//   (b) push >= 1 object into ctx.objects
//
// three.js scene-graph builds fine under Node (no GL context needed — we never
// render). The ONE non-pure dependency is getMaterials() in mesher.js (called
// inside festivalKit's addBillboard/addWindowGlow). We satisfy it by stubbing
// global.document before any import so initMaterials() can run without a real
// canvas or WebGL context.
//
// Run: node scripts/verify-festival-render.mjs

// --- stub document BEFORE any import that may trigger initMaterials ----------
// textures.js/mesher.js call document.createElement('canvas') inside
// initMaterials()/buildAtlas(). A minimal stub is enough: the geometry + UV
// math is all pure; only the CanvasTexture constructor needs a canvas object,
// and it never renders headlessly.
global.document = {
  createElement: (tag) => {
    if (tag !== 'canvas') return {};
    const ctx2d = {
      clearRect: () => {},
      fillRect:  () => {},
      drawImage: () => {},
      fillStyle: '',
    };
    return { width: 0, height: 0, getContext: () => ctx2d };
  },
};

// --- imports (after stub) ----------------------------------------------------
import * as THREE from 'three';
import { initMaterials }  from '../src/mesher.js';
import { B }              from '../src/defs.js';
import { seasonStateAtPhase } from '../src/season.js';
import { FESTIVALS }          from '../src/festivals.js';

import { buildChristmas } from '../src/festivals/christmas.js';
import { buildBonfire }   from '../src/festivals/bonfire.js';
import { buildHarvest }   from '../src/festivals/harvest.js';
import { buildEaster }    from '../src/festivals/easter.js';
import { buildMayDay }    from '../src/festivals/mayday.js';
import { buildMidsummer } from '../src/festivals/midsummer.js';

// Initialise the shared materials (opaque/cutout/liquid) so getMaterials() is
// non-null when the builders call festivalKit helpers.
initMaterials();

// --- test harness ------------------------------------------------------------
let failed = false;
const ok  = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// --- mock world + gen --------------------------------------------------------
// Village layout: one village centred at (cx, cz).
// Buildings: a chapel, a farmhouse, two cottages — enough to exercise all the
// chapel/wreath/parlour-tree/window-glow paths in christmas.js and harvest.js.
// Positions are chosen so the chapel forecourt scan (dz=2..5 south of chapel.z0)
// will find at least one open non-building cell.

const CX = 100, CZ = 100;  // village + player centre

// Chapel: 6 wide × 4 deep, centred on CX, positioned so z0=CZ-10
const CHAPEL = { type: 'chapel',    x0: CX-3, x1: CX+3, z0: CZ-10, z1: CZ-6,  g: 32 };
// Farmhouse: offset west
const FARM   = { type: 'farmhouse', x0: CX-12, x1: CX-7, z0: CZ-5, z1: CZ,    g: 32 };
// Two cottages
const COT1   = { type: 'cottage',   x0: CX+5,  x1: CX+8, z0: CZ-5, z1: CZ-2,  g: 32 };
const COT2   = { type: 'cottage',   x0: CX-6,  x1: CX-3, z0: CZ+4, z1: CZ+7,  g: 32 };

const VILLAGE = { x: CX, z: CZ, buildings: [CHAPEL, FARM, COT1, COT2] };

// gen.geo.villageColumn(x, z): returns the cell kind used by placement scans.
// Building footprint cells → 'building'; a ring of cells near village centre
// → 'green' so every scan (r=2..10) can find open ground.
function villageColumn(x, z) {
  // Building footprint check
  for (const b of VILLAGE.buildings) {
    if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) {
      return { kind: 'building' };
    }
  }
  // Return 'green' for cells within r=12 of the village centre (generous window
  // that covers the placement scans r=2..10 used by all builders).
  const dist = Math.max(Math.abs(x - CX), Math.abs(z - CZ));
  if (dist <= 12) return { kind: 'green' };
  return null; // outside the village area — no special column
}

// gen.height: a constant 32 everywhere (flat moor — enough for all builders).
// Midsummer needs local maxima, so we add a synthetic hill well outside the
// village exclusion radius (VILLAGE_EXCL = 32 blocks):
//   hill centre at (CX + 50, CZ + 50), height 50.
//   Cardinal neighbours at 16-block grid step: height 32.
// This satisfies: h(hill) - min(neighbours) = 50 - 32 = 18 >= SUMMIT_RISE(4).
// Distance from village: hypot(50,50) ≈ 70 > VILLAGE_EXCL(32). ✓
function mockHeight(x, z) {
  const hx = CX + 50, hz = CZ + 50;
  if (x === hx && z === hz) return 50;
  return 32;
}

// world.getBlock: always AIR (open ground everywhere).
const mockWorld = {
  getBlock: (_x, _y, _z) => B.AIR,  // B.AIR = 0
  snowmanLedger: new Map(),
  gen: null,  // filled in below after gen is defined
};

const mockGen = {
  height: mockHeight,
  geo: {
    villages: [VILLAGE],
    villageColumn,
    seed: 0xdeadbeef,
  },
};

// Cross-reference so christmas.js chapelFirPlacement can access world.gen
mockWorld.gen = mockGen;

// --- builder registry --------------------------------------------------------
// Map festival id → { builder, yearPhase } so we can run each with the
// season it would naturally be called in (not strictly required for logic, but
// keeps the mock semantically honest).
const FESTIVAL_YEARPHASE = {
  yule:      0.88,   // deep winter / Christmastide
  bonfire:   0.60,   // early November
  harvest:   0.57,   // Michaelmas / September
  easter:    0.18,   // Eastertide / spring
  mayday:    0.25,   // May Day
  midsummer: 0.37,   // Midsummer / St John's Eve
};

const BUILDERS = {
  yule:      buildChristmas,
  bonfire:   buildBonfire,
  harvest:   buildHarvest,
  easter:    buildEaster,
  mayday:    buildMayDay,
  midsummer: buildMidsummer,
};

// --- run each builder --------------------------------------------------------
console.log('\n-- Festival builder render smoke-test --\n');

for (const { id } of FESTIVALS) {
  const builder = BUILDERS[id];
  if (!builder) {
    bad(`${id}: no builder registered (check BUILDERS map above)`);
    continue;
  }

  const scene   = new THREE.Scene();
  const objects = [];
  const lit     = [];
  const robins  = [];
  const yearPhase = FESTIVAL_YEARPHASE[id] ?? 0.5;
  const season  = seasonStateAtPhase(yearPhase);

  const ctx = {
    scene,
    world:     mockWorld,
    gen:       mockGen,
    cx:        CX,
    cz:        CZ,
    season,
    snowAccum: 1,   // full snow cover → exercises deep-snow paths (christmas)
    objects,
    lit,
    robins,
  };

  let threw = null;
  try {
    builder(ctx);
  } catch (e) {
    threw = e;
  }

  if (threw) {
    bad(`${id}: builder threw — ${threw.message}`);
    console.log('         ' + threw.stack.split('\n').slice(0, 3).join('\n         '));
  } else {
    ok(`${id}: builder ran without throwing`);
  }

  if (!threw) {
    if (objects.length >= 1) {
      ok(`${id}: pushed ${objects.length} object(s) into ctx.objects`);
    } else {
      bad(`${id}: ctx.objects is empty after build (expected >= 1)`);
    }
  }
}

// --- cross-check: FESTIVALS calendar covers all 6 ids -----------------------
console.log('\n-- Calendar / builder parity --\n');
const EXPECTED = ['easter', 'mayday', 'midsummer', 'harvest', 'bonfire', 'yule'];
const calIds = FESTIVALS.map(f => f.id);
for (const id of EXPECTED) {
  (calIds.includes(id) ? ok : bad)(`FESTIVALS calendar contains '${id}'`);
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
