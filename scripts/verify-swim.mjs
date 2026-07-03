// Swimming + river current — run wi': node scripts/verify-swim.mjs
//
// James 2026-07-03: "the river doesn't seem to bring a player downstream. we should
// have a 'swim' function too." Two features, one gate:
//   1. SWIM — chest-deep = swim state: look-direction strokes, tread-at-the-surface
//      by default (bairns don't drown), Space kicks up, Shift dives, slow sink when
//      tha lets go. Wading (feet-only) keeps normal legs an' a proper jump.
//   2. CURRENT — river columns carry thee downstream: tangent × bank × base. Sea,
//      tarns an' the stylised world have NO current (riverFlow null / absent).
// Plus: water absorbs fall damage (bridge-jumping into t' Esk is fun, not fatal),
// an' a flowing beck never tires thee (still deep water — the sea — still does).
//
// Pure helpers live in src/physics.js; the full Player contract is exercised on a
// stub world (the verify-economy.mjs pattern — real Player, fake getBlock).

import { SWIM, submersion, swimWish, swimVerticalWish, swimVerticalStep, riverCurrent, steeredCurrent, currentAt } from '../src/physics.js';
import { Player } from '../src/player.js';
import { B } from '../src/defs.js';
import { seasonStateAtPhase } from '../src/season.js';

let failed = false;
const ok  = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// player.js locomotion constants (not exported — update here if those change)
const WALK = 4.3, SPRINT = 6.4;
const STROKE = WALK * SWIM.SPEED_MUL, SPRINT_STROKE = SPRINT * SWIM.SPEED_MUL;

// ---------- stub worlds ----------
// flat stone to bedY, water bedY+1..bedY+depth, air above — an endless still lake
const lake = (depth, bedY = 25) => ({
  getBlock: (x, y, z) => (y <= bedY ? B.STONE : (y <= bedY + depth ? B.WATER : B.AIR)),
  isLoaded: () => true,
  gen: {},
});
const dryLand = (topY = 25) => ({
  getBlock: (x, y, z) => (y <= topY ? B.STONE : B.AIR),
  isLoaded: () => true,
  gen: {},
});
const summer = seasonStateAtPhase(0.375);
const STEP = 1 / 60;
const sim = (p, seconds, keys = {}) => {
  const input = { keys, jumpTapped: false };
  for (let t = 0; t < seconds; t += STEP) p.update(STEP, input, null, summer);
};
const mkPlayer = (world, x, y, z) => {
  const p = new Player(world);
  p.pos = { x, y, z };
  return p;
};

// --- submersion: chest-deep = swim, feet-only = wade, surfaceY = top o' t' watter ---
{
  const w3 = lake(3); // water 26,27,28 → surface top face at 29
  const dry = submersion(dryLand(), 0.5, 26.0001, 0.5);
  (!dry.feet && !dry.chest && !dry.head && dry.surfaceY === null ? ok : bad)('dry land: nowt submerged, no surface');
  const wade = submersion(lake(1), 0.5, 26.0001, 0.5);
  (wade.feet && !wade.chest && wade.surfaceY === null ? ok : bad)('1-deep watter: feet wet, chest dry — wading, not swimming');
  const swim3 = submersion(w3, 0.5, 26.0001, 0.5);
  (swim3.feet && swim3.chest && swim3.head && swim3.surfaceY === 29 ? ok : bad)('3-deep watter: chest-deep = swimming, surface found at t’ top face');
  (JSON.stringify(submersion(w3, 0.5, 26.5, 0.5)) === JSON.stringify(submersion(w3, 0.5, 26.5, 0.5)) ? ok : bad)('deterministic — same column, same answer');
  // a 2-deep beck bed keeps t' eye INSIDE t' tread band — every river is self-rescuing
  const bed2 = submersion(lake(2), 0.5, 26.0001, 0.5);
  (bed2.surfaceY - (26.0001 + 1.62) < SWIM.TREAD_BAND ? ok : bad)('standing on a 2-deep beck bed (BED_DEPTH=2), t’ tread float still reaches thee');
}

