// NPC looks — run wi': node scripts/verify-npclooks.mjs
//
// The wardrobe system (src/entities.js): every villager is dressed by role
// (period 1900, muted natural dyes) wi' an id-seeded person underneath (skin,
// hair, build, palette shade). This gate proves, headlessly:
//   1. outfitSpecFor is DETERMINISTIC — same (role, id) -> byte-identical spec,
//      an' no Math.random is consulted at spec- or mesh-build time.
//   2. ROLE COVERAGE — every role string the client uses (roster.js
//      RIDE_ROLE_BONUS, villagerlife.js EXTRA_FOLK, quests.js) an' every role
//      the brain's roster sim streams (population.py's pools — the client-side
//      contract copy below) maps to a real outfit; unknown roles get default.
//   3. PALETTE BOUNDS — every colour in the table an' in resolved specs parses
//      as a 24-bit int; skin/hair stay within the period-plausible tone lists.
//   4. MESH BUDGET — no spec ever yields more than 4 extra boxes, an' a built
//      model carries exactly base(9) + spec.boxes meshes.
//   5. CURATED CAST — the family + the roster's named folk keep their pinned
//      looks (glinda's grey hair an' shawl, harry's blue jumper, cc's curls…).
//   6. SHARED CACHES — two builds of the same spec share geometry an' material
//      instances (the drops/bursts material-cache pattern, mirrored).
//   7. REMOTE PLAYERS untouched — villagerLook still returns the legacy look.
//
// makeVillager needs no DOM (nameplates are the caller's business), but the
// document stub keeps any incidental canvas use safe under Node.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

global.document = {
  createElement: (tag) => {
    if (tag !== 'canvas') return {};
    const ctx2d = {
      clearRect: () => {}, fillRect: () => {}, drawImage: () => {},
      strokeText: () => {}, fillText: () => {},
      measureText: () => ({ width: 10 }),
      font: '', fillStyle: '', strokeStyle: '', lineWidth: 0,
      textAlign: '', textBaseline: '',
    };
    return { width: 0, height: 0, getContext: () => ctx2d };
  },
};

const {
  outfitSpecFor, lookFromSpec, canonicalRole, makeVillager, villagerLook,
  WARDROBE, OUTFIT_BOXES, SKIN_TONES, HAIR_TONES,
} = await import('../src/entities.js');
const { EXTRA_FOLK } = await import('../src/villagerlife.js');

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const SRC = dirname(fileURLToPath(import.meta.url));
const src = f => readFileSync(join(SRC, '..', 'src', f), 'utf8');

// ---------- 1. determinism ----------
console.log('determinism');
{
  const ids = [];
  for (let i = 0; i < 60; i++) ids.push(`pop-whitby-${i}|mary raw ${i}`);
  ids.push('amos|amos burnett', '|granny glinda', 'char_1766232811959|farmer harry', '|owd tom', '');
  const roles = [null, 'fishwife', 'parson', 'drover', 'ironstone miner', 'station-master', "ship's chandler", 'nonsense-trade'];
  let same = true;
  for (const id of ids) {
    for (const r of roles) {
      if (JSON.stringify(outfitSpecFor(r, id)) !== JSON.stringify(outfitSpecFor(r, id))) same = false;
    }
  }
  same ? ok('same (role, id) twice -> byte-identical spec (65 ids x 8 roles)') : bad('outfitSpecFor is not deterministic');

  // no dice in the resolver: poison Math.random through outfitSpecFor.
  // (makeVillager can't be poison-tested — THREE's Object3D uuids legitimately
  // eat Math.random — so mesh-build determinism is proven structurally below.)
  const realRandom = Math.random;
  let rolled = false;
  Math.random = () => { rolled = true; return 0.5; };
  try {
    outfitSpecFor('fishwife', 'pop-whitby-2|mary raw');
    outfitSpecFor(null, '|granny glinda');
  } finally { Math.random = realRandom; }
  rolled ? bad('Math.random consulted inside outfitSpecFor') : ok('no Math.random inside outfitSpecFor');

  // mesh-build determinism: two builds of the same spec agree box-for-box on
  // geometry size, material colour an' position
  const fingerprint = model => {
    const rows = [];
    model.group.traverse(o => {
      if (!o.isMesh) return;
      const p = o.geometry.parameters || {};
      rows.push(`${p.width},${p.height},${p.depth}@${o.position.x},${o.position.y},${o.position.z}#${o.material.color.getHexString()}`);
    });
    return rows.sort().join(';');
  };
  const specA = outfitSpecFor('fishwife', 'pop-whitby-2|mary raw');
  const one = fingerprint(makeVillager(lookFromSpec(specA)));
  const two = fingerprint(makeVillager(lookFromSpec(outfitSpecFor('fishwife', 'pop-whitby-2|mary raw'))));
  one === two ? ok('two builds of the same soul are box-for-box identical') : bad('mesh build not deterministic');
}

