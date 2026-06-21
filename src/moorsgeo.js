// The real North York Moors, c.1900 — the geo interface driven by data/moors-data.json.
// Same surface as geography.js Geography, so worldgen/rails/entities consume it unchanged.
// Towns are MARKERS in Slice 0; building layouts + morphology arrive in slices 2-3.
import data from '../data/moors-data.json' with { type: 'json' };
import { HEIGHT, WATER_LEVEL } from './defs.js';
import { fbm2 } from './noise.js';
import { bilinear, blockToGrid } from './geo-grid.js';
import { buildRailPath, samplePos as rpSample, railInfo as rpInfo } from './railpath.js';

function smoothstep(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }

export class MoorsGeography {
  constructor(seed = 0) {
    this.seed = seed | 0;
    this.realWorld = true;   // a real-OS world: suppresses stylised-only content (wild quarries, spawned folk)
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

  // ---------- coast (DEM-driven: the sea is wherever the real ground sits below the waterline) ----------
  coastT(x, z) {
    const base = this._baseMetresToBlock(x, z);
    if (base >= WATER_LEVEL) return 0;            // land
    return smoothstep((WATER_LEVEL - base) / 8);  // 0 at the shore, 1 out at sea
  }
  coastX() { return 1e6; }   // no single coast-x with a real DEM; off-map for the few callers (ore/quest)

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

  // ---------- surface character (drives the ground block + map tint, NOT height/parity) ----------
  // Tied to the REAL relief so the moor reads naturally — heather on the high tops,
  // pasture in the dales and the lower south, a little blanket bog on the highest
  // ground — instead of arbitrary noise bands. (~block 33 = 105 m, 47 = 315 m.)
  heatheriness(x, z) { const b = this._baseMetresToBlock(x, z); return Math.max(0, Math.min(1, (b - 33) / 14)); }
  daleness(x, z)     { const b = this._baseMetresToBlock(x, z); return Math.max(0, Math.min(1, (38 - b) / 10)); }
  bogginess(x, z)    { const b = this._baseMetresToBlock(x, z); return Math.max(0, Math.min(1, (b - 44) / 6)); }

  // ---------- Whitby helpers ----------
  inWhitby(x, z, pad = 0) { const w = this.villages.find(v => v.name === 'Whitby'); return !!w && Math.hypot(x - w.x, z - w.z) < (w.radius + pad); }
  isMuseumBoard() { return false; }

  // Building/landmark sites are kept OFF-MAP in slice 0, so no stylised structures
  // (abbey, pier, museum) intrude on the real-terrain preview — they return for real
  // when the towns get their morphology in slices 2-3.
  abbeySite() { return { x: 1e6, z: 1e6 }; }
  abbeyFont() { return { x: 1e6, z: 1e6 }; }
  museumSite() { return { x: 1e6, z: 1e6 }; }
  pierHead() { return { x: 1e6, z: 1e6 }; }

  // Moor furniture (crosses, shooting huts, signposts, the Roman road) — none in
  // slice 0; placed deterministically in a later slice.
  crossAt() { return null; }
  shelterAt() { return null; }
  signAt() { return null; }
  nearestShelter() { return null; }
  onRoad() { return false; }

  // ---------- naming ----------
  locationName(x, z) {
    for (const lm of this.data.landmarks) if (Math.hypot(x - lm.x, z - lm.z) < 36) return lm.name;
    for (const v of this.villages) if (Math.hypot(x - v.x, z - v.z) < v.radius + 4) return v.name;
    if (this.coastT(x, z) > 0.75) return 'T’ North Sea';
    if (this.coastT(x, z) > 0.02) return 'T’ Heritage Coast';
    return this.heightRaw(x, z) >= WATER_LEVEL + 18 ? 'T’ High Moor' : 'T’ Dale';
  }
}
