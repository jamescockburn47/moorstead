// birds.js — [32] starling murmuration at dusk. A shape-shifting flock (ball →
// ribbon → sheet) hangin' ower a roost near a village, seen of an autumn or
// frosty-winter dusk when the sky's dry. Real Moors sight, this: thousands o'
// starlings wheelin' as one body afore they drop into t' reeds for t' night.
//
// ONE THREE.Points, fully GPU-animated (mirrors makeFireworks in festivalKit.js):
// per-bird attributes are baked once frae a seeded RNG, all motion is summed
// sines in the vertex shader driven by uTime, an' the CPU only pokes a handful
// of uniforms a frame (uCentre, uStretch, uFade) — same shape as tickFires'
// registry. Dark 8px canvas dot: starlings at distance read as near-black
// flecks, not lit birds.
import * as THREE from 'three';
import { mulberry32 } from './noise.js';
import { registerFxMat, unregisterFxMat } from './fire.js';
import { solarState } from './sky.js';

export const MURMUR_COUNT_FINE = 600;
export const MURMUR_COUNT_PLAIN = 250;

// ---- dusk / season gate (pure — headlessly testable) ---------------------
// Narrow band either side of the SOLAR sunset ([SOLAR] James 2026-07-03: the
// band rides solarState(…).sunsetT now, not the old 0.70–0.80 literals — at
// the equinox the two are identical, mid-autumn dusk lands ~0.71, deep-winter
// ~0.65). Murmurations happen at last light, not full dark.
const DUSK_HALF = 0.05;  // half-width of the last-light band about sunsetT
export function duskGate(time, yearPhase = 0.125) {
  const t = ((time % 1) + 1) % 1;
  const mid = solarState(t, yearPhase).sunsetT; // peak at the solar sunset itself
  if (t < mid - DUSK_HALF || t > mid + DUSK_HALF) return 0;
  return 1 - Math.abs(t - mid) / DUSK_HALF; // 0 at the edges, 1 at dead centre
}

// Season gate: bump scalars frae season.js — autumn is prime murmuration
// season, an' a frosty winter dusk (frost > 0.5) still draws a flock.
export function seasonGate(season) {
  if (!season) return 0;
  const autumn = season.autumn || 0;
  const frostyWinter = season.season === 'winter' ? (season.frost || 0) : 0;
  return Math.max(autumn, frostyWinter > 0.5 ? frostyWinter : 0);
}

// Combined visibility gate: dusk × season × dry. Each factor 0..1; the flock
// fades in a shrinks out rather than popping — callers ease uFade toward this.
export function murmurationGate(time, season, rainAmount) {
  const dry = 1 - Math.min(1, Math.max(0, rainAmount || 0) / 0.25);
  if (dry <= 0) return 0;
  const s = seasonGate(season);
  if (s <= 0) return 0;
  // [SOLAR] the dusk band follows the season's own sunset (equinox default when
  // the season carries no yearPhase — e.g. headless stubs)
  const d = duskGate(time, season && season.yearPhase != null ? season.yearPhase : 0.125);
  if (d <= 0) return 0;
  return Math.min(1, s) * d * dry;
}

// Deterministic roost pick: hash the village list down to one index so every
// client picks the SAME home village for the flock (worldSeed-derived, not
// Math.random — invariant 6). Falls back to index 0 (home village) if the
// hash or list is empty.
export function pickRoostVillage(villages, worldSeed) {
  if (!villages || !villages.length) return null;
  const rng = mulberry32((worldSeed ^ 0x6d75726d) >>> 0); // ^ 'murm' bytes, cheap salt
  const idx = Math.floor(rng() * villages.length) % villages.length;
  return villages[idx];
}

