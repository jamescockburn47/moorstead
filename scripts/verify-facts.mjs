// Game-facts retrieval check — run wi': node scripts/verify-facts.mjs
// The mini-RAG that lets Merlin and the villagers answer "how do I…" questions
// from the SAME corpus, retrieved per question. This proves retrieval picks the
// right facts, respects the context budget, and that the corpus tracks the live
// economy constants (a drift guard — if a balance number changes in code but not
// here, this fails).
import { readFileSync } from 'fs';
import { retrieveFacts, scoreFact, villagerAffinity } from '../src/facts.js';
import { GAME_FACTS } from '../src/game-facts.js';
import { STARTING_BRASS, FREIGHT_ALLOWANCE, formatBrass } from '../src/economy.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const has = (arr, sub, m) => ((arr.join(' ').toLowerCase().includes(sub.toLowerCase())) ? ok : bad)(m);

// --- retrieval finds the right topic for a player's question ---
{
  const r = retrieveFacts('how do I sell my coal for a good price');
  (r.length > 0 ? ok : bad)('a selling question retrieves something');
  has(r, 'rail', 'selling coal points at the rail / market route');
}
has(retrieveFacts('how do I get a sheepdog to herd sheep'), 'dog', 'a sheepdog question retrieves the dog facts');
has(retrieveFacts('how do I build a pen to keep my sheep'), 'gate', 'a penning question retrieves the fold / gate facts');
has(retrieveFacts('what do I do at night when it goes dark'), 'night', 'a night question retrieves the danger facts');
has(retrieveFacts('how do I ride the train'), 'train', 'a train question retrieves railway facts');
(retrieveFacts('how do I make some money').length > 0 ? ok : bad)('a money question retrieves something');

// --- empty / unknown queries retrieve nothing (no fact-dumping) ---
(retrieveFacts('').length === 0 ? ok : bad)('empty message retrieves nothing');
(retrieveFacts('   ').length === 0 ? ok : bad)('whitespace retrieves nothing');
(retrieveFacts('asdfqwerty zzzv').length === 0 ? ok : bad)('a query with no known terms retrieves nothing');

// --- top-k and context budget respected ---
{
  const r = retrieveFacts('sell coal wool jet fish at the market by rail train station', { k: 2 });
  (r.length <= 2 ? ok : bad)(`respects k=2 (got ${r.length})`);
}
{
  const r = retrieveFacts('sell coal wool jet fish at the market by rail', { k: 6, maxChars: 130 });
  const total = r.join(' ').length;
  (total <= 130 ? ok : bad)(`respects the maxChars budget (got ${total} chars)`);
}

// --- affinity boosts an NPC's OWN patch, but only when the question is relevant ---
{
  const railFact = GAME_FACTS.find(f => f.topic === 'railway');
  (railFact ? ok : bad)('there is a railway fact to score');
  if (railFact) {
    const q = ['train', 'station'];
    const withAff = scoreFact(railFact, q, ['railway']).total;
    const without = scoreFact(railFact, q, []).total;
    (withAff > without ? ok : bad)('affinity lifts an own-patch fact when relevant');
  }
}
{
  // affinity must NOT fabricate relevance: an off-topic question yields no own-patch dump
  const r = retrieveFacts('what is your name', { affinity: ['railway'] });
  (r.every(t => !/timetable|regulator|platform/i.test(t)) ? ok : bad)('affinity does not dump facts on an off-topic question');
}

// --- NPC affinity reflects role/village (so each leans to their own patch) ---
{
  (villagerAffinity('stationmaster briggs', 'Goathland').includes('railway') ? ok : bad)('the stationmaster leans railway');
  (villagerAffinity('fishwife annie', 'Whitby').includes('coast') ? ok : bad)('the fishwife leans coast');
  (villagerAffinity('farmer james', 'Moorstead').includes('sheepdog') ? ok : bad)('the farmer leans sheepdog');
  (villagerAffinity('', '').length === 0 ? ok : bad)('an unknown villager has no forced affinity');
}

// --- drift guard: the corpus must state the LIVE economy numbers ---
{
  const all = GAME_FACTS.map(f => f.text).join(' ');
  (all.includes(String(FREIGHT_ALLOWANCE)) ? ok : bad)(`corpus states the live freight cap (${FREIGHT_ALLOWANCE})`);
  const purse = formatBrass(STARTING_BRASS); // "5s"
  (all.includes(purse) || /five shilling/i.test(all) ? ok : bad)(`corpus states the live starting purse (${purse})`);
}

// --- sync guard: Merlin's Python copy must match the source corpus ---
{
  let synced = null;
  try {
    synced = JSON.parse(readFileSync(new URL('../clint-body/game-facts.json', import.meta.url), 'utf8'));
  } catch { /* missing file -> fails below */ }
  (synced && JSON.stringify(synced) === JSON.stringify(GAME_FACTS) ? ok : bad)(
    'clint-body/game-facts.json is in sync with src/game-facts.js (run: node scripts/sync-facts.mjs)');
}

// --- every fact is well-formed ---
{
  const shape = GAME_FACTS.every(f =>
    f.topic && Array.isArray(f.keywords) && f.keywords.length > 0 &&
    typeof f.text === 'string' && f.text.length > 10);
  (shape ? ok : bad)('every fact has a topic, keywords and text');
  (GAME_FACTS.length >= 20 ? ok : bad)(`corpus is reasonably complete (${GAME_FACTS.length} facts)`);
}

console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
