// Mobs (Swaledale sheep, grouse, hares, barghest, boggarts), item drops, particles.
import * as THREE from 'three';
import { B, I, BLOCKS, isSolid } from './defs.js';
import { FARM_THRESHOLD } from './economy.js';
import { moveEntity } from './physics.js';
import { getIconURL, tileColor } from './textures.js';
import { hash2i } from './noise.js';
import { TAME_GOAL, FOLLOW_RANGE, feedTrust, chooseName } from './pets.js';
import { dayPhase, villagerRemark } from './villagerlife.js';
import { HEIGHT, WATER_LEVEL } from './defs.js';
import { flockCentroid, driveTarget, dogGoal, foldAt } from './herding.js';
import { wintry } from './festive.js';

// The only blocks a land beast may stand or spawn on: open, walkable ground.
// NOT trees (LOG/LEAVES), NOT buildings (PLANKS/COBBLE/THATCH...), NOT water/bog.
const WALKABLE_GROUND = new Set([B.GRASS, B.PEAT, B.DIRT, B.STONE, B.SAND]);
function isWalkableGround(b) { return WALKABLE_GROUND.has(b); }

// Built stock barriers a beast must not hop out over (walls + hurdles + gates).
const BARRIER = new Set([B.FENCE, B.GATE, B.COBBLE]);
function isBarrier(b) { return BARRIER.has(b); }
// People (villagers) cross walls/fences/water freely; only true beasts are penned.
function isAnimal(mob) { return mob.type !== 'villager' && mob.type !== 'coble'; }

const HERD_RADIUS = 18; // how near a working dog will gather loose sheep

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

