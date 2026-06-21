// forage.js — pure forageable tables. No DOM, no three.js.
//   Scattered ground forage: standalone plants picked off open ground (no host bush).
import { TILE, I, B } from './defs.js';

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
