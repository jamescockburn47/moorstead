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
//      yule), keyed on festivalState(season.yearPhase).active.
import * as THREE from 'three';
import { TILE } from './defs.js';
import { isFine, nightFromSkyTime, addWindowGlow, addBillboard } from './festivalKit.js';
import { festivalState } from './festivals.js';
import { Fire, makeSmoke, registerFxMat, unregisterFxMat } from './fire.js';

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

// Parlour-interior-local -> world coords, same idiom as worldgen.js stampInns'
// toWorld() and main.js crossThreshold (origin + floor(dim/2) offset).
function parlourToWorld(plan, local) {
  const { w: pw, l: pl } = plan.parlour;
  const ix0 = plan.origin.x - Math.floor(pw / 2), iz0 = plan.origin.z - Math.floor(pl / 2);
  return { x: ix0 + local.x, z: iz0 + local.z };
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

export class InnDecorLayer {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
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
    const key = `${nightBucket}|${fest}|${isFine() ? 'F' : 'P'}`;
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

    // hanging bracket sign: same texture reused (shared — this layer owns the
    // texture but two materials may point at it; both disposed on clear()),
    // half scale, perpendicular to the wall at the door's side.
    const bracketMat = new THREE.MeshBasicMaterial({ map: tex, transparent: false, side: THREE.DoubleSide });
    const bracketGeo = new THREE.PlaneGeometry(1.5, 0.375);
    const bracket = new THREE.Mesh(bracketGeo, bracketMat);
    bracket.rotation.y = d.yaw + Math.PI / 2; // perpendicular to the wall
    const sideOff = 1.3; // out from the door, along the wall
    bracket.position.set(
      d.x + 0.5 + offX * 6 - Math.cos(d.yaw) * sideOff,
      plan.groundY + 2.6,
      d.z + 0.5 + offZ * 6 + Math.sin(d.yaw) * sideOff
    );
    bracket.frustumCulled = false;
    bracket.userData.ownGeometry = true;
    bracket.userData.sign = true;
    this.scene.add(bracket);
    this.objects.push(bracket);
  }

  // -- 2. hearth fire -------------------------------------------------------------
  buildHearthFire(plan, fine) {
    const hw = parlourToWorld(plan, plan.parlour.hearth);
    const seed = (plan.origin.x * 928371 + plan.origin.z) >>> 0;
    const fire = Fire({
      scale: 0.6,
      layers: fine ? 2 : 1,
      seed,
      smoke: false, // the parlour's underground — its own chimney plume is built separately, outside
      light: fine,
    });
    fire.position.set(hw.x + 0.5, plan.parlour.floorY + 1.2, hw.z + 0.5);
    this.scene.add(fire);
    this.objects.push(fire);
  }

  // -- one chimney-top smoke plume outside (the tavern isn't in v.buildings, so
  // seasonalLayer's cottage chimney pass never finds it) --------------------------
  buildChimneySmoke(plan, night) {
    const gate = () => night; // baked at build time; the 0.4s throttle refreshes it
    if (gate() <= 0) return;
    const g = gableGeometry(plan);
    const plume = makeSmoke(0.5);
    plume.position.set(g.fx0 + 0.5, g.ridgeY + 2.6, g.midZ + 0.5);
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
  buildLampGlow(plan) {
    const { w: pw, l: pl, floorY } = plan.parlour;
    const ix0 = plan.origin.x - Math.floor(pw / 2), iz0 = plan.origin.z - Math.floor(pl / 2);
    // two wall-mounted quads, facing inward, on opposite long walls
    const spots = [
      { x: ix0 + 2 + 0.5, z: iz0 + 0.05, yaw: 0 },
      { x: ix0 + pw - 3 + 0.5, z: iz0 + pl - 0.05, yaw: Math.PI },
    ];
    for (const s of spots) {
      addWindowGlow(this.scene, this.objects, s.x, floorY + 2.3, s.z, s.yaw, { color: 0xffb35c, opacity: 0.55 });
      const added = this.objects[this.objects.length - 1];
      added.userData.lampGlow = true;
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
