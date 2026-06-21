// geo-grid pure maths — run wi': node scripts/verify-geo-grid.mjs
import { bilinear, pointToSegment } from '../src/geo-grid.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

// bilinear over a 2x2 grid (cols=2, rows=2): [[0,10],[20,30]] row-major, row0=north
{
  const grid = { cols: 2, rows: 2, metres: [0, 10, 20, 30] };
  (near(bilinear(grid, 0, 0), 0) ? ok : bad)('corner (0,0) = 0');
  (near(bilinear(grid, 1, 0), 10) ? ok : bad)('corner (1,0) = 10');
  (near(bilinear(grid, 0, 1), 20) ? ok : bad)('corner (0,1) = 20');
  (near(bilinear(grid, 0.5, 0.5), 15) ? ok : bad)('centre = 15');
  (near(bilinear(grid, 5, 5), 30) ? ok : bad)('clamps past the far corner to 30');
}
// point-to-segment distance
{
  (near(pointToSegment(0, 0, -1, 0, 1, 0), 0) ? ok : bad)('on the segment = 0');
  (near(pointToSegment(0, 3, -1, 0, 1, 0), 3) ? ok : bad)('above the midpoint = 3');
  (near(pointToSegment(2, 0, -1, 0, 1, 0), 1) ? ok : bad)('past the end clamps to the endpoint');
}

console.log(failed ? '\nGEO-GRID: FAIL' : '\nGEO-GRID: all good');
process.exit(failed ? 1 : 0);
