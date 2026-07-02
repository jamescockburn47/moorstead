// Chunk meshing: culled faces with per-vertex AO; opaque, cutout and liquid passes.
import * as THREE from 'three';
import { B, BLOCKS, CHUNK, HEIGHT, TILE, isOpaque, isLiquid, isCutout } from './defs.js';
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
export function setSnowLevel(snowiness) {
  const s = snowiness < 0 ? 0 : snowiness > 1 ? 1 : snowiness;
  snowUniforms.uSnowAmt.value = s;
  snowUniforms.uSnowLine.value = snowLineFor(s); // t' snow-line creeps down as winter deepens
}
function addSnow(mat, key = 'terrain-snow', glint = false) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSnowLine = snowUniforms.uSnowLine;
    shader.uniforms.uSnowAmt = snowUniforms.uSnowAmt;
    shader.vertexShader = 'attribute float aSnowExp;\nvarying float vSnowExp;\nvarying float vSnowY;\nvarying float vSnowUp;\nvarying float vSnowWX;\nvarying float vSnowWZ;\n' + shader.vertexShader
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\n  vec4 wSnowPos = modelMatrix * vec4(transformed, 1.0);\n  vSnowY = wSnowPos.y;\n  vSnowWX = wSnowPos.x;\n  vSnowWZ = wSnowPos.z;\n  vSnowUp = normalize(mat3(modelMatrix) * objectNormal).y;\n  vSnowExp = aSnowExp;');
    shader.fragmentShader = 'uniform float uSnowLine;\nuniform float uSnowAmt;\nvarying float vSnowExp;\nvarying float vSnowY;\nvarying float vSnowUp;\nvarying float vSnowWX;\nvarying float vSnowWZ;\n' + shader.fragmentShader
      .replace('#include <color_fragment>',
        '#include <color_fragment>\n  float drift = 0.6 + 0.4 * sin(vSnowWX * 0.15) * cos(vSnowWZ * 0.15);\n  float snow = uSnowAmt * drift * vSnowExp * smoothstep(uSnowLine, uSnowLine + 10.0, vSnowY) * smoothstep(0.05, 0.55, vSnowUp);\n  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.96, 0.98, 1.0), clamp(snow * 1.25, 0.0, 1.0));');
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
  mat.customProgramCacheKey = () => key;
  return mat;
}

const iceUniform = { uFrozen: { value: 0 } };
export function setFrozen(frozen) { iceUniform.uFrozen.value = frozen ? 1 : 0; }
function addIce(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFrozen = iceUniform.uFrozen;
    shader.vertexShader = 'attribute float aFreeze;\nvarying float vFreeze;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vFreeze = aFreeze;');
    shader.fragmentShader = 'uniform float uFrozen;\nvarying float vFreeze;\n' + shader.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\n  float ice = uFrozen * vFreeze;\n  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.80, 0.88, 0.95), ice);');
  };
  mat.customProgramCacheKey = () => 'liquid-ice';
  return mat;
}

export function initMaterials() {
  const atlas = buildAtlas();
  materials = {
    opaque: addSnow(new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true }), 'snow-opaque'),
    cutout: addSnow(new THREE.MeshLambertMaterial({ map: getCutoutAtlas(), vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide }), 'snow-cutout-glint', true),
    liquid: addIce(new THREE.MeshLambertMaterial({
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
  constructor() { this.pos = []; this.norm = []; this.uv = []; this.col = []; this.exp = []; this.frz = []; this.idx = []; this.n = 0; }
  quad(corners, normal, uvRect, aos, light, exp = 1, frz = 0, tint = null) {
    const [u0, v0, u1, v1] = uvRect;
    for (const c of corners) {
      this.pos.push(c[0], c[1], c[2]);
      this.norm.push(normal[0], normal[1], normal[2]);
      this.uv.push(u0 + (u1 - u0) * c[3], v0 + (v1 - v0) * c[4]);
      this.exp.push(exp);
    }
    this.frz.push(frz, frz, frz, frz);
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
          for (let f = 0; f < FACES.length; f++) {
            const { dir, corners } = FACES[f];
            const nb = get(lx + dir[0], y + dir[1], lz + dir[2]);
            if (nb === id || isOpaque(nb)) continue;
            if (isLiquid(nb)) continue;
            const cs = corners.map(c => {
              const yy = (c[1] === 1) ? y + 1 - drop : y;
              return [lx + c[0], yy, lz + c[2], c[3], c[4]];
            });
            const frz = freezableWater(id, world.gen.geo.coastT(x0 + lx, z0 + lz), B) ? 1 : 0;
            liquid.quad(cs, dir, uvr, [3, 3, 3, 3], FACE_LIGHT[f], 1, frz);
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
