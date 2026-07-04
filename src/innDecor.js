// innDecor.js — [D2] Inn decor layer: turns D1's bare tavern shell into a
// dressed pub. Windowed-overlay layer following HearthLayer's shape exactly
// (src/hearthLayer.js): r=RADIUS, ~0.4s throttled rebuild keyed on a string,
// objects[] + clear() teardown per the seasonalLayer.js:368-386 contract.
//
// Per inn within range this builds:
//   1. a painted sign (canvas -> CanvasTexture -> owned PlaneGeometry/material)
//      flush above the exterior door, plus a small perpendicular bracket sign;
//   2. the parlour hearth fire (Fire({smoke:false, light: isFine()})) + one
//      chimney-top smoke plume outside (makeSmoke, gated cold/night like
//      seasonalLayer's cottage chimney pass);
//   3. warm window glow on the exterior window cells after dark
//      (addWindowGlow, gated on nightFactor());
//   4. two subtle interior paraffin-lamp glow quads on the parlour walls;
//   5. one seasonal dressing prop at the mantel mount (+ door lintel for
//      yule), keyed on festivalState(season.yearPhase).active;
//   6. [D4] a bragging board above the servery: the LOCAL player's pub-games
//      record (gameStatsRows), rebuilt on gameRecord revision.
import * as THREE from 'three';
import { TILE } from './defs.js';
import { isFine, nightFromSkyTime, addWindowGlow, addBillboard } from './festivalKit.js';
import { festivalState } from './festivals.js';
import { Fire, makeSmoke, registerFxMat, unregisterFxMat } from './fire.js';
import { gameStatsRows } from './ledgers.js';
import { formatBrass } from './economy.js';
import { relCell, doorFrame } from './innplan.js';

const RADIUS = 48;
const REBUILD_MOVE = 8;

const SIGN_BOARD_COLOR = '#2a1c10';
const SIGN_TEXT_COLOR = '#e8c96a';

// Same wall geometry the exterior shell (worldgen.js stampInns) and the
// exterior-landing helper (main.js _innExteriorLanding) already derive from
// plan.footprint/doorSide — mirrored here so the sign/glow/smoke props land
// on the SAME cells the voxels actually occupy, not a re-guess.
function doorWorld(plan) {
  const { x0, z0, x1, z1 } = plan.footprint;
  const midX = Math.round((x0 + x1) / 2), midZ = Math.round((z0 + z1) / 2);
  // yaw: the direction the sign/prop should FACE (outward, away from the building)
  if (plan.doorSide === 'n') return { x: midX, z: z0, yaw: Math.PI };       // facing north (-z)
  if (plan.doorSide === 's') return { x: midX, z: z1, yaw: 0 };             // facing south (+z)
  if (plan.doorSide === 'e') return { x: x1, z: midZ, yaw: -Math.PI / 2 };  // facing east (+x)
  return { x: x0, z: midZ, yaw: Math.PI / 2 };                              // 'w' facing west (-x)
}

// Gable geometry mirrored from worldgen.js stampInns (Task 1): ridge runs
// along x (the long axis), gableHalf = floor((z1-z0)/2), ridgeY constant.
function gableGeometry(plan) {
  const { x0: fx0, z0: fz0, x1: fx1, z1: fz1 } = plan.footprint;
  const wallH = 3, g = plan.groundY;
  const midZ = Math.round((fz0 + fz1) / 2);
  const gableHalf = Math.floor((fz1 - fz0) / 2);
  const ridgeY = g + wallH + 1 + gableHalf;
  return { fx0, fz0, fx1, fz1, midZ, ridgeY };
}

