// festivalKit.js — generic, festival-agnostic mesh helpers shared across the
// seasonal layer and individual festival builders. Pure three.js: each helper
// builds one mesh, pushes it to the caller's teardown `objects` array and adds
// it to `scene`. The userData flags (sharedMaterial/ownGeometry) drive teardown
// in SeasonalLayer.clear(), so they MUST be preserved byte-for-byte.
import * as THREE from 'three';
import { TILE, B } from './defs.js';
import { tileUV } from './textures.js';
import { getMaterials } from './mesher.js';
import { registerFxMat, unregisterFxMat } from './fire.js';
import { solarState } from './sky.js';

// --- village open-ground placement (shared by every festival builder) -------------------------
// Centrepieces + scatter (bonfire pile, maypole, corn stooks, pace-eggs, greenery) sit on open
// communal ground near a village. The STYLISED world classifies cells via geo.villageColumn
// (green/closes/path); the REAL-Moors world returns NULL there, so every "kind === green" gate
// rejected the whole village and nothing built. Fall back to the village's BUILDING FOOTPRINTS
// (populated on v.buildings by SeasonalLayer): open ground = clear sky above the surface AND not
// inside any footprint AND not the stone cross dead-centre. Works in both worlds. `col` is the
// villageColumn result if the caller already has it (else pass null).
export function isOpenGround(world, v, x, z, col = null) {
  if (col && col.kind === 'building') return false;                 // stylised: explicit building cell
  if (x === v.x && z === v.z) return false;                         // the stone cross sits dead-centre
  const boxes = v.buildings || [];
  for (const b of boxes) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return false;
  const sy = world.gen.height(x, z);
  return world.getBlock(x, sy + 1, z) === B.AIR;                    // open sky above the surface
}

// Deterministic open cell near a village centre for a centrepiece. Pass 1 prefers a classified
// green/closes/path (stylised world); pass 2 takes ANY open ground (the real-Moors fallback).
// `salt` rotates the scan so two centrepieces in one village don't pick the exact same cell.
// `opts` adds safety clearances for hazardous centrepieces (the bonfire — James 2026-07-03:
// fires were landing on/next to the rail line and against building walls):
//   margin    — blocks of extra Chebyshev clearance beyond every building footprint (default 0)
//   railClear — min distance frae any rail line, via geo.railInfo where it exists (default 0)
//   maxR      — scan radius (default 12; raise it when clearance shrinks the candidate set)
export function greenPlacement(world, v, salt = 0, opts = {}) {
  const geo = world.gen.geo;
  const margin = opts.margin || 0, railClear = opts.railClear || 0, maxR = opts.maxR || 12;
  const isPreferred = k => k === 'green' || k === 'closes' || k === 'path';
  const clearOf = (x, z) => {
    if (margin > 0) {
      for (const b of (v.buildings || []))
        if (x >= b.x0 - margin && x <= b.x1 + margin && z >= b.z0 - margin && z <= b.z1 + margin) return false;
    }
    if (railClear > 0 && typeof geo.railInfo === 'function') {
      const ri = geo.railInfo(x, z);
      if (ri && ri.d < railClear) return false;
    }
    return true;
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let r = 2; r <= maxR; r++) {
      for (let ai = 0; ai < 16; ai++) {
        const angle = (ai / 16) * Math.PI * 2 + salt;
        const x = v.x + Math.round(r * Math.cos(angle));
        const z = v.z + Math.round(r * Math.sin(angle));
        const col = typeof geo.villageColumn === 'function' ? geo.villageColumn(x, z) : null;
        if (pass === 0 && !(col && isPreferred(col.kind))) continue;  // pass 1: classified greens only
        if (!clearOf(x, z)) continue;
        if (!isOpenGround(world, v, x, z, col)) continue;
        return { x, z };
      }
    }
  }
  return null;
}

