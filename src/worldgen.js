// Terrain generation for t' North York Moors.
import { B, BLOCKS, CHUNK, HEIGHT, WATER_LEVEL } from './defs.js';
import { fbm2, fbm3, noise3, hash2i, hash3i, mulberry32, strSeed } from './noise.js';
import { Geography, ROSEBERRY, WAINSTONES, KILNS, CASTLE } from './geography.js';
import { MoorsGeography } from './moorsgeo.js';
import { stationOrient } from './railpath.js';
import { innPlan } from './innplan.js';

// The real-Moors world id — the seed string main.js uses for the solo world + the shared room
export const MOORS_SEED = strSeed('t-moors-1900');
export function isMoorsSeed(seed) { return (seed | 0) === (MOORS_SEED | 0); }

const IDX = (x, y, z) => x + z * CHUNK + y * CHUNK * CHUNK;

export class Gen {
  constructor(seed) {
    this.seed = seed | 0;
    this.geo = isMoorsSeed(seed) ? new MoorsGeography(seed) : new Geography(seed);

    // One inn per configured village (innplan.js INN_NAMES), built once at
    // construction time — deterministic, so every client with the same seed
    // produces byte-identical inns (INVARIANTS.md rule 6).
    this.inns = new Map();
    for (const v of this.geo.villages || []) {
      const plan = innPlan(this.geo, v.name, this.seed);
      if (plan) this.inns.set(v.name, plan);
    }
  }

  height(x, z) { return this.geo.height(x, z); }
  bogginess(x, z) { return this.geo.bogginess(x, z); }

  // blanket bog pool on t' tops — kept sparse (t' real moors are drier than tha'd
  // think), so t' threshold's high: only t' boggiest hollows hold open water.
  isBogPool(x, z) {
    const h = this.geo.height(x, z);
    return h >= 33 && this.geo.bogginess(x, z) > 0.74 && !this.geo.inVillage(x, z, 4);
  }

  // distinct woods an' copses, wi' open moor between — not a scattered forest
  woodiness(x, z) {
    return fbm2(x * 0.01 + 77.7, z * 0.01 + 31.3, 3, this.seed ^ 0x300d);
  }

  // A guaranteed copse just outside every village, plus an oak on t' green, so a
  // newcomer is never stuck for wood — t' first rung o' t' whole ladder. Built
  // once, deterministic frae t' seed, keyed by "x,z" -> trunk height.
  homeTrees() {
    if (this._homeTrees) return this._homeTrees;
    const m = new Map();
    const geo = this.geo;
    const plantable = (x, z, hiH = 40) => {
      const h = geo.height(x, z);
      return h > WATER_LEVEL && h < hiH && geo.bogginess(x, z) < 0.42 && geo.coastT(x, z) <= 0;
    };
    for (const v of geo.villages) {
      const rng = mulberry32((this.seed ^ Math.imul(v.x | 0, 73856093) ^ Math.imul(v.z | 0, 19349663)) | 0);
      // one tall oak on an open green/closes column near t' middle — wood at hand frae t' off
      for (let k = 0; k < 16; k++) {
        const a = rng() * Math.PI * 2, d = 6 + rng() * 10;
        const tx = Math.round(v.x + Math.cos(a) * d), tz = Math.round(v.z + Math.sin(a) * d);
        const col = geo.villageColumn(tx, tz);
        if (col && (col.kind === 'green' || col.kind === 'closes') && plantable(tx, tz)) { m.set(tx + ',' + tz, 5); break; }
      }
      // a copse o' six-or-so oaks just past t' village edge: scan rays outward an'
      // tek t' NEAREST plantable spot, so even a coastal town like Whitby gets a
      // wood inland rather than out to sea
      let cx = 0, cz = 0, found = false, bestD = Infinity;
      for (let ray = 0; ray < 48; ray++) {
        const a = ray / 48 * Math.PI * 2;
        for (let d = v.radius + 4; d <= v.radius + 30; d += 3) {
          const tx = Math.round(v.x + Math.cos(a) * d), tz = Math.round(v.z + Math.sin(a) * d);
          if (plantable(tx, tz, 40) && !geo.inVillage(tx, tz, 0) && !geo.villageColumn(tx, tz)) {
            if (d < bestD) { bestD = d; cx = tx; cz = tz; found = true; }
            break; // nearest along this ray
          }
        }
      }
      if (found) {
        for (let k = 0; k < 8; k++) {
          const a = rng() * Math.PI * 2, d = rng() * 5;
          const tx = Math.round(cx + Math.cos(a) * d), tz = Math.round(cz + Math.sin(a) * d);
          if (plantable(tx, tz, 40) && !geo.inVillage(tx, tz, 0) && !geo.villageColumn(tx, tz)) m.set(tx + ',' + tz, 4 + ((rng() * 2) | 0));
        }
      }
    }
    this._homeTrees = m;
    return m;
  }

