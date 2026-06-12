// Chunk storage, streaming, and block access.
import { B, BLOCKS, CHUNK, HEIGHT, isLiquid, isSolid } from './defs.js';
import { Gen } from './worldgen.js';
import { buildChunkMeshes, disposeChunkMeshes } from './mesher.js';
import { tileColor } from './textures.js';

const IDX = (x, y, z) => x + z * CHUNK + y * CHUNK * CHUNK;
const key = (cx, cz) => cx + ',' + cz;

export class World {
  constructor(scene, seed, savedChunks) {
    this.scene = scene;
    this.gen = new Gen(seed);
    this.chunks = new Map();
    this.savedChunks = savedChunks || new Map(); // "cx,cz" -> Uint8Array
    this.lanterns = new Set(); // "x,y,z"
    this.renderDist = 6;
    this.genQueue = [];
  }

  chunkAt(cx, cz) { return this.chunks.get(key(cx, cz)); }

  ensureChunk(cx, cz) {
    const k = key(cx, cz);
    let c = this.chunks.get(k);
    if (c) return c;
    const saved = this.savedChunks.get(k);
    const data = saved ? new Uint8Array(saved) : this.gen.generateChunk(cx, cz);
    // shared-moor edits arriving afore their chunk exists land here on gen
    if (this.netEdits) {
      for (const [ek, id] of this.netEdits) {
        const [x, y, z] = ek.split(',').map(Number);
        if (Math.floor(x / CHUNK) === cx && Math.floor(z / CHUNK) === cz) {
          data[(x - cx * CHUNK) + (z - cz * CHUNK) * CHUNK + y * CHUNK * CHUNK] = id;
        }
      }
    }
    c = {
      cx, cz, data,
      modified: !!saved,
      dirty: true,
      meshes: null,
      colors: null, // minimap surface colours
      colorsDirty: true,
    };
    this.chunks.set(k, c);
    // register owt that burns (lanterns an' torches both ward an' light)
    for (let i = 0; i < data.length; i++) {
      if (data[i] === B.LANTERN || data[i] === B.TORCH) {
        const y = Math.floor(i / (CHUNK * CHUNK));
        const r = i % (CHUNK * CHUNK);
        this.lanterns.add(`${cx * CHUNK + (r % CHUNK)},${y},${cz * CHUNK + Math.floor(r / CHUNK)}`);
        this.lightsDirty = true;
      }
    }
    // neighbours that were already meshed may now show stale border faces
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = this.chunkAt(cx + dx, cz + dz);
      if (n) n.dirty = true;
    }
    return c;
  }

  getBlock(x, y, z) {
    if (y < 0 || y >= HEIGHT) return B.AIR;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = this.chunks.get(key(cx, cz));
    if (!c) return B.STONE; // ungenerated: treat as solid so nowt falls through t' world
    return c.data[IDX(x - cx * CHUNK, y, z - cz * CHUNK)];
  }

  isLoaded(x, z) {
    return this.chunks.has(key(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
  }

  setBlock(x, y, z, id) {
    if (y < 0 || y >= HEIGHT) return;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = this.chunks.get(key(cx, cz));
    if (!c) return;
    const lx = x - cx * CHUNK, lz = z - cz * CHUNK;
    const old = c.data[IDX(lx, y, lz)];
    if (old === id) return;
    c.data[IDX(lx, y, lz)] = id;
    c.modified = true;
    c.dirty = true;
    c.colorsDirty = true;
    if (old === B.LANTERN || old === B.TORCH) { this.lanterns.delete(`${x},${y},${z}`); this.lightsDirty = true; }
    if (id === B.LANTERN || id === B.TORCH) { this.lanterns.add(`${x},${y},${z}`); this.lightsDirty = true; }
    // plant on top falls off when its block is dug out
    const above = this.getBlock(x, y + 1, z);
    if (id === B.AIR && BLOCKS[above] && BLOCKS[above].kind === 'cutout') {
      this.setBlock(x, y + 1, z, B.AIR);
    }
    if (lx === 0) this.markDirty(cx - 1, cz);
    if (lx === CHUNK - 1) this.markDirty(cx + 1, cz);
    if (lz === 0) this.markDirty(cx, cz - 1);
    if (lz === CHUNK - 1) this.markDirty(cx, cz + 1);
  }

  markDirty(cx, cz) {
    const c = this.chunks.get(key(cx, cz));
    if (c) c.dirty = true;
  }

  // Stream chunks around t' player. Budgeted per frame.
  update(px, pz) {
    const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
    const R = this.renderDist;

    // generate missing, nearest first
    let genBudget = 2;
    outer:
    for (let r = 0; r <= R + 1 && genBudget > 0; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (!this.chunks.has(key(pcx + dx, pcz + dz))) {
            this.ensureChunk(pcx + dx, pcz + dz);
            if (--genBudget <= 0) break outer;
          }
        }
      }
    }

    // mesh dirty chunks that have all 4 neighbours, nearest first
    let meshBudget = 2;
    const dirty = [];
    for (const c of this.chunks.values()) {
      if (!c.dirty) continue;
      const d = Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz));
      if (d > R) continue;
      if (!this.chunkAt(c.cx + 1, c.cz) || !this.chunkAt(c.cx - 1, c.cz) ||
          !this.chunkAt(c.cx, c.cz + 1) || !this.chunkAt(c.cx, c.cz - 1)) continue;
      dirty.push([d, c]);
    }
    dirty.sort((a, b) => a[0] - b[0]);
    for (const [, c] of dirty) {
      if (meshBudget-- <= 0) break;
      this.remesh(c);
    }

    // unload distant chunks
    for (const [k, c] of this.chunks) {
      const d = Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz));
      if (d > R + 3) {
        if (c.modified) this.savedChunks.set(k, c.data);
        if (c.meshes) disposeChunkMeshes(this.scene, c.meshes);
        this.chunks.delete(k);
      }
    }
  }

  remesh(c) {
    if (c.meshes) disposeChunkMeshes(this.scene, c.meshes);
    c.meshes = buildChunkMeshes(this, c);
    for (const m of c.meshes) this.scene.add(m);
    c.dirty = false;
  }

  // Is every chunk within `r` of t' position meshed yet?
  readyAround(px, pz, r = 2) {
    const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      const c = this.chunkAt(pcx + dx, pcz + dz);
      if (!c || (c.dirty && !c.meshes)) return false;
    }
    return true;
  }

  // Surface colours for t' minimap (lazily refreshed per chunk).
  surfaceColors(cx, cz) {
    const c = this.chunkAt(cx, cz);
    if (!c) return null;
    if (!c.colorsDirty && c.colors) return c.colors;
    const cols = c.colors || new Uint8ClampedArray(CHUNK * CHUNK * 3);
    for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
      let col = [20, 20, 30];
      for (let y = HEIGHT - 1; y >= 0; y--) {
        const id = c.data[IDX(lx, y, lz)];
        if (id === B.AIR) continue;
        const def = BLOCKS[id];
        const base = tileColor(def.tex.t);
        const f = 0.6 + (y / HEIGHT) * 0.7; // height shading
        col = [base[0] * f, base[1] * f, base[2] * f];
        if (isLiquid(id)) col = [base[0] * 0.9, base[1] * 0.9, base[2] * 0.9];
        break;
      }
      const o = (lz * CHUNK + lx) * 3;
      cols[o] = col[0]; cols[o + 1] = col[1]; cols[o + 2] = col[2];
    }
    c.colors = cols;
    c.colorsDirty = false;
    return cols;
  }

  collectModified() {
    const out = new Map(this.savedChunks);
    for (const [k, c] of this.chunks) {
      if (c.modified) out.set(k, c.data);
    }
    return out;
  }

  solidAt(x, y, z) { return isSolid(this.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))); }

  // Is there a burning light (lantern/torch) within r of this spot?
  // Dark things won't come near flame.
  nearLight(x, z, r) {
    if (this.lightsDirty || !this._lightsArr) {
      this._lightsArr = [...this.lanterns].map(k => k.split(',').map(Number));
      this.lightsDirty = false;
    }
    const r2 = r * r;
    for (const [lx, , lz] of this._lightsArr) {
      const dx = lx - x, dz = lz - z;
      if (dx * dx + dz * dz < r2) return true;
    }
    return false;
  }
}
