// Mobs (Swaledale sheep, grouse, hares, barghest, boggarts), item drops, particles.
import * as THREE from 'three';
import { B, I, BLOCKS, isSolid } from './defs.js';
import { moveEntity } from './physics.js';
import { getIconURL, tileColor } from './textures.js';
import { hash2i } from './noise.js';
import { TAME_GOAL, FOLLOW_RANGE, feedTrust, chooseName } from './pets.js';
import { dayPhase, villagerRemark } from './villagerlife.js';
import { HEIGHT, WATER_LEVEL } from './defs.js';

const GRAVITY = 26;

const PRINT_GEOM = new THREE.PlaneGeometry(0.34, 0.5); // shared geom for the barghest's dawn-prints
function box(w, h, d, color, emissive = 0) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color, emissive, emissiveIntensity: emissive ? 1 : 0 })
  );
  return m;
}

// ---------- mob models ----------
function makeSheep() {
  const g = new THREE.Group();
  const body = box(0.9, 0.65, 1.2, 0xe8e2d4); body.position.y = 0.75; g.add(body);
  const head = box(0.42, 0.42, 0.4, 0x1c1c1c); head.position.set(0, 1.0, 0.72); g.add(head);
  const snout = box(0.22, 0.2, 0.16, 0x2e2e2e); snout.position.set(0, 0.92, 0.96); g.add(snout);
  const legs = [];
  for (const [x, z] of [[-0.28, 0.42], [0.28, 0.42], [-0.28, -0.42], [0.28, -0.42]]) {
    const l = box(0.16, 0.5, 0.16, 0x2a2a2a); l.position.set(x, 0.25, z); g.add(l); legs.push(l);
  }
  return { group: g, legs, body, head };
}

function makeGrouse() {
  const g = new THREE.Group();
  const body = box(0.34, 0.3, 0.5, 0x6e3a26); body.position.y = 0.32; g.add(body);
  const head = box(0.18, 0.18, 0.18, 0x7a4630); head.position.set(0, 0.52, 0.28); g.add(head);
  const comb = box(0.1, 0.05, 0.1, 0xd03a2a); comb.position.set(0, 0.62, 0.28); g.add(comb);
  const tail = box(0.24, 0.1, 0.2, 0x4e2a1a); tail.position.set(0, 0.42, -0.3); g.add(tail);
  const legs = [];
  for (const x of [-0.08, 0.08]) {
    const l = box(0.05, 0.18, 0.05, 0x9a8a4a); l.position.set(x, 0.09, 0.05); g.add(l); legs.push(l);
  }
  const wings = [];
  for (const x of [-1, 1]) { const w = box(0.36, 0.06, 0.34, 0x5a3020); w.position.set(x * 0.2, 0.4, -0.02); g.add(w); wings.push(w); }
  return { group: g, legs, body, head, wings };
}

function makeHare() {
  const g = new THREE.Group();
  const body = box(0.34, 0.36, 0.6, 0x8a6e4e); body.position.y = 0.32; g.add(body);
  const head = box(0.24, 0.24, 0.24, 0x96785a); head.position.set(0, 0.52, 0.36); g.add(head);
  for (const x of [-0.07, 0.07]) {
    const ear = box(0.07, 0.3, 0.05, 0x8a6e4e); ear.position.set(x, 0.78, 0.32); g.add(ear);
  }
  const legs = [];
  for (const [x, z] of [[-0.12, 0.2], [0.12, 0.2], [-0.12, -0.2], [0.12, -0.2]]) {
    const l = box(0.09, 0.26, 0.09, 0x7a5e40); l.position.set(x, 0.13, z); g.add(l); legs.push(l);
  }
  return { group: g, legs, body, head };
}

function makeBarghest() {
  const g = new THREE.Group();
  const body = box(0.85, 0.8, 1.5, 0x0c0c10); body.position.y = 0.95; g.add(body);
  const head = box(0.55, 0.5, 0.6, 0x101014); head.position.set(0, 1.35, 0.95); g.add(head);
  const jaw = box(0.4, 0.18, 0.4, 0x08080c); jaw.position.set(0, 1.12, 1.05); g.add(jaw);
  for (const x of [-0.16, 0.16]) {
    const eye = box(0.1, 0.08, 0.05, 0xff2200, 0xff2200); eye.position.set(x, 1.42, 1.26); g.add(eye);
    const ear = box(0.12, 0.2, 0.08, 0x0c0c10); ear.position.set(x * 1.6, 1.66, 0.8); g.add(ear);
  }
  const legs = [];
  for (const [x, z] of [[-0.28, 0.5], [0.28, 0.5], [-0.28, -0.55], [0.28, -0.55]]) {
    const l = box(0.2, 0.65, 0.2, 0x0a0a0e); l.position.set(x, 0.32, z); g.add(l); legs.push(l);
  }
  return { group: g, legs, body, head };
}

function makeDracula() {
  const g = new THREE.Group();
  // tall dark figure in a sweeping cloak
  const cape = box(1.1, 1.5, 0.2, 0x120810); cape.position.set(0, 1.35, -0.15); g.add(cape);
  const body = box(0.5, 1.1, 0.35, 0x1a1018); body.position.y = 1.15; g.add(body);
  const head = box(0.42, 0.42, 0.38, 0xc8b8a8); head.position.set(0, 1.82, 0.05); g.add(head);
  const hair = box(0.46, 0.18, 0.4, 0x0a0808); hair.position.set(0, 2.02, 0.02); g.add(hair);
  for (const x of [-0.1, 0.1]) {
    const eye = box(0.07, 0.05, 0.04, 0xff1020, 0xff1020); eye.position.set(x, 1.86, 0.24); g.add(eye);
  }
  const legs = [];
  for (const x of [-0.14, 0.14]) {
    const l = box(0.16, 0.75, 0.16, 0x0e0a10); l.position.set(x, 0.37, 0); g.add(l); legs.push(l);
  }
  return { group: g, legs, body, head, cape };
}

function makeBoggart() {
  const g = new THREE.Group();
  const body = box(0.5, 0.55, 0.35, 0x2a3326); body.position.y = 0.62; g.add(body);
  const head = box(0.4, 0.38, 0.38, 0x33402c); head.position.set(0, 1.1, 0); g.add(head);
  for (const x of [-0.1, 0.1]) {
    const eye = box(0.08, 0.08, 0.04, 0xc8ff50, 0xa0ff30); eye.position.set(x, 1.14, 0.2); g.add(eye);
  }
  const arms = [];
  for (const x of [-0.32, 0.32]) {
    const a = box(0.12, 0.5, 0.12, 0x2a3326); a.position.set(x, 0.62, 0); g.add(a); arms.push(a);
  }
  const legs = [];
  for (const x of [-0.13, 0.13]) {
    const l = box(0.14, 0.35, 0.14, 0x222a1e); l.position.set(x, 0.17, 0); g.add(l); legs.push(l);
  }
  return { group: g, legs: legs.concat(arms), body, head };
}

function makeCow() {
  const g = new THREE.Group();
  const body = box(1.0, 0.8, 1.5, 0x5a4632); body.position.y = 0.9; g.add(body);
  const patch = box(1.02, 0.5, 0.8, 0xe8e2d4); patch.position.set(0, 1.0, 0.1); g.add(patch); // a white flank
  const head = box(0.46, 0.46, 0.5, 0x4a3a28); head.position.set(0, 1.15, 0.95); g.add(head);
  const snout = box(0.36, 0.28, 0.2, 0xc89898); snout.position.set(0, 1.02, 1.18); g.add(snout);
  for (const x of [-0.18, 0.18]) { const horn = box(0.09, 0.12, 0.09, 0xe8e0d0); horn.position.set(x, 1.42, 0.95); g.add(horn); }
  const legs = [];
  for (const [x, z] of [[-0.34, 0.55], [0.34, 0.55], [-0.34, -0.55], [0.34, -0.55]]) {
    const l = box(0.2, 0.6, 0.2, 0x3a2e20); l.position.set(x, 0.3, z); g.add(l); legs.push(l);
  }
  return { group: g, legs, body, head };
}

function makeBull() {
  const g = new THREE.Group();
  const body = box(1.15, 0.95, 1.7, 0x241c14); body.position.y = 1.0; g.add(body);
  const hump = box(0.7, 0.32, 0.6, 0x2c2218); hump.position.set(0, 1.5, 0.2); g.add(hump);
  const head = box(0.52, 0.52, 0.55, 0x1c150e); head.position.set(0, 1.2, 1.05); g.add(head);
  const snout = box(0.4, 0.3, 0.2, 0x3a2a24); snout.position.set(0, 1.05, 1.3); g.add(snout);
  for (const x of [-0.3, 0.3]) {
    const horn = box(0.1, 0.1, 0.34, 0xd8d0c0); horn.position.set(x, 1.42, 1.0); horn.rotation.z = x < 0 ? 0.4 : -0.4; g.add(horn);
    const eye = box(0.07, 0.07, 0.04, 0x401010, 0x802010); eye.position.set(x * 0.5, 1.28, 1.33); g.add(eye);
  }
  const legs = [];
  for (const [x, z] of [[-0.4, 0.62], [0.4, 0.62], [-0.4, -0.62], [0.4, -0.62]]) {
    const l = box(0.24, 0.62, 0.24, 0x161009); l.position.set(x, 0.31, z); g.add(l); legs.push(l);
  }
  return { group: g, legs, body, head };
}

function makeLlama() {
  const g = new THREE.Group();
  // tall, slim body in cream wool
  const body = box(0.85, 0.85, 1.2, 0xead8b6); body.position.y = 1.1; g.add(body);
  // long neck reaching up
  const neck = box(0.36, 0.85, 0.42, 0xead8b6); neck.position.set(0, 1.75, 0.7); g.add(neck);
  // small head held high
  const head = box(0.4, 0.4, 0.55, 0xddc89a); head.position.set(0, 2.1, 0.95); g.add(head);
  const snout = box(0.28, 0.24, 0.2, 0xc8a878); snout.position.set(0, 2.0, 1.25); g.add(snout);
  // long banana ears
  for (const x of [-0.14, 0.14]) {
    const ear = box(0.09, 0.32, 0.07, 0xc8a878); ear.position.set(x, 2.36, 0.88); ear.rotation.x = 0.18; g.add(ear);
  }
  // little dark eyes
  for (const x of [-0.12, 0.12]) {
    const eye = box(0.06, 0.06, 0.04, 0x101010); eye.position.set(x, 2.16, 1.22); g.add(eye);
  }
  // a soft chest tuft
  const tuft = box(0.4, 0.18, 0.14, 0xfff0d0); tuft.position.set(0, 1.55, 0.6); g.add(tuft);
  // slender legs
  const legs = [];
  for (const [x, z] of [[-0.3, 0.42], [0.3, 0.42], [-0.3, -0.42], [0.3, -0.42]]) {
    const l = box(0.18, 0.75, 0.18, 0xc8a878); l.position.set(x, 0.37, z); g.add(l); legs.push(l);
  }
  return { group: g, legs, body, head };
}

function makePony() {
  const g = new THREE.Group();
  // a stocky moorland pony — bay brown wi' black points (mane, tail, lower legs),
  // a mealy muzzle an' feathered fetlocks. Built an' eyeballed frae two angles afore shipping.
  const BODY = 0x4d3925, BELLY = 0x402f1d, PT = 0x161009, MEALY = 0xa08a6a, HOOF = 0x0d0a07;
  // a deep barrel, rounded fore an' aft so she reads stocky, not a plank on legs
  const body = box(0.8, 0.82, 1.3, BODY); body.position.y = 1.1; g.add(body);
  const chest = box(0.84, 0.78, 0.5, BODY); chest.position.set(0, 1.04, 0.5); g.add(chest);
  const rump = box(0.84, 0.82, 0.46, BODY); rump.position.set(0, 1.12, -0.54); g.add(rump);
  const belly = box(0.72, 0.46, 1.14, BELLY); belly.position.set(0, 0.76, -0.02); g.add(belly);
  // an arched neck wi' a black mane laid flush down the crest (so it can't poke up)
  const neck = box(0.46, 0.85, 0.54, BODY); neck.position.set(0, 1.5, 0.6); neck.rotation.x = -0.5; g.add(neck);
  const mane = box(0.16, 0.82, 0.14, PT); mane.position.set(0, 1.48, 0.36); mane.rotation.x = -0.5; g.add(mane);
  // a neat head dropped forward to a pale muzzle, a forelock between the ears
  const head = box(0.4, 0.44, 0.72, BODY); head.position.set(0, 1.9, 1.06); head.rotation.x = -0.2; g.add(head);
  const muzzle = box(0.34, 0.32, 0.26, MEALY); muzzle.position.set(0, 1.76, 1.46); g.add(muzzle);
  const forelock = box(0.24, 0.16, 0.1, PT); forelock.position.set(0, 2.0, 1.28); g.add(forelock);
  for (const x of [-0.12, 0.12]) { const ear = box(0.1, 0.18, 0.09, BODY); ear.position.set(x, 2.08, 0.96); g.add(ear); }
  for (const x of [-0.16, 0.16]) {
    const ring = box(0.11, 0.11, 0.04, MEALY); ring.position.set(x, 1.86, 1.3); g.add(ring);
    const eye = box(0.06, 0.06, 0.05, 0x0a0806); eye.position.set(x, 1.86, 1.33); g.add(eye);
  }
  // a thick black tail near to the hocks
  const tail = box(0.2, 0.84, 0.22, PT); tail.position.set(0, 0.9, -0.82); tail.rotation.x = 0.3; g.add(tail);
  // four short legs — bay to the knee, then a black sock, a feathered fetlock an' a hoof;
  // the sock, feather an' hoof are children so they swing along as the leg strides
  const legs = [];
  for (const [x, z] of [[-0.26, 0.42], [0.26, 0.42], [-0.26, -0.46], [0.26, -0.46]]) {
    const l = box(0.21, 0.66, 0.21, BODY); l.position.set(x, 0.46, z); g.add(l); legs.push(l);
    const sock = box(0.2, 0.34, 0.2, PT); sock.position.set(0, -0.2, 0); l.add(sock);
    const feather = box(0.27, 0.2, 0.27, PT); feather.position.set(0, -0.28, 0); l.add(feather);
    const hoof = box(0.22, 0.12, 0.22, HOOF); hoof.position.set(0, -0.36, 0); l.add(hoof);
  }
  return { group: g, legs, body, head };
}

