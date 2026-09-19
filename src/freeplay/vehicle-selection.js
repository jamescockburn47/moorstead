import { VEHICLE_CORE, MAX_VEHICLE_CELLS, selectVehicleCells } from './vehicle-data.js';

const NEIGHBOURS = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
// The server converts a bounding box: refuse disconnected extras inside it.
export function connectedVehicleCells(world, core) {
  if (!Array.isArray(core) || core.length !== 3 || !core.every(Number.isSafeInteger)
    || world.overrides.getCell(...core) !== VEHICLE_CORE) throw Error('Place a Vehicle control block on your build first.');
  const queue = [[...core]], seen = new Set([core.join(',')]), cells = [], from = [...core], to = [...core];
  for (let index = 0; index < queue.length; index++) {
    const point = queue[index], [x,y,z] = point;
    const id = world.overrides.getCell(x,y,z); if (!(id > 0)) continue;
    if (!world.isLoaded(x,z)) throw Error('Go closer and wait for the whole build to load.');
    cells.push([...point,id]);
    if (cells.length > MAX_VEHICLE_CELLS) throw Error('This is connected to more than 512 placed blocks. Separate the vehicle from the larger build.');
    for (let axis = 0; axis < 3; axis++) { from[axis] = Math.min(from[axis],point[axis]); to[axis] = Math.max(to[axis],point[axis]); }
    if (to.some((n,i) => n - from[i] + 1 > [16,12,16][i])) throw Error('This connected build is too large. Keep a vehicle within 16 × 12 × 16 blocks.');
    for (const [dx,dy,dz] of NEIGHBOURS) {
      const next = [x+dx,y+dy,z+dz];
      if (next[1] < 1 || next[1] > 63 || Math.abs(next[0]) > 8192 || Math.abs(next[2]) > 8192) continue;
      const key = next.join(','); if (!seen.has(key)) { seen.add(key); queue.push(next); }
    }
  }
  const selected = selectVehicleCells(world,from,to,core);
  if (selected.cells.length !== cells.length) throw Error('Separate blocks sit inside this build’s outline. Move them away or choose the corners manually.');
  return selected;
}
