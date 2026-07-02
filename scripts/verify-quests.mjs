// Headless: the v2 folklore-quest library builds, the giants record is sound, its
// giver role+place are real for the v2 world, its landmark resolves in-bounds, and
// the Wade lore is grounded in the game-facts corpus. Mirrors the verify-*.mjs
// pattern (Gen, MOORS_SEED; a counter; a single OK line). The resolver-vs-LIVE-roster
// path is exercised in the in-game smoke (a later task); here we test the pure data,
// the landmark resolver against the real moors data, and the role/place vocabulary.
import assert from 'node:assert';
import { Gen, MOORS_SEED } from '../src/worldgen.js';
import { buildFolkloreQuests, resolveLandmarkPoint, wantGiants, buildHobArc, Quests } from '../src/quests.js';
import { EXTRA_FOLK } from '../src/villagerlife.js';
import { factsContext } from '../src/facts.js';
import { I, B, itemName } from '../src/defs.js';
import { LORE } from '../src/lore.js';

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const geo = new Gen(MOORS_SEED).geo;
ok(geo.realWorld, 'the v2 (moors) world is the real-world geo');

// --- the library builds and carries the giants ---
const lib = buildFolkloreQuests(geo);
ok(Array.isArray(lib) && lib.length >= 1, `buildFolkloreQuests returns ≥1 record (got ${lib.length})`);
const wade = lib.find(q => q.id === 'folk_wade');
ok(wade, 'the giants record (folk_wade) is present');
ok(typeof wade.truth === 'string' && wade.truth.length > 0, 'the giants record has non-empty truth');
ok(Array.isArray(wade.loreFacts) && wade.loreFacts.length > 0 && wade.loreFacts.every(f => typeof f === 'string' && f.length > 0),
  'the giants record has non-empty loreFacts');
ok(wade.manifestation === 'giants', "the giants record carries manifestation:'giants' (the later visible payoff)");
ok(wade.steps.length >= 1 && wade.steps[0].kind === 'visit' && wade.steps[0].time === 'duskOrNight',
  'the giants step is a dusk-or-night visit');
ok(wade.reward && Array.isArray(wade.reward.items) && wade.reward.items.length > 0, 'the giants record has a reward item');

// --- the giver role + place are real for the v2 world ---
const town = geo.villages.find(v => v.name === wade.giver.place);
ok(town, `the giants giver place is a real v2 town (${wade.giver.place})`);
const producibleRoles = new Set(EXTRA_FOLK.map(f => f.role));   // the population's role vocabulary
ok(producibleRoles.has(wade.giver.role), `the giants giver role is one the population produces (${wade.giver.role})`);

// --- the landmark resolves to an in-bounds point (the real resolver, real data) ---
const lm = resolveLandmarkPoint(geo, wade.landmark);
ok(lm && Number.isFinite(lm.x) && Number.isFinite(lm.z), `resolveLandmark returns a finite {x,z} for the giants (${lm && `${Math.round(lm.x)},${Math.round(lm.z)}`})`);
const b = geo.worldBounds();
ok(lm.x >= b.minX && lm.x <= b.maxX && lm.z >= b.minZ && lm.z <= b.maxZ, 'the giants landmark is in-world bounds');
// it should be the real Wade's Causeway marker that ships in the moors data
const dataLm = geo.data.landmarks.find(l => /wade/i.test(l.name));
ok(dataLm, "Wade's Causeway is present in the moors data landmarks");
ok(Math.abs(lm.x - dataLm.x) < 80 && Math.abs(lm.z - dataLm.z) < 80, "the resolved landmark sits on the real Wade's Causeway");

// an unknown landmark key resolves to null (the quest is then simply not offered, no crash)
ok(resolveLandmarkPoint(geo, 'no_such_landmark') === null, 'an unknown landmark key resolves to null (fails safe)');

// --- the Wade lore is grounded: ANY NPC retrieves it for the obvious questions ---
{
  const c1 = factsContext('who is Wade');
  ok(/wade/i.test(c1) && /giant/i.test(c1), 'the Wade fact retrieves for "who is Wade"');
  const c2 = factsContext("what is Wade's causeway");
  ok(/causeway|wheeldale|causey/i.test(c2), 'the Wade fact retrieves for "what is Wade\'s causeway"');
}

// --- the manifestation gate (wantGiants): the pure spawn predicate ---
// TRUE only when ALL four gates hold, so the giants never leak into normal play or
// the stylised world; FALSE if ANY single gate is false.
ok(wantGiants({ realWorld: true, questActive: true, dusk: true, near: true }) === true,
  'wantGiants is TRUE when all four gates hold (realWorld + questActive + dusk + near)');
