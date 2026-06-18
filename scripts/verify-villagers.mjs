// Villager-life logic check — run wi': node scripts/verify-villagers.mjs
import { EXTRA_FOLK, dayPhase, moodWord, villagerRemark } from '../src/villagerlife.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// roughly doubles the parish: a good dozen-plus extra folk, some that roam
{
  (EXTRA_FOLK.length >= 14 ? ok : bad)(`EXTRA_FOLK adds a good number of souls (${EXTRA_FOLK.length})`);
  (EXTRA_FOLK.every(f => f.name && f.role) ? ok : bad)('every extra folk has a name an’ a role');
  (EXTRA_FOLK.some(f => f.roam) && EXTRA_FOLK.some(f => f.village === null) ? ok : bad)('some folk roam, an’ some are free moor-wanderers');
}

// the day's rhythm: home at night, social at midday, work in the working hours
{
  (dayPhase(0.0) === 'home' && dayPhase(0.85) === 'home' ? ok : bad)('folk are home through the night');
  (dayPhase(0.5) === 'social' ? ok : bad)('folk gather on the green at midday');
  (dayPhase(0.3) === 'work' && dayPhase(0.68) === 'work' ? ok : bad)('folk are at their work morning an’ afternoon');
}

// mood words
{
  (moodWord(0.9) === 'cheerful' && moodWord(0.1) === 'mardy' ? ok : bad)('moodWord maps humour to a word');
}

// remarks: always a non-empty line; a build draws a build-comment; deterministic
{
  const r1 = villagerRemark({ role: 'shepherd', mood: 0.6, outside: true }, rng(7));
  const r2 = villagerRemark({ role: 'shepherd', mood: 0.6, outside: true }, rng(7));
  (typeof r1 === 'string' && r1.length > 0 ? ok : bad)('villagerRemark gives a line');
  (r1 === r2 ? ok : bad)('villagerRemark is deterministic for a fixed rng');
  // near a build, with many seeds, most lines mention building/work
  let buildish = 0;
  for (let s = 1; s <= 200; s++) {
    const line = villagerRemark({ role: 'gossip', mood: 0.6, nearBuild: true }, rng(s * 13 + 1));
    if (/build|throw|stone|work|house|plan|eyesore|way|land/i.test(line)) buildish++;
  }
  (buildish > 150 ? ok : bad)(`near a build, folk mostly remark on it (${buildish}/200)`);
}

console.log('RESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