// --- swimWish: strokes follow t' LOOK ---
{
  const level = swimWish(0, 0, 1, 0, STROKE);
  (near(level.x, 0) && near(level.y, 0) && near(level.z, -STROKE) ? ok : bad)('level forward stroke matches walk heading (yaw 0 → -z), no vertical');
  const up = swimWish(0, 0.6, 1, 0, STROKE);
  (up.y > 0 && near(Math.hypot(up.x, up.y, up.z), STROKE, 1e-6) ? ok : bad)('look up an’ swim up — full stroke magnitude preserved');
  const down = swimWish(0, -0.6, 1, 0, STROKE);
  (down.y < 0 ? ok : bad)('look down an’ swim down');
  const strafe = swimWish(0, -1.2, 0, 1, STROKE);
  (near(strafe.y, 0) ? ok : bad)('strafe stays level whatever t’ pitch');
}

// --- swimVerticalWish: t' swim state machine ---
{
  const deep = { lookY: 0, stroking: false, eyeY: 20, surfaceY: 29, bobT: 0 };
  (swimVerticalWish(deep) === SWIM.SINK_V ? ok : bad)('let go o’ everything deep down: a slow sink (' + SWIM.SINK_V + ' b/s), not a plummet');
  (swimVerticalWish({ ...deep, space: true }) >= SWIM.RISE_V ? ok : bad)('Space thrusts thee up');
  (swimVerticalWish({ ...deep, shift: true }) <= -SWIM.DIVE_V ? ok : bad)('Shift dives thee down');
  const below = swimVerticalWish({ lookY: 0, stroking: false, eyeY: 28.5, surfaceY: 29, bobT: 0 });
  (below > 0 ? ok : bad)('near t’ surface wi’ eyes under: t’ tread floats thee UP');
  const above = swimVerticalWish({ lookY: 0, stroking: false, eyeY: 29.6, surfaceY: 29, bobT: 0 });
  (above < 0 ? ok : bad)('bobbed ower t’ waterline: t’ tread settles thee back DOWN');
  const tired = swimVerticalWish({ lookY: 0, stroking: false, eyeY: 29 + SWIM.TREAD_EYE, surfaceY: 29, tiring: true, bobT: 0 });
  (tired < 0 ? ok : bad)('wearied treading sags — thi head slips under (t’ sea stays a real danger)');
  const dive = swimVerticalWish({ lookY: -2, stroking: true, diving: true, eyeY: 28.9, surfaceY: 29, bobT: 0 });
  (near(dive, -2) ? ok : bad)('a deliberate down-look stroke cuts through t’ tread (tha can dive off t’ surface)');
  const stroke = swimVerticalWish({ lookY: 0, stroking: true, eyeY: 20, surfaceY: 29, bobT: 0 });
  (stroke === 0 ? ok : bad)('a level mid-water stroke holds depth (neutral, nowt sinking)');
}

// --- swimVerticalStep: drag both ways, hard entries slapped off fast ---
{
  const gentle = swimVerticalStep(0, 2, STEP);
  (gentle > 0 && gentle < 2 ? ok : bad)('velocity bends toward t’ wish, never jumps to it');
  (swimVerticalStep(0, 2, 10) === 2 ? ok : bad)('big dt clamps AT t’ wish — no overshoot ever');
  const hard = -20;
  const brakeHard = swimVerticalStep(hard, SWIM.SINK_V, STEP) - hard;
  const brakeSoft = (swimVerticalStep(-2, SWIM.SINK_V, STEP) - (-2)) / (SWIM.SINK_V - (-2));
  (brakeHard / (SWIM.SINK_V - hard) > brakeSoft ? ok : bad)('a plunging entry brakes harder than a gentle sink (watter slaps back)');
}

