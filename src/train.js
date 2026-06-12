// T' Moors Railway steam train, built proper: loco, tender an' carriage as
// separate bodies that bend through t' curves, wi' spoked drivers, working
// coupling rods, a rounded boiler an' a carmine NYMR-style carriage.
// Local +z = direction of travel for every part.
import * as THREE from 'three';

const BLACK = 0x16161a, IRON = 0x2a2a30, BRASS = 0xb8923a, RED = 0x7a1f1f,
  CARMINE = 0x8a2430, CREAM = 0xe8dfc8, ROOF = 0x3a3a40, COAL = 0x111114,
  STEEL = 0x8a8a92, GLASS = 0xaccadd;

function box(w, h, d, color, group, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z);
  group.add(m);
  return m;
}

function cyl(r, len, color, group, x, y, z, axis = 'z', seg = 14) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), new THREE.MeshLambertMaterial({ color }));
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  else if (axis === 'x') m.rotation.z = Math.PI / 2;
  m.position.set(x, y, z);
  group.add(m);
  return m;
}

// a spoked driving wheel: rim, hub, six spokes an' a crank pin
function driver(r, color, group, x, y, z) {
  const w = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.07, 8, 20), new THREE.MeshLambertMaterial({ color }));
  w.add(rim);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.14, 8), new THREE.MeshLambertMaterial({ color: STEEL }));
  hub.rotation.z = Math.PI / 2;
  w.add(hub);
  for (let i = 0; i < 6; i++) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.05, r * 1.9, 0.05), new THREE.MeshLambertMaterial({ color }));
    sp.rotation.x = (i / 6) * Math.PI;
    w.add(sp);
  }
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 6), new THREE.MeshLambertMaterial({ color: STEEL }));
  pin.rotation.z = Math.PI / 2;
  pin.position.set(0, 0, r * 0.55); // crank offset, spins wi' t' wheel
  w.add(pin);
  w.rotation.y = Math.PI / 2; // wheel face out t' side
  w.position.set(x, y, z);
  w.userData.r = r; // so t' game spins each wheel at its true rate
  group.add(w);
  return w;
}

function buildLoco() {
  const g = new THREE.Group();
  box(2.2, 0.45, 6.2, IRON, g, 0, 0.62, 0);                   // frames
  box(2.0, 0.7, 0.22, RED, g, 0, 0.85, 3.15);                 // buffer beam
  for (const s of [-1, 1]) cyl(0.09, 0.4, STEEL, g, s * 0.7, 0.85, 3.3, 'z', 8); // buffers
  // boiler, smokebox, firebox
  cyl(0.86, 3.4, BLACK, g, 0, 1.92, 0.9);                     // boiler barrel
  cyl(0.9, 0.7, IRON, g, 0, 1.92, 2.7);                       // smokebox
  cyl(0.92, 0.1, IRON, g, 0, 1.92, 3.06, 'z', 18);            // smokebox door rim
  box(1.9, 1.5, 1.4, BLACK, g, 0, 1.6, -0.9);                 // firebox shoulders
  box(1.7, 0.22, 3.8, BLACK, g, 0, 1.05, 0.9);                // running board
  // funnel wi' a capped lip, dome an' safety valve
  cyl(0.24, 0.85, BLACK, g, 0, 3.05, 2.55, 'y', 12);
  cyl(0.32, 0.16, BLACK, g, 0, 3.5, 2.55, 'y', 12);
  const fn = new THREE.Vector3(0, 3.62, 2.55);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: BRASS }));
  dome.position.set(0, 2.62, 0.9); g.add(dome);
  cyl(0.16, 0.3, BRASS, g, 0, 2.75, -0.1, 'y', 8);            // safety valve
  // cab wi' a rounded roof an' glazed spectacles
  box(2.1, 1.3, 1.7, BLACK, g, 0, 1.95, -2.2);
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(1.18, 1.18, 1.9, 12, 1, false, Math.PI * 0.62, Math.PI * 0.76),
    new THREE.MeshLambertMaterial({ color: ROOF }));
  roof.rotation.x = Math.PI / 2; roof.position.set(0, 2.45, -2.2); g.add(roof);
  for (const s of [-1, 1]) {
    box(0.05, 0.42, 0.42, GLASS, g, s * 1.06, 2.35, -1.85);   // cab glasses
    box(0.05, 0.5, 1.6, BLACK, g, s * 1.05, 2.85, -2.2);      // cab sides up
  }
  // motion: three spoked drivers a side, coupled by a rod on crank pins
  const wheels = [], rods = [];
  for (const s of [-1, 1]) {
    const drs = [];
    for (let i = 0; i < 3; i++) drs.push(driver(0.62, IRON, g, s * 1.08, 0.62, 1.5 - i * 1.3));
    wheels.push(...drs);
    const rod = box(0.07, 0.11, 2.9, STEEL, g, s * 1.18, 0.62, 0.2);
    rods.push(rod);
    // cylinders an' slide bars at t' front
    cyl(0.22, 0.9, IRON, g, s * 0.85, 0.75, 2.6, 'z', 10);
  }
  // lamp on t' beam
  box(0.22, 0.3, 0.22, CREAM, g, 0, 1.25, 3.2);
  return { group: g, wheels, rods, funnel: fn, length: 6.4 };
}

