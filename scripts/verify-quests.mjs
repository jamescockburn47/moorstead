// Headless: the v2 folklore-quest library builds, the giants record is sound, its
// giver role+place are real for the v2 world, its landmark resolves in-bounds, and
// the Wade lore is grounded in the game-facts corpus. Mirrors the verify-*.mjs
// pattern (Gen, MOORS_SEED; a counter; a single OK line). The resolver-vs-LIVE-roster
// path is exercised in the in-game smoke (a later task); here we test the pure data,
// the landmark resolver against the real moors data, and the role/place vocabulary.
import assert from 'node:assert';
import { Gen, MOORS_SEED } from '../src/worldgen.js';
import { buildFolkloreQuests, resolveLandmarkPoint, wantGiants } from '../src/quests.js';
import { EXTRA_FOLK } from '../src/villagerlife.js';
import { factsContext } from '../src/facts.js';

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

console.log(`verify-quests: ${n} assertions OK`);
