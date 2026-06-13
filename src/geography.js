// The lie of t' land: a North York Moors-shaped world.
//
// A high heather plateau cut by dales, blanket bog on t' tops, and the North
// Sea away to t' east behind a line of cliffs. Fixed landmarks echo the real
// thing: Roseberry Topping, t' Hole of Horcum, the Wainstones, Rosedale
// ironstone kilns, Wade's Causeway, moor crosses, an abbey ruin on t' cliffs,
// and the village of Moorstead near where tha wakes up.
import { fbm2, hash2i, mulberry32 } from './noise.js';
import { HEIGHT, WATER_LEVEL } from './defs.js';

function smoothstep(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }
function lerp(a, b, t) { return a + (b - a) * t; }

// Fixed landmark coordinates (the map IS the place, whatever the seed).
export const ROSEBERRY = { x: -700, z: -880, r: 32 };
export const HORCUM = { x: 540, z: 680, r: 48 };
export const WAINSTONES = { x: -380, z: -620, r: 11 };
export const KILNS = { x: -260, z: 380, r: 0 };
export const ROAD_X = 60; // Wade's Causey runs north from t' village fields
export const ABBEY_Z = -60;
// Where Count Dracula walks t' open moor at neet (quest boss arena)
export const DRACULA_MOOR = { x: 140, z: -180, r: 28 };

const DALE_NAMES = ['Rosedale', 'Farndale', 'Bransdale', 'Bilsdale', 'Glaisdale', 'Fryupdale', 'Danby Dale', 'Baysdale'];
const MOOR_NAMES = ['Danby High Moor', 'Westerdale Moor', 'Spaunton Moor', 'Egton High Moor', 'Goathland Moor', 'Urra Moor'];

export class Geography {
  constructor(seed) {
    this.seed = seed | 0;
    this.colCache = new Map();
    this.villages = this.buildVillages();
    this.village = this.villages[0]; // Moorstead: home, quests, croft
  }

  // ---------- raw fields ----------
  bogginess(x, z) {
    return fbm2(x * 0.007 + 503.7, z * 0.007 + 211.3, 3, this.seed ^ 0xb09);
  }

  heatheriness(x, z) {
    return fbm2(x * 0.012 + 91.2, z * 0.012 + 37.8, 2, this.seed ^ 0x4ea);
  }

  // 0..1, 1 = dale floor. Valleys carve along the zero-contours of a slow field.
  daleness(x, z) {
    const dn = fbm2(x * 0.0036 + 811.1, z * 0.0036 + 413.9, 3, this.seed ^ 0xda1e);
    return Math.max(0, 1 - Math.abs(dn) * 3.4);
  }

  coastX(z) {
    // Robin Hood's Bay: t' coastline bites inland in a sweeping bay
    const bay = Math.exp(-(((z - 340) / 130) ** 2)) * -70;
    return 900 + bay + fbm2(z * 0.004, 7.7, 2, this.seed ^ 0xc0a57) * 45;
  }

  // 0 inland .. 1 open sea — a broad transition, for proper wide sands
  coastT(x, z) {
    const cx = this.coastX(z);
    return smoothstep((x - (cx - 6)) / 64);
  }

  // ---------- height ----------
  // Terrain before village flattening (used to pick the village site).
  heightRaw(x, z) {
    // high moor plateau wi' gentle swell
    let h = 37 + fbm2(x * 0.0045, z * 0.0045, 4, this.seed) * 4.5;
    // dales bite into t' plateau
    const dale = this.daleness(x, z);
    h -= dale * dale * 12;
    // local roughness
    h += fbm2(x * 0.03 + 99.3, z * 0.03 + 17.1, 3, this.seed ^ 0x517) * 2.5;
    // blanket bog dishes flat on t' tops
    const bog = this.bogginess(x, z);
    if (bog > 0.45 && h > 33) h = lerp(h, 34.2, Math.min(1, (bog - 0.45) * 5));

    // Roseberry Topping: t' lonely cone wi' a craggy top
    {
      const dx = x - ROSEBERRY.x, dz = z - ROSEBERRY.z;
      const r = Math.hypot(dx, dz);
      if (r < ROSEBERRY.r) {
        const cone = 56 - (r / ROSEBERRY.r) * 24 + fbm2(x * 0.08, z * 0.08, 2, this.seed ^ 0x405e) * 1.5;
        // the famous crooked summit: a wee step on t' south-west face
        const step = (r < 7 && dx < 0) ? 2 : 0;
        h = Math.max(h, cone + step);
      }
    }
    // T' Hole of Horcum: a giant bowl scooped out o' t' moor
    {
      const r = Math.hypot(x - HORCUM.x, z - HORCUM.z);
      if (r < HORCUM.r) {
        const bowl = 28 + Math.pow(r / HORCUM.r, 1.6) * 11;
        h = Math.min(h, bowl);
      } else if (r < HORCUM.r + 7) {
        h += (1 - (r - HORCUM.r) / 7) * 2.5; // raised rim
      }
    }
    // T' coast: cliffs, then a proper beach shelf, then t' North Sea
    {
      const t = this.coastT(x, z);
      if (t > 0) {
        if (t < 0.4) {
          h = lerp(h, 25.3, smoothstep(t / 0.4)); // cliff face down to t' sands
        } else {
          const sea = 17 + fbm2(x * 0.02, z * 0.02, 2, this.seed ^ 0x5ea) * 1.5;
          h = lerp(25.3, sea, Math.pow((t - 0.4) / 0.6, 2.2)); // long gentle scaur, wide flats
        }
      }
    }
    return Math.max(5, Math.min(HEIGHT - 6, h));
  }

