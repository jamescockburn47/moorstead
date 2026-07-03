// Whitby harbour light ([33]) check — run wi': node scripts/verify-lighthouse.mjs
//
// The contract this defends:
//   (a) siteHarbourLight(geo) resolves on the shipped moors data to dry land
//       (coastT 0) at headland height (>= WATER_LEVEL + 1), clear of the
//       Dracula boss arena (>= 24 blocks — the fight owns the East Cliff);
//   (b) determinism — two fresh geo constructions site the identical block
//       (INVARIANTS #6: the ring search is a pure function of the geo);
//   (c) a geo without whitbyHarbour (the stylised world) returns null, no throw;
//   (d) the tower itself: boxes only, NO PointLight anywhere in the group
//       (point lights are too dear — the lamp is an emissive-over-bloom trick),
//       lamp emissive over the 0.85 bloom threshold (intensity >= 2), and
//       dispose() takes it cleanly out of the scene;
//   (e) the beam (James 2026-07-03 rework — "casts 2 laser beams, far too far
//       away"): ONE flared blade (not the old crossed pair), 22 blocks not 60,
//       hinged at the lamp down local -Z with a cone flare (tip wider than
//       base), rolled about its LONG axis in update() so the face bisects
//       toward the camera (one beam from every angle, shared-clock yaw
//       untouched), and paraffin alpha in the shader: hard (1-v)^2.5 length
//       die-off, mist-driven reach mix(0.45,1.0) and peak alpha mix(0.10,0.55),
//       mistiness anchored (98 - fogFar) / 70 to sky.js's FOG_FAR_MAX=98 /
//       fog-weather<=28.
//
// Headless three.js scene-graph builds fine under Node (we never render). The
// flare sprite is the module's one document-touching path, so the tower is
// built { plain: true } here — the browser-only ctor branch stays untested
// headlessly by design (it's the documented Plain/Fine split).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { siteHarbourLight, HarbourLight } from '../src/lighthouse.js';
import { MoorsGeography } from '../src/moorsgeo.js';
import { MOORS_SEED } from '../src/worldgen.js';
import { WATER_LEVEL } from '../src/defs.js';

const SRC = readFileSync(fileURLToPath(new URL('../src/lighthouse.js', import.meta.url)), 'utf8');

let failed = false;
const ok  = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// --- (a) siting on the shipped moors data ------------------------------------
const geo = new MoorsGeography(MOORS_SEED);
const site = siteHarbourLight(geo);
(site !== null ? ok : bad)('siteHarbourLight(geo) resolves on the shipped moors data');
if (site) {
  (Number.isInteger(site.x) && Number.isInteger(site.z) ? ok : bad)(`site is a whole block column (${site.x}, ${site.z})`);
  (geo.coastT(site.x, site.z) === 0 ? ok : bad)('site stands on dry land (coastT 0)');
  (site.h >= WATER_LEVEL + 1 ? ok : bad)(`site is headland-tall (h ${site.h} >= WATER_LEVEL + 1 = ${WATER_LEVEL + 1})`);
  const arena = geo.draculaArena();
  (Number.isFinite(arena.x) && Math.abs(arena.x) < 1e5 ? ok : bad)('draculaArena() is a real in-bounds spot (abbey landmark present)');
  const d = Math.hypot(site.x - arena.x, site.z - arena.z);
  (d >= 24 ? ok : bad)(`site keeps clear of the boss arena (${d.toFixed(1)} >= 24 blocks)`);
}

// --- (b) determinism: two fresh geos, one site --------------------------------
{
  const siteB = siteHarbourLight(new MoorsGeography(MOORS_SEED));
  (JSON.stringify(site) === JSON.stringify(siteB)
    ? ok : bad)(`two fresh geo constructions site the identical block (pure ring search): ${JSON.stringify(site)} vs ${JSON.stringify(siteB)}`);
}

