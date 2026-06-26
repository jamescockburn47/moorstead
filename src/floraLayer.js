// floraLayer.js — seasonal flora as an instanced cutout overlay around the
// player. Scatter flowers on open grass (deterministic) + adornments
// (berries/blossom) on the bush blocks they grow on, in season. Decoupled from
// chunk meshes; rebuilt only on player-cell move or bloom-window change. No
// world-data writes, no relay, no re-mesh. Pattern mirrors src/rails.js.
import * as THREE from 'three';
import { tileUV } from './textures.js';
import { getMaterials } from './mesher.js';
import { activeScatter, activeAdornments } from './flora-season.js';
import { activeForageables, fruitSpeciesAt, fruitTreeRipe, FRUIT_SPECIES } from './forage.js';
import { cellInstances } from './flora-placement.js';
import { hash2i } from './noise.js';
import { B } from './defs.js';

const RADIUS = 40;
const REBUILD_MOVE = 8;
// Per-frame time budget (ms) for the sliced rebuild. The full 81-wide scan is
// the heavy bit (per-cell height/getBlock/rail/road queries); we scan columns
// until this much frame time is spent, then yield — so a single frame never
// carries the whole cost, on any machine. Adapts automatically: a fast CPU
// finishes in fewer frames, a slow one in more, but each frame stays cheap.
const SLICE_MS = 6;

function crossGeom(tile, glint = 0) {
  const [u0, v0, u1, v1] = tileUV(tile);
  const g = new THREE.BufferGeometry();
  const h = 1, w = 0.5;
  const pos = [-w, 0, 0, w, 0, 0, w, h, 0, -w, h, 0, 0, 0, -w, 0, 0, w, 0, h, w, 0, h, -w];
  const uv = [u0, v0, u1, v0, u1, v1, u0, v1, u0, v0, u1, v0, u1, v1, u0, v1];
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  // white per-vertex colour: the shared cutout material has vertexColors:true, so a
  // geometry with no colour attribute renders BLACK (texture * 0). White = texture as-is.
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(24).fill(1), 3));
  g.setAttribute('aGlint', new THREE.Float32BufferAttribute(new Array(8).fill(glint), 1));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  g.computeVertexNormals();
  return g;
}

