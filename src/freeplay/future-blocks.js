import { BLOCKS } from '../defs.js';
import { ATLAS_TILES, tileUV } from '../textures.js';

export const FUTURE_BLOCKS = Object.freeze([
  { id: 200, tile: 120, name: 'Alloy plating', description: 'Cool steel panels with recessed seams and rivets.' },
  { id: 201, tile: 121, name: 'Neon cyan', description: 'Bright cyan strips on dark spaceship panelling.' },
  { id: 202, tile: 122, name: 'Neon magenta', description: 'Pink energy diamonds for bold futuristic builds.' },
  { id: 203, tile: 123, name: 'Energy window', description: 'A solid blue patterned pane; decorative, not see-through.' },
  { id: 204, tile: 124, name: 'Circuit panel', description: 'Green circuit traces, copper contacts and a central chip.' },
  { id: 205, tile: 125, name: 'Landing pad', description: 'A marked landing deck with yellow hazard edges.' },
].map(Object.freeze));

const byId = new Map(FUTURE_BLOCKS.map(row => [row.id, row]));
const painted = new WeakSet(), icons = new Map();
const PAYLOAD = 16;

export function registerFutureBlocks() {
  // Check the entire reserved range before changing anything.
  for (const row of FUTURE_BLOCKS) {
    const existing = BLOCKS[row.id];
    if (existing && (existing.freeplayFuture !== true || existing.name !== row.name || existing.tex.t !== row.tile)) {
      throw new Error(`Free Play block ID ${row.id} is already occupied`);
    }
  }
  for (const row of FUTURE_BLOCKS) if (!BLOCKS[row.id]) {
    BLOCKS[row.id] = Object.freeze({ name: row.name, kind: 'solid', hard: .5, tool: 'pick', drop: row.id,
      tex: Object.freeze({ t: row.tile, s: row.tile, b: row.tile }), freeplayFuture: true });
  }
  return FUTURE_BLOCKS;
}

// Static 16px procedural art, also used by icons and deterministic verification.
export function futureTilePixels(id) {
  if (!byId.has(id)) return null;
  const pixels = new Uint8ClampedArray(PAYLOAD * PAYLOAD * 4);
  const dot = (x, y, hex) => {
    if (x < 0 || y < 0 || x >= PAYLOAD || y >= PAYLOAD) return;
    const i = (x + y * PAYLOAD) * 4;
    pixels[i] = hex >> 16 & 255; pixels[i + 1] = hex >> 8 & 255; pixels[i + 2] = hex & 255; pixels[i + 3] = 255;
  };
  const rect = (x, y, width, height, hex) => {
    for (let yy = y; yy < y + height; yy++) for (let xx = x; xx < x + width; xx++) dot(xx, yy, hex);
  };
  const frame = (inset, hex) => {
    const width = PAYLOAD - inset * 2;
    rect(inset, inset, width, 1, hex); rect(inset, PAYLOAD - inset - 1, width, 1, hex);
    rect(inset, inset, 1, width, hex); rect(PAYLOAD - inset - 1, inset, 1, width, hex);
  };
  rect(0, 0, 16, 16, 0x132c39);
  if (id === 200) {
    rect(1, 1, 14, 14, 0x617c90); rect(2, 2, 12, 11, 0x829bad);
    rect(2, 2, 12, 1, 0xc4dce8); rect(2, 3, 1, 10, 0x9bb8c9);
    rect(3, 12, 11, 2, 0x3d566b); rect(13, 3, 1, 9, 0x4b6376);
    for (let y = 5; y <= 10; y += 2) rect(5, y, 6, 1, 0x738a9b);
    for (const x of [2, 13]) for (const y of [2, 13]) { dot(x, y, 0x183543); dot(x, y - 1, 0xd5e8ec); }
  } else if (id === 201) {
    rect(1, 1, 14, 14, 0x103c4a); frame(2, 0x137785); frame(3, 0x29dbe2); frame(4, 0xb0fff1);
    rect(5, 5, 6, 6, 0x143c48); rect(7, 0, 2, 5, 0x31e8ed); rect(7, 11, 2, 5, 0x31e8ed);
    rect(0, 7, 5, 2, 0x31e8ed); rect(11, 7, 5, 2, 0x31e8ed); rect(7, 7, 2, 2, 0xe1ffef);
  } else if (id === 202) {
    rect(0, 0, 16, 16, 0x261831); frame(1, 0x553751);
    for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) {
      const distance = Math.abs(x - 7.5) + Math.abs(y - 7.5);
      if (distance >= 5 && distance <= 7) dot(x, y, distance === 6 ? 0xffc1ed : 0xe144b7);
    }
    rect(7, 5, 2, 6, 0xff86d6); rect(5, 7, 6, 2, 0xff86d6); rect(7, 7, 2, 2, 0xffd9f5);
    for (const x of [1, 14]) for (const y of [1, 14]) dot(x, y, 0xf68ada);
  } else if (id === 203) {
    rect(1, 1, 14, 14, 0x44798e); rect(2, 2, 12, 12, 0x285b78);
    for (let y = 3; y < 13; y++) rect(3, y, 10, 1, (0x20 + y * 2) << 16 | (0x55 + y * 3) << 8 | (0x72 + y * 3));
    rect(5, 2, 1, 12, 0x7ec3cc); rect(10, 2, 1, 12, 0x7ec3cc); rect(2, 7, 12, 1, 0x7ec3cc);
    for (let i = 0; i < 7; i++) { dot(3 + i, 3 + i, 0xc4eced); dot(4 + i, 3 + i, 0x8cd0d9); }
    frame(0, 0x192f42); frame(1, 0x639da9);
  } else if (id === 204) {
    rect(1, 1, 14, 14, 0x204539); frame(1, 0x34654a);
    for (const offset of [3, 7, 12]) {
      rect(offset, 1, 1, 5, 0x8ece8d); rect(1, offset, 5, 1, 0x8ece8d);
      rect(offset, 10, 1, 5, 0x73bfa5); rect(10, offset, 5, 1, 0x73bfa5);
      dot(offset, 2, 0xe4b16b); dot(13, offset, 0xe4b16b);
    }
    rect(5, 5, 6, 6, 0x9ecbac); rect(6, 6, 4, 4, 0x14252d);
    dot(7, 7, 0x5bedd6); dot(8, 8, 0x5bedd6);
  } else {
    rect(0, 0, 16, 16, 0x303f51); frame(2, 0x73818a);
    for (let i = 0; i < 16; i++) {
      const colour = (i >> 1) % 2 ? 0x263748 : 0xe8bb56;
      rect(i, 0, 1, 2, colour); rect(i, 14, 1, 2, colour);
      rect(0, i, 2, 1, colour); rect(14, i, 2, 1, colour);
    }
    rect(5, 4, 2, 8, 0xe6ece7); rect(9, 4, 2, 8, 0xe6ece7); rect(6, 7, 4, 2, 0xe6ece7);
    for (const x of [3, 12]) for (const y of [3, 12]) dot(x, y, 0x76f2e7);
  }
  return pixels;
}