// Window cells mirrored from worldgen.js stampInns: 2 per long wall (z=fz0,
// z=fz1) at g+2, skipping the door column.
function windowCells(plan) {
  const { x0: fx0, z0: fz0, x1: fx1, z1: fz1 } = plan.footprint;
  const g = plan.groundY;
  const door = doorCellExterior(plan);
  const out = [];
  for (const wz of [fz0, fz1]) {
    for (const wx of [fx0 + 2, fx1 - 2]) {
      if (wx === door.x && wz === door.z) continue;
      // face: south wall (fz0) glows outward toward -z, north wall (fz1) toward +z
      const outward = wz === fz0 ? { yaw: 0, dz: -0.05 } : { yaw: Math.PI, dz: 1.05 };
      out.push({ x: wx + 0.5, y: g + 2.5, z: wz + outward.dz, yaw: outward.yaw });
    }
  }
  return out;
}

function doorCellExterior(plan) {
  const { x0: fx0, z0: fz0, x1: fx1, z1: fz1 } = plan.footprint;
  const midX = Math.round((fx0 + fx1) / 2), midZ = Math.round((fz0 + fz1) / 2);
  if (plan.doorSide === 'n') return { x: midX, z: fz0 };
  if (plan.doorSide === 's') return { x: midX, z: fz1 };
  if (plan.doorSide === 'e') return { x: fx1, z: midZ };
  return { x: fx0, z: midZ };
}

// Door-relative (f,l) undercroft cell -> world coords (innplan.js relCell — the
// single source of truth the worldgen carve and parlour seats also use).
function parlourToWorld(plan, cell) {
  return relCell(plan.origin, plan.doorSide, cell.f, cell.l);
}

// -- sign canvas texture -------------------------------------------------------
// Technique copied from entities.js makeNameplate() (not exported) — a
// fit-to-width loop on a 2D canvas, baked once into a CanvasTexture. Dark
// board background, cream serif lettering, period tavern-sign look.
function makeSignTexture(text) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = SIGN_BOARD_COLOR;
  x.fillRect(0, 0, c.width, c.height);
  x.textAlign = 'center'; x.textBaseline = 'middle';
  const MAXW = 460;
  const fit = (str, size, floor) => {
    const f = s => `${s}px "Georgia", "Times New Roman", serif`;
    let fs = size; x.font = f(fs);
    while (fs > floor && x.measureText(str).width > MAXW) { fs--; x.font = f(fs); }
    return f(fs);
  };
  x.font = fit(text, 54, 22);
  x.strokeStyle = 'rgba(0,0,0,0.6)'; x.lineWidth = 3;
  x.strokeText(text, c.width / 2, c.height / 2);
  x.fillStyle = SIGN_TEXT_COLOR;
  x.fillText(text, c.width / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

// -- bragging board canvas texture ---------------------------------------------
// Same dark-board/cream-lettering house style as makeSignTexture, but a
// multi-line list rather than a single fitted headline: header row bold-ish
// (bigger), stat rows smaller monospace-ish serif, left-aligned.
function makeBoardTexture(lines) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 320;
  const x = c.getContext('2d');
  x.fillStyle = SIGN_BOARD_COLOR;
  x.fillRect(0, 0, c.width, c.height);
  x.textAlign = 'left'; x.textBaseline = 'middle';
  x.fillStyle = SIGN_TEXT_COLOR;
  const pad = 22;
  const rowH = c.height / Math.max(lines.length, 1);
  lines.forEach((line, i) => {
    const isHeader = i === 0;
    x.font = `${isHeader ? 'bold 34' : '22'}px "Georgia", "Times New Roman", serif`;
    const maxw = c.width - pad * 2;
    let str = String(line);
    while (x.measureText(str).width > maxw && str.length > 3) str = str.slice(0, -2) + '…';
    x.fillText(str, pad, rowH * i + rowH / 2);
  });
  return new THREE.CanvasTexture(c);
}

// -- undercroft prop textures: things the voxel palette can't do, painted onto
// canvases the same way the sign is. Period-plain, warm, no anachronisms. --------
function newCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

