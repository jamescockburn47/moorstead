// Visible period architecture, anchored to existing worldgen plans and voxels.
import * as THREE from 'three';
import { V3_PALETTE as C } from './v3-props.js';
import { B, WATER_LEVEL } from './defs.js';
import { doorFrame } from './innplan.js';

export function stationSites(geo) {
  const sites = [], seen = new Set();
  for (const { name, path } of geo.railPaths?.() || []) {
    const line = geo.railLines().find(l => l.name === name);
    for (const [i, station] of (line?.stops || []).entries()) {
      if (seen.has(station.name)) continue; seen.add(station.name);
      const sp = geo.samplePosOn(path, path.stationS[i]);
      const g = Math.max(Math.round(sp.deck), WATER_LEVEL + 1);
      const cell = (a, w) => ({ x: Math.round(sp.x + sp.tx * a + sp.tz * w), z: Math.round(sp.z + sp.tz * a - sp.tx * w) });
      sites.push({ key: `station:${station.name}`, kind: 'station', name: station.name, x: sp.x + .5, z: sp.z + .5, y: g + 1,
        yaw: Math.atan2(-sp.tz, sp.tx), grand: ['Pickering', 'Whitby'].includes(station.name),
        anchor: { ...cell(3, 4), y: g + 2, block: B.BOARD }, cell });
    }
  }
  return sites;
}

export function innSite(plan) {
  const p = plan.footprint, mx = Math.round((p.x0 + p.x1) / 2), mz = Math.round((p.z0 + p.z1) / 2);
  const x = plan.doorSide === 'e' ? p.x1 : plan.doorSide === 'w' ? p.x0 : mx;
  const z = plan.doorSide === 'n' ? p.z0 : plan.doorSide === 's' ? p.z1 : mz;
  const { fwd } = doorFrame(plan.doorSide);
  return { key: `inn:${plan.name}`, kind: 'inn', name: plan.name, x: x + .5, z: z + .5, y: plan.groundY + 1,
    yaw: Math.atan2(fwd[0], fwd[1]), anchor: { x, z, y: plan.groundY + 1, block: B.INN_DOOR }, plan };
}

export function buildStation(kit, site) {
  const root = new THREE.Group(); root.name = site.key;
  // Local X runs along rail; positive Z here faces the platform. Basis is right-handed,
  // so platform across values are NEGATIVE Z (worldgen across = [tz,-tx]).
  const b = (s, p, c, r = 0) => kit.box(root, s, [p[0], p[1], -p[2]], c, r);
  if (!site.grand) {
    b([10.6, .18, 3.1], [0, 3.65, 3.4], C.slate);
    b([10.6, .27, .1], [0, 3.44, 1.85], C.cream);
    for (const x of [-4.65, 4.65]) {
      b([.16, 3.6, .16], [x, 1.8, 4.25], C.iron);
      b([.36, .18, .36], [x, .12, 4.25], C.red);
      b([.12, 1, .12], [x + (x < 0 ? .33 : -.33), 3.2, 4.25], C.iron, x < 0 ? -.7 : .7);
    }
    for (let x = -5; x <= 5; x += .5) b([.2, .2, .09], [x, 3.23, 1.85], C.cream);
    kit.label(root, site.name.toUpperCase(), [0, 3.42, -1.78], 4.3, .44);
  } else kit.label(root, site.name.toUpperCase(), [-3, 3.2, -4.6], 4.5, .5);
  // Frame the actual 3x2 departures board, never create a second interaction object.
  b([3.35, .12, 1.18], [3, 3.1, 4], C.slate);
  kit.label(root, 'TRAINS  ·  MARKET', [3, 2.68, -3.44], 2.65, .43);
  for (const x of [1.48, 4.52]) b([.1, 1.9, .08], [x, 2, 3.45], C.cream);
  for (const [x, y, w] of [[2.15, 2.04, .78], [3.25, 2.04, .88], [3.95, 1.43, .55]]) {
    b([w, .52, .03], [x, y, 3.44], C.paper);
    for (let j = 0; j < 3; j++) b([w * .7, .025, .015], [x, y + .12 - j * .12, 3.42], C.iron);
  }
  // Luggage sits on the existing workbench footprint, away from platform circulation.
  b([.75, .35, .48], [-2, 1.2, 4], C.oak);
  b([.58, .25, .4], [-2.06, 1.5, 4], C.red);
  for (const x of [-2.24, -1.85]) b([.055, .36, .49], [x, 1.2, 4], C.brass);
  b([.21, .055, .06], [-2.06, 1.65, 4], C.iron);
  kit.lantern(root, -4, 2.8, -4.15); kit.lantern(root, 4, 2.8, -4.15);
  kit.clock(root, [-3, 2.8, -4.2]);
  kit.batch(root); return root;
}

