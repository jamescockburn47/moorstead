// Headless: the honours layer (earned titles + standing on quest completion) is
// sound and OPT-IN. Mirrors the verify-*.mjs pattern (Gen, MOORS_SEED; a counter;
// a single OK line). We build a REAL Quests instance against the real moors geo
// (with a minimal game stub providing only what construction touches), then:
//  - exercise the title-store helpers (uniqueness, newest-worn, worn-guards);
//  - assert the giants record (folk_wade) declares a non-empty honour;
//  - assert NO v1 quest (the hand-crafted arc, the Dracula arc, or the procedural
//    errands/board notices) declares an honour — proving the stylised world is
//    untouched (only quests that opt in via `honour` ever award one).
import assert from 'node:assert';
import { Gen, MOORS_SEED } from '../src/worldgen.js';
import { Quests, buildFolkloreQuests } from '../src/quests.js';

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// A minimal game stub: construction touches only world.gen.geo, sky, seed,
// standingData (optional) and rosterClient (null-safe). No entities/ui/player are
// hit during construction or by the pure title helpers we test below.
const gen = new Gen(MOORS_SEED);
ok(gen.geo.realWorld, 'the v2 (moors) world is the real-world geo');
const game = {
  world: { gen },
  sky: { day: 1 },
  seed: MOORS_SEED,
  standingData: null,     // standingIndex() defaults to 4 when absent
  rosterClient: null,     // refreshFolkloreOffers() is null-safe -> offers nothing
};
const q = new Quests(game);

// --- title store: a fresh Quests starts with no titles ---
ok(Array.isArray(q.earnedTitles) && q.earnedTitles.length === 0, 'earnedTitles starts empty');
ok(q.wornTitle === null, 'wornTitle starts null');

// --- earnTitle: unique, newest worn by default ---
q.earnTitle('X');
q.earnTitle('X');                                   // duplicate -> ignored
ok(q.earnedTitleList().filter(t => t === 'X').length === 1, 'earnTitle is idempotent (no duplicate "X")');
ok(q.wornTitle === 'X', 'earnTitle wears the newly-earned title (X)');
q.earnTitle('Y');
ok(q.wornTitle === 'Y', 'earnTitle wears the newest title (Y)');
ok(JSON.stringify(q.earnedTitleList()) === JSON.stringify(['X', 'Y']), 'earnedTitleList preserves earned order [X, Y]');
q.earnTitle('');                                    // falsy title -> no-op (must not throw or store)
q.earnTitle(null);
ok(q.earnedTitleList().length === 2 && q.wornTitle === 'Y', 'a falsy title is ignored (list still [X, Y], worn still Y)');

// earnedTitleList returns a copy (mutating it must not affect the store)
const copy = q.earnedTitleList();
copy.push('Z');
ok(q.earnedTitleList().length === 2, 'earnedTitleList returns a defensive copy');

// --- setWornTitle: only an earned title, or null ---
q.setWornTitle('X');
ok(q.wornTitle === 'X', 'setWornTitle("X") wears an earned title');
q.setWornTitle('Z');                                // unearned -> unchanged
ok(q.wornTitle === 'X', 'setWornTitle("Z") (unearned) leaves the worn title unchanged');
q.setWornTitle(null);
ok(q.wornTitle === null, 'setWornTitle(null) clears the worn title');

// --- the giants record opts in to an honour ---
const lib = buildFolkloreQuests(gen.geo);
const wade = lib.find(r => r.id === 'folk_wade');
ok(wade, 'the giants record (folk_wade) is present');
ok(wade.honour && typeof wade.honour.title === 'string' && wade.honour.title.length > 0,
  `the giants record declares a non-empty honour.title (${wade.honour && wade.honour.title})`);
ok(wade.honour && typeof wade.honour.standing === 'number' && wade.honour.standing > 0,
  `the giants record declares honour.standing > 0 (${wade.honour && wade.honour.standing})`);

// the folklore instance carries the honour onto the live instance (so finish() can read it)
const folkInst = q.buildFolkInstance(wade, { name: 'Test Shepherd' }, { x: 0, z: 0 });
ok(folkInst.honour && folkInst.honour.title === wade.honour.title,
  'buildFolkInstance carries the honour onto the instance');

// --- the honour opt-in is surgical: ONLY the Dracula finale (drac5) awards one ---
// The hand-crafted "Hound o' the Mires" arc declares NO honour at all (pure stylised
// content). The elevated Dracula arc (Slice 1+2: drac1,drac2,dracA,dracB,drac3,drac4,
// dracC,drac5 — dracC is the Slice-2 boxes-of-earth chapter) opts in on its FINALE only
// — slaying the Count earns the game's grandest title.
const v1Arc = Object.values(q.arc);
const v1Drac = Object.values(q.dracArc);
ok(v1Arc.length === 5 && v1Drac.length === 8, `both arcs built (Hound ${v1Arc.length}, Dracula ${v1Drac.length})`);
for (const def of v1Arc) ok(!def.honour, `Hound arc chapter "${def.id}" declares no honour`);
// every Dracula chapter EXCEPT the finale declares no honour
for (const def of v1Drac) {
  if (def.id === 'drac5') continue;
  ok(!def.honour, `Dracula chapter "${def.id}" declares no honour`);
}
// the finale declares the grandest honour: a non-empty title + a standing > 0
const drac5 = q.dracArc.drac5;
ok(drac5 && drac5.honour && typeof drac5.honour.title === 'string' && drac5.honour.title.length > 0,
  `the Dracula finale (drac5) declares a non-empty honour.title (${drac5.honour && drac5.honour.title})`);
ok(drac5.honour && typeof drac5.honour.standing === 'number' && drac5.honour.standing > 0,
  `the Dracula finale (drac5) declares honour.standing > 0 (${drac5.honour && drac5.honour.standing})`);

// and the instances those defs build carry the honour faithfully: null everywhere
// except drac5, whose instance carries the finale honour onto the live quest.
for (const def of v1Arc) ok(q.buildArcInstance(def).honour === null, `Hound instance "${def.id}" has honour === null`);
for (const def of v1Drac) {
  const inst = q.buildDracInstance(def);
  if (def.id === 'drac5') {
    ok(inst.honour && inst.honour.title === drac5.honour.title,
      'buildDracInstance carries the finale honour onto the drac5 instance');
  } else {
    ok(inst.honour === null, `Dracula instance "${def.id}" has honour === null`);
  }
}

// the procedural errands / board notices the constructor produced also declare none
const procInsts = [...Object.values(q.offers), ...q.boardOffers].filter(i => !i.folk);
for (const inst of procInsts) ok(!inst.honour, `procedural quest "${inst.id}" (${inst.title}) declares no honour`);

console.log(`verify-honours: ${n} assertions OK`);
