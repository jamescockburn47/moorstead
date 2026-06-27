// invariants.js — the gameplay-invariant catalogue (pure, no THREE, no DOM).
//
// One source of truth for "things that should never be true in a live world",
// shared by the headless harness (scripts/verify-invariants.mjs) and the live
// auditor (moorstead.debug.audit()). Each invariant takes the world + a mob and
// returns a violation object, or null when the mob is fine. Keep them cheap and
// side-effect-free so they can run every frame in the live audit.
import { B } from './defs.js';

// The first non-air block at or below a feet position — mirrors the mob
// water-wall scan in entities.js (the sea sits lower than the shore, so a plain
// same-level check misses the ledge).
export function columnSurface(world, x, fy, z, depth = 16) {
  for (let y = fy; y > fy - depth; y--) {
    const b = world.getBlock(x, y, z);
    if (b !== B.AIR) return b;
  }
  return B.AIR;
}

// A land beast: walks the ground, so water/air underfoot is a glitch. Excludes
// fliers (they belong over water), boats, and villagers (handled separately).
export function isLandMob(mob) {
  return !!mob && !mob.dead && mob.type !== 'coble' && mob.type !== 'villager' && !(mob.t && mob.t.fly);
}

// "Tame sheep walking on the river" — a land beast standing over open water.
export function mobOverWater(world, mob) {
  if (!isLandMob(mob)) return null;
  const fx = Math.floor(mob.pos.x), fz = Math.floor(mob.pos.z), fy = Math.floor(mob.pos.y + 0.2);
  if (columnSurface(world, fx, fy, fz) === B.WATER) {
    return {
      kind: 'mob-over-water', type: mob.type, owner: !!mob.owner,
      x: +mob.pos.x.toFixed(1), y: +mob.pos.y.toFixed(1), z: +mob.pos.z.toFixed(1),
    };
  }
  return null;
}

// The catalogue. Add new mob invariants here and both the harness and the live
// auditor pick them up automatically.
export const MOB_INVARIANTS = [mobOverWater];

export function auditMobs(world, mobs) {
  const violations = [];
  for (const mob of mobs || []) {
    for (const inv of MOB_INVARIANTS) {
      const v = inv(world, mob);
      if (v) violations.push(v);
    }
  }
  return violations;
}
