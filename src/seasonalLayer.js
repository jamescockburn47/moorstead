// seasonalLayer.js — seasonal scene-layer host. Owns the lifecycle (flicker +
// robin-hop animation, the move/state-change rebuild gate, teardown), renders
// snowmen across the whole cold season (their own deepSnow/wintry gate), and
// dispatches the active festival's dressing builder. Mirror of floraLayer
// lifecycle. Festival content itself lives in src/festivals/*.
import * as THREE from 'three';
import { wintry, deepSnow } from './festive.js';
import { festivalState } from './festivals.js';
import { SCARF_COLORS, DEFAULT_SNOWMAN } from './snowman.js';
import { hash2i } from './noise.js';
import { B } from './defs.js';
import { isFine } from './festivalKit.js';
import { buildChristmas } from './festivals/christmas.js';
import { buildBonfire } from './festivals/bonfire.js';
import { buildHarvest } from './festivals/harvest.js';
import { buildEaster } from './festivals/easter.js';
import { buildMayDay } from './festivals/mayday.js';
import { buildMidsummer } from './festivals/midsummer.js';

const RADIUS = 48;
const REBUILD_MOVE = 8;

// Registry of festival-id → dressing builder. Later slices add more entries
// (mayday, harvest…); the host calls whichever matches the active festival
// window, so nowt is drawn outside its calendar window.
const FESTIVAL_BUILDERS = { yule: buildChristmas, bonfire: buildBonfire, harvest: buildHarvest, easter: buildEaster, mayday: buildMayDay, midsummer: buildMidsummer };

