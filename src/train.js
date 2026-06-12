// T' Moors Railway steam train: a proper black loco, tender an' carmine
// carriage, built block by block. Tha sits inside an' watches t' moor go by.
import * as THREE from 'three';

function box(w, h, d, color, group, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z);
  group.add(m);
  return m;
}

function cyl(r, len, color, group, x, y, z, alongZ = true) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), new THREE.MeshLambertMaterial({ color }));
  if (alongZ) m.rotation.x = Math.PI / 2;
  else m.rotation.z = Math.PI / 2;
  m.position.set(x, y, z);
  group.add(m);
  return m;
}

// Builds t' whole rake. Local +z = direction of travel.
// Returns { group, seat (Vector3, local), funnel (Vector3, local), wheels[] }
export function buildTrain() {
  const g = new THREE.Group();
  const BLACK = 0x16161a, IRON = 0x2a2a30, BRASS = 0xb8923a, RED = 0x7a1f1f,
    CARMINE = 0x8a2430, CREAM = 0xe8dfc8, ROOF = 0x3a3a40, COAL = 0x111114;

  // ---- locomotive (front, +z) ----
  const lz = 5.0; // loco centre
  box(2.2, 0.5, 5.6, IRON, g, 0, 0.65, lz);             // frames
  cyl(0.85, 3.6, BLACK, g, 0, 1.9, lz + 0.5);           // boiler
  box(1.7, 0.25, 3.6, BLACK, g, 0, 1.05, lz + 0.5);     // running board
  cyl(0.88, 0.3, IRON, g, 0, 1.9, lz + 2.35);           // smokebox door
  cyl(0.28, 1.0, BLACK, g, 0, 3.1, lz + 1.9);           // funnel
  const fn = new THREE.Vector3(0, 3.7, lz + 1.9);       // smoke point
  cyl(0.42, 0.5, BRASS, g, 0, 2.85, lz + 0.6);          // brass dome
  cyl(0.3, 0.35, BRASS, g, 0, 2.75, lz - 0.3);          // safety valve
  // cab
  box(2.1, 2.0, 1.6, BLACK, g, 0, 2.2, lz - 1.8);
  box(2.3, 0.18, 1.9, ROOF, g, 0, 3.25, lz - 1.8);
  box(0.06, 0.5, 0.5, CREAM, g, -1.04, 2.5, lz - 1.8);  // cab window glints
  box(0.06, 0.5, 0.5, CREAM, g, 1.04, 2.5, lz - 1.8);
  box(2.0, 0.7, 0.2, RED, g, 0, 0.85, lz + 3.0);        // buffer beam
  // wheels: 3 big drivers per side + leading
  const wheels = [];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      wheels.push(cyl(0.62, 0.18, IRON, g, s * 1.05, 0.62, lz + 0.9 - i * 1.15, false));
    }
  }
  // coupling rods (static, cosmetic)
  for (const s of [-1, 1]) box(0.08, 0.12, 2.4, 0x8a8a92, g, s * 1.15, 0.62, lz - 0.25);

  // ---- tender ----
  const tz = 1.2;
  box(2.1, 1.5, 2.4, BLACK, g, 0, 1.45, tz);
  box(1.7, 0.5, 1.8, COAL, g, 0, 2.3, tz);              // heaped coal
  for (const s of [-1, 1]) for (let i = 0; i < 2; i++) {
    wheels.push(cyl(0.45, 0.16, IRON, g, s * 1.0, 0.45, tz + 0.6 - i * 1.2, false));
  }

  // ---- carriage (carmine, NYMR teak-ish) — tha sits in here ----
  const cz = -3.6; // carriage centre
  const W = 2.4, L = 7.0;
  box(W, 0.22, L, IRON, g, 0, 1.0, cz);                  // floor
  box(W + 0.15, 0.18, L + 0.2, ROOF, g, 0, 3.45, cz);    // roof
  // side panels wi' window gaps: 4 windows per side
  for (const s of [-1, 1]) {
    box(0.12, 0.7, L, CARMINE, g, s * (W / 2), 1.45, cz);          // waist panel
    box(0.12, 0.45, L, CARMINE, g, s * (W / 2), 3.15, cz);         // cantrail panel
    for (let i = 0; i <= 4; i++) {
      box(0.12, 1.2, 0.5, CARMINE, g, s * (W / 2), 2.35, cz - L / 2 + 0.25 + i * (L - 0.5) / 4); // pillars
    }
    box(0.1, 0.1, L, CREAM, g, s * (W / 2), 1.85, cz);             // cream lining
  }
  box(W, 2.5, 0.14, CARMINE, g, 0, 2.2, cz - L / 2);     // ends
  box(W, 2.5, 0.14, CARMINE, g, 0, 2.2, cz + L / 2);
  // seats: two facing benches
  box(1.8, 0.25, 0.9, 0x5a3a2a, g, 0, 1.35, cz + 1.2);
  box(1.8, 0.8, 0.2, 0x5a3a2a, g, 0, 1.7, cz + 1.7);
  box(1.8, 0.25, 0.9, 0x5a3a2a, g, 0, 1.35, cz - 1.2);
  box(1.8, 0.8, 0.2, 0x5a3a2a, g, 0, 1.7, cz - 1.7);
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
    wheels.push(cyl(0.45, 0.16, IRON, g, s * 1.05, 0.45, cz + 2.4 - i * 2.4, false));
  }

  // tha sits by t' window, facing t' engine
  const seat = new THREE.Vector3(0.55, 2.25, cz - 0.7);
  return { group: g, seat, funnel: fn, wheels };
}
