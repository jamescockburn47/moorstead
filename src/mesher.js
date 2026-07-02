// Chunk meshing: culled faces with per-vertex AO; opaque, cutout and liquid passes.
import * as THREE from 'three';
import { B, BLOCKS, CHUNK, HEIGHT, TILE, WATER_LEVEL, isOpaque, isLiquid, isCutout } from './defs.js';
import { tileUV, buildAtlas, getCutoutAtlas } from './textures.js';
import { hash2i, noise2 } from './noise.js';
import { snowLineFor, freezableWater } from './snow.js';

let materials = null;

// snow-on-t'-tops: a height-gated white wash injected into t' opaque terrain
// material, gated to up-facing faces above a snow-line. Driven each frame frae
// season.snowiness via setSnowLevel; no chunk re-mesh needed.
const snowUniforms = { uSnowLine: { value: 64 }, uSnowAmt: { value: 0 } };
const glintUniform = { uGlintTime: { value: 0 } };
export function setGlintTime(t) { glintUniform.uGlintTime.value = t; }
// [0] cloud shadows: soft dark patches glidin' ower t' moor in time wi' t' dome
// clouds. Module uniforms shared by BOTH addSnow materials (t' glintUniform
// pattern). uCloudTime rides sky.cloudT — t' SAME accumulator t' dome scrolls
// by, churn speed-up an' all — an' t' fragment drifts by t' same wind vector
// (uTime * vec2(0.012, 0.007)), so ground shadows an' sky clouds move together.
// uCloudShadowAmt defaults 0 an' applyQuality parks it there on Plain: t'
// >0.001 branch never runs, terrain output stays byte-identical. Fine re-drives
// it every frame frae cover × dayness × clear-sky (self-zeroes at neet an' in
// full overcast by construction).
const cloudUniforms = { uCloudTime: { value: 0 }, uCloudShadowAmt: { value: 0 } };
export function setCloudTime(t) { cloudUniforms.uCloudTime.value = t; }
export function setCloudShadow(v) { cloudUniforms.uCloudShadowAmt.value = v; }
export function setSnowLevel(snowiness) {
  const s = snowiness < 0 ? 0 : snowiness > 1 ? 1 : snowiness;
  snowUniforms.uSnowAmt.value = s;
  snowUniforms.uSnowLine.value = snowLineFor(s); // t' snow-line creeps down as winter deepens
}
function addSnow(mat, key = 'terrain-snow', glint = false) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSnowLine = snowUniforms.uSnowLine;
    shader.uniforms.uSnowAmt = snowUniforms.uSnowAmt;
    shader.uniforms.uCloudTime = cloudUniforms.uCloudTime;
    shader.uniforms.uCloudShadowAmt = cloudUniforms.uCloudShadowAmt;
    shader.vertexShader = 'attribute float aSnowExp;\nvarying float vSnowExp;\nvarying float vSnowY;\nvarying float vSnowUp;\nvarying float vSnowWX;\nvarying float vSnowWZ;\n' + shader.vertexShader
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\n  vec4 wSnowPos = modelMatrix * vec4(transformed, 1.0);\n  vSnowY = wSnowPos.y;\n  vSnowWX = wSnowPos.x;\n  vSnowWZ = wSnowPos.z;\n  vSnowUp = normalize(mat3(modelMatrix) * objectNormal).y;\n  vSnowExp = aSnowExp;');
    // [0] t' dome's hash/noise idiom (sky.js dome fragment), fbm capped at TWO
    // octaves on terrain — t' perf rulin's hard cap. cs- prefix keeps t' names
    // clear o' owt three.js chunks define.
    shader.fragmentShader = 'uniform float uSnowLine;\nuniform float uSnowAmt;\nuniform float uCloudTime;\nuniform float uCloudShadowAmt;\nvarying float vSnowExp;\nvarying float vSnowY;\nvarying float vSnowUp;\nvarying float vSnowWX;\nvarying float vSnowWZ;\n'
      + 'float csHash(vec2 p){ p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }\n'
      + 'float csNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);\n'
      + '  float a = csHash(i), b = csHash(i + vec2(1.0, 0.0)), c = csHash(i + vec2(0.0, 1.0)), d = csHash(i + vec2(1.0, 1.0));\n'
      + '  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }\n'
      + 'float csFbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 2; i++){ v += a * csNoise(p); p *= 2.0; a *= 0.5; } return v; }\n'
      + shader.fragmentShader
      .replace('#include <color_fragment>',
        '#include <color_fragment>\n  float drift = 0.6 + 0.4 * sin(vSnowWX * 0.15) * cos(vSnowWZ * 0.15);\n  float snow = uSnowAmt * drift * vSnowExp * smoothstep(uSnowLine, uSnowLine + 10.0, vSnowY) * smoothstep(0.05, 0.55, vSnowUp);\n  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.96, 0.98, 1.0), clamp(snow * 1.25, 0.0, 1.0));')
      // [0] cloud shadows: dim DIRECT sun only (ambient untouched, so shade stays
      // readable), sampled at world XZ ~0.012/block an' drifted by t' dome's wind
      // vector on t' shared cloud clock. Zero uniform skips t' whole term (Plain).
      .replace('#include <lights_fragment_end>',
        '#include <lights_fragment_end>\n'
        + '  if (uCloudShadowAmt > 0.001) {\n'
        + '    vec2 csP = vec2(vSnowWX, vSnowWZ) * 0.012 + uCloudTime * vec2(0.012, 0.007);\n'
        + '    float csCloud = smoothstep(0.38, 0.62, csFbm(csP));\n'
        + '    reflectedLight.directDiffuse *= 1.0 - csCloud * uCloudShadowAmt;\n'
        + '  }');
    if (glint) {
      shader.uniforms.uGlintTime = glintUniform.uGlintTime;
      shader.vertexShader = 'attribute float aGlint;\nvarying float vGlint;\nvarying float vGlintH;\n' + shader.vertexShader
        .replace('#include <begin_vertex>',
          '#include <begin_vertex>\n  vGlint = aGlint;\n  vGlintH = transformed.x * 1.7 + transformed.z * 2.3;');
      shader.fragmentShader = 'uniform float uGlintTime;\nvarying float vGlint;\nvarying float vGlintH;\n' + shader.fragmentShader
        .replace('#include <color_fragment>',
          '#include <color_fragment>\n  float gl = vGlint * 0.12 * (0.5 + 0.5 * sin(uGlintTime * 2.0 + vGlintH));\n  diffuseColor.rgb += gl;');
    }
  };
  // [0] '-cloud' extends BOTH snow keys ('snow-opaque', 'snow-cutout-glint') so
  // t' new uniform/GLSL forks fresh programs — still t' same program COUNT (3).
  mat.customProgramCacheKey = () => key + '-cloud';
  return mat;
}