// Build a flat cutout quad for TILE tile and add it to the scene + objects.
// Reuses floraLayer's crossGeom approach: two crossed quads with the atlas UV,
// the shared cutout material, and white vertex colours so the texture shows as-is.
export function addBillboard(scene, objects, tile, x, y, z, yaw) {
  const [u0, v0, u1, v1] = tileUV(tile);
  const h = 1, w = 0.5;
  const pos = [-w, 0, 0, w, 0, 0, w, h, 0, -w, h, 0, 0, 0, -w, 0, 0, w, 0, h, w, 0, h, -w];
  const uv  = [u0, v0, u1, v0, u1, v1, u0, v1, u0, v0, u1, v0, u1, v1, u0, v1];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color',    new THREE.Float32BufferAttribute(new Array(24).fill(1), 3));
  geo.setAttribute('aGlint',   new THREE.Float32BufferAttribute(new Array(8).fill(0), 1));
  geo.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, getMaterials().cutout);
  mesh.frustumCulled = false;
  mesh.rotation.y = yaw;
  mesh.position.set(x, y, z);
  mesh.userData.ownGeometry = true;
  mesh.userData.sharedMaterial = true; // cutout material is shared — don't dispose it
  scene.add(mesh);
  objects.push(mesh);
}

// Place a warm candlelight glow quad over a window cell, facing outward.
// Uses a NEW per-mesh MeshBasicMaterial (unlit, warm amber) sized to cover one
// window pane. The material is NOT flagged sharedMaterial, so clear() disposes it.
// `opts` lets the 'Fine' path warm/brighten the pane (bloom catches colours > ~0.85
// post-ACES) without touching the Plain look: { color, opacity }.
export function addWindowGlow(scene, objects, x, y, z, yaw, opts = {}) {
  const mat = new THREE.MeshBasicMaterial({
    color: opts.color != null ? opts.color : 0xffce6b,
    transparent: true,
    opacity: opts.opacity != null ? opts.opacity : 0.82,
    depthWrite: false,
    side: THREE.DoubleSide, // visible from outside whichever wall it sits on
  });
  const geo = new THREE.PlaneGeometry(0.7, 0.75);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.y = yaw;
  mesh.position.set(x, y, z);
  mesh.frustumCulled = false;
  mesh.userData.ownGeometry = true;
  // Do NOT set sharedMaterial — this material is per-mesh and must be disposed.
  scene.add(mesh);
  objects.push(mesh);
}

// ============================== the festival WOW kit ==============================
// Everything below is the 'Fine'-quality spectacle layer: fireworks, drifting
// motes, lantern strings, bunting an' streaming maypole ribbons. All of it is:
//   • POOLED — every particle count is a fixed allocation at build time; the
//     animation is GPU-side (uTime shaders) or a handful of position writes.
//     Nowt allocates per frame.
//   • LIFECYCLE-SAFE — each FX object is pushed to ctx.objects as a ROOT with a
//     dispose() that unregisters its uTime material from the fire tick registry;
//     SeasonalLayer.clear() calls dispose() then disposes geometry + material.
//   • QUALITY-GATED — builders only call these when ctx.fine is set (the game's
//     'Fine' renderer: ACES + bloom threshold 0.85 + shadows). Plain stays
//     byte-for-byte today's look.

// --- quality + time-of-day gates ------------------------------------------------
// The game exposes itself at window.moorstead (main.js ~589). gfxQuality is
// 'fine' | 'plain' (persisted in localStorage 'moorcraft-gfx', resolved by
// sky.resolveQuality). Headless / early-boot → false, so the Plain path is the
// safe default everywhere.
export function isFine() {
  try {
    return typeof window !== 'undefined' && !!window.moorstead && window.moorstead.gfxQuality === 'fine';
  } catch { return false; }
}

// Pure: 0 (broad day) → 1 (full night) from the sky clock. [SOLAR] the sun's
// altitude comes from the one solar API (solarState, sky.js) so festival dark
// falls at the SEASONAL sunset — early of a bonfire-night autumn, late of a
// midsummer eve. Default yearPhase = the equinox (sunrise 0.25 / sunset 0.75,
// the old fixed behaviour's shape).
export function nightFromSkyTime(time, yearPhase = 0.125) {
  const sunY = solarState(time, yearPhase).sunAlt;
  return Math.max(0, Math.min(1, (-sunY + 0.04) * 2.6));
}

