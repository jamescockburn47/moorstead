// Day/night cycle, moorland weather (clear / misty / fog / rain), rain particles.
import * as THREE from 'three';
import { currentWeather } from './weather-live.js';

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
    this.time = 0.3; // start mid-morning
    this.day = 1;
    this.weather = 'misty';
    this.weatherTimer = 60 + Math.random() * 60;
    this.fogFar = 90; this.fogTargetFar = 90;
    this.rainAmount = 0;
    this.dread = 0;
    this.dreadTarget = 0;
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

    // low drifting cloud sheet
    const cc = document.createElement('canvas'); cc.width = cc.height = 256;
    const cx = cc.getContext('2d');
    cx.clearRect(0, 0, 256, 256);
    for (let i = 0; i < 1800; i++) {
      const x = Math.random() * 256, y = Math.random() * 256;
      const r = 6 + Math.random() * 18;
      const a = Math.random() * 0.05;
      cx.fillStyle = `rgba(235,238,242,${a})`;
      cx.beginPath(); cx.arc(x, y, r, 0, 7); cx.fill();
    }
    const cloudTex = new THREE.CanvasTexture(cc);
    cloudTex.wrapS = cloudTex.wrapT = THREE.RepeatWrapping;
    cloudTex.repeat.set(12, 12);
    this.cloudTex = cloudTex;
    this.clouds = new THREE.Mesh(
      new THREE.PlaneGeometry(3000, 3000),
      new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, opacity: 0.7, fog: false, depthWrite: false })
    );
    this.clouds.rotation.x = Math.PI / 2;
    this.clouds.position.y = 110;
    scene.add(this.clouds);

    // sky dome — a gradient frae horizon to zenith, so t' sky has depth an'
    // wraps round to t' horizon all about, not a flat lid overhead. Horizon
    // colour is fed t' live sky tint each frame, so it keeps day/night,
    // weather, dread an' t' seasonal cast.
    this.domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x2f5074) },
        bottomColor: { value: new THREE.Color(0x9fb6c8) },
        exponent: { value: 0.7 },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float exponent;
        varying vec3 vDir;
        void main() {
          float t = pow(clamp(vDir.y, 0.0, 1.0), exponent);
          gl_FragColor = vec4(mix(bottomColor, topColor, t), 1.0);
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
  update(dt, playerPos, season = null) {
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
    const live = currentWeather();
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
      const next = r < 0.3 ? 'clear' : r < 0.55 ? 'misty' : r < 0.8 ? 'rain' : 'fog';
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
    this.sun.intensity = (0.25 + dayness * 1.0) * (1 - this.dread * 0.35);
    this.ambient.intensity = (0.16 + dayness * 0.5) * (1 - this.dread * 0.25);
    this.sun.color.setHSL(0.1, dayness < 0.4 ? 0.6 : 0.25, 0.85);

    this.sunSprite.position.set(playerPos.x + sunX * 160, sunY * 150 + playerPos.y * 0.3, playerPos.z - 60);
    this.moonSprite.position.set(playerPos.x - sunX * 160, -sunY * 150 + playerPos.y * 0.3, playerPos.z + 60);

    // sky colour
    let col;
    if (sunY > 0.25) col = SKY.day;
    else if (sunY > 0) col = lerpC(sunX > 0 ? SKY.dawn : SKY.dusk, SKY.day, sunY / 0.25);
    else if (sunY > -0.2) col = lerpC(sunX > 0 ? SKY.dawn : SKY.dusk, SKY.night, -sunY / 0.2);
    else col = SKY.night;
    // weather greys t' sky
    const grey = { clear: 0, misty: 0.35, rain: 0.55, fog: 0.7 }[this.weather];
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
    let baseFog = (this.liveFog != null) ? this.liveFog : { clear: 150, misty: 70, rain: 95, fog: 30 }[this.weather];
    if (this.dread > 0.05) baseFog = Math.min(baseFog, 55 - this.dread * 22);
    if (this.moorFog > 0.01) baseFog = Math.min(baseFog, 150 - this.moorFog * 143); // ~7 at full: hand-afore-face stuff
    this.fogTargetFar = baseFog;
    this.fogFar += (this.fogTargetFar - this.fogFar) * Math.min(1, dt * 0.5);
    this.scene.fog.far = this.fogFar;
    this.scene.fog.near = Math.max(5, this.fogFar * 0.25);

    this.stars.material.opacity = Math.max(0, -sunY * 2) * (1 - grey * 0.8);
    this.stars.position.set(playerPos.x, 0, playerPos.z);

    // clouds drift on t' wind
    this.cloudTex.offset.x += dt * 0.004;
    this.cloudTex.offset.y += dt * 0.0015;
    this.clouds.position.x = playerPos.x;
    this.clouds.position.z = playerPos.z;
    this.clouds.material.opacity = 0.25 + grey * 0.55;

    // rain
    const targetRain = (this.liveRain != null) ? this.liveRain : (this.weather === 'rain' ? 1 : 0);
    this.rainAmount += (targetRain - this.rainAmount) * Math.min(1, dt * 0.8);
    this.rain.material.opacity = this.rainAmount * 0.5;
    if (this.rainAmount > 0.02) {
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
      this.rain.position.set(playerPos.x, playerPos.y - 8, playerPos.z);
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
