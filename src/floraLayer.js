// floraLayer.js — seasonal flora as an instanced cutout overlay around the
// player. Scatter flowers on open grass (deterministic) + adornments
// (berries/blossom) on the bush blocks they grow on, in season. Decoupled from
// chunk meshes; rebuilt only on player-cell move or bloom-window change. No
// world-data writes, no relay, no re-mesh. Pattern mirrors src/rails.js.
import * as THREE from 'three';
import { tileUV } from './textures.js';
import { getMaterials } from './mesher.js';
import { activeScatter, activeAdornments } from './flora-season.js';
import { cellInstances } from './flora-placement.js';
import { hash2i } from './noise.js';
import { B } from './defs.js';

const RADIUS = 40;
const REBUILD_MOVE = 8;

function crossGeom(tile) {
  const [u0, v0, u1, v1] = tileUV(tile);
  const g = new THREE.BufferGeometry();
  const h = 1, w = 0.5;
  const pos = [-w, 0, 0, w, 0, 0, w, h, 0, -w, h, 0, 0, 0, -w, 0, 0, w, 0, h, w, 0, h, -w];
  const uv = [u0, v0, u1, v0, u1, v1, u0, v1, u0, v0, u1, v0, u1, v1, u0, v1];
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
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
    // forage sibling spec sets this to (x,z,bush)=>bool to hide picked fruit; null = show all
    this.fruitPicked = null;
  }

  update(dt, playerPos, season) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.4;
    if (!season) return;
    const cx = Math.floor(playerPos.x), cz = Math.floor(playerPos.z);
    const key = activeScatter(season).map(s => s.tile).join(',') + '|' +
                activeAdornments(season).map(a => a.tile).join(',');
    if (this.center && Math.abs(cx - this.center[0]) < REBUILD_MOVE &&
        Math.abs(cz - this.center[1]) < REBUILD_MOVE && key === this.windowKey && this.meshes.length) return;
    this.build(cx, cz, season);
    this.center = [cx, cz];
    this.windowKey = key;
  }

  build(cx, cz, season) {
    this.clear();
    const scatter = activeScatter(season);
    const adorn = activeAdornments(season);
    if (!scatter.length && !adorn.length) return;
    const gen = this.world.gen;
    const seed = gen.seed >>> 0;
    const byTile = new Map();
    const add = (tile, x, y, z, yaw, sc) => {
      let a = byTile.get(tile); if (!a) byTile.set(tile, a = []);
      a.push([x, y, z, yaw, sc]);
    };
    for (let x = cx - RADIUS; x <= cx + RADIUS; x++) {
      for (let z = cz - RADIUS; z <= cz + RADIUS; z++) {
        const ri = gen.geo.railInfo(x, z);
        if (ri && ri.d < 4) continue;                       // keep the four-foot clear
        const surfY = gen.height(x, z);
        const top = this.world.getBlock(x, surfY + 1, z);
        if (adorn.length && top) {
          for (const a of adorn) if (top === a.bush) {
            if (this.fruitPicked && this.fruitPicked(x, z, a.bush)) continue; // forage suppression
            const yaw = hash2i(x, z, seed ^ (a.tile << 6)) * Math.PI * 2;
            add(a.tile, x + 0.5, surfY + 1, z + 0.5, yaw, 1);
          }
        }
        if (scatter.length && top === B.AIR) {
          const mode = (ri && ri.d >= 4 && ri.d < 7) ? 'lineside' : 'moor';
          for (const sp of scatter)
            for (const inst of cellInstances(seed, x, z, mode, sp.tile))
              add(sp.tile, x + inst.dx, surfY + 1, z + inst.dz, inst.yaw, inst.scale);
        }
      }
    }
    const mat = getMaterials().cutout;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (const [tile, places] of byTile) {
      const mesh = new THREE.InstancedMesh(crossGeom(tile), mat, places.length);
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
  }

  clear() {
    for (const mesh of this.meshes) {
      this.scene.remove(mesh);
      if (mesh.userData.ownGeometry && mesh.geometry) mesh.geometry.dispose();
    }
    this.meshes.length = 0;
  }
}
