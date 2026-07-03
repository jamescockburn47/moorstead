// Conversation etiquette: one ambient voice at a time near the player, a quiet
// period between barks, silence while the chat window is open, and a low random
// baseline. Pure-function tests + source-wiring assertions.
import { readFileSync } from 'node:fs';
import {
  canNosy, nosyWants, ambientQuietAfter,
  AMBIENT_QUIET_MIN, AMBIENT_QUIET_MAX, NOSY_RANDOM_BASE,
} from '../src/villagerlife.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const check = (c, m) => (c ? ok(m) : bad(m));

// --- canNosy: every blocker blocks ---
const base = { hasToken: false, approaching: false, chatting: false, bubble: false,
               playerDead: false, chatOpen: false, quietLeft: 0, cd: 0, dist: 5 };
check(canNosy(base) === true, 'clear path -> may start a nosy approach');
check(canNosy({ ...base, hasToken: true }) === false, 'token held elsewhere blocks');
check(canNosy({ ...base, chatOpen: true }) === false, 'open chat window blocks ALL approaches');
check(canNosy({ ...base, quietLeft: 5 }) === false, 'quiet period blocks a new approach');
check(canNosy({ ...base, quietLeft: 3.9 }) === true, 'quiet nearly over (<=4s) -> approach may start');
check(canNosy({ ...base, bubble: true }) === false, 'own live bubble blocks');
check(canNosy({ ...base, chatting: true }) === false, 'engaged villager never re-approaches');
check(canNosy({ ...base, playerDead: true }) === false, 'dead player blocks');
check(canNosy({ ...base, cd: 1 }) === false, 'personal cooldown blocks');
check(canNosy({ ...base, dist: 10 }) === false, 'too far blocks');
check(canNosy({ ...base, dist: 2 }) === false, 'too close blocks');

// --- nosyWants: baseline is genuinely low, triggers still fire ---
check(NOSY_RANDOM_BASE <= 0.05, 'random baseline cut to <=5% (was 16%)');
check(nosyWants({ nearBuild: true }, 0.99) === true, 'building nearby always draws a look');
check(nosyWants({ roam: true }, 0.99) === true, 'roamers still wander over');
check(nosyWants({ sociable: 0.9 }, 0.99) === true, 'sociable folk still come');
check(nosyWants({ sociable: 0.5 }, 0.5) === false, 'ordinary folk mostly do not');
check(nosyWants({ sociable: 0.5 }, NOSY_RANDOM_BASE / 2) === true, 'rare random nosiness survives');

// --- quiet period: bubble life + 10..15s, monotone in rand ---
check(ambientQuietAfter(8, 0) === 8 + AMBIENT_QUIET_MIN, 'min quiet = secs + 10');
check(ambientQuietAfter(8, 1) === 8 + AMBIENT_QUIET_MAX, 'max quiet = secs + 15');
check(AMBIENT_QUIET_MIN >= 10 && AMBIENT_QUIET_MAX <= 15, 'quiet window is 10-15s per spec');

// --- simulation: N eager villagers, one voice at a time, never overlapping ---
{
  const mobs = Array.from({ length: 6 }, (_, i) => ({ id: i, cd: 0, bubbleT: 0 }));
  let quiet = 0, token = null, overlaps = 0, spoke = 0;
  for (let f = 0; f < 4000; f++) {           // 400s of 0.1s frames
    const dt = 0.1;
    quiet = Math.max(0, quiet - dt);
    for (const m of mobs) {
      m.cd = Math.max(0, m.cd - dt);
      m.bubbleT = Math.max(0, m.bubbleT - dt);
      if (token === m && m.approachT != null && (m.approachT -= dt) <= 0) {
        // end of approach: speak only through the gate
        if (quiet <= 0) { m.bubbleT = 8; quiet = ambientQuietAfter(8, 0.5); spoke++; }
        m.approachT = null; token = null;
      }
      if (!token && canNosy({ hasToken: false, approaching: m.approachT != null,
          chatting: false, bubble: m.bubbleT > 0, playerDead: false, chatOpen: false,
          quietLeft: quiet, cd: m.cd, dist: 5 })) {
        token = m; m.approachT = 3; m.cd = 30;
      }
    }
    if (mobs.filter(m => m.bubbleT > 0).length > 1) overlaps++;
  }
  check(overlaps === 0, 'no two ambient bubbles ever live at once');
  check(spoke >= 5, `the parish still talks (${spoke} barks in 400s)`);
  check(spoke <= 25, `but not constantly (${spoke} barks in 400s)`);
}

// --- source wiring: entities/main/roster actually use the gate ---
// NOTE: these are EXPECTED to fail until Tasks 2-4 land — that's fine, this script
// reports them as ordinary FAILs (not a crash), same as any other in-progress check.
const ent = readFileSync(new URL('../src/entities.js', import.meta.url), 'utf8');
check(/speakAmbient\(/.test(ent), 'entities.js defines/uses speakAmbient');
check(/canNosy\(/.test(ent), 'entities.js gates the nosy trigger through canNosy');
check(!/Math\.random\(\)\s*<\s*0\.16/.test(ent), 'old 16% inline baseline is gone');
const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
check(/this\.chatOpen\s*=\s*true/.test(mainSrc) && /this\.chatOpen\s*=\s*false/.test(mainSrc),
   'main.js tracks chatOpen across openChat/closeChat');
const ros = readFileSync(new URL('../src/roster.js', import.meta.url), 'utf8');
check(/speakAmbient\(/.test(ros), 'roster banter near the player goes through the ambient gate');

console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
