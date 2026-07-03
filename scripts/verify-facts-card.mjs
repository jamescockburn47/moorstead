// The FACTS card: game-authoritative context every villager chat carries. Pure
// formatter tests + market-intel truth checks against the real SPREAD table +
// source-wiring greps. LLM narrates, ledgers decide — every card row is TRUE.
import { readFileSync } from 'node:fs';
import { buildFactsCard, trainLines, FACTS_CARD_MAX } from '../src/factscard.js';
import { marketIntel } from '../src/economy.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const check = (c, m) => (c ? ok(m) : bad(m));

// --- buildFactsCard: rows in, labelled trustworthy block out ---
const card = buildFactsCard({
  playerName: 'James', standing: 'Welcomed', titles: ['Storm-Warden'],
  trainRows: ['Next trains from Grosmont: Whitby in 4 minutes, then Pickering in 12 minutes.'],
  marketRows: ['Wool is dear here; it sells cheap at Moorstead.'],
});
check(card.startsWith('GAME FACTS'), 'card carries the GAME FACTS header');
check(/trust these over anything you remember/i.test(card), 'card instructs the model to defer to it');
check(card.includes('James') && card.includes('Welcomed') && card.includes('Storm-Warden'),
      'name, standing and honours all present');
check(card.includes('Next trains from Grosmont') && card.includes('Wool is dear'),
      'train + market rows carried through');
check(buildFactsCard({}) === '', 'empty inputs -> empty card (no noise for the model)');
check(buildFactsCard({ playerName: 'X'.repeat(2000) }).length <= FACTS_CARD_MAX,
      'card never exceeds its budget');

// --- trainLines: true, compact, tellable ---
const tl = trainLines('Grosmont', [{ dest: 'Whitby', eta: 245, dist: 800 }, { dest: 'Pickering', eta: 731, dist: 1400 }]);
check(tl.length === 1 && tl[0].includes('Grosmont'), 'one line per station');
check(tl[0].includes('Whitby') && tl[0].includes('4 minutes'), 'first departure with rounded minutes');
check(tl[0].includes('Pickering') && tl[0].includes('12 minutes'), 'second departure follows');
check(trainLines('Grosmont', []).length === 0, 'no departures -> no line (never invent a time)');
check(trainLines('Grosmont', [{ dest: 'Whitby', eta: 40, dist: 800 }])[0].includes('due now'),
      'imminent train reads as due now, not 0 minutes');

// --- marketIntel: TRUE statements from the real SPREAD table ---
const whitby = marketIntel('Whitby');
check(Array.isArray(whitby) && whitby.length >= 1 && whitby.length <= 2, 'Whitby yields 1-2 intel lines');
check(whitby.every(l => typeof l === 'string' && l.length < 160), 'lines are short prose');
check(whitby.some(l => /coal/i.test(l) || /fish/i.test(l) || /wool/i.test(l) || /jet/i.test(l) || /iron/i.test(l)),
      'talks about real spread goods');
const nowhere = marketIntel('Boggle Hole');
check(Array.isArray(nowhere), 'unknown village -> array (may be empty), never throws');
// dear-case truthfulness: no dear line may claim a cheap source (spreadHint.best is another DEAR market)
check(!whitby.some(l => /dear price here.*cheap/i.test(l)), 'dear lines never invent a cheap source');

// --- source wiring (lands in B2; expected FAIL until then) ---
const q = readFileSync(new URL('../src/quests.js', import.meta.url), 'utf8');
check(/buildFactsCard\(/.test(q), 'quests.chatContext prepends the facts card');
const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
check(/depsForStation\(/.test(mainSrc), 'main.js exposes depsForStation for chat + chip');
check(/knownTimes/.test(mainSrc), 'main.js wires the learn-gate');
const p = readFileSync(new URL('../src/player.js', import.meta.url), 'utf8');
check(/knownTimes/.test(p), 'player persists knownTimes');

console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
