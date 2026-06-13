// Procedural WebAudio: moorland ambience and gameplay SFX. No audio files.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.ambientTimer = 4;
    this.dread = 0;
    this.heartTimer = 0;
  }

  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);

    // looping noise buffer for wind and rain
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // ---- wind: noise -> lowpass, slow gust LFO ----
    this.windSrc = this.ctx.createBufferSource();
    this.windSrc.buffer = this.noiseBuf; this.windSrc.loop = true;
    const windFilter = this.ctx.createBiquadFilter();
    windFilter.type = 'bandpass'; windFilter.frequency.value = 320; windFilter.Q.value = 0.6;
    this.windGain = this.ctx.createGain(); this.windGain.gain.value = 0.06;
    this.windSrc.connect(windFilter).connect(this.windGain).connect(this.master);
    this.windSrc.start();
    this.windFilter = windFilter;

    // ---- rain: noise -> highpass ----
    this.rainSrc = this.ctx.createBufferSource();
    this.rainSrc.buffer = this.noiseBuf; this.rainSrc.loop = true;
    const rainFilter = this.ctx.createBiquadFilter();
    rainFilter.type = 'highpass'; rainFilter.frequency.value = 2600;
    this.rainGain = this.ctx.createGain(); this.rainGain.gain.value = 0;
    this.rainSrc.connect(rainFilter).connect(this.rainGain).connect(this.master);
    this.rainSrc.start();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  // call each frame
  update(dt, { rain = 0, windiness = 0.5, isNight = false, nearSheep = false, dread = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.dread = dread;
    // gusts — dread stills t' wind a touch
    const gust = (0.045 + windiness * 0.06 + Math.sin(t * 0.37) * 0.02 + Math.sin(t * 0.13 + 2) * 0.018) * (1 - dread * 0.35);
    this.windGain.gain.setTargetAtTime(Math.max(0.02, gust), t, 0.5);
    this.windFilter.frequency.setTargetAtTime(280 + Math.sin(t * 0.21) * 120, t, 0.8);
    this.rainGain.gain.setTargetAtTime(rain * 0.10, t, 1.0);

    // occasional ambient calls
    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0) {
      this.ambientTimer = 9 + Math.random() * 16;
      const r = Math.random();
      if (!isNight) {
        if (r < 0.45) this.curlew();
        else if (r < 0.6 && nearSheep) this.baa(0.25);
        else if (r < 0.75) this.grouseCall(0.18);
      } else {
        if (r < 0.3) this.owl();
      }
    }
    // low dread heartbeat — felt afore tha sees him
    if (dread > 0.12) {
      this.heartTimer -= dt;
      const interval = 1.1 - dread * 0.55;
      if (this.heartTimer <= 0) {
        this.heartTimer = interval;
        this.heartbeat(0.04 + dread * 0.1);
      }
    } else {
      this.heartTimer = 0;
    }
  }

  heartbeat(vol = 0.08) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    for (const [f, delay] of [[58, 0], [48, 0.14]]) {
      const o = this.ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t0 + delay);
      g.gain.linearRampToValueAtTime(vol, t0 + delay + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + 0.22);
      o.connect(g).connect(this.master);
      o.start(t0 + delay); o.stop(t0 + delay + 0.3);
    }
  }

  // ---------- helpers ----------
  env(gain, t0, a, peak, dec) {
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + a);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + a + dec);
  }

  osc(type, freq, t0, dur, peak = 0.2, dest = null) {
    if (!this.ctx) return null;
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    const g = this.ctx.createGain();
    this.env(g, t0, 0.01, peak, dur);
    o.connect(g).connect(dest || this.master);
    o.start(t0); o.stop(t0 + dur + 0.1);
    return o;
  }

  noiseBurst(t0, dur, peak, filterFreq = 800, type = 'lowpass') {
    if (!this.ctx) return;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    this.env(g, t0, 0.005, peak, dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t0); s.stop(t0 + dur + 0.1);
  }

  // ---------- ambience ----------
  // curlew: rising two-note bubbling whistle
  curlew(vol = 0.12) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + Math.random() * 0.3;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    const g = this.ctx.createGain();
    o.connect(g).connect(this.master);
    o.frequency.setValueAtTime(1100, t0);
    o.frequency.exponentialRampToValueAtTime(1900, t0 + 0.35);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.08);
    g.gain.linearRampToValueAtTime(vol * 0.4, t0 + 0.35);
    // bubbling trill
    let tt = t0 + 0.4;
    for (let i = 0; i < 6; i++) {
      o.frequency.setValueAtTime(1500, tt);
      o.frequency.exponentialRampToValueAtTime(1950, tt + 0.07);
      tt += 0.09;
    }
    g.gain.linearRampToValueAtTime(vol, t0 + 0.55);
    g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.2);
    o.start(t0); o.stop(tt + 0.3);
  }

  baa(vol = 0.3) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    const base = 180 + Math.random() * 90;
    o.frequency.setValueAtTime(base, t0);
    // vibrato = t' bleat
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 9;
    const lfoG = this.ctx.createGain(); lfoG.gain.value = base * 0.12;
    lfo.connect(lfoG).connect(o.frequency);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1200;
    const g = this.ctx.createGain();
    this.env(g, t0, 0.05, vol, 0.55);
    o.connect(f).connect(g).connect(this.master);
    o.start(t0); o.stop(t0 + 0.8); lfo.start(t0); lfo.stop(t0 + 0.8);
  }

  // red grouse: "go-back go-back go-back"
  grouseCall(vol = 0.18) {
    if (!this.ctx) return;
    let t0 = this.ctx.currentTime;
    for (let i = 0; i < 5; i++) {
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(520 - i * 30, t0);
      o.frequency.exponentialRampToValueAtTime(330, t0 + 0.05);
      const g = this.ctx.createGain();
      this.env(g, t0, 0.005, vol * 0.5, 0.06);
      const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700;
      o.connect(f).connect(g).connect(this.master);
      o.start(t0); o.stop(t0 + 0.12);
      t0 += 0.11 + i * 0.012;
    }
  }

  owl(vol = 0.1) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    for (const [dt, dur] of [[0, 0.25], [0.5, 0.5]]) {
      const o = this.ctx.createOscillator();
      o.type = 'sine'; o.frequency.setValueAtTime(420, t0 + dt);
      o.frequency.linearRampToValueAtTime(370, t0 + dt + dur);
      const g = this.ctx.createGain();
      this.env(g, t0 + dt, 0.06, vol, dur);
      o.connect(g).connect(this.master);
      o.start(t0 + dt); o.stop(t0 + dt + dur + 0.1);
    }
  }

  moo(vol = 0.3) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    const base = 150 + Math.random() * 40;
    o.frequency.setValueAtTime(base * 1.2, t0);
    o.frequency.linearRampToValueAtTime(base, t0 + 0.3);
    o.frequency.linearRampToValueAtTime(base * 0.85, t0 + 1.0);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
    const g = this.ctx.createGain();
    this.env(g, t0, 0.12, vol, 0.9);
    o.connect(f).connect(g).connect(this.master);
    o.start(t0); o.stop(t0 + 1.2);
  }

  bullSnort(vol = 0.32) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    this.noiseBurst(t0, 0.18, vol, 500, 'lowpass');
    this.noiseBurst(t0 + 0.16, 0.14, vol * 0.8, 400, 'lowpass');
    const o = this.osc('sawtooth', 90, t0, 0.3, vol * 0.5);
    if (o) o.frequency.exponentialRampToValueAtTime(60, t0 + 0.3);
  }

  crow(vol = 0.2) {
    if (!this.ctx) return;
    let t0 = this.ctx.currentTime;
    const n = 2 + ((Math.random() * 2) | 0);
    for (let i = 0; i < n; i++) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(420, t0);
      o.frequency.exponentialRampToValueAtTime(250, t0 + 0.14);
      const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 3;
      const g = this.ctx.createGain();
      this.env(g, t0, 0.01, vol, 0.16);
      o.connect(f).connect(g).connect(this.master);
      o.start(t0); o.stop(t0 + 0.3);
      t0 += 0.22 + Math.random() * 0.1;
    }
  }

  gull(vol = 0.18) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    for (const [dt, hi] of [[0, 1500], [0.34, 1700], [0.62, 1400]]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(900, t0 + dt);
      o.frequency.linearRampToValueAtTime(hi, t0 + dt + 0.1);
      o.frequency.linearRampToValueAtTime(800, t0 + dt + 0.22);
      const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1600; f.Q.value = 4;
      const g = this.ctx.createGain();
      this.env(g, t0 + dt, 0.02, vol, 0.2);
      o.connect(f).connect(g).connect(this.master);
      o.start(t0 + dt); o.stop(t0 + dt + 0.3);
    }
  }

  pheasant(vol = 0.22) {
    if (!this.ctx) return;
    let t0 = this.ctx.currentTime; // a harsh double "kok-kok"
    for (let i = 0; i < 2; i++) {
      const o = this.ctx.createOscillator();
      o.type = 'square'; o.frequency.setValueAtTime(380, t0);
      o.frequency.exponentialRampToValueAtTime(220, t0 + 0.07);
      const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 800;
      const g = this.ctx.createGain();
      this.env(g, t0, 0.005, vol, 0.08);
      o.connect(f).connect(g).connect(this.master);
      o.start(t0); o.stop(t0 + 0.16);
      t0 += 0.16;
    }
  }

  frogCroak(vol = 0.16) {
    if (!this.ctx) return;
    let t0 = this.ctx.currentTime;
    const n = 2 + ((Math.random() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const o = this.ctx.createOscillator();
      o.type = 'square'; o.frequency.setValueAtTime(150 + Math.random() * 30, t0);
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
      const g = this.ctx.createGain();
      this.env(g, t0, 0.01, vol, 0.08);
      o.connect(f).connect(g).connect(this.master);
      o.start(t0); o.stop(t0 + 0.12);
      t0 += 0.1;
    }
  }

  howl(vol = 0.22) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(140, t0);
    o.frequency.linearRampToValueAtTime(260, t0 + 0.8);
    o.frequency.linearRampToValueAtTime(180, t0 + 1.8);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.2);
    o.connect(f).connect(g).connect(this.master);
    o.start(t0); o.stop(t0 + 2.4);
  }

  // a proper two-tone steam whistle
  whistle(vol = 0.5) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    for (const [f, delay, dur] of [[660, 0, 0.5], [550, 0.05, 0.45], [660, 0.7, 0.9], [550, 0.72, 0.85]]) {
      const o = this.ctx.createOscillator();
      o.type = 'triangle'; o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t0 + delay);
      g.gain.linearRampToValueAtTime(vol * 0.22, t0 + delay + 0.06);
      g.gain.setValueAtTime(vol * 0.22, t0 + delay + dur - 0.15);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + dur);
      o.connect(g).connect(this.master);
      o.start(t0 + delay); o.stop(t0 + delay + dur + 0.1);
    }
  }

  // ---------- SFX ----------
  dig(hard = 1) { this.noiseBurst(this.ctx ? this.ctx.currentTime : 0, 0.08, 0.15, 400 + hard * 300); }
  breakBlock() { this.noiseBurst(this.ctx ? this.ctx.currentTime : 0, 0.18, 0.3, 900); }
  place() { this.noiseBurst(this.ctx ? this.ctx.currentTime : 0, 0.1, 0.22, 500); }
  thud() { this.noiseBurst(this.ctx ? this.ctx.currentTime : 0, 0.15, 0.35, 200); }
  jump() { }
  pickup() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    this.osc('sine', 600, t0, 0.08, 0.12);
    this.osc('sine', 900, t0 + 0.06, 0.1, 0.1);
  }
  craft() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    this.noiseBurst(t0, 0.06, 0.15, 1200, 'bandpass');
    this.noiseBurst(t0 + 0.1, 0.08, 0.18, 800, 'bandpass');
  }
  smelt() {
    if (!this.ctx) return;
    this.noiseBurst(this.ctx.currentTime, 0.5, 0.12, 600, 'bandpass');
  }
  eat() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) this.noiseBurst(t0 + i * 0.16, 0.07, 0.16, 1500, 'bandpass');
  }
  hurt() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const o = this.osc('square', 260, t0, 0.18, 0.16);
    if (o) o.frequency.exponentialRampToValueAtTime(120, t0 + 0.18);
  }
  toolSnap() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    this.noiseBurst(t0, 0.1, 0.3, 2200, 'highpass');
    this.osc('square', 180, t0, 0.15, 0.12);
  }
  mobHurt(type) {
    if (type === 'greatbarghest' || type === 'dracula') { this.growl(0.45); return; }
    if (type === 'sheep' || type === 'lamb') this.baa(0.35);
    else if (type === 'grouse') this.grouseCall(0.25);
    else if (type === 'barghest') this.growl(0.3);
    else if (type === 'boggart') this.boggartChitter(0.25);
    else if (type === 'cow' || type === 'bull') this.moo(0.32);
    else if (type === 'pheasant') this.pheasant(0.28);
    else if (type === 'curlew') this.curlew(0.2);
    else this.thud();
  }
  mobAttack(type) { if (type === 'barghest') this.growl(0.35); else this.boggartChitter(0.3); }
  mobAmbient(type, dist) {
    const vol = Math.max(0, 1 - dist / 40) * 0.35;
    if (vol <= 0.01) return;
    if (type === 'sheep') this.baa(vol);
    else if (type === 'grouse') this.grouseCall(vol * 0.7);
    else if (type === 'barghest') this.growl(vol * 0.8);
    else if (type === 'boggart') this.boggartChitter(vol * 0.6);
    else if (type === 'cow') this.moo(vol);
    else if (type === 'bull') this.bullSnort(vol);
    else if (type === 'curlew') this.curlew(vol * 0.7);
    else if (type === 'pheasant') this.pheasant(vol * 0.8);
    else if (type === 'owl') this.owl(vol * 0.9);
    else if (type === 'crow') this.crow(vol * 0.7);
    else if (type === 'seagull') this.gull(vol * 0.8);
    else if (type === 'frog') this.frogCroak(vol * 0.8);
  }
  growl(vol = 0.25) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(65, t0);
    o.frequency.linearRampToValueAtTime(48, t0 + 0.7);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 280;
    const g = this.ctx.createGain();
    this.env(g, t0, 0.08, vol, 0.7);
    o.connect(f).connect(g).connect(this.master);
    o.start(t0); o.stop(t0 + 0.9);
  }
  boggartChitter(vol = 0.2) {
    if (!this.ctx) return;
    let t0 = this.ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      const o = this.osc('square', 700 + Math.random() * 400, t0, 0.05, vol * 0.5);
      t0 += 0.07;
    }
  }
}
