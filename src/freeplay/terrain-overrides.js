import { CHUNK, HEIGHT } from '../defs.js';

const VOLUME = CHUNK * CHUNK * HEIGHT;
const TOMBSTONE = 257;
const decode = value => value === TOMBSTONE ? null : value - 1;
export function voxelIndex(x, y, z) {
  return ((x % CHUNK + CHUNK) % CHUNK) + ((z % CHUNK + CHUNK) % CHUNK) * CHUNK + y * CHUNK * CHUNK;
}

// Map-compatible externally, compact id+1 arrays internally (zero means procedural).
// A whole village crater costs one Uint16 per voxel, not two maps of cell strings.
export class OverrideStore {
  constructor(entries = []) {
    this.chunks = new Map(); this.size = 0;
    for (const [key, value] of entries) this.set(key, value);
  }
  getChunk(cx, cz) { return this.chunks.get(`${cx},${cz}`); }
  getCell(x, y, z) {
    const row = this.getChunk(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
    const value = row?.cells[voxelIndex(x, y, z)];
    return value ? decode(value) : undefined;
  }
  setCell(x, y, z, id) {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK), key = `${cx},${cz}`;
    let row = this.chunks.get(key);
    if (!row) { row = { cx, cz, count: 0, cells: new Uint16Array(VOLUME) }; this.chunks.set(key, row); }
    const i = voxelIndex(x, y, z);
    if (!row.cells[i]) { row.count++; this.size++; }
    row.cells[i] = id === null ? TOMBSTONE : id + 1;
    return this;
  }
  deleteCell(x, y, z) {
    const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`, row = this.chunks.get(key);
    const i = voxelIndex(x, y, z);
    if (!row?.cells[i]) return false;
    row.cells[i] = 0; row.count--; this.size--;
    if (!row.count) this.chunks.delete(key);
    return true;
  }
  set(key, value) { return this.setCell(...key.split(',').map(Number), value); }
  get(key) { return this.getCell(...key.split(',').map(Number)); }
  has(key) { return this.get(key) !== undefined; }
  delete(key) { return this.deleteCell(...key.split(',').map(Number)); }
  clear() { this.chunks.clear(); this.size = 0; }
  *entries() {
    for (const [x, y, z, value] of this.cells()) yield [`${x},${y},${z}`, value];
  }
  *cells() {
    for (const { cx, cz, cells } of this.chunks.values()) for (let i = 0; i < cells.length; i++) {
      if (!cells[i]) continue;
      const y = Math.floor(i / (CHUNK * CHUNK)), rem = i % (CHUNK * CHUNK);
      yield [cx * CHUNK + rem % CHUNK, y, cz * CHUNK + Math.floor(rem / CHUNK), decode(cells[i])];
    }
  }
  *keys() { for (const [key] of this.entries()) yield key; }
  *values() { for (const [, value] of this.entries()) yield value; }
  [Symbol.iterator]() { return this.entries(); }
}
