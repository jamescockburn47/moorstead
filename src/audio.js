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

    // pink noise (Paul Kellet) for the soft ambient beds. White noise is flat —
    // its high-frequency energy reads as a constant static/hiss; pink (-3 dB/oct)
    // gives a natural rush, so the always-on wind no longer hisses under everything.
    this.pinkBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const pd = this.pinkBuf.getChannelData(0);
    let p0 = 0, p1 = 0, p2 = 0, p3 = 0, p4 = 0, p5 = 0, p6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      p0 = 0.99886 * p0 + w * 0.0555179; p1 = 0.99332 * p1 + w * 0.0750759;
      p2 = 0.96900 * p2 + w * 0.1538520; p3 = 0.86650 * p3 + w * 0.3104856;
      p4 = 0.55000 * p4 + w * 0.5329522; p5 = -0.7616 * p5 - w * 0.0168980;
      pd[i] = (p0 + p1 + p2 + p3 + p4 + p5 + p6 + w * 0.5362) * 0.11; p6 = w * 0.115926;
    }

    // ---- wind: noise -> lowpass, slow gust LFO ----
    this.windSrc = this.ctx.createBufferSource();
    this.windSrc.buffer = this.pinkBuf; this.windSrc.loop = true;
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

    // ---- beck: a brighter, babblin' watter ----
    this.beckSrc = this.ctx.createBufferSource();
    this.beckSrc.buffer = this.noiseBuf; this.beckSrc.loop = true;
    const beckFilter = this.ctx.createBiquadFilter();
    beckFilter.type = 'bandpass'; beckFilter.frequency.value = 1100; beckFilter.Q.value = 0.5;
    this.beckGain = this.ctx.createGain(); this.beckGain.gain.value = 0;
    this.beckSrc.connect(beckFilter).connect(this.beckGain).connect(this.master);
    this.beckSrc.start();
    this.beckFilter = beckFilter;

    // ---- sea: a low surf swell ----
    this.surfSrc = this.ctx.createBufferSource();
    this.surfSrc.buffer = this.pinkBuf; this.surfSrc.loop = true;
    const surfFilter = this.ctx.createBiquadFilter();
    surfFilter.type = 'lowpass'; surfFilter.frequency.value = 420;
    this.surfGain = this.ctx.createGain(); this.surfGain.gain.value = 0;
    this.surfSrc.connect(surfFilter).connect(this.surfGain).connect(this.master);
    this.surfSrc.start();

    // ---- tap-room: a low murmur o' talk by t' fire ----
    this.pubSrc = this.ctx.createBufferSource();
    this.pubSrc.buffer = this.pinkBuf; this.pubSrc.loop = true;
    const pubFilter = this.ctx.createBiquadFilter();
    pubFilter.type = 'bandpass'; pubFilter.frequency.value = 480; pubFilter.Q.value = 0.8;
    this.pubGain = this.ctx.createGain(); this.pubGain.gain.value = 0;
    this.pubSrc.connect(pubFilter).connect(this.pubGain).connect(this.master);
    this.pubSrc.start();
    this.pubFilter = pubFilter;

    // ---- festival bonfire: a low filtered-noise roar (the body o' the blaze),
    // wi' enveloped crackle grains scheduled on top (see _scheduleCrackle). Built
    // as a bed like t' others — proximity fades this.crackleGain via setCrackle. ----
    this.crackleSrc = this.ctx.createBufferSource();
    this.crackleSrc.buffer = this.pinkBuf; this.crackleSrc.loop = true;
    const crackleFilter = this.ctx.createBiquadFilter();
    crackleFilter.type = 'lowpass'; crackleFilter.frequency.value = 380; // warm, low — a near fire, not a hiss
    this.crackleGain = this.ctx.createGain(); this.crackleGain.gain.value = 0;
    this.crackleSrc.connect(crackleFilter).connect(this.crackleGain).connect(this.master);
    this.crackleSrc.start();
    this.crackleFilter = crackleFilter;
    this._crackleLevel = 0;   // last level set by setCrackle — gates the grain scheduler
    this._crackleTimer = 0;   // counts down to t' next crackle-grain burst

    this.pubTimer = 0; this.whistleTimer = 0; this.brassTimer = 90;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  // call each frame
  update(dt, { rain = 0, windiness = 0.5, isNight = false, nearSheep = false, dread = 0,
               season = null, nearWater = 0, onCoast = 0, nearInn = 0, trainDist = null,
               fireCrackle = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.dread = dread;
    this._wintry = season ? season.warmth < -0.35 : false; // curlews/lambs/frogs fall silent in deep winter
    // gusts — dread stills t' wind a touch
    const gust = (0.045 + windiness * 0.06 + Math.sin(t * 0.37) * 0.02 + Math.sin(t * 0.13 + 2) * 0.018) * (1 - dread * 0.35);
    this.windGain.gain.setTargetAtTime(Math.max(0.02, gust), t, 0.5);
    this.windFilter.frequency.setTargetAtTime(280 + Math.sin(t * 0.21) * 120, t, 0.8);
    this.rainGain.gain.setTargetAtTime(rain * 0.10, t, 1.0);

    // continuous beds: t' beck, t' sea swell, an' t' tap-room murmur
    this.beckGain.gain.setTargetAtTime(nearWater * 0.075, t, 0.6);
    this.beckFilter.frequency.setTargetAtTime(1000 + Math.sin(t * 0.7) * 260, t, 0.5); // burble
    this.surfGain.gain.setTargetAtTime(onCoast * (0.06 + (Math.sin(t * 0.18) * 0.5 + 0.5) * 0.06), t, 0.8); // swell
    this.pubGain.gain.setTargetAtTime(nearInn * 0.06, t, 0.7);
    this.pubFilter.frequency.setTargetAtTime(440 + Math.sin(t * 1.3) * 80, t, 0.3); // murmur wobble

    // festival fire-crackle bed: roar level set by the caller (proximity), grains
    // scheduled on top only while it's actually audible (no work near silence).
    this.setCrackle(fireCrackle, dt);

    // tap-room one-shots of an evening: pots, a laugh, t' hearth, a dog
    if (nearInn > 0.2) {
      this.pubTimer -= dt;
      if (this.pubTimer <= 0) {
        this.pubTimer = 2 + Math.random() * 4;
        const pr = Math.random();
        if (pr < 0.38) this.potClink(nearInn * 0.5);
        else if (pr < 0.58) this.pubLaugh(nearInn * 0.45);
        else if (pr < 0.74) this.hearthCrackle(nearInn * 0.5);
        else if (pr < 0.84) this.dogWoof(nearInn * 0.4);
      }
      // an' once in a long while, a brass band on t' evening air
      this.brassTimer -= dt;
      if (this.brassTimer <= 0) { this.brassTimer = 150 + Math.random() * 200; this.brassBand(nearInn * 0.06); }
    }

    // a distant steam whistle when t' train's abroad but not close
    if (trainDist != null && trainDist > 35 && trainDist < 200) {
      this.whistleTimer -= dt;
      if (this.whistleTimer <= 0) {
        this.whistleTimer = 18 + Math.random() * 24;
        this.distantWhistle(Math.max(0.05, 0.22 * (1 - trainDist / 200)));
      }
    }

    // ambient wildlife calls — frequent enough that t' moor feels alive; t' mix shifts wi' t' season
    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0) {
      this.ambientTimer = 5 + Math.random() * 8;             // ~3x as often as afore
      const spring = season ? Math.max(0, Math.min(1, season.greenness)) : 0.5;
      const winterHush = season ? (season.warmth < 0 ? -season.warmth : 0) : 0;
      const r = Math.random();
      if (Math.random() < winterHush * 0.3) {
        // deep winter: t' moor's quieter, but for t' wind
      } else if (!isNight) {
        if (nearSheep && r < 0.42 && !this._wintry) this.baa(0.34);  // lambs/flock — hushed in winter
        else if (r < 0.64 && !this._wintry) this.curlew(0.18);       // curlews migrate off for winter
        else if (r < 0.84) this.grouseCall(0.24);                    // red grouse are resident year-round
        else this.crow(0.16);                                        // crows tough out the winter moor
      } else {
        if (r < 0.5) this.owl(0.14);
        else if (r < 0.74) this.crow(0.12);
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

  // ---------- festival: bonfire crackle + church bells ----------
  // Ramp the bonfire-roar bed toward `level` (proximity, 0..~0.5) and, while it's
  // audible, schedule short crackle grains at random-ish gaps. The scheduler is
  // gated on level: near silence we ramp the roar down and do no grain work.
  setCrackle(level, dt) {
    if (!this.ctx || !this.crackleGain) return;
    const t = this.ctx.currentTime;
    this._crackleLevel = level;
    // anti-click: never slam to a hard 0 — a tiny floor, then audibly silent
    this.crackleGain.gain.setTargetAtTime(Math.max(0.0001, level), t, 0.5);
    if (level < 0.02) { this._crackleTimer = 0; return; } // hushed: don't schedule grains
    this._crackleTimer -= dt;
    if (this._crackleTimer <= 0) {
      // a wee cluster o' snaps, then a gap — fires crackle in flurries, not evenly
      const n = 1 + ((Math.random() * 3) | 0);
      for (let i = 0; i < n; i++) this._crackleGrain(t + i * (0.02 + Math.random() * 0.06), level);
      this._crackleTimer = 0.12 + Math.random() * 0.4;
    }
  }

  // one crackle grain: a tiny enveloped band-passed noise pop (a spit o' the fire).
  _crackleGrain(t0, level) {
    if (!this.ctx) return;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.playbackRate.value = 0.8 + Math.random() * 0.9;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 900 + Math.random() * 2200; f.Q.value = 4 + Math.random() * 6;
    const g = this.ctx.createGain();
    const peak = level * (0.18 + Math.random() * 0.5);  // grains scale wi' proximity too
    const dur = 0.02 + Math.random() * 0.05;            // very short — a snap, not a hiss
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t0); s.stop(t0 + dur + 0.02);
  }

  // bells(opts): ONE church-bell PEAL (not a bed). Rings ~8 struck tones in a
  // descending round over a few seconds, at a tenor-bell pitch. Each strike is
  // additive partials at bell ratios through a gentle low-pass; one call schedules
  // the whole peal and returns. `gain` is the peal volume (proximity-set).
  bells({ gain = 0.18 } = {}) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + 0.05;
    // a shared gentle low-pass softens the higher partials so it tolls, not clangs
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 3200; lp.Q.value = 0.4;
    const peal = this.ctx.createGain();
    peal.gain.value = Math.max(0.0001, gain); // anti-click floor; one peal = one fixed level
    lp.connect(peal).connect(this.master);
    // a descending round on a tenor-bell scale around A3 — change-ringing feel
    const base = 220; // A3, a real tenor-bell pitch
    const scale = [1, 0.891, 0.794, 0.749, 0.667, 0.595, 0.561, 0.5]; // ~A G F E D C B A (octave down)
    const gap = 0.34;
    for (let i = 0; i < scale.length; i++) this._bellStrike(base * scale[i], t0 + i * gap, lp);
  }

  // one struck bell = additive partials at bell ratios, each a sine with a near-
  // instant attack and a long exponential decay (higher partials die faster). The
  // tierce (1.2, the minor third) is what makes metal read as a *bell*.
  _bellStrike(f0, t0, dest) {
    if (!this.ctx) return;
    // [ratio, level, decay(s)] — hum, prime, tierce(min-3rd), quint(5th), nominal, + two upper
    const partials = [
      [0.5, 0.55, 3.6],   // hum — the deep undertone, longest ring
      [1.0, 1.00, 3.0],   // prime — the named note
      [1.2, 0.85, 2.4],   // tierce — the minor third, a bell's signature
      [1.5, 0.50, 1.8],   // quint — the fifth
      [2.0, 0.65, 1.6],   // nominal — the strike-note octave
      [2.7, 0.30, 0.9],   // upper partial — adds the metallic 'ting'
      [3.6, 0.18, 0.6],   // higher still — decays fast, just the attack shimmer
    ];
    for (const [ratio, lvl, dec] of partials) {
      const o = this.ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f0 * ratio;
      const g = this.ctx.createGain();
      const peak = 0.16 * lvl;
      g.gain.setValueAtTime(0.0001, t0);                              // from a tiny floor (no click)
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + 0.004); // struck: near-instant attack
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dec);          // long, ringing tail
      o.connect(g).connect(dest);
      o.start(t0); o.stop(t0 + dec + 0.05);
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
    const dur = 0.45 + Math.random() * 0.55;
    const base = 200 + Math.random() * 130;          // ewes an' lambs all sound different
    const o = this.ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(base * 1.06, t0);
    o.frequency.linearRampToValueAtTime(base, t0 + dur * 0.5);
    o.frequency.linearRampToValueAtTime(base * 0.9, t0 + dur);
    // t' bleat: a fast, irregular wobble in pitch
    const lfo = this.ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 11 + Math.random() * 7;
    const lfoG = this.ctx.createGain(); lfoG.gain.value = base * (0.05 + Math.random() * 0.04);
    lfo.connect(lfoG).connect(o.frequency);
    // two nasal formants give it t' sheep timbre, not a buzz
    const f1 = this.ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 780 + Math.random() * 120; f1.Q.value = 4;
    const f2 = this.ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1850; f2.Q.value = 7;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
    const g = this.ctx.createGain();
    // tremolo on t' volume = t' wavering bleat
    const trem = this.ctx.createOscillator(); trem.type = 'sine'; trem.frequency.value = 12 + Math.random() * 7;
    const tremG = this.ctx.createGain(); tremG.gain.value = vol * 0.22;
    trem.connect(tremG).connect(g.gain);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.05);
    g.gain.setValueAtTime(vol, t0 + dur - 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(f1); o.connect(f2); f1.connect(lp); f2.connect(lp); lp.connect(g).connect(this.master);
    this.noiseBurst(t0, 0.05, vol * 0.10, 2400, 'highpass'); // a breath at t' off
    o.start(t0); o.stop(t0 + dur + 0.05);
    lfo.start(t0); lfo.stop(t0 + dur + 0.05);
    trem.start(t0); trem.stop(t0 + dur + 0.05);
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
    const dur = 1.0 + Math.random() * 0.8;
    const base = 125 + Math.random() * 55;
    const o = this.ctx.createOscillator(); o.type = 'sawtooth';
    // a moo swells up then falls away
    o.frequency.setValueAtTime(base * 0.9, t0);
    o.frequency.linearRampToValueAtTime(base * 1.12, t0 + dur * 0.35);
    o.frequency.linearRampToValueAtTime(base * 0.78, t0 + dur);
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 5; // slow vibrato
    const lfoG = this.ctx.createGain(); lfoG.gain.value = base * 0.03; lfo.connect(lfoG).connect(o.frequency);
    // big chesty formants
    const f1 = this.ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 300 + Math.random() * 140; f1.Q.value = 5;
    const f2 = this.ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 680; f2.Q.value = 3;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.2);
    g.gain.setValueAtTime(vol, t0 + dur - 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(f1); o.connect(f2); f1.connect(lp); f2.connect(lp); lp.connect(g).connect(this.master);
    this.noiseBurst(t0 + dur * 0.62, 0.2, vol * 0.10, 480, 'lowpass'); // a breathy snort to finish
    o.start(t0); o.stop(t0 + dur + 0.1); lfo.start(t0); lfo.stop(t0 + dur + 0.1);
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

  // thunder: a low, rolling rumble (filtered noise, long decay) with a sharp
  // crack on top for a near strike (a louder call = closer). Played by the storm
  // controller a beat after each lightning flash.
  thunder(vol = 0.35) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const near = vol > 0.4;
    // the body of the rumble: low-passed noise, swelling then dying away over ~2 s
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf; s.loop = true;
    s.playbackRate.value = 0.5 + Math.random() * 0.25;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = near ? 380 : 220;
    const g = this.ctx.createGain();
    const dur = near ? 1.8 : 2.6;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + (near ? 0.04 : 0.25)); // a near crack hits at once; a far one rolls in
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    // a slow tremor in the filter = the rumble rolling across the moor
    const lfo = this.ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 3 + Math.random() * 2;
    const lfoG = this.ctx.createGain(); lfoG.gain.value = near ? 120 : 60;
    lfo.connect(lfoG).connect(lp.frequency);
    s.connect(lp).connect(g).connect(this.master);
    s.start(t0); s.stop(t0 + dur + 0.1);
    lfo.start(t0); lfo.stop(t0 + dur + 0.1);
    // the sharp crack of a close strike, riding the front of the rumble
    if (near) this.noiseBurst(t0, 0.18, vol * 0.8, 1800, 'highpass');
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
    else if (type === 'curlew' && !this._wintry) this.curlew(vol * 0.7); // migratory — gone in winter
    else if (type === 'pheasant') this.pheasant(vol * 0.8);
    else if (type === 'owl') this.owl(vol * 0.9);
    else if (type === 'crow') this.crow(vol * 0.7);
    else if (type === 'seagull') this.gull(vol * 0.8);
    else if (type === 'frog' && !this._wintry) this.frogCroak(vol * 0.8); // frogs hibernate in winter
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

  // ---------- tap-room & travel ----------
  potClink(vol = 0.25) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    this.noiseBurst(t0, 0.04, vol * 0.4, 2600, 'bandpass');
    const o = this.osc('triangle', 1400 + Math.random() * 600, t0, 0.12, vol * 0.25);
    if (o) o.frequency.exponentialRampToValueAtTime(1100, t0 + 0.12);
  }
  pubLaugh(vol = 0.22) {
    if (!this.ctx) return;
    let t0 = this.ctx.currentTime;
    const base = 200 + Math.random() * 80;
    const n = 3 + ((Math.random() * 2) | 0);
    for (let i = 0; i < n; i++) { this.osc('sawtooth', base - i * 12, t0, 0.12, vol * 0.4); t0 += 0.13; }
  }
  hearthCrackle(vol = 0.2) {
    if (!this.ctx) return;
    let t0 = this.ctx.currentTime;
    for (let i = 0; i < 3 + ((Math.random() * 3) | 0); i++) {
      this.noiseBurst(t0, 0.03, vol * (0.3 + Math.random() * 0.4), 1800 + Math.random() * 1400, 'bandpass');
      t0 += 0.04 + Math.random() * 0.12;
    }
  }
  dogWoof(vol = 0.3) {
    if (!this.ctx) return;
    let t0 = this.ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(180, t0);
      o.frequency.linearRampToValueAtTime(120, t0 + 0.18);
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
      const g = this.ctx.createGain(); this.env(g, t0, 0.02, vol, 0.2);
      o.connect(f).connect(g).connect(this.master);
      o.start(t0); o.stop(t0 + 0.25);
      t0 += 0.3;
    }
  }
  distantWhistle(vol = 0.15) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    lp.connect(this.master);
    for (const [f, delay, dur] of [[660, 0, 0.7], [550, 0.05, 0.65]]) {
      const o = this.ctx.createOscillator();
      o.type = 'triangle'; o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t0 + delay);
      g.gain.linearRampToValueAtTime(vol * 0.2, t0 + delay + 0.12);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + dur);
      o.connect(g).connect(lp);
      o.start(t0 + delay); o.stop(t0 + delay + dur + 0.1);
    }
  }
  // a fragment o' "On Ilkla Moor Baht 'at" (trad., public domain) on distant brass
  brassBand(vol = 0.06) {
    if (!this.ctx) return;
    let t0 = this.ctx.currentTime + 0.1;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1300;
    lp.connect(this.master);
    const notes = [392, 392, 440, 494, 494, 440, 392, 587]; // G G A B B A G D
    const beat = 0.42;
    for (let i = 0; i < notes.length; i++) {
      const f = notes[i], dur = beat * (i === notes.length - 1 ? 1.6 : 1);
      for (const det of [0, 4, -4]) { // stacked detuned saws = a brassy band
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth'; o.frequency.value = f + det;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(vol * 0.5, t0 + 0.06);
        g.gain.setValueAtTime(vol * 0.5, t0 + dur - 0.08);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g).connect(lp);
        o.start(t0); o.stop(t0 + dur + 0.05);
      }
      t0 += dur;
    }
  }
}