  treeAt(x, z) {
    const home = this.homeTrees().get(x + ',' + z);
    if (home) return home;
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

  // fruit trees — apple, pear an' plum orchards in t' ring just outside villages.
  // Returns true if this column should carry a fruit tree.
  fruitTreeAt(x, z) {
    const h = this.geo.height(x, z);
    if (h <= WATER_LEVEL || h > 38) return false;
    if (this.geo.coastT(x, z) > 0) return false;
    if (this.geo.inVillage(x, z, 2)) return false;        // not in t' village itself
    if (!this.geo.inVillage(x, z, 16)) return false;       // only t' ring just outside it
    const clump = fbm2(x * 0.06, z * 0.06, 1, (this.seed ^ 0x0ac2) >>> 0);
    if (clump < 0.3) return false;                         // one or two orchard patches, not a full ring
    return hash2i(x, z, this.seed ^ 0x0ac1) < 0.10;        // fruit trees within t' patch
  }

  // gritstone breaks up t' empty stretches — most a lone stone, some a middlin'
  // cluster, t' odd proud tor up on t' tops. Returns 0 | 1 (stone) | 2 (cluster) | 3 (tor).
  boulderAt(x, z) {
    const h = this.geo.height(x, z);
    if (h < 30 || this.geo.coastT(x, z) > 0 || this.geo.inVillage(x, z, 8)) return 0;
    if (this.geo.bogginess(x, z) > 0.45 || this.geo.villageColumn(x, z)) return 0;
    const r = hash2i(x, z, this.seed ^ 0xb01d);
    if (r < 0.00035 && h >= 36) return 3; // a gritstone tor, Wainstones in miniature
    if (r < 0.0016) return 2;             // a middlin' cluster
    if (r < 0.004) return 1;              // a lone weathered stone
    return 0;
  }

  // monkey puzzles — a Victorian fancy, planted about t' edges o' settlements
  // (gardens, station yards), wi' t' rare lone specimen gone wild on t' moor.
  // Returns 0 or t' trunk height.
  monkeyPuzzleAt(x, z) {
    const h = this.geo.height(x, z);
    if (h <= WATER_LEVEL || h > 40) return 0;
    if (this.geo.coastT(x, z) > 0 || this.geo.bogginess(x, z) > 0.4) return 0;
    if (this.geo.villageColumn(x, z)) return 0; // never on a building, path or green
    const fringe = this.geo.inVillage(x, z, 14) && !this.geo.inVillage(x, z, 0);
    const r = hash2i(x, z, this.seed ^ 0x70e5);
    if (fringe) { if (r > 0.012) return 0; }
    else { if (r > 0.00012) return 0; } // ultra-rare wild specimen
    return 9 + ((hash2i(x, z, this.seed ^ 0x70e6) * 5) | 0); // tall: 9-13
  }

  // drystone field walls: t' dale pastures are squared off; t' open moor in't
  wallAt(x, z) {
    const h = this.geo.height(x, z);
    if (h <= WATER_LEVEL || h > 34) return false;
    if (this.geo.bogginess(x, z) > 0.4 || this.geo.coastT(x, z) > 0) return false;
    if (this.geo.inVillage(x, z, 8)) return false;
    if (this.geo.nearRiver && this.geo.nearRiver(x, z, 1)) return false; // walls stop at the beck, not over it
    if (Math.abs(x - 60) < 4 && z > -420 && z < 60) return false; // keep off Wade's Causey
    // real Moors: wobble the grid lines + thin the runs so the walls aren't a dead-straight
    // square grid (the stylised world keeps its tidy grid — wob/gap stay at the old values)
    const real = !!this.geo.realWorld;
    const wobX = real ? Math.round(fbm2(z * 0.07 + 2.1, 1.3, 2, this.seed ^ 0xa13) * 3) : 0;
    const wobZ = real ? Math.round(fbm2(x * 0.07 + 5.4, 7.7, 2, this.seed ^ 0xa14) * 3) : 0;
    const gx = (((x - wobX) % 48) + 48) % 48, gz = (((z - wobZ) % 40) + 40) % 40;
    if (gx !== 0 && gz !== 0) return false;
    if (hash2i(x, z, this.seed ^ 0xa11) < (real ? 0.2 : 0.12)) return false;
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

  // Seed cave drifts (old workings): free deep mining on faces bordering natural
  // cave air. Solid rock below grade still needs a quarry or licensed mine.
  inNaturalCaveVolume(x, y, z) {
    const h = this.height(x, z);
    if (y >= h - 1 || y < 4) return false;
    if (this.caveAt(x, y, z, h)) return true;
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const nh = this.height(x + dx, z + dz);
      if (this.caveAt(x + dx, y + dy, z + dz, nh)) return true;
    }
    return false;
  }

  // Scattered worldgen quarries (stampQuarry): log-framed pits on t' open moor.
  wildQuarryChunk(cx, cz) {
    const geo = this.geo;
    if (geo.realWorld) return null;   // no stylised scattered moor-pits in the real-OS world
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const midH = geo.height(x0 + 8, z0 + 8);
    if (midH <= WATER_LEVEL + 1 || geo.bogginess(x0 + 8, z0 + 8) > 0.4) return null;
    if (geo.inVillage(x0 + 8, z0 + 8, 24)) return null;
    if (geo.coastT(x0 + 8, z0 + 8) > 0) return null;
    const r = hash2i(cx, cz, this.seed ^ 0x57c);
    if (r < 0.008) return null;
    if (r < 0.016 && midH >= 33) return null;
    if (r >= 0.026) return null;
    const fx = 5, fz = 5, size = 6;
    const top = geo.height(x0 + fx + 3, z0 + fz + 3);
    if (top <= WATER_LEVEL + 2) return null;
    return { top, qx0: x0 + fx, qz0: z0 + fz, size, cx: x0 + fx + 3, cz: z0 + fz + 3 };
  }

  wildQuarryAt(x, z) {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const q = this.wildQuarryChunk(cx, cz);
    if (!q) return null;
    if (x < q.qx0 || x >= q.qx0 + q.size || z < q.qz0 || z >= q.qz0 + q.size) return null;
    return q;
  }

  /** All scattered moor pits in t' playable bounds (cached per seed). */
  listWildQuarries(minX = -750, maxX = 600, minZ = -920, maxZ = 720) {
    if (!this._wildQuarrySites) {
      const sites = [];
      for (let cx = Math.floor(minX / CHUNK); cx <= Math.floor(maxX / CHUNK); cx++) {
        for (let cz = Math.floor(minZ / CHUNK); cz <= Math.floor(maxZ / CHUNK); cz++) {
          const q = this.wildQuarryChunk(cx, cz);
          if (q) sites.push({ kind: 'wild', name: 'Old moor pit', cx: q.cx, cz: q.cz, radius: 4, free: true });
        }
      }
      this._wildQuarrySites = sites;
    }
    return this._wildQuarrySites;
  }

  inWildQuarryVolume(x, y, z) {
    if (!this.wildQuarryAt(x, z)) return false;
    const grade = this.height(x, z);
    if (y >= grade - 1 || y < 3) return false;
    return true;
  }

  inOldWorkingsVolume(x, y, z) {
    return this.inNaturalCaveVolume(x, y, z) || this.inWildQuarryVolume(x, y, z);
  }

  oreAt(x, y, z) {
    // Ore comes in VEINS, not lone specks: one low-frequency 3D field, thresholded
    // by depth, so finding one lump means there's more about — tha can follow a
    // seam. Caves cut through t' seams, so they show in t' cave walls an' all.
    // A rich vein has a jet-or-iron core wi' coal round t' edges; t' deeper an'
    // richer t' field, t' better t' ore. Rosedale's grand for ironstone an' jet.
    const v = noise3(x * 0.17, y * 0.17, z * 0.17, this.seed ^ 0x04e); // one noise call; most blocks cheap-out below
    if (v <= 0.50) return B.STONE;
    
    const geo = this.geo;
    const cx = geo.coastX(z);
    
    // Cleveland ironstone / Jet thinning near old workings (Rosedale kilns)
    const nearKilns = Math.hypot(x - KILNS.x, z - KILNS.z) < 70;
    
    // STYLISED world only — none of these belong in the c.1900 real Moors:
    //  • Boulby potash/polyhalite mine is 1960s+ (≈70 yr too early)
    //  • deep rock salt: by 1900 Cleveland salt was Teesside brine-pumping, off this map
    //  • the NYM alum industry collapsed ≈1871, so by 1900 it's gone (player said: strict, no ruins)
    if (!geo.realWorld) {
      const isNECoast = z > 0 && x > cx - 180;
      if (isNECoast && y < 12 && v > 0.85) return B.POLYHALITE;
      if (isNECoast && y < 16 && v > 0.65) return B.ROCK_SALT;
      const isCoastCliff = x > cx - 100 && x < cx - 10;
      if (isCoastCliff && y >= 15 && y < 45 && v > 0.65) return B.ALUM_SHALE;
    }

    // jet: in the real-Moors world it's the Whitby jet rock — won at the Whitby cliffs/moors, rare elsewhere
    const jetThresh = geo.realWorld
      ? ((geo.jetAt && geo.jetAt(x, z)) ? 0.62 : 0.97)
      : (nearKilns ? 0.94 : 0.86);
    if (y < 20 && v > jetThresh) return B.JET_ORE;    // jet
    // ironstone: in the real-Moors world it's the Rosedale field — rich seams there, rare elsewhere
    const ironThresh = geo.realWorld
      ? ((geo.ironstoneAt && geo.ironstoneAt(x, z)) ? 0.5 : 0.92)
      : (nearKilns ? 0.82 : 0.68);
    if (y < 34 && v > ironThresh) return B.IRON_ORE;                  // ironstone
    // coal: the NYM moor seams were thin, poor an' nigh worked-out by 1900 (Durham coal came by rail) — scarce
    const coalThresh = geo.realWorld ? 0.9 : (nearKilns ? 0.78 : 0.61);
    if (y < 48 && v > coalThresh) return B.COAL_ORE;                  // coal
    
    return B.STONE;
  }

  generateChunk(cx, cz) {
    const data = new Uint8Array(CHUNK * CHUNK * HEIGHT);
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const geo = this.geo;
    const railCols = []; // columns in t' loading gauge — re-cleared after t' stamps

    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const x = x0 + lx, z = z0 + lz;
        const h = geo.height(x, z);
        const inn = this.innAt(x, z);
        const bog = geo.bogginess(x, z);
        const coast = geo.coastT(x, z);
        const onCliff = coast > 0.03 && coast < 0.85 && h > WATER_LEVEL;
        const blanketBog = h >= 33 && bog > 0.45;
        const pool = this.isBogPool(x, z);
        const rocky = h >= 45 || onCliff;
        const vcol = geo.villageColumn(x, z);
        const onRoad = geo.onRoad(x, z) && h > WATER_LEVEL && !blanketBog;

        // beach: the moors coast lays a flat sand strip at the foot of the cliffs (h≈WL+1,
        // hard by the sea); the stylised world keeps its DEM-coast rule.
        const beach = geo.realWorld
          ? (h <= WATER_LEVEL + 1 && geo.coastDistCoarse(x, z) <= 14)
          : (coast > 0.3 && h >= 22 && h <= 27);
        for (let y = 0; y <= h; y++) {
          let id;
          if (y === 0) id = B.BEDROCK;
          else if (y < h - 3) {
            id = (inn ? false : this.caveAt(x, y, z, h)) ? B.AIR : this.oreAt(x, y, z);
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
        // moor rivers (client carve): cut the beck bed into the un-carved ground and run
        // water down it (h is the un-carved ground). Don't flood the track gauge — the rail
        // crosses on its embankment for now (proper bridges/culverts are a later slice).
        let inRiver = false, riverRC = null;
        if (geo.realWorld && geo.riverColumn && !vcol) {
          const rc = geo.riverColumn(x, z);
          if (rc) {
            inRiver = true; riverRC = rc;
            for (let y = rc.bed + 1; y <= h + 2 && y < HEIGHT; y++) data[IDX(lx, y, lz)] = B.AIR; // clear the channel
            if (rc.bed > 0) data[IDX(lx, rc.bed, lz)] = B.GRAVEL;                                  // gravel bed
            for (let y = rc.bed + 1; y <= rc.wl && y < HEIGHT; y++) data[IDX(lx, y, lz)] = B.WATER; // water runs through (the rail crosses on a culvert)
          }
        }
        // blanket bog pools: two deep, dark and hungry — STYLISED world only.
        // The real Moors' tops are walkable peat-marsh, so no open liquid there.
        if (pool && !geo.realWorld) {
          data[IDX(lx, h, lz)] = B.BOG;
          if (h - 1 > 0) data[IDX(lx, h - 1, lz)] = B.BOG;
          if (h - 2 > 0) data[IDX(lx, h - 2, lz)] = B.PEAT;
        }

        // t' railway profile (deck height an' distance frae t' line) — wanted
        // both for t' permanent way below an' for t' lineside planting
        const ri = geo.railInfo(x, z);

        // surface vegetation
        if (!vcol && (!pool || geo.realWorld) && !onRoad && !inRiver && h >= WATER_LEVEL && h <= HEIGHT - 3) {
          const surf = data[IDX(lx, h, lz)];
          const r = hash2i(x, z, this.seed ^ 0xf10);
          const heath = geo.heatheriness(x, z);
          const onVerge = ri && ri.d >= 4 && ri.d < 7;   // widened band, beyond the four-foot
          if (onVerge && (surf === B.GRASS || surf === B.DIRT) && data[IDX(lx, h + 1, lz)] === B.AIR) {
            // lineside verge: dense varied band — brambles, ferns, foxgloves,
            // holly an' bracken; t' four-foot stays clean beyond ri.d < 4
            const v = hash2i(x, z, this.seed ^ 0x5a1e);
            let plant = 0;
            if (v < 0.22) plant = B.BRAMBLE;            // brambles
            else if (v < 0.46) plant = B.FERN;          // thick ferns
            else if (v < 0.62) plant = B.FOXGLOVE;      // foxglove spikes
            else if (v < 0.74) plant = B.HOLLY;         // evergreen winter anchor
            else if (v < 0.84) plant = B.BRACKEN;       // bracken
            else if (v < 0.90) plant = B.BLACKTHORN;    // sloes in autumn
            else if (v < 0.96) plant = B.HAZEL;         // hazelnuts in autumn
            if (plant) data[IDX(lx, h + 1, lz)] = plant;   // ~4% left bare
          } else if (surf === B.GRASS) {
            // patches o' colour on an open moor: heather drifts (purple),
            // gorse banks (yellow), woods — wi' bare ground between
            const gorse = this.geo.heatheriness(x + 1731, z - 942); // an independent patch field
            const wood = this.woodiness(x, z);
            if (h >= 33) {
              if (heath > 0.28) { // a heather drift
                if (r < 0.5) data[IDX(lx, h + 1, lz)] = B.HEATHER;
                else if (r < 0.56) data[IDX(lx, h + 1, lz)] = B.BILBERRY_BUSH;
                else if (r < 0.574) data[IDX(lx, h + 1, lz)] = B.FOXGLOVE; // t' odd spire in t' heather
              } else if (gorse > 0.34) { // a gorse bank
                if (r < 0.4) data[IDX(lx, h + 1, lz)] = B.GORSE;
                else if (r < 0.43) data[IDX(lx, h + 1, lz)] = B.FERN;
              } else {
                // open moor: a touch more life than t' bare stretches afore
                if (r < 0.07) data[IDX(lx, h + 1, lz)] = B.TUSSOCK;
                else if (r < 0.085) data[IDX(lx, h + 1, lz)] = B.HEATHER;
                else if (r < 0.095) data[IDX(lx, h + 1, lz)] = B.GORSE;
                else if (r < 0.10) data[IDX(lx, h + 1, lz)] = B.FOXGLOVE;
              }
            } else {
              // dale pasture an' fringe: gorse on t' banks, ferns an' bracken near
              // t' woods, dog rose an' elder in t' hedgerow
              if (gorse > 0.4 && r < 0.3) data[IDX(lx, h + 1, lz)] = B.GORSE;
              else if (wood > 0.3 && r < 0.16) data[IDX(lx, h + 1, lz)] = B.BRACKEN;
              else if (wood > 0.3 && r < 0.21) data[IDX(lx, h + 1, lz)] = B.FERN;
              else if (wood > 0.25 && r < 0.235) data[IDX(lx, h + 1, lz)] = B.FOXGLOVE;
              else if (r < 0.05) data[IDX(lx, h + 1, lz)] = B.TUSSOCK;
              else if (r < 0.062) data[IDX(lx, h + 1, lz)] = B.BILBERRY_BUSH;
              else if (r < 0.072) data[IDX(lx, h + 1, lz)] = B.DOG_ROSE;
              else if (r < 0.078) data[IDX(lx, h + 1, lz)] = B.ELDER;
              else if (r < 0.088) data[IDX(lx, h + 1, lz)] = B.BLACKTHORN;
              else if (r < 0.092) data[IDX(lx, h + 1, lz)] = B.HAZEL;
            }
          } else if (surf === B.PEAT) {
            if (geo.realWorld && geo.bogginess(x, z) > 0.6 && r < 0.16) data[IDX(lx, h + 1, lz)] = B.COTTONGRASS;
            else if (r < 0.14) data[IDX(lx, h + 1, lz)] = B.TUSSOCK;
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

        // t' Moors Railway: a proper engineered permanent way — t' deck
        // follows t' line's own smoothed profile, so it rides embankments
        // an' causeways ower t' dips an' cuts a slot through t' rises.
        // (T' rails an' sleepers themselves are drawn as real geometry.)
        if (ri && ri.d < 2.8) {
          // floor (not round) so t' voxel bed tucks UNDER t' smooth ballast crown
          const deck = Math.max(1, Math.min(HEIGHT - 5, Math.floor(ri.deck)));
          // embankment / causeway: fill frae t' ground (or t' watter bed) up to
          // t' deck so there's a level shoulder either side — no trench. BUT where t'
          // line crosses a beck, leave a CULVERT: keep t' water, cap it wi' a stone
          // lintel, an' raise t' embankment frae there up — t' beck flows under t' rails.
          // In the river-crossing zone, a raised deck becomes an OPEN arch carried on a
          // stone deck slab — symmetrically over BOTH the beck and the raised banks (dry
          // relief arches), so no side is a blank embankment wall. Solid dressed-stone only
          // where the deck comes down to the ground (the abutment ends). Normal earth
          // embankment away from rivers.
          const bridgeZone = geo.realWorld && geo.nearRiver && geo.nearRiver(x, z, 3);
          const overSea = geo.realWorld && geo.coastT && geo.coastT(x, z) > 0.5;
          const spanLevel = riverRC ? riverRC.wl : h;
          // t' water table under t' span: t' beck's own level in t' channel, sea level ower
          // t' tidal flats (t' estuary by Whitby is water wi' no riverColumn). T' stamp must
          // never carve nor wall below it — t' culvert promise above: t' water runs through.
          const waterTop = riverRC ? Math.max(riverRC.wl, h < WATER_LEVEL ? WATER_LEVEL : 0)
                                   : (h < WATER_LEVEL ? WATER_LEVEL : -1);
          if (bridgeZone && deck - spanLevel > 2) {
            for (let y = Math.max(spanLevel, waterTop) + 1; y <= deck - 2 && y < HEIGHT; y++) data[IDX(lx, y, lz)] = B.AIR; // open arch, sprung clear o' t' water
            if (deck - 1 > waterTop && deck - 1 > 0) data[IDX(lx, deck - 1, lz)] = B.STONEBRICK; // deck slab carries the track
          } else if (overSea && deck > WATER_LEVEL + 2) {
            // SEA VIADUCT (Larpool, over the Esk estuary): open span over the water on a stone
            // deck slab, with a masonry pier every few blocks down to the seabed — sea flows under.
            for (let y = WATER_LEVEL + 1; y <= deck - 2 && y < HEIGHT; y++) data[IDX(lx, y, lz)] = B.AIR;
            if (deck - 1 > 0) data[IDX(lx, deck - 1, lz)] = B.STONEBRICK; // deck slab
            if ((x + z) % 6 === 0) for (let y = WATER_LEVEL - 8; y < deck - 1 && y > 0; y++) data[IDX(lx, y, lz)] = B.STONEBRICK; // pier
          } else if (bridgeZone) {
            // low deck ower water: a CULVERT, not a dam — stone springs frae just ABOVE t'
            // water line (t' lintel), t' beck keeps its full depth underneath.
            for (let y = Math.max(Math.min(h, deck), waterTop + 1); y < deck && y > 0; y++) data[IDX(lx, y, lz)] = B.STONEBRICK; // dressed-stone abutment
          } else {
            for (let y = Math.min(h, deck); y < deck && y > 0; y++) data[IDX(lx, y, lz)] = B.STONE; // earth embankment
          }
          // clear t' loading gauge: a slot WIDE an' TALL enough for t' train wi'
          // her sway — cuttings get the full slot, open ground just the air
          const clearTop = Math.min(HEIGHT - 1, Math.max(deck + 6, h + 1));
          for (let y = deck + 1; y <= clearTop; y++) data[IDX(lx, y, lz)] = B.AIR;
          // ballast under t' rails, dressed-stone edging, grassy verge beyond
          data[IDX(lx, deck, lz)] = ri.d < 1.4 ? B.GRAVEL : ri.d < 2.2 ? B.COBBLE : B.GRASS;
          railCols.push({ lx, lz, deck, d: ri.d });
        }

        // drystone walls stop at t' lineside — t' railway bought its land
        if (!vcol && !(ri && ri.d < 3.4) && this.wallAt(x, z)) {
          data[IDX(lx, h + 1, lz)] = B.COBBLE;
          if (hash2i(x, z, this.seed ^ 0xa12) < 0.85) data[IDX(lx, h + 2, lz)] = B.COBBLE;
        }
      }
    }

    // trees, rocks an' t' odd monkey puzzle (canopies an' blobs may cross
    // borders) — none o' it on t' railway land
    for (let lz = -2; lz < CHUNK + 2; lz++) {
      for (let lx = -2; lx < CHUNK + 2; lx++) {
        const x = x0 + lx, z = z0 + lz;
        const fruit = this.fruitTreeAt(x, z);
        const th = fruit ? 0 : this.treeAt(x, z);
        const size = (fruit || th) ? 0 : this.boulderAt(x, z);
        const mh = (fruit || th || size) ? 0 : this.monkeyPuzzleAt(x, z);
        if (!fruit && !th && !size && !mh) continue;
        if (geo.realWorld && geo.nearRiver && geo.nearRiver(x, z, 2)) continue; // nowt grows in t' beck
        const tri = geo.railInfo(x, z);
        if (tri && tri.d < 4) continue; // a cleared verge — nowt grows in t' four-foot
        if (geo.realWorld && geo.nearTownBuilding && geo.nearTownBuilding(x, z, 5)) continue; // streets kept clear o' trees
        if (geo.realWorld && geo.nearAbbey && geo.nearAbbey(x, z, 4)) continue; // a clear headland round the abbey
        const gh = this.geo.height(x, z);
        if (fruit) this.stampTree(data, lx, gh + 1, lz, 4, true);
        else if (th) this.stampTree(data, lx, gh + 1, lz, th);
        else if (size) this.stampBoulder(data, lx, gh, lz, size, x, z);
        else this.stampMonkeyPuzzle(data, lx, gh + 1, lz, mh);
      }
    }

    this.stampVillage(data, cx, cz);
    this.stampTownExtras(data, cx, cz);
    this.stampLandmarks(data, cx, cz);
    this.stampAbbey(data, cx, cz);
    this.stampWorks(data, cx, cz);
    this.stampFarm(data, cx, cz);
    this.stampShelters(data, cx, cz);
    this.stampStructures(data, cx, cz);
    this.stampCastle(data, cx, cz);
    // re-clear t' loading gauge now t' trees, walls an' buildings are down, so
    // nowt's left stood in t' train's road. Stations come AFTER, so platforms
    // an' their furniture are laid into t' cleared slot an' kept.
    for (const c of railCols) {
      const top = Math.min(HEIGHT - 1, c.deck + 6);
      for (let y = c.deck + 1; y <= top; y++) data[IDX(c.lx, y, c.lz)] = B.AIR;
      data[IDX(c.lx, c.deck, c.lz)] = c.d < 1.4 ? B.GRAVEL : c.d < 2.2 ? B.COBBLE : B.GRASS;
    }
    this.stampInns(data, cx, cz);
    this.stampStations(data, cx, cz);
    this.stampBridges(data, cx, cz);
    return data;
  }

  // Is (x,z) inside any inn's protected box? O(inns) — inns.size is tiny,
  // called once per column per chunk generation.
  innAt(x, z) {
    for (const p of this.inns.values()) {
      if (x >= p.protectedBox.x0 && x <= p.protectedBox.x1 && z >= p.protectedBox.z0 && z <= p.protectedBox.z1) return p;
    }
    return null;
  }

  // Merlin's Keep: a great stone castle stood alone on t' empty north-west moor.
  // Curtain walls wi' battlements, four corner towers, a south gatehouse, an' a
  // tall central keep — set on a flattened plinth so it sits proud o' t' heather.
  stampCastle(data, cx, cz) {
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const CXp = CASTLE.x, CZp = CASTLE.z;
    const OUT = 32;                 // curtain-wall half-extent (~66x66 footprint)
    const M = OUT + 4;
    if (x0 + CHUNK <= CXp - M || x0 > CXp + M || z0 + CHUNK <= CZp - M || z0 > CZp + M) return;

    const put = (wx, wy, wz, id) => {
      const lx = wx - x0, lz = wz - z0;
      if (lx >= 0 && lx < CHUNK && lz >= 0 && lz < CHUNK && wy > 0 && wy < HEIGHT) data[IDX(lx, wy, lz)] = id;
    };
    // plinth level — clamped so even t' keep's battlements clear t' world ceiling
    const base = Math.max(WATER_LEVEL + 1, Math.min(HEIGHT - 26, this.geo.height(CXp, CZp)));

    // --- plinth, curtain wall, corner towers, gatehouse ---
    for (let dz = -OUT - 3; dz <= OUT + 3; dz++) {
      for (let dx = -OUT - 3; dx <= OUT + 3; dx++) {
        const wx = CXp + dx, wz = CZp + dz;
        if (wx < x0 - 1 || wx >= x0 + CHUNK + 1 || wz < z0 - 1 || wz >= z0 + CHUNK + 1) continue;
        const ax = Math.abs(dx), az = Math.abs(dz);
        const inFoot = ax <= OUT && az <= OUT;
        const terr = this.geo.height(wx, wz);

        // level the ground: clear owt above the plinth, fill any hollow below
        for (let y = base + 1; y < base + 26; y++) put(wx, y, wz, B.AIR);
        if (inFoot) {
          for (let y = Math.min(terr, base); y < base; y++) put(wx, y, wz, B.STONE);
          put(wx, base, wz, B.COBBLE);                 // bailey / courtyard floor
        } else {
          for (let y = Math.min(terr, base); y < base; y++) put(wx, y, wz, B.DIRT);
          if (terr < base) put(wx, base, wz, B.GRASS);  // a clear, level approach
        }

        const corner = ax >= OUT - 3 && az >= OUT - 3;
        const onWall = (ax === OUT || az === OUT);
        const gate = az === OUT && dz > 0 && ax <= 3;   // south gatehouse opening

        if (corner) {
          const th = 17;                                // corner towers, taller
          for (let y = base + 1; y <= base + th; y++) put(wx, y, wz, B.STONEBRICK);
          if (((dx + dz) & 1) === 0) put(wx, base + th + 1, wz, B.STONEBRICK); // crenellations
          if (((dx + dz) & 3) === 0) { put(wx, base + 6, wz, B.WINDOW); put(wx, base + 12, wz, B.WINDOW); }
          if (dx === 0 || dz === 0) put(wx, base + th, wz, B.LANTERN);
        } else if (gate) {
          for (let y = base + 5; y <= base + 11; y++) put(wx, y, wz, B.STONEBRICK); // arch over
          if (ax === 3) { for (let y = base + 1; y <= base + 11; y++) put(wx, y, wz, B.STONEBRICK); put(wx, base + 5, wz, B.LANTERN); }
        } else if (onWall) {
          const wh = 9;                                 // curtain wall
          for (let y = base + 1; y <= base + wh; y++) put(wx, y, wz, B.STONEBRICK);
          if (((dx + dz) & 1) === 0) put(wx, base + wh + 1, wz, B.STONEBRICK); // merlons
          else if (dx % 8 === 0 || dz % 8 === 0) put(wx, base + wh + 1, wz, B.LANTERN); // wall lamps
          if ((dx + dz) % 6 === 0) put(wx, base + wh - 3, wz, B.WINDOW); // arrow slits
        }
      }
    }

    // --- central keep ---
    const K = 8, kh = 22;
    for (let dz = -K; dz <= K; dz++) {
      for (let dx = -K; dx <= K; dx++) {
        const wx = CXp + dx, wz = CZp + dz;
        if (wx < x0 - 1 || wx >= x0 + CHUNK + 1 || wz < z0 - 1 || wz >= z0 + CHUNK + 1) continue;
        const ax = Math.abs(dx), az = Math.abs(dz);
        if (ax === K || az === K) {
          for (let y = base + 1; y <= base + kh; y++) put(wx, y, wz, B.STONEBRICK);
          if (((dx + dz) & 1) === 0) put(wx, base + kh + 1, wz, B.STONEBRICK);
          if (((dx + dz) & 3) === 0) { put(wx, base + 5, wz, B.WINDOW); put(wx, base + 11, wz, B.WINDOW); put(wx, base + 17, wz, B.WINDOW); }
        } else {
          for (let y = base + 1; y < base + kh; y++) put(wx, y, wz, ((y - base) % 6 === 0) ? B.PLANKS : B.AIR);
          if (dx === 0 && dz === 0) for (let y = base + 2; y < base + kh; y += 6) put(wx, y, wz, B.LANTERN);
        }
      }
    }
    for (let dx = -1; dx <= 1; dx++) for (let y = base + 1; y <= base + 3; y++) put(CXp + dx, y, CZp + K, B.AIR); // keep doorway
    put(CXp, base + kh + 2, CZp, B.LANTERN); // a beacon atop the keep

    this._castleBase = base;
  }

  // One inn's exterior shell + underground parlour, stamped into whichever
  // chunk(s) its protectedBox overlaps. Same idiom as stampStations: local
  // put() closure bounds-checked against the current chunk only, so a
  // structure straddling a chunk boundary gets finished by its OTHER chunk's
  // own call — every chunk only ever writes its own CHUNK x CHUNK x HEIGHT slab.
  stampInns(data, cx, cz) {
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const put = (wx, wy, wz, id) => {
      const lx = wx - x0, lz = wz - z0;
      if (lx >= 0 && lx < CHUNK && lz >= 0 && lz < CHUNK && wy >= 0 && wy < HEIGHT) data[IDX(lx, wy, lz)] = id;
    };
    for (const p of this.inns.values()) {
      if (p.protectedBox.x1 < x0 || p.protectedBox.x0 >= x0 + CHUNK || p.protectedBox.z1 < z0 || p.protectedBox.z0 >= z0 + CHUNK) continue;

      // --- exterior shell: a modest stone building, gabled slate roof, one door ---
      // Footprint is 9(x) x 7(z) — x is the LONG axis. The ridge runs along x
      // (constant height for every wx), with height falling off toward fz0/fz1
      // (the LONG walls become eaves); the SHORT end walls (wx=fx0/fx1) are
      // closed gable triangles that climb from the eave line up to the ridge
      // peak, matching stampStations' buildOne (worldgen.js buildOne, roofY
      // formula: peak = g+wallH+1+half, roofY = g+wallH+1+(half-|off-centre|)).
      const { x0: fx0, z0: fz0, x1: fx1, z1: fz1 } = p.footprint;
      const wallH = 3, g = p.groundY;
      const midX = Math.round((fx0 + fx1) / 2), midZ = Math.round((fz0 + fz1) / 2);
      const gableHalf = Math.floor((fz1 - fz0) / 2); // 3 for a 7-deep footprint
      const ridgeY = g + wallH + 1 + gableHalf;       // peak height, constant along x
      for (let wx = fx0; wx <= fx1; wx++) for (let wz = fz0; wz <= fz1; wz++) {
        const perim = (wx === fx0 || wx === fx1 || wz === fz0 || wz === fz1);
        const roofY = g + wallH + 1 + (gableHalf - Math.abs(wz - midZ));
        put(wx, g, wz, B.PLANKS); // floor
        for (let y = g + 1; y <= g + wallH; y++) put(wx, y, wz, perim ? B.STONEBRICK : B.AIR);
        // interior clear + a flat STONEBRICK ceiling at g+wallH+1, unchanged from
        // D1 — the gable loft above it is a closed shell, empty air inside
        put(wx, g + wallH + 1, wz, B.STONEBRICK);
        for (let y = g + wallH + 2; y < roofY; y++) put(wx, y, wz, B.AIR);
        // gable-end triangles (short walls, wx=fx0/fx1): solid stone climbing to the ridge
        if (wx === fx0 || wx === fx1) for (let y = g + wallH + 2; y <= roofY; y++) put(wx, y, wz, B.STONEBRICK);
        put(wx, roofY, wz, B.SLATE); // slate skin along the gable slope
      }
      // door: centred on doorSide, door block at ground+1, clear air at ground+2
      const doorPos = p.doorSide === 'n' ? [midX, fz0] : p.doorSide === 's' ? [midX, fz1]
        : p.doorSide === 'e' ? [fx1, midZ] : [fx0, midZ];
      put(doorPos[0], g + 1, doorPos[1], B.INN_DOOR);
      put(doorPos[0], g + 2, doorPos[1], B.AIR);

      // windows: 2 per long wall (z=fz0, z=fz1) at g+2, skipping the door column
      for (const wz of [fz0, fz1]) {
        for (const wx of [fx0 + 2, fx1 - 2]) {
          if (wx === doorPos[0] && wz === doorPos[1]) continue;
          put(wx, g + 2, wz, B.WINDOW);
        }
      }

      // chimney: a 1-block RBRICK column at one gable end (fx0), rising from the
      // roof surface there to peak+2 — matches stampStations' chimney idiom.
      {
        const chx = fx0;
        for (let y = ridgeY; y <= ridgeY + 2; y++) put(chx, y, midZ, B.RBRICK);
      }

      // --- underground parlour: hollow room + solid stone shell, directly below the site ---
      const { floorY, w: pw, l: pl, h: ph, wallThick: wt } = p.parlour;
      const px0 = p.origin.x - Math.floor(pw / 2) - wt, px1 = px0 + pw + 2 * wt - 1;
      const pz0 = p.origin.z - Math.floor(pl / 2) - wt, pz1 = pz0 + pl + 2 * wt - 1;
      for (let wx = px0; wx <= px1; wx++) for (let wz = pz0; wz <= pz1; wz++) {
        const inShell = (wx === px0 || wx === px1 || wz === pz0 || wz === pz1);
        put(wx, floorY - 1, wz, B.STONEBRICK); // footing
        put(wx, floorY, wz, B.STONEBRICK);     // floor — solid everywhere, not just the shell
        for (let y = floorY + 1; y <= floorY + ph; y++) put(wx, y, wz, inShell ? B.STONEBRICK : B.AIR); // walls + hollow interior
        put(wx, floorY + ph + 1, wz, B.STONEBRICK); // ceiling
      }
      // interior exit door in the wall matching the exterior doorSide
      const exitPos = p.doorSide === 'n' ? [p.origin.x, pz0] : p.doorSide === 's' ? [p.origin.x, pz1]
        : p.doorSide === 'e' ? [px1, p.origin.z] : [px0, p.origin.z];
      put(exitPos[0], floorY + 1, exitPos[1], B.INN_DOOR);

      // hearth: physical cell only in D1 (fire/decor arrive in D2/D3)
      const ix0 = p.origin.x - Math.floor(pw / 2), iz0 = p.origin.z - Math.floor(pl / 2);
      const hx = ix0 + p.parlour.hearth.x, hz = iz0 + p.parlour.hearth.z;
      put(hx, floorY, hz, B.STONEBRICK);
      put(hx, floorY + 1, hz, B.TORCH);

      // --- D2: furnish the parlour from p.furnish (servery/strongbox/benches) +
      // the existing game tables. All coords are parlour-interior-local, same
      // space as parlour.hearth/tables — resolve to world coords the same way
      // the hearth does above (ix0/iz0 + local). Bounds-check against the
      // interior box (walls sit AT the shell perimeter, one ring outside the
      // interior 0..pw-1 / 0..pl-1 range) and skip the hearth cell so furniture
      // never lands in a wall or on top of the fire.
      if (p.furnish) {
        const toWorld = (local) => ({ x: ix0 + local.x, z: iz0 + local.z });
        const inInterior = (local) => local.x >= 0 && local.x < pw && local.z >= 0 && local.z < pl;
        const isHearth = (local) => local.x === p.parlour.hearth.x && local.z === p.parlour.hearth.z;
        const isDoor = (wx, wz) => wx === exitPos[0] && wz === exitPos[1];

        for (const t of p.parlour.tables) {
          if (!inInterior(t) || isHearth(t)) continue;
          const w = toWorld(t);
          if (isDoor(w.x, w.z)) continue;
          put(w.x, floorY + 1, w.z, B.PLANKS); // game table
        }
        for (const b of p.furnish.benches) {
          if (!inInterior(b) || isHearth(b)) continue;
          const w = toWorld(b);
          if (isDoor(w.x, w.z)) continue;
          put(w.x, floorY + 1, w.z, B.BENCH);
        }
        if (inInterior(p.furnish.servery) && !isHearth(p.furnish.servery)) {
          const w = toWorld(p.furnish.servery);
          if (!isDoor(w.x, w.z)) put(w.x, floorY + 1, w.z, B.PLANKS); // hatch/servery counter
        }
        if (inInterior(p.furnish.strongbox) && !isHearth(p.furnish.strongbox)) {
          const w = toWorld(p.furnish.strongbox);
          if (!isDoor(w.x, w.z)) put(w.x, floorY + 1, w.z, B.STRONGBOX);
        }
      }
    }
  }

  // Station: platforms laid parallel to t' rails, an NER timber (or grand
  // stone) station building, lamps, a running-in board — an' at t' big stations
  // an overall trainshed an' a lattice footbridge. cell(a,w): a along t' line,
  // w across it (w>0 t' near platform side, w<0 t' far side).
  stampStations(data, cx, cz) {
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const put = (wx, wy, wz, id) => {
      const lx = wx - x0, lz = wz - z0;
      if (lx >= 0 && lx < CHUNK && lz >= 0 && lz < CHUNK && wy > 0 && wy < HEIGHT) data[IDX(lx, wy, lz)] = id;
    };
    const at = (wx, wy, wz) => {
      const lx = wx - x0, lz = wz - z0;
      if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK || wy <= 0 || wy >= HEIGHT) return undefined;
      return data[IDX(lx, wy, lz)];
    };
    const stamped = new Set();
    for (const { name: lineName, path } of this.geo.railPaths()) {
      const line = this.geo.railLines().find(l => l.name === lineName);
      const stns = line ? line.stops : [];
      for (let si = 0; si < stns.length; si++) {
      const s = stns[si];
      if (s.x < x0 - 24 || s.x > x0 + CHUNK + 24 || s.z < z0 - 24 || s.z > z0 + CHUNK + 24) continue;
      if (stamped.has(s.name)) continue;   // a shared junction (Grosmont/Whitby) is stamped once
      stamped.add(s.name);
      const sp = this.geo.samplePosOn(path, path.stationS[si]);
      const g = Math.max(Math.round(sp.deck), WATER_LEVEL + 1);
      const ux = sp.tx, uz = sp.tz, px = uz, pz = -ux;
      const cell = (a, w) => [Math.round(sp.x + ux * a + px * w), Math.round(sp.z + uz * a + pz * w)];
      const { along: bAl, across: bAc } = stationOrient(ux, uz);
      const isPickering = s.name === 'Pickering';
      const isBig = isPickering || s.name === 'Whitby';
      const sides = isBig ? [1, -1] : [1];
      const aHalf = isBig ? 9 : 5;
      // The building is stamped on a world-cardinal basis (n/s or e/w) so it's a clean box, not a
      // staircased diagonal. Its CENTRE is offset along the rail-perpendicular (px,pz — the platform
      // side), NOT the cardinal axis: on a diagonal line the cardinal offset isn't perpendicular and
      // sits the box back on the rails (Sandsend). Platforms/track/furniture keep `cell` (rail-parallel).
      const bOff = isBig ? 10 : 8;
      // pick the side (±rail-perpendicular) whose footprint best clears ALL tracks and isn't over
      // the sea — at a junction (Grosmont) one side sits on the crossing line; on the coast one
      // side is open water. Ties favour +px (the platform side, so the door faces the platform).
      const sideAt = (sgn) => {
        const bx = Math.round(sp.x + px * sgn * bOff), bz = Math.round(sp.z + pz * sgn * bOff);
        if (this.geo.coastT && this.geo.coastT(bx, bz) > 0.3) return { bx, bz, md: -1 };
        let md = Infinity;
        for (let a = -4; a <= 4; a++) for (let w = -2; w <= 2; w++) {
          const ri = this.geo.railInfo(bx + bAl[0] * a + bAc[0] * w, bz + bAl[1] * a + bAc[1] * w);
          if (ri) md = Math.min(md, ri.d);
        }
        return { bx, bz, md };
      };
      const sP = sideAt(1), sM = sideAt(-1), pick = sM.md > sP.md ? sM : sP;
      const bX = pick.bx, bZ = pick.bz;
      const boxCell = (a, w) => [bX + bAl[0] * a + bAc[0] * w, bZ + bAl[1] * a + bAc[1] * w];

      // platforms (planks level wi' t' deck, footing carried down to t' ground)
      for (const sd of sides) for (let a = -aHalf; a <= aHalf; a++) for (let w = 2; w <= 4; w++) {
        const [wx, wz] = cell(a, sd * w);
        put(wx, g, wz, B.PLANKS);
        for (let y = g + 1; y <= g + 3; y++) put(wx, y, wz, B.AIR);
        for (let y = g - 1; y > 0 && y >= g - 7; y--) { const b = at(wx, y, wz); if (b === undefined || (b !== B.AIR && b !== B.WATER)) break; put(wx, y, wz, B.STONE); }
      }

      // a station building beside t' platform — cream/Indian-red NER timber, or
      // dressed stone for t' grand stations, wi' a slate roof an' a brick stack
      const buildOne = (sd, a0, a1, w0, w1, wallH, stone) => {
        const wc = (w0 + w1) / 2, half = (w1 - w0) / 2;
        const lowMat = stone ? B.STONEBRICK : B.ST_RED, hiMat = stone ? B.STONEBRICK : B.ST_CREAM;
        const peak = g + wallH + 1 + Math.round(half);
        for (let a = a0; a <= a1; a++) for (let w = w0; w <= w1; w++) {
          const [wx, wz] = boxCell(a, sd * w);
          const roofY = g + wallH + 1 + Math.round(half - Math.abs(w - wc));
          for (let y = g + 1; y <= peak + 1; y++) put(wx, y, wz, B.AIR);
          put(wx, g, wz, B.PLANKS);
          const perim = (a === a0 || a === a1 || w === w0 || w === w1);
          if (perim) {
            for (let y = g + 1; y <= g + wallH; y++) put(wx, y, wz, y === g + 1 ? lowMat : hiMat);
            if (a === a0 || a === a1) for (let y = g + wallH + 1; y < roofY; y++) put(wx, y, wz, hiMat);
          }
          put(wx, roofY, wz, B.SLATE);
        }
        const am = Math.round((a0 + a1) / 2);
        const fr = (a, w, y, id) => { const [wx, wz] = boxCell(a, sd * w); put(wx, y, wz, id); };
        fr(am - 1, w0, g + 1, B.AIR); fr(am, w0, g + 1, B.AIR); fr(am, w0, g + 2, B.AIR); // doorway
        fr(a0 + 1, w0, g + 2, B.WINDOW); fr(a1 - 1, w0, g + 2, B.WINDOW);
        // (the running-in board is now a big free-standing departures board on the platform — see below)
        const [chx, chz] = boxCell(a0 + 1, sd * Math.round(wc));
        for (let y = g + wallH + 1; y <= peak + 2; y++) put(chx, y, chz, B.RBRICK); // chimney
      };

      if (isPickering) { this.stampTrainshed(put, cell, g, aHalf); buildOne(1, -4, 4, -2, 2, 4, true); }
      else buildOne(1, -3, 3, -2, 1, 3, false);

      // platform furniture
      for (const a of [-aHalf + 1, aHalf - 1]) { const c = cell(a, 3); put(c[0], g + 1, c[1], B.LANTERN); }
      let c = cell(0, 4); put(c[0], g + 1, c[1], B.SIGNPOST);
      c = cell(-2, 4); put(c[0], g + 1, c[1], B.BENCH);

      // a big, can't-miss DEPARTURES & MARKET board on every platform: a 3-wide, 2-high
      // panel on stout posts, stood plain at t' platform edge. Right-click any of it to
      // open t' boards (nearStation covers the whole structure).
      for (const ba of [2, 3, 4]) {
        const [bx, bz] = cell(ba, sides[0] * 4);
        put(bx, g + 1, bz, B.LOG);    // post
        put(bx, g + 2, bz, B.BOARD);  // panel (lower)
        put(bx, g + 3, bz, B.BOARD);  // panel (upper)
      }

      if (isBig) this.stampFootbridge(put, cell, g, aHalf);
      if (s.name === 'Grosmont') this.stampTerrace(put, cell);
      }
    }
  }

  // simple low stone-arch overbridges — REAL voxel masonry (dressed stone) carried
  // ower t' line where she runs in a cutting, so t' arch sits natural in t' bank an'
  // is textured an' lit like t' rest o' t' world (no flat overlay slab). Stamped
  // AFTER t' loading-gauge re-clear, so nowt erases her; she leaves t' portal clear.
  stampBridges(data, cx, cz) {
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const put = (wx, wy, wz, id) => {
      const lx = wx - x0, lz = wz - z0;
      if (lx >= 0 && lx < CHUNK && lz >= 0 && lz < CHUNK && wy > 0 && wy < HEIGHT) data[IDX(lx, wy, lz)] = id;
    };
    const path = this.geo.railPath();
    const SP = 240, OPEN = 3, ABE = 5, AD = 2;     // half-span, abutment edge, half-depth along t' line
    for (let bk = 1; bk * SP < path.length; bk++) {
      const hsh = ((bk * 2654435761) >>> 0) / 4294967296;
      if (hsh > 0.62) continue;                    // not every slot earns a bridge
      const sb = bk * SP + (hsh - 0.3) * 130;      // jittered along t' line
      if (sb < 60 || sb > path.length - 60) continue;
      if (path.stationS.some(ss => Math.abs(ss - sb) < 40)) continue; // well clear o' stations
      const sp = this.geo.samplePos(sb);
      if (sp.x < x0 - 22 || sp.x > x0 + CHUNK + 22 || sp.z < z0 - 22 || sp.z > z0 + CHUNK + 22) continue;
      if (this.geo.coastT && this.geo.coastT(sp.x, sp.z) > 0.05) continue; // not out ower t' sands
      if (this.geo.inVillage && this.geo.inVillage(sp.x, sp.z, 18)) continue;
      const deck = Math.floor(sp.deck); // match t' rail carve + clearance check (both floor t' deck)
      const ux = sp.tx, uz = sp.tz, px = uz, pz = -ux;
      const cell = (a, w) => [Math.round(sp.x + ux * a + px * w), Math.round(sp.z + uz * a + pz * w)];
      // t' moors line mostly runs at grade, so t' overbridge springs frae t' lineside
      // ground an' arches ower. Skip only where t' line stands proud on an embankment
      // (an arch'd float) or runs low by t' water.
      let gMax = 0;
      for (const a of [-AD, 0, AD]) for (const w of [ABE + 1, -(ABE + 1)]) { const c = cell(a, w); gMax = Math.max(gMax, this.geo.height(c[0], c[1])); }
      if (gMax < deck - 1 || deck < WATER_LEVEL + 2) continue;
      const crownU = deck + 7, springU = deck + 5; // soffit sits ABOVE t' loading gauge (deck+1..deck+5) wi' a block to spare
      const floor = deck - 1, road = crownU + 1;
      // a FLAT soffit across t' gauge width (|w|<=2), curving down to t' springs
      // beyond — so t' train's road is always clear, even wi' deck-rounding wobble.
      const underside = (w) => {
        const aw = Math.abs(w);
        if (aw <= 2) return crownU;
        const f = (aw - 2) / Math.max(1, OPEN - 2);
        return Math.round(crownU - (crownU - springU) * f);
      };
      for (let a = -AD; a <= AD; a++) {
        for (let w = -ABE; w <= ABE; w++) {
          const [wx, wz] = cell(a, w);
          if (Math.abs(w) <= OPEN) {
            const u = underside(w);
            for (let y = deck + 1; y < u; y++) put(wx, y, wz, B.AIR);      // keep t' portal clear for t' train
            for (let y = u; y <= road; y++) put(wx, y, wz, B.STONEBRICK);  // arch ring + spandrel ower t' opening
          } else {
            for (let y = floor; y <= road; y++) put(wx, y, wz, B.STONEBRICK); // dressed-stone abutment / wing wall
          }
          if (Math.abs(a) === AD) put(wx, road + 1, wz, B.STONEBRICK);     // a low parapet down each side o' t' road
          else put(wx, road, wz, B.COBBLE);                                // cobbled lane atween t' parapets
        }
      }
    }
  }

  // a great overall roof spanning both platforms an' t' track, on stone walls,
  // open at both ends so t' train runs through (rides ABOVE t' loading gauge)
  stampTrainshed(put, cell, g, aHalf) {
    const W = 5, eave = g + 6;
    const roofAt = w => eave + (W - Math.abs(w)); // ridge ower t' track
    for (let a = -aHalf - 1; a <= aHalf + 1; a++) {
      for (let w = -W; w <= W; w++) { const [wx, wz] = cell(a, w); put(wx, roofAt(w), wz, B.SLATE); }
      for (const w of [-W, W]) { const [wx, wz] = cell(a, w); for (let y = g + 1; y <= eave; y++) put(wx, y, wz, B.STONEBRICK); }
    }
    for (const a of [-aHalf - 1, aHalf + 1]) for (let w = -W; w <= W; w++) { // gable screens above t' eaves
      const [wx, wz] = cell(a, w);
      for (let y = eave + 1; y < roofAt(w); y++) put(wx, y, wz, B.STONEBRICK);
    }
  }

  // a footbridge ower t' line wi' stone piers an' stairs down to t' platform
  stampFootbridge(put, cell, g, aHalf) {
    const W = 5, deckY = g + 7, ab = aHalf - 1;
    for (const a of [ab, ab + 1]) for (let w = -W; w <= W; w++) { const [wx, wz] = cell(a, w); put(wx, deckY, wz, B.PLANKS); put(wx, deckY + 1, wz, B.AIR); }
    for (const sd of [1, -1]) {
      for (let y = g + 1; y <= deckY; y++) { let c = cell(ab, sd * W); put(c[0], y, c[1], B.STONEBRICK); c = cell(ab + 1, sd * W); put(c[0], y, c[1], B.STONEBRICK); }
      for (let w = W; w >= 3; w--) { // stairs
        const sy = g + Math.max(1, Math.round((deckY - g) * (w - 3) / (W - 3)));
        const c = cell(ab + 2, sd * w); put(c[0], sy, c[1], B.PLANKS);
        for (let y = sy + 1; y <= deckY; y++) put(c[0], y, c[1], B.AIR);
      }
    }
  }

  // a row o' colourful cottages stepped down t' far side o' t' line — slate
  // roofs, brick stacks, a different wash on each, each sat on its own ground
  stampTerrace(put, cell) {
    const fronts = [B.TER_MINT, B.ST_CREAM, B.TER_BLUE, B.TER_YELLOW, B.TER_PINK];
    const wFront = -9, depth = 4, hH = 5, half = (depth - 1) / 2;
    for (let a = -10; a <= 10; a++) {
      const hi = Math.floor((a + 10) / 3);          // which cottage
      const col = fronts[hi % fronts.length];
      const party = ((a + 10) % 3 === 0);           // wall between cottages
      const doorBay = ((a + 10) % 3 === 1);
      for (let d = 0; d < depth; d++) {
        const w = wFront - d;
        const [wx, wz] = cell(a, w);
        const base = this.geo.height(wx, wz);
        if (base <= WATER_LEVEL) continue;
        const roofY = base + hH + 1 + Math.round(half - Math.abs(d - half));
        for (let y = base + 1; y <= roofY + 1; y++) put(wx, y, wz, B.AIR);
        put(wx, base, wz, B.PLANKS);
        const frontBack = (d === 0 || d === depth - 1);
        if (party || frontBack) {
          for (let y = base + 1; y <= base + hH; y++) put(wx, y, wz, d === 0 ? col : B.STONEBRICK);
          if (party) for (let y = base + hH + 1; y < roofY; y++) put(wx, y, wz, B.STONEBRICK);
        }
        put(wx, roofY, wz, B.SLATE);
        if (d === 0) {
          if (doorBay) { put(wx, base + 1, wz, B.AIR); put(wx, base + 2, wz, B.AIR); }
          else { put(wx, base + 2, wz, B.WINDOW); put(wx, base + 4, wz, B.WINDOW); }
        }
        if (party && d === 1) for (let y = base + hH + 2; y <= base + hH + 4; y++) put(wx, y, wz, B.RBRICK);
      }
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
          this.stampBuildingColumn(data, lx, lz, x, z, vcol.b, vcol.b.g != null ? vcol.b.g : vv.ground);
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

  // Whitby Abbey — a dramatic, imposing GOTHIC RUIN on the East Cliff: soaring nave walls with
  // tall pointed-arch lancets, a great east window frame over the sea, broken jagged tops and
  // standing crossing-piers. Trees are cleared off the headland round it.
  stampAbbey(data, cx, cz) {
    const geo = this.geo;
    if (!geo.realWorld || !geo.data) return;
    const lm = (geo.data.landmarks || []).find(l => l.kind === 'abbey');
    if (!lm) return;
    const x0c = cx * CHUNK, z0c = cz * CHUNK;
    if (lm.x < x0c - 12 || lm.x > x0c + CHUNK + 12 || lm.z < z0c - 14 || lm.z > z0c + CHUNK + 14) return;
    const put = (wx, wy, wz, id) => { const lx = wx - x0c, lz = wz - z0c; if (lx >= 0 && lx < CHUNK && lz >= 0 && lz < CHUNK && wy > 0 && wy < HEIGHT) data[IDX(lx, wy, lz)] = id; };
    const g = Math.max(WATER_LEVEL + 1, Math.round(geo.height(lm.x, lm.z)));
    const NX0 = lm.x - 3, NX1 = lm.x + 3, Z0 = lm.z - 6, Z1 = lm.z + 6; // nave: 7 wide × 13 long, E end at Z1 (the sea)
    // precinct: clear the headland (trees + air), lay a grassed-rubble floor under the church
    for (let x = lm.x - 5; x <= lm.x + 5; x++) for (let z = lm.z - 8; z <= lm.z + 8; z++) {
      for (let y = g + 1; y <= g + 20 && y < HEIGHT; y++) put(x, y, z, B.AIR);
      if (x >= NX0 - 1 && x <= NX1 + 1 && z >= Z0 - 1 && z <= Z1 + 1) put(x, g, z, ((x * 3 + z) % 4 === 0) ? B.GRASS : B.GRAVEL);
    }
    // the two long nave walls — tall, ruined (jagged tops), with tall pointed-arch lancets
    for (const wx of [NX0, NX1]) for (let z = Z0; z <= Z1; z++) {
      const top = g + 14 - (hash2i(wx, z, this.seed ^ 0xabbe) * 5 | 0);
      const arch = ((z - Z0) % 3 === 1);
      for (let y = g + 1; y <= top && y < HEIGHT; y++) { if (arch && y >= g + 3 && y <= g + 9) continue; put(wx, y, z, B.STONEBRICK); }
    }
    // the GREAT EAST WINDOW — a soaring arched frame over the sea
    for (let x = NX0; x <= NX1; x++) for (let y = g + 1; y <= g + 18 && y < HEIGHT; y++) {
      if (!(x > NX0 && x < NX1 && y >= g + 3 && y <= g + 15)) put(x, y, Z1, B.STONEBRICK);
    }
    // west gable — lower, broken
    for (let x = NX0; x <= NX1; x++) { const top = g + 8 - (hash2i(x, Z0, this.seed ^ 0xabc) * 3 | 0); for (let y = g + 1; y <= top; y++) put(x, y, Z0, B.STONEBRICK); }
    // four standing crossing-piers down the middle, for drama
    for (const px of [lm.x - 2, lm.x + 2]) for (const pz of [lm.z - 1, lm.z + 1]) for (let y = g + 1; y <= g + 12 && y < HEIGHT; y++) put(px, y, pz, B.STONEBRICK);
  }

  // The industrial WORKS: Rosedale's calcining kilns (a long bank of arched stone kilns built into
  // the slope) and the Grosmont blast furnace (a tall stone stack with a brick chimney + cast-house).
  // Sites are found by the geography; the yard is cleared + floored.
  stampWorks(data, cx, cz) {
    const geo = this.geo;
    if (!geo.realWorld || !geo.worksSites) return;
    const x0c = cx * CHUNK, z0c = cz * CHUNK;
    const put = (wx, wy, wz, id) => { const lx = wx - x0c, lz = wz - z0c; if (lx >= 0 && lx < CHUNK && lz >= 0 && lz < CHUNK && wy > 0 && wy < HEIGHT) data[IDX(lx, wy, lz)] = id; };
    for (const s of geo.worksSites()) {
      if (s.x < x0c - 18 || s.x > x0c + CHUNK + 18 || s.z < z0c - 18 || s.z > z0c + CHUNK + 18) continue;
      const g = s.g;
      // clear + floor the yard (also clears any trees)
      for (let x = s.x - s.hw - 3; x <= s.x + s.hw + 3; x++) for (let z = s.z - s.hd - 3; z <= s.z + s.hd + 3; z++) {
        for (let y = g + 1; y <= g + 14 && y < HEIGHT; y++) put(x, y, z, B.AIR);
        put(x, g, z, B.GRAVEL);
      }
      if (s.kind === 'kiln') {
        // a bank of calcining kilns: a tall stone face with arched draw-holes, the bank rising behind
        for (let dx = -s.hw; dx <= s.hw; dx++) {
          const wx = s.x + dx, arch = ((dx + s.hw) % 3 === 1);
          for (let y = g + 1; y <= g + 5 && y < HEIGHT; y++) { if (arch && y <= g + 3) continue; put(wx, y, s.z + s.hd, B.STONEBRICK); }
          for (let d = 0; d <= s.hd * 2; d++) put(wx, g + 1 + Math.min(d, 4), s.z + s.hd - d, B.STONE); // the filled bank, sloping up
        }
      } else if (s.kind === 'jetshop') {
        // a small jet carver's workshop: stone walls, a pitched slate roof, a window an' a bench
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
          const perim = Math.abs(dx) === 2 || Math.abs(dz) === 2;
          for (let y = g + 1; y <= g + 3; y++) put(s.x + dx, y, s.z + dz, perim ? B.COBBLE : B.AIR);
          put(s.x + dx, g + 4 + (2 - Math.abs(dz)), s.z + dz, B.SLATE); // little gable, ridge along x
        }
        put(s.x, g + 1, s.z - 2, B.AIR); put(s.x, g + 2, s.z - 2, B.AIR);                 // doorway
        put(s.x + 1, g + 2, s.z - 2, B.WINDOW); put(s.x - 1, g + 2, s.z - 2, B.WINDOW);   // shop windows
        put(s.x, g + 1, s.z + 1, B.BENCH);                                                // the carver's bench
      } else {
        // the blast furnace: a 5x5 stone stack, hollow, with a brick chimney top + a slated cast-house
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
          const perim = Math.abs(dx) === 2 || Math.abs(dz) === 2;
          for (let y = g + 1; y <= g + 11 && y < HEIGHT; y++) put(s.x + dx, y, s.z + dz, perim ? B.STONEBRICK : B.AIR);
        }
        for (let y = g + 1; y <= g + 13 && y < HEIGHT; y++) put(s.x, y, s.z, B.RBRICK); // the chimney up the middle
        for (let dx = -2; dx <= 2; dx++) for (let dz = 3; dz <= 5; dz++) { put(s.x + dx, g, s.z + dz, B.PLANKS); put(s.x + dx, g + 4, s.z + dz, B.SLATE); for (let y = g + 1; y <= g + 3; y++) if (Math.abs(dx) === 2 || dz === 5) put(s.x + dx, y, s.z + dz, B.STONEBRICK); }
      }
    }
  }

  // Farmsteads: farmhouse + barn stamped via the town building column stamper;
  // fold as a 2-high fence ring on the ground so Task-3's barrier rule pens the stock.
  // Moors-gated; the stylised world is untouched.
  stampFarm(data, cx, cz) {
    const geo = this.geo;
    if (!geo.realWorld || !geo.farmSites) return;
    const x0c = cx * CHUNK, z0c = cz * CHUNK;
    for (const f of geo.farmSites()) {
      for (const b of geo._farmBuildings(f)) {
        if (b.x1 < x0c - 1 || b.x0 > x0c + CHUNK || b.z1 < z0c - 1 || b.z0 > z0c + CHUNK) continue;
        if (b.type === 'fold') {
          // a 2-high fence ring — stock can't hop it (Task 3 barrier rule)
          for (let x = b.x0; x <= b.x1; x++) for (let z = b.z0; z <= b.z1; z++) {
            if (x !== b.x0 && x !== b.x1 && z !== b.z0 && z !== b.z1) continue; // perimeter only
            const lx = x - x0c, lz = z - z0c;
            if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK) continue;
            const g = this.geo.height(x, z);
            data[IDX(lx, g + 1, lz)] = B.FENCE;
            data[IDX(lx, g + 2, lz)] = B.FENCE;
          }
        } else {
          // farmhouse / barn — reuse the town building column stamper
          for (let x = b.x0; x <= b.x1; x++) for (let z = b.z0; z <= b.z1; z++) {
            const lx = x - x0c, lz = z - z0c;
            if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK) continue;
            this.stampBuildingColumn(data, lx, lz, x, z, b, b.g != null ? b.g : geo.height(x, z));
          }
        }
      }
    }
  }

