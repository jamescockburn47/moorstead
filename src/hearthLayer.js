// hearthLayer.js — [5] Hearthlight: lit cottage windows after dark. Windowed-
// overlay layer mirroring SeasonalLayer's lifecycle (src/seasonalLayer.js:41-102):
// same r=48 window, ~0.4s throttled rebuild, keyed teardown/rebuild. Independent
// of SeasonalLayer — it materialises v.buildings itself (idempotent alongside the
// chimney-smoke pass that also reads it; see seasonalLayer.js:111-123) so this
// layer works stood alone wi'out a build-order dependency on the other.
//
// Ground-pool decal quads from the original spec were DROPPED (red-team call,
// 2026-07-02): baked block-light ([6], mesher BFS) supersedes them, and decals
// z-fight on uneven ground. Panes + hashed bedtimes only.
import * as THREE from 'three';
import { hash2i } from './noise.js';
import { isFine } from './festivalKit.js';
import { solarState } from './sky.js';
import { registerFxMat, unregisterFxMat } from './fire.js';

const RADIUS = 48;
const REBUILD_MOVE = 8;

// Evening/night window on sky.time — [SOLAR] anchored to the SEASONAL sunset
// and sunrise now (solarState, sky.js): the window opens EVENING_LEAD before
// the solar sunset (folk light up at dusk) and closes DAWN_LEAD before the
// solar sunrise (early risers snuff out). At the equinox this is the old
// 0.72 / 0.22 pair exactly; a midwinter window runs ~0.62 → ~0.32 (long lamp-lit
// evenings), midsummer a short ~0.82 → ~0.14.
const EVENING_LEAD = 0.03; // window opens this far ahead of solar sunset
const DAWN_LEAD = 0.03;    // and closes this far ahead of solar sunrise
function windowEdges(yearPhase = 0.125) {
  const s = solarState(0.5, yearPhase); // sunrise/sunset depend on yearPhase only
  const start = s.sunsetT - EVENING_LEAD, end = s.sunriseT - DAWN_LEAD;
  // Span of the lit window in day-fraction (start through midnight to end) —
  // bedtimes are drawn over exactly this span so "hour 0" means "evening just
  // started" and "hour SPAN" means "window closing". Hashing over a raw clock
  // hour instead would put most households "asleep" the instant the window
  // opens — caught in the headless smoke test.
  return { start, end, span: (1 - start) + end };
}

// Hours-into-the-lit-window (0 at the window's open, ticking up through
// midnight to its close) — used for BOTH the bedtime hash and the rebuild key,
// so households wink out one at a time as the night wears on rather than all
// at once at dusk or all surviving till dawn.
function hourOf(time, yearPhase = 0.125) {
  const t = (time % 1 + 1) % 1;
  const { start } = windowEdges(yearPhase);
  const sinceStart = t >= start ? t - start : (1 - start) + t;
  return Math.floor(sinceStart * 24);
}

function inEveningWindow(time, yearPhase = 0.125) {
  const t = (time % 1 + 1) % 1;
  const { start, end } = windowEdges(yearPhase);
  return t >= start || t < end;
}

// Bedtime hash per dwelling: a stable [0,1) draw off the building footprint,
// scaled to hours-into-the-window (0..span*24, i.e. the full span from dusk to
// the window closing — [SOLAR] a LONGER spread on long winter nights) so every
// household gets a real chance to be lit at SOME point in the night, not just
// in the last sliver before the window re-closes. Deterministic: same seed,
// same building, same season, same bedtime, every client.
function bedtimeHour(bx, bz, seed, yearPhase = 0.125) {
  return hash2i(bx, bz, seed ^ 0x4845) * (windowEdges(yearPhase).span * 24); // 'HE' — hearth salt, distinct from chimney's 0x484d
}

const DWELLING_TYPES = new Set(['cottage', 'farmhouse']);
const PANES_PER_DWELLING = 3; // spec: 1-3 panes per dwelling
const LIT_MAX_FINE = 8;       // cap per village, matches the torch cap
const LIT_MAX_PLAIN = 4;      // halved under Plain (fewer draws, same gate)

// Unlit amber base colour (period candle/lamp, c.1900 — no electric white).
const UNLIT_COLOR = 0xb87a2e;
// Under 'Fine' the pane is pushed ~1.6x over white so the bloom threshold (0.85
// post-ACES) catches it — same idiom as christmas.js's FINE_PANE.
const FINE_MULT = 1.6;

// One pane geometry shared by every window — mirrors addWindowGlow's plane but
// owned here as a module cache so the rebuild churn (create/destroy every 0.4s
// throttle tick) never reallocates geometry, only positions meshes fresh.
let _paneGeo = null;
function paneGeometry() {
  if (!_paneGeo) _paneGeo = new THREE.PlaneGeometry(0.7, 0.75);
  return _paneGeo;
}

