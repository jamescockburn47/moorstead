// Headless: the Dracula flagship arc (Slice 1) is sound — the moors-spanning
// mystery chain resolves in order, the finale awards the grand honour, the three
// new gathered defences exist, and the lore grounding retrieves. Mirrors the
// verify-*.mjs pattern (Gen, MOORS_SEED; a counter; a single OK line).
//
// We build a REAL Quests instance against the real moors geo (the same minimal
// game stub the honours/quests checks use), exercise the pure chain logic, and
// re-check the same dracArc in the STYLISED world (a non-moors seed) so the proof
// covers both worlds the arc serves.
import assert from 'node:assert';
import { Gen, MOORS_SEED } from '../src/worldgen.js';
import { Quests, wantWreck, wantHound } from '../src/quests.js';
import { MOB_TYPES } from '../src/entities.js';
import { I, itemName } from '../src/defs.js';
import { PRICES } from '../src/economy.js';
import { factsContext } from '../src/facts.js';

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

const ORDER = ['drac1', 'drac2', 'dracA', 'dracB', 'drac3', 'drac4', 'dracC', 'drac5'];

// A minimal game stub: construction touches only world.gen.geo, sky, seed,
// standingData (optional) and rosterClient (null-safe).
const stub = (seed, geo) => ({
  world: { gen: { geo } }, sky: { day: 1 }, seed,
  standingData: null, rosterClient: null,
});

// --- the chain resolves, in order, in BOTH worlds the arc serves ---
for (const [label, seed] of [['moors', MOORS_SEED], ['stylised', 0x5117]]) {
  const geo = new Gen(seed).geo;
  const q = new Quests(stub(seed, geo));
  const ids = Object.keys(q.dracArc);

  ok(ids.length === ORDER.length && ORDER.every(id => q.dracArc[id]),
    `[${label}] the Dracula arc has all ${ORDER.length} chapters (${ids.join(',')})`);

  // every needs target exists and points at the previous chapter (drac1 has none)
  for (let i = 0; i < ORDER.length; i++) {
    const def = q.dracArc[ORDER[i]];
    const want = i === 0 ? null : ORDER[i - 1];
    ok((def.needs || null) === want,
      `[${label}] ${def.id} needs ${want === null ? 'nothing' : `"${want}"`} (got ${def.needs || 'null'})`);
    if (def.needs) ok(!!q.dracArc[def.needs], `[${label}] ${def.id}'s needs target "${def.needs}" exists`);
  }

  // draculaNext walks the chain in exactly ORDER as each chapter is completed
  const walked = [];
  for (let i = 0; i < ORDER.length + 2; i++) {
    const nx = q.draculaNext();
    if (!nx) break;
    walked.push(nx.id);
    q.completed.push(nx.id);
  }
  ok(JSON.stringify(walked) === JSON.stringify(ORDER),
    `[${label}] draculaNext yields ${ORDER.join('→')} (got ${walked.join('→')})`);

  // the two inserted chapters route across the moor with a real grant-effect each,
  // and resolve to finite on-/off-map points without crashing in either world.
  const dracA = q.dracArc.dracA, dracB = q.dracArc.dracB;
  ok(dracA.steps[0].kind === 'visit' && dracA.steps[0].effect === 'dropSilverToken' &&
    Number.isFinite(dracA.steps[0].x) && Number.isFinite(dracA.steps[0].z),
    `[${label}] dracA visits the moor cross with dropSilverToken`);
  ok(dracB.steps.some(s => s.effect === 'dropWolfsbane') &&
    dracB.steps.some(s => s.kind === 'collect' && s.item === I.WILD_GARLIC && s.n === 2),
    `[${label}] dracB grants wolfsbane and collects 2 wild garlic`);

  // Slice 2: dracC ("the boxes of earth") slots between drac4 and drac5 and is three
  // sanctifyBox visit steps at finite, distinct box sites near Whitby (both worlds).
  const dracC = q.dracArc.dracC;
  ok(dracC && dracC.needs === 'drac4', `[${label}] dracC follows drac4 (needs "${dracC && dracC.needs}")`);
  ok(q.dracArc.drac5.needs === 'dracC', `[${label}] drac5 now follows dracC (needs "${q.dracArc.drac5.needs}")`);
  ok(dracC.steps.length === 3 && dracC.steps.every(s => s.kind === 'visit' && s.effect === 'sanctifyBox' &&
    Number.isFinite(s.x) && Number.isFinite(s.z)),
    `[${label}] dracC is 3 finite sanctifyBox visit steps`);
  ok(new Set(dracC.steps.map(s => `${s.x},${s.z}`)).size === 3,
    `[${label}] dracC's three box sites are distinct points`);

  // Slice 2: drac5 spawns the Count at a finite arena (dual-world: arena in v2, moor in stylised)
  const spawnAt = q.dracArc.drac5.steps[0].spawnAt;
  ok(spawnAt && Number.isFinite(spawnAt.x) && Number.isFinite(spawnAt.z) && spawnAt.night === true,
    `[${label}] drac5 spawnAt is a finite night arena (${spawnAt && spawnAt.x},${spawnAt && spawnAt.z})`);

  // the finale (drac5) declares the grandest honour
  const h = q.dracArc.drac5.honour;
  ok(h && typeof h.title === 'string' && h.title.length > 0 && typeof h.standing === 'number' && h.standing > 0,
    `[${label}] drac5 declares a valid honour (title "${h && h.title}", standing ${h && h.standing})`);
  // and a built instance carries that honour through to finish()
  ok(q.buildDracInstance(q.dracArc.drac5).honour?.title === h.title,
    `[${label}] the drac5 instance carries the finale honour`);
}