// ---- shader --------------------------------------------------------------
// Per-bird motion: a slow 3-axis Lissajous body (the flock's collective drift,
// shared by every point via uCentre) plus a per-bird orbit round that centre
// built frae 3 summed sines seeded on aSeed, scaled by uStretch so the SAME
// swarm reads as a ball (stretch ~1,1,1), a ribbon (one axis long) or a sheet
// (one axis flat) without touching a single attribute. A small fast jitter
// keeps individual birds twitchy inside the shared shape.
const BIRD_VERT = `
  attribute vec3 aSeed;
  uniform float uTime;
  uniform vec3 uCentre;
  uniform vec3 uStretch;
  uniform float uFade;
  varying float vAlpha;
  void main(){
    float t = uTime;
    // three independent slow orbits per bird, phase-locked to its seed so it
    // keeps its own lane inside the flock rather than swimming through others
    vec3 orbit = vec3(
      sin(t * 0.42 + aSeed.x * 6.2831) * cos(t * 0.19 + aSeed.y * 6.2831),
      sin(t * 0.31 + aSeed.y * 6.2831 + 1.7) * 0.6,
      cos(t * 0.37 + aSeed.z * 6.2831) * sin(t * 0.23 + aSeed.x * 6.2831 + 0.9)
    );
    vec3 jitter = vec3(
      sin(t * 6.0 + aSeed.x * 40.0),
      sin(t * 6.0 + aSeed.y * 40.0 + 2.1),
      sin(t * 6.0 + aSeed.z * 40.0 + 4.2)
    ) * 0.2;
    vec3 pos = uCentre + orbit * uStretch + jitter;
    vAlpha = uFade;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    // distance-attenuated point size — a wee dark fleck, bigger up close
    gl_PointSize = uFade <= 0.001 ? 0.0 : clamp(340.0 / -mv.z, 1.0, 6.0);
  }
`;

const BIRD_FRAG = `
  precision mediump float;
  uniform sampler2D uMap;
  varying float vAlpha;
  void main(){
    if (vAlpha <= 0.004) discard;
    vec4 tex = texture2D(uMap, gl_PointCoord);
    float a = tex.a * vAlpha;
    if (a <= 0.004) discard;
    gl_FragColor = vec4(tex.rgb, a);
  }
`;

// ---- lazy 8px dot sprite ---------------------------------------------------
// Soft-edged, near-black — a starling silhouette at distance, not a lit dot.
// Built on first construct only (headless import must never touch canvas —
// same guard as train.js's nerEmblem()).
let _dotTex = null;
function birdDotTexture() {
  if (typeof document === 'undefined') return null;
  if (_dotTex) return _dotTex;
  const S = 8;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(10,10,12,0.95)');
  g.addColorStop(0.6, 'rgba(10,10,12,0.7)');
  g.addColorStop(1, 'rgba(10,10,12,0)');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  _dotTex = new THREE.CanvasTexture(c);
  return _dotTex;
}

// module-scratch — zero per-frame allocations in update()
const _villPos = { x: 0, z: 0 };

export class MurmurationLayer {
  // scene: THREE.Scene to add/remove the Points root.
  // world: chunk world — world.gen.seed (worldSeed) an' world.gen.geo.villages
  //        (roost anchor) are read frae here, same access path main.js already
  //        uses (this.world.gen.geo.villages).
  // sky: the live Sky instance — sky.time (day-fraction, dusk gate) an'
  //      sky.rainAmount (dry gate) are read each frame; nowt is written back.
  // isFine: quality flag chosen at BUILD time (Fine = 600 birds, Plain = 250).
  //         Mirrors the FIREWORK_SPARKS-style const-count pattern; quality
  //         flips are rare enough that the orchestrator can rebuild the layer
  //         rather than resizing buffers live.
  constructor({ scene, world, sky, isFine = false } = {}) {
    this.scene = scene;
    this.world = world;
    this.sky = sky;
    this.isFine = !!isFine;
    this.count = this.isFine ? MURMUR_COUNT_FINE : MURMUR_COUNT_PLAIN;
    this.fade = 0;       // eased visibility, 0..1
    this.points = null;
    this.mat = null;
    this._phaseX = 0; this._phaseY = 0; this._phaseZ = 0; // roost-hashed Lissajous phases
    this._roost = null;   // { x, z, ground|y }
    this._loftH = 60;     // height above the roost the flock patrols, 40-80 blocks

    this._build();
  }

