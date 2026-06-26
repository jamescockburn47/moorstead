// Deterministic check o' t' Moors road network — run wi': node scripts/verify-roads.mjs
// The road analogue of verify-rail.mjs: builds the real-Moors Geography, computes the
// road route-graph (buildRoadNet), and checks the graph + routing + the KEY guard that
// no road point cuts through a building.
//   1. graph connected (BFS from village 0 reaches every village)
//   2. every village has an edge to a station node
//   3. each routed edge's ends sit near the two node centres
//   4. a shadow edge's mid-point sits near the rail
//   5. NO road point lies inside any inflated building bbox  (the avoidance guard)
//   7. roadInfo non-null on a known on-track point, null well off it
import { MoorsGeography } from '../src/moorsgeo.js';
import { buildRoadNet, roadInfo } from '../src/roadpath.js';

let failed = false;
let asserts = 0;
const bad = m => { failed = true; asserts++; console.log('  FAIL  ' + m); };
const ok = m => { asserts++; console.log('  ok    ' + m); };

const geo = new MoorsGeography();
const net = buildRoadNet(geo);

console.log(`\n== real-Moors road network ==`);
console.log(`  nodes: ${net.nodes.length} (villages + stations)  edges: ${net.edges.length}`);

// the building bboxes the routing must avoid — real-Moors towns generate them lazily
function buildingsOf(v) {
  if (geo._townBuildings) return geo._townBuildings(v);
  return v.buildings || [];
}

// TRUE perpendicular distance to the nearest rail across all lines (uncapped — geo.railInfo
// stops at 6 blocks, which can't even measure the ~6-block shadow offset). Scans every line's
// dense polyline directly.
function railDist(x, z) {
  let best = Infinity;
  for (const { path } of geo.railPaths()) {
    const pts = path.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1e-6;
      let t = ((x - a.x) * dx + (z - a.z) * dz) / L2; t = Math.max(0, Math.min(1, t));
      best = Math.min(best, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)));
    }
  }
  return best;
}
const allBuildings = [];
for (const v of geo.villages) for (const b of buildingsOf(v)) allBuildings.push(b);

// ---- 1. graph connectivity (village nodes reachable via edges) ----
const villageNodes = net.nodes.filter(n => n.kind === 'village');
{
  const idOf = n => n.id;
  const adj = new Map();
  for (const n of net.nodes) adj.set(n.id, []);
  for (const e of net.edges) { adj.get(e.from).push(e.to); adj.get(e.to).push(e.from); }
  const start = villageNodes[0].id;
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const cur = stack.pop();
    for (const nb of adj.get(cur) || []) if (!seen.has(nb)) { seen.add(nb); stack.push(nb); }
  }
  const unreachedV = villageNodes.filter(n => !seen.has(n.id));
  if (unreachedV.length) bad(`graph not connected: ${unreachedV.map(n => n.name).join(', ')} unreachable`);
  else ok(`graph connected — all ${villageNodes.length} villages reachable from ${villageNodes[0].name}`);
}

// ---- 2. every village has an edge to a station node ----
{
  const stationIds = new Set(net.nodes.filter(n => n.kind === 'station').map(n => n.id));
  let missing = 0;
  for (const v of villageNodes) {
    const hasStn = net.edges.some(e =>
      (e.from === v.id && stationIds.has(e.to)) || (e.to === v.id && stationIds.has(e.from)));
    if (!hasStn) { bad(`${v.name} has no edge to a station`); missing++; }
  }
  if (!missing) ok('every village has a station edge');
}

// ---- 3. routed edges reach their node centres ----
{
  const byId = Object.fromEntries(net.nodes.map(n => [n.id, n]));
  let off = 0;
  for (const e of net.edges) {
    if (!e.path || !e.path.pts || !e.path.pts.length) { bad('edge has no routed path'); off++; continue; }
    const a = byId[e.from], b = byId[e.to];
    const p0 = e.path.pts[0], p1 = e.path.pts[e.path.pts.length - 1];
    // endpoints may attach to either end (undirected); take the nearer pairing
    const tolA = (a.kind === 'village' ? a.radius : 12) + 6;
    const tolB = (b.kind === 'village' ? b.radius : 12) + 6;
    const dStart = Math.min(Math.hypot(p0.x - a.x, p0.z - a.z), Math.hypot(p0.x - b.x, p0.z - b.z));
    const dEnd = Math.min(Math.hypot(p1.x - a.x, p1.z - a.z), Math.hypot(p1.x - b.x, p1.z - b.z));
    if (dStart > Math.max(tolA, tolB) || dEnd > Math.max(tolA, tolB)) {
      bad(`edge ${a.name}->${b.name} ends ${dStart.toFixed(0)}/${dEnd.toFixed(0)} off the node centres`);
      off++;
    }
  }
  if (!off) ok('every routed edge reaches its node centres');
}