// Live night factor off the running game's sky; 0 when headless (FX invisible).
export function nightFactor() {
  try {
    const g = (typeof window !== 'undefined' && window.moorstead) || null;
    const sky = g && g.sky;
    return sky ? nightFromSkyTime(sky.time, sky.yearPhase != null ? sky.yearPhase : 0.125) : 0;
  } catch { return 0; }
}

// --- pure particle maths (mirrored in the GLSL below; unit-tested headlessly) ----
// The same 1D hash the ember shader uses — keep JS + GLSL byte-for-byte.
export function hash1(n) { const s = Math.sin(n * 78.233) * 43758.5453; return s - Math.floor(s); }
function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Rocket ascent: eased-out climb to `apex` blocks over t in [0,1] — fast off the
// pale, slowing toward the burst point, like a real black-powder rocket.
export function rocketHeight(t, apex) {
  const tt = Math.max(0, Math.min(1, t));
  return apex * (1 - (1 - tt) * (1 - tt));
}

// Burst spark: ballistic offset from the burst point after ts in [0,1] of a
// `live`-second life. Direction + speed are hashed off the spark's seed;
// gravity pulls the arc over. Returns {x, y, z} in blocks.
export const SPARK_LIVE = 1.9;    // seconds a burst spark lives
export const SPARK_GRAVITY = 4.5; // blocks/s² — gentle, so sparks hang and fall
export function sparkOffset(seed, ts, live = SPARK_LIVE, g = SPARK_GRAVITY) {
  const h1 = hash1(seed * 13.7), h2 = hash1(seed * 5.1), h3 = hash1(seed * 29.3);
  const theta = h1 * Math.PI * 2;
  const cp = h2 * 2 - 1;                    // cos(phi) uniform on the sphere
  const sp = Math.sqrt(Math.max(0, 1 - cp * cp));
  const speed = 3.2 + 3.4 * h3;
  const tSec = Math.max(0, ts) * live;
  return {
    x: sp * Math.cos(theta) * speed * tSec,
    y: cp * speed * tSec - 0.5 * g * tSec * tSec,
    z: sp * Math.sin(theta) * speed * tSec,
  };
}

// Spark brightness over its life: snaps on at the burst, holds, dies away to
// exactly 0 by the end of life (so a recycled spark never pops visibly).
export function sparkFade(ts) {
  if (ts <= 0 || ts >= 1) return 0;
  return smoothstep(0, 0.08, ts) * (1 - smoothstep(0.5, 1, ts));
}

// Catenary-ish sag for a hung line (lantern strings, bunting): parabolic dip,
// 0 at both ends, -sag at the middle. Good enough at village scale.
export function sagY(t, sag) { return -4 * sag * t * (1 - t); }

// Maypole streamer point (JS mirror of the ribbon vertex shader): ribbon `ir`
// of `n`, param tAlong in [0,1] root→tip, at time `time`. The ribbons process
// slowly round the pole (wrap), trail a twist along their length, an' flutter
// outward toward the tip — reads as ribbons streaming in the May breeze.
export function ribbonPoint(ir, n, tAlong, time, topY = 6.3, baseR = 2.0) {
  const a0 = (ir / n) * Math.PI * 2;
  const ang = a0 + time * 0.5 + tAlong * 2.4;
  const flutter = Math.sin(time * 2.2 + tAlong * 9.0 + a0) * 0.25 * tAlong;
  const r = 0.18 + (baseR - 0.18) * tAlong + flutter * 0.3;
  const y = topY * (1 - tAlong * 0.85) + Math.sin(time * 1.7 + a0 + tAlong * 5.0) * 0.15 * tAlong;
  return { x: Math.cos(ang) * r, y, z: Math.sin(ang) * r };
}

