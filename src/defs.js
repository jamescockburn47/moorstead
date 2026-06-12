// Block, item, tile, recipe and smelting definitions for Moorstead.

export const CHUNK = 16;
export const HEIGHT = 64;
export const WATER_LEVEL = 26;

// ---- Texture atlas tile indices (16x16 tiles in a 256px atlas) ----
export const TILE = {
  GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, PEAT: 3, STONE: 4, COBBLE: 5,
  LOG_SIDE: 6, LOG_TOP: 7, LEAVES: 8, PLANKS: 9, WATER: 10, BOG: 11,
  HEATHER: 12, BRACKEN: 13, COAL: 14, IRON: 15, JET: 16, GRAVEL: 17,
  BEDROCK: 18, THATCH: 19, STONEBRICK: 20, BENCH_TOP: 21, BENCH_SIDE: 22,
  LANTERN: 23, TUSSOCK: 24, WOOL: 25, BILBERRY: 26, RANGE_FRONT: 27,
  RANGE_SIDE: 28, WINDOW: 29, BOARD: 30, TORCH: 31, SIGNPOST: 32, SAND: 33,
  GORSE: 34,
};

// ---- Block ids ----
export const B = {
  AIR: 0, GRASS: 1, DIRT: 2, PEAT: 3, STONE: 4, COBBLE: 5, LOG: 6,
  LEAVES: 7, PLANKS: 8, WATER: 9, BOG: 10, HEATHER: 11, BRACKEN: 12,
  COAL_ORE: 13, IRON_ORE: 14, JET_ORE: 15, GRAVEL: 16, BEDROCK: 17,
  THATCH: 18, STONEBRICK: 19, BENCH: 20, LANTERN: 21, TUSSOCK: 22,
  WOOL: 23, BILBERRY_BUSH: 24, RANGE: 25, WINDOW: 26, BOARD: 27,
  TORCH: 28, SIGNPOST: 29, SAND: 30, GORSE: 31,
};

// ---- Item ids (blocks double as items; pure items start at 64) ----
export const I = {
  STICK: 64,
  W_PICK: 65, W_AXE: 66, W_SHOVEL: 67, W_SWORD: 68,
  S_PICK: 69, S_AXE: 70, S_SHOVEL: 71, S_SWORD: 72,
  I_PICK: 73, I_AXE: 74, I_SHOVEL: 75, I_SWORD: 76,
  COAL_LUMP: 77, RAW_IRON: 78, IRON_INGOT: 79, JET_GEM: 80,
  RAW_MUTTON: 81, COOKED_MUTTON: 82, RAW_GROUSE: 83, COOKED_GROUSE: 84,
  BILBERRIES: 85,
  // quest items
  PARCEL: 86, AMULET_L: 87, AMULET_R: 88, BELL_CLAPPER: 89, AMULET: 90,
  SPARKLE: 91, HIDE_SCRAP: 92,
  // fossils, dug frae t' bay sands
  AMMONITE: 93, GRYPHAEA: 94,
  // Dracula storyline
  HOLY_WATER: 95, WOODEN_STAKE: 96, HOLY_STAKE: 97, DRACULA_JOURNAL: 98,
};

// Parish wardens: dash account ids wi' admin powers in t' client
// (client-side only — t' game is client-authoritative owt road)
export const ADMIN_ACCTS = ['beck-cross-53'];

