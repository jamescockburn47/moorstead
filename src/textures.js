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
  [TILE.COTTONGRASS](p) {
    p.clear();
    for (let i = 0; i < 6; i++) {
      const x = 2 + ((p.rng() * 12) | 0);
      const h = 7 + ((p.rng() * 7) | 0);
      for (let y = 0; y < h; y++) p.px(x, T - 1 - y, shade(0x6b6b40, 0.7 + p.rng() * 0.3)); // green stalk
      // white cotton head
      for (let dy = 0; dy < 3; dy++) for (let dx = -1; dx <= 1; dx++) p.px(x + dx, T - 1 - h - dy, shade(0xf4f1ea, 0.85 + p.rng() * 0.3));
    }
  },
  [TILE.WOOL](p) {
    p.speckle(0xe2dcd0, 0.08);
    p.dots(0xcfc8ba, 24); p.dots(0xf2eee6, 18);
  },
  [TILE.BILBERRY](p) {
    p.clear();
    // low rounded bush — berries come seasonally from t' overlay
    for (let y = 6; y < T; y++) for (let x = 2; x < 14; x++) {
      const cx = x - 8, cy = y - 11;
      if (cx * cx / 36 + cy * cy / 25 < 1 && p.rng() < 0.85) {
        p.px(x, y, shade(0x46622e, 0.8 + p.rng() * 0.4));
      }
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
    // lush green shuttlecock fronds wi' fiddlehead curls at t' tip
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
      // fiddlehead curl at t' tip: a tight 4-5 pixel spiral
      const tipX = Math.round(x + lean * (h - 1));
      const tipY = T - h;
      const curl = shade(0x2d5a20, 1);
      p.px(tipX,     tipY,     curl);
      p.px(tipX + 1, tipY,     curl);
      p.px(tipX + 1, tipY + 1, shade(0x3a6e2a, 1));
      p.px(tipX,     tipY + 1, shade(0x3a6e2a, 1));
      p.px(tipX,     tipY + 2, shade(0x4f7e38, 0.9));
    }
  },
  [TILE.FOXGLOVE](p) {
    p.clear();
    // tall spike wi' a graduated one-sided column o' purple bells — visibly different from heather
    for (let i = 0; i < 2; i++) {
      const x = 4 + ((p.rng() * 8) | 0);
      const h = 13 + ((p.rng() * 2) | 0); // tall: 13-14 px
      // full-length stem
      for (let y = 0; y < h; y++) p.px(x, T - 1 - y, shade(0x3c5a2a, 0.85 + p.rng() * 0.3));
      // basal rosette leaves
      p.px(x - 2, T - 2, shade(0x46682e, 1)); p.px(x + 2, T - 1, shade(0x46682e, 1));
      p.px(x - 1, T - 3, shade(0x3c5a2a, 0.9)); p.px(x + 1, T - 2, shade(0x3c5a2a, 0.9));
      // bells: graduated size — larger at base o' spike, smaller toward tip, always on same side
      const bellStart = T - h;
      const bellLen = Math.floor(h * 0.65);
      for (let b = 0; b < bellLen; b++) {
        const by = bellStart + b;
        const bellW = Math.max(1, Math.round(2.2 - b * 1.6 / bellLen)); // tapers from 2 to 1
        const bellC = shade(0x9a3f9e, 0.8 + p.rng() * 0.35);
        const innerC = shade(0xc060c8, 0.9 + p.rng() * 0.2);
        if (b % 2 === 0) { // alternate rows for clear bell spacing
          for (let bx = 1; bx <= bellW + 1; bx++) p.px(x + bx, by, bellC);
          p.px(x + 1, by, innerC); // lighter inner
          if (bellW > 0) p.px(x + 2, by, innerC);
        }
      }
      p.px(x, bellStart,     '#d890d8'); // pale closed bud at t' very tip
      p.px(x, bellStart + 1, '#c070c0');
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
  [TILE.MINE_ENTRANCE](p) {
    p.speckle(0x7d7468, 0.14);
    p.rect(2, 2, 12, 14, '#1b1b1f');
    p.rect(2, 2, 12, 2, '#5a452c');
    p.rect(2, 2, 2, 14, '#5a452c');
    p.rect(12, 2, 2, 14, '#5a452c');
  },
  [TILE.PIT_PROPS](p) {
    p.speckle(0x7d7468, 0.14);
    p.rect(1, 0, 3, T, '#5a452c');
    p.rect(12, 0, 3, T, '#5a452c');
    p.rect(1, 1, 14, 3, '#5a452c');
    p.rect(1, 12, 14, 3, '#5a452c');
  },
  [TILE.SAFETY_LAMP](p) {
    p.speckle(0x2a2a30, 0.1);
    p.rect(4, 1, 8, 14, '#242429');
    p.rect(5, 4, 6, 8, '#f2be3a');
    p.rect(6, 6, 4, 4, '#fffae8');
    p.rect(4, 8, 8, 1, '#242429');
    p.rect(7, 1, 2, 1, '#1b1b1f');
  },
  [TILE.WINCH](p) {
    p.speckle(0x7d7468, 0.14);
    p.rect(1, 4, 14, 8, '#5a452c');
    p.rect(4, 5, 8, 6, '#b88a5c');
    p.rect(8, 2, 2, 12, '#242429');
  },
  [TILE.ALUM](p) {
    p.speckle(0x5c575e, 0.15);
    p.dots(0x4b464d, 22); p.dots(0x726c75, 14);
    for (let i = 0; i < 3; i++) {
      const x = (p.rng() * T) | 0, y = (p.rng() * T) | 0;
      p.rect(x, y, 3, 1, shade(0x403c42, 1));
    }
  },
  [TILE.POLYHALITE](p) {
    p.speckle(0x7d7468, 0.14);
    for (let i = 0; i < 6; i++) {
      const x = 1 + ((p.rng() * 12) | 0), y = 1 + ((p.rng() * 12) | 0);
      p.rect(x, y, 2, 2, '#d95a53'); p.px(x, y, '#ff7870'); p.px(x+1, y+1, '#ff968f');
    }
  },
  [TILE.ROCK_SALT](p) {
    p.speckle(0x7d7468, 0.14);
    for (let i = 0; i < 6; i++) {
      const x = 1 + ((p.rng() * 12) | 0), y = 1 + ((p.rng() * 12) | 0);
      p.rect(x, y, 2, 2, '#e6e6fa'); p.px(x, y, '#ffffff'); p.px(x+1, y+1, '#f8f8ff');
    }
  },
  [TILE.BRAMBLE](p) {
    p.clear();
    for (let i = 0; i < 9; i++) { let x = 2 + ((p.rng()*12)|0), y = T-1; const h = 8 + ((p.rng()*6)|0);
      for (let s = 0; s < h; s++) { p.px(x&15, y, shade(0x2f4a24, 0.8 + p.rng()*0.4)); y--; x += p.rng()<0.5?0:(p.rng()<0.5?-1:1); } }
    p.dots(0x213518, 16);
  },
  [TILE.SNOWDROP](p) {
    p.clear();
    // short green stem wi' a small white nodding bell near t' top
    for (let i = 0; i < 3; i++) {
      const x = 4 + ((p.rng() * 8) | 0);
      const h = 7 + ((p.rng() * 4) | 0);
      for (let y = 0; y < h; y++) p.px(x, T - 1 - y, shade(0x3a6028, 0.85 + p.rng() * 0.3));
      // nodding bell: stem droops slightly at t' tip, bell hangs down
      const tipY = T - h;
      const bx = x + 1;
      p.px(bx,     tipY,     shade(0x3a6028, 0.8)); // drooping pedicel
      p.px(bx,     tipY + 1, '#e8e8e8');            // outer bell
      p.px(bx + 1, tipY + 1, '#f0f0f0');
      p.px(bx,     tipY + 2, '#d8d8d8');            // inner shadow
      p.px(bx + 1, tipY + 2, '#e0e0e0');
      p.px(bx,     tipY + 3, '#c8eab4');            // green tip o' t' ovary
    }
  },
  [TILE.DAFFODIL](p) {
    p.clear();
    // taller green stem wi' a yellow trumpet flower
    for (let i = 0; i < 3; i++) {
      const x = 3 + ((p.rng() * 10) | 0);
      const h = 10 + ((p.rng() * 4) | 0);
      for (let y = 2; y < h; y++) p.px(x, T - 1 - y, shade(0x3a6028, 0.85 + p.rng() * 0.3));
      // narrow strap leaves alongside t' stem
      if (p.rng() < 0.7) p.px(x - 1, T - 3, shade(0x4a7030, 0.9));
      // trumpet: pale-yellow outer petals + orange-yellow cup
      const tx = x, ty = T - h - 1;
      p.px(tx - 1, ty,     '#f2dc70'); // outer petals
      p.px(tx + 1, ty,     '#f2dc70');
      p.px(tx,     ty - 1, '#ede060');
      p.px(tx - 1, ty + 1, '#ece858');
      p.px(tx + 1, ty + 1, '#ece858');
      p.px(tx,     ty,     '#e8a020'); // central cup — deeper orange
      p.px(tx,     ty + 1, '#f0b830');
    }
  },
  [TILE.WILDFLOWER](p) {
    p.clear();
    // small meadow tuft wi' flower dots in mixed warm hues
    for (let i = 0; i < 8; i++) {
      const x = 2 + ((p.rng() * 12) | 0);
      const h = 4 + ((p.rng() * 7) | 0);
      for (let y = 0; y < h; y++) p.px(x, T - 1 - y, shade(0x4a6a2e, 0.8 + p.rng() * 0.4));
    }
    // scattered flower heads in warm varied hues
    for (let i = 0; i < 6; i++) {
      const fx = 2 + ((p.rng() * 12) | 0), fy = 2 + ((p.rng() * 9) | 0);
      const hue = p.rng();
      let col;
      if (hue < 0.25)      col = shade(0xd44060, 0.9 + p.rng() * 0.2);  // pink-red
      else if (hue < 0.5)  col = shade(0xe8a020, 0.9 + p.rng() * 0.2);  // amber
      else if (hue < 0.75) col = shade(0xcc50cc, 0.9 + p.rng() * 0.2);  // purple
      else                 col = shade(0xf0dc40, 0.9 + p.rng() * 0.2);  // yellow
      p.px(fx, fy, col);
      p.px(fx + 1, fy, col);
    }
  },
  [TILE.BRAMBLE_FLOWER](p) {
    p.clear();
    // tiny white 5-petal blossom sprite, centred
    const cx = 8, cy = 8;
    // 5 petals arranged round t' centre
    const petals = [[-1,-2],[1,-2],[-2,0],[2,0],[0,2]];
    for (const [dx, dy] of petals) {
      p.px(cx + dx, cy + dy, '#f0f0f4');
      p.px(cx + dx + (dx > 0 ? 1 : 0), cy + dy, '#e0e0ea');
    }
    p.px(cx, cy, '#f8e060');     // yellow centre
    p.px(cx - 1, cy, '#f0f0f4');
    p.px(cx + 1, cy, '#f0f0f4');
    p.px(cx, cy - 1, '#f0f0f4');
    p.px(cx, cy + 1, '#f0f0f4');
    // short green stems below
    for (let i = 0; i < 3; i++) {
      const sx = 5 + ((p.rng() * 6) | 0);
      for (let y = cy + 3; y < T - 1; y++) p.px(sx, y, shade(0x3a6028, 0.85 + p.rng() * 0.3));
    }
  },
  [TILE.BLACKBERRY](p) {
    p.clear();
    // short green stems
    for (let i = 0; i < 5; i++) {
      const x = 3 + ((p.rng() * 10) | 0), h = 4 + ((p.rng() * 5) | 0);
      for (let y = 0; y < h; y++) p.px(x, T - 1 - y, shade(0x2f4a24, 0.8 + p.rng() * 0.4));
    }
    // cluster o' dark purple-black berries
    for (let i = 0; i < 8; i++) {
      const bx = 2 + ((p.rng() * 12) | 0), by = 3 + ((p.rng() * 9) | 0);
      const dark = p.rng() < 0.5;
      p.px(bx,     by,     dark ? '#1c1230' : '#2e1d4a');
      p.px(bx + 1, by,     dark ? '#2e1d4a' : '#3a2860');
      p.px(bx,     by + 1, dark ? '#241840' : '#1c1230');
      p.px(bx + 1, by + 1, '#1a1028');
    }
    p.dots(0x1c1230, 6);
  },
  [TILE.BILBERRY_FRUIT](p) {
    p.clear();
    // short leafy green stems
    for (let i = 0; i < 5; i++) {
      const x = 3 + ((p.rng() * 10) | 0), h = 4 + ((p.rng() * 4) | 0);
      for (let y = 0; y < h; y++) p.px(x, T - 1 - y, shade(0x46622e, 0.8 + p.rng() * 0.4));
    }
    // a few small blue-black bilberries
    for (let i = 0; i < 6; i++) {
      const bx = 3 + ((p.rng() * 10) | 0), by = 3 + ((p.rng() * 8) | 0);
      p.px(bx,     by,     '#2c3460');
      p.px(bx + 1, by,     '#3a4480');
      p.px(bx,     by + 1, '#242c54');
      p.px(bx + 1, by + 1, '#2c3460');
    }
  },
  [TILE.HOLLY](p) {
    p.clear();
    // spiky dark-green evergreen leaves wi' jagged edges — no berries
    for (let i = 0; i < 5; i++) {
      const cx = 3 + ((p.rng() * 10) | 0), cy = 3 + ((p.rng() * 10) | 0);
      const w = 3 + ((p.rng() * 3) | 0), h = 4 + ((p.rng() * 3) | 0);
      // leaf body
      for (let dy = 0; dy < h; dy++) for (let dx = -w; dx <= w; dx++) {
        const inside = Math.abs(dx) <= w - Math.abs(dy - h / 2) * 0.9;
        if (inside && p.rng() < 0.88) p.px(cx + dx, cy + dy, shade(0x1a4a1a, 0.8 + p.rng() * 0.4));
      }
      // jagged spine tips — alternating spikes along edge
      for (let sp = 0; sp < 3; sp++) {
        const sx = cx - w + sp * w; const sy = cy + ((sp % 2 === 0) ? 0 : h - 1);
        p.px(sx, sy, shade(0x0e3010, 1));  // dark spike tip
      }
      // midrib
      for (let dy = 0; dy < h; dy++) p.px(cx, cy + dy, shade(0x2a6028, 0.9));
    }
    p.dots(0x0e3010, 8);
  },
  [TILE.ICE](p) {
    p.clear();
    p.speckle(0xb8d0e0, 0.10);
    for (let i = 0; i < 5; i++) {
      let x = (p.rng() * T) | 0, y = (p.rng() * T) | 0;
      for (let s = 0; s < 4; s++) { p.px(x & 15, y & 15, shade(0xdff0ff, 1)); x += p.rng() < 0.5 ? 1 : 0; y += 1; }
    }
  },
  [TILE.HOLLY_BERRY](p) {
    p.clear();
    // dark green leaf background
    for (let y = 4; y < T; y++) for (let x = 1; x < 15; x++) {
      if (p.rng() < 0.55) p.px(x, y, shade(0x1a4a1a, 0.75 + p.rng() * 0.4));
    }
    // cluster o' bright red berries
    for (let i = 0; i < 7; i++) {
      const bx = 2 + ((p.rng() * 11) | 0), by = 2 + ((p.rng() * 9) | 0);
      const bright = p.rng() < 0.5;
      p.px(bx,     by,     bright ? '#e03030' : '#c01818');
      p.px(bx + 1, by,     bright ? '#f04040' : '#d82020');
      p.px(bx,     by + 1, '#c01818');
      p.px(bx + 1, by + 1, '#a81010');
      p.px(bx,     by,     '#ff6060'); // specular highlight
    }
  },
  [TILE.CEP](p) {
    p.clear();
    // a fat pale stalk wi' a rounded brown cap — porcini-style cep
    for (let i = 0; i < 2; i++) {
      const x = 4 + ((p.rng() * 8) | 0);
      // stalk: fat pale column
      const sh = 5 + ((p.rng() * 3) | 0);
      for (let y = T - 1; y > T - 1 - sh; y--) {
        p.px(x - 1, y, shade(0xd4c8a0, 0.85 + p.rng() * 0.2));
        p.px(x,     y, shade(0xe0d4b0, 0.85 + p.rng() * 0.2));
        p.px(x + 1, y, shade(0xc8bc94, 0.85 + p.rng() * 0.2));
      }
      // cap: rounded dome in warm brown, wider than the stalk
      const cy = T - 1 - sh;
      const cw = 4 + ((p.rng() * 2) | 0);
      for (let dy = 0; dy < 5; dy++) {
        const hw = Math.round(cw * Math.sqrt(1 - (dy / 5) * (dy / 5)));
        for (let dx = -hw; dx <= hw; dx++) {
          p.px(x + dx, cy - dy, shade(dy < 2 ? 0x6b4218 : 0x8a5a28, 0.8 + p.rng() * 0.35));
        }
      }
      // paler underside rim
      for (let dx = -cw; dx <= cw; dx++) p.px(x + dx, cy, shade(0xc8a870, 0.9));
    }
  },
  [TILE.CHANTERELLE](p) {
    p.clear();
    // golden/yellow funnel-shaped mushroom — wavy cap edge, hollow centre
    for (let i = 0; i < 2; i++) {
      const x = 4 + ((p.rng() * 8) | 0);
      const sh = 5 + ((p.rng() * 3) | 0);
      // stalk: slender golden
      for (let y = T - 1; y > T - 1 - sh; y--) {
        p.px(x, y, shade(0xd4a820, 0.85 + p.rng() * 0.25));
        if (p.rng() < 0.5) p.px(x - 1, y, shade(0xbc9418, 0.8 + p.rng() * 0.2));
      }
      // funnel cap: wide at top, curled-down edges, bright golden-yellow
      const cy = T - 1 - sh;
      const cw = 4 + ((p.rng() * 2) | 0);
      for (let dy = 0; dy < 4; dy++) {
        const hw = cw - dy + (dy === 3 ? 1 : 0); // flares at tip for wavy edge
        for (let dx = -hw; dx <= hw; dx++) {
          const atEdge = Math.abs(dx) >= hw - 1;
          p.px(x + dx, cy - dy, shade(atEdge ? 0xf0c830 : 0xe8b018, 0.8 + p.rng() * 0.35));
        }
      }
      // pale gill ridges on underside of cap
      for (let dx = -cw + 1; dx < cw; dx += 2) p.px(x + dx, cy, shade(0xf8e090, 0.9));
    }
  },
  [TILE.WILD_GARLIC](p) {
    p.clear();
    // broad green leaves wi' a few tiny white star flowers
    // leaves: broad, upright, slightly arching
    for (let i = 0; i < 5; i++) {
      const x = 2 + ((p.rng() * 12) | 0);
      const h = 9 + ((p.rng() * 5) | 0);
      const lean = (p.rng() - 0.5) * 0.5;
      for (let y = 0; y < h; y++) {
        const yy = T - 1 - y;
        const sx = Math.round(x + lean * y);
        const w = 1 + (y < h * 0.7 ? 1 : 0); // broad in the lower half
        for (let dx = -w; dx <= w; dx++) {
          p.px(sx + dx, yy, shade(0x3a6a2c, 0.8 + p.rng() * 0.4));
        }
      }
    }
    // white star flowers — 5-point, scattered near top
    for (let i = 0; i < 4; i++) {
      const fx = 3 + ((p.rng() * 10) | 0), fy = 2 + ((p.rng() * 5) | 0);
      p.px(fx,     fy,     '#f4f4f8');
      p.px(fx - 1, fy,     '#e8e8f0');
      p.px(fx + 1, fy,     '#e8e8f0');
      p.px(fx,     fy - 1, '#f0f0f8');
      p.px(fx,     fy + 1, '#e0e0ea');
      p.px(fx,     fy,     '#f8e840'); // tiny yellow centre
    }
  },
  [TILE.SORREL](p) {
    p.clear();
    // a clump of slim upright green leaves — arrow-shaped, slightly reddish tips
    for (let i = 0; i < 6; i++) {
      const x = 2 + ((p.rng() * 12) | 0);
      const h = 7 + ((p.rng() * 6) | 0);
      const lean = (p.rng() - 0.5) * 0.4;
      for (let y = 0; y < h; y++) {
        const yy = T - 1 - y;
        const sx = Math.round(x + lean * y);
        const atTip = y > h * 0.75;
        // slim: 1px wide; reddish-green at tips
        p.px(sx, yy, shade(atTip ? 0x8a5a3a : 0x4a7830, 0.8 + p.rng() * 0.4));
        // slight leaf width in mid-section
        if (y > 1 && y < h * 0.5 && p.rng() < 0.5) {
          p.px(sx + (p.rng() < 0.5 ? -1 : 1), yy, shade(0x3e6428, 0.75 + p.rng() * 0.35));
        }
      }
    }
  },
  [TILE.ROSEHIP](p) {
    p.clear();
    // thorny arching spray wi' bright red-orange hips
    for (let i = 0; i < 4; i++) {
      let x = 3 + ((p.rng() * 10) | 0), y = T - 1;
      const h = 9 + ((p.rng() * 5) | 0);
      for (let s = 0; s < h && y > 2; s++) {
        p.px(x & 15, y, shade(0x4a3828, 0.85 + p.rng() * 0.3)); // dark woody cane
        if (p.rng() < 0.25) p.px((x + (p.rng() < 0.5 ? -1 : 1)) & 15, y, shade(0x3a2c20, 1)); // thorns
        x += p.rng() < 0.5 ? (p.rng() < 0.5 ? -1 : 1) : 0; y--;
      }
      // leaves along cane
      for (let lf = 0; lf < 3; lf++) {
        const lx = 2 + ((p.rng() * 12) | 0), ly = 4 + ((p.rng() * 8) | 0);
        p.px(lx, ly, shade(0x3a5a28, 0.9 + p.rng() * 0.2));
        p.px(lx + 1, ly, shade(0x4a6a32, 0.85 + p.rng() * 0.2));
      }
    }
    // red-orange hips — oval, clustered
    for (let i = 0; i < 6; i++) {
      const hx = 2 + ((p.rng() * 12) | 0), hy = 2 + ((p.rng() * 10) | 0);
      p.px(hx,     hy,     '#d43c18');
      p.px(hx + 1, hy,     '#e85020');
      p.px(hx,     hy + 1, '#c03010');
      p.px(hx + 1, hy + 1, '#d44020');
      p.px(hx,     hy,     '#ff7040'); // specular
    }
  },
  [TILE.SLOE](p) {
    p.clear();
    // dark twiggy bush wi' blue-black sloes, dusty bloom
    for (let i = 0; i < 8; i++) {
      let x = 2 + ((p.rng() * 12) | 0), y = T - 1;
      const h = 7 + ((p.rng() * 7) | 0);
      for (let s = 0; s < h && y > 1; s++) {
        p.px(x & 15, y, shade(0x2a2018, 0.85 + p.rng() * 0.3)); // near-black twig
        if (p.rng() < 0.2) { // sparse small leaves
          const lc = shade(0x2e4a22, 0.8 + p.rng() * 0.3);
          p.px((x + (p.rng() < 0.5 ? -1 : 1)) & 15, y, lc);
        }
        x += p.rng() < 0.4 ? (p.rng() < 0.5 ? -1 : 1) : 0; y--;
      }
    }
    // blue-black sloes wi' dusty bloom (slightly lighter highlight)
    for (let i = 0; i < 8; i++) {
      const sx = 2 + ((p.rng() * 12) | 0), sy = 2 + ((p.rng() * 10) | 0);
      p.px(sx,     sy,     '#1c1a30');
      p.px(sx + 1, sy,     '#2a2840');
      p.px(sx,     sy + 1, '#16142a');
      p.px(sx + 1, sy + 1, '#201e38');
      p.px(sx,     sy,     '#6868a8'); // dusty bloom highlight
    }
  },
  [TILE.ELDERBERRY](p) {
    p.clear();
    // drooping umbel sprays of tiny near-black berries on red-purple stems
    // foliage body
    for (let y = 2; y < T; y++) for (let x = 1; x < 15; x++) {
      const cx = x - 8, cy = y - 9;
      if (cx * cx / 45 + cy * cy / 50 < 1 && p.rng() < 0.78) p.px(x, y, shade(0x2e4822, 0.8 + p.rng() * 0.4));
    }
    p.rect(7, T - 3, 2, 3, shade(0x4a3a26, 1)); // woody base
    // berry umbels: drooping clusters from central stem
    for (let u = 0; u < 3; u++) {
      const ux = 4 + ((p.rng() * 8) | 0), uy = 3 + ((p.rng() * 5) | 0);
      // stems radiating down
      for (let r = 0; r < 4; r++) {
        const rx = ux + ((p.rng() * 6 - 3) | 0), ry = uy + 2 + ((p.rng() * 3) | 0);
        p.px(rx, ry, '#6a2040'); // reddish-purple stem
        // tiny berries at stem tips
        p.px(rx,     ry + 1, '#0e0c18');
        p.px(rx + 1, ry + 1, '#1a1828');
        p.px(rx,     ry + 2, '#0a0814');
        p.px(rx + 1, ry + 2, '#0e0c18');
      }
    }
  },
  [TILE.HAZELNUT](p) {
    p.clear();
    // rounded green hedge bush wi' clusters of pale-green nuts in leafy husks
    for (let y = 1; y < T; y++) for (let x = 1; x < 15; x++) {
      const cx = x - 8, cy = y - 9;
      if (cx * cx / 46 + cy * cy / 52 < 1 && p.rng() < 0.80) p.px(x, y, shade(0x3a5c28, 0.8 + p.rng() * 0.4));
    }
    p.rect(7, T - 3, 2, 3, shade(0x4a3a26, 1)); // woody base
    // nut clusters: 2-3 nuts per cluster in pale-green husks
    for (let c = 0; c < 4; c++) {
      const cx = 3 + ((p.rng() * 10) | 0), cy = 3 + ((p.rng() * 7) | 0);
      // husk — ragged pale-green jacket
      p.px(cx - 1, cy,     shade(0x7a9a40, 0.9 + p.rng() * 0.2));
      p.px(cx,     cy - 1, shade(0x8aaa4a, 0.9 + p.rng() * 0.2));
      p.px(cx + 1, cy,     shade(0x6a8a36, 0.9 + p.rng() * 0.2));
      p.px(cx,     cy + 1, shade(0x7a9a40, 0.85 + p.rng() * 0.2));
      // nut — pale tan-brown sphere
      p.px(cx,     cy,     '#c8b860');
      p.px(cx - 1, cy + 1, '#b8a850');
      if (p.rng() < 0.6) {
        // second nut alongside
        p.px(cx + 2, cy,     '#c0b058');
        p.px(cx + 2, cy - 1, shade(0x7a9a40, 0.85));
        p.px(cx + 3, cy,     shade(0x8aaa4a, 0.9));
      }
    }
  },
  [TILE.BLACKTHORN](p) {
    p.clear();
    // dark twiggy bush wi' sparse leaves — the pre-sloe-flower look, angular silhouette
    for (let i = 0; i < 10; i++) {
      let x = 2 + ((p.rng() * 12) | 0), y = T - 1;
      const h = 7 + ((p.rng() * 7) | 0);
      for (let s = 0; s < h && y > 1; s++) {
        p.px(x & 15, y, shade(0x1e1610, 0.85 + p.rng() * 0.3)); // very dark near-black
        // occasional thorn spike
        if (p.rng() < 0.18) p.px((x + (p.rng() < 0.5 ? -1 : 2)) & 15, y, shade(0x140e0a, 1));
        // sparse small leaves
        if (p.rng() < 0.15) p.px((x + (p.rng() < 0.5 ? -1 : 1)) & 15, y - (p.rng() < 0.5 ? 0 : 1), shade(0x2e4a1e, 0.85 + p.rng() * 0.3));
        x += p.rng() < 0.45 ? (p.rng() < 0.5 ? -1 : 1) : 0; y--;
      }
    }
    p.dots(0x160e08, 6); // extra dark specks for bark texture
  },
  [TILE.HAZEL](p) {
    p.clear();
    // rounded green hedge bush — leafy, full canopy, lighter than blackthorn
    for (let y = 1; y < T; y++) for (let x = 1; x < 15; x++) {
      const cx = x - 8, cy = y - 9;
      if (cx * cx / 46 + cy * cy / 52 < 1 && p.rng() < 0.82) p.px(x, y, shade(0x3a5a26, 0.8 + p.rng() * 0.4));
    }
    p.rect(7, T - 3, 2, 3, shade(0x4a3a26, 1)); // woody base
    // brighter leaf highlights to distinguish from elder
    p.dots(0x5a7a38, 14); p.dots(0x2e4a1e, 10);
  },
  [TILE.ORCHARD_LEAVES](p) {
    // lush rounded orchard canopy — softer, lighter green than oak TILE.LEAVES
    p.speckle(0x4e6e2e, 0.22);
    p.dots(0x62863c, 28); p.dots(0x3a5420, 18); p.dots(0x7aa050, 12);
  },
  [TILE.APPLE](p) {
    // orchard canopy wi' clusters o' red-and-green apples
    TILE_PAINTERS[TILE.ORCHARD_LEAVES](p);
    for (let i = 0; i < 6; i++) {
      const ax = 2 + ((p.rng() * 12) | 0), ay = 2 + ((p.rng() * 10) | 0);
      const bright = p.rng() < 0.6;
      p.px(ax,     ay,     bright ? '#d03020' : '#b02010');
      p.px(ax + 1, ay,     bright ? '#e04030' : '#c02818');
      p.px(ax,     ay + 1, bright ? '#c02818' : '#a01808');
      p.px(ax + 1, ay + 1, '#b02010');
      p.px(ax,     ay,     '#ff6050'); // specular
      // green cheek on one side
      p.px(ax - 1, ay,     shade(0x5a8830, 0.9 + p.rng() * 0.2));
    }
  },
  [TILE.PEAR](p) {
    // orchard canopy wi' yellow-green pears
    TILE_PAINTERS[TILE.ORCHARD_LEAVES](p);
    for (let i = 0; i < 6; i++) {
      const px2 = 2 + ((p.rng() * 12) | 0), py = 2 + ((p.rng() * 10) | 0);
      p.px(px2,     py,     '#c8d040');
      p.px(px2 + 1, py,     '#d8e050');
      p.px(px2,     py + 1, '#b0bc30');
      p.px(px2 + 1, py + 1, '#c0cc38');
      p.px(px2,     py,     '#eef870'); // specular
    }
  },
  [TILE.PLUM](p) {
    // orchard canopy wi' deep purple plums, pale dusty bloom
    TILE_PAINTERS[TILE.ORCHARD_LEAVES](p);
    for (let i = 0; i < 6; i++) {
      const plx = 2 + ((p.rng() * 12) | 0), ply = 2 + ((p.rng() * 10) | 0);
      p.px(plx,     ply,     '#4a1860');
      p.px(plx + 1, ply,     '#5e2278');
      p.px(plx,     ply + 1, '#3c1250');
      p.px(plx + 1, ply + 1, '#4a1860');
      p.px(plx,     ply,     '#9a80b8'); // dusty bloom highlight
    }
  },
  [TILE.SNOWBALL](p) {
    p.clear();
    // round white snowball — blue-grey shadow lower-right, bright highlight top-left
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const dx = x - 8, dy = y - 8;
      if (dx * dx + dy * dy < 44) {
        // soft grey-blue shading: stronger bottom-right, lighter top-left
        const shade_amt = 0.72 + (dx + dy) * 0.022;
        const f = Math.min(1, Math.max(0.58, shade_amt));
        const r = Math.round(220 * f), g = Math.round(228 * f), b = Math.round(240 * f);
        p.px(x, y, `rgb(${r},${g},${b})`);
      }
    }
    // top-left specular highlight
    p.px(5, 4, '#ffffff'); p.px(6, 4, '#f8faff');
    p.px(4, 5, '#f8faff'); p.px(5, 5, '#ffffff');
  },
  [TILE.WREATH](p) {
    p.clear();
    // holly wreath: a green ring wi' red berries an' a red bow at t' bottom
    const cx = 8, cy = 7, ro = 6, ri = 3;
    for (let y = 0; y < 14; y++) for (let x = 0; x < T; x++) {
      const dx = x - cx, dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= ri * ri && d2 <= ro * ro) {
        p.px(x, y, shade(0x1e5218, 0.8 + p.rng() * 0.35));
      }
    }
    // jagged leaf tips round the ring
    for (let a = 0; a < 24; a++) {
      const ang = (a / 24) * Math.PI * 2;
      const r = ro - 1;
      const lx = Math.round(cx + Math.cos(ang) * r);
      const ly = Math.round(cy + Math.sin(ang) * r);
      if (lx >= 0 && lx < T && ly >= 0 && ly < 14) {
        p.px(lx, ly, shade(a % 3 === 0 ? 0x0e3a0e : 0x2a6828, 1));
      }
    }
    // red berries: a cluster of 7 round the ring
    const berryAngles = [0.3, 1.1, 1.9, 2.7, 3.5, 4.3, 5.1];
    for (const ang of berryAngles) {
      const r = (ro + ri) / 2;
      const bx = Math.round(cx + Math.cos(ang) * r);
      const by = Math.round(cy + Math.sin(ang) * r);
      if (bx >= 0 && bx < T && by >= 0 && by < 14) {
        p.px(bx, by, '#d42020');
        if (bx + 1 < T) p.px(bx + 1, by, '#e83030');
        p.px(bx, by, '#ff5050'); // specular
      }
    }
    // red bow at the bottom: two loops + a knot
    p.rect(5, 13, 3, 2, '#c01818'); // left loop
    p.rect(9, 13, 3, 2, '#c01818'); // right loop
    p.rect(7, 13, 2, 2, '#e03030'); // knot
    p.px(8, 12, '#b01010');         // ribbon tail up
  },
  [TILE.ROBIN](p) {
    p.clear();
    // small robin: brown body wi' a bright orange-red breast, dark wing, pale belly
    // body: fat rounded silhouette, centred
    for (let y = 4; y < 13; y++) for (let x = 3; x < 13; x++) {
      const dx = x - 8, dy = y - 8;
      if (dx * dx * 1.2 + dy * dy < 16) {
        // brown back upper half, orange breast lower front
        const breast = dx < 1 && dy > -1;
        p.px(x, y, shade(breast ? 0xd05010 : 0x5a3a18, 0.8 + p.rng() * 0.3));
      }
    }
    // wing: slightly darker brown patch on the right side
    for (let y = 6; y < 12; y++) for (let x = 9; x < 13; x++) {
      const dx = x - 11, dy = y - 9;
      if (dx * dx + dy * dy < 8 && p.rng() < 0.75) {
        p.px(x, y, shade(0x3a2410, 0.85 + p.rng() * 0.25));
      }
    }
    // head: small rounded dark cap
    for (let y = 2; y < 7; y++) for (let x = 5; x < 12; x++) {
      const dx = x - 8, dy = y - 4;
      if (dx * dx + dy * dy < 10 && p.rng() < 0.85) {
        p.px(x, y, shade(0x4a2e10, 0.8 + p.rng() * 0.3));
      }
    }
    // beak: tiny dark yellow point
    p.px(12, 4, shade(0x9a7a18, 1));
    p.px(13, 4, shade(0x7a5a10, 1));
    // eye: single bright pixel
    p.px(10, 3, '#111111');
    p.px(10, 3, '#333333'); // highlight nearby
    p.px(11, 3, '#cccccc');
    // tail: short dark wedge
    p.rect(3, 10, 3, 2, shade(0x3a2410, 1));
    p.px(2, 11, shade(0x2a1a08, 1));
    // legs: two thin dark lines
    p.px(7, 13, '#2a2010'); p.px(7, 14, '#2a2010');
    p.px(9, 13, '#2a2010'); p.px(9, 14, '#2a2010');
    p.px(6, 15, '#2a2010'); p.px(10, 15, '#2a2010'); // claws
  },
  [TILE.HOLLY_SPRIG](p) {
    p.clear();
    // a cluster o' dark-green holly leaves wi' red berries — denser than TILE.HOLLY
    // two large leaves, crossing
    for (let i = 0; i < 3; i++) {
      const lx = 3 + i * 4, ly = 4 + ((i % 2) * 3);
      const lw = 3 + (i % 2), lh = 5 + (i % 2);
      for (let dy = 0; dy < lh; dy++) for (let dx = -lw; dx <= lw; dx++) {
        const inside = Math.abs(dx) <= lw - Math.abs(dy - lh / 2) * 0.7;
        if (inside && p.rng() < 0.9) {
          p.px(lx + dx, ly + dy, shade(0x1a4a18, 0.78 + p.rng() * 0.38));
        }
      }
      // midrib
      for (let dy = 0; dy < lh; dy++) p.px(lx, ly + dy, shade(0x2a6828, 0.88));
      // jagged spine tips
      p.px(lx - lw, ly + 1, shade(0x0d2e0d, 1));
      p.px(lx + lw, ly + lh - 2, shade(0x0d2e0d, 1));
    }
    // stem
    p.rect(7, 11, 2, 5, shade(0x3a5220, 1));
    // bright red berries: cluster of 5 near the centre
    const bpos = [[7, 8], [9, 7], [8, 9], [10, 9], [6, 10]];
    for (const [bx, by] of bpos) {
      p.px(bx,     by,     '#d42020');
      p.px(bx + 1, by,     '#e83030');
      p.px(bx,     by + 1, '#b01818');
      p.px(bx,     by,     '#ff5050'); // specular
    }
  },
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
const SEASON_TILES = [TILE.GRASS_TOP, TILE.GRASS_SIDE, TILE.HEATHER, TILE.BRACKEN, TILE.FERN, TILE.BILBERRY, TILE.GORSE, TILE.LEAVES, TILE.MONKEY_LEAVES, TILE.BRAMBLE, TILE.ORCHARD_LEAVES];
function blendPx(d, i, r, g, b, amt) {
  d[i] += (r - d[i]) * amt; d[i + 1] += (g - d[i + 1]) * amt; d[i + 2] += (b - d[i + 2]) * amt;
}
function desatPx(d, i, amt) {
  const y = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
  d[i] += (y - d[i]) * amt; d[i + 1] += (y - d[i + 1]) * amt; d[i + 2] += (y - d[i + 2]) * amt;
}
export function seasonShiftPx(tile, d, i, s) {
  const winter = s.warmth < 0 ? -s.warmth : 0;
  if (tile === TILE.HEATHER) {
    blendPx(d, i, 150, 74, 168, s.heatherBloom * 0.82);  // late-summer bloom: t' whole plant purples
    blendPx(d, i, 92, 74, 56, winter * 0.45);            // winter: browned off
  } else if (tile === TILE.BRACKEN || tile === TILE.FERN) {
    blendPx(d, i, 156, 86, 38, s.autumn * 0.72);         // autumn rust
    blendPx(d, i, 120, 100, 74, winter * 0.4);           // dead-brown in winter
  } else if (tile === TILE.GRASS_TOP || tile === TILE.GRASS_SIDE) {
    blendPx(d, i, 96, 132, 58, s.greenness * 0.22);      // spring/summer flush
    desatPx(d, i, winter * 0.5); blendPx(d, i, 150, 148, 118, winter * 0.28); // winter: pale an' strawy
  } else if (tile === TILE.GORSE) {
    desatPx(d, i, winter * 0.3);
  } else if (tile === TILE.BILBERRY) {
    blendPx(d, i, 150, 80, 50, s.autumn * 0.35); desatPx(d, i, winter * 0.4);
  } else if (tile === TILE.LEAVES) {
    blendPx(d, i, 96, 150, 60, s.greenness * 0.20);      // spring/summer flush
    blendPx(d, i, 178, 116, 38, s.autumn * 0.6);         // autumn gold -> rust
    desatPx(d, i, winter * 0.45); blendPx(d, i, 120, 100, 74, winter * 0.4); // winter: brown, bare-looking
  } else if (tile === TILE.ORCHARD_LEAVES) {
    blendPx(d, i, 96, 150, 60, s.greenness * 0.20);      // spring/summer flush
    blendPx(d, i, 178, 116, 38, s.autumn * 0.6);         // autumn gold -> rust
    desatPx(d, i, winter * 0.45); blendPx(d, i, 120, 100, 74, winter * 0.4); // winter: brown, bare-looking
  } else if (tile === TILE.MONKEY_LEAVES) {
    desatPx(d, i, winter * 0.18);                        // evergreen: only a faint winter frost
  } else if (tile === TILE.BRAMBLE) {
    blendPx(d, i, 96, 132, 58, s.greenness * 0.18);                         // spring/summer green
    desatPx(d, i, winter * 0.5); blendPx(d, i, 110, 92, 64, winter * 0.5);  // winter die-back: brown/bare
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
  [I.CALCINED_IRONSTONE](ctx) {
    ctx.fillStyle = '#7a4838'; ctx.beginPath(); ctx.arc(16, 17, 9, 0, 7); ctx.fill(); // roasted reddish-grey
    ctx.fillStyle = '#9c6850'; ctx.fillRect(11, 12, 4, 4); ctx.fillRect(18, 18, 3, 3);
    ctx.fillStyle = '#4e372e'; ctx.fillRect(14, 16, 3, 2); // a roasting crack
  },
  [I.PIG_IRON](ctx) {
    ctx.fillStyle = '#54565e'; ctx.beginPath(); // a dark rough cast pig
    ctx.moveTo(6, 22); ctx.lineTo(10, 12); ctx.lineTo(24, 12); ctx.lineTo(28, 22); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#70727a'; ctx.fillRect(11, 13, 11, 3);
    ctx.fillStyle = '#3a3c42'; ctx.fillRect(9, 19, 16, 2);
  },
  [I.CARVED_JET](ctx) {
    // a polished mourning brooch: carved jet in a fine setting, with a sheen
    ctx.fillStyle = '#b9982f'; ctx.beginPath(); ctx.ellipse(16, 16, 11, 9, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#0c0c14'; ctx.beginPath(); ctx.ellipse(16, 16, 8, 6, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#3a3a55'; ctx.beginPath(); ctx.ellipse(13, 13, 3, 2, -0.6, 0, 7); ctx.fill();
    ctx.fillStyle = '#7a7ab0'; ctx.fillRect(12, 12, 2, 1);
  },
  [I.RAW_MUTTON](ctx) { drawMeat(ctx, '#d2697a', '#e8909e'); },
  [I.COOKED_MUTTON](ctx) { drawMeat(ctx, '#8a5230', '#b07448'); },
  [I.RAW_GROUSE](ctx) { drawMeat(ctx, '#c2737f', '#daa0a8', 0.7); },
  [I.COOKED_GROUSE](ctx) { drawMeat(ctx, '#96603a', '#ba8456', 0.7); },
  [I.RAW_BEEF](ctx) { drawMeat(ctx, '#aa3f44', '#cc6a64', 1.1); },
  [I.COOKED_BEEF](ctx) { drawMeat(ctx, '#723c24', '#9a5e36', 1.1); },
  [I.RAW_PORK](ctx) { drawMeat(ctx, '#d66d9b', '#f29ec6', 0.95); },
  [I.COOKED_PORK](ctx) { drawMeat(ctx, '#9b5d3d', '#be815e', 0.95); },
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
  [I.WOOL_COAT](ctx) {
    // cream/grey wool coat: torso body + two sleeves
    const body = '#d8d2c4', shadow = '#b8b0a0', dark = '#9a9288';
    // torso
    ctx.fillStyle = body; ctx.fillRect(9, 10, 14, 16);
    // collar notch — slightly darker at top
    ctx.fillStyle = shadow; ctx.fillRect(9, 10, 14, 2);
    // centre-front opening line
    ctx.fillStyle = dark; ctx.fillRect(15, 10, 2, 16);
    // left sleeve
    ctx.fillStyle = body; ctx.fillRect(3, 10, 6, 11);
    ctx.fillStyle = shadow; ctx.fillRect(3, 10, 6, 2); ctx.fillRect(3, 19, 6, 2);
    // right sleeve
    ctx.fillStyle = body; ctx.fillRect(23, 10, 6, 11);
    ctx.fillStyle = shadow; ctx.fillRect(23, 10, 6, 2); ctx.fillRect(23, 19, 6, 2);
    // two buttons
    ctx.fillStyle = dark; ctx.fillRect(13, 14, 2, 2); ctx.fillRect(13, 19, 2, 2);
  },
  [I.CEP](ctx) {
    // draw tile frae atlas scaled up — matches the world tile
    const tile = TILE.CEP;
    const tx = (tile % ATLAS_TILES) * T, ty = Math.floor(tile / ATLAS_TILES) * T;
    ctx.drawImage(atlasCanvas, tx, ty, T, T, 2, 2, 28, 28);
  },
  [I.CHANTERELLE](ctx) {
    const tile = TILE.CHANTERELLE;
    const tx = (tile % ATLAS_TILES) * T, ty = Math.floor(tile / ATLAS_TILES) * T;
    ctx.drawImage(atlasCanvas, tx, ty, T, T, 2, 2, 28, 28);
  },
  [I.COOKED_MUSHROOMS](ctx) {
    // mushrooms sizzling in a cast-iron frying pan
    // pan body
    ctx.fillStyle = '#2a2a2e'; ctx.beginPath(); ctx.ellipse(17, 22, 12, 7, 0, 0, Math.PI * 2); ctx.fill();
    // pan rim highlight
    ctx.strokeStyle = '#3e3e44'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(17, 22, 12, 7, 0, 0, Math.PI * 2); ctx.stroke();
    // handle
    ctx.fillStyle = '#3a3028'; ctx.fillRect(26, 20, 5, 3);
    ctx.fillStyle = '#2a221e'; ctx.fillRect(27, 21, 3, 1);
    // golden-brown mushroom caps sizzling in butter
    ctx.fillStyle = '#c87830';
    ctx.beginPath(); ctx.ellipse(13, 20, 5, 3, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(21, 19, 4, 2.5, 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(17, 23, 4, 2.5, 0, 0, Math.PI * 2); ctx.fill();
    // highlights on caps
    ctx.fillStyle = '#e8a050';
    ctx.fillRect(10, 18, 2, 1); ctx.fillRect(19, 17, 2, 1); ctx.fillRect(15, 21, 2, 1);
    // butter sheen
    ctx.fillStyle = 'rgba(240,200,80,0.25)';
    ctx.beginPath(); ctx.ellipse(17, 22, 10, 5.5, 0, 0, Math.PI * 2); ctx.fill();
    // steam wisps
    ctx.strokeStyle = 'rgba(220,220,220,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(12, 14); ctx.quadraticCurveTo(10, 10, 12, 7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(17, 12); ctx.quadraticCurveTo(19, 8, 17, 5); ctx.stroke();
  },
  [I.WILD_GARLIC](ctx) {
    const tile = TILE.WILD_GARLIC;
    const tx = (tile % ATLAS_TILES) * T, ty = Math.floor(tile / ATLAS_TILES) * T;
    ctx.drawImage(atlasCanvas, tx, ty, T, T, 2, 2, 28, 28);
  },
  [I.SORREL](ctx) {
    const tile = TILE.SORREL;
    const tx = (tile % ATLAS_TILES) * T, ty = Math.floor(tile / ATLAS_TILES) * T;
    ctx.drawImage(atlasCanvas, tx, ty, T, T, 2, 2, 28, 28);
  },
  [I.BLACKBERRY](ctx) {
    const tile = TILE.BLACKBERRY;
    const tx = (tile % ATLAS_TILES) * T, ty = Math.floor(tile / ATLAS_TILES) * T;
    ctx.drawImage(atlasCanvas, tx, ty, T, T, 2, 2, 28, 28);
  },
  [I.ROSEHIP](ctx) {
    const tile = TILE.ROSEHIP;
    const tx = (tile % ATLAS_TILES) * T, ty = Math.floor(tile / ATLAS_TILES) * T;
    ctx.drawImage(atlasCanvas, tx, ty, T, T, 2, 2, 28, 28);
  },
  [I.SLOE](ctx) {
    const tile = TILE.SLOE;
    const tx = (tile % ATLAS_TILES) * T, ty = Math.floor(tile / ATLAS_TILES) * T;
    ctx.drawImage(atlasCanvas, tx, ty, T, T, 2, 2, 28, 28);
  },
  [I.ELDERBERRY](ctx) {
    const tile = TILE.ELDERBERRY;
    const tx = (tile % ATLAS_TILES) * T, ty = Math.floor(tile / ATLAS_TILES) * T;
    ctx.drawImage(atlasCanvas, tx, ty, T, T, 2, 2, 28, 28);
  },
  [I.HAZELNUT](ctx) {
    const tile = TILE.HAZELNUT;
    const tx = (tile % ATLAS_TILES) * T, ty = Math.floor(tile / ATLAS_TILES) * T;
    ctx.drawImage(atlasCanvas, tx, ty, T, T, 2, 2, 28, 28);
  },
  [I.APPLE](ctx) {
    const tile = TILE.APPLE;
    const tx = (tile % ATLAS_TILES) * T, ty = Math.floor(tile / ATLAS_TILES) * T;
    ctx.drawImage(atlasCanvas, tx, ty, T, T, 2, 2, 28, 28);
  },
  [I.PEAR](ctx) {
    const tile = TILE.PEAR;
    const tx = (tile % ATLAS_TILES) * T, ty = Math.floor(tile / ATLAS_TILES) * T;
    ctx.drawImage(atlasCanvas, tx, ty, T, T, 2, 2, 28, 28);
  },
  [I.PLUM](ctx) {
    const tile = TILE.PLUM;
    const tx = (tile % ATLAS_TILES) * T, ty = Math.floor(tile / ATLAS_TILES) * T;
    ctx.drawImage(atlasCanvas, tx, ty, T, T, 2, 2, 28, 28);
  },
  [I.SNOWBALL](ctx) {
    const tile = TILE.SNOWBALL;
    const tx = (tile % ATLAS_TILES) * T, ty = Math.floor(tile / ATLAS_TILES) * T;
    ctx.drawImage(atlasCanvas, tx, ty, T, T, 2, 2, 28, 28);
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
