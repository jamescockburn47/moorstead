// Herding model check — run wi': node scripts/verify-herding.mjs
import { flockCentroid, driveTarget, dogGoal, allPenned, commandFromKey, FLANK_RADIUS, foldAt, allPennedCells } from '../src/herding.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const near = (got, want, m, eps = 1e-6) => (Math.abs(got - want) < eps ? ok : bad)(`${m} (got ${got})`);

// --- Task 1: flock centroid ---
{
  const c = flockCentroid([{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 1, z: 3 }]);
  near(c.x, 1, 'centroid x is the mean');
  near(c.z, 1, 'centroid z is the mean');
  (flockCentroid([]) === null ? ok : bad)('centroid of an empty flock is null');
}

// --- Task 2: drive target (flock flees the net pressure) ---
{
  const t = driveTarget({ x: 0, z: 0 }, [{ x: -5, z: 0, strength: 1 }]);
  near(t.x, 4, 'flock heads away from a single pressure (+x)');
  near(t.z, 0, 'no sideways drift for an on-axis pressure');
  const s = driveTarget({ x: 0, z: 0 }, [{ x: -5, z: 0, strength: 1 }, { x: 5, z: 0, strength: 1 }]);
  near(s.x, 0, 'balanced pressure leaves the flock put (x)');
  near(s.z, 0, 'balanced pressure leaves the flock put (z)');
  const n = driveTarget({ x: 3, z: 7 }, []);
  (n.x === 3 && n.z === 7 ? ok : bad)('no pressure: target is the centroid');
}

// --- Task 3: dog goal from a whistle command ---
{
  const centroid = { x: 0, z: 0 };
  const dog = { x: 0, z: -FLANK_RADIUS };
  const lie = dogGoal('lie-down', centroid, dog);
  (lie.x === dog.x && lie.z === dog.z ? ok : bad)('lie-down holds the dog where she is');
  const walk = dogGoal('walk-on', centroid, dog);
  (walk.x === centroid.x && walk.z === centroid.z ? ok : bad)('walk-on sends her in to the flock');
  const cb = dogGoal('come-bye', centroid, dog);
  const aw = dogGoal('away', centroid, dog);
  near(Math.hypot(cb.x - centroid.x, cb.z - centroid.z), FLANK_RADIUS, 'come-bye stays on the flank circle');
  near(Math.hypot(aw.x - centroid.x, aw.z - centroid.z), FLANK_RADIUS, 'away stays on the flank circle');
  (Math.sign(cb.x) !== Math.sign(aw.x) ? ok : bad)('come-bye and away flank opposite ways');
}

// --- Task 4: pen check (every head inside the fold footprint) ---
{
  const fold = { x0: 0, z0: 0, x1: 10, z1: 10 };
  (allPenned([{ x: 2, z: 2 }, { x: 8, z: 9 }], fold) === true ? ok : bad)('all inside the fold = penned');
  (allPenned([{ x: 2, z: 2 }, { x: 11, z: 9 }], fold) === false ? ok : bad)('one head outside = not penned');
  (allPenned([], fold) === false ? ok : bad)('an empty flock is not "penned"');
}

// --- Task 5: arrow-key -> whistle command mapping ---
{
  (commandFromKey('ArrowLeft') === 'come-bye' ? ok : bad)('left = come-bye');
  (commandFromKey('ArrowRight') === 'away' ? ok : bad)('right = away');
  (commandFromKey('ArrowUp') === 'walk-on' ? ok : bad)('up = walk-on');
  (commandFromKey('ArrowDown') === 'lie-down' ? ok : bad)('down = lie-down');
  (commandFromKey('KeyW') === null ? ok : bad)('a non-arrow key is no command');
}

// --- Task 6: fence-enclosure fold detection (auto-detect a pen) ---
{
  // a 5x5 fence ring with a 3x3 open interior; the moor outside is open too
  const ring = (x, z) => (x >= 0 && x <= 4 && z >= 0 && z <= 4) && (x === 0 || x === 4 || z === 0 || z === 4);
  const fold = foldAt(2, 2, ring);
  (fold.enclosed === true ? ok : bad)('a closed fence ring reads as an enclosed fold');
  (fold.cells && fold.cells.size === 9 ? ok : bad)(`the fold interior is the 3x3 of open cells (got ${fold.cells && fold.cells.size})`);
  // open the ring at (0,2): the fill escapes to the open moor -> not a fold
  const ringGap = (x, z) => ring(x, z) && !(x === 0 && z === 2);
  (foldAt(2, 2, ringGap).enclosed === false ? ok : bad)('a ring with an open gate is not enclosed');
  // a seed sitting on the fence itself is no interior
  (foldAt(0, 0, ring).enclosed === false ? ok : bad)('a seed on the fence is no fold');
}

// --- Task 7: every head penned within the detected fold cells ---
{
  const ring = (x, z) => (x >= 0 && x <= 4 && z >= 0 && z <= 4) && (x === 0 || x === 4 || z === 0 || z === 4);
  const cells = foldAt(2, 2, ring).cells;
  (allPennedCells([{ x: 1.5, z: 1.2 }, { x: 3.4, z: 2.9 }], cells) === true ? ok : bad)('all heads on fold cells = penned');
  (allPennedCells([{ x: 1.5, z: 1.2 }, { x: 9, z: 9 }], cells) === false ? ok : bad)('a head off the fold cells = not penned');
  (allPennedCells([], cells) === false ? ok : bad)('an empty flock is not penned');
}

console.log('RESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