for (const gate of ['realWorld', 'questActive', 'dusk', 'near']) {
  const args = { realWorld: true, questActive: true, dusk: true, near: true };
  args[gate] = false;
  ok(wantGiants(args) === false, `wantGiants is FALSE when ${gate} is false`);
}
// the stylised world (realWorld false) can never raise the giants, whatever else holds
ok(wantGiants({ realWorld: false, questActive: true, dusk: true, near: true }) === false,
  'wantGiants is FALSE in the stylised world (realWorld false), even with quest+dusk+near');
// falsy/missing fields are handled (no quest instance, etc.)
ok(wantGiants({ realWorld: true, questActive: null, dusk: true, near: true }) === false,
  'wantGiants is FALSE when questActive is missing (null)');

// ===========================================================================
// T' Hob o' Farndale (hob1..hob4): shape, chain, gates, givers, locations,
// items, honour — then the offer flow through a REAL Quests instance, so the
// arc is proven to surface through the same curated-giver wiring as the
// Barghest arc, not just to exist as data.
// ===========================================================================

// every step kind the engine actually handles (update / onBlockPlaced /
// onBlockBroken / onMuseumRead) — a hob step outside this set would be dead
const KNOWN_STEP_KINDS = new Set(['visit', 'collect', 'fetch', 'escort', 'kill', 'place', 'wall', 'build', 'dig', 'museum']);
// the curated givers refreshOffers loops over — a giver outside this set is never offered
const CURATED = new Set(['james', 'glinda', 'harry', 'karen', 'cc']);
const HOB_ORDER = ['hob1', 'hob2', 'hob3', 'hob4'];

const hob = buildHobArc(geo);
ok(HOB_ORDER.every(id => hob[id] && hob[id].id === id), 'hob arc carries hob1..hob4 with ids matching keys');
ok(Object.keys(hob).length === HOB_ORDER.length, `hob arc is exactly ${HOB_ORDER.length} chapters`);

// --- the chain: slots in mid-game, after the White Lady (arc2), links unbroken ---
ok(hob.hob1.needs === 'arc2', 'hob1 needs arc2 (the arc opens after the Barghest’s White Lady chapter)');
ok(hob.hob1.minStanding >= 1, `hob1 is standing-gated at >= 1 (got ${hob.hob1.minStanding})`);
for (let i = 1; i < HOB_ORDER.length; i++) {
  ok(hob[HOB_ORDER[i]].needs === HOB_ORDER[i - 1], `${HOB_ORDER[i]} needs ${HOB_ORDER[i - 1]}`);
  ok((hob[HOB_ORDER[i]].minStanding || 0) >= (hob[HOB_ORDER[i - 1]].minStanding || 0),
    `${HOB_ORDER[i]} minStanding never drops below ${HOB_ORDER[i - 1]}’s`);
}

// --- givers/turn-ins are curated villagers the offer loop can actually reach ---
for (const id of HOB_ORDER) {
  const d = hob[id];
  ok(CURATED.has(d.giver), `${id} giver "${d.giver}" is a curated villager`);
  ok(d.turnIn === 'auto' || CURATED.has(d.turnIn), `${id} turnIn "${d.turnIn}" resolves (curated or auto)`);
  for (const c of d.clues || []) {
    ok(CURATED.has(c.holder) && typeof c.text === 'string' && c.text.length > 0, `${id} clue holder "${c.holder}" resolves with text`);
  }
}
ok(hob.hob2.giver === 'glinda' && hob.hob3.giver === 'glinda', 'the lore/custom chapters (hob2, hob3) are Granny Glinda’s');
ok(hob.hob1.giver === 'james' && hob.hob4.giver === 'james', 'the farm chapters (hob1, hob4) are Farmer James’s');

// --- every step is a kind the engine knows; every visit resolves in-bounds ---
const hb = geo.worldBounds();
for (const id of HOB_ORDER) {
  for (const s of hob[id].steps) {
    ok(KNOWN_STEP_KINDS.has(s.kind), `${id} step kind "${s.kind}" is one the engine handles`);
    ok(typeof s.objective === 'string' && s.objective.length > 0, `${id} step has a non-empty objective`);
    if (s.kind === 'visit') {
      ok(Number.isFinite(s.x) && Number.isFinite(s.z) && s.r > 0, `${id} visit step has finite {x,z} and r > 0`);
      ok(s.x >= hb.minX && s.x <= hb.maxX && s.z >= hb.minZ && s.z <= hb.maxZ, `${id} visit target is in world bounds`);
    }
  }
  // NPC-brain integrity fields the chat layer feeds on
  for (const f of ['title', 'desc', 'offer', 'truth', 'doneNote']) {
    ok(typeof hob[id][f] === 'string' && hob[id][f].length > 0, `${id} carries a non-empty ${f}`);
  }
}

