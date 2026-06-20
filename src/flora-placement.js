// flora-placement.js — deterministic per-cell scatter placement. Pure: no DOM,
// no three.js. A cell is one world block column (x,z). Returns sub-cell instances.
import { hash2i, noise2 } from './noise.js';

const S_COUNT = 0x2b1d, S_POS = 0x71c3, S_VAR = 0x53a7, S_CLUMP = 0x9e10;

export function cellInstances(seed, cx, cz, mode, tile) {
  const r = (salt, n = 0) => hash2i(cx * 2 + n, cz * 2 + (salt & 1), seed ^ salt ^ (tile << 4));
  let count;
  if (mode === 'lineside') {
    count = 3 + Math.floor(r(S_COUNT) * 4);                 // 3..6
  } else {
    const clump = noise2(cx * 0.10, cz * 0.10, seed ^ S_CLUMP ^ (tile << 4)); // [-1,1]
    if (clump < 0.5) return [];                             // tighter, well-separated patches
    if (r(S_COUNT) < 0.55) return [];                       // sparse even within a patch
    count = 1;                                              // one bloom per populated cell
  }
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({
      dx: r(S_POS + i * 3), dz: r(S_POS + i * 3 + 1),
      yaw: r(S_POS + i * 3 + 2) * Math.PI * 2,
      scale: 0.8 + r(S_VAR + i) * 0.4,
      variant: Math.floor(r(S_VAR + i * 2) * 3),
    });
  }
  return out;
}