// --- fireworks (Bonfire Night) ----------------------------------------------------
// One pooled THREE.Points per launch site: FIREWORK_STREAK trail points that ride
// the rocket up, then FIREWORK_SPARKS ballistic sparks that burst, arc over an'
// gutter out. Everything is derived in-shader from uTime — the CPU only pokes
// uNight once a frame (fireworks are a night spectacle; they fade with the dusk).
// Period-true c.1900: warm golds an' reds (chrysanthemum burst), one rocket every
// 4–8 s per site.
export const FIREWORK_SPARKS = 130;  // burst sparks (spec: 60–150)
export const FIREWORK_STREAK = 12;   // ascent-trail points
export const FIREWORK_LAUNCH = 1.25; // seconds of ascent

const FW_VERT = `
  attribute float aSeed;   // 0..1 per point
  attribute float aRole;   // 0 = ascent streak, 1 = burst spark
  attribute float aTint;   // 0..1 — colour pick (gold / red / rare white)
  uniform float uTime;
  uniform float uNight;    // 0 day .. 1 night — fireworks are a night show
  uniform float uPhase;    // per-site phase 0..1
  uniform float uPeriod;   // seconds per rocket (4..8)
  uniform float uApex;     // burst height, blocks
  varying float vAlpha;
  varying float vTint;
  varying float vRole;
  float h(float n){ return fract(sin(n * 78.233) * 43758.5453); }
  void main(){
    vTint = aTint;
    vRole = aRole;
    float cycle = mod(uTime + uPhase * uPeriod, uPeriod);
    const float LAUNCH = ${FIREWORK_LAUNCH.toFixed(2)};
    const float LIVE   = ${SPARK_LIVE.toFixed(2)};
    const float G      = ${SPARK_GRAVITY.toFixed(2)};
    // the rocket head drifts a touch off vertical, hashed per site
    vec2 drift = vec2(h(uPhase * 3.1) - 0.5, h(uPhase * 9.4) - 0.5) * 1.4;
    vec3 p; float alpha; float size;
    if (aRole < 0.5) {
      // ascent streak: trail points strung behind the head, eased climb
      float t = clamp(cycle / LAUNCH, 0.0, 1.0);
      float tt = max(t - aSeed * 0.25, 0.0);
      float ease = 1.0 - (1.0 - tt) * (1.0 - tt);      // == rocketHeight()
      p = vec3(drift.x * tt, uApex * ease, drift.y * tt);
      alpha = (cycle < LAUNCH ? 1.0 : 0.0) * (1.0 - aSeed * 0.6);
      size = 1.6 + (1.0 - aSeed) * 2.0;
    } else {
      // burst spark: ballistic arc off the burst point (== sparkOffset())
      float ts = (cycle - LAUNCH) / LIVE;
      float alive = step(0.0, ts) * (1.0 - step(1.0, ts));
      float h1 = h(aSeed * 13.7), h2 = h(aSeed * 5.1), h3 = h(aSeed * 29.3);
      float theta = h1 * 6.2831853;
      float cp = h2 * 2.0 - 1.0;
      float sp = sqrt(max(0.0, 1.0 - cp * cp));
      float speed = 3.2 + 3.4 * h3;
      float tSec = max(ts, 0.0) * LIVE;
      p = vec3(drift.x, uApex, drift.y) + vec3(
        sp * cos(theta) * speed * tSec,
        cp * speed * tSec - 0.5 * G * tSec * tSec,
        sp * sin(theta) * speed * tSec);
      // fade == sparkFade(): snap on, hold, gutter to 0 by end of life
      float fade = smoothstep(0.0, 0.08, ts) * (1.0 - smoothstep(0.5, 1.0, ts));
      alpha = fade * alive;
      size = 0.8 + (1.0 - clamp(ts, 0.0, 1.0)) * 3.0;
    }
    alpha *= uNight;
    vAlpha = alpha;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = alpha <= 0.001 ? 0.0 : max(1.0, size * (300.0 / -mv.z));
  }
`;

