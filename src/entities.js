// Mobs (Swaledale sheep, grouse, hares, barghest, boggarts), item drops, particles.
import * as THREE from 'three';
import { B, I, BLOCKS, isSolid } from './defs.js';
import { moveEntity } from './physics.js';
import { getIconURL, tileColor } from './textures.js';
import { hash2i } from './noise.js';
import { HEIGHT, WATER_LEVEL } from './defs.js';

const GRAVITY = 26;

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
  x.strokeText(text, 128, 24);
  x.fillStyle = '#ffe9b0';
  x.fillText(text, 128, 24);
  x.font = '20px "Segoe UI", sans-serif';
  x.strokeStyle = 'rgba(0,0,0,0.8)'; x.lineWidth = 4;
  x.strokeText('right-click to natter', 128, 50);
  x.fillStyle = '#cfc8b8';
  x.fillText('right-click to natter', 128, 50);
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false, opacity: 0,
  }));
  spr.scale.set(1.9, 0.48, 1);
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
// Call after makeVillager to augment Merlin's group with wizard regalia.
// s = look.scale (1.0 for a standard-height adult).
// Everything is parented to the villager's group so it moves/rotates with him
// and is cleaned up automatically when the group is scene.remove()'d.
function makeWizardExtras(group, s) {
  const INDIGO    = 0x2a2060; // robe + hat colour
  const HAT_DARK  = 0x1a1540; // hat slightly darker for depth
  const BEARD     = 0xd0ccc4; // pale grey beard
  const GLOW_COL  = 0xffe080; // warm gold emissive

  // -- robe: a slightly wider indigo box over the default body --
  // body sits at y = 0.85s, height 0.6s → top 1.15s, bottom 0.55s
  const robe = new THREE.Mesh(
    new THREE.BoxGeometry(0.58 * s, 0.68 * s, 0.36 * s),
    new THREE.MeshLambertMaterial({ color: INDIGO, emissive: GLOW_COL, emissiveIntensity: 0.08 })
  );
  robe.position.y = 0.85 * s;
  group.add(robe);

  // -- lower robe skirt: tapers toward the feet --
  const skirt = new THREE.Mesh(
    new THREE.BoxGeometry(0.62 * s, 0.38 * s, 0.38 * s),
    new THREE.MeshLambertMaterial({ color: INDIGO })
  );
  skirt.position.y = 0.38 * s;
  group.add(skirt);

  // -- beard: a small pale cone hanging below the head --
  // head centre is at 1.34s, head bottom ~1.16s
  const beardGeo = new THREE.ConeGeometry(0.1 * s, 0.28 * s, 6);
  const beard = new THREE.Mesh(
    beardGeo,
    new THREE.MeshLambertMaterial({ color: BEARD })
  );
  // cone origin is at its centre; point faces down (rotate 180°)
  beard.rotation.x = Math.PI;
  beard.position.set(0, (1.34 - 0.22) * s, 0.12 * s);
  group.add(beard);

  // -- hat brim: wide flat disc just above the hair --
  // hair top ≈ (1.34 + 0.2) * s = 1.54s
  const brim = new THREE.Mesh(
    new THREE.BoxGeometry(0.62 * s, 0.04 * s, 0.62 * s),
    new THREE.MeshLambertMaterial({ color: HAT_DARK })
  );
  brim.position.y = 1.56 * s;
  group.add(brim);

  // -- pointed hat cone: tip ~0.54s above brim --
  const hatGeo = new THREE.ConeGeometry(0.28 * s, 0.56 * s, 7);
  const hat = new THREE.Mesh(
    hatGeo,
    new THREE.MeshLambertMaterial({ color: INDIGO, emissive: GLOW_COL, emissiveIntensity: 0.12 })
  );
  // cone centred at half its height above brim
  hat.position.y = (1.56 + 0.28) * s;
  group.add(hat);

  // -- soft point light: warm gold glow, small range, parented to group --
  const light = new THREE.PointLight(GLOW_COL, 0.55, 5.5);
  light.position.y = 1.7 * s; // roughly mid-torso height so it lights the ground nearby
  group.add(light);
}

