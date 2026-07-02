// fire.js — a real animated flame for every torch, lantern, safety-lamp AN' the
// festival bonfire.
//
// The flame LOOK is the proven prototype (prototypes/fire.html): a domain-warped
// fBm turbulence carved into a multi-tongue bed, coloured through a blackbody
// ramp. Here it's ported FAITHFULLY into a three.js ShaderMaterial — the same
// hash/vnoise/fbm an' the same heat→colour ramp — wi' three changes for the world:
//   1. the VERTEX shader billboards the quad toward the camera (no per-frame CPU
//      rotation), offsetting the group centre in view space by the corner * size;
//   2. a per-vertex aSeed offsets the noise so two torches side by side don't
//      pulse in lockstep;
//   3. a per-vertex aBig (0/1) picks the FLAME PRESET — 0 collapses it to the
//      prototype's narrow "torch" tongue, 1 spreads it to the broad, chaotic
//      "bonfire" bed (PRESETS.bonfire frae the prototype). Both presets ride the
//      ONE shared material, resolved in-shader, so torches an' the bonfire animate
//      off the same uTime wi'out a second material.
//
// SINGLETON + GLOBAL TICK. There is exactly ONE flame ShaderMaterial for the
// whole game (getFlameMaterial(), lazy, module-level). It is shared by BOTH the
// FireLayer torches an' festival Fire() calls, an' it LIVES for the game — it is
// never disposed on world-reload (the shader program is persistent). tickFires(t)
// is called ONCE PER FRAME frae main.js: it advances the material's uTime, drives
// every hero fire's ember system, an' pulses the hero point-lights. Mirrors the
// sky-dome idiom in src/sky.js (a ShaderMaterial wi' a uTime uniform advanced each
// frame), but centralised so off-FireLayer fires animate too.
import * as THREE from 'three';

// --- the billboard quad -------------------------------------------------------
// Local space: x in [-0.5, 0.5] (width), y in [0, 1] (rises from the base at the
// group origin). vUv runs 0..1 over the quad — the fragment shader treats vUv.y
// as height an' vUv.x as the cross-flame axis, exactly like the prototype's
// full-screen quad. ASPECT bakes the quad's height:width so the flame body keeps
// the prototype's proportions once it's a world billboard (a torch flame is tall
// an' narrow, ~1.6:1).
const ASPECT = 0.62; // == prototype uAspect for a tall narrow flame (width/height)

// `big` (0|1) is baked into every vertex of the quad as aBig — picks the flame
// preset in-shader (0 = torch, 1 = bonfire). One number per quad; const per fire.
function flameQuad(seed, big) {
  const g = new THREE.BufferGeometry();
  // two tris; base edge at y=0, tip at y=1
  const pos = [
    -0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0,
    -0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0,
  ];
  const uv = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1];
  const seeds = new Array(6).fill(seed);
  const bigs = new Array(6).fill(big ? 1 : 0);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
  g.setAttribute('aBig', new THREE.Float32BufferAttribute(bigs, 1));
  return g;
}

// --- the shared flame material ------------------------------------------------
// ONE material is shared by every flame in the world. Never dispose it (it
// outlives every world). Only its render targets — the Fire groups' geometries —
// are disposed.
//
// VERTEX: billboard. The group's centre (local origin) is transformed to view
// space, then the quad corner is added in view space (× per-instance scale) so
// the quad always faces the camera, upright, rising from the centre. vUv + aSeed
// + aBig pass through to the fragment.
//
// FRAGMENT: the prototype flame body. The slider params are no longer baked as
// constants — they're resolved per-fragment by mixing the torch preset an' the
// bonfire preset on aBig, so the same material draws both a narrow torch tongue
// an' a broad chaotic bonfire bed.
const VERT = `
  attribute float aSeed;
  attribute float aBig;
  varying vec2 vUv;
  varying float vSeed;
  varying float vBig;
  void main() {
    vUv = uv;
    vSeed = aSeed;
    vBig = aBig;
    // billboard: take the mesh origin into view space, then offset by the quad
    // corner so the quad always faces the camera, upright. Per-mesh size comes
    // from the model matrix's x/y scale columns (so each Fire's group/mesh scale
    // is honoured an' there's no shared size uniform). position.x in [-0.5,0.5],
    // position.y in [0,1] => the flame hangs off the origin an' licks upward.
    vec2 mscale = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
    vec4 centre = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    centre.xy += position.xy * mscale;
    gl_Position = projectionMatrix * centre;
  }
`;