// back-bar: dark shelving, ranked bottles, a foxed brewery mirror, a pewter row.
function makeBackBarTexture() {
  const c = newCanvas(384, 224), x = c.getContext('2d');
  x.fillStyle = '#20140b'; x.fillRect(0, 0, c.width, c.height);
  // mirror (centre)
  x.fillStyle = '#3b4a4a'; x.fillRect(150, 30, 84, 150);
  x.strokeStyle = '#6a5230'; x.lineWidth = 4; x.strokeRect(150, 30, 84, 150);
  // three shelves
  for (const sy of [70, 118, 166]) { x.fillStyle = '#4a3018'; x.fillRect(6, sy, 372, 6); }
  const bottleCols = ['#7a1f1f', '#2f5a2f', '#8a6a1f', '#4a2a5a', '#6a3a1a', '#2a4a6a'];
  for (let s = 0; s < 3; s++) {
    for (let i = 0; i < 10; i++) {
      const bx = 12 + i * 36; if (bx > 130 && bx < 240) continue; // clear the mirror
      const by = 40 + s * 48;
      x.fillStyle = bottleCols[(i + s) % bottleCols.length];
      x.fillRect(bx, by, 12, 26); x.fillRect(bx + 3, by - 8, 6, 8); // body + neck
    }
  }
  // pewter tankards hung along the top
  x.fillStyle = '#9aa0a6';
  for (let i = 0; i < 8; i++) { x.fillRect(20 + i * 46, 8, 16, 14); x.fillRect(35 + i * 46, 11, 5, 8); }
  return new THREE.CanvasTexture(c);
}

// a public-bar dartboard: cream/black wedges with red+green rings.
function makeDartboardTexture() {
  const c = newCanvas(200, 200), x = c.getContext('2d'), cx = 100, cy = 100;
  x.clearRect(0, 0, 200, 200);
  for (let r = 96; r > 0; r -= 2) {
    const wedge = Math.floor(r / 6) % 2;
    x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2);
    x.fillStyle = r > 90 ? '#111' : (r % 24 < 4 ? (wedge ? '#8a1f1f' : '#2f6a2f') : (wedge ? '#0d0d0d' : '#e8dcc0'));
    x.fill();
  }
  x.fillStyle = '#8a1f1f'; x.beginPath(); x.arc(cx, cy, 8, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#2f6a2f'; x.beginPath(); x.arc(cx, cy, 4, 0, Math.PI * 2); x.fill();
  x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 1;
  for (let a = 0; a < 20; a++) { x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a / 20 * 6.283) * 90, cy + Math.sin(a / 20 * 6.283) * 90); x.stroke(); }
  return new THREE.CanvasTexture(c);
}

// a made-up letting bed: a patchwork coverlet. Varied by index (no randomness).
function makeQuiltTexture(i) {
  const c = newCanvas(96, 96), x = c.getContext('2d');
  const palettes = [['#7a3b2e', '#c9a24b', '#3b5a4a'], ['#3a4a6a', '#b0a58a', '#6a2f3a'], ['#5a4a2a', '#8a9a6a', '#7a3b2e'], ['#4a3b5a', '#c9a24b', '#3b5a4a']];
  const pal = palettes[i % palettes.length];
  for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) { x.fillStyle = pal[(a + b + i) % pal.length]; x.fillRect(a * 16, b * 16, 16, 16); }
  x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 1;
  for (let a = 0; a <= 6; a++) { x.beginPath(); x.moveTo(a * 16, 0); x.lineTo(a * 16, 96); x.stroke(); x.beginPath(); x.moveTo(0, a * 16); x.lineTo(96, a * 16); x.stroke(); }
  return new THREE.CanvasTexture(c);
}

