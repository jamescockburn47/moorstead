// forage.js — pure forageable tables. No DOM, no three.js.
//   Scattered ground forage: standalone plants picked off open ground (no host bush).
import { TILE, I } from './defs.js';

export const SCATTER_FORAGE = [
  { tile: TILE.CEP,         item: I.CEP,         scalar: 'seedhead',    threshold: 0.3, habitat: 'wood' },
  { tile: TILE.CHANTERELLE, item: I.CHANTERELLE, scalar: 'seedhead',    threshold: 0.3, habitat: 'wood' },
  { tile: TILE.WILD_GARLIC, item: I.WILD_GARLIC, scalar: 'daffodil',    threshold: 0.3, habitat: 'wood' },
  { tile: TILE.SORREL,      item: I.SORREL,      scalar: 'summerBloom', threshold: 0.3, habitat: 'dale' },
];

export const FORAGE_LIFESPAN = 4; // game-days until a picked forageable regrows

export function activeForageables(season) {
  return SCATTER_FORAGE.filter(s => (season[s.scalar] || 0) > s.threshold)
    .map(s => ({ tile: s.tile, item: s.item }));
}

export function forageYield(tile) {
  const s = SCATTER_FORAGE.find(f => f.tile === tile);
  return s ? s.item : null;
}
