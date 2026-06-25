// The parish lanes — the road analogue of railpath.js. A deterministic route-graph
// computed from the village/station layout: each village joined to its two nearest
// neighbours and its nearest station, routed either by SHADOWING the rail (offset a few
// blocks off the engineered corridor) or by striking fresh across the open MOOR. Every
// route is nudged clear of the buildings, and the river/rail meetings are catalogued as
// flat-plank bridge + crossing spans. Pure, headless, cached on `geo` (see geography.js).
//
//   buildRoadNet(geo) -> { nodes:[{id,kind,name,x,z,radius?}], edges:[{from,to,kind,path,bridges,crossings}] }
//   roadInfo(net, x, z) -> { d, along, deck } | null   (nearest road within ~4 blocks)
//
// The road analogue keeps railpath's data shapes: path = { pts:[{x,z,s,deck}], length, cells }.
import { WATER_LEVEL } from './defs.js';

const ROAD_OFFSET = 6;     // shadow lanes sit this far off the rail centreline (clear o' the four-foot ≥5)
const RAIL_NEAR = 40;      // a village within this o' the rail counts as "rail-served"
const ROAD_GRADE = 1 / 6;  // roads climb steeper than rail (1-in-6 vs 1-in-8)
const RAIL_CROSS = 2;      // a path column within this o' the rail centreline is a level-crossing
const ROAD_REACH = 4;      // roadInfo answers within this many blocks (mirrors flora's 4-foot skip)
const MIN_STATION_LANE = 12; // a village's station lane goes to the nearest station ≥ this far (no zero-length lane to a halt sat on the town)
const BUILD_PAD = 1;       // building bbox inflation for the avoidance guard (matches the test)
const BUILD_MARGIN = 0.6;  // shove points this far PAST the inflated edge, so none sit on the line

// the building boxes a town puts down — real-Moors towns generate them lazily via
// _townBuildings; the stylised world carries them on v.buildings. Either way: [{x0,z0,x1,z1,...}]
function buildingsOf(geo, v) {
  if (typeof geo._townBuildings === 'function') {
    try { return geo._townBuildings(v) || []; } catch { return v.buildings || []; }
  }
  return v.buildings || [];
}

// surface height under a column, kept dry (mirrors railpath's deck floor)
function deckAt(geo, x, z) {
  return Math.max(geo.height(Math.round(x), Math.round(z)), WATER_LEVEL + 1);
}

// nearest rail path + chainage at a point, scanning every line so a lane can shadow whichever
// line runs nearest. Returns { path, along, d, deck } | null (within `maxD` blocks).
function nearestRail(geo, x, z, maxD = 24) {
  if (typeof geo.railPaths !== 'function') return null;
  let best = null;
  for (const { path } of geo.railPaths()) {
    const cells = path.cells;
    const cx = Math.floor(x / 8), cz = Math.floor(z / 8);
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gz = cz - 1; gz <= cz + 1; gz++) {
        const idxs = cells.get(`${gx},${gz}`);
        if (!idxs) continue;
        for (const i of idxs) {
          const a = path.pts[i], b = path.pts[Math.min(i + 1, path.pts.length - 1)];
          const dx = b.x - a.x, dz = b.z - a.z;
          const L2 = dx * dx + dz * dz || 0.001;
          let t = ((x - a.x) * dx + (z - a.z) * dz) / L2;
          t = Math.max(0, Math.min(1, t));
          const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
          if (d < maxD && (!best || d < best.d)) {
            best = { path, along: a.s + Math.sqrt(L2) * t, d, deck: a.deck + (b.deck - a.deck) * t };
          }
        }
      }
    }
  }
  return best;
}