// --- riverCurrent: tangent × bank × base; nowt off-river ---
{
  (riverCurrent(null) === null ? ok : bad)('off-river / sea / tarn (flow null): NO current');
  (riverCurrent({ tx: 1, tz: 0, s: 0, bank: 0 }) === null ? ok : bad)('at t’ very bank edge (bank 0): no drag');
  const mid = riverCurrent({ tx: 1, tz: 0, s: 5, bank: 1 });
  (near(mid.x, SWIM.CURRENT_BASE) && near(mid.z, 0) ? ok : bad)('mid-channel: full base drift downstream (' + SWIM.CURRENT_BASE + ' b/s)');
  const half = riverCurrent({ tx: 0, tz: -1, s: 5, bank: 0.5 });
  (near(half.z, -SWIM.CURRENT_BASE * 0.5) && near(half.x, 0) ? ok : bad)('linear in bank: half-way ower = half t’ carry, along t’ tangent');
  (JSON.stringify(riverCurrent({ tx: 1, tz: 0, s: 1, bank: 0.7 })) === JSON.stringify(riverCurrent({ tx: 1, tz: 0, s: 1, bank: 0.7 })) ? ok : bad)('deterministic — pure function o’ position via riverFlow');
}

// --- steeredCurrent: t' edge steer keeps a rider mid-stream (Grosmont pocket bug) ---
{
  // a channel centred on x=0 flowing +z: bank falls off linearly wi' |x|
  const chan = (x, z) => { const bank = 1 - Math.abs(x) / 3; return bank > 0 ? { tx: 0, tz: 1, s: z, bank } : null; };
  const mid = steeredCurrent(chan, 0, 0);
  (near(mid.x, 0) && near(mid.z, SWIM.CURRENT_BASE) ? ok : bad)('mid-channel: no steer, pure downstream carry');
  const edge = steeredCurrent(chan, 1.5, 0);
  (edge.x < -0.3 && edge.z > 0 ? ok : bad)('near t’ right bank: pulled back toward mid-stream while still carried down');
  const edgeL = steeredCurrent(chan, -1.5, 0);
  (edgeL.x > 0.3 ? ok : bad)('…an’ t’ mirror side pulls t’ other way');
  (Math.abs(edge.x) < STROKE ? ok : bad)('t’ steer stays weaker than a stroke — grabbing t’ bank is still winnable');
  // slack pocket just OFF t' field (t' Grosmont bug): eased back toward t' stream, still carried
  const pocket = steeredCurrent(chan, 4, 0);
  (pocket && pocket.x < -0.5 && pocket.z > 0 ? ok : bad)('a flow-null pocket pulls thee back to t’ stream — t’ field edge is no cliff');
  (Math.hypot(pocket.x, pocket.z - SWIM.CURRENT_BASE * 0) < STROKE + SWIM.CURRENT_BASE && SWIM.POCKET_PULL < STROKE ? ok : bad)('…an’ t’ pocket pull is beatable by a stroke');
  (steeredCurrent(() => null, 0, 0) === null ? ok : bad)('no flow anywhere near (sea/tarn): genuinely no current');
}

// --- currentAt: t' stylised-world guard (same typeof idiom as mesher.js) ---
{
  (currentAt(null, 0, 0) === null ? ok : bad)('no geo at all: no current');
  (currentAt({}, 0, 0) === null ? ok : bad)('stylised Geography (no riverFlow method): no current');
  const geo = { riverFlow: () => ({ tx: 1, tz: 0, s: 0, bank: 1 }) };
  (near(currentAt(geo, 0, 0).x, SWIM.CURRENT_BASE) ? ok : bad)('Moors geo wi’ riverFlow: current flows');
  (currentAt({ riverFlow: () => null }, 0, 0) === null ? ok : bad)('riverFlow null (sea/tarn column): no current');
  // t' Esk-mouth guard: riverFlow's tail runs past t' mouth, so coastT kills t' current at sea
  const mouth = { riverFlow: () => ({ tx: 1, tz: 0, s: 999, bank: 1 }), coastT: () => 0.9 };
  (currentAt(mouth, 0, 0) === null ? ok : bad)('brackish/sea column (coastT > 0.15): current dies at t’ river mouth');
  const fresh = { riverFlow: () => ({ tx: 1, tz: 0, s: 10, bank: 1 }), coastT: () => 0 };
  (near(currentAt(fresh, 0, 0).x, SWIM.CURRENT_BASE) ? ok : bad)('fresh watter inland (coastT 0): t’ beck still carries');
}

