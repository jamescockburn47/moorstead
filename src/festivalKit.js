// festivalKit.js — generic, festival-agnostic mesh helpers shared across the
// seasonal layer and individual festival builders. Pure three.js: each helper
// builds one mesh, pushes it to the caller's teardown `objects` array and adds
// it to `scene`. The userData flags (sharedMaterial/ownGeometry) drive teardown
// in SeasonalLayer.clear(), so they MUST be preserved byte-for-byte.
import * as THREE from 'three';
import { TILE, B } from './defs.js';
import { tileUV } from './textures.js';
import { getMaterials } from './mesher.js';

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
export function greenPlacement(world, v, salt = 0) {
  const geo = world.gen.geo;
  const isPreferred = k => k === 'green' || k === 'closes' || k === 'path';
  for (let pass = 0; pass < 2; pass++) {
    for (let r = 2; r <= 12; r++) {
      for (let ai = 0; ai < 16; ai++) {
        const angle = (ai / 16) * Math.PI * 2 + salt;
        const x = v.x + Math.round(r * Math.cos(angle));
        const z = v.z + Math.round(r * Math.sin(angle));
        const col = typeof geo.villageColumn === 'function' ? geo.villageColumn(x, z) : null;
        if (pass === 0 && !(col && isPreferred(col.kind))) continue;  // pass 1: classified greens only
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
export function addWindowGlow(scene, objects, x, y, z, yaw) {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffce6b,
    transparent: true,
    opacity: 0.82,
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
