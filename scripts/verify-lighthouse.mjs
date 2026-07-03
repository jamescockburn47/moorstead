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
//       dispose() takes it cleanly out of the scene.
//
// Headless three.js scene-graph builds fine under Node (we never render). The
// flare sprite is the module's one document-touching path, so the tower is
// built { plain: true } here — the browser-only ctor branch stays untested
// headlessly by design (it's the documented Plain/Fine split).

import * as THREE from 'three';
import { siteHarbourLight, HarbourLight } from '../src/lighthouse.js';
import { MoorsGeography } from '../src/moorsgeo.js';
import { MOORS_SEED } from '../src/worldgen.js';
import { WATER_LEVEL } from '../src/defs.js';

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
  (hl.beamGroup && hl.beamGroup.children.length === 2 ? ok : bad)('two crossed beam planes hinged at the lamp');

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
