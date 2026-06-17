// Pet taming logic check — run wi': node scripts/verify-pets.mjs
// The taming maths live in a pure module so they can be checked headless, the same
// road as the season an' weather clocks.
import {
  TAME_GOAL, FOLLOW_RANGE, tameGain, feedTrust, chooseName, PET_BENEFIT, PET_KINDS, isTameableType,
} from '../src/pets.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// a seeded rng so the test is deterministic
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// tameGain stays in band
{
  const r = rng(1); let lo = 9, hi = -9;
  for (let i = 0; i < 5000; i++) { const g = tameGain(r); lo = Math.min(lo, g); hi = Math.max(hi, g); }
  (lo >= 0.7 - 1e-9 && hi <= 1.4 + 1e-9 ? ok : bad)(`tameGain stays in 0.7..1.4 (got ${lo.toFixed(3)}..${hi.toFixed(3)})`);
}

// taming takes "some effort": between 4 and 8 feeds across many seeds
{
  let lo = 99, hi = 0;
  for (let s = 1; s <= 400; s++) {
    const r = rng(s * 97 + 3); let trust = 0, feeds = 0;
    while (trust < TAME_GOAL) { trust = feedTrust(trust, r).trust; feeds++; if (feeds > 50) break; }
    lo = Math.min(lo, feeds); hi = Math.max(hi, feeds);
  }
  (lo >= 4 && hi <= 8 ? ok : bad)(`taming takes 4..8 feeds of the right food (got ${lo}..${hi})`);
}

// feedTrust flips tamed exactly at the goal, not before
{
  (feedTrust(TAME_GOAL - 0.01, () => 0.02).tamed === true ? ok : bad)('feedTrust tips to tamed once trust reaches the goal');
  (feedTrust(0, () => 0.5).tamed === false ? ok : bad)('feedTrust is not tamed early');
}

// chooseName avoids names already taken, and is deterministic for a fixed rng
{
  const taken = ['Gyp', 'Bess'];
  const n1 = chooseName(rng(5), taken), n2 = chooseName(rng(5), taken);
  (n1 === n2 ? ok : bad)('chooseName is deterministic for a fixed rng');
  (!taken.includes(n1) ? ok : bad)('chooseName avoids names already on thi beasts (got ' + n1 + ')');
}

// every companion kind has a stated benefit, and FOLLOW_RANGE is sane
{
  (PET_KINDS.every(k => typeof PET_BENEFIT[k] === 'string' && PET_BENEFIT[k].length > 0) ? ok : bad)('every companion kind has a benefit blurb');
  (FOLLOW_RANGE > 6 && FOLLOW_RANGE < 80 ? ok : bad)('FOLLOW_RANGE is a sensible distance');
  (isTameableType({ tameable: true }) && !isTameableType({}) ? ok : bad)('isTameableType reads the tameable flag');
}

console.log('RESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