export const MOB_TYPES = {
  sheep: {
    make: makeSheep, hw: 0.45, h: 1.1, hp: 8, speed: 1.6, fleeSpeed: 4.2,
    hostile: false, drops: [[I.RAW_MUTTON, 1, 2], [B.WOOL, 1, 2]], cap: 8, name: 'Swaledale Yow',
  },
  grouse: {
    make: makeGrouse, hw: 0.2, h: 0.6, hp: 3, speed: 1.4, fleeSpeed: 3.8,
    hostile: false, drops: [[I.RAW_GROUSE, 1, 1]], cap: 6, name: 'Red Grouse',
    habitat: 'moor', shy: true, shyRadius: 6, flush: true, fleeFor: 3,
  },
  hare: {
    make: makeHare, hw: 0.2, h: 0.7, hp: 4, speed: 2.6, fleeSpeed: 6.4,
    hostile: false, drops: [], cap: 4, name: 'Brown Hare',
    shy: true, shyRadius: 7, fleeFor: 4, // bolts t' moment tha gets near
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
    hostile: false, drops: [[I.RAW_BEEF, 1, 2]], cap: 8, name: 'Dale Cow',
    habitat: 'pasture', group: [2, 4],
  },
  bull: {
    make: makeBull, hw: 0.6, h: 1.6, hp: 20, speed: 3.8, fleeSpeed: 3.0,
    hostile: false, aggroRadius: 8, dmg: 4, attackRange: 1.9, attackCause: 'A bull had thee on its horns',
    drops: [[I.RAW_BEEF, 1, 3]], cap: 1, name: 'Dale Bull', habitat: 'pasture',
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
    hostile: false, drops: [], cap: 7, name: 'Carrion Crow',
    fly: true, flock: true, flyBand: 16, day: true, group: [3, 6], habitat: 'moor',
  },
  lizard: {
    make: makeLizard, hw: 0.12, h: 0.18, hp: 2, speed: 1.0, fleeSpeed: 5.5,
    hostile: false, drops: [], cap: 5, name: 'Common Lizard',
    bask: true, shy: true, shyRadius: 5, fleeFor: 2.5, day: true, habitat: 'rock',
  },
  curlew: {
    make: makeCurlew, hw: 0.2, h: 0.95, hp: 3, speed: 1.5, fleeSpeed: 4.4,
    hostile: false, drops: [], cap: 4, name: 'Curlew',
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
    this.spawnTimer = 0;
    this.particleGeom = new THREE.BoxGeometry(0.12, 0.12, 0.12);
  }

  // ---------- villagers ----------
  spawnVillager(charId, name, x, y, z, opts = {}) {
    const look = villagerLook(name);
    const model = makeVillager(look);
    // Merlin gets the wizard treatment — keyed on pid (charId) with name fallback
    const isMerlin = charId === 'clint-body' || (name || '').toLowerCase() === 'merlin';
    if (isMerlin) {
      try { makeWizardExtras(model.group, look.scale); } catch (err) { /* fail safe — default avatar still rendered */ }
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
    const type = types[(Math.random() * types.length) | 0];
    const t = MOB_TYPES[type];
    if (t.hostile && day <= 2 && Math.random() < 0.5) return; // first neets: a taster, not a massacre
    const ang = Math.random() * Math.PI * 2;
    const dist = t.hostile ? 26 + Math.random() * 22 : 18 + Math.random() * 30;
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
    return mob;
  }

  // one more o' t' same on t' surface at (x,z) — for herds an' flocks
  spawnNear(type, x, z) {
    if (!this.world.isLoaded(x, z)) return;
    const t = MOB_TYPES[type];
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

  updateMobs(dt, player, isNight, audio) {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 2.5;
      this.trySpawns(player, isNight, audio);
    }

    for (const mob of this.mobs) {
      if (mob.dead) continue;
      // hold physics for owt standing on ungenerated ground
      if (!this.world.isLoaded(mob.pos.x, mob.pos.z)) continue;
      const t = mob.t;
      const dx = player.pos.x - mob.pos.x;
      const dz = player.pos.z - mob.pos.z;
      const distP = Math.hypot(dx, dz);

      if (mob.type === 'villager') {
        this.updateVillager(mob, dt, player, distP);
        continue;
      }

      // despawn: too far, hostiles at dawn, day-birds at dusk (bosses/followers linger)
      if ((distP > (t.boss || t.follower ? 140 : 90)) || (t.night && !isNight) || (t.day && isNight)) {
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

      // lost lambs trot after thee once tha's found 'em
      if (t.follower && distP < 26 && !player.dead) {
        if (distP > 2.4) {
          const inv = distP || 1;
          wishX = dx / inv; wishZ = dz / inv; speed = t.speed;
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
      if (t.shy && mob.state !== 'chase' && mob.state !== 'flee' && !player.dead && !player.creative && distP < (t.shyRadius || 8)) {
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

      if (mob.state === 'follow') {
        if (!(t.follower && distP < 26)) mob.state = 'idle';
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
  speak(mob, text, secs = 8) {
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
      mob.plate.material.opacity = distP < 30 ? 1 : 0;
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
    let wishX = 0, wishZ = 0, speed = 0;

    // turn to face thee when tha's close (or mid-natter)
    if (mob.chatting || (distP < 3.5 && !player.dead)) {
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
        if (mob.stateTimer <= 0) {
          mob.stateTimer = 3 + Math.random() * 6;
          mob.state = Math.random() < 0.55 ? 'wander' : 'idle';
          if (mob.state === 'wander') {
            // potter about near home
            const hx = mob.home.x - mob.pos.x, hz = mob.home.z - mob.pos.z;
            const homeDist = Math.hypot(hx, hz);
            if (homeDist > 9) mob.wanderYaw = Math.atan2(hz, hx);
            else mob.wanderYaw = Math.random() * Math.PI * 2;
          }
        }
        if (mob.state === 'wander') {
          wishX = Math.cos(mob.wanderYaw); wishZ = Math.sin(mob.wanderYaw);
          speed = mob.t.speed;
        }
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

  update(dt, player, isNight, audio, onPickup) {
    this.updateMobs(dt, player, isNight, audio);
    this.updateDrops(dt, player, audio, onPickup);
    this.updateParticles(dt);
  }

  clear() {
    for (const m of this.mobs) this.scene.remove(m.model.group);
    for (const d of this.drops) this.scene.remove(d.spr);
    for (const p of this.particles) this.scene.remove(p.m);
    this.mobs = []; this.drops = []; this.particles = [];
  }
}
