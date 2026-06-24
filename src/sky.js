// Day/night cycle, moorland weather (clear / misty / fog / rain), rain particles.
import * as THREE from 'three';
import { currentWeather } from './weather-live.js';
import { winterPrecip, overcastGrey, snowfallIntensity } from './snow.js';

const DAY_LENGTH = 1800; // seconds per full day — a proper half-hour, not a rush
// (t' shared-moor relay must agree: worldsvc/server.py DAY_LENGTH)

// weather-change toasts, shared by t' random machine an' t' live-weather feed
const WEATHER_MSG = {
  clear: "Sky's clearin' up. Grand.",
  misty: 'A mist hangs ower t’ moor.',
  rain: 'It’s silin’ it down!',
  fog: 'Fog’s rollin’ in thick. Mind tha doesn’t get lost.',
};

function lerpC(a, b, t) { return a.clone().lerp(b, t); }

const SKY = {
  night: new THREE.Color(0x070a14),
  dawn: new THREE.Color(0x9a6a52),
  day: new THREE.Color(0x9fb6c8),   // pale, slightly grey Yorkshire sky
  dusk: new THREE.Color(0x7a5560),
};

export class Sky {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;  // anchor precipitation to the viewer so snow fills the frame in any view (incl. the aerial title orbit)
    this.time = 0.3; // start mid-morning
    this.day = 1;
    this.weather = 'misty';
    this.weatherTimer = 60 + Math.random() * 60;
    this.fogFar = 90; this.fogTargetFar = 90;
    this.rainAmount = 0;
    this.dread = 0;
    this.dreadTarget = 0;
    this.flash = 0;       // transient lightning-flash term (0..1), spiked by the storm controller, decays each frame
    this.stormPrecip = undefined; // when set (~1) the storm overrides precip to a downpour; cleared restores normal weather
    this.stormIsSnow = undefined; // storm precip falls as snow (winter) vs rain
    this.moorFog = 0;    // T' Great Fog intensity at t' player, 0..1
    this.moorGate = 0;   // set by t' game: 1 on t' high moor, 0 in villages/coast
    this._gateS = 0;
    this.fogDebug = false; // dev: force t' Great Fog on

    this.sun = new THREE.DirectionalLight(0xfff2dd, 1.0);
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.ambient = new THREE.AmbientLight(0xbfcfdd, 0.55);
    scene.add(this.ambient);

    scene.fog = new THREE.Fog(SKY.day.clone(), 10, 90);

