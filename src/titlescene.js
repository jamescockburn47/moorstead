// titlescene.js — a living, looping fly-over of the moor behind the front page.
// Self-contained: its own scene/camera/renderer, all procedural (no asset files),
// matched to the game's palette. Built once, paused while you play, resumed on the
// title. Fails quietly to the gradient background if WebGL won't start.
import * as THREE from 'three';
import { fbm2, noise2, hash2i } from './noise.js';

const box = (w, h, d, color) =>
  new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));

// one soft round puff texture, shared by every bit of steam
function puffTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.5, 'rgba(232,228,220,0.55)');
  g.addColorStop(1, 'rgba(220,214,206,0)');
  x.fillStyle = g; x.beginPath(); x.arc(32, 32, 30, 0, 7); x.fill();
  return new THREE.CanvasTexture(c);
}

export class TitleFlyover {
  constructor(canvas) {
    this.canvas = canvas;
    this.built = false;
    this.running = false;
    this.raf = 0;
    this.t0 = 0;
    this.seed = 1337;
    this._onResize = () => this._resize();
  }

  // ---- moor terrain: a displaced, vertex-coloured plane ----
  _terrain() {
    const SIZE = 320, SEG = 150;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const H = (x, z) => {
      // rolling tops, a gentle grassy dale through the middle, an' a carved bowl for the tarn
      const h = 5 + fbm2(x * 0.011 + 40, z * 0.011 - 17, 4, this.seed) * 24;
      const dale = Math.exp(-((z + 6) * (z + 6)) / 3200) * 5;
      const pond = Math.exp(-(((x + 70) * (x + 70) + (z - 60) * (z - 60))) / 240) * 7;
      return h - dale - pond + fbm2(x * 0.05, z * 0.05, 2, this.seed + 9) * 1.5;
    };
    this.H = H;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = H(x, z);
      pos.setY(i, y);
      // colour by height + a heather/bracken noise
      const heather = noise2(x * 0.03 + 5, z * 0.03, this.seed + 3);
      const t = Math.min(1, Math.max(0, y / 22));
      if (y < 1.2) c.setHex(0x46562f);                        // boggy tarn-side green
      else if (y > 16.5) c.setHex(0xeef2f6);                  // snow on the caps
      else if (y > 13) c.lerpColors(new THREE.Color(0x6f5d38), new THREE.Color(0xeef2f6), (y - 13) / 3.5); // snowline dusting the tops
      else if (heather > 0.6 && t > 0.34) c.setHex(0x6f5470); // heather purple on the moor
      else if (t < 0.34) c.setHex(0x53612f);                  // dale grass
      else c.lerpColors(new THREE.Color(0x53612f), new THREE.Color(0x67632f), (t - 0.34) / 0.3); // moor grass into bracken
      // a touch of per-vertex variation so it isn't flat
      const j = (hash2i((x * 4) | 0, (z * 4) | 0, this.seed) - 0.5) * 0.06;
      col[i * 3] = Math.max(0, c.r + j); col[i * 3 + 1] = Math.max(0, c.g + j); col[i * 3 + 2] = Math.max(0, c.b + j);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.receiveShadow = false;
    return mesh;
  }

