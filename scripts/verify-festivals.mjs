// Festival calendar + flag split — run wi': node scripts/verify-festivals.mjs
import { festivalState, windowIntensity, FESTIVALS } from '../src/festivals.js';
import { wintry, yuletide } from '../src/festive.js';
import { seasonStateAtPhase } from '../src/season.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// every festival is full-on at its centre and dead at the opposite side of the year
for (const f of FESTIVALS) {
  (festivalState(f.centre)[f.id] > 0.99 ? ok : bad)(f.id + ' is full intensity at its centre');
  (festivalState(f.centre + 0.5)[f.id] === 0 ? ok : bad)(f.id + ' is silent half a year away');
}

// `active` picks the festival whose window we are inside, or null between them
(festivalState(0.882).active === 'yule' ? ok : bad)('active is yule at midwinter');
(festivalState(0.650).active === 'harvest' ? ok : bad)('active is harvest at Michaelmas');
(festivalState(0.385).active === 'midsummer' ? ok : bad)('active is midsummer at the solstice');
(festivalState(0.500).active === null ? ok : bad)('no festival active between harvest and midsummer');

// windows do not collide: at each centre, only that one festival is non-zero
for (const f of FESTIVALS) {
  const others = FESTIVALS.filter(g => g.id !== f.id).every(g => festivalState(f.centre)[g.id] === 0);
  (others ? ok : bad)('no other festival overlaps ' + f.id + "'s centre");
}

// the trapezoid: 1 across the core, fading to 0 at the visible edge
{
  const f = FESTIVALS.find(x => x.id === 'yule'); // centre 0.882, 14 days
  (windowIntensity(f.centre, f.centre, f.days) === 1 ? ok : bad)('window is 1 at centre');
  (windowIntensity(f.centre + 0.04, f.centre, f.days) === 0 ? ok : bad)('window is 0 well past the edge');
}

// --- flag split: wintry (broad) vs yuletide (narrow Christmastide) ---
{
  const autumn = seasonStateAtPhase(0.70);
  (wintry(autumn) ? ok : bad)('0.70 (autumn) is wintry — snow play unaffected');
  (!yuletide(autumn) ? ok : bad)('0.70 (autumn) is NOT yuletide — carol stays silent');
}
(yuletide(seasonStateAtPhase(0.882)) ? ok : bad)('midwinter is yuletide');
(!yuletide(seasonStateAtPhase(0.50)) ? ok : bad)('high summer is not yuletide');
{
  let subset = true, wintryMatchesFrost = true;
  for (let i = 0; i < 500; i++) {
    const s = seasonStateAtPhase(i / 500);
    if (yuletide(s) && !wintry(s)) subset = false;
    if (wintry(s) !== (s.frost > 0.35)) wintryMatchesFrost = false;
  }
  (subset ? ok : bad)('yuletide ⊂ wintry across the whole year');
  (wintryMatchesFrost ? ok : bad)('wintry is exactly the old frost > 0.35 (no snow-play regression)');
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