const FW_FRAG = `
  precision highp float;
  varying float vAlpha;
  varying float vTint;
  varying float vRole;
  void main(){
    if (vAlpha <= 0.004) discard;
    vec2 d = gl_PointCoord - vec2(0.5);
    float r = length(d);
    if (r > 0.5) discard;
    float soft = smoothstep(0.5, 0.0, r);
    // warm golds an' reds mostly, the odd white-hot spark; streaks run white-gold
    vec3 gold  = vec3(1.0, 0.72, 0.25);
    vec3 red   = vec3(1.0, 0.28, 0.10);
    vec3 white = vec3(1.0, 0.95, 0.82);
    vec3 col = mix(gold, red, smoothstep(0.45, 0.75, vTint));
    col = mix(col, white, smoothstep(0.86, 0.96, vTint));
    col = mix(col, white, 1.0 - step(0.5, vRole)); // ascent streak burns white-gold
    // ×1.5 shoves the core over the 0.85 bloom threshold under 'Fine'
    gl_FragColor = vec4(col * 1.5 * soft * vAlpha, soft * vAlpha);
  }
`;

// Build one pooled firework launch site. Caller positions the Points at the
// launch pale (ground level, near the bonfire) an' pushes it to ctx.objects as a
// ROOT. Push an fx callback that feeds uNight from nightFactor() each frame.
export function makeFireworks(opts = {}) {
  const seed = opts.seed || 0;
  const total = FIREWORK_STREAK + FIREWORK_SPARKS;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(total * 3), 3));
  const seeds = new Float32Array(total), roles = new Float32Array(total), tints = new Float32Array(total);
  for (let i = 0; i < FIREWORK_STREAK; i++) {
    seeds[i] = (i + 0.5) / FIREWORK_STREAK; roles[i] = 0; tints[i] = 0;
  }
  for (let i = 0; i < FIREWORK_SPARKS; i++) {
    const j = FIREWORK_STREAK + i;
    seeds[j] = (i + 0.5) / FIREWORK_SPARKS;
    roles[j] = 1;
    tints[j] = hash1(seed * 31.7 + i * 2.13);
  }
  g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  g.setAttribute('aRole', new THREE.BufferAttribute(roles, 1));
  g.setAttribute('aTint', new THREE.BufferAttribute(tints, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime:   { value: 0 },
      uNight:  { value: 0 },
      uPhase:  { value: hash1(seed * 3.3) },
      uPeriod: { value: 4 + hash1(seed * 7.9) * 4 }, // one rocket every 4–8 s
      uApex:   { value: 9 + hash1(seed * 17.2) * 4 },
    },
    vertexShader: FW_VERT,
    fragmentShader: FW_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false; // the shader throws sparks well off the origin
  pts.userData.wow = 'fireworks';
  pts.userData.sparkCount = FIREWORK_SPARKS;
  registerFxMat(mat);
  pts.dispose = () => unregisterFxMat(mat); // clear()'s traverse frees geo + mat
  return pts;
}

// --- drifting motes (midsummer gold / harvest chaff) ------------------------------
// A pooled Points cloud looping up through a soft cylinder of air. uGate scales
// visibility 0..1 — midsummer feeds it nightFactor() (evening air), harvest feeds
// 1 - nightFactor() (chaff by day). GPU-animated; CPU pokes uGate only.
const MOTE_VERT = `
  attribute float aSeed;
  uniform float uTime;
  uniform float uGate;     // 0 hidden .. 1 full — time-of-day gate
  uniform float uRadius;
  uniform float uHeight;
  uniform float uSpeed;
  uniform float uSize;
  varying float vAlpha;
  float h(float n){ return fract(sin(n * 78.233) * 43758.5453); }
  void main(){
    float t = fract(uTime * uSpeed * 0.05 + aSeed);
    float ang = aSeed * 6.2831 + uTime * 0.08;
    float rad = uRadius * (0.15 + 0.85 * h(aSeed * 3.3));
    float px = cos(ang) * rad + sin(uTime * 0.6 + aSeed * 9.0) * 0.5;
    float pz = sin(ang) * rad + cos(uTime * 0.5 + aSeed * 6.0) * 0.5;
    float py = t * uHeight;
    vAlpha = uGate * sin(t * 3.14159) * (0.35 + 0.65 * h(aSeed * 7.7));
    vec4 mv = modelViewMatrix * vec4(px, py, pz, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = vAlpha <= 0.002 ? 0.0 : max(1.0, uSize * (300.0 / -mv.z));
  }
`;

