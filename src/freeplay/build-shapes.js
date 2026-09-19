// Pure preview counterpart to the server's bounded, atomic building commands.
import { FREEPLAY } from './config.js';

export const MAX_BUILD_CELLS = 1024;
export const BRUSH_SIZES = Object.freeze([3, 5, 7]);
export const BUILD_SHAPES = Object.freeze([
  { id: 'line', name: 'Line', prefab: false },
  { id: 'wall', name: 'Wall', prefab: false },
  { id: 'floor', name: 'Floor', prefab: false },
  { id: 'box', name: 'Hollow box', prefab: false },
  { id: 'base', name: 'Space base', prefab: true, dimensions: [5, 5, 5] },
  { id: 'tower', name: 'Neon tower', prefab: true, dimensions: [5, 9, 5] },
  { id: 'bridge', name: 'Sky bridge', prefab: true, dimensions: [3, 3, 13] },
].map(row => Object.freeze({ ...row, ...(row.dimensions ? { dimensions: Object.freeze(row.dimensions) } : {}) })));

const STAIR = Object.freeze([[2, 1], [3, 1], [3, 2], [3, 3], [2, 3], [1, 3], [1, 2], [1, 1]]);
const validBlock = id => Number.isInteger(id) && ((id >= 1 && id <= 62) || (id >= 200 && id <= 206));
const coordinate = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;

export function buildDimensions(shape, size) {
  const info = BUILD_SHAPES.find(row => row.id === shape);
  if (!info) throw new Error('Choose a building shape.');
  if (info.prefab) {
    if (size !== undefined) throw new Error('Prefabs have a fixed size.');
    return [...info.dimensions];
  }
  if (!BRUSH_SIZES.includes(size)) throw new Error('Choose a brush size of 3, 5 or 7.');
  return shape === 'line' ? [size, 1, 1] : shape === 'wall' ? [size, size, 1]
    : shape === 'floor' ? [size, 1, size] : [size, size, size];
}

function prefabBlock(shape, x, y, z) {
  if (shape === 'bridge') {
    if (y === 0) return z % 6 === 0 ? 205 : 200;
    if (x !== 0 && x !== 2) return 0;
    if (y === 1) return z % 3 === 0 ? 201 : 200;
    return z % 3 === 0 ? (z === 0 || z === 12 ? 202 : 203) : 0;
  }
  const edgeX = x === 0 || x === 4, edgeZ = z === 0 || z === 4;
  const edge = edgeX || edgeZ, flatWall = edgeX !== edgeZ;
  if (y === 0) return 205;
  if (shape === 'base') {
    if (y === 4) return edge ? 201 : x === 2 && z === 2 ? 202 : 204;
    if (x === 2 && z === 0) return y <= 2 ? 0 : 201;
    return y === 2 && flatWall ? 203 : edge ? 200 : 0;
  }
  // Eight single-block steps reach the roof. Openings preserve two-block headroom
  // through the intermediate floor and the rooftop landing.
  if (y >= 1 && y <= 8 && STAIR[y - 1][0] === x && STAIR[y - 1][1] === z) return 205;
  if (y === 8) {
    if (x === 1 && (z === 2 || z === 3)) return 0;
    return edge ? 201 : x === 2 && z === 2 ? 202 : 204;
  }
  if (x === 2 && z === 0 && y <= 2) return 0;
  if (y === 4) return edge ? 201 : x === 3 && (z === 1 || z === 2) ? 0 : 204;
  return [2, 3, 6, 7].includes(y) && flatWall ? 203 : edge ? 200 : 0;
}

// Origin is the local bottom/front/left corner. Rotate around that voxel, not the
// bounding-box centre: +90° sends local +x towards world +z and +z towards -x.
export function buildShape(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid building command.');
  const { shape, origin, rotation, block, size } = value;
  const info = BUILD_SHAPES.find(row => row.id === shape);
  if (!info) throw new Error('Choose a building shape.');
  const allowed = ['shape', 'origin', 'rotation', 'block', ...(info.prefab ? [] : ['size'])];
  if (Object.keys(value).length !== allowed.length || Object.keys(value).some(key => !allowed.includes(key))) {
    throw new Error('Unexpected or missing building fields.');
  }
  if (!Array.isArray(origin) || origin.length !== 3
    || !coordinate(origin[0], -FREEPLAY.worldLimit, FREEPLAY.worldLimit)
    || !coordinate(origin[1], 1, 63) || !coordinate(origin[2], -FREEPLAY.worldLimit, FREEPLAY.worldLimit)) {
    throw new Error('Choose a building origin inside the playable world.');
  }
  if (!coordinate(rotation, 0, 3)) throw new Error('Choose one of four building rotations.');
  if (!validBlock(block)) throw new Error('Choose a valid building block.');
  const [width, height, length] = buildDimensions(shape, size), rows = [];
  if (width * height * length > MAX_BUILD_CELLS) throw new Error('That building is too large.');
  for (let y = 0; y < height; y++) for (let z = 0; z < length; z++) for (let x = 0; x < width; x++) {
    const [rx, rz] = rotation === 0 ? [x, z] : rotation === 1 ? [-z, x] : rotation === 2 ? [-x, -z] : [z, -x];
    const px = origin[0] + rx, py = origin[1] + y, pz = origin[2] + rz;
    if (!coordinate(px, -FREEPLAY.worldLimit, FREEPLAY.worldLimit) || !coordinate(py, 1, 63)
      || !coordinate(pz, -FREEPLAY.worldLimit, FREEPLAY.worldLimit)) throw new Error('The whole building must fit inside the world.');
    const shell = x === 0 || x === width - 1 || y === 0 || y === height - 1 || z === 0 || z === length - 1;
    const id = info.prefab ? prefabBlock(shape, x, y, z) : shape === 'box' && !shell ? 0 : block;
    rows.push([px, py, pz, id]);
  }
  return rows;
}