// ---------- the network graph ----------
export function buildRoadNet(geo) {
  const villages = geo.villages || [];
  const nodes = [];
  // village nodes
  villages.forEach((v, i) => {
    nodes.push({ id: `v${i}`, kind: 'village', name: v.name, x: v.x, z: v.z, radius: v.radius || 28, v });
  });
  // station nodes — gathered from every line's stops, deduped by (rounded) position so a
  // shared junction (Grosmont) is one node. Classify each village rail-served vs remote.
  const stationNodes = [];
  const seenStn = new Map();
  if (typeof geo.railLines === 'function') {
    for (const line of geo.railLines()) {
      for (const stop of (line.stops || [])) {
        const key = `${Math.round(stop.x)},${Math.round(stop.z)}`;
        if (seenStn.has(key)) continue;
        const node = { id: `s${stationNodes.length}`, kind: 'station', name: stop.name || 'halt', x: stop.x, z: stop.z };
        seenStn.set(key, node);
        stationNodes.push(node);
        nodes.push(node);
      }
    }
  }
  // rail-served flag for villages (small railInfo at the centre)
  const villageNodes = nodes.filter(n => n.kind === 'village');
  for (const vn of villageNodes) {
    const ri = typeof geo.railInfo === 'function' ? geo.railInfo(Math.round(vn.x), Math.round(vn.z)) : null;
    const nr = nearestRail(geo, vn.x, vn.z, RAIL_NEAR + 10);
    vn.railServed = (ri && ri.d <= RAIL_NEAR) || (nr && nr.d <= RAIL_NEAR);
  }

  // edges: each village -> 2 nearest village neighbours + nearest station; dedupe undirected
  const edgeKeys = new Set();
  const rawEdges = [];
  const addEdge = (aId, bId) => {
    if (aId === bId) return;
    const key = aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    rawEdges.push({ from: aId, to: bId });
  };
  for (const vn of villageNodes) {
    // 2 nearest village neighbours
    const others = villageNodes
      .filter(o => o.id !== vn.id)
      .map(o => ({ o, d: Math.hypot(o.x - vn.x, o.z - vn.z) }))
      .sort((a, b) => a.d - b.d);
    for (let k = 0; k < Math.min(2, others.length); k++) addEdge(vn.id, others[k].o.id);
    // nearest station — but PREFER one you'd actually walk a lane to. In the real-Moors data
    // most halts sit on the very town marker, so the literal "nearest station" is the village's
    // own centre (a zero-length lane). Pick the nearest station at least MIN_STATION_LANE away;
    // fall back to the closest only if every station is coincident (keeps the station edge).
    if (stationNodes.length) {
      let real = null, realD = Infinity, any = null, anyD = Infinity;
      for (const sn of stationNodes) {
        const d = Math.hypot(sn.x - vn.x, sn.z - vn.z);
        if (d < anyD) { anyD = d; any = sn; }
        if (d >= MIN_STATION_LANE && d < realD) { realD = d; real = sn; }
      }
      const target = real || any;
      if (target) addEdge(vn.id, target.id);
    }
  }

  const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  const edges = [];
  for (const re of rawEdges) {
    const a = byId[re.from], b = byId[re.to];
    const path = routeEdge(geo, a, b);
    nudgeOutOfBuildings(path.pts, geo, villages);
    remeasure(path);
    bakeDeck(path, geo);
    const { bridges, crossings } = annotate(path, geo);
    edges.push({ from: re.from, to: re.to, kind: path.kind, path, bridges, crossings });
  }

  const net = { nodes, edges };
  buildCells(net);
  return net;
}

// ---------- per-edge routing ----------
// shadow when the rail runs between the two ends on ONE line; else strike across the moor.
function routeEdge(geo, a, b) {
  const railA = nearestRail(geo, a.x, a.z, RAIL_NEAR + 10);
  const railB = nearestRail(geo, b.x, b.z, RAIL_NEAR + 10);
  if (railA && railB && railA.path === railB.path && Math.abs(railA.along - railB.along) > 12) {
    return shadowRoute(geo, a, b, railA, railB);
  }
  return moorRoute(geo, a, b);
}

