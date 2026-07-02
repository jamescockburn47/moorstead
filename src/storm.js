// storm.js — the boss-battle storm (Dracula, Slice 2 Task 2.3).
//
// While the Count's fight is live (entities.draculaActive(), or the hunt is up
// and the player is near the East Cliff arena), this drives a storm: heavy rain
// (or snow in winter), lightning flashes that spike the sky lighting + a white
// screen blip, and a thunder clap a beat after each flash. It is SCOPED to the
// fight — it overrides nowt permanently and restores the prior sky state when the
// Count falls or the player leaves.
//
// The pure choices (rain-vs-snow, the next flash interval, the thunder delay,
// the bolt's forked shape) are split out as deterministic helpers so they're
// unit-tested headlessly; the rest is the in-game controller (smoke-tested live).
import * as THREE from 'three';
import { mulberry32 } from './noise.js';
import { DRACULA_MOOR } from './geography.js';

// Season -> the storm's precipitation. Winter brings snow, else rain. The winter
// check mirrors snow.js (winterPrecip/overcastGrey): season.warmth < 0 is the
// canonical "wintry" test the precipitation renderer itself splits snow/rain by,
// so the storm and the renderer always agree.
export function stormPrecip(season) {
  return (season && season.warmth < 0) ? 'snow' : 'rain';
}

// Seconds until the next lightning flash, varied by a running flash index so the
// rhythm wanders (a near, then a far, then a close pair…). ~4–12 s. `rnd` is
// injected for tests; defaults to Math.random (fine in the client runtime).
export function nextFlashInterval(i, rnd = Math.random) {
  const base = 4 + (i % 3) * 1.6;        // 4.0 / 5.6 / 7.2, cycling by index
  return base + rnd() * (12 - base);     // up to ~12 s, never below `base`
}

// Seconds between a flash and its thunder, varied by index: some strikes are near
// (a prompt crack), some far (a late rumble). ~0.2–2.5 s. A close strike (every
// 4th, by index) cracks promptly; the rest rumble later.
export function thunderDelay(i, rnd = Math.random) {
  const near = (i % 4) === 0;
  return near ? 0.2 + rnd() * 0.4        // near: 0.2–0.6 s
              : 0.8 + rnd() * 1.7;       // far:  0.8–2.5 s
}

// ---- the bolt itself: a seeded forked polyline (item 36) --------------------
// Pure and DETERMINISTIC: the same (index, worldSeed, arena, groundAt) writes the
// same floats, so every client at the same strike of the same fight in the same
// world draws the identical bolt — mulberry32 over the strike index folded with
// the world seed, NO Math.random anywhere in the shape (invariant 6).
//
// Writes the strike's strands into `pts` (a Float32Array of >= BOLT_MAX_POINTS*3
// floats) as ordered polyline points — the trunk first, then 1–2 branches — and
// the per-strand point counts into `counts` ([trunk, b1, b2]; 0 = unused). Both
// buffers are caller-owned and reused across strikes: nothing is allocated here.
// `groundAt(x, z)` supplies the terrain height under the hashed strike point
// (worldgen height in-game — itself seed-deterministic; tests pass a constant).
export const BOLT_MAX_POINTS = 25;  // trunk <= 13 points + two branches <= 6 each
export const BOLT_MAX_SEGS = 22;    // trunk <= 12 segments + two branches <= 5 each
export function boltStrands(index, worldSeed, arena, groundAt, pts, counts) {
  const rng = mulberry32((Math.imul(index | 0, 2654435761) ^ (worldSeed | 0)) | 0);
  const ax = arena && Number.isFinite(arena.x) ? arena.x : 0;
  const az = arena && Number.isFinite(arena.z) ? arena.z : 0;
  const r = (arena && arena.r) || 16;
  // the strike point: hashed near the arena (just outside to ~1.5r beyond)
  const ang = rng() * Math.PI * 2;
  const rad = r * (0.35 + rng() * 1.15);
  const ex = ax + Math.cos(ang) * rad, ez = az + Math.sin(ang) * rad;
  const ey = (groundAt ? groundAt(ex, ez) : 20) - 1.5; // tip buried a touch: depth test hides it
  // cloud-base start, offset sideways so the bolt slants across the sky
  const sx = ex + (rng() * 2 - 1) * 26, sz = ez + (rng() * 2 - 1) * 26, sy = 120;
  // trunk: a random walk down — 8..12 segments, ±6 lateral jitter on the knees,
  // endpoints exact (out of the cloud, into the hashed strike point)
  const segs = 8 + Math.floor(rng() * 5);
  let w = 0;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, knee = i > 0 && i < segs;
    pts[w++] = sx + (ex - sx) * t + (knee ? (rng() * 2 - 1) * 6 : 0);
    pts[w++] = sy + (ey - sy) * t;
    pts[w++] = sz + (ez - sz) * t + (knee ? (rng() * 2 - 1) * 6 : 0);
  }
  counts[0] = segs + 1;
  // 1–2 branches forking at ~40% of the trunk, petering out mid-air
  const nBranch = 1 + Math.floor(rng() * 2);
  for (let b = 0; b < 2; b++) {
    if (b >= nBranch) { counts[1 + b] = 0; continue; }
    const at = Math.max(1, Math.round(segs * 0.4) + b); // second fork one knee lower
    const a = at * 3;
    let px = pts[a], py = pts[a + 1], pz = pts[a + 2];
    const bAng = rng() * Math.PI * 2;
    const bs = 3 + Math.floor(rng() * 3);               // 3..5 segments
    pts[w++] = px; pts[w++] = py; pts[w++] = pz;
    for (let i = 1; i <= bs; i++) {
      px += Math.cos(bAng) * (5 + rng() * 4) + (rng() * 2 - 1) * 3.5;
      py -= 14 + rng() * 9;
      pz += Math.sin(bAng) * (5 + rng() * 4) + (rng() * 2 - 1) * 3.5;
      pts[w++] = px; pts[w++] = py; pts[w++] = pz;
    }
    counts[1 + b] = bs + 1;
  }
  return counts;
}

