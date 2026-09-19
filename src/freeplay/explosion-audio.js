// Synthesised pressure crack, descending bass and filtered rumble. No audio assets.
import { mulberry32 } from '../noise.js';

const SOUNDS = Object.freeze({
  grenade: { duration:.45, crack:4000, tail:600, bass:135, bottom:70, attack:.005, weight:.22, volume:.14, wave:'triangle' },
  dynamite: { duration:1, crack:3000, tail:220, bass:115, bottom:45, attack:.012, weight:.4, volume:.16, wave:'triangle' },
  demolition: { duration:2.1, crack:2100, tail:110, bass:95, bottom:32, attack:.018, weight:.6, volume:.18, wave:'sine' },
  mega: { duration:3.9, crack:1500, tail:75, bass:82, bottom:27, attack:.022, weight:.7, volume:.2, wave:'sine' },
  atom: { duration:6.1, crack:1800, tail:70, bass:73, bottom:26, attack:.025, weight:.75, volume:.2, wave:'sine' },
});

export class ExplosionAudio {
  constructor(audio = null) {
    this.audio = audio;
    this.ctx = null;
    this.ownsContext = false;
    this.voices = [];
    this.noise = null;
    this.muted = false;
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.muted) for (const voice of [...this.voices]) this.release(voice);
  }

  async unlock() {
    if (this.audio) {
      this.audio.init();
      this.ctx = this.audio.ctx;
    } else if (!this.ctx && typeof window !== 'undefined') {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return false;
      this.ctx = new Context();
      this.ownsContext = true;
    }
    if (!this.ctx) return false;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return this.ctx.state === 'running';
  }

  play({ kind='atom', radius = 40 }, distance = 0) {
    const ctx = this.audio?.ctx || this.ctx;
    const sound=SOUNDS[kind];
    if (!sound || !Number.isFinite(radius) || radius<=0 || radius>64 || !Number.isFinite(distance)
      || !ctx || ctx.state !== 'running' || this.muted || this.audio?.muted) return false;
    while (this.voices.length >= 3) this.release(this.voices[0]);
    if (!this.noise || this.noise.sampleRate !== ctx.sampleRate) {
      this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = this.noise.getChannelData(0), random = mulberry32(918273);
      for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1;
    }
    const now = ctx.currentTime, duration=sound.duration;
    const volume = sound.volume / (1 + Math.max(0, distance) / Math.max(12, radius * 3));
    const bus = ctx.createGain(), filter = ctx.createBiquadFilter();
    bus.gain.setValueAtTime(volume, now);
    bus.connect(this.audio?.master || ctx.destination);
    filter.type = 'lowpass'; filter.Q.value = .7;
    filter.frequency.setValueAtTime(sound.crack, now);
    filter.frequency.exponentialRampToValueAtTime(sound.tail, now + duration);
    const noise = ctx.createBufferSource(), rumble = ctx.createGain();
    noise.buffer = this.noise; noise.loop = true;
    rumble.gain.setValueAtTime(.001, now);
    rumble.gain.exponentialRampToValueAtTime(.9, now + sound.attack);
    rumble.gain.exponentialRampToValueAtTime(.001, now + duration);
    noise.connect(filter).connect(rumble).connect(bus);
    const bass = ctx.createOscillator(), bassGain = ctx.createGain();
    bass.type = sound.wave;
    bass.frequency.setValueAtTime(sound.bass, now);
    bass.frequency.exponentialRampToValueAtTime(sound.bottom, now + duration * .65);
    bassGain.gain.setValueAtTime(.001, now);
    bassGain.gain.exponentialRampToValueAtTime(sound.weight, now + Math.max(.01,sound.attack*1.6));
    bassGain.gain.exponentialRampToValueAtTime(.001, now + duration * .8);
    bass.connect(bassGain).connect(bus);
    const voice = { sources: [noise, bass], nodes: [bus, filter, rumble, bassGain], stopped: false };
    this.voices.push(voice);
    noise.onended = () => this.release(voice);
    noise.start(now); bass.start(now);
    noise.stop(now + duration); bass.stop(now + duration);
    return true;
  }

  release(voice) {
    if (voice.stopped) return;
    voice.stopped = true;
    for (const source of voice.sources) { source.onended = null; source.stop(); source.disconnect(); }
    for (const node of voice.nodes) node.disconnect();
    this.voices = this.voices.filter(item => item !== voice);
  }

  dispose() {
    for (const voice of [...this.voices]) this.release(voice);
    this.noise = null;
    if (this.ownsContext && this.ctx?.state !== 'closed') {
      this.ctx.close().catch(error => console.warn('Free play audio shutdown failed', error.name));
    }
    this.ctx = null;
  }
}