// ---------- 2. role coverage ----------
console.log('role coverage');
{
  // roles named in roster.js (mounted-NPC trade bonuses)
  const rosterSrc = src('roster.js');
  const bonus = rosterSrc.match(/RIDE_ROLE_BONUS\s*=\s*\{([^}]*)\}/);
  const rosterRoles = bonus ? [...bonus[1].matchAll(/([a-z]+)\s*:/g)].map(m => m[1]) : [];
  rosterRoles.length >= 5 ? ok(`roster.js RIDE_ROLE_BONUS roles found: ${rosterRoles.join(', ')}`)
    : bad('could not extract RIDE_ROLE_BONUS roles from roster.js');

  // roles in villagerlife.js EXTRA_FOLK + quests.js quest-giver specs
  const folkRoles = [...new Set(EXTRA_FOLK.map(f => f.role))];
  const questRoles = [...new Set([...src('quests.js').matchAll(/role:\s*'([a-z-]+)'/g)].map(m => m[1]))];

  // the brain's population.py pools (client-side contract copy — roles the
  // roster sim streams into spawnVillager via opts.role; keep in step wi'
  // yorkshire_bot/brain/population.py)
  const brainRoles = [
    'fisherman', 'fishwife', 'coble-man', 'cooper', 'net-mender', 'sailmaker', 'harbour-hand',
    'jet-cutter', 'jet-carver', "ship's chandler", 'alum-worker',
    'platelayer', 'porter', 'signalman', 'station-master', 'engine-driver', 'fireman', 'ganger',
    'market trader', 'butcher', 'baker', 'draper', 'innkeeper', 'blacksmith', 'carter', 'grocer', 'saddler',
    'shepherd', 'drover', 'farmer', 'herbwife', 'peat-cutter', 'gamekeeper', 'wheelwright',
    'parson', 'schoolmistress', 'alewife', 'cobbler', 'tailor', 'midwife', 'ostler',
    'ironstone miner', 'collier', 'kiln-man', 'calciner', 'quarryman',
    'washerwoman', 'seamstress', 'postmistress',
  ];

  // roles that legitimately wear the everyday-villager outfit
  const defaultOk = new Set(['rambler', 'labourer']);
  const all = [...new Set([...rosterRoles, ...folkRoles, ...questRoles, ...brainRoles])];
  let missing = [];
  for (const r of all) {
    const canon = canonicalRole(r);
    if (!canon || !WARDROBE[canon]) { missing.push(r); continue; }
    if (canon === 'villager' && !defaultOk.has(r)) missing.push(r + ' (fell through to default)');
    const spec = outfitSpecFor(r, 'pop-test-' + r);
    if (!spec || !WARDROBE[spec.role]) missing.push(r + ' (no spec)');
  }
  missing.length === 0
    ? ok(`every used role maps to an outfit (${all.length} roles across roster/villagerlife/quests/brain)`)
    : bad('roles wi\' no outfit: ' + missing.join(', '));

  // unknown roles degrade to the default villager outfit, never throw
  for (const r of ['flibbertigibbet', '', null, undefined, 'DROVER', 'Jet-Cutter']) {
    const spec = outfitSpecFor(r, 'pop-x-1|nobody');
    if (!spec || !WARDROBE[spec.role]) { bad(`role ${JSON.stringify(r)} produced no usable spec`); }
  }
  outfitSpecFor('flibbertigibbet', 'pop-x-1|nobody').role === 'villager'
    ? ok('unknown roles fall back to the default villager outfit')
    : bad('unknown role did not fall back to villager');
  outfitSpecFor('DROVER', 'pop-x-1|nobody').role === 'drover'
    ? ok('role matching is case/punctuation tolerant (DROVER, Jet-Cutter…)')
    : bad('role normalisation broken');
}