// ---- companions: dog, cat, pig, rat ----
function makeDog() {
  const g = new THREE.Group();
  const DARK = 0x20242a, WHITE = 0xe6e2d6;
  const body = box(0.42, 0.42, 0.9, DARK); body.position.y = 0.5; g.add(body);
  const bib = box(0.44, 0.32, 0.42, WHITE); bib.position.set(0, 0.46, 0.3); g.add(bib);
  const neck = box(0.3, 0.3, 0.3, DARK); neck.position.set(0, 0.6, 0.5); g.add(neck);
  const head = box(0.32, 0.32, 0.36, DARK); head.position.set(0, 0.72, 0.7); g.add(head);
  const blaze = box(0.12, 0.32, 0.22, WHITE); blaze.position.set(0, 0.72, 0.86); g.add(blaze);
  const snout = box(0.18, 0.16, 0.22, DARK); snout.position.set(0, 0.66, 0.92); g.add(snout);
  const nose = box(0.1, 0.09, 0.08, 0x0a0a0a); nose.position.set(0, 0.68, 1.04); g.add(nose);
  for (const x of [-0.12, 0.12]) { const ear = box(0.1, 0.16, 0.08, DARK); ear.position.set(x, 0.9, 0.62); g.add(ear); }
  const tail = box(0.12, 0.14, 0.4, WHITE); tail.position.set(0, 0.52, -0.56); tail.rotation.x = 0.6; g.add(tail);
  const legs = [];
  for (const [x, z] of [[-0.14, 0.3], [0.14, 0.3], [-0.14, -0.3], [0.14, -0.3]]) {
    const l = box(0.13, 0.5, 0.13, DARK); l.position.set(x, 0.25, z); g.add(l); legs.push(l);
    const sock = box(0.14, 0.18, 0.14, WHITE); sock.position.set(0, -0.16, 0); l.add(sock);
  }
  return { group: g, legs, body, head };
}

function makeCat() {
  const g = new THREE.Group();
  const FUR = 0x4a4038;
  const body = box(0.28, 0.3, 0.62, FUR); body.position.y = 0.42; g.add(body);
  const head = box(0.28, 0.26, 0.26, FUR); head.position.set(0, 0.56, 0.4); g.add(head);
  const snout = box(0.14, 0.12, 0.1, FUR); snout.position.set(0, 0.5, 0.54); g.add(snout);
  for (const x of [-0.09, 0.09]) { const ear = box(0.08, 0.12, 0.06, FUR); ear.position.set(x, 0.72, 0.36); g.add(ear); }
  for (const x of [-0.07, 0.07]) { const eye = box(0.05, 0.05, 0.03, 0x9ac04a, 0x507018); eye.position.set(x, 0.56, 0.52); g.add(eye); }
  const tail = box(0.1, 0.1, 0.46, FUR); tail.position.set(0, 0.56, -0.34); tail.rotation.x = -0.9; g.add(tail);
  const legs = [];
  for (const [x, z] of [[-0.09, 0.22], [0.09, 0.22], [-0.09, -0.22], [0.09, -0.22]]) {
    const l = box(0.09, 0.42, 0.09, FUR); l.position.set(x, 0.21, z); g.add(l); legs.push(l);
  }
  return { group: g, legs, body, head };
}

function makePig() {
  const g = new THREE.Group();
  const PINK = 0xd29a90, DARK = 0xae766c;
  const body = box(0.62, 0.56, 0.95, PINK); body.position.y = 0.55; g.add(body);
  const head = box(0.42, 0.4, 0.36, PINK); head.position.set(0, 0.56, 0.62); g.add(head);
  const snout = box(0.26, 0.2, 0.14, DARK); snout.position.set(0, 0.5, 0.82); g.add(snout);
  for (const x of [-0.06, 0.06]) { const n = box(0.05, 0.05, 0.04, 0x6a4a44); n.position.set(x, 0.5, 0.9); g.add(n); }
  for (const x of [-0.14, 0.14]) { const ear = box(0.12, 0.14, 0.06, PINK); ear.position.set(x, 0.76, 0.6); ear.rotation.x = 0.3; g.add(ear); }
  const tail = box(0.06, 0.16, 0.06, PINK); tail.position.set(0, 0.62, -0.5); tail.rotation.x = -0.5; g.add(tail);
  const legs = [];
  for (const [x, z] of [[-0.2, 0.3], [0.2, 0.3], [-0.2, -0.3], [0.2, -0.3]]) {
    const l = box(0.16, 0.34, 0.16, DARK); l.position.set(x, 0.17, z); g.add(l); legs.push(l);
  }
  return { group: g, legs, body, head };
}

function makeRat() {
  const g = new THREE.Group();
  const FUR = 0x4a4038, PINK = 0xc89890;
  const body = box(0.2, 0.2, 0.42, FUR); body.position.y = 0.18; g.add(body);
  const head = box(0.16, 0.16, 0.2, FUR); head.position.set(0, 0.2, 0.3); g.add(head);
  const snout = box(0.08, 0.08, 0.12, FUR); snout.position.set(0, 0.17, 0.42); g.add(snout);
  for (const x of [-0.07, 0.07]) { const ear = box(0.08, 0.08, 0.03, PINK); ear.position.set(x, 0.3, 0.26); g.add(ear); }
  const tail = box(0.04, 0.04, 0.5, PINK); tail.position.set(0, 0.16, -0.42); g.add(tail);
  const legs = [];
  for (const [x, z] of [[-0.08, 0.14], [0.08, 0.14], [-0.08, -0.14], [0.08, -0.14]]) {
    const l = box(0.05, 0.16, 0.05, PINK); l.position.set(x, 0.08, z); g.add(l); legs.push(l);
  }
  return { group: g, legs, body, head };
}

// A kept beast's name floats over her head — green, so tha can tell thi own frae a villager.
function makePetPlate(name) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 56;
  const x = c.getContext('2d');
  x.font = 'bold 26px "Segoe UI", sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.strokeStyle = 'rgba(0,0,0,0.85)'; x.lineWidth = 6; x.strokeText(name, 128, 28);
  x.fillStyle = '#bfe6a4'; x.fillText(name, 128, 28);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(c), transparent: true, depthTest: false, opacity: 0.95,
  }));
  spr.scale.set(1.7, 0.37, 1); spr.renderOrder = 50;
  return spr;
}

// ---- a Yorkshire coble: high raked bow, square stern, clinker planks ----
function makeCoble() {
  const g = new THREE.Group();
  const HULL = 0x5a3b22, TRIM = 0x3a2616, DECK = 0x6e4a2c, SAIL = 0xe8e2d0;
  const hull = box(1.1, 0.7, 3.2, HULL); hull.position.y = 0.35; g.add(hull);
  const well = box(0.8, 0.5, 2.6, DECK); well.position.y = 0.56; g.add(well); // open deck/well
  const bow = box(0.86, 0.86, 0.95, HULL); bow.position.set(0, 0.5, 1.35); bow.rotation.x = -0.4; g.add(bow); // raked bow, lapped onto the hull
  const prow = box(0.36, 0.62, 0.5, HULL); prow.position.set(0, 0.94, 1.74); prow.rotation.x = -0.5; g.add(prow);
  for (const x of [-0.58, 0.58]) { const rail = box(0.1, 0.16, 3.0, TRIM); rail.position.set(x, 0.68, 0); g.add(rail); }
  const transom = box(1.05, 0.6, 0.2, HULL); transom.position.set(0, 0.4, -1.55); g.add(transom);
  const thwart = box(0.92, 0.12, 0.42, TRIM); thwart.position.set(0, 0.72, -0.4); g.add(thwart);
  const mast = box(0.1, 1.7, 0.1, TRIM); mast.position.set(0, 1.45, 0.2); g.add(mast);
  const sail = box(0.07, 1.05, 0.66, SAIL); sail.position.set(0.02, 1.55, 0.02); g.add(sail);
  for (const x of [-0.5, 0.5]) { const oar = box(0.07, 0.07, 1.8, 0x7a5836); oar.position.set(x, 0.74, -0.2); g.add(oar); }
  return { group: g };
}

function makePheasant() {
  const g = new THREE.Group();
  const body = box(0.34, 0.34, 0.56, 0x7a4a26); body.position.y = 0.36; g.add(body);
  const neck = box(0.16, 0.26, 0.16, 0x16306a); neck.position.set(0, 0.6, 0.22); g.add(neck); // glossy dark neck-ring
  const head = box(0.2, 0.2, 0.22, 0x123a2a); head.position.set(0, 0.78, 0.28); g.add(head);
  const face = box(0.24, 0.16, 0.1, 0xd02a2a, 0x501008); face.position.set(0, 0.78, 0.41); g.add(face); // t' distinctive red face
  const tail = box(0.12, 0.1, 0.72, 0x9a6a36); tail.position.set(0, 0.42, -0.52); tail.rotation.x = 0.18; g.add(tail);
  const legs = [];
  for (const x of [-0.09, 0.09]) { const l = box(0.05, 0.2, 0.05, 0xa89060); l.position.set(x, 0.1, 0.05); g.add(l); legs.push(l); }
  const wings = [];
  for (const x of [-1, 1]) { const w = box(0.38, 0.06, 0.4, 0x6a3e20); w.position.set(x * 0.2, 0.44, -0.04); g.add(w); wings.push(w); }
  return { group: g, legs, body, head, wings };
}

function makeOwl() {
  const g = new THREE.Group();
  const body = box(0.36, 0.46, 0.34, 0x6a5640); body.position.y = 0; g.add(body);
  const head = box(0.36, 0.3, 0.3, 0x7a6248); head.position.set(0, 0.34, 0.02); g.add(head);
  for (const x of [-0.09, 0.09]) {
    const eye = box(0.1, 0.1, 0.05, 0xf2c84a, 0x705012); eye.position.set(x, 0.36, 0.16); g.add(eye);
    const ear = box(0.06, 0.1, 0.06, 0x5a4632); ear.position.set(x * 1.4, 0.52, 0); g.add(ear);
  }
  const beak = box(0.06, 0.08, 0.08, 0x3a2a1a); beak.position.set(0, 0.28, 0.18); g.add(beak);
  const wings = [];
  for (const x of [-1, 1]) { const w = box(0.5, 0.08, 0.32, 0x5a4632); w.position.set(x * 0.42, 0.06, 0); g.add(w); wings.push(w); }
  return { group: g, legs: [], wings, body, head };
}

function makeCrow() {
  const g = new THREE.Group();
  const body = box(0.26, 0.26, 0.5, 0x0c0c10); body.position.y = 0; g.add(body);
  const head = box(0.2, 0.2, 0.2, 0x101015); head.position.set(0, 0.16, 0.3); g.add(head);
  const beak = box(0.06, 0.06, 0.18, 0x1a1a1a); beak.position.set(0, 0.14, 0.46); g.add(beak);
  const tail = box(0.16, 0.06, 0.3, 0x0a0a0e); tail.position.set(0, 0.02, -0.34); g.add(tail);
  const wings = [];
  for (const x of [-1, 1]) { const w = box(0.6, 0.06, 0.28, 0x08080c); w.position.set(x * 0.4, 0.04, 0); g.add(w); wings.push(w); }
  return { group: g, legs: [], wings, body, head };
}

function makeLizard() {
  const g = new THREE.Group();
  const body = box(0.16, 0.08, 0.34, 0x4a5a32); body.position.y = 0.06; g.add(body);
  const head = box(0.12, 0.08, 0.12, 0x55683a); head.position.set(0, 0.06, 0.22); g.add(head);
  const tail = box(0.06, 0.05, 0.3, 0x3e4c2a); tail.position.set(0, 0.05, -0.28); g.add(tail);
  const legs = [];
  for (const [x, z] of [[-0.1, 0.1], [0.1, 0.1], [-0.1, -0.1], [0.1, -0.1]]) {
    const l = box(0.04, 0.05, 0.1, 0x3a4828); l.position.set(x, 0.03, z); l.rotation.y = x < 0 ? 0.5 : -0.5; g.add(l); legs.push(l);
  }
  return { group: g, legs, body, head };
}

function makeCurlew() {
  const g = new THREE.Group();
  const body = box(0.3, 0.28, 0.46, 0x8a7448); body.position.y = 0.5; g.add(body);
  const neck = box(0.12, 0.24, 0.12, 0x9a8458); neck.position.set(0, 0.74, 0.18); g.add(neck);
  const head = box(0.16, 0.16, 0.18, 0x9a8458); head.position.set(0, 0.9, 0.22); g.add(head);
  const bill = box(0.04, 0.04, 0.34, 0x2a1c12); bill.position.set(0, 0.84, 0.42); bill.rotation.x = 0.5; g.add(bill); // long downcurved bill
  const legs = [];
  for (const x of [-0.08, 0.08]) { const l = box(0.04, 0.4, 0.04, 0x4a4030); l.position.set(x, 0.2, 0); g.add(l); legs.push(l); }
  const wings = [];
  for (const x of [-1, 1]) { const w = box(0.34, 0.05, 0.34, 0x6e5c3a); w.position.set(x * 0.18, 0.54, -0.02); g.add(w); wings.push(w); }
  return { group: g, legs, body, head, wings };
}

function makeFrog() {
  const g = new THREE.Group();
  const body = box(0.24, 0.14, 0.26, 0x3a6a2e); body.position.y = 0.1; g.add(body);
  for (const x of [-0.07, 0.07]) {
    const eye = box(0.07, 0.07, 0.07, 0x6a9a3a); eye.position.set(x, 0.2, 0.08); g.add(eye);
    const pup = box(0.03, 0.03, 0.03, 0x101810); pup.position.set(x, 0.22, 0.13); g.add(pup);
  }
  const legs = [];
  for (const [x, z] of [[-0.12, -0.08], [0.12, -0.08]]) { const l = box(0.06, 0.06, 0.16, 0x336026); l.position.set(x, 0.05, z); g.add(l); legs.push(l); }
  for (const [x, z] of [[-0.1, 0.1], [0.1, 0.1]]) { const l = box(0.05, 0.05, 0.1, 0x336026); l.position.set(x, 0.05, z); g.add(l); legs.push(l); }
  return { group: g, legs, body, head: body };
}