const MOTE_FRAG = `
  precision highp float;
  uniform vec3 uColor;
  varying float vAlpha;
  void main(){
    if (vAlpha <= 0.004) discard;
    vec2 d = gl_PointCoord - vec2(0.5);
    float r = length(d);
    if (r > 0.5) discard;
    float soft = smoothstep(0.5, 0.0, r);
    gl_FragColor = vec4(uColor * 1.2 * soft * vAlpha, soft * vAlpha);
  }
`;

export function makeDriftMotes(opts = {}) {
  const count = Math.min(opts.count || 60, 90); // hard cap — pooled once
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) seeds[i] = (i + 0.5) / count;
  g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime:   { value: 0 },
      uGate:   { value: 0 },
      uRadius: { value: opts.radius || 6 },
      uHeight: { value: opts.height || 4 },
      uSpeed:  { value: opts.speed || 1 },
      uSize:   { value: opts.size || 2.2 },
      uColor:  { value: new THREE.Color(opts.color != null ? opts.color : 0xffcf6a) },
    },
    vertexShader: MOTE_VERT,
    fragmentShader: MOTE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.userData.wow = 'motes';
  pts.userData.moteCount = count;
  registerFxMat(mat);
  pts.dispose = () => unregisterFxMat(mat);
  return pts;
}

// --- lantern strings (Christmastide) ----------------------------------------------
// A catenary line of small emissive lanterns strung between two points (building
// eaves near the parish tree). Emissive Lambert pops the bloom under 'Fine'.
// Gentle sway is a handful of CPU position writes per frame via group.swayTick(t)
// — the caller pushes `t => group.swayTick(t)` into ctx.fx.
export const LANTERNS_MAX = 9;
export function makeLanternString(p0, p1, opts = {}) {
  const group = new THREE.Group();
  const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
  const dist = Math.hypot(dx, dy, dz);
  const sag = opts.sag != null ? opts.sag : Math.max(0.5, dist * 0.07);
  const n = Math.max(3, Math.min(LANTERNS_MAX, opts.count || Math.round(dist / 1.7)));

  // the rope: a sagging Line through 17 samples
  const ROPE_SAMPLES = 17;
  const ropePos = new Float32Array(ROPE_SAMPLES * 3);
  for (let i = 0; i < ROPE_SAMPLES; i++) {
    const t = i / (ROPE_SAMPLES - 1);
    ropePos[i * 3]     = p0.x + dx * t;
    ropePos[i * 3 + 1] = p0.y + dy * t + sagY(t, sag);
    ropePos[i * 3 + 2] = p0.z + dz * t;
  }
  const ropeGeo = new THREE.BufferGeometry();
  ropeGeo.setAttribute('position', new THREE.BufferAttribute(ropePos, 3));
  const rope = new THREE.Line(ropeGeo, new THREE.LineBasicMaterial({ color: 0x1d1611 }));
  rope.frustumCulled = false;
  group.add(rope);

  // the lanterns: one shared geometry + ONE shared warm-emissive material per
  // string (clear()'s traverse disposes them; re-dispose is idempotent).
  const lampGeo = new THREE.BoxGeometry(0.16, 0.22, 0.16);
  const lampMat = new THREE.MeshLambertMaterial({
    color: 0x2c1d10,
    emissive: new THREE.Color(0xffa845),
    emissiveIntensity: 2.2, // over the 0.85 bloom threshold — the cheap wow
  });
  const lamps = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const m = new THREE.Mesh(lampGeo, lampMat);
    m.position.set(p0.x + dx * t, p0.y + dy * t + sagY(t, sag) - 0.16, p0.z + dz * t);
    m.userData.baseX = m.position.x;
    m.userData.baseZ = m.position.z;
    m.userData.phase = i * 1.37 + (opts.seed || 0) * 6.28;
    group.add(m);
    lamps.push(m);
  }
  group.userData.wow = 'lanternString';
  group.userData.lanternCount = n;
  // gentle sway: tiny lateral drift, per-lantern phase — n position writes/frame
  group.swayTick = (t) => {
    for (let i = 0; i < lamps.length; i++) {
      const m = lamps[i];
      m.position.x = m.userData.baseX + Math.sin(t * 1.15 + m.userData.phase) * 0.05;
      m.position.z = m.userData.baseZ + Math.cos(t * 0.9 + m.userData.phase) * 0.04;
    }
  };
  return group;
}

