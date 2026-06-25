// Festival audio: church-bell peals + fire-crackle bed — run wi':
//   node scripts/verify-festival-audio.mjs
//
// A real AudioContext needs a browser, so this is a STRUCTURAL check only: we stub
// a minimal WebAudio API (just enough nodes for AudioEngine.init + the festival
// methods to run), then confirm the engine exposes setCrackle/bells, wires the
// crackle bed in init, schedules grains only while audible, and that one bells()
// call schedules a peal of struck tones. The actual *sound* is verified live by ear
// (like the carol) — synthesis here is principled-by-construction, not auditioned.
import { AudioEngine } from '../src/audio.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// ---- a tiny WebAudio stub: counts the nodes created so we can assert on them ----
let osc = 0, bufSrc = 0;
const param = () => ({
  value: 0,
  setValueAtTime() { return this; },
  linearRampToValueAtTime() { return this; },
  exponentialRampToValueAtTime() { return this; },
  setTargetAtTime() { return this; },
});
function gainNode() { return { gain: param(), connect: () => dest }; }
const dest = { connect: () => dest };
function ctxStub() {
  return {
    currentTime: 0,
    sampleRate: 44100,
    destination: dest,
    createGain: () => gainNode(),
    createBiquadFilter: () => ({ type: '', frequency: param(), Q: param(), connect: () => dest }),
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
    createBufferSource: () => { bufSrc++; return { buffer: null, loop: false, playbackRate: param(), connect: () => dest, start() {}, stop() {} }; },
    createOscillator: () => { osc++; return { type: '', frequency: param(), connect: () => dest, start() {}, stop() {} }; },
  };
}
globalThis.window = { AudioContext: ctxStub, webkitAudioContext: ctxStub };

// ---- the engine exposes the festival API ----
const eng = new AudioEngine();
(typeof eng.bells === 'function' ? ok : bad)('AudioEngine exposes bells()');
(typeof eng.setCrackle === 'function' ? ok : bad)('AudioEngine exposes setCrackle()');
(typeof eng._bellStrike === 'function' ? ok : bad)('AudioEngine exposes _bellStrike()');
(typeof eng._crackleGrain === 'function' ? ok : bad)('AudioEngine exposes _crackleGrain()');

// ---- init wires the crackle bed (gain on the chain, starting silent) ----
eng.init();
(eng.crackleGain && typeof eng.crackleGain.gain === 'object' ? ok : bad)('init() builds this.crackleGain (a bed gain)');
(eng.crackleFilter && eng.crackleFilter.type === 'lowpass' ? ok : bad)('the crackle bed is low-passed (warm/low, not a hiss)');

// ---- setCrackle: silent => no grains; audible => schedules grain bursts ----
{
  const before = bufSrc;
  eng.setCrackle(0, 0.016);             // hushed
  (bufSrc === before ? ok : bad)('setCrackle(0) schedules no grains (gated off near silence)');
  eng._crackleTimer = 0;                 // force a due burst
  eng.setCrackle(0.5, 0.016);            // audible, timer due
  (bufSrc > before ? ok : bad)('setCrackle(level>0) with a due timer schedules >=1 crackle grain');
}

// ---- bells(): one call schedules a peal of struck tones (many oscillators) ----
{
  const before = osc;
  eng.bells({ gain: 0.18 });
  // 8 strikes x 7 partials = 56 sine oscillators for a full peal
  (osc - before >= 40 ? ok : bad)('bells() schedules a multi-strike peal of additive partials (' + (osc - before) + ' oscillators)');
}

// ---- a single strike is additive (several partials, incl. the tierce) ----
{
  const before = osc;
  eng._bellStrike(220, 0, dest);
  (osc - before >= 5 ? ok : bad)('_bellStrike() sums several partials (' + (osc - before) + ' >= 5, hum/prime/tierce/quint/nominal+)');
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