// a plain-dial tavern wall clock (NOT a longcase — period-correct for a tap room).
function makeClockTexture() {
  const c = newCanvas(128, 128), x = c.getContext('2d'), cx = 64, cy = 64;
  x.clearRect(0, 0, 128, 128);
  x.fillStyle = '#1a1207'; x.beginPath(); x.arc(cx, cy, 62, 0, 6.2832); x.fill();
  x.fillStyle = '#efe6cf'; x.beginPath(); x.arc(cx, cy, 52, 0, 6.2832); x.fill();
  x.strokeStyle = '#1a1207'; x.lineWidth = 3;
  for (let h = 0; h < 12; h++) { const a = h / 12 * 6.2832; x.beginPath(); x.moveTo(cx + Math.sin(a) * 46, cy - Math.cos(a) * 46); x.lineTo(cx + Math.sin(a) * 40, cy - Math.cos(a) * 40); x.stroke(); }
  x.lineWidth = 4; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + 20, cy - 14); x.stroke(); // hour ~ 2 o'clock
  x.lineWidth = 3; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx - 6, cy - 40); x.stroke(); // minute
  return new THREE.CanvasTexture(c);
}

// a game board chalked/inlaid on a tabletop, one per game, so a game table reads
// as a game in play and can't be mistaken for a plain settle.
function makeGameBoardTexture(game) {
  const c = newCanvas(128, 128), x = c.getContext('2d');
  x.fillStyle = '#5a3d22'; x.fillRect(0, 0, 128, 128); // dark polished wood
  const dot = (px, py, col) => { x.fillStyle = col; x.beginPath(); x.arc(px, py, 4, 0, 6.2832); x.fill(); };
  if (game === 'merrils') {
    x.strokeStyle = '#e8dcc0'; x.lineWidth = 3;
    for (const m of [14, 32, 50]) x.strokeRect(m, m, 128 - 2 * m, 128 - 2 * m);
    x.beginPath();
    x.moveTo(64, 14); x.lineTo(64, 50); x.moveTo(64, 78); x.lineTo(64, 114);
    x.moveTo(14, 64); x.lineTo(50, 64); x.moveTo(78, 64); x.lineTo(114, 64); x.stroke();
    for (const [a, b] of [[14, 14], [64, 14], [114, 14], [14, 64], [114, 64], [14, 114], [64, 114], [114, 114], [32, 32], [64, 32], [96, 32], [32, 64], [96, 64], [32, 96], [64, 96], [96, 96], [50, 50], [64, 50], [78, 50], [50, 64], [78, 64], [50, 78], [64, 78], [78, 78]]) dot(a, b, '#e8dcc0');
    dot(14, 14, '#1a1208'); dot(64, 32, '#1a1208'); dot(114, 114, '#efe6cf'); dot(64, 96, '#efe6cf');
  } else if (game === 'draughts') {
    for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) { x.fillStyle = (a + b) % 2 ? '#3a2816' : '#c9a86a'; x.fillRect(a * 16, b * 16, 16, 16); }
    for (const [a, b, col] of [[1, 0, '#1a1208'], [3, 0, '#1a1208'], [5, 2, '#1a1208'], [0, 7, '#efe6cf'], [2, 7, '#efe6cf'], [6, 5, '#efe6cf']]) dot(a * 16 + 8, b * 16 + 8, col);
  } else if (game === 'dominoes') {
    x.fillStyle = '#2f4a2f'; x.fillRect(8, 8, 112, 112); // green baize
    const tile = (px, py, w, h) => { x.fillStyle = '#efe6cf'; x.fillRect(px, py, w, h); x.strokeStyle = '#333'; x.lineWidth = 1; x.strokeRect(px, py, w, h); x.beginPath(); x.moveTo(px, py + h / 2); x.lineTo(px + w, py + h / 2); x.stroke(); };
    tile(22, 30, 46, 20); tile(38, 60, 20, 46); tile(72, 66, 46, 20);
  } else { // shoveha
    x.fillStyle = '#c9a86a'; x.fillRect(10, 10, 108, 108);
    x.strokeStyle = '#3a2816'; x.lineWidth = 2;
    for (let i = 1; i <= 9; i++) { const py = 10 + i * 10.8; x.beginPath(); x.moveTo(10, py); x.lineTo(118, py); x.stroke(); }
    for (const [px, py] of [[40, 26], [70, 48], [55, 70], [85, 92]]) dot(px, py, '#b8b8c0');
  }
  return new THREE.CanvasTexture(c);
}