// --- the farm: one spot for the whole arc, up Farndale off Hutton-le-Hole, dry land ---
const farm = hob.hob1.steps[0];
const hutton = geo.villages.find(v => v.name === 'Hutton-le-Hole');
ok(hutton, 'Hutton-le-Hole (the Farndale gateway village) is a real v2 town');
ok(Math.hypot(farm.x - hutton.x, farm.z - hutton.z) < 200, 'Dale End Farm is a short walk from Hutton-le-Hole');
ok(HOB_ORDER.every(id => hob[id].steps.every(s => s.kind !== 'visit' || (s.x === farm.x && s.z === farm.z))),
  'every hob visit step points at the same farm');
ok(!geo.riverColumn(Math.round(farm.x), Math.round(farm.z)), 'the farm is not in the River Dove channel');
ok(geo.coastT(farm.x, farm.z) === 0, 'the farm is inland');
ok(geo.bogginess(Math.round(farm.x), Math.round(farm.z)) < 0.3, 'the farm stands on dry ground');

// --- the night beats reuse the existing gates (arc1's night, the folk duskOrNight) ---
ok(hob.hob2.steps[0].duskOrNight === true, 'hob2 listens at gloamin’ (duskOrNight gate)');
ok(hob.hob3.steps[0].night === true, 'hob3 leaves the offering after dark (the arc1 night gate)');
ok(hob.hob3.steps[0].requireItem === I.PARCEL, 'hob3 requires the jug (I.PARCEL) in hand');
ok(Array.isArray(hob.hob3.grantOnAccept) && hob.hob3.grantOnAccept.some(([id, cnt]) => id === I.PARCEL && cnt >= 1),
  'hob3 grants the jug on accept, so its requireItem is always satisfiable');
ok(hob.hob3.turnIn === 'auto', 'hob3 completes at the hearthstone (auto turn-in, like the Dracula field chapters)');

// --- rewards use only real items/blocks; trust goes to curated folk; honour on the finale only ---
for (const id of HOB_ORDER) {
  const r = hob[id].reward;
  ok(r && Array.isArray(r.items) && typeof r.text === 'string' && r.text.length > 0, `${id} reward has items[] and text`);
  for (const [item, cnt] of r.items) {
    ok(typeof itemName(item) === 'string' && itemName(item).length > 0 && cnt > 0, `${id} reward item ${item} ("${itemName(item)}") is a real item x${cnt}`);
  }
  for (const [who, amt] of r.trust || []) {
    ok(CURATED.has(who) && amt > 0, `${id} trust reward goes to curated "${who}"`);
  }
}
ok(!hob.hob1.honour && !hob.hob2.honour && !hob.hob3.honour, 'only the finale carries an honour');
ok(hob.hob4.honour && typeof hob.hob4.honour.title === 'string' && hob.hob4.honour.title.length > 0
  && typeof hob.hob4.honour.standing === 'number' && hob.hob4.honour.standing > 0,
  `hob4 declares the honour ("${hob.hob4.honour && hob.hob4.honour.title}", standing ${hob.hob4.honour && hob.hob4.honour.standing})`);

// --- the stylised world degrades gracefully (no Hutton-le-Hole -> home-dale fallback) ---
{
  const styGeo = new Gen(0x5117).geo;
  ok(!styGeo.realWorld, 'seed 0x5117 builds the stylised world');
  const styHob = buildHobArc(styGeo);
  const s = styHob.hob1.steps[0];
  ok(Number.isFinite(s.x) && Number.isFinite(s.z), 'the stylised-world farm point resolves finite (graceful degrade)');
}

