import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Scene } from 'three';
import { B, I, TILE, BLOCKS, isSolid, isOpaque } from '../src/defs.js';
import { FreeplayWorld } from '../src/freeplay/world.js';

const originalIds = Object.keys(BLOCKS);
const { FUTURE_BLOCKS, registerFutureBlocks, futureTilePixels, paintFutureAtlas, getFutureIconURL } = await import('../src/freeplay/future-blocks.js');
assert.deepEqual(Object.keys(BLOCKS), originalIds, 'import alone never changes ordinary block definitions');
assert.equal(FUTURE_BLOCKS.length, 7);
assert.deepEqual(FUTURE_BLOCKS.slice(0, 6).map(row => row.id), [200, 201, 202, 203, 204, 205], 'existing block IDs remain append-only');
assert.deepEqual(FUTURE_BLOCKS.slice(0, 6).map(row => row.tile), [120, 121, 122, 123, 124, 125], 'existing atlas slots remain unchanged');
assert.deepEqual(FUTURE_BLOCKS.slice(6).map(row => [row.id, row.tile, row.name]), [[206, 126, 'Vehicle control']]);
for (const row of FUTURE_BLOCKS) {
  assert.ok(![...Object.values(B), ...Object.values(I)].includes(row.id), 'reserved ID cannot collide with existing block/item');
  assert.ok(!Object.values(TILE).includes(row.tile), 'reserved tile cannot overwrite existing procedural art');
  assert.ok(Object.isFrozen(row));
}
registerFutureBlocks();
const definitions = FUTURE_BLOCKS.map(row => BLOCKS[row.id]);
registerFutureBlocks();
assert.deepEqual(FUTURE_BLOCKS.map(row => BLOCKS[row.id]), definitions, 'registration is idempotent');
for (const row of FUTURE_BLOCKS) {
  const definition = BLOCKS[row.id];
  assert.equal(definition.name, row.name); assert.equal(definition.drop, row.id);
  assert.deepEqual(definition.tex, { t: row.tile, s: row.tile, b: row.tile });
  assert.equal(isSolid(row.id), true); assert.equal(isOpaque(row.id), true);
  assert.equal(new Uint8Array([row.id])[0], row.id, 'existing voxel storage retains the complete block ID');
}
assert.match(FUTURE_BLOCKS.find(row => row.id === 203).description, /solid.*not see-through/, 'window honestly describes its solid geometry');
const hashes = new Set();
for (const row of FUTURE_BLOCKS) {
  const pixels = futureTilePixels(row.id);
  assert.equal(pixels.length, 16 * 16 * 4);
  assert.deepEqual(pixels, futureTilePixels(row.id), 'art is deterministic between clients');
  for (let i = 3; i < pixels.length; i += 4) assert.equal(pixels[i], 255, 'every solid tile payload pixel is opaque');
  hashes.add(createHash('sha256').update(pixels).digest('hex'));
}
assert.equal(hashes.size, 7, 'vehicle control adds distinct art to the original six blocks');
assert.equal(futureTilePixels(8), null);
assert.equal(getFutureIconURL(8), null);
assert.equal(getFutureIconURL(200), null, 'headless imports never require browser canvas');

// Capture actual atlas patches: prove the renderer's painter writes only its
// seven reserved cells and that all four sides and corners replicate payload edges.
const patches = [], context = {
  createImageData: (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
  putImageData: (patch, x, y) => patches.push({ patch, x, y }),
};
let uploads = 0;
const atlas = { image: { width: 384, height: 384, getContext: () => context }, set needsUpdate(value) { if (value) uploads++; } };
assert.equal(paintFutureAtlas(atlas), atlas);
paintFutureAtlas(atlas);
assert.equal(patches.length, 7, 'repeat painting reuses the same atlas without work or allocation');
assert.equal(uploads, 1, 'one GPU upload request for seven static tiles');
for (let i = 0; i < patches.length; i++) {
  const { patch, x, y } = patches[i], row = FUTURE_BLOCKS[i], payload = futureTilePixels(row.id);
  assert.equal(x, row.tile % 16 * 24); assert.equal(y, Math.floor(row.tile / 16) * 24);
  assert.equal(patch.width, 24); assert.equal(patch.height, 24);
  for (let py = 0; py < 24; py++) for (let px = 0; px < 24; px++) {
    const sx = Math.max(0, Math.min(15, px - 4)), sy = Math.max(0, Math.min(15, py - 4));
    const a = (px + py * 24) * 4, b = (sx + sy * 16) * 4;
    assert.deepEqual(patch.data.slice(a, a + 4), payload.slice(b, b + 4), 'payload and nearest-edge gutter match');
  }
}
assert.throws(() => paintFutureAtlas({ image: { width: 256, height: 256, getContext: () => context } }), /atlas layout/);
assert.throws(() => paintFutureAtlas(null), /atlas canvas/);

const world = new FreeplayWorld(new Scene(), 419947177);
for (const row of FUTURE_BLOCKS) world.applyEdits([[row.id - 200, 55, 0, row.id]]);
world.ensureChunk(0, 0);
for (const row of FUTURE_BLOCKS) assert.equal(world.getBlock(row.id - 200, 55, 0), row.id, 'future block survives unloaded-chunk overlay generation');
world.dispose();
const first = BLOCKS[200]; BLOCKS[200] = { name: 'Synthetic collision' };
assert.throws(() => registerFutureBlocks(), /already occupied/); BLOCKS[200] = first;
assert.deepEqual(Object.keys(BLOCKS), [...originalIds, '200', '201', '202', '203', '204', '205', '206'], 'registration adds only seven private IDs');
assert.ok(readFileSync(new URL('../src/freeplay/future-blocks.js', import.meta.url), 'utf8').split('\n').length <= 300);
console.log('PASS free-play future blocks: isolated/idempotent registration, original six IDs plus vehicle control, seven distinct opaque tiles, gutters, one atlas upload and Uint8 chunk persistence.');
