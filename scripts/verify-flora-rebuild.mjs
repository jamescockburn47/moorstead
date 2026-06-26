// verify-flora-rebuild.mjs — guards the frame-sliced FloraLayer rebuild.
//
// The walk-stutter fix spreads the heavy 81×81 cell scan over several frames
// instead of one. This test asserts the slicer is BOTH:
//   (a) correct  — the sliced rebuild lands the exact same instances as the
//                  old synchronous build (no flora gained or lost), and
//   (b) amortised — it takes more than one frame and doesn't materialise the
//                   overlay on the frame the rebuild is triggered.
//
// Headless three.js builds fine (we never render); the one non-pure dep is
// getMaterials() (cutout material), satisfied by stubbing document before import.
//
// Run: node scripts/verify-flora-rebuild.mjs

// --- stub document BEFORE any import that triggers initMaterials -------------
global.document = {
  createElement: (tag) => {
    if (tag !== 'canvas') return {};
    const ctx2d = { clearRect: () => {}, fillRect: () => {}, drawImage: () => {}, fillStyle: '' };
    return { width: 0, height: 0, getContext: () => ctx2d };
  },
};

import * as THREE from 'three';
import { initMaterials } from '../src/mesher.js';
import { B } from '../src/defs.js';
import { seasonStateAtPhase } from '../src/season.js';
import { FloraLayer } from '../src/floraLayer.js';

initMaterials();

let failed = false;
const ok  = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// --- mock world: flat open moor grass everywhere, no rail/road/village -------
const SURF = 32;
const mockWorld = {
  getBlock: (_x, y, _z) => (y === SURF ? B.GRASS : B.AIR), // grass top, air above
  isForaged: () => false,
  gen: {
    seed: 0x9e3779b9,
    height: () => SURF,
    geo: {
      railInfo: () => null,
      roadInfo: () => null,
      inVillage: () => false,
    },
  },
};

const totalInstances = layer => layer.meshes.reduce((n, m) => n + m.count, 0);

// Summer — wildflowers scatter on open grass, so the overlay is non-trivial.
const season = seasonStateAtPhase(0.40);

console.log('\n-- FloraLayer sliced-rebuild --\n');

// --- (1) synchronous build: the reference instance count ---------------------
const sync = new FloraLayer(new THREE.Scene(), mockWorld);
sync.build(0, 0, season);
const refCount = totalInstances(sync);
(refCount > 0 ? ok : bad)(`synchronous build placed flora (${refCount} instances)`);

// --- (2) sliced build via update(): same result, spread over frames ----------
const sliced = new FloraLayer(new THREE.Scene(), mockWorld);
const pos = { x: 0, y: SURF + 1, z: 0 };

// First update with a big dt trips the 0.4s check timer and STARTS the rebuild.
sliced.update(1.0, pos, season);
(sliced.meshes.length === 0 && sliced._pending
  ? ok : bad)('rebuild does not materialise on the trigger frame (it is deferred)');

// Drive the in-flight build to completion; dt=0 keeps the check timer asleep so
// each call only advances the slice.
let frames = 1;
while (sliced._pending) { sliced.update(0, pos, season); frames++; }

(frames > 1 ? ok : bad)(`rebuild amortised across multiple frames (${frames} frames)`);

const slicedCount = totalInstances(sliced);
(slicedCount === refCount
  ? ok : bad)(`sliced build matches synchronous build (${slicedCount} vs ${refCount})`);

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
