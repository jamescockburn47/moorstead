import { B, CHUNK, HEIGHT, isSolid, isBuiltMaterial } from '../defs.js';
import { voxelIndex } from './terrain-overrides.js';

const removals = new WeakMap();
function chunkRemovals(world, cx, cz) {
  let cache = removals.get(world);
  if (cache?.revision !== world.revision) { cache = { revision: world.revision, chunks: new Map() }; removals.set(world, cache); }
  const key = `${cx},${cz}`;
  if (cache.chunks.has(key)) return cache.chunks.get(key);
  const cells = world.overrides.getChunk(cx, cz)?.cells;
  if (!cells) { cache.chunks.set(key, null); return null; }
  const columns = new Uint8Array(CHUNK * CHUNK).fill(HEIGHT);
  for (let i = CHUNK * CHUNK; i < cells.length; i++) if (cells[i] === 1) {
    const column = i % (CHUNK * CHUNK), y = Math.floor(i / (CHUNK * CHUNK));
    if (y < columns[column]) columns[column] = y;
  }
  cache.chunks.set(key, columns);
  return columns;
}

export function columnRemoved(world, x, z, top = HEIGHT - 1) {
  x = Math.floor(x); z = Math.floor(z);
  const columns = chunkRemovals(world, Math.floor(x / CHUNK), Math.floor(z / CHUNK));
  return !!columns && columns[voxelIndex(x, 0, z)] <= Math.min(HEIGHT - 1, Math.floor(top));
}

// Railway geometry spans several columns: sample the entire support footprint so
// an intact centre rail cannot conceal a missing bank, sleeper or bridge support.
export function trackSupported(world, x, z, deck, kind = 'rails') {
  const reach = kind === 'skirt' ? 14 : 3;
  if (!world.overrides.size) return true;
  let touched = false;
  for (let cx = Math.floor((x - reach - 1) / CHUNK); cx <= Math.floor((x + reach + 1) / CHUNK); cx++) {
    for (let cz = Math.floor((z - reach - 1) / CHUNK); cz <= Math.floor((z + reach + 1) / CHUNK); cz++) {
      if (world.overrides.getChunk(cx, cz)) touched = true;
    }
  }
  if (!touched) return true;
  for (let dx = -reach; dx <= reach; dx++) for (let dz = -reach; dz <= reach; dz++) {
    if (columnRemoved(world, Math.round(x) + dx, Math.round(z) + dz, deck)) return false;
  }
  return true;
}

export function roadGround(world, x, z) {
  x = Math.round(x); z = Math.round(z);
  if (!world.isLoaded(x, z)) return null;
  const original = world.gen.height(x, z);
  if (columnRemoved(world, x, z, original)) return null;
  for (let y = HEIGHT - 1; y >= 1; y--) {
    const id = world.getBlock(x, y, z);
    if (isBuiltMaterial(id) || id === B.PLANKS || id === B.LOG || id === B.LEAVES) return null;
    if (isSolid(id)) return y + 1;
  }
  return null;
}

export function footprintSupported(world, box) {
  for (let x = Math.floor(box.min.x); x <= Math.floor(box.max.x); x++) {
    for (let z = Math.floor(box.min.z); z <= Math.floor(box.max.z); z++) {
      if (columnRemoved(world, x, z, box.max.y)) return false;
    }
  }
  return true;
}
