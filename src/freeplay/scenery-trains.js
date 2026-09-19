import { buildTrain } from '../train.js';
import { DWELL_T, legTime, runProfile } from '../railtime.js';
import { trackSupported } from './scenery-support.js';

const RAKE_LENGTH = 33;

export function scheduleAt(path, now) {
  const stops = path.stationS;
  const legs = stops.slice(1).map((s, i) => ({ s0: stops[i], s1: s, len: s - stops[i], t: legTime(s - stops[i]) }));
  const oneWay = legs.reduce((total, leg) => total + leg.t, stops.length * DWELL_T);
  const dir = Math.floor(now / oneWay) % 2, forward = dir === 0;
  let time = now % oneWay;
  for (let k = 0; k < stops.length; k++) {
    const stop = forward ? k : stops.length - 1 - k;
    if (time < DWELL_T) return { s: stops[stop], dir, moving: false, speed: 0, end: k === stops.length - 1 };
    time -= DWELL_T;
    if (k === stops.length - 1) break;
    const leg = legs[forward ? k : legs.length - 1 - k];
    if (time < leg.t) {
      const run = runProfile(leg.len, time);
      return { s: forward ? leg.s0 + run.dist : leg.s1 - run.dist, dir, moving: true, speed: run.v, end: false };
    }
    time -= leg.t;
  }
  return { s: stops[0], dir: 0, moving: false, speed: 0, end: false };
}

// The whole articulated rake must stand on track. A blast also suspends its route,
// including offscreen, so reconnecting cannot teleport a train across a missing bridge.
export function safeTrainBerth(world, path) {
  const gap = path.pts.find(p => !trackSupported(world, p.x, p.z, p.deck));
  if (!gap) return { blocked: false, s: null };
  for (let s = gap.s - 8; s >= RAKE_LENGTH; s -= 8) {
    let safe = true;
    for (let offset = 0; offset <= RAKE_LENGTH; offset += 2) {
      const p = world.gen.geo.samplePosOn(path, s - offset);
      if (!trackSupported(world, p.x, p.z, p.deck)) { safe = false; break; }
    }
    if (safe) return { blocked: true, s };
  }
  return { blocked: true, s: null };
}

export class FreeplayTrains {
  constructor(game, now = () => Date.now() / 1000) {
    this.game = game; this.now = now; this.revision = -1;
    this.routes = game.world.gen.geo.railPaths().filter(route => route.kind !== 'freight')
      .map(route => ({ ...route, train: null, berth: { blocked: false, s: null } }));
  }

  update(dt) {
    const { world, player, scene } = this.game, geo = world.gen.geo;
    if (this.revision !== world.revision) {
      this.revision = world.revision;
      for (const route of this.routes) route.berth = safeTrainBerth(world, route.path);
    }
    for (const route of this.routes) {
      const { path, berth } = route;
      const scheduled = scheduleAt(path, this.now());
      const state = berth.blocked ? { s: berth.s, dir: 0, speed: 0, moving: false, end: false } : scheduled;
      if (state.s === null) { this.hide(route); continue; }
      const forward = (state.dir === 0 ? 1 : -1) * (state.end ? -1 : 1);
      const lead = Math.max(RAKE_LENGTH, Math.min(path.length - RAKE_LENGTH, state.s));
      const position = geo.samplePosOn(path, lead);
      if (Math.hypot(position.x - player.pos.x, position.z - player.pos.z) > 160 || !world.isLoaded(position.x, position.z)) {
        this.hide(route); continue;
      }
      if (!route.train) {
        route.train = buildTrain();
        // Exterior-only free-play trains do not need carriage PointLights.
        for (const part of route.train.parts) part.group.traverse(object => { if (object.isLight) object.visible = false; });
      }
      for (const part of route.train.parts) {
        const p = geo.samplePosOn(path, lead + part.offset * forward);
        if (!part.group.parent) scene.add(part.group);
        part.group.visible = true;
        part.group.position.set(p.x, p.deck + 1, p.z);
        part.group.rotation.order = 'YXZ';
        part.group.rotation.set(-Math.atan(p.grade * forward), Math.atan2(p.tx * forward, p.tz * forward), 0);
        if (state.moving) for (const wheel of part.wheels || []) wheel.rotateZ(state.speed * dt / (wheel.userData.r || .62));
      }
      if (state.moving) {
        route.train.rodPhase = (route.train.rodPhase || 0) + state.speed * dt / .62;
        route.train.loco.rods?.forEach((rod, i) => {
          const phase = route.train.rodPhase + i * Math.PI / 2;
          rod.position.y = .62 + Math.sin(phase) * .32; rod.position.z = .2 + Math.cos(phase) * .32;
        });
      }
    }
  }

  hide(route) { for (const part of route.train?.parts || []) part.group.visible = false; }

  dispose() {
    const geometries = new Set(), materials = new Set();
    for (const route of this.routes) for (const part of route.train?.parts || []) {
      part.group.removeFromParent();
      part.group.traverse(object => {
        if (object.geometry) geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          // train.js owns and caches the two emblem/numberplate textures globally.
          if (material && !material.map) materials.add(material);
        }
      });
    }
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    this.routes.length = 0;
  }
}
