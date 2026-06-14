// Deterministic check that tha can see out o' t' carriage — run wi':
//   node scripts/verify-train-view.mjs
// Builds t' REAL train (src/train.js) under Node, with no browser an' no GPU,
// then casts rays frae t' window seat. Three.js raycasting is plain CPU
// geometry — no WebGL context needed — so this runs in milliseconds an' slots
// into CI. It catches t' whole "camera looks at a solid wall" class o' bug
// without a single screenshot.
//
// A pane only counts as a blocker if it's OPAQUE: a clear, glazed window is
// exactly what we want the ray to pass through.
import * as THREE from 'three';
import { buildTrain } from '../src/train.js';

const train = buildTrain();
const car = train.carriage.group;
car.updateMatrixWorld(true);

const seat = train.seat.clone();            // (0.55, 2.2, -0.85) — t' rider's eye
const rc = new THREE.Raycaster();

let failed = false;
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const ok = m => console.log('  ok    ' + m);

console.log(`== carriage window view (seat at ${seat.x}, ${seat.y}, ${seat.z}) ==`);

// 1. sideways sightlines must reach the outside world — i.e. nowt OPAQUE
//    within three blocks either side of the seat.
const dirs = { left: [-1, 0, 0], right: [1, 0, 0] };
for (const [name, d] of Object.entries(dirs)) {
  rc.set(seat, new THREE.Vector3(...d).normalize());
  const blocker = rc.intersectObject(car, true).find(h => {
    const m = Array.isArray(h.object.material) ? h.object.material[0] : h.object.material;
    const opaque = !(m && m.transparent && m.opacity < 0.5);
    return opaque && h.distance < 3;
  });
  if (blocker) {
    const g = blocker.object;
    bad(`view ${name} blocked by ${g.name || g.geometry.type} @${blocker.distance.toFixed(2)} (opaque)`);
  } else {
    ok(`view ${name}: clear to the outside`);
  }
}

// 2. the windows must actually be glazed (transparent) — guards against
//    someone "fixing" the wall by deleting the glass, or making it opaque again.
let panes = 0;
car.traverse(o => {
  if (!o.isMesh) return;
  const m = Array.isArray(o.material) ? o.material[0] : o.material;
  if (m && m.transparent && m.opacity < 0.5) panes++;
});
if (panes < 6) bad(`only ${panes} transparent panes found — windows not glazed`);
else ok(`${panes} transparent panes glazed`);

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