const iceUniform = { uFrozen: { value: 0 } };
export function setFrozen(frozen) { iceUniform.uFrozen.value = frozen ? 1 : 0; }

// [15]+[D0] living water: module uniforms shared by t' ONE liquid material (same
// pattern as glintUniform). All default 0 = today's flat still water, so Plain is
// byte-identical; applyQuality (main.js) stamps t' Fine amps an' setGlitter is
// re-driven each frame frae dayness × clear-sky. setWaterTime rides t' existing
// glint clock in main.js — no new tick.
const waterUniforms = {
  uWaterTime: { value: 0 },  // shared water clock (seconds)
  uRippleAmp: { value: 0 },  // isotropic surface bob amplitude (sea/tarns), Fine ~0.05
  uFlowAmp: { value: 0 },    // downstream wavelet amplitude (becks), Fine ~0.05
  uGlitter: { value: 0 },    // sun-sparkle strength, driven per frame under Fine
  uFresnel: { value: 0 },    // grazing-angle alpha lift (glassy water), Fine ~0.35
};
export function setWaterTime(t) { waterUniforms.uWaterTime.value = t; }
export function setRippleAmp(v) { waterUniforms.uRippleAmp.value = v; }
export function setFlowAmp(v) { waterUniforms.uFlowAmp.value = v; }
export function setGlitter(v) { waterUniforms.uGlitter.value = v; }
export function setFresnel(v) { waterUniforms.uFresnel.value = v; }