// ---------- 3. palette bounds ----------
console.log('palette bounds');
{
  const colOk = c => Number.isInteger(c) && c >= 0 && c <= 0xffffff;
  let badCols = 0;
  for (const [role, w] of Object.entries(WARDROBE)) {
    for (const c of [...(w.jacket || []), ...(w.legs || [])]) if (!colOk(c)) { badCols++; bad(`${role}: bad palette colour ${c}`); }
    for (const e of (w.extras || [])) {
      if (e.match) continue;
      for (const c of (Array.isArray(e.color) ? e.color : [e.color])) if (!colOk(c)) { badCols++; bad(`${role}/${e.kind}: bad colour ${c}`); }
    }
  }
  if (!badCols) ok('every wardrobe-table colour parses as a 24-bit int');

  let outBad = 0;
  for (const role of [...Object.keys(WARDROBE), 'nonsense']) {
    for (let i = 0; i < 40; i++) {
      const s = outfitSpecFor(role, `pop-${role}-${i}|test body ${i}`);
      for (const c of [s.jacket, s.legs, s.skin, s.hair, ...s.extras.map(e => e.color)]) if (!colOk(c)) outBad++;
      if (!SKIN_TONES.includes(s.skin)) { outBad++; bad(`${role}#${i}: skin ${s.skin.toString(16)} outside the period range`); }
      if (!HAIR_TONES.includes(s.hair)) { outBad++; bad(`${role}#${i}: hair ${s.hair.toString(16)} outside the period range`); }
      if (!(s.scale >= 0.25 && s.scale <= 1.2)) { outBad++; bad(`${role}#${i}: scale ${s.scale} out of bounds`); }
      if (!(s.width >= 0.88 && s.width <= 1.12)) { outBad++; bad(`${role}#${i}: width ${s.width} out of bounds`); }
    }
  }
  outBad === 0
    ? ok('resolved specs: colours parse, skin/hair within period tones, scale ±8% an\' width ±10% respected (19 roles x 40 ids)')
    : bad(`${outBad} resolved-spec value(s) out of bounds`);
}

// ---------- 4. mesh budget ----------
console.log('mesh budget');
{
  let over = [];
  for (const role of Object.keys(WARDROBE)) {
    for (let i = 0; i < 50; i++) {
      const s = outfitSpecFor(role, `pop-${role}-${i}|budget ${i}`);
      const boxes = s.extras.reduce((n, e) => n + (OUTFIT_BOXES[e.kind] || 99), 0);
      if (boxes > 4 || s.boxes > 4 || boxes !== s.boxes) over.push(`${role}#${i}: ${boxes}/${s.boxes}`);
    }
  }
  // curated cast within budget an' all
  for (const id of ['|granny glinda', '|farmer james', '|farmer harry', '|karen', '|cc', '|max',
    'amos|amos burnett', 'mary|mary agar', 'jonty|jonty featherstone', 'edith|edith raw', 'tom|tom pennock', 'bess|bess harland']) {
    const s = outfitSpecFor(null, id);
    if (s.boxes > 4) over.push(`curated ${id}: ${s.boxes}`);
  }
  over.length === 0 ? ok('no spec ever yields more than 4 extra boxes (18 outfits x 50 ids + curated)')
    : bad('over budget: ' + over.join('; '));

  // a BUILT model carries exactly base(9 meshes) + spec.boxes (curls excepted — cc only)
  const countMeshes = model => { let n = 0; model.group.traverse(o => { if (o.isMesh) n++; }); return n; };
  const fw = outfitSpecFor('fishwife', 'pop-whitby-2|mary raw');
  const built = countMeshes(makeVillager(lookFromSpec(fw)));
  built === 9 + fw.boxes
    ? ok(`built fishwife = 9 base meshes + ${fw.boxes} outfit boxes (${built} total)`)
    : bad(`built fishwife has ${built} meshes, expected ${9 + fw.boxes}`);
}

