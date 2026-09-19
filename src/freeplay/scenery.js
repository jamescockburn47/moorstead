// The same Moorstead builders, with support checks against the edited terrain.
import * as THREE from 'three';
import { Rails } from '../rails.js';
import { RoadLayer } from '../roads.js';
import { V3WorldLayer } from '../v3World.js';
import { FloraLayer } from '../floraLayer.js';
import { getMaterials } from '../mesher.js';
import { trackSupported, roadGround, footprintSupported } from './scenery-support.js';
import { FreeplayTrains } from './scenery-trains.js';

export class FreeplayScenery {
  constructor(game) {
    this.game = game;
    const { scene, world } = game;
    this.supportCache = new Map();
    this.placeChecks = new WeakMap();
    this.rails = new Rails(scene, world.gen.geo, { supported: (x, z, y, kind) => this.trackSupported(x, z, y, kind) });
    this.roads = new RoadLayer(scene, world, world.gen.geo, { groundAt: (x, z) => roadGround(world, x, z) });
    this.places = new V3WorldLayer(game);
    this.trains = new FreeplayTrains(game);
    this.flora = getMaterials() ? new FloraLayer(scene, world) : null;
    this.revision = world.revision;
    this.quiet = 0;
    this.box = new THREE.Box3();
    this.disposed = false;
  }

  trackSupported(x, z, y, kind = 'rails') {
    const key = `${Math.round(x)},${Math.round(z)},${Math.floor(y)},${kind}`;
    if (!this.supportCache.has(key)) this.supportCache.set(key, trackSupported(this.game.world, x, z, y, kind));
    return this.supportCache.get(key);
  }

  invalidate() {
    this.supportCache.clear();
    this.rails.clear(); this.rails.lastPos = null; this.rails.timer = 0;
    this.roads.clear(); this.roads.timer = 0;
    if (this.flora) {
      this.flora.clear(); this.flora._pending = null;
      this.flora.center = null; this.flora.timer = 0;
    }
    this.places.elapsed = 1;
    for (const route of this.trains.routes) this.trains.hide(route);
    this.quiet = 0.1;
  }

  update(dt = 0) {
    if (this.disposed) return;
    const { world, player, sky, season } = this.game;
    if (world.revision !== this.revision) { this.revision = world.revision; this.invalidate(); }
    this.places.update(dt);
    for (const root of this.places.places.values()) {
      if (this.placeChecks.get(root) === world.revision) continue;
      root.updateWorldMatrix(true, true);
      this.box.setFromObject(root);
      root.visible = footprintSupported(world, this.box);
      this.placeChecks.set(root, world.revision);
    }
    if (this.quiet > 0) { this.quiet -= dt; return; }
    this.trains.update(dt);
    this.rails.update(dt, player.pos);
    this.roads.update(dt, player.pos, 0);
    this.flora?.update(dt, player.pos, season || sky?.season);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.rails.dispose(); this.roads.dispose(); this.places.dispose(); this.flora?.clear(); this.trains.dispose();
    this.supportCache.clear();
  }
}