// A colossal moor giant (Wade or Bell) — a dark, simple silhouette built to be
// read against the dusk skyline from far off. Modelled like makeBarghest/makeDracula
// (a THREE group, returning {group, legs} so the stride animation can swing the legs),
// but scaled ≈5× a villager (~7 m tall). No face detail — it's a striding shadow.
// MOB_TYPES.giant.h is ~7.0; these part offsets sum to roughly that height.
function makeGiant() {
  const g = new THREE.Group();
  const DARK = 0x14131a, DARKER = 0x0d0c12;
  // long striding legs (children swing in the stride; the group sits on the ground)
  const legs = [];
  for (const x of [-0.7, 0.7]) {
    const l = box(0.85, 3.4, 0.95, DARKER); l.position.set(x, 1.7, 0); g.add(l); legs.push(l);
  }
  // a heavy torso
  const body = box(2.3, 2.8, 1.5, DARK); body.position.y = 4.7; g.add(body);
  // broad shoulders + long arms hanging at the sides
  const shoulders = box(2.9, 0.7, 1.6, DARK); shoulders.position.y = 5.7; g.add(shoulders);
  for (const x of [-1.5, 1.5]) {
    const a = box(0.7, 2.6, 0.8, DARKER); a.position.set(x, 4.5, 0); g.add(a);
  }
  // a blunt head
  const head = box(1.2, 1.3, 1.2, DARK); head.position.set(0, 6.6, 0.05); g.add(head);
  return { group: g, legs, body, head };
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

// A small night bat — the Count's flutter of summons (Slice 2). A dark body with two
// thin wing planes (children, so updateFlyer's wing-flap swings them). Never wild-spawns;
// spawned + culled only by updateDraculaBoss while the Count is engaged.
function makeBat() {
  const g = new THREE.Group();
  const body = box(0.16, 0.16, 0.26, 0x161018); body.position.y = 0; g.add(body);
  const head = box(0.12, 0.12, 0.1, 0x1c1420); head.position.set(0, 0.04, 0.16); g.add(head);
  for (const x of [-0.06, 0.06]) { const ear = box(0.04, 0.1, 0.03, 0x1c1420); ear.position.set(x, 0.13, 0.14); g.add(ear); }
  for (const x of [-0.1, 0.1]) { const eye = box(0.03, 0.03, 0.02, 0xff2030, 0xff2030); eye.position.set(x, 0.05, 0.2); g.add(eye); }
  const wings = [];
  for (const x of [-1, 1]) { const w = box(0.34, 0.03, 0.22, 0x120c14); w.position.set(x * 0.24, 0, -0.02); g.add(w); wings.push(w); }
  return { group: g, legs: [], body, head, wings };
}

// The Demeter, run aground on the Whitby strand (Slice 3). A broken Russian schooner —
// dark, storm-wet timber: a long hull listing to port, a snapped foremast slumped over the
// bow, a stub of mainmast, a couple of fallen spars and a torn yard. Simple boxes, no AI:
// MOB_TYPES.wreck is special:true, so it is spawned/posed/despawned solely by updateQuestFx
// (main.js), exactly like the giants. The whole group is tilted (listing) by the caller; the
// parts are modelled upright here so that one rotation reads as a ship heeled over on the sand.
function makeWreck() {
  const g = new THREE.Group();
  const HULL = 0x2a2018, HULL_DK = 0x1c1610, DECK = 0x3a2c1e, MAST = 0x241a12, SAIL = 0x6a6256;
  // the hull: a long clinker-planked body, deeper aft, with a raked bow
  const hull = box(2.0, 1.5, 7.0, HULL); hull.position.y = 0.75; g.add(hull);
  const keel = box(1.4, 0.5, 7.2, HULL_DK); keel.position.y = 0.0; g.add(keel);
  const deck = box(1.7, 0.25, 6.4, DECK); deck.position.y = 1.5; g.add(deck);
  const bow = box(1.4, 1.3, 1.6, HULL); bow.position.set(0, 0.95, 4.0); bow.rotation.x = -0.5; g.add(bow);
  const stern = box(1.9, 1.5, 1.0, HULL); stern.position.set(0, 0.95, -3.6); g.add(stern);
  // gunwale rails down each side
  for (const x of [-0.92, 0.92]) { const rail = box(0.16, 0.3, 6.2, HULL_DK); rail.position.set(x, 1.6, 0); g.add(rail); }
  // a ragged hole stove in the port side (a dark gap of broken planking)
  const breach = box(0.3, 0.8, 1.6, 0x070504); breach.position.set(-0.95, 0.7, -0.6); g.add(breach);
  // the foremast, snapped off short and slumped forward over the bow
  const foremast = box(0.34, 3.4, 0.34, MAST); foremast.position.set(0.1, 2.4, 2.4); foremast.rotation.x = 0.7; g.add(foremast);
  const foreStub = box(0.4, 0.9, 0.4, MAST); foreStub.position.set(0.1, 1.9, 1.7); g.add(foreStub);
  // the mainmast, a broken stump amidships
  const mainStump = box(0.42, 1.6, 0.42, MAST); mainStump.position.set(-0.05, 2.3, -0.6); g.add(mainStump);
  // fallen spars / a torn yard across the deck, and a shred of sail
  const yard = box(3.0, 0.22, 0.22, MAST); yard.position.set(0, 1.85, 0.4); yard.rotation.z = 0.18; g.add(yard);
  const spar = box(0.2, 0.2, 2.4, MAST); spar.position.set(0.5, 1.8, -1.4); spar.rotation.y = 0.5; g.add(spar);
  const sail = box(0.08, 1.2, 1.6, SAIL); sail.position.set(0.2, 2.4, 2.5); sail.rotation.x = 0.7; g.add(sail);
  return { group: g };
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
// LEGACY look, kept verbatim for the two callers who must NOT pick up the new
// wardrobe: remote PLAYERS (a player-customisation feature is coming — their
// avatar stays exactly as it is today) and Merlin (his robes are built over the
// plain base look by makeWizardExtras). Everyone else goes through
// outfitSpecFor() below.
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

// ---------- NPC wardrobe: role dress + id-seeded variation ----------
// ~100 souls wi' real names, trades an' LLM personalities all looked like the
// same brown mannequin. Fix: a deterministic appearance system. A role maps to
// an OUTFIT (period 1900, muted natural dyes — no chemical brights on a moor
// wage) an' a stable id-hash seeds the person underneath it: skin, hair, build,
// an' which shade o' the role's palette their coat were dyed. Same NPC, same
// look, every session, every client — nowt is ever Math.random at build time.
//
// Budget: an outfit adds AT MOST 4 extra boxes over the base body (see
// OUTFIT_BOXES), geometries are shared per size an' materials per colour
// (mirrors the burst()-material cache), so 100 dressed folk cost barely more
// than 100 plain ones. Enforced headlessly by scripts/verify-npclooks.mjs.

// stable FNV-1a (same recipe as roster.js idHash — kept local, entities mustn't
// pull in the roster module just for a hash)
function lookHash(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Period-plausible North-York-Moors skin (fair through weathered-outdoor tan)
// and hair (blacks/browns/chestnut/sandy/ginger, plus grey an' white elders).
export const SKIN_TONES = [0xf0d6b8, 0xe4c1a0, 0xd8ab8a, 0xc79b7a, 0xb08363];
export const HAIR_TONES = [0x241c14, 0x3a2c1e, 0x4a3a28, 0x5c452e, 0x6e4f30, 0x8a5a30, 0x7c3f22, 0x8f8f88, 0xe8e8e8];

// How many boxes each outfit part costs (the ≤4 budget is counted in these).
export const OUTFIT_BOXES = {
  cap: 1, hatwide: 2, topper: 2, helmet: 2, bonnet: 1,
  shawl: 1, apron: 1, pinafore: 1, waistcoat: 1, collar: 1,
  skirt: 1, coatskirt: 1, scarf: 1, beltrope: 1,
};

// role -> outfit spec. `jacket`/`legs` are palettes (the id-hash picks a shade —
// that's the within-role hue jitter); extras are the parts that make the
// silhouette read at distance. Every extras list sums to ≤4 boxes.
export const WARDROBE = {
  // the everyday parishioner: waistcoat an' flat cap in seeded homespun shades
  villager:     { jacket: [0x6a5a40, 0x5f6350, 0x6b4f43, 0x565a66], legs: [0x4a4438, 0x413c34],
                  extras: [{ kind: 'waistcoat', color: 0x3a342e }, { kind: 'cap', color: [0x3a342e, 0x32302a] }] },
  // all black, white collar band, wide shovel hat
  parson:       { jacket: [0x1d1d20], legs: [0x1a1a1d],
                  extras: [{ kind: 'collar', color: 0xf0ead8 }, { kind: 'hatwide', color: 0x141416 }] },
  monk:         { jacket: [0x4c3b28, 0x55432d], legs: [0x453724],
                  extras: [{ kind: 'beltrope', color: 0x8a7a58 }] },
  // dark blue serge an' the custodian helmet
  constable:    { jacket: [0x25304c, 0x212b45, 0x293554], legs: [0x1e2740],
                  extras: [{ kind: 'helmet', color: 0x1b2337 }] },
  // shawl ower the shoulders, apron, proper skirt
  fishwife:     { jacket: [0x5a6472, 0x6e5a5a, 0x616a5e], legs: [0x3f3a42, 0x46403a],
                  extras: [{ kind: 'skirt', match: 'legs' }, { kind: 'shawl', color: [0x6e4a3c, 0x5a5244, 0x54604f] }, { kind: 'apron', color: 0xd9d2c0 }] },
  herbwife:     { jacket: [0x5c6248, 0x66584a], legs: [0x453f33, 0x3f3a30],
                  extras: [{ kind: 'skirt', match: 'legs' }, { kind: 'shawl', color: [0x4f5a40, 0x6a5a46] }, { kind: 'apron', color: 0xcfc6ae }] },
  // crisp pinafore ower a dark dress, neat bonnet
  postmistress: { jacket: [0x3c3646, 0x42353a], legs: [0x322e38],
                  extras: [{ kind: 'skirt', match: 'legs' }, { kind: 'pinafore', color: 0xe4ddca }, { kind: 'bonnet', color: 0x2e2a34 }] },
  // pale smock ower earth-tone legs — reads across a field
  shepherd:     { jacket: [0xa89a7c, 0x9c8e72, 0xb0a284], legs: [0x5a4a34, 0x4f4531],
                  extras: [{ kind: 'cap', color: 0x4a3f30 }, { kind: 'scarf', color: 0x7a4a38 }] },
  drover:       { jacket: [0x77644a, 0x6d5c44], legs: [0x4a4034],
                  extras: [{ kind: 'cap', color: 0x3c342a }, { kind: 'scarf', color: 0x5f4632 }] },
  farmer:       { jacket: [0x6a5a40, 0x72604a, 0x5f523c], legs: [0x4a4438],
                  extras: [{ kind: 'waistcoat', color: 0x3e352a }, { kind: 'cap', color: 0x3a342e }] },
  // sooty jacket an' cap, a neckerchief for the flash o' colour
  miner:        { jacket: [0x35302b, 0x2e2b28], legs: [0x2a2724],
                  extras: [{ kind: 'cap', color: 0x232019 }, { kind: 'scarf', color: 0x71382e }] },
  publican:     { jacket: [0x5c3f33, 0x64483a], legs: [0x3c342c],
                  extras: [{ kind: 'waistcoat', color: 0x2f2a24 }, { kind: 'apron', color: 0xded6c2 }] },
  // fine dark topcoat wi' skirts, an' the tall hat
  gentry:       { jacket: [0x2c2c34, 0x33333c, 0x2a2f3a], legs: [0x26262e],
                  extras: [{ kind: 'coatskirt', color: 0x232329 }, { kind: 'topper', color: 0x18181a }] },
  railway:      { jacket: [0x2c3444, 0x2a3040], legs: [0x24293a],
                  extras: [{ kind: 'waistcoat', color: 0x1f2534 }, { kind: 'cap', color: 0x1c2130 }] },
  // the navy gansey
  fisherman:    { jacket: [0x2c3a4e, 0x263243, 0x33424e], legs: [0x2e2a26],
                  extras: [{ kind: 'cap', color: 0x20262e }] },
  // leather apron trades (smith, cooper, wheelwright…)
  craftsman:    { jacket: [0x4f463c, 0x574c40], legs: [0x3a342c],
                  extras: [{ kind: 'apron', color: 0x5a4632 }, { kind: 'cap', color: 0x2e2a26 }] },
  trader:       { jacket: [0x5a4a3a, 0x4e5242, 0x5e4438], legs: [0x3c362e],
                  extras: [{ kind: 'waistcoat', color: 0x33302a }, { kind: 'apron', color: 0xcac2ae }] },
  child:        { jacket: [0x7a6a4a, 0x5a6a7a, 0x8a5a4a, 0x8a7a5a], legs: [0x4a4438, 0x3f3f4a],
                  extras: [], scaleBase: 0.6 },
};

// every role string the game (or the brain's roster sim) actually uses, mapped
// to its outfit. Keys are normalised to letters only — "jet-cutter",
// "station-master" an' "ship's chandler" all land. Unknown roles -> villager.
const ROLE_ALIAS = {
  vicar: 'parson', curate: 'parson', priest: 'parson', clergyman: 'parson', rector: 'parson',
  brother: 'monk', friar: 'monk',
  policeman: 'constable', sergeant: 'constable', bobby: 'constable',
  midwife: 'herbwife', washerwoman: 'herbwife', gossip: 'herbwife', widow: 'herbwife', wisewoman: 'herbwife',
  schoolmistress: 'postmistress', seamstress: 'postmistress',
  gamekeeper: 'shepherd',
  carter: 'drover', carrier: 'drover', ostler: 'drover',
  peatcutter: 'farmer', waller: 'farmer', hedger: 'farmer',
  ironstoneminer: 'miner', collier: 'miner', kilnman: 'miner', calciner: 'miner', quarryman: 'miner',
  jetman: 'miner', jetcutter: 'miner', jetcarver: 'miner', alumworker: 'miner',
  innkeeper: 'publican', alewife: 'publican', landlord: 'publican',
  squire: 'gentry', doctor: 'gentry', magistrate: 'gentry',
  platelayer: 'railway', porter: 'railway', signalman: 'railway', stationmaster: 'railway',
  enginedriver: 'railway', fireman: 'railway', ganger: 'railway', driver: 'railway',
  fisher: 'fisherman', cobleman: 'fisherman', harbourhand: 'fisherman', sailmaker: 'fisherman', netmender: 'fisherman',
  blacksmith: 'craftsman', smith: 'craftsman', cooper: 'craftsman', wheelwright: 'craftsman',
  cobbler: 'craftsman', saddler: 'craftsman', tailor: 'craftsman', joiner: 'craftsman', mason: 'craftsman',
  markettrader: 'trader', market: 'trader', butcher: 'trader', baker: 'trader', draper: 'trader',
  grocer: 'trader', pedlar: 'trader', tinker: 'trader', chandler: 'trader', shipschandler: 'trader',
  lad: 'child', lass: 'child', boy: 'child', girl: 'child',
  rambler: 'villager', labourer: 'villager',
};

export function canonicalRole(role) {
  const r = String(role || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!r) return null;
  if (WARDROBE[r]) return r;
  return ROLE_ALIAS[r] || null;
}

// Many folk arrive wi'out a role field but wear it in their name ("fishwife
// annie", "vicar ambrose", "jet-cutter amos") — read the trade off the name.
function inferRole(key) {
  for (const tok of String(key).split(/[|\s]+/)) {
    const c = canonicalRole(tok);
    if (c) return c;
  }
  return null;
}

// The named cast get priority polish: pinned colours (an' for the family, their
// whole familiar look) that the seeded variation must never shuffle. `m` is a
// word-boundary match against the "charid|name" key; `id` matches the charId
// token exactly (so streamed "tom" is Tom Pennock but "owd tom" isn't).
// `extraColors` re-pins a colour on a role-outfit part wi'out replacing the outfit.
const CURATED_CAST = [
  { m: /\bglinda\b/, role: 'herbwife', scale: 1.0, width: 1, jacket: 0x8a8294, legs: 0x4a4452, hair: 0xe8e8e8,
    extras: [{ kind: 'shawl', color: 0x6a5a6e }, { kind: 'skirt', color: 0x4a4452 }] },       // granny: grey bun an' her shawl
  { m: /\bjames\b/, role: 'farmer', scale: 1.05, width: 1.04, jacket: 0x4a5a3a, legs: 0x3a342a, hair: 0x5a4a36,
    extras: [{ kind: 'cap', color: 0x32402a }, { kind: 'waistcoat', color: 0x2f3626 }] },
  { m: /\bharry\b/, role: 'child', scale: 0.62, width: 1, jacket: 0x3a6a9a, legs: 0x3a342a, hair: 0x6a4a2a,
    extras: [{ kind: 'cap', color: 0x4a3f30 }] },                                             // farm lad's flat cap
  { m: /\bkaren\b/, role: 'child', scale: 0.62, width: 1, jacket: 0xa84a5a, legs: 0x7a3a4a, hair: 0x6a4a2a,
    extras: [{ kind: 'skirt', color: 0x7a3a4a }] },
  { m: /\bcc\b/, role: 'child', scale: 0.45, width: 1, jacket: 0xc88ab0, legs: 0xb07a9e, hair: 0xf2d878,
    curls: true, extras: [] },
  { m: /\bmax\b/, role: 'child', scale: 0.32, width: 1, jacket: 0xd8d0c0, legs: 0xd8d0c0, hair: 0x9a7a4a, extras: [] },
  // the roster's deep six (streamed wi' their roles; we pin the person)
  { id: 'amos', hair: 0x2a221c, jacket: 0x35302b },                          // jet-cutter, coal-dark
  { id: 'mary', hair: 0x5c452e, extraColors: { shawl: 0x6e4a3c } },          // fishwife in the russet shawl
  { id: 'jonty', hair: 0x3a2c1e, jacket: 0x6d5c44 },                         // drover
  { id: 'edith', hair: 0x4a3a28 },                                           // postmistress
  { id: 'tom', hair: 0x8f8f88 },                                             // owd platelayer, grey
  { id: 'bess', hair: 0x8f8f88, extraColors: { shawl: 0x4f5a40 } },          // herbwife in herb-green
];

function curatedFor(key) {
  const idTok = key.split('|')[0];
  for (const c of CURATED_CAST) {
    if (c.id ? c.id === idTok : c.m.test(key)) return c;
  }
  return null;
}

// The one resolver: (role, stable id) -> a fully resolved appearance spec.
// Pure an' deterministic — same inputs, same spec, every session, every client
// (the verify script an' any future wardrobe UI both lean on this). `id` is the
// NPC's stable identity key; spawnVillager passes "charid|name" lowercased.
export function outfitSpecFor(role, id) {
  const key = String(id == null ? '' : id).toLowerCase();
  const h = lookHash(key || 'a-body');
  const cur = curatedFor(key);
  const canon = (cur && cur.role) || canonicalRole(role) || inferRole(key) || 'villager';
  const w = WARDROBE[canon] || WARDROBE.villager;
  const pick = (arr, shift) => (Array.isArray(arr) ? arr[(h >>> shift) % arr.length] : arr);
  const legsC = pick(w.legs, 28);
  const spec = {
    role: canon,
    curated: !!cur,
    scale: (w.scaleBase || 1) * (1 + (((h >>> 6) % 17) - 8) / 100),   // ±8% height
    width: 1 + (((h >>> 11) % 21) - 10) / 100,                        // ±10% build
    skin: SKIN_TONES[(h >>> 16) % SKIN_TONES.length],
    hair: HAIR_TONES[(h >>> 20) % HAIR_TONES.length],
    jacket: pick(w.jacket, 24),
    legs: legsC,
    curls: false,
    extras: (w.extras || []).map(e => ({ kind: e.kind, color: e.match === 'legs' ? legsC : pick(e.color, 14) })),
  };
  if (cur) {
    for (const k of ['scale', 'width', 'jacket', 'legs', 'hair', 'skin', 'curls']) {
      if (cur[k] != null) spec[k] = cur[k];
    }
    if (cur.extras) spec.extras = cur.extras.map(e => ({ ...e }));
    if (cur.extraColors) for (const e of spec.extras) { if (cur.extraColors[e.kind] != null) e.color = cur.extraColors[e.kind]; }
  }
  spec.boxes = spec.extras.reduce((n, e) => n + (OUTFIT_BOXES[e.kind] || 1), 0);
  return spec;
}

// spec -> the `look` shape makeVillager eats (legacy cap/shawl fields stay null —
// the spec's extras carry the dress).
export function lookFromSpec(spec) {
  return {
    scale: spec.scale, width: spec.width,
    jumper: spec.jacket, skirt: spec.legs, hair: spec.hair, skin: spec.skin,
    cap: null, shawl: null, curls: spec.curls, extras: spec.extras,
  };
}

// ---------- PLAYER customisation ("Dress thissen") ----------
// A player picks their OWN look from bounded, period-1900 choices — never freeform
// hex (bounded = kid-safe, validates cleanly, and every client can trust a peer's
// look message). The look is a small plain object of INDICES into the fixed tables
// below: { outfit, jacket, hat, skin, hair }. It rides player.serialize (an
// additive key — old saves default to a rambler) and the relay as an additive
// `look` message (INVARIANTS rule 3: unknown types fall through on old clients).
//
// It resolves through lookToSpec() -> the SAME spec shape outfitSpecFor() returns,
// so a player avatar is built by the SAME makeVillager/lookFromSpec path and shares
// the same per-size/per-colour caches as every NPC. No parallel builder.

// The outfits a player may wear. Deliberately a subset of WARDROBE: the working
// folk and cheerful trades that read as "a rambler on the moor", NOT the authority
// figures included (constable, parson, gentry, monk) — it's a dressing-up game, so
// let a bairn be the bobby if they fancy it. All 1900-plausible.
export const PLAYER_OUTFITS = [
  'villager', 'farmer', 'shepherd', 'miner', 'fishwife',
  'herbwife', 'fisherman', 'railway', 'craftsman', 'trader', 'publican',
  'constable', 'parson', 'gentry', 'monk',
];

// Jacket/coat dye — the muted natural-dye moor palette (no chemical brights), with
// a couple of cheerful-but-period dyes (madder red, woad blue, moss green) so a
// child gets a bit of colour without breaking 1900.
export const PLAYER_JACKETS = [
  0x6a5a40, // homespun brown
  0x565a66, // slate grey
  0x4a5a3a, // moss green
  0x2c3a4e, // navy gansey
  0x6b4f43, // russet
  0x5c3f33, // chestnut
  0x7a3f36, // madder red
  0x3a5566, // woad blue
  0x5a5244, // oat
  0x35302b, // sooty black
];

// Hat/cap choices. Index 0 = bare-headed; the rest reuse the wardrobe's own
// silhouettes (flat cap, wide hat, bonnet, topper) so they build through
// addOutfitPart with no new geometry. Colours are fixed period felt/wool shades.
export const PLAYER_HATS = [
  null,                                   // 0 — bare-headed
  { kind: 'cap', color: 0x3a342e },       // 1 — flat cap, dark
  { kind: 'cap', color: 0x4a3f30 },       // 2 — flat cap, brown
  { kind: 'bonnet', color: 0x2e2a34 },    // 3 — bonnet
  { kind: 'hatwide', color: 0x4a3f30 },   // 4 — wide brim
  { kind: 'topper', color: 0x1a1a1e },    // 5 — tall hat (Sunday best)
];

// Choosable skin/hair — the same period-plausible tone lists the NPC seeder uses,
// so a player look never falls outside what the moor already shows.
export const PLAYER_SKINS = SKIN_TONES;
export const PLAYER_HAIRS = HAIR_TONES;

// A sensible rambler default: old saves and any junk look degrade to this.
export const DEFAULT_PLAYER_LOOK = Object.freeze({ outfit: 0, jacket: 0, hat: 1, skin: 2, hair: 2 });

// Coerce ANY input to a valid, bounded playerLook. Junk (out-of-range index,
// non-integer, wrong type, unknown extra fields) is rejected field-by-field back to
// the default — never trusted. Used on load AND on every inbound relay `look`
// (relay-borne data is untrusted, INVARIANTS rule 3 corollary).
export function validatePlayerLook(look) {
  const idx = (v, len, def) =>
    (Number.isInteger(v) && v >= 0 && v < len) ? v : def;
  const src = (look && typeof look === 'object') ? look : {};
  return {
    outfit: idx(src.outfit, PLAYER_OUTFITS.length, DEFAULT_PLAYER_LOOK.outfit),
    jacket: idx(src.jacket, PLAYER_JACKETS.length, DEFAULT_PLAYER_LOOK.jacket),
    hat:    idx(src.hat,    PLAYER_HATS.length,    DEFAULT_PLAYER_LOOK.hat),
    skin:   idx(src.skin,   PLAYER_SKINS.length,   DEFAULT_PLAYER_LOOK.skin),
    hair:   idx(src.hair,   PLAYER_HAIRS.length,   DEFAULT_PLAYER_LOOK.hair),
  };
}

// playerLook -> the resolved spec shape outfitSpecFor() returns. Pure and
// deterministic: same indices, same spec, every client. The outfit supplies the
// silhouette extras (from the WARDROBE table, minus its own hat — the player picks
// their own headwear); jacket/hat/skin/hair are the player's explicit choices.
export function lookToSpec(playerLook) {
  const L = validatePlayerLook(playerLook);
  const role = PLAYER_OUTFITS[L.outfit];
  const w = WARDROBE[role] || WARDROBE.villager;
  const jacket = PLAYER_JACKETS[L.jacket];
  // Take the outfit's non-hat extras at their FIRST palette shade (deterministic,
  // no id-seed for a player — their look is chosen, not seeded), then bolt on the
  // player's chosen hat. Legs follow the outfit's first legs shade.
  const HAT_KINDS = new Set(['cap', 'hatwide', 'topper', 'helmet', 'bonnet']);
  const first = c => (Array.isArray(c) ? c[0] : c);
  const legsC = first(w.legs);
  const extras = (w.extras || [])
    .filter(e => !HAT_KINDS.has(e.kind))                       // drop the outfit's own headwear
    .map(e => ({ kind: e.kind, color: e.match === 'legs' ? legsC : first(e.color) }));
  const hat = PLAYER_HATS[L.hat];
  if (hat) extras.push({ kind: hat.kind, color: hat.color });
  const spec = {
    role, curated: false,
    scale: (w.scaleBase || 1),
    width: 1,
    skin: PLAYER_SKINS[L.skin],
    hair: PLAYER_HAIRS[L.hair],
    jacket,
    legs: legsC,
    curls: false,
    extras,
  };
  spec.boxes = spec.extras.reduce((n, e) => n + (OUTFIT_BOXES[e.kind] || 1), 0);
  return spec;
}

// Convenience: playerLook -> the `look` object makeVillager eats.
export function playerLookToVillagerLook(playerLook) {
  return lookFromSpec(lookToSpec(playerLook));
}

// Build a standalone avatar mesh for a playerLook, through the SAME makeVillager
// path/caches every NPC uses. Returns the outer THREE.Group (drop it into any
// scene — the wardrobe preview does exactly this). No DOM, but it constructs GL
// geometry, so callers guard it behind a typeof-THREE / try check like elsewhere.
export function buildPlayerLookMesh(playerLook) {
  return makeVillager(playerLookToVillagerLook(playerLook)).group;
}

// shared geometry (per size) + material (per colour) caches — villagers are
// built at UNIT scale inside a scaled group, so every torso/hat/apron of a size
// is the same BoxGeometry however tall its wearer. Nowt may MUTATE these
// materials (makeWizardExtras re-ASSIGNS Merlin's, it doesn't recolour in place;
// the hurt-flash traverse never runs on villagers — updateVillager owns them).
const _npcGeos = new Map();
const _npcMats = new Map();
function npcGeo(w, h, d) {
  const k = w + '|' + h + '|' + d;
  let g = _npcGeos.get(k);
  if (!g) { g = new THREE.BoxGeometry(w, h, d); _npcGeos.set(k, g); }
  return g;
}
function npcMat(color) {
  let m = _npcMats.get(color);
  if (!m) { m = new THREE.MeshLambertMaterial({ color }); _npcMats.set(color, m); }
  return m;
}
function nbox(w, h, d, color) { return new THREE.Mesh(npcGeo(w, h, d), npcMat(color)); }

// one outfit part -> its box(es), built at unit scale into the body group
function addOutfitPart(g, part) {
  const c = part.color;
  switch (part.kind) {
    case 'cap': { const m = nbox(0.46, 0.07, 0.46, c); m.position.set(0, 1.6, 0.05); g.add(m); break; }
    case 'hatwide': { // parson's shovel hat: wide brim, low crown
      const brim = nbox(0.56, 0.05, 0.56, c); brim.position.y = 1.63; g.add(brim);
      const crown = nbox(0.28, 0.16, 0.28, c); crown.position.y = 1.73; g.add(crown); break;
    }
    case 'topper': { // gentry: narrow brim, tall crown
      const brim = nbox(0.48, 0.05, 0.48, c); brim.position.y = 1.63; g.add(brim);
      const crown = nbox(0.3, 0.36, 0.3, c); crown.position.y = 1.83; g.add(crown); break;
    }
    case 'helmet': { // custodian: tall dome an' the wee crest
      const dome = nbox(0.4, 0.26, 0.4, c); dome.position.y = 1.68; g.add(dome);
      const crest = nbox(0.12, 0.1, 0.12, c); crest.position.y = 1.86; g.add(crest); break;
    }
    case 'bonnet': { const m = nbox(0.44, 0.16, 0.44, c); m.position.y = 1.6; g.add(m); break; }
    case 'shawl': { const m = nbox(0.56, 0.2, 0.36, c); m.position.y = 1.08; g.add(m); break; }
    case 'apron': { const m = nbox(0.4, 0.52, 0.05, c); m.position.set(0, 0.7, 0.16); g.add(m); break; }
    case 'pinafore': { const m = nbox(0.46, 0.64, 0.05, c); m.position.set(0, 0.78, 0.16); g.add(m); break; }
    case 'waistcoat': { const m = nbox(0.44, 0.5, 0.05, c); m.position.set(0, 0.88, 0.155); g.add(m); break; }
    case 'collar': { const m = nbox(0.3, 0.09, 0.38, c); m.position.y = 1.17; g.add(m); break; }
    case 'skirt': { const m = nbox(0.52, 0.5, 0.36, c); m.position.y = 0.33; g.add(m); break; }
    case 'coatskirt': { const m = nbox(0.56, 0.34, 0.38, c); m.position.y = 0.5; g.add(m); break; }
    case 'scarf': { const m = nbox(0.4, 0.1, 0.4, c); m.position.y = 1.17; g.add(m); break; }
    case 'beltrope': { const m = nbox(0.54, 0.07, 0.34, c); m.position.y = 0.62; g.add(m); break; }
  }
}

// Floating nameplate so tha can tell who's who from across t' green. `sub` (optional) adds a
// second, smaller line beneath the name — used to show a roster NPC what it's currently up to.
function makeNameplate(text, sub) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = sub ? 96 : 64;
  const x = c.getContext('2d');
  x.textAlign = 'center'; x.textBaseline = 'middle';
  const MAXW = 240;   // keep text within the 256px plate (room for the outline) so nowt clips at the edges
  // Largest font (down to a floor) that fits MAXW; only ellipsise if it STILL won't fit at the floor.
  // The activity line runs long ("walking over to Robin Hood's Bay") — without this it clipped both ends.
  const fit = (str, size, floor, weight) => {
    const f = s => `${weight}${s}px "Segoe UI", sans-serif`;
    let fs = size; x.font = f(fs);
    while (fs > floor && x.measureText(str).width > MAXW) { fs--; x.font = f(fs); }
    let out = str;
    if (x.measureText(out).width > MAXW) { while (out.length > 1 && x.measureText(out + '…').width > MAXW) out = out.slice(0, -1); out += '…'; }
    return { out, font: f(fs) };
  };
  const nameY = sub ? 26 : 32;
  const nm = fit(text, 30, 18, 'bold ');
  x.font = nm.font;
  x.strokeStyle = 'rgba(0,0,0,0.85)'; x.lineWidth = 6;
  x.strokeText(nm.out, 128, nameY);
  x.fillStyle = '#ffe9b0';
  x.fillText(nm.out, 128, nameY);
  if (sub) {
    const sb = fit(sub, 20, 13, '');
    x.font = sb.font;
    x.strokeStyle = 'rgba(0,0,0,0.85)'; x.lineWidth = 5;
    x.strokeText(sb.out, 128, 66);
    x.fillStyle = '#cfe8ff';                       // soft blue, so the activity reads as separate from the name
    x.fillText(sb.out, 128, 66);
  }
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false, opacity: 0,
  }));
  spr.scale.set(1.9, sub ? 0.72 : 0.48, 1);
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

