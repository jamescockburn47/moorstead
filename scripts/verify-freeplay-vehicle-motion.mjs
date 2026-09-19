import assert from 'node:assert/strict';
import { createVehicleBody, vehiclePoint, vehicleAABB, stepVehicle, VEHICLE_LIMITS } from '../src/freeplay/vehicle-motion.js';

const close = (a, b, epsilon = 1e-7) => assert(Math.abs(a - b) < epsilon, `${a} should equal ${b}`);
const body = createVehicleBody([[0, 0, 0, 206]]);
const ground = (x, y, z) => ({ loaded: true, solid: y <= 0, water: false });
const step = (shape, pose, input, mode = 'car', probe = ground, dt = .05) => stepVehicle(shape, pose, input, dt, { mode, probe });
const advance = (pose, count, input, mode = 'car', probe = ground, shape = body) => {
  for (let i = 0; i < count; i++) pose = step(shape, pose, input, mode, probe).pose;
  return pose;
};

// The same local voxels survive every quarter turn, including non-origin control seats.
{
  const rows = [[0, 0, 0, 200], [3, 1, 2, 206]], shape = createVehicleBody(rows);
  assert.deepEqual(shape.control, [3, 1, 2]);
  for (let q = 0; q < 4; q++) {
    const pose = { x: 10, y: 20, z: 30, yaw: q * Math.PI / 2 };
    const transforms = [[3, 2], [-2, 3], [-3, -2], [2, -3]];
    const p = vehiclePoint(pose, shape.control);
    close(p.x, 10.5 + transforms[q][0]); close(p.z, 30.5 + transforms[q][1]); close(p.y, 21.5);
    const box = vehicleAABB(shape, pose);
    for (const row of rows) {
      const centre = vehiclePoint(pose, row);
      assert(centre.x - .5 >= box.min[0] - 1e-7 && centre.x + .5 <= box.max[0] + 1e-7);
      assert(centre.z - .5 >= box.min[2] - 1e-7 && centre.z + .5 <= box.max[2] + 1e-7);
    }
  }
  const diagonal = vehicleAABB(body, { x: 0, y: 5, z: 0, yaw: Math.PI / 4 });
  close(diagonal.max[0] - diagonal.min[0], Math.SQRT2);
  assert.throws(() => createVehicleBody([]));
  assert.throws(() => createVehicleBody([[0, 0, 0, 0]]));
  assert.throws(() => createVehicleBody([[0, 12, 0, 200]]));
  assert.throws(() => createVehicleBody([[16, 0, 0, 200]]));
  assert.throws(() => createVehicleBody([[0, 0, 0, 200], [0, 0, 0, 206]]));
  assert.throws(() => createVehicleBody([[0, 0, 0, 200]], [1, 0, 0]));
  assert.throws(() => createVehicleBody(Array.from({ length: 513 }, () => [0, 0, 0, 200])));
}

// Cardinal and continuous steering, reverse, speed caps, and immutable caller state.
{
  const start = { x: 0, y: 1, z: 0, yaw: 0 }, before = JSON.stringify(start);
  for (const [yaw, dx, dz] of [[0, 0, -.6], [Math.PI / 2, .6, 0], [Math.PI, 0, .6], [-Math.PI / 2, -.6, 0]]) {
    const result = step(body, { ...start, yaw }, { forward: 1 });
    close(result.pose.x, dx); close(result.pose.z, dz); close(result.pose.y, 1); assert(!result.blocked);
  }
  close(step(body, start, { forward: -1 }).pose.z, .6);
  const turned = step(body, start, { forward: 1, turn: 1 });
  close(turned.pose.yaw, .09); assert(turned.pose.x > 0 && turned.pose.z < 0);
  assert.equal(JSON.stringify(start), before);
  const longFrame = step(body, { ...start, y: 10 }, { forward: 100, lift: 100, turn: 100 }, 'plane', ground, 10);
  assert(Math.hypot(longFrame.pose.x, longFrame.pose.z) <= 1 + 1e-7);
  close(longFrame.pose.y, 10.6); close(longFrame.pose.yaw, .09);
  assert.throws(() => step(body, start, {}, 'boat'));
  assert.throws(() => step(body, { ...start, x: NaN }, {}));
}

// The deliberately inadequate endpoint-only jump would cross this one-voxel wall.
{
  const wall = (x, y, z) => ({ loaded: true, solid: y <= 0 || z === -3, water: false });
  const start = { x: 0, y: 10, z: 0, yaw: 0 };
  assert.equal(wall(0, 10, -20).solid, false, 'An endpoint-only 1s move misses the wall');
  const atWall = advance(start, 40, { forward: 1 }, 'plane', wall);
  assert(atWall.z >= -2 - 1e-6 && atWall.z < -.9, 'Fast flight stops before the thin wall');
  assert(step(body, atWall, { forward: 1 }, 'plane', wall).blocked);
  const down = advance({ ...start, y: 3 }, 40, { lift: -1 }, 'plane');
  assert(down.y >= 1 && down.y < 1.3);
  const boundary = step(body, { x: 8192, y: 2, z: 0, yaw: Math.PI / 2 }, { forward: 1 }, 'plane');
  assert(boundary.blocked); close(boundary.pose.x, 8192);
  const ceiling = step(body, { ...start, y: 179 }, { lift: 1 }, 'plane');
  assert.equal(ceiling.reason, 'boundary'); close(ceiling.pose.y, 179);
  const unknown = (x, y, z) => ({ loaded: z >= -2, solid: false, water: false });
  assert(advance(start, 20, { forward: 1 }, 'plane', unknown).z >= -2);
}

