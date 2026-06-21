// flora-season.js — which overlay flora are active for a given season state.
// Pure: a function of the season scalars only. No DOM, no three.js.
//   scatter   — standalone flowers placed on open grass.
//   adornment — berries/blossom rendered on a specific bush block, in season.
import { TILE, B } from './defs.js';
import { HOST_FORAGE } from './forage.js';

const SCATTER = [
  { tile: TILE.SNOWDROP, scalar: 'snowdrop', threshold: 0.3 },
  { tile: TILE.DAFFODIL, scalar: 'daffodil', threshold: 0.3 },
  { tile: TILE.WILDFLOWER, scalar: 'summerBloom', threshold: 0.3 },
];

// Decorative-only adornments: blossom/berries with no pickable yield.
const ADORN_DECOR = [
  { tile: TILE.BRAMBLE_FLOWER, scalar: 'brambleFlower', threshold: 0.3, bush: B.BRAMBLE },
  { tile: TILE.HOLLY_BERRY,    scalar: 'frost',         threshold: 0.4, bush: B.HOLLY },
];

export function activeScatter(season) {
  return SCATTER.filter(s => (season[s.scalar] || 0) > s.threshold).map(s => ({ tile: s.tile }));
}
export function activeAdornments(season) {
  const fruit = HOST_FORAGE.filter(h => (season[h.scalar] || 0) > h.threshold).map(h => ({ tile: h.tile, bush: h.bush }));
  const decor = ADORN_DECOR.filter(s => (season[s.scalar] || 0) > s.threshold).map(s => ({ tile: s.tile, bush: s.bush }));
  return [...fruit, ...decor];
}
