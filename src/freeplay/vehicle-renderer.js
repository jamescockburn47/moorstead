// Borrow the terrain atlas; own only the merged vehicle geometry and materials.
import * as THREE from 'three';
import { BLOCKS } from '../defs.js';
import { tileUV } from '../textures.js';

const MAX_VEHICLES = 16, MAX_CELLS = 512;
const FACES = [
  { dir: [-1, 0, 0], corners: [[0, 1, 0, 0, 1], [0, 0, 0, 0, 0], [0, 1, 1, 1, 1], [0, 0, 1, 1, 0]] },
  { dir: [1, 0, 0], corners: [[1, 1, 1, 0, 1], [1, 0, 1, 0, 0], [1, 1, 0, 1, 1], [1, 0, 0, 1, 0]] },
  { dir: [0, -1, 0], corners: [[1, 0, 1, 1, 0], [0, 0, 1, 0, 0], [1, 0, 0, 1, 1], [0, 0, 0, 0, 1]] },
  { dir: [0, 1, 0], corners: [[0, 1, 1, 1, 1], [1, 1, 1, 0, 1], [0, 1, 0, 1, 0], [1, 1, 0, 0, 0]] },
  { dir: [0, 0, -1], corners: [[1, 0, 0, 0, 0], [0, 0, 0, 1, 0], [1, 1, 0, 0, 1], [0, 1, 0, 1, 1]] },
  { dir: [0, 0, 1], corners: [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [0, 1, 1, 0, 1], [1, 1, 1, 1, 1]] },
];
const SHADE = [.82, .82, .6, 1, .74, .74];
const validPose = pose => pose && ['x', 'y', 'z', 'yaw'].every(key => Number.isFinite(pose[key]));
const cellKey = (x, y, z) => `${x},${y},${z}`;

function validCells(cells) {
  if (!Array.isArray(cells) || !cells.length || cells.length > MAX_CELLS) return false;
  const seen = new Set();
  for (const row of cells) {
    if (!Array.isArray(row) || row.length !== 4 || !row.every(Number.isSafeInteger)
      || row[0] < 0 || row[0] > 15 || row[1] < 0 || row[1] > 11 || row[2] < 0 || row[2] > 15
      || !BLOCKS[row[3]]?.tex) return false;
    const key = cellKey(...row); if (seen.has(key)) return false; seen.add(key);
  }
  return true;
}

function mergedGeometry(cells) {
  const occupied = new Map(cells.map(row => [cellKey(...row), row[3]]));
  const position = [], normal = [], uv = [], colour = [], indices = [[], []];
  for (const [x, y, z, id] of cells) {
    const def = BLOCKS[id], pass = def.kind === 'cutout' ? 1 : 0;
    for (let f = 0; f < FACES.length; f++) {
      const { dir, corners } = FACES[f], neighbour = occupied.get(cellKey(x + dir[0], y + dir[1], z + dir[2]));
      if (neighbour != null && (BLOCKS[neighbour].kind !== 'cutout' || neighbour === id)) continue;
      const tile = f === 3 ? def.tex.t : f === 2 ? def.tex.b : f === 5 && def.sFront != null ? def.sFront : def.tex.s;
      const [u0, v0, u1, v1] = tileUV(tile), base = position.length / 3;
      for (const corner of corners) {
        position.push(x + corner[0] - .5, y + corner[1], z + corner[2] - .5);
        normal.push(...dir); uv.push(u0 + corner[3] * (u1 - u0), v0 + corner[4] * (v1 - v0));
        colour.push(SHADE[f], SHADE[f], SHADE[f]);
      }
      indices[pass].push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colour, 3));
  geometry.setIndex(indices.flat());
  let offset = 0;
  indices.forEach((list, material) => { if (list.length) geometry.addGroup(offset, list.length, material); offset += list.length; });
  geometry.computeBoundingBox(); geometry.computeBoundingSphere(); return geometry;
}

