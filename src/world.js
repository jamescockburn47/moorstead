// Chunk storage, streaming, and block access.
import { B, BLOCKS, CHUNK, HEIGHT, isLiquid, isSolid } from './defs.js';
import { categoryOf, isExpired, LIFESPAN } from './editledger.js';
import { FORAGE_LIFESPAN } from './forage.js';
import { snowmanMelted } from './festive.js';
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
    this.editLedger = new Map(); // "x,y,z" -> { cat, day, by, was } — harvest edits awaiting regrowth
    this.forageLedger = new Map(); // "x,y,z" -> pickedDay — picked forage cells awaiting regrowth
    this.snowmanLedger = new Map(); // "x,y,z" -> { cfg, day } — player-built snowmen; melt in the spring thaw
    this.treeRegrowth = new Map(); // "x,y,z" (stump) -> felledDay — a sapling sprouts here in time
    this.saplings = new Map(); // "x,y,z" -> sproutedDay — a young tree growing toward full
    this.fruitStumps = new Set(); // "x,y,z" keys whose sapling should regrow as a fruit tree
    this.deeds = [
      { id: 'quarry_moorstead', kind: 'quarry', by: 'parish', cx: 40, cz: 60, radius: 10, paidUntilDay: Infinity, lapsedDay: null },
      { id: 'quarry_goathland', kind: 'quarry', by: 'parish', cx: 280, cz: -80, radius: 10, paidUntilDay: Infinity, lapsedDay: null },
      { id: 'quarry_pickering', kind: 'quarry', by: 'parish', cx: 480, cz: 820, radius: 12, paidUntilDay: Infinity, lapsedDay: null }
    ]; // { id, kind, by, cx, cz, radius, depth, paidUntilDay, lapsedDay } — land claims + mine licences
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
    // register owt that burns (lanterns, torches an' pit safety-lamps — all
    // ward an' light, an' all get a flame in fireLayer)
    for (let i = 0; i < data.length; i++) {
      if (data[i] === B.LANTERN || data[i] === B.TORCH || data[i] === B.SAFETY_LAMP) {
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
    if (old === B.LANTERN || old === B.TORCH || old === B.SAFETY_LAMP) { this.lanterns.delete(`${x},${y},${z}`); this.lightsDirty = true; }
    if (id === B.LANTERN || id === B.TORCH || id === B.SAFETY_LAMP) { this.lanterns.add(`${x},${y},${z}`); this.lightsDirty = true; }
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

  // Record a block change so it can revert or decay later. Tracks all edits.
  recordEdit(x, y, z, was, newId, day, by) {
    const k = `${x},${y},${z}`;
    const existing = this.editLedger.get(k);
    const base = existing ? existing.was : was; // the original seed block
    
    if (newId === base) {
      // Returned to base state: remove edit from ledger
      this.editLedger.delete(k);
    } else {
      // Modified state: update/set the edit
      const cat = categoryOf(base, newId);
      this.editLedger.set(k, { cat, day, by, was: base });
    }
  }

  // Revert expired edits: backfill holes, regrow plants/ores, and crumble unclaimed/lapsed builds.
  expireEdits(nowDay, decayScale = 1) {
    let n = 0;
    const heightFunc = (x, z) => this.gen.height(x, z);
    for (const [k, e] of this.editLedger) {
      const [x, y, z] = k.split(',').map(Number);
      if (!isExpired(e, nowDay, this.deeds, decayScale, x, y, z, heightFunc)) continue;
      if (!this.isLoaded(x, z)) continue;          // grows back next time its chunk is loaded
      
      const cur = this.getBlock(x, y, z);
      if (e.cat === 'harvest' || e.cat === 'dig') {
        if (cur !== B.AIR) { this.editLedger.delete(k); continue; } // summat's built there now
      }
      
      this.setBlock(x, y, z, e.was);               // revert to base block
      this.editLedger.delete(k);
      if (this.netEdits) this.netEdits.delete(k);
      n++;
    }
    return n;
  }

  // Record a forage pick so t' cell reads as spent; expires (regrows) after FORAGE_LIFESPAN days.
  recordForage(x, y, z, day) { this.forageLedger.set(`${x},${y},${z}`, day); }
  isForaged(x, y, z) { return this.forageLedger.has(`${x},${y},${z}`); }
  expireForage(nowDay) {
    for (const [k, day] of this.forageLedger)
      if (nowDay - day >= FORAGE_LIFESPAN) this.forageLedger.delete(k);
  }

  // Player-built snowmen: persist across saves; melt when the season leaves the festive window.
  recordSnowman(x, y, z, cfg, day) { this.snowmanLedger.set(`${x},${y},${z}`, { cfg, day }); }
  getSnowman(x, y, z) { return this.snowmanLedger.get(`${x},${y},${z}`) || null; }
  removeSnowman(x, y, z) { this.snowmanLedger.delete(`${x},${y},${z}`); }
  meltSnowmen(season) { if (snowmanMelted(season)) this.snowmanLedger.clear(); }

  // Gradual tree regrowth: a felled stump sprouts a sapling after the tree lifespan, and a sapling
  // matures into a full tree after more days — so clear-felling leaves saplings (let woods recover).
  growTrees(nowDay) {
    for (const [k, felledDay] of this.treeRegrowth) {
      if (nowDay - felledDay < LIFESPAN.tree) continue;
      const [x, y, z] = k.split(',').map(Number);
      if (!this.isLoaded(x, z)) continue;
      if (this.getBlock(x, y, z) !== B.AIR || !isSolid(this.getBlock(x, y - 1, z))) { this.treeRegrowth.delete(k); this.fruitStumps.delete(k); continue; }
      const fruit = this.fruitStumps.has(k);
      this.setBlock(x, y, z, B.LOG); this.setBlock(x, y + 1, z, fruit ? B.ORCHARD_LEAVES : B.LEAVES); // a wee sapling
      this.saplings.set(k, nowDay);
      this.treeRegrowth.delete(k);
    }
    for (const [k, sproutedDay] of this.saplings) {
      const [x, y, z] = k.split(',').map(Number);
      if (!this.isLoaded(x, z)) continue;
      if (this.getBlock(x, y, z) !== B.LOG) { this.saplings.delete(k); this.fruitStumps.delete(k); continue; } // chopped — forget it
      if (nowDay - sproutedDay < LIFESPAN.sapling) continue;
      const fruit = this.fruitStumps.has(k);
      this.placeTree(x, y, z, 5, fruit);
      this.fruitStumps.delete(k);
      this.saplings.delete(k);
    }
  }

  // Stamp a full tree (trunk + canopy) at a stump, modelled on worldgen's stampTree.
  // Pass fruit=true to grow orchard canopy (B.ORCHARD_LEAVES) instead of oak (B.LEAVES).
  placeTree(x, y, z, th = 5, fruit = false) {
    const canopy = fruit ? B.ORCHARD_LEAVES : B.LEAVES;
    for (let i = 0; i < th; i++) this.setBlock(x, y + i, z, B.LOG);
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0 && dy === 0) continue;
        const cx = x + dx, cy = y + th - 1 + dy, cz = z + dz;
        if (this.getBlock(cx, cy, cz) === B.AIR) this.setBlock(cx, cy, cz, canopy);
      }
    }
    if (this.getBlock(x, y + th + 1, z) === B.AIR) this.setBlock(x, y + th + 1, z, canopy);
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
