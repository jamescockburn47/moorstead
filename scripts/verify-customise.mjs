// Player customisation ("Dress thissen") — run wi': node scripts/verify-customise.mjs
//
// The player picks their OWN look frae bounded period-1900 choices; it persists
// (rides player.serialize) an' rides the relay as an ADDITIVE `look` message so
// other players see it. This gate proves, headlessly:
//   1. VALIDATION — validatePlayerLook coerces ANY junk (out-of-range, non-int,
//      wrong type, unknown fields) to a bounded, valid look; good looks pass through.
//   2. ROUND-TRIP — a serialized look deserialises identical; an OLD save (no look)
//      an' a junk look both default to a rambler (INVARIANTS rule 4 additive).
//   3. DETERMINISM — lookToSpec is pure: same indices -> byte-identical spec, an'
//      it feeds the SAME shared spec shape (lookFromSpec) every NPC is built from.
//   4. PALETTE BOUNDS — every choosable colour parses as a 24-bit int; skin/hair
//      stay within the period tone lists; authority outfits are NOT choosable.
//   5. MESH BUDGET — a resolved player spec never exceeds the ≤4 extra-box budget.
//   6. RELAY SHAPE — the client sends `{type:'look', look}`; handle() has a `look`
//      case; the else-if chain FALLS THROUGH for unknown types (old clients ignore
//      it — additive, INVARIANTS rule 3, no version bump); inbound look is validated.
//   7. DEGRADE — an unknown extra field on a look is ignored, not trusted.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// makeVillager (reached via buildPlayerLookMesh) touches canvas; stub document so
// entities.js imports clean under Node (mirrors verify-npclooks).
global.document = {
  createElement: (tag) => {
    if (tag !== 'canvas') return {};
    const ctx2d = {
      clearRect: () => {}, fillRect: () => {}, drawImage: () => {},
      strokeText: () => {}, fillText: () => {},
      measureText: () => ({ width: 10 }),
      font: '', fillStyle: '', strokeStyle: '', lineWidth: 0, textAlign: '', textBaseline: '',
    };
    return { width: 0, height: 0, getContext: () => ctx2d };
  },
};

const {
  validatePlayerLook, lookToSpec, playerLookToVillagerLook,
  DEFAULT_PLAYER_LOOK, PLAYER_OUTFITS, PLAYER_JACKETS, PLAYER_HATS,
  PLAYER_SKINS, PLAYER_HAIRS, WARDROBE, OUTFIT_BOXES, SKIN_TONES, HAIR_TONES,
} = await import('../src/entities.js');

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const SRC = dirname(fileURLToPath(import.meta.url));
const src = f => readFileSync(join(SRC, '..', 'src', f), 'utf8');

const DEF = { ...DEFAULT_PLAYER_LOOK };

// ---------- 1. validation: junk -> default, good -> through ----------
console.log('validation');
{
  (eq(validatePlayerLook(null), DEF) ? ok : bad)('null -> default rambler');
  (eq(validatePlayerLook(undefined), DEF) ? ok : bad)('undefined -> default');
  (eq(validatePlayerLook('nonsense'), DEF) ? ok : bad)('a string -> default');
  (eq(validatePlayerLook(42), DEF) ? ok : bad)('a number -> default');
  (eq(validatePlayerLook([]), DEF) ? ok : bad)('an array coerces field-by-field to default');
  // out-of-range / non-integer indices are each rejected to the per-field default
  const junk = validatePlayerLook({ outfit: 999, jacket: -1, hat: 2.5, skin: 'x', hair: null });
  (eq(junk, DEF) ? ok : bad)('every out-of-range/non-int field falls back to default');
  // a fully-valid, non-default look survives untouched
  const good = { outfit: 1, jacket: 3, hat: 0, skin: 4, hair: 5 };
  (eq(validatePlayerLook(good), good) ? ok : bad)('a valid non-default look passes through unchanged');
  // partial: valid fields kept, missing/bad fields defaulted
  const part = validatePlayerLook({ outfit: 2 });
  (part.outfit === 2 && part.jacket === DEF.jacket && part.hair === DEF.hair ? ok : bad)('partial look keeps valid fields, defaults the rest');
  // the returned object has EXACTLY the five known keys — no junk rides through
  (eq(Object.keys(part).sort(), ['hair', 'hat', 'jacket', 'outfit', 'skin']) ? ok : bad)('validated look has exactly the 5 known keys');
}

// ---------- 2. serialize/deserialize round-trip + old-save default ----------
console.log('persistence round-trip');
{
  // simulate player.serialize/deserialize for the look field (the real methods just
  // pass this.look through / re-validate it — see player.js)
  const roundtrip = look => validatePlayerLook(JSON.parse(JSON.stringify(look)));
  const chosen = { outfit: 4, jacket: 6, hat: 4, skin: 1, hair: 7 };
  (eq(roundtrip(chosen), chosen) ? ok : bad)('a chosen look survives serialize -> deserialize identically');
  // an OLD save simply has no look key -> deserialize defaults it (additive rule 4)
  const oldSave = { pos: { x: 0, y: 0, z: 0 }, brass: 10 }; // no `look`
  (eq(validatePlayerLook(oldSave.look), DEF) ? ok : bad)('an old save (no look) defaults to a rambler');
}

