// The parish lanes made visible: a narrow row of packed-earth voxel tiles laid along the road
// alignment (roadpath.js) — ONE flat tile per column at GROUND level, an' it CARVES the lane clear:
// trees, moor foliage an' drystone walls in the column are removed (LOCALLY — a per-client setBlock,
// never sent to the relay, so no shared-world write an' no epoch) so nowt pokes through, while
// BUILDINGS are skirted (never tiled, never carved). Voxel-aligned an' flush to the moor. (The old swept-ribbon
// version warped into shards on slopes an' near buildings; per-column tiles can't — each tile is a
// flat slab on a single block.) A windowed scene-overlay round the player, struck when she's far frae
// the lane — same lifecycle as the permanent way (rails.js). PURE OVERLAY: no world-data writes.
// Where the lane meets a beck the tiles stop at the bank (NPCs ford it on foot); it crosses the line
// at grade (tiles laid straight over the rail columns). No plank bridges, no level crossings.
import * as THREE from 'three';
import { B, CHUNK, HEIGHT } from './defs.js';

const WINDOW = 220;        // chainage either side o' t' player kept dressed
const REBUILD_MOVE = 80;   // rebuild when t' player's drifted this far
const STRIDE = 0.4;        // rasterise the centreline this fine so diagonals stay a connected row

// [D6] mud lanes: t' packed-earth lane darkens to churned mud as t' ground wets through.
// Dry lane 0x6e5a3e -> wet mud 0x4a3a26, lerped by groundWet. Module scratch Colors so
// t' per-frame lerp allocates nowt ([22] hoist lesson); shared across every RoadLayer.
const LANE_DRY = new THREE.Color(0x6e5a3e);
const LANE_WET = new THREE.Color(0x4a3a26);

// Block sets for the lane. SOFT = natural soil the lane beds onto. BUILDING = structures the lane
// must SKIRT (never tiled, never cleared). CLEAR = what the lane CARVES out of its column so nowt
// pokes through the track: trees, moor foliage, drystone walls (cobble/loose stone), an' field
// barriers. (Useful placed props — signposts, lamps, benches — are left be: scanned past, not cleared.)
const SOFT = new Set([B.GRASS, B.DIRT, B.PEAT, B.GRAVEL, B.SAND, B.BOG]);
const BUILDING = new Set([
  B.PLANKS, B.THATCH, B.STONEBRICK, B.WINDOW, B.BOARD, B.SLATE, B.ST_CREAM, B.ST_RED, B.RBRICK,
  B.TER_MINT, B.TER_BLUE, B.TER_PINK, B.TER_YELLOW, B.WOOL, B.RANGE, B.MINE_ENTRANCE, B.WINCH,
]);
const CLEAR = new Set([
  B.LOG, B.LEAVES, B.MONKEY_LEAVES, B.ORCHARD_LEAVES, B.FERN, B.BRACKEN, B.HEATHER, B.TUSSOCK,
  B.GORSE, B.BILBERRY_BUSH, B.FOXGLOVE, B.DOG_ROSE, B.ELDER, B.BRAMBLE, B.HOLLY, B.BLACKTHORN,
  B.HAZEL, B.COTTONGRASS, B.COBBLE, B.STONE, B.FENCE, B.GATE,
]);

// Bed a road tile at (x,z) AND clear the lane above it. Scans down to the soil the lane sits on,
// CLEARING any trees/foliage/walls standing on it (local setBlock → no recordEdit, no net.send, so
// it never reaches the relay: a per-client visual carve, deterministic so every client matches, no
// epoch). Returns the ground's top face, or null for a BUILDING column (skirt — no tile, no carve).
// Unloaded chunk → DEM fallback (no voxel info yet; it'll carve when the chunk loads + rebuilds).
function clearAndGround(world, geo, x, z) {
  const rx = Math.round(x), rz = Math.round(z);
  const dem = geo.height(rx, rz);
  if (!world.chunkAt(Math.floor(rx / CHUNK), Math.floor(rz / CHUNK))) return dem + 1;
  let softY = null, topSolid = null;
  for (let y = dem + 24; y >= dem - 16 && y > 1; y--) {
    const b = world.getBlock(rx, y, rz);
    if (b === B.AIR || b === B.WATER) continue;
    if (BUILDING.has(b)) return null;              // a building/structure — skirt it
    if (topSolid === null) topSolid = y;           // first solid (could be foliage/wall over soil)
    if (SOFT.has(b)) { softY = y; break; }         // the soil the lane beds onto
  }
  const groundY = softY != null ? softY : topSolid;
  if (groundY == null) return dem + 1;
  for (let y = groundY + 1; y <= groundY + 9 && y < HEIGHT; y++) {   // carve the lane's headroom clear
    if (CLEAR.has(world.getBlock(rx, y, rz))) world.setBlock(rx, y, rz, B.AIR);
  }
  return groundY + 1;
}

