// Festive winter — run wi': node scripts/verify-festive.mjs
import { wintry, deepSnow, snowmanMelted } from '../src/festive.js';
import { SCARF_COLORS, HATS, NOSES, DEFAULT_SNOWMAN, cycleSnowman } from '../src/snowman.js';
import { seasonStateAtPhase } from '../src/season.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const winter = seasonStateAtPhase(0.875), summer = seasonStateAtPhase(0.375), spring = seasonStateAtPhase(0.18);

(wintry(winter) ? ok : bad)('winter is the cold season');
(!wintry(summer) ? ok : bad)('summer is not the cold season');
(deepSnow(0.9) && !deepSnow(0.5) ? ok : bad)('auto-snowmen only when snow is deepest');
(snowmanMelted(spring) && !snowmanMelted(winter) ? ok : bad)('player snowmen melt in the thaw, not mid-winter');
{
  let c = { ...DEFAULT_SNOWMAN };
  const s0 = c.scarf; c = cycleSnowman(c, 'scarf');
  (c.scarf === (s0 + 1) % SCARF_COLORS.length ? ok : bad)('scarf colour cycles');
  c = cycleSnowman(c, 'hat'); (HATS.includes(c.hat) ? ok : bad)('hat cycles within HATS');
  c = cycleSnowman(c, 'nose'); (NOSES.includes(c.nose) ? ok : bad)('nose cycles within NOSES');
  const a = c.arms; c = cycleSnowman(c, 'arms'); (c.arms === !a ? ok : bad)('arms toggle');
  (cycleSnowman(c, 'scarf') !== c ? ok : bad)('cycle returns a new object (no mutation)');
}

// snowmanLedger: record -> get; melts in the spring thaw
{
  const { World } = await import('../src/world.js');
  const w = new World(null, 1234);
  w.recordSnowman(3, 28, 7, { ...DEFAULT_SNOWMAN, scarf: 2 }, 800);
  (w.getSnowman(3, 28, 7)?.cfg.scarf === 2 ? ok : bad)('a built snowman is remembered');
  w.meltSnowmen(seasonStateAtPhase(0.875));
  (w.getSnowman(3, 28, 7) ? ok : bad)('snowmen survive mid-winter');
  w.meltSnowmen(seasonStateAtPhase(0.18));
  (!w.getSnowman(3, 28, 7) ? ok : bad)('snowmen melt in spring');
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
