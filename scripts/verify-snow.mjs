// Snow maths — run wi': node scripts/verify-snow.mjs
import { TrampleBuffer } from '../src/footprints.js';
import { stepAccumulation, accumulationTarget, snowfallIntensity, showerOscillation, snowLineFor, driftDepth } from '../src/snow.js';
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
// accumulation target tracks the season — the seed value used on world-load and
// on a season flip, so winter is snowy at once (not after game-days of creep).
{
  const winter = seasonStateAtPhase(0.875), summer = seasonStateAtPhase(0.375);
  (accumulationTarget(winter) > 0.9 ? ok : bad)('deep winter wants near-full cover (' + accumulationTarget(winter).toFixed(2) + ')');
  (accumulationTarget(summer) === 0 ? ok : bad)('summer wants no snow');
  (accumulationTarget({ frost: 0.5, warmth: -0.2 }) === Math.min(1, 0.5 * 0.75 + 0.2) ? ok : bad)('partial cover for a mild cold snap (' + accumulationTarget({ frost: 0.5, warmth: -0.2 }).toFixed(2) + ')');
  (Math.abs(stepAccumulation(accumulationTarget(winter), winter, 1) - accumulationTarget(winter)) < 0.01 ? ok : bad)('accum seeded to target stays put');
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

// banked drifts: deep winter only, patchy (crests slow, hollows walkable),
// zero below the snow-line band, deterministic per column
{
  (driftDepth(10, 10, 40, 0.3) === 0 ? ok : bad)('no drifts under light cover');
  (driftDepth(10, 10, 10, 1) === 0 ? ok : bad)('no drifts below the snow-line band');
  let deep = 0, shallow = 0;
  for (let x = 0; x < 60; x++) for (let z = 0; z < 60; z++) {
    const d = driftDepth(x, z, 60, 1);
    if (d > 0.5) deep++; else if (d === 0) shallow++;
  }
  (deep > 0 ? ok : bad)('deep winter has banked drift crests (' + deep + ' cells)');
  (shallow > deep ? ok : bad)('hollows outnumber banks — the moor stays walkable (' + shallow + ' clear)');
  (driftDepth(7, 9, 60, 0.95) === driftDepth(7, 9, 60, 0.95) ? ok : bad)('drift depth is deterministic');
  let inRange = true;
  for (let x = 0; x < 40; x++) { const d = driftDepth(x, x * 2, 60, 1); if (d < 0 || d > 1) inRange = false; }
  (inRange ? ok : bad)('drift depth stays in [0,1]');
}

{
  const tb = new TrampleBuffer(8);
  tb.mark(0, 0, 100); tb.mark(0, 0, 100);          // same spot -> no duplicate
  (tb.prints.length === 1 ? ok : bad)('trample buffer dedups the same step');
  tb.mark(5, 5, 100);
  (tb.prints.length === 2 ? ok : bad)('a step away adds a print');
  for (let i = 0; i < 12; i++) tb.mark(i * 2, 0, 100);   // overflow the cap of 8
  (tb.prints.length <= 8 ? ok : bad)('buffer is capped (got ' + tb.prints.length + ')');
  (Array.isArray(tb.alive(100)) ? ok : bad)('alive() returns current prints');
  (tb.alive(1000).length === 0 ? ok : bad)('old prints expire');
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
