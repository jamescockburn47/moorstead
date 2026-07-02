// Evening village life — run wi': node scripts/verify-eveninglife.mjs
//
// Housed folk no longer wink out at dusk: frae DUSK (skyT 0.76) a villager wi' a
// house (mob.house = {b, out, inside} frae geo.npcHome) anchors their potter to
// their OWN doorstep (house.out), walks there wi' the existing potter/walkTo
// machinery (popTo stuck-safety intact), an' potters tight round the step —
// visible, standin' quiet, facin' the door now an' then. Only i' the dead o'
// neet (skyT > 0.88) do they finally vanish; back at dawn as ever. Houseless
// folk keep exactly the old behaviour (gone at 0.76).
//
// Steps the REAL Entities.updateVillager headlessly (three.js scene-graph builds
// fine under Node — we never render). The one non-pure dependency is the canvas
// used by makeNameplate; a minimal document stub (crib of verify-festival-render)
// satisfies it BEFORE the entities import.

global.document = {
  createElement: (tag) => {
    if (tag !== 'canvas') return {};
    const ctx2d = {
      clearRect: () => {}, fillRect: () => {}, drawImage: () => {},
      strokeText: () => {}, fillText: () => {},
      measureText: () => ({ width: 10 }),
      font: '', fillStyle: '', strokeStyle: '', lineWidth: 0,
      textAlign: '', textBaseline: '',
    };
    return { width: 0, height: 0, getContext: () => ctx2d };
  },
};

import { Entities } from '../src/entities.js';
import { villagerRemark, GREET_EVENING } from '../src/villagerlife.js';
import { B } from '../src/defs.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// --- headless arena: flat stone floor at GY, air above; optional wall plane ---
const GY = 20;
function makeArena({ wallX = null } = {}) {
  const world = {
    isLoaded: () => true,
    getBlock: (x, y, z) => {
      if (y <= GY) return B.STONE;
      if (wallX !== null && Math.floor(x) === wallX && y <= GY + 8) return B.STONE; // a high wall — no hoppin' ower
      return B.AIR;
    },
    gen: { height: () => GY, geo: null },
  };
  const scene = { add() {}, remove() {} };
  const ents = new Entities(scene, world);
  ents.spawnTimer = 1e9;
  ents.game = { sky: { time: 0.5 }, season: null };
  return ents;
}

const HOUSE = {
  b: {},
  out: { x: 30.5, z: 30.5 },     // afore t' door
  inside: { x: 30.5, z: 33.5 },  // ower t' threshold (faced, never walked)
};
const WORK = { x: 0.5, z: 0.5 };
const GREEN = { x: 8.5, z: 8.5 };

function makeVillagerAt(ents, opts = {}) {
  const v = ents.spawnVillager('pop-eve-test', 'eve tester', 0.5, GY + 1, 0.5, {
    village: 'Moorstead', work: WORK, green: GREEN, ...opts,
  });
  ents.mobs = [v]; // isolate
  return v;
}

// player parked far off — no greet/nosy interference
const player = { pos: { x: 500, y: GY + 1, z: 500 }, dead: false, creative: false, heldItem: () => null, countItem: () => 0, damage() {} };

function step(ents, mob, seconds, dt = 0.05) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    const distP = Math.hypot(player.pos.x - mob.pos.x, player.pos.z - mob.pos.z);
    ents.updateVillager(mob, dt, player, distP);
  }
}
const distTo = (mob, p) => Math.hypot(p.x - mob.pos.x, p.z - mob.pos.z);