export class InnDecorLayer {
  // player is optional (verify harness constructs with 2 args) — the bragging
  // board simply doesn't build without one; every other prop is unaffected.
  constructor(scene, world, player = null) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.objects = [];
    this.center = null;
    this.key = null;
    this.timer = 0;
    this._builtOnce = false;
    this._fxMats = []; // this build's registered fire-tick materials — unregistered on clear()
  }

  update(dt, playerPos, sky, season) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.4; // same throttle as HearthLayer/SeasonalLayer
    const cx = Math.floor(playerPos.x), cz = Math.floor(playerPos.z);
    const time = sky ? sky.time : 0;
    const yearPhase = (season && season.yearPhase != null) ? season.yearPhase
      : (sky && sky.yearPhase != null) ? sky.yearPhase : 0.125;
    const night = nightFromSkyTime(time, yearPhase);
    const nightBucket = Math.round(night * 4);
    const fest = festivalState(yearPhase).active || '-';
    const rev = (this.player && this.player._gameRecRev) || 0;
    const key = `${nightBucket}|${fest}|${isFine() ? 'F' : 'P'}|${rev}`;
    if (this.center &&
        Math.abs(cx - this.center[0]) < REBUILD_MOVE &&
        Math.abs(cz - this.center[1]) < REBUILD_MOVE &&
        key === this.key &&
        this._builtOnce) return;
    this.build(cx, cz, yearPhase, night);
    this.center = [cx, cz];
    this.key = key;
    this._builtOnce = true;
  }

  build(cx, cz, yearPhase, night) {
    this.clear();
    const gen = this.world.gen;
    if (!gen || !gen.inns || gen.inns.size === 0) return;

    const fine = isFine();
    const fest = festivalState(yearPhase);

    for (const plan of gen.inns.values()) {
      if (Math.abs(plan.origin.x - cx) > RADIUS || Math.abs(plan.origin.z - cz) > RADIUS) continue;

      this.buildSign(plan);
      this.buildHearthFire(plan, fine);
      this.buildChimneySmoke(plan, night);
      if (night > 0.1) this.buildWindowGlow(plan);
      this.buildLampGlow(plan);
      this.buildSeasonalMounts(plan, fest);
      this.buildBraggingBoard(plan);
      this.buildUndercroftProps(plan);
    }
  }

  // -- 1. painted sign + hanging bracket sign -----------------------------------
  buildSign(plan) {
    const d = doorWorld(plan);
    const tex = makeSignTexture(plan.name);

    // main board: flush above the door, 0.06 out from the wall face
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: false });
    const geo = new THREE.PlaneGeometry(3, 0.75);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.y = d.yaw;
    const offX = Math.sin(d.yaw) * 0.06, offZ = Math.cos(d.yaw) * 0.06;
    mesh.position.set(d.x + 0.5 + offX, plan.groundY + 3.4, d.z + 0.5 + offZ);
    mesh.frustumCulled = false;
    mesh.userData.ownGeometry = true;
    mesh.userData.sign = true;
    this.scene.add(mesh);
    this.objects.push(mesh);

    // hanging bracket sign: perpendicular to the wall at the door's side, and
    // DOUBLE-FACED the way a real pub sign is — two front-facing planes
    // back-to-back, NOT one THREE.DoubleSide plane (DoubleSide renders the
    // back face with mirrored UVs — James saw backwards lettering live,
    // 2026-07-04). Same texture reused; both materials disposed on clear().
    const sideOff = 1.3; // out from the door, along the wall
    const bx = d.x + 0.5 + offX * 6 - Math.cos(d.yaw) * sideOff;
    const bz = d.z + 0.5 + offZ * 6 + Math.sin(d.yaw) * sideOff;
    for (const flip of [0, Math.PI]) {
      const bracketMat = new THREE.MeshBasicMaterial({ map: tex, transparent: false });
      const face = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.375), bracketMat);
      face.rotation.y = d.yaw + Math.PI / 2 + flip;
      // nudge each face a hair along its own outward normal so they never z-fight
      face.position.set(
        bx + Math.sin(face.rotation.y) * 0.006,
        plan.groundY + 2.6,
        bz + Math.cos(face.rotation.y) * 0.006
      );
      face.frustumCulled = false;
      face.userData.ownGeometry = true;
      face.userData.sign = true;
      this.scene.add(face);
      this.objects.push(face);
    }
  }

  // -- 2. hearth fire -------------------------------------------------------------
  buildHearthFire(plan, fine) {
    const hw = parlourToWorld(plan, plan.parlour.hearth);
    const seed = (plan.origin.x * 928371 + plan.origin.z) >>> 0;
    const fY = plan.parlour.floorY;
    const { fwd } = doorFrame(plan.doorSide);
    // a real, ALWAYS-lit fire burning in the range firebox — big and multi-layered,
    // nudged to the front face (−forward, into the room) so it burns in the opening,
    // not inside the block. This is the "genuine hearth with a flame".
    const fire = Fire({ scale: 1.05, layers: fine ? 3 : 2, seed, smoke: false, light: true });
    // pull it well clear of the range's solid front face (~0.65 blocks into the room)
    // and raise it into the firebox opening, or the block buries it (tested live).
    fire.position.set(hw.x + 0.5 - fwd[0] * 1.15, fY + 1.7, hw.z + 0.5 - fwd[1] * 1.15);
    this.scene.add(fire);
    this.objects.push(fire);
    // a warm amber firelight pool cast on the flags in front of the hearth
    const gm = new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0.3, depthWrite: false });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), gm);
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(hw.x + 0.5 - fwd[0] * 1.1, fY + 1.05, hw.z + 0.5 - fwd[1] * 1.1);
    glow.frustumCulled = false; glow.userData.ownGeometry = true; glow.userData.hearthGlow = true;
    this.scene.add(glow); this.objects.push(glow);
  }

  // -- one chimney-top smoke plume outside (the tavern isn't in v.buildings, so
  // seasonalLayer's cottage chimney pass never finds it) --------------------------
  buildChimneySmoke(plan, night) {
    const gate = () => night; // baked at build time; the 0.4s throttle refreshes it
    if (gate() <= 0) return;
    const g = gableGeometry(plan);
    const plume = makeSmoke(0.5);
    plume.position.set(g.fx0 + 0.5, g.ridgeY + 3.6, g.midZ + 0.5); // chimney column runs ridgeY+1..+3 (base sits ON the ridge slate)
    plume.material.uniforms.uGate.value = Math.min(1, gate());
    registerFxMat(plume.material);
    this._fxMats.push(plume.material);
    plume.dispose = () => unregisterFxMat(plume.material);
    this.scene.add(plume);
    this.objects.push(plume);
  }

  // -- 3. window glow (night only) -------------------------------------------------
  buildWindowGlow(plan) {
    for (const w of windowCells(plan)) {
      addWindowGlow(this.scene, this.objects, w.x, w.y, w.z, w.yaw, { color: 0xffce6b, opacity: 0.82 });
      const added = this.objects[this.objects.length - 1];
      added.userData.windowGlow = true;
    }
  }

  // -- 4. paraffin-lamp glow inside (always, subtle) -------------------------------
  // A warm amber light pool cast on the FLOOR beneath each room's lantern (a
  // horizontal quad, not the floating vertical square the old version dropped in
  // mid-air). The lantern block itself emits the real light; this is just its pool.
  buildLampGlow(plan) {
    const fY = plan.parlour.floorY;
    for (const r of (plan.parlour.rooms || [])) {
      const w = relCell(plan.origin, plan.doorSide, Math.round((r.f0 + r.f1) / 2), Math.round((r.l0 + r.l1) / 2));
      const mat = new THREE.MeshBasicMaterial({ color: 0xffb35c, transparent: true, opacity: 0.16, depthWrite: false });
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), mat);
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(w.x + 0.5, fY + 1.04, w.z + 0.5);
      glow.frustumCulled = false; glow.userData.ownGeometry = true; glow.userData.lampGlow = true;
      this.scene.add(glow); this.objects.push(glow);
    }
  }

  // -- 5. seasonal dressing at the mantel mount (+ door lintel for yule) -----------
  buildSeasonalMounts(plan, fest) {
    const mounts = plan.furnish && plan.furnish.mounts;
    if (!mounts) return;
    const active = fest.active;
    if (!active) return;

    let tile = null;
    if (active === 'yule') tile = TILE.HOLLY;
    else if (active === 'harvest') tile = TILE.WILDFLOWER; // no dedicated sheaf/wheat tile exists — closest flora billboard
    else if (active === 'mayday' || active === 'midsummer') tile = TILE.WILDFLOWER;
    if (tile == null) return;

    const mantelWorld = parlourToWorld(plan, mounts.mantel);
    addBillboard(this.scene, this.objects, tile, mantelWorld.x + 0.5, plan.parlour.floorY + 2.2, mantelWorld.z + 0.5, 0);
    const mantelProp = this.objects[this.objects.length - 1];
    mantelProp.userData.seasonalMount = true;

    if (active === 'yule' && mounts.doorOut) {
      const d = doorWorld(plan);
      addBillboard(this.scene, this.objects, TILE.HOLLY, d.x + 0.5, plan.groundY + 3.1, d.z + 0.5, d.yaw);
      const lintelProp = this.objects[this.objects.length - 1];
      lintelProp.userData.seasonalMount = true;
    }
  }

  // -- 6. [D4] bragging board: the LOCAL player's pub-games record, on the
  // parlour wall nearest the servery. Per-room SHARED standings need relay
  // persistence and are deferred alongside PvP (D4 non-goals) — this board
  // only ever shows what the visitor themself has won or lost.
  buildBraggingBoard(plan) {
    if (!this.player) return;
    const par = plan.parlour;
    if (!par || !par.rooms) return;
    // mounted on the Games Room's back (-lat) wall, facing into the room over the
    // tables — the club/games room is where a drinker's record belongs.
    const games = par.rooms.find(r => r.name === 'games') || par.rooms[0];
    const floorY = par.floorY;
    const cf = Math.round((games.f0 + games.f1) / 2);
    const { lat } = doorFrame(plan.doorSide);
    const inner = relCell(plan.origin, plan.doorSide, cf, games.l0); // interior cell against the -lat wall
    const yaw = Math.atan2(lat[0], lat[1]);                          // face +lat (into the room)
    const wx = inner.x + 0.5 - lat[0] * 0.45;
    const wz = inner.z + 0.5 - lat[1] * 0.45;

    const rows = gameStatsRows(this.player.gameRecord, formatBrass).slice(0, 4);
    const lines = ['TAVERN GAMES', ...(rows.length ? rows : ["nowt won nor lost yet."])].slice(0, 5);
    const tex = makeBoardTexture(lines);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: false, side: THREE.DoubleSide });
    const geo = new THREE.PlaneGeometry(2.2, 1.5);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.y = yaw;
    mesh.position.set(wx, floorY + 2.2, wz);
    mesh.frustumCulled = false;
    mesh.userData.ownGeometry = true;
    mesh.userData.braggingBoard = true;
    this.scene.add(mesh);
    this.objects.push(mesh);
  }

  // -- 7. undercroft painted props: back-bar bottles+mirror, a dartboard, bed
  // quilts, a plain-dial clock — the "visuals are the point" detail the voxel
  // palette can't express, mounted flush on the right room walls via relCell. ----
  buildUndercroftProps(plan) {
    const par = plan.parlour;
    if (!par || !par.rooms) return;
    const fY = par.floorY;
    const { fwd, lat } = doorFrame(plan.doorSide);
    const room = n => par.rooms.find(r => r.name === n);
    // a flat painted plane at door-relative (f,l), FACING (faceF*fwd + faceL*lat),
    // flush 0.46 off the wall into the room.
    const wallProp = (f, l, faceF, faceL, y, wM, hM, tex, tag) => {
      const c = relCell(plan.origin, plan.doorSide, f, l);
      const nx = fwd[0] * faceF + lat[0] * faceL, nz = fwd[1] * faceF + lat[1] * faceL;
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(wM, hM), mat);
      mesh.rotation.y = Math.atan2(nx, nz);
      mesh.position.set(c.x + 0.5 + nx * 0.46, y, c.z + 0.5 + nz * 0.46);
      mesh.frustumCulled = false; mesh.userData.ownGeometry = true; mesh.userData[tag] = true;
      this.scene.add(mesh); this.objects.push(mesh);
    };
    // a horizontal painted plane laid on top of a block (a bed coverlet)
    const flatProp = (f, l, y, size, tex, tag) => {
      const c = relCell(plan.origin, plan.doorSide, f, l);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(c.x + 0.5, y, c.z + 0.5);
      mesh.frustumCulled = false; mesh.userData.ownGeometry = true; mesh.userData[tag] = true;
      this.scene.add(mesh); this.objects.push(mesh);
    };

    // 1. back-bar bottles + mirror on the servery's far (+lat) wall, facing the hatch
    const sv = room('servery');
    if (sv) wallProp(Math.round((sv.f0 + sv.f1) / 2), sv.l1, 0, -1, fY + 1.7, 2.6, 1.5, makeBackBarTexture(), 'ucProp');
    // 2. dartboard on the games room's forward wall, facing back into the room
    const gm = room('games');
    if (gm) wallProp(gm.f1, Math.round((gm.l0 + gm.l1) / 2), -1, 0, fY + 1.9, 0.95, 0.95, makeDartboardTexture(), 'ucProp');
    // 3. a patchwork quilt laid on top of each letting bed (the WOOL block's top
    // face is at world y = floorY+2, so the coverlet sits a hair above it)
    (plan.furnish.beds || []).forEach((b, i) => flatProp(b.f, b.l, fY + 2.03, 0.92, makeQuiltTexture(i), 'ucProp'));
    // 3b. a chalked/inlaid game board on each table top, so a game table reads as a
    // game in play and can't be mistaken for a plain settle
    (par.tables || []).forEach(t => flatProp(t.f, t.l, fY + 2.03, 0.94, makeGameBoardTexture(t.game), 'ucProp'));
    // 4. a plain-dial tavern clock high on the tap forward wall, beside the range
    const tap = room('tap');
    if (tap) wallProp(tap.f1, tap.l1 - 1, -1, 0, fY + 2.5, 0.8, 0.8, makeClockTexture(), 'ucProp');
  }

  clear() {
    for (const o of this.objects) {
      this.scene.remove(o);
      if (typeof o.dispose === 'function') o.dispose();
      if (typeof o.traverse === 'function') {
        o.traverse(c => {
          if (c.geometry) c.geometry.dispose();
          if (c.material && !c.userData.sharedMaterial) {
            if (c.material.map) c.material.map.dispose();
            c.material.dispose();
          }
        });
      } else {
        if (o.geometry) o.geometry.dispose();
        if (o.material && !o.userData.sharedMaterial) {
          if (o.material.map) o.material.map.dispose();
          o.material.dispose();
        }
      }
    }
    this.objects.length = 0;
    for (const m of this._fxMats) unregisterFxMat(m);
    this._fxMats = [];
  }
}