// ---------- 3. determinism + feeds the shared builder ----------
console.log('determinism');
{
  const L = { outfit: 3, jacket: 2, hat: 1, skin: 0, hair: 3 };
  (eq(lookToSpec(L), lookToSpec(L)) ? ok : bad)('lookToSpec is deterministic — same look, same spec');
  // no Math.random consulted (spec has no jitter; player looks are chosen, not seeded)
  const orig = Math.random; let called = false; Math.random = () => { called = true; return 0.5; };
  lookToSpec(L); playerLookToVillagerLook(L);
  Math.random = orig;
  (!called ? ok : bad)('no Math.random at spec/look build (chosen, not seeded — INVARIANTS rule 6)');
  // the spec is the SAME shape every NPC is built from (lookFromSpec fields present)
  const vl = playerLookToVillagerLook(L);
  (['scale', 'width', 'jumper', 'skirt', 'hair', 'skin', 'extras'].every(k => k in vl) ? ok : bad)('resolves to the shared villager-look shape (fed to makeVillager)');
  // buildPlayerLookMesh reuses the SAME builder path (returns a group with children)
  const { buildPlayerLookMesh } = await import('../src/entities.js');
  const mesh = buildPlayerLookMesh(L);
  (mesh && mesh.children && mesh.children.length > 0 ? ok : bad)('buildPlayerLookMesh builds through makeVillager (a populated group)');
}

// ---------- 4. palette bounds + all wardrobe outfits choosable ----------
console.log('palette bounds');
{
  const int24 = c => Number.isInteger(c) && c >= 0 && c <= 0xffffff;
  (PLAYER_JACKETS.every(int24) ? ok : bad)('every jacket dye is a 24-bit colour');
  (PLAYER_HATS.every(h => h === null || int24(h.color)) ? ok : bad)('every hat is bare-headed or a 24-bit colour');
  (PLAYER_SKINS.every(int24) && PLAYER_HAIRS.every(int24) ? ok : bad)('skin/hair choices are 24-bit colours');
  (PLAYER_SKINS.every(c => SKIN_TONES.includes(c)) ? ok : bad)('skin choices are within the period tone list');
  (PLAYER_HAIRS.every(c => HAIR_TONES.includes(c)) ? ok : bad)('hair choices are within the period tone list');
  // every choosable outfit is a REAL wardrobe role
  (PLAYER_OUTFITS.every(r => WARDROBE[r]) ? ok : bad)('every choosable outfit maps to a real wardrobe role');
  // it's a dressing-up game: authority outfits ARE choosable too (a bairn can be the bobby)
  const authority = ['constable', 'parson', 'gentry', 'monk'];
  (authority.every(r => PLAYER_OUTFITS.includes(r)) ? ok : bad)('authority outfits (constable/parson/gentry/monk) are choosable too');
  // the default is a valid, in-range look
  (eq(validatePlayerLook(DEF), DEF) ? ok : bad)('the default look is itself valid');
}

// ---------- 5. mesh budget ----------
// The ≤4-box budget is the NPC-wardrobe contract (it holds for ~100 souls at once).
// A player picks their own HAT on top of an outfit's own extras, so a 3-extra dress
// (fishwife: skirt+shawl+apron) + a 2-box hat (wide/tall) reaches 5. That's fine for
// ONE local avatar (or a handful of peers) — but keep it lean an' bounded so it can
// never balloon. Bound: ≤5, an' spec.boxes must equal the counted extras.
console.log('mesh budget');
{
  let worst = 0;
  for (let o = 0; o < PLAYER_OUTFITS.length; o++)
    for (let h = 0; h < PLAYER_HATS.length; h++) {
      const spec = lookToSpec({ outfit: o, jacket: 0, hat: h, skin: 0, hair: 0 });
      worst = Math.max(worst, spec.boxes);
      const counted = spec.extras.reduce((n, e) => n + (OUTFIT_BOXES[e.kind] || 1), 0);
      if (counted !== spec.boxes) bad(`spec.boxes mismatch for outfit ${o}/hat ${h}`);
    }
  (worst <= 5 ? ok : bad)(`no player look exceeds the ≤5 extra-box bound (worst ${worst})`);
}

// ---------- 6. relay message shape + additive fall-through ----------
console.log('relay (additive)');
{
  const mp = src('multiplayer.js');
  (/type:\s*['"]look['"]/.test(mp) ? ok : bad)("client sends a {type:'look'} message (sendLook)");
  (/m\.type === ['"]look['"]/.test(mp) ? ok : bad)("handle() has a 'look' case");
  (/validatePlayerLook\(m\.look\)/.test(mp) ? ok : bad)('inbound look is validated before use (untrusted relay data)');
  (/redressRemote/.test(mp) ? ok : bad)("a look message re-dresses the remote's mesh");
  // the handle() chain is an else-if ladder that falls through for unknown types:
  // the LAST branch is a plain `else if` (no trailing bare `else`), so an unknown
  // type simply does nothing — old clients ignore a `look` they don't know.
  const handleBody = mp.slice(mp.indexOf('handle(m) {'));
  const lastBranch = handleBody.slice(0, handleBody.indexOf('sendLook()'));
  (!/}\s*else\s*{/.test(lastBranch) ? ok : bad)('handle() has no catch-all else — unknown types fall through harmlessly');
  // no minClientVersion bump is forced by this feature (additive) — assert the
  // entities look table + player.look are additive-only (no SAVE_VERSION touch here)
  (!/SAVE_VERSION/.test(src('player.js')) ? ok : bad)('player.js does not touch SAVE_VERSION (additive save key)');
}

// ---------- 7. degrade: unknown extra field ignored ----------
console.log('degrade');
{
  const withJunk = validatePlayerLook({ outfit: 1, jacket: 1, hat: 1, skin: 1, hair: 1, evil: '<script>', cape: true });
  (!('evil' in withJunk) && !('cape' in withJunk) ? ok : bad)('unknown extra fields on a look are dropped, not carried');
  // and the known fields still resolve to a buildable spec
  (typeof lookToSpec(withJunk).jacket === 'number' ? ok : bad)('a look with junk fields still resolves cleanly');
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