// --- bunting (May Day) --------------------------------------------------------------
// A sagging line of triangular flags in period colours. Static (the joyful shape
// is the sag + the colours); one geometry for the whole run, vertex-coloured.
export const BUNTING_FLAGS_MAX = 16;
export function makeBunting(p0, p1, colors, opts = {}) {
  const group = new THREE.Group();
  const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
  const dist = Math.hypot(dx, dy, dz);
  const sag = opts.sag != null ? opts.sag : Math.max(0.35, dist * 0.06);
  const n = Math.max(4, Math.min(BUNTING_FLAGS_MAX, Math.round(dist / 0.9)));

  const ropeGeo = new THREE.BufferGeometry();
  const ROPE_SAMPLES = 15;
  const ropePos = new Float32Array(ROPE_SAMPLES * 3);
  for (let i = 0; i < ROPE_SAMPLES; i++) {
    const t = i / (ROPE_SAMPLES - 1);
    ropePos[i * 3]     = p0.x + dx * t;
    ropePos[i * 3 + 1] = p0.y + dy * t + sagY(t, sag);
    ropePos[i * 3 + 2] = p0.z + dz * t;
  }
  ropeGeo.setAttribute('position', new THREE.BufferAttribute(ropePos, 3));
  const rope = new THREE.Line(ropeGeo, new THREE.LineBasicMaterial({ color: 0x3a2c1a }));
  rope.frustumCulled = false;
  group.add(rope);

  // one triangle per flag, all in one geometry with vertex colours
  const pos = new Float32Array(n * 9);
  const col = new Float32Array(n * 9);
  const c = new THREE.Color();
  const flagH = 0.55;
  for (let i = 0; i < n; i++) {
    const t0 = (i + 0.15) / n, t1 = (i + 0.85) / n, tm = (i + 0.5) / n;
    const ax = p0.x + dx * t0, ay = p0.y + dy * t0 + sagY(t0, sag), az = p0.z + dz * t0;
    const bx = p0.x + dx * t1, by = p0.y + dy * t1 + sagY(t1, sag), bz = p0.z + dz * t1;
    const mx = p0.x + dx * tm, my = p0.y + dy * tm + sagY(tm, sag) - flagH, mz = p0.z + dz * tm;
    pos.set([ax, ay, az, bx, by, bz, mx, my, mz], i * 9);
    c.set(colors[i % colors.length]);
    for (let v = 0; v < 3; v++) col.set([c.r, c.g, c.b], i * 9 + v * 3);
  }
  const flagGeo = new THREE.BufferGeometry();
  flagGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  flagGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  flagGeo.computeVertexNormals();
  const flags = new THREE.Mesh(flagGeo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  flags.frustumCulled = false;
  group.add(flags);

  group.userData.wow = 'bunting';
  group.userData.flagCount = n;
  return group;
}

// --- maypole ribbon streamers (May Day) ----------------------------------------------
// RIBBON_STREAMERS long thin strips streaming out an' wrapping round the pole,
// animated entirely in the vertex shader (uTime) — the JS mirror is ribbonPoint()
// above. Caller positions the mesh at the pole base an' pushes it as a ROOT.
export const RIBBON_STREAMERS = 6;
export const RIBBON_SEGMENTS = 14;

const RIBBON_VERT = `
  attribute float aRibbon;  // 0..1 — which ribbon (fraction of the ring)
  attribute float aT;       // 0..1 — root (pole top) .. tip (near ground)
  attribute float aSide;    // -1 / +1 — strip width side
  uniform float uTime;
  uniform float uTop;       // attach height on the pole
  uniform float uBase;      // swirl radius at the tip
  varying vec3 vColor;
  void main(){
    vColor = color * (1.05 - aT * 0.25); // tips shade a touch darker
    float a0 = aRibbon * 6.2831853;
    float ang = a0 + uTime * 0.5 + aT * 2.4;                       // wrap + twist
    float flutter = sin(uTime * 2.2 + aT * 9.0 + a0) * 0.25 * aT;  // breeze
    float r = mix(0.18, uBase, aT) + flutter * 0.3;
    float y = uTop * (1.0 - aT * 0.85) + sin(uTime * 1.7 + a0 + aT * 5.0) * 0.15 * aT;
    vec3 p = vec3(cos(ang) * r, y + aSide * 0.055, sin(ang) * r);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const RIBBON_FRAG = `
  precision highp float;
  varying vec3 vColor;
  void main(){ gl_FragColor = vec4(vColor, 1.0); }
`;

export function makeRibbonStreamers(opts = {}) {
  const topY  = opts.topY  != null ? opts.topY  : 6.3;
  const baseR = opts.baseR != null ? opts.baseR : 2.0;
  const colors = opts.colors || [0xcc2222, 0xeeeedd, 0x2255bb, 0xddcc22, 0x33aa44, 0xdd55aa];
  const nR = RIBBON_STREAMERS, nS = RIBBON_SEGMENTS;
  const vertsPerRibbon = (nS + 1) * 2;
  const total = nR * vertsPerRibbon;
  const pos = new Float32Array(total * 3);          // placeholder — shader positions
  const ribbonA = new Float32Array(total);
  const tA = new Float32Array(total);
  const sideA = new Float32Array(total);
  const colA = new Float32Array(total * 3);
  const idx = [];
  const c = new THREE.Color();
  for (let ri = 0; ri < nR; ri++) {
    c.set(colors[ri % colors.length]);
    for (let si = 0; si <= nS; si++) {
      for (let sd = 0; sd < 2; sd++) {
        const v = ri * vertsPerRibbon + si * 2 + sd;
        ribbonA[v] = ri / nR;
        tA[v] = si / nS;
        sideA[v] = sd === 0 ? -1 : 1;
        colA.set([c.r, c.g, c.b], v * 3);
      }
      if (si < nS) {
        const b = ri * vertsPerRibbon + si * 2;
        idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aRibbon', new THREE.BufferAttribute(ribbonA, 1));
  g.setAttribute('aT', new THREE.BufferAttribute(tA, 1));
  g.setAttribute('aSide', new THREE.BufferAttribute(sideA, 1));
  g.setAttribute('color', new THREE.BufferAttribute(colA, 3));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uTop: { value: topY }, uBase: { value: baseR } },
    vertexShader: RIBBON_VERT,
    fragmentShader: RIBBON_FRAG,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false; // shader swings the strips well off the placeholder bounds
  mesh.userData.wow = 'ribbons';
  mesh.userData.ribbonCount = nR;
  registerFxMat(mat);
  mesh.dispose = () => unregisterFxMat(mat);
  return mesh;
}

// --- shared helper: pair up nearby buildings for strung lines ------------------------
// Returns up to `max` [a, b] building pairs near a focus point, nearest-first,
// consecutive-neighbour pairing — the same idiom for lantern strings an' bunting.
export function nearbyBuildingPairs(v, fx, fz, max = 3, range = 18) {
  const near = (v.buildings || [])
    .map(b => ({ b, d: Math.hypot((b.x0 + b.x1) / 2 - fx, (b.z0 + b.z1) / 2 - fz) }))
    .filter(e => e.d <= range)
    .sort((a, b) => a.d - b.d)
    .map(e => e.b);
  const pairs = [];
  for (let i = 0; i + 1 < near.length && pairs.length < max; i++) pairs.push([near[i], near[i + 1]]);
  return pairs;
}