// white-blue bolt colour (0xdfe8ff), split so vertex colours can carry the fade
const BOLT_R = 0xdf / 255, BOLT_G = 0xe8 / 255, BOLT_B = 1.0;
// module scratch for the glow ribbon — nowt allocated per strike (invariant 7)
const _bP = new THREE.Vector3(), _bDir = new THREE.Vector3(),
      _bTo = new THREE.Vector3(), _bPerp = new THREE.Vector3();

export class Storm {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.cached = null;        // { stormPrecip, stormIsSnow, stormChurn } captured off the sky on start
    this.flashIndex = 0;
    this.flashTimer = nextFlashInterval(0);
    this.pendingThunder = [];  // [{ t, vol }] thunder claps owed, counting down
    // the forked bolt (item 36): TWO pooled meshes built lazily on first _begin
    // (never at import — the verify gate loads this module headlessly) and reused
    // for every strike after. The point/count scratch is preallocated here so a
    // strike allocates nothing at all.
    this._boltLine = null;     // thin white-blue core: additive LineSegments
    this._boltGlow = null;     // ~3-block camera-faced ribbon, Fine tier only
    this._glowOn = false;
    this._pts = new Float32Array(BOLT_MAX_POINTS * 3);
    this._counts = [0, 0, 0];
    // terrain height under the hashed strike point — worldgen is seed-deterministic,
    // so this keeps the bolt identical across clients; safe fallback mid-init
    this._groundAt = (x, z) => {
      const g = this.game, gen = g && g.world && g.world.gen;
      return gen && gen.height ? gen.height(Math.floor(x), Math.floor(z)) : 20;
    };
  }

  // Is the Count's fight live? True when he's risen (draculaActive), OR the hunt
  // is up and the player stands near the arena (so the sky turns as he's about to
  // rise). Guarded against a half-built world / pre-spawn entities.
  fightLive() {
    const g = this.game;
    const ent = g && g.entities;
    if (!ent) return false;
    if (ent.draculaActive && ent.draculaActive()) return true;
    // anticipation: the hunt accepted, not yet done, and we're at the arena
    const q = g.quests;
    if (q && q.draculaHuntActive && q.draculaHuntActive() && !(q.draculaDone && q.draculaDone())) {
      const geo = g.world && g.world.gen && g.world.gen.geo;
      const arena = geo && geo.draculaArena && geo.draculaArena();
      const p = g.player && g.player.pos;
      if (arena && p && Number.isFinite(arena.x)) {
        const d = Math.hypot(p.x - arena.x, p.z - arena.z);
        if (d < (arena.r || 16) + 24) return true;   // a touch beyond the trigger radius
      }
    }
    return false;
  }

  // Drive the storm one frame. Cheap, and a no-op (bar a one-time restore) when
  // the fight isn't live. Everything is guarded so a mid-init sky/audio/ui is safe.
  update(dt) {
    const g = this.game;
    const sky = g && g.sky;
    if (!sky) return;
    const live = this.fightLive();

    if (live && !this.active) this._begin(sky);
    else if (!live && this.active) this._end(sky);
    if (!this.active) return;

    // keep the precip override asserted on the sky each frame (in case a save/load
    // or weather tick reset it) and follow the season (rain may turn to snow).
    // stormChurn is OURS alone (the title flyover borrows stormPrecip for its
    // winter plates): it turns the dome's cloud deck near-black and 3x-scrolled.
    sky.stormPrecip = 1;
    sky.stormIsSnow = stormPrecip(g.season) === 'snow';
    sky.stormChurn = 1;

    // lightning: count down to the next flash, fire it, schedule its thunder
    this.flashTimer -= dt;
    if (this.flashTimer <= 0) {
      this._strike(sky);
      this.flashIndex++;
      this.flashTimer = nextFlashInterval(this.flashIndex);
    }

    // the bolt meshes ride the sky's own flash decay (~220 ms; sky.update owns
    // it), squared so they gutter out sharp — opacity only, the geometry stays
    // as laid until the next strike rewrites it in place
    if (this._boltLine) {
      const f = sky.flash * sky.flash;
      const on = f > 0.01;
      this._boltLine.material.opacity = Math.min(1, f * 1.1);
      this._boltLine.visible = on;
      this._boltGlow.material.opacity = this._glowOn ? f * 0.85 : 0;
      this._boltGlow.visible = on && this._glowOn;
    }

    // thunder owed from earlier flashes
    if (this.pendingThunder.length) {
      const audio = g.audio;
      for (const c of this.pendingThunder) {
        c.t -= dt;
        if (c.t <= 0 && !c.fired) {
          c.fired = true;
          if (audio && audio.thunder) audio.thunder(c.vol);
        }
      }
      this.pendingThunder = this.pendingThunder.filter(c => !c.fired);
    }
  }

  _begin(sky) {
    this.active = true;
    // cache whatever the sky's storm-override fields were (normally undefined) so
    // we put them back exactly — we never touch the live-weather model itself.
    this.cached = { stormPrecip: sky.stormPrecip, stormIsSnow: sky.stormIsSnow, stormChurn: sky.stormChurn };
    this.flashIndex = 0;
    this.flashTimer = 1.0 + Math.random() * 1.5; // first strike soon after he rises
    this.pendingThunder = [];
    this._ensureBolt();
  }

  _end(sky) {
    this.active = false;
    // restore the prior sky precip state (clear our override)
    if (this.cached) {
      sky.stormPrecip = this.cached.stormPrecip;
      sky.stormIsSnow = this.cached.stormIsSnow;
      sky.stormChurn = this.cached.stormChurn;
    } else {
      sky.stormPrecip = undefined; sky.stormIsSnow = undefined; sky.stormChurn = undefined;
    }
    this.cached = null;
    sky.flash = 0;
    if (this.game && this.game.ui && this.game.ui.setStormFlash) this.game.ui.setStormFlash(0);
    this.pendingThunder = [];
    // hide the pooled bolt meshes (kept for the next fight, never disposed)
    if (this._boltLine) {
      this._boltLine.visible = false; this._boltLine.material.opacity = 0;
      this._boltGlow.visible = false; this._boltGlow.material.opacity = 0;
    }
  }

  // one lightning strike: spike the sky's flash term + a white screen blip, lay
  // the forked bolt into the pooled meshes, and queue a thunder clap a beat
  // later (near strikes crack, far ones rumble late).
  _strike(sky) {
    const g = this.game;
    sky.flash = 1;                                   // sky.update decays this over ~200 ms
    if (g.ui && g.ui.setStormFlash) g.ui.setStormFlash(0.85);
    if (this._ensureBolt()) this._layBolt(sky);
    const delay = thunderDelay(this.flashIndex);
    // nearer strikes (short delay) are louder; distant ones softer
    const vol = delay < 0.7 ? 0.5 : 0.22 + Math.random() * 0.12;
    this.pendingThunder.push({ t: delay, vol, fired: false });
  }

  // Build the two pooled bolt meshes ONCE (invariant 7): geometry buffers sized
  // to the polyline maximum, updated in place each strike — zero geometry or
  // material allocation per strike, never disposed while the game lives. Lazy
  // (first fight), inside the class lifecycle: nothing GL-ish runs at import,
  // so the headless verify gate stays safe.
  _ensureBolt() {
    if (this._boltLine) return true;
    const g = this.game;
    if (!g || !g.scene) return false;
    // the thin white-blue core: every trunk/branch segment as a line pair
    this._linePos = new Float32Array(BOLT_MAX_SEGS * 2 * 3);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this._linePos, 3));
    lg.setDrawRange(0, 0);
    this._boltLine = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({
      color: 0xdfe8ff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    // the glow core: a camera-faced quad strip per strand, vertex colours carry
    // the tip fade (additive: black = invisible, so colour doubles as alpha)
    this._glowPos = new Float32Array(BOLT_MAX_POINTS * 2 * 3);
    this._glowCol = new Float32Array(BOLT_MAX_POINTS * 2 * 3);
    this._glowIdx = new Uint16Array(BOLT_MAX_SEGS * 6);
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(this._glowPos, 3));
    gg.setAttribute('color', new THREE.BufferAttribute(this._glowCol, 3));
    gg.setIndex(new THREE.BufferAttribute(this._glowIdx, 1));
    gg.setDrawRange(0, 0);
    this._boltGlow = new THREE.Mesh(gg, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    for (const m of [this._boltLine, this._boltGlow]) {
      m.visible = false;
      m.frustumCulled = false; // world-space verts rewritten in place; bounds go stale
      g.scene.add(m);
    }
    return true;
  }

  // Lay one strike's geometry into the pooled buffers. The strand POINTS are
  // seeded from (flashIndex, world seed, arena) — identical on every client.
  _layBolt(sky) {
    const g = this.game;
    const geo = g.world && g.world.gen && g.world.gen.geo;
    let arena = geo && geo.draculaArena ? geo.draculaArena() : null;
    // moorsgeo answers {x:1e6,…} when the abbey landmark is missing, and the
    // stylised legacy world has no draculaArena at all — both fall back to the
    // Count's moor (a module constant, so still identical everywhere).
    if (!arena || !Number.isFinite(arena.x) || Math.abs(arena.x) > 1e5) arena = DRACULA_MOOR;
    boltStrands(this.flashIndex, (g.seed | 0), arena, this._groundAt, this._pts, this._counts);
    const pts = this._pts, counts = this._counts, lp = this._linePos;
    let lw = 0, base = 0;
    for (let s = 0; s < 3; s++) {
      const n = counts[s];
      for (let i = 0; i + 1 < n; i++) {
        const a = (base + i) * 3;
        lp[lw++] = pts[a];     lp[lw++] = pts[a + 1]; lp[lw++] = pts[a + 2];
        lp[lw++] = pts[a + 3]; lp[lw++] = pts[a + 4]; lp[lw++] = pts[a + 5];
      }
      base += n;
    }
    const lgeo = this._boltLine.geometry;
    lgeo.setDrawRange(0, lw / 3);
    lgeo.attributes.position.needsUpdate = true;
    // the wide glow core is Fine-only: Plain keeps the trivial line draw + blip
    this._glowOn = !!(sky && sky.gfx === 'fine');
    if (this._glowOn) this._layGlow();
  }

  // The ~3-block glow ribbon. Facing uses THIS client's camera (cosmetic, like
  // any billboard); the strand points underneath stay identical everywhere.
  _layGlow() {
    const g = this.game;
    const cam = g.camera && g.camera.position;
    const pts = this._pts, counts = this._counts;
    const gp = this._glowPos, gc = this._glowCol, gi = this._glowIdx;
    let vi = 0, iw = 0, base = 0;
    for (let s = 0; s < 3; s++) {
      const n = counts[s];
      if (n < 2) { base += n; continue; }
      const half = s === 0 ? 1.5 : 0.7;      // trunk ~3 blocks wide, branches slimmer
      const bright = s === 0 ? 1 : 0.7;
      const first = vi;
      for (let i = 0; i < n; i++) {
        const a = (base + i) * 3;
        _bP.set(pts[a], pts[a + 1], pts[a + 2]);
        // central-difference direction along the strand
        const p = (base + Math.max(0, i - 1)) * 3, q = (base + Math.min(n - 1, i + 1)) * 3;
        _bDir.set(pts[q] - pts[p], pts[q + 1] - pts[p + 1], pts[q + 2] - pts[p + 2]);
        if (cam) _bTo.copy(cam).sub(_bP); else _bTo.set(1, 0, 0.3);
        _bPerp.crossVectors(_bDir, _bTo);
        if (_bPerp.lengthSq() < 1e-8) _bPerp.set(1, 0, 0);
        _bPerp.normalize().multiplyScalar(half);
        const t = i / (n - 1);
        const fade = (1 - t * t) * bright;   // alpha fades to the tips
        const f = vi * 3;
        gp[f]     = _bP.x - _bPerp.x; gp[f + 1] = _bP.y - _bPerp.y; gp[f + 2] = _bP.z - _bPerp.z;
        gp[f + 3] = _bP.x + _bPerp.x; gp[f + 4] = _bP.y + _bPerp.y; gp[f + 5] = _bP.z + _bPerp.z;
        gc[f]     = gc[f + 3] = BOLT_R * fade;
        gc[f + 1] = gc[f + 4] = BOLT_G * fade;
        gc[f + 2] = gc[f + 5] = BOLT_B * fade;
        vi += 2;
      }
      for (let i = 0; i + 1 < n; i++) {
        const v = first + i * 2;
        gi[iw++] = v;     gi[iw++] = v + 1; gi[iw++] = v + 2;
        gi[iw++] = v + 2; gi[iw++] = v + 1; gi[iw++] = v + 3;
      }
      base += n;
    }
    const gg = this._boltGlow.geometry;
    gg.setDrawRange(0, iw);
    gg.attributes.position.needsUpdate = true;
    gg.attributes.color.needsUpdate = true;
    gg.index.needsUpdate = true;
  }
}
