// The real North York Moors, c.1900 — the geo interface driven by data/moors-data.json.
// Same surface as geography.js Geography, so worldgen/rails/entities consume it unchanged.
// Towns are MARKERS in Slice 0; building layouts + morphology arrive in slices 2-3.
import data from '../data/moors-data.json' with { type: 'json' };
import { HEIGHT, WATER_LEVEL } from './defs.js';
import { fbm2 } from './noise.js';
import { bilinear, blockToGrid, pointToPolyline } from './geo-grid.js';
import { buildRailPath, samplePos as rpSample, railInfo as rpInfo } from './railpath.js';

function smoothstep(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }

export class MoorsGeography {
  constructor(seed = 0) {
    this.seed = seed | 0;
    this.data = data;
    this.colCache = new Map();
    this.villages = data.towns.map(t => ({
      x: t.x, z: t.z, name: t.name, tier: t.tier,
      radius: t.tier === 1 ? 48 : 28, style: 'marker', buildings: [],
      ground: Math.max(this._baseMetresToBlock(t.x, t.z), WATER_LEVEL + 2),
    }));
    this.village = this.villages[0];
  }

  _baseMetresToBlock(x, z) {
    const [gx, gz] = blockToGrid(this.data.transform, this.data.elevation, x, z);
    const m = bilinear(this.data.elevation, gx, gz);
    return Math.floor(WATER_LEVEL + m / this.data.transform.metresPerBlock);
  }

  // ---------- coast ----------
  coastDist(x, z) { return pointToPolyline(x, z, this.data.coast); }
  _coastXAt(z) {
    // interpolate the coast polyline's x at this z
    const c = this.data.coast;
    for (let i = 0; i < c.length - 1; i++) {
      const [x0, z0] = c[i], [x1, z1] = c[i + 1];
      if ((z >= z0 && z <= z1) || (z >= z1 && z <= z0)) {
        const t = (z - z0) / ((z1 - z0) || 1);
        return x0 + (x1 - x0) * t;
      }
    }
    return c[c.length - 1][0];
  }
  coastX(z) { return this._coastXAt(z); }
  // 0 inland .. 1 open sea (east of the coastline)
  coastT(x, z) {
    if (x <= this._coastXAt(z)) return 0;
    return smoothstep(this.coastDist(x, z) / 64);
  }

  // ---------- height ----------
  heightRaw(x, z) {
    let h = this._baseMetresToBlock(x, z);
    // light micro-roughness so the stylised surface isn't glassy (deterministic;
    // skipped for client/relay parity sampling via _heightRawNoFbm)
    if (!this._noFbm) h += fbm2(x * 0.03 + 11.1, z * 0.03 + 7.7, 2, this.seed ^ 0x5117) * 1.5;
    // landmark sculpt (peaks)
    for (const lm of this.data.landmarks) {
      if (lm.kind === 'peak') {
        const r = Math.hypot(x - lm.x, z - lm.z), R = lm.params.radius;
        if (r < R) {
          const cone = (WATER_LEVEL + lm.params.height / this.data.transform.metresPerBlock) - (r / R) * 14;
          h = Math.max(h, cone);
        }
      }
    }
    // coast: drop to the sea floor east of the coastline
    const t = this.coastT(x, z);
    if (t > 0) h = (h * (1 - t)) + (WATER_LEVEL - 9) * t;
    return Math.max(5, Math.min(HEIGHT - 6, h));
  }

  // the deterministic base+landmark+coast height only — what the relay mirrors
  _heightRawNoFbm(x, z) {
    const prev = this._noFbm; this._noFbm = true;
    const h = this.heightRaw(x, z);
    this._noFbm = prev;
    return h;
  }

  height(x, z) {
    const key = x + ',' + z;
    const c = this.colCache.get(key);
    if (c !== undefined) return c;
    let h = this.heightRaw(x, z);
    for (const v of this.villages) {
      if (Math.hypot(x - v.x, z - v.z) < v.radius) { h = (h + v.ground) / 2; break; } // gentle marker flatten (slice 0)
    }
    h = Math.floor(h);
    if (this.colCache.size > 80000) this.colCache.clear();
    this.colCache.set(key, h);
    return h;
  }

  // ---------- railway (reusing the proven engine) ----------
  railway() { return this.data.stations.filter(s => s.line === 'moors'); }
  railPath() { return this._path || (this._path = buildRailPath(this.railway(), (x, z) => this.height(x, z), this.villages)); }
  samplePos(s) { return rpSample(this.railPath(), s); }
  railInfo(x, z) { return rpInfo(this.railPath(), x, z); }
  nearStation(x, z, r = 8) { return this.railway().find(s => Math.hypot(s.x - x, s.z - z) < r) || null; }

  // ---------- villages (markers in slice 0) ----------
  inVillage(x, z, pad = 0) { return this.villages.some(v => Math.hypot(x - v.x, z - v.z) < v.radius + pad); }
  villageAt(x, z) { return this.villages.find(v => Math.hypot(x - v.x, z - v.z) < v.radius) || null; }
  villageColumn() { return null; }   // no building layouts yet (slices 2-3)
  npcHome() { return null; }          // ditto
  npcSpot(name, v = this.village) { return [v.x, v.z]; }

  // ---------- naming ----------
  locationName(x, z) {
    for (const lm of this.data.landmarks) if (Math.hypot(x - lm.x, z - lm.z) < 36) return lm.name;
    for (const v of this.villages) if (Math.hypot(x - v.x, z - v.z) < v.radius + 4) return v.name;
    if (this.coastT(x, z) > 0.75) return 'T’ North Sea';
    if (this.coastT(x, z) > 0.02) return 'T’ Heritage Coast';
    return this.heightRaw(x, z) >= WATER_LEVEL + 18 ? 'T’ High Moor' : 'T’ Dale';
  }
}
