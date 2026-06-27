// The real North York Moors, c.1900 — the geo interface driven by data/moors-data.json.
// Same surface as geography.js Geography, so worldgen/rails/entities consume it unchanged.
// Towns are MARKERS in Slice 0; building layouts + morphology arrive in slices 2-3.
import data from '../data/moors-data.json' with { type: 'json' };
import { HEIGHT, WATER_LEVEL } from './defs.js';
import { fbm2 } from './noise.js';
import { bilinear, blockToGrid } from './geo-grid.js';
import { buildRailPath, samplePos as rpSample, railInfo as rpInfo } from './railpath.js';
import { buildRoadNet, roadInfo as rdInfo } from './roadpath.js';
import { WORKS } from './economy.js';

function smoothstep(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }

// point-to-segment distance in the block plane (for the causeway; rivers reuse it in 1b)
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  let t = l2 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

// point-to-segment: returns [distance, t] where t in [0,1] is the projection param
function segDT(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  let t = l2 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return [Math.hypot(px - (ax + t * dx), pz - (az + t * dz)), t];
}

const RIVER_HALF = { major: 3, beck: 2 }; // channel half-width by river size
const SNAP = 5;        // perpendicular search half-width for the valley floor
const FREEBOARD = 1;   // water sits this far below the valley floor (so it can't perch)
const RESAMPLE = 4;    // even chainage step for the profile
const SMOOTH_WIN = 2;  // moving-average half-window (smooth gradient)
const TAPER = 60;      // chainage over which the carve ramps up from the source
const MAXCUT = 4;      // hard cap on carve depth below local ground (no canyon)
const BED_DEPTH = 2;   // full water depth downstream

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

  // coarse (8-block) coast-distance field, BFS from sea cells, built once + cached. A cheap
  // O(1) pre-filter so the fine ring search only runs near the coast (keeps chunk-gen fast).
  _coastField() {
    if (this._cf) return this._cf;
    const b = this.worldBounds(), S = 8;
    const cols = Math.floor(b.maxX / S) + 2, rows = Math.floor(b.maxZ / S) + 2;
    const dist = new Int16Array(cols * rows).fill(999);
    const q = [];
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      if (this._baseMetresToBlock(i * S, j * S) < WATER_LEVEL) { dist[i * rows + j] = 0; q.push(i * rows + j); }
    }
    for (let head = 0; head < q.length; head++) {
      const idx = q[head], d = dist[idx]; if (d >= 10) continue;
      const i = (idx / rows) | 0, j = idx % rows;
      for (const [ni, nj] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
        const n = ni * rows + nj; if (dist[n] > d + 1) { dist[n] = d + 1; q.push(n); }
      }
    }
    this._cf = { dist, cols, rows, S };
    return this._cf;
  }
  coastDistCoarse(x, z) {
    const f = this._coastField(), i = Math.round(x / f.S), j = Math.round(z / f.S);
    if (i < 0 || j < 0 || i >= f.cols || j >= f.rows) return 999;
    return f.dist[i * f.rows + j] * f.S;
  }

  // distance (Manhattan rings) to the nearest sea column, capped at maxR (Infinity if none).
  // Drives the general sea-cliff: low land within reach of the shore stands up as cliff.
  _coastDist(x, z, maxR) {
    for (let r = 1; r <= maxR; r++) {
      for (let dx = -r; dx <= r; dx++) {
        const dz = r - Math.abs(dx);
        if (this._baseMetresToBlock(x + dx, z + dz) < WATER_LEVEL) return r;
        if (dz !== 0 && this._baseMetresToBlock(x + dx, z - dz) < WATER_LEVEL) return r;
      }
    }
    return Infinity;
  }

  // is this column within `pad` of a river (data polyline)? — the clifftop plateau leaves the
  // river corridor alone so the river keeps its low path to the sea (no damming the estuary).
  _nearRiverData(x, z, pad) {
    if (!this._rbb) {
      this._rbb = (this.data.rivers || []).map(r => {
        let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
        for (const [px, pz] of r.points) { x0 = Math.min(x0, px); x1 = Math.max(x1, px); z0 = Math.min(z0, pz); z1 = Math.max(z1, pz); }
        return { x0, x1, z0, z1, pts: r.points };
      });
    }
    const p2 = pad * pad;
    for (const b of this._rbb) {
      if (x < b.x0 - pad || x > b.x1 + pad || z < b.z0 - pad || z > b.z1 + pad) continue;
      for (const [px, pz] of b.pts) { const dx = x - px, dz = z - pz; if (dx * dx + dz * dz < p2) return true; }
    }
    return false;
  }

  // target clifftop height (blocks above sea) at a coastal column — inverse-distance blend of
  // the coast anchors, so cliff height varies along the coast (Whitby modest, Boulby tall).
  coastCliffTop(x, z) {
    const cs = this.data.coastalCliffs;
    if (!cs || !cs.length) return 6;
    let wsum = 0, tsum = 0;
    for (const c of cs) {
      const dx = x - c.x, dz = z - c.z, d2 = dx * dx + dz * dz;
      if (d2 < 4) return c.top;
      const w = 1 / (d2 * d2);
      wsum += w; tsum += w * c.top;
    }
    return tsum / wsum;
  }

  // ---------- clifftop coast routing (for the coastal rail lines) ----------
  // nearest clifftop to a (sea) point: nearest land, pushed a few blocks further inland
  _pullToClifftop(x, z) {
    let best = null;
    for (let r = 2; r <= 70 && !best; r += 2) for (let a = 0; a < 360; a += 15) {
      const px = Math.round(x + r * Math.cos(a * Math.PI / 180)), pz = Math.round(z + r * Math.sin(a * Math.PI / 180));
      if (this.coastT(px, pz) === 0) { best = { x: px, z: pz }; break; }
    }
    if (!best) return { x, z };
    const dx = best.x - x, dz = best.z - z, L = Math.hypot(dx, dz) || 1;
    return { x: Math.round(best.x + dx / L * 15), z: Math.round(best.z + dz / L * 15) };
  }
  // via-waypoints (flagged via) following the clifftop from a to b, bowing inland round bays
  _coastRoute(a, b) {
    const raw = [];
    const rec = (p0, p1, d) => {
      if (d >= 7 || Math.hypot(p1.x - p0.x, p1.z - p0.z) < 18) { raw.push({ x: Math.round(p1.x), z: Math.round(p1.z) }); return; }
      // find the worst over-sea point ALONG the chord (a bay needn't be centred on it)
      let worst = -1, wt = 0.35;
      for (let t = 0.15; t <= 0.85; t += 0.1) {
        const ct = this.coastT(Math.round(p0.x + (p1.x - p0.x) * t), Math.round(p0.z + (p1.z - p0.z) * t));
        if (ct > wt) { wt = ct; worst = t; }
      }
      if (worst < 0) { raw.push({ x: Math.round(p1.x), z: Math.round(p1.z) }); return; } // chord on land
      const m = this._pullToClifftop(p0.x + (p1.x - p0.x) * worst, p0.z + (p1.z - p0.z) * worst);
      rec(p0, m, d + 1); rec(m, p1, d + 1);
    };
    rec(a, b, 0);
    raw.pop();   // last == b (the station) — the caller adds it
    const keep = this._dp([{ x: a.x, z: a.z }, ...raw, { x: b.x, z: b.z }], 1);
    return keep.slice(1, -1).map(p => ({ x: p.x, z: p.z, via: true }));
  }
  // CONTOUR-FOLLOW the coastline from a to b, hugging the clifftop a fixed few blocks back from
  // the sea — marches along the coast (perp to the seaward gradient), so it stays tight to the
  // shore AND wraps round bays naturally (where a straight chord would cut across the water).
  _coastHug(a, b) {
    const TARGET = 7, STEP = 6;
    const cd = (x, z) => { const d = this._coastDist(Math.round(x), Math.round(z), 20); return d === Infinity ? 20 : d; };
    const pts = []; let P = { x: a.x, z: a.z }, prev = Math.hypot(a.x - b.x, a.z - b.z), stall = 0, prevT = null;
    for (let n = 0; n < 320; n++) {
      if (Math.hypot(P.x - b.x, P.z - b.z) < STEP * 1.6) break;
      const gx = cd(P.x + 4, P.z) - cd(P.x - 4, P.z), gz = cd(P.x, P.z + 4) - cd(P.x, P.z - 4); // inland gradient
      const gl = Math.hypot(gx, gz);
      let tx, tz;
      if (gl < 0.5) { const dx = b.x - P.x, dz = b.z - P.z, L = Math.hypot(dx, dz) || 1; tx = dx / L; tz = dz / L; }
      else {
        // perpendicular to the seaward gradient; keep the SAME way along the coast (momentum),
        // only steering toward b on the first step — stops it reversing into a bay it just left.
        const ux = -gz / gl, uz = gx / gl, ref = prevT || { x: b.x - P.x, z: b.z - P.z };
        const s = (ux * ref.x + uz * ref.z) >= 0 ? 1 : -1; tx = ux * s; tz = uz * s;
      }
      prevT = { x: tx, z: tz };
      let nx = P.x + tx * STEP, nz = P.z + tz * STEP;
      if (gl >= 0.5) { const err = cd(nx, nz) - TARGET; nx -= (gx / gl) * err; nz -= (gz / gl) * err; } // snap to the offset
      P = { x: Math.round(nx), z: Math.round(nz) };
      pts.push(P);
      const dist = Math.hypot(P.x - b.x, P.z - b.z);
      if (dist > prev - 0.5) { if (++stall > 16) break; } else stall = 0;
      prev = dist;
    }
    return this._dp([{ x: a.x, z: a.z }, ...pts, { x: b.x, z: b.z }], 2).slice(1, -1).map(p => ({ x: p.x, z: p.z, via: true }));
  }

  // distance from point p to segment a-b, plus the clamped projection parameter t
  _segDist(p, a, b) {
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
    let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / L2; t = Math.max(0, Math.min(1, t));
    return { d: Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t)), t };
  }

  // Douglas–Peucker: prune to the essential bends (tolerance eps blocks)
  _dp(pts, eps) {
    if (pts.length < 3) return pts.slice();
    const A = pts[0], B = pts[pts.length - 1];
    const dx = B.x - A.x, dz = B.z - A.z, L2 = dx * dx + dz * dz || 1;
    let maxd = 0, idx = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const t = ((pts[i].x - A.x) * dx + (pts[i].z - A.z) * dz) / L2;
      const cx = A.x + dx * t, cz = A.z + dz * t;
      const d = Math.hypot(pts[i].x - cx, pts[i].z - cz);
      if (d > maxd) { maxd = d; idx = i; }
    }
    if (maxd <= eps) return [A, B];
    return this._dp(pts.slice(0, idx + 1), eps).slice(0, -1).concat(this._dp(pts.slice(idx), eps));
  }

  // arc-length resample of a [[x,z],...] polyline to ~even `step`-block spacing (endpoints kept)
  _resamplePoly(pts, step) {
    if (pts.length < 2) return pts.map(p => p.slice());
    const out = [pts[0].slice()]; let ax = pts[0][0], az = pts[0][1], acc = 0;
    for (let i = 1; i < pts.length; i++) {
      let bx = pts[i][0], bz = pts[i][1], seg = Math.hypot(bx - ax, bz - az);
      while (acc + seg >= step) {
        const t = (step - acc) / seg; ax += (bx - ax) * t; az += (bz - az) * t;
        out.push([ax, az]); acc = 0; seg = Math.hypot(bx - ax, bz - az);
      }
      acc += seg; ax = bx; az = bz;
    }
    const last = pts[pts.length - 1];
    if (Math.hypot(out[out.length - 1][0] - last[0], out[out.length - 1][1] - last[1]) > step * 0.5) out.push(last.slice());
    return out;
  }

  // Chaikin corner-cutting: rounds sharp corners so a spline through the result can't overshoot
  // into kinks/loops. Endpoints are preserved. `iters` controls smoothness.
  _chaikin(pts, iters) {
    let p = pts.map(a => a.slice());
    for (let it = 0; it < iters && p.length > 2; it++) {
      const out = [p[0]];
      for (let i = 0; i < p.length - 1; i++) {
        const a = p[i], b = p[i + 1];
        out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
        out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      out.push(p[p.length - 1]);
      p = out;
    }
    return p;
  }

  // centred moving-average smooth of a [[x,z],...] polyline: a low-pass that removes hand-flown
  // jitter (and the sharp corners a spline overshoots) WITHOUT corner-cutting the bays — unlike
  // Chaikin it stays centred on the surveyed line. Endpoints fixed. `half` = window radius.
  _smoothPoly(pts, half, passes) {
    let p = pts.map(a => a.slice());
    for (let it = 0; it < passes && p.length > 2; it++) {
      const out = [p[0].slice()];
      for (let i = 1; i < p.length - 1; i++) {
        let sx = 0, sz = 0, n = 0;
        for (let k = -half; k <= half; k++) { const j = i + k; if (j >= 0 && j < p.length) { sx += p[j][0]; sz += p[j][1]; n++; } }
        out.push([sx / n, sz / n]);
      }
      out.push(p[p.length - 1].slice());
      p = out;
    }
    return p;
  }

  // is this column inside a relief sculpt (cliff/peak)? — the town flatten leaves these alone
  _sculpted(x, z) {
    for (const lm of this.data.landmarks) {
      if (lm.kind === 'cliff' || lm.kind === 'peak' || lm.kind === 'hill') {
        if (Math.hypot(x - lm.x, z - lm.z) < (lm.params?.radius || 12)) return true;
      }
    }
    return false;
  }

  // exact block-extent of the data, so the map fits itself to the real world
  // (no sampling past the edge, which would extrude the edge row into strips)
  worldBounds() {
    const t = this.data.transform, mpb = t.metresPerBlock;
    return { minX: 0, maxX: (t.maxN - t.minN) / mpb, minZ: 0, maxZ: (t.maxE - t.minE) / mpb };
  }

  // ---------- height ----------
  heightRaw(x, z) {
    const base = this._baseMetresToBlock(x, z);
    let h = base;
    // light micro-roughness so the stylised surface isn't glassy (deterministic;
    // skipped for client/relay parity sampling via _heightRawNoFbm)
    if (!this._noFbm) h += fbm2(x * 0.03 + 11.1, z * 0.03 + 7.7, 2, this.seed ^ 0x5117) * 1.5;
    // sea-coast cross-section (BEFORE the landmark sculpts, so a headland landmark like the
    // abbey cliff can still rise on top): from the sea — a wide flat BEACH, a CLIMBABLE
    // terraced cliff (1-in-1, every step ≤1 block so players can walk up + down), then a LEVEL
    // clifftop, then a gentle inland taper. Height varies along the coast from the anchors.
    // The river corridor is left alone so the river keeps its low path to the sea.
    if (this.coastDistCoarse(x, z) <= 48 && base >= WATER_LEVEL - 5 && h < WATER_LEVEL + 14 && !this._nearRiverData(x, z, 5)) {
      const T = this.coastCliffTop(x, z);
      const BEACH = 6, FLAT = 10, TAPER = 6;
      const RISE = Math.max(1, Math.floor(T) - 1);
      // stretch t' rise to 2 horizontal blocks per 1 vertical — walkable terrace
      // instead o' a near-sheer wall; same total height, same beach/flat/taper.
      const COAST_W = BEACH + RISE * 2;
      const cd = this._coastDist(x, z, COAST_W + FLAT + TAPER);
      if (cd < Infinity) {
        const prof = cd <= BEACH ? 1
          : cd <= COAST_W ? 1 + (cd - BEACH) / 2
          : cd <= COAST_W + FLAT ? T
          : T * Math.max(0, 1 - (cd - COAST_W - FLAT) / TAPER);
        // SET on the shore (clean descent, real beach, no pre-cliff bump); raise-only inland.
        h = cd <= COAST_W ? WATER_LEVEL + prof : Math.max(h, WATER_LEVEL + prof);
      }
    }
    // landmark sculpt — all raise-only (max), so they compose with the DEM + each other.
    const mpb = this.data.transform.metresPerBlock;
    for (const lm of this.data.landmarks) {
      const p = lm.params || {};
      if (lm.kind === 'peak' || lm.kind === 'hill') {
        // conical hill (Roseberry Topping) — the DEM badly under-reads sharp peaks
        const R = p.radius || 12, r = Math.hypot(x - lm.x, z - lm.z);
        if (r < R) h = Math.max(h, (WATER_LEVEL + (p.height || 180) / mpb) - (r / R) * 14);
      } else if (lm.kind === 'cliff') {
        // flat-topped headland with a steep face (Whitby's cliffs): a plateau for the
        // abbey/town to sit on, dropping sharply to the sea via the coast-blend below.
        const R = p.radius || 12, pr = p.plateauR || 7, top = p.top || 5, k = p.k || 2;
        const r = Math.hypot(x - lm.x, z - lm.z);
        if (r < R) {
          const f = r <= pr ? 0 : Math.pow((r - pr) / (R - pr), k);
          h = Math.max(h, WATER_LEVEL + top - f * top);
        }
      }
    }
    // (rivers are carved client-side in worldgen now, not in heightRaw — the ground stays
    // un-carved here so flora/parity stay simple; the minimap reads the rendered surface.)
    // coast: drop to the sea floor where the ground is genuinely below the waterline —
    // but NOT under a cliff/headland a sculpt has raised above it, or the blend would
    // drown the very sea-cliffs we just built (the DEM eroded thin headlands to sea).
    const t = this.coastT(x, z);
    if (t > 0 && h <= WATER_LEVEL) h = (h * (1 - t)) + (WATER_LEVEL - 9) * t;
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
      // gentle marker flatten — but NEVER raise sea columns (coastT>0) (a coastal town would
      // dam its own estuary), nor flatten a cliff/peak the town perches on (keep the drama).
      if (Math.hypot(x - v.x, z - v.z) < v.radius) { if (this.coastT(x, z) === 0 && !this._sculpted(x, z)) h = (h + v.ground) / 2; break; }
    }
    h = Math.floor(h);
    if (this.colCache.size > 80000) this.colCache.clear();
    this.colCache.set(key, h);
    return h;
  }

  // ---------- railway (reusing the proven engine, now multi-line) ----------
  railway() { return this.data.stations.filter(s => s.line === 'moors'); }   // the main line — trains/schedules use this
  // every line, resolved to its ordered station coords (by name, so shared stations work)
  railLines() {
    if (this._lines) return this._lines;
    const byName = Object.fromEntries(this.data.stations.map(s => [s.name, s]));
    this._lines = (this.data.lines || []).map(l => {
      let stops = (l.stations || []).map(n => byName[n]).filter(Boolean);
      if (l.name === 'Esk Valley' && stops.length >= 2 && stops[0].name === 'Grosmont') {
        // The Esk Valley TERMINATES at Grosmont — on the very node the W&P passes through. The two
        // trains run independent schedules off the shared clock, so they DO meet there (verified:
        // both at Grosmont, rakes overlapping, ~once every couple of hours). Real Grosmont answers
        // this with a bay: terminating dale trains stand on a siding clear of the through road. So
        // shift the Esk Valley's Grosmont terminus ~16 blocks onto solid ground NW of the junction —
        // the Egton side it already approaches from, so it curves into the bay without ever crossing
        // the express. A COPY: the shared Grosmont station (W&P platform, map label) is untouched.
        stops = stops.slice(); stops[0] = { ...stops[0], x: 1423, z: 2592, bay: true };
      }
      let route = stops;
      if (l.pegs && l.pegs.length >= 2) {
        // a HAND-SURVEYED line. Hand-flown pegs carry jitter and sharp corners that a spline
        // overshoots into kinks and loops, and they run on PAST the end stations. So: (1) TRIM the
        // pegs to the terminal stations, (2) RESAMPLE to even spacing and CHAIKIN-smooth so there
        // are no sharp corners left to overshoot, then (3) snap each named station to the line.
        let pts = l.pegs.map(p => p.slice());
        const nearestIdx = s => { let bi = 0, bd = Infinity; for (let i = 0; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - s.x, pts[i][1] - s.z); if (d < bd) { bd = d; bi = i; } } return bi; };
        let i0 = nearestIdx(stops[0]), i1 = nearestIdx(stops[stops.length - 1]);
        if (i0 > i1) { const t = i0; i0 = i1; i1 = t; }
        pts = pts.slice(i0, i1 + 1);
        // resample to even spacing, then CHAIKIN-round the corners. Chaikin cuts each corner toward
        // its own chord (staying inside the polyline's hull), so it rounds the hand-flown jitter and
        // sharp bends into sweeping curves — WITHOUT the moving-average's failure mode, where a heavy
        // window tightens tight bays into sharper turns and drifts the route off-line. The named
        // stations are snapped back onto the smoothed line just below, and verify-coast confirms the
        // rounded route never strays into the sea.
        pts = this._smoothPoly(this._resamplePoly(pts, 8), 2, 2);
        route = pts.map(p => ({ x: Math.round(p[0]), z: Math.round(p[1]), via: true }));
        const named = [];
        for (const stn of stops) {
          let bi = 0, bd = Infinity;
          for (let i = 0; i < route.length; i++) { const d = Math.hypot(route[i].x - stn.x, route[i].z - stn.z); if (d < bd) { bd = d; bi = i; } }
          route[bi] = { x: route[bi].x, z: route[bi].z, name: stn.name };
          named.push(route[bi]);
        }
        // clear a gap in the vias around each station so its ±22-block platform run has room —
        // otherwise buildRailPath's platform controls overshoot the adjacent vias into a loop.
        const stnSet = new Set(named);
        route = route.filter(r => stnSet.has(r) || !named.some(s => Math.hypot(r.x - s.x, r.z - s.z) < 30));
        stops = named;
      } else if (l.coastal && stops.length >= 2) {
        // route the clifftop two ways and keep whichever stays out of the sea best: the
        // contour-follower hugs tightest, the chord-router is steadier — pick per line.
        const hf = (x, z) => this.height(x, z), rf = (x, z) => this.riverWaterLevel(x, z);
        const mk = router => { let r = [stops[0]]; for (let i = 1; i < stops.length; i++) r = r.concat(router(stops[i - 1], stops[i]), [stops[i]]); return r; };
        const overSea = rt => { const pa = buildRailPath(rt, hf, this.villages, true, rf); let s = 0; for (const p of pa.pts) if (this.coastT(Math.round(p.x), Math.round(p.z)) > 0.5) s++; return s; };
        const hug = mk((a, b) => this._coastHug(a, b)), chord = mk((a, b) => this._coastRoute(a, b));
        route = overSea(hug) <= overSea(chord) ? hug : chord;
        // clear any last clip on the chosen route: pull the offending spline point inland
        // (escalating each pass) and insert it in the right segment, until none cross the sea.
        for (let pass = 0; pass < 8; pass++) {
          const pa = buildRailPath(route, hf, this.villages, true, rf);
          let bad = null; for (const p of pa.pts) if (this.coastT(Math.round(p.x), Math.round(p.z)) > 0.5) { bad = p; break; }
          if (!bad) break;
          const land = this._pullToClifftop(bad.x, bad.z);
          const dx = land.x - bad.x, dz = land.z - bad.z, L = Math.hypot(dx, dz) || 1, extra = pass * 7;
          const vv = { x: Math.round(land.x + dx / L * extra), z: Math.round(land.z + dz / L * extra), via: true };
          let seg = 0, bd = Infinity;
          for (let j = 0; j < route.length - 1; j++) { const r = this._segDist(bad, route[j], route[j + 1]); if (r.d < bd) { bd = r.d; seg = j; } }
          route.splice(seg + 1, 0, vv);
        }
      }
      return { name: l.name, kind: l.kind, stops, route, pegged: !!(l.pegs && l.pegs.length >= 2) };
    }).filter(l => l.stops.length >= 2);
    return this._lines;
  }
  // a built spline per line (cached); each splines through its route (stations + coast via),
  // bridges rivers + cardinal-aligns its real stations
  railPaths() {
    if (this._paths) return this._paths;
    const hf = (x, z) => this.height(x, z);
    // lift the deck over rivers AND over open water (so a coast line crossing the Esk estuary
    // rides a viaduct — Larpool — instead of fording it)
    const rf = (x, z) => { const r = this.riverWaterLevel(x, z); return r != null ? r : (this.coastT(x, z) > 0.5 ? WATER_LEVEL : null); };
    // The real-layout world places every line deliberately (real routes) and its towns are empty
    // markers, so the procedural village-avoidance only fights the routes — kinking them into loops
    // around blobs with nothing to avoid. Skip it for ALL moors lines; buildings (added later) are
    // kept clear of the rails at stamp time instead.
    this._paths = this.railLines().map(l => ({ name: l.name, kind: l.kind, path: buildRailPath(l.route, hf, [], true, rf, 9) }));
    return this._paths;
  }
  // the MAIN line's spline (single-path consumers: trains, schedules, ride camera)
  railPath() {
    if (this._path) return this._path;
    const m = this.railPaths().find(p => p.name === 'Whitby & Pickering') || this.railPaths()[0];
    this._path = m.path;
    return this._path;
  }
  samplePos(s) { return rpSample(this.railPath(), s); }
  samplePosOn(path, s) { return rpSample(path, s); }
  // nearest track across ALL lines — so the terrain (embankment/bridges/ballast), flora and
  // mob-avoidance treat every line, not just the main one
  railInfo(x, z) {
    let best = null;
    for (const { path } of this.railPaths()) { const ri = rpInfo(path, x, z); if (ri && (!best || ri.d < best.d)) best = ri; }
    return best;
  }
  nearStation(x, z, r = 8) { return this.data.stations.find(s => Math.hypot(s.x - x, s.z - z) < r) || null; }

  // ---------- the parish lanes ----------
  // The road network (towns ↔ neighbours + station), built once from the layout and cached —
  // the road analogue of railPaths(). Lanes shadow the line where it runs parallel and strike
  // across the moor to the remote dales, threading round the town buildings, with flat-plank
  // bridges over the becks and plank crossings over the rail. See src/roadpath.js.
  roadPaths() {
    return (this._roadNet || (this._roadNet = buildRoadNet(this))).edges;
  }
  // nearest road across all lanes: { d, along, deck } | null (within ~4 blocks)
  roadInfo(x, z) {
    return rdInfo(this._roadNet || (this._roadNet = buildRoadNet(this)), x, z);
  }

  // ---------- villages (markers in slice 0) ----------
  inVillage(x, z, pad = 0) { return this.villages.some(v => Math.hypot(x - v.x, z - v.z) < v.radius + pad); }
  villageAt(x, z) { return this.villages.find(v => Math.hypot(x - v.x, z - v.z) < v.radius) || null; }
  // A deterministic period townscape per town: enterable PLACES OF BUSINESS (inn/shop/chapel)
  // and terraced rows of cottages that curve round the streets — each cottage a clean square
  // box. All kept clear of the rails, becks, sea and one another. Cached per town. (Folk sleep
  // out of sight at neet, so cottages are scene-dressing; the businesses are the enterable bit.)
  _townBuildings(v) {
    if (v._bld) return v._bld;
    const out = [], WL = WATER_LEVEL;
    let s = ((Math.round(v.x) * 73856093) ^ (Math.round(v.z) * 19349663)) >>> 0;
    const rnd = () => { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296; };
    const free = (x0, z0, x1, z1, clear) => {
      let lo = 999, hi = 0;
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const h = this.height(x, z);
        if (h <= WL + 1 || this.riverWaterLevel(x, z) != null || this.coastT(x, z) > 0.2) return null;
        if (h < lo) lo = h; if (h > hi) hi = h;
      }
      if (hi - lo > 5) return null;                          // flat-ish footing only
      for (let x = x0 - clear; x <= x1 + clear; x++) for (let z = z0 - clear; z <= z1 + clear; z++) {
        const ri = this.railInfo(x, z); if (ri && ri.d < 3.5) return null;   // clear of the rails
      }
      for (const st of this.data.stations) if (Math.abs((x0 + x1) / 2 - st.x) < 13 && Math.abs((z0 + z1) / 2 - st.z) < 13) return null;
      for (const b of out) if (!(x1 < b.x0 || x0 > b.x1 || z1 < b.z0 || z0 > b.z1)) return null; // no overlap (allow touching)
      return Math.round((lo + hi) / 2);
    };
    const add = (ccx, ccz, w, d, type) => {
      const x0 = Math.round(ccx - (w - 1) / 2), z0 = Math.round(ccz - (d - 1) / 2), x1 = x0 + w - 1, z1 = z0 + d - 1;
      const g = free(x0, z0, x1, z1, type === 'cottage' ? 2 : 3);
      if (g == null) return false;
      const biz = type !== 'cottage';
      const roof = type === 'chapel' ? 'slate' : (rnd() < 0.6 ? 'pantile' : 'slate');
      // `biz` buildings get a sign post + a cleared, levelled doorstep in the dressing pass
      out.push({ x0, z0, x1, z1, g, type, wallH: biz ? 5 : 4, roof, wall: biz ? 'stonebrick' : 'cobble', biz });
      return true;
    };
    const R = v.radius, hero = v.name === 'Whitby';
    // PLACES OF BUSINESS — every town gets a CHURCH (with tower) and a PUB, then shops; worked out
    // in rings from the centre so they cluster on the high street and the player's led to them.
    const wanted = [
      { type: 'chapel', sizes: [[8, 6], [6, 5], [5, 4], [4, 4]] },  // a church (smaller if hemmed in)
      { type: 'pub', sizes: [[7, 5], [6, 4], [5, 4], [4, 4]] },
      { type: 'shop', sizes: [[6, 5], [5, 4], [4, 4]] },
      { type: 'shop', sizes: [[6, 5], [5, 4]] },
    ];
    if (hero) for (let i = 0; i < 3; i++) wanted.push({ type: 'shop', sizes: [[7, 5], [6, 5], [5, 4]] });
    for (const { type, sizes } of wanted) {
      let done = false;
      for (const [w, d] of sizes) {
        if (done) break;
        for (let ring = 5; ring < R + 12 && !done; ring += 5)
          for (let k = 0; k < 12 && !done; k++) {
            const a = k * Math.PI / 6 + rnd();
            if (add(v.x + Math.cos(a) * ring, v.z + Math.sin(a) * ring, w, d, type)) done = true;
          }
      }
    }
    // TERRACED ROWS — streets every ~6 blocks, cottages set adjacent along the row wherever the
    // ground's good; the rows break and re-form round water and cliff, so the town hugs the land.
    const cap = hero ? 44 : (R >= 48 ? 22 : 13);
    for (let dz = -R; dz <= R && out.length < cap; dz += 6)
      for (let dx = -R; dx <= R && out.length < cap; dx += 4)
        add(v.x + dx, v.z + dz, 4, 4, 'cottage');
    v._bld = out;
    return out;
  }
  villageColumn(x, z) {
    for (const v of this.villages) {
      if (Math.abs(x - v.x) > v.radius + 14 || Math.abs(z - v.z) > v.radius + 14) continue;
      for (const b of this._townBuildings(v)) {
        if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return { kind: 'building', b, v };
      }
    }
    // farm buildings — so the column loop in stampVillage skips them (stampFarm handles them)
    for (const f of this.farmSites())
      for (const b of this._farmBuildings(f))
        if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return { kind: 'farm', b, f };
    return null;
  }
  // is (x,z) within `pad` of any town building footprint? — towns only, no recursion.
  _nearTownBuildingOnly(x, z, pad) {
    for (const v of this.villages) {
      if (Math.abs(x - v.x) > v.radius + 16 + pad || Math.abs(z - v.z) > v.radius + 16 + pad) continue;
      for (const b of this._townBuildings(v))
        if (x >= b.x0 - pad && x <= b.x1 + pad && z >= b.z0 - pad && z <= b.z1 + pad) return true;
    }
    return false;
  }
  // is (x,z) within `pad` of any town or farm building footprint?
  // Used to clear trees off the streets and farmsteads. farmSites() calls _nearTownBuildingOnly
  // internally (to avoid recursion during site selection); all other callers use this method.
  nearTownBuilding(x, z, pad = 5) {
    if (this._nearTownBuildingOnly(x, z, pad)) return true;
    // farm buildings (safe: _farmSites is [] during farmSites() construction)
    for (const f of this.farmSites())
      for (const b of this._farmBuildings(f))
        if (x >= b.x0 - pad && x <= b.x1 + pad && z >= b.z0 - pad && z <= b.z1 + pad) return true;
    return false;
  }
  // Works sites: each WORKS (calcining kiln, furnace) placed at a dry, flat-ish spot near its town,
  // clear of the rails. Cached. `kind` ('kiln'|'furnace') shapes the footprint + structure.
  worksSites() {
    if (this._worksSites) return this._worksSites;
    const WL = WATER_LEVEL;
    const fit = (cx, cz, hw, hd) => {
      let lo = 999, hi = 0;
      for (let x = cx - hw; x <= cx + hw; x++) for (let z = cz - hd; z <= cz + hd; z++) {
        const h = this.height(x, z);
        if (h <= WL + 1 || this.riverWaterLevel(x, z) != null || this.coastT(x, z) > 0.2) return null;
        if (h < lo) lo = h; if (h > hi) hi = h;
      }
      if (hi - lo > 4) return null;
      for (let x = cx - hw - 3; x <= cx + hw + 3; x++) for (let z = cz - hd - 3; z <= cz + hd + 3; z++) {
        const ri = this.railInfo(x, z); if (ri && ri.d < 3) return null;
      }
      if (this.nearTownBuilding(cx, cz, Math.max(hw, hd) + 2)) return null; // clear of the town buildings
      return Math.round((lo + hi) / 2);
    };
    this._worksSites = [];
    for (const w of WORKS) {
      const v = this.villages.find(t => t.name.toLowerCase().includes(w.town.toLowerCase()));
      if (!v) continue;
      const hw = w.kind === 'kiln' ? 6 : w.kind === 'jetshop' ? 2 : 3, hd = w.kind === 'jetshop' ? 2 : 3; // kiln bank long; furnace squarer; jet shop small
      let placed = null;
      for (let ring = 12; ring < 64 && !placed; ring += 6)
        for (let k = 0; k < 12 && !placed; k++) {
          const a = k * Math.PI / 6;
          const cx = Math.round(v.x + Math.cos(a) * ring), cz = Math.round(v.z + Math.sin(a) * ring);
          const g = fit(cx, cz, hw, hd);
          if (g != null) placed = { ...w, x: cx, z: cz, g, hw, hd };
        }
      if (placed) this._worksSites.push(placed);
    }
    return this._worksSites;
  }
  worksAt(x, z) { return this.worksSites().find(s => Math.abs(x - s.x) <= s.hw + 2 && Math.abs(z - s.z) <= s.hd + 2) || null; }

  // Farmstead sites: ~10-12 deterministic isolated holdings scattered across the dales,
  // each in the parish band (40-170 blocks from a town), dry, flat, clear of rails/rivers/towns.
  farmSites() {
    if (this._farmSites) return this._farmSites;
    const out = [];
    if (!this.realWorld || !this.worldBounds) { this._farmSites = out; return out; }
    // set early so any re-entrant call returns [] instead of recursing
    this._farmSites = out;
    const { minX, maxX, minZ, maxZ } = this.worldBounds();
    const flat = (x, z) => {
      const h = this.height(x, z); let mx = 0;
      for (const [dx, dz] of [[6,0],[-6,0],[0,6],[0,-6]]) mx = Math.max(mx, Math.abs(this.height(x+dx, z+dz) - h));
      return mx <= 3;
    };
    const nearTown = (x, z) => this.villages.some(v => Math.hypot(v.x - x, v.z - z) < 40);
    const inParish = (x, z) => this.villages.some(v => { const d = Math.hypot(v.x - x, v.z - z); return d >= 40 && d <= 170; });
    const far = (x, z) => out.every(f => Math.hypot(f.x - x, f.z - z) > 120);
    // deterministic sweep on a 24-block grid
    for (let x = minX + 30; x < maxX - 30 && out.length < 12; x += 24) {
      for (let z = minZ + 30; z < maxZ - 30 && out.length < 12; z += 24) {
        if (this.height(x, z) < 28) continue;               // dry land, above the becks
        if (this.coastT(x, z) > 0) continue;                // not the shore
        if (this.riverWaterLevel(x, z) != null) continue;   // not in a river
        const ri = this.railInfo(x, z); if (ri && ri.d < 6) continue; // well clear of the line
        if (!flat(x, z)) continue;
        if (nearTown(x, z) || !inParish(x, z)) continue;
        if (this._nearTownBuildingOnly(x, z, 10)) continue;  // town-only check avoids recursion during site selection
        if (!far(x, z)) continue;
        out.push({ x, z, seed: (x * 73856093) ^ (z * 19349663) });
      }
    }
    // _farmSites already points at `out`; no re-assign needed
    return out;
  }

  // Each farm's building footprint: farmhouse + barn + walled fold.
  // Box fields mirror _townBuildings exactly so stampBuildingColumn + nearTownBuilding accept them.
  _farmBuildings(site) {
    if (site._bld) return site._bld;
    let s = (site.seed >>> 0);
    const rnd = () => { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296; };
    const { x, z } = site;
    const blds = [];
    // farmhouse: ~6x5, cobble walls, slate roof
    const g0 = Math.round(this.height(x, z));
    blds.push({ x0: x - 3, x1: x + 3, z0: z - 2, z1: z + 3, g: g0, type: 'farmhouse', wallH: 4, wall: 'cobble', roof: 'slate', biz: false });
    // barn: ~5x4, set a few blocks east, planks walls
    const bx = x + 7 + ((rnd() * 3) | 0);
    const bg = Math.round(this.height(bx + 2, z));
    blds.push({ x0: bx, x1: bx + 5, z0: z - 2, z1: z + 2, g: bg, type: 'barn', wallH: 4, wall: 'cobble', roof: 'slate', biz: false });
    // fold: a fenced pen for stock, to the west of the yard
    const fx = x - 12 - ((rnd() * 4) | 0);
    const fg = Math.round(this.height(fx + 4, z));
    blds.push({ x0: fx, x1: fx + 8, z0: z - 4, z1: z + 4, g: fg, type: 'fold', wallH: 2, wall: 'fence', roof: null, biz: false });
    site._bld = blds;
    return blds;
  }

  // the Cleveland/Rosedale ironstone field — rich seams round Rosedale, the heart of the 1900 industry
  ironstoneAt(x, z) {
    const r = this.villages.find(v => v.name.includes('Rosedale'));
    return !!r && Math.hypot(x - r.x, z - r.z) < 130;
  }
  // Whitby jet — the Lias jet rock, won from the Whitby cliffs + the moors close behind the town
  jetAt(x, z) {
    const w = this.villages.find(v => v.name === 'Whitby');
    return !!w && Math.hypot(x - w.x, z - w.z) < 120;
  }
  // a clear headland round the abbey ruin (no trees crowding the great east window)
  nearAbbey(x, z, pad = 5) {
    const a = (this.data.landmarks || []).find(l => l.kind === 'abbey');
    return !!a && Math.abs(x - a.x) <= 5 + pad && Math.abs(z - a.z) <= 8 + pad;
  }
  npcHome() { return null; }          // folk vanish at neet (no houses needed)
  // by day folk are at a place of business (dry, sensible — the town centre may be harbour water);
  // distributed across the town's buildings by name so they don't all stack on one spot.
  npcSpot(name, v = this.village) {
    const B = this._townBuildings(v);
    if (B.length) {
      let h = 0; for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
      const b = B[h % B.length];
      return [Math.round((b.x0 + b.x1) / 2), Math.round((b.z0 + b.z1) / 2)];
    }
    return [v.x, v.z];
  }

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
  // (pier, museum) intrude on the real-terrain preview — they return for real when the
  // towns get their morphology in slices 2-3. The MUSEUM never exists in the moors world
  // (the Dracula arc opens at the Whitby harbour via a roster fishwife instead); so
  // museumSite()/isMuseumBoard() stay off-map/false here on purpose.
  abbeySite() { return { x: 1e6, z: 1e6 }; }
  museumSite() { return { x: 1e6, z: 1e6 }; }
  pierHead() { return { x: 1e6, z: 1e6 }; }

  // The Whitby Abbey landmark from the real OS data ({x,z} of the East Cliff ruin), or
  // null if the data lacks it. Distinct from abbeySite() (the stylised structure anchor,
  // still off-map here): this is the surveyed point the Dracula arc routes to.
  _abbeyLandmark() { return (this.data.landmarks || []).find(l => l.kind === 'abbey') || null; }

  // Holy water font on the consecrated abbey headland. Real in v2: a solid-ground point
  // just inland (south-west) of the surveyed East Cliff abbey, inside the nearAbbey()
  // clearing — so drac3 ("draw holy water from the abbey font") is reachable on the moor.
  // Falls back to the off-map sentinel only if the abbey landmark is missing.
  abbeyFont() {
    const a = this._abbeyLandmark();
    if (!a) return { x: 1e6, z: 1e6 };
    return { x: a.x - 10, z: a.z - 6 };   // (1822,3085): coastT 0, on land, within nearAbbey()
  }

  // The Whitby harbour strand where the Demeter ran aground — a real solid-ground point
  // on the waterline just north of the town centre (within inWhitby()). Used to open the
  // Dracula arc in the moors world. Null only if the Whitby town is missing.
  whitbyHarbour() {
    const w = this.villages.find(v => v.name === 'Whitby');
    if (!w) return null;
    return { x: w.x + 38, z: w.z };       // (1828,3046): coastT 0, on the strand by the water
  }

  // The boss arena: a real, in-bounds, solid clifftop spot on the East Cliff in the abbey's
  // consecrated clearing — where the Count makes his last stand at dawn (Slice 2). Derived
  // from the surveyed abbey landmark with a small SW offset onto flat ground inside nearAbbey()
  // (the sea-cliff edge lies just NE, fitting the East Cliff drama). Returns {x,z,r}; falls
  // back to the off-map sentinel only if the abbey landmark is missing. drac5.spawnAt is
  // dual-world (geo.realWorld ? draculaArena() : DRACULA_MOOR), so the stylised fight is
  // untouched. (1824,3079): coastT 0, h 27, flat, in-bounds, nearAbbey, within Whitby.
  draculaArena() {
    const a = this._abbeyLandmark();
    if (!a) return { x: 1e6, z: 1e6, r: 16 };
    return { x: a.x - 8, z: a.z - 12, r: 16 };
  }

  // Moor furniture (crosses, shooting huts, signposts, the Roman road) — none in
  // slice 0; placed deterministically in a later slice.
  crossAt() { return null; }
  shelterAt() { return null; }
  signAt() { return null; }
  nearestShelter() { return null; }
  onRoad(x, z) {
    if (this._causeway === undefined) {
      const c = this.data.landmarks.find(l => l.kind === 'causeway');
      this._causeway = (c && c.points) || null;
    }
    const pts = this._causeway;
    if (!pts) return false;
    for (let i = 0; i < pts.length - 1; i++) {
      if (segDist(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) < 1.6) return true;
    }
    return false;
  }

  // ---------- rivers v2 (valley-floor becks, carved client-side in worldgen) ----------
  // resample a chained polyline at even spacing → [{x,z,s}] with cumulative chainage s
  _resample(pts) {
    const out = [{ x: pts[0][0], z: pts[0][1], s: 0 }];
    let s = 0;
    for (let i = 1; i < pts.length; i++) {
      const ax = pts[i - 1][0], az = pts[i - 1][1], bx = pts[i][0], bz = pts[i][1];
      const L = Math.hypot(bx - ax, bz - az); if (L < 1e-6) continue;
      for (let d = RESAMPLE; d <= L + 1e-6; d += RESAMPLE) { const t = d / L; out.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, s: s + d }); }
      s += L;
    }
    return out;
  }

  // Per-river profile: anchored to the VALLEY FLOOR (perpendicular min → can't perch),
  // SMOOTHED (even gradient), MONOTONIC (downhill). Built once.
  _riverProfile() {
    if (this._rprof) return this._rprof;
    this._rprof = (this.data.rivers || []).map(r => {
      const res = this._resample(r.points);
      const floor = res.map((p, i) => {
        const a = res[Math.max(0, i - 1)], b = res[Math.min(res.length - 1, i + 1)];
        let px = -(b.z - a.z), pz = (b.x - a.x); const L = Math.hypot(px, pz) || 1; px /= L; pz /= L;
        let m = Infinity;
        for (let o = -SNAP; o <= SNAP; o++) m = Math.min(m, this._baseMetresToBlock(Math.round(p.x + px * o), Math.round(p.z + pz * o)));
        return m;
      });
      const sfloor = floor.map((f, i) => {
        let sum = 0, k = 0; for (let j = -SMOOTH_WIN; j <= SMOOTH_WIN; j++) { const q = floor[i + j]; if (q !== undefined) { sum += q; k++; } }
        return Math.min(f, sum / k);
      });
      if (sfloor[0] < sfloor[sfloor.length - 1]) { res.reverse(); sfloor.reverse(); floor.reverse(); const S = res[res.length - 1].s; for (const p of res) p.s = S - p.s; }
      // water surface descends, but NEVER below sea level — a river can't run below the
      // sea it drains into, so the lower reach sits at WATER_LEVEL and meets the sea flush.
      const wl = new Array(sfloor.length); wl[0] = Math.max(WATER_LEVEL, sfloor[0] - FREEBOARD);
      for (let i = 1; i < sfloor.length; i++) wl[i] = Math.max(WATER_LEVEL, Math.min(wl[i - 1], sfloor[i] - FREEBOARD));
      // extend the mouth to tidewater if the sea is close, so the river actually reaches it,
      // ramped to sea level so the junction is flush (no awkward step down into the sea)
      const mouth = res[res.length - 1];
      let target = null;
      for (let rad = 3; rad <= 20 && !target; rad += 3)
        for (let a = 0; a < 360; a += 30) {
          const tx = mouth.x + Math.cos(a * Math.PI / 180) * rad, tz = mouth.z + Math.sin(a * Math.PI / 180) * rad;
          if (this.coastT(Math.round(tx), Math.round(tz)) > 0) { target = [tx, tz]; break; }
        }
      if (target) {
        const dx = target[0] - mouth.x, dz = target[1] - mouth.z, L = Math.hypot(dx, dz) || 1;
        for (let d = RESAMPLE; d <= L; d += RESAMPLE) {
          const t = d / L;
          res.push({ x: mouth.x + dx * t, z: mouth.z + dz * t, s: mouth.s + d });
          wl.push(WATER_LEVEL); floor.push(WATER_LEVEL + 1);
        }
      }
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const p of res) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z; }
      return { name: r.name, dale: r.dale, size: r.size || 'beck', res, wl, floor, minX, maxX, minZ, maxZ };
    });
    return this._rprof;
  }

  // nearest river column → { bed, wl, dale } or null. Client-only (worldgen carves it).
  // Shallow (capped, tapered at the source), below the valley floor (no perch),
  // suppressed in open water (no trench through the sea/pond bed).
  riverColumn(x, z) {
    let best = null;
    for (const r of this._riverProfile()) {
      const half = RIVER_HALF[r.size] || 2;
      if (x < r.minX - half || x > r.maxX + half || z < r.minZ - half || z > r.maxZ + half) continue;
      for (let i = 0; i < r.res.length - 1; i++) {
        const [d, t] = segDT(x, z, r.res[i].x, r.res[i].z, r.res[i + 1].x, r.res[i + 1].z);
        if (!best || d < best.d) best = { d, r, i, t, half };
      }
    }
    if (!best || best.d >= best.half) return null;
    const r = best.r, i = best.i, t = best.t;
    if (this.coastT(x, z) > 0) return null;                  // merge into the sea — no trench through the bed
    const wl = Math.round(r.wl[i] + (r.wl[i + 1] - r.wl[i]) * t);
    const s = r.res[i].s + (r.res[i + 1].s - r.res[i].s) * t;
    const base = this._baseMetresToBlock(x, z);
    const depth = Math.max(1, Math.round(BED_DEPTH * Math.min(1, s / TAPER))); // taper from ~0 at the source
    let bed = wl - depth;
    if (bed < base - MAXCUT) bed = base - MAXCUT;            // cap the cut — no canyon
    if (bed >= base) return null;                             // nothing to carve here
    return { bed, wl, dale: r.dale };
  }

  // water surface level at a river column (for worldgen to fill), else null
  riverWaterLevel(x, z) { const rc = this.riverColumn(x, z); return rc ? rc.wl : null; }

  // is (x,z) within `pad` blocks of a river bank? Keeps trees/boulders/structures clear.
  nearRiver(x, z, pad = 0) {
    for (const r of this._riverProfile()) {
      const lim = (RIVER_HALF[r.size] || 2) + pad;
      if (x < r.minX - lim || x > r.maxX + lim || z < r.minZ - lim || z > r.maxZ + lim) continue;
      for (let i = 0; i < r.res.length - 1; i++) if (segDT(x, z, r.res[i].x, r.res[i].z, r.res[i + 1].x, r.res[i + 1].z)[0] < lim) return true;
    }
    return false;
  }

  // ---------- naming ----------
  locationName(x, z) {
    for (const lm of this.data.landmarks) if (lm.kind !== 'causeway' && Math.hypot(x - lm.x, z - lm.z) < 36) return lm.name;
    for (const v of this.villages) if (Math.hypot(x - v.x, z - v.z) < v.radius + 4) return v.name;
    if (this.coastT(x, z) > 0.75) return 'T’ North Sea';
    if (this.coastT(x, z) > 0.02) return 'T’ Heritage Coast';
    if (this.onRoad(x, z)) return 'Wade’s Causey';
    const rvn = this.riverColumn(x, z);
    if (rvn) return rvn.dale;
    return this.heightRaw(x, z) >= WATER_LEVEL + 18 ? 'T’ High Moor' : 'T’ Dale';
  }
}