// Faithful port of prototypes/fire.html FRAG. The uniforms that were sliders in
// the prototype are resolved per-fragment by mix(torch, bonfire, vBig) — the two
// presets are PRESETS.torch an' PRESETS.bonfire frae the prototype, baked here as
// const pairs. Only uTime + the per-vertex seed/big vary across draws.
const FRAG = `
  precision highp float;
  varying vec2 vUv;
  varying float vSeed;
  varying float vBig;
  uniform float uTime;

  // PRESETS.torch (narrow single tongue) an' PRESETS.bonfire (broad chaotic bed),
  // verbatim frae the prototype. vBig (0|1) mixes between them — a torch resolves
  // to the torch numbers, the bonfire to the bonfire numbers.
  const float uAspect = ${ASPECT.toFixed(2)};
  //                        torch   bonfire
  const float uScaleA     = 4.5,  uScaleB     = 3.2;
  const float uSpeedA     = 1.5,  uSpeedB     = 1.15;
  const float uChaosA     = 1.0,  uChaosB     = 2.3;
  const float uHeightA    = 0.85, uHeightB    = 0.98;
  const float uBaseWidthA = 0.14, uBaseWidthB = 0.58;
  const float uTonguesA   = 2.5,  uTonguesB   = 8.0;
  const float uIntensityA = 1.9,  uIntensityB = 1.8;
  const float uTempA      = 1.0,  uTempB      = 1.12;
  const float uSwayA      = 0.7,  uSwayB      = 0.5;

  float hash(vec2 p){ p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }
  float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    float a = hash(i), b = hash(i + vec2(1.0,0.0)), c = hash(i + vec2(0.0,1.0)), d = hash(i + vec2(1.0,1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
  }
  float fbm(vec2 p){
    float s = 0.0, a = 0.55;
    for (int i = 0; i < 5; i++){ s += a * vnoise(p); p = p * 2.02 + 7.0; a *= 0.5; }
    return s;
  }

  void main(){
    // resolve the preset for this fragment (torch ↔ bonfire on vBig)
    float uScale     = mix(uScaleA,     uScaleB,     vBig);
    float uSpeed     = mix(uSpeedA,     uSpeedB,     vBig);
    float uChaos     = mix(uChaosA,     uChaosB,     vBig);
    float uHeight    = mix(uHeightA,    uHeightB,    vBig);
    float uBaseWidth = mix(uBaseWidthA, uBaseWidthB, vBig);
    float uTongues   = mix(uTonguesA,   uTonguesB,   vBig);
    float uIntensity = mix(uIntensityA, uIntensityB, vBig);
    float uTemp      = mix(uTempA,      uTempB,      vBig);
    float uSway      = mix(uSwayA,      uSwayB,      vBig);

    // per-flame desync: shove every noise lookup by a seed-derived offset so two
    // neighbouring torches writhe out of step.
    vec2 so = vec2(vSeed * 7.13, vSeed * 3.71);

    float y = vUv.y;
    float x = (vUv.x - 0.5) * uAspect;
    x += uSway * 0.05 * sin(uTime * 1.7 + y * 3.0 + vSeed) * y;

    // bed across the flame's width, narrowing only slightly with height
    float halfW = uBaseWidth * (1.0 - y * 0.18);
    float inX = smoothstep(halfW, halfW * 0.45, abs(x));

    // per-column reach: noise across x (scrolling, so tongues writhe)
    float colN = fbm(vec2(x * uTongues + 13.0 + so.x, uTime * uSpeed * 0.7 + so.y));
    float reach = uHeight * (0.30 + 1.25 * colN);
    float vert = smoothstep(reach, reach * 0.22, y) * smoothstep(0.0, 0.06, y);

    // fine turbulence, domain-warped, scrolling upward
    vec2 q = vec2(vUv.x * uScale, vUv.y * uScale - uTime * uSpeed) + so;
    vec2 w = vec2(fbm(q + vec2(0.0, uTime * uSpeed * 0.6)), fbm(q + vec2(5.2, 1.3)));
    float n = fbm(q + uChaos * w);

    float heat = inX * vert * (0.45 + 0.95 * n);
    heat = clamp(heat * uIntensity, 0.0, 1.0);
    heat *= smoothstep(0.05, 0.24, heat);

    vec3 col = mix(vec3(0.0),  vec3(0.55, 0.04, 0.0), smoothstep(0.0,  0.22, heat));
    col      = mix(col,        vec3(1.0,  0.32, 0.02), smoothstep(0.18, 0.5,  heat));
    col      = mix(col,        vec3(1.0,  0.78, 0.22), smoothstep(0.5,  0.8,  heat));
    col      = mix(col,        vec3(1.0,  0.96, 0.82), smoothstep(0.84, 1.0,  heat));
    col *= uTemp;

    float alpha = smoothstep(0.02, 0.2, heat);
    gl_FragColor = vec4(col * alpha, alpha);
  }
`;