// kind: 'solid' | 'cutout' (cross plants) | 'liquid' | 'air'
// tex: {t, s, b} tile ids; hard: seconds to break by hand; tool: best tool
// needsPick: drops nothing (and breaks slowly) without a pick
// drop: item id dropped (null = nothing); light: emits light
const D = {};
D[B.AIR] = { name: 'Air', kind: 'air' };
D[B.GRASS] = { name: 'Moor Grass', kind: 'solid', tex: { t: TILE.GRASS_TOP, s: TILE.GRASS_SIDE, b: TILE.DIRT }, hard: 0.7, tool: 'shovel', drop: B.DIRT };
D[B.DIRT] = { name: 'Dirt', kind: 'solid', tex: { t: TILE.DIRT, s: TILE.DIRT, b: TILE.DIRT }, hard: 0.6, tool: 'shovel', drop: B.DIRT };
D[B.PEAT] = { name: 'Peat', kind: 'solid', tex: { t: TILE.PEAT, s: TILE.PEAT, b: TILE.PEAT }, hard: 0.6, tool: 'shovel', drop: B.PEAT };
D[B.STONE] = { name: 'Gritstone', kind: 'solid', tex: { t: TILE.STONE, s: TILE.STONE, b: TILE.STONE }, hard: 1.6, tool: 'pick', needsPick: true, drop: B.COBBLE };
D[B.COBBLE] = { name: 'Drystone Cobble', kind: 'solid', tex: { t: TILE.COBBLE, s: TILE.COBBLE, b: TILE.COBBLE }, hard: 2.0, tool: 'pick', needsPick: true, drop: B.COBBLE };
D[B.LOG] = { name: 'Owd Oak Log', kind: 'solid', tex: { t: TILE.LOG_TOP, s: TILE.LOG_SIDE, b: TILE.LOG_TOP }, hard: 2.0, tool: 'axe', drop: B.LOG };
D[B.LEAVES] = { name: 'Leaves', kind: 'solid', tex: { t: TILE.LEAVES, s: TILE.LEAVES, b: TILE.LEAVES }, hard: 0.25, tool: null, drop: null };
D[B.PLANKS] = { name: 'Planks', kind: 'solid', tex: { t: TILE.PLANKS, s: TILE.PLANKS, b: TILE.PLANKS }, hard: 2.0, tool: 'axe', drop: B.PLANKS };
D[B.WATER] = { name: 'Beck Water', kind: 'liquid', tex: { t: TILE.WATER, s: TILE.WATER, b: TILE.WATER }, hard: Infinity, drop: null };
D[B.BOG] = { name: 'Peat Bog', kind: 'liquid', tex: { t: TILE.BOG, s: TILE.BOG, b: TILE.BOG }, hard: Infinity, drop: null };
D[B.HEATHER] = { name: 'Heather', kind: 'cutout', tex: { t: TILE.HEATHER, s: TILE.HEATHER, b: TILE.HEATHER }, hard: 0.05, tool: null, drop: B.HEATHER };
D[B.BRACKEN] = { name: 'Bracken', kind: 'cutout', tex: { t: TILE.BRACKEN, s: TILE.BRACKEN, b: TILE.BRACKEN }, hard: 0.05, tool: null, drop: B.BRACKEN };
D[B.COAL_ORE] = { name: 'Coal Seam', kind: 'solid', tex: { t: TILE.COAL, s: TILE.COAL, b: TILE.COAL }, hard: 3.0, tool: 'pick', needsPick: true, drop: I.COAL_LUMP };
D[B.IRON_ORE] = { name: 'Ironstone', kind: 'solid', tex: { t: TILE.IRON, s: TILE.IRON, b: TILE.IRON }, hard: 3.0, tool: 'pick', needsPick: true, drop: I.RAW_IRON };
D[B.JET_ORE] = { name: 'Whitby Jet Seam', kind: 'solid', tex: { t: TILE.JET, s: TILE.JET, b: TILE.JET }, hard: 3.2, tool: 'pick', needsPick: true, drop: I.JET_GEM };
D[B.GRAVEL] = { name: 'Beck Gravel', kind: 'solid', tex: { t: TILE.GRAVEL, s: TILE.GRAVEL, b: TILE.GRAVEL }, hard: 0.7, tool: 'shovel', drop: B.GRAVEL };
D[B.BEDROCK] = { name: 'Bedrock', kind: 'solid', tex: { t: TILE.BEDROCK, s: TILE.BEDROCK, b: TILE.BEDROCK }, hard: Infinity, drop: null };
D[B.THATCH] = { name: 'Thatch', kind: 'solid', tex: { t: TILE.THATCH, s: TILE.THATCH, b: TILE.THATCH }, hard: 0.6, tool: 'axe', drop: B.THATCH };
D[B.STONEBRICK] = { name: 'Dressed Stone', kind: 'solid', tex: { t: TILE.STONEBRICK, s: TILE.STONEBRICK, b: TILE.STONEBRICK }, hard: 2.2, tool: 'pick', needsPick: true, drop: B.STONEBRICK };
D[B.BENCH] = { name: "Joiner's Bench", kind: 'solid', tex: { t: TILE.BENCH_TOP, s: TILE.BENCH_SIDE, b: TILE.PLANKS }, hard: 2.0, tool: 'axe', drop: B.BENCH };
D[B.LANTERN] = { name: 'Lantern', kind: 'solid', tex: { t: TILE.LANTERN, s: TILE.LANTERN, b: TILE.LANTERN }, hard: 0.4, tool: 'pick', drop: B.LANTERN, light: true };
D[B.TUSSOCK] = { name: 'Tussock Grass', kind: 'cutout', tex: { t: TILE.TUSSOCK, s: TILE.TUSSOCK, b: TILE.TUSSOCK }, hard: 0.05, tool: null, drop: null };
D[B.WOOL] = { name: 'Swaledale Wool', kind: 'solid', tex: { t: TILE.WOOL, s: TILE.WOOL, b: TILE.WOOL }, hard: 0.9, tool: null, drop: B.WOOL };
D[B.BILBERRY_BUSH] = { name: 'Bilberry Bush', kind: 'cutout', tex: { t: TILE.BILBERRY, s: TILE.BILBERRY, b: TILE.BILBERRY }, hard: 0.05, tool: null, drop: I.BILBERRIES };
D[B.RANGE] = { name: "T' Range", kind: 'solid', tex: { t: TILE.STONEBRICK, s: TILE.RANGE_SIDE, b: TILE.STONEBRICK }, sFront: TILE.RANGE_FRONT, hard: 2.5, tool: 'pick', needsPick: true, drop: B.RANGE };
D[B.WINDOW] = { name: 'Cottage Window', kind: 'solid', tex: { t: TILE.WINDOW, s: TILE.WINDOW, b: TILE.WINDOW }, hard: 0.4, tool: null, drop: B.WINDOW };
D[B.BOARD] = { name: 'Notice Board', kind: 'solid', tex: { t: TILE.PLANKS, s: TILE.BOARD, b: TILE.PLANKS }, hard: Infinity, drop: null };
D[B.TORCH] = { name: 'Torch', kind: 'cutout', tex: { t: TILE.TORCH, s: TILE.TORCH, b: TILE.TORCH }, hard: 0.05, tool: null, drop: B.TORCH, light: true };
D[B.SIGNPOST] = { name: 'Waymark Signpost', kind: 'cutout', tex: { t: TILE.SIGNPOST, s: TILE.SIGNPOST, b: TILE.SIGNPOST }, hard: 1.0, tool: 'axe', drop: B.SIGNPOST };
D[B.SAND] = { name: 'Bay Sand', kind: 'solid', tex: { t: TILE.SAND, s: TILE.SAND, b: TILE.SAND }, hard: 0.5, tool: 'shovel', drop: B.SAND };
D[B.GORSE] = { name: 'Gorse', kind: 'cutout', tex: { t: TILE.GORSE, s: TILE.GORSE, b: TILE.GORSE }, hard: 0.05, tool: null, drop: B.GORSE };

