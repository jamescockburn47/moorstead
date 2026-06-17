// pets.js — pure taming/companion logic. No THREE, no DOM, so it can be unit-tested
// headless (see scripts/verify-pets.mjs). The models, mob AI and item ids live in
// entities.js/main.js; this is just the rules a kept beast plays by.

// Trust a beast must reach, fed its favourite scran, before it throws its lot in with thee.
export const TAME_GOAL = 5;

// How close a companion keeps before it trots to catch up.
export const FOLLOW_RANGE = 30;

// The four beasts a body can take on as a proper companion (others can be tamed to
// follow, but these have a job of work to do — see PET_BENEFIT).
export const PET_KINDS = ['dog', 'cat', 'pig', 'rat'];

// Each mouthful of the right food wins a bit of trust — randomised, so it takes a
// few goes (and a touch of luck). Goal 5 ÷ ~1.05 average ≈ 4–7 feeds.
export function tameGain(rng) {
  return 0.7 + rng() * 0.7; // 0.7 .. 1.4
}

// Will this beast take to a body at all?
export function isTameableType(t) {
  return !!(t && t.tameable);
}

// Apply one feed. Returns the new trust total and whether that's tipped it over.
export function feedTrust(prev, rng) {
  const next = (prev || 0) + tameGain(rng);
  return { trust: next, tamed: next >= TAME_GOAL };
}

// What good a kept beast does thee — plain words, for toasts and the handbook.
export const PET_BENEFIT = {
  dog: 'keeps neet-things off thee — nowt dark will close on thee while she’s at heel',
  cat: 'can be sent off to scout t’ ground, an’ slinks back wi’ summat in her teeth',
  pig: 'snuffles up buried finds — jet, owd bones, truffles — when tha asks her',
  rat: 'forages i’ t’ dark, turning up odd bits as tha mines',
};

const NAMES = [
  'Gyp', 'Bess', 'Floss', 'Moss', 'Tess', 'Nell', 'Pip', 'Skip', 'Jess', 'Tup',
  'Bracken', 'Soot', 'Pickle', 'Biscuit', 'Smut', 'Tatie', 'Mardy', 'Cinder',
  'Bramble', 'Maggie', 'Rook', 'Whisper', 'Clout', 'Nip',
];

// Pick a name not already on one of thi beasts. Deterministic given the rng.
export function chooseName(rng, taken) {
  const used = taken || [];
  const free = NAMES.filter(n => !used.includes(n));
  const pool = free.length ? free : NAMES;
  return pool[Math.min(pool.length - 1, (rng() * pool.length) | 0)];
}
