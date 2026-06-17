// Live-weather mapping check — run wi': node scripts/verify-weather.mjs
// mapWeather is pure (WMO code + fields → game weather state + intensities),
// so it tests headlessly. The fetch itself is not tested here (it degrades to
// the random weather machine on any failure — see sky.js).
import { mapWeather } from '../src/weather-live.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// --- state mapping across the WMO buckets ---
(mapWeather({ weatherCode: 0, cloudCover: 5 }).state === 'clear' ? ok : bad)('code 0, low cloud → clear');
(mapWeather({ weatherCode: 3, cloudCover: 85 }).state === 'misty' ? ok : bad)('overcast (cloud 85) → misty');
(mapWeather({ weatherCode: 2, cloudCover: 20 }).state === 'clear' ? ok : bad)('partly cloudy, low cloud → clear');
(mapWeather({ weatherCode: 61, precipitation: 0.5 }).state === 'rain' ? ok : bad)('code 61 (rain) → rain');
(mapWeather({ weatherCode: 80, precipitation: 2 }).state === 'rain' ? ok : bad)('code 80 (showers) → rain');
(mapWeather({ weatherCode: 71, precipitation: 0.4 }).state === 'rain' ? ok : bad)('code 71 (snow) → rain (no season crossover in v1)');
(mapWeather({ weatherCode: 95, precipitation: 3 }).state === 'rain' ? ok : bad)('code 95 (thunderstorm) → rain');
(mapWeather({ weatherCode: 45 }).state === 'fog' ? ok : bad)('code 45 (fog) → fog');
(mapWeather({ weatherCode: 0, visibility: 500 }).state === 'fog' ? ok : bad)('very low visibility → fog');
(mapWeather({ weatherCode: 1, cloudCover: 0, precipitation: 0.3 }).state === 'rain' ? ok : bad)('measurable precip overrides a clear code → rain');

// --- continuous intensities ---
{
  const r = mapWeather({ weatherCode: 63, precipitation: 2 });
  (Math.abs(r.rainAmount - 0.5) < 1e-6 ? ok : bad)('2 mm/h → rainAmount 0.5 (' + r.rainAmount + ')');
}
(mapWeather({ weatherCode: 65, precipitation: 99 }).rainAmount === 1 ? ok : bad)('heavy precip clamps rainAmount to 1');
(mapWeather({ weatherCode: 0, visibility: 50000 }).fogFar === 160 ? ok : bad)('far visibility clamps fogFar to 160');
(mapWeather({ weatherCode: 45, visibility: 200 }).fogFar === 25 ? ok : bad)('thick fog clamps fogFar to 25');
{
  const a = mapWeather({ weatherCode: 0, windSpeed: 0 }).windiness;
  const b = mapWeather({ weatherCode: 0, windSpeed: 40 }).windiness;
  (a === 0 && b === 1 ? ok : bad)('windiness scales 0..1 with wind speed (' + a + '..' + b + ')');
}

// --- robustness: missing fields fall back to sane defaults, never throw ---
{
  let threw = false, res = null;
  try { res = mapWeather({}); } catch { threw = true; }
  (!threw && res && res.state === 'clear' ? ok : bad)('empty sample → clear, no throw');
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
