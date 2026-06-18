// T' Moors Railway steam train, built proper: loco, tender an' carriage as
// separate bodies that bend through t' curves, wi' spoked drivers, working
// coupling rods, a rounded boiler an' a carmine NYMR-style carriage.
// Local +z = direction of travel for every part.
import * as THREE from 'three';

const BLACK = 0x16161a, IRON = 0x2a2a30, BRASS = 0xb8923a, RED = 0x7a1f1f,
  CARMINE = 0x8a2430, CREAM = 0xe8dfc8, ROOF = 0x3a3a40, COAL = 0x111114,
  STEEL = 0x8a8a92, GLASS = 0xaccadd;
// carriage fit-out — honey veneer, BR-blue moquette, pale barrel ceiling
const WOOD = 0x9c6a32, WOODDK = 0x6e4622, MOQUETTE = 0x3f4f9e, MOQDK = 0x313e7a,
  CEIL = 0xeee9da, RACK = 0xa6acb4, CARPET = 0x6b3a46, ENDDOOR = 0x583a1e;

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
  hub.rotation.x = Math.PI / 2; // boss along t' axle (t' wheel's own +z)
  w.add(hub);
  for (let i = 0; i < 6; i++) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.05, r * 1.9, 0.05), new THREE.MeshLambertMaterial({ color }));
    sp.rotation.z = (i / 6) * Math.PI; // spokes lie IN t' wheel, fanned round t' hub
    w.add(sp);
  }
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 6), new THREE.MeshLambertMaterial({ color: STEEL }));
  pin.rotation.x = Math.PI / 2;            // crank pin parallel to t' axle...
  pin.position.set(0, r * 0.55, 0.08);     // ...set out at t' crank throw, spins wi' t' wheel
  w.add(pin);
  w.rotation.y = Math.PI / 2; // wheel face out t' side
  w.position.set(x, y, z);
  w.userData.r = r; // so t' game spins each wheel at its true rate
  group.add(w);
  return w;
}

// A North Yorkshire Moors Railway roundel, painted to a canvas an' worn as a
// badge on t' tender. An original heritage-style emblem in t' game's own hand —
// place-name lettering, a steam engine an' t' NYMR initials — not t' line's
// trade-marked artwork. Returns null under Node (t' verify probe has no canvas);
// t' train still builds, just bare-sided.
let _nymrMat = null;
function nymrEmblem() {
  if (typeof document === 'undefined') return null;
  if (_nymrMat) return _nymrMat;
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d'), cx = S / 2, cy = S / 2;
  const GREEN = '#13502f', GREEND = '#0c3a22', GOLD = '#c9a94a', CREAM = '#ece3cc';
  const disc = (r, col) => { x.fillStyle = col; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill(); };
  disc(122, GREEND); disc(116, GOLD); disc(110, GREEN); disc(84, CREAM);
  // curved name round t' green band
  x.fillStyle = CREAM; x.textAlign = 'center'; x.textBaseline = 'middle';
  const arc = (str, r, mid, dir) => {
    x.save(); x.translate(cx, cy); x.font = 'bold 19px Georgia';
    const step = 0.135, start = mid - dir * (str.length - 1) * step / 2;
    for (let i = 0; i < str.length; i++) {
      x.save(); x.rotate(start + dir * i * step); x.translate(0, -dir * r);
      if (dir < 0) x.rotate(Math.PI);
      x.fillText(str[i], 0, 0); x.restore();
    }
    x.restore();
  };
  arc('NORTH YORKSHIRE', 97, 0, 1);
  arc('MOORS  RAILWAY', 97, Math.PI, -1);
  // a wee side-on steam engine
  x.fillStyle = GREEN;
  const ex = cx - 34, by = cy - 2;
  x.fillRect(ex, by - 13, 50, 13);          // boiler
  x.fillRect(ex + 44, by - 24, 15, 24);     // cab
  x.fillRect(ex + 4, by - 24, 8, 11);       // funnel
  const wheel = w => { x.beginPath(); x.arc(w, by + 3, 6, 0, 7); x.fill(); };
  wheel(ex + 12); wheel(ex + 30); wheel(ex + 49);
  x.beginPath(); x.arc(ex + 6, by - 30, 5, 0, 7); x.arc(ex - 2, by - 36, 4, 0, 7); x.arc(ex - 9, by - 40, 3, 0, 7); x.fill(); // smoke
  // initials
  x.fillStyle = GREEN; x.font = 'bold 30px Georgia'; x.fillText('NYMR', cx, cy + 50);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 8;
  _nymrMat = new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide });
  return _nymrMat;
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
  // NYMR roundel on t' smokebox door — t' badge on her face
  const em = nymrEmblem();
  if (em) {
    const front = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.84), em);
    front.position.set(0, 1.92, 3.13);
    g.add(front);
  }
  return { group: g, wheels, rods, funnel: fn, length: 6.4 };
}

