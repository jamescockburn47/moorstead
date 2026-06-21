// forage.js — pure forageable tables. No DOM, no three.js.
//   Scattered ground forage: standalone plants picked off open ground (no host bush).
import { TILE, I, B } from './defs.js';
import { noise2 } from './noise.js';

export const SCATTER_FORAGE = [
  { tile: TILE.CEP,         item: I.CEP,         scalar: 'seedhead',    threshold: 0.3, habitat: 'wood' },
  { tile: TILE.CHANTERELLE, item: I.CHANTERELLE, scalar: 'seedhead',    threshold: 0.3, habitat: 'wood' },
  { tile: TILE.WILD_GARLIC, item: I.WILD_GARLIC, scalar: 'daffodil',    threshold: 0.3, habitat: 'wood' },
  { tile: TILE.SORREL,      item: I.SORREL,      scalar: 'summerBloom', threshold: 0.3, habitat: 'dale' },
];

// Host-borne fruit: an adornment on a host bush; picking yields `item`, the bush stays.
export const HOST_FORAGE = [
  { bush: B.BILBERRY_BUSH, tile: TILE.BILBERRY_FRUIT, item: I.BILBERRIES, scalar: 'heatherBloom', threshold: 0.4 },
  { bush: B.BRAMBLE,       tile: TILE.BLACKBERRY,     item: I.BLACKBERRY, scalar: 'blackberry',   threshold: 0.3 },
  { bush: B.DOG_ROSE,      tile: TILE.ROSEHIP,        item: I.ROSEHIP,    scalar: 'frost',        threshold: 0.3 },
  { bush: B.BLACKTHORN,    tile: TILE.SLOE,           item: I.SLOE,       scalar: 'frost',        threshold: 0.3 },
  { bush: B.ELDER,         tile: TILE.ELDERBERRY,     item: I.ELDERBERRY, scalar: 'seedhead',     threshold: 0.3 },
  { bush: B.HAZEL,         tile: TILE.HAZELNUT,       item: I.HAZELNUT,   scalar: 'seedhead',     threshold: 0.3 },
];
export function activeHostForage(season) {
  return HOST_FORAGE.filter(h => (season[h.scalar] || 0) > h.threshold);
}
export function hostForageFor(bush, season) {
  return activeHostForage(season).find(h => h.bush === bush) || null;
}

export const FORAGE_LIFESPAN = 4; // game-days until a picked forageable regrows

export function activeForageables(season) {
  return SCATTER_FORAGE.filter(s => (season[s.scalar] || 0) > s.threshold)
    .map(s => ({ tile: s.tile, item: s.item }));
}

export function forageYield(tile) {
  const s = SCATTER_FORAGE.find(f => f.tile === tile);
  return s ? s.item : null;
}

export const FRUIT_SPECIES = [
  { tile: TILE.APPLE, item: I.APPLE },
  { tile: TILE.PEAR,  item: I.PEAR },
  { tile: TILE.PLUM,  item: I.PLUM },
];
// Species varies slowly across the land, so an orchard tends to one fruit.
export function fruitSpeciesAt(seed, x, z) {
  const n = noise2(x * 0.02, z * 0.02, (seed ^ 0xf20a7) >>> 0); // [-1,1]
  const idx = n < -0.2 ? 0 : n < 0.2 ? 1 : 2;
  return FRUIT_SPECIES[idx];
}
export function fruitTreeRipe(season) { return (season.seedhead || 0) > 0.25; } // late summer -> autumn