export const BLOCKS = D;

export function isSolid(id) { const d = D[id]; return d && d.kind === 'solid'; }
export function isLiquid(id) { const d = D[id]; return d && d.kind === 'liquid'; }
export function isCutout(id) { const d = D[id]; return d && d.kind === 'cutout'; }
// blocks that fully hide a neighbouring solid face
export function isOpaque(id) { return isSolid(id); }

// ---- Item display names ----
export const ITEM_NAMES = {
  [I.STICK]: 'Stick',
  [I.W_PICK]: 'Wooden Pick', [I.W_AXE]: 'Wooden Axe', [I.W_SHOVEL]: 'Wooden Spade', [I.W_SWORD]: 'Wooden Sword',
  [I.S_PICK]: 'Gritstone Pick', [I.S_AXE]: 'Gritstone Axe', [I.S_SHOVEL]: 'Gritstone Spade', [I.S_SWORD]: 'Gritstone Sword',
  [I.I_PICK]: 'Iron Pick', [I.I_AXE]: 'Iron Axe', [I.I_SHOVEL]: 'Iron Spade', [I.I_SWORD]: 'Iron Sword',
  [I.COAL_LUMP]: 'Coal', [I.RAW_IRON]: 'Raw Ironstone', [I.IRON_INGOT]: 'Iron Ingot', [I.JET_GEM]: 'Whitby Jet',
  [I.RAW_MUTTON]: 'Raw Mutton', [I.COOKED_MUTTON]: 'Roast Mutton',
  [I.RAW_GROUSE]: 'Raw Grouse', [I.COOKED_GROUSE]: 'Roast Grouse',
  [I.BILBERRIES]: 'Bilberries',
  [I.PARCEL]: 'Brown Paper Parcel',
  [I.AMULET_L]: 'Owd Amulet (left half)',
  [I.AMULET_R]: 'Owd Amulet (right half)',
  [I.BELL_CLAPPER]: 'Abbey Bell Clapper',
  [I.AMULET]: 'Amulet o\u2019 t\u2019 Moors',
  [I.SPARKLE]: 'Sparkle (one-eyed unicorn)',
  [I.HIDE_SCRAP]: 'Barghest Hide Scrap',
  [I.AMMONITE]: 'Ammonite (Snakestone)',
  [I.GRYPHAEA]: 'Devil\u2019s Toenail',
  [I.HOLY_WATER]: 'Holy Water (Whitby Abbey)',
  [I.WOODEN_STAKE]: 'Wooden Stake',
  [I.HOLY_STAKE]: 'Holy Water Stake',
  [I.DRACULA_JOURNAL]: 'Captain\u2019s Log (Dracula)',
};

