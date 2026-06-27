// editledger.js — the pure heart of world regeneration. No THREE, no DOM: classifies each
// block edit and says when a harvested resource has grown back. Reversion itself ("forget the
// edit, the resource is back") lives in world.js; this module only decides.
import { B } from './defs.js';
import { findActiveDeed, findLapsedDeed } from './deeds.js';

// What kind of edit was this? Placing anything is a build; breaking is classified by what WAS there.
const PLANTS = new Set([B.HEATHER, B.BRACKEN, B.TUSSOCK, B.BILBERRY_BUSH, B.GORSE, B.FERN, B.FOXGLOVE, B.DOG_ROSE, B.ELDER]);
const TREES  = new Set([B.LOG, B.LEAVES, B.MONKEY_LEAVES, B.ORCHARD_LEAVES]);
const ORES   = new Set([B.COAL_ORE, B.IRON_ORE, B.JET_ORE, B.ALUM_SHALE, B.POLYHALITE, B.ROCK_SALT]);
const HARVEST = new Set([...PLANTS, ...TREES, ...ORES, B.PEAT]); // natural resources that regrow
const TERRAIN = new Set([B.STONE, B.DIRT, B.GRASS, B.GRAVEL, B.COBBLE, B.SAND]); // natural ground

// game-days a harvested resource takes to grow back. A day = 30 real min (DAY_LENGTH=1800), so these
// are deliberately SLOW — healing must never be perceptible within a session (James's call). Start slow,
// tune live by observation. These four are the regrowth tuning knobs.
export const LIFESPAN = { plant: 6, tree: 24, ore: 24, peat: 12, sapling: 24 };

export function categoryOf(was, newId) {
  if (newId !== B.AIR) return 'build';      // a placement
  if (HARVEST.has(was)) return 'harvest';   // cut a resource
  if (TERRAIN.has(was)) return 'dig';       // dug natural ground
  return 'build';                           // removed a placed block
}

export function lifespanOf(cat, was) {
  if (cat !== 'harvest') return Infinity;   // dig + build decay is claim/mine/mode aware, decided in isExpired
  if (TREES.has(was)) return LIFESPAN.tree;
  if (ORES.has(was)) return LIFESPAN.ore;
  if (was === B.PEAT) return LIFESPAN.peat;
  return LIFESPAN.plant;                     // plants
}

// Deterministic coordinate-based hash for gradual crumbling of lapsed builds
export function coordHash(x, y, z) {
  const sin = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453123;
  return sin - Math.floor(sin);
}

// An edit is { cat, day, by, was }. Expired once `nowDay` has passed its lifespan.
// Claims protect builds; Mines protect digs inside their licensed depth envelopes.
export function isExpired(edit, nowDay, deeds = [], decayScale = 1, x = 0, y = 0, z = 0, heightFunc = null, free = false) {
  const life = lifespanOf(edit.cat, edit.was);

  if (edit.cat === 'harvest') {
    // Resources regrow in every world — the gather loop is the fun even in a free world.
    return (nowDay - edit.day) >= life;
  }

  if (edit.cat === 'build') {
    // Free world: builds never crumble — no claim needed to keep what you make.
    if (free) return false;

    // Protected if inside any active land claim
    if (findActiveDeed(deeds, x, z, 'claim')) return false;

    // Lapsed claim: gradual coordinator-hash-based crumbling
    const lapsed = findLapsedDeed(deeds, x, z, 'claim');
    if (lapsed) {
      const grace = 7 * decayScale;          // e.g. 7 days for adults, 14 for bairns
      const decayDuration = 14 * decayScale; // e.g. 14 days for adults, 28 for bairns
      const h = coordHash(x, y, z);
      return (nowDay - lapsed.lapsedDay) > (grace + h * decayDuration);
    }

    // Outside any claim: decays after 30 days
    return (nowDay - edit.day) >= 30;
  }

  if (edit.cat === 'dig') {
    // Free world: digs never backfill — deep workings stay open.
    if (free) return false;

    // Protected if inside an active mine and within its depth envelope
    const mine = findActiveDeed(deeds, x, z, 'mine');
    if (mine && heightFunc) {
      const grade = heightFunc(x, z);
      if (y <= grade && y >= grade - mine.depth) return false;
    }

    // Outside mines/in public quarries/lapsed mines: backfills after 24 days
    return (nowDay - edit.day) >= 24;
  }

  return false;
}

// Depth bands mapping: returns the required pick tier and fixture block ID
export function depthBandFor(depthBelowGrade) {
  if (depthBelowGrade <= 10) {
    return { pick: 'wood', fixture: null };
  } else if (depthBelowGrade <= 20) {
    return { pick: 'stone', fixture: B.PIT_PROPS };
  } else if (depthBelowGrade <= 30) {
    return { pick: 'iron', fixture: B.SAFETY_LAMP };
  } else {
    return { pick: 'iron', fixture: B.WINCH };
  }
}

// Checks if a deep break is permitted under the 1-block-deep rule
// allowedFixtures is an array of block IDs currently present inside the mine's cylinder
export function mayDigDeep(y, grade, mineDeed, heldPickType, allowedFixtures = [], free = false) {
  if (y >= grade - 1) return { allowed: true }; // within 1-block surface skim

  // computed before the free/mine guards so both paths share the value
  const depth = grade - y;

  if (!free) {
    if (!mineDeed) return { allowed: false, reason: 'nomine' };
    if (depth > mineDeed.depth) return { allowed: false, reason: 'depthlimit', limit: mineDeed.depth };
  }

  const band = depthBandFor(depth);

  // Verify pick requirements — kept in the free world too, as gentle progression.
  const pickOrder = { none: 0, wood: 1, stone: 2, iron: 3 };
  const playerPickPower = pickOrder[heldPickType || 'none'] || 0;
  const reqPickPower = pickOrder[band.pick];
  if (playerPickPower < reqPickPower) {
    return { allowed: false, reason: 'pick', pickNeeded: band.pick, fixtureNeeded: band.fixture };
  }

  // Verify fixture requirements — dropped in the free world (no props/lamp/winch faff).
  if (!free && band.fixture && !allowedFixtures.includes(band.fixture)) {
    return { allowed: false, reason: 'fixture', pickNeeded: band.pick, fixtureNeeded: band.fixture };
  }

  return { allowed: true };
}
