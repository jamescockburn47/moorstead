// The permanent way, provider-agnostic. Lifted verbatim from geography.js so both
// the stylised and the real-Moors worlds share one proven engine.
//   stations: [{name,x,z}]   heightFn: (x,z)=>blockY   villages: [{x,z,radius,buildings}]
// A Catmull-Rom alignment swept through the stations, with a smoothed,
// gradient-clamped (~1-in-8) vertical profile and village/building avoidance.
// Returns { pts:[{x,z,s,deck}], cells:Map, length, stationS:[] }.
import { WATER_LEVEL } from './defs.js';

// Cardinal basis (n/s or e/w) nearest a rail tangent. A station BUILDING stamped on
// this basis is a clean world-axis box even where the line runs diagonally — stamping
// on the raw tangent and rounding is what staircases the walls. Platforms stay
// rail-parallel; only the building uses this. `along` is the long axis, `across` its
// left-perpendicular; both are unit cardinals. Ties (45°) favour +x deterministically.
export function stationOrient(tx, tz) {
  const along = Math.abs(tx) >= Math.abs(tz) ? [Math.sign(tx) || 1, 0] : [0, Math.sign(tz) || 1];
  // left-perpendicular; guard the -0 that Math.sign yields so the basis is canonical
  const across = [along[1], along[0] === 0 ? 0 : -along[0]];
  return { along, across };
}

