// dripLayer.js — [D9] drips frae the eaves. After a shower passes, cottage
// eaves, barn lintels an' the station canopy keep dripping for a few minutes:
// sparse, irregular single drops falling off the roof edge. Walk into a
// village tha didn't see rained on an' tha still knows it just was.
//
// Windowed overlay in the SeasonalLayer mould (seasonalLayer.js:21-22,56-102):
// same RADIUS/rebuild-throttle/villages-in-range/hash-seeded-determinism shape,
// but ONE THREE.Points for the whole window rather than per-object meshes —
// motion is entirely GPU-side (onBeforeCompile on the PointsMaterial, the
// r166 pattern proven by sky.js's precipitation rig an' star twinkle, an' by
// birds.js's lazy CanvasTexture singleton).
//
// Emitter siting mirrors festivals/christmas.js's window-glow perimeter walk
// (:140-176): walk each building's wall footprint, pick the roof-perimeter
// (eave) cells, hash-seed 2-6 of them per building, push the point 0.3
// outward from the wall face exactly like the window-glow offset does.
//
// Period: dripping thatch/pantiles, c.1900 — no electric guttering, no
// modern downpipes, just water finding the eave and letting go.
import * as THREE from 'three';
import { hash2i } from './noise.js';
import { registerFxMat, unregisterFxMat } from './fire.js';

const RADIUS = 48;            // same window as SeasonalLayer/festival dressing
const REBUILD_MOVE = 8;       // same move-threshold as SeasonalLayer
const REBUILD_THROTTLE = 0.4; // seconds — mirrors seasonalLayer.js's this.timer gate
const POINT_CAP = 600;        // Fine cap; Plain halves it (see constructor)
const MIN_EMIT = 2, MAX_EMIT = 6; // emitters per building
const EAVE_OUT = 0.3;         // eave point pushed this far outward from the wall face

// ---- lazy droplet sprite ---------------------------------------------------
// Tiny 4x6 vertical streak, the same canvas-gradient idiom as sky.js's rain
// texture (sky.js:544-551) an' birds.js's lazy-singleton guard (birds.js:118-132)
// — built on first real construct only, never at import time (headless-safe).
let _dropTex = null;
function dropletTexture() {
  if (typeof document === 'undefined') return null;
  if (_dropTex) return _dropTex;
  const c = document.createElement('canvas'); c.width = 4; c.height = 6;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 6);
  g.addColorStop(0, 'rgba(200,215,225,0)');
  g.addColorStop(0.55, 'rgba(210,222,232,0.85)');
  g.addColorStop(1, 'rgba(225,235,245,0.95)');
  x.fillStyle = g; x.fillRect(1, 0, 2, 6);
  _dropTex = new THREE.CanvasTexture(c);
  return _dropTex;
}

// ---- vertex/fragment injection (onBeforeCompile on PointsMaterial) --------
// Mirrors sky.js's addPrecipMotion shape (sky.js:179-192): declare attrs/uniforms
// after #include <common>, replace #include <begin_vertex> for the fall, gate
// alpha in the fragment. uTime is the ONLY uniform name registerFxMat/tickFires
// will drive (fire.js:220-221,544-547) — NOT uDripT, per the red-team fix.
const DRIP_VERT_DECL = `
attribute float aSeed;
attribute float aFallH;
uniform float uTime;
varying float vAlpha;
`;
const DRIP_VERT_MOVE = `
vec3 transformed = vec3( position );
{
  float h = max(aFallH, 0.05);
  transformed.y -= mod(aSeed * 7.3 + uTime * (1.2 + aSeed * 0.8), h);
  // sparse release gate: each emitter drops roughly once every 1-4s, not a
  // steady stream — step(0.92, fract(...)) opens a narrow ~8% window per cycle
  vAlpha = step(0.92, fract(aSeed * 13.7 + uTime * 0.11));
}
`;
const DRIP_FRAG_ALPHA = `
vec4 diffuseColor = vec4( diffuse, opacity * vAlpha );
`;
function addDripMotion(mat) {
  // registerFxMat/tickFires read mat.uniforms.uTime directly (fire.js:220-221,546)
  // — NOT the compiled shader's sh.uniforms — so the material needs its own
  // {value} object up front; onBeforeCompile then hands the SAME object into
  // the compiled program (the precip own/shared pattern, sky.js:528-536,557).
  mat.uniforms = { uTime: { value: 0 } };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = mat.uniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', DRIP_VERT_DECL + '#include <common>')
      .replace('#include <begin_vertex>', DRIP_VERT_MOVE);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', 'varying float vAlpha;\n#include <common>')
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', DRIP_FRAG_ALPHA);
  };
  mat.customProgramCacheKey = () => 'eave-drip';
}

