import { test, expect } from '@playwright/test';
import { prepare, login, state, settled } from './freeplay-helpers.mjs';
import { buildShape } from '../../src/freeplay/build-shapes.js';

test('battlefield: join, recruit, orders, shared shots, shield, real bunker and leave', async ({ page }, testInfo) => {
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
  expect((await state(page)).revision).toBe(before.revision, 'sky shot is an authoritative battle event without a terrain crater');

  await page.getByRole('button', { name: 'Army', exact: true }).click();
  await page.getByRole('button', { name: 'Deploy shield dome', exact: true }).click();
  await expect.poll(async () => (await state(page)).battle.shields.length).toBe(1);
  // Prepare one clear overview for visual inspection; gameplay commands above use the real camp position.
  await page.evaluate(([x,y,z]) => window.moorsteadTest.prepareView(x - 8, y + 5, z + 10, -.65, -.4), camp);
  await page.waitForTimeout(500);
  await page.screenshot({ path: testInfo.outputPath('army-camp-shield.png') });
  await page.evaluate(([x,y,z]) => window.moorsteadTest.prepareView(x, y, z, Math.PI, -.55), camp);
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
});
