// Procedurally painted 16px texture atlas + item icons. No external assets.
import * as THREE from 'three';
import { TILE, I, BLOCKS, TOOLS } from './defs.js';
import { mulberry32 } from './noise.js';

export const ATLAS_TILES = 16; // tiles per row
const T = 16; // pixels per tile

function shade(hex, f) {
  const r = Math.min(255, Math.max(0, Math.round(((hex >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((hex >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((hex & 255) * f)));
  return `rgb(${r},${g},${b})`;
}

class Painter {
  constructor(ctx, ox, oy, seed) {
    this.ctx = ctx; this.ox = ox; this.oy = oy;
    this.rng = mulberry32(seed);
  }
  px(x, y, c) { this.ctx.fillStyle = c; this.ctx.fillRect(this.ox + x, this.oy + y, 1, 1); }
  rect(x, y, w, h, c) { this.ctx.fillStyle = c; this.ctx.fillRect(this.ox + x, this.oy + y, w, h); }
  // base colour with random brightness speckle
  speckle(hex, amount = 0.18) {
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      this.px(x, y, shade(hex, 1 - amount + this.rng() * amount * 2));
    }
  }
  dots(hex, n, f = 1) {
    for (let i = 0; i < n; i++) {
      this.px((this.rng() * T) | 0, (this.rng() * T) | 0, shade(hex, f));
    }
  }
  clear() { this.ctx.clearRect(this.ox, this.oy, T, T); }
}

const TILE_PAINTERS = {
  [TILE.GRASS_TOP](p) {
    p.speckle(0x5a7037, 0.22);
    p.dots(0x6e8444, 30); p.dots(0x4a5c2c, 24); p.dots(0x8a8a50, 8);
  },
  [TILE.GRASS_SIDE](p) {
    p.speckle(0x6b5232, 0.2);
    p.dots(0x55401f, 20);
    for (let x = 0; x < T; x++) {
      const d = 3 + ((p.rng() * 3) | 0);
      for (let y = 0; y < d; y++) p.px(x, y, shade(0x5a7037, 0.85 + p.rng() * 0.3));
    }
  },
  [TILE.DIRT](p) { p.speckle(0x6b5232, 0.2); p.dots(0x55401f, 28); p.dots(0x7d6340, 16); },
  [TILE.PEAT](p) {
    p.speckle(0x32261c, 0.18);
    for (let i = 0; i < 7; i++) {
      const y = (p.rng() * T) | 0, x = (p.rng() * 10) | 0, w = 3 + ((p.rng() * 5) | 0);
      p.rect(x, y, w, 1, shade(0x241a12, 1));
    }
    p.dots(0x46362a, 14);
  },
  [TILE.STONE](p) {
    p.speckle(0x7d7468, 0.14);
    p.dots(0x665e52, 26); p.dots(0x938a7c, 14);
    for (let i = 0; i < 3; i++) {
      let x = (p.rng() * T) | 0, y = (p.rng() * T) | 0;
      for (let s = 0; s < 5; s++) { p.px(x & 15, y & 15, shade(0x5c544a, 1)); x += p.rng() < 0.5 ? 1 : 0; y += 1; }
    }
  },
  [TILE.COBBLE](p) {
    p.speckle(0x77705f, 0.12);
    // irregular drystone courses
    const rows = [0, 5, 10, 15];
    for (const y of rows) p.rect(0, y, T, 1, shade(0x4a4438, 1));
    for (let r = 0; r < 3; r++) {
      let x = (p.rng() * 5) | 0;
      while (x < T) {
        p.rect(x, rows[r] + 1, 1, rows[r + 1] - rows[r] - 1, shade(0x504a3e, 1));
        x += 3 + ((p.rng() * 4) | 0);
      }
    }
    p.dots(0x8c8472, 16);
  },
  [TILE.LOG_SIDE](p) {
    p.speckle(0x5a452c, 0.12);
    for (let x = 0; x < T; x += 2 + ((p.rng() * 2) | 0)) {
      for (let y = 0; y < T; y++) if (p.rng() < 0.8) p.px(x, y, shade(0x46351f, 1));
    }
    p.dots(0x6e5636, 10);
  },
  [TILE.LOG_TOP](p) {
    p.speckle(0x8a6f48, 0.1);
    p.ctx.strokeStyle = shade(0x5a452c, 1);
    for (let r = 2; r <= 7; r += 2) {
      for (let a = 0; a < 32; a++) {
        const x = 8 + Math.round(Math.cos(a / 32 * Math.PI * 2) * r * 0.9);
        const y = 8 + Math.round(Math.sin(a / 32 * Math.PI * 2) * r * 0.9);
        if (x >= 0 && x < T && y >= 0 && y < T) p.px(x, y, shade(0x5a452c, 1));
      }
    }
  },
  [TILE.LEAVES](p) {
    p.speckle(0x3f5527, 0.25);
    p.dots(0x2e401b, 30); p.dots(0x55703a, 20); p.dots(0x202c12, 12);
  },
  [TILE.PLANKS](p) {
    p.speckle(0x9a7a4e, 0.1);
    for (const y of [0, 4, 8, 12]) p.rect(0, y, T, 1, shade(0x6e5535, 1));
    p.dots(0x84663c, 18); p.dots(0xab8b5e, 10);
  },
  [TILE.WATER](p) {
    p.speckle(0x3a5e7a, 0.12);
    p.dots(0x4d7796, 18); p.dots(0x2c4a62, 12);
    for (let i = 0; i < 3; i++) {
      const y = (p.rng() * T) | 0, x = (p.rng() * 8) | 0;
      p.rect(x, y, 4 + ((p.rng() * 4) | 0), 1, shade(0x6b95b2, 1));
    }
  },
  [TILE.BOG](p) {
    p.speckle(0x3d3a22, 0.14);
    p.dots(0x2e2c18, 20); p.dots(0x4f4c2e, 16); p.dots(0x5a5a30, 6);
  },
  [TILE.HEATHER](p) {
    p.clear();
    for (let i = 0; i < 7; i++) {
      const x = 1 + ((p.rng() * 14) | 0);
      const h = 6 + ((p.rng() * 7) | 0);
      for (let y = T - 1; y > T - 1 - h; y--) p.px(x, y, shade(0x4a5530, 0.9 + p.rng() * 0.2));
      // purple bells up the stem
      for (let y = T - h; y < T - 2; y += 2) {
        p.px(x - 1, y, shade(0x9a5f9e, 0.9 + p.rng() * 0.3));
        p.px(x + 1, y + 1, shade(0xa86fb0, 0.9 + p.rng() * 0.3));
      }
      p.px(x, T - 1 - h, shade(0xb87fc0, 1));
    }
  },
  [TILE.BRACKEN](p) {
    p.clear();
    for (let i = 0; i < 4; i++) {
      const x = 2 + ((p.rng() * 12) | 0);
      const h = 9 + ((p.rng() * 6) | 0);
      for (let y = T - 1; y > T - 1 - h; y--) {
        p.px(x, y, shade(0x57683a, 1));
        const fy = T - 1 - y;
        if (fy > 2 && fy % 2 === 0) {
          const w = Math.max(1, ((h - fy) / 3) | 0);
          for (let dx = 1; dx <= w; dx++) {
            p.px(x - dx, y, shade(0x687b44, 0.85 + p.rng() * 0.3));
            p.px(x + dx, y, shade(0x687b44, 0.85 + p.rng() * 0.3));
          }
        }
      }
    }
  },
  [TILE.COAL](p) {
    TILE_PAINTERS[TILE.STONE](p);
    for (let i = 0; i < 5; i++) {
      const x = 1 + ((p.rng() * 12) | 0), y = 1 + ((p.rng() * 12) | 0);
      p.rect(x, y, 2, 2, '#181818'); p.px(x + 1, y, '#2e2e2e');
    }
  },
  [TILE.IRON](p) {
    TILE_PAINTERS[TILE.STONE](p);
    for (let i = 0; i < 5; i++) {
      const x = 1 + ((p.rng() * 12) | 0), y = 1 + ((p.rng() * 12) | 0);
      p.rect(x, y, 2, 2, '#a8744f'); p.px(x, y, '#c98e62');
    }
  },
  [TILE.JET](p) {
    TILE_PAINTERS[TILE.STONE](p);
    for (let i = 0; i < 4; i++) {
      const x = 1 + ((p.rng() * 12) | 0), y = 1 + ((p.rng() * 12) | 0);
      p.rect(x, y, 2, 2, '#0a0a0e'); p.px(x, y, '#3a3a4e'); p.px(x + 1, y + 1, '#1c1c26');
    }
  },
  [TILE.GRAVEL](p) {
    p.speckle(0x8a8278, 0.2);
    p.dots(0x6e675c, 26); p.dots(0xa09888, 20); p.dots(0x5a544a, 12);
  },
  [TILE.BEDROCK](p) {
    p.speckle(0x3a3a3a, 0.3);
    p.dots(0x202020, 36); p.dots(0x555555, 20);
  },
  [TILE.THATCH](p) {
    p.speckle(0xa8893f, 0.16);
    for (let y = 0; y < T; y += 2) {
      for (let x = 0; x < T; x++) if (p.rng() < 0.6) p.px(x, y, shade(0x8a6e2e, 0.9 + p.rng() * 0.3));
    }
    p.dots(0xc0a050, 14);
  },
  [TILE.STONEBRICK](p) {
    p.speckle(0x8a8276, 0.08);
    for (const y of [0, 5, 10, 15]) p.rect(0, y, T, 1, shade(0x5c564c, 1));
    p.rect(4, 1, 1, 4, shade(0x5c564c, 1)); p.rect(11, 1, 1, 4, shade(0x5c564c, 1));
    p.rect(7, 6, 1, 4, shade(0x5c564c, 1)); p.rect(2, 11, 1, 4, shade(0x5c564c, 1));
    p.rect(12, 11, 1, 4, shade(0x5c564c, 1));
    p.dots(0x9a9286, 10);
  },
  [TILE.BENCH_TOP](p) {
    TILE_PAINTERS[TILE.PLANKS](p);
    p.rect(2, 2, 4, 1, '#555'); p.rect(3, 1, 1, 3, '#555'); // saw marks
    p.rect(10, 10, 3, 3, '#777'); p.px(11, 11, '#999'); // vice
  },
  [TILE.BENCH_SIDE](p) {
    TILE_PAINTERS[TILE.PLANKS](p);
    p.rect(0, 0, T, 2, shade(0x6e5535, 1));
    p.rect(2, 5, 3, 4, shade(0x55401f, 1)); p.rect(10, 5, 4, 5, shade(0x55401f, 1));
  },
  [TILE.LANTERN](p) {
    p.speckle(0x2a2a30, 0.1);
    p.rect(3, 2, 10, 12, '#1c1c22');
    p.rect(4, 3, 8, 10, '#e8b84a');
    p.rect(6, 5, 4, 5, '#ffe9a8');
    p.rect(7, 0, 2, 2, '#3a3a44');
    p.rect(3, 7, 10, 1, '#1c1c22'); p.rect(7, 3, 1, 10, '#1c1c22');
  },
  [TILE.TUSSOCK](p) {
    p.clear();
    for (let i = 0; i < 10; i++) {
      const x = 1 + ((p.rng() * 14) | 0);
      const h = 5 + ((p.rng() * 9) | 0);
      const lean = p.rng() < 0.5 ? -1 : 1;
      for (let y = 0; y < h; y++) {
        p.px(x + ((y > h / 2 ? lean : 0)), T - 1 - y, shade(0x8a8a50, 0.8 + p.rng() * 0.4));
      }
    }
  },
  [TILE.WOOL](p) {
    p.speckle(0xe2dcd0, 0.08);
    p.dots(0xcfc8ba, 24); p.dots(0xf2eee6, 18);
  },
  [TILE.BILBERRY](p) {
    p.clear();
    // low rounded bush
    for (let y = 6; y < T; y++) for (let x = 2; x < 14; x++) {
      const cx = x - 8, cy = y - 11;
      if (cx * cx / 36 + cy * cy / 25 < 1 && p.rng() < 0.85) {
        p.px(x, y, shade(0x46622e, 0.8 + p.rng() * 0.4));
      }
    }
    for (let i = 0; i < 7; i++) {
      const x = 3 + ((p.rng() * 10) | 0), y = 7 + ((p.rng() * 7) | 0);
      p.px(x, y, '#2c3460'); p.px(x + 1, y, '#3a4480');
    }
  },
  [TILE.RANGE_FRONT](p) {
    TILE_PAINTERS[TILE.STONEBRICK](p);
    p.rect(4, 6, 8, 8, '#161210');
    p.rect(5, 10, 6, 4, '#d96a1e'); p.rect(6, 11, 4, 3, '#f2a23a'); p.rect(7, 12, 2, 2, '#ffd97a');
  },
  [TILE.RANGE_SIDE](p) {
    TILE_PAINTERS[TILE.STONEBRICK](p);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (p.rng() < 0.2) p.px(x, y, 'rgba(20,16,12,0.45)');
  },
  [TILE.BOARD](p) {
    TILE_PAINTERS[TILE.PLANKS](p);
    // pinned notices
    p.rect(2, 2, 5, 6, '#e8e2d0'); p.rect(3, 4, 3, 1, '#777'); p.rect(3, 6, 3, 1, '#777');
    p.rect(9, 3, 5, 7, '#ded6bc'); p.rect(10, 5, 3, 1, '#777'); p.rect(10, 7, 3, 1, '#777');
    p.rect(4, 10, 6, 4, '#e0d8c2'); p.rect(5, 12, 4, 1, '#777');
    p.px(4, 2, '#b03030'); p.px(11, 3, '#3050b0'); p.px(6, 10, '#b03030');
  },
  [TILE.TORCH](p) {
    p.clear();
    // stick wrapped at t' top, wi' a proper flame
    p.rect(7, 6, 2, 10, '#7a5a36');
    p.rect(7, 5, 2, 2, '#4a3a26');
    p.rect(6, 3, 4, 3, '#e8842a');
    p.rect(7, 1, 2, 3, '#ffc84a');
    p.px(7, 0, '#ffe9a0'); p.px(8, 1, '#ffe9a0');
    p.px(6, 2, '#d85a1a'); p.px(9, 3, '#d85a1a');
  },
  [TILE.SIGNPOST](p) {
    p.clear();
    // post wi' two finger-boards
    p.rect(7, 2, 2, 14, '#5a452c');
    p.rect(1, 3, 12, 3, '#9a7a4e');
    p.rect(2, 4, 8, 1, '#e8e2d0'); // painted lettering stripe
    p.px(13, 4, '#9a7a4e'); p.px(14, 4, '#7a5a36'); // pointed end
    p.rect(4, 8, 11, 3, '#8a6a40');
    p.rect(6, 9, 7, 1, '#e8e2d0');
    p.px(3, 9, '#6a4a28');
  },
  [TILE.GORSE](p) {
    p.clear();
    // a spiky dark bush ablaze wi' yellow flower
    for (let i = 0; i < 9; i++) {
      const x = 1 + ((p.rng() * 14) | 0);
      const h = 5 + ((p.rng() * 9) | 0);
      for (let y = T - 1; y > T - 1 - h; y--) {
        p.px(x, y, shade(0x2e4424, 0.85 + p.rng() * 0.3));
        if (p.rng() < 0.25) p.px(x + (p.rng() < 0.5 ? -1 : 1), y, shade(0x3a5028, 1));
      }
      if (p.rng() < 0.85) {
        p.px(x, T - h, '#e8c61e');
        p.px(x + (p.rng() < 0.5 ? -1 : 1), T - h + 1, '#f2d63a');
        if (p.rng() < 0.5) p.px(x, T - h + 2, '#d4b414');
      }
    }
  },
  [TILE.SAND](p) {
    p.speckle(0xd2bc8a, 0.12);
    p.dots(0xbfa770, 22); p.dots(0xe2d0a2, 18); p.dots(0x9a8a5e, 8);
  },
  [TILE.WINDOW](p) {
    // four-pane cottage window: dark frame, sky-glass, a glint
    p.rect(0, 0, T, T, '#4a4438');
    p.rect(2, 2, 12, 12, '#2c2920');
    p.rect(3, 3, 10, 10, '#8fa9bc');
    p.rect(7, 2, 2, 12, '#2c2920'); p.rect(2, 7, 12, 2, '#2c2920');
    p.px(4, 4, '#c8dcea'); p.px(5, 5, '#c8dcea');
    p.px(10, 10, '#a8c2d4'); p.px(11, 11, '#c8dcea');
    p.px(4, 10, '#7a94a8'); p.px(11, 4, '#a8c2d4');
  },
  [TILE.FERN](p) {
    p.clear();
    // lush green shuttlecock fronds — greener an' fuller than t' rusty bracken
    for (let i = 0; i < 6; i++) {
      const x = 2 + ((p.rng() * 12) | 0);
      const h = 9 + ((p.rng() * 6) | 0);
      const lean = (p.rng() - 0.5) * 0.6;
      for (let y = 0; y < h; y++) {
        const yy = T - 1 - y;
        const sx = Math.round(x + lean * y);
        p.px(sx, yy, shade(0x3f6a2e, 0.85 + p.rng() * 0.3)); // midrib
        const w = Math.max(1, Math.round((h - y) / 3));      // pinnae, broadest near t' base
        for (let dx = 1; dx <= w; dx++) {
          if (p.rng() < 0.7) p.px(sx - dx, yy + (dx > 1 ? 1 : 0), shade(0x4f7e38, 0.8 + p.rng() * 0.35));
          if (p.rng() < 0.7) p.px(sx + dx, yy + (dx > 1 ? 1 : 0), shade(0x4f7e38, 0.8 + p.rng() * 0.35));
        }
      }
    }
  },
  [TILE.FOXGLOVE](p) {
    p.clear();
    // tall stem wi' a one-sided spire o' purple bells
    for (let i = 0; i < 3; i++) {
      const x = 3 + ((p.rng() * 10) | 0);
      const h = 11 + ((p.rng() * 4) | 0);
      for (let y = 0; y < h; y++) p.px(x, T - 1 - y, shade(0x3c5a2a, 0.85 + p.rng() * 0.3));
      p.px(x - 1, T - 2, shade(0x46682e, 1)); p.px(x + 1, T - 1, shade(0x46682e, 1));
      const top = T - h;
      for (let y = top; y < top + Math.floor(h * 0.55); y++) {
        const side = (y % 2 === 0) ? -1 : 1;
        p.px(x + side, y, shade(0x9a3f9e, 0.85 + p.rng() * 0.3));
        if (p.rng() < 0.6) p.px(x + side * 2, y, shade(0xb060b8, 1));
      }
      p.px(x, top, '#c878c8'); // pale bud at t' tip
    }
  },
  [TILE.DOG_ROSE](p) {
    p.clear();
    // an arching bush ablaze wi' pink five-petal blooms
    for (let y = 4; y < T; y++) for (let x = 1; x < 15; x++) {
      const cx = x - 8, cy = y - 12;
      if (cx * cx / 49 + cy * cy / 36 < 1 && p.rng() < 0.78) p.px(x, y, shade(0x3a5a2e, 0.8 + p.rng() * 0.4));
    }
    for (let i = 0; i < 3; i++) { // arching canes
      let x = 3 + ((p.rng() * 9) | 0), y = T - 1;
      for (let s = 0; s < 9 && y > 3; s++) { p.px(x, y, shade(0x5a4632, 1)); x += p.rng() < 0.5 ? 1 : 0; y -= 1 + (p.rng() < 0.3 ? 1 : 0); }
    }
    for (let i = 0; i < 5; i++) { // blooms: pink petals round a yellow eye
      const x = 3 + ((p.rng() * 10) | 0), y = 4 + ((p.rng() * 7) | 0);
      p.px(x - 1, y, '#e88fb4'); p.px(x + 1, y, '#e88fb4');
      p.px(x, y - 1, '#f2a8c4'); p.px(x, y + 1, '#f2a8c4');
      p.px(x, y, '#ffe070');
    }
  },
  [TILE.ELDER](p) {
    p.clear();
    // a tall dark shrub crowned wi' creamy umbels o' flower
    for (let y = 1; y < T; y++) for (let x = 1; x < 15; x++) {
      const cx = x - 8, cy = y - 9;
      if (cx * cx / 49 + cy * cy / 55 < 1 && p.rng() < 0.82) p.px(x, y, shade(0x2f4a26, 0.8 + p.rng() * 0.4));
    }
    p.rect(7, T - 3, 2, 3, shade(0x4a3a26, 1)); // woody base
    for (let i = 0; i < 4; i++) {
      const cx = 3 + ((p.rng() * 10) | 0), cy = 3 + ((p.rng() * 6) | 0);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        if (p.rng() < 0.8) p.px(cx + dx, cy + dy, p.rng() < 0.5 ? '#f2eed8' : '#e6e0c6');
      }
    }
  },
  [TILE.MONKEY_LEAVES](p) {
    // dense dark araucaria fronds — stiff overlapping spiky scales
    p.speckle(0x244a26, 0.18);
    for (let i = 0; i < 26; i++) {
      const x = (p.rng() * T) | 0, y = (p.rng() * T) | 0;
      p.px(x, y, shade(0x346634, 0.8 + p.rng() * 0.4));
      if (p.rng() < 0.5) p.px(x, Math.max(0, y - 1), shade(0x163016, 1)); // shadow above each scale
    }
    p.dots(0x4f8240, 10); // brighter tips
  },
  [TILE.SLATE](p) {
    p.speckle(0x49545f, 0.12);
    for (let cy = 0; cy < T; cy += 4) {
      p.rect(0, cy, T, 1, shade(0x2f3640, 1));
      for (let cx = (cy % 8 ? 0 : 4); cx < T; cx += 8) p.rect(cx, cy, 1, 4, shade(0x2f3640, 1));
    }
    p.dots(0x606d7a, 9);
  },
  [TILE.ST_CREAM](p) {
    p.speckle(0xe7ddc1, 0.06);
    for (let y = 2; y < T; y += 4) p.rect(0, y, T, 1, shade(0xc7bb96, 1)); // weatherboard lines
  },
  [TILE.ST_RED](p) {
    p.speckle(0x8c3c2f, 0.1);
    for (let y = 2; y < T; y += 4) p.rect(0, y, T, 1, shade(0x6c2a20, 1));
  },
  [TILE.RBRICK](p) {
    p.speckle(0x9d4a38, 0.08);
    for (const y of [0, 5, 10, 15]) p.rect(0, y, T, 1, shade(0x6d3225, 1));
    for (const [x, y] of [[4, 1], [11, 1], [7, 6], [2, 11], [12, 11]]) p.rect(x, y, 1, 4, shade(0x6d3225, 1));
  },
  [TILE.TER_MINT](p) { p.speckle(0xbfe0c4, 0.07); p.dots(0xa8d0ad, 8); },
  [TILE.TER_BLUE](p) { p.speckle(0x9fc0d8, 0.07); p.dots(0x86abc6, 8); },
  [TILE.TER_PINK](p) { p.speckle(0xe6b8bf, 0.07); p.dots(0xd49aa3, 8); },
  [TILE.TER_YELLOW](p) { p.speckle(0xe9d79a, 0.07); p.dots(0xd6c081, 8); },
};

let atlasCanvas = null;   // the LIVE atlas (may be season-tinted)
let baseCanvas = null;    // untinted base, kept so seasonal tints don't compound
let atlasTexture = null;

export function buildAtlas() {
  // paint t' untinted base once
  baseCanvas = document.createElement('canvas');
  baseCanvas.width = baseCanvas.height = ATLAS_TILES * T;
  const bctx = baseCanvas.getContext('2d');
  bctx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
  for (const [tileId, fn] of Object.entries(TILE_PAINTERS)) {
    const id = +tileId;
    const tx = (id % ATLAS_TILES) * T, ty = Math.floor(id / ATLAS_TILES) * T;
    fn(new Painter(bctx, tx, ty, 1000 + id * 7));
  }
  // t' live atlas starts as a copy o' t' base
  atlasCanvas = document.createElement('canvas');
  atlasCanvas.width = atlasCanvas.height = ATLAS_TILES * T;
  atlasCanvas.getContext('2d', { willReadFrequently: true }).drawImage(baseCanvas, 0, 0);
  atlasTexture = new THREE.CanvasTexture(atlasCanvas);
  atlasTexture.magFilter = THREE.NearestFilter;
  atlasTexture.minFilter = THREE.NearestFilter;
  atlasTexture.generateMipmaps = false;
  atlasTexture.colorSpace = THREE.SRGBColorSpace;
  return atlasTexture;
}

// ---- seasonal re-tint o' t' growing things (re-paints tiles in place; no chunk re-mesh) ----
const SEASON_TILES = [TILE.GRASS_TOP, TILE.GRASS_SIDE, TILE.HEATHER, TILE.BRACKEN, TILE.FERN, TILE.BILBERRY, TILE.GORSE];
function blendPx(d, i, r, g, b, amt) {
  d[i] += (r - d[i]) * amt; d[i + 1] += (g - d[i + 1]) * amt; d[i + 2] += (b - d[i + 2]) * amt;
}
function desatPx(d, i, amt) {
  const y = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
  d[i] += (y - d[i]) * amt; d[i + 1] += (y - d[i + 1]) * amt; d[i + 2] += (y - d[i + 2]) * amt;
}
function seasonShiftPx(tile, d, i, s) {
  const winter = s.warmth < 0 ? -s.warmth : 0;
  if (tile === TILE.HEATHER) {
    blendPx(d, i, 150, 74, 168, s.heatherBloom * 0.7);  // late-summer bloom: t' whole plant purples
    blendPx(d, i, 92, 74, 56, winter * 0.45);           // winter: browned off
  } else if (tile === TILE.BRACKEN || tile === TILE.FERN) {
    blendPx(d, i, 156, 86, 38, s.autumn * 0.6);         // autumn rust
    blendPx(d, i, 120, 100, 74, winter * 0.4);          // dead-brown in winter
  } else if (tile === TILE.GRASS_TOP || tile === TILE.GRASS_SIDE) {
    blendPx(d, i, 96, 132, 58, s.greenness * 0.22);     // spring/summer flush
    desatPx(d, i, winter * 0.4); blendPx(d, i, 150, 148, 118, winter * 0.22); // winter: pale an' strawy
  } else if (tile === TILE.GORSE) {
    desatPx(d, i, winter * 0.3);
  } else if (tile === TILE.BILBERRY) {
    blendPx(d, i, 150, 80, 50, s.autumn * 0.35); desatPx(d, i, winter * 0.4);
  }
}
export function retintAtlasForSeason(season) {
  if (!atlasCanvas || !baseCanvas || !atlasTexture) return;
  const ctx = atlasCanvas.getContext('2d', { willReadFrequently: true });
  for (const tile of SEASON_TILES) {
    const tx = (tile % ATLAS_TILES) * T, ty = Math.floor(tile / ATLAS_TILES) * T;
    ctx.clearRect(tx, ty, T, T);
    ctx.drawImage(baseCanvas, tx, ty, T, T, tx, ty, T, T); // reset frae base so tints don't stack
    const img = ctx.getImageData(tx, ty, T, T);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8) continue; // leave t' transparent cutout background be
      seasonShiftPx(tile, d, i, season);
    }
    ctx.putImageData(img, tx, ty);
  }
  atlasTexture.needsUpdate = true;
  tileColorCache.clear();
}

// UV rect for a tile: returns [u0, v0, u1, v1] (v0 = bottom)
export function tileUV(tile) {
  const c = tile % ATLAS_TILES, r = Math.floor(tile / ATLAS_TILES);
  const s = 1 / ATLAS_TILES;
  return [c * s, 1 - (r + 1) * s, (c + 1) * s, 1 - r * s];
}

// ---------- Item icons (32px canvases, cached) ----------
const iconCache = new Map();

const TOOL_COLORS = { W: '#9a6b3f', S: '#8a8276', I: '#d8d8e0' };

function toolTier(id) {
  if (id >= I.W_PICK && id <= I.W_SWORD) return 'W';
  if (id >= I.S_PICK && id <= I.S_SWORD) return 'S';
  return 'I';
}

function drawTool(ctx, id) {
  const t = TOOLS[id].type;
  const head = TOOL_COLORS[toolTier(id)];
  const handle = '#7a5a36';
  ctx.save();
  ctx.translate(16, 16); ctx.rotate(-Math.PI / 4); ctx.translate(-16, -16);
  ctx.fillStyle = handle; ctx.fillRect(14, 8, 4, 20);
  ctx.fillStyle = head;
  if (t === 'pick') { ctx.fillRect(6, 4, 20, 4); ctx.fillRect(6, 8, 4, 3); ctx.fillRect(22, 8, 4, 3); }
  else if (t === 'axe') { ctx.fillRect(10, 3, 12, 5); ctx.fillRect(8, 8, 8, 5); }
  else if (t === 'shovel') { ctx.fillRect(11, 2, 10, 8); ctx.fillRect(13, 10, 6, 2); }
  else if (t === 'sword') { ctx.fillRect(14, 0, 4, 18); ctx.fillStyle = '#5a4a30'; ctx.fillRect(10, 16, 12, 3); }
  ctx.restore();
}

const ITEM_ICON_PAINTERS = {
  [I.STICK](ctx) {
    ctx.fillStyle = '#7a5a36';
    ctx.save(); ctx.translate(16, 16); ctx.rotate(-Math.PI / 4);
    ctx.fillRect(-2, -12, 4, 24); ctx.restore();
  },
  [I.COAL_LUMP](ctx) {
    ctx.fillStyle = '#1c1c1c'; ctx.beginPath(); ctx.arc(16, 17, 9, 0, 7); ctx.fill();
    ctx.fillStyle = '#383838'; ctx.fillRect(11, 12, 4, 4); ctx.fillRect(18, 18, 3, 3);
  },
  [I.RAW_IRON](ctx) {
    ctx.fillStyle = '#8a8276'; ctx.beginPath(); ctx.arc(16, 17, 9, 0, 7); ctx.fill();
    ctx.fillStyle = '#a8744f'; ctx.fillRect(11, 13, 5, 4); ctx.fillRect(17, 18, 4, 4);
  },
  [I.IRON_INGOT](ctx) {
    ctx.fillStyle = '#c8c8d2'; ctx.beginPath();
    ctx.moveTo(6, 22); ctx.lineTo(10, 12); ctx.lineTo(24, 12); ctx.lineTo(28, 22); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e6e6ee'; ctx.fillRect(11, 13, 11, 3);
  },
  [I.JET_GEM](ctx) {
    ctx.fillStyle = '#0c0c14'; ctx.beginPath();
    ctx.moveTo(16, 5); ctx.lineTo(26, 14); ctx.lineTo(16, 27); ctx.lineTo(6, 14); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#3a3a55'; ctx.beginPath();
    ctx.moveTo(16, 5); ctx.lineTo(20, 13); ctx.lineTo(12, 13); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#6a6a9a'; ctx.fillRect(14, 9, 2, 2);
  },
  [I.RAW_MUTTON](ctx) { drawMeat(ctx, '#d2697a', '#e8909e'); },
  [I.COOKED_MUTTON](ctx) { drawMeat(ctx, '#8a5230', '#b07448'); },
  [I.RAW_GROUSE](ctx) { drawMeat(ctx, '#c2737f', '#daa0a8', 0.7); },
  [I.COOKED_GROUSE](ctx) { drawMeat(ctx, '#96603a', '#ba8456', 0.7); },
  [I.RAW_BEEF](ctx) { drawMeat(ctx, '#aa3f44', '#cc6a64', 1.1); },
  [I.COOKED_BEEF](ctx) { drawMeat(ctx, '#723c24', '#9a5e36', 1.1); },
  [I.FISHING_ROD](ctx) {
    ctx.strokeStyle = '#8a6a40'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(5, 28); ctx.lineTo(27, 4); ctx.stroke();          // t' rod
    ctx.strokeStyle = '#5a4428'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(5, 28); ctx.lineTo(10, 23); ctx.stroke();          // t' handle
    ctx.strokeStyle = 'rgba(210,224,236,0.85)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(27, 4); ctx.lineTo(25, 22); ctx.stroke();          // t' line
    ctx.fillStyle = '#d83a2a'; ctx.beginPath(); ctx.arc(25, 23, 2, 0, 7); ctx.fill(); // t' float
  },
  [I.RAW_TROUT](ctx) { drawFish(ctx, '#7a8a5a', '#cfd2b8'); ctx.fillStyle = '#a0402c'; for (let i = 0; i < 6; i++) ctx.fillRect(9 + i * 2.5, 14 + (i % 2) * 2, 1, 1); },
  [I.SEA_FISH](ctx) { drawFish(ctx, '#6a8298', '#dfe6ec'); },
  [I.COOKED_FISH](ctx) { drawFish(ctx, '#b07a44', '#dab584'); },
  [I.BILBERRIES](ctx) {
    for (const [x, y] of [[11, 13], [19, 12], [15, 19], [22, 20], [9, 21]]) {
      ctx.fillStyle = '#2c3460'; ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill();
      ctx.fillStyle = '#4a5694'; ctx.fillRect(x - 2, y - 2, 2, 2);
    }
  },
  [I.PARCEL](ctx) {
    ctx.fillStyle = '#a5805a'; ctx.fillRect(6, 9, 20, 15);
    ctx.fillStyle = '#8a6a48'; ctx.fillRect(6, 9, 20, 3);
    ctx.strokeStyle = '#5a4530'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(16, 9); ctx.lineTo(16, 24); ctx.moveTo(6, 16); ctx.lineTo(26, 16); ctx.stroke();
    ctx.fillStyle = '#5a4530'; ctx.fillRect(14, 14, 4, 4);
  },
  [I.AMULET_L](ctx) { drawAmuletHalf(ctx, true); },
  [I.AMULET_R](ctx) { drawAmuletHalf(ctx, false); },
  [I.BELL_CLAPPER](ctx) {
    ctx.strokeStyle = '#9a9aa6'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(16, 5); ctx.lineTo(16, 20); ctx.stroke();
    ctx.fillStyle = '#b8b8c4'; ctx.beginPath(); ctx.arc(16, 23, 6, 0, 7); ctx.fill();
    ctx.fillStyle = '#e2e2ea'; ctx.fillRect(13, 20, 3, 3);
    ctx.fillStyle = '#7a7a86'; ctx.fillRect(13, 3, 6, 3);
  },
  [I.AMULET](ctx) {
    ctx.strokeStyle = '#8a6a2a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(16, 8, 5, Math.PI * 0.2, Math.PI * 0.8, true); ctx.stroke();
    ctx.fillStyle = '#d8b95a'; ctx.beginPath(); ctx.arc(16, 18, 10, 0, 7); ctx.fill();
    ctx.fillStyle = '#b8983a'; ctx.beginPath(); ctx.arc(16, 18, 10, 0, 7); ctx.stroke();
    ctx.fillStyle = '#0c0c14'; ctx.beginPath(); ctx.arc(16, 18, 5, 0, 7); ctx.fill();
    ctx.fillStyle = '#3a3a55'; ctx.fillRect(13, 15, 2, 2);
    ctx.fillStyle = '#f2e2a0'; ctx.fillRect(10, 12, 3, 2); ctx.fillRect(20, 22, 2, 2);
  },
  [I.SPARKLE](ctx) {
    ctx.fillStyle = '#e8e2dc'; ctx.beginPath(); ctx.ellipse(15, 18, 8, 7, -0.3, 0, 7); ctx.fill();
    ctx.fillStyle = '#dcd2cc'; ctx.beginPath(); ctx.ellipse(21, 11, 5, 4.5, -0.4, 0, 7); ctx.fill();
    ctx.fillStyle = '#e8c84a'; ctx.beginPath();
    ctx.moveTo(23, 7); ctx.lineTo(28, 1); ctx.lineTo(25, 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#222'; ctx.fillRect(22, 10, 2, 2); // t' one good eye
    ctx.fillStyle = '#c8a0b8'; ctx.fillRect(12, 24, 2, 4); ctx.fillRect(18, 24, 2, 4);
    ctx.fillStyle = '#b89ec8'; ctx.fillRect(8, 12, 3, 5); // raggedy mane
  },
  [I.AMMONITE](ctx) {
    // a coiled snakestone
    ctx.strokeStyle = '#6a5a44'; ctx.lineWidth = 3.5;
    ctx.beginPath();
    for (let a = 0; a < Math.PI * 5; a += 0.15) {
      const r = 2 + a * 1.55;
      const x = 16 + Math.cos(a) * r, y = 16 + Math.sin(a) * r;
      a === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.strokeStyle = '#8a7a5e'; ctx.lineWidth = 1.2; ctx.stroke();
  },
  [I.FISH_CHIPS](ctx) {
    // a paper cone o' chips wi' battered fish atop
    ctx.fillStyle = '#e8e0d0'; // t' paper
    ctx.beginPath(); ctx.moveTo(8, 12); ctx.lineTo(24, 12); ctx.lineTo(19, 28); ctx.lineTo(13, 28); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#c8bca4'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#e8c050'; // chips poking out
    ctx.fillRect(10, 6, 3, 8); ctx.fillRect(14, 4, 3, 10); ctx.fillRect(18, 7, 3, 7);
    ctx.fillStyle = '#c89838'; // battered fish laid across
    ctx.beginPath(); ctx.ellipse(16, 11, 8, 3.4, -0.25, 0, 7); ctx.fill();
    ctx.strokeStyle = '#a87828'; ctx.stroke();
  },
  [I.GRYPHAEA](ctx) {
    ctx.fillStyle = '#4a4438';
    ctx.beginPath();
    ctx.moveTo(10, 6); ctx.quadraticCurveTo(26, 8, 24, 20);
    ctx.quadraticCurveTo(22, 28, 12, 26); ctx.quadraticCurveTo(4, 22, 10, 6);
    ctx.fill();
    ctx.strokeStyle = '#6a6254'; ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath(); ctx.arc(14 + i, 16, 6 + i * 2.4, 2.6, 4.6); ctx.stroke();
    }
  },
  [I.HIDE_SCRAP](ctx) {
    ctx.fillStyle = '#16161c'; ctx.beginPath();
    ctx.moveTo(7, 8); ctx.lineTo(24, 6); ctx.lineTo(27, 18); ctx.lineTo(20, 26); ctx.lineTo(9, 24); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#2c2c38'; ctx.fillRect(12, 11, 3, 3); ctx.fillRect(19, 17, 3, 2);
    ctx.strokeStyle = '#3a3a48'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(10, 20); ctx.lineTo(16, 14); ctx.stroke();
  },
  [I.HOLY_WATER](ctx) {
    ctx.fillStyle = '#8a9ab8'; ctx.fillRect(11, 8, 10, 18);
    ctx.fillStyle = '#c8d8f0'; ctx.fillRect(12, 9, 8, 4);
    ctx.fillStyle = '#4a6a9a'; ctx.fillRect(12, 13, 8, 12);
    ctx.fillStyle = '#a8c8e8'; ctx.fillRect(14, 15, 4, 3);
    ctx.strokeStyle = '#6a7a98'; ctx.lineWidth = 1; ctx.strokeRect(11, 8, 10, 18);
  },
  [I.WOODEN_STAKE](ctx) {
    ctx.fillStyle = '#6a5238'; ctx.fillRect(14, 4, 4, 24);
    ctx.fillStyle = '#8a6a48'; ctx.fillRect(15, 4, 2, 24);
    ctx.fillStyle = '#4a3828'; ctx.beginPath();
    ctx.moveTo(16, 4); ctx.lineTo(12, 10); ctx.lineTo(20, 10); ctx.closePath(); ctx.fill();
  },
  [I.HOLY_STAKE](ctx) {
    ctx.fillStyle = '#6a5238'; ctx.fillRect(14, 6, 4, 22);
    ctx.fillStyle = '#c8e0f8'; ctx.fillRect(13, 2, 6, 6);
    ctx.fillStyle = '#88b8e8'; ctx.fillRect(14, 3, 4, 4);
    ctx.fillStyle = '#e8f4ff'; ctx.fillRect(15, 4, 2, 2);
  },
  [I.DRACULA_JOURNAL](ctx) {
    ctx.fillStyle = '#2a1a14'; ctx.fillRect(8, 6, 16, 20);
    ctx.fillStyle = '#4a3028'; ctx.fillRect(8, 6, 16, 4);
    ctx.strokeStyle = '#8a6a48'; ctx.lineWidth = 1;
    ctx.strokeRect(8, 6, 16, 20);
    ctx.fillStyle = '#d8c8a8';
    for (let y = 12; y < 24; y += 3) ctx.fillRect(10, y, 12, 1);
    ctx.fillStyle = '#c82828'; ctx.fillRect(20, 7, 3, 2);
  },
};

function drawAmuletHalf(ctx, left) {
  ctx.save();
  ctx.beginPath();
  if (left) ctx.rect(0, 0, 16, 32); else ctx.rect(16, 0, 16, 32);
  ctx.clip();
  ctx.fillStyle = '#d8b95a'; ctx.beginPath(); ctx.arc(16, 17, 10, 0, 7); ctx.fill();
  ctx.fillStyle = '#0c0c14'; ctx.beginPath(); ctx.arc(16, 17, 5, 0, 7); ctx.fill();
  ctx.restore();
  // jagged broken edge
  ctx.fillStyle = '#8a6a2a';
  for (let y = 7; y < 28; y += 4) ctx.fillRect(left ? 14 : 16, y, 2, 2);
}

function drawMeat(ctx, c1, c2, s = 1) {
  ctx.save();
  ctx.translate(16, 16); ctx.scale(s, s); ctx.translate(-16, -16);
  ctx.fillStyle = c1; ctx.beginPath(); ctx.ellipse(13, 14, 9, 7, -0.6, 0, 7); ctx.fill();
  ctx.fillStyle = c2; ctx.beginPath(); ctx.ellipse(12, 13, 5, 3.5, -0.6, 0, 7); ctx.fill();
  ctx.fillStyle = '#e8e0d0'; ctx.fillRect(20, 20, 8, 4); ctx.fillRect(26, 18, 4, 8);
  ctx.restore();
}

function drawFish(ctx, body, belly) {
  ctx.fillStyle = body; ctx.beginPath(); ctx.ellipse(15, 16, 10, 5, 0, 0, 7); ctx.fill();
  ctx.fillStyle = belly; ctx.beginPath(); ctx.ellipse(14, 18, 7, 2.4, 0, 0, 7); ctx.fill();
  ctx.fillStyle = body; ctx.beginPath(); ctx.moveTo(24, 16); ctx.lineTo(30, 11); ctx.lineTo(30, 21); ctx.closePath(); ctx.fill(); // tail
  ctx.fillStyle = '#16161a'; ctx.beginPath(); ctx.arc(8, 15, 1.2, 0, 7); ctx.fill(); // eye
}

export function getIconURL(itemId) {
  if (iconCache.has(itemId)) return iconCache.get(itemId);
  const c = document.createElement('canvas');
  c.width = 32; c.height = 32;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  if (itemId < 64) {
    // block: draw its side (or top for plants) tile scaled up
    const def = BLOCKS[itemId];
    if (def && def.tex) {
      const tile = def.kind === 'cutout' ? def.tex.t : (def.tex.s ?? def.tex.t);
      const tx = (tile % ATLAS_TILES) * T, ty = Math.floor(tile / ATLAS_TILES) * T;
      if (def.kind === 'cutout' || def.kind === 'liquid') {
        ctx.drawImage(atlasCanvas, tx, ty, T, T, 2, 2, 28, 28);
      } else {
        // pseudo-3D cube icon
        const topTile = def.tex.t;
        const ttx = (topTile % ATLAS_TILES) * T, tty = Math.floor(topTile / ATLAS_TILES) * T;
        ctx.save();
        ctx.setTransform(1, -0.5, 1, 0.5, 4, 12);
        ctx.drawImage(atlasCanvas, ttx, tty, T, T, 0, 0, 12, 12);
        ctx.restore();
        ctx.save();
        ctx.setTransform(1, 0.5, 0, 1, 4, 12);
        ctx.globalAlpha = 0.8;
        ctx.drawImage(atlasCanvas, tx, ty, T, T, 0, 0, 12, 14);
        ctx.restore();
        ctx.save();
        ctx.setTransform(1, -0.5, 0, 1, 16, 18);
        ctx.globalAlpha = 0.6;
        ctx.drawImage(atlasCanvas, tx, ty, T, T, 0, 0, 12, 14);
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    }
  } else if (TOOLS[itemId]) {
    drawTool(ctx, itemId);
  } else if (ITEM_ICON_PAINTERS[itemId]) {
    ITEM_ICON_PAINTERS[itemId](ctx);
  }
  const url = c.toDataURL();
  iconCache.set(itemId, url);
  return url;
}

// Average colour of a tile (for particles / minimap)
const tileColorCache = new Map();
export function tileColor(tile) {
  if (tileColorCache.has(tile)) return tileColorCache.get(tile);
  const ctx = atlasCanvas.getContext('2d');
  const tx = (tile % ATLAS_TILES) * T, ty = Math.floor(tile / ATLAS_TILES) * T;
  const d = ctx.getImageData(tx, ty, T, T).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 100) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
  }
  n = Math.max(1, n);
  const col = [r / n | 0, g / n | 0, b / n | 0];
  tileColorCache.set(tile, col);
  return col;
}