    // sun & moon discs
    const mkDisc = (color, size) => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d');
      x.fillStyle = color; x.beginPath(); x.arc(32, 32, 26, 0, 7); x.fill();
      const tex = new THREE.CanvasTexture(c);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, transparent: true, depthWrite: false }));
      s.scale.set(size, size, 1);
      scene.add(s);
      return s;
    };
    this.sunSprite = mkDisc('#ffe9b0', 18);
    this.moonSprite = mkDisc('#d8e0ea', 12);

    // stars
    const starGeo = new THREE.BufferGeometry();
    const pts = [];
    for (let i = 0; i < 350; i++) {
      const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI * 0.5;
      pts.push(Math.cos(a) * Math.cos(b) * 180, Math.sin(b) * 180 + 5, Math.sin(a) * Math.cos(b) * 180);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
      color: 0xcdd8ee, size: 1.4, transparent: true, opacity: 0, fog: false, sizeAttenuation: false,
    }));
    this.scene.add(this.stars);

    // (clouds are rendered inside the sky dome shader below — no flat plane lid)

    // sky dome — a gradient frae horizon to zenith, so t' sky has depth an'
    // wraps round to t' horizon all about, not a flat lid overhead. Horizon
    // colour is fed t' live sky tint each frame, so it keeps day/night,
    // weather, dread an' t' seasonal cast.
    this.domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x2f5074) },
        bottomColor: { value: new THREE.Color(0x9fb6c8) },
        cloudCol: { value: new THREE.Color(0xe8edf2) },
        exponent: { value: 0.7 },
        uTime: { value: 0 },
        uClouds: { value: 0.3 },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 topColor, bottomColor, cloudCol;
        uniform float exponent, uTime, uClouds;
        varying vec3 vDir;
        float hash(vec2 p){ p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }
        float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
        float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a * noise(p); p *= 2.0; a *= 0.5; } return v; }
        void main() {
          vec3 dir = normalize(vDir);
          float t = pow(clamp(dir.y, 0.0, 1.0), exponent);
          vec3 col = mix(bottomColor, topColor, t);
          float up = clamp(dir.y, 0.0, 1.0);
          if (up > 0.02) {
            vec2 uv = dir.xz / max(dir.y, 0.06) * 0.55 + uTime * vec2(0.012, 0.007);
            float n = fbm(uv);
            float cover = 0.62 - uClouds * 0.42;
            float cloud = smoothstep(cover, cover + 0.2, n) * smoothstep(0.05, 0.4, up);
            col = mix(col, cloudCol, cloud * 0.85);
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(500, 24, 16), this.domeMat);
    this.dome.renderOrder = -1;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    // rain
    this.rainCount = 900;
    const rg = new THREE.BufferGeometry();
    const rp = new Float32Array(this.rainCount * 3);
    for (let i = 0; i < this.rainCount; i++) {
      rp[i * 3] = (Math.random() - 0.5) * 40;
      rp[i * 3 + 1] = Math.random() * 24;
      rp[i * 3 + 2] = (Math.random() - 0.5) * 40;
    }
    rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    const rainC = document.createElement('canvas'); rainC.width = 4; rainC.height = 16;
    const rcx = rainC.getContext('2d');
    const grad = rcx.createLinearGradient(0, 0, 0, 16);
    grad.addColorStop(0, 'rgba(190,205,220,0)');
    grad.addColorStop(1, 'rgba(190,205,220,0.8)');
    rcx.fillStyle = grad; rcx.fillRect(1, 0, 2, 16);
    this.rain = new THREE.Points(rg, new THREE.PointsMaterial({
      map: new THREE.CanvasTexture(rainC), size: 0.45, transparent: true,
      opacity: 0, depthWrite: false, sizeAttenuation: true,
    }));
    this.rain.frustumCulled = false;
    scene.add(this.rain);

    // snow (winter) — softer, slower, drifting; mirrors the rain rig
    this.snowCount = 2400;
    this.snowAmount = 0;
    const sg = new THREE.BufferGeometry();
    const sp = new Float32Array(this.snowCount * 3);
    for (let i = 0; i < this.snowCount; i++) {
      sp[i * 3] = (Math.random() - 0.5) * 80;
      sp[i * 3 + 1] = Math.random() * 48 - 28;     // -28..+20: a tall column centred on the viewer
      sp[i * 3 + 2] = (Math.random() - 0.5) * 80;
    }
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    const snowC = document.createElement('canvas'); snowC.width = snowC.height = 8;
    const scx = snowC.getContext('2d');
    const sgr = scx.createRadialGradient(4, 4, 0, 4, 4, 4);
    sgr.addColorStop(0, 'rgba(255,255,255,0.95)'); sgr.addColorStop(1, 'rgba(255,255,255,0)');
    scx.fillStyle = sgr; scx.fillRect(0, 0, 8, 8);
    this.snow = new THREE.Points(sg, new THREE.PointsMaterial({
      map: new THREE.CanvasTexture(snowC), size: 0.5, transparent: true,
      opacity: 0, depthWrite: false, sizeAttenuation: true,
    }));
    this.snow.frustumCulled = false;
    scene.add(this.snow);
  }

  isNight() { return this.time < 0.18 || this.time > 0.82; }

  timeName() {
    const t = this.time;
    if (t < 0.18) return 'Neet';
    if (t < 0.3) return 'Morn';
    if (t < 0.55) return 'Noontide';
    if (t < 0.75) return "Evenin'";
    if (t < 0.82) return 'Gloamin\u2019';
    return 'Neet';
  }

  // returns a weather-change message when t' weather turns, else null
  update(dt, playerPos, season = null, covered = false) {
    let msg = null;
    const prevNight = this.isNight();
    const prevT = this.time;
    this.time += dt / DAY_LENGTH;
    if (this.time >= 1) { this.time -= 1; this.day++; }
    if (!prevNight && this.isNight()) msg = { type: 'night' };
    else if (prevT < 0.74 && this.time >= 0.74) msg = { type: 'dusk' };

    // live moor weather frae Open-Meteo when we have a sample: it drives t'
    // weather state directly an' parks t' random timer. Falls back to t' random
    // machine below on any fetch fault (currentWeather() returns null).
    if (this.forceClear) { this.weather = 'clear'; this.weatherTimer = 1e9; } // title backdrop: always a clear morning
    const live = this.forceClear ? null : currentWeather();
    if (live) {
      this.liveRain = live.rainAmount;
      this.liveFog = live.fogFar;
      if (live.state !== this.weather) {
        this.weather = live.state;
        msg = msg || { type: 'weather', text: WEATHER_MSG[live.state] };
      }
      this.weatherTimer = 1e9; // park t' random machine while live weather rules
    } else {
      this.liveRain = null;
      this.liveFog = null;
    }

    // weather state machine — t' moors are rarely kind
    this.weatherTimer -= dt;
    if (this.weatherTimer <= 0) {
      const r = Math.random();
      // mostly fair: clear skies the rule, real fog a rare thing (offline fallback only)
      const next = r < 0.58 ? 'clear' : r < 0.82 ? 'misty' : r < 0.95 ? 'rain' : 'fog';
      if (next !== this.weather) {
        this.weather = next;
        msg = msg || {
          type: 'weather',
          text: {
            clear: "Sky's clearin' up. Grand.",
            misty: 'A mist hangs ower t\u2019 moor.',
            rain: 'It\u2019s silin\u2019 it down!',
            fog: 'Fog\u2019s rollin\u2019 in thick. Mind tha doesn\u2019t get lost.',
          }[next],
        };
      }
      this.weatherTimer = 80 + Math.random() * 140;
    }

    // sun position
    const ang = (this.time - 0.25) * Math.PI * 2; // sunrise at t=0.25... offset so noon t=0.5
    const sunY = Math.sin(ang), sunX = Math.cos(ang);
    this.sun.position.set(playerPos.x + sunX * 60, sunY * 80, playerPos.z + 20);
    this.sun.target.position.set(playerPos.x, playerPos.y, playerPos.z);
    const dayness = Math.max(0, Math.min(1, (sunY + 0.12) * 3));
    // lightning flash: decays fast (~200 ms from a full spike) and briefly floods
    // the scene lighting — spiked by the storm controller (sky.flash = 1).
    this.flash = Math.max(0, this.flash - dt / 0.22);
    const flashLift = this.flash * this.flash * 2.4; // eased, a sharp blue-white burst
    this.sun.intensity = (0.25 + dayness * 1.0) * (1 - this.dread * 0.35) + flashLift;
    this.ambient.intensity = (0.16 + dayness * 0.5) * (1 - this.dread * 0.25) + flashLift * 0.7;
    this.sun.color.setHSL(0.1, dayness < 0.4 ? 0.6 : 0.25, 0.85);

    this.sunSprite.position.set(playerPos.x + sunX * 160, sunY * 150 + playerPos.y * 0.3, playerPos.z - 60);
    this.moonSprite.position.set(playerPos.x - sunX * 160, -sunY * 150 + playerPos.y * 0.3, playerPos.z + 60);

    // sky colour
    let col;
    if (sunY > 0.25) col = SKY.day;
    else if (sunY > 0) col = lerpC(sunX > 0 ? SKY.dawn : SKY.dusk, SKY.day, sunY / 0.25);
    else if (sunY > -0.2) col = lerpC(sunX > 0 ? SKY.dawn : SKY.dusk, SKY.night, -sunY / 0.2);
    else col = SKY.night;
    // precipitation: split into snow (wintry) vs rain, using live feed or deterministic clock
    let { snow: snowFall, rain: rainTarget } = winterPrecip(season, this.liveRain != null ? this.liveRain : null, season ? snowfallIntensity(Date.now(), season) : 0);
    // the Dracula storm (sky.stormPrecip, set by the storm controller only while
    // the Count's fight is live) overrides precip to a downpour — snow in winter,
    // else rain. Scoped to the fight: clearing the override restores normal weather.
    if (this.stormPrecip) {
      if (this.stormIsSnow) { snowFall = 1; rainTarget = 0; }
      else { rainTarget = 1; snowFall = 0; }
    }
    const targetRain = rainTarget;

    // weather greys t' sky
    const grey = overcastGrey(this.weather, snowFall, this.rainAmount);
    let sky = col.clone().lerp(new THREE.Color(0x8a949c).multiplyScalar(0.2 + dayness * 0.8), grey);
    // Count Dracula's presence: sky bruises, fog thickens — dread afore horror
    this.dread += (this.dreadTarget - this.dread) * Math.min(1, dt * 1.8);
    if (this.dread > 0.02) {
      sky = sky.clone().lerp(new THREE.Color(0x1a1020), this.dread * 0.42);
      sky.lerp(new THREE.Color(0x301018), this.dread * 0.12);
    }

    // T' Great Fog: a shared-clock whiteout on t' high moor — same for every
    // player, like t' train. Every three game days, about six game hours
    // comes down thick, eased in an' out ower ~25s.
    // T' game sets moorGate frae geography: tops only, never coast nor village.
    {
      const CYCLE = DAY_LENGTH * 3, DUR = DAY_LENGTH / 4, EASE = 25;
      const into = (Date.now() / 1000) % CYCLE - (CYCLE - DUR);
      let ev = 0;
      if (into >= 0) ev = into < EASE ? into / EASE : Math.min(1, Math.max(0, (DUR - into) / EASE));
      if (this.fogDebug) ev = 1;
      this._gateS += (this.moorGate - this._gateS) * Math.min(1, dt * 1.2);
      this.moorFog = ev * this._gateS;
      if (this.moorFog > 0.01) {
        sky = sky.clone().lerp(new THREE.Color(0xc6cbd1), this.moorFog * (0.3 + dayness * 0.55));
      }
    }
    // seasonal cast — summer warms the daylight, winter cools and greys it.
    // Scaled by `dayness` so it only tints the lit sky, not the night.
    if (season) {
      const w = season.warmth; // -1 (deep winter) .. +1 (high summer)
      const tint = new THREE.Color().setHSL(w >= 0 ? 0.09 : 0.58, 0.4, 0.5);
      sky = sky.clone().lerp(tint, 0.07 * Math.abs(w) * dayness);
      this.ambient.intensity *= (1 + w * 0.05);
      this.sun.intensity *= (1 + w * 0.04);
    }
    this.scene.background = sky;
    this.scene.fog.color.copy(sky);

    // sky dome follows t' player; horizon takes t' live sky colour, an' t'
    // zenith deepens by day so there's a proper gradient to t' horizon.
    this.dome.position.set(playerPos.x, playerPos.y, playerPos.z);
    this.domeMat.uniforms.bottomColor.value.copy(sky);
    this.domeMat.uniforms.topColor.value.copy(sky).lerp(new THREE.Color(0x21426a), 0.5 * dayness);

    // fog distance
    let baseFog = (this.liveFog != null) ? this.liveFog : { clear: 160, misty: 120, rain: 90, fog: 22 }[this.weather];
    // a 'misty' moor is a soft far haze tha sees through; only 'fog' walls thee in
    if (this.weather === 'misty') baseFog = Math.max(baseFog, 78);
    else if (this.weather === 'fog') baseFog = Math.min(baseFog, 28);
    if (this.dread > 0.05) baseFog = Math.min(baseFog, 55 - this.dread * 22);
    if (this.moorFog > 0.01) baseFog = Math.min(baseFog, 150 - this.moorFog * 143); // ~7 at full: hand-afore-face stuff
    this.fogTargetFar = baseFog;
    this.fogFar += (this.fogTargetFar - this.fogFar) * Math.min(1, dt * 0.5);
    this.scene.fog.far = this.fogFar;
    // thick fog fades in over a SHORT band so it genuinely hides what's beyond (not a
    // pale silhouette); open weather keeps the gentle, distant haze.
    const nearRatio = 0.25 + 0.35 * Math.max(0, Math.min(1, (55 - this.fogFar) / 35));
    this.scene.fog.near = Math.max(5, this.fogFar * nearRatio);

    this.stars.material.opacity = Math.max(0, -sunY * 2) * (1 - grey * 0.8);
    this.stars.position.set(playerPos.x, 0, playerPos.z);

    // drift t' dome clouds on t' wind; coverage frae t' weather, lit by day
    this.cloudT = (this.cloudT || 0) + dt;
    const cu = this.domeMat.uniforms;
    cu.uTime.value = this.cloudT;
    cu.uClouds.value += (grey - cu.uClouds.value) * Math.min(1, dt * 0.5);
    cu.cloudCol.value.setRGB(0.16, 0.18, 0.22).lerp(new THREE.Color(0.91, 0.93, 0.95), dayness);

    // rain
    this.rainAmount += (targetRain - this.rainAmount) * Math.min(1, dt * 0.8);
    this.rain.material.opacity = covered ? 0 : this.rainAmount * 0.5; // no rain through a roof
    if (!covered && this.rainAmount > 0.02) {
      const p = this.rain.geometry.attributes.position;
      for (let i = 0; i < this.rainCount; i++) {
        let y = p.array[i * 3 + 1] - dt * 22;
        if (y < 0) {
          y = 20 + Math.random() * 4;
          p.array[i * 3] = (Math.random() - 0.5) * 40;
          p.array[i * 3 + 2] = (Math.random() - 0.5) * 40;
        }
        p.array[i * 3 + 1] = y;
      }
      p.needsUpdate = true;
      const va = this.camera ? this.camera.position : playerPos;
      this.rain.position.set(va.x, va.y - 8, va.z);
    }

    // winter snow: falls slow, drifts on the wind, no rain alongside
    this.snowAmount += ((covered ? 0 : snowFall) - this.snowAmount) * Math.min(1, dt * 0.5);
    this.snow.material.opacity = this.snowAmount * 0.85;
    if (this.snowAmount > 0.02) {
      const va = this.camera ? this.camera.position : playerPos;
      const p = this.snow.geometry.attributes.position;
      for (let i = 0; i < this.snowCount; i++) {
        let y = p.array[i * 3 + 1] - dt * 6.5;
        p.array[i * 3] += Math.sin((this.cloudT + i) * 0.7) * dt * 0.6;
        // a tall column centred on the viewer: recycle from below the view back up above it, so
        // flakes fall through the WHOLE frame (sky → ground), incl. the aerial title orbit
        if (y < -28) { y = 20 + Math.random() * 8; p.array[i * 3] = (Math.random() - 0.5) * 80; p.array[i * 3 + 2] = (Math.random() - 0.5) * 80; }
        p.array[i * 3 + 1] = y;
      }
      p.needsUpdate = true;
      this.snow.position.set(va.x, va.y, va.z);
    }

    return msg;
  }

  setDread(v) { this.dreadTarget = Math.max(0, Math.min(1, v)); }

  serialize() { return { time: this.time, day: this.day, weather: this.weather }; }
  deserialize(d) {
    if (!d) return;
    this.time = d.time; this.day = d.day; this.weather = d.weather || 'misty';
  }
}
