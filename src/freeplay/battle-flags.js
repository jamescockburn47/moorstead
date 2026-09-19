import * as THREE from 'three';
import { BATTLE_TEAMS } from './battle-models.js';

const PROFILES = Object.freeze({
  home: { bottom: 0, pole: 4.8, clothY: 4.1, width: 2.4, height: 1.5 },
  carried: { bottom: 1.35, pole: 2.2, clothY: 3.1, width: 1.6, height: 1 },
  dropped: { bottom: 0, pole: 1.9, clothY: 1.35, width: 1.6, height: 1 },
});

// Two reusable objective slots share one draw batch. Server state alone decides
// where flags are, who carries them, and when they return to base.
export class BattleFlags {
  constructor(parent) {
    this.slots = Object.keys(BATTLE_TEAMS).map(team => ({ team, visible: false, x: 0, y: 0, z: 0, status: 'home', carrier: null }));
    this.enabled = false; this.disposed = false;
    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    this.material = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, 8);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.mesh.frustumCulled = false; this.mesh.count = 0;
    this.dummy = new THREE.Object3D(); this.colour = new THREE.Color(); parent.add(this.mesh);
  }
  apply(ctf) {
    this.enabled = !!ctf && ['setup', 'active', 'won'].includes(ctf.phase);
    for (const slot of this.slots) {
      const flag = this.enabled && ctf.flags?.[slot.team];
      slot.visible = !!flag && [flag.x, flag.y, flag.z].every(Number.isFinite) && Object.hasOwn(PROFILES, flag.status)
        && (flag.carrier === null || typeof flag.carrier === 'string');
      if (slot.visible) Object.assign(slot, { x: flag.x, y: flag.y, z: flag.z, status: flag.status, carrier: flag.carrier });
    }
  }
  part(index, x, y, z, angle, offsetX, offsetY, width, height, depth, tint) {
    this.dummy.position.set(x + Math.cos(angle) * offsetX, y + offsetY, z - Math.sin(angle) * offsetX);
    this.dummy.rotation.set(0, angle, 0); this.dummy.scale.set(width, height, depth); this.dummy.updateMatrix();
    this.mesh.setMatrixAt(index, this.dummy.matrix); this.mesh.setColorAt(index, this.colour.set(tint));
  }
  update(actors, world, playerPos) {
    if (this.disposed) return;
    let count = 0;
    for (const slot of this.slots) {
      if (!slot.visible) continue;
      const carrier = slot.status === 'carried' && actors.get('p:' + slot.carrier);
      const anchor = carrier?.current || slot, { x, y, z } = anchor;
      if (world?.isLoaded && !world.isLoaded(Math.floor(x), Math.floor(z))) continue;
      const p = PROFILES[slot.status], angle = Math.atan2(playerPos.x - x, playerPos.z - z), offset = p.width / 2;
      this.part(count++, x, y, z, angle, 0, p.bottom + p.pole / 2, .11, p.pole, .11, 0xf4eddc);
      this.part(count++, x, y, z, angle, offset, p.clothY, p.width, p.height, .10, BATTLE_TEAMS[slot.team]);
      this.part(count++, x, y, z, angle, offset, p.clothY, .13, p.height * .58, .12, 0xffffff);
      this.part(count++, x, y, z, angle, offset, p.clothY, p.height * .58, .13, .12, 0xffffff);
    }
    this.mesh.count = count; this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  clear() { this.enabled = false; this.slots.forEach(slot => { slot.visible = false; }); this.mesh.count = 0; }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.clear(); this.mesh.removeFromParent();
    this.mesh.dispose(); this.geometry.dispose(); this.material.dispose();
  }
}