// --- the ONE shared flame material (module singleton) -------------------------
// Built lazily, reused by every fire in the game, NEVER disposed. Additive + no
// depth-write so flames glow an' never occlude owt behind them (sky.js domeMat
// uses the same depthWrite:false idiom).
let _flameMat = null;
export function getFlameMaterial() {
  if (!_flameMat) {
    _flameMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
  }
  return _flameMat;
}

// Back-compat alias: callers (an' the headless test) historically called
// makeFlameMaterial(). It now returns the SAME singleton — one material per
// process is the whole point. `.shared` still exposes the instance for the test's
// material-identity assertion.
export function makeFlameMaterial() { return getFlameMaterial(); }
Object.defineProperty(makeFlameMaterial, 'shared', { get: () => _flameMat });

// --- hero registries (driven by tickFires) ------------------------------------
// Hero fires (the bonfire) add an ember Points an' a point-light. They register
// here so the ONE global tick animates them; the Fire group's dispose() pulls its
// own entries back out. CPU per-frame work is nil — embers animate GPU-side; the
// light is a single intensity write.
const _emberMats = []; // ShaderMaterials wi' a uTime uniform (ember + smoke plumes)
const _heroLights = []; // { light, base } — pulsed about `base` intensity

// --- external FX registration ---------------------------------------------------
// Festival FX (fireworks, drifting motes, maypole ribbons — see festivalKit.js)
// are GPU-animated ShaderMaterials wi' a uTime uniform, exactly like the embers.
// They register here so the ONE global tick drives them too; their owners MUST
// unregister on dispose (SeasonalLayer teardown) or the registry leaks.
export function registerFxMat(mat) {
  if (mat && mat.uniforms && mat.uniforms.uTime && _emberMats.indexOf(mat) < 0) _emberMats.push(mat);
}
export function unregisterFxMat(mat) { removeFrom(_emberMats, mat); }
// registry size — used by the headless teardown test (verify-festivalwow) to
// assert zero orphans after a SeasonalLayer.clear().
export function fxMatCount() { return _emberMats.length; }

// --- ember particle system ----------------------------------------------------
// A capped (~EMBER_COUNT) THREE.Points of additive warm motes that rise off the
// bed an' recycle, animated ENTIRELY GPU-side: the vertex shader derives each
// mote's life frae uTime + a per-point seed, lifts it up its lane an' shrinks it,
// the fragment fades warm-orange → transparent over life. No per-frame CPU loop —
// tickFires only pokes uTime.
const EMBER_COUNT = 40;
// The taller EMBER COLUMN (Bonfire Night / Midsummer under 'Fine'): same pooled
// shader, more motes, a narrower lane spread an' a much taller rise — a spark
// column that rides the bloom. Capped; allocated once per fire; GPU-animated.
const EMBER_COLUMN_COUNT = 70;