// Deterministic emitter list for one building — hash-seeded off the building's
// own footprint coords + the world seed, so every client builds the SAME
// drips (no Math.random, no per-client state). Mirrors christmas.js's
// window-glow perimeter walk (festivals/christmas.js:140-176) for the
// eave-cell → outward-offset idiom, but samples a handful of perimeter cells
// rather than every qualifying one.
function buildingEmitters(gen, b, worldSeed) {
  const out = [];
  const g = b.g != null ? b.g : gen.height(Math.round((b.x0 + b.x1) / 2), Math.round((b.z0 + b.z1) / 2));
  const wallH = b.wallH != null ? b.wallH : 4;
  const eaveY = g + wallH + 1; // wall-top / roof-start course — the eave line
  const count = MIN_EMIT + Math.floor(hash2i(b.x0, b.z1, worldSeed ^ 0xd91b) * (MAX_EMIT - MIN_EMIT + 1));
  const perim = []; // every non-corner perimeter cell, walked once (cheap: small footprints)
  for (let wx = b.x0; wx <= b.x1; wx++) {
    for (let wz = b.z0; wz <= b.z1; wz++) {
      const onPerim = wx === b.x0 || wx === b.x1 || wz === b.z0 || wz === b.z1;
      if (!onPerim) continue;
      const corner = (wx === b.x0 || wx === b.x1) && (wz === b.z0 || wz === b.z1);
      if (corner) continue;
      perim.push([wx, wz]);
    }
  }
  if (!perim.length) return out;
  for (let i = 0; i < count; i++) {
    const seedA = hash2i(b.x0 + i * 31, b.z0 - i * 17, worldSeed ^ 0x6472); // 'dr' salt, picks the cell
    const seedB = hash2i(b.x1 - i * 13, b.z1 + i * 29, worldSeed ^ 0x6472); // per-emitter fall seed
    const [wx, wz] = perim[Math.floor(seedA * perim.length) % perim.length];
    // outward wall-face offset — same yaw logic as festivals/christmas.js:154-175
    let ex, ez;
    if (wz === b.z0)      { ex = wx + 0.5; ez = wz - EAVE_OUT; }       // south wall
    else if (wz === b.z1) { ex = wx + 0.5; ez = wz + 1 + EAVE_OUT; }   // north wall
    else if (wx === b.x0) { ex = wx - EAVE_OUT; ez = wz + 0.5; }       // west wall
    else                  { ex = wx + 1 + EAVE_OUT; ez = wz + 0.5; }   // east wall
    const groundH = gen.height(wx, wz);
    const fallH = Math.max(0.6, eaveY - groundH);
    out.push({ x: ex, y: eaveY, z: ez, seed: seedB, fallH });
  }
  return out;
}

