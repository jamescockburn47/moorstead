// Reuse Moorstead's wardrobe and animal rigs. Animals own their body resources;
// villager and animal-face caches remain shared with the ordinary game.
import { makeVillager, makeSheep, makeCow, makeDog, lookFromSpec, outfitSpecFor } from '../entities.js';

export class PopulationModels {
  constructor() {
    this.templates = new Map(); this.pool = new Map();
    this.geometries = new Set(); this.materials = new Set();
  }

  acquire(kind, variant = 0) {
    const key = `${kind}:${variant}`;
    if (this.pool.get(key)?.length) return this.pool.get(key).pop();
    if (!this.templates.has(key)) {
      const role = ['farmer', 'fishwife', 'miner', 'shepherd'][variant % 4];
      const model = kind === 'villager'
        ? makeVillager(lookFromSpec(outfitSpecFor(role, `freeplay:${variant}`)))
        : ({ sheep: makeSheep, cow: makeCow, dog: makeDog }[kind])();
      model.legs.forEach((leg, i) => { leg.name = `freeplay-leg-${i}`; });
      if (kind !== 'villager') {
        const collect = node => {
          if (node.name.startsWith('face:')) return;
          if (node.geometry) this.geometries.add(node.geometry);
          if (node.material) this.materials.add(node.material);
          node.children.forEach(collect);
        };
        collect(model.group);
      }
      this.templates.set(key, model);
    }
    const template = this.templates.get(key), group = template.group.clone(true);
    const legs = template.legs.map((_, i) => group.getObjectByName(`freeplay-leg-${i}`));
    return { key, group, legs };
  }

  release(rig) {
    rig.group.removeFromParent(); rig.group.rotation.set(0, 0, 0);
    rig.legs.forEach(leg => { leg.rotation.x = 0; });
    if (!this.pool.has(rig.key)) this.pool.set(rig.key, []);
    this.pool.get(rig.key).push(rig);
  }

  dispose() {
    this.geometries.forEach(geometry => geometry.dispose());
    this.materials.forEach(material => material.dispose());
    this.geometries.clear(); this.materials.clear(); this.templates.clear(); this.pool.clear();
  }
}