const EMBER_VERT = `
  attribute float aSeed;   // 0..1 per mote — phase + lane + lifespan jitter
  uniform float uTime;
  uniform float uScale;    // fire scale (blocks) — sizes the spread + rise height
  uniform float uRise;     // rise-height multiplier (1 = bed embers, ~2.6 = column)
  uniform float uSpread;   // lane-radius multiplier (1 = bed, ~0.55 = tight column)
  varying float vLife;     // 0..1 along this mote's current life (for the fade)
  // cheap 1D hash for per-mote lane offsets
  float h(float n){ return fract(sin(n * 78.233) * 43758.5453); }
  void main(){
    float seed = aSeed;
    float life = h(seed * 11.1);          // 0.5..1.5s lifespans, varied
    float dur  = (0.9 + life) * (0.7 + 0.3 * uRise); // column motes live a touch longer
    // each mote loops on its own phase; t in [0,1) is its progress this cycle
    float t = fract(uTime / dur + seed);
    vLife = t;
    // lane: a fixed-ish x/z drift per mote, widening a touch as it climbs
    float ang = seed * 6.2831;
    float rad = (0.10 + 0.22 * h(seed * 3.7)) * uScale * (0.4 + 0.8 * t) * uSpread;
    float px = cos(ang) * rad + sin(uTime * 1.3 + seed * 10.0) * 0.04 * uScale;
    float pz = sin(ang) * rad + cos(uTime * 1.1 + seed * 7.0) * 0.04 * uScale;
    float py = (0.2 + t * (1.1 + 0.6 * h(seed * 5.3))) * uScale * uRise; // rises up its lane
    vec4 mv = modelViewMatrix * vec4(px, py, pz, 1.0);
    gl_Position = projectionMatrix * mv;
    // shrink with life + distance; bigger fires throw bigger embers
    float sz = (1.0 - t) * (2.2 + 2.0 * uScale);
    gl_PointSize = max(1.0, sz * (300.0 / -mv.z));
  }
`;

const EMBER_FRAG = `
  precision highp float;
  varying float vLife;
  void main(){
    // round soft mote
    vec2 d = gl_PointCoord - vec2(0.5);
    float r = length(d);
    if (r > 0.5) discard;
    float soft = smoothstep(0.5, 0.0, r);
    // warm orange cooling toward red as it ages, fading out at both ends of life
    vec3 col = mix(vec3(1.0, 0.62, 0.18), vec3(0.9, 0.18, 0.04), vLife);
    float fade = smoothstep(0.0, 0.12, vLife) * (1.0 - smoothstep(0.6, 1.0, vLife));
    gl_FragColor = vec4(col, soft * fade * 0.9);
  }
`;

function makeEmbers(scale, opts = {}) {
  const count  = opts.count  || EMBER_COUNT;
  const rise   = opts.rise   != null ? opts.rise   : 1.0;
  const spread = opts.spread != null ? opts.spread : 1.0;
  const g = new THREE.BufferGeometry();
  // all points sit at the origin in attribute space; the vertex shader places
  // them — so geometry is just a seed per point (position is a required attr).
  const pos = new Float32Array(count * 3); // all zero
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) seeds[i] = (i + 0.5) / count;
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: scale }, uRise: { value: rise }, uSpread: { value: spread } },
    vertexShader: EMBER_VERT,
    fragmentShader: EMBER_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false; // the shader places the motes — static bounds would cull them wrongly
  pts.userData.emberMat = mat;
  pts.userData.emberGeo = g;
  return pts;
}

// --- smoke plume --------------------------------------------------------------
// A couple of large soft grey quads stacked above the flame that drift, rise an'
// fade on uTime. Kept subtle (low alpha). Billboards toward the camera the same
// way the flame does. GPU-animated; tickFires only pokes uTime.
const SMOKE_VERT = `
  attribute float aLayer;  // 0..1 — which puff in the stack (phase + base height)
  uniform float uTime;
  uniform float uScale;
  varying vec2 vUv;
  varying float vLayer;
  void main(){
    vUv = uv;
    vLayer = aLayer;
    // rise + recycle on a per-layer phase; a slow lateral sway as it climbs
    float t = fract(uTime * 0.10 + aLayer);
    float rise = (0.9 + t * 2.4) * uScale;           // climbs well above the flame
    float sway = sin(uTime * 0.5 + aLayer * 6.28) * 0.18 * uScale * t;
    float grow = (0.6 + 1.1 * t);                    // billows wider as it rises
    vec2 mscale = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz)) * grow;
    vec4 centre = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    centre.xy += position.xy * mscale;
    centre.x  += sway;
    centre.y  += rise;
    gl_Position = projectionMatrix * centre;
  }
`;

