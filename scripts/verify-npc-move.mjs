// NPC movement: streamed folk now obey the player's physics — real AABB collision
// (no clipping through walls), gravity (no floating onto roofs), and a 1-block auto
// step-up (a person on foot steps up one, but not two). run: node scripts/verify-npc-move.mjs
//
// Drives npcMove (src/roster.js) over a tiny synthetic world and asserts the outcomes
// that the old direct-pos-write + surfaceHeight-snap got wrong.
global.document = { createElement: () => ({ getContext: () => ({}), width: 0, height: 0 }) };
global.location = { hostname: 'verify-headless' };

import { npcMove } from '../src/roster.js';
import { B } from '../src/defs.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// a tiny fake world: solid ground for y<=0, plus any blocks the test marks solid.
function makeWorld(solid) {
  return {
    isLoaded: () => true,
    getBlock: (x, y, z) => (y <= 0 ? B.STONEBRICK : (solid.has(x + ',' + y + ',' + z) ? B.STONEBRICK : B.AIR)),
    setBlock: () => {},
  };
}
const mkMob = (x, y, z) => ({ pos: { x, y, z }, vel: { x: 0, y: 0, z: 0 }, hw: 0.3, h: 1.7, onGround: false });
const run = (mob, world, vx, vz, steps = 160, dt = 1 / 30) => { for (let i = 0; i < steps; i++) npcMove(mob, vx, vz, world, dt); };
const slab = (x0, x1, y0, y1, z0, z1) => { const s = new Set(); for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) s.add(x + ',' + y + ',' + z); return s; };

// 1. gravity settles a floating mob onto the ground
{
  const m = mkMob(5.5, 6, 5.5);
  run(m, makeWorld(new Set()), 0, 0);
  (Math.abs(m.pos.y - 1) < 0.25 && m.onGround ? ok : bad)(`gravity settles a mob onto the ground (y=${m.pos.y.toFixed(2)}, onGround=${m.onGround})`);
}

// 2. a mob CANNOT walk through a wall (a 3-high stone wall at x=8)
{
  const m = mkMob(5.5, 1, 5.5);
  run(m, makeWorld(slab(8, 8, 1, 3, 3, 8)), 3, 0);
  (m.pos.x < 8 - 0.3 + 0.02 ? ok : bad)(`a mob is stopped by a wall, does not clip through (x=${m.pos.x.toFixed(2)})`);
}

// 3. auto step-up a 1-block rise (a long raised terrace, top at y=2) — the mob climbs
// on and walks along it (extended far enough that it hasn't walked back off by the end)
{
  const m = mkMob(5.5, 1, 5.5);
  run(m, makeWorld(slab(8, 40, 1, 1, 3, 8)), 3, 0, 240);
  (m.pos.x > 9 && m.pos.y > 1.8 ? ok : bad)(`a mob auto-steps UP a 1-block rise and walks the terrace (x=${m.pos.x.toFixed(2)}, y=${m.pos.y.toFixed(2)})`);
}

// 3d. NO BOUNCING: walking on flat ground, the mob's y stays steady (the step-up is a
// smooth glide only when it hits a wall, never a ballistic hop on open ground)
{
  const w = makeWorld(new Set());
  const m = mkMob(5.5, 1, 5.5);
  let maxY = 1, minY = 1;
  for (let i = 0; i < 200; i++) { npcMove(m, 3, 0, w, 1 / 30); maxY = Math.max(maxY, m.pos.y); minY = Math.min(minY, m.pos.y); }
  (maxY - minY < 0.06 ? ok : bad)(`no bouncing on flat ground — y is steady (range ${(maxY - minY).toFixed(3)})`);
}

// 4. a mob does NOT climb a 2-block wall (blocks at y=1 and y=2)
{
  const m = mkMob(5.5, 1, 5.5);
  run(m, makeWorld(slab(8, 13, 1, 2, 3, 8)), 3, 0, 240);
  (m.pos.x < 8 - 0.3 + 0.06 && m.pos.y < 2.3 ? ok : bad)(`a mob does NOT climb a 2-block wall (x=${m.pos.x.toFixed(2)}, y=${m.pos.y.toFixed(2)})`);
}

// 5. a mob does NOT float onto a roof (a tall building) — it stays at ground level
{
  const m = mkMob(5.5, 1, 5.5);
  run(m, makeWorld(slab(8, 13, 1, 6, 3, 8)), 3, 0, 240);
  (m.pos.y < 2.3 ? ok : bad)(`a mob does not float onto a roof — stays at ground level (y=${m.pos.y.toFixed(2)})`);
}

// 6. a mob unloaded-chunk guard: npcMove holds position when the chunk isn't loaded
{
  const w = makeWorld(new Set()); w.isLoaded = () => false;
  const m = mkMob(5.5, 6, 5.5);
  run(m, w, 3, 0, 30);
  (m.pos.x === 5.5 && m.pos.y === 6 ? ok : bad)(`npcMove holds position in an unloaded chunk (no wedging in solid)`);
}

// 7b. haul out of a beck up a higher bank (water-exit hop, like the player's swimGrace)
{
  const water = new Set(); for (let x = 3; x <= 7; x++) for (let y = 1; y <= 2; y++) for (let z = 4; z <= 7; z++) water.add(x + ',' + y + ',' + z);
  const bank = new Set(); for (let x = 8; x <= 70; x++) for (let y = 1; y <= 3; y++) for (let z = 4; z <= 7; z++) bank.add(x + ',' + y + ',' + z); // long bank, top y3 (stand y4)
  const w = {
    isLoaded: () => true,
    getBlock: (x, y, z) => (y <= 0 ? B.STONEBRICK : (water.has(x + ',' + y + ',' + z) ? B.WATER : (bank.has(x + ',' + y + ',' + z) ? B.STONEBRICK : B.AIR))),
    setBlock: () => {},
  };
  const m = mkMob(6.5, 3, 5.5); // wading in the beck
  run(m, w, 3, 0, 400);
  (m.pos.x > 8 && m.pos.y > 3.5 ? ok : bad)(`a mob hauls out of a beck up a higher bank (x=${m.pos.x.toFixed(2)}, y=${m.pos.y.toFixed(2)})`);
}

// 7. the stuck watchdog accrues time when a walker is wedged against an impassable wall
// (so the roster's _unstickDriven can rescue it — no permanently-frozen bodies)
{
  const m = mkMob(5.5, 1, 5.5);
  run(m, makeWorld(slab(8, 13, 1, 3, 3, 8)), 3, 0, 300); // ~10s pressing a 3-high wall
  (m._stuckT > 5 ? ok : bad)(`the stuck watchdog accrues no-progress time on a wedged walker (_stuckT=${(m._stuckT || 0).toFixed(1)}s)`);
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
