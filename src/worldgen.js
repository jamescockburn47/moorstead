// Terrain generation for t' North York Moors.
import { B, BLOCKS, CHUNK, HEIGHT, WATER_LEVEL } from './defs.js';
import { fbm2, fbm3, hash2i, hash3i, mulberry32 } from './noise.js';
import { Geography, ROSEBERRY, WAINSTONES, KILNS } from './geography.js';

const IDX = (x, y, z) => x + z * CHUNK + y * CHUNK * CHUNK;

export class Gen {
  constructor(seed) {
    this.seed = seed | 0;
    this.geo = new Geography(seed);
  }

  height(x, z) { return this.geo.height(x, z); }
  bogginess(x, z) { return this.geo.bogginess(x, z); }

  // blanket bog pool on t' tops
  isBogPool(x, z) {
    const h = this.geo.height(x, z);
    return h >= 33 && this.geo.bogginess(x, z) > 0.62 && !this.geo.inVillage(x, z, 4);
  }

  // distinct woods an' copses, wi' open moor between — not a scattered forest
  woodiness(x, z) {
    return fbm2(x * 0.01 + 77.7, z * 0.01 + 31.3, 3, this.seed ^ 0x300d);
  }

  treeAt(x, z) {
    const h = this.geo.height(x, z);
    if (h <= WATER_LEVEL || h > 42) return 0;
    if (this.geo.coastT(x, z) > 0) return 0;
    if (this.geo.bogginess(x, z) > 0.42 && h > 33) return 0;
    if (this.geo.inVillage(x, z, 4)) {
      // one fine owd oak on t' green
      const v = this.geo.village;
      return (x === v.x + 4 && z === v.z + 4) ? 4 : 0;
    }
    const wood = this.woodiness(x, z);
    const dale = this.geo.daleness(x, z);
    let p = 0.0002; // bare moor: nigh on nowt
    if (wood > 0.4 && h < 36) p = 0.06;             // proper woodland
    else if (wood > 0.25 && dale > 0.35 && h < 34) p = 0.008; // wood edges in t' dales
    if (hash2i(x, z, this.seed ^ 0x7ee) > p) return 0;
    return 3 + ((hash2i(x, z, this.seed ^ 0x7ef) * 2) | 0);
  }

  // lone gritstone boulders break up t' empty stretches
  boulderAt(x, z) {
    const h = this.geo.height(x, z);
    if (h < 30 || this.geo.coastT(x, z) > 0 || this.geo.inVillage(x, z, 8)) return 0;
    if (this.geo.bogginess(x, z) > 0.45) return 0;
    const r = hash2i(x, z, this.seed ^ 0xb01d);
    if (r > 0.0006) return 0;
    return 1 + ((r * 10000) | 0) % 2;
  }

  // drystone field walls: t' dale pastures are squared off; t' open moor in't
  wallAt(x, z) {
    const h = this.geo.height(x, z);
    if (h <= WATER_LEVEL || h > 34) return false;
    if (this.geo.bogginess(x, z) > 0.4 || this.geo.coastT(x, z) > 0) return false;
    if (this.geo.inVillage(x, z, 8)) return false;
    if (Math.abs(x - 60) < 4 && z > -420 && z < 60) return false; // keep off Wade's Causey
    const gx = ((x % 48) + 48) % 48, gz = ((z % 40) + 40) % 40;
    if (gx !== 0 && gz !== 0) return false;
    if (hash2i(x, z, this.seed ^ 0xa11) < 0.12) return false;
    const onX = gx === 0;
    const h2 = this.geo.height(x + (onX ? 0 : 1), z + (onX ? 1 : 0));
    if (Math.abs(h - h2) > 2) return false;
    return true;
  }

  caveAt(x, y, z, h) {
    if (y < 4 || y >= h - 3) return false;
    if (h < WATER_LEVEL + 1) return false;
    const n = fbm3(x * 0.055, y * 0.085, z * 0.055, 3, this.seed ^ 0xcafe);
    return n > 0.58;
  }

  oreAt(x, y, z) {
    const r = hash3i(x, y, z, this.seed ^ 0x04e);
    // Rosedale's seams are famously rich in ironstone
    const nearKilns = Math.hypot(x - KILNS.x, z - KILNS.z) < 70;
    if (y < 16 && r < 0.005) return B.JET_ORE;
    if (y < 30 && r >= 0.01 && r < (nearKilns ? 0.045 : 0.022)) return B.IRON_ORE;
    if (y < 42 && r >= 0.05 && r < 0.07) return B.COAL_ORE;
    return B.STONE;
  }

