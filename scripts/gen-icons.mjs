// gen-icons.mjs — draw the PWA home-screen icons procedurally (no deps, no binary
// sources: a pure-Node PNG encoder + a per-pixel moor scene, same identity rule as
// the rest of the game — nothing checked in that a script can't regenerate).
// Usage: node scripts/gen-icons.mjs   → public/icons/icon-192.png, icon-512.png
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT_DIR = fileURLToPath(new URL('../public/icons/', import.meta.url));

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// Minimal PNG: 8-bit RGB, filter 0 on every scanline, one IDAT.
function png(w, h, pix) {
  const stride = 1 + w * 3;
  const raw = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pix(x, y);
      const o = y * stride + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // bit depth 8, colour type 2 (RGB)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// The scene: a pale sky over two moor ridges — heather behind, bracken in front —
// with a low sun. Full-bleed (no transparent margin) so the same art serves as a
// maskable icon; the sun sits inside the central safe zone.
function moorPix(size) {
  return (x, y) => {
    const u = x / size, v = y / size;
    // sky: pale blue down to a warm horizon
    const t = Math.min(v / 0.55, 1);
    let r = 143 + (229 - 143) * t;
    let g = 179 + (211 - 179) * t;
    let b = 204 + (170 - 204) * t;
    // low sun, upper-right
    const d = Math.hypot(u - 0.64, v - 0.28);
    if (d < 0.085) { r = 244; g = 228; b = 170; }
    else if (d < 0.11) {
      const m = (0.11 - d) / 0.025;
      r += (244 - r) * m * 0.7; g += (228 - g) * m * 0.7; b += (170 - b) * m * 0.7;
    }
    // far ridge: heather purple
    const ridge1 = 0.52 + 0.045 * Math.sin(u * 6.3 + 1.2) + 0.018 * Math.sin(u * 15.7);
    if (v > ridge1) {
      const sh = 1 - Math.min((v - ridge1) * 1.1, 0.28);
      r = 122 * sh; g = 84 * sh; b = 128 * sh;
    }
    // near ridge: dark bracken green
    const ridge2 = 0.72 + 0.05 * Math.sin(u * 4.1 + 4.2) + 0.02 * Math.sin(u * 9.3 + 2.0);
    if (v > ridge2) {
      const sh = 1 - Math.min((v - ridge2) * 0.9, 0.32);
      r = 76 * sh; g = 86 * sh; b = 48 * sh;
    }
    return [r | 0, g | 0, b | 0];
  };
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [192, 512]) {
  const file = `${OUT_DIR}icon-${size}.png`;
  writeFileSync(file, png(size, size, moorPix(size)));
  console.log(`wrote icon-${size}.png`);
}
