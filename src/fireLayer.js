// fireLayer.js — a real animated flame over every placed torch, lantern an'
// safety-lamp near the player. A windowed scene-overlay, same shape as
// floraLayer/seasonalLayer: it owns its lifecycle (per-frame flame tick, a
// throttled rebuild gated on player move, teardown) an' writes no world data.
//
// ENUMERATION (the cheap bit): the world already keeps `world.lanterns` — a Set
// of "x,y,z" keys for every burning light, kept current on chunk-load an' on
// every setBlock (see world.js). main.js extends that registration to safety
// lamps too, so this Set IS the complete light list. We never scan blocks: we
// read the Set, filter to a radius, sort by distance, cap the count. So the
// rebuild is O(lights near the player), an' it only fires on the throttle.
import * as THREE from 'three';
import { makeFlameMaterial, Fire, tickFlame } from './fire.js';

const RADIUS = 32;       // only light blocks within this of the player get a flame
const REBUILD_MOVE = 4;  // rebuild once the player drifts this many blocks
const REBUILD_EVERY = 0.3; // ...an' at most this often (seconds)
const CAP = 40;          // never more than this many live flames (nearest win)
const TORCH_SCALE = 0.32; // a small narrow torch/lantern flame (blocks tall)
const LOD_NEAR = 18;     // within this, a slightly fuller two-tongue flame

// deterministic per-position seed so each fire writhes differently but the SAME
// torch always looks the same frame-to-frame (no reshuffling on rebuild).
function seedAt(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) >>> 0;
  h = (h ^ (h >>> 13)) * 1274126177 >>> 0;
  return (h % 100000) / 100000; // 0..1
}

export class FireLayer {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.mat = makeFlameMaterial(); // the ONE shared flame material (we tick it)
    this.fires = [];                // live Fire groups
    this.center = null;             // [x,z] of the last rebuild
    this.lightKey = null;           // world.lanterns.size at the last rebuild
    this.timer = 0;
    this.t = 0;                     // flame animation clock
  }

  update(dt, playerPos, camera) {
    // Flame animation runs EVERY frame, before the rebuild early-out — the
    // billboard faces the camera in-shader, so there's no per-frame CPU rotation.
    this.t += dt;
    tickFlame(this.mat, this.t);

    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = REBUILD_EVERY;

    const cx = Math.floor(playerPos.x), cz = Math.floor(playerPos.z);
    // The light set can change without the player moving (a torch placed or
    // broken), so its size joins the rebuild gate — same idea as seasonalLayer
    // keying on the snowman-ledger size.
    const lights = this.world.lanterns;
    const key = lights.size;
    if (this.center &&
        Math.abs(cx - this.center[0]) < REBUILD_MOVE &&
        Math.abs(cz - this.center[1]) < REBUILD_MOVE &&
        key === this.lightKey &&
        this.fires.length) return;

    this.build(playerPos);
    this.center = [cx, cz];
    this.lightKey = key;
  }

  build(playerPos) {
    this.clear();
    const px = playerPos.x, py = playerPos.y, pz = playerPos.z;
    const r2 = RADIUS * RADIUS;

    // gather lights within the radius, with their squared distance for LOD/cap
    const near = [];
    for (const k of this.world.lanterns) {
      const c0 = k.indexOf(','), c1 = k.indexOf(',', c0 + 1);
      const x = +k.slice(0, c0), y = +k.slice(c0 + 1, c1), z = +k.slice(c1 + 1);
      const dx = x - px, dz = z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      near.push([d2, x, y, z]);
    }
    // nearest first, then cap — the closest CAP flames are the ones tha sees
    near.sort((a, b) => a[0] - b[0]);
    if (near.length > CAP) near.length = CAP;

    for (const [d2, x, y, z] of near) {
      // LOD: a fuller two-tongue flame up close, a single tongue further out
      const layers = d2 < LOD_NEAR * LOD_NEAR ? 2 : 1;
      const fire = Fire({
        scale: TORCH_SCALE,
        layers,
        seed: seedAt(x, y, z),
        material: this.mat, // render on OUR shared, ticked material
      });
      // sit the flame on the block top: centred in x/z, a touch above the block
      fire.position.set(x + 0.5, y + 0.7, z + 0.5);
      this.scene.add(fire);
      this.fires.push(fire);
    }
  }

  // Dispose every live fire group (frees their geometries). NEVER the shared
  // material — it lives for the whole layer; teardown drops it with the layer.
  clear() {
    for (const f of this.fires) {
      this.scene.remove(f);
      if (typeof f.dispose === 'function') f.dispose();
    }
    this.fires.length = 0;
  }
}