// SHADOW: sample the rail path between the two chainages, offset perpendicular (-tz,tx) by
// ROAD_OFFSET to one side, then graft short free legs onto the actual node centres so the lane
// still reaches the green / the platform. `deck` left for bakeDeck.
function shadowRoute(geo, a, b, railA, railB) {
  const path = railA.path;
  let s0 = railA.along, s1 = railB.along;
  const flip = s0 > s1;
  if (flip) { const t = s0; s0 = s1; s1 = t; }
  const STEP = 2;
  const railPts = [];
  for (let s = s0; s <= s1; s += STEP) railPts.push(geo.samplePosOn(path, s));
  railPts.push(geo.samplePosOn(path, s1));
  if (flip) railPts.reverse();
  // offset each to one side of travel (perpendicular (-tz,tx)); a consistent side along the run
  const offset = railPts.map((rp, i) => {
    const prev = railPts[Math.max(0, i - 1)], next = railPts[Math.min(railPts.length - 1, i + 1)];
    let tx = next.x - prev.x, tz = next.z - prev.z;
    const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
    return { x: rp.x + (-tz) * ROAD_OFFSET, z: rp.z + (tx) * ROAD_OFFSET };
  });
  // The shadow SPINE is the offset rail line; the lane reaches the node centres by a short
  // CONNECTOR leg at each end, sampled at the same ~2-block density so the spine dominates the
  // array (the mid-index — which the verify checks — lands on the spine, hard by the rail).
  const leg = (from, to) => {
    const L = Math.hypot(to.x - from.x, to.z - from.z);
    const n = Math.max(1, Math.round(L / STEP));
    const seg = [];
    for (let k = 0; k < n; k++) { const t = k / n; seg.push({ x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t }); }
    return seg;
  };
  const head = leg({ x: a.x, z: a.z }, offset[0]);
  const tail = leg(offset[offset.length - 1], { x: b.x, z: b.z });
  const pts = stripDup([...head, ...offset, ...tail, { x: b.x, z: b.z }]);
  // a couple of gentle averaging passes ONLY at the two joins, so the connector doesn't kink off
  // the spine — interior spine points stay put (still hugging the rail).
  smoothJoins(pts, head.length, head.length + offset.length);
  measure(pts);
  return { pts, kind: 'shadow', length: pts[pts.length - 1].s };
}

// soften the two connector/spine joins without disturbing the spine interior
function smoothJoins(pts, j0, j1) {
  const soft = (lo, hi) => {
    for (let r = 0; r < 2; r++) {
      for (let i = Math.max(1, lo); i < Math.min(pts.length - 1, hi); i++) {
        pts[i].x = (pts[i - 1].x + pts[i].x * 2 + pts[i + 1].x) / 4;
        pts[i].z = (pts[i - 1].z + pts[i].z * 2 + pts[i + 1].z) / 4;
      }
    }
  };
  soft(j0 - 3, j0 + 3);
  soft(j1 - 3, j1 + 3);
}

// MOOR: a Catmull-Rom alignment through the two ends, terrain-following via bakeDeck. Plain
// straight-ish lane in plan; the vertical road-grade clamp is applied in bakeDeck.
function moorRoute(geo, a, b) {
  // a couple of intermediate control points so the spline can bend round the worst water/steps
  const ctrl = [{ x: a.x, z: a.z }];
  const N = 3;
  for (let k = 1; k < N; k++) {
    const t = k / N;
    let x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
    // nudge a control off open sea toward shallower ground (cheap: sample a small ring)
    if (typeof geo.coastT === 'function' && geo.coastT(Math.round(x), Math.round(z)) > 0.4) {
      let best = null, bd = Infinity;
      for (let r = 6; r <= 48; r += 6) for (let aa = 0; aa < 360; aa += 30) {
        const px = x + Math.cos(aa * Math.PI / 180) * r, pz = z + Math.sin(aa * Math.PI / 180) * r;
        if (geo.coastT(Math.round(px), Math.round(pz)) <= 0.2) {
          const d = Math.hypot(px - x, pz - z);
          if (d < bd) { bd = d; best = { x: px, z: pz }; }
        }
      }
      if (best) { x = best.x; z = best.z; }
    }
    ctrl.push({ x, z });
  }
  ctrl.push({ x: b.x, z: b.z });
  const out = catmull(stripDup(ctrl), 2);
  measure(out);
  return { pts: out, kind: 'moor', length: out[out.length - 1].s };
}

// ---------- building avoidance (the key requirement) ----------
// Push any sample out of every inflated building bbox, then a light averaging pass so the nudge
// isn't a kink. After this NO sample lies inside any (pad=1) inflated bbox.
//
// The hard part: abutting buildings (e.g. a pub and a chapel sharing the village-centre line)
// form a WALL. Escaping one box's nearest edge can land in its neighbour, and a naive "nearest
// edge of the box I'm in" loop ping-pongs between the two forever. So `escapePoint` evaluates a
// candidate exit against ALL boxes and picks one that is free of the lot (preferring the
// shortest such move) — stepping perpendicular to a wall when the along-wall exit is blocked.
function escapePoint(p, boxes) {
  for (let guard = 0; guard < 96; guard++) {
    let hit = null;
    for (const b of boxes) {
      if (p.x > b.x0 && p.x < b.x1 && p.z > b.z0 && p.z < b.z1) { hit = b; break; }
    }
    if (!hit) return;
    // four candidate exits from the box we're in
    const cands = [
      { x: hit.x0 - BUILD_MARGIN, z: p.z, c: p.x - hit.x0 },
      { x: hit.x1 + BUILD_MARGIN, z: p.z, c: hit.x1 - p.x },
      { x: p.x, z: hit.z0 - BUILD_MARGIN, c: p.z - hit.z0 },
      { x: p.x, z: hit.z1 + BUILD_MARGIN, c: hit.z1 - p.z },
    ];
    const free = c => boxes.every(b => !(c.x > b.x0 && c.x < b.x1 && c.z > b.z0 && c.z < b.z1));
    // prefer the shortest move that lands FREE of every box; else the shortest move that at least
    // leaves the current box (the guard loop then clears whatever it lands in next)
    const clear = cands.filter(free).sort((a, b) => a.c - b.c);
    const pick = clear.length ? clear[0] : cands.sort((a, b) => a.c - b.c)[0];
    p.x = pick.x; p.z = pick.z;
    if (clear.length) return;
  }
}

