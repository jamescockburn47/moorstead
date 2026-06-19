// Voxel AABB collision and DDA raycast.
import { isSolid, HEIGHT, B } from './defs.js';

// Does an AABB centred at (x,z) with half-width hw, feet at y, height h, overlap any solid block?
// passGate: if set, a field gate (B.GATE) stands open to this body (it's not solid to it).
export function boxCollides(world, x, y, z, hw, h, passGate = false) {
  const x0 = Math.floor(x - hw), x1 = Math.floor(x + hw);
  const y0 = Math.floor(y), y1 = Math.floor(y + h - 0.001);
  const z0 = Math.floor(z - hw), z1 = Math.floor(z + hw);
  for (let bx = x0; bx <= x1; bx++)
    for (let by = y0; by <= y1; by++)
      for (let bz = z0; bz <= z1; bz++) {
        const id = world.getBlock(bx, by, bz);
        if (passGate && id === B.GATE) continue; // a gate stands open to this body
        if (isSolid(id)) return true;
      }
  return false;
}

// Move an entity axis by axis. ent: {pos:{x,y,z}, vel:{x,y,z}, hw, h, onGround}
export function moveEntity(world, ent, dt) {
  const p = ent.pos, v = ent.vel;
  ent.hitWall = false;
  const pg = ent.passGate;

  // Y
  let ny = p.y + v.y * dt;
  if (boxCollides(world, p.x, ny, p.z, ent.hw, ent.h, pg)) {
    if (v.y < 0) {
      ny = Math.floor(p.y + v.y * dt) + 1.0001;
      if (boxCollides(world, p.x, ny, p.z, ent.hw, ent.h, pg)) ny = p.y;
      ent.onGround = true;
    } else {
      ny = p.y;
    }
    v.y = 0;
  } else {
    ent.onGround = false;
  }
  p.y = ny;

  // X
  let nx = p.x + v.x * dt;
  if (boxCollides(world, nx, p.y, p.z, ent.hw, ent.h, pg)) {
    nx = p.x; v.x = 0; ent.hitWall = true;
  }
  p.x = nx;

  // Z
  let nz = p.z + v.z * dt;
  if (boxCollides(world, p.x, p.y, nz, ent.hw, ent.h, pg)) {
    nz = p.z; v.z = 0; ent.hitWall = true;
  }
  p.z = nz;
}

// If an entity has ended up wedged inside solid blocks, free it.
// Tries gentle upward nudges first, then sets it on t' surface. Returns true
// if the entity was stuck and has been moved.
export function unstick(world, ent) {
  if (!boxCollides(world, ent.pos.x, ent.pos.y, ent.pos.z, ent.hw, ent.h)) return false;
  for (let dy = 0.25; dy <= 3; dy += 0.25) {
    if (!boxCollides(world, ent.pos.x, ent.pos.y + dy, ent.pos.z, ent.hw, ent.h)) {
      ent.pos.y += dy;
      ent.vel.y = 0;
      return true;
    }
  }
  // proper buried: pop up to t' surface
  const bx = Math.floor(ent.pos.x), bz = Math.floor(ent.pos.z);
  for (let y = HEIGHT - 2; y > 0; y--) {
    if (isSolid(world.getBlock(bx, y, bz))) {
      ent.pos.y = y + 1.01;
      ent.vel.x = 0; ent.vel.y = 0; ent.vel.z = 0;
      return true;
    }
  }
  return true;
}

// DDA voxel raycast. Returns { x,y,z, face:[nx,ny,nz], dist } or null.
export function raycast(world, ox, oy, oz, dx, dy, dz, maxDist, hitTest) {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMaxX = dx !== 0 ? (dx > 0 ? (x + 1 - ox) : (ox - x)) * tDeltaX : Infinity;
  let tMaxY = dy !== 0 ? (dy > 0 ? (y + 1 - oy) : (oy - y)) * tDeltaY : Infinity;
  let tMaxZ = dz !== 0 ? (dz > 0 ? (z + 1 - oz) : (oz - z)) * tDeltaZ : Infinity;
  let face = [0, 0, 0];
  let t = 0;

  for (let i = 0; i < 256; i++) {
    if (t > maxDist) return null;
    const id = world.getBlock(x, y, z);
    if (hitTest(id)) return { x, y, z, face, dist: t, id };
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; t = tMaxX; tMaxX += tDeltaX; face = [-stepX, 0, 0];
    } else if (tMaxY < tMaxZ) {
      y += stepY; t = tMaxY; tMaxY += tDeltaY; face = [0, -stepY, 0];
    } else {
      z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; face = [0, 0, -stepZ];
    }
  }
  return null;
}