export class SeasonalLayer {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.objects = [];
    this.center = null;
    this.key = null;
    this.timer = 0;
    this._builtOnce = false;
    this._lit = [];
    this._robins = [];
    this._fx = [];   // per-frame FX callbacks (lantern sway, uNight/uGate feeds) — cleared with the build
    this._t = 0;
  }

  update(dt, playerPos, season, snowAccum) {
    // Flicker runs every frame, before the rebuild early-out
    this._t += dt;
    for (let i = 0; i < this._lit.length; i++) {
      const m = this._lit[i];
      const k = 0.82 + 0.18 * Math.sin(this._t * 6 + i * 1.7); // candlelight breathing
      m.scale.setScalar(k);
    }

    // Robin hop animation — tiny vertical bob on a per-bird phase offset
    for (let i = 0; i < this._robins.length; i++) {
      const r = this._robins[i];
      const phase = r.userData.hopPhase || 0;
      // Bob: gentle sine wave at ~2Hz, amplitude 0.06 blocks
      r.position.y = r.userData.groundY + 0.06 * Math.abs(Math.sin(this._t * 2.1 + phase));
      // Occasional side-to-side tilt to sell the hop feel
      r.rotation.z = 0.08 * Math.sin(this._t * 2.1 + phase);
    }

    // Festival FX callbacks (lantern-string sway, fireworks uNight, mote uGate) —
    // a handful of cheap writes per frame; the heavy animation is GPU-side off the
    // shared fire tick (tickFires in main.js).
    for (let i = 0; i < this._fx.length; i++) this._fx[i](this._t, dt);

    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.4;
    const cx = Math.floor(playerPos.x), cz = Math.floor(playerPos.z);
    // Rebuild key changes on: the active festival window, the deep-snow gate,
    // and the player-snowman ledger size (so newly built/dressed/melted
    // snowmen re-render).
    // The key includes the quality tier so flipping Fine ↔ Plain rebuilds the
    // dressing (Fine adds the FX layer; Plain must fall back to today's look).
    const fest = festivalState(season.yearPhase);
    const key = (fest.active || '-') + (deepSnow(snowAccum) ? 'D' : '') +
                (isFine() ? 'F' : '') +
                '|' + this.world.snowmanLedger.size;
    if (this.center &&
        Math.abs(cx - this.center[0]) < REBUILD_MOVE &&
        Math.abs(cz - this.center[1]) < REBUILD_MOVE &&
        key === this.key &&
        this._builtOnce) return;
    this.build(cx, cz, season, snowAccum);
    this.center = [cx, cz];
    this.key = key;
    this._builtOnce = true;
  }

  build(cx, cz, season, snowAccum) {
    this._lit = [];
    this._robins = [];
    this._fx = [];
    this.clear();
    const gen = this.world.gen;

    // The real-Moors world keeps its building footprints LAZILY on geo._townBuildings(v); v.buildings
    // is []. Every festival builder decorates via v.buildings[].type (chapel decking, wreaths, window
    // glow, parlour trees, the chapel-fir). Without this, NO building dressing builds in the real
    // world — which is why festivals looked empty live. Materialise v.buildings from the lazy source
    // for the villages we're about to dress (cached on the village; only nearby ones, on rebuild).
    if (gen.geo && typeof gen.geo._townBuildings === 'function') {
      for (const v of (gen.geo.villages || [])) {
        if (Math.abs(v.x - cx) > RADIUS || Math.abs(v.z - cz) > RADIUS) continue;
        if (!v.buildings || !v.buildings.length) {
          try { v.buildings = gen.geo._townBuildings(v) || []; } catch { /* leave empty — builders skip it */ }
        }
      }
    }

    // -- Snowmen: rendered across the whole cold season, independent of any
    // festival. Auto-snowmen on greens need the deepest snow; player snowmen
    // from the ledger render whenever it's wintry. --
    if (wintry(season)) {
      // Auto-snowmen on village greens — only when snow is at its deepest.
      // Spread across the whole village (wider radius 4-28), exclude within 6
      // blocks of the fir so none cluster under the tree. Place 4-6 per village.
      if (deepSnow(snowAccum)) {
        for (const v of (gen.geo.villages || [])) {
          if (Math.abs(v.x - cx) > RADIUS || Math.abs(v.z - cz) > RADIUS) continue;
          const fp = firPlacement(this.world, v);
          let placed = 0;
          for (let r = 4; r < 28 && placed < 5; r++) {
            for (let a = 0; a < 16 && placed < 5; a++) {
              const angle = (a / 16) * Math.PI * 2;
              const x = v.x + Math.round(r * Math.cos(angle));
              const z = v.z + Math.round(r * Math.sin(angle));
              // Exclude cells within 6 blocks of the fir tree
              if (fp && Math.hypot(x - fp.x, z - fp.z) < 6) continue;
              const col = gen.geo.villageColumn(x, z);
              if (!col || (col.kind !== 'green' && col.kind !== 'closes')) continue;
              const sy = gen.height(x, z);
              if (this.world.getBlock(x, sy + 1, z) !== B.AIR) continue;
              if (hash2i(x, z, gen.geo.seed ^ 0x5107) > 0.45) continue; // sparse
              const yaw = hash2i(x, z, 7) * Math.PI * 2;
              this.addSnowman(x + 0.5, sy + 1, z + 0.5, DEFAULT_SNOWMAN, yaw);
              placed++;
            }
          }
        }
      }
      // Player-built snowmen from the ledger (placed by snowman interactions;
      // always rendered when wintry + loaded).
      for (const [k, entry] of this.world.snowmanLedger) {
        const [wx, wy, wz] = k.split(',').map(Number);
        if (Math.abs(wx - cx) > RADIUS || Math.abs(wz - cz) > RADIUS) continue;
        const yaw = hash2i(wx, wz, 0xbeef) * Math.PI * 2;
        this.addSnowman(wx + 0.5, wy, wz + 0.5, entry.cfg || DEFAULT_SNOWMAN, yaw);
      }
    }

    // -- Festival dressing: dispatch the active festival's builder. The builder
    // is only invoked inside its own calendar window, so e.g. the Christmas
    // dressing now shows across Christmastide rather than the whole winter. --
    const fest = festivalState(season.yearPhase);
    const b = FESTIVAL_BUILDERS[fest.active];
    if (b) b({
      scene: this.scene,
      world: this.world,
      gen,
      cx,
      cz,
      season,
      snowAccum,
      objects: this.objects,
      lit: this._lit,
      robins: this._robins,
      fx: this._fx,        // per-frame callbacks — run in update(), cleared on rebuild
      fine: isFine(),      // 'Fine' renderer live → builders add the FX/spectacle layer
    });
  }

  addSnowman(x, y, z, cfg, yaw) {
    const g = this.buildSnowman(cfg);
    g.position.set(x, y, z);
    g.rotation.y = yaw || 0;
    this.scene.add(g);
    this.objects.push(g);
  }

  buildSnowman(cfg) {
    const g = new THREE.Group();
    const snow = new THREE.MeshLambertMaterial({ color: 0xfbfdff });
    const dark = new THREE.MeshLambertMaterial({ color: 0x111111 });
    const brown = new THREE.MeshLambertMaterial({ color: 0x6b3d1e });

    // -- body spheres (feet at y=0) --
    const bot = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), snow);
    bot.position.y = 0.4;
    g.add(bot);

    const mid = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), snow);
    mid.position.y = 1.0;
    g.add(mid);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), snow);
    head.position.y = 1.5;
    g.add(head);

    // -- eyes --
    for (const ex of [-0.08, 0.08]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 5, 4), dark);
      eye.position.set(ex, 1.55, 0.19);
      g.add(eye);
    }

    // -- smile (coal dots in a small arc) --
    if (cfg.smile) {
      for (let i = 0; i < 5; i++) {
        const a = (i / 4 - 0.5) * 0.7; // arc angle
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.025, 4, 3), dark);
        dot.position.set(Math.sin(a) * 0.14, 1.42 + Math.cos(a) * 0.06 - 0.06, 0.2);
        g.add(dot);
      }
    }

    // -- nose --
    if (cfg.nose === 'carrot') {
      const orange = new THREE.MeshLambertMaterial({ color: 0xe05b00 });
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.18, 6), orange);
      nose.rotation.x = Math.PI / 2; // point along +z
      nose.position.set(0, 1.5, 0.24);
      g.add(nose);
    } else {
      // coal nub
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.04, 5, 4), dark);
      nose.position.set(0, 1.5, 0.22);
      g.add(nose);
    }

    // -- scarf --
    const scarfColor = SCARF_COLORS[cfg.scarf] != null ? SCARF_COLORS[cfg.scarf] : SCARF_COLORS[0];
    const scarfMat = new THREE.MeshLambertMaterial({ color: scarfColor });
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.045, 5, 12), scarfMat);
    scarf.rotation.x = Math.PI / 2;
    scarf.position.y = 1.24;
    g.add(scarf);

    // -- arms (two thin brown boxes angled out from mid sphere) --
    if (cfg.arms) {
      for (const side of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.08), brown);
        arm.position.set(side * 0.35, 1.02, 0.04);
        arm.rotation.z = side * 0.55; // angle outward
        g.add(arm);
      }
    }

    // -- hat --
    if (cfg.hat === 'topper') {
      const hatMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
      // brim
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 12), hatMat);
      brim.position.y = 1.74;
      g.add(brim);
      // crown
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.32, 12), hatMat);
      crown.position.y = 1.92;
      g.add(crown);
    } else if (cfg.hat === 'bobble') {
      const capColor = SCARF_COLORS[(cfg.scarf + 2) % SCARF_COLORS.length];
      const capMat = new THREE.MeshLambertMaterial({ color: capColor });
      // cap body
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.22, 10), capMat);
      cap.position.y = 1.8;
      g.add(cap);
      // pom
      const pom = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 5), snow);
      pom.position.y = 1.94;
      g.add(pom);
    }
    // cfg.hat === 'none' — nothing

    return g;
  }

  clear() {
    for (const o of this.objects) {
      this.scene.remove(o);
      // Groups that own a lifecycle (e.g. the bonfire's hero Fire — ember/smoke
      // particle systems + a registered pulsing light) expose dispose(); call it
      // first so their tick registries are released. It frees its OWN geometry +
      // per-fire materials but NEVER the shared flame material.
      if (typeof o.dispose === 'function') o.dispose();
      o.traverse(c => {
        if (c.geometry) c.geometry.dispose();
        // Only dispose materials that the object owns (not the shared cutout/flame
        // material, flagged sharedMaterial).
        if (c.material && !c.userData.sharedMaterial) c.material.dispose();
      });
    }
    this.objects.length = 0;
    this._lit = [];
    this._fx = [];
  }
}