  _sky() {
    const geo = new THREE.SphereGeometry(420, 24, 16);
    // sunrise: a bright gold horizon warming up through rose to a pale morning blue
    const zenith = new THREE.Color(0x6f9fd4), midSky = new THREE.Color(0xe7a98c), horizon = new THREE.Color(0xffd9a0);
    const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const yy = Math.max(0, Math.min(1, pos.getY(i) / 420 * 0.5 + 0.5)); // 0 horizon .. 1 zenith
      if (yy < 0.5) c.copy(horizon).lerp(midSky, yy / 0.5);
      else c.copy(midSky).lerp(zenith, (yy - 0.5) / 0.5);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }));
  }

  _tree(x, z) {
    const g = new THREE.Group();
    const h = 2.2 + Math.random() * 1.6;
    const trunk = box(0.4, h, 0.4, 0x4a3826); trunk.position.y = h / 2; g.add(trunk);
    for (let i = 0; i < 3; i++) {
      const s = 2.2 - i * 0.5;
      const f = box(s, 1.3, s, i % 2 ? 0x33502c : 0x3c5a30);
      f.position.y = h - 0.2 + i * 0.9; g.add(f);
    }
    g.position.set(x, this.H(x, z), z);
    return g;
  }

  _village(cx, cz) {
    const g = new THREE.Group();
    const place = (mesh, x, z, yoff = 0) => { mesh.position.set(cx + x, this.H(cx + x, cz + z) + yoff, cz + z); g.add(mesh); };
    // church: nave + tower + spire
    const nave = box(3.2, 2.4, 5, 0x8a8478); place(nave, 0, 0, 1.2);
    const roof = box(3.4, 1.2, 5.2, 0x5a3a30); place(roof, 0, 0, 2.9);
    const tower = box(2.2, 5.2, 2.2, 0x9a9486); place(tower, 0, -3.2, 2.6);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(1.5, 2.2, 4), new THREE.MeshLambertMaterial({ color: 0x4a4036 }));
    spire.rotation.y = Math.PI / 4; place(spire, 0, -3.2, 6.3);
    // cottages around the green
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * Math.PI * 2, r = 9 + (i % 3) * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * (r * 0.8) + 6;
      const w = 2 + Math.random() * 1.4, d = 2.6 + Math.random();
      const body = box(w, 2, d, 0x8f8576); body.position.set(cx + x, this.H(cx + x, cz + z) + 1, cz + z); g.add(body);
      const rf = box(w + 0.3, 0.9, d + 0.3, 0x5a4030); rf.position.set(cx + x, this.H(cx + x, cz + z) + 2.4, cz + z); g.add(rf);
    }
    return g;
  }

  // a stone wall snaking up a hillside
  _wall(x0, z0, x1, z1) {
    const g = new THREE.Group();
    const n = 26;
    for (let i = 0; i <= n; i++) {
      const x = x0 + (x1 - x0) * (i / n), z = z0 + (z1 - z0) * (i / n);
      const seg = box(0.45, 0.8 + Math.random() * 0.2, 1.0, 0x726a5c);
      seg.position.set(x, this.H(x, z) + 0.4, z);
      seg.rotation.y = Math.atan2(z1 - z0, x1 - x0);
      g.add(seg);
    }
    return g;
  }

  _pony(x, z) {
    const g = new THREE.Group();
    const BODY = 0x4d3925, PT = 0x161009;
    const pbody = box(0.8, 0.8, 1.3, BODY); pbody.position.set(0, 1.05, 0); g.add(pbody);
    const neck = box(0.42, 0.8, 0.5, BODY); neck.position.set(0, 1.45, 0.6); neck.rotation.x = -0.5; g.add(neck);
    const head = box(0.36, 0.4, 0.6, BODY); head.position.set(0, 1.8, 0.95); head.rotation.x = -0.2; g.add(head);
    const tail = box(0.18, 0.7, 0.2, PT); tail.position.set(0, 0.85, -0.78); tail.rotation.x = 0.3; g.add(tail);
    for (const [lx, lz] of [[-0.26, 0.42], [0.26, 0.42], [-0.26, -0.46], [0.26, -0.46]]) {
      const l = box(0.2, 0.7, 0.2, PT); l.position.set(lx, 0.35, lz); g.add(l);
    }
    g.position.set(x, this.H(x, z), z); g.rotation.y = Math.random() * 6.28;
    return g;
  }

  _sheep(x, z) {
    const g = new THREE.Group();
    const sbody = box(0.7, 0.55, 0.95, 0xe6e0d2); sbody.position.set(0, 0.62, 0); g.add(sbody);
    const head = box(0.34, 0.34, 0.32, 0x2a2a2a); head.position.set(0, 0.78, 0.56); g.add(head);
    for (const [lx, lz] of [[-0.22, 0.3], [0.22, 0.3], [-0.22, -0.3], [0.22, -0.3]]) {
      const l = box(0.13, 0.4, 0.13, 0x242424); l.position.set(lx, 0.2, lz); g.add(l);
    }
    g.position.set(x, this.H(x, z), z); g.rotation.y = Math.random() * 6.28;
    return g;
  }

  _train(track) {
    const g = new THREE.Group();
    const black = 0x14181c, red = 0x5a2420;
    // loco
    const boiler = box(1.0, 1.0, 2.6, black); boiler.position.set(0, 0.9, 0.2); g.add(boiler);
    const cab = box(1.2, 1.3, 1.2, black); cab.position.set(0, 1.05, -1.2); g.add(cab);
    const funnel = box(0.5, 0.7, 0.5, black); funnel.position.set(0, 1.6, 1.1); g.add(funnel);
    const buffer = box(1.2, 0.5, 0.3, red); buffer.position.set(0, 0.55, 1.55); g.add(buffer);
    for (const wz of [1.0, 0.2, -0.6, -1.4]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.3, 12), new THREE.MeshLambertMaterial({ color: 0x0c0e10 })); w.rotation.z = Math.PI / 2; w.position.set(0, 0.4, wz); g.add(w); }
    // two carriages
    for (let ci = 1; ci <= 2; ci++) {
      const car = box(1.2, 1.4, 3.0, 0x6a3b2a); car.position.set(0, 1.0, -2.6 - ci * 3.2); g.add(car);
      const roofc = box(1.3, 0.3, 3.0, 0x3a2018); roofc.position.set(0, 1.75, -2.6 - ci * 3.2); g.add(roofc);
    }
    this.train = g; this.trainTrack = track;
    return g;
  }

  // oval track the train runs on; returns {pos,ang} for a 0..1 parameter
  _trackAt(u) {
    const a = u * Math.PI * 2;
    const x = Math.cos(a) * 46, z = 22 + Math.sin(a) * 30;
    return { x, z, a };
  }

  _build() {
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    r.setPixelRatio(Math.min(devicePixelRatio || 1, 1.6));
    this.renderer = r;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xf2dcb4, 175, 470); // pale dawn haze, pushed back so the moor reads clear
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.5, 700);

    this.scene.add(this._sky());
    // a low rising sun — bright morning light
    const sunDir = new THREE.Vector3(0.46, 0.20, -0.86).normalize();
    const sun = new THREE.DirectionalLight(0xfff0d2, 1.5); sun.position.copy(sunDir).multiplyScalar(120); this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight(0xdce8f4, 0x6a5e44, 0.9)); // bright morning fill
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.18));
    // the rising sun: a bright core inside a warm halo, low on the horizon
    const gtex = puffTexture();
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: gtex, color: 0xffe6b0, transparent: true, depthWrite: false, opacity: 0.85, fog: false }));
    halo.scale.set(115, 115, 1); halo.position.copy(sunDir).multiplyScalar(340); this.scene.add(halo);
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: gtex, color: 0xfff7e2, transparent: true, depthWrite: false, opacity: 1, fog: false }));
    core.scale.set(36, 36, 1); core.position.copy(sunDir).multiplyScalar(345); this.scene.add(core);

    this.scene.add(this._terrain());

    // a tarn in a low spot
    const water = new THREE.Mesh(new THREE.CircleGeometry(9.5, 28), new THREE.MeshLambertMaterial({ color: 0x35506a, transparent: true, opacity: 0.9 }));
    water.rotateX(-Math.PI / 2); water.position.set(-70, 0.9, 60); this.scene.add(water);

    this.scene.add(this._village(38, 30));
    // scatter trees in the dale, away from the village
    for (let i = 0; i < 16; i++) {
      const x = -120 + Math.random() * 240, z = -40 + Math.random() * 120;
      if (Math.hypot(x - 38, z - 30) < 22) continue;
      if (this.H(x, z) > 12) continue;
      this.scene.add(this._tree(x, z));
    }
    // a couple of drystone walls climbing the tops
    this.scene.add(this._wall(-90, -30, -50, 40));
    this.scene.add(this._wall(70, -20, 95, 60));
    // beasts on the hill
    for (let i = 0; i < 4; i++) this.scene.add(this._pony(-30 + Math.random() * 90, -30 + Math.random() * 50));
    for (let i = 0; i < 12; i++) this.scene.add(this._sheep(-90 + Math.random() * 180, -30 + Math.random() * 110));

    this.scene.add(this._train(0));
    // steam pool, parented to the world so it lingers as the loco pulls away
    this.puffs = [];
    const ptex = puffTexture();
    for (let i = 0; i < 12; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ptex, transparent: true, depthWrite: false, opacity: 0 }));
      s.userData.life = i / 12; this.scene.add(s); this.puffs.push(s);
    }

    this.built = true;
    this._resize();
  }

  _resize() {
    if (!this.renderer) return;
    const w = this.canvas.clientWidth || this.canvas.offsetWidth || 1280;
    const h = this.canvas.clientHeight || this.canvas.offsetHeight || 720;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _frame(now) {
    if (!this.running) return;
    if (!this.t0) this.t0 = now;
    const t = (now - this.t0) / 1000; // seconds

    // only do the work when the title is actually on screen
    if (this.canvas.offsetParent !== null) {
      // camera: a slow elliptical fly-over, banking into the turn, looking forward-down
      const a = t * 0.085;
      const cam = this.camera;
      cam.position.set(Math.cos(a) * 90, 27 + Math.sin(a * 1.3) * 5, Math.sin(a) * 76 + 6);
      const look = new THREE.Vector3(Math.cos(a + 0.7) * 24, 11, Math.sin(a + 0.7) * 22 + 12);
      cam.lookAt(look);
      cam.rotation.z += Math.sin(a) * 0.05; // gentle bank

      // train along its track
      const u = (t * 0.012) % 1;
      const p = this._trackAt(u), pn = this._trackAt((u + 0.004) % 1);
      this.train.position.set(p.x, this.H(p.x, p.z) + 0.35, p.z);
      this.train.rotation.y = -Math.atan2(pn.z - p.z, pn.x - p.x) + Math.PI / 2;
      // steam from the funnel
      const fpos = new THREE.Vector3(0, 1.95, 1.1).applyEuler(this.train.rotation).add(this.train.position);
      for (const s of this.puffs) {
        s.userData.life += 0.016;
        if (s.userData.life >= 1) { s.userData.life = 0; s.position.copy(fpos); }
        const lf = s.userData.life;
        s.position.y += 0.05; s.position.x += 0.03; s.position.z -= 0.02;
        const sc = 0.8 + lf * 3.0; s.scale.set(sc, sc, 1);
        s.material.opacity = Math.max(0, 0.55 * (1 - lf));
      }

      this.renderer.render(this.scene, this.camera);
    }
    this.raf = requestAnimationFrame(this._frame.bind(this));
  }

  start() {
    if (this.running) return;
    try {
      if (!this.built) this._build();
    } catch (e) {
      this.built = false; this.running = false;
      return; // WebGL unavailable — the CSS gradient stands in
    }
    this.running = true;
    this.t0 = 0;
    addEventListener('resize', this._onResize);
    this._resize();
    this.raf = requestAnimationFrame(this._frame.bind(this));
  }

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    removeEventListener('resize', this._onResize);
  }
}
