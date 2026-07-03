// lighthouse.js — [33] Whitby harbour light: a revolving paraffin beam on the
// harbour headland, moors world only. Pure module (no GL at import scope) so
// the verify gate can import it under Node; construct HarbourLight only once
// three.js + a scene exist.
//
// SITING RULE (must be a pure function of the geo data, identical every client):
// start from geo.whitbyHarbour() — the surveyed strand point (coastT 0, on dry
// land by the water, moorsgeo.js:762-766). There is NO pierHead in the moors
// world (moorsgeo.js:742 returns the off-map sentinel), so the light cannot
// sit on a stamped pier — it sits on the natural headland instead.
//
// A single fixed-angle ray out from the strand does NOT find a headland here —
// checked against the real Whitby DEM: the ground east of the strand is a flat
// beach/quay (~27) that drops straight into the sea with no tall dry edge
// anywhere near it. So instead: a deterministic RING SEARCH outward from the
// strand, ring by ring (Chebyshev radius 1, 2, 3, ...), scanning each ring in
// a fixed clockwise order starting due north. The first column that is ALL of:
//   (a) dry land (coastT === 0) at height >= WATER_LEVEL + 1 (a shoulder above
//       the beach, not the beach itself),
//   (b) has an 8-neighbour with coastT > 0 (genuinely at the water's edge), and
//   (c) at least SAFE_DIST_FROM_ARENA from geo.draculaArena() (checked against
//       the DEM: the only *tall* headland-with-shore-edge near Whitby is the
//       East Cliff, which sits inside the Dracula boss arena — draculaArena().r
//       is 16; excluding a 24-block ring around it steers the search off the
//       abbey precinct entirely and it resolves to the harbour-mouth shoulder
//       just past the strand instead, which is thematically apt anyway: real
//       Whitby's harbour lights stand at the harbour mouth, not on the abbey
//       cliff) — wins. Ring order + fixed per-ring scan order + the fixed arena
// check make the search a pure function of geo: two constructions from the
// same geo/seed always walk the identical sequence and stop at the identical
// block (INVARIANTS #6). On the shipped data this lands one block seaward of
// the strand itself, at the harbour-mouth shoulder. If no column ever
// qualifies (shouldn't happen on the shipped DEM, but a data edit could starve
// it), fall back to the strand point itself, raised to local ground — still
// deterministic, just flatter siting.
import * as THREE from 'three';
import { WATER_LEVEL } from './defs.js';

const MAX_RING = 150;                  // Chebyshev radius to give up at
const MIN_HEADLAND_H = WATER_LEVEL + 1;
const SAFE_DIST_FROM_ARENA = 24;       // keep clear of the Dracula boss arena (r 16) + margin

// Fixed clockwise walk of a Chebyshev ring of radius r around (0,0): north edge
// west->east, east edge north->south, south edge east->west, west edge south->north.
function ringOffsets(r) {
  const pts = [];
  for (let x = -r; x <= r; x++) pts.push([x, -r]);
  for (let z = -r + 1; z <= r; z++) pts.push([r, z]);
  for (let x = r - 1; x >= -r; x--) pts.push([x, r]);
  for (let z = r - 1; z >= -r + 1; z--) pts.push([-r, z]);
  return pts;
}

function isShoreEdge(geo, x, z) {
  for (let ax = -1; ax <= 1; ax++) {
    for (let az = -1; az <= 1; az++) {
      if (ax === 0 && az === 0) continue;
      if (geo.coastT(x + ax, z + az) > 0) return true;
    }
  }
  return false;
}

