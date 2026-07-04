// src/innplan.js — deterministic inn/tavern plan builder. Pure: no THREE, no
// World, no chunk access — callable from worldgen (has `geo`) and from a Node
// verify script (constructs `geo` directly). Given the same (geo, villageName,
// seed) it must always return the same plan (INVARIANTS.md rule 6, determinism).
//
// THE UNDERCROFT (2026-07-04 rebuild). The surface building stays a modest 9x7
// stone shell with one door. Crossing the threshold teleports the player DOWN to
// the origin (main.js crossThreshold, drop = {origin.x+0.5, floorY+1, origin.z+0.5}).
// Below ground that drop-cell opens onto a big multi-room warren — MUCH bigger than
// the hut above (a deliberate TARDIS): an Entry Hall, a vaulted Tap Room round the
// cast-iron range, a Games Room, a screened Snug, a Servery/Cellar-head with a
// sunken Strongroom vault, and a Letting Wing of beds.
//
// COORDINATE MODEL. Every underground cell is authored in a DOOR-RELATIVE frame
// (f, l): f = FORWARD (out the door — the open side scanSite chose, away from the
// village/rail), l = LATERAL (signed). The origin cell is (f=0, l=0) = the teleport
// drop. relCell() rotates (f,l) into world by doorSide, so ONE layout is correct for
// all four door orientations and the whole thing stays a pure function of the plan
// (determinism). The complex is biased to grow FORWARD and to +LAT and stay tight
// BACK and on -LAT, which keeps its corners clear of the running line (on the live
// Grosmont seed the rail clips the back/-lat diagonal).
import { mulberry32, strSeed } from './noise.js';

export const PARLOUR_H = 5;    // main-level interior clear height, blocks (y4..y8 over the floor)
const MAIN_FLOOR_Y = 3;        // world y the main undercroft floor sits at (well clear of bedrock y=0)
const VAULT_FLOOR_Y = 1;       // sunken strongroom pit floor (2 blocks below the main floor)
const WALL_THICK = 1;          // shell + partition wall thickness

const EXT_W = 9;               // exterior surface building footprint width (x), blocks
const EXT_L = 7;               // exterior surface building footprint length (z), blocks
const EXT_MARGIN = 2;          // no-edit buffer beyond the exterior footprint, blocks

const INN_MIN_R = 14;          // site-scan: nearest ring to try (blocks from village centre)
const INN_MAX_R = 46;          // site-scan: furthest ring — clears the rails/station/works

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

const RAIL_CLEAR = 13;     // centre-to-nearest-rail: the whole footprint + forecourt clears the line
const STATION_CLEAR = 26;  // centre-to-station: well clear of the platform/station building

// --- door-relative frame ------------------------------------------------------
// FORWARD = out the door; LAT = perpendicular. Pure integer rotation, no trig.
export function doorFrame(doorSide) {
  const fwd = doorSide === 'n' ? [0, -1] : doorSide === 's' ? [0, 1] : doorSide === 'e' ? [1, 0] : [-1, 0];
  const lat = (doorSide === 'n' || doorSide === 's') ? [1, 0] : [0, 1];
  return { fwd, lat };
}
// (f,l) door-relative -> world (x,z). origin is {x,z}. Used by worldgen (carve),
// parlour (seats), innDecor (props) and the verify scripts — ONE source of truth.
export function relCell(origin, doorSide, f, l) {
  const { fwd, lat } = doorFrame(doorSide);
  return { x: origin.x + fwd[0] * f + lat[0] * l, z: origin.z + fwd[1] * f + lat[1] * l };
}

// --- the undercroft layout, authored once in (f,l) --------------------------
// Rooms are inclusive (f,l) boxes on the main level (floorY=MAIN_FLOOR_Y). Each
// carves a sealed stone cell; partitions between rooms are opened by DOORS below.
// The envelope is f in [-3,12], l in [-8,8] — verified rail-safe on the live seed
// (world box origin-4..+13 in the forward axis, +/-9 lateral, with a 1-block shell).
// The whole warren grows FORWARD (out the door) and to +LAT; the -LAT side stays
// SHALLOW (games only, forward<=7). This is rail-safety, not taste: on the live
// Grosmont seed the running line sits off the forward/-lat diagonal, so a deep
// -lat room breaches the >=3 corner clearance (verified — see verify-inn-undercroft).
// The +lat line is clear on every inn, so the deep-forward rooms live there.
const ROOMS = [
  { name: 'entry',   f0: -1, f1: 1,  l0: -1, l1: 1 },   // teleport landing, exit door, notices
  { name: 'tap',     f0: 3,  f1: 10, l0: -3, l1: 4 },   // the vaulted heart: range, hatch, 2 tables
  { name: 'games',   f0: 3,  f1: 7,  l0: -8, l1: -5 },  // -lat wing (shallow): 2 more tables
  { name: 'servery', f0: 3,  f1: 6,  l0: 6,  l1: 8 },   // +lat behind the hatch: casks + the vault pit
  { name: 'snug',    f0: 8,  f1: 10, l0: 6,  l1: 8 },   // +lat forward: screened fireside nook
  { name: 'letting', f0: 12, f1: 14, l0: 6,  l1: 8 },   // +lat furthest forward: 4 beds (D6 sleep)
];