// --- the three new gathered defences exist (id + name + a small worth) ---
for (const key of ['WOLFSBANE', 'SILVER_TOKEN', 'GRAVE_EARTH']) {
  const id = I[key];
  ok(Number.isInteger(id), `I.${key} is a defined item id (${id})`);
  ok(itemName(id) && itemName(id) !== '?', `I.${key} has a display name ("${itemName(id)}")`);
  ok(typeof PRICES[id] === 'number' && PRICES[id] > 0, `I.${key} has a small worth (${PRICES[id]}d)`);
}
// the ids are distinct and free (no collision with the prior block ending at CARVED_JET)
{
  const ids = [I.WOLFSBANE, I.SILVER_TOKEN, I.GRAVE_EARTH];
  ok(new Set(ids).size === 3, 'the three new item ids are distinct');
  ok(ids.every(id => id > I.CARVED_JET), 'the three new item ids sit above the prior items');
}

// --- the lore grounding retrieves (so NPCs tell the real story) ---
{
  const c1 = factsContext('who is Count Dracula');
  ok(/stoker/i.test(c1) && /(demeter|whitby|199)/i.test(c1), 'the dracula fact retrieves for "who is Count Dracula"');
  const c2 = factsContext('how do I protect against a vampire');
  ok(/wolfsbane/i.test(c2) && /(garlic|stake|silver|holy water)/i.test(c2),
    'the vampire-defences fact retrieves for "how do I protect against a vampire"');
}

// ===========================================================================
// Slice 1b: the arc OPENS and CHAINS in the MOORS world via the Whitby harbour +
// roster givers (no museum), and the stylised world is UNCHANGED (museum opening).
// ===========================================================================

// (a) abbeyFont() is a real, in-bounds point in v2 (not the 1e6 off-map sentinel),
//     so drac3 ("draw holy water from the abbey font") is reachable on the moor.
{
  const geo = new Gen(MOORS_SEED).geo;
  const b = geo.worldBounds();
  const inB = p => p && Number.isFinite(p.x) && Number.isFinite(p.z) &&
    p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ;
  const font = geo.abbeyFont();
  ok(font.x !== 1e6 && font.z !== 1e6, `[moors] abbeyFont() is real, not the off-map sentinel (${font.x},${font.z})`);
  ok(inB(font), `[moors] abbeyFont() is in-bounds (${font.x},${font.z} within ${b.maxX|0}x${b.maxZ|0})`);
  ok(geo.coastT(font.x, font.z) === 0, `[moors] abbeyFont() sits on solid ground (coastT 0)`);
  ok(geo.nearAbbey(font.x, font.z), `[moors] abbeyFont() lies on the consecrated abbey headland (nearAbbey)`);
  // the Whitby harbour wreck-site is a real, in-bounds, solid-ground point in the town
  const harbour = geo.whitbyHarbour();
  ok(harbour && inB(harbour), `[moors] whitbyHarbour() is a real in-bounds point (${harbour && harbour.x},${harbour && harbour.z})`);
  ok(harbour && geo.coastT(harbour.x, harbour.z) === 0, `[moors] whitbyHarbour() sits on the strand (coastT 0)`);
  ok(harbour && geo.inWhitby(harbour.x, harbour.z), `[moors] whitbyHarbour() is within Whitby`);
}