// Two shared materials (unlit Plain look; lit Fine/Plain look) — MeshBasicMaterial
// is unlit so no light rig is needed, and every pane of a kind shares the ONE
// instance (INVARIANTS rule 7: share via a per-key cache). Flicker under Fine
// tints color per-frame via a uTime-registered ShaderMaterial instead — see
// litFineMaterial() below — so the plain MeshBasicMaterial cache only serves
// the steady (Plain, or Fine-not-yet-built) look.
let _litMat = null;
function litMaterial() {
  if (!_litMat) {
    _litMat = new THREE.MeshBasicMaterial({
      color: UNLIT_COLOR,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }
  return _litMat;
}

// Fine-tier lit pane: a ShaderMaterial so a gentle per-pane candle flicker can
// ride the shared fire tick (uTime, registerFxMat/tickFires — fire.js:220-226)
// without a per-frame CPU loop here. Colour multiplied ~1.6x over white so ACES
// bloom (threshold 0.85) catches it; the flicker is a slow, uneven waver — like
// fire.js's own candlelight breathing (seasonalLayer.js:61) — not a steady glow,
// so it reads as candle/lamp, not electric. Each pane gets its OWN material
// instance (phase-desynced via uSeed) so a street of cottages doesn't pulse in
// lockstep; NOT shared, so clear() disposes it and unregisters it from the tick.
const FLICKER_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const FLICKER_FRAG = `
  precision mediump float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uSeed;
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    // candlelight breathing: two out-of-phase sines, not a clean single wave —
    // mirrors seasonalLayer's lit-candle flicker (update(), :61) but per-pane.
    float k = 0.86 + 0.10 * sin(uTime * 5.3 + uSeed * 6.28) +
              0.06 * sin(uTime * 11.7 + uSeed * 3.1);
    gl_FragColor = vec4(uColor * k, uOpacity);
  }
`;
function makeFlickerMaterial(color, opacity, seed) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: seed },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
    },
    vertexShader: FLICKER_VERT,
    fragmentShader: FLICKER_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// Same facade-perimeter walk christmas.js uses for its window glow (:140-178):
// perimeter cells, skip corners, skip the south-wall doorway, (x+z)%3===0 marks
// a window cell — mirrors stampBuildingColumn's own window rule so panes land on
// real window blocks. Returns up to PANES_PER_DWELLING candidate placements
// { x, y, z, yaw }, walked in a fixed perimeter order so the SAME panes are
// picked every time (deterministic subset, not first-N-found order-dependent).
function facadePanes(gen, b) {
  const midX = Math.round((b.x0 + b.x1) / 2);
  const g = gen.height(midX, Math.floor((b.z0 + b.z1) / 2));
  const glowY = g + 2.5; // centred on the window block (g+2, height 1)
  const out = [];
  for (let wx = b.x0; wx <= b.x1 && out.length < PANES_PER_DWELLING; wx++) {
    for (let wz = b.z0; wz <= b.z1 && out.length < PANES_PER_DWELLING; wz++) {
      const onPerim = wx === b.x0 || wx === b.x1 || wz === b.z0 || wz === b.z1;
      if (!onPerim) continue;
      const corner = (wx === b.x0 || wx === b.x1) && (wz === b.z0 || wz === b.z1);
      if (corner) continue;
      const isDoor = (wz === b.z0) && (wx === midX);
      if (isDoor) continue;
      if ((wx + wz) % 3 !== 0) continue;

      let x, z, yaw;
      if (wz === b.z0) { x = wx + 0.5; z = wz - 0.05; yaw = 0; }
      else if (wz === b.z1) { x = wx + 0.5; z = wz + 1.05; yaw = Math.PI; }
      else if (wx === b.x0) { x = wx - 0.05; z = wz + 0.5; yaw = Math.PI / 2; }
      else { x = wx + 1.05; z = wz + 0.5; yaw = -Math.PI / 2; }
      out.push({ x, y: glowY, z, yaw });
    }
  }
  return out;
}

