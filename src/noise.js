// Seeded hashing + value noise (2D/3D) + fBm. Deterministic per world seed.

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function strSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Integer lattice hash -> [0,1)
export function hash3i(x, y, z, seed = 0) {
  let h = seed ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function hash2i(x, z, seed = 0) {
  return hash3i(x, 0, z, seed);
}

function smooth(t) { return t * t * (3 - 2 * t); }
function lerp(a, b, t) { return a + (b - a) * t; }

// Value noise in [-1, 1]
export function noise2(x, z, seed = 0) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = smooth(xf), v = smooth(zf);
  const a = hash2i(xi, zi, seed), b = hash2i(xi + 1, zi, seed);
  const c = hash2i(xi, zi + 1, seed), d = hash2i(xi + 1, zi + 1, seed);
  return (lerp(lerp(a, b, u), lerp(c, d, u), v)) * 2 - 1;
}

export function noise3(x, y, z, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = smooth(xf), v = smooth(yf), w = smooth(zf);
  const n000 = hash3i(xi, yi, zi, seed), n100 = hash3i(xi + 1, yi, zi, seed);
  const n010 = hash3i(xi, yi + 1, zi, seed), n110 = hash3i(xi + 1, yi + 1, zi, seed);
  const n001 = hash3i(xi, yi, zi + 1, seed), n101 = hash3i(xi + 1, yi, zi + 1, seed);
  const n011 = hash3i(xi, yi + 1, zi + 1, seed), n111 = hash3i(xi + 1, yi + 1, zi + 1, seed);
  const x00 = lerp(n000, n100, u), x10 = lerp(n010, n110, u);
  const x01 = lerp(n001, n101, u), x11 = lerp(n011, n111, u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w) * 2 - 1;
}

export function fbm2(x, z, octaves, seed = 0) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x * freq, z * freq, seed + i * 1013) * amp;
    norm += amp;
    amp *= 0.5; freq *= 2;
  }
  return sum / norm;
}

export function fbm3(x, y, z, octaves, seed = 0) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise3(x * freq, y * freq, z * freq, seed + i * 7919) * amp;
    norm += amp;
    amp *= 0.5; freq *= 2;
  }
  return sum / norm;
}
