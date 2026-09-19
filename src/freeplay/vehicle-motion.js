// Pure arcade motion. The caller supplies terrain; this module never edits it.
export const VEHICLE_LIMITS = Object.freeze({ blocks: 512, size: [16, 12, 16], dt: .05,
  world: 8192, ceiling: 180, turnSpeed: 1.8, stepHeight: 1, fallSpeed: 8, substeps: 16 });
export const VEHICLE_MODES = Object.freeze({
  car: Object.freeze({ speed: 12, lift: 0 }),
  plane: Object.freeze({ speed: 20, lift: 12 }),
  submarine: Object.freeze({ speed: 8, lift: 6 }),
});
const EPS = 1e-6, STRIDE = .2, TAU = Math.PI * 2;
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const axisInput = n => Number.isFinite(n) ? clamp(n, -1, 1) : 0;
const wrap = n => ((n + Math.PI) % TAU + TAU) % TAU - Math.PI;
const finitePose = p => p && ['x', 'y', 'z', 'yaw'].every(key => Number.isFinite(p[key]));

export function createVehicleBody(rows, control = null) {
  if (!Array.isArray(rows) || !rows.length || rows.length > VEHICLE_LIMITS.blocks) throw new Error('A vehicle needs 1–512 blocks.');
  const seen = new Set(), lowest = new Map(), cells = [], min = [Infinity, Infinity, Infinity], max = [-1, -1, -1];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 4 || !row.every(Number.isSafeInteger)
      || row.slice(0, 3).some((n, i) => n < 0 || n >= VEHICLE_LIMITS.size[i]) || row[3] < 1 || row[3] > 255) {
      throw new Error('Vehicle blocks must fit 16 × 12 × 16.');
    }
    const [x, y, z, id] = row, key = `${x},${y},${z}`, column = `${x},${z}`;
    if (seen.has(key)) throw new Error('A vehicle repeats a block.');
    seen.add(key); const cell = Object.freeze([...row]); cells.push(cell);
    if (!lowest.has(column) || lowest.get(column)[1] > y) lowest.set(column, cell);
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], row[i]); max[i] = Math.max(max[i], row[i]); }
    if (!control && id === 206) control = [x, y, z];
  }
  control ||= cells[0].slice(0, 3);
  if (!Array.isArray(control) || control.length !== 3 || !control.every(Number.isSafeInteger) || !seen.has(control.join(','))) {
    throw new Error('The control must belong to the vehicle.');
  }
  const radius = Math.hypot(max[0], max[2]) + Math.SQRT1_2;
  return Object.freeze({ cells: Object.freeze(cells), floor: Object.freeze([...lowest.values()]),
    min: Object.freeze(min), max: Object.freeze(max), control: Object.freeze([...control]), radius });
}

// x/z rotate about the centre of voxel (0,0,0), matching integer quarter-turn parking.
// A Three.js group uses position(pose.x+.5,pose.y,pose.z+.5), rotation.y=-pose.yaw;
// its block centres are local(x,y+.5,z).
export function vehiclePoint(pose, local) {
  const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
  return { x: pose.x + .5 + local[0] * c - local[2] * s,
    y: pose.y + local[1] + .5, z: pose.z + .5 + local[0] * s + local[2] * c };
}

export function vehicleAABB(body, pose) {
  const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw), half = (Math.abs(c) + Math.abs(s)) / 2;
  const min = [Infinity, pose.y + body.min[1], Infinity], max = [-Infinity, pose.y + body.max[1] + 1, -Infinity];
  for (const x of [body.min[0], body.max[0]]) for (const z of [body.min[2], body.max[2]]) {
    const p = vehiclePoint(pose, [x, 0, z]);
    min[0] = Math.min(min[0], p.x - half); max[0] = Math.max(max[0], p.x + half);
    min[2] = Math.min(min[2], p.z - half); max[2] = Math.max(max[2], p.z + half);
  }
  return { min, max };
}

function footprint(pose, cell) {
  const p = vehiclePoint(pose, cell), half = (Math.abs(Math.cos(pose.yaw)) + Math.abs(Math.sin(pose.yaw))) / 2;
  return { x0: Math.floor(p.x - half + EPS), x1: Math.floor(p.x + half - EPS),
    z0: Math.floor(p.z - half + EPS), z1: Math.floor(p.z + half - EPS), bottom: p.y - .5 };
}

function collision(body, pose, probe) {
  const box = vehicleAABB(body, pose), limit = VEHICLE_LIMITS.world;
  if (box.min[0] < -limit || box.min[2] < -limit || box.max[0] > limit + 1 || box.max[2] > limit + 1
    || box.min[1] < 1 - EPS || box.max[1] > VEHICLE_LIMITS.ceiling + EPS) return 'boundary';
  for (const cell of body.cells) {
    const f = footprint(pose, cell);
    for (let x = f.x0; x <= f.x1; x++) for (let z = f.z0; z <= f.z1; z++) {
      for (let y = Math.floor(f.bottom + EPS); y <= Math.floor(f.bottom + 1 - EPS); y++) {
        const block = probe(x, y, z);
        if (!block.loaded) return 'unloaded';
        if (block.solid) return 'solid';
      }
    }
  }
  return null;
}