function buildTender() {
  const g = new THREE.Group();
  box(2.1, 0.4, 3.4, IRON, g, 0, 0.62, 0);
  box(2.1, 1.4, 3.2, BLACK, g, 0, 1.5, 0);
  box(1.7, 0.45, 2.4, COAL, g, 0, 2.3, 0.1);                  // heaped coal
  // NYMR roundel on each side o' t' tender
  const em = nymrEmblem();
  if (em) for (const s of [-1, 1]) {
    const badge = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.15), em);
    badge.position.set(s * 1.06, 1.5, 0);
    badge.rotation.y = s * Math.PI / 2;
    g.add(badge);
  }
  const wheels = [];
  for (const s of [-1, 1]) for (let i = 0; i < 2; i++) {
    wheels.push(driver(0.45, IRON, g, s * 1.0, 0.45, 0.75 - i * 1.5));
  }
  return { group: g, wheels, length: 3.6 };
}

// A proper open coach: carmine/cream livery outside, but a honey-veneer
// saloon within — big glazed lights tha can actually see t' moor through,
// blue moquette seats in facing pairs, luggage racks an' a pale barrel roof.
function buildCarriage() {
  const g = new THREE.Group();
  const W = 2.4, L = 7.2, HALF = W / 2;

  // glazing: transparent so t' moor shows through, double-sided so it reads
  // frae t' aisle an' frae out on t' line alike. THIS is what lets thee see out.
  const glassMat = new THREE.MeshLambertMaterial({ color: GLASS, transparent: true, opacity: 0.16, side: THREE.DoubleSide });
  const pane = (w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), glassMat);
    m.position.set(x, y, z); m.name = 'window'; m.userData.glass = true; g.add(m); return m;
  };

  // underframe an' a maroon carpet
  box(W, 0.22, L, IRON, g, 0, 1.0, 0);
  box(W - 0.14, 0.05, L - 0.14, CARPET, g, 0, 1.15, 0);

  // three bays down t' coach — windows sit between t' seat-backs
  const bayZ = [-2.2, 0, 2.2];                 // window + table centres
  const pillarZ = [-3.35, -1.1, 1.1, 3.35];    // mullions on t' seat-back lines
  const winBot = 1.72, winTop = 2.5;           // big light straddles t' eye (2.2)
  const topY = 2.66;                           // wee toplights above

  for (const s of [-1, 1]) {
    const wx = s * HALF;
    box(0.08, 0.62, L, CARMINE, g, wx, 1.41, 0);              // carmine dado (outside)
    box(0.05, 0.58, L, WOOD, g, s * (HALF - 0.07), 1.41, 0);  // wood dado (inside)
    box(0.10, 0.12, L, BRASS, g, wx, 1.74, 0);               // waist beading
    box(0.08, 0.30, L, CREAM, g, wx, 2.86, 0);               // cream cantrail (outside)
    box(0.05, 0.26, L, WOOD, g, s * (HALF - 0.06), 2.84, 0); // wood cant rail (inside)
    for (const pz of pillarZ) {                               // pillars: carmine out, wood in
      box(0.09, 1.2, 0.16, CARMINE, g, wx, 2.16, pz);
      box(0.06, 1.16, 0.13, WOOD, g, s * (HALF - 0.05), 2.16, pz);
    }
    for (let i = 0; i < bayZ.length; i++) {                   // a main light an' a toplight per bay
      const z = bayZ[i];
      const wWin = (i === 0 || i === bayZ.length - 1) ? 1.9 : 2.0;
      pane(0.05, winTop - winBot, wWin, s * (HALF - 0.04), (winTop + winBot) / 2, z);
      box(0.06, 0.05, wWin, WOODDK, g, s * (HALF - 0.05), winTop + 0.05, z); // transom
      pane(0.05, 0.22, wWin, s * (HALF - 0.04), topY, z);
    }
    // aluminium luggage rack — unlit constant shade so it reads even as it
    // catches no lamp on its underside; slim, hugging t' wall over t' lights
    const rackMat = new THREE.MeshBasicMaterial({ color: RACK });
    const rack = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.04, L - 0.6), rackMat);
    rack.position.set(s * (HALF - 0.24), 2.6, 0); rack.rotation.z = s * 0.14; g.add(rack);
    for (const bz of [-2.4, -0.8, 0.8, 2.4]) {
      const br = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.34, 6), rackMat);
      br.rotation.z = Math.PI / 2; br.position.set(s * (HALF - 0.22), 2.64, bz); g.add(br);
    }
  }

  // ends: carmine out, wood within, wi' a glazed door through to t' next coach
  for (const ze of [-1, 1]) {
    const z = ze * L / 2;
    box(W, 1.9, 0.12, CARMINE, g, 0, 1.95, z);
    box(W - 0.1, 1.7, 0.06, WOOD, g, 0, 1.85, z - ze * 0.08);
    box(0.86, 1.5, 0.05, ENDDOOR, g, 0, 1.85, z - ze * 0.12);
    pane(0.5, 0.5, 0.04, 0, 2.3, z - ze * 0.14);
  }

  // roof: dark barrel outside, a pale cream ceiling within
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, L + 0.25, 14, 1, false, Math.PI * 0.65, Math.PI * 0.7),
    new THREE.MeshLambertMaterial({ color: ROOF }));
  roof.rotation.x = Math.PI / 2; roof.position.set(0, 2.6, 0); g.add(roof);
  // cream ceiling: a shallow barrel whose haunches come down to t' cant rail an'
  // run t' full length, so no gap to t' sky shows at t' eaves or t' ends
  const ceil = new THREE.Mesh(new THREE.CylinderGeometry(1.40, 1.40, L + 0.1, 16, 1, false, Math.PI * 0.695, Math.PI * 0.61),
    new THREE.MeshLambertMaterial({ color: CEIL, side: THREE.DoubleSide }));
  ceil.rotation.x = Math.PI / 2; ceil.position.set(0, 2.05, 0); g.add(ceil);
  for (const cz of [-2.2, -1.1, 0, 1.1, 2.2]) {              // round vents + wee lamps
    cyl(0.11, 0.04, 0x4a4a50, g, 0, 3.0, cz, 'y', 10);
    cyl(0.07, 0.06, 0xfff2cf, g, 0, 2.96, cz + 0.55, 'y', 8);
  }
  // a warm glow within, so t' saloon reads bright an' airy under t' roof
  for (const lz of [-2.4, 0, 2.4]) {
    const lamp = new THREE.PointLight(0xfff1d6, 0.95, 12, 1.2);
    lamp.position.set(0, 2.95, lz); g.add(lamp);
  }

  // seating: blue moquette facing pairs wi' wood backs, ends an' a window table
  const wheels = [];
  const benchAt = (x, z, face) => {
    box(0.82, 0.16, 0.74, MOQUETTE, g, x, 1.5, z);           // cushion
    box(0.82, 0.10, 0.74, MOQDK, g, x, 1.41, z);             // cushion shade
    const bz = z - face * 0.33;
    box(0.82, 0.62, 0.12, MOQUETTE, g, x, 1.78, bz);         // back
    box(0.86, 0.10, 0.16, WOODDK, g, x, 2.10, bz);           // wood capping
    for (const ex of [-0.42, 0.42]) box(0.07, 0.66, 0.78, WOODDK, g, x + ex, 1.72, z); // ends
  };
  for (const zc of bayZ) {
    for (const sx of [-1, 1]) {
      const x = sx * 0.66;
      benchAt(x, zc - 0.85, 1);   // faces forrard
      benchAt(x, zc + 0.85, -1);  // faces back
      box(0.62, 0.06, 0.95, WOODDK, g, sx * 0.82, 1.52, zc);  // table at t' window
      box(0.07, 0.4, 0.10, 0x3a3a40, g, sx * 0.82, 1.30, zc); // table leg
    }
  }

  // bogies: four little wheels at each end
  for (const ze of [2.6, -2.6]) {
    box(1.6, 0.3, 1.3, IRON, g, 0, 0.5, ze);
    for (const s of [-1, 1]) for (let i = 0; i < 2; i++) {
      wheels.push(driver(0.34, IRON, g, s * 1.0, 0.34, ze + 0.45 - i * 0.9));
    }
  }

  // NYMR roundel on each side, low on t' carmine waist
  const em = nymrEmblem();
  if (em) for (const s of [-1, 1]) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.56), em);
    b.position.set(s * (HALF + 0.02), 1.4, 0);
    b.rotation.y = s * Math.PI / 2;
    g.add(b);
  }
  // seat anchor: t' game seats up to four riders at (±0.55, ±0.85) round t' middle bay
  const seat = new THREE.Vector3(0.55, 2.2, -0.85);
  return { group: g, wheels, seat, length: 7.6 };
}

// T' whole rake as articulated parts. Each part carries a chainage offset
// frae t' schedule position; t' game poses each at its own spot on t' spline
// so she bends honestly through t' curves.
export function buildTrain() {
  const loco = buildLoco();
  const tender = buildTender();
  const carriage = buildCarriage();
  const carriage2 = buildCarriage();
  return {
    parts: [
      { ...loco, offset: 0 },        // schedule chainage = loco centre
      { ...tender, offset: -5.3 },
      { ...carriage, offset: -11.2 },
      { ...carriage2, offset: -17.1 }, // a second coach on the rake
    ],
    funnel: loco.funnel,
    seat: carriage.seat,
    loco, tender, carriage,
  };
}