export class DripLayer {
  // scene: THREE.Scene to add/remove the single Points root.
  // world: chunk world — world.gen / world.gen.geo._townBuildings(v) /
  //        world.gen.geo.villages are read frae here (same access path
  //        SeasonalLayer uses).
  // opts.plain: true halves the point cap (Points are tablet-trivial per
  //             [19]'s finding, so this ships on both tiers — just fewer).
  constructor(scene, world, opts = {}) {
    this.scene = scene;
    this.world = world;
    this.cap = opts.plain ? Math.floor(POINT_CAP / 2) : POINT_CAP;
    this.center = null;
    this.timer = 0;
    this._builtOnce = false;
    this._amt = 0; // smoothed uDripAmt, so the fade doesn't step

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.cap * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(this.cap), 1));
    geo.setAttribute('aFallH', new THREE.BufferAttribute(new Float32Array(this.cap), 1));
    geo.setDrawRange(0, 0); // nowt drawn 'til the first build populates it
    this.geometry = geo;

    this.material = new THREE.PointsMaterial({
      map: dropletTexture(), size: 0.22, transparent: true,
      opacity: 0.9, depthWrite: false, sizeAttenuation: true, fog: false,
    });
    addDripMotion(this.material);
    this.material.visible = false; // dry/no-window default — draw call disappears

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    // mat.uniforms.uTime already exists (set in addDripMotion above), so this
    // registers straight away — the ONE global tick (tickFires in main.js)
    // drives it from here on, whether or not the drips are visible this frame.
    registerFxMat(this.material);
  }

  // dt: frame delta seconds.
  // playerPos: {x,z} (or {x,y,z}) — drives the windowed rebuild, same shape
  //            SeasonalLayer.update() takes.
  // drive: { groundWet, rainAmount, frozen } — groundWet/rainAmount read off
  //        the Game/Sky exactly as main.js already computes them for the wet-
  //        ground term (this.groundWet, this.sky.rainAmount); frozen is the
  //        boolean isFrozen(season) main.js already derives each frame.
  update(dt, playerPos, drive = {}) {
    const groundWet = drive.groundWet || 0;
    const rainAmount = drive.rainAmount || 0;
    const frozen = !!drive.frozen;
    // DRIVE: nonzero ONLY in the just-stopped-raining window, fading as the
    // ground dries; multiplies to 0 while it's still raining hard, and while
    // frozen (a frozen eave doesn't drip — it grows an icicle, not this effect).
    const target = clamp01(groundWet * 2) * clamp01(1 - rainAmount * 3) * (frozen ? 0 : 1);
    this._amt += (target - this._amt) * Math.min(1, dt * 2); // quick-ish ease, no popping
    const amt = this._amt < 0.003 ? 0 : this._amt;
    this.material.visible = amt > 0;
    if (this.material.opacity !== amt) this.material.opacity = amt * 0.9;

    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = REBUILD_THROTTLE;
    if (!this.world || !this.world.gen) return;
    const cx = Math.floor(playerPos.x), cz = Math.floor(playerPos.z);
    if (this.center &&
        Math.abs(cx - this.center[0]) < REBUILD_MOVE &&
        Math.abs(cz - this.center[1]) < REBUILD_MOVE &&
        this._builtOnce) return;
    this.build(cx, cz);
    this.center = [cx, cz];
    this._builtOnce = true;
  }

  build(cx, cz) {
    const gen = this.world.gen;
    if (!(gen.geo && typeof gen.geo._townBuildings === 'function')) { this.geometry.setDrawRange(0, 0); return; }
    const worldSeed = gen.geo.seed || 0;

    // Materialise v.buildings lazily, same pattern SeasonalLayer.build() uses
    // (seasonalLayer.js:116-123) — coordinated so it's cached once and every
    // window-reading layer (festivals, chimney smoke, this) shares the array.
    for (const v of (gen.geo.villages || [])) {
      if (Math.abs(v.x - cx) > RADIUS || Math.abs(v.z - cz) > RADIUS) continue;
      if (!v.buildings || !v.buildings.length) {
        try { v.buildings = gen.geo._townBuildings(v) || []; } catch { /* leave empty — nowt drips there this pass */ }
      }
    }

    const pos = this.geometry.attributes.position.array;
    const seedA = this.geometry.attributes.aSeed.array;
    const fallA = this.geometry.attributes.aFallH.array;
    let n = 0;
    outer:
    for (const v of (gen.geo.villages || [])) {
      if (Math.abs(v.x - cx) > RADIUS || Math.abs(v.z - cz) > RADIUS) continue;
      for (const b of (v.buildings || [])) {
        if (!b.roof) continue; // no roof (e.g. fold/fence) = no eave to drip off
        for (const e of buildingEmitters(gen, b, worldSeed)) {
          if (n >= this.cap) break outer;
          pos[n * 3] = e.x; pos[n * 3 + 1] = e.y; pos[n * 3 + 2] = e.z;
          seedA[n] = e.seed;
          fallA[n] = e.fallH;
          n++;
        }
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aSeed.needsUpdate = true;
    this.geometry.attributes.aFallH.needsUpdate = true;
    this.geometry.setDrawRange(0, n);
  }

  dispose() {
    unregisterFxMat(this.material);
    this.scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
    // dropletTexture() is a module-level cached singleton (mirrors
    // getFlameMaterial/birdDotTexture) — it outlives this layer, NOT disposed here.
  }
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