export class VehicleRenderer {
  constructor(scene, texture) {
    this.root = new THREE.Group(); this.root.name = 'freeplay-vehicles'; scene.add(this.root);
    this.vehicles = new Map(); this.disposed = false; this.raycaster = new THREE.Raycaster();
    this.materials = [new THREE.MeshLambertMaterial({ map: texture, vertexColors: true }),
      new THREE.MeshLambertMaterial({ map: texture, vertexColors: true, alphaTest: .45, side: THREE.DoubleSide })];
    this.selection = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({
      color: 0x79ffbf, transparent: true, opacity: .9, depthTest: false, depthWrite: false, toneMapped: false }));
    this.selection.name = 'vehicle-selected-cells'; this.selection.visible = false; this.selection.renderOrder = 9;
    this.root.add(this.selection);
  }

  upsert(vehicle) {
    if (this.disposed || typeof vehicle?.id !== 'string' || !vehicle.id.length || vehicle.id.length > 80
      || !validCells(vehicle.cells) || !validPose(vehicle.pose)) return false;
    let item = this.vehicles.get(vehicle.id);
    if (!item && this.vehicles.size >= MAX_VEHICLES) return false;
    const signature = vehicle.cells.map(row => row.join(',')).join(';');
    if (!item || item.signature !== signature) {
      const geometry = mergedGeometry(vehicle.cells);
      if (item) { item.mesh.geometry.dispose(); item.mesh.geometry = geometry; }
      else {
        const group = new THREE.Group(), mesh = new THREE.Mesh(geometry, this.materials);
        group.name = `vehicle:${vehicle.id}`; mesh.userData.vehicleId = vehicle.id;
        group.add(mesh); this.root.add(group); item = { group, mesh };
        this.vehicles.set(vehicle.id, item);
      }
      item.signature = signature;
    }
    this.setPose(vehicle.id, vehicle.pose); return true;
  }

  setPose(id, pose) {
    const item = this.vehicles.get(id); if (this.disposed || !item || !validPose(pose)) return false;
    item.group.position.set(pose.x + .5, pose.y, pose.z + .5); item.group.rotation.y = -pose.yaw;
    item.group.updateMatrixWorld(true); return true;
  }

  update(vehiclesById) {
    if (this.disposed || !vehiclesById) return;
    for (const [id, item] of this.vehicles) {
      const vehicle = vehiclesById instanceof Map ? vehiclesById.get(id) : vehiclesById[id];
      if (vehicle) this.setPose(id, vehicle.pose);
    }
  }

  pick(ray, maxDistance = 12) {
    if (this.disposed || !ray?.isRay && !(ray instanceof THREE.Ray) || !Number.isFinite(maxDistance) || maxDistance <= 0) return null;
    if (![ray.origin.x, ray.origin.y, ray.origin.z, ray.direction.x, ray.direction.y, ray.direction.z].every(Number.isFinite)
      || ray.direction.lengthSq() < .000001) return null;
    this.root.updateMatrixWorld(true); this.raycaster.ray.copy(ray); this.raycaster.ray.direction.normalize();
    this.raycaster.near = 0; this.raycaster.far = maxDistance;
    const hit = this.raycaster.intersectObjects([...this.vehicles.values()].map(item => item.mesh), false)[0];
    return hit?.object.userData.vehicleId ?? null;
  }

  setSelection(cells) {
    if (this.disposed) return false;
    if (cells == null || Array.isArray(cells) && !cells.length) { this.selection.visible = false; return true; }
    if (!Array.isArray(cells) || cells.length > MAX_CELLS || cells.some(row => !Array.isArray(row)
      || row.length < 3 || !row.slice(0, 3).every(Number.isSafeInteger))) return false;
    const signature = cells.map(row => row.slice(0, 3).join(',')).join(';');
    if (this.selectionSignature === signature) { this.selection.visible = true; return true; }
    const segments = [], edges = new Set();
    for (const [x, y, z] of cells) for (let axis = 0; axis < 3; axis++) {
      const other = [0, 1, 2].filter(value => value !== axis);
      for (const a of [0, 1]) for (const b of [0, 1]) {
        const from = [x, y, z]; from[other[0]] += a; from[other[1]] += b;
        const to = [...from]; to[axis]++;
        const key = from.join(',') + ':' + axis;
        if (!edges.has(key)) { edges.add(key); segments.push(...from, ...to); }
      }
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3));
    geometry.computeBoundingSphere(); this.selection.geometry.dispose(); this.selection.geometry = geometry;
    this.selectionSignature = signature; this.selection.visible = true; return true;
  }

  remove(id) {
    const item = this.vehicles.get(id); if (!item) return false;
    item.group.removeFromParent(); item.mesh.geometry.dispose(); this.vehicles.delete(id); return true;
  }
  clear() { for (const id of [...this.vehicles.keys()]) this.remove(id); this.setSelection(null); }
  dispose() {
    if (this.disposed) return;
    this.clear(); this.disposed = true; this.root.removeFromParent();
    this.selection.geometry.dispose(); this.selection.material.dispose(); this.materials.forEach(material => material.dispose());
  }
}
