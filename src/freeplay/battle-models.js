import * as THREE from 'three';
import { PopulationModels } from './population-models.js';

export const BATTLE_TEAMS = Object.freeze({ blue: 0x4eacff, red: 0xff696e });
const CAPACITY = 30;

function compile(parts) {
  const positions = [], normals = [], colours = [], colour = new THREE.Color();
  for (const { geometry, matrix, tint } of parts) {
    const source = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    source.applyMatrix4(matrix); colour.set(tint);
    const p = source.attributes.position, n = source.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i)); normals.push(n.getX(i), n.getY(i), n.getZ(i));
      colours.push(colour.r, colour.g, colour.b);
    }
    source.dispose();
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  result.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  result.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  result.computeBoundingSphere(); return result;
}

export class BattleModels {
  constructor(parent) {
    this.source = new PopulationModels(); this.rig = this.source.acquire('villager', 2);
    this.rig.group.children[0].scale.setScalar(1); this.rig.group.updateMatrixWorld(true);
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true }); this.teams = new Map();
    const parts = [], limbs = new Set(this.rig.legs);
    this.rig.group.traverse(node => {
      if (node.isMesh && !limbs.has(node)) parts.push({ geometry: node.geometry, matrix: node.matrixWorld,
        tint: node.position.y < 1.2 || node.position.y > 1.55 ? null : node.material.color });
    });
    const extras = [], dummy = new THREE.Object3D();
    const box = (size, position, tint) => {
      const geometry = new THREE.BoxGeometry(...size); dummy.position.set(...position); dummy.updateMatrix();
      extras.push({ geometry, matrix: dummy.matrix.clone(), tint });
    };
    box([.49, .22, .49], [0, 1.63, 0], null); // helmet dome
    box([.58, .045, .58], [0, 1.53, .015], 0x243346); // brim
    box([.15, .15, .64], [.27, .96, .33], 0x283749); // conspicuous toy blaster
    box([.17, .11, .07], [.27, .96, .68], 0xffe285); // safety-coloured muzzle
    box([.12, .08, .24], [.27, 1.075, .29], null); // team sight
    for (const [team, tint] of Object.entries(BATTLE_TEAMS)) {
      const body = compile([...parts, ...extras].map(part => ({ ...part, tint: part.tint ?? tint })));
      const geometries = [body, ...this.rig.legs.map((limb, index) => compile([
        { geometry: limb.geometry, matrix: new THREE.Matrix4(), tint: index < 2 ? 0x273749 : tint },
      ]))];
      const batches = geometries.map(geometry => {
        const mesh = new THREE.InstancedMesh(geometry, this.material, CAPACITY);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; mesh.count = 0;
        parent.add(mesh); return mesh;
      });
      this.teams.set(team, { batches, geometries, count: 0 });
    }
    extras.forEach(part => part.geometry.dispose());
    this.offsets = this.rig.legs.map(limb => limb.position.clone());
    this.pose = new THREE.Object3D(); this.part = new THREE.Object3D(); this.matrix = new THREE.Matrix4();
  }

  begin() { for (const team of this.teams.values()) team.count = 0; }
  put(teamName, position, yaw, stride, knocked, recovery) {
    const team = this.teams.get(teamName); if (!team || team.count >= CAPACITY) return;
    const index = team.count++, pose = this.pose;
    pose.position.copy(position); pose.position.y += knocked ? .16 : Math.abs(Math.sin(stride)) * .025 * recovery;
    pose.rotation.set(0, yaw, knocked ? Math.PI / 2 : 0); pose.scale.setScalar(1); pose.updateMatrix();
    team.batches[0].setMatrixAt(index, pose.matrix);
    for (let limb = 0; limb < this.offsets.length; limb++) {
      const swing = limb >= 2 ? -1.1 + Math.sin(stride) * .04 * recovery : Math.sin(stride + limb % 2 * Math.PI) * .38 * recovery;
      this.part.position.copy(this.offsets[limb]); this.part.rotation.set(knocked ? .1 : swing, 0, 0);
      this.part.updateMatrix(); this.matrix.multiplyMatrices(pose.matrix, this.part.matrix);
      team.batches[limb + 1].setMatrixAt(index, this.matrix);
    }
  }
  end() { for (const team of this.teams.values()) for (const batch of team.batches) { batch.count = team.count; batch.instanceMatrix.needsUpdate = true; } }
  dispose() {
    for (const team of this.teams.values()) {
      team.batches.forEach(mesh => { mesh.removeFromParent(); mesh.dispose(); }); team.geometries.forEach(geometry => geometry.dispose());
    }
    this.material.dispose(); this.source.release(this.rig); this.source.dispose(); this.teams.clear();
  }
}

// One procedural atlas and one quad batch for all names; no Sprite/texture per NPC.
export class BattleLabels {
  constructor(parent) {
    this.labels = []; this.texture = null;
    if (typeof document !== 'undefined') {
      this.canvas = document.createElement('canvas'); this.canvas.width = 1024; this.canvas.height = 280;
      this.context = this.canvas.getContext('2d'); this.texture = new THREE.CanvasTexture(this.canvas);
      this.texture.colorSpace = THREE.SRGBColorSpace; this.texture.minFilter = THREE.LinearFilter; this.texture.generateMipmaps = false;
    }
    this.geometry = new THREE.BufferGeometry();
    this.position = new THREE.Float32BufferAttribute(new Float32Array(80 * 12), 3);
    this.uv = new THREE.Float32BufferAttribute(new Float32Array(80 * 8), 2); const indices = [];
    for (let i = 0; i < 80; i++) indices.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3);
    this.geometry.setAttribute('position', this.position); this.geometry.setAttribute('uv', this.uv); this.geometry.setIndex(indices);
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, alphaTest: .15, depthWrite: false, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(this.geometry, this.material); this.mesh.frustumCulled = false; this.mesh.visible = !!this.texture;
    parent.add(this.mesh); this.count = 0;
  }
  begin() { this.count = 0; this.dirty = false; }
  put(text, team, x, y, z, angle) {
    const index = this.count++; if (index >= 80) return;
    const label = `${team}:${text}`, col = index % 8, row = Math.floor(index / 8);
    if (this.labels[index] !== label) {
      this.labels[index] = label; this.dirty = true;
      if (this.context) {
        const c = this.context; c.clearRect(col * 128, row * 32, 128, 32); c.fillStyle = '#102432dd'; c.fillRect(col * 128, row * 32, 128, 32);
        c.fillStyle = team === 'blue' ? '#9cdaff' : '#ffb5b8'; c.font = 'bold 16px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(text.slice(0, 22), col * 128 + 64, row * 32 + 16, 122);
      }
    }
    const rightX = Math.cos(angle) * .72, rightZ = -Math.sin(angle) * .72;
    for (const [corner, side, height] of [[0, -1, 0], [1, 1, 0], [2, -1, .36], [3, 1, .36]]) {
      this.position.setXYZ(index * 4 + corner, x + rightX * side, y + height, z + rightZ * side);
      this.uv.setXY(index * 4 + corner, (col + (side + 1) / 2) / 8, 1 - (row + (height ? 0 : 1)) / 16);
    }
  }
  end() {
    this.geometry.setDrawRange(0, Math.min(80, this.count) * 6); this.position.needsUpdate = this.uv.needsUpdate = true;
    if (this.dirty && this.texture) this.texture.needsUpdate = true;
  }
  dispose() { this.mesh.removeFromParent(); this.geometry.dispose(); this.material.dispose(); this.texture?.dispose(); }
}