const SMOKE_FRAG = `
  precision highp float;
  varying vec2 vUv;
  varying float vLayer;
  uniform float uTime;
  void main(){
    vec2 d = vUv - vec2(0.5);
    float r = length(d);
    float soft = smoothstep(0.5, 0.08, r);       // soft round puff
    float t = fract(uTime * 0.10 + vLayer);
    // fade in low, thin out as it rises an' disperses
    float fade = smoothstep(0.0, 0.2, t) * (1.0 - smoothstep(0.55, 1.0, t));
    float a = soft * fade * 0.16;                 // subtle
    gl_FragColor = vec4(vec3(0.32, 0.30, 0.29), a);
  }
`;

const SMOKE_PUFFS = 3;

function makeSmoke(scale) {
  // one quad per puff, stacked; each puff is a layer 0..1 (phase offset)
  const pos = [], uv = [], layer = [], idx = [];
  for (let p = 0; p < SMOKE_PUFFS; p++) {
    const b = p * 4;
    // a unit quad centred on origin (size carried by model scale × grow in-shader)
    pos.push(-0.7, 0, 0, 0.7, 0, 0, 0.7, 1.4, 0, -0.7, 1.4, 0);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    const l = (p + 0.5) / SMOKE_PUFFS;
    layer.push(l, l, l, l);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aLayer', new THREE.Float32BufferAttribute(layer, 1));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: scale } },
    vertexShader: SMOKE_VERT,
    fragmentShader: SMOKE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending, // grey smoke darkens, not additive
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false; // shader lifts the quads above their static bounds
  mesh.userData.smokeMat = mat;
  mesh.userData.smokeGeo = g;
  return mesh;
}

// --- a single fire ------------------------------------------------------------
// A THREE.Group of `layers` billboard quads on the ONE shared flame material,
// sized by `scale`. The caller positions the group at the fire's world coords
// (block top). Stacking a few layers (different seeds) reads as a fuller, deeper
// flame; a torch is happy wi' one.
//
// opts:
//   scale    world size of the flame (height in blocks; width follows ASPECT)
//   layers   how many billboard quads (1 = a torch tongue)
//   seed     desync seed, baked into aSeed (FireLayer hashes it from position)
//   big      use the BROAD/CHAOTIC bonfire preset (else the narrow torch preset).
//            Auto-on for big flames (scale ≥ 1.5) so a bonfire reads right even if
//            the caller forgets the flag; torches stay small/narrow.
//   embers  } HERO features — only big fires use them. embers: a rising-ember
//   smoke   } Points; smoke: a soft drifting plume; light: one warm pulsed
//   light   } PointLight. All GPU-animated off the shared tick (no CPU loop).
//   column   a SECOND, taller+tighter ember stream (the 'Fine'-quality spark
//            column that rides the bloom). Pooled at EMBER_COLUMN_COUNT motes.
//   material the shared flame material to render on. Defaults to the singleton;
//            FireLayer passes the same singleton explicitly.
export function Fire(opts = {}) {
  const {
    scale = 0.3,
    layers = 1,
    seed = 0,
    material = null,
    embers = false,
    smoke = false,
    light = false,
    column = false,
  } = opts;
  // a big flame either asks for it, or is simply large
  const big = opts.big != null ? !!opts.big : scale >= 1.5;

  const mat = material || getFlameMaterial();
  const group = new THREE.Group();
  const geoms = [];
  for (let i = 0; i < layers; i++) {
    // each layer gets its own slight seed nudge so stacked quads don't overlap
    // identically; a single-layer torch just uses `seed`.
    const g = flameQuad(seed + i * 0.37, big);
    geoms.push(g);
    const m = new THREE.Mesh(g, mat);
    m.userData.sharedMaterial = true; // never dispose the shared flame material
    m.scale.setScalar(scale);
    // depth for a multi-layer flame comes from each layer's different seed (above)
    // — distinct tongue shapes — not geometry: the billboard always faces camera,
    // so co-planar quads with the same seed would just overdraw identically.
    group.add(m);
  }
  // each mesh's scale sets the flame's world size: the billboard vertex shader
  // reads it from the model matrix, so no shared size uniform is needed.
  group.userData.fireScale = scale;
  group.userData.big = big;

  // -- hero features (big fires only) --
  let emberPts = null, smokeMesh = null, pointLight = null, columnPts = null;
  if (embers) {
    emberPts = makeEmbers(scale);
    group.add(emberPts);
    _emberMats.push(emberPts.userData.emberMat); // registered for the global tick
  }
  if (column) {
    // the tall spark column: more motes, tighter lanes, ~2.6× the rise — under
    // 'Fine' (ACES + bloom) the additive motes glow like true fire-sparks.
    columnPts = makeEmbers(scale, { count: EMBER_COLUMN_COUNT, rise: 2.6, spread: 0.55 });
    columnPts.userData.emberColumn = true;
    group.add(columnPts);
    _emberMats.push(columnPts.userData.emberMat);
  }
  if (smoke) {
    smokeMesh = makeSmoke(scale);
    group.add(smokeMesh);
    _emberMats.push(smokeMesh.userData.smokeMat);
  }
  if (light) {
    // one warm point-light — the world's MeshLambert responds to it. Range/
    // intensity scale with the fire; tickFires pulses it about `base`.
    const base = 1.6 + scale * 0.5;
    pointLight = new THREE.PointLight(0xffa64a, base, 10 + scale * 6, 2);
    pointLight.position.set(0, scale * 0.6, 0); // sit it in the flame body
    group.add(pointLight);
    _heroLights.push({ light: pointLight, base });
  }

  // Free this group's hero geometries + drop its registry entries + remove its
  // light. NEVER the shared flame material (it outlives every fire).
  group.dispose = () => {
    for (const g of geoms) g.dispose();
    geoms.length = 0;
    if (emberPts) {
      emberPts.userData.emberGeo.dispose();
      emberPts.userData.emberMat.dispose();
      removeFrom(_emberMats, emberPts.userData.emberMat);
      emberPts = null;
    }
    if (columnPts) {
      columnPts.userData.emberGeo.dispose();
      columnPts.userData.emberMat.dispose();
      removeFrom(_emberMats, columnPts.userData.emberMat);
      columnPts = null;
    }
    if (smokeMesh) {
      smokeMesh.userData.smokeGeo.dispose();
      smokeMesh.userData.smokeMat.dispose();
      removeFrom(_emberMats, smokeMesh.userData.smokeMat);
      smokeMesh = null;
    }
    if (pointLight) {
      group.remove(pointLight);
      removeLight(_heroLights, pointLight);
      pointLight = null;
    }
  };
  return group;
}

function removeFrom(arr, v) { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); }
function removeLight(arr, light) { const i = arr.findIndex(e => e.light === light); if (i >= 0) arr.splice(i, 1); }