export class FloraLayer {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;          // world.gen (height, geo.railInfo, seed) + getBlock
    this.meshes = [];
    this.center = null;
    this.windowKey = null;
    this.timer = 0;
    this._pending = null;        // in-flight sliced rebuild, scanned a few columns per frame
    // a foraged bush's fruit is hidden until it regrows; the adornment sits at the bush cell (surfY+1)
    this.fruitPicked = (x, z, bush) => this.world.isForaged(x, this.world.gen.height(x, z) + 1, z);
  }

  update(dt, playerPos, season) {
    // Drive an in-flight sliced rebuild every frame, independent of the 0.4s
    // check cadence below — this is what spreads the heavy scan over frames
    // instead of landing it all on one (the old walk-stutter spike).
    if (this._pending) this._advanceBuild();

    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.4;
    if (!season) return;
    const cx = Math.floor(playerPos.x), cz = Math.floor(playerPos.z);
    const key = this._seasonKey(season);
    // Displayed overlay still covers the player and the season window's unchanged
    if (this.center && Math.abs(cx - this.center[0]) < REBUILD_MOVE &&
        Math.abs(cz - this.center[1]) < REBUILD_MOVE && key === this.windowKey && this.meshes.length) return;
    // A sliced rebuild is already heading for (near) here — let it finish
    if (this._pending && Math.abs(cx - this._pending.cx) < REBUILD_MOVE &&
        Math.abs(cz - this._pending.cz) < REBUILD_MOVE && key === this._pending.key) return;
    this._startBuild(cx, cz, season, key);
  }

  // The bloom-window fingerprint: a rebuild is forced when any of these turn.
  _seasonKey(season) {
    return activeScatter(season).map(s => s.tile).join(',') + '|' +
           activeAdornments(season).map(a => a.tile).join(',') + '|' +
           activeForageables(season).map(f => f.tile).join(',') + '|' +
           (fruitTreeRipe(season) ? 'F' : '');
  }

  // Synchronous full build — kept for tests/tools and any caller needing the
  // overlay materialised at once. Production goes through update()'s sliced path.
  build(cx, cz, season) {
    this._startBuild(cx, cz, season, this._seasonKey(season));
    while (this._pending) this._advanceBuild();
  }

  // Begin (or restart) a frame-sliced rebuild centred on (cx,cz). The existing
  // meshes stay on screen until the new set is ready (see _finishBuild), so
  // there's no flora flicker while the scan runs.
  _startBuild(cx, cz, season, key) {
    const scatter = activeScatter(season);
    const adorn = activeAdornments(season);
    const forage = activeForageables(season);
    const fruitRipe = fruitTreeRipe(season);
    if (!scatter.length && !adorn.length && !forage.length && !fruitRipe) {
      this.clear();                     // nowt blooms this window — drop the overlay
      this.center = [cx, cz];
      this.windowKey = key;
      this._pending = null;
      return;
    }
    const glintTiles = new Set([...forage.map(f => f.tile), ...FRUIT_SPECIES.map(s => s.tile)]);
    this._pending = { cx, cz, key, scatter, adorn, forage, fruitRipe, glintTiles, x: cx - RADIUS, byTile: new Map() };
  }

  // Scan columns of the pending build until the per-frame time budget is spent
  // (always at least one, so it can't stall), then swap once the whole RADIUS
  // window's been covered.
  _advanceBuild() {
    const p = this._pending;
    const gen = this.world.gen, seed = gen.seed >>> 0;
    const clock = (typeof performance !== 'undefined' && performance.now) ? performance : null;
    const start = clock ? clock.now() : 0;
    do {
      this._scanColumn(p.x, p.cx, p.cz, p, gen, seed);
      p.x++;
    } while (p.x <= p.cx + RADIUS && clock && (clock.now() - start) < SLICE_MS);
    if (p.x > p.cx + RADIUS) this._finishBuild();
  }

  // One column (z-strip) of cell placement, pushing instances into p.byTile.
  _scanColumn(x, cx, cz, p, gen, seed) {
    const add = (tile, ax, ay, az, yaw, sc) => {
      let a = p.byTile.get(tile); if (!a) p.byTile.set(tile, a = []);
      a.push([ax, ay, az, yaw, sc]);
    };
    for (let z = cz - RADIUS; z <= cz + RADIUS; z++) {
      const ri = gen.geo.railInfo(x, z);
      if (ri && ri.d < 4) continue;                       // keep the four-foot clear
      const rd = gen.geo.roadInfo(x, z);
      if (rd && rd.d < 3) continue;                       // keep the packed-earth lane clear (no flowers through the track)
      const surfY = gen.height(x, z);
      const top = this.world.getBlock(x, surfY + 1, z);
      const surf = this.world.getBlock(x, surfY, z);
      if (p.adorn.length && top) {
        for (const a of p.adorn) if (top === a.bush) {
          if (this.fruitPicked && this.fruitPicked(x, z, a.bush)) continue; // forage suppression
          const yaw = hash2i(x, z, seed ^ (a.tile << 6)) * Math.PI * 2;
          add(a.tile, x + 0.5, surfY + 1, z + 0.5, yaw, 1);
        }
      }
      if (p.fruitRipe) {
        for (let dy = 2; dy <= 8; dy++) {
          if (this.world.getBlock(x, surfY + dy, z) === B.ORCHARD_LEAVES) {
            if (!this.world.isForaged(x, surfY + dy, z) && hash2i(x, z, seed ^ 0x0f18) < 0.6) {
              const sp = fruitSpeciesAt(seed, x, z);
              add(sp.tile, x + 0.5, surfY + dy, z + 0.5, hash2i(x, z, seed ^ (sp.tile << 6)) * Math.PI * 2, 1);
            }
            break;  // fruit only on the lowest (reachable) canopy block of the column
          }
        }
      }
      // scatter only on open, natural moor grass — never in villages, on paths, sand or roofs
      if (p.scatter.length && top === B.AIR && surf === B.GRASS && !gen.geo.inVillage(x, z, 1)) {
        const mode = (ri && ri.d >= 4 && ri.d < 7) ? 'lineside' : 'moor';
        for (const sp of p.scatter)
          for (const inst of cellInstances(seed, x, z, mode, sp.tile))
            add(sp.tile, x + inst.dx, surfY + 1, z + inst.dz, inst.yaw, inst.scale);
      }
      if (p.forage.length && top === B.AIR && surf === B.GRASS && !gen.geo.inVillage(x, z, 1)
          && !this.world.isForaged(x, surfY + 1, z)) {
        for (const f of p.forage)
          for (const inst of cellInstances(seed, x, z, 'forage', f.tile))
            add(f.tile, x + inst.dx, surfY + 1, z + inst.dz, inst.yaw, inst.scale);
      }
    }
  }

  // Swap the freshly-scanned instances in for the old overlay in one step — the
  // only frame that touches the scene graph, and it's cheap (just InstancedMesh
  // builds, no world queries).
  _finishBuild() {
    const p = this._pending;
    this.clear();
    const mat = getMaterials().cutout;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (const [tile, places] of p.byTile) {
      const mesh = new THREE.InstancedMesh(crossGeom(tile, p.glintTiles.has(tile) ? 1 : 0), mat, places.length);
      mesh.frustumCulled = false;
      for (let i = 0; i < places.length; i++) {
        const [px, py, pz, yaw, sc] = places[i];
        e.set(0, yaw, 0); q.setFromEuler(e);
        m.compose(new THREE.Vector3(px, py, pz), q, new THREE.Vector3(sc, sc, sc));
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.userData.ownGeometry = true;
      this.scene.add(mesh);
      this.meshes.push(mesh);
    }
    this.center = [p.cx, p.cz];
    this.windowKey = p.key;
    this._pending = null;
  }

  clear() {
    for (const mesh of this.meshes) {
      this.scene.remove(mesh);
      if (mesh.userData.ownGeometry && mesh.geometry) mesh.geometry.dispose();
    }
    this.meshes.length = 0;
  }
}