function makeSeagull() {
  const g = new THREE.Group();
  const body = box(0.3, 0.3, 0.5, 0xeef0f2); body.position.y = 0; g.add(body);
  const head = box(0.2, 0.2, 0.2, 0xf8fafc); head.position.set(0, 0.18, 0.3); g.add(head);
  const beak = box(0.07, 0.07, 0.16, 0xe8b028); beak.position.set(0, 0.14, 0.46); g.add(beak);
  const tail = box(0.18, 0.06, 0.26, 0xdfe4e8); tail.position.set(0, 0.02, -0.34); g.add(tail);
  const wings = [];
  for (const x of [-1, 1]) { const w = box(0.7, 0.06, 0.3, 0xc2cdd6); w.position.set(x * 0.46, 0.05, 0); g.add(w); wings.push(w); }
  return { group: g, legs: [], wings, body, head };
}

// ---------- villagers ----------
// Appearance derived from t' persona's name (matches yorkshire_bot's roster).
function villagerLook(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('glinda')) return { scale: 1.0, jumper: 0x8a8294, skirt: 0x4a4452, hair: 0xe8e8e8, cap: null, shawl: 0x6a5a6e };
  if (n.includes('james')) return { scale: 1.05, jumper: 0x4a5a3a, skirt: 0x3a342a, hair: 0x5a4a36, cap: 0x32402a };
  if (n.includes('harry')) return { scale: 0.62, jumper: 0x3a6a9a, skirt: 0x3a342a, hair: 0x6a4a2a, cap: null };
  if (n.includes('karen')) return { scale: 0.62, jumper: 0xa84a5a, skirt: 0x7a3a4a, hair: 0x6a4a2a, cap: null };
  if (n.includes('cc')) return { scale: 0.45, jumper: 0xc88ab0, skirt: 0xb07a9e, hair: 0xf2d878, cap: null, curls: true };
  if (n.includes('max')) return { scale: 0.32, jumper: 0xd8d0c0, skirt: 0xd8d0c0, hair: 0x9a7a4a, cap: null };
  return { scale: 1.0, jumper: 0x6a5a40, skirt: 0x4a4438, hair: 0x4a3a28, cap: 0x3a342e };
}

// Floating nameplate so tha can tell who's who from across t' green.
function makeNameplate(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.font = 'bold 30px "Segoe UI", sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.strokeStyle = 'rgba(0,0,0,0.85)'; x.lineWidth = 6;
  x.strokeText(text, 128, 32);
  x.fillStyle = '#ffe9b0';
  x.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false, opacity: 0,
  }));
  spr.scale.set(1.9, 0.48, 1);
  spr.renderOrder = 50;
  return spr;
}

// A faint floating prompt so a body knows a pony'll let thee up.
function makeRideLabel() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 56;
  const x = c.getContext('2d');
  x.font = 'bold 23px "Segoe UI", sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.strokeStyle = 'rgba(0,0,0,0.85)'; x.lineWidth = 5;
  x.strokeText('right-click to ride', 128, 28);
  x.fillStyle = '#ffe9b0';
  x.fillText('right-click to ride', 128, 28);
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false, opacity: 0,
  }));
  spr.scale.set(1.7, 0.37, 1);
  spr.renderOrder = 50;
  return spr;
}

// A spoken line floating ower a villager's head.
function makeBubble(text) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 160;
  const x = c.getContext('2d');
  x.font = '26px "Segoe UI", sans-serif';
  // wrap into up to 4 lines
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (x.measureText(t).width > 460 && cur) { lines.push(cur); cur = w; }
    else cur = t;
    if (lines.length === 3) break;
  }
  if (cur && lines.length < 4) lines.push(cur);
  const h = 24 + lines.length * 32;
  // bubble back
  x.fillStyle = 'rgba(12, 12, 10, 0.88)';
  x.strokeStyle = 'rgba(216, 185, 90, 0.9)';
  x.lineWidth = 3;
  const y0 = 160 - h;
  x.beginPath();
  x.roundRect(6, y0, 500, h - 14, 12);
  x.fill(); x.stroke();
  // little tail
  x.beginPath();
  x.moveTo(246, 160 - 16); x.lineTo(266, 160 - 16); x.lineTo(256, 158); x.closePath();
  x.fillStyle = 'rgba(12, 12, 10, 0.88)'; x.fill();
  x.fillStyle = '#f0e8d0';
  x.textAlign = 'center';
  lines.forEach((l, i) => x.fillText(l, 256, y0 + 30 + i * 32));
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  spr.scale.set(3.4, 1.06, 1);
  spr.renderOrder = 60;
  return spr;
}

function makeVillager(look) {
  const g = new THREE.Group();
  const s = look.scale;
  const skin = 0xd8ab8a;
  const legs = [];
  for (const x of [-0.11, 0.11]) {
    const l = box(0.16 * s, 0.55 * s, 0.16 * s, look.skirt);
    l.position.set(x * s * 1.6, 0.28 * s, 0);
    g.add(l); legs.push(l);
  }
  const body = box(0.5 * s, 0.6 * s, 0.3 * s, look.jumper);
  body.position.y = 0.85 * s; g.add(body);
  const arms = [];
  for (const x of [-0.33, 0.33]) {
    const a = box(0.14 * s, 0.55 * s, 0.14 * s, look.jumper);
    a.position.set(x * s, 0.85 * s, 0);
    g.add(a); arms.push(a);
  }
  const head = box(0.36 * s, 0.36 * s, 0.36 * s, skin);
  head.position.y = 1.34 * s; g.add(head);
  const hair = box(0.38 * s, 0.12 * s, 0.38 * s, look.hair);
  hair.position.y = (1.34 + 0.2) * s; g.add(hair);
  if (look.curls) {
    // a mop o' golden curls: bobbles round t' head
    for (const [cx, cz] of [[-0.2, 0], [0.2, 0], [0, -0.2], [-0.14, -0.16], [0.14, -0.16]]) {
      const curl = box(0.14 * s, 0.14 * s, 0.14 * s, look.hair);
      curl.position.set(cx * s, 1.42 * s, cz * s);
      g.add(curl);
    }
  }
  if (look.cap) {
    const cap = box(0.46 * s, 0.07 * s, 0.46 * s, look.cap);
    cap.position.set(0, (1.34 + 0.26) * s, 0.04 * s); g.add(cap);
  }
  if (look.shawl) {
    const sh = box(0.56 * s, 0.2 * s, 0.36 * s, look.shawl);
    sh.position.y = 1.08 * s; g.add(sh);
  }
  // little dark eyes so tha knows they're looking at thee
  for (const x of [-0.08, 0.08]) {
    const eye = box(0.05 * s, 0.05 * s, 0.02 * s, 0x222222);
    eye.position.set(x * s, 1.38 * s, 0.19 * s); g.add(eye);
  }
  return { group: g, legs: legs.concat(arms), body, head };
}

// ---------- Merlin wizard extras ----------
// Re-robes a freshly-built villager into a proper glowing wizard: recolours the
// body/arms/legs into the robe (so no default villager shows through), then adds
// a full beard, a flared robe with gold trim, a wide-brim pointed hat with a
// glowing tip, and a breathing glow.  Takes the whole villager model so it can
// restyle its parts.  s = look.scale (1.0 for a standard-height adult).
function makeWizardExtras(model, s) {
  const group   = model.group;
  const ROBE    = 0x352a78; // deep indigo robe
  const ROBE_DK = 0x231b52; // darker robe for the skirt/legs
  const TRIM    = 0xc9a23a; // gold trim
  const BEARD   = 0xeae6dc; // near-white beard
  const GLOW    = 0xffe080; // warm gold glow

  // 1) Re-robe the villager: recolour body, arms and legs so no brown shows.
  //    The head (skin) stays as the face.  model.legs holds legs + arms.
  try {
    if (model.body) model.body.material.color.setHex(ROBE);
    for (const part of (model.legs || [])) {
      part.material.color.setHex(part.position.y > 0.6 * s ? ROBE : ROBE_DK);
    }
  } catch (e) { /* fail-safe — base avatar still renders */ }

  // 2) A fuller robe over the body + a flared skirt, for a proper silhouette,
  //    cinched with a gold belt.
  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(0.62 * s, 0.72 * s, 0.44 * s),
    new THREE.MeshLambertMaterial({ color: ROBE, emissive: GLOW, emissiveIntensity: 0.26 }),
  );
  torso.position.y = 0.86 * s; group.add(torso);
  const skirt = new THREE.Mesh(
    new THREE.BoxGeometry(0.82 * s, 0.62 * s, 0.52 * s),
    new THREE.MeshLambertMaterial({ color: ROBE_DK, emissive: GLOW, emissiveIntensity: 0.16 }),
  );
  skirt.position.y = 0.33 * s; group.add(skirt);
  const belt = new THREE.Mesh(
    new THREE.BoxGeometry(0.66 * s, 0.09 * s, 0.48 * s),
    new THREE.MeshLambertMaterial({ color: TRIM, emissive: TRIM, emissiveIntensity: 0.3 }),
  );
  belt.position.y = 0.6 * s; group.add(belt);

  // 3) A proper full beard: stacked tapering boxes from the jaw to mid-chest,
  //    with a moustache so it meets the face cleanly.  (Head centre ~1.34s.)
  const beardSegs = [[0.32, 0.14, 1.17], [0.27, 0.14, 1.04], [0.20, 0.14, 0.91], [0.12, 0.13, 0.79]];
  for (const [w, h, y] of beardSegs) {
    const seg = new THREE.Mesh(
      new THREE.BoxGeometry(w * s, h * s, 0.15 * s),
      new THREE.MeshLambertMaterial({ color: BEARD }),
    );
    seg.position.set(0, y * s, 0.2 * s); group.add(seg);
  }
  const tash = new THREE.Mesh(
    new THREE.BoxGeometry(0.32 * s, 0.08 * s, 0.1 * s),
    new THREE.MeshLambertMaterial({ color: BEARD }),
  );
  tash.position.set(0, 1.26 * s, 0.21 * s); group.add(tash);

  // 4) Wide-brim pointed hat over the hair, with a gold band and a glowing tip.
  const brim = new THREE.Mesh(
    new THREE.BoxGeometry(0.74 * s, 0.06 * s, 0.74 * s),
    new THREE.MeshLambertMaterial({ color: ROBE_DK }),
  );
  brim.position.y = 1.56 * s; group.add(brim);
  const band = new THREE.Mesh(
    new THREE.BoxGeometry(0.52 * s, 0.08 * s, 0.52 * s),
    new THREE.MeshLambertMaterial({ color: TRIM, emissive: TRIM, emissiveIntensity: 0.3 }),
  );
  band.position.y = 1.62 * s; group.add(band);
  const hat = new THREE.Mesh(
    new THREE.ConeGeometry(0.3 * s, 0.66 * s, 8),
    new THREE.MeshLambertMaterial({ color: ROBE, emissive: GLOW, emissiveIntensity: 0.4 }),
  );
  hat.position.y = (1.62 + 0.33) * s; group.add(hat);
  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.1 * s, 10, 10),
    new THREE.MeshBasicMaterial({ color: GLOW }),
  );
  orb.position.y = (1.62 + 0.7) * s; group.add(orb);

  // 5) Glow: a bright warm core light + a wide soft halo, breathing (pulsed in
  //    updateVillager via group.userData.wizLights).
  const core = new THREE.PointLight(GLOW, 2.3, 13);
  core.position.y = 1.0 * s; group.add(core);
  const halo = new THREE.PointLight(GLOW, 1.0, 22);
  halo.position.y = 1.2 * s; group.add(halo);
  group.userData.wizLights = [
    { light: core, base: 2.3 },
    { light: halo, base: 1.0 },
  ];
}

