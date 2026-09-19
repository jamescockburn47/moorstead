import * as THREE from 'three';
import { BATTLE_TEAMS } from './battle-models.js';

const TRACERS = 48, HITS = 32;
const point = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
export class BattleEffects {
  constructor(parent) {
    this.tracers = Array.from({ length: TRACERS }, () => ({ life: 0, from: new THREE.Vector3(), to: new THREE.Vector3(), colour: new THREE.Color() }));
    this.hits = Array.from({ length: HITS }, () => ({ life: 0, position: new THREE.Vector3(), shield: false }));
    this.tracerIndex = this.hitIndex = 0; this.disposed = false;
    this.geometry = new THREE.BufferGeometry(); this.positions = new THREE.Float32BufferAttribute(new Float32Array(TRACERS * 6), 3);
    this.colours = new THREE.Float32BufferAttribute(new Float32Array(TRACERS * 6), 3);
    this.geometry.setAttribute('position', this.positions); this.geometry.setAttribute('color', this.colours); this.geometry.setDrawRange(0, 0);
    this.material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .85, depthWrite: false, toneMapped: false });
    this.lines = new THREE.LineSegments(this.geometry, this.material); this.lines.frustumCulled = false; parent.add(this.lines);
    this.hitGeometry = new THREE.SphereGeometry(1, 8, 6);
    this.hitMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: .55, wireframe: true, depthWrite: false, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(this.hitGeometry, this.hitMaterial, HITS); this.mesh.frustumCulled = false; this.mesh.count = 0; parent.add(this.mesh);
    this.dummy = new THREE.Object3D(); this.colour = new THREE.Color();
  }
  event(value) {
    if (this.disposed) return false;
    if (value?.type === 'shot' && point(value.from) && point(value.to) && Object.hasOwn(BATTLE_TEAMS, value.team)) {
      const slot = this.tracers[this.tracerIndex++ % TRACERS]; slot.life = .13;
      slot.from.set(...value.from); slot.to.set(...value.to); slot.colour.set(BATTLE_TEAMS[value.team]); return true;
    }
    if (value?.type === 'hit' && [value.x, value.y, value.z].every(Number.isFinite)) {
      const slot = this.hits[this.hitIndex++ % HITS]; slot.life = .35; slot.shield = value.shield === true;
      slot.position.set(value.x, value.y, value.z); return true;
    }
    return false;
  }
  update(dt, settings = {}) {
    if (this.disposed || !Number.isFinite(dt) || dt < 0) return;
    let count = 0;
    for (const slot of this.tracers) {
      if (slot.life <= 0) continue;
      slot.life -= dt; if (slot.life <= 0) continue;
      this.positions.setXYZ(count * 2, slot.from.x, slot.from.y, slot.from.z);
      this.positions.setXYZ(count * 2 + 1, slot.to.x, slot.to.y, slot.to.z);
      for (const vertex of [count * 2, count * 2 + 1]) this.colours.setXYZ(vertex, slot.colour.r, slot.colour.g, slot.colour.b);
      count++;
    }
    this.geometry.setDrawRange(0, count * 2); this.positions.needsUpdate = this.colours.needsUpdate = true;
    this.material.opacity = settings.reducedFlash ? .4 : .85; count = 0;
    for (const slot of this.hits) {
      if (slot.life <= 0) continue;
      slot.life -= dt; if (slot.life <= 0) continue;
      this.dummy.position.copy(slot.position); this.dummy.scale.setScalar((slot.shield ? .6 : .24) * (settings.reducedMotion ? 1 : 1.5 - slot.life));
      this.dummy.updateMatrix(); this.mesh.setMatrixAt(count, this.dummy.matrix);
      this.mesh.setColorAt(count++, this.colour.set(slot.shield ? 0x80edff : 0xffdf8b));
    }
    this.mesh.count = count; this.mesh.instanceMatrix.needsUpdate = true; if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.hitMaterial.opacity = settings.reducedFlash ? .22 : .55;
  }
  clear() { this.tracers.forEach(slot => { slot.life = 0; }); this.hits.forEach(slot => { slot.life = 0; }); this.geometry.setDrawRange(0, 0); this.mesh.count = 0; }
  stats() { return { tracers: this.tracers.filter(slot => slot.life > 0).length, hits: this.hits.filter(slot => slot.life > 0).length, capacities: [TRACERS, HITS] }; }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.clear();
    this.lines.removeFromParent(); this.mesh.removeFromParent(); this.geometry.dispose(); this.material.dispose(); this.hitGeometry.dispose(); this.hitMaterial.dispose(); this.mesh.dispose();
  }
}