// (b)+(c) the v2 offering resolves drac1's giver to a Whitby roster role at the real
//          harbour landmark, and drac1/drac2 in v2 use harbour/visit steps (not museum).
{
  const geo = new Gen(MOORS_SEED).geo;
  const harbour = geo.whitbyHarbour();
  // a live roster: a fishwife at Whitby (the Demeter account), a moor parson, Bess @ Lealholm.
  // resolveGiver reads only rosterClient.npcs (id -> {data}); place = state.place||village||home.
  // We also seed a shepherd at Goathland so the folk_wade quest binds to its OWN giver and
  // doesn't fall back to the parson (a realistic roster has both); the parson sits at Danby.
  const npcs = new Map([
    ['n1', { data: { id: 'n1', name: 'Mary Storr', role: 'fishwife', village: 'Whitby' } }],
    ['n2', { data: { id: 'n2', name: 'Parson Gray', role: 'parson', village: 'Danby' } }],
    ['n3', { data: { id: 'n3', name: 'Bess', role: 'herbwife', village: 'Lealholm' } }],
    ['n4', { data: { id: 'n4', name: 'Old Tom', role: 'shepherd', village: 'Goathland' } }],
  ]);
  const game = { ...stub(MOORS_SEED, geo), rosterClient: { npcs } };
  const q = new Quests(game);

  // drac1/drac2 in v2 are harbour visit steps, NOT kind:'museum'
  const d1 = q.dracArc.drac1, d2 = q.dracArc.drac2;
  ok(d1.steps[0].kind === 'visit' && !d1.steps.some(s => s.kind === 'museum'),
    `[moors] drac1 is a visit step (not museum)`);
  ok(harbour && d1.steps[0].x === harbour.x && d1.steps[0].z === harbour.z,
    `[moors] drac1 routes to the real Whitby harbour point (${d1.steps[0].x},${d1.steps[0].z})`);
  ok(d2.steps[0].kind === 'visit' && !d2.steps.some(s => s.kind === 'museum'),
    `[moors] drac2 is a talk/visit step at the harbour (not kind:'museum')`);
  ok(harbour && d2.steps[0].x === harbour.x && d2.steps[0].z === harbour.z,
    `[moors] drac2 routes to the real Whitby harbour point`);

  // the offering binds drac1 to the Whitby fishwife and surfaces it via offerFor()
  const offered = q.offerFor('Mary Storr');
  ok(offered && offered.id === 'drac1' && offered.dracArc,
    `[moors] the v2 offering surfaces drac1 from the Whitby fishwife (offerFor -> ${offered && offered.id})`);
  ok(offered && offered.giver === 'Mary Storr',
    `[moors] drac1's giver is bound to the resolved roster fishwife's name`);

  // and it CHAINS: as each offered chapter is "completed", the next is offered by its
  // roster giver — drac1+drac2 -> the fishwife, dracA -> the parson, dracB -> Bess. We
  // simulate accept+complete purely (push to completed, clear the slot, re-offer), the same
  // way the chain block above walks draculaNext, so no full game stub (ui/saveNow) is needed.
  const chain = [];
  for (let i = 0; i < 8; i++) {
    const inst = Object.values(q.offers).find(o => o && o.dracArc);
    if (!inst) break;
    chain.push({ id: inst.id, giver: inst.giver });
    q.completed.push(inst.id);
    delete q.offers[(inst.giver || '').toLowerCase()];
    q.refreshOffers();
  }
  const ids = chain.map(c => c.id);
  ok(JSON.stringify(ids) === JSON.stringify(['drac1', 'drac2', 'dracA', 'dracB']),
    `[moors] the arc chains drac1->drac2->dracA->dracB via roster givers (got ${ids.join('->')})`);
  ok(chain[0].giver === 'Mary Storr' && chain[1].giver === 'Mary Storr',
    `[moors] drac1+drac2 are given by the Whitby fishwife`);
  ok(chain[2].giver === 'Parson Gray', `[moors] dracA is given by the parson (got ${chain[2].giver})`);
  ok(chain[3].giver === 'Bess', `[moors] dracB is given by the herbwife Bess (got ${chain[3].giver})`);
  // drac3 carries no v2 giver, so it is not surfaced as an offer (advances on its own steps)
  ok(!Object.values(q.offers).some(o => o && o.dracArc),
    `[moors] drac3+ are not roster-offered (they advance on their own steps)`);
}

