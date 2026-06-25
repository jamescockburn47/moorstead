// festivalKit.js — generic, festival-agnostic mesh helpers shared across the
// seasonal layer and individual festival builders. Pure three.js: each helper
// builds one mesh, pushes it to the caller's teardown `objects` array and adds
// it to `scene`. The userData flags (sharedMaterial/ownGeometry) drive teardown
// in SeasonalLayer.clear(), so they MUST be preserved byte-for-byte.
import * as THREE from 'three';
import { TILE } from './defs.js';
import { tileUV } from './textures.js';
import { getMaterials } from './mesher.js';

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
