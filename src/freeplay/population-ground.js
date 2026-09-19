import { B, HEIGHT, isSolid } from '../defs.js';

const UNSAFE = new Set([B.LEAVES, B.MONKEY_LEAVES, B.ORCHARD_LEAVES, B.LOG, B.FENCE, B.GATE, B.THATCH]);

// Scan the edited column to bedrock, never generator height minus a shallow band.
// Missing columns are not forced into existence by scenery or population work.
export function safeSurface(world, x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  if (!world.isLoaded(ix, iz)) return null;
  for (let y = HEIGHT - 1; y >= 0; y--) {
    const block = world.getBlock(ix, y, iz);
    if (block === B.WATER || block === B.BOG) return null;
    if (!isSolid(block)) continue;
    if (UNSAFE.has(block)) return null;
    for (const dx of [-.42, .42]) for (const dz of [-.42, .42]) {
      const px = Math.floor(x + dx), pz = Math.floor(z + dz);
      if (!world.isLoaded(px, pz)) return null;
      for (let h = 1; h <= 2; h++) {
        const above = world.getBlock(px, y + h, pz);
        if (isSolid(above) || above === B.WATER || above === B.BOG) return null;
      }
    }
    return y + 1;
  }
  return null;
}

export function nearbySurface(world, x, z, maxRadius = 8) {
  for (let radius = 0; radius <= maxRadius; radius += 2) {
    const steps = radius ? 12 : 1;
    for (let i = 0; i < steps; i++) {
      const angle = i / steps * Math.PI * 2;
      const px = Math.floor(x + Math.cos(angle) * radius) + .5;
      const pz = Math.floor(z + Math.sin(angle) * radius) + .5;
      const y = safeSurface(world, px, pz);
      if (y != null) return { x: px, y, z: pz };
    }
  }
  return null;
}