// [D0] chainage wrap for aFlow.z: baked as s % FLOW_WRAP (K = 1 block⁻¹). 50π is
// chosen so EVERY sinusoid the shader hangs off vFlowS completes whole cycles across
// t' wrap — coefficients 1.6, 1.6·2.7 = 4.32 an' 2.2 give 80π, 216π an' 110π, all
// even multiples o' π — so t' phase is seamless at t' wrap an' float32 never sees a
// chainage beyond ~157 (t' Esk runs to thousands o' blocks; raw s would lose t'
// sub-radian precision t' wavelets need).
export const FLOW_WRAP = Math.PI * 50;
const FLOW_ZERO = [0, 0, 0];

// --- [16] shoreline: depth tint + foam fringe (mesh-time, tier-flat, no shader) ---
// Depth tint: every liquid TOP face scans down its own column to t' first
// non-liquid block an' scales t' vertex colour by depth — 1.0 at depth 1 (pale,
// glassy shallows) down to 0.55 at depth 8+ (dark slate off Whitby). Mesh-time
// vertex colour only: deterministic, identical on both tiers, zero runtime cost,
// NO shader change (so no cache-key change either). DEPTH_TINT_AMP = 0 restores
// today's flat water colour exactly.
export const DEPTH_TINT_AMP = 1;
export function waterDepthTint(depth, amp = DEPTH_TINT_AMP) {
  if (!amp) return 1;
  const d = depth < 1 ? 1 : depth > 8 ? 8 : depth;
  return 1 - 0.45 * amp * ((d - 1) / 7);
}
// Foam fringe: where a WATER top face at sea level (y === WATER_LEVEL) horizontally
// neighbours solid SAND or GRAVEL, ONE flat quad goes into t' CUTOUT builder 0.01
// ABOVE t' water surface (cutout writes depth an' renders afore t' translucent
// liquid — a sub-surface quad would show tinted through t' 0.78-opacity water).
// Foam verts carry aGlint = 1, so t' compiled cutout glint shimmers 'em for free.
// Capped per chunk; FOAM_CAP = 0 is t' kill switch.
export const FOAM_CAP = 32;