// --- the global tick ----------------------------------------------------------
// Call ONCE PER FRAME frae main.js wi' a rising clock `t` (seconds). Advances the
// shared flame material, every live ember/smoke material, an' pulses every hero
// point-light about its base intensity. This is the SOLE driver of flame uTime in
// the game — FireLayer no longer ticks (its torches ride this), so off-FireLayer
// fires (the festival bonfire) animate too.
export function tickFires(t) {
  const mat = getFlameMaterial();
  mat.uniforms.uTime.value = t;
  for (let i = 0; i < _emberMats.length; i++) _emberMats[i].uniforms.uTime.value = t;
  for (let i = 0; i < _heroLights.length; i++) {
    const e = _heroLights[i];
    // a quick warm flicker + a slow breathe, summed — reads as a living fire
    const flick = 0.85 + 0.15 * Math.sin(t * 11.0 + i * 2.3) + 0.08 * Math.sin(t * 27.0 + i);
    e.light.intensity = e.base * flick;
  }
}

// Advance the shared flame material only. Kept for back-compat (FireLayer's old
// per-frame call an' the headless test). Prefer tickFires(t) — it drives embers
// an' lights too. `material` is honoured if passed, else the singleton.
export function tickFlame(material, t) {
  (material || getFlameMaterial()).uniforms.uTime.value = t;
}
