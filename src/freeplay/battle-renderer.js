// Battle state is authoritative. This layer only interpolates and draws it.
import * as THREE from 'three';
import { BattleModels, BattleLabels, BATTLE_TEAMS } from './battle-models.js';
import { BattleEffects } from './battle-effects.js';
import { BattleFlags } from './battle-flags.js';
import { BattleEquipment } from './battle-equipment.js';
import { BattleZones } from './battle-zones.js';

const ACTORS = 80, SHIELDS = 8;
const validActor = row => row && typeof row.id === 'string' && row.id.length > 0 && row.id.length <= 96
  && Object.hasOwn(BATTLE_TEAMS, row.team) && [row.x, row.y, row.z, row.yaw, row.hp, row.respawn].every(Number.isFinite);
const validShield = row => row && typeof row.id === 'string' && Object.hasOwn(BATTLE_TEAMS, row.team)
  && [row.x, row.y, row.z, row.radius, row.remaining].every(Number.isFinite) && row.radius > 0 && row.radius <= 16 && row.remaining > 0;

export class BattleRenderer {
  constructor(scene, world) {
    this.world = world; this.disposed = false; this.actors = new Map(); this.shields = []; this.camps = []; this.clock = 0;
    this.settings = {}; this.root = new THREE.Group(); this.root.name = 'freeplay-battle'; scene.add(this.root);
    this.models = new BattleModels(this.root); this.labels = new BattleLabels(this.root); this.effects = new BattleEffects(this.root);
    this.flags = new BattleFlags(this.root);
    this.equipment = new BattleEquipment(this.root); this.zones = new BattleZones(this.root);
    this.plane = new THREE.PlaneGeometry(1, 1); this.dummy = new THREE.Object3D(); this.colour = new THREE.Color();
    this.healthMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
    this.health = new THREE.InstancedMesh(this.plane, this.healthMaterial, ACTORS * 4); this.health.frustumCulled = false; this.health.count = 0; this.root.add(this.health);
    this.domeGeometry = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    this.domeMaterial = new THREE.MeshBasicMaterial({ wireframe: true, transparent: true, opacity: .22, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this.domes = new THREE.InstancedMesh(this.domeGeometry, this.domeMaterial, SHIELDS); this.domes.frustumCulled = false; this.domes.count = 0; this.root.add(this.domes);
    this.ringGeometry = new THREE.RingGeometry(.975, 1, 48);
    this.ringMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: .6, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this.rings = new THREE.InstancedMesh(this.ringGeometry, this.ringMaterial, SHIELDS); this.rings.frustumCulled = false; this.rings.count = 0; this.root.add(this.rings);
    this.campGeometry = new THREE.BoxGeometry(1, 1, 1);
    this.campMaterial = new THREE.MeshLambertMaterial();
    this.campMesh = new THREE.InstancedMesh(this.campGeometry, this.campMaterial, 10); this.campMesh.frustumCulled = false; this.campMesh.count = 0; this.root.add(this.campMesh);
    this.pickBox = new THREE.Box3(); this.pickPoint = new THREE.Vector3(); this.pickRay = new THREE.Ray();
  }

  apply(state) {
    if (this.disposed || !state || !Array.isArray(state.soldiers) || !Array.isArray(state.players)) return false;
    const next = new Map(), teamCounts = { blue: 0, red: 0 };
    const add = (row, player, number) => {
      if (!validActor(row)) return;
      const key = `${row.kind ? 'e' : player ? 'p' : 'n'}:${row.id}`; if (next.has(key)) return;
      if (!player && !row.kind && teamCounts[row.team]++ >= 30) return;
      const knocked = row.hp <= 0 || row.respawn > 0, previous = this.actors.get(key);
      const current = previous?.current || new THREE.Vector3(row.x, row.y, row.z);
      if (previous && (previous.knocked && !knocked || current.distanceToSquared(new THREE.Vector3(row.x, row.y, row.z)) > 144)) current.set(row.x, row.y, row.z);
      next.set(key, { id: row.id, team: row.team, player, kind: row.kind, hp: Math.max(0, row.hp), shield: Math.max(0, Number.isFinite(row.shield) ? row.shield : 0),
        respawn: Math.max(0, row.respawn), knocked, current, target: new THREE.Vector3(row.x, row.y, row.z),
        yaw: previous?.yaw ?? row.yaw, targetYaw: row.yaw, stride: previous?.stride || 0,
        name: row.kind ? `Squad ${row.squad||1} ${row.kind}` : row.squad ? `Squad ${row.squad} · ${number+1}` : typeof row.name === 'string' && row.name ? row.name.slice(0, 22) : player ? row.team + ' player' : `${row.team === 'blue' ? 'Blue' : 'Red'} ${number + 1}` });
    };
    state.soldiers.slice(0, 96).forEach((row, i) => add(row, false, i));
    (state.equipment||[]).slice(0,10).forEach((row,i)=>add(row,false,i));
    state.players.slice(0, 8).forEach((row, i) => add(row, true, i)); this.actors = next;
    this.shields = (Array.isArray(state.shields) ? state.shields : []).filter(validShield).slice(0, SHIELDS).map(row => ({ ...row, age: 0 }));
    this.flags.apply(state.ctf);this.ctf=state.ctf;
    this.camps = Object.keys(BATTLE_TEAMS).flatMap(team => {
      const pos = this.flags.enabled ? state.ctf.bases?.[team] : state.camps?.[team];
      return Array.isArray(pos) && pos.length === 3 && pos.every(Number.isFinite) ? [{ team, pos: [...pos] }] : [];
    });
    return true;
  }

  bar(index, x, y, z, angle, width, height, colour, offset = 0) {
    const layer=colour===0x152735?0:.015;
    this.dummy.position.set(x + Math.cos(angle) * offset + Math.sin(angle)*layer, y, z - Math.sin(angle) * offset + Math.cos(angle)*layer);
    this.dummy.rotation.set(0, angle, 0); this.dummy.scale.set(width, height, 1); this.dummy.updateMatrix();
    this.health.setMatrixAt(index, this.dummy.matrix); this.health.setColorAt(index, this.colour.set(colour));
  }

  update(dt, playerPos) {
    if (this.disposed || !Number.isFinite(dt) || dt < 0 || !playerPos || ![playerPos.x, playerPos.y, playerPos.z].every(Number.isFinite)) return;
    dt = Math.min(dt, .1); this.clock += dt; let bars = 0;
    this.models.begin(); this.labels.begin(); this.equipment.begin();
    for (const actor of this.actors.values()) {
      const beforeX = actor.current.x, beforeZ = actor.current.z;
      actor.current.lerp(actor.target, Math.min(1, dt * 14));
      const moved = Math.hypot(actor.current.x - beforeX, actor.current.z - beforeZ);
      actor.stride += moved * 8; actor.yaw += Math.atan2(Math.sin(actor.targetYaw - actor.yaw), Math.cos(actor.targetYaw - actor.yaw)) * Math.min(1, dt * 14);
      const p = actor.current, distance = Math.hypot(p.x - playerPos.x, p.z - playerPos.z);
      const loaded = this.world?.isLoaded ? this.world.isLoaded(Math.floor(p.x), Math.floor(p.z)) : true;
      if (!loaded || distance > 170) continue;
      if(actor.kind)this.equipment.put(actor);
      else if (!actor.player) this.models.put(actor.team, p, actor.yaw, actor.stride, actor.knocked, this.settings.reducedMotion ? 0 : Math.min(1, moved / Math.max(dt, .001)));
      if (distance < .9 && Math.abs(p.y - playerPos.y) < 2.2) continue;
      const angle = Math.atan2(playerPos.x - p.x, playerPos.z - p.z), health = Math.min(1, actor.hp / (actor.player || actor.kind==='tank' ? 100 : actor.kind==='turret' ? 75 : 50));
      const shield = Math.min(1, actor.shield / 100), y = p.y + (actor.knocked ? .7 : 1.94);
      this.bar(bars++, p.x, y, p.z, angle, .88, .14, 0x152735);
      this.bar(bars++, p.x, y + .001, p.z, angle, Math.max(.001, .84 * health), .08, actor.knocked ? 0xffd579 : 0x97e89d, -.42 * (1 - health));
      this.bar(bars++, p.x, y - .105, p.z, angle, Math.max(.001, .84 * shield), .035, 0x8feeff, -.42 * (1 - shield));
      this.bar(bars++, p.x, y + .1, p.z, angle, .15, .15, actor.knocked ? 0xffd579 : BATTLE_TEAMS[actor.team], -.58);
      this.labels.put(actor.knocked ? `Recovering ${Math.ceil(actor.respawn)}s` : actor.name, actor.team, p.x, y + .12, p.z, angle);
    }
    this.models.end(); this.labels.end(); this.equipment.end(); this.health.count = bars; this.health.instanceMatrix.needsUpdate = true;
    if (this.health.instanceColor) this.health.instanceColor.needsUpdate = true;
    let shieldCount = 0;
    for (const shield of this.shields) {
      shield.age += dt; if (shield.age >= shield.remaining) continue;
      this.dummy.position.set(shield.x, shield.y + .03, shield.z); this.dummy.rotation.set(0, 0, 0); this.dummy.scale.setScalar(shield.radius); this.dummy.updateMatrix();
      this.domes.setMatrixAt(shieldCount, this.dummy.matrix); this.domes.setColorAt(shieldCount, this.colour.set(BATTLE_TEAMS[shield.team]));
      this.dummy.rotation.x = -Math.PI / 2; this.dummy.updateMatrix(); this.rings.setMatrixAt(shieldCount, this.dummy.matrix); this.rings.setColorAt(shieldCount++, this.colour);
    }
    for (const mesh of [this.domes, this.rings]) { mesh.count = shieldCount; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
    this.updateCamps();
    this.flags.update(this.actors, this.world, playerPos);this.zones.update(this.ctf,this.world);
    this.effects.update(dt, this.settings);
  }

  updateCamps() {
    let count = 0;
    for (const { team, pos: [x, y, z] } of this.camps) {
      if (this.world?.isLoaded && !this.world.isLoaded(Math.floor(x), Math.floor(z))) continue;
      const colour = BATTLE_TEAMS[team];
      // Tall team flags and a small camp plinth remain legible above fortifications.
      const parts = [[0, .06, 0, 2.4, .12, 2.4, colour], [0, 2.5, 0, .13, 5, .13, 0xe0e7df],
        [1.2, 4.12, 0, 2.4, 1.5, .12, colour], [1.2, 4.12, 0, .16, .85, .14, 0xffffff], [1.2, 4.12, 0, .85, .16, .14, 0xffffff]];
      if (this.flags.enabled) parts.length = 1; // Empty base plinth persists when the actual objective flag moves.
      for (const [dx, dy, dz, sx, sy, sz, tint] of parts) {
        this.dummy.position.set(x + dx, y + dy, z + dz); this.dummy.rotation.set(0, 0, 0); this.dummy.scale.set(sx, sy, sz); this.dummy.updateMatrix();
        this.campMesh.setMatrixAt(count, this.dummy.matrix); this.campMesh.setColorAt(count++, this.colour.set(tint));
      }
    }
    this.campMesh.count = count; this.campMesh.instanceMatrix.needsUpdate = true;
    if (this.campMesh.instanceColor) this.campMesh.instanceColor.needsUpdate = true;
  }

  event(value) { return this.effects.event(value?.type === 'battle-event' ? value.event : value); }

  pick(ray, maxDistance = 100) {
    if (this.disposed || !(ray instanceof THREE.Ray) || !Number.isFinite(maxDistance) || maxDistance <= 0
      || ![...ray.origin.toArray(), ...ray.direction.toArray()].every(Number.isFinite) || ray.direction.lengthSq() === 0) return null;
    this.pickRay.copy(ray); this.pickRay.direction.normalize(); let nearest = maxDistance, id = null;
    for (const actor of this.actors.values()) {
      if (actor.player || actor.knocked) continue;
      const p = actor.current;
      if (this.world?.isLoaded && !this.world.isLoaded(Math.floor(p.x), Math.floor(p.z))) continue;
      this.pickBox.min.set(p.x - .4, p.y, p.z - .4); this.pickBox.max.set(p.x + .4, p.y + 1.8, p.z + .4);
      if (!this.pickRay.intersectBox(this.pickBox, this.pickPoint)) continue;
      const distance = this.pickPoint.distanceTo(ray.origin); if (distance <= nearest) { nearest = distance; id = actor.id; }
    }
    return id;
  }

  clear() {
    this.actors.clear(); this.shields = []; this.camps = []; this.models.begin(); this.models.end(); this.labels.begin(); this.labels.end();
    this.health.count = this.domes.count = this.rings.count = this.campMesh.count = 0; this.effects.clear(); this.flags.clear();this.equipment.begin();this.equipment.end();this.zones.clear();this.ctf=null;
  }
  stats() { return { soldiers: [...this.actors.values()].filter(actor => !actor.player).length, players: [...this.actors.values()].filter(actor => actor.player).length,
    knocked: [...this.actors.values()].filter(actor => actor.knocked).length, shields: this.domes.count, batches: this.root.children.length, effects: this.effects.stats() }; }
  dispose() {
    if (this.disposed) return; this.clear(); this.disposed = true; this.root.removeFromParent(); this.models.dispose(); this.labels.dispose(); this.effects.dispose(); this.flags.dispose();this.equipment.dispose();this.zones.dispose();
    for (const mesh of [this.health, this.domes, this.rings, this.campMesh]) mesh.dispose();
    for (const geometry of [this.plane, this.domeGeometry, this.ringGeometry, this.campGeometry]) geometry.dispose();
    for (const material of [this.healthMaterial, this.domeMaterial, this.ringMaterial, this.campMaterial]) material.dispose();
  }
}