  _build() {
    const worldSeed = (this.world && this.world.gen && (this.world.gen.seed >>> 0)) || 0;
    const geo = this.world && this.world.gen && this.world.gen.geo;
    const villages = geo && geo.villages;
    const roost = pickRoostVillage(villages, worldSeed) || (geo && geo.village) || { x: 0, z: 0, ground: 24 };
    this._roost = roost;

    // Lissajous phase, hashed off the roost's own coords so every village's
    // flock loops differently but is stable frame to frame an' client to
    // client (invariant 6 — no Math.random).
    const rng = mulberry32(((roost.x | 0) * 73856093 ^ (roost.z | 0) * 19349663 ^ worldSeed) >>> 0);
    this._phaseX = rng() * Math.PI * 2;
    this._phaseY = rng() * Math.PI * 2;
    this._phaseZ = rng() * Math.PI * 2;
    this._loftH = 40 + rng() * 40; // 40-80 blocks above the roost, hashed per village

    const rngBirds = mulberry32((worldSeed ^ 0x5442726f) >>> 0); // ^ 'TBro' salt, distinct stream
    const n = this.count;
    const seeds = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      seeds[i * 3 + 0] = rngBirds();
      seeds[i * 3 + 1] = rngBirds();
      seeds[i * 3 + 2] = rngBirds();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uCentre: { value: new THREE.Vector3() },
        uStretch: { value: new THREE.Vector3(10, 6, 10) },
        uFade: { value: 0 },
        uMap: { value: birdDotTexture() },
      },
      vertexShader: BIRD_VERT,
      fragmentShader: BIRD_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.mat = mat;
    registerFxMat(mat); // uniform IS named uTime — ticks for free off tickFires

    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false; // the shape roams well off any single AABB
    pts.visible = false;       // invisible until the gate says otherwise
    pts.userData.wow = 'murmuration';
    this.points = pts;
    if (this.scene) this.scene.add(pts);
  }

  // dt: seconds since last frame; season: the seasonState() main.js computes
  // each frame (neither world nor sky stores one). Call every frame regardless
  // of gate state — update() itself skips uniform writes while gated off.
  update(dt, season = null) {
    if (!this.points || !this.mat) return;
    const sky = this.sky;
    const time = sky ? sky.time : 0;
    const rain = sky ? sky.rainAmount : 0;
    if (!season) season = (this.world && this.world.season) || (sky && sky.season) || null;
    const targetGate = murmurationGate(time, season, rain);

    // ease fade toward the gate — flock settles in/out rather than popping
    this.fade += (targetGate - this.fade) * Math.min(1, dt * 0.5);
    if (this.fade < 0.002 && targetGate <= 0) {
      // fully gated off: invisible, skip the uniform writes (spec requirement)
      if (this.points.visible) this.points.visible = false;
      this.mat.uniforms.uFade.value = 0;
      return;
    }

    if (!this.points.visible) this.points.visible = true;
    // Shared wall-clock, NOT a per-client accumulator: every player watches
    // t' same flock trace t' same loop (invariant 6 — the snow.js clock idiom).
    // No modulus: Math.sin is double-precision here (CPU side), an' a wrap
    // would pop t' flock once an hour. Per-bird wing jitter rides uTime (fx
    // tick) an' may drift per client; that's sub-bird cosmetic flutter, allowed.
    const t = Date.now() / 1000;

    const roost = this._roost || { x: 0, z: 0, ground: 24 };
    _villPos.x = roost.x; _villPos.z = roost.z;
    const roostY = (roost.ground != null ? roost.ground : (roost.y != null ? roost.y : 24)) + this._loftH;

    // seeded Lissajous loop above the roost — slow, so it reads as t' flock
    // patrolling one patch of sky rather than flying a route
    const u = this.mat.uniforms;
    u.uCentre.value.set(
      _villPos.x + Math.sin(t * 0.05 + this._phaseX) * 22,
      roostY + Math.sin(t * 0.037 + this._phaseY) * 14,
      _villPos.z + Math.cos(t * 0.043 + this._phaseZ) * 22,
    );

    // 3 slow independent sines morph the flock's silhouette: ball → ribbon → sheet
    const sx = 6 + 10 * (0.5 + 0.5 * Math.sin(t * 0.08 + this._phaseX));
    const sy = 4 + 8 * (0.5 + 0.5 * Math.sin(t * 0.065 + this._phaseY + 2.1));
    const sz = 6 + 10 * (0.5 + 0.5 * Math.sin(t * 0.071 + this._phaseZ + 4.2));
    u.uStretch.value.set(sx, sy, sz);

    u.uFade.value = this.fade;
  }

  // Full teardown: unregister frae the shared fx tick, dispose geometry +
  // material + the (shared, module-level) dot texture is NOT owned by this
  // layer — it's a cached singleton like nerEmblem/getFlameMaterial, so we
  // leave it for the next flock. Resource hygiene invariant 7: dispose what
  // we alone own.
  dispose() {
    if (this.points) {
      if (this.scene) this.scene.remove(this.points);
      this.points.geometry.dispose();
    }
    if (this.mat) {
      unregisterFxMat(this.mat);
      this.mat.dispose();
    }
    this.points = null;
    this.mat = null;
  }
}
