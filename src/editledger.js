// editledger.js — the pure heart of world regeneration. No THREE, no DOM: classifies each
// block edit and says when a harvested resource has grown back. Reversion itself ("forget the
// edit, the resource is back") lives in world.js; this module only decides.
import { B } from './defs.js';

// What kind of edit was this? Placing anything is a build; breaking is classified by what WAS there.
const PLANTS = new Set([B.HEATHER, B.BRACKEN, B.TUSSOCK, B.BILBERRY_BUSH, B.GORSE, B.FERN, B.FOXGLOVE, B.DOG_ROSE, B.ELDER]);
const TREES  = new Set([B.LOG, B.LEAVES, B.MONKEY_LEAVES]);
const ORES   = new Set([B.COAL_ORE, B.IRON_ORE, B.JET_ORE]);
const HARVEST = new Set([...PLANTS, ...TREES, ...ORES, B.PEAT]); // natural resources that regrow
const TERRAIN = new Set([B.STONE, B.DIRT, B.GRASS, B.GRAVEL, B.COBBLE, B.SAND]); // natural ground

// game-days a harvested resource takes to grow back. A day = 30 real min (DAY_LENGTH=1800), so these
// are deliberately SLOW — healing must never be perceptible within a session (James's call). Start slow,
// tune live by observation. These four are the regrowth tuning knobs.
export const LIFESPAN = { plant: 6, tree: 24, ore: 24, peat: 12 };

export function categoryOf(was, newId) {
  if (newId !== B.AIR) return 'build';      // a placement
  if (HARVEST.has(was)) return 'harvest';   // cut a resource
  if (TERRAIN.has(was)) return 'dig';       // dug natural ground
  return 'build';                           // removed a placed block
}

export function lifespanOf(cat, was) {
  if (cat !== 'harvest') return Infinity;   // dig + build do not regrow in Slice 1
  if (TREES.has(was)) return LIFESPAN.tree;
  if (ORES.has(was)) return LIFESPAN.ore;
  if (was === B.PEAT) return LIFESPAN.peat;
  return LIFESPAN.plant;                     // plants
}

// An edit is { cat, day, by, was }. Expired once `nowDay` has passed its lifespan.
export function isExpired(edit, nowDay) {
  const life = lifespanOf(edit.cat, edit.was);
  return Number.isFinite(life) && (nowDay - edit.day) >= life;
}
