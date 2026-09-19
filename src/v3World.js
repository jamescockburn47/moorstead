// Bounded visual dressing. No blocks, collision, saves, AI, network or gameplay writes.
import * as THREE from 'three';
import { B } from './defs.js';
import { V3PropKit } from './v3-props.js';
import { stationSites, innSite, buildStation, buildInn, buildNoticeboard } from './v3-places.js';
import { townSites, buildTownFront } from './v3-town.js';

export const V3_PLACE_LIMIT = 4;
export const V3_FRONTAGE_LIMIT = 8;
export class V3WorldLayer {
  constructor(game) {
    this.game = game; this.kit = new V3PropKit(); this.root = new THREE.Group();
    this.root.name = 'v3-world'; (game.scene || game.entities.scene).add(this.root);
    this.places = new Map(); this.elapsed = 1; this.disposed = false;
    const gen = game.world.gen, geo = gen.geo;
    this.sites = [...stationSites(geo), ...[...(gen.inns?.values() || [])].map(innSite)];
    // This particular parish board is stamped only at geo.village, not all OS towns.
    const v = geo.village;
    if (v) this.sites.push({ key: 'village-board', kind: 'board', x: v.x - 3, z: v.z - 11.5, y: v.ground + 1, yaw: 0,
      anchor: { x: v.x - 3, z: v.z - 12, y: v.ground + 2, block: B.BOARD } });
  }
  update(dt = 0) {
    if (this.disposed) return;
    this.elapsed += dt;
    if (this.elapsed >= .5) {
      this.elapsed = 0; this.refresh();
    }
    const time = this.game.sky?.time ?? .5;
    this.root.traverse(o => {
      const hands = o.userData.clockHands;
      if (hands) { hands[0].rotation.z = -time * Math.PI * 4; hands[1].rotation.z = -(time * 24 % 1) * Math.PI * 2; }
    });
  }
  refresh() {
    const p = this.game.player?.pos; if (!p) return;
    const world = this.game.world;
    const sites = this.sites.filter(s => Math.hypot(s.x - p.x, s.z - p.z) < 95 && Math.abs(s.y - p.y) < 40)
      .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z)).slice(0, V3_PLACE_LIMIT);
    const fronts = townSites(world.gen.geo, p).filter(s => Math.hypot(s.x - p.x, s.z - p.z) < 65 && Math.abs(s.y - p.y) < 30)
      .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z)).slice(0, V3_FRONTAGE_LIMIT);
    const wanted = new Set();
    for (const site of [...sites, ...fronts]) {
      const a = site.anchor;
      // Wait for real chunk data; removed/replaced anchors suppress decoration.
      if (world.getBlock(a.x, a.y, a.z) !== a.block) continue;
      wanted.add(site.key);
      if (!this.places.has(site.key)) {
        const builder = site.kind === 'station' ? buildStation : site.kind === 'inn' ? buildInn : site.kind === 'town' ? buildTownFront : buildNoticeboard;
        const root = builder(this.kit, site); root.position.set(site.x, site.y, site.z); root.rotation.y = site.yaw;
        this.root.add(root); this.places.set(site.key, root);
      }
    }
    for (const [key, root] of this.places) if (!wanted.has(key)) { this.release(root); this.places.delete(key); }
  }
  release(root) {
    root.removeFromParent(); root.traverse(o => { if (o.isInstancedMesh) o.dispose(); });
  }
  dispose() {
    if (this.disposed) return; this.disposed = true;
    for (const root of this.places.values()) this.release(root);
    this.places.clear(); this.root.removeFromParent(); this.kit.dispose();
  }
}