// (d) the STYLISED arc is unchanged: it opens at the museum (drac1 visits museumSite,
//     drac2 reads exhibits via kind:'museum') and museumOffer() drives it.
{
  const geo = new Gen(0x5117).geo;
  const q = new Quests(stub(0x5117, geo));
  const ms = geo.museumSite();
  const d1 = q.dracArc.drac1, d2 = q.dracArc.drac2;
  ok(d1.steps[0].kind === 'visit' && d1.steps[0].x === ms.x && d1.steps[0].z === ms.z,
    `[stylised] drac1 still visits the Whitby museum site`);
  ok(d2.steps[0].kind === 'museum',
    `[stylised] drac2 still uses kind:'museum' (read the exhibits)`);
  ok(d1.giver === 'museum' && d2.giver === 'museum',
    `[stylised] drac1/drac2 are still given by the museum board`);
  const off = q.museumOffer();
  ok(off && off.id === 'drac1' && off.dracArc,
    `[stylised] museumOffer() opens the arc at drac1 (got ${off && off.id})`);
}

// ===========================================================================
// Slice 2: the East Cliff arena, the boxes-of-earth counter + persistence, the
// sanctifyBox effect, and the bat summon type. (The boss combat — summons/warding/
// kill-gate — lives in entities.js updateDraculaBoss/hurtMob and is exercised in
// the in-game smoke; here we prove the data + state the arc and the gate depend on.)
// ===========================================================================

// (e) the v2 arena is a real, in-bounds, solid clifftop point on the East Cliff by the abbey
{
  const geo = new Gen(MOORS_SEED).geo;
  const b = geo.worldBounds();
  const inB = p => p && Number.isFinite(p.x) && Number.isFinite(p.z) &&
    p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ;
  const arena = geo.draculaArena();
  ok(arena.x !== 1e6 && arena.z !== 1e6, `[moors] draculaArena() is real, not the off-map sentinel (${arena.x},${arena.z})`);
  ok(inB(arena), `[moors] draculaArena() is in-bounds (${arena.x},${arena.z})`);
  ok(geo.coastT(arena.x, arena.z) === 0, `[moors] draculaArena() sits on solid ground (coastT 0)`);
  ok(geo.nearAbbey(arena.x, arena.z), `[moors] draculaArena() lies on the consecrated abbey headland (nearAbbey)`);
  ok(typeof arena.r === 'number' && arena.r > 0, `[moors] draculaArena() carries a trigger radius (r ${arena.r})`);
  // the Count's spawn corner (quests update spawns at spawnAt.x+4.5) is also solid land
  ok(geo.coastT(arena.x + 4, arena.z + 4) === 0, `[moors] the arena spawn corner is on land (coastT 0)`);
}

