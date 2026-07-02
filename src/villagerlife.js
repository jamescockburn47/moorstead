// villagerlife.js — the parish beyond the brain's 18 deep folk: extra souls who
// fill the villages out, a daily rhythm for everyone, and the nosy/neighbourly
// things they say off their own bat. Pure data + helpers (no THREE, no DOM) so it
// can be unit-tested headless (see scripts/verify-villagers.mjs). Works with the
// brain off — these lines are the canned voice the bubbles use.

// Extra folk to roughly double the population. No brain id (canned voice only),
// but they potter, roam and natter like anyone. `role` shapes their day + lines;
// `roam` folk range beyond the village (out on the roads and moor). village:null
// folk are free wanderers with no home settlement.
export const EXTRA_FOLK = [
  { name: 'shepherd dot', village: 'Moorstead', role: 'shepherd', roam: true },
  { name: 'lad wilf', village: 'Moorstead', role: 'child' },
  { name: 'widow earnshaw', village: 'Moorstead', role: 'gossip' },
  { name: 'waller dan', village: 'Moorstead', role: 'waller', roam: true },
  { name: 'pedlar quirk', village: 'Goathland', role: 'pedlar', roam: true },
  { name: 'goose-girl pru', village: 'Goathland', role: 'child' },
  { name: 'brother cuthbert', village: 'Rosedale Abbey', role: 'monk' },
  { name: 'charcoal kit', village: 'Rosedale Abbey', role: 'collier', roam: true },
  { name: 'cobble-jack', village: 'Staithes', role: 'fisher' },
  { name: 'crab-lass sal', village: 'Staithes', role: 'fisher' },
  { name: 'constable byass', village: 'Pickering', role: 'constable', roam: true },
  { name: 'market-lad robin', village: 'Pickering', role: 'child' },
  { name: 'platelayer huw', village: 'Grosmont', role: 'railway', roam: true },
  { name: 'washerwoman else', village: 'Grosmont', role: 'gossip' },
  { name: 'jet-cutter amos', village: 'Whitby', role: 'jetman' },
  { name: 'cooper bram', village: 'Whitby', role: 'cooper' },
  { name: 'tinker meg', village: null, role: 'pedlar', roam: true },
  { name: 'rambling abe', village: null, role: 'rambler', roam: true },
];

// Where a body ought to be by the time of day (skyT is 0..1 round the clock).
//  'home'   — abed / by the hearth (night)
//  'social' — down the green or the inn (midday)
//  'work'   — at their patch (morning & afternoon); roamers range out on this one
export function dayPhase(skyT) {
  if (skyT > 0.78 || skyT < 0.15) return 'home';
  if (skyT >= 0.43 && skyT < 0.57) return 'social';
  return 'work';
}

// A mood word, frae a 0..1 humour (for flavour + the brain context).
export function moodWord(m) {
  if (m >= 0.75) return 'cheerful';
  if (m >= 0.5) return 'content';
  if (m >= 0.28) return 'weary';
  return 'mardy';
}

const GREET = [
  "Now then.", "Ayup.", "Eh up, stranger.", "Grand day for it.",
  "Mind how tha goes.", "Tha's about, then.", "Good to see a face.",
  "Tha's out early.", "Fine weather for wanderin'.", "Keep thi wits about thee.",
];
// said of an evening, when t' lamps are lit an' folk are for their own doors
export const GREET_EVENING = [
  "Evenin' to thee.",
  "Neet's drawin' in — I'm for my own door.",
  "Candle's lit an' supper's on t' hearth.",
  "Mind t' moor after dark — it's no place for wanderin'.",
];
const NOSY = [
  "Where's tha headed, then?", "Tha's not frae round here, are tha?",
  "What's tha after, all this way out?", "Tha's a long way frae t' village.",
  "What's tha up to, eh?", "Owt worth seeing out yonder?",
  "Tha keeps queer hours, I'll say that.", "Seen owt strange on t' moor?",
  "Tha's been busy, by t' look of thee.", "Need a hand findin' summat?",
];
// said when the visitor's been building near where the villager finds them
const BUILD_WARM = [
  "By 'eck, what's tha throwin' up here, then?", "Tha's busy wi' summat — what's this to be?",
  "A rum spot to build, this. What's t' plan?", "Buildin', are we? Let's have a look at thi work.",
  "Tha's handy wi' stone. What's it for?", "Is this to be a house, or summat grander?",
];
const BUILD_CURT = [
  "Mind tha doesn't block t' right o' way wi' that.", "Hmf. Buildin' where tha's no business, I'd say.",
  "That's an eyesore an' no mistake.", "Whose land does tha think this is, eh?",
];
const ROLE_LINES = {
  shepherd: ["Seen any o' my yows? Daft things wander.", "Get by, dog. Not thee — t' sheep."],
  pedlar: ["Owt tha needs? Ribbons, nails, an' news.", "I've walked frae Pickering wi' a full pack."],
  constable: ["Keep it lawful, now.", "No bother round here, I trust?"],
  child: ["Are you really frae far off?", "Will tha show us a trick?", "Me mam says not to talk to ramblers. Hello!"],
  gossip: ["Did tha hear about t' Wainstones? Folk whisper.", "I don't gossip, mind — but THEY say..."],
  jetman: ["It's jet I cut — black as neet, worth a mint at Whitby.", "Bring us owt black an' glossy frae t' sands."],
  fisher: ["T' sea's lively today.", "Tide's turnin' — I'd not go far out."],
  waller: ["A good wall's dry-laid, no mortar. Tek note.", "Pickin' stone all day, me."],
  collier: ["Charcoal's slow work — tend t' clamp all neet.", "Smells o' woodsmoke, do I? Aye."],
  monk: ["Peace be on thi road.", "T' abbey bell rings for vespers soon."],
  railway: ["Mind t' line — she's due through.", "Keepin' t' permanent way, me. Hard graft."],
  cooper: ["Barrels an' butts, that's my trade.", "A tight cask keeps t' herring sweet."],
  rambler: ["Forty mile I've walked. Grand country.", "Which way's t' nearest inn, dost tha know?"],
};

// One thing a villager says of their own accord. o = {role, mood, nearBuild, outside, evening}.
export function villagerRemark(o, rng) {
  const pick = a => a[(rng() * a.length) | 0];
  const curt = (o.mood !== undefined && o.mood < 0.3);
  if (o.nearBuild && rng() < 0.85) return pick(curt ? BUILD_CURT : BUILD_WARM);
  // of an evening the greeting mostly turns to dusk talk (lamps, hearths, gettin' in)
  if (o.evening && rng() < 0.6) return pick(GREET_EVENING);
  const roleLines = ROLE_LINES[o.role] || [];
  // out on the open moor they're nosier; in the village, more neighbourly
  const pool = [];
  pool.push(...GREET);
  if (o.outside) pool.push(...NOSY, ...NOSY);
  else pool.push(...NOSY);
  if (roleLines.length && rng() < 0.5) return pick(roleLines);
  return pick(pool);
}