export class RoadLayer {
  constructor(scene, world, geo) {
    this.scene = scene;
    this.world = world;          // chunk world — surfaceHeight needs it for the REAL (built) surface
    this.geo = geo;
    this.meshes = [];
    this.timer = 0;
    this.lastPos = null;
    this.earthMat = new THREE.MeshLambertMaterial({ color: 0x6e5a3e });  // packed-earth lane
    // one shared flat tile: a 1-block-wide packed-earth slab, a touch under a full block so adjacent
    // tiles show a hairline seam (reads as a row o' blocks, not a poured ribbon).
    this.tileGeom = new THREE.BoxGeometry(0.98, 0.16, 0.98);
  }

  // nearest chainage on a given path to a point — coarse stride scan, only for t' window
  nearestSOn(path, px, pz) {
    const pts = path.pts;
    let best = 0, bd = Infinity;
    for (let i = 0; i < pts.length; i += 4) {
      const d = Math.hypot(pts[i].x - px, pts[i].z - pz);
      if (d < bd) { bd = d; best = i; }
    }
    return { s: pts[best].s, d: bd };
  }

  update(dt, playerPos, groundWet = 0) {
    // [D6] mud: darken t' shared lane material toward mud by groundWet, EVERY frame
    // (afore t' rebuild throttle early-returns) so wet lanes read even when t' tiles
    // aren't being rebuilt. One CPU lerp, no alloc — LANE_DRY.lerp writes into earthMat.
    this.earthMat.color.copy(LANE_DRY).lerp(LANE_WET, groundWet < 0 ? 0 : groundWet > 1 ? 1 : groundWet);
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.5;
    // dress every lane near the player; rebuild only when she's drifted far enough
    if (this.lastPos && Math.hypot(playerPos.x - this.lastPos.x, playerPos.z - this.lastPos.z) < REBUILD_MOVE && this.meshes.length) return;
    this.clear();
    let any = false;
    for (const edge of this.geo.roadPaths()) {
      const near = this.nearestSOn(edge.path, playerPos.x, playerPos.z);
      if (near.d <= 300) { this.build(edge, near.s); any = true; }
    }
    this.lastPos = any ? { x: playerPos.x, z: playerPos.z } : null;
  }

  build(edge, centerS) {
    const path = edge.path, pts = path.pts;
    const s0 = Math.max(0, centerS - WINDOW), s1 = Math.min(path.length, centerS + WINDOW);
    let i0 = 0; while (i0 < pts.length - 1 && pts[i0].s < s0) i0++;
    let i1 = i0; while (i1 < pts.length - 1 && pts[i1].s < s1) i1++;
    if (i1 - i0 < 2) return;

    // rasterise the lane centreline to the integer columns it runs through (deduped) — a 1-wide row.
    const cols = new Map();
    for (let i = i0; i < i1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / STRIDE));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const x = Math.round(a.x + dx * t), z = Math.round(a.z + dz * t);
        cols.set(x + ',' + z, { x, z });
      }
    }

    // one flat tile per column, sat on THAT column's real surface (voxel-aligned → always flush).
    // Skip river columns: the lane fords the beck on foot, so no deck over the water.
    const hasRiver = typeof this.geo.riverColumn === 'function';
    const place = [];
    for (const { x, z } of cols.values()) {
      if (hasRiver && this.geo.riverColumn(x, z)) continue;   // ford — no tile over the beck
      const y = clearAndGround(this.world, this.geo, x, z);
      if (y == null) continue;                                 // building/structure column — skirt (no tile)
      place.push([x, y, z]);
    }
    if (!place.length) return;

    const mesh = new THREE.InstancedMesh(this.tileGeom, this.earthMat, place.length);
    const m = new THREE.Matrix4();
    for (let n = 0; n < place.length; n++) {
      const [x, y, z] = place[n];
      m.makeTranslation(x + 0.5, y - 0.04, z + 0.5);   // top a whisker proud o' the surface, base sunk in
      mesh.setMatrixAt(n, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.meshes.push(mesh);
  }

  clear() {
    for (const mesh of this.meshes) {
      this.scene.remove(mesh);
      mesh.dispose();   // frees the per-instance buffers; the shared tileGeom + earthMat live on
    }
    this.meshes = [];
    this.lastPos = null;
  }

  dispose() {
    this.clear();
    this.earthMat.dispose();
    this.tileGeom.dispose();
  }
}