export const MOB_TYPES = {
  sheep: {
    make: makeSheep, hw: 0.45, h: 1.1, hp: 8, speed: 1.6, fleeSpeed: 4.2,
    hostile: false, drops: [[I.RAW_MUTTON, 1, 2], [B.WOOL, 1, 2]], cap: 36, name: 'Swaledale Yow',
    group: [4, 7], // Swaledales graze t' moor in flocks, not singly
    tameable: true, tameFood: [I.BILBERRIES],
  },
  grouse: {
    make: makeGrouse, hw: 0.2, h: 0.6, hp: 3, speed: 1.4, fleeSpeed: 3.8,
    hostile: false, drops: [[I.RAW_GROUSE, 1, 1]], cap: 10, name: 'Red Grouse',
    habitat: 'moor', shy: true, shyRadius: 6, flush: true, fleeFor: 3,
  },
  hare: {
    make: makeHare, hw: 0.2, h: 0.7, hp: 4, speed: 2.6, fleeSpeed: 6.4,
    hostile: false, drops: [], cap: 6, name: 'Brown Hare',
    shy: true, shyRadius: 7, fleeFor: 4, // bolts t' moment tha gets near — unless tha holds her food
    tameable: true, tameFood: [I.BILBERRIES],
  },
  barghest: {
    make: makeBarghest, hw: 0.45, h: 1.6, hp: 22, speed: 4.0, fleeSpeed: 4.6,
    hostile: true, dmg: 3, attackRange: 1.8, drops: [[I.COAL_LUMP, 0, 2]], cap: 3, night: true, name: 'Barghest',
  },
  boggart: {
    make: makeBoggart, hw: 0.3, h: 1.3, hp: 10, speed: 3.0, fleeSpeed: 3.0,
    hostile: true, dmg: 2, attackRange: 1.4, drops: [[B.PEAT, 0, 2]], cap: 4, night: true, name: 'Boggart',
  },
  // ---- t' living moor: cattle, game birds, fliers, basking lizards ----
  cow: {
    make: makeCow, hw: 0.55, h: 1.45, hp: 12, speed: 1.2, fleeSpeed: 2.8,
    hostile: false, drops: [[I.RAW_BEEF, 1, 2]], cap: 12, name: 'Dale Cow',
    habitat: 'pasture', group: [2, 4],
    tameable: true, tameFood: [I.BILBERRIES],
  },
  bull: {
    make: makeBull, hw: 0.6, h: 1.6, hp: 20, speed: 3.8, fleeSpeed: 3.0,
    hostile: false, aggroRadius: 8, dmg: 4, attackRange: 1.9, attackCause: 'A bull had thee on its horns',
    drops: [[I.RAW_BEEF, 1, 3]], cap: 1, name: 'Dale Bull', habitat: 'pasture',
  },
  llama: {
    make: makeLlama, hw: 0.45, h: 2.2, hp: 14, speed: 1.4, fleeSpeed: 2.6,
    hostile: false, drops: [[B.WOOL, 1, 2]], cap: 6, name: 'Pack Llama',
    habitat: 'pasture', group: [2, 3],
  },
  pony: {
    make: makePony, hw: 0.42, h: 1.7, hp: 18, speed: 1.7, fleeSpeed: 3.2,
    hostile: false, drops: [], cap: 12, name: 'Moorland Pony',
    habitat: 'moor', group: [2, 3], // half-wild, but they'll let thee up
  },
  // ---- beasts a body can keep: feed 'em their favourite an' they'll throw their lot in wi' thee ----
  dog: {
    make: makeDog, hw: 0.32, h: 0.85, hp: 12, speed: 2.2, fleeSpeed: 3.0,
    hostile: false, drops: [], cap: 2, name: 'Moor Sheepdog', habitat: 'edge',
    tameable: true, tameFood: [I.RAW_MUTTON, I.COOKED_MUTTON, I.RAW_BEEF, I.COOKED_BEEF, I.RAW_GROUSE],
  },
  cat: {
    make: makeCat, hw: 0.22, h: 0.6, hp: 8, speed: 2.0, fleeSpeed: 4.2,
    hostile: false, drops: [], cap: 2, name: 'Farm Cat', habitat: 'edge',
    shy: true, shyRadius: 4, fleeFor: 2,
    tameable: true, tameFood: [I.RAW_TROUT, I.SEA_FISH, I.COOKED_FISH, I.RAW_GROUSE],
  },
  pig: {
    make: makePig, hw: 0.36, h: 0.9, hp: 12, speed: 1.4, fleeSpeed: 2.6,
    hostile: false, drops: [[I.RAW_BEEF, 1, 1]], cap: 3, name: 'Saddleback Pig',
    habitat: 'pasture', group: [1, 3],
    tameable: true, tameFood: [I.BILBERRIES, I.RAW_BEEF, I.COOKED_BEEF, I.RAW_MUTTON],
  },
  rat: {
    make: makeRat, hw: 0.16, h: 0.3, hp: 4, speed: 2.4, fleeSpeed: 4.4,
    hostile: false, drops: [], cap: 3, name: 'Moor Rat', habitat: 'edge', night: true,
    shy: true, shyRadius: 4, fleeFor: 2,
    tameable: true, tameFood: [I.BILBERRIES, I.RAW_GROUSE, I.RAW_MUTTON],
  },
  // a moored fishing boat tha can board an' sail — never wild-spawns; t' harbours provide 'em
  coble: {
    make: makeCoble, hw: 0.9, h: 1.0, hp: 40, speed: 0, fleeSpeed: 0,
    hostile: false, drops: [], cap: 0, natural: false, name: 'Coble', vehicle: true,
  },
  pheasant: {
    make: makePheasant, hw: 0.2, h: 0.85, hp: 3, speed: 1.6, fleeSpeed: 4.6,
    hostile: false, drops: [[I.RAW_GROUSE, 1, 1]], cap: 5, name: 'Pheasant',
    habitat: 'edge', shy: true, shyRadius: 7, flush: true, fleeFor: 4,
  },
  owl: {
    make: makeOwl, hw: 0.3, h: 0.6, hp: 4, speed: 4.0, fleeSpeed: 4.0,
    hostile: false, drops: [], cap: 2, name: 'Tawny Owl',
    fly: true, swoop: true, flyBand: 12, night: true,
  },
  crow: {
    make: makeCrow, hw: 0.25, h: 0.4, hp: 3, speed: 4.5, fleeSpeed: 5.0,
    hostile: false, drops: [], cap: 12, name: 'Carrion Crow',
    fly: true, flock: true, flyBand: 16, day: true, group: [3, 6], habitat: 'moor',
  },
  lizard: {
    make: makeLizard, hw: 0.12, h: 0.18, hp: 2, speed: 1.0, fleeSpeed: 5.5,
    hostile: false, drops: [], cap: 5, name: 'Common Lizard',
    bask: true, shy: true, shyRadius: 5, fleeFor: 2.5, day: true, habitat: 'rock',
  },
  curlew: {
    make: makeCurlew, hw: 0.2, h: 0.95, hp: 3, speed: 1.5, fleeSpeed: 4.4,
    hostile: false, drops: [], cap: 8, name: 'Curlew',
    shy: true, shyRadius: 8, flush: true, fleeFor: 4, habitat: 'moor',
  },
  frog: {
    make: makeFrog, hw: 0.14, h: 0.22, hp: 2, speed: 1.2, fleeSpeed: 3.2,
    hostile: false, drops: [], cap: 5, name: 'Frog',
    shy: true, shyRadius: 4, fleeFor: 2, habitat: 'water',
  },
  seagull: {
    make: makeSeagull, hw: 0.28, h: 0.5, hp: 3, speed: 4.8, fleeSpeed: 5.2,
    hostile: false, drops: [], cap: 6, name: 'Herring Gull',
    fly: true, flock: true, flyBand: 18, day: true, group: [2, 5], habitat: 'coast',
  },
  // quest-only creatures (never spawn naturally)
  lamb: {
    make: () => {
      const m = makeSheep();
      m.group.scale.setScalar(0.55);
      return m;
    },
    hw: 0.26, h: 0.62, hp: 6, speed: 2.4, fleeSpeed: 2.4,
    hostile: false, drops: [[I.RAW_MUTTON, 0, 1]], cap: 0, natural: false, name: 'Lost Lamb', follower: true,
  },
  greatbarghest: {
    make: () => {
      const m = makeBarghest();
      m.group.scale.setScalar(1.65);
      return m;
    },
    hw: 0.75, h: 2.6, hp: 60, speed: 5.2, fleeSpeed: 5.2,
    hostile: true, dmg: 6, attackRange: 2.6, drops: [[I.JET_GEM, 1, 2], [I.HIDE_SCRAP, 1, 1]],
    cap: 0, natural: false, night: true, boss: true, name: 'T\u2019 Great Barghest',
  },
  dracula: {
    make: makeDracula, hw: 0.42, h: 2.1, hp: 72, speed: 4.9, fleeSpeed: 5.5,
    hostile: true, dmg: 8, attackRange: 2.2, drops: [[I.JET_GEM, 2, 3], [I.DRACULA_JOURNAL, 1, 1]],
    cap: 0, natural: false, night: true, boss: true, name: 'Count Dracula',
  },
};