export function itemName(id) {
  if (id < 64) return D[id] ? D[id].name : '?';
  return ITEM_NAMES[id] || '?';
}

// ---- Tools ----
// speed: mining speed multiplier vs matching block; dmg: attack damage; dur: durability
export const TOOLS = {
  [I.W_PICK]: { type: 'pick', speed: 2.5, dmg: 2, dur: 60 },
  [I.W_AXE]: { type: 'axe', speed: 2.5, dmg: 3, dur: 60 },
  [I.W_SHOVEL]: { type: 'shovel', speed: 2.5, dmg: 2, dur: 60 },
  [I.W_SWORD]: { type: 'sword', speed: 1, dmg: 4, dur: 60 },
  [I.S_PICK]: { type: 'pick', speed: 4.5, dmg: 3, dur: 132 },
  [I.S_AXE]: { type: 'axe', speed: 4.5, dmg: 4, dur: 132 },
  [I.S_SHOVEL]: { type: 'shovel', speed: 4.5, dmg: 2, dur: 132 },
  [I.S_SWORD]: { type: 'sword', speed: 1, dmg: 5, dur: 132 },
  [I.I_PICK]: { type: 'pick', speed: 7, dmg: 4, dur: 251 },
  [I.I_AXE]: { type: 'axe', speed: 7, dmg: 5, dur: 251 },
  [I.I_SHOVEL]: { type: 'shovel', speed: 7, dmg: 3, dur: 251 },
  [I.I_SWORD]: { type: 'sword', speed: 1, dmg: 7, dur: 251 },
};

// ---- Food: hunger restored ----
export const FOODS = {
  [I.BILBERRIES]: 3,
  [I.RAW_MUTTON]: 3,
  [I.COOKED_MUTTON]: 8,
  [I.RAW_GROUSE]: 2,
  [I.COOKED_GROUSE]: 6,
};

export const STACK_SIZE = 64;
export function maxStack(id) { return TOOLS[id] ? 1 : STACK_SIZE; }