// A small "❓" marker above a persona villager who has summat to say.
// One canvas created once — no per-frame allocation.
let _questMarkerTex = null;
function makeQuestMarker() {
  if (!_questMarkerTex) {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const x = c.getContext('2d');
    x.font = 'bold 42px sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.strokeStyle = 'rgba(0,0,0,0.85)'; x.lineWidth = 6;
    x.strokeText('❓', 32, 32);
    x.fillText('❓', 32, 32);
    _questMarkerTex = new THREE.CanvasTexture(c);
  }
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: _questMarkerTex, transparent: true, depthTest: false, opacity: 0,
  }));
  spr.scale.set(0.55, 0.55, 1);
  spr.renderOrder = 51;
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

// Two-level group: the OUTER group carries position/rotation an' the
// absolute-space attachments callers add at world scale (nameplate, bubbles,
// quest marker, Merlin's robes), while the INNER group holds the unit-scale
// body an' takes the whole height (y) an' build (x/z) scale. Unit-scale parts
// are what lets the geometry cache actually share: every villager torso is the
// SAME BoxGeometry however tall or broad its wearer.
function makeVillager(look) {
  const outer = new THREE.Group();
  const g = new THREE.Group();
  const s = look.scale, w = look.width || 1;
  g.scale.set(s * w, s, s * w);
  outer.add(g);
  const skin = look.skin || 0xd8ab8a;
  const legs = [];
  for (const x of [-0.11, 0.11]) {
    const l = nbox(0.16, 0.55, 0.16, look.skirt);
    l.position.set(x * 1.6, 0.28, 0);
    g.add(l); legs.push(l);
  }
  const body = nbox(0.5, 0.6, 0.3, look.jumper);
  body.position.y = 0.85; g.add(body);
  const arms = [];
  for (const x of [-0.33, 0.33]) {
    const a = nbox(0.14, 0.55, 0.14, look.jumper);
    a.position.set(x, 0.85, 0);
    g.add(a); arms.push(a);
  }
  const head = nbox(0.36, 0.36, 0.36, skin);
  head.position.y = 1.34; g.add(head);
  const hair = nbox(0.38, 0.12, 0.38, look.hair);
  hair.position.y = 1.34 + 0.2; g.add(hair);
  if (look.curls) {
    // a mop o' golden curls: bobbles round t' head
    for (const [cx, cz] of [[-0.2, 0], [0.2, 0], [0, -0.2], [-0.14, -0.16], [0.14, -0.16]]) {
      const curl = nbox(0.14, 0.14, 0.14, look.hair);
      curl.position.set(cx, 1.42, cz);
      g.add(curl);
    }
  }
  if (look.cap) {
    const cap = nbox(0.46, 0.07, 0.46, look.cap);
    cap.position.set(0, 1.34 + 0.26, 0.04); g.add(cap);
  }
  if (look.shawl) {
    const sh = nbox(0.56, 0.2, 0.36, look.shawl);
    sh.position.y = 1.08; g.add(sh);
  }
  // little dark eyes so tha knows they're looking at thee
  for (const x of [-0.08, 0.08]) {
    const eye = nbox(0.05, 0.05, 0.02, 0x222222);
    eye.position.set(x, 1.38, 0.19); g.add(eye);
  }
  // the wardrobe: role dress + seeded trimmings (≤4 boxes, see OUTFIT_BOXES)
  for (const part of (look.extras || [])) addOutfitPart(g, part);
  return { group: outer, legs: legs.concat(arms), body, head };
}

