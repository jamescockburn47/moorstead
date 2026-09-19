import { test, expect } from '@playwright/test';
import { prepare, login, state, settled } from './freeplay-helpers.mjs';
import { buildShape } from '../../src/freeplay/build-shapes.js';
import { freeplayFixtureOptions } from '../../scripts/playtest-options.mjs';
import { FREEPLAY } from '../../src/freeplay/config.js';

async function joinFixtureOpponent(page) {
  const fixture = freeplayFixtureOptions();
  const response = await page.request.post(fixture.origin + '/auth/freeplay-claim', { data: { name: 'James', code: 'james-test-only' } });
  const auth = await response.json(); expect(auth.ok).toBe(true);
  const url = new URL('/freeplay/ws', fixture.origin); url.protocol = 'ws:';
  for (const [key, value] of Object.entries({ room: FREEPLAY.room, pid: 'a' + auth.acct, name: auth.name, token: auth.token })) url.searchParams.set(key, value);
  const peer = { socket: new WebSocket(url), epoch: 0, ready: false, battle: null, errors: [], events: [] };
  peer.socket.onopen = () => peer.socket.send(JSON.stringify({ type: 'hello', protocol: FREEPLAY.protocol, contentVersion: FREEPLAY.contentVersion }));
  peer.socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.type === 'init') peer.epoch = message.epoch;
    if (message.type === 'ready') peer.ready = true;
    if (message.type === 'battle-state') peer.battle = message.battle;
    if (message.type === 'battle-event') peer.events.push(message.event);
    if (message.type === 'error') peer.errors.push(message.code || 'error');
  };
  peer.socket.onerror = () => peer.errors.push('socket');
  peer.send = (type, fields = {}) => peer.socket.send(JSON.stringify({ type, epoch: peer.epoch, ...fields }));
  return peer;
}

