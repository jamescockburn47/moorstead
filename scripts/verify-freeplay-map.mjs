import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fitMap, isMapPosition, projectMap, mapHeading, peerGuidance } from '../src/freeplay/map-math.js';

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} vs ${expected}`);
const centre = { x: 100, z: 200, y: 40 };
const frame = fitMap([centre], { width: 500, height: 500, padding: 30 });
assert.equal(frame.span, 128, 'nearby players keep enough terrain context');
assert.deepEqual(projectMap(centre, frame), { x: 250, y: 250 });
const cardinals = [
  [{ x: 110, z: 200 }, { x: 250, y: 250 - 10 * frame.scale }, 'north'],
  [{ x: 100, z: 210 }, { x: 250 + 10 * frame.scale, y: 250 }, 'east'],
  [{ x: 90, z: 200 }, { x: 250, y: 250 + 10 * frame.scale }, 'south'],
  [{ x: 100, z: 190 }, { x: 250 - 10 * frame.scale, y: 250 }, 'west'],
];
for (const [point, screen, compass] of cardinals) {
  assert.deepEqual(projectMap(point, frame), screen, `${compass} projects onto the correct side`);
  assert.equal(peerGuidance(centre, point, 0).compass, compass);
}

for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, .37, -5.21]) {
  const heading = mapHeading(yaw);
  near(Math.sin(heading), -Math.cos(yaw), 'map arrow horizontal component follows player');
  near(-Math.cos(heading), Math.sin(yaw), 'map arrow vertical component follows player');
  const forward = { x: centre.x - Math.sin(yaw) * 10, z: centre.z - Math.cos(yaw) * 10 };
  const guide = peerGuidance(centre, forward, yaw);
  assert.equal(guide.arrow, '↑', 'someone straight ahead is never shown behind');
  near(guide.turn, 0, 'zero turn to actual player-forward vector');
  near(guide.distance, 10, 'horizontal distance uses actual coordinates');
}
const north = { x: 110, z: 200 };
assert.equal(peerGuidance(centre, north, 0).arrow, '→', 'facing west: north lies to the right');
assert.equal(peerGuidance(centre, north, Math.PI).arrow, '←', 'facing east: north lies to the left');
assert.equal(peerGuidance(centre, north, Math.PI / 2).arrow, '↓', 'facing south: north lies behind');
assert.equal(peerGuidance(centre, north, -Math.PI / 2).arrow, '↑', 'facing north: north lies ahead');
near(peerGuidance(centre, north, 0).turn, Math.PI / 2, 'positive turn is right');
near(peerGuidance(centre, north, Math.PI).turn, -Math.PI / 2, 'negative turn is left');
assert.equal(peerGuidance(centre, { x: 110, z: 210 }, 0).compass, 'north-east');
assert.equal(peerGuidance(centre, { ...centre, y: 55 }, 0).heightDifference, 15);
assert.equal(peerGuidance(centre, { ...centre }, 0).arrow, '●', 'coincident positions have no invented direction');
assert.equal(peerGuidance(centre, { x: 110, z: 200 }, 0).heightDifference, null, 'missing altitude is not invented');

const limits = [{ x: -8192, z: -8192 }, { x: 8192, z: 8192 }];
for (const [width, height] of [[800, 1280], [1280, 800], [320, 240]]) {
  const fit = fitMap(limits, { width, height, padding: 24 });
  assert.equal(fit.span, 16384, 'opposite world edges fit without clamping a player away');
  for (const point of limits) {
    const p = projectMap(point, fit);
    assert.ok(p.x >= 24 && p.x <= width - 24 && p.y >= 24 && p.y <= height - 24, 'both distant players stay within padded map bounds');
  }
}
assert.equal(fitMap([]), null);
assert.equal(fitMap([null, {}, { x: 1 }]), null, 'unpositioned roster does not fabricate origin markers');
assert.deepEqual(fitMap([null, { name: 'synthetic-unpositioned' }, centre]), fitMap([centre]));
for (const bad of [null, {}, { x: NaN, z: 0 }, { x: Infinity, z: 0 }, { x: 0, z: -Infinity }, { x: 0, y: NaN, z: 0 }, { x: '0', z: 0 }]) {
  assert.equal(isMapPosition(bad), false);
  assert.equal(projectMap(bad, frame), null);
  assert.equal(peerGuidance(centre, bad, 0), null, 'invalid peer has no direction');
}
assert.equal(peerGuidance(centre, north, 0, { connected: false }), null, 'offline cached peer has no guidance');
assert.equal(peerGuidance(centre, { ...north, connected: false }, 0), null);
assert.equal(peerGuidance({ ...centre, connected: false }, north, 0), null);
assert.equal(peerGuidance(centre, north, NaN), null);
assert.equal(mapHeading(NaN), null);
assert.equal(projectMap(centre, null), null);
assert.equal(fitMap([centre], { width: 50, height: 50, padding: 25 }), null, 'invalid viewport cannot create infinite scale');
assert.ok(readFileSync(new URL('../src/freeplay/map-math.js', import.meta.url), 'utf8').split('\n').length <= 300);
console.log('PASS free-play map: cardinals, yaw-relative guidance, opposite world edges, missing positions, stale connection and finite-only inputs.');