// ---------- Merlin wizard extras ----------
// Re-robes a freshly-built villager.  isFC = true → Victorian Father Christmas
// (deep holly-green robe, white fur trim, green hood with white bobble).
// isFC = false (default) → indigo wizard (gold trim, pointed hat with glowing orb).
// Takes the whole villager model so it can restyle its parts.
// s = look.scale (1.0 for a standard-height adult).
function makeWizardExtras(model, s, isFC = false) {
  const group   = model.group;

  // Palette — wizard vs Father Christmas
  const ROBE    = isFC ? 0x2f6e4f : 0x352a78; // holly green / deep indigo
  const ROBE_DK = isFC ? 0x1e4d37 : 0x231b52; // darker green / darker indigo
  const TRIM    = isFC ? 0xf2f2f2 : 0xc9a23a; // white fur / gold
  const BEARD   = 0xeae6dc;                    // near-white beard (same both ways)
  const GLOW    = isFC ? 0xa8e6c8 : 0xffe080;  // soft mint glow / warm gold glow

  // 1) Re-robe the villager: body, arms and legs so no brown shows. The head
  //    (skin) stays as the face.  model.legs holds legs + arms. Materials are
  //    RE-ASSIGNED (never recoloured in place) — villager materials are shared
  //    per colour now, an' a setHex here would re-robe half the parish wi' him.
  //    Base parts live in the unit-scale inner group, so the y test is unit y.
  try {
    if (model.body) model.body.material = npcMat(ROBE);
    for (const part of (model.legs || [])) {
      part.material = npcMat(part.position.y > 0.6 ? ROBE : ROBE_DK);
    }
  } catch (e) { /* fail-safe — base avatar still renders */ }

  // 2) A fuller robe over the body + a flared skirt, for a proper silhouette.
  //    Wizard: cinched with a gold belt.  Father Christmas: white fur hem band.
  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(0.62 * s, 0.72 * s, 0.44 * s),
    new THREE.MeshLambertMaterial({ color: ROBE, emissive: GLOW, emissiveIntensity: 0.22 }),
  );
  torso.position.y = 0.86 * s; group.add(torso);
  const skirt = new THREE.Mesh(
    new THREE.BoxGeometry(0.82 * s, 0.62 * s, 0.52 * s),
    new THREE.MeshLambertMaterial({ color: ROBE_DK, emissive: GLOW, emissiveIntensity: 0.12 }),
  );
  skirt.position.y = 0.33 * s; group.add(skirt);
  // belt / hem trim (gold for wizard, white fur for FC)
  const belt = new THREE.Mesh(
    new THREE.BoxGeometry(0.66 * s, 0.09 * s, 0.48 * s),
    isFC
      ? new THREE.MeshLambertMaterial({ color: TRIM })
      : new THREE.MeshLambertMaterial({ color: TRIM, emissive: TRIM, emissiveIntensity: 0.3 }),
  );
  belt.position.y = 0.6 * s; group.add(belt);
  if (isFC) {
    // white fur hem at the base of the skirt
    const hem = new THREE.Mesh(
      new THREE.BoxGeometry(0.86 * s, 0.10 * s, 0.56 * s),
      new THREE.MeshLambertMaterial({ color: TRIM }),
    );
    hem.position.y = 0.06 * s; group.add(hem);
    // white fur cuffs on sleeves (arms are the lower items in model.legs — recolour front face via overlay box)
    for (const cx of [-0.38, 0.38]) {
      const cuff = new THREE.Mesh(
        new THREE.BoxGeometry(0.16 * s, 0.10 * s, 0.18 * s),
        new THREE.MeshLambertMaterial({ color: TRIM }),
      );
      cuff.position.set(cx * s, 0.72 * s, 0); group.add(cuff);
    }
    // white fur collar at throat
    const collar = new THREE.Mesh(
      new THREE.BoxGeometry(0.50 * s, 0.10 * s, 0.46 * s),
      new THREE.MeshLambertMaterial({ color: TRIM }),
    );
    collar.position.y = 1.20 * s; group.add(collar);
  }

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

  // 4) Hat.
  if (isFC) {
    // Victorian Father Christmas: a rounded hood/cap in green with a white fur brim
    // band and a white wool bobble on top — no wizard star.
    const hatBrim = new THREE.Mesh(
      new THREE.BoxGeometry(0.62 * s, 0.10 * s, 0.62 * s),
      new THREE.MeshLambertMaterial({ color: TRIM }),
    );
    hatBrim.position.y = 1.56 * s; group.add(hatBrim);
    const hatCap = new THREE.Mesh(
      new THREE.BoxGeometry(0.52 * s, 0.40 * s, 0.52 * s),
      new THREE.MeshLambertMaterial({ color: ROBE, emissive: GLOW, emissiveIntensity: 0.18 }),
    );
    hatCap.position.y = 1.77 * s; group.add(hatCap);
    const hatTop = new THREE.Mesh(
      new THREE.BoxGeometry(0.38 * s, 0.22 * s, 0.38 * s),
      new THREE.MeshLambertMaterial({ color: ROBE }),
    );
    hatTop.position.y = 2.04 * s; group.add(hatTop);
    // white wool bobble
    const bobble = new THREE.Mesh(
      new THREE.SphereGeometry(0.10 * s, 8, 8),
      new THREE.MeshLambertMaterial({ color: TRIM }),
    );
    bobble.position.y = 2.20 * s; group.add(bobble);
  } else {
    // Wizard: wide-brim pointed hat with a gold band and a glowing tip.
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
  }

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
    tameable: true, tameFood: [I.BILBERRIES], droveable: true,
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
    tameable: true, tameFood: [I.BILBERRIES], droveable: true,
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
    tameable: true, tameFood: [I.BILBERRIES], droveable: true,
  },
  pony: {
    make: makePony, hw: 0.42, h: 1.7, hp: 18, speed: 1.7, fleeSpeed: 3.2,
    hostile: false, drops: [], cap: 12, name: 'Moorland Pony',
    habitat: 'moor', group: [2, 3], // half-wild, but they'll let thee up
    tameable: true, tameFood: [I.BILBERRIES], droveable: true, // feed her bilberries to win her over an' keep her
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
    hostile: false, drops: [[I.RAW_PORK, 1, 2]], cap: 3, name: 'Saddleback Pig',
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
  // The Count's bats (Slice 2): a small flutter he summons while engaged at night. A flier
  // (uses updateFlyer), harmless on its own but unnerving; never wild-spawns (natural:false,
  // cap:0). Spawned + capped + culled by updateDraculaBoss; all despawn when the Count dies.
  bat: {
    make: makeBat, hw: 0.18, h: 0.2, hp: 2, speed: 5.0, fleeSpeed: 5.0,
    hostile: false, drops: [], cap: 0, natural: false, night: true, fly: true, flyBand: 6, name: 'Bat', summon: true,
  },
  // a folklore manifestation: a colossal, wordless, unkillable giant (Wade/Bell) that
  // strides the far skyline. Never wild-spawns and skips all mob AI — it is spawned,
  // posed and despawned solely by the quest-gated updateQuestFx() (see main.js), like
  // a coble is driven by floatCoble. `special:true` flags the no-AI skip in updateMobs.
  giant: {
    make: makeGiant, hw: 1.6, h: 7.0, hp: Infinity, speed: 1.0,
    hostile: false, drops: [], cap: 0, natural: false, special: true, name: 'Giant',
  },
  // Slice 3 — the Demeter wreck: a static, no-AI prop aground on the Whitby strand while
  // the player is on the Dracula opening chapters. special:true (skips all mob AI), never
  // wild-spawns; spawned, seated/listed and despawned solely by updateQuestFx (main.js).
  wreck: {
    make: makeWreck, hw: 1.2, h: 2.6, hp: Infinity, speed: 0,
    hostile: false, drops: [], cap: 0, natural: false, special: true, name: 'The Demeter',
  },
  // Slice 3 — the spectral black hound that leapt from the Demeter and bounded up the 199
  // steps. Reuses makeBarghest, near-black and large, but it is a manifestation (special:true,
  // no AI): updateQuestFx poses it bounding from the harbour up the East-Cliff line toward the
  // abbey at night, then fades it. Never wild-spawns; never attacks. Distinct from the AI
  // `barghest` the Count summons.
  houndspectre: {
    make: () => {
      const m = makeBarghest();
      m.group.scale.setScalar(1.5);
      // sink to near-black: drop every part's colour right down (red eyes stay, set emissive)
      m.group.traverse(o => {
        if (o.isMesh && o.material && o.material.color && !(o.material.emissiveIntensity > 0)) {
          o.material.color.multiplyScalar(0.4);
        }
      });
      return m;
    },
    hw: 0.7, h: 2.4, hp: Infinity, speed: 1.0,
    hostile: false, drops: [], cap: 0, natural: false, special: true, name: 'Black Hound',
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
    // Merlin gets the wizard treatment — keyed on pid (charId) with name fallback.
    // In winter (wintry) he becomes Father Christmas: green robe, white fur trim.
    const isMerlin = charId === 'clint-body' || (name || '').toLowerCase() === 'merlin';
    // Remote PLAYERS keep today's plain look untouched (their own wardrobe
    // feature is coming). They're spawned by multiplayer.addRemote with no opts,
    // an' isRemotePlayer is only set AFTER this returns — but their pid always
    // ends "-s<seed>" (see Game.playerId), which no roster/brain/pop id does.
    const isRemote = typeof charId === 'string' && /-s\d+$/.test(charId);
    // Everyone else is dressed: role wardrobe (streamed roster folk an'
    // EXTRA_FOLK carry opts.role; the rest wear their trade in their name) plus
    // id-seeded person underneath. Seeded on the stable "charid|name" key so the
    // same soul looks the same every session an' on every client.
    //
    // A REMOTE PLAYER now honours a chosen `look` (their playerLook, sent over the
    // relay) if one's arrived — built through the SAME shared path as every NPC.
    // Until their look lands they wear the legacy plain rambler (graceful default).
    const look = isMerlin
      ? villagerLook(name)
      : (isRemote && opts.look)
        ? playerLookToVillagerLook(opts.look)
        : isRemote
          ? villagerLook(name)
          : lookFromSpec(outfitSpecFor(opts.role, ((charId || '') + '|' + (name || '')).toLowerCase()));
    const model = makeVillager(look);
    const currentSeason = this.game && this.game.season;
    const isFC = isMerlin && wintry(currentSeason);
    if (isMerlin) {
      try { makeWizardExtras(model, look.scale, isFC); } catch (err) { /* fail safe — default avatar still rendered */ }
    }
    this.scene.add(model.group);
    // roster NPCs can arrive nameless (the brain serves name:null for un-named folk) — fall back so the .replace never throws
    const displayName = isMerlin && isFC ? 'Father Christmas' : (name || 'traveller').replace(/\b\w/g, c => c.toUpperCase());
    const plate = makeNameplate(displayName);
    plate.position.y = Math.max(0.9, 1.65 * look.scale) + 0.55;
    model.group.add(plate);
    // Quest marker: persona villagers (not pop-* crowd) get a ❓ above their head
    const isPersona = charId && !(typeof charId === 'string' && charId.startsWith('pop-'));
    let questMarker = null;
    if (isPersona) {
      questMarker = makeQuestMarker();
      questMarker.position.y = Math.max(0.9, 1.65 * look.scale) + 1.05;
      model.group.add(questMarker);
    }
    const v = {
      type: 'villager',
      t: { hostile: false, speed: 1.1, name },
      model, charId, plate, questMarker,
      displayName,
      isMerlin, merlinFC: isFC, // track so we can swap outfit on season change
      pos: { x, y, z }, vel: { x: 0, y: 0, z: 0 },
      home: { x, z },
      village: opts.village || null,   // which settlement they belong to
      house: opts.house || null,       // {b, out, inside} frae geo.npcHome
      homeStuck: 0,
      hw: 0.28 * look.scale + 0.08, h: Math.max(0.5, 1.65 * look.scale), onGround: false,
      hp: Infinity, yaw: Math.random() * Math.PI * 2,
      state: 'idle', stateTimer: 1 + Math.random() * 4,
      walkPhase: Math.random() * 10, flash: 0, attackCd: 0, fleeTimer: 0,
      chatLog: [],
      // ---- inner life ----
      role: opts.role || null,
      roam: !!opts.roam,
      streamed: !!opts.streamed,   // server-driven (roster sim) — skips local AI; pos owned by RosterClient
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

  // Re-dress a spawned REMOTE PLAYER when their chosen look arrives (or changes)
  // over the relay. Rebuilds the body mesh through the SAME shared path, then moves
  // the existing nameplate/quest marker onto the new group and swaps it into the
  // scene at the current position/heading — so a peer's outfit changes live without
  // a respawn. Materials/geometries are the shared caches, so nowt leaks; the old
  // body's boxes reference shared caches too (never disposed — they're pooled).
  redressRemote(mob, playerLook) {
    if (!mob || !mob.model || !mob.isRemotePlayer) return;
    const look = playerLookToVillagerLook(playerLook);
    const model = makeVillager(look);
    const old = mob.model;
    // carry the floating sprites over (they were added to the old group)
    for (const spr of [mob.plate, mob.questMarker]) {
      if (spr && spr.parent === old.group) { old.group.remove(spr); model.group.add(spr); }
    }
    model.group.position.copy(old.group.position);
    model.group.rotation.copy(old.group.rotation);
    this.scene.remove(old.group);
    this.scene.add(model.group);
    mob.model = model;
    mob.hw = 0.28 * look.scale + 0.08;
    mob.h = Math.max(0.5, 1.65 * look.scale);
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
    // roster-driven mounts (NPCs riding the lanes) don't count toward the wild-pony cap — they
    // come and go with their rider's journey, and shouldn't starve the moor of grazing ponies.
    for (const m of this.mobs) { if (m.rosterMount) continue; counts[m.type] = (counts[m.type] || 0) + 1; }
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
    if (season && season.warmth < 0 && Math.random() < (-season.warmth) * 0.55) return;
    let type;
    if (season) {
      const spring = Math.max(0, Math.min(1, season.greenness));
      // in deep winter, grazers an' game birds are scarce — food's hard to come by
      const winterF = season.warmth < 0 ? Math.max(0.2, 1 + season.warmth) : 1;
      const wts = types.map(k =>
        k === 'sheep' ? 3.5 * winterF                  // t' moor should be thick wi' Swaledales
          : k === 'pony' ? 2.0                         // an' enough ponies that tha can find one
          : k === 'cow' ? 1.6 * winterF
          : k === 'curlew' ? (0.5 + spring * 2.5) * winterF  // curlews come back to nest in spring
          : (k === 'grouse' || k === 'pheasant') ? (0.7 + spring * 1.2) * winterF
          : k === 'crow' ? 1 + (1 - spring) * 0.8      // crows commoner in t' lean months
          : 1);
      let r = Math.random() * wts.reduce((a, b) => a + b, 0);
      type = types[types.length - 1];
      for (let i = 0; i < types.length; i++) { r -= wts[i]; if (r <= 0) { type = types[i]; break; } }
    } else {
      type = types[(Math.random() * types.length) | 0];
    }
    const t = MOB_TYPES[type];
    if (t.hostile && day <= 3 && Math.random() < 0.45) return; // first few neets: a taster, not a massacre
    const ang = Math.random() * Math.PI * 2;
    const dist = t.hostile ? 26 + Math.random() * 22 : 24 + Math.random() * 62; // grazers spread right across t' visible moor
    const x = Math.floor(player.pos.x + Math.cos(ang) * dist);
    const z = Math.floor(player.pos.z + Math.sin(ang) * dist);
    if (!this.world.isLoaded(x, z)) return;
    // nowt nasty walks into Moorstead — t' village is safe ground
    if (t.hostile && geo.inVillage(x, z, 12)) return;
    // wild beasts keep to t' moor an' t' pasture round about — not in t' village streets
    // (thi own tamed farm stock are placed separate, so a village farm still stands)
    if (!t.fly && geo.inVillage(x, z, 6)) return;
    // nor will owt dark rise near a burning light (shelters, torch camps)
    if (t.hostile && this.world.nearLight(x, z, 18)) return;
    // find t' surface block an' its height
    let surfY = -1, surfB = 0;
    for (let y = HEIGHT - 2; y > 1; y--) {
      const b = this.world.getBlock(x, y, z);
      if (b === B.AIR) continue;
      if (isWalkableGround(b)) {
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
      if (isWalkableGround(b)) {
        const above = this.world.getBlock(x, y + 1, z);
        if (above === B.AIR || (BLOCKS[above] && BLOCKS[above].kind === 'cutout')) {
          this.spawnMob(type, x + 0.5, t.fly ? y + (t.flyBand || 14) : y + 1.05, z + 0.5);
        }
      }
      break;
    }
  }

  // pop a stuck beast onto t' nearest walkable ground within a few blocks — out o' a
  // dug pit or off a bog pool, but never onto a tree canopy or a roof.
  rescueStuck(mob) {
    const sx = Math.floor(mob.pos.x), sz = Math.floor(mob.pos.z);
    let best = null, bestD = 1e9;
    for (let dx = -5; dx <= 5; dx++) for (let dz = -5; dz <= 5; dz++) {
      const x = sx + dx, z = sz + dz;
      if (!this.world.isLoaded(x, z)) continue;
      for (let y = HEIGHT - 2; y > 1; y--) {
        const b = this.world.getBlock(x, y, z);
        if (b === B.AIR) continue;
        // only a column whose TOP surface is walkable ground counts — so a beast is never
        // popped onto a tree canopy or a roof, only onto honest ground; nearest wins, not highest.
        if (isWalkableGround(b) && this.world.getBlock(x, y + 1, z) === B.AIR) {
          const d = dx * dx + dz * dz;
          if (d < bestD) { bestD = d; best = { x, z, y }; }
        }
        break;
      }
    }
    if (best) { mob.pos.x = best.x + 0.5; mob.pos.z = best.z + 0.5; mob.pos.y = best.y + 1.05; mob.vel.x = mob.vel.y = mob.vel.z = 0; return true; }
    return false;
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
        if (isWalkableGround(b) && this.world.getBlock(ox, y + 1, oz) === B.AIR) {
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
    let staggerOnly = false;
    if (mob.type === 'dracula') {
      const withStake = held && held.id === I.HOLY_STAKE;
      dmg = withStake ? 24 : Math.max(1, Math.floor(dmg * 0.12));
      // The kill gate (Slice 2): the Count can only be FELLED with the holy stake AND his
      // three boxes of grave-earth sanctified AND the grey of dawn near (sky.time within
      // ~0.04 of the 0.18 night->day edge). Until all three hold, a stake hit STAGGERS him
      // (knockback below) but cannot take his last hp — clamp to >=1. boxesSanctified is a
      // v2-only counter but defaults to 0 and is set in BOTH worlds now (both chain through
      // dracC), so the gate is satisfiable in the stylised fight too.
      const boxes = this.game?.quests?.boxesSanctified || 0;
      const t = this.game?.sky?.time ?? 0.5;
      const nearDawn = t >= 0.14 && t < 0.18;            // the last sliver of night, ~0.04 before dawn
      const canFinish = withStake && boxes >= 3 && nearDawn;
      if (withStake && !canFinish && mob.hp - dmg <= 0) {
        // would be fatal, but the gate isn't met: stagger instead, leave him on 1 hp
        dmg = Math.max(0, mob.hp - 1);
        staggerOnly = true;
        mob.draculaHintCd = (mob.draculaHintCd || 0) - 1;
        if (this.game?.ui && mob.draculaHintCd <= 0) {
          mob.draculaHintCd = 4;
          const hint = boxes < 3
            ? 'Thi stake bites, but he will not fall — <b>his graves still shelter him.</b> Sanctify his boxes o’ earth.'
            : 'Thi stake bites, but he will not fall — <b>he’s strongest in t’ dark.</b> Hold him till t’ grey o’ dawn.';
          this.game.ui.toast(hint, 5000);
        }
      }
    }
    mob.hp -= dmg;
    mob.flash = 0.25;
    // a staked-but-ungated Count is thrown back hard (the warding stagger), but survives
    const kk = staggerOnly ? 10 : 7;
    mob.vel.x += kx * kk; mob.vel.z += kz * kk; mob.vel.y = staggerOnly ? 6 : 5;
    if (staggerOnly) { mob.state = 'flee'; mob.fleeTimer = 1.5; mob.lungeBlock = 1.5; }
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

  // Re-spawn saved beasts on load: followers come to thi heel, penned farm stock
  // come back at their own home spot (so thi farm's still there when tha returns).
  restorePets(list, player) {
    if (!list || !list.length) return;
    for (const p of list) {
      if (!MOB_TYPES[p.kind]) continue;
      if (p.stay && p.home) {
        const m = this.spawnMob(p.kind, p.home.x, p.home.y ?? (player.pos.y), p.home.z);
        if (m) { this.makeCompanion(m, p.name); m.stay = true; m.home = { x: p.home.x, y: p.home.y ?? m.pos.y, z: p.home.z }; }
      } else {
        const m = this.spawnMob(p.kind, player.pos.x + (Math.random() * 2 - 1), player.pos.y + 1, player.pos.z + (Math.random() * 2 - 1));
        if (m) this.makeCompanion(m, p.name);
      }
    }
  }

  // The work a kept beast does each frame. Returns true if she's "away" (skip her update).
  companionBenefit(mob, dt, player, isNight, audio) {
    if (mob.stay) return false; // penned farm stock: no following, no popping to heel — she bides at home
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

  // --- herding: a working dog (an owned dog) + thi own pressure drive a wild flock ---
  // Each frame, tags nearby loose sheep with a herdTarget (steered to in the state machine)
  // and sets the dog's herdGoal (where she flanks/presses). Off with no working dog or on
  // "heel". Tuning lives in HERD_RADIUS + the pressure strengths + the speed multipliers.
  herd(dt, player) {
    const cmd = (this.game && this.game.herdCmd) || 'heel';
    const dog = this.mobs.find(m => m && !m.dead && m.owner && m.type === 'dog');
    if (!dog || cmd === 'heel') {
      if (dog) dog.herdGoal = null;
      for (const m of this.mobs) if (m && m.herding) { m.herding = false; if (m.state === 'herd') m.state = 'idle'; }
      return;
    }
    const flock = this.mobs.filter(m => m && !m.dead && (!m.owner || m.droving) && MOB_TYPES[m.type]?.droveable &&
      Math.hypot(m.pos.x - dog.pos.x, m.pos.z - dog.pos.z) < HERD_RADIUS);
    for (const m of this.mobs) if (m && m.herding && !flock.includes(m)) { m.herding = false; if (m.state === 'herd') m.state = 'idle'; }
    if (!flock.length) { dog.herdGoal = null; return; }
    const centroid = flockCentroid(flock.map(m => ({ x: m.pos.x, z: m.pos.z })));
    if (cmd === 'lie-down') {
      dog.herdGoal = { x: dog.pos.x, z: dog.pos.z };
    } else if (cmd === 'walk-on') {
      // press in toward the flock but hold a stand-off — don't barge through them
      const vx = dog.pos.x - centroid.x, vz = dog.pos.z - centroid.z, vd = Math.hypot(vx, vz) || 1;
      dog.herdGoal = { x: centroid.x + (vx / vd) * 4, z: centroid.z + (vz / vd) * 4 };
    } else {
      dog.herdGoal = dogGoal(cmd, centroid, dog.pos); // come-bye / away flank around the flock
    }
    const pressures = [{ x: dog.pos.x, z: dog.pos.z, strength: 2 }, { x: player.pos.x, z: player.pos.z, strength: 1 }];
    const target = driveTarget(centroid, pressures);
    for (const m of flock) { m.herding = true; m.herdTarget = target; m.state = 'herd'; }
    // funnel: a herded sheep near a gate (still outside the fold) aims THROUGH the gateway into
    // the fold, not just away from the dog — so a bunched flock threads a narrow gate instead of
    // jamming on the fence beside it.
    if (this.foldCells && this.foldCells.size && this.gateCells && this.gateCells.length) {
      for (const m of flock) {
        if (this.foldCells.has(Math.floor(m.pos.x) + ',' + Math.floor(m.pos.z))) continue; // already inside
        let near = null, nd = 7;
        for (const gt of this.gateCells) { const d = Math.hypot(m.pos.x - (gt.x + 0.5), m.pos.z - (gt.z + 0.5)); if (d < nd) { nd = d; near = gt; } }
        if (!near) continue;
        // aim straight at the fold cell just INSIDE the gate — threads the opening single-file
        for (const [nx, nz] of [[near.x + 1, near.z], [near.x - 1, near.z], [near.x, near.z + 1], [near.x, near.z - 1]]) {
          if (this.foldCells.has(nx + ',' + nz)) { m.herdTarget = { x: nx + 0.5, z: nz + 0.5 }; break; }
        }
      }
    }
    // pen any driven sheep that's crossed into the fold — she settles as thi stock for good
    if (this.foldCells && this.foldCells.size) {
      for (const m of flock) {
        if (!this.foldCells.has(Math.floor(m.pos.x) + ',' + Math.floor(m.pos.z))) continue;
        if (m.owner) {
          // a droved-back beast settling home again — re-anchor, don't re-register
          m.stay = true; m.droving = false; m.home = { x: m.pos.x, y: m.pos.y, z: m.pos.z }; m.herding = false;
          const rec = (player.pets || []).find(p => p.name === m.petName);
          if (rec) { rec.stay = true; rec.home = { ...m.home }; }
          continue;
        }
        const name = chooseName(Math.random, (player.pets || []).map(p => p.name));
        this.makeCompanion(m, name);
        m.stay = true; m.home = { x: m.pos.x, y: m.pos.y, z: m.pos.z }; m.herding = false;
        (player.pets || (player.pets = [])).push({ kind: m.type, name, stay: true, home: { ...m.home } });
        if (this.game) {
          const head = (player.pets || []).filter(p => p && MOB_TYPES[p.kind]?.droveable).length;
          const registered = player.farmStatus && player.farmStatus.registered;
          let msg = `<b>${name}</b>’s penned, she’s thi stock now.`;
          if (!registered) {
            msg += head >= FARM_THRESHOLD
              ? ` <b>${head} head!</b> Tha can register thi farm at t’ Moorstead notice board.`
              : ` <b>${head}/${FARM_THRESHOLD} head</b>, pen ${FARM_THRESHOLD - head} more to register a farm.`;
          }
          if (this.game.ui) this.game.ui.toast(msg, 4500);
          if (this.game.milestones) this.game.milestones.fire('flock_penned');
        }
      }
    }
  }

  // En-route risk: a droving sheep strung out far from thee strays off — slow by day, fast at
  // neet, and a barghest in the dark will have her. Bunched + daytime = safe. You're paid for
  // what ARRIVES; never a hard fail. (All four numbers are tuning — confirm live with James.)
  droveRisk(dt, player, night) {
    const STRAY_DIST = 22;        // strung-out threshold (m from the player)
    const GRACE_DAY = 10;         // seconds strung out before a daytime stray is lost
    const GRACE_NIGHT = 4;        // … much less after dark
    const BARGHEST_REACH = 12;    // a night-thing this close to a strayed beast takes her at once
    for (const m of this.mobs) {
      if (!m || m.dead || !m.droving) continue;
      const d = Math.hypot(m.pos.x - player.pos.x, m.pos.z - player.pos.z);
      if (d <= STRAY_DIST) { m.strayT = 0; continue; }
      m.strayT = (m.strayT || 0) + dt;
      let lost = m.strayT > (night ? GRACE_NIGHT : GRACE_DAY);
      let toBarghest = false;
      if (night && !lost) {
        for (const h of this.mobs) {
          if (h.dead || h.type !== 'barghest') continue;
          if (Math.hypot(h.pos.x - m.pos.x, h.pos.z - m.pos.z) < BARGHEST_REACH) { lost = true; toBarghest = true; break; }
        }
      }
      if (lost) {
        if (player.pets) player.pets = player.pets.filter(p => p.name !== m.petName);
        m.dead = true; this.scene.remove(m.model.group);
        if (this.game && this.game.ui) {
          this.game.ui.toast(toBarghest
            ? `🐺 A barghest had <b>${m.petName}</b> out o’ thi flock in t’ dark.`
            : `<b>${m.petName}</b> strayed off on t’ moor — gone frae thi drove.`, 5000);
        }
      }
    }
  }

  // Seed a small flock (3-5 sheep, the odd cow) inside each loaded farm fold that's near the
  // player and under-populated. Runs on the spawn timer (every ~1.2 s). Moors-gated; capped;
  // never re-spawns if the fold already has enough. The barrier rule (Task 3) keeps them penned.
  seedFoldLivestock(player) {
    const geo = this.world.gen.geo;
    const farms = geo.farmSites();
    if (!farms.length) return;
    const LOAD_R = 80; // only seed folds within loaded range
    for (const f of farms) {
      if (Math.hypot(f.x - player.pos.x, f.z - player.pos.z) > LOAD_R) continue;
      if (!this.world.isLoaded(f.x, f.z)) continue;
      const fold = geo._farmBuildings(f).find(b => b.type === 'fold');
      if (!fold) continue;
      // count sheep / cows already inside this fold
      const inFold = this.mobs.filter(m => m && !m.dead && !m.owner &&
        (m.type === 'sheep' || m.type === 'cow') &&
        m.pos.x >= fold.x0 && m.pos.x <= fold.x1 &&
        m.pos.z >= fold.z0 && m.pos.z <= fold.z1);
      if (inFold.length >= 3) continue; // already well-populated
      // seed: 3-5 sheep, 1 cow at every other farm
      const wantSheep = 3 + ((f.seed >>> 0) % 3); // 3-5 deterministic per farm
      const wantCow = ((f.seed >>> 0) % 2 === 0) ? 1 : 0;
      const need = (wantSheep + wantCow) - inFold.length;
      if (need <= 0) continue;
      // spawn inside the fold interior (avoid the perimeter fence itself)
      const ix0 = fold.x0 + 1, ix1 = fold.x1 - 1, iz0 = fold.z0 + 1, iz1 = fold.z1 - 1;
      if (ix0 > ix1 || iz0 > iz1) continue;
      for (let i = 0; i < need; i++) {
        const type = (i === 0 && wantCow) ? 'cow' : 'sheep';
        const wx = ix0 + ((Math.random() * (ix1 - ix0 + 1)) | 0);
        const wz = iz0 + ((Math.random() * (iz1 - iz0 + 1)) | 0);
        if (!this.world.isLoaded(wx, wz)) continue;
        for (let y = HEIGHT - 2; y > 1; y--) {
          const b = this.world.getBlock(wx, y, wz);
          if (b === B.AIR) continue;
          if (isWalkableGround(b) && this.world.getBlock(wx, y + 1, wz) === B.AIR) {
            this.spawnMob(type, wx + 0.5, y + 1.05, wz + 0.5);
          }
          break;
        }
      }
    }
  }

  // Find the player's fenced fold(s): for each gate nearby, flood-fill its open neighbours;
  // an enclosed fill is the fold interior. Cached in this.foldCells (cell keys "x,z"), used
  // by the one-way gate (an animal inside can't leave) and the pen trigger. Throttled.
  foldScan(player) {
    const py = Math.round(player.pos.y);
    const isFence = (x, z) => { for (let y = py - 2; y <= py + 3; y++) { const b = this.world.getBlock(x, y, z); if (b === B.FENCE || b === B.GATE) return true; } return false; };
    const isGate = (x, z) => { for (let y = py - 2; y <= py + 3; y++) if (this.world.getBlock(x, y, z) === B.GATE) return true; return false; };
    const cells = new Set(), gates = [];
    const px = Math.round(player.pos.x), pz = Math.round(player.pos.z), R = 18;
    for (let x = px - R; x <= px + R; x++) for (let z = pz - R; z <= pz + R; z++) {
      if (!isGate(x, z)) continue;
      gates.push({ x, z });
      for (const [nx, nz] of [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]]) {
        if (isFence(nx, nz) || cells.has(nx + ',' + nz)) continue;
        const f = foldAt(nx, nz, isFence, 600);
        if (f.enclosed) for (const c of f.cells) cells.add(c);
      }
    }
    this.foldCells = cells;
    this.gateCells = gates;
  }

  // The multi-phase Count (Slice 2). Reuses the existing chase/stake-damage/dread; this
  // layers on (1) SUMMONS — while he's alive and engaged at night he periodically calls a
  // barghest (the hound) and a flutter of bats, capped (<=1 hound + <=3 bats), all tagged
  // draculaSummon so they're culled the instant he dies; and (2) WARDING — when the player
  // holds a blessed silver token or holy water within close range he's staggered back and
  // can't lunge for a beat (mob.lungeBlock, respected in the chase block). All v2-safe:
  // nothing here touches v2-only state, so the stylised fight gets the same elevation.
  updateDraculaBoss(dt, player, audio) {
    let count = null;
    for (const m of this.mobs) { if (m.type === 'dracula' && !m.dead) { count = m; break; } }
    if (!count) {
      // no Count abroad: cull any orphaned summons (he died, or never rose)
      if (this._hadDracula) {
        for (const m of this.mobs) {
          if (m.draculaSummon && !m.dead) { this.scene.remove(m.model.group); m.dead = true; }
        }
        this._hadDracula = false;
      }
      return;
    }
    this._hadDracula = true;
    const night = this.game?.sky?.isNight?.() ?? true;
    const distP = Math.hypot(count.pos.x - player.pos.x, count.pos.z - player.pos.z);

    // ---- warding: silver token or holy water in hand staggers him back, blocks his lunge ----
    const held = player.heldItem && player.heldItem();
    const wardItem = held && (held.id === I.SILVER_TOKEN || held.id === I.HOLY_WATER);
    count.wardCd = (count.wardCd || 0) - dt;
    if (wardItem && distP < 6 && count.wardCd <= 0) {
      count.wardCd = 1.6;
      count.lungeBlock = 1.6;                 // can't close to attack for ~1.6s
      count.state = 'flee'; count.fleeTimer = Math.max(count.fleeTimer || 0, 1.4);
      const dx = count.pos.x - player.pos.x, dz = count.pos.z - player.pos.z, L = Math.hypot(dx, dz) || 1;
      count.vel.x += dx / L * 9; count.vel.z += dz / L * 9; count.vel.y = 5;
      count.flash = 0.2;
      if (audio) audio.mobHurt('dracula');
      if (this.game?.ui) {
        this.game.ui.toast(held.id === I.SILVER_TOKEN
          ? 'T’ blessed silver flares — t’ Count recoils, hissing, an’ gives ground.'
          : 'Tha flings holy water — it sears him an’ drives him back a step.', 2200);
      }
    }
    if (count.lungeBlock > 0) count.lungeBlock -= dt;

    // ---- summons: a hound + a flutter of bats, while engaged at night, capped ----
    count.summonCd = (count.summonCd || 6) - dt;
    if (night && distP < 44 && count.summonCd <= 0) {
      count.summonCd = 7 + Math.random() * 5;
      let hounds = 0, bats = 0;
      for (const m of this.mobs) {
        if (!m.draculaSummon || m.dead) continue;
        if (m.type === 'barghest') hounds++; else if (m.type === 'bat') bats++;
      }
      const groundAt = (x, z) => this.world.gen.height(Math.floor(x), Math.floor(z));
      if (hounds < 1) {
        const ang = Math.random() * Math.PI * 2, r = 8 + Math.random() * 6;
        const x = count.pos.x + Math.cos(ang) * r, z = count.pos.z + Math.sin(ang) * r;
        if (this.world.isLoaded(x, z)) {
          const h = groundAt(x, z);
          const hound = this.spawnMob('barghest', x + 0.5, h + 1.2, z + 0.5);
          hound.draculaSummon = true;
          this.burst(x + 0.5, h + 1.2, z + 0.5, [20, 0, 30], 10);
          if (audio) audio.howl(0.18);
          if (this.game?.ui) this.game.ui.toast('T’ Count throws back his head — <b>a great hound</b> bounds frae t’ dark to his side!', 4000);
        }
      }
      const wantBats = Math.min(3 - bats, 1 + (Math.random() * 2 | 0));
      for (let i = 0; i < wantBats; i++) {
        const ang = Math.random() * Math.PI * 2, r = 3 + Math.random() * 5;
        const x = count.pos.x + Math.cos(ang) * r, z = count.pos.z + Math.sin(ang) * r;
        if (!this.world.isLoaded(x, z)) continue;
        const h = groundAt(x, z);
        const bat = this.spawnMob('bat', x + 0.5, h + 4 + Math.random() * 3, z + 0.5);
        bat.draculaSummon = true;
      }
    }
  }

  updateMobs(dt, player, isNight, audio) {
    const geo = this.world.gen.geo;
    this.foldScanT = (this.foldScanT || 0) - dt;
    if (this.foldScanT <= 0) { this.foldScanT = 0.5; this.foldScan(player); }
    this.herd(dt, player);
    this.droveRisk(dt, player, isNight);
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
      if (geo.realWorld && geo.farmSites) this.seedFoldLivestock(player);
    }

    // the multi-phase Count: summons (a hound + a flutter of bats) + warding, every frame
    this.updateDraculaBoss(dt, player, audio);

    for (const mob of this.mobs) {
      if (mob.dead) continue;
      // a special manifestation (the giant): no wander, no chase, no distance-despawn —
      // it is spawned, posed and removed solely by the quest-gated updateQuestFx (main.js),
      // exactly as a coble is driven by the game, not its own AI.
      if (mob.t.special) continue;
      // a field gate stands open to an animal frae OUTSIDE the fold (enter), shut frae inside (stay penned)
      mob.passGate = !(this.foldCells && this.foldCells.has(Math.floor(mob.pos.x) + ',' + Math.floor(mob.pos.z)));
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

      // a kept beast told to STAY: she grazes in her pen, tethered to her home spot,
      // never follows nor despawns — that's thi farm.
      if (mob.owner && mob.stay && mob.home) {
        const hx = mob.home.x - mob.pos.x, hz = mob.home.z - mob.pos.z, hd = Math.hypot(hx, hz);
        if (hd > 6) { wishX = hx / hd; wishZ = hz / hd; speed = t.speed * 0.7; mob.state = 'wander'; } // amble back home
        else if (mob.stateTimer <= 0) {
          mob.stateTimer = 3 + Math.random() * 5;
          mob.state = Math.random() < 0.5 ? 'wander' : 'idle';
          if (mob.state === 'wander') mob.wanderYaw = Math.random() * Math.PI * 2;
        }
        if (mob.state === 'wander' && hd <= 6) { wishX = Math.cos(mob.wanderYaw); wishZ = Math.sin(mob.wanderYaw); speed = t.speed * 0.45; }
      } else if (mob.naturalLamb) {
        const ewe = (mob.mother && !mob.mother.dead) ? mob.mother : null;
        if (ewe) {
          const lx = ewe.pos.x - mob.pos.x, lz = ewe.pos.z - mob.pos.z, ld = Math.hypot(lx, lz);
          if (ld > 1.6) { wishX = lx / (ld || 1); wishZ = lz / (ld || 1); speed = t.speed; }
          mob.state = 'follow';
        }
      } else if (mob.herdGoal) {
        // a working dog away on a flank/command — make for the goal, not back to heel
        const gx = mob.herdGoal.x - mob.pos.x, gz = mob.herdGoal.z - mob.pos.z, gd = Math.hypot(gx, gz);
        if (gd > 0.5) { wishX = gx / gd; wishZ = gz / gd; speed = t.speed * 1.5; }
        mob.state = 'follow'; // reuse 'follow' so the state machine keeps this wish
      } else if (((mob.owner && !mob.droving) || t.follower) && distP < (mob.owner ? FOLLOW_RANGE : 26) && !player.dead) {
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
          // Count Dracula: shelters an' villages are sanctuary; holy stake repels him; a
          // fresh ward (silver/holy water, see updateDraculaBoss) holds him off via lungeBlock
          if (geo.inVillage(player.pos.x, player.pos.z, -4) || inShelter) {
            if (mob.state === 'chase') { mob.state = 'flee'; mob.fleeTimer = 5; }
          } else if (mob.lungeBlock > 0) {
            // staggered by a ward — keep him recoiling, no chase, until the block lapses
            mob.state = 'flee'; mob.fleeTimer = Math.max(mob.fleeTimer || 0, mob.lungeBlock);
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
      } else if (mob.state === 'herd' && mob.herdTarget) {
        const tx = mob.herdTarget.x - mob.pos.x, tz = mob.herdTarget.z - mob.pos.z, td = Math.hypot(tx, tz);
        if (td > 0.6) { wishX = tx / td; wishZ = tz / td; speed = t.speed * 0.85; }
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

      // ground-animal separation: stop beasts merging into one blob. A quick scan
      // of nearby ground mobs — skip flyers, cobles, villagers an' remote/streamed folk.
      // O(n²) in the worst case; the dist² early-out keeps it cheap for sparse worlds.
      if (!t.fly && mob.type !== 'coble' && mob.type !== 'villager' && !mob.streamed && !mob.isRemotePlayer && !mob.chatting) {
        const SEP_R2 = 0.64; // 0.8² — separation radius in blocks²
        const SEP_FORCE = 6;  // nudge strength
        let sx = 0, sz = 0;
        for (const o of this.mobs) {
          if (o === mob || o.dead || o.t.fly || o.type === 'coble' || o.type === 'villager' || o.streamed || o.isRemotePlayer) continue;
          const ox = mob.pos.x - o.pos.x, oz = mob.pos.z - o.pos.z;
          const dd = ox * ox + oz * oz;
          if (dd >= SEP_R2) continue; // early out — mobs are far apart, skip inner work
          if (dd > 0.0001) { const d = Math.sqrt(dd); sx += ox / d; sz += oz / d; }
        }
        if (sx !== 0 || sz !== 0) { mob.vel.x += sx * SEP_FORCE * dt; mob.vel.z += sz * SEP_FORCE * dt; }
      }

      // t' lineside fence: shove any beast that wanders onto t' track back off it
      if (!t.fly && mob.type !== 'coble') {
        const ri = geo.railInfo(mob.pos.x, mob.pos.z);
        if (ri && ri.d < 2.8) {
          let nx = mob.pos.x - ri.px, nz = mob.pos.z - ri.pz;
          const nl = Math.hypot(nx, nz);
          if (nl > 0.05) { nx /= nl; nz /= nl; const push = (2.8 - ri.d) * 9; mob.vel.x += nx * push * dt; mob.vel.z += nz * push * dt; }
        }
      }

      // land beasts shy off open water — they'll not walk out onto t' sea (which left
      // 'em paddling on t' surface). Turn back at t' water's edge an' pick a new way.
      if (!t.fly && (Math.abs(wishX) > 0.1 || Math.abs(wishZ) > 0.1)) {
        const ax = Math.floor(mob.pos.x + wishX * 1.1), az = Math.floor(mob.pos.z + wishZ * 1.1);
        // find the surface in the column ahead (the sea sits LOWER than the shore, so a
        // plain same-level check misses the ledge); turn back if she'd step onto water.
        let surfAhead = B.AIR;
        for (let y = Math.floor(mob.pos.y) + 1; y > Math.floor(mob.pos.y) - 14; y--) { const b = this.world.getBlock(ax, y, az); if (b !== B.AIR) { surfAhead = b; break; } }
        if (surfAhead === B.WATER) {
          wishX = -wishX; wishZ = -wishZ;
          mob.wanderYaw = Math.atan2(wishZ, wishX);
          mob.vel.x *= 0.4; mob.vel.z *= 0.4;
        }
      }

      const feet = this.world.getBlock(Math.floor(mob.pos.x), Math.floor(mob.pos.y + 0.2), Math.floor(mob.pos.z));
      const inLiq = feet === B.WATER || feet === B.BOG;
      if (inLiq) {
        mob.vel.y += (2.5 - mob.vel.y) * Math.min(1, 4 * dt); // bob up
      } else {
        mob.vel.y -= GRAVITY * dt;
      }
      const preX = mob.pos.x, preZ = mob.pos.z;
      moveEntity(this.world, mob, dt);
      // hop up single blocks — but a penned beast won't hop a built barrier (wall/hurdle/gate),
      // so walls and folds actually hold stock. Terrain still hops; people cross freely.
      if (mob.hitWall && mob.onGround && (Math.abs(wishX) > 0.1 || Math.abs(wishZ) > 0.1)) {
        const ax = Math.floor(mob.pos.x + wishX * 0.6), az = Math.floor(mob.pos.z + wishZ * 0.6);
        const ahead = this.world.getBlock(ax, Math.floor(mob.pos.y) + 1, az);
        if (!(isAnimal(mob) && isBarrier(ahead))) mob.vel.y = 7.5;
      }
      // open water is a WALL for land beasts. The sea sits LOWER than the shore, so scan
      // the column below her feet for the first solid/liquid.
      if (!t.fly) {
        const fx = Math.floor(mob.pos.x), fz = Math.floor(mob.pos.z), fy0 = Math.floor(mob.pos.y + 0.2);
        const seaUnder = (cx, cz) => { for (let y = fy0; y > fy0 - 16; y--) { const b = this.world.getBlock(cx, y, cz); if (b !== B.AIR) return b === B.WATER; } return false; };
        if (seaUnder(fx, fz)) {
          if ((preX !== mob.pos.x || preZ !== mob.pos.z) && !seaUnder(Math.floor(preX), Math.floor(preZ))) {
            // she stepped FROM dry land out over the sea — shove her straight back
            mob.pos.x = preX; mob.pos.z = preZ; mob.vel.x = 0; mob.vel.z = 0; mob.waterT = 0;
          } else {
            // genuinely adrift (fell in, or no dry land to step back to)
            mob.waterT = (mob.waterT || 0) + dt;
            if (mob.waterT > 1.0) {
              if (mob.owner) { this.rescueStuck(mob); mob.waterT = 0; } // tame stock are pulled out, not drowned
              else { this.scene.remove(mob.model.group); mob.dead = true; continue; } // wild beasts let go so nowt's seen paddling
            }
          }
        } else {
          mob.waterT = 0;
          // stuck in a dug pit (wanting to move but going nowhere): pop her onto dry land
          if ((Math.abs(wishX) > 0.1 || Math.abs(wishZ) > 0.1) && Math.hypot(mob.vel.x, mob.vel.z) < 0.25) {
            mob.stuckT = (mob.stuckT || 0) + dt;
            if (mob.stuckT > 4) { this.rescueStuck(mob); mob.stuckT = 0; }
          } else mob.stuckT = 0;
        }
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
    // Merlin swaps between indigo wizard and Father Christmas when winter starts/ends.
    // We rebuild his model+nameplate in-place — same position, same mob object.
    if (mob.isMerlin) {
      const _nowFC = wintry(this.game && this.game.season);
      if (_nowFC !== mob.merlinFC) {
        mob.merlinFC = _nowFC;
        // Strip the old model from the scene and rebuild it.
        this.scene.remove(mob.model.group);
        const _look = villagerLook(mob.t.name);
        const _newModel = makeVillager(_look);
        try { makeWizardExtras(_newModel, _look.scale, _nowFC); } catch (_e) { /* fail-safe */ }
        mob.model = _newModel;
        mob.model.group.position.set(mob.pos.x, mob.pos.y, mob.pos.z);
        mob.model.group.rotation.y = mob.yaw;
        this.scene.add(mob.model.group);
        // Rebuild the nameplate with the season-appropriate label.
        const _label = _nowFC ? 'Father Christmas' : mob.t.name.replace(/\b\w/g, c => c.toUpperCase());
        mob.displayName = _label;
        const _plate = makeNameplate(_label); // starts at opacity 0, fades in naturally
        _plate.position.y = Math.max(0.9, 1.65 * _look.scale) + 0.55;
        mob.plate = _plate;
        mob.model.group.add(_plate);
      }
    }
    // roster folk: the brain's sim owns their logical state and the RosterClient sets their
    // pos/yaw each frame — we just dress them (no local wander/greet/gravity AI). Moors-only;
    // `streamed` defaults false so ordinary villagers are unaffected.
    if (mob.streamed) {
      const lp = mob.lastPos || mob.pos;
      const sp = Math.hypot(mob.pos.x - lp.x, mob.pos.z - lp.z) / Math.max(dt, 0.001);
      mob.lastPos = { x: mob.pos.x, y: mob.pos.y, z: mob.pos.z };
      mob.walkPhase += Math.min(sp, 6) * dt * 3.2;
      const swing = Math.sin(mob.walkPhase * Math.PI) * Math.min(1, sp / 3) * 0.5;
      mob.model.legs.forEach((l, i) => { l.rotation.x = (i % 2 === 0 ? swing : -swing); });
      mob.model.group.position.set(mob.pos.x, mob.pos.y, mob.pos.z);
      mob.model.group.rotation.y = mob.yaw;
      // Activity marker: rebuild the plate as "Name / <activity>" when the activity changes — only
      // on state changes (a handful of times per trip), never per-frame. The proximity fade below
      // keeps it from cluttering the whole moor; you read it by getting near a body.
      if (mob.activityShort !== mob._plateAct) {
        mob._plateAct = mob.activityShort;
        const opacity = mob.plate ? mob.plate.material.opacity : 0;
        const py = mob.plate ? mob.plate.position.y : (Math.max(0.9, 1.65) + 0.55);
        if (mob.plate) {
          mob.model.group.remove(mob.plate);
          if (mob.plate.material.map) mob.plate.material.map.dispose();
          mob.plate.material.dispose();
        }
        const np = makeNameplate(mob.displayName, mob.activityShort || null);
        np.position.y = py;
        np.material.opacity = opacity;          // keep the current fade so it doesn't flash on change
        mob.model.group.add(np);
        mob.plate = np;
      }
      const tgt = (distP < 30 && !mob.chatting) ? 1 : 0;
      mob.plate.material.opacity += (tgt - mob.plate.material.opacity) * Math.min(1, dt * 8);
      if (mob.bubble) {
        mob.bubbleT -= dt;
        mob.bubble.material.opacity = Math.max(0, Math.min(1, mob.bubbleT));
        if (mob.bubbleT <= 0) { mob.model.group.remove(mob.bubble); mob.bubble = null; }
      }
      return;
    }
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
    // snap to the real voxel surface (not DEM-only) so a villager whose chunk
    // just loaded sits on the ground/platform, not floating or buried
    {
      const rx = Math.round(mob.pos.x), rz = Math.round(mob.pos.z);
      const dem = this.world.gen.height(rx, rz);
      let surf = null;
      for (let y = dem + 24; y >= dem - 16 && y > 1; y--) {
        const b = this.world.getBlock(rx, y, rz);
        if (b === B.AIR || b === B.WATER) continue;
        const below = this.world.getBlock(rx, y - 1, rz);
        if (below !== B.AIR && below !== B.WATER) { surf = y; break; }
      }
      const wantY = (surf != null ? surf : dem) + 1;
      if (Math.abs(mob.pos.y - wantY) > 0.05) { mob.pos.y = wantY; mob.vel.y = 0; }
    }
    // NIGHT POLICY: houseless folk sleep out of sight at neet — they vanish at dusk an'
    // are back at dawn (no houses needed). Folk WI' a house get an evening first: frae
    // dusk they mek for their own doorstep an' stand about it by lamplight, an' only
    // wink out i' t' dead o' neet. Nobody treks indoors — no door/inside pathing, that
    // way lies folk wedged on walls. People only — animals, remote players an'
    // train-riders already returned above.
    const skyT = this.game && this.game.sky ? this.game.sky.time : 0.5;
    const DUSK = 0.76, BEDTIME = 0.88, DAWN = 0.16; // DUSK/DAWN match t' old vanish window; BEDTIME is deeper
    // evening: a housed body's on their doorstep; latening: any body's talk turns to dusk
    const evening = !!mob.house && skyT > DUSK && skyT <= BEDTIME;
    const latening = skyT > 0.7 && skyT <= BEDTIME;
    const abed = mob.house ? (skyT > BEDTIME || skyT < DAWN) : (skyT > DUSK || skyT < DAWN);
    if (abed && !mob.chatting) {
      if (mob.model.group.visible) mob.model.group.visible = false;
      mob.vel.x = mob.vel.y = mob.vel.z = 0;
      if (mob.bubble) { mob.model.group.remove(mob.bubble); mob.bubble = null; }
      if (mob.nosyApproach) { mob.nosyApproach = null; if (this.nosyToken === mob) this.nosyToken = null; }
      return;
    }
    if (!mob.model.group.visible) mob.model.group.visible = true; // dawn — back about their day
    mob.stateTimer -= dt;
    // nameplate fades in as tha gets near
    const target = distP < 9 && !mob.chatting ? Math.min(1, (9 - distP) / 4) : 0;
    mob.plate.material.opacity += (target - mob.plate.material.opacity) * Math.min(1, dt * 8);
    // quest marker: show for persona villagers (not chatting) between ~3m and 18m; gentle pulse
    if (mob.questMarker) {
      const qTarget = (!mob.chatting && distP > 2.5 && distP < 18)
        ? 0.62 + 0.38 * Math.sin(performance.now() * 0.003) : 0;
      mob.questMarker.material.opacity += (qTarget - mob.questMarker.material.opacity) * Math.min(1, dt * 6);
    }
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
        if (!mob.bubble) this.speak(mob, villagerRemark({ role: mob.role, mood: mob.mood, nearBuild: mob.nosyApproach.build, outside: !mob.village, evening: latening }, Math.random), 8);
        mob.nosyApproach = null; mob.state = 'greet'; mob.stateTimer = 1.5;
        if (this.nosyToken === mob) this.nosyToken = null;
      }
    } else if (mob.chatting || (distP < 3.5 && !player.dead)) {
      mob.state = 'greet';
      mob.yaw = Math.atan2(player.pos.x - mob.pos.x, player.pos.z - mob.pos.z);
      if (mob.stateTimer <= 0) mob.stateTimer = 1;
    } else {
      if (mob.state === 'greet') { mob.state = 'idle'; mob.stateTimer = 1 + Math.random() * 2; }
      const walkTo = (tgt, sp) => {
        const dx = tgt.x - mob.pos.x, dz = tgt.z - mob.pos.z;
        const d = Math.hypot(dx, dz);
        wishX = dx / Math.max(d, 0.001); wishZ = dz / Math.max(d, 0.001);
        speed = sp;
        // stuck = no PROGRESS toward the goal, not just standing still — a body
        // grinding along a wall at an angle moves plenty fast an' gets nowhere,
        // an' t' old speed test let 'em scrape there all neet
        const g = mob.stuckG;
        if (!g || g.x !== tgt.x || g.z !== tgt.z) {
          // fresh goal: new yardstick, but t' clock keeps runnin' — a re-rolled
          // potter goal round t' same anchor mustn't hand a wedged body a clean slate
          mob.stuckG = { x: tgt.x, z: tgt.z, d };
          mob.homeStuck = (mob.homeStuck || 0) + dt;
        } else if (d < g.d - 0.4) {
          g.d = d;
          mob.homeStuck = 0;
        } else {
          mob.homeStuck = (mob.homeStuck || 0) + dt;
        }
        return d;
      };
      const popTo = (tgt) => { // gie ower an' pop there — kinder than a neet stuck on a wall
        // never mid-natter: teleporting away from the player tha's talking to is jarring —
        // give 'em another spell o' walking an' pop later if still stuck
        if (mob.chatting) { mob.homeStuck = 0; return; }
        mob.pos.x = tgt.x; mob.pos.z = tgt.z;
        const rx = Math.round(tgt.x), rz = Math.round(tgt.z);
        const dem = this.world.gen.height(rx, rz);
        let surf = null;
        for (let y = dem + 24; y >= dem - 16 && y > 1; y--) {
          const b = this.world.getBlock(rx, y, rz);
          if (b === B.AIR || b === B.WATER) continue;
          const below = this.world.getBlock(rx, y - 1, rz);
          if (below !== B.AIR && below !== B.WATER) { surf = y; break; }
        }
        mob.pos.y = (surf != null ? surf : dem) + 1;
        mob.vel.x = mob.vel.z = 0; mob.homeStuck = 0;
      };
      // daytime routine: at their work of a morning an' afternoon, gathered round the
        // green at midday — but each to their OWN spot, an' pottering about it, so folk
        // mill an' shift rather than stack on one tile an' stand like posts.
        // roamers (shepherds, pedlars, the constable) range out on the roads an' moor.
        const phase = dayPhase(skyT);
        if (mob.roam && !evening) {
          if (mob.stateTimer <= 0 || !mob.roamGoal) {
            mob.stateTimer = 10 + Math.random() * 18;
            const base = (phase === 'social' && mob.green) ? mob.green : (mob.home);
            const a = Math.random() * Math.PI * 2, r = 14 + Math.random() * 34;
            mob.roamGoal = { x: base.x + Math.cos(a) * r, z: base.z + Math.sin(a) * r };
          }
          const d = walkTo(mob.roamGoal, mob.t.speed);
          if (d < 3) { wishX = wishZ = 0; speed = 0; mob.vel.x *= 0.8; mob.vel.z *= 0.8; mob.homeStuck = 0; }
          else if (mob.homeStuck > 6) popTo(mob.roamGoal);
        } else {
          // of an evening a housed body's anchor is their OWN doorstep (house.out) —
          // walked to wi' t' same potter machinery, then pottered round tight
          const anchor = evening ? mob.house.out
            : (phase === 'social' && mob.green) ? mob.green : (mob.work || mob.home);
          // dusk fell (or dawn broke): drop t' stale goal so they set off now, not in 7s
          if (evening !== mob.eveHome) { mob.eveHome = evening; mob.potterGoal = null; }
          // amble to a fresh spot a few steps off the patch every so often, an' glance about
          if (mob.stateTimer <= 0 || !mob.potterGoal) {
            mob.stateTimer = 4 + Math.random() * 7;
            const a = Math.random() * Math.PI * 2,
              r = evening ? Math.random() * 1.5 : (phase === 'social' ? 1.5 + Math.random() * 4 : Math.random() * 3.5);
            mob.potterGoal = { x: anchor.x + Math.cos(a) * r, z: anchor.z + Math.sin(a) * r };
            if (evening) {
              // stood quiet on t' step — turn to face t' door now an' then
              if (Math.random() < 0.5) mob.yaw = Math.atan2(mob.house.inside.x - mob.pos.x, mob.house.inside.z - mob.pos.z);
            } else if (Math.random() < 0.4) mob.yaw = Math.random() * Math.PI * 2;
          }
          // stride home at full pace while t' doorstep's far off; potter once tha's there
          const dHome = evening ? Math.hypot(anchor.x - mob.pos.x, anchor.z - mob.pos.z) : 0;
          const d = walkTo(mob.potterGoal, dHome > 6 ? mob.t.speed : mob.t.speed * 0.55);
          if (d < 1.2) { wishX = wishZ = 0; speed = 0; mob.vel.x *= 0.85; mob.vel.z *= 0.85; mob.homeStuck = 0; }
          else if (mob.homeStuck > 6) popTo(mob.potterGoal);
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
  // One SpriteMaterial (and texture) per item id, shared by every drop of that item —
  // a fresh texture per drop leaked GPU memory for the life of the session.
  dropMaterial(item) {
    if (!this._dropMats) this._dropMats = new Map();
    let mat = this._dropMats.get(item);
    if (!mat) {
      const tex = new THREE.TextureLoader().load(getIconURL(item));
      tex.magFilter = THREE.NearestFilter;
      tex.colorSpace = THREE.SRGBColorSpace;
      mat = new THREE.SpriteMaterial({ map: tex });
      this._dropMats.set(item, mat);
    }
    return mat;
  }

  spawnDrop(x, y, z, item, n, opts = {}) {
    const spr = new THREE.Sprite(this.dropMaterial(item));
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
    // materials cached per colour — bursts fire on every mined block, and a fresh
    // material each time was churn the GC (and the GPU) had to eat
    if (!this._burstMats) this._burstMats = new Map();
    const key = rgb[0] + ',' + rgb[1] + ',' + rgb[2];
    let mat = this._burstMats.get(key);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255) });
      this._burstMats.set(key, mat);
    }
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

export {
  makeSheep,
  makeBarghest,
  makeCow,
  makeBull,
  makeLlama,
  makePony,
  makeDog,
  makeCat,
  makePig,
  makeRat,
  makeCoble,
  makeGiant,
  makeVillager,
  villagerLook,
  makeWizardExtras
};
