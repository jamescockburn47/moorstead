// Activity-digest check — node scripts/verify-activity.mjs
// The deterministic "what's this player been up to" digest that makes NPCs nosey.
import { I } from '../src/defs.js';
import { buildActivityDigest } from '../src/activity.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const has = (s, sub, m) => (s.toLowerCase().includes(sub.toLowerCase()) ? ok : bad)(m);

const game = ({ counts = {}, pets = [], milestonesDone = [], standingIdx = 0 } = {}) => ({
  player: { countItem: id => counts[id] || 0, pets, milestonesDone },
  quests: { standingIndex: () => standingIdx },
});

// holdings are noticed
{
  const d = buildActivityDigest(game({ counts: { [I.JET_GEM]: 1, [I.I_PICK]: 1 } }));
  has(d, 'jet', 'notices Whitby jet in the pack');
  has(d, 'iron tools', 'notices iron tools');
}
// kept stock
has(buildActivityDigest(game({ pets: [{ petKind: 'dog' }] })), 'sheepdog', 'notices a sheepdog');
has(buildActivityDigest(game({ pets: [{ type: 'sheep' }, { type: 'sheep' }, { type: 'sheep' }] })),
  'flock of 3', 'notices a flock and counts it');
// milestones (kids)
has(buildActivityDigest(game({ milestonesDone: ['iron_tools'] })), 'iron tools', 'notices a kid milestone');
// standing
has(buildActivityDigest(game({ standingIdx: 4 })), 'thought of', 'notices high standing');

// nothing notable -> empty
(buildActivityDigest(game()) === '' ? ok : bad)('a fresh player yields no digest');
(buildActivityDigest({}) === '' ? ok : bad)('no player yields no digest (fail-safe)');
(buildActivityDigest(null) === '' ? ok : bad)('null game yields no digest (fail-safe)');

// capped to a remark, not a dossier (<= 4 bits => <= 3 separators)
{
  const d = buildActivityDigest(game({
    counts: { [I.JET_GEM]: 1, [I.I_PICK]: 1, [I.IRON_INGOT]: 4, [I.COAL_LUMP]: 40, [I.WOOL]: 8, [I.SEA_FISH]: 2, [I.AMMONITE]: 1 },
    pets: [{ petKind: 'dog' }, { type: 'sheep' }, { type: 'sheep' }],
    milestonesDone: ['iron_tools', 'first_neet'], standingIdx: 4,
  }));
  ((d.match(/;/g) || []).length <= 3 ? ok : bad)('digest is capped to a few items');
}

console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
