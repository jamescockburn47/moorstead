// Season clock check — run wi': node scripts/verify-season.mjs
// The season is a pure function of wall-clock time: deterministic, shared by
// every client, ~1 real day per season (a four-day year). Nowt is persisted.
import {
  seasonState, seasonStateAtPhase, bilberryInSeason, YEAR, ANCHOR_SEC, ANCHOR_PHASE,
} from '../src/season.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const DAY = 86400 * 1000;

// determinism — same instant, same result
{
  const t = ANCHOR_SEC * 1000 + 12345;
  (JSON.stringify(seasonState(t)) === JSON.stringify(seasonState(t)) ? ok : bad)('seasonState is deterministic for a fixed instant');
}

// the four seasons cycle one per real day, starting from the anchor (summer)
{
  const base = ANCHOR_SEC * 1000 + 1;
  const names = [0, 1, 2, 3].map(d => seasonState(base + d * DAY).season);
  (names.join(',') === 'summer,autumn,winter,spring' ? ok : bad)('seasons cycle one per real day from the anchor (got ' + names.join(',') + ')');
}

// season by yearPhase quarter
{
  (seasonStateAtPhase(0.05).season === 'spring' ? ok : bad)('yearPhase .05 is spring');
  (seasonStateAtPhase(0.30).season === 'summer' ? ok : bad)('yearPhase .30 is summer');
  (seasonStateAtPhase(0.60).season === 'autumn' ? ok : bad)('yearPhase .60 is autumn');
  (seasonStateAtPhase(0.90).season === 'winter' ? ok : bad)('yearPhase .90 is winter');
}

// heather blooms in late summer, not spring or winter
{
  const late = seasonStateAtPhase(0.45).heatherBloom;
  const spring = seasonStateAtPhase(0.10).heatherBloom;
  const winter = seasonStateAtPhase(0.85).heatherBloom;
  (late > 0.9 ? ok : bad)('heather bloom peaks in late summer (' + late.toFixed(2) + ')');
  (spring < 0.1 && winter < 0.1 ? ok : bad)('heather is not in bloom in spring or winter');
}

// snow peaks in deep winter, never at high summer
{
  const winter = seasonStateAtPhase(0.875).snowiness;
  const summer = seasonStateAtPhase(0.375).snowiness;
  (winter > 0.9 ? ok : bad)('snow peaks in deep winter (' + winter.toFixed(2) + ')');
  (summer < 0.05 ? ok : bad)('no snow at high summer (' + summer.toFixed(2) + ')');
}

// spring is greener than winter
{
  (seasonStateAtPhase(0.18).greenness > seasonStateAtPhase(0.875).greenness ? ok : bad)('spring is greener than winter');
}

// every scalar stays in range across the whole year
{
  let inRange = true;
  for (let i = 0; i < 400; i++) {
    const s = seasonStateAtPhase(i / 400);
    if (s.yearPhase < 0 || s.yearPhase >= 1) inRange = false;
    if (s.heatherBloom < 0 || s.heatherBloom > 1) inRange = false;
    if (s.snowiness < 0 || s.snowiness > 1) inRange = false;
    if (s.greenness < 0 || s.greenness > 1) inRange = false;
    if (s.warmth < -1.0001 || s.warmth > 1.0001) inRange = false;
    if (s.autumn < 0 || s.autumn > 1) inRange = false;
    if (s.snowdrop < 0 || s.snowdrop > 1) inRange = false;
    if (s.daffodil < 0 || s.daffodil > 1) inRange = false;
    if (s.summerBloom < 0 || s.summerBloom > 1) inRange = false;
    if (s.seedhead < 0 || s.seedhead > 1) inRange = false;
    if (s.frost < 0 || s.frost > 1) inRange = false;
  }
  (inRange ? ok : bad)('all seasonal scalars stay within range across the year');
}

// autumn peaks mid-autumn, not in spring
{
  (seasonStateAtPhase(0.625).autumn > 0.9 ? ok : bad)('autumn peaks mid-autumn');
  (seasonStateAtPhase(0.125).autumn < 0.1 ? ok : bad)('no autumn tint in spring');
}

// bilberries bear at the bloom peak, bare in winter
{
  // exact inverse of seasonState's phase formula: a `now` (ms) at year phase p
  const nowAtPhase = p => (ANCHOR_SEC + (p - ANCHOR_PHASE) * YEAR) * 1000 + 1;
  (bilberryInSeason(nowAtPhase(0.45)) ? ok : bad)('bilberries are in season at late-summer peak');
  (!bilberryInSeason(nowAtPhase(0.85)) ? ok : bad)('bilberries are bare in winter');
}

// new flower/frost windows peak in the right season and are quiet out of season
{
  (seasonStateAtPhase(0.97).snowdrop > 0.9 ? ok : bad)('snowdrops peak in late winter');
  (seasonStateAtPhase(0.45).snowdrop < 0.1 ? ok : bad)('no snowdrops in late summer');
  (seasonStateAtPhase(0.12).daffodil > 0.9 ? ok : bad)('daffodils peak in early spring');
  (seasonStateAtPhase(0.70).daffodil < 0.1 ? ok : bad)('no daffodils in autumn');
  (seasonStateAtPhase(0.37).summerBloom > 0.9 ? ok : bad)('summer blooms (foxgloves) peak in summer');
  (seasonStateAtPhase(0.875).summerBloom < 0.1 ? ok : bad)('no summer blooms in deep winter');
  (seasonStateAtPhase(0.66).seedhead > 0.85 ? ok : bad)('seedheads peak in autumn');
  (seasonStateAtPhase(0.12).seedhead < 0.1 ? ok : bad)('no seedheads in spring');
  (seasonStateAtPhase(0.875).frost > 0.9 ? ok : bad)('frost peaks in deep winter');
  (seasonStateAtPhase(0.375).frost < 0.05 ? ok : bad)('no frost at high summer');
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