  height(x, z) {
    const key = x + ',' + z;
    const c = this.colCache.get(key);
    if (c !== undefined) return c;
    let h = this.heightRaw(x, z);
    // flatten under each village
    for (const v of this.villages) {
      const d = Math.hypot(x - v.x, z - v.z);
      if (d < v.radius) {
        const t = 1 - smoothstep((d - (v.radius - 18)) / 18);
        h = lerp(h, v.ground, t);
        break;
      }
    }
    h = Math.floor(h);
    if (this.colCache.size > 80000) this.colCache.clear();
    this.colCache.set(key, h);
    return h;
  }

  // ---------- villages ----------
  // Moorstead (home, full quest life) plus settlements echoing real North
  // York Moors villages — an' Pickering, t' capital, minster an' all.
  buildVillages() {
    const vs = [this.layoutVillage()]; // Moorstead, sited by search
    const mk = (vx, vz, dx, dz, w, d, wallH, type) => ({
      x0: vx + dx, z0: vz + dz, x1: vx + dx + w - 1, z1: vz + dz + d - 1, wallH, type,
    });

    // Goathland: cottages strung along a long green, up t' moor SW o' Whitby
    // (NE quarter o' t' map, like t' real un — t' railway calls here)
    {
      const s = this.drySpot(460, -60, 29);
      const x = s.x, z = s.z, g = Math.max(Math.floor(this.heightRaw(x, z)), WATER_LEVEL + 2);
      vs.push({
        x, z, ground: g, name: 'Goathland', radius: 40, style: 'longgreen',
        buildings: [
          mk(x, z, -22, -10, 7, 6, 3, 'cottage'), mk(x, z, -8, -12, 7, 6, 3, 'cottage'),
          mk(x, z, 6, -10, 8, 6, 3, 'cottage'), mk(x, z, -16, 8, 7, 6, 3, 'cottage'),
          mk(x, z, 2, 9, 7, 6, 3, 'cottage'), mk(x, z, 16, 6, 6, 6, 3, 'barn'),
        ],
      });
    }
    // Rosedale Abbey: by t' kilns, wi' its own ruined arch
    {
      const s = this.drySpot(KILNS.x + 34, KILNS.z + 26, 29);
      const x = s.x, z = s.z, g = Math.max(Math.floor(this.heightRaw(x, z)), WATER_LEVEL + 2);
      vs.push({
        x, z, ground: g, name: 'Rosedale Abbey', radius: 36, style: 'green',
        buildings: [
          mk(x, z, -16, -12, 7, 6, 3, 'cottage'), mk(x, z, 8, -12, 7, 6, 3, 'cottage'),
          mk(x, z, -14, 8, 7, 6, 3, 'cottage'), mk(x, z, 8, 8, 8, 7, 3, 'cottage'),
          mk(x, z, 18, -4, 5, 9, 5, 'ruin'),
        ],
      });
    }
    // Staithes: a tight fishing huddle up on t' cliff top
    {
      const s = this.drySpot(Math.floor(this.coastX(140)) - 26, 140, 29);
      const x = s.x, z = s.z, g = Math.max(Math.floor(this.heightRaw(x, z)), WATER_LEVEL + 2);
      vs.push({
        x, z, ground: g, name: 'Staithes', radius: 30, style: 'cluster',
        buildings: [
          mk(x, z, -12, -8, 6, 5, 3, 'cottage'), mk(x, z, -4, -10, 6, 5, 3, 'cottage'),
          mk(x, z, 4, -7, 6, 5, 3, 'cottage'), mk(x, z, -9, 0, 6, 5, 3, 'cottage'),
          mk(x, z, 0, 2, 7, 5, 3, 'cottage'), mk(x, z, 9, -1, 5, 5, 3, 'cottage'),
        ],
      });
    }
    // Pickering: t' capital — market square, shops, an' a proper minster.
    // Sits at t' SOUTH foot o' t' moors below t' Hole of Horcum, like t' real
    // town: t' railway sets off north frae here.
    {
      const s = this.drySpot(540, 860, 29);
      const x = s.x, z = s.z, g = Math.max(Math.floor(this.heightRaw(x, z)), WATER_LEVEL + 2);
      vs.push({
        x, z, ground: g, name: 'Pickering', radius: 56, style: 'capital',
        buildings: [
          mk(x, z, -8, -34, 13, 24, 5, 'minster'),
          mk(x, z, -20, -4, 7, 6, 3, 'shop'), mk(x, z, -20, 6, 7, 6, 3, 'shop'),
          mk(x, z, 14, -4, 7, 6, 3, 'shop'), mk(x, z, 14, 6, 7, 6, 3, 'shop'),
          mk(x, z, -8, 14, 8, 6, 3, 'shop'), mk(x, z, 3, 14, 8, 6, 3, 'cottage'),
          mk(x, z, -22, -16, 8, 7, 3, 'cottage'), mk(x, z, 15, -16, 8, 7, 3, 'cottage'),
        ],
      });
    }
    // Grosmont: t' engine-shed hamlet in t' Esk valley, last stop afore Whitby
    {
      const s = this.drySpot(640, -104, 29);
      const x = s.x, z = s.z, g = Math.max(Math.floor(this.heightRaw(x, z)), WATER_LEVEL + 2);
      vs.push({
        x, z, ground: g, name: 'Grosmont', radius: 26, style: 'cluster',
        buildings: [
          mk(x, z, -10, -8, 6, 5, 3, 'cottage'), mk(x, z, -2, -10, 6, 5, 3, 'cottage'),
          mk(x, z, 6, -7, 6, 5, 3, 'cottage'),
          mk(x, z, -4, 0, 8, 6, 4, 'barn'), // t' engine shed
        ],
      });
    }
    // Whitby: fishing town below t' abbey cliffs — museum, chippy, fossil shop
    {
      const ab = this.abbeySite();
      // Whitby stays down by t' sea, but stands on a dry terrace behind a
      // sea wall — t' town were drowning whole on some seeds
      const x = ab.x + 48, z = ab.z + 62;
      const g = Math.max(Math.floor(this.heightRaw(x, z)), WATER_LEVEL + 2);
      vs.push({
        x, z, ground: g, name: 'Whitby', radius: 44, style: 'cluster',
        buildings: [
          mk(x, z, -14, -10, 9, 7, 4, 'museum'),
          mk(x, z, 2, -10, 7, 6, 3, 'fishchip'),
          mk(x, z, 10, -8, 7, 6, 3, 'fossilshop'),
          mk(x, z, -10, 2, 6, 5, 3, 'cottage'), mk(x, z, -2, 2, 6, 5, 3, 'cottage'),
          mk(x, z, 6, 3, 6, 5, 3, 'cottage'), mk(x, z, 14, 1, 5, 5, 3, 'cottage'),
        ],
      });
    }
    return vs;
  }

