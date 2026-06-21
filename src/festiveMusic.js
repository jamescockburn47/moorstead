// festiveMusic.js — Yorkshire brass-band rendition of "In the Bleak Midwinter"
// (Holst's "Cranham" melody, 1906, public domain).
// Shares the game's existing AudioContext (pass this.audio.ctx from AudioEngine).
// Master gain maxes at ~0.12 so it sits under t' ambient bed without swamping it.

// Cranham melody, verse 1 (transposed to C major; midi 60 = C4).
// Each entry: [midiNote | null, durationInBeats].  null = rest.
export const CRANHAM = [
  [67,1],[67,1],[69,1],[67,1], [72,2],[71,2],
  [67,1],[67,1],[69,1],[67,1], [74,2],[72,2],
  [67,1],[67,1],[76,1],[74,1], [72,2],[71,2],
  [69,1],[69,1],[71,1],[69,1], [67,3],[null,1],
];

const BPM       = 66;
const BEAT_SEC  = 60 / BPM;
const LOOKAHEAD = 0.3;   // seconds ahead to schedule notes
const POLL_MS   = 100;   // scheduler interval

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export class FestiveMusic {
  constructor(ctx) {
    this.ctx    = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    this._running      = false;
    this._cursor       = 0;          // index into CRANHAM
    this._nextNoteTime = 0;          // audio-clock time for the next note
    this._intervalId   = null;
  }

  // Schedule a single brass note: two oscillators (sawtooth + detuned square)
  // through a lowpass filter and a per-note gain with soft ADSR.
  _playNote(freq, startTime, durBeats) {
    const ctx  = this.ctx;
    const dur  = durBeats * BEAT_SEC;
    const atk  = 0.04;
    const rel  = 0.15;
    const sus  = 0.50;     // sustain level relative to peak

    // per-note gain (ADSR envelope)
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, startTime);
    env.gain.linearRampToValueAtTime(1.0, startTime + atk);
    env.gain.linearRampToValueAtTime(sus, startTime + atk + 0.05);
    env.gain.setValueAtTime(sus, startTime + dur - rel);
    env.gain.linearRampToValueAtTime(0, startTime + dur);

    // lowpass: brass warmth, kill harsh aliases
    const lp = ctx.createBiquadFilter();
    lp.type            = 'lowpass';
    lp.frequency.value = 1600;
    lp.Q.value         = 0.7;

    env.connect(lp).connect(this.master);

    // primary oscillator: sawtooth (rich harmonics)
    const osc1 = ctx.createOscillator();
    osc1.type          = 'sawtooth';
    osc1.frequency.value = freq;
    osc1.connect(env);
    osc1.start(startTime);
    osc1.stop(startTime + dur + 0.05);

    // second oscillator: detuned square for body, slightly brighter
    const osc2 = ctx.createOscillator();
    osc2.type          = 'square';
    osc2.frequency.value = freq * 1.003;   // ~5 cents sharp — band-in-unison wobble
    osc2.connect(env);
    osc2.start(startTime);
    osc2.stop(startTime + dur + 0.05);
  }

  _tick() {
    if (!this._running) return;
    const now = this.ctx.currentTime;
    const horizon = now + LOOKAHEAD;

    while (this._nextNoteTime < horizon) {
      const entry = CRANHAM[this._cursor];
      const [midi, beats] = entry;

      if (midi !== null) {
        this._playNote(midiToFreq(midi), this._nextNoteTime, beats);
      }
      this._nextNoteTime += beats * BEAT_SEC;

      this._cursor++;
      if (this._cursor >= CRANHAM.length) {
        this._cursor = 0;
        // 2-beat rest between repeats
        this._nextNoteTime += 2 * BEAT_SEC;
      }
    }
  }

  // Idempotent: safe to call every frame when vol > 0.
  start() {
    if (this._running) return;
    this._running      = true;
    this._nextNoteTime = Math.max(this.ctx.currentTime, this._nextNoteTime);
    // Resume if browser suspended the context (belt-and-braces — gesture has
    // already been handled by AudioEngine.init(), but belts don't hurt).
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this._intervalId = setInterval(() => this._tick(), POLL_MS);
    // Fire once immediately so notes start without a POLL_MS delay.
    this._tick();
  }

  stop() {
    if (!this._running) return;
    this._running = false;
    clearInterval(this._intervalId);
    this._intervalId = null;
    // Silence the master gain quickly.
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(0, t, 0.05);
  }

  // Smooth volume ramp — call every frame with the computed distance-based vol.
  setVolume(v) {
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(v, t, 0.4);
  }
}
