// src/innplan.js — deterministic inn/tavern plan builder. Pure: no THREE, no
// World, no chunk access — callable from worldgen (has `geo`) and from a Node
// verify script (constructs `geo` directly). Given the same (geo, villageName,
// seed) it must always return the same plan (INVARIANTS.md rule 6, determinism).
import { mulberry32, strSeed } from './noise.js';

export const PARLOUR_W = 11;   // parlour interior width (x), blocks
export const PARLOUR_L = 9;    // parlour interior length (z), blocks
export const PARLOUR_H = 4;    // parlour interior clear height, blocks
const PARLOUR_FLOOR_Y = 3;     // world y the parlour floor sits at (well clear of bedrock y=0)
const WALL_THICK = 1;          // shell wall thickness, both exterior and pocket

// LOAD-BEARING EQUALITY: the underground parlour shell spans
// origin ± (floor(PARLOUR_W/2)+WALL_THICK, floor(PARLOUR_L/2)+WALL_THICK) = ±(6,5),
// and the protectedBox spans origin ± (floor(EXT_W/2)+EXT_MARGIN, floor(EXT_L/2)+EXT_MARGIN) = ±(6,5).
// They coincide EXACTLY, with zero slack — cave suppression and edit protection are both
// keyed on protectedBox, so if any of these six constants is tuned independently the
// parlour shell can silently poke outside the protected region. Re-derive both sides
// (and re-run verify-inn-interior / verify-inn-protection) before changing any of them.
const EXT_W = 9;               // exterior building footprint width (x), blocks
const EXT_L = 7;               // exterior building footprint length (z), blocks
const EXT_MARGIN = 2;          // no-edit buffer beyond the exterior footprint, blocks

const INN_MIN_R = 14;          // site-scan: nearest ring to try (blocks from village centre)
const INN_MAX_R = 28;          // site-scan: furthest ring to try before giving up

// Flagship + confirmed candidates. Villages not listed here have no inn.
const INN_NAMES = {
  Grosmont: 'Station Tavern',
  Lealholm: 'Board Inn',
  Danby: 'Duke of Wellington',
  'Beck Hole': 'Birch Hall Inn',
  Pickering: 'White Swan',
  Egton: 'Postgate',
};
const GAMES = ['merrils', 'draughts', 'dominoes', 'shoveha'];
const DOOR_SIDES = ['n', 's', 'e', 'w'];

function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; } // rng() < 1 strictly, so the index never reaches arr.length

// Deterministic clear-site scan near the village centre. Pure (x,z) queries only.
function scanSite(geo, v, rng) {
  const saltAngle = rng() * Math.PI * 2;
  for (let r = INN_MIN_R; r <= INN_MAX_R; r += 2) {
    for (let ai = 0; ai < 12; ai++) {
      const angle = (ai / 12) * Math.PI * 2 + saltAngle;
      const x = v.x + Math.round(r * Math.cos(angle));
      const z = v.z + Math.round(r * Math.sin(angle));
      if (typeof geo.onRoad === 'function' && geo.onRoad(x, z)) continue;
      if (typeof geo.riverColumn === 'function' && geo.riverColumn(x, z)) continue;
      const h = geo.height(x, z);
      // flat enough: every corner of the exterior box within 1 block of centre height
      let flat = true;
      const hw = Math.floor(EXT_W / 2), hl = Math.floor(EXT_L / 2); // same half-width the real footprint uses below
      for (const [dx, dz] of [[-hw, -hl], [hw, -hl], [-hw, hl], [hw, hl]]) {
        if (Math.abs(geo.height(x + dx, z + dz) - h) > 1) { flat = false; break; }
      }
      if (!flat) continue;
      return { x, z, groundY: h };
    }
  }
  return null;
}

export function innPlan(geo, villageName, seed) {
  const name = INN_NAMES[villageName];
  if (!name) return null;
  const v = geo.villages.find(vv => vv.name === villageName);
  if (!v) return null;

  const rng = mulberry32((strSeed(villageName) ^ (seed | 0)) | 0);
  const site = scanSite(geo, v, rng);
  if (!site) return null;

  const doorSide = pick(rng, DOOR_SIDES);

  const ex0x = site.x - Math.floor(EXT_W / 2), ex1x = ex0x + EXT_W - 1;
  const ex0z = site.z - Math.floor(EXT_L / 2), ex1z = ex0z + EXT_L - 1;
  const footprint = { x0: ex0x, z0: ex0z, x1: ex1x, z1: ex1z };
  const protectedBox = {
    x0: ex0x - EXT_MARGIN, z0: ex0z - EXT_MARGIN,
    x1: ex1x + EXT_MARGIN, z1: ex1z + EXT_MARGIN,
  };

  // parlour tables: 4 fixed slots around the room, deterministic order shuffled by rng
  const slots = [
    { x: 2, z: 2 }, { x: PARLOUR_W - 3, z: 2 },
    { x: 2, z: PARLOUR_L - 3 }, { x: PARLOUR_W - 3, z: PARLOUR_L - 3 },
  ];
  const games = [...GAMES];
  const tables = slots.map(s => ({ ...s, game: games.splice(Math.floor(rng() * games.length), 1)[0] }));

  // furnish: parlour furniture + seasonal dressing mount points — pure data
  // derived from fields already fixed above. No RNG draws here (order-sensitive:
  // any new draw MUST go after the tables shuffle above, or every existing plan's
  // geometry changes — verify-inn-interior's determinism/pinned-snapshot assertions
  // guard this).
  const furnish = {
    // parlour-interior coords (same space as parlour.hearth/tables)
    servery: { x: PARLOUR_W - 2, z: Math.floor(PARLOUR_L / 2) },   // hatch/servery counter cell against the east wall
    strongbox: { x: PARLOUR_W - 2, z: PARLOUR_L - 2 },             // the tavern strongbox (addendum §1)
    benches: tables.map(t => ({ x: t.x, z: t.z + 1 })),            // one settle/bench beside each game table
    // seasonal dressing mount points (world-space resolved by the decor layer):
    mounts: {
      mantel: { x: Math.floor(PARLOUR_W / 2), z: 2 },              // above the hearth
      doorOut: true,                                                // exterior door lintel (wreath)
      windows: true,                                                // exterior sills
    },
  };

  return {
    village: villageName,
    name,
    origin: { x: site.x, z: site.z },
    groundY: site.groundY,
    doorSide,
    footprint,
    protectedBox,
    parlour: {
      w: PARLOUR_W, l: PARLOUR_L, h: PARLOUR_H,
      floorY: PARLOUR_FLOOR_Y,
      wallThick: WALL_THICK,
      hearth: { x: Math.floor(PARLOUR_W / 2), z: 1 },
      tables,
    },
    furnish,
  };
}