// --- t' feel contract: t' numbers James signed off (2026-07-03) ---
{
  (SWIM.CURRENT_BASE > STROKE ? ok : bad)('upstream mid-channel is a LOSING battle (current ' + SWIM.CURRENT_BASE + ' > stroke ' + STROKE.toFixed(2) + ')');
  (SWIM.CURRENT_BASE * 0.25 < STROKE ? ok : bad)('upstream near t’ bank (bank 0.25) is a WINNABLE one');
  (SPRINT_STROKE > SWIM.CURRENT_BASE ? ok : bad)('a flat-out sprint stroke can just beat mid-channel (heroic, ' + SPRINT_STROKE.toFixed(2) + ' vs ' + SWIM.CURRENT_BASE + ')');
  (STROKE < WALK ? ok : bad)('swimming is slower than walking');
}

// ============ full Player contract on a stub world ============

// --- tread by default: a bairn in deep watter floats, breathes, an' lives ---
{
  const p = mkPlayer(lake(3), 0.5, 26.0001, 0.5);
  sim(p, 5);
  const eyeY = p.pos.y + p.eye;
  (Math.abs(eyeY - 29) < 0.4 ? ok : bad)('5s idle in a 3-deep pool: treading wi’ eyes at t’ waterline (eye ' + eyeY.toFixed(2) + ' vs surface 29)');
  (p.air === 10 && p.health === 20 && !p.dead ? ok : bad)('…full air, full health — nobody drowns by default');
}

// --- still deep water still tires thee (t' open sea stays a real danger) ---
{
  const p = mkPlayer(lake(6), 0.5, 29, 0.5);
  sim(p, 20);
  (p.swimTime > 12 ? ok : bad)('20s treading STILL deep watter: wearied (swimTime ' + p.swimTime.toFixed(1) + 's > 12)');
  (p.air < 10 ? ok : bad)('…an’ a wearied swimmer slips under — air draining (' + p.air.toFixed(1) + ')');
}

// --- a FLOWING beck never tires thee, an' carries thee downstream ---
{
  const w = lake(2);
  w.gen = { geo: { riverFlow: () => ({ tx: 1, tz: 0, s: 10, bank: 1 }) } };
  const p = mkPlayer(w, 0.5, 26.0001, 0.5);
  sim(p, 20);
  (p.air === 10 && p.health === 20 ? ok : bad)('20s riding t’ beck: full air, full health — riding t’ Esk to Whitby is a lark');
  (p.pos.x - 0.5 > SWIM.CURRENT_BASE * 20 * 0.8 ? ok : bad)('…carried properly downstream (' + (p.pos.x - 0.5).toFixed(1) + ' blocks in 20s, base ' + SWIM.CURRENT_BASE + ' b/s)');
  const eyeY = p.pos.y + p.eye;
  (Math.abs(eyeY - 28) < 0.4 ? ok : bad)('…treading at t’ surface t’ whole way down');
}

// --- a slack pocket at t' beck's edge is still t' beck: no tiring, no drowning ---
{
  const w = lake(2);
  // flow field ends at x=5 (t' Grosmont pocket): rider drifts in, flow goes null
  w.gen = { geo: { riverFlow: (x) => (x < 5 ? { tx: 1, tz: 0, s: 10, bank: 1 } : null) } };
  const p = mkPlayer(w, 0.5, 26.5, 0.5);
  sim(p, 25);
  (p.pos.x >= 5 ? ok : bad)('t’ rider drifted into t’ flow-null pocket (' + p.pos.x.toFixed(1) + ')');
  (p.air === 10 && p.health === 20 && !p.dead ? ok : bad)('…an’ 25s bobbing there is SAFE — once t’ beck’s had thee, tha stays “in t’ beck” till tha leaves t’ watter');
}