// T' liquid shader: ice tint (winter freeze, unchanged semantics — uFrozen stays t'
// binary addIce had; S2c will float it), plus [15] ripple/glitter an' [D0] downstream
// wavelets/lace. ONE handler, one cache key — still exactly 3 terrain programs.
//   aTop   — 1 on every corner carrying t' 0.12 top-drop (incl. side-face top edges,
//            so edges ripple wi' t' surface an' no cracks open); 0 elsewhere.
//   aFlow  — vec3(tx·bank, tz·bank, s % FLOW_WRAP): xy is t' downstream unit tangent
//            scaled by bank (1 mid-channel → 0 at t' bank), so ONE attribute carries
//            direction, strength an' phase; t' shader recovers bank as length(aFlow.xy).
//            Zero-filled off-river an' in t' stylised world → collapses to [15].
function addWater(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFrozen = iceUniform.uFrozen;
    shader.uniforms.uWaterTime = waterUniforms.uWaterTime;
    shader.uniforms.uRippleAmp = waterUniforms.uRippleAmp;
    shader.uniforms.uFlowAmp = waterUniforms.uFlowAmp;
    shader.uniforms.uGlitter = waterUniforms.uGlitter;
    shader.uniforms.uFresnel = waterUniforms.uFresnel;
    shader.vertexShader = 'attribute float aFreeze;\nattribute float aTop;\nattribute vec3 aFlow;\nuniform float uFrozen;\nuniform float uWaterTime;\nuniform float uRippleAmp;\nuniform float uFlowAmp;\nvarying float vFreeze;\nvarying float vWX;\nvarying float vWZ;\nvarying float vFlowS;\nvarying vec2 vFlowDir;\n' + shader.vertexShader
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\n'
        + '  vFreeze = aFreeze;\n'
        // world pos via modelMatrix (t' addSnow idiom) so ripple phase never repeats per chunk
        + '  vec4 wWaterPos = modelMatrix * vec4(transformed, 1.0);\n'
        + '  vWX = wWaterPos.x; vWZ = wWaterPos.z;\n'
        + '  vFlowS = aFlow.z; vFlowDir = aFlow.xy;\n'
        // [15] isotropic bob, [D0] directional downstream wavelet; blended by bank
        // strength (smoothstep, not a hard step, so t' beck meets t' sea wi'out a crack)
        + '  float wIso = sin(uWaterTime * 1.3 + wWaterPos.x * 0.9) * cos(uWaterTime * 1.1 + wWaterPos.z * 0.7);\n'
        + '  float wPh = aFlow.z * 1.6 - uWaterTime * 2.4;\n'
        + '  float wDir = 0.8 * sin(wPh) + 0.2 * sin(wPh * 2.7);\n'
        + '  float wFm = smoothstep(0.01, 0.06, length(aFlow.xy));\n'
        + '  transformed.y += aTop * (1.0 - aFreeze * uFrozen) * mix(uRippleAmp * wIso, uFlowAmp * wDir, wFm);');
    shader.fragmentShader = 'uniform float uFrozen;\nuniform float uWaterTime;\nuniform float uFlowAmp;\nuniform float uGlitter;\nuniform float uFresnel;\nvarying float vFreeze;\nvarying float vWX;\nvarying float vWZ;\nvarying float vFlowS;\nvarying vec2 vFlowDir;\n' + shader.fragmentShader
      .replace('#include <color_fragment>',
        '#include <color_fragment>\n'
        + '  float ice = uFrozen * vFreeze;\n'
        + '  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.80, 0.88, 0.95), ice);\n'
        // [15] world-space sun glitter (NOT a UV scroll), phase sheared downstream by
        // dot(wpos.xz, flow) so sparkle streaks elongate along t' current ([D0])
        + '  vec2 wGp = vec2(vWX, vWZ);\n'
        + '  wGp -= vFlowDir * dot(wGp, vFlowDir) * 0.5;\n'
        + '  float wG = pow(max(0.0, sin(wGp.x * 2.3 + uWaterTime * 0.8) * sin(wGp.y * 1.9 - uWaterTime * 0.6)), 8.0);\n'
        + '  diffuseColor.rgb += wG * uGlitter * (1.0 - ice);\n'
        // [D0] travelling lace bands running downstream, strongest mid-channel;
        // 3×uFlowAmp keeps 'em subtle (max +0.15) an' Plain-safe (amp 0 → nowt)
        + '  float wBank = length(vFlowDir);\n'
        + '  float wLace = smoothstep(0.55, 0.95, 0.5 + 0.5 * sin(vFlowS * 2.2 - uWaterTime * 3.0)) * wBank;\n'
        + '  diffuseColor.rgb += wLace * uFlowAmp * 3.0 * (1.0 - ice);\n'
        // [15] Fine-only fresnel: grazing-angle water reads glassy (alpha lift)
        + '  float wFres = pow(1.0 - abs(dot(normalize(vViewPosition), normalize(vNormal))), 3.0);\n'
        + '  diffuseColor.a = min(1.0, diffuseColor.a + wFres * uFresnel);');
  };
  mat.customProgramCacheKey = () => 'liquid-ice-water';
  return mat;
}

export function initMaterials() {
  const atlas = buildAtlas();
  materials = {
    opaque: addSnow(new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true }), 'snow-opaque'),
    cutout: addSnow(new THREE.MeshLambertMaterial({ map: getCutoutAtlas(), vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide }), 'snow-cutout-glint', true),
    liquid: addWater(new THREE.MeshLambertMaterial({
      map: atlas, vertexColors: true, transparent: true, opacity: 0.78,
      depthWrite: false, side: THREE.DoubleSide,
    })),
  };
  return atlas;
}
export function getMaterials() { return materials; }