// A sparse construction collides only where it has blocks, not throughout its box.
{
  const arch = createVehicleBody([[0, 0, 0, 206], [2, 0, 0, 200], [0, 1, 0, 200], [1, 1, 0, 200], [2, 1, 0, 200]]);
  const obstacle = (x, y, z) => ({ loaded: true, solid: x === 1 && y === 5 && z === 0, water: false });
  const pose = { x: 0, y: 5, z: 0, yaw: 0 };
  assert.equal(step(arch, pose, {}, 'plane', obstacle, 0).blocked, false);
  const filled = createVehicleBody([...arch.cells, [1, 0, 0, 200]]);
  assert.equal(step(filled, pose, {}, 'plane', obstacle, 0).reason, 'solid');
  const long = createVehicleBody([[0, 0, 0, 206], [15, 0, 0, 200]]);
  const cornerWall = (x, y, z) => ({ loaded: true, solid: x === 15 && z === 1, water: false });
  const turn = step(long, pose, { turn: 1 }, 'plane', cornerWall);
  assert(turn.blocked && turn.pose.yaw < .09, 'Swept turn cannot swing a distant voxel through a wall');
}

// Grounded vehicles climb a single step, reject taller cliffs and low roofs, then settle.
{
  const start = { x: 0, y: 1, z: 0, yaw: 0 };
  const stairs = (x, y, z) => ({ loaded: true, solid: y <= 0 || z <= -2 && y === 1, water: false });
  const climbed = advance(start, 8, { forward: 1 }, 'car', stairs);
  assert(climbed.z < -3); close(climbed.y, 2);
  const wall = (x, y, z) => ({ loaded: true, solid: y <= 0 || z <= -2 && y <= 2, water: false });
  const stopped = advance(start, 8, { forward: 1 }, 'car', wall);
  assert(stopped.z >= -1 - 1e-6); close(stopped.y, 1);
  const roof = (x, y, z) => ({ ...stairs(x, y, z), solid: stairs(x, y, z).solid || y === 2 && z >= -1 });
  assert(advance(start, 8, { forward: 1 }, 'car', roof).z >= -1 - 1e-6);
  close(advance({ ...start, y: 5 }, 20, {}, 'car').y, 1);
  const water = (x, y, z) => ({ loaded: true, solid: y <= 0, water: z <= -2 && y <= 2 });
  assert(advance(start, 10, { forward: 1 }, 'car', water).z >= -1.5 - 1e-6);
}

// A submarine can reach water from land, dive, rise to the surface, and never fly.
{
  const start = { x: 0, y: 1, z: 0, yaw: 0 };
  const land = step(body, start, { forward: 1, lift: 1 }, 'submarine');
  close(land.pose.y, 1); close(land.pose.z, -.2);
  const sea = (x, y, z) => ({ loaded: true, solid: y <= 0, water: y >= 1 && y <= 5 });
  const diving = advance({ ...start, y: 4 }, 5, { forward: 1, lift: -1 }, 'submarine', sea);
  assert(diving.y < 3 && diving.z < -1.8);
  const surfaced = advance({ ...start, y: 4 }, 20, { lift: 1 }, 'submarine', sea);
  assert(surfaced.y <= 5.5 && surfaced.y > 5.2, 'Control stays below the water surface');
  const dock = (x, y, z) => ({ loaded: true, solid: y <= 0, water: z <= -2 && y >= 1 && y <= 5 });
  const entered = advance(start, 20, { forward: 1, lift: 1 }, 'submarine', dock);
  assert(entered.z < -4 && entered.y > 1, 'Land-built sub reaches water before gaining lift');
  const rock = (x, y, z) => ({ ...sea(x, y, z), solid: y <= 0 || z === -3 });
  assert(advance({ ...start, y: 3 }, 20, { forward: 1 }, 'submarine', rock).z >= -2 - 1e-6);
}

// Largest allowed body/frame stays bounded; lookup caching avoids per-voxel duplicate I/O.
{
  const rows = [];
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 0; y < 2; y++) rows.push([x, y, z, 200]);
  const largest = createVehicleBody(rows), unique = new Set(); let calls = 0;
  const probe = (x, y, z) => { calls++; unique.add(`${x},${y},${z}`); return ground(x, y, z); };
  const result = step(largest, { x: 0, y: 20, z: 0, yaw: .7 }, { forward: 1, turn: 1, lift: 1 }, 'plane', probe, 100);
  assert(!result.blocked); assert.equal(calls, unique.size); assert(calls < 10000);
  assert.equal(VEHICLE_LIMITS.substeps, 16); assert.equal(VEHICLE_LIMITS.dt, .05);
}
console.log('PASS free-play vehicle motion: bounded continuous steering, voxel collisions, steps/roofs, water/land modes, world limits and geometry parity');