// --- (c) the stylised world (no whitbyHarbour) is a clean null ----------------
{
  let threw = false, r;
  try { r = siteHarbourLight({ coastT: () => 0, height: () => 30 }); } catch { threw = true; }
  (!threw && r === null ? ok : bad)('a geo without whitbyHarbour() returns null without throwing');
  (siteHarbourLight(null) === null ? ok : bad)('a null geo returns null without throwing');
}

// --- (d) the tower: boxes, no point light, emissive lamp, clean teardown ------
{
  // a REAL (headless) THREE.Scene: dispose() checks group.parent, which only a
  // real Object3D.add() sets — an ad-hoc stub would miss the removal path.
  const scene = new THREE.Scene();
  const hl = new HarbourLight(scene, geo, { plain: true });
  (!hl.disposed ? ok : bad)('HarbourLight built live off the shipped geo');
  (scene.children.length === 1 && scene.children[0] === hl.group ? ok : bad)('exactly one group added to the scene');
  (hl.group.children.length >= 12 ? ok : bad)(`tower group has its boxes (${hl.group.children.length} children >= 12)`);
  let boxes = 0, pointLights = 0;
  hl.group.traverse(o => {
    if (o.isMesh && o.geometry && o.geometry.type === 'BoxGeometry') boxes++;
    if (o.isPointLight) pointLights++;
  });
  (boxes >= 12 ? ok : bad)(`tower is built of boxes (${boxes} box meshes)`);
  (pointLights === 0 ? ok : bad)('NO THREE.PointLight anywhere in the group (emissive-over-bloom only)');
  (hl.lamp && hl.lamp.material.emissiveIntensity >= 2
    ? ok : bad)(`lamp emissive rides over the 0.85 bloom threshold (intensity ${hl.lamp && hl.lamp.material.emissiveIntensity} >= 2)`);
  // James 2026-07-03: deliberately adjusted from `=== 2` ("two crossed beam
  // planes") — the crossed pair showed its X and read as TWO laser beams. The
  // contract is now ONE blade, billboarded about its long axis in update().
  (hl.beamGroup && hl.beamGroup.children.length === 1 ? ok : bad)('ONE beam blade hinged at the lamp (no crossed-plane X)');

  // --- (e) the beam blade: geometry, paraffin shader literals, billboard roll --
  const beam = hl.beam;
  (beam && beam === hl.beamGroup.children[0] ? ok : bad)('hl.beam is the blade inside the beam group');
  if (beam) {
    const pos = beam.geometry.getAttribute('position');
    const uv = beam.geometry.getAttribute('uv');
    (pos.count === 4 ? ok : bad)(`blade is a single quad (${pos.count} verts)`);
    let zMin = 0, zMax = 0, baseW = 0, tipW = 0;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i), x = pos.getX(i);
      zMin = Math.min(zMin, z); zMax = Math.max(zMax, z);
      if (z === 0) baseW = Math.max(baseW, Math.abs(x) * 2);
      else tipW = Math.max(tipW, Math.abs(x) * 2);
    }
    (zMax === 0 && zMin === -22 ? ok : bad)(`blade hinges at the lamp and runs 22 blocks down local -Z (was 60 — laser length), got ${-zMin}`);
    (Math.abs(baseW - 1.2) < 1e-6 ? ok : bad)(`base width 1.2 (got ${baseW})`);
    (Math.abs(tipW - 3.4) < 1e-6 ? ok : bad)(`tip width 3.4 (got ${tipW})`);
    (tipW > baseW ? ok : bad)('cone flare: the blade widens with distance (paraffin spread, not a parallel laser bar)');
    let uvOk = true;
    for (let i = 0; i < pos.count; i++) uvOk = uvOk && (uv.getY(i) === (pos.getZ(i) === 0 ? 0 : 1));
    (uvOk ? ok : bad)('uv v runs 0 at the lamp to 1 at the tip (the shader length falloff axis)');
  }
  // paraffin shader + mist-drive literals (source-scraped: the alpha shaping
  // lives in GLSL strings a scene-graph walk can't see)
  (SRC.includes('pow(1.0 - lv, 2.5)') ? ok : bad)('length falloff is (1-v)^2.5 — the tip genuinely dies');
  (SRC.includes('mix(0.45, 1.0, uMistiness)') ? ok : bad)('mist drives the beam REACH: clear air 0.45 of full length -> mist 1.0');
  (SRC.includes('mix(0.10, 0.55, uMistiness)') ? ok : bad)('mist drives the peak alpha: clear 0.10 (soft blade) -> mist 0.55');
  (SRC.includes('(98 - fogFar) / 70') ? ok : bad)('mistiness anchored to sky.js fog range: clear FOG_FAR_MAX=98 -> 0, fog weather 28 -> 1');
  (!SRC.includes('BEAM_W = ') && SRC.includes('BEAM_LEN = 22') ? ok : bad)('BEAM_LEN literal is 22 and the old parallel-bar BEAM_W is gone');

  // functional: stub the shared clock so yaw is deterministic, then drive
  // update() headlessly (pure maths, no GL) and check the billboard roll
  {
    const realNow = Date.now;
    Date.now = () => 0; // yaw = 0 -> beam points down world -Z
    try {
      scene.updateMatrixWorld(true);
      const lampW = new THREE.Vector3().setFromMatrixPosition(hl.lamp.matrixWorld);
      const cam = { position: new THREE.Vector3() };
      const mist = { isNight: () => true, fogFar: 28 };  // fog weather -> full mist
      const clear = { isNight: () => true, fogFar: 98 }; // clear night

      cam.position.set(lampW.x, lampW.y + 30, lampW.z);  // straight above the lamp
      hl.update(0.016, cam, mist);
      (hl.beamGroup.visible === true && hl.lamp.visible === true ? ok : bad)('beam and lamp show at night');
      (Math.abs(hl.beam.rotation.z) < 1e-9 ? ok : bad)(`camera overhead -> roll 0 (face +Y toward camera), got ${hl.beam.rotation.z}`);
      (hl.beam.material.uniforms.uMistiness.value === 1 ? ok : bad)(`fog weather (fogFar 28) -> uMistiness 1 (got ${hl.beam.material.uniforms.uMistiness.value})`);
      (hl.beamGroup.rotation.y === 0 ? ok : bad)('shared-clock yaw untouched by the billboard (stubbed clock -> yaw 0)');

      cam.position.set(lampW.x + 10, lampW.y, lampW.z);  // due east, lamp height
      hl.update(0.016, cam, clear);
      (Math.abs(hl.beam.rotation.z - Math.atan2(-10, 0)) < 1e-9 ? ok : bad)(`camera abeam east -> roll -pi/2 (face +X toward camera), got ${hl.beam.rotation.z}`);
      (hl.beam.material.uniforms.uMistiness.value === 0 ? ok : bad)(`clear night (fogFar 98) -> uMistiness 0 (got ${hl.beam.material.uniforms.uMistiness.value})`);
      (hl.beamGroup.rotation.y === 0 ? ok : bad)('yaw still the clock\'s after a second billboard pass');

      hl.update(0.016, cam, { isNight: () => false, fogFar: 98 });
      (hl.beamGroup.visible === false ? ok : bad)('beam hides by day');
    } finally {
      Date.now = realNow;
    }
  }

  let threw = false;
  try { hl.dispose(); } catch { threw = true; }
  (!threw ? ok : bad)('dispose() runs without throwing');
  (scene.children.length === 0 ? ok : bad)('dispose() removes the group from the scene');
  (hl.disposed === true ? ok : bad)('dispose() marks the light inert');
  // update() after dispose must short-circuit, not throw
  let threw2 = false;
  try { hl.update(0.016, null, null); } catch { threw2 = true; }
  (!threw2 ? ok : bad)('update() after dispose is a safe no-op');
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
