// carolBox.js — the village carol. Real public-domain MIDI arrangements played
// through a sampled church organ (MusyngKite), the combo proved in the carolbox
// prototype. Replaces the old HTML5-Audio Holst loop.
//
// It uses the GAME's AudioContext (passed in), so playback sits behind the same
// user-gesture init as the rest of the audio — browsers block sound before a
// gesture, and the game's AudioEngine.init() already runs on first interaction.
//
// The organ samples (~2.9 MB) load LAZILY the first time the carol is actually
// wanted near a yuletide village — never on boot. They're served LOCALLY from
// public/music/soundfont/church_organ-mp3.js (vendored, no gleitz CDN at runtime),
// and the MIDI from public/music/carols/. soundfont-player's `nameToUrl` option
// is what points it at the vendored file (see ensureInstrument below).
//
// Signal bus, as in the prototype: organ -> low-pass (soften the top) ->
// [dry + convolution reverb (a synthetic village-air IR)] -> master gain. main.js
// gates the whole thing (yuletide + near a village) and feeds proximity in; this
// only plays / stops and rides the master gain by distance.

import { Midi } from '@tonejs/midi';
import Soundfont from 'soundfont-player';
import { CAROLS, rotationOrder } from './carols.js';

const CAROL_BASE = '/music/carols/';
const SOUNDFONT_BASE = '/music/soundfont/';
const GAP_SECONDS = 4;            // a breath of quiet between carols
const FADE = 0.18;                // master-gain ramp, seconds — no clicks
const VOL_SCALE = 0.55;           // the carol's headroom (matches the old festVol)

export class CarolBox {
  constructor(audioCtx) {
    this.ctx = audioCtx;
    this.inst = null;             // the loaded organ (cached once loaded)
    this._loading = null;         // in-flight load promise (so we load once)
    this._running = false;        // is a rotation currently scheduled?
    this._order = null;           // the day's carol-id order
    this._seed = null;            // the day-seed that built _order
    this._idx = 0;                // position within the day's order
    this._advanceTimer = null;    // setTimeout handle for the next carol
    this._disposed = false;
    this._buildBus();
  }

  _buildBus() {
    const ac = this.ctx;
    // organ feeds in here; everything downstream is the village-air colour
    this.busIn = ac.createGain();
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 4200;   // take the fizz off the samples
    const conv = ac.createConvolver(); conv.buffer = this._makeIR(2.4, 3);
    const wet = ac.createGain(); wet.gain.value = 0.26;   // a touch of stone-church air
    const dry = ac.createGain(); dry.gain.value = 1;
    // master starts silent — main.js ramps it up by proximity once a carol plays
    this.master = ac.createGain(); this.master.gain.value = 0;
    this.busIn.connect(lp);
    lp.connect(dry).connect(this.master);
    lp.connect(conv).connect(wet).connect(this.master);
    this.master.connect(ac.destination);
  }

  // a synthetic impulse response: white noise on an exponential decay. Cheap,
  // and gives the organ a roomy, churchy tail without shipping an IR file.
  _makeIR(secs, decay) {
    const ac = this.ctx;
    const len = Math.floor(ac.sampleRate * secs);
    const b = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }

  // Load the church organ exactly once. The `nameToUrl` option overrides
  // soundfont-player's default gleitz CDN url and points it at the vendored file:
  // for name 'church_organ' + format 'mp3' this returns
  // '/music/soundfont/church_organ-mp3.js', which vite serves from public/.
  ensureInstrument() {
    if (this.inst) return Promise.resolve(this.inst);
    if (this._loading) return this._loading;
    this._loading = Soundfont.instrument(this.ctx, 'church_organ', {
      format: 'mp3',
      nameToUrl: (name, _sf, format) => SOUNDFONT_BASE + name + '-' + format + '.js',
      destination: this.busIn,
    }).then(inst => {
      this.inst = inst;
      this._loading = null;
      return inst;
    }).catch(err => {
      this._loading = null;        // let a later frame retry the load
      throw err;
    });
    return this._loading;
  }