export class HearthLayer {
  // Signature mirrors SeasonalLayer.update(dt, playerPos, season, snowAccum):
  // update(dt, playerPos, sky) — `sky` gives us `.time` (day fraction, drives
  // both the evening/night gate and the bedtime comparison) same as
  // festivalKit.nightFromSkyTime consumes it elsewhere.
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.objects = [];
    this.center = null;
    this.key = null;
    this.timer = 0;
    this._builtOnce = false;
    this._flickerMats = []; // this build's flicker materials — unregistered on clear()
    this._t = 0;
    this._yearPhase = 0.125; // [SOLAR] refreshed each update() from sky.yearPhase
  }

  update(dt, playerPos, sky) {
    this._t += dt;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.4; // same throttle as SeasonalLayer's windowed rebuild
    const cx = Math.floor(playerPos.x), cz = Math.floor(playerPos.z);
    const time = sky ? sky.time : 0;
    // [SOLAR] the live Sky caches its yearPhase each update; headless stubs
    // without one fall back to the equinox (= the old fixed 0.72/0.22 window).
    const yp = (sky && sky.yearPhase != null) ? sky.yearPhase : 0.125;
    this._yearPhase = yp; // build() reads it for the bedtime hash
    const evening = inEveningWindow(time, yp);
    const hour = hourOf(time, yp);
    // Rebuild key: position window (via center-move check below) is NOT enough
    // on its own — the SAME position must also rebuild when night falls, when
    // an hour ticks over (households going dark one by one), or when Fine/Plain
    // flips (Fine adds the flicker layer; Plain must fall back to steady amber).
    const key = (evening ? 'N' : 'D') + hour + (isFine() ? 'F' : '');
    if (this.center &&
        Math.abs(cx - this.center[0]) < REBUILD_MOVE &&
        Math.abs(cz - this.center[1]) < REBUILD_MOVE &&
        key === this.key &&
        this._builtOnce) return;
    this.build(cx, cz, evening, hour);
    this.center = [cx, cz];
    this.key = key;
    this._builtOnce = true;
  }

  build(cx, cz, evening, hour) {
    this.clear();
    const gen = this.world.gen;
    if (!(gen.geo && gen.geo.villages)) return;

    // Daytime: gate entirely off — no panes built at all (spec: "invisible/not
    // built", so this takes the "not built" branch; cheapest possible daytime).
    if (!evening) return;

    // Materialise v.buildings from the lazy real-world source for villages in
    // the window, same idiom as seasonalLayer.js:111-123. Another layer
    // (chimney smoke, inside SeasonalLayer) also does this independently — both
    // calls are idempotent (v.buildings is cached once populated), so there is
    // no ordering dependency between the two layers.
    if (gen.geo && typeof gen.geo._townBuildings === 'function') {
      for (const v of gen.geo.villages) {
        if (Math.abs(v.x - cx) > RADIUS || Math.abs(v.z - cz) > RADIUS) continue;
        if (!v.buildings || !v.buildings.length) {
          try { v.buildings = gen.geo._townBuildings(v) || []; } catch { /* leave empty — skip this village this pass */ }
        }
      }
    }

    const fine = isFine();
    const cap = fine ? LIT_MAX_FINE : LIT_MAX_PLAIN;

    for (const v of gen.geo.villages) {
      if (Math.abs(v.x - cx) > RADIUS || Math.abs(v.z - cz) > RADIUS) continue;
      let lit = 0;
      for (const b of (v.buildings || [])) {
        if (lit >= cap) break;
        if (!DWELLING_TYPES.has(b.type)) continue;
        // Bedtime hash: this house is lit only while `hour` hasn't passed its
        // bedtime yet — so households go dark one by one as the night wears on,
        // and the SAME houses are lit at the SAME hour for every client (no
        // Math.random; hash2i seeded off the world seed + building footprint).
        const bedtime = bedtimeHour(b.x0, b.z1, gen.geo.seed, this._yearPhase != null ? this._yearPhase : 0.125);
        if (hour >= bedtime) continue;
        const panes = facadePanes(gen, b);
        if (!panes.length) continue;
        for (const p of panes) this.addPane(p, fine, b);
        lit++;
      }
    }
  }

  addPane(p, fine, b) {
    const geo = paneGeometry();
    let mesh;
    if (fine) {
      // Own material per pane (phase-desynced flicker) — NOT shared, disposed +
      // unregistered on teardown.
      const seed = hash2i(Math.round(p.x * 4), Math.round(p.z * 4), 0x666c); // 'fl'icker salt
      const mat = makeFlickerMaterial(
        new THREE.Color(UNLIT_COLOR).multiplyScalar(FINE_MULT),
        0.88,
        seed
      );
      registerFxMat(mat);
      this._flickerMats.push(mat);
      mesh = new THREE.Mesh(geo, mat);
      mesh.userData.ownMaterial = true; // clear() must dispose this one
    } else {
      // Plain: steady amber, the shared cached material — no flicker, no bloom,
      // still the first real window-glow the tablets get at night.
      mesh = new THREE.Mesh(geo, litMaterial());
      mesh.userData.sharedMaterial = true; // clear() must NOT dispose the cache
    }
    mesh.rotation.y = p.yaw;
    mesh.position.set(p.x, p.y, p.z);
    mesh.frustumCulled = false;
    mesh.userData.bx0 = b.x0; mesh.userData.bz0 = b.z0; // owning building — cap/debug bookkeeping, harmless at runtime
    this.scene.add(mesh);
    this.objects.push(mesh);
  }

  clear() {
    for (const o of this.objects) {
      this.scene.remove(o);
      // Shared pane geometry is a module cache — never dispose it here. Only
      // dispose materials this layer owns (the per-pane flicker ShaderMaterials);
      // the shared litMaterial() instance is left alone (userData.sharedMaterial).
      if (o.material && !o.userData.sharedMaterial) o.material.dispose();
    }
    this.objects.length = 0;
    for (const m of this._flickerMats) unregisterFxMat(m);
    this._flickerMats = [];
  }
}

// Exported for the headless smoke test / verify assertions: pure re-derivation
// of which buildings are lit at a given hour, without touching THREE at all.
export { bedtimeHour, hourOf, inEveningWindow, facadePanes };