// (f) boxesSanctified defaults to 0 and round-trips through serialize/deserialize (mirrors earnedTitles)
{
  const geo = new Gen(MOORS_SEED).geo;
  const q = new Quests(stub(MOORS_SEED, geo));
  ok(q.boxesSanctified === 0, `[moors] boxesSanctified defaults to 0`);
  q.boxesSanctified = 2;
  const blob = q.serialize();
  ok(blob.boxesSanctified === 2, `[moors] serialize() carries boxesSanctified (${blob.boxesSanctified})`);
  const q2 = new Quests(stub(MOORS_SEED, geo));
  q2.deserialize(blob);
  ok(q2.boxesSanctified === 2, `[moors] deserialize() restores boxesSanctified (${q2.boxesSanctified})`);
  // an old save with no field defaults safely to 0
  const q3 = new Quests(stub(MOORS_SEED, geo));
  q3.deserialize({});
  ok(q3.boxesSanctified === 0, `[moors] deserialize() of an old save defaults boxesSanctified to 0`);
}

// (g) the sanctifyBox effect increments the counter and consumes holy water when held
{
  const geo = new Gen(MOORS_SEED).geo;
  const q = new Quests(stub(MOORS_SEED, geo));
  // a minimal player/ui/audio for applyEffect's sanctifyBox path
  let water = 1;
  const fakeGame = {
    player: { countItem: id => (id === I.HOLY_WATER ? water : 0), removeItem: (id, k) => { if (id === I.HOLY_WATER) water -= k; } },
    ui: { invDirty: false, toast() {} }, audio: { pickup() {} },
  };
  q.game = fakeGame;
  q.applyEffect('sanctifyBox', {}, {});
  ok(q.boxesSanctified === 1 && water === 0, `[moors] sanctifyBox blesses box 1 and consumes held holy water`);
  q.applyEffect('sanctifyBox', {}, {});          // no water now — still marks for playability
  ok(q.boxesSanctified === 2 && water === 0, `[moors] sanctifyBox still marks a box when no holy water is held`);
  q.applyEffect('sanctifyBox', {}, {});
  ok(q.boxesSanctified === 3, `[moors] three sanctifyBox calls reach the kill-gate threshold (>=3)`);
}

// (h) the Count's bat summon type exists and never wild-spawns (natural:false, cap:0)
{
  ok(MOB_TYPES.bat && typeof MOB_TYPES.bat.make === 'function', `the bat summon mob type exists`);
  ok(MOB_TYPES.bat.natural === false && MOB_TYPES.bat.cap === 0,
    `the bat never wild-spawns (natural:false, cap:0)`);
  ok(MOB_TYPES.bat.fly === true && MOB_TYPES.bat.night === true,
    `the bat is a night flier (fly:true, night:true)`);
}

// ===========================================================================
// Slice 3: the Demeter wreck + the black-hound manifestation. The wreck/hound
// MOB_TYPES exist as no-AI props, the pure spawn predicates gate them to v2 + the
// opening chapters (hound also night-gated), and the captain's-log grant is once-only.
// ===========================================================================

// (i) the wreck + hound mob types exist, never wild-spawn, and skip all mob AI (special)
{
  for (const key of ['wreck', 'houndspectre']) {
    ok(MOB_TYPES[key] && typeof MOB_TYPES[key].make === 'function', `the ${key} mob type exists`);
    ok(MOB_TYPES[key].natural === false && MOB_TYPES[key].cap === 0,
      `the ${key} never wild-spawns (natural:false, cap:0)`);
    ok(MOB_TYPES[key].special === true, `the ${key} is a special no-AI prop (skipped by updateMobs)`);
    ok(MOB_TYPES[key].hostile === false, `the ${key} is harmless (hostile:false)`);
  }
}

// (j) wantWreck: TRUE only in the moors world on the opening chapters; FALSE if either gate is off
{
  ok(wantWreck({ realWorld: true, onOpening: true }) === true,
    'wantWreck is TRUE when realWorld + onOpening both hold');
  for (const gate of ['realWorld', 'onOpening']) {
    const args = { realWorld: true, onOpening: true };
    args[gate] = false;
    ok(wantWreck(args) === false, `wantWreck is FALSE when ${gate} is false`);
  }
  ok(wantWreck({ realWorld: false, onOpening: true }) === false,
    'wantWreck is FALSE in the stylised world (realWorld false), even on the opening');
}

