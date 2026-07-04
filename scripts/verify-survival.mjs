// Winter survival model — run wi': node scripts/verify-survival.mjs
//
// Extended for Workstream D5 (docs/superpowers/plans/2026-07-04-tavern-d5-chill-fatigue.md
// Task 1): general night-chill outside warm seasons, miseryOf tiers, warmedThroughUntil
// wrap safety, and — the plan's one deliberate balance change — cold no longer deals
// health damage (the old ≤0° freeze-damage block is REMOVED, not just disabled). That
// last one is driven against a REAL Player.update tick (not just the pure miseryOf
// lookup) using the same `new Player(stub)` harness verify-gamerecord.mjs established.
import { temperatureTarget, stepTemperature, HOT_FOODS, miseryOf, warmedThroughUntil, skyTimeIsBefore } from '../src/temperature.js';
import { seasonStateAtPhase } from '../src/season.js';
import { I } from '../src/defs.js';
import { Player } from '../src/player.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const winter = seasonStateAtPhase(0.875), summer = seasonStateAtPhase(0.375);
const env = (o = {}) => ({ covered: false, nearFire: false, night: false, altitude01: 0, wetness: 0, coat: false, ...o });
// A shoulder season: cos((yearPhase-0.375)*2pi) in (0, 0.5) so warmth is a small
// positive number — "not wintry" (warmth >= 0) but also "not a warm season"
// (warmth < 0.5), the general-night-chill band the plan adds. yearPhase 0.55
// lands just past midsummer, sliding toward autumn.
const shoulder = seasonStateAtPhase(0.55);

{
  (temperatureTarget(summer, env()) === 20 ? ok : bad)('summer target is fully warm');
  (temperatureTarget(winter, env()) < 8 ? ok : bad)('winter outdoors is cold (' + temperatureTarget(winter, env()).toFixed(1) + ')');
}
{
  const out = temperatureTarget(winter, env());
  (temperatureTarget(winter, env({ nearFire: true })) === 20 ? ok : bad)('a fire keeps you warm');
  (temperatureTarget(winter, env({ covered: true })) > out ? ok : bad)('shelter is warmer than open');
  (temperatureTarget(winter, env({ coat: true })) > out ? ok : bad)('a coat is warmer');
  (temperatureTarget(winter, env({ night: true })) < out ? ok : bad)('night is colder');
  (temperatureTarget(winter, env({ wetness: 1 })) < out ? ok : bad)('wet is colder');
  (temperatureTarget(winter, env({ altitude01: 1 })) < out ? ok : bad)('the high tops are colder');
}
{
  (stepTemperature(10, 20, 1) > 10 && stepTemperature(10, 0, 1) < 10 ? ok : bad)('temperature eases toward target');
  const warmStep = stepTemperature(10, 20, 1) - 10, chillStep = 10 - stepTemperature(10, 0, 1);
  (warmStep > chillStep ? ok : bad)('warms faster than it chills');
  (stepTemperature(19.9, 20, 100) <= 20 && stepTemperature(0.1, 0, 100) >= 0 ? ok : bad)('clamped to [0,20]');
}
{
  (HOT_FOODS.has(I.COOKED_MUTTON) && HOT_FOODS.has(I.FISH_CHIPS) ? ok : bad)('cooked foods are hot');
  (!HOT_FOODS.has(I.BILBERRIES) && !HOT_FOODS.has(I.RAW_MUTTON) ? ok : bad)('raw/cold foods are not hot');
}

