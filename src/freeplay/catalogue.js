import { B, BLOCKS, CREATIVE_ITEMS, isPlaceable, itemName } from '../defs.js';
import { FREEPLAY } from './config.js';

export const BLOCK_CATALOGUE = Object.freeze([...new Set(CREATIVE_ITEMS.filter(id => BLOCKS[id] && isPlaceable(id)))]
  .map(id => Object.freeze({ id, name: itemName(id) })));

// Stylised game effects; damage dimensions mirror the authoritative server table.
export const BOMBS = Object.freeze([
  Object.freeze({ id: 'grenade', name: 'Grenade', radius: 4, depth: 3, up: 6,
    fuse: 1.5, delivery: 'throw', colour: '#7d9659', description: 'Throw a quick pop. A small crater and a spray of rubble.' }),
  Object.freeze({ id: 'dynamite', name: 'Dynamite', radius: 7, depth: 5, up: 10,
    fuse: 2, delivery: 'place', colour: '#b9563e', description: 'Place a charge. A sharp crack and a rising column of dust.' }),
  Object.freeze({ id: 'demolition', name: 'Demolition bomb', radius: 12, depth: 8, up: 16,
    fuse: 2.5, delivery: 'place', colour: '#ca873e', description: 'Clear a building. Heavy rubble and a rolling dust cloud.' }),
  Object.freeze({ id: 'mega', name: 'Mega bomb', radius: 24, depth: 13, up: 24,
    fuse: 3, delivery: 'place', colour: '#bf6942', description: 'A broad crater, a great fireball and a sweeping shockwave.', chimney: true }),
  Object.freeze({ id: 'atom', name: 'Atom bomb', radius: 40, depth: 18, up: 30,
    fuse: 4, delivery: 'place', colour: '#d8af40', description: 'A village-sized crater. A towering mushroom cloud.', chimney: true }),
]);
export const DEFAULT_BLOCK = B.PLANKS;
export const bombById = id => BOMBS.find(bomb => bomb.id === id);

// Pure shape counterpart to the server; no client authority to choose damage.
export function* blastCells(bomb, [cx, cy, cz]) {
  const { radius, depth, up } = bomb;
  for (let x = Math.max(-FREEPLAY.worldLimit,cx-radius); x <= Math.min(FREEPLAY.worldLimit,cx+radius); x++) {
    for (let z = Math.max(-FREEPLAY.worldLimit,cz-radius); z <= Math.min(FREEPLAY.worldLimit,cz+radius); z++) {
      const radial = ((x - cx) ** 2 + (z - cz) ** 2) / radius ** 2;
      if (radial > 1) continue;
      const factor = Math.sqrt(1 - radial);
      const floor = Math.max(1, Math.ceil(cy - depth * factor));
      const top = bomb.chimney ? 63 : Math.min(63, Math.floor(cy + up * factor));
      for (let y = floor; y <= top; y++) yield [x, y, z, B.AIR];
    }
  }
}