export function buildInn(kit, site) {
  const root = new THREE.Group(); root.name = site.key;
  const b = (s, p, c) => kit.box(root, s, p, c);
  // Thin door surround lies on the existing wall; opening remains one full voxel wide.
  for (const x of [-.63, .63]) b([.22, 2.25, .13], [x, 1.13, .53], C.cream);
  b([1.65, .23, .18], [0, 2.38, .57], C.cream);
  b([3.25, .18, .95], [0, 2.85, .76], C.slate);
  b([3.05, .13, .12], [0, 2.72, 1.18], C.red);
  kit.label(root, site.name.toUpperCase(), [0, 3.28, .59], 4, .52);
  kit.label(root, 'WARMTH  ·  FOOD  ·  GAMES', [0, 2.54, .68], 2.65, .25);
  for (const x of [-1.2, 1.2]) {
    b([.06, .06, .62], [x, 2.18, .79], C.iron);
    kit.lantern(root, x, 1.72, 1.04);
  }
  // Mortared quoins, dark eave fascia and window sills on the real 9x7 shell.
  const p = site.plan.footprint, centre = new THREE.Vector3(site.x, site.y, site.z);
  const inverse = new THREE.Matrix4().makeRotationY(-site.yaw);
  const atWorld = (x, y, z, size, colour) => {
    const v = new THREE.Vector3(x, y, z).sub(centre).applyMatrix4(inverse);
    const m = kit.box(root, size, v.toArray(), colour); m.rotation.y = -site.yaw;
  };
  for (const x of [p.x0, p.x1]) for (const z of [p.z0, p.z1]) for (let y = 0; y < 3; y++)
    atWorld(x + .5, site.y + y + .5, z + .5, [1.045, .22, 1.045], y % 2 ? C.paper : 0xb2a082);
  for (const z of [p.z0, p.z1]) {
    atWorld((p.x0 + p.x1 + 1) / 2, site.y + 3.12, z + .5, [9.14, .22, 1.08], C.red);
    for (const x of [p.x0 + 2, p.x1 - 2]) atWorld(x + .5, site.y + .96, z + .5, [1.22, .13, 1.12], C.cream);
  }
  kit.batch(root); return root;
}

export function buildNoticeboard(kit, site) {
  const root = new THREE.Group(); root.name = site.key;
  kit.box(root, [2.3, .16, 1.35], [0, 2.25, 0], C.slate);
  for (const x of [-1.04, 1.04]) kit.box(root, [.11, 1.25, .09], [x, 1.58, .54], C.oak);
  kit.label(root, 'VILLAGE NOTICES', [0, 2.02, .56], 1.94, .32);
  for (const [x, y] of [[-.58, 1.5], [.3, 1.4]]) {
    kit.box(root, [.63, .7, .025], [x, y, .55], C.paper);
    for (let j = 0; j < 4; j++) kit.box(root, [.46, .025, .01], [x, y + .2 - j * .13, .57], C.iron);
  }
  kit.lantern(root, .84, 2.85, 0);
  kit.batch(root); return root;
}