// Doorways between rooms: a 2-wide, 2-high gap carved in the shared partition wall
// (the player's AABB jams a 1-wide gap, so every route is a true 2 cells). Each is
// a list of (f,l) cells on the partition line, cleared y4..y5.
const DOORS = [
  { cells: [[2, 0], [2, 1]] },        // entry -> tap
  { cells: [[4, -4], [5, -4]] },      // tap -> games
  { cells: [[5, 5], [6, 5]] },        // tap -> servery (walk-through, separate from the hatch)
  { cells: [[7, 6], [7, 7]] },        // servery -> snug
  { cells: [[11, 6], [11, 7]] },      // snug -> letting
];

// The sunken Strongroom: a pit in the Servery floor, two treads down to VAULT_FLOOR_Y.
// Open to the Servery above (not a sealed sub-level), rbrick-lined, the one strongbox.
const VAULT = {
  pit: { f0: 4, f1: 5, l0: 7, l1: 8 },   // pit floor at VAULT_FLOOR_Y
  treads: [[3, 7, 2], [4, 7, 1]],         // [f,l,topY] step down from servery floor(3) -> y2 -> y1
};

export function innPlan(geo, villageName, seed) {
  const name = INN_NAMES[villageName];
  if (!name) return null;
  const v = geo.villages.find(vv => vv.name === villageName);
  if (!v) return null;

  const rng = mulberry32((strSeed(villageName) ^ (seed | 0)) | 0);
  const site = scanSite(geo, v, rng);
  if (!site) return null;

  const origin = { x: site.x, z: site.z };
  const doorSide = site.doorSide;  // faces outward onto the open ground scanSite found

  const ex0x = site.x - Math.floor(EXT_W / 2), ex1x = ex0x + EXT_W - 1;
  const ex0z = site.z - Math.floor(EXT_L / 2), ex1z = ex0z + EXT_L - 1;
  const footprint = { x0: ex0x, z0: ex0z, x1: ex1x, z1: ex1z };

  // parlour tables: 4 fixed (f,l) slots, deterministic order, GAME shuffled by rng
  // (positions fixed so the layout is static; only which game sits where varies —
  // same idiom as before, so no geometry moves seed-to-seed). Slots: 2 in the tap
  // room, 2 in the games room.
  const slots = [
    { f: 5, l: -1 }, { f: 8, l: 2 },   // tap room
    { f: 4, l: -7 }, { f: 6, l: -6 },  // games room
  ];
  const games = [...GAMES];
  const tables = slots.map(s => ({ ...s, game: games.splice(Math.floor(rng() * games.length), 1)[0] }));

  // furnish: parlour furniture + seasonal mounts, all in (f,l). No RNG draws here
  // (order-sensitive: any new draw MUST go after the tables shuffle above).
  const furnish = {
    benches: tables.map(t => ({ f: t.f, l: t.l + 1 })),   // a settle beside each table
    servery: { f: 3, l: 5 },                               // hatch counter cell on the tap/servery wall
    strongbox: { f: 5, l: 8, y: 2 },                       // in the sunken vault pit (block sits at y=2 on the y1 floor)
    beds: [                                                 // Letting Wing (+lat, forward): 4 beds (D6 sleep)
      { f: 12, l: 6 }, { f: 12, l: 8 }, { f: 14, l: 6 }, { f: 14, l: 8 },
    ],
    hearth: { f: 10, l: 0 },                                // the cast-iron RANGE cell, in the tap forward-wall inglenook
    mounts: { mantel: { f: 10, l: 0 }, doorOut: true, windows: true },
  };

  // --- protection. protectedRects is the PRECISE protected region: one world AABB
  // per room's wall-ring box (rotated by doorSide) + the surface shell. It drives
  // cave-suppression (innAt) and edit-protection (isProtected). protectedBox is just
  // the axis-aligned BOUNDING box of all that — used only as a cheap pre-reject and
  // the stampInns chunk-iteration gate. The distinction matters: the warren is
  // L/T-shaped, so the bounding box has phantom corners (deep-forward × deep--lat)
  // that no room occupies; protecting/ rail-checking those would needlessly lock rock
  // and, on the Grosmont seed, read a false rail breach at a corner nothing is built at. ---
  const protectedRects = [];
  for (const r of ROOMS) {
    const a = relCell(origin, doorSide, r.f0 - WALL_THICK, r.l0 - WALL_THICK);
    const b = relCell(origin, doorSide, r.f1 + WALL_THICK, r.l1 + WALL_THICK);
    protectedRects.push({ x0: Math.min(a.x, b.x), z0: Math.min(a.z, b.z), x1: Math.max(a.x, b.x), z1: Math.max(a.z, b.z) });
  }
  protectedRects.push({ x0: ex0x - EXT_MARGIN, z0: ex0z - EXT_MARGIN, x1: ex1x + EXT_MARGIN, z1: ex1z + EXT_MARGIN });
  const protectedBox = {
    x0: Math.min(...protectedRects.map(r => r.x0)), z0: Math.min(...protectedRects.map(r => r.z0)),
    x1: Math.max(...protectedRects.map(r => r.x1)), z1: Math.max(...protectedRects.map(r => r.z1)),
  };

  return {
    village: villageName,
    name,
    origin,
    groundY: site.groundY,
    doorSide,
    footprint,
    protectedBox,
    protectedRects,
    // parlour: the load-bearing frame the rest of the program reads. floorY is the
    // teleport target (crossThreshold). rooms/doors/vault drive the carve; tables +
    // hearth stay here so parlour.js/gameTable.js keep their existing field paths.
    parlour: {
      h: PARLOUR_H,
      floorY: MAIN_FLOOR_Y,
      vaultFloorY: VAULT_FLOOR_Y,
      wallThick: WALL_THICK,
      rooms: ROOMS,
      doors: DOORS,
      vault: VAULT,
      hearth: furnish.hearth,
      tables,
    },
    furnish,
  };
}

