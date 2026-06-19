// herding.js — the pure herding maths (no THREE, no DOM), unit-tested headless via
// scripts/verify-herding.mjs. The flock model is SCRIPTED for v1 (a centroid + a single
// drive-target nudged away from pressure) and lives behind the pressure -> target contract
// (driveTarget), so it can be swapped for an emergent per-sheep model later without
// touching the dog commands, the pen check, or any caller.

export const DRIVE_DISTANCE = 4; // blocks the flock heads, away from the net pressure
export const FLANK_RADIUS = 6;   // radius the dog works at, circling the flock
export const FLANK_STEP = 0.9;   // radians the dog advances around the flock per flank command
export const FOLD_MAX_CELLS = 600; // a fold whose interior exceeds this reads as "open" (not enclosed)

// The mean position of the flock. positions: [{x,z}, ...]. null for an empty flock.
export function flockCentroid(positions) {
  if (!positions.length) return null;
  let x = 0, z = 0;
  for (const p of positions) { x += p.x; z += p.z; }
  return { x: x / positions.length, z: z / positions.length };
}

// Where a flock heads under pressure: directly away from the net of all pressure sources,
// DRIVE_DISTANCE blocks from the centroid. pressures: [{x,z,strength}]. Closer pressures
// push harder (weight = strength / distance). No pressure -> the centroid (graze in place).
// This IS the scripted pressure -> target contract; an emergent model would replace only this.
export function driveTarget(centroid, pressures, drive = DRIVE_DISTANCE) {
  let dx = 0, dz = 0;
  for (const p of pressures) {
    const ax = centroid.x - p.x, az = centroid.z - p.z;
    const d = Math.hypot(ax, az) || 1;
    const w = (p.strength || 1) / d;
    dx += (ax / d) * w; dz += (az / d) * w;
  }
  const m = Math.hypot(dx, dz);
  if (m < 1e-6) return { x: centroid.x, z: centroid.z };
  return { x: centroid.x + (dx / m) * drive, z: centroid.z + (dz / m) * drive };
}

// Where the dog should move for a whistle command, given the flock centroid and her own
// position. walk-on presses straight in; lie-down holds; come-bye / away flank the flock in
// opposite directions around a circle of FLANK_RADIUS (the sign is a tuning choice — the
// point is they're opposite).
export function dogGoal(command, centroid, dogPos, flankRadius = FLANK_RADIUS) {
  if (command === 'lie-down') return { x: dogPos.x, z: dogPos.z };
  if (command === 'walk-on') return { x: centroid.x, z: centroid.z };
  const ang = Math.atan2(dogPos.z - centroid.z, dogPos.x - centroid.x);
  const step = command === 'come-bye' ? FLANK_STEP : -FLANK_STEP;
  const a = ang + step;
  return { x: centroid.x + Math.cos(a) * flankRadius, z: centroid.z + Math.sin(a) * flankRadius };
}

// True when every head is inside the fold footprint. fold: {x0,z0,x1,z1} (a rectangle in
// world coords). Zone-based on purpose — simpler and more robust than true geometric
// containment, while the fence blocks still physically hold the flock. Empty flock = false.
export function allPenned(positions, fold) {
  if (!positions.length) return false;
  return positions.every(p => p.x >= fold.x0 && p.x <= fold.x1 && p.z >= fold.z0 && p.z <= fold.z1);
}

// Auto-detect a fold the player has fenced. Flood-fill the open cells from a seed; a cell is
// open when isFence(x,z) is false. If fences bound the fill within maxCells, it's an enclosed
// fold and we return its interior cell-set (keys "x,z") and bounding box; if the fill escapes
// (an open gate, or no enclosure) it blows past the cap and reads as NOT enclosed. The cap is
// both the size limit and the enclosure test, so detection is bounded and can't run away.
export function foldAt(seedX, seedZ, isFence, maxCells = FOLD_MAX_CELLS) {
  seedX = Math.floor(seedX); seedZ = Math.floor(seedZ);
  if (isFence(seedX, seedZ)) return { enclosed: false, cells: null, bounds: null };
  const cells = new Set([seedX + ',' + seedZ]);
  const queue = [[seedX, seedZ]];
  let x0 = seedX, z0 = seedZ, x1 = seedX, z1 = seedZ;
  while (queue.length) {
    const [x, z] = queue.pop();
    for (const [nx, nz] of [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]]) {
      const key = nx + ',' + nz;
      if (cells.has(key) || isFence(nx, nz)) continue;
      cells.add(key);
      if (cells.size > maxCells) return { enclosed: false, cells: null, bounds: null };
      queue.push([nx, nz]);
      if (nx < x0) x0 = nx; if (nx > x1) x1 = nx; if (nz < z0) z0 = nz; if (nz > z1) z1 = nz;
    }
  }
  return { enclosed: true, cells, bounds: { x0, z0, x1, z1 } };
}

// True when every head stands on a cell of a detected fold (the precise check for an
// arbitrary-shaped pen, vs allPenned's rectangle). cells: the Set from foldAt. Empty = false.
export function allPennedCells(positions, cells) {
  if (!positions.length || !cells) return false;
  return positions.every(p => cells.has(Math.floor(p.x) + ',' + Math.floor(p.z)));
}

// Map an arrow-key code to a whistle command (the player's own WASD movement is untouched).
export function commandFromKey(code) {
  switch (code) {
    case 'ArrowLeft': return 'come-bye';
    case 'ArrowRight': return 'away';
    case 'ArrowUp': return 'walk-on';
    case 'ArrowDown': return 'lie-down';
    default: return null;
  }
}