// Pure siting function — exported so verify scripts can assert determinism
// without constructing three.js geometry. Returns {x,z,h} in block coords, or
// null if the moors geo doesn't expose what we need (stylised world etc).
export function siteHarbourLight(geo) {
  if (!geo || typeof geo.whitbyHarbour !== 'function' || typeof geo.coastT !== 'function') return null;
  const strand = geo.whitbyHarbour();
  if (!strand) return null;
  const sx = Math.round(strand.x), sz = Math.round(strand.z);
  const heightOf = (x, z) => geo.height ? geo.height(x, z) : (geo.heightRaw ? geo.heightRaw(x, z) : null);
  const arena = typeof geo.draculaArena === 'function' ? geo.draculaArena() : null;

  for (let r = 1; r <= MAX_RING; r++) {
    for (const [dx, dz] of ringOffsets(r)) {
      const x = sx + dx, z = sz + dz;
      if (geo.coastT(x, z) !== 0) continue;              // must be dry land
      const h = heightOf(x, z);
      if (h == null || h < MIN_HEADLAND_H) continue;      // must be headland-tall
      if (!isShoreEdge(geo, x, z)) continue;               // must be at the water's edge
      if (arena && Math.hypot(x - arena.x, z - arena.z) < SAFE_DIST_FROM_ARENA) continue; // clear of the boss fight
      return { x, z, h };
    }
  }
  // fallback: the strand itself, raised to local ground — deterministic, just flatter siting
  const fh = heightOf(sx, sz);
  return { x: sx, z: sz, h: Math.max(fh != null ? fh : WATER_LEVEL, MIN_HEADLAND_H) };
}

// --- shared geometry/material cache (module-level, the entities.js npcGeo/npcMat idiom) ---
const _boxGeos = new Map();
const _boxMats = new Map();
function boxGeo(w, h, d) {
  const k = w + '|' + h + '|' + d;
  let g = _boxGeos.get(k);
  if (!g) { g = new THREE.BoxGeometry(w, h, d); _boxGeos.set(k, g); }
  return g;
}
function boxMat(color) {
  let m = _boxMats.get(color);
  if (!m) { m = new THREE.MeshLambertMaterial({ color }); _boxMats.set(color, m); }
  return m;
}
function box(w, h, d, color) { return new THREE.Mesh(boxGeo(w, h, d), boxMat(color)); }

// Dispose the shared caches. Only call this on full teardown of the last
// HarbourLight (e.g. world reset that will never build another one this
// session) — the caches are meant to outlive any single tower, same contract
// as entities.js's npcGeo/npcMat.
export function disposeSharedCaches() {
  for (const g of _boxGeos.values()) g.dispose();
  for (const m of _boxMats.values()) m.dispose();
  _boxGeos.clear();
  _boxMats.clear();
}

// --- the lamp: emissive box, mirrors festivalKit's lantern recipe (emissiveIntensity
// 2.2 — over the 0.85 bloom threshold, the cheap wow) but its own material (not shared
// with the lantern strings) since it's a one-off, always-on-when-lit prop.
function makeLampMesh() {
  const geo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
  const mat = new THREE.MeshLambertMaterial({
    color: 0x2a2318,
    emissive: new THREE.Color(0xfff2c0),
    emissiveIntensity: 2.2,
  });
  const m = new THREE.Mesh(geo, mat);
  m.userData.ownGeometry = true; // not from the shared cache — dispose() must free it directly
  return m;
}