// Return a deterministic open cell near village centre for the fir — used here
// only to keep auto-snowmen clear of where the Christmas fir would stand, so the
// exclusion radius matches regardless of which festival (if any) is active.
// Scans expanding rings r=2..10 with 16 angle steps per radius. Pass 1 prefers
// green/closes/path kinds (open ground); pass 2 accepts any non-building column.
function firPlacement(world, v) {
  const gen = world.gen;
  const isPreferred = kind => kind === 'green' || kind === 'closes' || kind === 'path';
  const isOpen = (x, z, col) => {
    if (!col || col.kind === 'building') return false;
    const sy = gen.height(x, z);
    return world.getBlock(x, sy + 1, z) === B.AIR;
  };
  // Pass 1: preferred kinds (green/closes/path).
  for (let r = 2; r <= 10; r++) {
    for (let ai = 0; ai < 16; ai++) {
      const angle = (ai / 16) * Math.PI * 2;
      const x = v.x + Math.round(r * Math.cos(angle));
      const z = v.z + Math.round(r * Math.sin(angle));
      if (x === v.x && z === v.z) continue; // skip the stone cross
      const col = gen.geo.villageColumn(x, z);
      if (!col || !isPreferred(col.kind)) continue;
      if (!isOpen(x, z, col)) continue;
      return { x, z };
    }
  }
  // Pass 2: any non-building open column.
  for (let r = 2; r <= 10; r++) {
    for (let ai = 0; ai < 16; ai++) {
      const angle = (ai / 16) * Math.PI * 2;
      const x = v.x + Math.round(r * Math.cos(angle));
      const z = v.z + Math.round(r * Math.sin(angle));
      if (x === v.x && z === v.z) continue;
      const col = gen.geo.villageColumn(x, z);
      if (!isOpen(x, z, col)) continue;
      return { x, z };
    }
  }
  return null;
}