// --- the offer flow, through a REAL Quests instance (the same wiring as the arc) ---
{
  const gen2 = new Gen(MOORS_SEED);
  const game = {
    world: { gen: gen2 },
    sky: { day: 1 },
    seed: MOORS_SEED,
    standingData: null,     // standingIndex() defaults to max when absent
    rosterClient: null,     // folklore/Dracula v2 offers are null-safe -> nothing offered
  };
  const q = new Quests(game);
  ok(!Object.values(q.offers).some(o => o && HOB_ORDER.includes(o.id)), 'no hob chapter is offered before arc2 is done');

  // arc2 done, standing "Welcomed" (idx 2, enough for every hob gate) ->
  // James offers hob1 through the ordinary giver slot
  game.standingData = { total_trust: 30 };
  q.completed.push('arc1', 'arc2');
  q.offers = {};
  q.refreshOffers();
  ok(q.offers.james && q.offers.james.id === 'hob1', 'after arc2, Farmer James offers hob1');
  ok(q.offers.james.state === 'offered' && q.offers.james.arc === true, 'the hob1 instance is a proper arc offer');
  ok(q.offers.james.honour === null, 'the hob1 instance carries no honour');

  // while a hob chapter is active, no next chapter is offered
  const inst1 = q.offers.james;
  inst1.state = 'active'; q.active.push(inst1); delete q.offers.james;
  ok(q.hobNext() === null, 'no next hob chapter while one is active');
  q.active = q.active.filter(a => a.id !== 'hob1');

  // hob1 done -> Glinda offers hob2 (the gloamin' listen)
  q.completed.push('hob1'); q.offers = {}; q.refreshOffers();
  ok(q.offers.glinda && q.offers.glinda.id === 'hob2', 'after hob1, Granny Glinda offers hob2');

  // hob2 done -> Glinda offers hob3, and the INSTANCE carries the jug grant + night gate
  q.completed.push('hob2'); q.offers = {}; q.refreshOffers();
  const i3 = q.offers.glinda;
  ok(i3 && i3.id === 'hob3', 'after hob2, Granny Glinda offers hob3');
  ok(Array.isArray(i3.grantOnAccept) && i3.grantOnAccept.some(([id, cnt]) => id === I.PARCEL && cnt >= 1),
    'buildArcInstance carries grantOnAccept (the jug) onto the hob3 instance');
  ok(i3.steps[0].night === true && i3.steps[0].requireItem === I.PARCEL, 'the hob3 instance keeps its night + requireItem gates');

  // hob3 done -> James offers the finale, honour carried onto the instance
  q.completed.push('hob3'); q.offers = {}; q.refreshOffers();
  ok(q.offers.james && q.offers.james.id === 'hob4', 'after hob3, Farmer James offers the finale (hob4)');
  ok(q.offers.james.honour && q.offers.james.honour.title === hob.hob4.honour.title,
    'buildArcInstance carries the honour onto the hob4 instance');

  // the standing gate holds: below Known (idx 1), hob1 is held back
  game.standingData = { total_trust: 0 };
  q.completed = ['arc1', 'arc2']; q.active = []; q.offers = {};
  q.refreshOffers();
  ok(!Object.values(q.offers).some(o => o && HOB_ORDER.includes(o.id)), 'hob1 is held back below standing 1');
  game.standingData = null;

  // --- the step effects are real: applyEffect handles both hob beats ---
  const inv = new Map([[I.PARCEL, 1]]);
  game.player = {
    pos: { x: 0, y: 0, z: 0 },
    countItem: id => inv.get(id) || 0,
    removeItem: (id, cnt) => inv.set(id, Math.max(0, (inv.get(id) || 0) - cnt)),
    addItem: () => 0,
  };
  game.ui = { toast() {}, invDirty: false };
  game.audio = { pickup() {} };
  const hobEffects = new Set();
  for (const id of HOB_ORDER) for (const s of hob[id].steps) if (s.effect) hobEffects.add(s.effect);
  for (const eff of hobEffects) q.applyEffect(eff, null, {});   // must not throw
  ok(hobEffects.has('hobGlimpse') && inv.get(I.PARCEL) === 0,
    'the hearthstone effect (hobGlimpse) consumes the jug, exactly as deliver consumes the parcel');
}

// --- the hob lore rides in lore.js: Glinda holds it, a bairn garbles it ---
{
  const hobLore = LORE.filter(l => /\bhob\b/i.test(l.text));
  ok(hobLore.length >= 2, `lore.js carries hob entries (got ${hobLore.length})`);
  ok(hobLore.some(l => l.holders.includes('glinda')), 'Granny Glinda holds the hob lore');
  ok(hobLore.some(l => /cream/i.test(l.text)), 'the cream custom is in the lore');
  ok(hobLore.some(l => /flittin/i.test(l.text)), 'the Farndale flitting tale is in the lore');
  ok(LORE.some(l => l.kid && /cream/i.test(l.text) && /little brown man/i.test(l.text)), 'a bairn retells the hob garbled (kid entry)');
}

console.log(`verify-quests: ${n} assertions OK`);
