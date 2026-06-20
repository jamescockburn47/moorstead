// Snow maths — run wi': node scripts/verify-snow.mjs
import { stepAccumulation, snowfallIntensity, showerOscillation, snowLineFor } from '../src/snow.js';
import { seasonStateAtPhase, YEAR, ANCHOR_SEC, ANCHOR_PHASE } from '../src/season.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const nowAtPhase = p => (ANCHOR_SEC + (p - ANCHOR_PHASE) * YEAR) * 1000 + 1;

// accumulation builds in deep winter and melts out by late spring
{
  const winter = seasonStateAtPhase(0.875), spring = seasonStateAtPhase(0.18);
  let acc = 0;
  for (let i = 0; i < 600; i++) acc = stepAccumulation(acc, winter, 1);
  (acc > 0.8 ? ok : bad)('snow accumulates deep in winter (' + acc.toFixed(2) + ')');
  let melt = acc;
  for (let i = 0; i < 600; i++) melt = stepAccumulation(melt, spring, 1);
  (melt < 0.15 ? ok : bad)('snow thaws in spring (' + melt.toFixed(2) + ')');
  (stepAccumulation(0.5, winter, 1) > 0.5 ? ok : bad)('accumulation rises while it snows and is cold');
  (stepAccumulation(0.5, spring, 1) < 0.5 ? ok : bad)('accumulation falls when it warms');
}
// deterministic snowfall: reliably present through winter, ~0 in summer
{
  let win = 0, n = 0;
  for (let p = 0.80; p < 0.95; p += 0.01) { win += snowfallIntensity(nowAtPhase(p), seasonStateAtPhase(p)); n++; }
  (win / n > 0.4 ? ok : bad)('winter is reliably snowy on average (' + (win / n).toFixed(2) + ')');
  (snowfallIntensity(nowAtPhase(0.375), seasonStateAtPhase(0.375)) < 0.02 ? ok : bad)('no snowfall at high summer');
}
// shower oscillation is deterministic, smooth, in [0,1]
{
  const t = nowAtPhase(0.875);
  (showerOscillation(t) === showerOscillation(t) ? ok : bad)('shower oscillation is deterministic');
  let inRange = true; for (let i = 0; i < 200; i++) { const v = showerOscillation(t + i * 60000); if (v < 0 || v > 1) inRange = false; }
  (inRange ? ok : bad)('shower oscillation stays in [0,1]');
}
// snow-line drops toward the valley as winter deepens
{
  (snowLineFor(0) > snowLineFor(1) ? ok : bad)('snow-line is higher with less snow');
  (snowLineFor(1) <= 30 ? ok : bad)('full snow blankets down to the valley floor (' + snowLineFor(1) + ')');
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
