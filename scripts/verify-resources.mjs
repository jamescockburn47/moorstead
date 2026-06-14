// Resource census — are t' materials genuinely findable near where folk wake up?
// Run wi': node scripts/verify-resources.mjs
//
// For every village spawn (across a few seeds, t' bairns' world included), counts
// t' wood, shallow coal an' iron within a kid's roaming radius an' dig depth, an'
// t' deep jet down t' column. Prints t' numbers so tuning is evidence, not guess.
import { strSeed } from '../src/noise.js';
import { Gen } from '../src/worldgen.js';
import { B } from '../src/defs.js';
import { KILNS } from '../src/geography.js';

const SEEDS = ['t-shared-moor:bairns', 't-shared-moor', 'owt', '42'];
const R = 64;     // how far a young 'un will roam frae spawn
const DIG = 12;   // how deep they'll sink a shaft for shallow ore
const STEP = 2;   // sample every other column (counts are ~1/4 o' t' true totals)

let failed = false;
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

function census(gen, cx, cz) {
  const geo = gen.geo;
  let trees = 0, nearestTree = Infinity, coal = 0, iron = 0, jet = 0, jetMinDepth = Infinity;
  for (let dx = -R; dx <= R; dx += STEP) {
    for (let dz = -R; dz <= R; dz += STEP) {
      if (dx * dx + dz * dz > R * R) continue;
      const x = Math.round(cx + dx), z = Math.round(cz + dz);
      const h = geo.height(x, z);
      if (gen.treeAt(x, z) > 0) { trees++; const d = Math.hypot(dx, dz); if (d < nearestTree) nearestTree = d; }
      const top = h - 4; // first stone course below t' 3-block soil cap
      for (let y = Math.max(1, top - DIG); y <= top && y < h - 3; y++) {
        const o = gen.oreAt(x, y, z);
        if (o === B.COAL_ORE) coal++;
        else if (o === B.IRON_ORE) iron++;
      }
      for (let y = 1; y < 20 && y < h - 3; y++) {
        if (gen.oreAt(x, y, z) === B.JET_ORE) { jet++; const depth = h - y; if (depth < jetMinDepth) jetMinDepth = depth; }
      }
    }
  }
  return { trees, nearestTree, coal, iron, jet, jetMinDepth };
}

for (const seedStr of SEEDS) {
  const gen = new Gen(strSeed(seedStr));
  console.log(`\n== seed "${seedStr}" ==`);
  for (const v of gen.geo.villages) {
    const c = census(gen, v.x, v.z);
    const wood = c.trees > 0 ? `${c.trees} tree-cols (nearest ${Math.round(c.nearestTree)}b)` : 'NO TREES';
    const jetTxt = c.jet ? `${c.jet} (min ${c.jetMinDepth}b deep)` : '0';
    console.log(`  ${v.name.padEnd(14)} wood: ${wood.padEnd(30)} coal ${String(c.coal).padStart(3)}  iron ${String(c.iron).padStart(3)}  jet ${jetTxt}`);
    if (c.trees < 1) bad(`${seedStr}/${v.name}: no wood within ${R}b of spawn`);
    if (c.coal < 6) bad(`${seedStr}/${v.name}: only ${c.coal} coal within reach`);
    if (c.iron < 4) bad(`${seedStr}/${v.name}: only ${c.iron} iron within reach`);
  }
}

console.log('\n== Rosedale jet richness (t’ quest needs 3) ==');
{
  const gen = new Gen(strSeed('t-shared-moor:bairns'));
  const c = census(gen, KILNS.x, KILNS.z);
  console.log(`  near t' kilns: jet ${c.jet ? `${c.jet} (min ${c.jetMinDepth}b deep)` : 0}, iron ${c.iron}`);
  if (c.jet < 3) bad(`Rosedale: only ${c.jet} jet sampled near t' kilns`);
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
