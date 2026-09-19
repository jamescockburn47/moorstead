// The private sandbox overlays immutable procedural terrain; ordinary World is unchanged.
import { World } from '../world.js';
import { B, BLOCKS, CHUNK, HEIGHT, isSolid } from '../defs.js';
import { disposeChunkMeshes } from '../mesher.js';
import { OverrideStore, voxelIndex as index } from './terrain-overrides.js';
import { registerFutureBlocks } from './future-blocks.js';

const chunkKey = (x, z) => `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
const light = id => id === B.LANTERN || id === B.TORCH || id === B.SAFETY_LAMP;
const clock = () => performance.now();

export class FreeplayWorld extends World {
  constructor(scene, seed, overrides = new Map()) {
    super(scene, seed);
    registerFutureBlocks();
    this.overrides = new OverrideStore();
    this.baselines = new Map();
    this.editQueue = [];
    this.revision = 0;
    this.renderDist = 4;
    this.replaceOverrides(overrides);
  }

  isProtected() { return false; }
  // Free-play state never enters survival decay, regrowth, or the solo save path.
  expireEdits() { return 0; }
  growTrees() {}
  recordEdit() {}

  baseline(cx, cz) {
    const k = `${cx},${cz}`;
    let data = this.baselines.get(k);
    if (!data) {
      data = this.gen.generateChunk(cx, cz);
      this.baselines.set(k, data);
      if (this.baselines.size > 32) this.baselines.delete(this.baselines.keys().next().value);
    }
    return data;
  }

  ensureChunk(cx, cz) {
    const k = `${cx},${cz}`;
    let c = this.chunks.get(k);
    if (c) return c;
    const data = new Uint8Array(this.baseline(cx, cz));
    const edits = this.overrides.getChunk(cx, cz)?.cells;
    if (edits) for (let i = 0; i < edits.length; i++) if (edits[i]) data[i] = edits[i] - 1;
    c = { cx, cz, data, modified: false, dirty: true, meshes: null, colors: null, colorsDirty: true };
    this.chunks.set(k, c);
    for (let y = 0; y < HEIGHT; y++) for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
      if (light(data[x + z * CHUNK + y * CHUNK * CHUNK])) this.lanterns.add(`${cx * CHUNK + x},${y},${cz * CHUNK + z}`);
    }
    this.lightsDirty = true;
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) this.queueRemesh(cx + dx, cz + dz);
    return c;
  }

  // Explicit AIR overrides must be observable before their chunk streams in.
  getBlock(x, y, z) {
    if (y < 0 || y >= HEIGHT) return B.AIR;
    const c = this.chunks.get(chunkKey(x, z));
    if (c) return c.data[index(x, y, z)];
    return this.overrides.getCell(x, y, z) ?? B.STONE;
  }

  setBlock(x, y, z, id) { return this.applyEdits([[x, y, z, id]]); }

  applyEdits(rows) {
    let changed = 0;
    for (const row of rows) {
      const [x, y, z, id] = row;
      if (![x, y, z].every(Number.isInteger) || y < 1 || y >= HEIGHT || (id !== null && (!Number.isInteger(id) || !BLOCKS[id]))) {
        throw new Error('Invalid free-play voxel edit');
      }
      const k = `${x},${y},${z}`, ck = chunkKey(x, z), i = index(x, y, z);
      const previous = this.overrides.getCell(x, y, z);
      if (id === null ? previous === undefined : previous === id) continue;
      const c = this.chunks.get(ck);
      if (id === null) {
        this.overrides.deleteCell(x, y, z);
      } else {
        this.overrides.setCell(x, y, z, id);
      }
      if (c) {
        const old = c.data[i], next = id === null ? this.baseline(c.cx, c.cz)[i] : id;
        c.data[i] = next; c.colorsDirty = true;
        if (light(old)) this.lanterns.delete(k);
        if (light(next)) this.lanterns.add(k);
        if (light(old) || light(next)) this.lightsDirty = true;
        this.queueRemesh(c.cx, c.cz);
        const lx = x - c.cx * CHUNK, lz = z - c.cz * CHUNK;
        if (lx === 0) this.queueRemesh(c.cx - 1, c.cz);
        if (lx === CHUNK - 1) this.queueRemesh(c.cx + 1, c.cz);
        if (lz === 0) this.queueRemesh(c.cx, c.cz - 1);
        if (lz === CHUNK - 1) this.queueRemesh(c.cx, c.cz + 1);
        this.onBlockSet?.(x, y, z, next);
      }
      changed++;
    }
    if (changed) this.revision++;
    return changed;
  }

  enqueueEdits(rows, onComplete = null) {
    this.editQueue.push({ rows, offset: 0, onComplete });
  }

  processEdits(budgetMs = 4) {
    const start = clock();
    do {
      const pending = this.editQueue[0];
      if (!pending) break;
      const end = Math.min(pending.offset + 256, pending.rows.length);
      this.applyEdits(pending.rows.slice(pending.offset, end));
      pending.offset = end;
      if (end === pending.rows.length) { this.editQueue.shift(); pending.onComplete?.(); }
    } while (clock() - start < budgetMs);
  }

  replaceOverrides(overrides = new Map()) {
    this.editQueue.length = 0;
    this.clearChunks();
    this.overrides = overrides instanceof OverrideStore ? overrides : new OverrideStore(overrides);
    this.revision++;
  }

  clearChunks() {
    for (const c of this.chunks.values()) if (c.meshes) disposeChunkMeshes(this.scene, c.meshes);
    this.chunks.clear(); this.savedChunks.clear(); this.remeshQueue.clear();
    this.lanterns.clear(); this.lightsDirty = true;
  }

  // Full-height scan is essential: an atom crater can be deeper than the ordinary NPC scan.
  surfaceY(x, z) {
    x = Math.floor(x); z = Math.floor(z);
    if (!this.isLoaded(x, z)) return null;
    for (let y = HEIGHT - 1; y >= 0; y--) if (isSolid(this.getBlock(x, y, z))) return y + 1;
    return null;
  }

  update(px, pz, { budgetMs = 7, maxGenerate = 1, maxMesh = 1 } = {}) {
    this.frame++;
    const start = clock();
    this.processEdits(Math.min(3, budgetMs / 2));
    const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK), r = this.renderDist;
    let generated = 0;
    outer: for (let ring = 0; ring <= r + 1; ring++) for (let dx = -ring; dx <= ring; dx++) for (let dz = -ring; dz <= ring; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring || this.chunkAt(pcx + dx, pcz + dz)) continue;
      if (generated >= maxGenerate || clock() - start >= budgetMs) break outer;
      this.ensureChunk(pcx + dx, pcz + dz); generated++;
    }
    const dirty = [...this.chunks.values()].filter(c => c.dirty && Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz)) <= r)
      .sort((a, b) => Math.hypot(a.cx - pcx, a.cz - pcz) - Math.hypot(b.cx - pcx, b.cz - pcz));
    let meshed = 0;
    for (const c of dirty) {
      if (meshed >= maxMesh || clock() - start >= budgetMs) break;
      if (!this.chunkAt(c.cx - 1, c.cz) || !this.chunkAt(c.cx + 1, c.cz) || !this.chunkAt(c.cx, c.cz - 1) || !this.chunkAt(c.cx, c.cz + 1)) continue;
      this.remesh(c); this.remeshQueue.delete(`${c.cx},${c.cz}`); meshed++;
    }
    for (const [k, c] of this.chunks) if (Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz)) > r + 3) {
      if (c.meshes) disposeChunkMeshes(this.scene, c.meshes);
      this.chunks.delete(k); this.remeshQueue.delete(k);
      for (const value of [...this.lanterns]) if (chunkKey(...[value.split(',')[0], value.split(',')[2]].map(Number)) === k) this.lanterns.delete(value);
      this.lightsDirty = true;
    }
  }

  dispose() { this.clearChunks(); this.baselines.clear(); this.editQueue.length = 0; }
}