// --- D5: general night-chill outside warm seasons (shoulder autumn/spring bite a
// little; summer nights stay mild; winter's own harsher night handling is untouched) ---
{
  (summer.warmth >= 0.5 ? ok : bad)('sanity: summer really is a warm season (warmth=' + summer.warmth.toFixed(2) + ')');
  (shoulder.warmth >= 0 && shoulder.warmth < 0.5 ? ok : bad)('sanity: shoulder season is not wintry but not warm either (warmth=' + shoulder.warmth.toFixed(2) + ')');
  const shoulderDay = temperatureTarget(shoulder, env());
  const shoulderNight = temperatureTarget(shoulder, env({ night: true }));
  (shoulderDay === 20 ? ok : bad)('shoulder-season daytime stays fully warm outdoors (' + shoulderDay + ')');
  (shoulderNight < shoulderDay ? ok : bad)('shoulder-season night bites a little (' + shoulderNight.toFixed(1) + ' < ' + shoulderDay + ')');
  (shoulderNight >= 14 ? ok : bad)('shoulder-season night-chill is gentle, not winter-harsh (' + shoulderNight.toFixed(1) + ' >= 14)');
  const summerNight = temperatureTarget(summer, env({ night: true }));
  (summerNight === 20 ? ok : bad)('summer nights stay mild (warm season is exempt from general night-chill, got ' + summerNight + ')');
  // winter's own night handling (x1.35 on the drop) is unchanged by the new branch —
  // re-assert the existing "night is colder" winter case still holds (already covered
  // above, but pin it again here so a regression in the new branch's placement shows up).
  const winterDay = temperatureTarget(winter, env());
  const winterNight = temperatureTarget(winter, env({ night: true }));
  (winterNight < winterDay ? ok : bad)('winter night-chill (harsher, x1.35) is untouched by the new shoulder-season branch');
}

// --- D5: miseryOf pure tier lookup ---
{
  (miseryOf(20) === 'none' && miseryOf(12) === 'none' ? ok : bad)('miseryOf: >=12 is none');
  (miseryOf(11.9) === 'chilled' && miseryOf(6) === 'chilled' ? ok : bad)('miseryOf: [6,12) is chilled');
  (miseryOf(5.9) === 'stiff' && miseryOf(0.1) === 'stiff' ? ok : bad)('miseryOf: (0,6) is stiff');
  (miseryOf(0) === 'perishing' && miseryOf(-5) === 'perishing' ? ok : bad)('miseryOf: <=0 is perishing');
}

// --- D5: warmedThroughUntil / skyTimeIsBefore — monotonic day+time axis, wrap-safe ---
{
  // granted mid-morning today (day 3, time 0.5): expiry is tomorrow's morning (day 4.25)
  const grantedDay = 3 + 0.5;
  const expiry1 = warmedThroughUntil(grantedDay);
  (expiry1 === 4.25 ? ok : bad)('warmedThroughUntil: granted after today\'s morning expires tomorrow morning (got ' + expiry1 + ')');
  (skyTimeIsBefore(3.6, expiry1) ? ok : bad)('skyTimeIsBefore: later same evening is still before expiry');
  (skyTimeIsBefore(3.999, expiry1) ? ok : bad)('skyTimeIsBefore: just before midnight rollover is still before expiry (wrap case)');
  (skyTimeIsBefore(4.1, expiry1) ? ok : bad)('skyTimeIsBefore: after midnight, before tomorrow\'s morning, is still before expiry (wrap case)');
  (!skyTimeIsBefore(4.25, expiry1) ? ok : bad)('skyTimeIsBefore: at the expiry instant is NOT before it');
  (!skyTimeIsBefore(4.3, expiry1) ? ok : bad)('skyTimeIsBefore: past tomorrow\'s morning is NOT before expiry');

  // granted before today's own morning boundary (day 3, time 0.1): expiry is TODAY's morning
  const grantedEarly = 3 + 0.1;
  const expiry2 = warmedThroughUntil(grantedEarly);
  (expiry2 === 3.25 ? ok : bad)('warmedThroughUntil: granted before today\'s morning expires later today (got ' + expiry2 + ')');
  (skyTimeIsBefore(3.2, expiry2) ? ok : bad)('skyTimeIsBefore: still before today\'s own morning expiry');
  (!skyTimeIsBefore(3.3, expiry2) ? ok : bad)('skyTimeIsBefore: past today\'s own morning expiry is NOT before it');

  (!skyTimeIsBefore(5, null) ? ok : bad)('skyTimeIsBefore: a null warmedUntil (no buff) is never "before" anything');
}

