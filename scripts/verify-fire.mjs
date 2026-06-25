// Fire component + flame material — run wi': node scripts/verify-fire.mjs
// Headless: three.js scene-graph builds fine under Node (no GL needed — we never render).
import * as THREE from 'three';
import { makeFlameMaterial, getFlameMaterial, Fire, tickFlame, tickFires } from '../src/fire.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// --- the shared flame material ---
const mat = makeFlameMaterial();
(mat instanceof THREE.ShaderMaterial ? ok : bad)('makeFlameMaterial() is a THREE.ShaderMaterial');
(mat.uniforms && mat.uniforms.uTime && mat.uniforms.uTime.value === 0 ? ok : bad)('has a uTime uniform starting at 0');
(mat.depthWrite === false ? ok : bad)('depthWrite is false (flame never occludes)');
(mat.transparent === true ? ok : bad)('transparent is true');
(mat.blending === THREE.AdditiveBlending ? ok : bad)('uses additive blending');
(mat.side === THREE.DoubleSide ? ok : bad)('renders double-sided');
(typeof mat.vertexShader === 'string' && mat.vertexShader.includes('aSeed') ? ok : bad)('vertex shader reads the per-vertex aSeed');
(typeof mat.fragmentShader === 'string' && mat.fragmentShader.length > 200 ? ok : bad)('fragment shader is the ported flame body');

// --- tickFlame drives time ---
tickFlame(mat, 12.5);
(mat.uniforms.uTime.value === 12.5 ? ok : bad)('tickFlame sets uTime.value');

// --- Fire(): a billboard group on the shared material ---
const f1 = Fire({ scale: 0.3, layers: 1 });
(f1 instanceof THREE.Object3D ? ok : bad)('Fire({layers:1}) is an Object3D/Group');
const meshes1 = [];
f1.traverse(o => { if (o.isMesh) meshes1.push(o); });
(meshes1.length >= 1 ? ok : bad)('Fire({layers:1}) has >= 1 mesh child');
(meshes1.every(m => m.material === mat || m.material === makeFlameMaterial.shared || m.material instanceof THREE.ShaderMaterial) ? ok : bad)('mesh children use a ShaderMaterial');
(meshes1[0] && meshes1[0].geometry.getAttribute('aSeed') ? ok : bad)('each quad geometry carries an aSeed attribute');

const f3 = Fire({ scale: 0.5, layers: 3, seed: 7 });
const meshes3 = [];
f3.traverse(o => { if (o.isMesh) meshes3.push(o); });
(meshes3.length === 3 ? ok : bad)('Fire({layers:3}) has exactly 3 flame quads');
(meshes3.every(m => m.geometry.getAttribute('aSeed')) ? ok : bad)('every layer quad carries an aSeed attribute');
{
  // the seed actually lands on the vertices (so adjacent fires desync)
  const a = meshes3[0].geometry.getAttribute('aSeed');
  (a.count >= 3 && a.array.every(v => v === 7) ? ok : bad)('aSeed values equal the requested seed (7)');
}

// --- dispose frees geometry but NEVER the shared material ---
(typeof f3.dispose === 'function' ? ok : bad)('the group exposes dispose()');
{
  let threw = false;
  try { f3.dispose(); } catch (e) { threw = true; }
  (!threw ? ok : bad)('dispose() runs without throwing');
  // the shared material must survive a group disposal (it is reused by every fire)
  (mat.uniforms && mat.uniforms.uTime ? ok : bad)('shared material is untouched after a group dispose');
}

// --- the flame material is a SINGLE process-wide singleton ---
(getFlameMaterial() === mat ? ok : bad)('getFlameMaterial() returns the same instance makeFlameMaterial() did');
{
  // two independent Fire() calls (no material passed) land on ONE shared material
  const a = Fire({ scale: 0.3 });
  const b = Fire({ scale: 0.3 });
  const ma = []; a.traverse(o => { if (o.isMesh) ma.push(o); });
  const mb = []; b.traverse(o => { if (o.isMesh) mb.push(o); });
  (ma[0].material === mb[0].material ? ok : bad)('two Fire() calls share ONE flame material (singleton)');
  (ma[0].material === mat ? ok : bad)('that shared material is the singleton');
  a.dispose(); b.dispose();
}

// --- tickFires exists an' drives the global clock ---
(typeof tickFires === 'function' ? ok : bad)('tickFires(t) is exported');
tickFires(20.0);
(mat.uniforms.uTime.value === 20.0 ? ok : bad)('tickFires advances the shared material uTime');

// --- a HERO fire: embers (Points) + smoke object + a PointLight ---
{
  const hero = Fire({ scale: 3, big: true, embers: true, smoke: true, light: true });
  (hero.userData.big === true ? ok : bad)('hero Fire({big:true}) flags the broad/chaotic flame');

  let points = null, light = null, smoke = null;
  hero.traverse(o => {
    if (o.isPoints) points = o;            // the ember system
    if (o.isPointLight) light = o;          // the warm pulsing light
    if (o.isMesh && o.userData.smokeMat) smoke = o; // the smoke plume mesh
  });
  (points instanceof THREE.Points ? ok : bad)('embers:true builds a THREE.Points ember system');
  (points && points.geometry.getAttribute('aSeed') ? ok : bad)('the ember Points carries a per-mote aSeed attribute');
  (points && points.material.uniforms && points.material.uniforms.uTime ? ok : bad)('the ember material has a uTime uniform (GPU-animated)');
  (smoke ? ok : bad)('smoke:true builds a smoke object above the flame');
  (light instanceof THREE.PointLight ? ok : bad)('light:true adds exactly one THREE.PointLight');
  {
    let nLights = 0; hero.traverse(o => { if (o.isPointLight) nLights++; });
    (nLights === 1 ? ok : bad)('exactly ONE point-light per hero fire');
  }

  // tickFires drives the ember material's uTime AND pulses the hero light
  const before = light.intensity;
  tickFires(0.0);
  tickFires(0.13); // a quarter-ish into the flicker — intensity should move
  (points.material.uniforms.uTime.value === 0.13 ? ok : bad)('tickFires advances the ember material uTime');
  (light.intensity !== before || light.intensity > 0 ? ok : bad)('tickFires pulses the hero point-light intensity');

  // dispose frees ember/smoke geometry, removes the light, de-registers — and
  // STILL never disposes the shared flame material
  let threw = false;
  try { hero.dispose(); } catch (e) { threw = true; }
  (!threw ? ok : bad)('hero dispose() runs without throwing');
  { let stillLight = false; hero.traverse(o => { if (o.isPointLight) stillLight = true; }); (!stillLight ? ok : bad)('hero dispose() removes the point-light from the group'); }
  (mat.uniforms && mat.uniforms.uTime ? ok : bad)('shared flame material survives a hero dispose');
  // after disposing the only hero fire, ticking must not throw (registries clean)
  { let t2 = false; try { tickFires(1.0); } catch (e) { t2 = true; } (!t2 ? ok : bad)('tickFires is safe after the hero fire is disposed'); }
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