test('battlefield: two-team flag bases, recruit, shared shots, shield, bunker and leave', async ({ page }, testInfo) => {
  test.setTimeout(240000);
  await page.setViewportSize({ width: 800, height: 600 });
  const errors = await prepare(page);
  // Observe real server events only: no battle state or command is supplied by this hook.
  await page.addInitScript(() => {
    window.battleEvents = [];
    const Socket = window.WebSocket;
    window.WebSocket = class extends Socket {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', event => {
          const value = JSON.parse(event.data);
          if (value.type === 'battle-event') {
            window.battleEvents.push(value.event);
            if (window.battleEvents.length > 64) window.battleEvents.shift();
          }
        });
      }
    };
  });
  let james;
  try {
  await login(page, 'Henry');
  const before = await state(page);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Battlefield / armies', exact: true }).click();
  await page.getByRole('button', { name: 'Join Blue army', exact: true }).click();
  await expect.poll(async () => (await state(page)).battlePlayer?.team, { timeout: 20000 }).toBe('blue');
  await expect(page.getByRole('button', { name: 'Army', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).not.toBeVisible();
  const joined = await state(page), camp = joined.battle.camps.blue;
  expect(joined.player.flying).toBe(false);
  expect(Math.hypot(joined.player.x - camp[0], joined.player.z - camp[2])).toBeLessThan(3);
  await expect.poll(() => page.evaluate(([x,,z]) => window.moorsteadTest.rendered(x, z), camp), { timeout: 45000 }).toBe(true);

  await page.getByRole('button', { name: 'Bombs', exact: true }).click();
  await expect(page.getByRole('button', { name: /Mega bomb · ∞/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Atom bomb · ∞/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Grenade · ∞/ })).toBeVisible();
  await page.getByRole('button', { name: 'Back to play', exact: true }).click();
  await page.getByRole('button', { name: 'Army', exact: true }).click();
  await page.getByRole('button', { name: 'Set home base here', exact: true }).click();
  await expect.poll(async () => (await state(page)).battle.ctf.bases.blue).not.toBeNull();
  expect((await state(page)).battle.ctf.phase).toBe('setup');
  james = await joinFixtureOpponent(page);
  await expect.poll(() => james.ready, { timeout: 15000 }).toBe(true);
  james.send('battle-join', { team: 'red' });
  await expect.poll(() => james.battle?.players.some(row => row.team === 'red')).toBe(true);
  await page.waitForTimeout(100); // Respect the adapter's per-account 80ms command gate.
  james.send('battle-base');
  await expect.poll(async () => (await state(page)).battle.ctf.phase).toBe('active');
  await expect.poll(() => james.battle?.ctf.phase).toBe('active');
  const bases = (await state(page)).battle.ctf.bases;
  expect(Math.hypot(bases.blue[0] - bases.red[0], bases.blue[2] - bases.red[2])).toBeGreaterThanOrEqual(32);
  expect((await state(page)).battle.ctf.flags.blue.status).toBe('home');
  expect((await state(page)).battle.ctf.flags.red.status).toBe('home');

  await page.getByRole('button', { name: 'Army', exact: true }).click();
  await page.getByRole('button', { name: 'Recruit 6 soldiers', exact: true }).click();
  await expect.poll(async () => (await state(page)).battle.soldiers.length).toBe(6);
  for (const [label, order] of [['Hold this position', 'hold'], ['Attack the enemy', 'attack'], ['Follow me', 'follow']]) {
    await page.getByRole('button', { name: 'Army', exact: true }).click();
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect.poll(async () => (await state(page)).battle.soldiers.every(row => row.order === order)).toBe(true);
  }

  await page.getByRole('button', { name: 'Weapons', exact: true }).click();
  await page.getByRole('button', { name: /Machine gun · ∞/ }).click();
  const position = (await state(page)).player;
  await page.evaluate(p => window.moorsteadTest.prepareView(p.x, p.y, p.z, 0, .8), position);
  await expect.poll(() => page.evaluate(() => window.moorsteadTest.target())).toBeNull();
  await page.getByRole('button', { name: 'Fire', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.battleEvents.some(row => row.type === 'shot' && row.weapon === 'machinegun'))).toBe(true);
  await expect.poll(() => james.events.some(row => row.type === 'shot' && row.weapon === 'machinegun' && row.team === 'blue')).toBe(true);
  expect((await state(page)).revision).toBe(before.revision, 'sky shot is an authoritative battle event without a terrain crater');

  await page.getByRole('button', { name: 'Army', exact: true }).click();
  await page.getByRole('button', { name: 'Deploy shield dome', exact: true }).click();
  await expect.poll(async () => (await state(page)).battle.shields.length).toBe(1);
  await expect(page.locator('.fp-panel')).not.toBeVisible();
  await expect(page.locator('.fp-canvas')).toBeFocused();
  await page.keyboard.down('KeyS'); await page.waitForTimeout(1200); await page.keyboard.up('KeyS');
  const overview = (await state(page)).player;
  await page.evaluate(p => window.moorsteadTest.prepareView(p.x, p.y, p.z, 0, .2), overview);
  await page.waitForTimeout(200);
  await page.screenshot({ path: testInfo.outputPath('army-camp-shield.png') });
  const buildPosition = (await state(page)).player;
  await page.evaluate(p => window.moorsteadTest.prepareView(p.x, p.y, p.z, Math.PI, -.55), buildPosition);
  await page.getByRole('button', { name: 'Army', exact: true }).click();
  await page.getByRole('button', { name: 'Trenches and fortifications', exact: true }).click();
  await page.getByRole('button', { name: 'Bunker', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.moorsteadTest.target()), { timeout: 15000 }).not.toBeNull();
  const hit = await page.evaluate(() => window.moorsteadTest.target());
  const origin = [hit.x + hit.face[0], hit.y + hit.face[1], hit.z + hit.face[2]];
  const rows = buildShape({ shape: 'bunker', origin, rotation: 0, block: 200 });
  const startBuild = await state(page);
  await page.getByRole('button', { name: 'Place', exact: true }).click();
  await settled(page, startBuild.revision + 1);
  expect(await page.evaluate(rows => rows.every(([x,y,z,id]) => window.moorsteadTest.cell(x,y,z) === id), rows)).toBe(true);
  await expect.poll(() => page.evaluate(rows => rows.every(([x,,z]) => window.moorsteadTest.rendered(x,z)), rows), { timeout: 45000 }).toBe(true);
  await page.getByRole('button', { name: 'Weapons', exact: true }).click();
  await page.getByRole('button', { name: /Plasma blaster · ∞/ }).click();
  await page.screenshot({ path: testInfo.outputPath('battle-bunker.png') });

  await page.getByRole('button', { name: 'Army', exact: true }).click();
  await page.getByRole('button', { name: 'Leave battlefield', exact: true }).click();
  await expect.poll(async () => (await state(page)).battlePlayer).toBeNull();
  await expect(page.getByRole('button', { name: 'Army', exact: true })).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  await expect.poll(async () => (await state(page)).battle.soldiers.length).toBe(0);
  const after = await state(page);
  expect(Math.hypot(after.player.x - before.player.x, after.player.z - before.player.z)).toBeLessThan(3);
  expect(after.player.flying).toBe(true);
  await testInfo.attach('battle-state', { body: JSON.stringify({ joined, after, bunkerOrigin: origin }), contentType: 'application/json' });
  expect(errors).toEqual([]);
  expect(james.errors).toEqual([]);
  } finally {
    james?.socket.close();
  }
});