// ---- 4. shadow edge mid-point hugs the rail ----
{
  const shadows = net.edges.filter(e => e.kind === 'shadow');
  if (!shadows.length) {
    ok('(no shadow edges to check)');
  } else {
    let strayed = 0;
    for (const e of shadows) {
      const mid = e.path.pts[Math.floor(e.path.pts.length / 2)];
      // a true shadow sits ~ROAD_OFFSET (6) off the rail; allow a little slack for the join/bend
      if (railDist(mid.x, mid.z) > 12) { strayed++; }
    }
    if (strayed) bad(`${strayed}/${shadows.length} shadow edges stray >12 blocks from the rail at mid-span`);
    else ok(`all ${shadows.length} shadow edges hug the rail at mid-span (~6-block offset)`);
  }
}

// ---- 5. THE GUARD: no road point inside any inflated building bbox ----
{
  let inside = 0, worst = null;
  for (const e of net.edges) {
    for (const p of e.path.pts) {
      for (const b of allBuildings) {
        if (p.x > b.x0 - 1 && p.x < b.x1 + 1 && p.z > b.z0 - 1 && p.z < b.z1 + 1) {
          inside++;
          if (!worst) worst = { x: p.x, z: p.z, b };
        }
      }
    }
  }
  if (inside) bad(`${inside} road points lie inside an inflated building bbox (e.g. (${worst.x.toFixed(1)},${worst.z.toFixed(1)}) in a ${worst.b.type || 'building'})`);
  else ok(`no road point inside any inflated building bbox (${allBuildings.length} buildings checked)`);
}

// ---- 7. roadInfo on-track non-null, off-track null ----
{
  // pick a point right on a routed edge
  const e = net.edges.find(ed => ed.path && ed.path.pts.length > 4);
  const onPt = e.path.pts[Math.floor(e.path.pts.length / 2)];
  const onInfo = roadInfo(net, Math.round(onPt.x), Math.round(onPt.z));
  if (onInfo && onInfo.d <= 2) ok(`roadInfo non-null on a known on-track point (d=${onInfo.d.toFixed(2)})`);
  else bad(`roadInfo returned ${onInfo ? 'd=' + onInfo.d.toFixed(2) : 'null'} on a known on-track point`);
  // a point far off any road (push 200 blocks perpendicular into nowhere)
  const offInfo = roadInfo(net, Math.round(onPt.x) + 5000, Math.round(onPt.z) + 5000);
  if (offInfo === null) ok('roadInfo null well off any road');
  else bad(`roadInfo non-null (d=${offInfo.d.toFixed(2)}) far off any road`);
}

// ---- 8. exposed on geo: roadPaths() routed + cached, roadInfo() delegates ----
{
  const rp1 = geo.roadPaths();
  const rp2 = geo.roadPaths();
  if (Array.isArray(rp1) && rp1.length && rp1[0].path && rp1[0].path.pts) ok(`geo.roadPaths() returns ${rp1.length} routed edges`);
  else bad('geo.roadPaths() did not return routed edges');
  if (rp1 === rp2) ok('geo.roadPaths() is cached (same ref on 2nd call)');
  else bad('geo.roadPaths() not cached (different ref on 2nd call)');
  // geo.roadInfo delegates to the same net — on a known on-track point it is non-null
  const e = rp1.find(ed => ed.path && ed.path.pts.length > 4);
  const onPt = e.path.pts[Math.floor(e.path.pts.length / 2)];
  const gi = geo.roadInfo(Math.round(onPt.x), Math.round(onPt.z));
  if (gi && gi.d <= 2) ok(`geo.roadInfo() delegates (on-track d=${gi.d.toFixed(2)})`);
  else bad(`geo.roadInfo() returned ${gi ? 'd=' + gi.d.toFixed(2) : 'null'} on a known on-track point`);
  if (geo.roadInfo(Math.round(onPt.x) + 5000, Math.round(onPt.z) + 5000) === null) ok('geo.roadInfo() null well off any road');
  else bad('geo.roadInfo() non-null far off any road');
}

console.log(`\n${asserts} assertions`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