function buildTender() {
  const g = new THREE.Group();
  box(2.1, 0.4, 3.4, IRON, g, 0, 0.62, 0);
  box(2.1, 1.4, 3.2, BLACK, g, 0, 1.5, 0);
  box(1.7, 0.45, 2.4, COAL, g, 0, 2.3, 0.1);                  // heaped coal
  const wheels = [];
  for (const s of [-1, 1]) for (let i = 0; i < 2; i++) {
    wheels.push(driver(0.45, IRON, g, s * 1.0, 0.45, 0.75 - i * 1.5));
  }
  return { group: g, wheels, length: 3.6 };
}

function buildCarriage() {
  const g = new THREE.Group();
  const W = 2.4, L = 7.2;
  box(W, 0.22, L, IRON, g, 0, 1.0, 0);                        // floor
  // body: carmine below t' waist, cream above, pillars between t' lights
  box(W, 0.9, L, CARMINE, g, 0, 1.55, 0);
  box(W - 0.06, 0.9, L, CREAM, g, 0, 2.45, 0);
  for (const s of [-1, 1]) {
    for (let i = 0; i <= 5; i++) {
      box(0.1, 0.95, 0.34, CARMINE, g, s * (W / 2), 2.45, -L / 2 + 0.3 + i * (L - 0.6) / 5);
    }
    // glazing strip behind t' pillars
    box(0.04, 0.7, L - 0.7, GLASS, g, s * (W / 2 - 0.06), 2.45, 0);
    box(0.1, 0.12, L, BRASS, g, s * (W / 2), 1.98, 0);        // waist beading
  }
  box(W, 1.9, 0.14, CARMINE, g, 0, 1.95, -L / 2);             // ends
  box(W, 1.9, 0.14, CARMINE, g, 0, 1.95, L / 2);
  // rounded roof
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, L + 0.25, 14, 1, false, Math.PI * 0.65, Math.PI * 0.7),
    new THREE.MeshLambertMaterial({ color: ROOF }));
  roof.rotation.x = Math.PI / 2; roof.position.set(0, 2.6, 0); g.add(roof);
  // benches inside
  for (const zz of [1.4, -1.4]) {
    box(1.8, 0.25, 0.9, 0x5a3a2a, g, 0, 1.32, zz);
    box(1.8, 0.75, 0.18, 0x5a3a2a, g, 0, 1.65, zz + (zz > 0 ? 0.45 : -0.45));
  }
  // bogies: four little wheels at each end
  const wheels = [];
  for (const ze of [2.6, -2.6]) {
    box(1.6, 0.3, 1.3, IRON, g, 0, 0.5, ze);
    for (const s of [-1, 1]) for (let i = 0; i < 2; i++) {
      wheels.push(driver(0.34, IRON, g, s * 1.0, 0.34, ze + 0.45 - i * 0.9));
    }
  }
  const seat = new THREE.Vector3(0.55, 2.2, -0.6);
  return { group: g, wheels, seat, length: 7.6 };
}

// T' whole rake as articulated parts. Each part carries a chainage offset
// frae t' schedule position; t' game poses each at its own spot on t' spline
// so she bends honestly through t' curves.
export function buildTrain() {
  const loco = buildLoco();
  const tender = buildTender();
  const carriage = buildCarriage();
  return {
    parts: [
      { ...loco, offset: 0 },        // schedule chainage = loco centre
      { ...tender, offset: -5.3 },
      { ...carriage, offset: -11.2 },
    ],
    funnel: loco.funnel,
    seat: carriage.seat,
    loco, tender, carriage,
  };
}