  layoutVillage() {
    // deterministic hunt for a flattish, dry, un-daled spot near t' origin
    let best = { x: 0, z: 0 };
    outer:
    for (let r = 30; r <= 200; r += 10) {
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        const x = Math.round(Math.cos(ang) * r), z = Math.round(Math.sin(ang) * r);
        const h = this.heightRaw(x, z);
        if (h >= 29 && h <= 36 && this.bogginess(x, z) < 0.3 && this.daleness(x, z) < 0.5 && this.coastT(x, z) === 0) {
          best = { x, z };
          break outer;
        }
      }
    }
    const ground = Math.max(Math.floor(this.heightRaw(best.x, best.z)), WATER_LEVEL + 2);
    const rng = mulberry32(this.seed ^ 0x71c);
    const mk = (dx, dz, w, d, wallH, type) => ({
      x0: best.x + dx, z0: best.z + dz,
      x1: best.x + dx + w - 1, z1: best.z + dz + d - 1,
      wallH, type,
    });
    const buildings = [
      mk(10, -16, 9, 7, 3, 'pub'),       // T' Black Sheep
      mk(-26, -4, 7, 12, 4, 'chapel'),
      mk(-18, -16, 7, 6, 3, 'cottage'),  // Granny Glinda's
      mk(14, 8, 7, 6, 3, 'cottage'),
      mk(-16, 14, 6, 6, 3, 'cottage'),
      mk(-4, 14, 8, 6, 3, 'cottage'),
      mk(8, 22, 11, 7, 3, 'farm'),       // Beck Farm
      mk(24, 12, 7, 9, 3, 'barn'),
    ];
    // t' owd croft: an empty plot at t' south-west corner, granted to t' newcomer
    const plot = { x0: best.x - 32, z0: best.z + 16, x1: best.x - 21, z1: best.z + 26 };
    return { x: best.x, z: best.z, ground, buildings, plot, name: 'Moorstead', radius: 52, style: 'green', rng };
  }

  inVillage(x, z, pad = 0) {
    for (const v of this.villages || []) {
      if (Math.hypot(x - v.x, z - v.z) < v.radius + pad) return true;
    }
    return false;
  }

  villageAt(x, z) {
    for (const v of this.villages || []) {
      if (Math.abs(x - v.x) <= v.radius && Math.abs(z - v.z) <= v.radius) return v;
    }
    return null;
  }

  // What does a village put in this column? null | {kind, b, v}
  villageColumn(x, z) {
    const v = this.villageAt(x, z);
    if (!v) return null;
    const dx = x - v.x, dz = z - v.z;
    for (const b of v.buildings) {
      if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return { kind: 'building', b, v };
    }
    if (v.plot && x >= v.plot.x0 && x <= v.plot.x1 && z >= v.plot.z0 && z <= v.plot.z1) return { kind: 'plot', v };
    if (v.style === 'capital') {
      // market square an' lanes
      if (Math.abs(dx) <= 10 && Math.abs(dz) <= 7) return { kind: 'path', v };
      if ((Math.abs(dx) <= 1 || Math.abs(dz) <= 1) && Math.hypot(dx, dz) < v.radius - 8) return { kind: 'path', v };
    } else if (v.style === 'longgreen') {
      if (Math.abs(dx) <= 14 && Math.abs(dz) <= 4) return { kind: 'green', v };
      if (Math.abs(dz) > 4 && Math.abs(dz) <= 6 && Math.abs(dx) <= 16) return { kind: 'path', v };
    } else if (v.style === 'cluster') {
      if ((Math.abs(dx) <= 1 || Math.abs(dz) <= 1) && Math.hypot(dx, dz) < v.radius - 6) return { kind: 'path', v };
    } else { // 'green' (Moorstead, Rosedale Abbey)
      const ell = (dx / 11) ** 2 + (dz / 9) ** 2;
      if (ell < 1) return { kind: 'green', v };
      if (Math.abs(ell - 1.18) < 0.22) return { kind: 'path', v };
      if ((Math.abs(dx) <= 1 || Math.abs(dz) <= 1) && Math.hypot(dx, dz) < v.radius - 12) return { kind: 'path', v };
    }
    return { kind: 'closes', v };
  }

  // Where t' villagers stand of a morning (homes keyed by name fragment).
  npcSpot(name, v = this.village) {
    const n = (name || '').toLowerCase();
    if (v === this.village) {
      const spots = {
        james: [v.x + 13, v.z + 20],   // Beck Farm door
        harry: [v.x + 16, v.z + 19],
        karen: [v.x + 10, v.z + 19],
        max: [v.x + 14, v.z + 18],
        cc: [v.x + 2, v.z + 3],        // on t' green
        glinda: [v.x - 14, v.z - 8],   // cottage door on t' green
      };
      for (const k of Object.keys(spots)) if (n.includes(k)) return spots[k];
    }
    // owt else stands about t' green o' their own village
    const r = mulberry32(this.seed ^ (n.length * 977 + (v.x * 31 + v.z * 7 | 0)))();
    return [v.x + Math.round((r - 0.5) * 14), v.z + Math.round((r * 7919 % 1 - 0.5) * 10)];
  }

  // A villager's house in their village: deterministic building pick, wi'
  // t' door an' a spot just inside (doors face south; barns face north).
  npcHome(name, v = this.village) {
    const liveable = (v.buildings || []).filter(b => b.type !== 'ruin');
    if (!liveable.length) return null;
    const n = (name || '').toLowerCase();
    let h = 0;
    for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
    const b = liveable[h % liveable.length];
    const midX = Math.floor((b.x0 + b.x1) / 2);
    const barn = b.type === 'barn';
    return {
      b,
      out: { x: midX + 0.5, z: barn ? b.z1 + 1.7 : b.z0 - 1.7 },   // afore t' door
      inside: { x: midX + 0.5, z: barn ? b.z1 - 1.3 : b.z0 + 2.3 }, // ower t' threshold
    };
  }

  // ---------- t' railway ----------
  // T' Moors Railway, shaped like t' real NYMR: Pickering at t' south end,
  // climbing north past t' Hole of Horcum (Levisham halt on its western
  // shoulder), a lonely moor-top call at Moorstead (playing Newton Dale),
  // then Goathland, Grosmont, an' into Whitby by t' sea.
  // (Rosedale's ironstone line were its own affair — ask Harry at t' kilns.
  // Staithes is its own coastal town; tha walks t' cliff path for that one.)
  // nearest dry, inland, un-built-on spot to (x0,z0) — deterministic spiral,
  // so open-country halts never end up in a beck or on t' sands
  drySpot(x0, z0, minH = WATER_LEVEL + 1) {
    for (let r = 0; r <= 96; r += 6) {
      for (let a = 0; a < (r ? 8 : 1); a++) {
        const ang = (a / 8) * Math.PI * 2;
        const x = Math.round(x0 + Math.cos(ang) * r), z = Math.round(z0 + Math.sin(ang) * r);
        if (this.coastT(x, z) > 0) continue;
        if (this.heightRaw(x, z) < minH) continue;
        if (this.daleness(x, z) > 0.6 && this.heightRaw(x, z) <= minH + 1) continue;
        const vc = this.villageColumn(x, z);
        if (vc && vc.kind === 'building') continue;
        return { x, z };
      }
    }
    return { x: Math.round(x0), z: Math.round(z0) };
  }

  railway() {
    if (this._rail) return this._rail;
    const vs = this.villages;
    const v = n => vs.find(x => x.name === n);
    const lev = this.drySpot(HORCUM.x - 45, HORCUM.z - 45);
    const ms = this.drySpot(v('Moorstead').x + 28, v('Moorstead').z + 50, 28);
    // Whitby station hunts dry ground frae t' coast at its OWN z, so it never
    // ends up on t' sands (or in a dale mouth) whatever t' seed says
    const wz = ABBEY_Z + 26;
    const wb = this.drySpot(Math.floor(this.coastX(wz)) - 44, wz);
    const stations = [
      { name: 'Pickering', x: v('Pickering').x - 20, z: v('Pickering').z - 30 },
      { name: 'Levisham', x: lev.x, z: lev.z },
      // t' village halt stands a step out on t' moor (like t' real Levisham!)
      // so t' line can curve past wi'out clipping owt on t' green
      { name: 'Moorstead', x: ms.x, z: ms.z },
      { name: 'Goathland', x: v('Goathland').x + 24, z: v('Goathland').z + 20 },
      { name: 'Grosmont', x: v('Grosmont').x, z: v('Grosmont').z + 24 },
      { name: 'Whitby', x: wb.x, z: wb.z },
    ];
    this._rail = stations;
    return stations;
  }

  nearStation(x, z, r = 8) {
    return this.railway().find(s => Math.hypot(s.x - x, s.z - z) < r) || null;
  }

  // ---------- t' permanent way ----------
  // T' line is a proper engineered alignment, not dot-to-dot: a Catmull-Rom
  // spline swept through t' stations, sampled every couple o' blocks, wi' a
  // smoothed vertical profile (gradients clamped to ~1-in-8) that cuts
  // through t' rises an' rides embankments ower t' dips — cuttings,
  // causeways an' all. Deterministic frae t' seed, same for every player.
  railPath() {
    if (this._path) return this._path;
    const st = this.railway();
    // Control points: every station gets a STRAIGHT run through t' platform
    // (controls planted ±22 blocks along t' angle bisector), so curves sweep
    // out in open country between stops — not through folk's farmyards.
    const unit = (ax, az) => { const L = Math.hypot(ax, az) || 1; return { x: ax / L, z: az / L }; };
    // (plat-tagged controls form t' dead-straight platform runs; their
    // segments are lerped, not splined — uniform Catmull-Rom overshoots
    // where a 22-block hop neighbours a 700-block leg)
    const ctrl = [];
    for (let i = 0; i < st.length; i++) {
      if (i === 0) {
        const w = unit(st[1].x - st[0].x, st[1].z - st[0].z);
        ctrl.push({ x: st[0].x, z: st[0].z, station: 0, plat: true });
        ctrl.push({ x: st[0].x + w.x * 22, z: st[0].z + w.z * 22, plat: true });
      } else if (i === st.length - 1) {
        const u = unit(st[i].x - st[i - 1].x, st[i].z - st[i - 1].z);
        ctrl.push({ x: st[i].x - u.x * 22, z: st[i].z - u.z * 22, plat: true });
        ctrl.push({ x: st[i].x, z: st[i].z, station: i, plat: true });
      } else {
        const u = unit(st[i].x - st[i - 1].x, st[i].z - st[i - 1].z);
        const w = unit(st[i + 1].x - st[i].x, st[i + 1].z - st[i].z);
        const m = unit(u.x + w.x, u.z + w.z);
        ctrl.push({ x: st[i].x - m.x * 22, z: st[i].z - m.z * 22, plat: true });
        ctrl.push({ x: st[i].x, z: st[i].z, station: i, plat: true });
        ctrl.push({ x: st[i].x + m.x * 22, z: st[i].z + m.z * 22, plat: true });
      }
    }
    // village avoidance: where a leg would pass through a settlement, plant a
    // via point pushed out past its boundary — t' line curves round, not through
    const vias = [];
    for (let i = 0; i < ctrl.length - 1; i++) {
      vias.push(ctrl[i]);
      const a = ctrl[i], b = ctrl[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const L2 = dx * dx + dz * dz;
      if (L2 < 900) continue; // short hops (station triplets) handled below
      let push = null;
      for (const vv of this.villages) {
        const t = Math.max(0, Math.min(1, ((vv.x - a.x) * dx + (vv.z - a.z) * dz) / L2));
        const cx = a.x + dx * t, cz = a.z + dz * t;
        const d = Math.hypot(cx - vv.x, cz - vv.z);
        if (d < vv.radius + 14 && t > 0.05 && t < 0.95) {
          const out = unit(cx - vv.x || 1, cz - vv.z || 0);
          const r = vv.radius + 20;
          push = { x: vv.x + out.x * r, z: vv.z + out.z * r };
          break;
        }
      }
      if (push) vias.push(push);
    }
    vias.push(ctrl[ctrl.length - 1]);
    // an' no plain control may stand inside a village either — t' spline
    // hugs its controls, so shove strays out past t' boundary
    for (const c of vias) {
      if (c.station !== undefined) continue;
      for (const vv of this.villages) {
        const d = Math.hypot(c.x - vv.x, c.z - vv.z);
        if (d < vv.radius + 8) {
          const out = unit(c.x - vv.x || 1, c.z - vv.z || 0);
          c.x = vv.x + out.x * (vv.radius + 14);
          c.z = vv.z + out.z * (vv.radius + 14);
        }
      }
    }
    const route = vias;
    // phantom ends mirror t' first an' last hops
    const P = [
      { x: 2 * route[0].x - route[1].x, z: 2 * route[0].z - route[1].z },
      ...route,
      { x: 2 * route[route.length - 1].x - route[route.length - 2].x, z: 2 * route[route.length - 1].z - route[route.length - 2].z },
    ];
    const pts = [];                      // {x, z, s}
    const stationS = new Array(st.length).fill(0);
    const stationIdx = new Array(st.length).fill(0);
    let s = 0, px = route[0].x, pz = route[0].z;
    pts.push({ x: px, z: pz, s: 0 });
    for (let i = 1; i < P.length - 2; i++) {
      const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
      const approx = Math.hypot(p2.x - p1.x, p2.z - p1.z);
      const n = Math.max(4, Math.ceil(approx / 2));
      const straight = p1.plat && p2.plat; // platform runs stay dead straight
      for (let k = 1; k <= n; k++) {
        const t = k / n, t2 = t * t, t3 = t2 * t;
        const cr = (a, b, c, d) =>
          0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        const x = straight ? p1.x + (p2.x - p1.x) * t : cr(p0.x, p1.x, p2.x, p3.x);
        const z = straight ? p1.z + (p2.z - p1.z) * t : cr(p0.z, p1.z, p2.z, p3.z);
        s += Math.hypot(x - px, z - pz);
        pts.push({ x, z, s });
        px = x; pz = z;
      }
      if (P[i + 1].station !== undefined) {
        stationS[P[i + 1].station] = s;
        stationIdx[P[i + 1].station] = pts.length - 1;
      }
    }

    // precision pass: t' line may cross a green or a close, but never a
    // building. Shove offending samples out o' (expanded) building boxes,
    // smooth t' kinks, re-measure t' chainage. Stations stay pinned.
    const pinned = new Array(pts.length).fill(false);
    for (const si of stationIdx) {
      for (let i = Math.max(0, si - 8); i <= Math.min(pts.length - 1, si + 8); i++) pinned[i] = true;
    }
    for (let pass = 0; pass < 5; pass++) {
      let moved = false;
      for (const p of pts) {
        for (const vv of this.villages) {
          if (Math.abs(p.x - vv.x) > vv.radius + 8 || Math.abs(p.z - vv.z) > vv.radius + 8) continue;
          for (const b of vv.buildings) {
            const ex0 = b.x0 - 2.6, ex1 = b.x1 + 2.6, ez0 = b.z0 - 2.6, ez1 = b.z1 + 2.6;
            if (p.x > ex0 && p.x < ex1 && p.z > ez0 && p.z < ez1) {
              const dl = p.x - ex0, dr = ex1 - p.x, du = p.z - ez0, dd = ez1 - p.z;
              const m = Math.min(dl, dr, du, dd);
              if (m === dl) p.x = ex0; else if (m === dr) p.x = ex1;
              else if (m === du) p.z = ez0; else p.z = ez1;
              moved = true;
            }
          }
        }
      }
      if (!moved) break;
      // light positional smoothing to round t' shoves off (pins held)
      for (let r = 0; r < 2; r++) {
        for (let i = 1; i < pts.length - 1; i++) {
          if (pinned[i]) continue;
          pts[i].x = (pts[i - 1].x + pts[i].x * 2 + pts[i + 1].x) / 4;
          pts[i].z = (pts[i - 1].z + pts[i].z * 2 + pts[i + 1].z) / 4;
        }
      }
    }
    // strike any kinks t' shoving left behind: a near-duplicate sample or one
    // that doubles back would spin t' train clean round — midpoint 'em out
    // (positions only, indices stay put so t' station pins hold)
    for (let pass = 0; pass < 6; pass++) {
      let mended = 0;
      for (let i = 1; i < pts.length - 1; i++) {
        const a = pts[i - 1], b = pts[i], c = pts[i + 1];
        const abx = b.x - a.x, abz = b.z - a.z, bcx = c.x - b.x, bcz = c.z - b.z;
        if (Math.hypot(abx, abz) < 0.4 || (abx * bcx + abz * bcz) < 0) {
          b.x = (a.x + c.x) / 2;
          b.z = (a.z + c.z) / 2;
          mended++;
        }
      }
      if (!mended) break;
    }
    // re-measure chainage after t' shoving
    pts[0].s = 0;
    for (let i = 1; i < pts.length; i++) {
      pts[i].s = pts[i - 1].s + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    }
    for (let si = 0; si < stationIdx.length; si++) stationS[si] = pts[stationIdx[si]].s;

    // vertical profile: terrain under t' line, smoothed twice...
    const deck = pts.map(p => Math.max(this.height(Math.round(p.x), Math.round(p.z)), WATER_LEVEL + 1));
    for (let pass = 0; pass < 2; pass++) {
      const w = 20, sm = deck.slice();
      for (let i = 0; i < deck.length; i++) {
        let acc = 0, cnt = 0;
        for (let j = Math.max(0, i - w); j <= Math.min(deck.length - 1, i + w); j++) { acc += deck[j]; cnt++; }
        sm[i] = acc / cnt;
      }
      for (let i = 0; i < deck.length; i++) deck[i] = sm[i];
    }
    // ...gradient-clamped to 1-in-8, forward an' back...
    const maxg = 0.125;
    for (let i = 1; i < deck.length; i++) {
      const ds = pts[i].s - pts[i - 1].s;
      deck[i] = Math.min(deck[i], deck[i - 1] + maxg * ds);
      deck[i] = Math.max(deck[i], deck[i - 1] - maxg * ds);
    }
    for (let i = deck.length - 2; i >= 0; i--) {
      const ds = pts[i + 1].s - pts[i].s;
      deck[i] = Math.min(deck[i], deck[i + 1] + maxg * ds);
      deck[i] = Math.max(deck[i], deck[i + 1] - maxg * ds);
    }
    // ...then platforms forced dead level wi' their station ground, an' a
    // final clamp anchored AT t' stations so t' approaches stay railway-gentle
    const fixed = new Array(deck.length).fill(false);
    for (let si = 0; si < st.length; si++) {
      const g = this.height(st[si].x, st[si].z);
      for (let i = 0; i < pts.length; i++) {
        const ds = Math.abs(pts[i].s - stationS[si]);
        if (ds < 52) {
          const k = ds < 12 ? 1 : 1 - (ds - 12) / 40;
          deck[i] += (g - deck[i]) * k;
          if (ds < 12) fixed[i] = true;
        }
      }
    }
    for (let i = 1; i < deck.length; i++) {
      if (fixed[i]) continue;
      const ds = pts[i].s - pts[i - 1].s;
      deck[i] = Math.min(deck[i], deck[i - 1] + maxg * ds);
      deck[i] = Math.max(deck[i], deck[i - 1] - maxg * ds);
    }
    for (let i = deck.length - 2; i >= 0; i--) {
      if (fixed[i]) continue;
      const ds = pts[i + 1].s - pts[i].s;
      deck[i] = Math.min(deck[i], deck[i + 1] + maxg * ds);
      deck[i] = Math.max(deck[i], deck[i + 1] - maxg * ds);
    }
    for (let i = 0; i < deck.length; i++) deck[i] = Math.max(deck[i], WATER_LEVEL + 1);
    for (let i = 0; i < pts.length; i++) pts[i].deck = deck[i];

    // spatial index: 8-block cells -> sample indices (for fast per-column lookup)
    const cells = new Map();
    for (let i = 0; i < pts.length; i++) {
      const k = `${Math.floor(pts[i].x / 8)},${Math.floor(pts[i].z / 8)}`;
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(i);
    }
    this._path = { pts, cells, length: s, stationS };
    return this._path;
  }

  // position, heading an' deck height at chainage s along t' line
  samplePos(s) {
    const path = this.railPath();
    const pts = path.pts;
    s = Math.max(0, Math.min(path.length, s));
    // binary search for t' sample pair straddling s
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].s <= s) lo = mid; else hi = mid;
    }
    const a = pts[lo], b = pts[hi];
    const ds = Math.max(b.s - a.s, 0.001);
    const t = (s - a.s) / ds;
    return {
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
      deck: a.deck + (b.deck - a.deck) * t,
      tx: (b.x - a.x) / ds, tz: (b.z - a.z) / ds,
      grade: (b.deck - a.deck) / ds,
    };
  }

  // Nearest point on t' line: {d, along, deck} | null (within ~2.6 blocks)
  railInfo(x, z) {
    const path = this.railPath();
    let best = null;
    const cx = Math.floor(x / 8), cz = Math.floor(z / 8);
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gz = cz - 1; gz <= cz + 1; gz++) {
        const idxs = path.cells.get(`${gx},${gz}`);
        if (!idxs) continue;
        for (const i of idxs) {
          const a = path.pts[i], b = path.pts[Math.min(i + 1, path.pts.length - 1)];
          const dx = b.x - a.x, dz = b.z - a.z;
          const L2 = dx * dx + dz * dz || 0.001;
          let t = ((x - a.x) * dx + (z - a.z) * dz) / L2;
          t = Math.max(0, Math.min(1, t));
          const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
          // report out to t' lineside verge (banks an' cuttin' tops); every
          // consumer gates on its own smaller distance, so this only widens reach
          if (d < 6 && (!best || d < best.d)) {
            best = { d, along: a.s + Math.sqrt(L2) * t, deck: a.deck + (b.deck - a.deck) * t };
          }
        }
      }
    }
    return best;
  }

  // ---------- waymarks ----------
  // Moor crosses on a loose 96-grid across t' high moor (Fat Betty's t' white un).
  crossAt(cellX, cellZ) {
    const h1 = hash2i(cellX, cellZ, this.seed ^ 0xc905);
    if (h1 < 0.45) return null; // not every cell has one
    const x = cellX * 96 + 16 + Math.floor(hash2i(cellX, cellZ, this.seed ^ 0xc906) * 64);
    const z = cellZ * 96 + 16 + Math.floor(hash2i(cellX, cellZ, this.seed ^ 0xc907) * 64);
    const h = this.heightRaw(x, z);
    if (h < 34 || this.bogginess(x, z) > 0.5 || this.coastT(x, z) > 0) return null;
    if (this.inVillage(x, z, 10)) return null;
    return { x, z, fatBetty: hash2i(cellX, cellZ, this.seed ^ 0xc908) < 0.3 };
  }

  // Wade's Causey: t' owd Roman road, running north across t' moor.
  onRoad(x, z) {
    if (z < -420 || z > 60) return false;
    const wob = Math.round(fbm2(z * 0.01, 3.3, 2, this.seed ^ 0x60ad) * 2);
    if (Math.abs(x - (ROAD_X + wob)) > 1) return false;
    // broken stretches, swallowed by t' moor
    if (hash2i(Math.floor(z / 6), 0, this.seed ^ 0x60ae) < 0.22) return false;
    return true;
  }

  abbeySite() {
    const ax = Math.floor(this.coastX(ABBEY_Z)) - 34;
    return { x: ax, z: ABBEY_Z };
  }

  // Holy water font in t' abbey nave (east end, south wall)
  abbeyFont() {
    const ab = this.abbeySite();
    return { x: ab.x + 12, z: ab.z + 3 };
  }

  // T' Dracula Museum in Whitby
  museumSite() {
    const w = this.villages.find(v => v.name === 'Whitby');
    if (!w) return { x: 0, z: 0 };
    const b = w.buildings.find(bb => bb.type === 'museum');
    return { x: Math.floor((b.x0 + b.x1) / 2), z: Math.floor((b.z0 + b.z1) / 2) };
  }

  // Whitby pier head, sticking out into t' sea
  pierHead() {
    const w = this.villages.find(v => v.name === 'Whitby');
    if (!w) return { x: 0, z: 0 };
    const cx = Math.floor(this.coastX(w.z + 18));
    return { x: cx + 8, z: w.z + 22 };
  }

  inWhitby(x, z, pad = 0) {
    const w = this.villages.find(v => v.name === 'Whitby');
    return w && Math.hypot(x - w.x, z - w.z) < w.radius + pad;
  }

  isMuseumBoard(x, z) {
    const w = this.villages.find(v => v.name === 'Whitby');
    if (!w) return false;
    const b = w.buildings.find(bb => bb.type === 'museum');
    if (!b) return false;
    return x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1;
  }

  // Moor shelters on a loose 144-grid: stone huts wi' a lantern, for benighted
  // travellers (like t' real shooting huts an' bields on t' tops).
  shelterAt(cellX, cellZ) {
    if (hash2i(cellX, cellZ, this.seed ^ 0x5e17) < 0.45) return null;
    const x = cellX * 144 + 24 + Math.floor(hash2i(cellX, cellZ, this.seed ^ 0x5e18) * 96);
    const z = cellZ * 144 + 24 + Math.floor(hash2i(cellX, cellZ, this.seed ^ 0x5e19) * 96);
    const h = this.heightRaw(x, z);
    if (h <= WATER_LEVEL + 2 || this.coastT(x, z) > 0) return null;
    if (this.bogginess(x, z) > 0.55) return null;
    if (this.inVillage(x, z, 30)) return null;
    if (Math.hypot(x - ROSEBERRY.x, z - ROSEBERRY.z) < 50) return null;
    if (Math.hypot(x - HORCUM.x, z - HORCUM.z) < HORCUM.r + 12) return null;
    return { x, z };
  }

  // nearest shelter to a point (scans t' surrounding grid cells)
  nearestShelter(px, pz) {
    let best = null, bestD = Infinity;
    const cx = Math.floor(px / 144), cz = Math.floor(pz / 144);
    for (let gx = cx - 3; gx <= cx + 3; gx++) {
      for (let gz = cz - 3; gz <= cz + 3; gz++) {
        const s = this.shelterAt(gx, gz);
        if (!s) continue;
        const d = Math.hypot(s.x - px, s.z - pz);
        if (d < bestD) { bestD = d; best = s; }
      }
    }
    return best ? { ...best, dist: bestD } : null;
  }

  // standalone waymark signposts on a 96-grid along t' open moor
  signAt(cellX, cellZ) {
    if (hash2i(cellX, cellZ, this.seed ^ 0x516e) < 0.5) return null;
    const x = cellX * 96 + 12 + Math.floor(hash2i(cellX, cellZ, this.seed ^ 0x516f) * 72);
    const z = cellZ * 96 + 12 + Math.floor(hash2i(cellX, cellZ, this.seed ^ 0x5170) * 72);
    const h = this.heightRaw(x, z);
    if (h <= WATER_LEVEL || this.coastT(x, z) > 0) return null;
    if (this.bogginess(x, z) > 0.5) return null;
    if (this.inVillage(x, z, 12)) return null;
    return { x, z };
  }

  // ---------- naming t' land ----------
  locationName(x, z) {
    for (const vv of this.villages) {
      if (Math.hypot(x - vv.x, z - vv.z) < vv.radius + 4) return vv.name;
    }
    const v = this.village;
    if (Math.hypot(x - v.x, z - v.z) < 55) return 'Moorstead';
    if (Math.hypot(x - ROSEBERRY.x, z - ROSEBERRY.z) < 45) return 'Roseberry Topping';
    if (Math.hypot(x - HORCUM.x, z - HORCUM.z) < HORCUM.r + 18) return 'T\u2019 Hole of Horcum';
    if (Math.hypot(x - WAINSTONES.x, z - WAINSTONES.z) < 26) return 'The Wainstones';
    if (Math.hypot(x - KILNS.x, z - KILNS.z) < 42) return 'Rosedale Ironstone Kilns';
    const ab = this.abbeySite();
    if (Math.hypot(x - ab.x, z - ab.z) < 38) return 'T\u2019 Abbey';
    if (this.inWhitby(x, z, 4)) return 'Whitby';
    if (Math.hypot(x - DRACULA_MOOR.x, z - DRACULA_MOOR.z) < DRACULA_MOOR.r + 10) return 'T\u2019 Lonely Moor';
    const ct = this.coastT(x, z);
    if (ct > 0.75) return 'T\u2019 North Sea';
    if (ct > 0.02) return (z > 220 && z < 460) ? 'Robin Hood\u2019s Bay' : 'T\u2019 Heritage Coast';
    if (this.onRoad(x, z) || (Math.abs(x - ROAD_X) < 8 && z > -420 && z < 60)) return 'Wade\u2019s Causey';
    const h = this.heightRaw(x, z);
    if (h > 33 && this.bogginess(x, z) > 0.5) return 'May Moss';
    if (this.daleness(x, z) > 0.55 && h < 33) {
      return DALE_NAMES[Math.floor(hash2i(Math.floor(x / 224), Math.floor(z / 224), this.seed ^ 0xda7e) * DALE_NAMES.length)];
    }
    if (h >= 34) {
      return MOOR_NAMES[Math.floor(hash2i(Math.floor(x / 256), Math.floor(z / 256), this.seed ^ 0x3008) * MOOR_NAMES.length)];
    }
    return 'T\u2019 Moor Fringe';
  }
}