  // Drive from main.js once per frame.
  //   audible : boolean — yuletide AND near a village (main.js owns the gate)
  //   dist    : distance in blocks to the nearest village (for the volume fade)
  //   daySeed : a stable per-day integer (e.g. sky.day) so the rotation is shared
  setActive(audible, dist, daySeed) {
    if (this._disposed) return;
    if (!audible) { this.stop(); return; }

    // proximity fade — full near the village, silent past ~60 blocks (as before)
    const vol = Math.max(0, 1 - dist / 60) * VOL_SCALE;
    if (this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(vol, t, FADE);
    }

    // a new day → rebuild the shared order and resume from its head
    const seed = Math.floor(daySeed) | 0;
    if (this._order === null || seed !== this._seed) {
      this._order = rotationOrder(seed);
      this._seed = seed;
      this._idx = 0;
    }

    if (!this._running) {
      this._running = true;
      // kick the organ load + first carol; if the load fails (or no gesture yet),
      // clear _running so a later frame tries again
      this.ensureInstrument()
        .then(() => { if (this._running && !this._disposed) this._playCurrent(); })
        .catch(() => { this._running = false; });
    }
  }

  _carolFor(idx) {
    const id = this._order[idx % this._order.length];
    return CAROLS.find(c => c.id === id);
  }

  // Schedule every non-percussion note of the current carol through the organ,
  // then arm a timer to advance to the next once it finishes (+ a short gap).
  _playCurrent() {
    if (!this._running || this._disposed || !this.inst) return;
    const carol = this._carolFor(this._idx);
    if (!carol) { this._running = false; return; }

    Midi.fromUrl(CAROL_BASE + carol.file).then(midi => {
      if (!this._running || this._disposed || !this.inst) return;
      const t0 = this.ctx.currentTime + 0.3;
      let end = t0;
      for (const track of midi.tracks) {
        if (track.instrument && track.instrument.percussion) continue;
        for (const note of track.notes) {
          const when = t0 + note.time;
          this.inst.play(note.name, when, { duration: note.duration, gain: Math.max(0.2, note.velocity) });
          const done = when + note.duration;
          if (done > end) end = done;
        }
      }
      // advance after the last note rings out, plus a breath of quiet
      const waitMs = Math.max(1, (end - this.ctx.currentTime) + GAP_SECONDS) * 1000;
      this._clearTimer();
      this._advanceTimer = setTimeout(() => {
        this._advanceTimer = null;
        if (!this._running || this._disposed) return;
        this._idx = (this._idx + 1) % this._order.length;
        this._playCurrent();
      }, waitMs);
    }).catch(() => {
      // a MIDI that won't load shouldn't wedge the rotation — skip on after a beat
      this._clearTimer();
      this._advanceTimer = setTimeout(() => {
        this._advanceTimer = null;
        if (!this._running || this._disposed) return;
        this._idx = (this._idx + 1) % this._order.length;
        this._playCurrent();
      }, GAP_SECONDS * 1000);
    });
  }

  _clearTimer() {
    if (this._advanceTimer) { clearTimeout(this._advanceTimer); this._advanceTimer = null; }
  }

  // Hush it: silence any ringing notes, fade the master, and stand the rotation
  // down. The loaded organ stays cached so re-approaching a village is instant.
  stop() {
    this._clearTimer();
    this._running = false;
    if (this.inst) { try { this.inst.stop(); } catch (e) { /* nowt playing */ } }
    if (this.master && this.ctx) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(0, t, FADE);
    }
  }

  dispose() {
    this._disposed = true;
    this.stop();
    if (this.inst) { try { this.inst.stop(); } catch (e) { /* ignore */ } }
    try { if (this.master) this.master.disconnect(); } catch (e) { /* ignore */ }
    try { if (this.busIn) this.busIn.disconnect(); } catch (e) { /* ignore */ }
    this.inst = null;
  }
}
