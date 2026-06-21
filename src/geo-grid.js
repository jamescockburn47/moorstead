// Pure geography maths shared by MoorsGeography (JS) and the relay mirror (Python
// port lives in deploy/world/geo_grid.py — keep the two in lockstep). No deps.

// Grid coords: gx in [0..cols-1] east, gz in [0..rows-1] south-from-north (row 0 = north).
export function bilinear(grid, gx, gz) {
  const { cols, rows, metres } = grid;
  const cx = Math.max(0, Math.min(cols - 1, gx));
  const cz = Math.max(0, Math.min(rows - 1, gz));
  const x0 = Math.floor(cx), z0 = Math.floor(cz);
  const x1 = Math.min(cols - 1, x0 + 1), z1 = Math.min(rows - 1, z0 + 1);
  const fx = cx - x0, fz = cz - z0;
  const at = (x, z) => metres[z * cols + x];
  const top = at(x0, z0) + (at(x1, z0) - at(x0, z0)) * fx;
  const bot = at(x0, z1) + (at(x1, z1) - at(x0, z1)) * fx;
  return top + (bot - top) * fz;
}

// shortest distance from (px,pz) to segment (ax,az)->(bx,bz)
export function pointToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const L2 = dx * dx + dz * dz || 1e-9;
  let t = ((px - ax) * dx + (pz - az) * dz) / L2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

// nearest distance from (px,pz) to a polyline (array of [x,z])
export function pointToPolyline(px, pz, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = pointToSegment(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (d < best) best = d;
  }
  return best;
}

// block coords -> grid coords, given the data transform
export function blockToGrid(transform, grid, bx, bz) {
  const { minE, minN, maxE, maxN, metresPerBlock } = transform;
  const E = minE + bz * metresPerBlock;   // +z = east
  const N = minN + bx * metresPerBlock;   // +x = north
  const gx = (E - minE) / (maxE - minE) * (grid.cols - 1);   // grid col = easting
  const gz = (maxN - N) / (maxN - minN) * (grid.rows - 1);   // grid row = northing (row 0 = north)
  return [gx, gz];
}