// Face tables (threejs voxel convention): two triangles 0,1,2 / 2,1,3
const FACES = [
  { dir: [-1, 0, 0], corners: [[0, 1, 0, 0, 1], [0, 0, 0, 0, 0], [0, 1, 1, 1, 1], [0, 0, 1, 1, 0]] },
  { dir: [1, 0, 0], corners: [[1, 1, 1, 0, 1], [1, 0, 1, 0, 0], [1, 1, 0, 1, 1], [1, 0, 0, 1, 0]] },
  { dir: [0, -1, 0], corners: [[1, 0, 1, 1, 0], [0, 0, 1, 0, 0], [1, 0, 0, 1, 1], [0, 0, 0, 0, 1]] },
  { dir: [0, 1, 0], corners: [[0, 1, 1, 1, 1], [1, 1, 1, 0, 1], [0, 1, 0, 1, 0], [1, 1, 0, 0, 0]] },
  { dir: [0, 0, -1], corners: [[1, 0, 0, 0, 0], [0, 0, 0, 1, 0], [1, 1, 0, 0, 1], [0, 1, 0, 1, 1]] },
  { dir: [0, 0, 1], corners: [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [0, 1, 1, 0, 1], [1, 1, 1, 1, 1]] },
];

const AO_LEVELS = [0.42, 0.62, 0.8, 1.0];
const FACE_LIGHT = [0.78, 0.78, 0.55, 1.0, 0.68, 0.68]; // directional baked shading

function faceTile(def, faceIdx, x, z) {
  if (faceIdx === 3) return def.tex.t;
  if (faceIdx === 2) return def.tex.b;
  // t' range shows a fire on one side
  if (def.sFront !== undefined && faceIdx === 5) return def.sFront;
  return def.tex.s;
}

// --- per-block top-face variation (S1c): hue jitter + dryness skew + UV rotation ---
// Only TOP faces (f===3) o' t' growing ground — grass tops, leaf canopies, peat
// moor-top — get a seeded brightness jitter, a slow dryness field (exposed tops
// strawier, dale floors lusher) and one o' four texture rotations, so t' moor
// stops reading as a grid of identical tiles. Building blocks (stone, brick,
// planks…) stay perfectly uniform. Mesh-time only, seeded frae WORLD x/z —
// deterministic, identical on both quality tiers, zero per-frame cost.
// TOP_VARY_AMP = 0 restores today's output exactly (identity tint, rotation 0).
export const TOP_VARY_AMP = 1;
const VARIED_TOP_TILES = new Set([
  TILE.GRASS_TOP, TILE.LEAVES, TILE.MONKEY_LEAVES, TILE.ORCHARD_LEAVES, TILE.PEAT,
]);
// t' four rotations o' t' corner UV frame (u,v within t' tile rect)
const UV_ROT = [
  (u, v) => [u, v],
  (u, v) => [v, 1 - u],
  (u, v) => [1 - u, 1 - v],
  (u, v) => [1 - v, u],
];
// Pure + exported so a verify script can assert variation at amp 1 and exact
// identity at amp 0 without building a chunk.
export function topFaceVariation(wx, wz, amp = TOP_VARY_AMP) {
  if (!amp) return { r: 1, g: 1, b: 1, rot: 0 };
  const j = 1 + amp * (0.92 + hash2i(wx, wz, 7) * 0.16 - 1); // brightness jitter, 0.92..1.08 at amp 1
  const dry = noise2(wx * 0.02, wz * 0.02, 9);               // slow dryness field in [-1,1]
  const skew = amp * 0.04 * dry;                             // dry -> +red/-blue (strawy); wet -> t' reverse (lush)
  return { r: j * (1 + skew), g: j, b: j * (1 - skew), rot: (hash2i(wx, wz, 8) * 4) | 0 };
}