// --- D5: the ONE deliberate balance change — cold is misery, NEVER death.
// Drives a REAL Player.update tick (not just the pure miseryOf lookup) at
// temperature 0 for well past the old 4s freeze-damage interval, grounded so
// it doesn't just fall out of the world. Confirmed failing-first against the
// pre-change code (git-stashed probe, 25s simulated at temp 0): health fell
// from 20 to 14 there. Post-change: zero health loss, ever, from cold alone. ---
{
  const stub = { getBlock(x, y) { return y < 1 ? 1 : 0; }, isLoaded() { return true; }, gen: { geo: { coastT: () => 0 } } };
  const p = new Player(stub);
  p.pos.y = 1.001;
  p.onGround = true;
  p.temperature = 0; // 'perishing' per miseryOf — the old code's exact freeze-damage threshold
  const input = { keys: {} };
  const deepWinter = { warmth: -1 };
  // 25 simulated seconds at 0.5s steps: the old block fired damage every 4s
  // (so this would have hit ~6 ticks / 6 HP lost under the removed code).
  for (let i = 0; i < 50; i++) p.update(0.5, input, null, deepWinter);
  check_survival(p.health === 20, 'a full survival tick at temperature 0 for 25s deals ZERO health damage (health=' + p.health + ')');
  check_survival(!p.dead, 'the player is not dead from cold alone');
  check_survival(p.deathCause !== 'Froze to death on t’ moor', 'the removed freeze deathCause never fires (deathCause=' + JSON.stringify(p.deathCause) + ')');
  check_survival(p.fatigue > 0, 'fatigue accrues over the same real tick (time-awake rate) — fatigue=' + p.fatigue.toFixed(4));
  check_survival(p.fatigue <= 20, 'fatigue never exceeds its cap');
}
function check_survival(c, m) { (c ? ok : bad)(m); }

// --- D5: fatigue exertion signal is honest — idle ticking accrues at
// RATE_AWAKE only; the exhaustion bump main.js's updateMining applies on a
// finished swing (this.player.exhaustion += 0.03, a fixed non-dt-scaled jump
// well above any tick's idle hunger-creep baseline) is recognised as exertion
// and accrues fatigue faster, WITHOUT player.js needing a dedicated
// "miningActive" flag it has no way to see (main.js applies that bump outside
// Player.update — see the comment at the fatigue-accrual site in player.js). ---
{
  const stub = { getBlock(x, y) { return y < 1 ? 1 : 0; }, isLoaded() { return true; }, gen: { geo: { coastT: () => 0 } } };
  const mildSeason = { warmth: 1 };
  const idleInput = { keys: {} };

  const idle = new Player(stub);
  idle.pos.y = 1.001; idle.onGround = true; idle.temperature = 20;
  for (let i = 0; i < 20; i++) idle.update(0.5, idleInput, null, mildSeason);

  const miner = new Player(stub);
  miner.pos.y = 1.001; miner.onGround = true; miner.temperature = 20;
  for (let i = 0; i < 20; i++) {
    miner.update(0.5, idleInput, null, mildSeason);
    miner.exhaustion += 0.03; // simulates main.js's updateMining bump on a finished break
  }
  check_survival(miner.fatigue > idle.fatigue, 'a player whose exhaustion is bumped by (simulated) mining accrues MORE fatigue than a truly idle player (' + miner.fatigue.toFixed(4) + ' > ' + idle.fatigue.toFixed(4) + ')');
}

// --- D5: fatigue/warmedUntil are additive save fields (constructor default,
// serialize round-trip, and old-save migration — matching the house pattern
// verify-gamerecord.mjs pins for gameRecord) ---
{
  const stub = { getBlock() { return 0; }, isLoaded() { return true; } };
  const p = new Player(stub);
  check_survival(p.fatigue === 0, 'a fresh player starts at fatigue 0');
  check_survival(p.warmedUntil === null, 'a fresh player has no warmedUntil buff');

  p.fatigue = 12.5;
  p.warmedUntil = 7.25;
  const saved = p.serialize();
  check_survival(saved.fatigue === 12.5, 'serialize preserves fatigue');
  check_survival(saved.warmedUntil === 7.25, 'serialize preserves warmedUntil');

  const p2 = new Player(stub);
  p2.deserialize(saved);
  check_survival(p2.fatigue === 12.5, 'deserialize restores fatigue');
  check_survival(p2.warmedUntil === 7.25, 'deserialize restores warmedUntil');

  // additive protocol: an old save without these fields migrates cleanly
  const p3 = new Player(stub);
  p3.deserialize({ pos: { x: 0, y: 0, z: 0 } });
  check_survival(p3.fatigue === 0, 'an old save without fatigue migrates to 0');
  check_survival(p3.warmedUntil === null, 'an old save without warmedUntil migrates to null');
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
