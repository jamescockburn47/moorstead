// Voxel-level check that t' train's road is actually CLEAR — run wi':
//   node scripts/verify-rail-clearance.mjs
// Generates the REAL chunks the line crosses (src/worldgen.js, under Node — no
// browser) an' asserts the loading gauge (±1.5 blocks, deck+1..deck+5) is AIR
// the whole way. This is what catches "t' train passes through a tree/building":
// it inspects the actual blocks the rake would occupy, not just the spline.
import { strSeed } from '../src/noise.js';
import { Gen } from '../src/worldgen.js';
import { CHUNK, B } from '../src/defs.js';

const IDX = (x, y, z) => x + z * CHUNK + y * CHUNK * CHUNK;
const SEEDS = ['t-shared-moor', '42'];

let failed = false;
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const ok = m => console.log('  ok    ' + m);

for (const SEED of SEEDS) {
  const gen = new Gen(strSeed(SEED));
  const geo = gen.geo;
  const path = geo.railPath();
  console.log(`\n== loading-gauge clearance, seed "${SEED}" (${Math.round(path.length)} blocks) ==`);

  const cache = new Map();
  const chunk = (cx, cz) => {
    const k = cx + ',' + cz;
    let d = cache.get(k);
    if (!d) { d = gen.generateChunk(cx, cz); cache.set(k, d); }
    return d;
  };

  const samples = 700;
  let checked = 0, blocked = 0;
  const seen = new Set();
  for (let i = 0; i <= samples; i++) {
    const p = geo.samplePos((i / samples) * path.length);
    const L = Math.hypot(p.tx, p.tz) || 1;
    const nx = -p.tz / L, nz = p.tx / L;            // perpendicular to travel
    for (const off of [-1.5, -0.75, 0, 0.75, 1.5]) {  // t' train's swept width
      const wx = Math.round(p.x + nx * off), wz = Math.round(p.z + nz * off);
      const ri = geo.railInfo(wx, wz);
      if (!ri || ri.d >= 2.8) continue;             // same gate worldgen clears on
      const deck = Math.max(1, Math.round(ri.deck));  // same deck worldgen uses
      const cx = Math.floor(wx / CHUNK), cz = Math.floor(wz / CHUNK);
      const data = chunk(cx, cz);
      const lx = wx - cx * CHUNK, lz = wz - cz * CHUNK;
      for (let y = deck + 1; y <= deck + 5; y++) {     // floor to roof o' t' rake (deck is t' ballast)
        const id = data[IDX(lx, y, lz)];
        checked++;
        if (id !== B.AIR && id !== B.WATER) {          // water's fine — bridges ride above
          blocked++;
          const key = wx + ',' + wz;
          if (!seen.has(key) && blocked <= 8) { seen.add(key); bad(`solid id=${id} at (${wx},${y},${wz}) — ${Math.round((i / samples) * path.length)} blocks along`); }
        }
      }
    }
  }
  if (!blocked) ok(`gauge clear: ${checked} cells inspected, all AIR above the deck`);
  else console.log(`        (${blocked}/${checked} gauge cells blocked)`);
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