// Bounding box (world x/z) of the whole undercroft: every room corner + the vault,
// grown by one shell ring, rotated by doorSide. Pure.
function complexBounds(origin, doorSide) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const eat = (f, l) => {
    const w = relCell(origin, doorSide, f, l);
    if (w.x < x0) x0 = w.x; if (w.x > x1) x1 = w.x;
    if (w.z < z0) z0 = w.z; if (w.z > z1) z1 = w.z;
  };
  for (const r of ROOMS) { eat(r.f0, r.l0); eat(r.f1, r.l0); eat(r.f0, r.l1); eat(r.f1, r.l1); }
  eat(VAULT.pit.f0, VAULT.pit.l0); eat(VAULT.pit.f1, VAULT.pit.l1);
  // grow by the shell ring (WALL_THICK) in every direction
  return { x0: x0 - WALL_THICK, z0: z0 - WALL_THICK, x1: x1 + WALL_THICK, z1: z1 + WALL_THICK };
}

// Is (x,z) a clear tavern site — offset from roads, rivers, rails, stations and
// works so the pub never lands ON a structure or the line. Pure (x,z).
function siteClear(geo, x, z) {
  if (typeof geo.nearStation === 'function' && geo.nearStation(x, z, STATION_CLEAR)) return false;
  if (typeof geo.railInfo === 'function') { const ri = geo.railInfo(x, z); if (ri && ri.d < RAIL_CLEAR) return false; }
  const hw = Math.floor(EXT_W / 2) + EXT_MARGIN + 2, hl = Math.floor(EXT_L / 2) + EXT_MARGIN + 2;
  for (const [dx, dz] of [[0, 0], [-hw, -hl], [hw, -hl], [-hw, hl], [hw, hl], [-hw, 0], [hw, 0], [0, -hl], [0, hl]]) {
    const px = x + dx, pz = z + dz;
    if (typeof geo.onRoad === 'function' && geo.onRoad(px, pz)) return false;
    if (typeof geo.riverColumn === 'function' && geo.riverColumn(px, pz)) return false;
    if (typeof geo.worksAt === 'function' && geo.worksAt(px, pz)) return false;
    if (typeof geo.railInfo === 'function') { const ri = geo.railInfo(px, pz); if (ri && ri.d < 4) return false; }
  }
  return true;
}

// Deterministic clear-site scan near the village centre. Pure (x,z) queries only.
// Returns the site AND the door side (facing OUTWARD, away from the village/station).
function scanSite(geo, v, rng) {
  const saltAngle = rng() * Math.PI * 2;
  for (let r = INN_MIN_R; r <= INN_MAX_R; r += 2) {
    for (let ai = 0; ai < 12; ai++) {
      const angle = (ai / 12) * Math.PI * 2 + saltAngle;
      const x = v.x + Math.round(r * Math.cos(angle));
      const z = v.z + Math.round(r * Math.sin(angle));
      if (!siteClear(geo, x, z)) continue;
      const h = geo.height(x, z);
      // flat enough: every corner of the exterior box within 1 block of centre height
      let flat = true;
      const hw = Math.floor(EXT_W / 2), hl = Math.floor(EXT_L / 2);
      for (const [dx, dz] of [[-hw, -hl], [hw, -hl], [-hw, hl], [hw, hl]]) {
        if (Math.abs(geo.height(x + dx, z + dz) - h) > 1) { flat = false; break; }
      }
      if (!flat) continue;
      const ox = x - v.x, oz = z - v.z;
      const doorSide = Math.abs(ox) >= Math.abs(oz) ? (ox >= 0 ? 'n' : 's') : (oz >= 0 ? 'e' : 'w');
      return { x, z, groundY: h, doorSide };
    }
  }
  return null;
}