  generateChunk(cx, cz) {
    const data = new Uint8Array(CHUNK * CHUNK * HEIGHT);
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const geo = this.geo;

    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const x = x0 + lx, z = z0 + lz;
        const h = geo.height(x, z);
        const bog = geo.bogginess(x, z);
        const coast = geo.coastT(x, z);
        const onCliff = coast > 0.03 && coast < 0.85 && h > WATER_LEVEL;
        const blanketBog = h >= 33 && bog > 0.45;
        const pool = this.isBogPool(x, z);
        const rocky = h >= 45 || onCliff;
        const vcol = geo.villageColumn(x, z);
        const onRoad = geo.onRoad(x, z) && h > WATER_LEVEL && !blanketBog;

        const beach = coast > 0.3 && h >= 22 && h <= 27;
        for (let y = 0; y <= h; y++) {
          let id;
          if (y === 0) id = B.BEDROCK;
          else if (y < h - 3) {
            id = this.caveAt(x, y, z, h) ? B.AIR : this.oreAt(x, y, z);
          } else if (y < h) {
            id = beach ? B.SAND : blanketBog ? B.PEAT : (rocky ? B.STONE : B.DIRT);
          } else { // surface
            if (beach) id = B.SAND;
            else if (h < WATER_LEVEL) id = B.GRAVEL;
            else if (pool) id = B.PEAT;
            else if (blanketBog) id = B.PEAT;
            else if (rocky) id = B.STONE;
            else if (vcol && (vcol.kind === 'path')) id = B.GRAVEL;
            else if (onRoad) id = hash2i(x, z, this.seed ^ 0x60af) < 0.7 ? B.COBBLE : B.GRAVEL;
            else id = B.GRASS;
          }
          data[IDX(lx, y, lz)] = id;
        }

        // t' sea, tarns and becks
        if (h < WATER_LEVEL) {
          for (let y = h + 1; y <= WATER_LEVEL; y++) data[IDX(lx, y, lz)] = B.WATER;
        }
        // blanket bog pools: two deep, dark and hungry
        if (pool) {
          data[IDX(lx, h, lz)] = B.BOG;
          if (h - 1 > 0) data[IDX(lx, h - 1, lz)] = B.BOG;
          if (h - 2 > 0) data[IDX(lx, h - 2, lz)] = B.PEAT;
        }

        // surface vegetation
        if (!vcol && !pool && !onRoad && h >= WATER_LEVEL && h <= HEIGHT - 3) {
          const surf = data[IDX(lx, h, lz)];
          const r = hash2i(x, z, this.seed ^ 0xf10);
          const heath = geo.heatheriness(x, z);
          if (surf === B.GRASS) {
            // patches o' colour on an open moor: heather drifts (purple),
            // gorse banks (yellow), woods — wi' bare ground between
            const gorse = this.geo.heatheriness(x + 1731, z - 942); // an independent patch field
            if (h >= 33) {
              if (heath > 0.28) { // a heather drift
                if (r < 0.5) data[IDX(lx, h + 1, lz)] = B.HEATHER;
                else if (r < 0.56) data[IDX(lx, h + 1, lz)] = B.BILBERRY_BUSH;
              } else if (gorse > 0.34) { // a gorse bank
                if (r < 0.4) data[IDX(lx, h + 1, lz)] = B.GORSE;
              } else {
                // open moor: sparse tussock, t' odd lone bush
                if (r < 0.05) data[IDX(lx, h + 1, lz)] = B.TUSSOCK;
                else if (r < 0.058) data[IDX(lx, h + 1, lz)] = B.HEATHER;
                else if (r < 0.064) data[IDX(lx, h + 1, lz)] = B.GORSE;
              }
            } else {
              // dale pasture an' fringe: gorse on t' banks, bracken near t' woods
              if (gorse > 0.4 && r < 0.3) data[IDX(lx, h + 1, lz)] = B.GORSE;
              else if (this.woodiness(x, z) > 0.3 && r < 0.14) data[IDX(lx, h + 1, lz)] = B.BRACKEN;
              else if (r < 0.05) data[IDX(lx, h + 1, lz)] = B.TUSSOCK;
              else if (r < 0.058) data[IDX(lx, h + 1, lz)] = B.BILBERRY_BUSH;
            }
            // a lone boulder, mebbe
            const bh = this.boulderAt(x, z);
            for (let y = 1; y <= bh && h + y < HEIGHT; y++) data[IDX(lx, h + y, lz)] = B.STONE;
          } else if (surf === B.PEAT) {
            if (r < 0.14) data[IDX(lx, h + 1, lz)] = B.TUSSOCK;
            else if (r < 0.2) data[IDX(lx, h + 1, lz)] = B.HEATHER;
          } else if (surf === B.STONE && r < 0.04) {
            data[IDX(lx, h + 1, lz)] = B.TUSSOCK;
          }
        }
        // t' village green gets a few wildflowers o' heather
        if (vcol && vcol.kind === 'green') {
          const r = hash2i(x, z, this.seed ^ 0xf11);
          if (r < 0.05) data[IDX(lx, h + 1, lz)] = B.HEATHER;
        }

        // t' Moors Railway: a proper permanent way — three-wide ballast bed,
        // sleepers across it, stone edging, an' causeways ower t' watter
        {
          const ri = geo.railInfo(x, z);
          if (ri) {
            const deck = Math.max(h, WATER_LEVEL + 1);
            // embankment fill up frae t' ground (or t' lake bed)
            for (let y = h; y < deck && y > 0; y++) {
              if (y < HEIGHT) data[IDX(lx, y, lz)] = B.STONE;
            }
            // clear headroom (an' owt growing on t' line)
            for (let y = deck + 1; y <= Math.min(HEIGHT - 1, deck + 3); y++) data[IDX(lx, y, lz)] = B.AIR;
            // deck: sleeper courses across t' bed every few yards
            const sleeper = ((ri.along % 4) + 4) % 4 < 1.2;
            let id;
            if (sleeper) id = B.PLANKS;
            else if (ri.d > 1.0) id = B.COBBLE; // dressed edging
            else id = B.GRAVEL;                  // ballast
            if (deck < HEIGHT) data[IDX(lx, deck, lz)] = id;
          }
        }

        if (!vcol && this.wallAt(x, z)) {
          data[IDX(lx, h + 1, lz)] = B.COBBLE;
          if (hash2i(x, z, this.seed ^ 0xa12) < 0.85) data[IDX(lx, h + 2, lz)] = B.COBBLE;
        }
      }
    }

    // trees (canopies may cross borders)
    for (let lz = -2; lz < CHUNK + 2; lz++) {
      for (let lx = -2; lx < CHUNK + 2; lx++) {
        const x = x0 + lx, z = z0 + lz;
        const th = this.treeAt(x, z);
        if (!th) continue;
        this.stampTree(data, lx, this.geo.height(x, z) + 1, lz, th);
      }
    }

    this.stampVillage(data, cx, cz);
    this.stampLandmarks(data, cx, cz);
    this.stampShelters(data, cx, cz);
    this.stampStructures(data, cx, cz);
    this.stampStations(data, cx, cz);
    return data;
  }

  // station platforms: planks, a lantern, an' t' departures board
  stampStations(data, cx, cz) {
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const put = (wx, wy, wz, id) => {
      const lx = wx - x0, lz = wz - z0;
      if (lx >= 0 && lx < CHUNK && lz >= 0 && lz < CHUNK && wy > 0 && wy < HEIGHT) data[IDX(lx, wy, lz)] = id;
    };
    for (const s of this.geo.railway()) {
      if (s.x < x0 - 6 || s.x > x0 + CHUNK + 6 || s.z < z0 - 6 || s.z > z0 + CHUNK + 6) continue;
      // platform never below t' causeway deck — a halt ower watter stands proud
      const g = Math.max(this.geo.height(s.x, s.z), WATER_LEVEL + 1);
      for (let dx = -2; dx <= 2; dx++) for (let dz = 1; dz <= 3; dz++) {
        put(s.x + dx, g, s.z + dz, B.PLANKS);
        for (let y = g + 1; y <= g + 3; y++) put(s.x + dx, y, s.z + dz, B.AIR);
      }
      put(s.x - 2, g + 1, s.z + 2, B.LANTERN);
      put(s.x + 2, g + 1, s.z + 2, B.BOARD);
      put(s.x, g + 1, s.z + 3, B.SIGNPOST);
    }
  }

  // moor shelters an' waymark signposts
  stampShelters(data, cx, cz) {
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const geo = this.geo;
    const put = (wx, wy, wz, id) => {
      const lx = wx - x0, lz = wz - z0;
      if (lx >= 0 && lx < CHUNK && lz >= 0 && lz < CHUNK && wy > 0 && wy < HEIGHT) data[IDX(lx, wy, lz)] = id;
    };

    for (let gx = Math.floor((x0 - 8) / 144); gx <= Math.floor((x0 + CHUNK + 8) / 144); gx++) {
      for (let gz = Math.floor((z0 - 8) / 144); gz <= Math.floor((z0 + CHUNK + 8) / 144); gz++) {
        const s = geo.shelterAt(gx, gz);
        if (!s) continue;
        if (s.x < x0 - 7 || s.x > x0 + CHUNK + 7 || s.z < z0 - 7 || s.z > z0 + CHUNK + 7) continue;
        const g = geo.height(s.x, s.z);
        // 5x5 stone hut: doorway south, lantern an' bench inside, flat slab roof
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
          const x = s.x + dx, z = s.z + dz;
          // clear an' floor
          for (let y = g + 1; y <= g + 5; y++) put(x, y, z, B.AIR);
          put(x, g, z, B.GRAVEL);
          const perim = Math.abs(dx) === 2 || Math.abs(dz) === 2;
          if (perim && !(dx === 0 && dz === 2)) {
            for (let y = 1; y <= 3; y++) put(x, g + y, z, B.STONEBRICK);
          }
          put(x, g + 4, z, B.STONEBRICK); // roof
        }
        put(s.x, g + 1, s.z, B.LANTERN);
        put(s.x - 1, g + 1, s.z - 1, B.BENCH);
        // signpost by t' door
        put(s.x + 1, g + 1, s.z + 3, B.SIGNPOST);
      }
    }

    // lone waymarks on t' open moor
    for (let gx = Math.floor((x0 - 2) / 96); gx <= Math.floor((x0 + CHUNK + 2) / 96); gx++) {
      for (let gz = Math.floor((z0 - 2) / 96); gz <= Math.floor((z0 + CHUNK + 2) / 96); gz++) {
        const sp = geo.signAt(gx, gz);
        if (!sp) continue;
        if (sp.x < x0 || sp.x >= x0 + CHUNK || sp.z < z0 || sp.z >= z0 + CHUNK) continue;
        const h = geo.height(sp.x, sp.z);
        const i = IDX(sp.x - x0, h + 1, sp.z - z0);
        if (data[i] === B.AIR || BLOCKS[data[i]] && BLOCKS[data[i]].kind === 'cutout') {
          data[i] = B.SIGNPOST;
        }
      }
    }
  }

  // ---------------- villages ----------------
  stampVillage(data, cx, cz) {
    const geo = this.geo;
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    for (const vv of geo.villages) {
      if (Math.abs(vv.x - (x0 + 8)) > vv.radius + 12 || Math.abs(vv.z - (z0 + 8)) > vv.radius + 12) continue;
      for (let lz = 0; lz < CHUNK; lz++) {
        for (let lx = 0; lx < CHUNK; lx++) {
          const x = x0 + lx, z = z0 + lz;
          const vcol = geo.villageColumn(x, z);
          if (!vcol || vcol.kind !== 'building' || vcol.v !== vv) continue;
          this.stampBuildingColumn(data, lx, lz, x, z, vcol.b, vv.ground);
        }
      }
    }
    const v = geo.village;
    if (Math.abs(v.x - (x0 + 8)) > 56 || Math.abs(v.z - (z0 + 8)) > 56) return;
    const g = v.ground;

    // t' village cross an' notice board (stamped from any chunk they touch)
    const cxw = v.x, czw = v.z;
    if (cxw >= x0 - 16 && cxw < x0 + CHUNK + 16 && czw >= z0 - 16 && czw < z0 + CHUNK + 16) {
      const put = (wx, wy, wz, id) => {
        const lx = wx - x0, lz = wz - z0;
        if (lx >= 0 && lx < CHUNK && lz >= 0 && lz < CHUNK && wy > 0 && wy < HEIGHT) data[IDX(lx, wy, lz)] = id;
      };
      put(cxw, g + 1, czw, B.STONE);
      put(cxw, g + 2, czw, B.STONE);
      put(cxw, g + 3, czw, B.STONE);
      put(cxw + 1, g + 3, czw, B.STONE);
      put(cxw - 1, g + 3, czw, B.STONE);
      put(cxw, g + 4, czw, B.STONE);
      // t' parish notice board by t' lane
      put(cxw - 3, g + 1, czw - 12, B.LOG);
      put(cxw - 3, g + 2, czw - 12, B.BOARD);
      put(cxw - 4, g + 2, czw - 12, B.BOARD);
    }

    // t' owd croft: corner posts an' a gravel edging, waiting for t' newcomer
    const p = v.buildings && geo.village.plot;
    if (p) {
      for (let x = p.x0; x <= p.x1; x++) for (let z = p.z0; z <= p.z1; z++) {
        const lx = x - x0, lz = z - z0;
        if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK) continue;
        const edge = x === p.x0 || x === p.x1 || z === p.z0 || z === p.z1;
        const corner = (x === p.x0 || x === p.x1) && (z === p.z0 || z === p.z1);
        if (edge) data[IDX(lx, g, lz)] = B.GRAVEL;
        if (corner) {
          data[IDX(lx, g + 1, lz)] = B.LOG;
          data[IDX(lx, g + 2, lz)] = B.LOG;
        }
      }
    }
  }

  stampBuildingColumn(data, lx, lz, x, z, b, g) {
    if (b.type === 'minster') return this.stampMinsterColumn(data, lx, lz, x, z, b, g);
    if (b.type === 'ruin') return this.stampRuinColumn(data, lx, lz, x, z, b, g);
    const wallMat = b.type === 'barn' ? B.PLANKS : B.STONEBRICK;
    const onPerim = x === b.x0 || x === b.x1 || z === b.z0 || z === b.z1;
    const corner = (x === b.x0 || x === b.x1) && (z === b.z0 || z === b.z1);
    const midX = Math.floor((b.x0 + b.x1) / 2);

    // clear t' inside up to t' rafters
    for (let y = g + 1; y <= Math.min(HEIGHT - 1, g + 13); y++) data[IDX(lx, y, lz)] = B.AIR;
    // footings and floor
    data[IDX(lx, g, lz)] = onPerim ? wallMat : B.PLANKS;
    for (let y = g - 1; y > g - 4 && y > 0; y--) {
      if (data[IDX(lx, y, lz)] === B.AIR) data[IDX(lx, y, lz)] = B.DIRT;
    }

    if (onPerim) {
      for (let y = 1; y <= b.wallH; y++) data[IDX(lx, g + y, lz)] = wallMat;
      // doorway: south wall, middle (barns get a wide north door)
      const doorWall = b.type === 'barn' ? (z === b.z1) : (z === b.z0);
      const doorHere = doorWall && (b.type === 'barn' ? Math.abs(x - midX) <= 1 : (x === midX));
      if (doorHere) {
        data[IDX(lx, g + 1, lz)] = B.AIR;
        data[IDX(lx, g + 2, lz)] = B.AIR;
      } else if (!corner && b.type !== 'barn' && (x + z) % 3 === 0) {
        data[IDX(lx, g + 2, lz)] = B.WINDOW;
        if (b.type === 'chapel') data[IDX(lx, g + 3, lz)] = B.WINDOW; // tall arched lights
      }
    }

    // gabled thatch roof, ridge along x
    const rise = Math.min(z - b.z0, b.z1 - z);
    const roofY = g + b.wallH + 1 + rise;
    if (roofY < HEIGHT) {
      if ((x === b.x0 || x === b.x1) && rise > 0) {
        // stone gable ends up to t' thatch line
        for (let y = g + b.wallH + 1; y < roofY && y < HEIGHT; y++) data[IDX(lx, y, lz)] = wallMat;
      }
      data[IDX(lx, roofY, lz)] = B.THATCH;
    }

    // chapel tower at t' north end: square, taller than owt else
    if (b.type === 'chapel') {
      const tx0 = b.x0 + 2, tx1 = b.x1 - 2, tz0 = b.z1 - 2, tz1 = b.z1;
      if (x >= tx0 && x <= tx1 && z >= tz0 && z <= tz1) {
        const tPerim = x === tx0 || x === tx1 || z === tz0 || z === tz1;
        for (let y = g + 1; y <= g + 8 && y < HEIGHT; y++) {
          data[IDX(lx, y, lz)] = tPerim ? B.STONEBRICK : B.AIR;
        }
        if (g + 9 < HEIGHT) data[IDX(lx, g + 9, lz)] = B.STONEBRICK; // cap
      }
    }

    // furnishings
    const inside = !onPerim;
    if (inside) {
      const fx = x - b.x0, fz = z - b.z0;
      if (b.type === 'pub') {
        if (fx === 1 && fz === 1) data[IDX(lx, g + 1, lz)] = B.LANTERN;
        if (fx === 2 && fz === 4) data[IDX(lx, g + 1, lz)] = B.BENCH;
        if (fx === 7 && fz === 1) data[IDX(lx, g + 1, lz)] = B.RANGE;
        if (fx === 5 && fz === 4) data[IDX(lx, g + 1, lz)] = B.LANTERN;
      } else if (b.type === 'farm') {
        if (fx === 1 && fz === 1) data[IDX(lx, g + 1, lz)] = B.LANTERN;
        if (fx === 9 && fz === 5) data[IDX(lx, g + 1, lz)] = B.RANGE;
        if (fx === 5 && fz === 5) data[IDX(lx, g + 1, lz)] = B.BENCH;
      } else if (b.type === 'chapel') {
        if (fx === 1 && fz === 1) data[IDX(lx, g + 1, lz)] = B.LANTERN;
        if (fx === 5 && fz === 1) data[IDX(lx, g + 1, lz)] = B.LANTERN;
      } else if (b.type === 'cottage') {
        if (fx === 1 && fz === 1) data[IDX(lx, g + 1, lz)] = B.LANTERN;
      } else if (b.type === 'shop') {
        // counter, light, an' a bench or range so t' shops are useful
        if (fx === 1 && fz === 1) data[IDX(lx, g + 1, lz)] = B.LANTERN;
        if (fx === 2 && fz === 3) data[IDX(lx, g + 1, lz)] = ((b.x0 + b.z0) % 2 === 0) ? B.BENCH : B.RANGE;
        if (fx === 4 && fz === 1) data[IDX(lx, g + 1, lz)] = B.BOARD;
      } else if (b.type === 'museum') {
        if (fx === 1 && fz === 1) data[IDX(lx, g + 1, lz)] = B.LANTERN;
        if (fx === 3 && fz === 1) data[IDX(lx, g + 1, lz)] = B.LANTERN;
        if (fx === 5 && fz === 2) data[IDX(lx, g + 1, lz)] = B.BOARD;
        if (fx === 2 && fz === 4) data[IDX(lx, g + 1, lz)] = B.BOARD;
        if (fx === 6 && fz === 4) data[IDX(lx, g + 1, lz)] = B.BOARD;
      } else if (b.type === 'fishchip') {
        if (fx === 1 && fz === 1) data[IDX(lx, g + 1, lz)] = B.LANTERN;
        if (fx === 3 && fz === 2) data[IDX(lx, g + 1, lz)] = B.RANGE;
        if (fx === 5 && fz === 1) data[IDX(lx, g + 1, lz)] = B.BENCH;
      } else if (b.type === 'fossilshop') {
        if (fx === 1 && fz === 1) data[IDX(lx, g + 1, lz)] = B.LANTERN;
        if (fx === 4 && fz === 2) data[IDX(lx, g + 1, lz)] = B.BENCH;
        if (fx === 2 && fz === 1) data[IDX(lx, g + 1, lz)] = B.BOARD;
      } else if (b.type === 'barn') {
        if (fx === 1 && fz === 1 && hash2i(x, z, this.seed) < 0.5) data[IDX(lx, g + 1, lz)] = B.WOOL;
        if (fx === 2 && fz === 5) data[IDX(lx, g + 1, lz)] = B.WOOL;
      }
    }
  }

  // a proper minster: tall nave, arched lights, a great square tower
  stampMinsterColumn(data, lx, lz, x, z, b, g) {
    const onPerim = x === b.x0 || x === b.x1 || z === b.z0 || z === b.z1;
    for (let y = g + 1; y <= Math.min(HEIGHT - 1, g + 16); y++) data[IDX(lx, y, lz)] = B.AIR;
    data[IDX(lx, g, lz)] = onPerim ? B.STONEBRICK : B.STONE; // flagstone floor
    for (let y = g - 1; y > g - 4 && y > 0; y--) data[IDX(lx, y, lz)] = B.DIRT;
    const midX = Math.floor((b.x0 + b.x1) / 2);
    if (onPerim) {
      for (let y = 1; y <= 6; y++) data[IDX(lx, g + y, lz)] = B.STONEBRICK;
      // great door south; tall arched lights along t' sides
      if (z === b.z1 && Math.abs(x - midX) <= 1) {
        data[IDX(lx, g + 1, lz)] = B.AIR; data[IDX(lx, g + 2, lz)] = B.AIR; data[IDX(lx, g + 3, lz)] = B.AIR;
      } else if ((x === b.x0 || x === b.x1) && (z - b.z0) % 3 === 1) {
        data[IDX(lx, g + 2, lz)] = B.WINDOW; data[IDX(lx, g + 3, lz)] = B.WINDOW; data[IDX(lx, g + 4, lz)] = B.WINDOW;
      }
    }
    // vaulted stone roof
    const rise = Math.min(Math.min(x - b.x0, b.x1 - x), 3);
    const roofY = g + 7 + rise;
    if (roofY < HEIGHT) data[IDX(lx, roofY, lz)] = B.STONEBRICK;
    if ((x === b.x0 || x === b.x1)) {
      for (let y = g + 7; y < roofY; y++) data[IDX(lx, y, lz)] = B.STONEBRICK;
    }
    // t' tower at t' north end, twelve courses an' crenellated
    const tx0 = midX - 2, tx1 = midX + 2, tz0 = b.z0, tz1 = b.z0 + 4;
    if (x >= tx0 && x <= tx1 && z >= tz0 && z <= tz1) {
      const tPerim = x === tx0 || x === tx1 || z === tz0 || z === tz1;
      for (let y = g + 1; y <= g + 12 && y < HEIGHT; y++) {
        data[IDX(lx, y, lz)] = tPerim ? B.STONEBRICK : B.AIR;
      }
      if (g + 12 < HEIGHT) data[IDX(lx, g + 12, lz)] = B.STONEBRICK;
      if (tPerim && g + 13 < HEIGHT && (x + z) % 2 === 0) data[IDX(lx, g + 13, lz)] = B.STONEBRICK;
      if (tPerim && (z === tz0 || z === tz1) && g + 9 < HEIGHT && Math.abs(x - midX) <= 1) {
        data[IDX(lx, g + 9, lz)] = B.WINDOW; // belfry lights
      }
    }
    // lanterns down t' nave
    const fz = z - b.z0;
    if (!onPerim && (x === b.x0 + 2 || x === b.x1 - 2) && fz > 5 && fz % 6 === 0) {
      data[IDX(lx, g + 1, lz)] = B.LANTERN;
    }
  }

  // a broken abbey arch for Rosedale
  stampRuinColumn(data, lx, lz, x, z, b, g) {
    for (let y = g + 1; y <= Math.min(HEIGHT - 1, g + 9); y++) data[IDX(lx, y, lz)] = B.AIR;
    data[IDX(lx, g, lz)] = B.GRAVEL;
    const onPerim = x === b.x0 || x === b.x1 || z === b.z0 || z === b.z1;
    if (!onPerim) return;
    const hgt = 2 + (hash2i(x, z, this.seed ^ 0xa8b) * 4 | 0);
    const midZ = Math.floor((b.z0 + b.z1) / 2);
    const arch = (x === b.x0 || x === b.x1) && Math.abs(z - midZ) <= 1;
    for (let y = 1; y <= (arch ? 5 : hgt); y++) {
      if (arch && y <= 3 && Math.abs(z - midZ) === 0) continue; // t' opening
      data[IDX(lx, g + y, lz)] = B.STONEBRICK;
    }
  }

  // ---------------- landmarks ----------------
  stampLandmarks(data, cx, cz) {
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const geo = this.geo;
    const put = (wx, wy, wz, id) => {
      const lx = wx - x0, lz = wz - z0;
      if (lx >= 0 && lx < CHUNK && lz >= 0 && lz < CHUNK && wy > 0 && wy < HEIGHT) data[IDX(lx, wy, lz)] = id;
    };

    // --- moor crosses (96-grid; whole cross stamped from any chunk it touches) ---
    for (let gx = Math.floor((x0 - 4) / 96); gx <= Math.floor((x0 + CHUNK + 4) / 96); gx++) {
      for (let gz = Math.floor((z0 - 4) / 96); gz <= Math.floor((z0 + CHUNK + 4) / 96); gz++) {
        const cr = geo.crossAt(gx, gz);
        if (!cr) continue;
        if (cr.x < x0 - 2 || cr.x > x0 + CHUNK + 1 || cr.z < z0 - 2 || cr.z > z0 + CHUNK + 1) continue;
        const h = geo.height(cr.x, cr.z);
        const mat = cr.fatBetty ? B.WOOL : B.STONE;
        put(cr.x, h + 1, cr.z, B.STONE);
        put(cr.x, h + 2, cr.z, B.STONE);
        put(cr.x, h + 3, cr.z, mat);
        put(cr.x + 1, h + 3, cr.z, mat);
        put(cr.x - 1, h + 3, cr.z, mat);
        put(cr.x, h + 4, cr.z, mat);
      }
    }

    // --- the Wainstones: a craggy jumble on t' ridge ---
    if (Math.abs(WAINSTONES.x - (x0 + 8)) < 30 && Math.abs(WAINSTONES.z - (z0 + 8)) < 30) {
      for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
        const x = x0 + lx, z = z0 + lz;
        const r = Math.hypot(x - WAINSTONES.x, z - WAINSTONES.z);
        if (r > WAINSTONES.r) continue;
        const hr = hash2i(x, z, this.seed ^ 0x3a17);
        if (hr < 0.3) {
          const h = geo.height(x, z);
          const ph = 1 + ((hr * 14) | 0) % 4 + (r < 4 ? 2 : 0);
          for (let y = 1; y <= ph && h + y < HEIGHT; y++) put(x, h + y, z, B.STONE);
        }
      }
    }

    // --- Rosedale ironstone kilns: a bank o' stone arches ---
    {
      const k = KILNS;
      if (k.x >= x0 - 20 && k.x < x0 + CHUNK + 20 && k.z >= z0 - 8 && k.z < z0 + CHUNK + 8) {
        const g = geo.height(k.x, k.z);
        for (let i = 0; i < 3; i++) {
          const ax = k.x - 7 + i * 5; // each arch 4 wide, 1 gap
          for (let dx = 0; dx <= 3; dx++) for (let dz = 0; dz <= 2; dz++) {
            for (let y = 1; y <= 5; y++) {
              const solidFront = dz === 0 && (dx === 0 || dx === 3 || y >= 4);
              const isBack = dz === 2;
              const isSide = false;
              if (dz === 1 && y <= 3 && dx >= 1 && dx <= 2) {
                put(ax + dx, g + y, k.z + dz, B.AIR); // t' chamber
              } else if (solidFront || isBack || dz === 1) {
                put(ax + dx, g + y, k.z + dz, B.STONEBRICK);
              }
            }
            put(ax + dx, g + 6, k.z + dz, B.STONEBRICK); // capping course
          }
          // glowing ember left in t' middle kiln
          if (i === 1) put(ax + 1, g + 1, k.z + 1, B.LANTERN);
        }
      }
    }

    // --- t' abbey ruin on t' cliff top ---
    {
      const ab = geo.abbeySite();
      if (ab.x >= x0 - 24 && ab.x < x0 + CHUNK + 24 && ab.z >= z0 - 12 && ab.z < z0 + CHUNK + 12) {
        const g = geo.height(ab.x, ab.z);
        const rng = mulberry32(this.seed ^ 0xabbe);
        // nave: two long walls wi' arched gaps, crumbling toward t' west
        for (let dx = 0; dx < 20; dx++) {
          for (const dz of [0, 7]) {
            const x = ab.x + dx, z = ab.z + dz;
            const crumble = hash2i(x, z, this.seed ^ 0xabb1);
            let wh = dx > 14 ? 7 : Math.floor(2 + crumble * 6);
            if (dx > 14) wh = 7; // east end stands proud
            for (let y = 1; y <= wh; y++) {
              // arched openings every 4 blocks
              const arch = (dx % 4 === 1 || dx % 4 === 2) && y <= 3 && dx < 18;
              if (!arch) put(x, g + y, z, B.STONEBRICK);
            }
          }
        }
        // east end wall wi' t' great window hole
        for (let dz = 0; dz <= 7; dz++) {
          for (let y = 1; y <= 8; y++) {
            const window = dz >= 2 && dz <= 5 && y >= 3 && y <= 6;
            if (!window) put(ab.x + 19, g + y, ab.z + dz, B.STONEBRICK);
          }
        }
        // scattered pillar stumps in t' nave
        for (let i = 0; i < 5; i++) {
          const px = ab.x + 2 + ((rng() * 16) | 0), pz = ab.z + 2 + ((rng() * 4) | 0);
          const ph = 1 + ((rng() * 3) | 0);
          for (let y = 1; y <= ph; y++) put(px, g + y, pz, B.STONEBRICK);
        }
        // holy water font — a stone basin wi' a glimmer o' light
        const font = geo.abbeyFont();
        put(font.x, g, font.z, B.STONEBRICK);
        put(font.x, g + 1, font.z, B.STONEBRICK);
        put(font.x, g + 2, font.z, B.LANTERN);
      }
    }

    // --- Whitby pier: planks out into t' harbour ---
    {
      const pier = geo.pierHead();
      const wv = geo.villages.find(v => v.name === 'Whitby');
      if (wv && pier.x >= x0 - 20 && pier.x < x0 + CHUNK + 20 && pier.z >= z0 - 20 && pier.z < z0 + CHUNK + 20) {
        const pg = geo.height(pier.x, pier.z);
        for (let i = 0; i < 14; i++) {
          const px = pier.x - i, pz = pier.z;
          const h = geo.height(px, pz);
          for (let dx = -1; dx <= 1; dx++) {
            put(px + dx, h, pz, B.PLANKS);
            if (i % 3 === 0 && dx === 0) put(px, h + 1, pz, B.LOG);
          }
        }
        put(pier.x, pg + 1, pier.z, B.LANTERN);
      }
    }
  }

  stampTree(data, lx, base, lz, th) {
    const put = (x, y, z, id, keep) => {
      if (x < 0 || x >= CHUNK || z < 0 || z >= CHUNK || y < 1 || y >= HEIGHT) return;
      const i = IDX(x, y, z);
      if (keep && data[i] !== B.AIR) return;
      data[i] = id;
    };
    for (let y = 0; y < th; y++) put(lx, base + y, lz, B.LOG);
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0 && dy === 0) continue;
        if (Math.abs(dx) === 1 && Math.abs(dz) === 1 && hash3i(lx + dx, base + dy, lz + dz, 77) < 0.4) continue;
        put(lx + dx, base + th - 1 + dy, lz + dz, B.LEAVES, true);
      }
    }
    put(lx, base + th + 1, lz, B.LEAVES, true);
  }

  // ---------------- scattered ruins (as before, rarer) ----------------
  stampStructures(data, cx, cz) {
    const r = hash2i(cx, cz, this.seed ^ 0x57c);
    const rng = mulberry32((this.seed ^ (cx * 73856093) ^ (cz * 19349663)) | 0);
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const midH = this.geo.height(x0 + 8, z0 + 8);
    if (midH <= WATER_LEVEL + 1 || this.geo.bogginess(x0 + 8, z0 + 8) > 0.4) return;
    if (this.geo.inVillage(x0 + 8, z0 + 8, 24)) return;
    if (this.geo.coastT(x0 + 8, z0 + 8) > 0) return;

    if (r < 0.008) this.stampFarmhouse(data, rng, x0, z0);
    else if (r < 0.016 && midH >= 33) this.stampStoneCircle(data, rng, x0, z0);
    else if (r < 0.026) this.stampQuarry(data, rng, x0, z0);
  }

  stampFarmhouse(data, rng, x0, z0) {
    const w = 9, d = 7, fx = 3, fz = 4;
    const floor = this.geo.height(x0 + fx + 4, z0 + fz + 3);
    if (floor + 6 >= HEIGHT) return;
    for (let dx = 0; dx < w; dx++) for (let dz = 0; dz < d; dz++) {
      for (let y = floor + 1; y < floor + 7; y++) data[IDX(fx + dx, y, fz + dz)] = B.AIR;
      data[IDX(fx + dx, floor, fz + dz)] = (dx === 0 || dz === 0 || dx === w - 1 || dz === d - 1) ? B.STONEBRICK : B.PLANKS;
      for (let y = floor - 1; y > floor - 4 && y > 0; y--) {
        if (data[IDX(fx + dx, y, fz + dz)] === B.AIR) data[IDX(fx + dx, y, fz + dz)] = B.DIRT;
      }
    }
    for (let dx = 0; dx < w; dx++) for (let dz = 0; dz < d; dz++) {
      const edge = dx === 0 || dz === 0 || dx === w - 1 || dz === d - 1;
      if (!edge) continue;
      const corner = (dx === 0 || dx === w - 1) && (dz === 0 || dz === d - 1);
      if (dz === 0 && (dx === 4 || dx === 5)) continue;
      let wh = corner ? 3 : 1 + ((rng() * 3) | 0);
      for (let y = 1; y <= wh; y++) data[IDX(fx + dx, floor + y, fz + dz)] = B.STONEBRICK;
      if (wh === 3 && rng() < 0.4) data[IDX(fx + dx, floor + 4, fz + dz)] = B.THATCH;
    }
    data[IDX(fx + 2, floor + 1, fz + 2)] = B.BENCH;
    data[IDX(fx + w - 3, floor + 1, fz + d - 3)] = B.LANTERN;
    if (rng() < 0.6) data[IDX(fx + w - 3, floor + 1, fz + 2)] = B.RANGE;
  }

  stampStoneCircle(data, rng, x0, z0) {
    const cxl = 8, czl = 8, rad = 5;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const px = cxl + Math.round(Math.cos(a) * rad);
      const pz = czl + Math.round(Math.sin(a) * rad);
      if (px < 1 || px > 14 || pz < 1 || pz > 14) continue;
      const h = this.geo.height(x0 + px, z0 + pz);
      const ph = 2 + ((rng() * 2) | 0);
      for (let y = 1; y <= ph; y++) {
        if (h + y < HEIGHT) data[IDX(px, h + y, pz)] = B.STONE;
      }
    }
  }

  stampQuarry(data, rng, x0, z0) {
    const fx = 5, fz = 5, size = 6;
    const top = this.geo.height(x0 + fx + 3, z0 + fz + 3);
    if (top <= WATER_LEVEL + 2) return;
    for (let dx = 0; dx < size; dx++) for (let dz = 0; dz < size; dz++) {
      const ring = Math.min(dx, dz, size - 1 - dx, size - 1 - dz);
      const depth = 1 + ring * 2;
      for (let y = top; y > top - depth && y > 2; y--) {
        data[IDX(fx + dx, y, fz + dz)] = B.AIR;
        data[IDX(fx + dx, y + 1, fz + dz)] = B.AIR;
      }
      const fy = Math.max(3, top - depth);
      if (ring >= 2 && rng() < 0.5) data[IDX(fx + dx, fy, fz + dz)] = B.COAL_ORE;
    }
    for (let y = top + 1; y <= top + 3; y++) {
      data[IDX(fx, y, fz)] = B.LOG;
      data[IDX(fx + size - 1, y, fz + size - 1)] = B.LOG;
    }
    for (let dx = 0; dx < size; dx++) data[IDX(fx + dx, top + 4, fz + dx)] = B.PLANKS;
  }

  // Wake up on t' edge of Moorstead green.
  findSpawn() {
    const v = this.geo.village;
    return { x: v.x + 0.5, y: v.ground + 2.2, z: v.z - 6 + 0.5 };
  }

  // Shared moor: folk wake spread across t' villages.
  findSpawnAt(idx) {
    const vs = this.geo.villages;
    const v = vs[((idx % vs.length) + vs.length) % vs.length];
    return { x: v.x + 0.5, y: v.ground + 2.2, z: v.z - 4 + 0.5, village: v.name };
  }
}