// (k) wantHound: TRUE only in the moors world, on the opening, AT NIGHT; FALSE if any gate is off
{
  ok(wantHound({ realWorld: true, onOpening: true, night: true }) === true,
    'wantHound is TRUE when realWorld + onOpening + night all hold');
  for (const gate of ['realWorld', 'onOpening', 'night']) {
    const args = { realWorld: true, onOpening: true, night: true };
    args[gate] = false;
    ok(wantHound(args) === false, `wantHound is FALSE when ${gate} is false`);
  }
  // the hound is strictly night-gated on top of the wreck's gates
  ok(wantHound({ realWorld: true, onOpening: true, night: false }) === false,
    'wantHound is FALSE by day even on the opening (night gate)');
}

// (l) draculaOnOpening() is true only while drac1/drac2 are active
{
  const geo = new Gen(MOORS_SEED).geo;
  const q = new Quests(stub(MOORS_SEED, geo));
  ok(q.draculaOnOpening() === false, 'draculaOnOpening() is false with no active chapter');
  q.active = [{ id: 'drac1' }];
  ok(q.draculaOnOpening() === true, 'draculaOnOpening() is true on drac1');
  q.active = [{ id: 'drac2' }];
  ok(q.draculaOnOpening() === true, 'draculaOnOpening() is true on drac2');
  q.active = [{ id: 'dracA' }];
  ok(q.draculaOnOpening() === false, 'draculaOnOpening() is false once the arc moves on (dracA)');
}

// (m) the captain's-log grant is ONCE-ONLY (guarded by draculaLogTaken) and persists
{
  const geo = new Gen(MOORS_SEED).geo;
  const q = new Quests(stub(MOORS_SEED, geo));
  let logs = 0, toasts = 0;
  q.game = {
    player: { addItem: id => { if (id === I.DRACULA_JOURNAL) logs++; return 0; } },
    ui: { invDirty: false, toast() { toasts++; } }, audio: { pickup() {} },
  };
  ok(q.draculaLogTaken === false, 'draculaLogTaken defaults to false');
  ok(q.grantDraculaLog() === true && logs === 1, 'grantDraculaLog() grants the log on the first call');
  ok(q.grantDraculaLog() === false && logs === 1, 'grantDraculaLog() is a no-op on the second call (once-only)');
  ok(q.grantDraculaLog() === false && logs === 1, 'grantDraculaLog() stays a no-op thereafter');
  ok(q.draculaLogTaken === true, 'draculaLogTaken is set after the grant');
  // it round-trips so a reload never re-grants the log
  const blob = q.serialize();
  ok(blob.draculaLogTaken === true, 'serialize() carries draculaLogTaken');
  const q2 = new Quests(stub(MOORS_SEED, geo));
  q2.deserialize(blob);
  ok(q2.draculaLogTaken === true, 'deserialize() restores draculaLogTaken (no re-grant on reload)');
  const q3 = new Quests(stub(MOORS_SEED, geo));
  q3.deserialize({});
  ok(q3.draculaLogTaken === false, 'deserialize() of an old save defaults draculaLogTaken to false');
}

// --- the Dracula arc is kept OUT of the bairns' (children's) world, even though it
//     now uses the real-Moors seed (which would otherwise enable the arc) ---
{
  const geo = new Gen(MOORS_SEED).geo;
  const mk = (room) => ({ world: { gen: { geo } }, sky: { day: 1 }, seed: MOORS_SEED, standingData: null, rosterClient: null, netRoom: room });
  const q = new Quests(mk('bairns'));
  ok(Object.keys(q.dracArc).length === 0, 'bairns world: the Dracula arc is empty (no chapters)');
  ok(q.draculaNext() === null, 'bairns world: draculaNext() returns null (no crash on the empty arc)');
  ok(q.museumOffer() === null, 'bairns world: no Dracula chapter is ever offered');
  ok(Object.keys(new Quests(mk('moor')).dracArc).length === ORDER.length, 'adult moors world still gets the full Dracula arc');
}

console.log(`verify-dracula: ${n} assertions OK`);
