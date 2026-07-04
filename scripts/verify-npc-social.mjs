// NPC social natter: idle, at-home neighbours who drift near each other STOP, turn face-to-face
// and hold a few seconds before moving on — a physical behaviour that needs no generated dialogue
// (the LLM voice, when a player's near, is layered on top by _maybeBanter). James 2026-07-04.
// run: node scripts/verify-npc-social.mjs
//
// Drives the REAL RosterClient._socialScan / _natterHold over a minimal harness (the class
// methods on a bare instance, with just the collaborators they touch stubbed).
global.document = { createElement: () => ({ getContext: () => ({}), width: 0, height: 0 }) };
global.location = { hostname: 'verify-headless' };
global.performance = global.performance || { now: () => 0 };

import { RosterClient } from '../src/roster.js';
import { B } from '../src/defs.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// a bare RosterClient with only what _socialScan / _natterHold reach into
const rc = Object.create(RosterClient.prototype);
let NOW = 100;
rc._nowEff = () => NOW;
rc.world = { isLoaded: () => true, getBlock: (x, y, z) => (y <= 0 ? B.DIRT : B.AIR), setBlock: () => {} };
rc.npcs = new Map();

const mkMob = (x, z) => ({ pos: { x, y: 1, z }, vel: { x: 0, y: 0, z: 0 }, hw: 0.3, h: 1.7, onGround: false, yaw: 0 });
const addNpc = (id, x, z) => { const e = { data: { id, state: { kind: 'at' } }, mob: mkMob(x, z) }; rc.npcs.set(id, e); return e; };
// force the throttled scan to run this call, with the RNG pinned so a near idle pair always strikes up
const scanNow = () => { const R = Math.random; Math.random = () => 0; rc._natterScan = 0; rc._socialScan(1.5); Math.random = R; };
const clearPairing = (...es) => es.forEach(e => { e.mob._natter = null; e.mob._natterCool = 0; });

const A = addNpc('a', 10, 10);
const C = addNpc('b', 11.5, 10);   // 1.5 blocks off A — within meeting range

// 1. two idle neighbours who drift near each other pair up, MUTUALLY
scanNow();
(A.mob._natter && A.mob._natter.other === C.mob && C.mob._natter && C.mob._natter.other === A.mob ? ok : bad)
  (`two idle neighbours pair up to natter (mutual)`);
(A.mob._natter && Math.abs(A.mob._natter.until - (NOW + 4)) < 1e-9 ? ok : bad)
  (`the natter has a short lifespan (until = now + ${(A.mob._natter ? A.mob._natter.until - NOW : NaN)}s)`);

// 2. mid-natter she stands still, faces her neighbour, stills her legs — and the hold returns true
const held = rc._natterHold(A.mob, NOW, 1 / 30);
// C sits at +x from A (dx=1.5, dz=0) so A should face +x -> yaw atan2(1.5,0) = PI/2
(held === true && A.mob.walkPhase === 0 && Math.abs(A.mob.yaw - Math.PI / 2) < 0.01 &&
  A.mob.activityShort === 'passing the time of day' ? ok : bad)
  (`mid-natter she stands, faces the neighbour, legs stilled (held=${held}, yaw=${A.mob.yaw.toFixed(2)})`);

// 3. when the time's up the natter ends and a cooldown is set (no perpetual vigils)
NOW = 105;   // past until (104)
const ended = rc._natterHold(A.mob, NOW, 1 / 30);
(ended === false && A.mob._natter === null && A.mob._natterCool > NOW && A.mob._natterCool <= NOW + 60 ? ok : bad)
  (`the natter ends on time and starts a cooldown (cool=+${(A.mob._natterCool - NOW).toFixed(0)}s)`);

// 4. if the partner strays (pulled onto an errand), the natter ends early
clearPairing(A, C); NOW = 200; scanNow();
const paired = !!A.mob._natter;
C.mob.pos.x = 99;   // partner walks off
const strayEnded = rc._natterHold(A.mob, NOW, 1 / 30);
(paired && strayEnded === false && A.mob._natter === null ? ok : bad)
  (`a natter ends the moment the partner strays out of range`);

// 5. a body on cooldown will not immediately strike up another natter
clearPairing(A, C); C.mob.pos.x = 11.5;   // near again
A.mob._natterCool = 300; NOW = 250;        // A still cooling
scanNow();
(!A.mob._natter ? ok : bad)(`a body on cooldown does not re-pair straight away`);

// 6. neighbours too far apart never pair
clearPairing(A, C); C.mob.pos.x = 20;   // 10 blocks off
NOW = 400; scanNow();
(!A.mob._natter ? ok : bad)(`neighbours too far apart don't natter`);

// 7. travellers (not idle 'at') never stop to natter — only at-home folk do
clearPairing(A, C); C.mob.pos.x = 11.5; A.data.state.kind = 'walk';
NOW = 500; scanNow();
(!A.mob._natter && !C.mob._natter ? ok : bad)(`a traveller (state 'walk') does not stop to natter`);
A.data.state.kind = 'at';

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