// --- upstream mid-channel: a losing battle; at t' bank: a winnable one ---
{
  const w = lake(2);
  w.gen = { geo: { riverFlow: () => ({ tx: 1, tz: 0, s: 10, bank: 1 }) } };
  const p = mkPlayer(w, 0.5, 26.5, 0.5);
  p.yaw = Math.PI / 2; // forward = -x = upstream
  sim(p, 10, { KeyW: true });
  (p.pos.x > 3 ? ok : bad)('swimming hard upstream mid-channel: still carried downstream (+' + p.pos.x.toFixed(1) + ' blocks ower 10s)');

  const w2 = lake(2);
  w2.gen = { geo: { riverFlow: () => ({ tx: 1, tz: 0, s: 10, bank: 0.25 }) } };
  const p2 = mkPlayer(w2, 0.5, 26.5, 0.5);
  p2.yaw = Math.PI / 2;
  sim(p2, 10, { KeyW: true });
  (p2.pos.x < -5 ? ok : bad)('t’ same stroke near t’ bank (bank 0.25): tha gains upstream (' + p2.pos.x.toFixed(1) + ' blocks)');
}

// --- t' sea has NO current ---
{
  const p = mkPlayer(lake(3), 0.5, 27, 0.5); // gen: {} — no geo.riverFlow at all
  sim(p, 5);
  (Math.abs(p.pos.x - 0.5) < 0.2 && Math.abs(p.pos.z - 0.5) < 0.2 ? ok : bad)('idle in flow-less watter (sea/tarn/stylised): no drift at all');
}

// --- water absorbs fall damage (James 2026-07-03: bridge-jumping is FUN) ---
{
  const p = mkPlayer(lake(1), 0.5, 40, 0.5); // 14-block drop into 1-deep watter ower stone
  sim(p, 3);
  (p.health === 20 && !p.dead ? ok : bad)('14-block drop into 1-DEEP watter: unhurt (t’ owd pre-move check missed this)');
  const p2 = mkPlayer(lake(2), 0.5, 46, 0.5); // rail-bridge height into t' beck proper
  sim(p2, 3);
  (p2.health === 20 && !p2.dead ? ok : bad)('20-block drop into t’ 2-deep beck: unhurt an’ swimming');
  const p3 = mkPlayer(dryLand(), 0.5, 40, 0.5); // same drop, dry ground — still hurts
  sim(p3, 3);
  (p3.health < 20 ? ok : bad)('t’ same drop onto dry stone still hurts (' + p3.health + '/20) — watter is t’ soft option');
}

// --- wading keeps normal legs: tha can JUMP out o' t' shallows ---
{
  const p = mkPlayer(lake(1), 0.5, 26.0001, 0.5);
  let apex = p.pos.y;
  const input = { keys: { Space: true }, jumpTapped: false };
  for (let t = 0; t < 1; t += STEP) { p.update(STEP, input, null, summer); apex = Math.max(apex, p.pos.y); }
  (apex > 27.2 ? ok : bad)('ankle-deep in t’ beck, Space is a proper JUMP (apex +' + (apex - 26).toFixed(2) + ' blocks), not a feeble float');
}

// --- climbing out: swim at a 1-block bank an' tha vaults ower t' lip ---
{
  // watter (2 deep, surface top 28) west o' x=0; bank stone up to y=27 (walk surface 28) east
  const w = {
    getBlock: (x, y, z) => (x >= 0 ? (y <= 27 ? B.STONE : B.AIR) : (y <= 25 ? B.STONE : (y <= 27 ? B.WATER : B.AIR))),
    isLoaded: () => true,
    gen: {},
  };
  const p = mkPlayer(w, -1.5, 26.2, 0.5);
  p.yaw = -Math.PI / 2; // forward = +x, straight at t' bank
  sim(p, 4, { KeyW: true });
  (p.pos.x > 0.3 && p.pos.y >= 27.9 && p.onGround ? ok : bad)('swimming at a 1-block bank climbs thee out onto it (' + p.pos.x.toFixed(1) + ', ' + p.pos.y.toFixed(1) + ')');
}

// --- no save-format change: swim state is transient ---
{
  const p = mkPlayer(lake(3), 0.5, 27, 0.5);
  sim(p, 2);
  const s = p.serialize();
  (!('swimTime' in s) && !('_bobT' in s) && !('_beck' in s) ? ok : bad)('serialize() carries NO swim keys — save format untouched');
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
