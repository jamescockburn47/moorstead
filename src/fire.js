// fire.js — a real animated flame for every torch, lantern an' safety-lamp.
//
// The flame LOOK is the proven prototype (prototypes/fire.html): a domain-warped
// fBm turbulence carved into a multi-tongue bed, coloured through a blackbody
// ramp. Here it's ported FAITHFULLY into a three.js ShaderMaterial — the same
// hash/vnoise/fbm an' the same heat→colour ramp — wi' two changes for the world:
//   1. the VERTEX shader billboards the quad toward the camera (no per-frame CPU
//      rotation), offsetting the group centre in view space by the corner * size;
//   2. a per-vertex aSeed offsets the noise so two torches side by side don't
//      pulse in lockstep.
// The in-game flames are torch/lantern-sized — one small narrow tongue — so the
// prototype's "torch" preset constants are baked straight into the GLSL. The
// broad chaotic bonfire is the same shader wi' wider params; that lands wi' the
// bonfire in Slice 7.
//
// Mirrors the sky-dome idiom in src/sky.js: a ShaderMaterial wi' a uTime uniform
// advanced each frame (here by tickFlame, called from FireLayer).
import * as THREE from 'three';

// --- the billboard quad -------------------------------------------------------
// Local space: x in [-0.5, 0.5] (width), y in [0, 1] (rises from the base at the
// group origin). vUv runs 0..1 over the quad — the fragment shader treats vUv.y
// as height an' vUv.x as the cross-flame axis, exactly like the prototype's
// full-screen quad. ASPECT bakes the quad's height:width so the flame body keeps
// the prototype's proportions once it's a world billboard (a torch flame is tall
// an' narrow, ~1.6:1).
const ASPECT = 0.62; // == prototype uAspect for a tall narrow flame (width/height)

function flameQuad(seed) {
  const g = new THREE.BufferGeometry();
  // two tris; base edge at y=0, tip at y=1
  const pos = [
    -0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0,
    -0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0,
  ];
  const uv = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1];
  const seeds = new Array(6).fill(seed);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
  return g;
}

// --- the shared flame material ------------------------------------------------
// ONE material is shared by every flame in the world (FireLayer owns it). Never
// dispose it from a Fire group — only its geometries.
//
// VERTEX: billboard. The group's centre (local origin) is transformed to view
// space, then the quad corner is added in view space (× per-instance uSize) so
// the quad always faces the camera, upright, rising from the centre. vUv + aSeed
// pass through to the fragment.
//
// FRAGMENT: the prototype flame body, torch preset baked as constants.
const VERT = `
  attribute float aSeed;
  varying vec2 vUv;
  varying float vSeed;
  void main() {
    vUv = uv;
    vSeed = aSeed;
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
// the prototype are frozen to the "torch" preset (a single narrow tongue); only
// uTime + the per-vertex seed vary. ASPECT/sway/etc. match the torch numbers.
const FRAG = `
  precision highp float;
  varying vec2 vUv;
  varying float vSeed;
  uniform float uTime;

  // torch preset (== PRESETS.torch in the prototype)
  const float uScale     = 4.5;
  const float uSpeed     = 1.5;
  const float uChaos     = 1.0;
  const float uHeight    = 0.85;
  const float uBaseWidth = 0.14;
  const float uTongues   = 2.5;
  const float uIntensity = 1.9;
  const float uTemp      = 1.0;
  const float uAspect    = ${ASPECT.toFixed(2)};
  const float uSway      = 0.7;

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

// Build the ONE shared flame material. Additive + no depth-write so flames glow
// an' never occlude owt behind them (sky.js domeMat uses the same depthWrite:false
// idiom). The caller (FireLayer) keeps a single instance an' ticks its uTime.
export function makeFlameMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

// A single fire: a THREE.Group of `layers` billboard quads on the ONE shared
// flame material, sized by `scale`. The caller positions the group at the fire's
// world coords (block top). Stacking a few layers (different seeds) reads as a
// fuller, deeper flame; a torch is happy wi' one.
//
// opts:
//   scale    world size of the flame (height in blocks; width follows ASPECT)
//   layers   how many billboard quads (1 = a torch tongue)
//   seed     desync seed, baked into aSeed (FireLayer hashes it from position)
//   material the shared flame material to render on. FireLayer passes ITS material
//            (the one it ticks each frame); omitted (e.g. the headless test) we
//            fall back to a module singleton so every quad still lands on a
//            ShaderMaterial. One material per process is the point, not a global.
//   embers  } Slice 7 hooks — see below. No-ops now (YAGNI): the bonfire wires
//   smoke   } the ember/smoke particle systems an' the flickering point-light
//   light   } when it first needs them. Kept in the signature so call sites set.
export function Fire(opts = {}) {
  const {
    scale = 0.3,
    layers = 1,
    seed = 0,
    material = null,
    embers = false, // Slice 7: ember particle puffs rising off the bed — not built (YAGNI)
    smoke = false,  // Slice 7: a thin smoke plume above a big fire — not built (YAGNI)
    light = false,  // Slice 7: a flickering THREE.PointLight on the bonfire — not built (YAGNI)
  } = opts;

  const mat = material || sharedMaterial();
  const group = new THREE.Group();
  const geoms = [];
  for (let i = 0; i < layers; i++) {
    // each layer gets its own slight seed nudge so stacked quads don't overlap
    // identically; a single-layer torch just uses `seed`.
    const g = flameQuad(seed + i * 0.37);
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
  group.userData.embers = embers; // Slice 7 hook (no-op)
  group.userData.smoke = smoke;   // Slice 7 hook (no-op)
  group.userData.light = light;   // Slice 7 hook (no-op)

  // Free this group's geometries. NEVER the shared material (it outlives every
  // fire — FireLayer owns its lifetime).
  group.dispose = () => {
    for (const g of geoms) g.dispose();
    geoms.length = 0;
  };
  return group;
}

// Advance the flame animation. Called every frame by FireLayer wi' a rising t.
// (Mirrors how sky.js pokes domeMat.uniforms.uTime.value each frame.)
export function tickFlame(material, t) {
  material.uniforms.uTime.value = t;
}

// --- shared-material singleton ------------------------------------------------
// Fire() needs the one shared material even when called standalone (e.g. the
// headless test). FireLayer makes its own via makeFlameMaterial() an' ticks that
// one; Fire() lazily reuses a module-level instance so every quad lands on a
// ShaderMaterial. In the live game the FireLayer material an' this one are both
// valid flame materials — what matters is one material per process, not a global.
let _shared = null;
function sharedMaterial() {
  if (!_shared) _shared = makeFlameMaterial();
  return _shared;
}
// expose for the headless test's material-identity assertion
makeFlameMaterial.shared = null;
Object.defineProperty(makeFlameMaterial, 'shared', { get: () => _shared });
