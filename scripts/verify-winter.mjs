// Winter weather/ice helpers — run wi': node scripts/verify-winter.mjs
import { winterPrecip, overcastGrey } from '../src/snow.js';
import { seasonStateAtPhase } from '../src/season.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

{
  const winter = seasonStateAtPhase(0.875), summer = seasonStateAtPhase(0.375);
  const w = winterPrecip(winter, 0.8, 0);
  (w.snow > 0.5 && w.rain === 0 ? ok : bad)('winter precip falls as snow, no rain (snow ' + w.snow.toFixed(2) + ')');
  const s = winterPrecip(summer, 0.8, 0);
  (s.rain > 0.5 && s.snow === 0 ? ok : bad)('summer precip stays rain');
  const clear = winterPrecip(winter, 0, 0);
  (clear.snow === 0 && clear.rain === 0 ? ok : bad)('clear winter = no snow, no rain (sunny snow day)');
  const offline = winterPrecip(winter, null, 0.6);
  (offline.snow > 0.5 ? ok : bad)('offline winter falls back to the deterministic snow clock');
}
{
  (overcastGrey('clear', 0.6, 0) > 0.3 ? ok : bad)('snowing -> overcast');
  (overcastGrey('clear', 0, 0) === 0 ? ok : bad)('clear + no precip -> sunny (grey 0)');
  (overcastGrey('rain', 0, 0.8) > 0.3 ? ok : bad)('raining -> overcast');
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
