// Festive winter — run wi': node scripts/verify-festive.mjs
import { festiveActive, deepSnow, snowmanMelted } from '../src/festive.js';
import { SCARF_COLORS, HATS, NOSES, DEFAULT_SNOWMAN, cycleSnowman } from '../src/snowman.js';
import { seasonStateAtPhase } from '../src/season.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const winter = seasonStateAtPhase(0.875), summer = seasonStateAtPhase(0.375), spring = seasonStateAtPhase(0.18);

(festiveActive(winter) ? ok : bad)('festive is on in winter');
(!festiveActive(summer) ? ok : bad)('festive is off in summer');
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

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