// ---------------------------------------------------------------------------
// (a) evening: a housed villager's goal becomes their doorstep; stays visible
// ---------------------------------------------------------------------------
console.log('== evening: housed folk head for their own doorstep, visible ==');
{
  const ents = makeArena();
  const v = makeVillagerAt(ents, { house: HOUSE });
  ents.game.sky.time = 0.8; // evening, past dusk (0.76), afore dead o' neet (0.88)
  step(ents, v, 0.05);      // one tick — goal re-anchors straight away
  (v.potterGoal && distTo({ pos: { x: v.potterGoal.x, y: 0, z: v.potterGoal.z } }, HOUSE.out) < 1.6
    ? ok : bad)('first evening tick anchors the potter goal to the doorstep (±1.5)');
  step(ents, v, 90);        // plenty o' time to walk t' ~42 blocks home
  (distTo(v, HOUSE.out) < 4 ? ok : bad)(`by evening's end they're stood at their own door (dist ${distTo(v, HOUSE.out).toFixed(1)})`);
  (v.model.group.visible ? ok : bad)('they stay VISIBLE through the evening');

  // pottering is tight: every fresh goal through a long evening hugs the step
  let maxGoal = 0;
  for (let i = 0; i < 1200; i++) { // 60 s more o' doorstep pottering
    step(ents, v, 0.05);
    if (v.potterGoal) maxGoal = Math.max(maxGoal, Math.hypot(v.potterGoal.x - HOUSE.out.x, v.potterGoal.z - HOUSE.out.z));
  }
  (maxGoal < 1.6 ? ok : bad)(`doorstep potter stays tight (max goal radius ${maxGoal.toFixed(2)} < 1.6)`);

  // now an' then they turn to face t' door (old habit kept)
  let faced = 0;
  for (let i = 0; i < 2400; i++) { // 120 s
    step(ents, v, 0.05);
    const sp = Math.hypot(v.vel.x, v.vel.z);
    const face = Math.atan2(HOUSE.inside.x - v.pos.x, HOUSE.inside.z - v.pos.z);
    let d = Math.abs(v.yaw - face) % (Math.PI * 2);
    if (d > Math.PI) d = Math.PI * 2 - d;
    if (sp < 0.05 && d < 0.03) faced++;
  }
  (faced > 0 ? ok : bad)(`they turn to face the door now an' then (${faced} facing ticks)`);
}

// ---------------------------------------------------------------------------
// (b) dead o' neet: housed folk finally wink out; dawn brings 'em back
// ---------------------------------------------------------------------------
console.log('\n== dead o\' neet: hidden; dawn: back about their day ==');
{
  const ents = makeArena();
  const v = makeVillagerAt(ents, { house: HOUSE });
  ents.game.sky.time = 0.8;
  step(ents, v, 1);
  (v.model.group.visible ? ok : bad)('0.80 (evening) — visible on the doorstep');
  ents.game.sky.time = 0.92; // dead o' neet, past BEDTIME (0.88)
  step(ents, v, 0.05);
  (!v.model.group.visible ? ok : bad)('0.92 (dead o\' neet) — hidden abed');
  ents.game.sky.time = 0.86; // still evening on t' step
  step(ents, v, 0.05);
  (v.model.group.visible ? ok : bad)('0.86 (late evening) — still up, still visible');
  ents.game.sky.time = 0.05; // deep neet, small hours
  step(ents, v, 0.05);
  (!v.model.group.visible ? ok : bad)('0.05 (small hours) — hidden');
  ents.game.sky.time = 0.2;  // dawn — same reappear threshold as ever (0.16)
  step(ents, v, 0.05);
  (v.model.group.visible ? ok : bad)('0.20 (dawn) — back about their day, visible');
}

// ---------------------------------------------------------------------------
// (c) midday: unchanged — anchor is work / green, nowt to do wi' the doorstep
// ---------------------------------------------------------------------------
console.log('\n== midday: behaviour unchanged for housed folk ==');
{
  const ents = makeArena();
  const v = makeVillagerAt(ents, { house: HOUSE });
  ents.game.sky.time = 0.3; // morning — work time
  step(ents, v, 5);
  (v.potterGoal && Math.hypot(v.potterGoal.x - WORK.x, v.potterGoal.z - WORK.z) < 4
    ? ok : bad)('0.30 (work time) — potter goal hugs their work patch');
  (Math.hypot(v.potterGoal.x - HOUSE.out.x, v.potterGoal.z - HOUSE.out.z) > 10
    ? ok : bad)('0.30 — goal is nowhere near the doorstep');
  const ents2 = makeArena();
  const v2 = makeVillagerAt(ents2, { house: HOUSE });
  ents2.game.sky.time = 0.5; // midday — social, on t' green
  step(ents2, v2, 5);
  (v2.potterGoal && Math.hypot(v2.potterGoal.x - GREEN.x, v2.potterGoal.z - GREEN.z) < 6.5
    ? ok : bad)('0.50 (midday) — potter goal is round the green');
  (v2.model.group.visible ? ok : bad)('0.50 — visible, as ever');
}