function controlWater(body, pose, probe) {
  const p = vehiclePoint(pose, body.control), block = probe(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
  return block.loaded && block.water;
}

function settle(body, pose, distance, probe) {
  let ground = -Infinity;
  for (const cell of body.floor) {
    const f = footprint(pose, cell);
    for (let x = f.x0; x <= f.x1; x++) for (let z = f.z0; z <= f.z1; z++) {
      for (let y = Math.floor(f.bottom - EPS); y >= Math.floor(f.bottom - distance - EPS); y--) {
        const block = probe(x, y, z);
        if (!block.loaded) return { pose, reason: 'unloaded' };
        if (block.solid) { ground = Math.max(ground, y + 1 - cell[1]); break; }
      }
    }
  }
  const next = { ...pose, y: Math.max(1 - body.min[1], pose.y - distance, ground) };
  const reason = collision(body, next, probe);
  return { pose: reason ? pose : next, reason };
}

function groundStep(body, current, target, dt, probe, car) {
  let next = target, reason = collision(body, next, probe);
  if (reason === 'solid') {
    // Sweep upwards before stepping forward; a low roof cannot be crossed by a jump.
    let clearance = true;
    for (let lift = STRIDE; lift <= VEHICLE_LIMITS.stepHeight + EPS; lift += STRIDE) {
      if (collision(body, { ...current, y: current.y + lift }, probe)) { clearance = false; break; }
    }
    const raised = { ...target, y: current.y + VEHICLE_LIMITS.stepHeight };
    if (clearance && !collision(body, raised, probe)) { next = raised; reason = null; }
  }
  if (!reason && car && controlWater(body, next, probe)) reason = 'water';
  if (reason) return { pose: current, reason };
  return settle(body, next, VEHICLE_LIMITS.fallSpeed * dt, probe);
}

export function stepVehicle(body, pose, input, dt, { mode = 'car', probe } = {}) {
  if (!body?.cells || !finitePose(pose) || !VEHICLE_MODES[mode] || typeof probe !== 'function'
    || !Number.isFinite(dt) || dt < 0) throw new Error('Invalid vehicle movement input.');
  const cache = new Map();
  const terrain = (x, y, z) => {
    const key = `${x},${y},${z}`;
    if (!cache.has(key)) {
      const value = probe(x, y, z);
      cache.set(key, { loaded: value?.loaded === true, solid: value?.solid === true, water: value?.water === true });
    }
    return cache.get(key);
  };
  let current = { x: pose.x, y: pose.y, z: pose.z, yaw: wrap(pose.yaw) };
  const initial = collision(body, current, terrain);
  if (initial || !dt) return { pose: current, blocked: !!initial, reason: initial };
  const elapsed = Math.min(dt, VEHICLE_LIMITS.dt), forward = axisInput(input?.forward), turn = axisInput(input?.turn), lift = axisInput(input?.lift);
  const spec = VEHICLE_MODES[mode], travel = Math.hypot(spec.speed * forward, Math.max(spec.lift * Math.abs(lift), VEHICLE_LIMITS.fallSpeed));
  const steps = Math.min(VEHICLE_LIMITS.substeps, Math.max(1, Math.ceil(elapsed * (travel + Math.abs(turn) * VEHICLE_LIMITS.turnSpeed * body.radius) / STRIDE)));
  const delta = elapsed / steps;
  let reason = null;
  for (let i = 0; i < steps; i++) {
    const underwater = mode === 'submarine' && controlWater(body, current, terrain);
    const grounded = mode === 'car' || mode === 'submarine' && !underwater;
    const speed = mode === 'submarine' && !underwater ? 4 : spec.speed;
    const yaw = wrap(current.yaw + turn * VEHICLE_LIMITS.turnSpeed * delta);
    const target = { x: current.x + Math.sin(yaw) * forward * speed * delta,
      y: current.y + (grounded ? 0 : lift * spec.lift * delta),
      z: current.z - Math.cos(yaw) * forward * speed * delta, yaw };
    if (underwater && lift > 0 && !controlWater(body, target, terrain)) { target.y = current.y; reason = 'surface'; }
    if (grounded) {
      const result = groundStep(body, current, target, delta, terrain, mode === 'car');
      if (result.reason) { reason = result.reason; break; }
      current = result.pose;
    } else {
      const blocked = collision(body, target, terrain);
      if (blocked) { reason = blocked; break; }
      current = target;
    }
  }
  return { pose: current, blocked: !!reason, reason };
}