export function buildRailPath(stations, heightFn, villages, cardinalStations = false, riverFn = null) {
  const st = stations;
  // route-waypoints (flagged `via`) shape the curve along the coast but are NOT platform
  // stations — they get no straight run, no deck-levelling and no stationS entry.
  const realSt = st.filter(s => !s.via);
  // Control points: every station gets a STRAIGHT run through t' platform
  // (controls planted ±22 blocks along t' angle bisector), so curves sweep
  // out in open country between stops — not through folk's farmyards.
  // When cardinalStations is set (the real-Moors world), the run through the two
  // line ENDS (the termini — Pickering & Whitby, the big trainshed stations) is
  // snapped to the nearest cardinal (n/s or e/w), so their track, platform,
  // trainshed an' station house all square up. Intermediate stops keep their
  // natural alignment, so the through route doesn't bulge between stations.
  const unit = (ax, az) => { const L = Math.hypot(ax, az) || 1; return { x: ax / L, z: az / L }; };
  const cardOf = (d) => { const o = stationOrient(d.x, d.z).along; return { x: o[0], z: o[1] }; };
  const ctrl = [];
  let sIdx = 0;   // real-station index (via-waypoints don't count)
  for (let i = 0; i < st.length; i++) {
    if (st[i].via) { ctrl.push({ x: st[i].x, z: st[i].z }); continue; } // plain spline control — no platform
    if (i === 0) {
      let w = unit(st[1].x - st[0].x, st[1].z - st[0].z);
      if (cardinalStations) w = cardOf(w);
      ctrl.push({ x: st[0].x, z: st[0].z, station: sIdx, plat: true });
      ctrl.push({ x: st[0].x + w.x * 22, z: st[0].z + w.z * 22, plat: true });
    } else if (i === st.length - 1) {
      let u = unit(st[i].x - st[i - 1].x, st[i].z - st[i - 1].z);
      if (cardinalStations) u = cardOf(u);
      ctrl.push({ x: st[i].x - u.x * 22, z: st[i].z - u.z * 22, plat: true });
      ctrl.push({ x: st[i].x, z: st[i].z, station: sIdx, plat: true });
    } else {
      // intermediate stops keep their natural alignment — only the line ENDS
      // (the termini) are kinked to cardinal, so the through route doesn't bulge.
      const u = unit(st[i].x - st[i - 1].x, st[i].z - st[i - 1].z);
      const w = unit(st[i + 1].x - st[i].x, st[i + 1].z - st[i].z);
      const m = unit(u.x + w.x, u.z + w.z);
      ctrl.push({ x: st[i].x - m.x * 22, z: st[i].z - m.z * 22, plat: true });
      ctrl.push({ x: st[i].x, z: st[i].z, station: sIdx, plat: true });
      ctrl.push({ x: st[i].x + m.x * 22, z: st[i].z + m.z * 22, plat: true });
    }
    sIdx++;
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
    for (const vv of villages) {
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
    for (const vv of villages) {
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
  const stationS = new Array(realSt.length).fill(0);
  const stationIdx = new Array(realSt.length).fill(0);
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

  // precision pass: shove samples out o' (expanded) building boxes, smooth, re-measure
  const pinned = new Array(pts.length).fill(false);
  for (const si of stationIdx) {
    for (let i = Math.max(0, si - 8); i <= Math.min(pts.length - 1, si + 8); i++) pinned[i] = true;
  }
  for (let pass = 0; pass < 5; pass++) {
    let moved = false;
    for (const p of pts) {
      for (const vv of villages) {
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
    for (let r = 0; r < 2; r++) {
      for (let i = 1; i < pts.length - 1; i++) {
        if (pinned[i]) continue;
        pts[i].x = (pts[i - 1].x + pts[i].x * 2 + pts[i + 1].x) / 4;
        pts[i].z = (pts[i - 1].z + pts[i].z * 2 + pts[i + 1].z) / 4;
      }
    }
  }
  // strike any kinks t' shoving left behind (near-duplicate or doubling-back samples)
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
  const deck = pts.map(p => Math.max(heightFn(Math.round(p.x), Math.round(p.z)), WATER_LEVEL + 1));
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
  // ...then platforms forced dead level wi' their station ground, an' a final clamp
  const fixed = new Array(deck.length).fill(false);
  for (let si = 0; si < realSt.length; si++) {
    const g = heightFn(realSt[si].x, realSt[si].z);
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
  // Bridges: lift the deck to clear a river so the line BRIDGES it (not fords it) — away
  // from stations — then re-ramp the approaches up at 1-in-8 so they stay gentle.
  if (riverFn) {
    const nearStn = pts.map(p => stationS.some(ss => Math.abs(p.s - ss) < 30));
    for (let i = 0; i < deck.length; i++) {
      if (fixed[i] || nearStn[i]) continue;
      const wl = riverFn(Math.round(pts[i].x), Math.round(pts[i].z));
      if (wl != null) deck[i] = Math.max(deck[i], wl + 4); // ~4-block clearance for the arch
    }
    for (let i = 1; i < deck.length; i++) { if (fixed[i]) continue; const ds = pts[i].s - pts[i - 1].s; if (deck[i] < deck[i - 1] - maxg * ds) deck[i] = deck[i - 1] - maxg * ds; }
    for (let i = deck.length - 2; i >= 0; i--) { if (fixed[i]) continue; const ds = pts[i + 1].s - pts[i].s; if (deck[i] < deck[i + 1] - maxg * ds) deck[i] = deck[i + 1] - maxg * ds; }
  }
  for (let i = 0; i < pts.length; i++) pts[i].deck = deck[i];

  // spatial index: 8-block cells -> sample indices (for fast per-column lookup)
  const cells = new Map();
  for (let i = 0; i < pts.length; i++) {
    const k = `${Math.floor(pts[i].x / 8)},${Math.floor(pts[i].z / 8)}`;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(i);
  }
  return { pts, cells, length: s, stationS };
}

// position, heading an' deck height at chainage s along t' line
export function samplePos(path, s) {
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
  // TWO tangents, for two different needs:
  //  • tx,tz = the LOCAL segment direction — what the train BODIES square up to, so carriages sit
  //    straight on the rail beneath them and never crab.
  //  • stx,stz = a CENTRED-window tangent over ~±10 blocks — the path is a dense polyline whose
  //    per-segment direction steps at every vertex, so the RIDE CAMERA reads this smoothed heading
  //    instead, and the run feels continuous. Position is the exact lerp either way (rails don't move).
  const W = 5;
  const fa = pts[Math.max(0, lo - W)], fb = pts[Math.min(pts.length - 1, hi + W)];
  const wtx = fb.x - fa.x, wtz = fb.z - fa.z, wl = Math.hypot(wtx, wtz) || 1;
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    deck: a.deck + (b.deck - a.deck) * t,
    tx: (b.x - a.x) / ds, tz: (b.z - a.z) / ds,   // local — bodies sit square to the rail
    stx: wtx / wl, stz: wtz / wl,                 // smoothed — the camera's continuous heading
    grade: (b.deck - a.deck) / ds,
  };
}

// Nearest point on t' line: {d, along, deck, px, pz} | null (within ~6 blocks)
export function railInfo(path, x, z) {
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
        if (d < 6 && (!best || d < best.d)) {
          best = { d, along: a.s + Math.sqrt(L2) * t, deck: a.deck + (b.deck - a.deck) * t, px: a.x + dx * t, pz: a.z + dz * t };
        }
      }
    }
  }
  return best;
}