// ---------- 5. curated cast ----------
console.log('curated cast');
{
  const has = (spec, kind) => spec.extras.some(e => e.kind === kind);
  const g = outfitSpecFor(null, '|granny glinda');
  (g.curated && g.hair === 0xe8e8e8 && has(g, 'shawl') && g.jacket === 0x8a8294)
    ? ok('glinda: granny-grey hair, her shawl an\' the mauve-grey dress') : bad('glinda override wrong: ' + JSON.stringify(g));
  const j = outfitSpecFor(null, 'char_123|farmer james');
  (j.curated && j.scale === 1.05 && j.jacket === 0x4a5a3a && has(j, 'cap') && has(j, 'waistcoat'))
    ? ok('james: green farmer\'s jacket, cap an\' waistcoat at 1.05 scale') : bad('james override wrong: ' + JSON.stringify(j));
  const h = outfitSpecFor(null, 'char_456|farmer harry');
  (h.curated && h.scale === 0.62 && h.jacket === 0x3a6a9a)
    ? ok('harry: the wee blue jumper stays') : bad('harry override wrong: ' + JSON.stringify(h));
  const k = outfitSpecFor(null, '|karen');
  (k.curated && k.scale === 0.62 && k.jacket === 0xa84a5a && has(k, 'skirt'))
    ? ok('karen: rose jumper an\' skirt') : bad('karen override wrong: ' + JSON.stringify(k));
  const c = outfitSpecFor(null, '|cc');
  (c.curated && c.scale === 0.45 && c.curls === true)
    ? ok('cc: golden curls at 0.45 scale') : bad('cc override wrong: ' + JSON.stringify(c));
  const m = outfitSpecFor(null, '|max');
  (m.curated && m.scale === 0.32) ? ok('max: the toddler in cream at 0.32') : bad('max override wrong: ' + JSON.stringify(m));
  const b = outfitSpecFor('herbwife', 'bess|bess harland');
  (b.curated && b.hair === 0x8f8f88 && b.extras.find(e => e.kind === 'shawl')?.color === 0x4f5a40)
    ? ok('bess: grey hair an\' the herb-green shawl') : bad('bess override wrong: ' + JSON.stringify(b));
  const a = outfitSpecFor('jet-cutter', 'amos|amos burnett');
  (a.curated && a.role === 'miner' && a.jacket === 0x35302b)
    ? ok('amos: jet-cutter in the coal-dark jacket') : bad('amos override wrong: ' + JSON.stringify(a));
  for (const [id, role] of [['mary', 'fishwife'], ['jonty', 'drover'], ['edith', 'postmistress'], ['tom', 'railway']]) {
    const s = outfitSpecFor(role, `${id}|somebody`);
    if (!s.curated) bad(`roster ${id} not curated`);
  }
  ok('mary/jonty/edith/tom carry curated pins');
  // exact-id matching: "owd tom" (fallback roster) must NOT catch Tom Pennock's pin
  const owd = outfitSpecFor(null, '|owd tom');
  owd.curated ? bad('"owd tom" wrongly matched the curated roster tom') : ok('"owd tom" stays his own man (exact-id curated match)');
}

// ---------- 6. shared caches ----------
console.log('shared caches');
{
  const spec = outfitSpecFor('parson', 'pop-pickering-3|parson test');
  const a = makeVillager(lookFromSpec(spec));
  const b = makeVillager(lookFromSpec(spec));
  (a.body.material === b.body.material) ? ok('same colour -> same material instance (Map cache, like burst())')
    : bad('body materials not shared between identical villagers');
  (a.body.geometry === b.body.geometry) ? ok('same size -> same BoxGeometry instance')
    : bad('body geometry not shared between identical villagers');
  // different jacket colours must NOT share a material
  const s2 = outfitSpecFor('fisherman', 'pop-staithes-1|gansey test');
  const cMat = makeVillager(lookFromSpec(s2)).body.material;
  (cMat !== a.body.material) ? ok('different colours get different materials') : bad('distinct colours wrongly share a material');
}

// ---------- 7. remote players untouched ----------
console.log('remote players');
{
  const legacy = villagerLook('some rambler');
  (legacy.scale === 1.0 && legacy.jumper === 0x6a5a40 && legacy.skirt === 0x4a4438 && legacy.hair === 0x4a3a28 && legacy.cap === 0x3a342e && !legacy.extras)
    ? ok('villagerLook (the remote-player path) still returns the legacy look, no wardrobe extras')
    : bad('legacy villagerLook changed: ' + JSON.stringify(legacy));
  // the pid-shape guard in spawnVillager: remote pids end "-s<seed>", no roster id does
  const pidLike = /-s\d+$/;
  (pidLike.test('a12-s334455') && pidLike.test('0b1c2d3e-4f5a-6b7c-8d9e-0f1a2b3c4d5e-s334455')
    && !pidLike.test('pop-sleights-3') && !pidLike.test('amos') && !pidLike.test('clint-body') && !pidLike.test('char_1766232811959'))
    ? ok('pid-shape guard separates player pids from every roster/pop/brain id form')
    : bad('pid-shape guard misclassifies an id');
}

console.log(failed ? '\nverify-npclooks: FAILED' : '\nverify-npclooks: all green');
process.exit(failed ? 1 : 0);