class GeoBuilder {
  constructor() { this.pos = []; this.norm = []; this.uv = []; this.col = []; this.exp = []; this.frz = []; this.top = []; this.flow = []; this.gli = []; this.hasGlint = false; this.idx = []; this.n = 0; }
  // tops: per-corner aTop floats (liquid only); flow: per-quad [fx, fz, s] aFlow vec3
  // (liquid only). Solid/cutout passes never push 'em, so build() skips t' attributes
  // an' t' big opaque geometry carries nowt extra.
  // glint: per-quad aGlint float ([16] foam = 1). T' builder never wrote aGlint afore
  // — chunk cutout geometry leant on t' disabled-attribute default (0), only
  // floraLayer set it — so t' attribute is baked ONLY when a quad carries a non-zero
  // value; every other geometry stays byte-identical wi' t' default-0 behaviour.
  quad(corners, normal, uvRect, aos, light, exp = 1, frz = 0, tint = null, tops = null, flow = null, glint = 0) {
    const [u0, v0, u1, v1] = uvRect;
    for (const c of corners) {
      this.pos.push(c[0], c[1], c[2]);
      this.norm.push(normal[0], normal[1], normal[2]);
      this.uv.push(u0 + (u1 - u0) * c[3], v0 + (v1 - v0) * c[4]);
      this.exp.push(exp);
    }
    this.frz.push(frz, frz, frz, frz);
    this.gli.push(glint, glint, glint, glint);
    if (glint) this.hasGlint = true;
    if (tops) this.top.push(tops[0], tops[1], tops[2], tops[3]);
    if (flow) for (let i = 0; i < 4; i++) this.flow.push(flow[0], flow[1], flow[2]);
    for (let i = 0; i < 4; i++) {
      const b = AO_LEVELS[aos[i]] * light;
      if (tint) this.col.push(b * tint.r, b * tint.g, b * tint.b);
      else this.col.push(b, b, b);
    }
    // flip quad to avoid AO anisotropy artefacts
    if (aos[0] + aos[3] > aos[1] + aos[2]) {
      this.idx.push(this.n, this.n + 1, this.n + 2, this.n + 2, this.n + 1, this.n + 3);
    } else {
      this.idx.push(this.n + 1, this.n + 3, this.n, this.n, this.n + 3, this.n + 2);
    }
    this.n += 4;
  }
  build(material) {
    if (this.n === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.norm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSnowExp', new THREE.Float32BufferAttribute(this.exp, 1));
    g.setAttribute('aFreeze', new THREE.Float32BufferAttribute(this.frz, 1));
    if (this.top.length) g.setAttribute('aTop', new THREE.Float32BufferAttribute(this.top, 1));
    if (this.flow.length) g.setAttribute('aFlow', new THREE.Float32BufferAttribute(this.flow, 3));
    if (this.hasGlint) g.setAttribute('aGlint', new THREE.Float32BufferAttribute(this.gli, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return new THREE.Mesh(g, material);
  }
}

export function buildChunkMeshes(world, chunk) {
  const { cx, cz, data } = chunk;
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  const solid = new GeoBuilder();
  const cutout = new GeoBuilder();
  const liquid = new GeoBuilder();

  // Per-column sky-exposure: highest opaque block y, used to gate snow to exterior surfaces.
  const skyTop = new Int16Array(CHUNK * CHUNK).fill(-1);
  for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
    for (let y = HEIGHT - 1; y >= 0; y--) {
      if (isOpaque(data[lx + lz * CHUNK + y * CHUNK * CHUNK])) { skyTop[lx + lz * CHUNK] = y; break; }
    }
  }
  const exposedAt = (lx, y, lz) => (y >= skyTop[lx + lz * CHUNK] ? 1 : 0);

  const get = (x, y, z) => {
    if (y < 0) return B.BEDROCK;
    if (y >= HEIGHT) return B.AIR;
    if (x >= 0 && x < CHUNK && z >= 0 && z < CHUNK) {
      return data[x + z * CHUNK + y * CHUNK * CHUNK];
    }
    return world.getBlock(x0 + x, y, z0 + z);
  };
  const occludes = (x, y, z) => isOpaque(get(x, y, z));

  // [D0] per-COLUMN river flow, memoised (t' y-loop is outermost, so each water column
  // is visited many times). Moors world only — t' stylised geo has no riverFlow (t'
  // worldgen.js typeof idiom), so t' attribute zero-fills an' behaviour collapses to [15].
  const geo = world.gen.geo;
  const flowMemo = new Map();
  const flowAt = (lx, lz) => {
    const k = lx + lz * CHUNK;
    let f = flowMemo.get(k);
    if (f === undefined) {
      const rf = (typeof geo.riverFlow === 'function') ? geo.riverFlow(x0 + lx, z0 + lz) : null;
      f = rf ? [rf.tx * rf.bank, rf.tz * rf.bank, rf.s % FLOW_WRAP] : FLOW_ZERO;
      flowMemo.set(k, f);
    }
    return f;
  };

  // [16] per-COLUMN water depth tint, memoised like flowAt (keyed on t' surface y an'
  // all, so a rare second liquid run higher up t' same column recomputes honestly).
  // Scan stays inside t' column — t' get() closure never leaves this chunk's data.
  const depthMemo = new Map();
  const depthTintAt = (lx, y, lz) => {
    const k = lx + lz * CHUNK;
    let m = depthMemo.get(k);
    if (m === undefined || m.y !== y) {
      let d = 1;
      while (d < 8 && isLiquid(get(lx, y - d, lz))) d++;
      const t = waterDepthTint(d);
      m = { y, tint: t === 1 ? null : { r: t, g: t, b: t } };
      depthMemo.set(k, m);
    }
    return m.tint;
  };
  const foamUV = tileUV(TILE.FOAM);
  let foamN = 0; // [16] foam quads this chunk, capped at FOAM_CAP

  for (let y = 0; y < HEIGHT; y++) {
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const id = get(lx, y, lz);
        if (id === B.AIR) continue;
        const def = BLOCKS[id];

        if (isCutout(id)) {
          const uvr = tileUV(def.tex.t);
          const [u0, v0, u1, v1] = uvr;
          if (id === B.TORCH || id === B.SIGNPOST || id === B.HOME_FLAG) {
            // structural cutouts stay centred + upright (a torch/signpost/flag shouldn't lean)
            for (const [ax, az, bx, bz] of [[0.15, 0.15, 0.85, 0.85], [0.85, 0.15, 0.15, 0.85]]) {
              cutout.quad(
                [[lx + ax, y, lz + az, 0, 0], [lx + bx, y, lz + bz, 1, 0],
                 [lx + ax, y + 1, lz + az, 0, 1], [lx + bx, y + 1, lz + bz, 1, 1]],
                [0, 1, 0], [u0, v0, u1, v1], [3, 3, 3, 3], 0.95, exposedAt(lx, y, lz)
              );
            }
          } else {
            // plant flora: deterministic per-block yaw + jitter + scale so heather, gorse,
            // ferns etc. read natural rather than a regular grid of identical crosses
            const wx = x0 + lx, wz = z0 + lz;
            const a = hash2i(wx, wz, 1) * Math.PI * 2;
            const cxj = 0.5 + (hash2i(wx, wz, 2) - 0.5) * 0.2;
            const czj = 0.5 + (hash2i(wx, wz, 3) - 0.5) * 0.2;
            const rad = 0.34 + hash2i(wx, wz, 4) * 0.14;   // 0.34..0.48 half-width
            const ht = 0.85 + hash2i(wx, wz, 5) * 0.35;    // 0.85..1.20 height
            const cA = Math.cos(a) * rad, sA = Math.sin(a) * rad;
            for (const [dx, dz] of [[cA, sA], [-sA, cA]]) {
              cutout.quad(
                [[lx + cxj - dx, y, lz + czj - dz, 0, 0], [lx + cxj + dx, y, lz + czj + dz, 1, 0],
                 [lx + cxj - dx, y + ht, lz + czj - dz, 0, 1], [lx + cxj + dx, y + ht, lz + czj + dz, 1, 1]],
                [0, 1, 0], [u0, v0, u1, v1], [3, 3, 3, 3], 0.95, exposedAt(lx, y, lz)
              );
            }
          }
          continue;
        }

        if (isLiquid(id)) {
          const uvr = tileUV(def.tex.t);
          const drop = 0.12;
          const flow = flowAt(lx, lz);
          for (let f = 0; f < FACES.length; f++) {
            const { dir, corners } = FACES[f];
            const nb = get(lx + dir[0], y + dir[1], lz + dir[2]);
            if (nb === id || isOpaque(nb)) continue;
            if (isLiquid(nb)) continue;
            const cs = corners.map(c => {
              const yy = (c[1] === 1) ? y + 1 - drop : y;
              return [lx + c[0], yy, lz + c[2], c[3], c[4]];
            });
            const frz = freezableWater(id, geo.coastT(x0 + lx, z0 + lz), B) ? 1 : 0;
            // [16] TOP faces only: depth tint (null at depth 1 = today's colour), an'
            // t' foam fringe where sea-level WATER meets solid SAND/GRAVEL abeam
            let tint = null;
            if (f === 3) {
              tint = depthTintAt(lx, y, lz);
              if (id === B.WATER && y === WATER_LEVEL && foamN < FOAM_CAP) {
                const e = get(lx + 1, y, lz), w = get(lx - 1, y, lz),
                      s = get(lx, y, lz + 1), n = get(lx, y, lz - 1);
                if (e === B.SAND || e === B.GRAVEL || w === B.SAND || w === B.GRAVEL
                  || s === B.SAND || s === B.GRAVEL || n === B.SAND || n === B.GRAVEL) {
                  foamN++;
                  // 0.01 ABOVE t' surface, into t' CUTOUT builder (depth-writing, drawn
                  // afore t' translucent water); aGlint = 1 rides t' compiled glint
                  // shimmer for free. exp 0: t' snow wash leaves foam be.
                  const fy = y + 1 - drop + 0.01;
                  cutout.quad(
                    [[lx, fy, lz + 1, 1, 1], [lx + 1, fy, lz + 1, 0, 1],
                     [lx, fy, lz, 1, 0], [lx + 1, fy, lz, 0, 0]],
                    [0, 1, 0], foamUV, [3, 3, 3, 3], 1.0, 0, 0, null, null, null, 1);
                }
              }
            }
            // aTop = 1 exactly where t' 0.12 top-drop applied (c[1] === 1) — INCLUDING
            // side-face top edges, so edges ripple wi' t' surface an' no cracks open
            liquid.quad(cs, dir, uvr, [3, 3, 3, 3], FACE_LIGHT[f], 1, frz,
              tint, corners.map(c => c[1]), flow);
          }
          continue;
        }

        // solid block faces
        const swx = x0 + lx, swz = z0 + lz; // WORLD coords, so t' pattern doesn't repeat per chunk
        for (let f = 0; f < FACES.length; f++) {
          const { dir, corners } = FACES[f];
          const nb = get(lx + dir[0], y + dir[1], lz + dir[2]);
          if (isOpaque(nb)) continue;
          const uvr = tileUV(faceTile(def, f, swx, swz));
          // per-vertex AO
          const aos = [];
          const axis = dir[0] !== 0 ? 0 : dir[1] !== 0 ? 1 : 2;
          const t1 = axis === 0 ? 1 : 0;
          const t2 = axis === 2 ? 1 : 2;
          for (const c of corners) {
            const s1o = c[t1] === 1 ? 1 : -1;
            const s2o = c[t2] === 1 ? 1 : -1;
            const np = [lx + dir[0], y + dir[1], lz + dir[2]];
            const p1 = [...np]; p1[t1] += s1o;
            const p2 = [...np]; p2[t2] += s2o;
            const pc = [...np]; pc[t1] += s1o; pc[t2] += s2o;
            const s1 = occludes(p1[0], p1[1], p1[2]) ? 1 : 0;
            const s2 = occludes(p2[0], p2[1], p2[2]) ? 1 : 0;
            const co = occludes(pc[0], pc[1], pc[2]) ? 1 : 0;
            aos.push(s1 && s2 ? 0 : 3 - (s1 + s2 + co));
          }
          // per-block variation on growing tops only (S1c) — identity when amp is 0
          let tint = null, uvRot = UV_ROT[0];
          if (f === 3 && VARIED_TOP_TILES.has(def.tex.t)) {
            tint = topFaceVariation(swx, swz);
            uvRot = UV_ROT[tint.rot];
          }
          solid.quad(corners.map(c => {
            const [ru, rv] = uvRot(c[3], c[4]);
            return [lx + c[0], y + c[1], lz + c[2], ru, rv];
          }), dir, uvr, aos, FACE_LIGHT[f], f === 3 ? exposedAt(lx, y, lz) : 0, 0, tint);
        }
      }
    }
  }

  const meshes = [];
  const ms = solid.build(materials.opaque);
  const mc = cutout.build(materials.cutout);
  const ml = liquid.build(materials.liquid);
  for (const m of [ms, mc, ml]) {
    if (!m) continue;
    m.position.set(x0, 0, z0);
    meshes.push(m);
  }
  if (ml) ml.renderOrder = 2;
  return meshes;
}

export function disposeChunkMeshes(scene, meshes) {
  for (const m of meshes) {
    scene.remove(m);
    m.geometry.dispose();
  }
}