export function paintFutureAtlas(atlas) {
  const canvas = atlas?.image;
  if (!canvas?.getContext) throw new Error('Free Play needs the procedural atlas canvas');
  if (painted.has(canvas)) return atlas;
  const cell = canvas.width / ATLAS_TILES, uv = tileUV(FUTURE_BLOCKS[0].tile);
  const payload = Math.round((uv[2] - uv[0]) * canvas.width), padding = (cell - payload) / 2;
  if (canvas.height !== canvas.width || !Number.isInteger(cell) || payload !== PAYLOAD || !Number.isInteger(padding) || padding < 1) {
    throw new Error('Unsupported procedural atlas layout');
  }
  const ctx = canvas.getContext('2d');
  for (const row of FUTURE_BLOCKS) {
    const pixels = futureTilePixels(row.id), patch = ctx.createImageData(cell, cell);
    // Copy nearest edge pixels into every gutter and corner; mips cannot sample a neighbour.
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
      const sx = Math.max(0, Math.min(PAYLOAD - 1, x - padding)), sy = Math.max(0, Math.min(PAYLOAD - 1, y - padding));
      const source = (sx + sy * PAYLOAD) * 4, target = (x + y * cell) * 4;
      patch.data.set(pixels.subarray(source, source + 4), target);
    }
    ctx.putImageData(patch, row.tile % ATLAS_TILES * cell, Math.floor(row.tile / ATLAS_TILES) * cell);
  }
  painted.add(canvas); atlas.needsUpdate = true;
  return atlas;
}

export function getFutureIconURL(id) {
  if (!byId.has(id) || typeof document === 'undefined') return null;
  if (icons.has(id)) return icons.get(id);
  const tile = document.createElement('canvas'); tile.width = tile.height = PAYLOAD;
  const tc = tile.getContext('2d'), patch = tc.createImageData(PAYLOAD, PAYLOAD);
  patch.data.set(futureTilePixels(id)); tc.putImageData(patch, 0, 0);
  const icon = document.createElement('canvas'); icon.width = icon.height = 40;
  const ctx = icon.getContext('2d'); ctx.imageSmoothingEnabled = false;
  for (const [transform, alpha] of [
    [[1, -.5, 1, .5, 4, 14], 1], [[1, .5, 0, 1, 4, 14], .86], [[1, -.5, 0, 1, 20, 22], .65],
  ]) {
    ctx.save(); ctx.setTransform(...transform); ctx.globalAlpha = alpha;
    ctx.drawImage(tile, 0, 0, 16, 16); ctx.restore();
  }
  const url = icon.toDataURL(); icons.set(id, url); return url;
}
