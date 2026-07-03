// innPlan() determinism + shape — run wi': node scripts/verify-inn-interior.mjs
import { MoorsGeography } from '../src/moorsgeo.js';
import { innPlan, PARLOUR_W, PARLOUR_L, PARLOUR_H } from '../src/innplan.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

const geo = new MoorsGeography();

// --- determinism: same village + seed -> byte-identical plan ---
{
  const a = innPlan(geo, 'Grosmont', 12345);
  const b = innPlan(geo, 'Grosmont', 12345);
  (a !== null ? ok : bad)('Grosmont produces a plan');
  (a && JSON.stringify(a) === JSON.stringify(b) ? ok : bad)('deterministic — same village+seed, same plan');
}

// --- different seed -> can differ (not a hard requirement of sameness) ---
{
  const a = innPlan(geo, 'Grosmont', 1);
  const c = innPlan(geo, 'Grosmont', 2);
  (a && c ? ok : bad)('two different seeds both produce a plan');
}

// --- shape: every field the rest of the program depends on is present and sane ---
{
  const p = innPlan(geo, 'Grosmont', 12345);
  (typeof p.name === 'string' && p.name.length > 0 ? ok : bad)('plan has a non-empty name');
  (p.name === 'Station Tavern' ? ok : bad)('Grosmont is named "Station Tavern" (flagship)');
  (Number.isInteger(p.origin.x) && Number.isInteger(p.origin.z) ? ok : bad)('origin is an integer (x,z)');
  (p.protectedBox.x1 > p.protectedBox.x0 && p.protectedBox.z1 > p.protectedBox.z0 ? ok : bad)('protectedBox is non-degenerate');
  (p.footprint.x0 >= p.protectedBox.x0 && p.footprint.x1 <= p.protectedBox.x1 ? ok : bad)('exterior footprint sits inside the protected box (x)');
  (p.footprint.z0 >= p.protectedBox.z0 && p.footprint.z1 <= p.protectedBox.z1 ? ok : bad)('exterior footprint sits inside the protected box (z)');
  (p.parlour.w === PARLOUR_W && p.parlour.l === PARLOUR_L && p.parlour.h === PARLOUR_H ? ok : bad)('parlour dims match the exported constants');
  (p.parlour.floorY >= 2 && p.parlour.floorY + PARLOUR_H < 20 ? ok : bad)('parlour sits at a shallow, in-bounds y (well clear of bedrock and normal terrain)');
  (p.doorSide === 'n' || p.doorSide === 's' || p.doorSide === 'e' || p.doorSide === 'w' ? ok : bad)('doorSide is one of n/s/e/w');
  (Array.isArray(p.parlour.tables) && p.parlour.tables.length === 4 ? ok : bad)('parlour has all 4 first-cut game tables');
  const games = p.parlour.tables.map(t => t.game).sort();
  (JSON.stringify(games) === JSON.stringify(['dominoes', 'draughts', 'merrils', 'shoveha']) ? ok : bad)('the 4 tables are exactly merrils/draughts/dominoes/shoveha, no dupes');
  (p.parlour.hearth.x >= 1 && p.parlour.hearth.x < PARLOUR_W - 1 ? ok : bad)('hearth sits inside the parlour, not against the outer wall corner');
}

// --- a village with no configured inn returns null, not a throw ---
{
  let threw = false, r = undefined;
  try { r = innPlan(geo, 'Nowhere Village', 1); } catch (e) { threw = true; }
  (!threw ? ok : bad)('unconfigured village does not throw');
  (r === null ? ok : bad)('unconfigured village returns null');
}

// --- worldgen actually carves the plan into chunk data ---
{
  const { Gen } = await import('../src/worldgen.js');
  const { B, CHUNK } = await import('../src/defs.js');
  const IDX = (x, y, z) => x + z * CHUNK + y * CHUNK * CHUNK;
  const gen = new Gen(12345);
  const plan = gen.inns.get('Grosmont');
  (plan ? ok : bad)('Gen builds a Grosmont inn plan at construction time');
  if (plan) {
    const cx = Math.floor(plan.origin.x / CHUNK), cz = Math.floor(plan.origin.z / CHUNK);
    const data = gen.generateChunk(cx, cz);
    const lx = ((plan.origin.x % CHUNK) + CHUNK) % CHUNK;
    const lz = ((plan.origin.z % CHUNK) + CHUNK) % CHUNK;
    // the parlour interior directly under the origin should be hollow at floor+1
    (data[IDX(lx, plan.parlour.floorY + 1, lz)] === B.AIR ? ok : bad)('parlour interior is hollowed out (AIR) at floor+1 under the origin');
    (data[IDX(lx, plan.parlour.floorY, lz)] !== B.AIR ? ok : bad)('parlour floor is solid, not AIR');
    // the ceiling one above the interior clear height should be solid too (a sealed room, not a shaft to the void)
    (data[IDX(lx, plan.parlour.floorY + plan.parlour.h + 1, lz)] !== B.AIR ? ok : bad)('parlour ceiling is solid, not AIR');
  }
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