  // Town dressing: a sign post + a levelled, accessible doorstep outside every place of business,
  // so folk are led to them an' can actually get in (the door's on t' -z wall).
  stampTownExtras(data, cx, cz) {
    const geo = this.geo, x0 = cx * CHUNK, z0 = cz * CHUNK;
    if (!geo.realWorld || !geo._townBuildings) return;
    const put = (wx, wy, wz, id) => { const lx = wx - x0, lz = wz - z0; if (lx >= 0 && lx < CHUNK && lz >= 0 && lz < CHUNK && wy > 0 && wy < HEIGHT) data[IDX(lx, wy, lz)] = id; };
    for (const v of geo.villages) {
      if (Math.abs(v.x - (x0 + 8)) > v.radius + 24 || Math.abs(v.z - (z0 + 8)) > v.radius + 24) continue;
      for (const b of geo._townBuildings(v)) {
        if (!b.biz) continue;                 // only places of business get a sign + doorstep
        const midX = Math.floor((b.x0 + b.x1) / 2), g = b.g;
        // accessible doorstep: a levelled cobble forecourt just outside the door (the z0 wall)
        for (let dx = -1; dx <= 1; dx++) for (let dd = 1; dd <= 2; dd++) {
          put(midX + dx, g, b.z0 - dd, B.COBBLE);
          for (let y = g + 1; y <= g + 4; y++) put(midX + dx, y, b.z0 - dd, B.AIR);
        }
        // a stout sign post with a board by the door — visible down the street
        const sx = midX + 1, sz = b.z0 - 1;
        for (let y = g + 1; y <= g + 3; y++) put(sx, y, sz, B.LOG);
        put(sx, g + 4, sz, B.BOARD);
        put(midX, g + 4, b.z0 - 1, B.BOARD);  // a board hung out over the doorway
      }
    }
  }