// --- the beam: ONE flared blade on one additive ShaderMaterial, billboarded
// about its LONG axis each frame (James 2026-07-03: the old two-crossed-planes
// X read as TWO laser beams from most angles, and 60 blocks of additive glow
// read as a laser, not a paraffin harbour light — one plane, rolled toward the
// camera in update(), reads as ONE beam from every angle).
//
// Geometry: length along local -Z (v 0 at the lamp hinge, v 1 at the tip),
// width along X with a gentle cone flare (BEAM_W0 at the lamp -> BEAM_W1 at
// the tip — a slightly diverging cone reads truer than a parallel bar), face
// normal +Y so a roll about local Z bisects the face toward the camera.
//
// Alpha (paraffin, not laser):
//   edge       = 1 - |u-0.5|*2                    soft width taper
//   reach      = mix(0.45, 1.0, uMistiness)       clear air: the beam dies short
//   lengthFade = (1 - clamp(v/reach,0,1))^2.5     hard die-off — the tip truly ends
//   a = edge^2 * lengthFade * mix(0.10, 0.55, uMistiness)
// so in CLEAR air the beam is a short faint blade (the lamp's emissive glow and
// the eye-wink flare carry the effect) and in mist/rain it lengthens toward the
// full BEAM_LEN and brightens — light needs vapour to be visible.
const BEAM_LEN = 22, BEAM_W0 = 1.2, BEAM_W1 = 3.4;
const BEAM_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const BEAM_FRAG = `
  precision mediump float;
  varying vec2 vUv;
  uniform float uMistiness; // 0..1, derived from sky.fogFar (short fogFar = thick air)
  uniform vec3 uColor;
  void main() {
    float edge = 1.0 - abs(vUv.x - 0.5) * 2.0;
    float widthFade = edge * edge;
    float reach = mix(0.45, 1.0, uMistiness);   // clear air: short throw; mist carries it
    float lv = clamp(vUv.y / reach, 0.0, 1.0);
    float lengthFade = pow(1.0 - lv, 2.5);      // hard along-length falloff — the tip dies
    float a = widthFade * lengthFade;
    a *= mix(0.10, 0.55, uMistiness);           // soft blade of light, brightening in vapour
    gl_FragColor = vec4(uColor, a);
  }
`;
let _beamMat = null;
function getBeamMaterial() {
  if (!_beamMat) {
    _beamMat = new THREE.ShaderMaterial({
      uniforms: { uMistiness: { value: 0.4 }, uColor: { value: new THREE.Color(0xfff2c0) } },
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      transparent: true,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
  }
  return _beamMat;
}
// One flared blade authored directly: 4 verts, 2 tris, hinged at the lamp
// (local origin), running down local -Z. Front-face winding gives normal +Y —
// the unrolled rest pose — so the per-frame roll about local Z in update()
// (mesh.rotation.z only; the parent beamGroup owns the shared-clock yaw) turns
// the face toward the camera without ever disturbing the sweep.
function makeBeamGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -BEAM_W0 / 2, 0, 0,          // lamp end, v=0
     BEAM_W0 / 2, 0, 0,
    -BEAM_W1 / 2, 0, -BEAM_LEN,  // tip, v=1 — flared wider than the base
     BEAM_W1 / 2, 0, -BEAM_LEN,
  ]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
    0, 0,  1, 0,  0, 1,  1, 1,
  ]), 2));
  g.setIndex([0, 1, 2, 2, 1, 3]);
  return g;
}
function makeBeamPlane() {
  return new THREE.Mesh(makeBeamGeometry(), getBeamMaterial());
}

// --- eye-wink flare sprite: reuses the sky.js mkDisc canvas-radial-disc idiom
// (a small additive sprite that only shows when the beam sweeps straight at
// the camera). Built lazily — this is the one bit of the module that touches
// `document`, so it's deferred to first use inside the browser-only ctor path.
function makeFlareSprite() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const grad = x.createRadialGradient(32, 32, 0, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,242,192,1)');
  grad.addColorStop(1, 'rgba(255,242,192,0)');
  x.fillStyle = grad; x.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, fog: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  s.scale.set(3, 3, 1);
  s.visible = false;
  return s;
}

const ROTATION_PERIOD_S = 12; // stately — one revolution every 12 real seconds, shared-clock

// HarbourLight — construct only in the moors world (geo.realWorld), once the
// scene exists. Consumes sky.fogFar (short = misty/thick air, thickens the
// beam's apparent opacity) and sky.isNight() (the lamp/beam are off by day —
// the tower stands regardless). Everything else is self-contained.
export class HarbourLight {
  // scene: THREE.Scene, geo: MoorsGeography, opts.plain: bool (Plain quality —
  // skips the eye-wink sprite per the red-team note; the beam itself is cheap
  // enough to run on both tiers with no bloom dependency).
  constructor(scene, geo, opts = {}) {
    this.scene = scene;
    this.plain = !!opts.plain;
    this.site = siteHarbourLight(geo);
    this.group = new THREE.Group();
    this.group.userData.wow = 'harbourLight';
    if (!this.site) { this.disposed = true; return; } // no valid siting data — inert, nowt to tear down but the empty group

    const { x, z, h } = this.site;
    this.group.position.set(x, h, z);
    scene.add(this.group);

    this._buildTower();
    this._buildLampAndBeam();
    if (!this.plain) {
      this.flare = makeFlareSprite();
      this.group.add(this.flare);
    }
  }