export class Entities {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.mobs = [];
    this.drops = [];
    this.particles = [];
    this.steam = [];       // t' loco's steam: soft trailing puffs (not hard pellets)
    this.spawnTimer = 0;
    this.particleGeom = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    this.prints = [];      // t' barghest's fading dawn paw-prints
    this.printDay = -1;
    this.nosyToken = null; // only ONE villager breaks off to greet thee at a time (no creepy crowds)
  }

  // ---------- villagers ----------
  spawnVillager(charId, name, x, y, z, opts = {}) {
    const look = villagerLook(name);
    const model = makeVillager(look);
    // Merlin gets the wizard treatment — keyed on pid (charId) with name fallback
    const isMerlin = charId === 'clint-body' || (name || '').toLowerCase() === 'merlin';
    if (isMerlin) {
      try { makeWizardExtras(model, look.scale); } catch (err) { /* fail safe — default avatar still rendered */ }
    }
    this.scene.add(model.group);
    const displayName = name.replace(/\b\w/g, c => c.toUpperCase());
    const plate = makeNameplate(displayName);
    plate.position.y = Math.max(0.9, 1.65 * look.scale) + 0.55;
    model.group.add(plate);
    const v = {
      type: 'villager',
      t: { hostile: false, speed: 1.1, name },
      model, charId, plate,
      displayName,
      pos: { x, y, z }, vel: { x: 0, y: 0, z: 0 },
      home: { x, z },
      village: opts.village || null,   // which settlement they belong to
      house: opts.house || null,       // {b, out, inside} frae geo.npcHome
      atHome: false, homeStuck: 0,
      hw: 0.28 * look.scale + 0.08, h: Math.max(0.5, 1.65 * look.scale), onGround: false,
      hp: Infinity, yaw: Math.random() * Math.PI * 2,
      state: 'idle', stateTimer: 1 + Math.random() * 4,
      walkPhase: Math.random() * 10, flash: 0, attackCd: 0, fleeTimer: 0,
      chatLog: [],
      // ---- inner life ----
      role: opts.role || null,
      roam: !!opts.roam,
      work: opts.work || null,    // their daytime patch
      green: opts.green || null,  // the village green (midday social)
      mood: Math.max(0.15, Math.min(0.95, 0.55 + (Math.random() * 0.4 - 0.2))),
      sociable: 0.4 + Math.random() * 0.5,
      memory: [],
      nosyCd: 6 + Math.random() * 12,
    };
    this.mobs.push(v);
    return v;
  }

  // ---------- mobs ----------
  spawnMob(type, x, y, z) {
    const t = MOB_TYPES[type];
    const model = t.make();
    this.scene.add(model.group);
    const mob = {
      type, t, model,
      pos: { x, y, z }, vel: { x: 0, y: 0, z: 0 },
      hw: t.hw, h: t.h, onGround: false,
      hp: t.hp, yaw: Math.random() * Math.PI * 2,
      state: 'idle', stateTimer: Math.random() * 3,
      target: null, fleeTimer: 0, attackCd: 0, flash: 0,
      walkPhase: Math.random() * 10,
    };
    this.mobs.push(mob);
    if (type === 'pony') {
      const label = makeRideLabel();
      label.position.set(0, 2.5, 0);
      model.group.add(label);
      mob.label = label;
    }
    return mob;
  }

  draculaVanquished() {
    return this.game?.quests?.draculaDone?.() ?? false;
  }

  draculaActive() {
    return this.mobs.some(m => m.type === 'dracula' && !m.dead);
  }

  // dread 0..1: how close t' Count is when he walks (felt afore he's seen)
  draculaDread(player) {
    if (!this.game?.sky?.isNight() || this.draculaVanquished()) return 0;
    let best = 0;
    for (const m of this.mobs) {
      if (m.type !== 'dracula' || m.dead) continue;
      const d = Math.hypot(m.pos.x - player.pos.x, m.pos.z - player.pos.z);
      if (d > 130) continue;
      best = Math.max(best, 1 - d / 130);
    }
    // quest anticipation: a creeping unease on t' moor at neet even afore he rises
    if (!best && this.game?.quests?.draculaHuntActive?.()) {
      const geo = this.world.gen.geo;
      if (!geo.inVillage(player.pos.x, player.pos.z, 8) && !this.world.nearLight(player.pos.x, player.pos.z, 12)) {
        best = 0.18;
      }
    }
    return best;
  }

  trySpawns(player, isNight, audio) {
    const counts = {};
    for (const m of this.mobs) counts[m.type] = (counts[m.type] || 0) + 1;
    // t' amulet o' t' moors wards off owt dark
    const warded = player.countItem(I.AMULET) > 0;
    const dracGone = this.draculaVanquished();
    // early nights are gentler: half t' hostile caps for t' first few days,
    // so little 'uns find their feet afore t' moor turns proper dark
    const day = this.day || 1;
    const geo = this.world.gen.geo;
    const types = Object.keys(MOB_TYPES).filter(k => {
      const t = MOB_TYPES[k];
      if (t.natural === false) return false;
      if (t.night && !isNight) return false;
      if (t.day && isNight) return false;        // day birds roost at neet
      if (t.hostile && warded) return false;
      let cap = t.hostile && day <= 3 ? Math.max(1, t.cap >> 1) : t.cap;
      // once Dracula's laid to rest, t' common night horrors thin out a touch
      if (t.hostile && dracGone && (k === 'barghest' || k === 'boggart')) cap = Math.max(1, cap - 1);
      return (counts[k] || 0) < cap;
    });
    if (!types.length) return;
    // t' season shapes t' moor: birds throng in spring, but in deep winter
    // little new ventures out.
    const season = this.game && this.game.season;
    if (season && season.warmth < 0 && Math.random() < (-season.warmth) * 0.3) return;
    let type;
    if (season) {
      const spring = Math.max(0, Math.min(1, season.greenness));
      const wts = types.map(k =>
        k === 'sheep' ? 3.5                            // t' moor should be thick wi' Swaledales
          : k === 'pony' ? 2.0                         // an' enough ponies that tha can find one
          : k === 'cow' ? 1.6
          : k === 'curlew' ? 0.5 + spring * 2.5        // curlews come back to nest in spring
          : (k === 'grouse' || k === 'pheasant') ? 0.7 + spring * 1.2
          : k === 'crow' ? 1 + (1 - spring) * 0.8      // crows commoner in t' lean months
          : 1);
      let r = Math.random() * wts.reduce((a, b) => a + b, 0);
      type = types[types.length - 1];
      for (let i = 0; i < types.length; i++) { r -= wts[i]; if (r <= 0) { type = types[i]; break; } }
    } else {
      type = types[(Math.random() * types.length) | 0];
    }
    const t = MOB_TYPES[type];
    if (t.hostile && day <= 2 && Math.random() < 0.5) return; // first neets: a taster, not a massacre
    const ang = Math.random() * Math.PI * 2;
    const dist = t.hostile ? 26 + Math.random() * 22 : 24 + Math.random() * 62; // grazers spread right across t' visible moor
    const x = Math.floor(player.pos.x + Math.cos(ang) * dist);
    const z = Math.floor(player.pos.z + Math.sin(ang) * dist);
    if (!this.world.isLoaded(x, z)) return;
    // nowt nasty walks into Moorstead — t' village is safe ground
    if (t.hostile && geo.inVillage(x, z, 12)) return;
    // nor will owt dark rise near a burning light (shelters, torch camps)
    if (t.hostile && this.world.nearLight(x, z, 18)) return;
    // find t' surface block an' its height
    let surfY = -1, surfB = 0;
    for (let y = HEIGHT - 2; y > 1; y--) {
      const b = this.world.getBlock(x, y, z);
      if (b === B.AIR) continue;
      if (b === B.GRASS || b === B.PEAT || b === B.DIRT || b === B.STONE || b === B.SAND) {
        const above = this.world.getBlock(x, y + 1, z);
        if (above === B.AIR || (BLOCKS[above] && BLOCKS[above].kind === 'cutout')) { surfY = y; surfB = b; }
      }
      break;
    }
    if (surfY < 0) return;
    // t' lineside fence pens beasts off t' railway — nowt walks on t' track (birds fly ower)
    if (!t.fly) { const ri = geo.railInfo(x, z); if (ri && ri.d < 3.2) return; }
    // right beast for t' right ground
    if (t.habitat && !this.habitatOk(t, geo, x, z, surfY, surfB)) return;
    const mob = this.spawnMob(type, x + 0.5, t.fly ? surfY + (t.flyBand || 14) : surfY + 1.05, z + 0.5);
    if (type === 'barghest' && audio) audio.howl();
    // herds an' flocks come in numbers
    if (t.group) {
      const extra = t.group[0] + ((Math.random() * (t.group[1] - t.group[0] + 1)) | 0) - 1;
      for (let i = 0; i < extra; i++) {
        this.spawnNear(type, x + ((Math.random() * 10 - 5) | 0), z + ((Math.random() * 10 - 5) | 0));
      }
    }
    // spring lambing: ewes come wi' lambs at heel (they follow their mother, not thee)
    if (type === 'sheep' && season && season.greenness > 0.55 && Math.random() < 0.7) {
      const nLambs = 1 + ((Math.random() * 2) | 0);
      for (let i = 0; i < nLambs; i++) {
        const lamb = this.spawnMob('lamb', x + 0.5 + (Math.random() * 2 - 1), surfY + 1.0, z + 0.5 + (Math.random() * 2 - 1));
        if (lamb) { lamb.naturalLamb = true; lamb.mother = mob; }
      }
    }
    return mob;
  }

  // one more o' t' same on t' surface at (x,z) — for herds an' flocks
  spawnNear(type, x, z) {
    if (!this.world.isLoaded(x, z)) return;
    const t = MOB_TYPES[type];
    if (!t.fly) { const ri = this.world.gen.geo.railInfo(x, z); if (ri && ri.d < 3.0) return; } // not on t' track

    for (let y = HEIGHT - 2; y > 1; y--) {
      const b = this.world.getBlock(x, y, z);
      if (b === B.AIR) continue;
      if (b === B.GRASS || b === B.PEAT || b === B.DIRT || b === B.STONE || b === B.SAND) {
        const above = this.world.getBlock(x, y + 1, z);
        if (above === B.AIR || (BLOCKS[above] && BLOCKS[above].kind === 'cutout')) {
          this.spawnMob(type, x + 0.5, t.fly ? y + (t.flyBand || 14) : y + 1.05, z + 0.5);
        }
      }
      break;
    }
  }

  // pop a stuck beast onto t' highest dry surface within a few blocks — out o' a
  // dug pit (t' rim stands higher than t' floor) or off a bog pool.
  rescueStuck(mob) {
    const sx = Math.floor(mob.pos.x), sz = Math.floor(mob.pos.z);
    let best = null, bestY = -1;
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
      const x = sx + dx, z = sz + dz;
      if (!this.world.isLoaded(x, z)) continue;
      for (let y = HEIGHT - 2; y > 1; y--) {
        const b = this.world.getBlock(x, y, z);
        if (b === B.AIR) continue;
        if (b !== B.WATER && b !== B.BOG && this.world.getBlock(x, y + 1, z) === B.AIR && y > bestY) { bestY = y; best = { x, z, y }; }
        break;
      }
    }
    if (best) { mob.pos.x = best.x + 0.5; mob.pos.z = best.z + 0.5; mob.pos.y = best.y + 1.05; mob.vel.x = mob.vel.y = mob.vel.z = 0; }
  }

  // warden helper: drop a wee group of beasts on t' ground near (x,z), cap or no cap
  forceSpawnGroup(type, x, z, n) {
    let spawned = 0;
    for (let i = 0; i < n; i++) {
      const ox = Math.floor(x) + ((Math.random() * 8 - 4) | 0), oz = Math.floor(z) + ((Math.random() * 8 - 4) | 0);
      if (!this.world.isLoaded(ox, oz)) continue;
      for (let y = HEIGHT - 2; y > 1; y--) {
        const b = this.world.getBlock(ox, y, oz);
        if (b === B.AIR) continue;
        if ((b === B.GRASS || b === B.PEAT || b === B.DIRT || b === B.STONE || b === B.SAND) && this.world.getBlock(ox, y + 1, oz) === B.AIR) {
          this.spawnMob(type, ox + 0.5, y + 1.05, oz + 0.5); spawned++;
        }
        break;
      }
    }
    return spawned;
  }

  // is this t' right ground for yon beast?
  habitatOk(t, geo, x, z, h, surf) {
    const coast = geo.coastT(x, z);
    switch (t.habitat) {
      case 'coast': return coast > 0.05;
      case 'pasture': return coast === 0 && h >= WATER_LEVEL && h <= 34 && geo.bogginess(x, z) < 0.4 && (geo.daleness(x, z) > 0.3 || geo.inVillage(x, z, 24));
      case 'edge': return coast === 0 && h < 37 && (this.world.gen.woodiness(x, z) > 0.22 || geo.daleness(x, z) > 0.3);
      case 'moor': return coast === 0 && h >= 30;
      case 'rock': return surf === B.STONE || h >= 42;
      case 'water': return this.nearWater(x, h, z);
      default: return true;
    }
  }

  // is there beck, tarn or bog within a hop?
  nearWater(x, h, z) {
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      for (let dy = -1; dy <= 2; dy++) {
        const b = this.world.getBlock(x + dx, h + dy, z + dz);
        if (b === B.WATER || b === B.BOG) return true;
      }
    }
    return false;
  }

  hurtMob(mob, dmg, kx, kz, audio, player) {
    if (mob.type === 'villager') return; // tha doesn't clout t' neighbours
    const held = player.heldItem && player.heldItem();
    if (mob.type === 'dracula') {
      if (held && held.id === I.HOLY_STAKE) dmg = 24;
      else dmg = Math.max(1, Math.floor(dmg * 0.12));
    }
    mob.hp -= dmg;
    mob.flash = 0.25;
    mob.vel.x += kx * 7; mob.vel.z += kz * 7; mob.vel.y = 5;
    if (!mob.t.hostile) { mob.state = 'flee'; mob.fleeTimer = 7; }
    if (audio) audio.mobHurt(mob.type);
    if (mob.hp <= 0) this.killMob(mob, player);
  }

  killMob(mob, player) {
    if (this.onKill) this.onKill(mob);
    for (const [item, min, max] of mob.t.drops) {
      const n = min + ((Math.random() * (max - min + 1)) | 0);
      if (n > 0) this.spawnDrop(mob.pos.x, mob.pos.y + 0.5, mob.pos.z, item, n);
    }
    this.burst(mob.pos.x, mob.pos.y + mob.h / 2, mob.pos.z, [60, 60, 60], 10);
    this.scene.remove(mob.model.group);
    mob.dead = true;
  }

  // ---------- taming & companions ----------
  // Feed a tameable beast its favourite scran. Returns 'wrongfood', {tamed:false,progress}
  // or {tamed:true,name} once she throws her lot in wi' thee.
  tameStep(mob, foodId, player) {
    if (mob.owner || !mob.t.tameable || !mob.t.tameFood || !mob.t.tameFood.includes(foodId)) return 'wrongfood';
    const res = feedTrust(mob.tameProg || 0, Math.random);
    mob.tameProg = res.trust;
    mob.flash = 0.15;
    mob.state = 'idle'; mob.fleeTimer = 0; // she settles as she comes round to thee
    if (res.tamed) {
      const taken = (player.pets || []).map(p => p.name);
      const name = chooseName(Math.random, taken);
      this.makeCompanion(mob, name);
      return { tamed: true, name };
    }
    return { tamed: false, progress: Math.min(1, mob.tameProg / TAME_GOAL) };
  }

  // Turn a beast into a kept companion: named, follows thee, never despawns.
  makeCompanion(mob, name) {
    mob.owner = true;
    mob.petName = name;
    mob.petKind = mob.type;
    mob.state = 'follow';
    mob.naturalLamb = false;
    if (mob.label) { mob.model.group.remove(mob.label); mob.label = null; }
    if (mob.plate) mob.model.group.remove(mob.plate);
    const plate = makePetPlate(name);
    plate.position.y = (mob.t.h || 1) + 0.55;
    mob.model.group.add(plate);
    mob.plate = plate;
  }

  // Re-spawn saved companions at the player's heel on load.
  restorePets(list, player) {
    if (!list || !list.length) return;
    for (const p of list) {
      if (!MOB_TYPES[p.kind]) continue;
      const m = this.spawnMob(p.kind, player.pos.x + (Math.random() * 2 - 1), player.pos.y + 1, player.pos.z + (Math.random() * 2 - 1));
      if (m) this.makeCompanion(m, p.name);
    }
  }

  // The work a kept beast does each frame. Returns true if she's "away" (skip her update).
  companionBenefit(mob, dt, player, isNight, audio) {
    // caught miles behind (tha teleported?) — she pops back to heel
    if (Math.hypot(player.pos.x - mob.pos.x, player.pos.z - mob.pos.z) > 70) {
      mob.pos.x = player.pos.x + (Math.random() * 2 - 1);
      mob.pos.z = player.pos.z + (Math.random() * 2 - 1);
      mob.pos.y = player.pos.y + 1; mob.vel.x = mob.vel.y = mob.vel.z = 0;
    }
    // a cat sent scouting: away (hidden) on a timer, then back wi' summat in her teeth
    if (mob.scoutT !== undefined) {
      mob.scoutT -= dt;
      if (mob.scoutT <= 0) {
        mob.scoutT = undefined;
        mob.model.group.visible = true;
        mob.pos.x = player.pos.x + (Math.random() * 2 - 1);
        mob.pos.z = player.pos.z + (Math.random() * 2 - 1);
        mob.pos.y = player.pos.y + 0.5; mob.vel.x = mob.vel.y = mob.vel.z = 0;
        this.petReward(mob, player, 'cat');
      }
      return true;
    }
    // a good dog drives neet-things off thee (not bosses — they're thine to face)
    if (mob.petKind === 'dog') {
      mob.wardCd = (mob.wardCd || 0) - dt;
      if (mob.wardCd <= 0) {
        mob.wardCd = 0.9;
        for (const h of this.mobs) {
          if (h.dead || !h.t || !h.t.hostile || h.t.boss) continue;
          const hd = Math.hypot(h.pos.x - player.pos.x, h.pos.z - player.pos.z);
          if (hd < 8.5) {
            const inv = hd || 1;
            this.hurtMob(h, 3, (h.pos.x - player.pos.x) / inv, (h.pos.z - player.pos.z) / inv, audio, player);
          }
        }
      }
    }
    // a pig's snuffle recharges over time
    if (mob.petKind === 'pig' && mob.snuffleCd > 0) mob.snuffleCd -= dt;
    // a rat forages i' t' dark as tha mines
    if (mob.petKind === 'rat') {
      const surf = this.world.gen.height(Math.floor(player.pos.x), Math.floor(player.pos.z));
      if (player.pos.y < surf - 4) {
        mob.forageCd = (mob.forageCd === undefined ? 30 : mob.forageCd) - dt;
        if (mob.forageCd <= 0) { mob.forageCd = 40 + Math.random() * 50; this.petReward(mob, player, 'rat'); }
      }
    }
    return false; // dog/pig/rat/sheep keep following normally
  }

  // Send a cat off to scout (frae the interact path). Returns true if she went.
  catScout(mob) {
    if (mob.petKind !== 'cat' || mob.scoutT !== undefined) return false;
    mob.scoutT = 22 + Math.random() * 12;
    mob.model.group.visible = false;
    return true;
  }

  // A pig snuffles up a buried find on command, then needs a minute. Returns the outcome.
  pigSnuffle(mob, player) {
    if (mob.petKind !== 'pig') return 'notpig';
    if (mob.snuffleCd > 0) return 'tired';
    mob.snuffleCd = 24;
    this.petReward(mob, player, 'pig');
    return 'snuffled';
  }

  // Drop a companion's find at thi feet, wi' a word about it.
  petReward(mob, player, kind) {
    const R = Math.random();
    let item, n = 1, msg;
    if (kind === 'cat') {
      if (R < 0.05) { item = I.JET_GEM; msg = 'fetched thee a chunk o’ jet'; }
      else if (R < 0.5) { item = I.RAW_GROUSE; msg = 'dropped a grouse at thi feet'; }
      else if (R < 0.78) { item = I.RAW_MUTTON; msg = 'brought back a bit o’ mutton'; }
      else { item = I.BILBERRIES; n = 2; msg = 'turned up a handful o’ bilberries'; }
    } else if (kind === 'pig') {
      if (R < 0.12) { item = I.JET_GEM; msg = 'rooted up a lump o’ jet'; }
      else if (R < 0.32) { item = I.AMMONITE; msg = 'snouted out a snakestone'; }
      else if (R < 0.58) { item = I.RAW_IRON; msg = 'turned up some ironstone'; }
      else { item = I.COAL_LUMP; n = 1 + ((Math.random() * 2) | 0); msg = 'rooted out a bit o’ coal'; }
    } else { // rat
      if (R < 0.07) { item = I.JET_GEM; msg = 'dragged back a scrap o’ jet'; }
      else if (R < 0.52) { item = I.COAL_LUMP; msg = 'found coal i’ t’ dark'; }
      else { item = I.RAW_IRON; msg = 'turned up some ironstone'; }
    }
    this.spawnDrop(player.pos.x + (Math.random() - 0.5), player.pos.y + 0.5, player.pos.z + (Math.random() - 0.5), item, n);
    if (this.game && this.game.ui) this.game.ui.toast(`<b>${mob.petName}</b> ${msg}.`, 4000);
  }

  // ---------- cobles (boats) ----------
  // A moored coble bobs on the swell; the game poses her while she's sailed.
  floatCoble(mob, dt, distP) {
    if (distP > 130) { this.scene.remove(mob.model.group); mob.dead = true; return; }
    mob.bob = (mob.bob || 0) + dt;
    const y = WATER_LEVEL + 0.4 + Math.sin(mob.bob * 1.4 + mob.pos.x) * 0.06;
    mob.pos.y = y;
    const g = mob.model.group;
    g.position.set(mob.pos.x, y, mob.pos.z);
    g.rotation.y = mob.yaw || 0;
    g.rotation.z = Math.sin(mob.bob * 1.1 + mob.pos.z) * 0.03;
  }

  // Keep a coble or two waiting at the coast towns, so there's allus a boat to take.
  ensureHarbourCobles(player) {
    const geo = this.world.gen.geo;
    const harbours = [geo.pierHead()];
    const st = (geo.villages || []).find(v => v.name === 'Staithes');
    if (st) harbours.push({ x: st.x, z: st.z });
    for (const h of harbours) {
      if (!h || Math.hypot(player.pos.x - h.x, player.pos.z - h.z) > 95) continue;
      const near = this.mobs.some(m => m.type === 'coble' && !m.dead && Math.hypot(m.pos.x - h.x, m.pos.z - h.z) < 70);
      if (near) continue;
      const cell = this.findSeaCell(h.x, h.z, 44);
      if (cell) {
        const m = this.spawnMob('coble', cell.x + 0.5, WATER_LEVEL + 0.4, cell.z + 0.5);
        if (m) m.yaw = Math.random() * Math.PI * 2;
      }
    }
  }

  // Find an open-water cell (sea, beck or tarn) near a point.
  findSeaCell(cx, cz, maxR) {
    for (let r = 2; r <= maxR; r += 2) {
      for (let a = 0; a < 16; a++) {
        const ang = a / 16 * Math.PI * 2;
        const x = Math.round(cx + Math.cos(ang) * r), z = Math.round(cz + Math.sin(ang) * r);
        if (this.world.getBlock(x, WATER_LEVEL, z) === B.WATER && this.world.getBlock(x, WATER_LEVEL + 1, z) === B.AIR) {
          return { x, z };
        }
      }
    }
    return null;
  }

  updateMobs(dt, player, isNight, audio) {
    const geo = this.world.gen.geo;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 1.2;
      // how many WILD beasts are about (not pets, other players, villagers or boats)?
      let wild = 0;
      for (const m of this.mobs) { const mt = m.t; if (mt && mt.natural !== false && !m.owner && !m.isRemotePlayer && m.type !== 'villager') wild++; }
      // fill a sparse moor fast, then ease off so she stays lively as tha roams
      const burst = wild < 50 ? 5 : wild < 95 ? 2 : 1;
      for (let i = 0; i < burst; i++) this.trySpawns(player, isNight, audio);
      this.ensureHarbourCobles(player);
    }

    for (const mob of this.mobs) {
      if (mob.dead) continue;
      if (mob.label) { // pony's "right-click to ride" prompt — fades in close, gone once tha's up
        const ldx = player.pos.x - mob.pos.x, ldz = player.pos.z - mob.pos.z;
        mob.label.material.opacity = (!mob.ridden && Math.hypot(ldx, ldz) < 9) ? 0.9 : 0;
      }
      if (mob.ridden) continue; // a ridden pony is posed by the game, not its AI
      // hold physics for owt standing on ungenerated ground
      if (!this.world.isLoaded(mob.pos.x, mob.pos.z)) continue;
      const t = mob.t;
      const dx = player.pos.x - mob.pos.x;
      const dz = player.pos.z - mob.pos.z;
      const distP = Math.hypot(dx, dz);

      if (mob.type === 'coble') { this.floatCoble(mob, dt, distP); continue; } // a moored boat just bobs

      if (mob.type === 'villager') {
        this.updateVillager(mob, dt, player, distP);
        continue;
      }

      // a kept beast: she earns her keep, follows thee, an' never wanders off for good
      if (mob.owner && this.companionBenefit(mob, dt, player, isNight, audio)) continue; // away scouting → skip

      // despawn: too far, hostiles at dawn, day-birds at dusk (bosses/followers/pets linger)
      if (!mob.owner && ((distP > (t.boss || t.follower ? 140 : 104)) || (t.night && !isNight) || (t.day && isNight))) {
        if ((t.night && !isNight) || (t.day && isNight)) this.burst(mob.pos.x, mob.pos.y + 1, mob.pos.z, [30, 30, 40], 8);
        this.scene.remove(mob.model.group);
        mob.dead = true;
        continue;
      }

      mob.stateTimer -= dt;
      mob.attackCd -= dt;
      if (mob.flash > 0) mob.flash -= dt;

      // fliers (owls, crows, gulls) ride t' air on their own rules
      if (t.fly) { this.updateFlyer(mob, dt, player, distP, isNight, audio); continue; }
      // a flushed game bird is up on t' wing — she flies off, she doesn't run
      if (mob.flushing) { this.updateFlush(mob, dt, player, audio); continue; }

      let wishX = 0, wishZ = 0, speed = 0;

      // natural spring lambs trot after their mother ewe, not after thee
      if (mob.naturalLamb) {
        const ewe = (mob.mother && !mob.mother.dead) ? mob.mother : null;
        if (ewe) {
          const lx = ewe.pos.x - mob.pos.x, lz = ewe.pos.z - mob.pos.z, ld = Math.hypot(lx, lz);
          if (ld > 1.6) { wishX = lx / (ld || 1); wishZ = lz / (ld || 1); speed = t.speed; }
          mob.state = 'follow';
        }
      } else if ((mob.owner || t.follower) && distP < (mob.owner ? FOLLOW_RANGE : 26) && !player.dead) {
        // a kept beast (or a found lamb) trots after thee, keeping close
        if (distP > 2.4) {
          const inv = distP || 1;
          wishX = dx / inv; wishZ = dz / inv; speed = mob.owner ? t.speed * 1.3 : t.speed;
        }
        mob.state = 'follow';
      } else if (t.hostile && distP < (t.boss ? 40 : 28) && !player.dead && !player.creative) {
        const geo = this.world.gen.geo;
        const heldItem = player.heldItem && player.heldItem();
        const heldTorch = heldItem && heldItem.id === B.TORCH;
        const heldStake = heldItem && heldItem.id === I.HOLY_STAKE;
        const lightWarded = this.world.nearLight(player.pos.x, player.pos.z, 9) ||
          this.world.nearLight(mob.pos.x, mob.pos.z, 7);
        const torchWarded = heldTorch && mob.type === 'boggart' && distP < 9;
        const shelter = geo.nearestShelter(player.pos.x, player.pos.z);
        const inShelter = shelter && shelter.dist < 9;
        if (mob.type === 'dracula') {
          // Count Dracula: shelters an' villages are sanctuary; holy stake repels him
          if (geo.inVillage(player.pos.x, player.pos.z, -4) || inShelter) {
            if (mob.state === 'chase') { mob.state = 'flee'; mob.fleeTimer = 5; }
          } else if (heldStake && distP < 11) {
            if (mob.state === 'chase') { mob.state = 'flee'; mob.fleeTimer = 2.5; }
          } else {
            mob.state = 'chase';
          }
        } else if (!t.boss && (geo.inVillage(player.pos.x, player.pos.z, -6) || geo.inVillage(mob.pos.x, mob.pos.z, 2))) {
          if (mob.state === 'chase') { mob.state = 'flee'; mob.fleeTimer = 4; }
        } else if (!t.boss && (lightWarded || torchWarded)) {
          if (mob.state === 'chase') { mob.state = 'flee'; mob.fleeTimer = 3; }
        } else if (!t.boss && player.countItem(I.AMULET) > 0) {
          if (mob.state === 'chase') mob.state = 'idle';
        } else {
          mob.state = 'chase';
        }
      }

      // a bull turns on thee if tha crowds it; eases off when tha gives ground
      if (t.aggroRadius && !player.dead && !player.creative) {
        if (distP < t.aggroRadius) mob.state = 'chase';
        else if (mob.state === 'chase' && distP > t.aggroRadius + 9) mob.state = 'idle';
      }
      // shy beasts bolt t' moment tha gets near (hare, lizard, curlew, pheasant, grouse)
      const calmFood = t.tameable && !mob.owner && player.heldItem && player.heldItem() && t.tameFood && t.tameFood.includes(player.heldItem().id);
      if (t.shy && !calmFood && mob.state !== 'chase' && mob.state !== 'flee' && !player.dead && !player.creative && distP < (t.shyRadius || 8)) {
        mob.state = 'flee'; mob.fleeTimer = t.fleeFor || 3;
        if (t.flush) {
          // game birds don't leg it — they FLUSH: clatter up off t' ground an' away
          mob.flushing = true; mob.fleeTimer = 6;
          const inv = distP || 1;
          mob.vel.y = 8;
          mob.vel.x = -dx / inv * (t.fleeSpeed || 4);
          mob.vel.z = -dz / inv * (t.fleeSpeed || 4);
        }
        if (audio) audio.mobAmbient(mob.type, distP);
      }

      // red grouse drum an' display at spring dawn
      if (mob.type === 'grouse' && this.game && this.game.season && this.game.season.greenness > 0.5) {
        const tm = this.game.sky ? this.game.sky.time : 0.5;
        if (tm > 0.18 && tm < 0.33) {
          mob.drumCd = (mob.drumCd || 0) - dt;
          if (mob.drumCd <= 0) {
            mob.drumCd = 4 + Math.random() * 6;
            if (distP < 40 && audio) audio.grouseCall(0.22);
            mob.vel.y = Math.max(mob.vel.y, 2.2); // a little display hop
          }
        }
      }

      if (mob.state === 'follow') {
        if (!mob.naturalLamb && !mob.owner && !(t.follower && distP < 26)) mob.state = 'idle';
        // wish already set above
      } else if (mob.state === 'flee') {
        mob.fleeTimer -= dt;
        if (mob.fleeTimer <= 0) mob.state = 'idle';
        const inv = distP || 1;
        wishX = -dx / inv; wishZ = -dz / inv; speed = t.fleeSpeed;
      } else if (mob.state === 'chase') {
        const inv = distP || 1;
        wishX = dx / inv; wishZ = dz / inv; speed = t.speed;
        if (distP < t.attackRange && mob.attackCd <= 0 && Math.abs(player.pos.y - mob.pos.y) < 2.6) {
          mob.attackCd = 1.1;
          const cause = mob.type === 'dracula' ? 'Count Dracula got thee'
            : t.boss ? 'T\u2019 Great Barghest got thee'
            : mob.type === 'barghest' ? 'A barghest got thee'
            : mob.type === 'boggart' ? 'A boggart did for thee'
            : (t.attackCause || 'summat got thee');
          player.damage(t.dmg, cause);
          if (audio) { audio.hurt(); if (mob.type === 'bull') audio.bullSnort(0.4); else audio.mobAttack('barghest'); }
        }
        if (distP > (t.boss ? 60 : 34) || player.dead || player.creative) mob.state = 'idle';
      } else { // idle / wander
        if (mob.stateTimer <= 0) {
          mob.stateTimer = 2 + Math.random() * 5;
          if (Math.random() < (t.bask ? 0.12 : 0.6)) { // basking lizards mostly sit an' sun
            mob.wanderYaw = Math.random() * Math.PI * 2;
            mob.state = 'wander';
          } else {
            mob.state = 'idle';
          }
          if (audio && Math.random() < 0.25) audio.mobAmbient(mob.type, distP);
        }
        if (mob.state === 'wander') {
          wishX = Math.cos(mob.wanderYaw); wishZ = Math.sin(mob.wanderYaw);
          speed = t.speed * 0.6;
        }
      }

      mob.vel.x += (wishX * speed - mob.vel.x) * Math.min(1, 10 * dt);
      mob.vel.z += (wishZ * speed - mob.vel.z) * Math.min(1, 10 * dt);

      // t' lineside fence: shove any beast that wanders onto t' track back off it
      if (!t.fly && mob.type !== 'coble') {
        const ri = geo.railInfo(mob.pos.x, mob.pos.z);
        if (ri && ri.d < 2.8) {
          let nx = mob.pos.x - ri.px, nz = mob.pos.z - ri.pz;
          const nl = Math.hypot(nx, nz);
          if (nl > 0.05) { nx /= nl; nz /= nl; const push = (2.8 - ri.d) * 9; mob.vel.x += nx * push * dt; mob.vel.z += nz * push * dt; }
        }
      }

      const feet = this.world.getBlock(Math.floor(mob.pos.x), Math.floor(mob.pos.y + 0.2), Math.floor(mob.pos.z));
      const inLiq = feet === B.WATER || feet === B.BOG;
      if (inLiq) {
        mob.vel.y += (2.5 - mob.vel.y) * Math.min(1, 4 * dt); // bob up
      } else {
        mob.vel.y -= GRAVITY * dt;
      }
      moveEntity(this.world, mob, dt);
      // hop up single blocks
      if (mob.hitWall && mob.onGround && (Math.abs(wishX) > 0.1 || Math.abs(wishZ) > 0.1)) {
        mob.vel.y = 7.5;
      }

      // stuck rescue: a beast that's wandered into a player's pit or a bog pool an'
      // can't climb out (no progress while wanting to move, or stood in liquid) gets
      // popped onto t' nearest dry surface — so holes an' bogs don't quietly swallow
      // t' moor's animals.
      if (!t.fly && !mob.owner) {
        const wishing = Math.abs(wishX) > 0.1 || Math.abs(wishZ) > 0.1;
        if (inLiq || (wishing && Math.hypot(mob.vel.x, mob.vel.z) < 0.25)) mob.stuckT = (mob.stuckT || 0) + dt;
        else mob.stuckT = 0;
        if (mob.stuckT > 4) { this.rescueStuck(mob); mob.stuckT = 0; }
      }

      // face movement direction
      const sp = Math.hypot(mob.vel.x, mob.vel.z);
      if (sp > 0.3) mob.yaw = Math.atan2(mob.vel.x, mob.vel.z);

      // animate
      mob.walkPhase += sp * dt * 3.2;
      const swing = Math.sin(mob.walkPhase * Math.PI) * Math.min(1, sp / 3) * 0.6;
      mob.model.legs.forEach((l, i) => { l.rotation.x = (i % 2 === 0 ? swing : -swing); });
      mob.model.group.position.set(mob.pos.x, mob.pos.y, mob.pos.z);
      mob.model.group.rotation.y = mob.yaw;
      // hurt flash
      const f = mob.flash > 0 ? 0.7 : 0;
      mob.model.group.traverse(o => {
        if (o.isMesh && !o.material.emissiveIntensity) o.material.emissive.setRGB(f, 0, 0);
      });
    }
    this.mobs = this.mobs.filter(m => !m.dead);
  }

  // a flushed game bird (grouse, pheasant, curlew) — clatters up steep off t'
  // ground, beats away on t' wing an' is gone ower t' moor. No gravity while up.
  updateFlush(mob, dt, player, audio) {
    const t = mob.t;
    mob.fleeTimer -= dt;
    const groundH = this.world.gen.height(Math.floor(mob.pos.x), Math.floor(mob.pos.z));
    const dx = mob.pos.x - player.pos.x, dz = mob.pos.z - player.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const cruiseY = groundH + 12;
    const sp = (t.fleeSpeed || 4) * 1.5;
    mob.vel.x += ((dx / d) * sp - mob.vel.x) * Math.min(1, 4 * dt);
    mob.vel.z += ((dz / d) * sp - mob.vel.z) * Math.min(1, 4 * dt);
    const wantVy = mob.pos.y < cruiseY ? 7 : 0.5; // climb hard, then level off
    mob.vel.y += (wantVy - mob.vel.y) * Math.min(1, 5 * dt);
    mob.pos.x += mob.vel.x * dt; mob.pos.y += mob.vel.y * dt; mob.pos.z += mob.vel.z * dt;
    const s2 = Math.hypot(mob.vel.x, mob.vel.z);
    if (s2 > 0.3) mob.yaw = Math.atan2(mob.vel.x, mob.vel.z);
    // beat t' wings, tuck t' legs up
    mob.walkPhase += dt * 20;
    const flap = Math.sin(mob.walkPhase) * 0.9;
    if (mob.model.wings) mob.model.wings.forEach((w, i) => { w.rotation.z = (i === 0 ? 1 : -1) * flap; });
    mob.model.legs.forEach(l => { l.rotation.x = -1.1; });
    mob.model.group.position.set(mob.pos.x, mob.pos.y, mob.pos.z);
    mob.model.group.rotation.y = mob.yaw;
    // away an' high — she's flown; let her go
    if (mob.fleeTimer <= 0 && (d > 28 || mob.pos.y > cruiseY + 6)) {
      this.scene.remove(mob.model.group);
      mob.dead = true;
    }
  }

  // owls, crows an' gulls — airborne, no gravity, wi' a flap an' (for owls) a swoop
  updateFlyer(mob, dt, player, distP, isNight, audio) {
    const t = mob.t;
    const groundH = this.world.gen.height(Math.floor(mob.pos.x), Math.floor(mob.pos.z));
    mob.flyTimer = (mob.flyTimer || 0) - dt;
    if (!mob.flyTarget || mob.flyTimer <= 0) {
      mob.flyTimer = 2.5 + Math.random() * 4;
      const ang = Math.random() * Math.PI * 2, rad = 8 + Math.random() * 24;
      let ty;
      if (t.swoop && Math.random() < 0.4) { ty = groundH + 1.5 + Math.random() * 2.5; mob.swooping = true; } // graceful swoop
      else { ty = groundH + (t.flyBand || 14) + Math.random() * 6; mob.swooping = false; }
      mob.flyTarget = { x: mob.pos.x + Math.cos(ang) * rad, y: ty, z: mob.pos.z + Math.sin(ang) * rad };
    }
    const tx = mob.flyTarget.x - mob.pos.x, ty2 = mob.flyTarget.y - mob.pos.y, tz = mob.flyTarget.z - mob.pos.z;
    const d = Math.hypot(tx, ty2, tz) || 1;
    const sp = t.speed * (mob.swooping ? 1.7 : 1), k = Math.min(1, 2.4 * dt);
    mob.vel.x += (tx / d * sp - mob.vel.x) * k;
    mob.vel.y += (ty2 / d * sp - mob.vel.y) * k;
    mob.vel.z += (tz / d * sp - mob.vel.z) * k;
    if (t.flock) this.applyFlock(mob, dt);
    if (mob.pos.y < groundH + 1.6) { mob.vel.y += 14 * dt; mob.swooping = false; } // never plough in
    mob.pos.x += mob.vel.x * dt; mob.pos.y += mob.vel.y * dt; mob.pos.z += mob.vel.z * dt;
    if (d < 3) mob.flyTarget = null;
    const hsp = Math.hypot(mob.vel.x, mob.vel.z);
    if (hsp > 0.2) mob.yaw = Math.atan2(mob.vel.x, mob.vel.z);
    mob.model.group.position.set(mob.pos.x, mob.pos.y, mob.pos.z);
    mob.model.group.rotation.y = mob.yaw;
    mob.walkPhase += dt * (mob.swooping ? 3 : 10);
    const flap = Math.sin(mob.walkPhase * Math.PI * 2) * (mob.swooping ? 0.25 : 0.8);
    if (mob.model.wings) mob.model.wings.forEach((w, i) => { w.rotation.z = (i === 0 ? 1 : -1) * flap; });
    if (audio && Math.random() < 0.004) audio.mobAmbient(mob.type, distP);
    const f = mob.flash > 0 ? 0.7 : 0;
    mob.model.group.traverse(o => { if (o.isMesh && !o.material.emissiveIntensity) o.material.emissive.setRGB(f, 0, 0); });
  }

  // boids-lite: cohesion, alignment an' a bit o' personal space, among t' same kind
  applyFlock(mob, dt) {
    let cx = 0, cz = 0, vx = 0, vz = 0, n = 0, sx = 0, sz = 0;
    for (const o of this.mobs) {
      if (o === mob || o.dead || o.type !== mob.type) continue;
      const dx = o.pos.x - mob.pos.x, dz = o.pos.z - mob.pos.z, dd = dx * dx + dz * dz;
      if (dd > 900) continue;
      n++; cx += o.pos.x; cz += o.pos.z; vx += o.vel.x; vz += o.vel.z;
      if (dd < 16 && dd > 0.0001) { sx -= dx / dd; sz -= dz / dd; }
    }
    if (!n) return;
    cx /= n; cz /= n; vx /= n; vz /= n;
    const w = dt * 2;
    mob.vel.x += ((cx - mob.pos.x) * 0.4 + (vx - mob.vel.x) * 0.5 + sx * 8) * w;
    mob.vel.z += ((cz - mob.pos.z) * 0.4 + (vz - mob.vel.z) * 0.5 + sz * 8) * w;
  }

  // show a spoken line ower their head for a few seconds
  speak(mob, text, secs = 14) {
    if (mob.bubble) mob.model.group.remove(mob.bubble);
    mob.bubble = makeBubble(text);
    mob.bubble.position.y = mob.plate.position.y + 0.85;
    mob.model.group.add(mob.bubble);
    mob.bubbleT = secs;
  }

  updateVillager(mob, dt, player, distP) {
    // remote players: t' network drives their position, we just dress it
    if (mob.isRemotePlayer) {
      const lp = mob.lastPos || mob.pos;
      const sp = Math.hypot(mob.pos.x - lp.x, mob.pos.z - lp.z) / Math.max(dt, 0.001);
      mob.lastPos = { ...mob.pos };
      mob.walkPhase += Math.min(sp, 6) * dt * 3.2;
      const swing = Math.sin(mob.walkPhase * Math.PI) * Math.min(1, sp / 3) * 0.5;
      mob.model.legs.forEach((l, i) => { l.rotation.x = (i % 2 === 0 ? swing : -swing); });
      mob.model.group.position.set(mob.pos.x, mob.pos.y, mob.pos.z);
      mob.model.group.rotation.y = mob.yaw + Math.PI;
      // Merlin's wizardly glow breathes gently
      const _wl = mob.model.group.userData.wizLights;
      if (_wl) {
        mob.glowT = (mob.glowT || 0) + dt;
        const _pulse = 0.8 + 0.32 * Math.sin(mob.glowT * 2.6);
        for (const e of _wl) e.light.intensity = e.base * _pulse;
      }
      mob.plate.material.opacity = distP < 30 ? 1 : 0;
      if (mob.bubble) {
        mob.bubbleT -= dt;
        mob.bubble.material.opacity = Math.max(0, Math.min(1, mob.bubbleT));
        if (mob.bubbleT <= 0) { mob.model.group.remove(mob.bubble); mob.bubble = null; }
      }
      return;
    }
    // folk ridin' t' train: t' game seats them in t' carriage, we just dress 'em
    if (mob.onTrain) {
      mob.model.group.position.set(mob.pos.x, mob.pos.y, mob.pos.z);
      mob.model.group.rotation.y = (mob.yaw || 0) + Math.PI;
      const tgt = (distP < 16 && !mob.chatting) ? 1 : 0;
      mob.plate.material.opacity += (tgt - mob.plate.material.opacity) * Math.min(1, dt * 8);
      if (mob.bubble) {
        mob.bubbleT -= dt;
        mob.bubble.material.opacity = Math.max(0, Math.min(1, mob.bubbleT));
        if (mob.bubbleT <= 0) { mob.model.group.remove(mob.bubble); mob.bubble = null; }
      }
      return;
    }
    // frozen till t' world's built under their feet (far-off villages)
    if (!this.world.isLoaded(Math.floor(mob.pos.x), Math.floor(mob.pos.z))) {
      mob.model.group.position.set(mob.pos.x, mob.pos.y, mob.pos.z);
      return;
    }
    mob.stateTimer -= dt;
    // nameplate fades in as tha gets near
    const target = distP < 9 && !mob.chatting ? Math.min(1, (9 - distP) / 4) : 0;
    mob.plate.material.opacity += (target - mob.plate.material.opacity) * Math.min(1, dt * 8);
    // spoken bubble fades an' goes
    if (mob.bubble) {
      mob.bubbleT -= dt;
      mob.bubble.material.opacity = Math.max(0, Math.min(1, mob.bubbleT));
      if (mob.bubbleT <= 0) {
        mob.model.group.remove(mob.bubble);
        mob.bubble = null;
      }
    }
    if (mob.hailCd > 0) mob.hailCd -= dt;
    if (mob.nosyCd > 0) mob.nosyCd -= dt;
    if (this.nosyToken === mob && !mob.nosyApproach) this.nosyToken = null; // released when done
    let wishX = 0, wishZ = 0, speed = 0;

    // a nosy neighbour breaks off to come have a look an' a word — but only ONE at a
    // time across t' whole parish (a single token), so folk don't crowd thee; the
    // rest get on wi' their lives an' trades.
    if (!this.nosyToken && !mob.nosyApproach && !mob.chatting && !mob.bubble && !player.dead && mob.nosyCd <= 0 && distP < 9 && distP > 2.6) {
      const lb = this.lastBuild;
      const nearBuild = !!(lb && (performance.now() - lb.t < 60000) &&
        Math.hypot(lb.x - mob.pos.x, lb.z - mob.pos.z) < 16 && Math.hypot(lb.x - player.pos.x, lb.z - player.pos.z) < 16);
      if (nearBuild || mob.roam || (mob.sociable || 0.5) > 0.62 || Math.random() < 0.16) {
        mob.nosyCd = 30 + Math.random() * 40;
        mob.nosyApproach = { until: 6, build: nearBuild };
        this.nosyToken = mob;
      }
    }

    // turn to face thee when tha's close (or mid-natter)
    if (mob.nosyApproach) {
      mob.nosyApproach.until -= dt;
      if (distP > 3) {
        wishX = (player.pos.x - mob.pos.x) / (distP || 1); wishZ = (player.pos.z - mob.pos.z) / (distP || 1);
        speed = mob.t.speed * 1.1; mob.state = 'approach';
      } else {
        mob.yaw = Math.atan2(player.pos.x - mob.pos.x, player.pos.z - mob.pos.z);
      }
      if (distP <= 3.2 || mob.nosyApproach.until <= 0) {
        if (!mob.bubble) this.speak(mob, villagerRemark({ role: mob.role, mood: mob.mood, nearBuild: mob.nosyApproach.build, outside: !mob.village }, Math.random), 8);
        mob.nosyApproach = null; mob.state = 'greet'; mob.stateTimer = 1.5;
        if (this.nosyToken === mob) this.nosyToken = null;
      }
    } else if (mob.chatting || (distP < 3.5 && !player.dead)) {
      mob.state = 'greet';
      mob.yaw = Math.atan2(player.pos.x - mob.pos.x, player.pos.z - mob.pos.z);
      if (mob.stateTimer <= 0) mob.stateTimer = 1;
    } else {
      if (mob.state === 'greet') { mob.state = 'idle'; mob.stateTimer = 1 + Math.random() * 2; }
      const skyT = this.game && this.game.sky ? this.game.sky.time : 0.5;
      const homeTime = !!mob.house && (skyT > 0.76 || skyT < 0.16);
      const walkTo = (tgt, sp) => {
        const dx = tgt.x - mob.pos.x, dz = tgt.z - mob.pos.z;
        const d = Math.hypot(dx, dz);
        wishX = dx / Math.max(d, 0.001); wishZ = dz / Math.max(d, 0.001);
        speed = sp;
        const spNow = Math.hypot(mob.vel.x, mob.vel.z);
        mob.homeStuck = spNow < 0.15 ? (mob.homeStuck || 0) + dt : 0;
        return d;
      };
      const popTo = (tgt) => { // gie ower an' pop there — kinder than a neet stuck on a wall
        mob.pos.x = tgt.x; mob.pos.z = tgt.z;
        mob.pos.y = this.world.gen.height(Math.floor(tgt.x), Math.floor(tgt.z)) + 1.1;
        mob.vel.x = mob.vel.z = 0; mob.homeStuck = 0;
      };
      if (homeTime && mob.atHome) {
        // settled in for t' neet — stand quiet by t' lantern, face t' door now an' then
        mob.vel.x *= 0.8; mob.vel.z *= 0.8;
        if (mob.stateTimer <= 0) {
          mob.stateTimer = 4 + Math.random() * 6;
          mob.yaw = Math.atan2(mob.house.out.x - mob.pos.x, mob.house.out.z - mob.pos.z);
        }
      } else if (homeTime) {
        // dusk: mek for thi own door, then ower t' threshold
        if (!mob.passedDoor) {
          if (walkTo(mob.house.out, 1.5) < 1.2) mob.passedDoor = true;
        } else if (walkTo(mob.house.inside, 1.2) < 0.9) {
          mob.atHome = true; mob.homeStuck = 0; wishX = wishZ = speed = 0;
        }
        if (mob.homeStuck > 6) { popTo(mob.house.inside); mob.atHome = true; mob.passedDoor = true; }
      } else if (mob.atHome || mob.leavingHome) {
        // morning: out t' door afore owt else
        mob.atHome = false; mob.leavingHome = true;
        if (walkTo(mob.house.out, 1.2) < 1.2 || mob.homeStuck > 6) {
          if (mob.homeStuck > 6) popTo(mob.house.out);
          mob.leavingHome = false; mob.passedDoor = false; mob.homeStuck = 0;
          wishX = wishZ = speed = 0;
        }
      } else {
        // daytime routine: at their work of a morning an' afternoon, down the green at midday.
        // roamers (shepherds, pedlars, the constable) range out on the roads an' moor.
        const phase = dayPhase(skyT);
        let tgt;
        if (mob.roam) {
          if (mob.stateTimer <= 0 || !mob.roamGoal) {
            mob.stateTimer = 10 + Math.random() * 18;
            const base = (phase === 'social' && mob.green) ? mob.green : (mob.home);
            const a = Math.random() * Math.PI * 2, r = 14 + Math.random() * 34;
            mob.roamGoal = { x: base.x + Math.cos(a) * r, z: base.z + Math.sin(a) * r };
          }
          tgt = mob.roamGoal;
        } else {
          tgt = (phase === 'social' && mob.green) ? mob.green : (mob.work || mob.home);
        }
        const d = walkTo(tgt, mob.t.speed);
        if (d < 3) { wishX = wishZ = 0; speed = 0; mob.vel.x *= 0.8; mob.vel.z *= 0.8; }
        else if (mob.homeStuck > 6) popTo(tgt);
      }
    }

    mob.vel.x += (wishX * speed - mob.vel.x) * Math.min(1, 10 * dt);
    mob.vel.z += (wishZ * speed - mob.vel.z) * Math.min(1, 10 * dt);
    mob.vel.y -= GRAVITY * dt;
    moveEntity(this.world, mob, dt);
    if (mob.hitWall && mob.onGround && speed > 0) mob.vel.y = 7;

    const sp = Math.hypot(mob.vel.x, mob.vel.z);
    if (sp > 0.3 && mob.state !== 'greet') mob.yaw = Math.atan2(mob.vel.x, mob.vel.z);
    mob.walkPhase += sp * dt * 3.2;
    const swing = Math.sin(mob.walkPhase * Math.PI) * Math.min(1, sp / 2) * 0.5;
    mob.model.legs.forEach((l, i) => { l.rotation.x = (i % 2 === 0 ? swing : -swing); });
    mob.model.group.position.set(mob.pos.x, mob.pos.y, mob.pos.z);
    mob.model.group.rotation.y = mob.yaw;
  }

  // closest mob hit by a ray, within maxDist
  raycastMobs(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = null, bestT = maxDist;
    for (const mob of this.mobs) {
      const cx = mob.pos.x - ox, cy = mob.pos.y + mob.h / 2 - oy, cz = mob.pos.z - oz;
      const tProj = cx * dx + cy * dy + cz * dz;
      if (tProj < 0 || tProj > bestT) continue;
      const px = ox + dx * tProj - mob.pos.x;
      const py = oy + dy * tProj - (mob.pos.y + mob.h / 2);
      const pz = oz + dz * tProj - mob.pos.z;
      const r = Math.max(mob.hw, mob.h / 2) + 0.25;
      if (px * px + py * py + pz * pz < r * r) { best = mob; bestT = tProj; }
    }
    return best ? { mob: best, dist: bestT } : null;
  }

  // ---------- drops ----------
  spawnDrop(x, y, z, item, n, opts = {}) {
    const tex = new THREE.TextureLoader().load(getIconURL(item));
    tex.magFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
    const s = opts.big ? 0.9 : 0.45;
    spr.scale.set(s, s, s);
    this.scene.add(spr);
    this.drops.push({
      pos: { x, y, z },
      vel: { x: (Math.random() - 0.5) * 2.5, y: 3.5 + Math.random() * 1.5, z: (Math.random() - 0.5) * 2.5 },
      hw: 0.12, h: 0.24, onGround: false,
      item, n, age: 0, spr,
    });
  }

  updateDrops(dt, player, audio, onPickup) {
    for (const d of this.drops) {
      d.age += dt;
      const dx = player.pos.x - d.pos.x;
      const dy = (player.pos.y + 0.9) - d.pos.y;
      const dz = player.pos.z - d.pos.z;
      const dist = Math.hypot(dx, dy, dz);
      if (!player.dead && dist < 2.2 && d.age > 0.5) {
        // magnet toward player
        d.vel.x += (dx / dist) * 26 * dt;
        d.vel.y += (dy / dist) * 26 * dt;
        d.vel.z += (dz / dist) * 26 * dt;
        if (dist < 0.9) {
          const left = player.addItem(d.item, d.n, d.dur);
          if (left === 0) {
            this.scene.remove(d.spr);
            d.dead = true;
            if (audio) audio.pickup();
            if (onPickup) onPickup(d.item, d.n);
            continue;
          } else {
            d.n = left;
          }
        }
      } else {
        d.vel.y -= GRAVITY * 0.6 * dt;
        d.vel.x *= (1 - Math.min(1, 4 * dt));
        d.vel.z *= (1 - Math.min(1, 4 * dt));
      }
      moveEntity(this.world, d, dt);
      d.spr.position.set(d.pos.x, d.pos.y + 0.25 + Math.sin(d.age * 3) * 0.06, d.pos.z);
      if (d.age > 90) { this.scene.remove(d.spr); d.dead = true; }
    }
    this.drops = this.drops.filter(d => !d.dead);
  }

  // ---------- particles ----------
  burst(x, y, z, rgb, count = 12) {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255) });
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.particleGeom, mat);
      m.position.set(x + (Math.random() - 0.5) * 0.6, y + (Math.random() - 0.5) * 0.6, z + (Math.random() - 0.5) * 0.6);
      this.scene.add(m);
      this.particles.push({
        m, life: 0.5 + Math.random() * 0.4,
        vx: (Math.random() - 0.5) * 4, vy: Math.random() * 4 + 1, vz: (Math.random() - 0.5) * 4,
      });
    }
  }

  blockBurst(x, y, z, blockId) {
    const def = BLOCKS[blockId];
    if (!def || !def.tex) return;
    this.burst(x + 0.5, y + 0.5, z + 0.5, tileColor(def.tex.s ?? def.tex.t), 12);
  }

  updateParticles(dt) {
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) { this.scene.remove(p.m); p.dead = true; continue; }
      p.vy -= GRAVITY * 0.5 * dt;
      p.m.position.x += p.vx * dt;
      p.m.position.y += p.vy * dt;
      p.m.position.z += p.vz * dt;
      const s = Math.min(1, p.life * 3);
      p.m.scale.setScalar(s);
    }
    this.particles = this.particles.filter(p => !p.dead);
  }

  // one soft round puff texture, shared by every wisp o' steam
  steamTex() {
    if (this._steamTex) return this._steamTex;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.5, 'rgba(252,252,255,0.5)');
    g.addColorStop(1, 'rgba(250,250,255,0)');
    x.fillStyle = g; x.beginPath(); x.arc(32, 32, 32, 0, 7); x.fill();
    this._steamTex = new THREE.CanvasTexture(c);
    return this._steamTex;
  }

  // a soft chimney puff: born small at t' funnel, billows out, rises gently an'
  // fades — emitted in a steady stream it leaves a classic trail o' little clouds.
  // (fwdx,fwdz) = t' loco's travel direction, so t' plume drifts back off t' stack.
  steamPuff(x, y, z, fwdx = 0, fwdz = 0) {
    const mat = new THREE.SpriteMaterial({ map: this.steamTex(), transparent: true, depthWrite: false, opacity: 0 });
    const tone = 0.84 + Math.random() * 0.15;            // mostly clean steam, a touch o' coal grey
    mat.color.setRGB(tone, tone, tone * 1.01);
    const spr = new THREE.Sprite(mat);
    const s0 = 0.45 + Math.random() * 0.3;
    spr.scale.setScalar(s0);
    spr.position.set(x + (Math.random() - 0.5) * 0.3, y + 0.2, z + (Math.random() - 0.5) * 0.3);
    this.scene.add(spr);
    const life = 2.0 + Math.random() * 1.3;
    this.steam.push({
      spr, life, maxLife: life, s0, grow: 1.9 + Math.random() * 1.4,
      vx: -fwdx * (0.4 + Math.random() * 0.4) + (Math.random() - 0.5) * 0.5,
      vy: 1.3 + Math.random() * 0.6,                      // buoyant rise, slows as it cools
      vz: -fwdz * (0.4 + Math.random() * 0.4) + (Math.random() - 0.5) * 0.5,
    });
  }

  updateSteam(dt) {
    for (const p of this.steam) {
      p.life -= dt;
      if (p.life <= 0) { this.scene.remove(p.spr); p.spr.material.dispose(); p.dead = true; continue; }
      const age = 1 - p.life / p.maxLife;                 // 0 fresh -> 1 spent
      p.vy *= (1 - dt * 0.6); p.vx *= (1 - dt * 0.5); p.vz *= (1 - dt * 0.5);
      p.spr.position.x += p.vx * dt; p.spr.position.y += p.vy * dt; p.spr.position.z += p.vz * dt;
      p.spr.scale.setScalar(p.s0 + age * p.grow);         // billows out as it drifts
      const fadeIn = Math.min(1, (p.maxLife - p.life) / 0.18);
      p.spr.material.opacity = Math.max(0, fadeIn * (p.life / p.maxLife) * 0.8);
    }
    this.steam = this.steam.filter(p => !p.dead);
  }

  update(dt, player, isNight, audio, onPickup) {
    this.updateMobs(dt, player, isNight, audio);
    this.updateDrops(dt, player, audio, onPickup);
    this.updateParticles(dt);
    this.updateSteam(dt);
    this.updatePrints(dt);
    // t' barghest's dawn-prints: a fading trail left on t' moor at first light
    const sky = this.game && this.game.sky;
    if (sky && sky.time > 0.17 && sky.time < 0.24 && this.printDay !== sky.day) {
      this.printDay = sky.day;
      if (Math.random() < 0.6) this.spawnDawnPrints(player);
    }
  }

  // a trail o' dark paw-prints, as if summat passed in t' night; fades ower a minute
  spawnDawnPrints(player) {
    const geo = this.world.gen.geo;
    if (geo.inVillage(player.pos.x, player.pos.z, 16)) return; // only out on t' open moor
    const start = Math.random() * Math.PI * 2;
    const sx = player.pos.x + Math.cos(start) * (8 + Math.random() * 10);
    const sz = player.pos.z + Math.sin(start) * (8 + Math.random() * 10);
    const dir = Math.random() * Math.PI * 2, nx = Math.cos(dir + Math.PI / 2), nz = Math.sin(dir + Math.PI / 2);
    for (let i = 0; i < 14; i++) {
      const off = (i % 2 ? 0.16 : -0.16);
      const px = sx + Math.cos(dir) * 0.9 * i + nx * off;
      const pz = sz + Math.sin(dir) * 0.9 * i + nz * off;
      let y = null;
      for (let yy = HEIGHT - 2; yy > 1; yy--) { if (this.world.getBlock(Math.floor(px), yy, Math.floor(pz)) !== B.AIR) { y = yy + 1; break; } }
      if (y == null) continue;
      const m = new THREE.Mesh(PRINT_GEOM, new THREE.MeshBasicMaterial({ color: 0x0a0a12, transparent: true, opacity: 0.5, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.rotation.z = -dir;
      m.position.set(px, y + 0.03, pz);
      this.scene.add(m);
      this.prints.push({ mesh: m, life: 80 + Math.random() * 30 });
    }
  }

  updatePrints(dt) {
    for (let i = this.prints.length - 1; i >= 0; i--) {
      const p = this.prints[i];
      p.life -= dt;
      if (p.life <= 0) { this.scene.remove(p.mesh); p.mesh.material.dispose(); this.prints.splice(i, 1); }
      else p.mesh.material.opacity = Math.min(0.5, p.life / 40 * 0.5);
    }
  }

  clear() {
    for (const m of this.mobs) this.scene.remove(m.model.group);
    for (const d of this.drops) this.scene.remove(d.spr);
    for (const p of this.particles) this.scene.remove(p.m);
    for (const p of this.steam) { this.scene.remove(p.spr); p.spr.material.dispose(); }
    for (const p of this.prints) { this.scene.remove(p.mesh); p.mesh.material.dispose(); }
    this.mobs = []; this.drops = []; this.particles = []; this.steam = []; this.prints = [];
  }
}