  stampBuildingColumn(data, lx, lz, x, z, b, g) {
    if (b.type === 'minster') return this.stampMinsterColumn(data, lx, lz, x, z, b, g);
    if (b.type === 'ruin') return this.stampRuinColumn(data, lx, lz, x, z, b, g);
    const wallMat = b.wall === 'cobble' ? B.COBBLE : b.wall === 'stonebrick' ? B.STONEBRICK : (b.type === 'barn' ? B.PLANKS : B.STONEBRICK);
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
      data[IDX(lx, roofY, lz)] = b.roof === 'slate' ? B.SLATE : b.roof === 'pantile' ? B.ST_RED : B.THATCH;
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
      // guard: no lantern in t' doorway column (x===midX) at the first interior row
      // — keeps the threshold clear an' lets folk see the door is open.
      const doorFx = midX - b.x0;
      const blocksThreshold = (testFx, testFz) => testFx === doorFx && testFz <= 1;
      if (b.type === 'pub') {
        if (fx === 1 && fz === 1 && !blocksThreshold(1, 1)) data[IDX(lx, g + 1, lz)] = B.LANTERN;
        if (fx === 2 && fz === 4) data[IDX(lx, g + 1, lz)] = B.BENCH;
        if (fx === 7 && fz === 1) data[IDX(lx, g + 1, lz)] = B.RANGE;
        if (fx === 5 && fz === 4) data[IDX(lx, g + 1, lz)] = B.LANTERN;
      } else if (b.type === 'farm') {
        if (fx === 1 && fz === 1 && !blocksThreshold(1, 1)) data[IDX(lx, g + 1, lz)] = B.LANTERN;
        if (fx === 9 && fz === 5) data[IDX(lx, g + 1, lz)] = B.RANGE;
        if (fx === 5 && fz === 5) data[IDX(lx, g + 1, lz)] = B.BENCH;
      } else if (b.type === 'chapel') {
        if (fx === 1 && fz === 1 && !blocksThreshold(1, 1)) data[IDX(lx, g + 1, lz)] = B.LANTERN;
        if (fx === 5 && fz === 1 && !blocksThreshold(5, 1)) data[IDX(lx, g + 1, lz)] = B.LANTERN;
      } else if (b.type === 'cottage') {
        if (fx === 1 && fz === 1 && !blocksThreshold(1, 1)) data[IDX(lx, g + 1, lz)] = B.LANTERN;
      } else if (b.type === 'shop') {
        // counter, light, an' a bench or range so t' shops are useful
        if (fx === 1 && fz === 1 && !blocksThreshold(1, 1)) data[IDX(lx, g + 1, lz)] = B.LANTERN;
        if (fx === 2 && fz === 3) data[IDX(lx, g + 1, lz)] = ((b.x0 + b.z0) % 2 === 0) ? B.BENCH : B.RANGE;
        if (fx === 4 && fz === 1) data[IDX(lx, g + 1, lz)] = B.BOARD;
      } else if (b.type === 'museum') {
        if (fx === 1 && fz === 1 && !blocksThreshold(1, 1)) data[IDX(lx, g + 1, lz)] = B.LANTERN;
        if (fx === 3 && fz === 1 && !blocksThreshold(3, 1)) data[IDX(lx, g + 1, lz)] = B.LANTERN;
        if (fx === 5 && fz === 2) data[IDX(lx, g + 1, lz)] = B.BOARD;
        if (fx === 2 && fz === 4) data[IDX(lx, g + 1, lz)] = B.BOARD;
        if (fx === 6 && fz === 4) data[IDX(lx, g + 1, lz)] = B.BOARD;
      } else if (b.type === 'fishchip') {
        if (fx === 1 && fz === 1 && !blocksThreshold(1, 1)) data[IDX(lx, g + 1, lz)] = B.LANTERN;
        if (fx === 3 && fz === 2) data[IDX(lx, g + 1, lz)] = B.RANGE;
        if (fx === 5 && fz === 1 && !blocksThreshold(5, 1)) data[IDX(lx, g + 1, lz)] = B.BENCH;
      } else if (b.type === 'fossilshop') {
        if (fx === 1 && fz === 1 && !blocksThreshold(1, 1)) data[IDX(lx, g + 1, lz)] = B.LANTERN;
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

    // Real-Moors crosses: fixed at their true sites (data list), not the 96-grid —
    // adjacent crosses (Young Ralph + Fat Betty) share a cell, so iterate directly.
    if (geo.realWorld && geo.data && geo.data.landmarks) {
      for (const lm of geo.data.landmarks) {
        if (lm.kind !== 'cross') continue;
        if (lm.x < x0 - 2 || lm.x > x0 + CHUNK + 1 || lm.z < z0 - 2 || lm.z > z0 + CHUNK + 1) continue;
        const h = geo.height(lm.x, lm.z);
        const white = (lm.params && lm.params.white) || /Betty/.test(lm.name);
        const mat = white ? B.WOOL : B.STONE;
        put(lm.x, h + 1, lm.z, B.STONE);
        put(lm.x, h + 2, lm.z, B.STONE);
        put(lm.x, h + 3, lm.z, mat);
        put(lm.x + 1, h + 3, lm.z, mat);
        put(lm.x - 1, h + 3, lm.z, mat);
        put(lm.x, h + 4, lm.z, mat);
      }
    }

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
        // every wall stands on a made footing: stone filled frae t' slope up
        // to t' abbey floor, so nowt floats where t' cliff falls away
        const found = (x, z) => {
          for (let y = Math.max(1, geo.height(x, z)); y <= g; y++) put(x, y, z, B.STONEBRICK);
        };
        // nave: two long walls wi' arched gaps, crumbling toward t' west
        for (let dx = 0; dx < 20; dx++) {
          for (const dz of [0, 7]) {
            const x = ab.x + dx, z = ab.z + dz;
            found(x, z);
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
          found(ab.x + 19, ab.z + dz);
          for (let y = 1; y <= 8; y++) {
            const window = dz >= 2 && dz <= 5 && y >= 3 && y <= 6;
            if (!window) put(ab.x + 19, g + y, ab.z + dz, B.STONEBRICK);
          }
        }
        // scattered pillar stumps in t' nave
        for (let i = 0; i < 5; i++) {
          const px = ab.x + 2 + ((rng() * 16) | 0), pz = ab.z + 2 + ((rng() * 4) | 0);
          const ph = 1 + ((rng() * 3) | 0);
          found(px, pz);
          for (let y = 1; y <= ph; y++) put(px, g + y, pz, B.STONEBRICK);
        }
        // holy water font — a stone basin wi' a glimmer o' light
        const font = geo.abbeyFont();
        found(font.x, font.z);
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

  stampTree(data, lx, base, lz, th, fruit = false) {
    const canopy = fruit ? B.ORCHARD_LEAVES : B.LEAVES;
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
        put(lx + dx, base + th - 1 + dy, lz + dz, canopy, true);
      }
    }
    put(lx, base + th + 1, lz, canopy, true);
  }

  // a boulder/cluster/tor sat on t' ground at (lx,lz). Seeded frae t' world
  // co-ords so it stamps t' same frae whichever chunk catches it.
  stampBoulder(data, lx, base, lz, size, x, z) {
    const rng = mulberry32(((x * 73856093) ^ (z * 19349663) ^ this.seed) | 0);
    const put = (px, py, pz, id) => {
      if (px < 0 || px >= CHUNK || pz < 0 || pz >= CHUNK || py < 1 || py >= HEIGHT) return;
      const cur = data[IDX(px, py, pz)];
      // rest on t' surface — fill air or low plants, never gouge solid ground
      if (cur === B.AIR || (BLOCKS[cur] && BLOCKS[cur].kind === 'cutout')) data[IDX(px, py, pz)] = id;
    };
    if (size === 1) {
      put(lx, base + 1, lz, B.STONE);
      if (rng() < 0.4) put(lx, base + 2, lz, B.COBBLE);
    } else if (size === 2) {
      const ry = 1 + ((rng() * 2) | 0);
      for (let dy = 1; dy <= ry + 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
          const t = (dx * dx) / 1.3 + (dz * dz) / 1.3 + ((dy - 1) / (ry + 0.5)) ** 2;
          if (t < 1 && rng() < 0.85) put(lx + dx, base + dy, lz + dz, rng() < 0.5 ? B.STONE : B.COBBLE);
        }
      }
    } else {
      // a proper gritstone tor — stacked an' weathered, taperin' toward t' top
      const ry = 3 + ((rng() * 3) | 0);
      for (let dy = 1; dy <= ry; dy++) {
        const rad = 2 - (dy / ry) * 1.6;
        const r2 = (rad + 0.4) ** 2;
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
          if (dx * dx + dz * dz <= r2 && rng() < 0.9) {
            put(lx + dx, base + dy, lz + dz, (dy > ry - 2 && rng() < 0.5) ? B.COBBLE : B.STONE);
          }
        }
      }
      put(lx, base + ry + 1, lz, B.STONE); // a capstone
    }
  }

  // a monkey puzzle: a tall bare trunk wi' a narrow domed crown o' dark fronds
  stampMonkeyPuzzle(data, lx, base, lz, th) {
    const put = (px, py, pz, id, keep) => {
      if (px < 0 || px >= CHUNK || pz < 0 || pz >= CHUNK || py < 1 || py >= HEIGHT) return;
      const i = IDX(px, py, pz);
      if (keep && data[i] !== B.AIR) return;
      data[i] = id;
    };
    for (let y = 0; y < th; y++) put(lx, base + y, lz, B.LOG);
    const crownBase = base + Math.floor(th * 0.55);
    const crownTop = base + th + 1;
    for (let y = crownBase; y <= crownTop; y++) {
      const f = (y - crownBase) / Math.max(1, crownTop - crownBase);
      const rad = Math.round(2.2 * Math.sin(f * Math.PI) + 0.4); // bulges in t' middle, tapers each end
      const r2 = (rad + 0.3) ** 2;
      for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
        if (dx === 0 && dz === 0 && y < crownTop) continue; // keep t' trunk line
        if (dx * dx + dz * dz <= r2 && hash3i(lx + dx, y, lz + dz, this.seed ^ 0x70e7) < 0.82) {
          put(lx + dx, y, lz + dz, B.MONKEY_LEAVES, true);
        }
      }
    }
    put(lx, crownTop + 1, lz, B.MONKEY_LEAVES, true); // a pointed top
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
