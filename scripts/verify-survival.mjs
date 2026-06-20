// Winter survival model — run wi': node scripts/verify-survival.mjs
import { temperatureTarget, stepTemperature, HOT_FOODS } from '../src/temperature.js';
import { seasonStateAtPhase } from '../src/season.js';
import { I } from '../src/defs.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const winter = seasonStateAtPhase(0.875), summer = seasonStateAtPhase(0.375);
const env = (o = {}) => ({ covered: false, nearFire: false, night: false, altitude01: 0, wetness: 0, coat: false, ...o });

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

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