  // ~12 boxes: stone base, tapering white tower, gallery ring, lamp room walls.
  // All from the shared box cache — every HarbourLight (there's only ever one,
  // but the cache doesn't care) reuses the same geometries/materials.
  _buildTower() {
    const g = this.group;
    const STONE = 0x8c8478, WHITE = 0xe8e3d6, IRON = 0x2c2c2c;
    // base: broad stone plinth, two courses
    g.add(setY(box(3.2, 1.2, 3.2, STONE), 0.6));
    g.add(setY(box(2.8, 1.0, 2.8, STONE), 1.7));
    // tower: tapering white courses (widest at the foot, narrowest below the gallery)
    const courses = [
      { w: 2.4, h: 1.6, y: 2.2 + 0.8 },
      { w: 2.0, h: 1.6, y: 3.8 + 0.8 },
      { w: 1.7, h: 1.6, y: 5.4 + 0.8 },
      { w: 1.4, h: 1.6, y: 7.0 + 0.8 },
      { w: 1.15, h: 1.4, y: 8.6 + 0.7 },
    ];
    for (const c of courses) g.add(setY(box(c.w, c.h, c.w, WHITE), c.y));
    const galleryY = 10.0 + 0.3;
    // gallery: iron walkway ring (a flat wide box reads fine at block scale) + rail
    g.add(setY(box(1.7, 0.15, 1.7, IRON), galleryY));
    g.add(setY(box(1.5, 0.5, 1.5, IRON), galleryY + 0.4));
    // lamp room: glazed box (dark, the lamp mesh sits inside/above it) + domed cap
    g.add(setY(box(1.15, 1.1, 1.15, 0x1a1a1a), galleryY + 1.1));
    g.add(setY(box(1.3, 0.25, 1.3, IRON), galleryY + 1.75));
    g.add(setY(box(0.5, 0.4, 0.5, IRON), galleryY + 2.05)); // finial ball
    this._lampBaseY = galleryY + 1.65; // where the lamp sits, inside the glazed room
  }

  _buildLampAndBeam() {
    const lamp = makeLampMesh();
    lamp.position.set(0, this._lampBaseY, 0);
    this.group.add(lamp);
    this.lamp = lamp;

    // the rotating beam assembly: ONE flared blade hinged at the lamp, spun as
    // a group each frame (one yaw write). update() additionally rolls the blade
    // about the beam's own axis so its face always bisects toward the camera —
    // from every angle it reads as ONE beam (James 2026-07-03: the old crossed
    // pair showed its X and looked like two lasers).
    const beamGroup = new THREE.Group();
    beamGroup.position.set(0, this._lampBaseY, 0);
    const beam = makeBeamPlane();
    beamGroup.add(beam);
    this.group.add(beamGroup);
    this.beamGroup = beamGroup;
    this.beam = beam;
  }

