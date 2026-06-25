// Fire component + flame material — run wi': node scripts/verify-fire.mjs
// Headless: three.js scene-graph builds fine under Node (no GL needed — we never render).
import * as THREE from 'three';
import { makeFlameMaterial, Fire, tickFlame } from '../src/fire.js';

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

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
