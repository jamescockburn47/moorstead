// facts.js — per-question retrieval over the game-facts corpus (the "mini-RAG").
//
// Pure, dependency-free, deterministic lexical retrieval: score each fact by how
// well its keywords/text overlap the player's question, return the best few. An
// NPC's "affinity" (the topics their role/village makes them authoritative on)
// only LIFTS a fact that is already relevant — it never fabricates relevance, so
// an off-topic question does not make a villager dump their own patch.
//
// The character is preserved by the brain's per-NPC persona; these facts ride in
// as labelled reference (see factsContext), not as a script.

import { GAME_FACTS } from './game-facts.js';

// short, common words that carry no retrieval signal (incl. a little dialect)
const STOP = new Set([
  'the', 'and', 'for', 'you', 'your', 'how', 'can', 'what', 'where', 'who', 'why',
  'with', 'get', 'got', 'are', 'was', 'this', 'that', 'them', 'they', 'some', 'any',
  'put', 'use', 'has', 'have', 'about', 'into', 'from', 'out', 'off', 'tha', 'thi',
  'thee', 'owt', 'nowt', 'does', 'doing', 'just', 'need', 'want', 'should', 'would',
]);

// Split a string into meaningful lowercase terms (letters/apostrophes, length > 2).
export function terms(s) {
  const m = (s || '').toLowerCase().match(/[a-z']+/g);
  if (!m) return [];
  return m.filter(w => w.length > 2 && !STOP.has(w));
}

// Score one fact against the query terms. Returns { rel, total }:
//   rel   — pure question relevance (keyword hit 3, text hit 1, stem hit 2)
//   total — rel plus a small affinity boost, applied ONLY when rel > 0
export function scoreFact(fact, queryTerms, affinity = []) {
  const kw = fact.keywords || [];
  const kwSet = new Set(kw);
  const txt = terms(fact.text);
  let rel = 0;
  for (const t of queryTerms) {
    if (kwSet.has(t)) { rel += 3; continue; }
    if (txt.includes(t)) { rel += 1; continue; }
    for (const k of kw) {
      if (k.length > 3 && (k.startsWith(t) || t.startsWith(k))) { rel += 2; break; }
    }
  }
  const boost = (rel > 0 && affinity.includes(fact.topic)) ? 1.5 : 0;
  return { rel, total: rel + boost };
}

// Retrieve the best fact texts for a question. Returns [] for an empty/unknown
// query. k caps the count; maxChars caps the total injected length (the brain's
// context budget is shared with the situational brief, so keep this modest).
export function retrieveFacts(message, { affinity = [], k = 2, maxChars = 600 } = {}) {
  const q = terms(message);
  if (!q.length) return [];
  const scored = GAME_FACTS
    .map(f => ({ f, ...scoreFact(f, q, affinity) }))
    .filter(x => x.rel > 0)
    .sort((a, b) => b.total - a.total);
  const out = [];
  let used = 0;
  for (const { f } of scored) {
    if (out.length >= k) break;
    if (used + f.text.length + 1 > maxChars) continue;
    out.push(f.text);
    used += f.text.length + 1;
  }
  return out;
}

// The topics an NPC is plausibly authoritative on, from their village and role.
// Used as retrieval affinity so each NPC leans toward their own patch — the
// stationmaster toward the railway, the fishwife toward the coast — without being
// forced to know everything. Derived, not hand-authored per character.
export function villagerAffinity(name = '', village = '') {
  const n = name.toLowerCase(), v = village.toLowerCase();
  const a = new Set();
  const add = (...t) => t.forEach(x => a.add(x));
  if (v.includes('moorstead')) add('fold', 'sheepdog', 'village');
  if (v.includes('goathland')) add('railway', 'rail-trade', 'sheepdog');
  if (v.includes('rosedale')) add('mining', 'range', 'food');
  if (v.includes('staithes')) add('coast', 'fishing');
  if (v.includes('pickering')) add('trade', 'rail-trade', 'ventures');
  if (v.includes('grosmont')) add('railway', 'mining');
  if (v.includes('whitby')) add('coast', 'fishing', 'quests');
  if (/farmer|shepher/.test(n)) add('sheepdog', 'fold');
  if (/station|driver|fireman|guard/.test(n)) add('railway', 'rail-trade');
  if (/market|trader|merchant/.test(n)) add('trade', 'rail-trade');
  if (/fish|annie|ned|beck/.test(n)) add('coast', 'fishing');
  if (/vicar|granny|glinda|owd tom/.test(n)) add('quests', 'landmarks');
  if (/miner|smith/.test(n)) add('mining', 'range');
  return [...a];
}

// Build a ready-to-inject context string (or '' if nothing relevant). The framing
// keeps the NPC in character: the facts are reference to draw on, not lines to read.
export function factsContext(message, opts) {
  const facts = retrieveFacts(message, opts);
  if (!facts.length) return '';
  return 'True things about the world, to draw on only if your character would know them and only if relevant (answer in your own voice, never recite this): '
    + facts.join(' ');
}