export function nudgeOutOfBuildings(pts, geo, villages) {
  villages = villages || geo.villages || [];
  const boxes = [];
  for (const v of villages) {
    for (const b of buildingsOf(geo, v)) {
      boxes.push({ x0: b.x0 - BUILD_PAD, x1: b.x1 + BUILD_PAD, z0: b.z0 - BUILD_PAD, z1: b.z1 + BUILD_PAD });
    }
  }
  if (!boxes.length || pts.length < 2) return;
  for (let pass = 0; pass < 8; pass++) {
    let any = false;
    for (const p of pts) {
      const inside = boxes.some(b => p.x > b.x0 && p.x < b.x1 && p.z > b.z0 && p.z < b.z1);
      if (inside) { escapePoint(p, boxes); any = true; }
    }
    if (!any) break;
    // re-smooth interior points (endpoints pinned to the node centres)
    for (let r = 0; r < 2; r++) {
      for (let i = 1; i < pts.length - 1; i++) {
        pts[i].x = (pts[i - 1].x + pts[i].x * 2 + pts[i + 1].x) / 4;
        pts[i].z = (pts[i - 1].z + pts[i].z * 2 + pts[i + 1].z) / 4;
      }
    }
  }
  // FINAL hard pass after smoothing (smoothing can drag a point back into a box). No re-smooth
  // after, so the guard holds EXACTLY — every point ends free of all boxes.
  for (const p of pts) escapePoint(p, boxes);
}

// ---------- vertical profile (deck) ----------
// terrain under the lane, smoothed, road-grade-clamped (1-in-6), kept dry. Mirrors railpath's
// profile but with the steeper road grade and no platform levelling.
function bakeDeck(path, geo) {
  const pts = path.pts;
  const deck = pts.map(p => deckAt(geo, p.x, p.z));
  // smooth twice (short window — lanes hug the ground more than the rail)
  for (let pass = 0; pass < 2; pass++) {
    const w = 6, sm = deck.slice();
    for (let i = 0; i < deck.length; i++) {
      let acc = 0, cnt = 0;
      for (let j = Math.max(0, i - w); j <= Math.min(deck.length - 1, i + w); j++) { acc += deck[j]; cnt++; }
      sm[i] = acc / cnt;
    }
    for (let i = 0; i < deck.length; i++) deck[i] = sm[i];
  }
  // grade-clamp forward + back to 1-in-6
  for (let i = 1; i < deck.length; i++) {
    const ds = pts[i].s - pts[i - 1].s || 0.001;
    deck[i] = Math.min(deck[i], deck[i - 1] + ROAD_GRADE * ds);
    deck[i] = Math.max(deck[i], deck[i - 1] - ROAD_GRADE * ds);
  }
  for (let i = deck.length - 2; i >= 0; i--) {
    const ds = pts[i + 1].s - pts[i].s || 0.001;
    deck[i] = Math.min(deck[i], deck[i + 1] + ROAD_GRADE * ds);
    deck[i] = Math.max(deck[i], deck[i + 1] - ROAD_GRADE * ds);
  }
  for (let i = 0; i < deck.length; i++) deck[i] = Math.max(deck[i], WATER_LEVEL + 1);
  for (let i = 0; i < pts.length; i++) pts[i].deck = deck[i];
}

