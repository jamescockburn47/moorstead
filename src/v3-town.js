// Dress the generated town footprints, including Castleton's first-use street.
// Every ornament is flush to a real wall or above the two-block doorway clearance.
import * as THREE from 'three';
import { B } from './defs.js';
import { V3_PALETTE as C } from './v3-props.js';

export function townSites(geo, player) {
  if (!geo._townBuildings) return [];
  return (geo.villages || []).filter(v => Math.hypot(v.x - player.x, v.z - player.z) < 110).flatMap(v =>
    geo._townBuildings(v).map(b => ({ key: `town:${b.x0}:${b.z0}`, kind: 'town', x: Math.floor((b.x0 + b.x1) / 2) + .5,
      y: b.g + 1, z: b.z0 + .5, yaw: Math.PI, building: b,
      anchor: { x: b.x0, y: b.g + 1, z: b.z0, block: b.wall === 'cobble' ? B.COBBLE : B.STONEBRICK } })));
}

export function buildTownFront(kit, site) {
  const root = new THREE.Group(); root.name = site.key;
  const b = site.building, width = b.x1 - b.x0 + 1, cx = site.x - (b.x0 + b.x1 + 1) / 2;
  const trim = [C.iron, C.red, 0x40566b][Math.abs(b.x0 * 13 + b.z0 * 7) % 3];
  const box = (s, p, colour) => kit.box(root, s, p, colour);
  // Eaves, alternating quoins and a bright doorway frame give the street rhythm.
  box([width + .13, .19, .14], [cx, b.wallH + .05, .55], trim);
  for (const wx of [b.x0, b.x1]) for (let i = 0; i < b.wallH; i++)
    box([i % 2 ? .72 : .96, .18, .1], [site.x - wx - .5, i + .47, .54], i % 2 ? 0xb2a082 : C.paper);
  for (const x of [-.64, .64]) box([.2, 2.16, .14], [x, 1.08, .55], trim);
  box([1.48, .2, .17], [0, 2.21, .55], C.cream);
  // Follow worldgen's actual window predicate; never paint windows over doorways.
  for (let wx = b.x0 + 1; wx < b.x1; wx++) {
    if (wx === Math.floor(site.x) || (wx + b.z0) % 3) continue;
    const x = site.x - wx - .5, height = b.type === 'chapel' ? 2 : 1;
    box([.98, .1, .18], [x, .98, .56], C.cream);
    for (const dx of [-.46, .46]) box([.06, height + .06, .08], [x + dx, 1 + height / 2, .55], trim);
    box([.055, height, .065], [x, 1 + height / 2, .55], C.cream);
    box([1, .065, .065], [x, 1.52, .55], C.cream);
  }
  if (b.biz) {
    const title = { pub: 'PUBLIC HOUSE', shop: 'VILLAGE SHOP', chapel: 'PARISH CHAPEL' }[b.type] || b.type.toUpperCase();
    kit.label(root, title, [-.5, 3.48, 1.57], 1.93, .54);
    if (b.type === 'shop') {
      // A shallow striped canvas canopy at head-safe height, above the actual doorstep.
      const w = Math.min(3.5, width - .2);
      for (let i = 0; i < 8; i++) box([w / 8, .12, 1.35], [(i - 3.5) * w / 8, 2.89, .98], i % 2 ? C.cream : trim);
      box([w, .23, .07], [0, 2.75, 1.62], trim);
    } else if (b.type === 'pub') {
      kit.lantern(root, -1.14, 2.57, .81);
    }
  }
  kit.batch(root); return root;
}