// ---- Crafting recipes ----
// { out, n, needs: [[itemId, count]...], bench: requires joiner's bench nearby }
export const RECIPES = [
  { out: B.PLANKS, n: 4, needs: [[B.LOG, 1]] },
  { out: I.STICK, n: 4, needs: [[B.PLANKS, 2]] },
  { out: B.BENCH, n: 1, needs: [[B.PLANKS, 4]] },
  { out: B.THATCH, n: 2, needs: [[B.BRACKEN, 4]] },
  { out: I.W_PICK, n: 1, needs: [[B.PLANKS, 3], [I.STICK, 2]], bench: true },
  { out: I.W_AXE, n: 1, needs: [[B.PLANKS, 3], [I.STICK, 2]], bench: true },
  { out: I.W_SHOVEL, n: 1, needs: [[B.PLANKS, 1], [I.STICK, 2]], bench: true },
  { out: I.W_SWORD, n: 1, needs: [[B.PLANKS, 2], [I.STICK, 1]], bench: true },
  { out: I.S_PICK, n: 1, needs: [[B.COBBLE, 3], [I.STICK, 2]], bench: true },
  { out: I.S_AXE, n: 1, needs: [[B.COBBLE, 3], [I.STICK, 2]], bench: true },
  { out: I.S_SHOVEL, n: 1, needs: [[B.COBBLE, 1], [I.STICK, 2]], bench: true },
  { out: I.S_SWORD, n: 1, needs: [[B.COBBLE, 2], [I.STICK, 1]], bench: true },
  { out: I.I_PICK, n: 1, needs: [[I.IRON_INGOT, 3], [I.STICK, 2]], bench: true },
  { out: I.I_AXE, n: 1, needs: [[I.IRON_INGOT, 3], [I.STICK, 2]], bench: true },
  { out: I.I_SHOVEL, n: 1, needs: [[I.IRON_INGOT, 1], [I.STICK, 2]], bench: true },
  { out: I.I_SWORD, n: 1, needs: [[I.IRON_INGOT, 2], [I.STICK, 1]], bench: true },
  { out: B.RANGE, n: 1, needs: [[B.COBBLE, 8]], bench: true },
  { out: B.STONEBRICK, n: 4, needs: [[B.STONE, 4]], bench: true },
  { out: B.TORCH, n: 4, needs: [[I.STICK, 1], [I.COAL_LUMP, 1]] },
  { out: B.SIGNPOST, n: 1, needs: [[B.PLANKS, 3], [I.STICK, 1]] },
  { out: B.LANTERN, n: 1, needs: [[I.IRON_INGOT, 1], [I.COAL_LUMP, 1]], bench: true },
  { out: I.AMULET, n: 1, needs: [[I.AMULET_L, 1], [I.AMULET_R, 1], [I.BELL_CLAPPER, 1], [I.JET_GEM, 1]], bench: true },
  { out: I.WOODEN_STAKE, n: 1, needs: [[B.PLANKS, 2], [I.STICK, 2]], bench: true },
  { out: I.HOLY_STAKE, n: 1, needs: [[I.WOODEN_STAKE, 1], [I.HOLY_WATER, 1]], bench: true },
];

// ---- Smelting (at t' range). Fuel: coal = 4 ops, peat = 1 op ----
export const SMELTS = [
  { in: I.RAW_IRON, out: I.IRON_INGOT, label: 'Smelt ironstone' },
  { in: B.COBBLE, out: B.STONE, label: 'Fire cobble to gritstone' },
  { in: I.RAW_MUTTON, out: I.COOKED_MUTTON, label: 'Roast mutton' },
  { in: I.RAW_GROUSE, out: I.COOKED_GROUSE, label: 'Roast grouse' },
];
export const FUELS = { [I.COAL_LUMP]: 4, [B.PEAT]: 1 };

// Blocks the player may place
export function isPlaceable(id) {
  return id < 64 && id !== B.AIR && id !== B.WATER && id !== B.BOG && id !== B.BEDROCK;
}

// Everything shown in t' creative cupboard
export const CREATIVE_ITEMS = [
  B.GRASS, B.DIRT, B.PEAT, B.STONE, B.COBBLE, B.STONEBRICK, B.GRAVEL,
  B.LOG, B.PLANKS, B.LEAVES, B.THATCH, B.WOOL, B.HEATHER, B.BRACKEN,
  B.TUSSOCK, B.BILBERRY_BUSH, B.COAL_ORE, B.IRON_ORE, B.JET_ORE,
  B.BENCH, B.RANGE, B.LANTERN, B.WINDOW, B.TORCH, B.SIGNPOST, B.BOARD,
  I.W_PICK, I.S_PICK, I.I_PICK, I.W_AXE, I.S_AXE, I.I_AXE,
  I.W_SHOVEL, I.S_SHOVEL, I.I_SHOVEL, I.W_SWORD, I.S_SWORD, I.I_SWORD,
  I.STICK, I.COAL_LUMP, I.RAW_IRON, I.IRON_INGOT, I.JET_GEM,
  I.RAW_MUTTON, I.COOKED_MUTTON, I.RAW_GROUSE, I.COOKED_GROUSE, I.BILBERRIES,
  I.HOLY_WATER, I.WOODEN_STAKE, I.HOLY_STAKE, I.DRACULA_JOURNAL,
];