// ---------- bridge + crossing spans, river-deck flattening ----------
// scan the path by chainage: a contiguous run over a river -> a {s0,s1} bridge (its pts.deck
// flattened to a level plank = max bank height +1); a column within RAIL_CROSS of the rail
// centreline -> a {s} crossing.
function annotate(path, geo) {
  const pts = path.pts;
  const bridges = [];
  const crossings = [];
  const hasRiver = typeof geo.riverColumn === 'function';
  const hasRail = typeof geo.railInfo === 'function';
  // rivers: find contiguous over-water runs
  if (hasRiver) {
    let run = null;
    const flush = () => {
      if (!run) return;
      // flat plank deck = max bank (just off each end) +1
      const i0 = run.i0, i1 = run.i1;
      const bank0 = i0 > 0 ? pts[i0 - 1].deck : pts[i0].deck;
      const bank1 = i1 < pts.length - 1 ? pts[i1 + 1].deck : pts[i1].deck;
      const plank = Math.max(bank0, bank1, WATER_LEVEL + 1) + 1;
      for (let i = i0; i <= i1; i++) pts[i].deck = plank;
      bridges.push({ s0: pts[i0].s, s1: pts[i1].s });
      run = null;
    };
    for (let i = 0; i < pts.length; i++) {
      const over = !!geo.riverColumn(Math.round(pts[i].x), Math.round(pts[i].z));
      if (over) {
        if (!run) run = { i0: i, i1: i };
        else run.i1 = i;
      } else if (run) flush();
    }
    flush();
  }
  // rail crossings: a column that sits on the rail centreline (de-duped so one crossing isn't
  // logged for every dense sample over it)
  if (hasRail) {
    let lastCrossS = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const ri = geo.railInfo(Math.round(pts[i].x), Math.round(pts[i].z));
      if (ri && ri.d < RAIL_CROSS && pts[i].s - lastCrossS > 6) {
        crossings.push({ s: pts[i].s });
        lastCrossS = pts[i].s;
      }
    }
  }
  return { bridges, crossings };
}

// ---------- spatial index + lookup (mirrors railpath cells/railInfo) ----------
function buildCells(net) {
  for (const e of net.edges) {
    const pts = e.path.pts;
    const cells = new Map();
    for (let i = 0; i < pts.length; i++) {
      const k = `${Math.floor(pts[i].x / 8)},${Math.floor(pts[i].z / 8)}`;
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(i);
    }
    e.path.cells = cells;
  }
}

// nearest road across ALL edges: { d, along, deck } | null (within ROAD_REACH blocks)
export function roadInfo(net, x, z) {
  let best = null;
  const cx = Math.floor(x / 8), cz = Math.floor(z / 8);
  for (const e of net.edges) {
    const path = e.path;
    if (!path.cells) continue;
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
          if (d < ROAD_REACH && (!best || d < best.d)) {
            best = { d, along: a.s + Math.sqrt(L2) * t, deck: a.deck + (b.deck - a.deck) * t };
          }
        }
      }
    }
  }
  return best;
}

// ---------- small geometry helpers ----------
// remove near-duplicate consecutive control points (a spline through dups kinks)
function stripDup(pts) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const p = out[out.length - 1];
    if (Math.hypot(pts[i].x - p.x, pts[i].z - p.z) > 1) out.push(pts[i]);
  }
  if (out.length < 2) out.push(pts[pts.length - 1]);
  return out;
}

// Catmull-Rom through control points, ~`per`-block sampling, with phantom ends. Returns
// fresh {x,z} samples (chainage added by measure()).
function catmull(route, per) {
  if (route.length < 2) return route.map(p => ({ x: p.x, z: p.z }));
  const P = [
    { x: 2 * route[0].x - route[1].x, z: 2 * route[0].z - route[1].z },
    ...route,
    { x: 2 * route[route.length - 1].x - route[route.length - 2].x, z: 2 * route[route.length - 1].z - route[route.length - 2].z },
  ];
  const pts = [{ x: route[0].x, z: route[0].z }];
  for (let i = 1; i < P.length - 2; i++) {
    const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
    const approx = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const n = Math.max(2, Math.ceil(approx / per));
    for (let k = 1; k <= n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const cr = (a, b, c, d) =>
        0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      pts.push({ x: cr(p0.x, p1.x, p2.x, p3.x), z: cr(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  return pts;
}

// (re)compute cumulative chainage `s` on a pts array
function measure(pts) {
  pts[0].s = 0;
  for (let i = 1; i < pts.length; i++) {
    pts[i].s = pts[i - 1].s + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  }
  return pts;
}
function remeasure(path) {
  measure(path.pts);
  path.length = path.pts[path.pts.length - 1].s;
}