// ---------------------------------------------------------------------------
// (d) houseless folk: exactly today's behaviour — gone at dusk, back at dawn
// ---------------------------------------------------------------------------
console.log('\n== houseless folk: unchanged ==');
{
  const ents = makeArena();
  const v = makeVillagerAt(ents, { house: null });
  ents.game.sky.time = 0.5;
  step(ents, v, 2);
  (v.model.group.visible ? ok : bad)('0.50 (midday) — about, visible');
  ents.game.sky.time = 0.78; // just past dusk — old vanish threshold (0.76)
  step(ents, v, 0.05);
  (!v.model.group.visible ? ok : bad)('0.78 (dusk) — houseless folk vanish as before');
  ents.game.sky.time = 0.82;
  step(ents, v, 0.05);
  (!v.model.group.visible ? ok : bad)('0.82 (evening) — still gone (no doorstep to stand at)');
  ents.game.sky.time = 0.2;
  step(ents, v, 0.05);
  (v.model.group.visible ? ok : bad)('0.20 (dawn) — reappears as before');
}

// ---------------------------------------------------------------------------
// (e) popTo stuck-safety still applies on the way home — no neet wedged on a wall
// ---------------------------------------------------------------------------
console.log('\n== stuck on a wall heading home: popTo frees them ==');
{
  const ents = makeArena({ wallX: 15 }); // a high wall square across the road home
  const v = makeVillagerAt(ents, { house: HOUSE });
  ents.game.sky.time = 0.8;
  step(ents, v, 60); // walkTo jams them at x≈15; homeStuck > 6 must popTo the goal
  (distTo(v, HOUSE.out) < 4 ? ok : bad)(`walled-off villager still ends up at the doorstep (dist ${distTo(v, HOUSE.out).toFixed(1)})`);
  (v.model.group.visible ? ok : bad)('an\' visible there, not wedged out o\' sight');
}

// ---------------------------------------------------------------------------
// (f) evening greets: dusk talk frae the evening pool; daytime picks unchanged
// ---------------------------------------------------------------------------
console.log('\n== evening greetings ==');
{
  (GREET_EVENING.length >= 3 && GREET_EVENING.every(l => typeof l === 'string' && l.length > 0)
    ? ok : bad)(`an evening pool of ${GREET_EVENING.length} lines, all non-empty`);
  (GREET_EVENING.every(l => !/electric|bulb|lamp-post|telly|radio/i.test(l))
    ? ok : bad)('period-true: candles an\' hearths, nowt electric');
  let eve = 0;
  for (let s = 1; s <= 200; s++) {
    const line = villagerRemark({ role: 'gossip', mood: 0.6, evening: true }, rng(s * 31 + 7));
    if (GREET_EVENING.includes(line)) eve++;
  }
  (eve > 80 ? ok : bad)(`of an evening, folk mostly talk dusk talk (${eve}/200 frae the evening pool)`);
  let dayEve = 0;
  for (let s = 1; s <= 200; s++) {
    const line = villagerRemark({ role: 'gossip', mood: 0.6 }, rng(s * 31 + 7));
    if (GREET_EVENING.includes(line)) dayEve++;
  }
  (dayEve === 0 ? ok : bad)(`by day, never a word frae the evening pool (${dayEve}/200)`);
  const r1 = villagerRemark({ role: 'shepherd', mood: 0.6, outside: true }, rng(7));
  const r2 = villagerRemark({ role: 'shepherd', mood: 0.6, outside: true }, rng(7));
  (r1 === r2 ? ok : bad)('daytime remark rng sequence untouched (deterministic as before)');
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
