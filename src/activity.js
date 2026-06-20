// activity.js — a small, deterministic "what has this player been up to?" digest,
// built from live game state (inventory, kept stock, milestones, standing). It is
// injected into the NPC's context so villagers and Merlin can be a bit NOSEY —
// "settling into that croft, are you?", "I see you've been down the jet seams".
//
// Pure and cheap: no LLM call, no extra round-trip, so it adds NO latency — it
// just rides in the prompt the game already sends. Returns '' when there's
// nothing worth noticing, and never throws.

import { I } from './defs.js';

// Notable things in the pack worth a passing remark — not a full inventory.
function holdings(p) {
  const out = [];
  const has = (id, n = 1) => typeof p.countItem === 'function' && p.countItem(id) >= n;
  if (has(I.JET_GEM)) out.push('carrying fine Whitby jet');
  if (has(I.I_PICK) || has(I.I_AXE) || has(I.I_SWORD)) out.push('well-equipped with iron tools');
  else if (has(I.S_PICK) || has(I.S_AXE) || has(I.S_SWORD)) out.push('carrying gritstone tools');
  if (has(I.IRON_INGOT)) out.push('carrying smelted iron');
  if (has(I.COAL_LUMP, 16)) out.push('laden with coal');
  if (has(I.WOOL, 4)) out.push('carrying a good bit of wool');
  if (has(I.COOKED_FISH) || has(I.SEA_FISH) || has(I.FISH_CHIPS)) out.push('been to the coast for fish');
  if (has(I.AMMONITE) || has(I.GRYPHAEA)) out.push('been turning up old fossils');
  return out;
}

// Kept beasts / a worked flock.
function stock(p) {
  const pets = Array.isArray(p.pets) ? p.pets : [];
  if (!pets.length) return [];
  const kindOf = (x) => x.petKind || x.type || x.kind || '';
  const out = [];
  if (pets.some((x) => kindOf(x) === 'dog')) out.push('has a sheepdog at heel');
  const flock = pets.filter((x) => kindOf(x) === 'sheep').length;
  if (flock >= 2) out.push(`keeps a flock of ${flock}`);
  else if (pets.length && !out.length) out.push('keeps a beast or two');
  return out;
}

// First-hour milestones (the bairns' world tracks these; adults have none).
const MILESTONE_PHRASE = {
  iron_tools: 'has worked their way up to iron tools',
  iron_won: 'is smelting iron now',
  stood_ground: 'has stood their ground against the dark',
  first_neet: 'has seen a whole night through on the moor',
  first_bench: 'has set up a joiner’s bench',
};
function milestones(p) {
  const done = Array.isArray(p.milestonesDone) ? p.milestonesDone : [];
  const out = [];
  for (const id of ['iron_tools', 'iron_won', 'stood_ground', 'first_neet', 'first_bench']) {
    if (done.includes(id) && MILESTONE_PHRASE[id]) out.push(MILESTONE_PHRASE[id]);
  }
  return out.slice(0, 2);
}

function standing(game) {
  const q = game.quests;
  if (!q || typeof q.standingIndex !== 'function') return [];
  return q.standingIndex() >= 3 ? ['well thought of in the parish'] : [];
}

// Build the digest string (or '' if there's nothing notable). Capped so an NPC
// drops a remark, not a dossier.
export function buildActivityDigest(game) {
  try {
    const p = game && game.player;
    if (!p) return '';
    const bits = [...holdings(p), ...stock(p), ...milestones(p), ...standing(game)];
    if (!bits.length) return '';
    return 'What you can tell this visitor has been up to (work it in naturally only if it fits, never list it): '
      + bits.slice(0, 4).join('; ') + '.';
  } catch {
    return '';
  }
}