  // update(dt, camera, sky): dt in seconds, camera a THREE.PerspectiveCamera (for
  // the eye-wink dot-product test), sky the game's Sky instance (reads
  // sky.isNight() for the night gate and sky.fogFar for the mistiness term —
  // short fogFar / thick air makes the beam read denser). Call once per frame
  // after the world/camera are known; safe to call even if siting failed
  // (this.disposed short-circuits).
  update(dt, camera, sky) {
    if (this.disposed) return;
    const night = !!(sky && typeof sky.isNight === 'function' && sky.isNight());
    if (this.lamp) this.lamp.visible = night;
    if (this.beamGroup) this.beamGroup.visible = night;
    if (!night) { if (this.flare) this.flare.visible = false; return; }

    // stately rotation, shared-clock: every client's beam points the same way at
    // the same wall-clock instant (the snow.js showerOscillation idiom — derive
    // from Date.now(), never accumulate dt, so a late-joining client matches).
    const now = Date.now() / 1000;
    const yaw = ((now % ROTATION_PERIOD_S) / ROTATION_PERIOD_S) * Math.PI * 2;
    this.beamGroup.rotation.y = yaw;

    // mistiness from sky.fogFar: post the S1d horizon-fix knee-clamp (sky.js
    // FOG_KNEE=60 / FOG_FAR_MAX=98), fogFar's practical range is ~7 (the Great
    // Fog) up to 98 (clear); fog weather clamps to <=28. Anchors: clear (98)
    // -> 0, fog weather (28) -> 1. Drives BOTH the beam's reach and its peak
    // alpha in the shader — a paraffin beam is barely there in clear air and
    // only becomes a long bright blade when there's vapour to light.
    const fogFar = (sky && typeof sky.fogFar === 'number') ? sky.fogFar : 98;
    const mistiness = clamp01((98 - fogFar) / 70);
    getBeamMaterial().uniforms.uMistiness.value = mistiness;

    if (camera) {
      const lampWorld = _v1.setFromMatrixPosition(this.lamp.matrixWorld);
      const c = _v2.copy(camera.position).sub(lampWorld);
      const cy = Math.cos(yaw), sy = Math.sin(yaw);

      // billboard the blade about its LONG axis: in beamGroup-local space the
      // beam runs down -Z, so a roll about local Z spins the face without
      // touching the shared-clock yaw above. Take the camera offset into
      // group-local space (undo the yaw about Y: lx = x·cos - z·sin, ly = y);
      // (lx, ly) IS the component of the offset perpendicular to the beam, and
      // rolling the rest-pose +Y normal onto it is roll = atan2(-lx, ly).
      // View-dependent by design — pure per-client cosmetics; the shared state
      // (the sweep) stays the clock-derived yaw. Scalar maths, no allocation.
      const lx = c.x * cy - c.z * sy;
      this.beam.rotation.z = Math.atan2(-lx, c.y);

      if (this.flare) {
        const toCam = c.normalize();
        // beam forward direction in world space (local -z rotated by the group's yaw)
        const beamDir = _v3.set(-sy, 0, -cy);
        const dot = beamDir.dot(toCam);
        if (dot > 0.9995) {
          this.flare.visible = true;
          // at t' LAMP, not t' tower foot — t' group origin sits at t' base, t'
          // lamp rides _lampBaseY up (pre-existing one-liner, James round 7)
          this.flare.position.set(0, this._lampBaseY, 0);
        } else {
          this.flare.visible = false;
        }
      }
    }
  }

  // dispose(): remove from scene, free anything not in the shared cache (the
  // lamp's own geometry/material, the beam blade's geometry, the flare sprite's
  // texture/material). The beam ShaderMaterial and the box cache are module
  // singletons and are NOT freed here — they're cheap and may serve the next
  // HarbourLight this session (mirrors getFlameMaterial's "never disposed"
  // singleton contract in fire.js). Call disposeSharedCaches() separately if
  // the caller wants a full module-level teardown (e.g. dev hot-reload).
  dispose() {
    if (this.scene && this.group.parent) this.scene.remove(this.group);
    if (this.lamp) { this.lamp.geometry.dispose(); this.lamp.material.dispose(); }
    if (this.beamGroup) {
      for (const m of this.beamGroup.children) if (m.geometry) m.geometry.dispose();
    }
    if (this.flare) {
      this.flare.material.map && this.flare.material.map.dispose();
      this.flare.material.dispose();
    }
    this.disposed = true;
  }
}

function setY(mesh, y) { mesh.position.y = y; return mesh; }
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// scratch vectors for update()'s per-frame dot-product test — zero per-frame
// allocations (INVARIANTS resource-hygiene spirit; same idiom as main.js's
// hoisted scratch Color/Vector3s elsewhere in the Fine path).
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
