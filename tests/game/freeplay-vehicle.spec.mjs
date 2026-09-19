import { test, expect } from '@playwright/test';
import { prepare, login, state, settled } from './freeplay-helpers.mjs';
import { parkedCells } from '../../src/freeplay/vehicle-data.js';

const vehicles = async page => (await state(page)).vehicles;
async function aimAt(page, [x, y, z]) {
  await page.evaluate(([x, y, z]) => window.moorsteadTest.prepareView(x + .5, y + 5, z + 3.5, 0, -Math.atan2(6.12, 3)), [x, y, z]);
  await expect.poll(() => page.evaluate(() => {
    const h = window.moorsteadTest.target(); return h && [h.x, h.y, h.z];
  }), { timeout: 15000 }).toEqual([x, y, z]);
}
async function vehicleMenu(page) {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Our vehicles', exact: true }).click();
}
async function signOut(page) {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Come on in', exact: true })).toBeVisible();
}

test('freeplay vehicle: real build, flight, parking, account handoff, edit and undo preserve its blocks', async ({ page }, testInfo) => {
  test.setTimeout(240000);
  await page.setViewportSize({ width: 640, height: 480 });
  const errors = await prepare(page);
    // One active WebGL world: concurrent lease/broadcast behavior has service tests.
    await login(page, 'Henry');
    const initial = await state(page);
    await page.getByRole('button', { name: 'Build', exact: true }).click();
    await page.getByRole('button', { name: 'Line', exact: true }).click();
    await page.getByLabel('Brush size', { exact: true }).selectOption('3');
    await page.getByRole('button', { name: 'Alloy plating', exact: true }).click();
    await page.evaluate(() => window.moorsteadTest.prepareView(1674, 50, 1780, 0, -.9));
    await expect.poll(() => page.evaluate(() => window.moorsteadTest.target()), { timeout: 15000 }).not.toBeNull();
    const hit = await page.evaluate(() => window.moorsteadTest.target());
    const origin = [hit.x + hit.face[0], hit.y + hit.face[1], hit.z + hit.face[2]];
    const rows = [0, 1, 2].map(x => [origin[0] + x, origin[1], origin[2], 200]);
    await page.getByRole('button', { name: 'Place', exact: true }).click();
    await settled(page, initial.revision + 1);
    await page.getByRole('button', { name: 'Build', exact: true }).click();
    await page.getByRole('button', { name: 'Vehicle control', exact: true }).click();
    await aimAt(page, origin);
    await page.getByRole('button', { name: 'Place', exact: true }).click();
    await settled(page, initial.revision + 2);
    const core = [origin[0], origin[1] + 1, origin[2]]; rows.push([...core, 206]);
    expect(await page.evaluate(rows => rows.every(([x, y, z, id]) => window.moorsteadTest.cell(x, y, z) === id), rows)).toBe(true);

    await aimAt(page, core);
    await page.getByRole('button', { name: 'Use core', exact: true }).click();
    await page.getByRole('button', { name: 'Back to play', exact: true }).click();
    await aimAt(page, rows[2].slice(0, 3));
    await page.getByRole('button', { name: 'Mark corner', exact: true }).click();
    await aimAt(page, core);
    await page.getByRole('button', { name: 'Mark corner', exact: true }).click();
    await expect(page.getByText('4 blocks selected. Choose how it moves.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Make plane', exact: true }).click();
    await settled(page, initial.revision + 3);
    const original = (await vehicles(page))[0]; expect(original.cells).toHaveLength(4);
    expect(original.cells.filter(row => row[3] === 206)).toHaveLength(1);
    expect(await page.evaluate(rows => rows.every(([x, y, z]) => window.moorsteadTest.cell(x, y, z) === 0), rows)).toBe(true);

    await vehicleMenu(page); await page.getByRole('button', { name: 'Enter plane', exact: true }).click();
    await expect.poll(async () => (await state(page)).driving).toBe(original.id);
    // The native dialog close event unpauses input and then returns canvas focus.
    // Lease receipt happens first, so driving alone does not establish readiness.
    await expect(page.locator('.fp-panel')).not.toBeVisible();
    await expect(page.locator('.fp-canvas')).toBeFocused();
    await expect.poll(async () => (await state(page)).paused).toBe(false);
    await page.keyboard.down('Space'); await page.waitForTimeout(1000); await page.keyboard.up('Space');
    await expect.poll(async () => (await vehicles(page))[0].pose.y, { timeout: 20000 }).toBeGreaterThan(original.pose.y + 3);
    await page.keyboard.down('KeyW'); await page.waitForTimeout(1000); await page.keyboard.up('KeyW');
    await expect.poll(async () => (await vehicles(page))[0].pose.z, { timeout: 20000 }).toBeLessThan(original.pose.z - 4);
    await page.locator('.fp-vehicle-drive').getByRole('button', { name: 'Park', exact: true }).click();
    await expect.poll(async () => (await state(page)).driving, { timeout: 30000 }).toBeNull();
    await expect.poll(async () => (await vehicles(page))[0].pilot, { timeout: 30000 }).toBeNull();
    const parked = (await vehicles(page))[0]; expect(parked.cells).toEqual(original.cells);

    await signOut(page); await login(page, 'James');
    await settled(page, initial.revision + 3);
    expect((await vehicles(page))[0].cells).toEqual(original.cells);
    expect((await vehicles(page))[0].pose).toEqual(parked.pose);
    await vehicleMenu(page); await page.getByRole('button', { name: 'Enter plane', exact: true }).click();
    await expect.poll(async () => (await state(page)).driving).toBe(original.id);
    await page.locator('.fp-vehicle-drive').getByRole('button', { name: 'Park', exact: true }).click();
    await expect.poll(async () => (await state(page)).driving, { timeout: 30000 }).toBeNull();
    await expect.poll(async () => (await vehicles(page))[0].pilot, { timeout: 30000 }).toBeNull();
    const finalVehicle = (await vehicles(page))[0], materialised = parkedCells(finalVehicle);
    await expect.poll(() => page.evaluate(rows => rows.every(([x,,z]) => window.moorsteadTest.rendered(x, z)), materialised), { timeout: 45000 }).toBe(true);
    await vehicleMenu(page); await page.getByRole('button', { name: 'Edit build', exact: true }).click();
    await settled(page, initial.revision + 4);
    expect(await vehicles(page)).toEqual([]);
    expect(await page.evaluate(rows => rows.every(([x, y, z, id]) => window.moorsteadTest.cell(x, y, z) === id), materialised)).toBe(true);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await settled(page, initial.revision + 5);
    const assertRestored = async p => {
      const restored = (await vehicles(p))[0];
      expect(restored.id).toBe(original.id); expect(restored.cells).toEqual(original.cells); expect(restored.pose).toEqual(finalVehicle.pose);
      expect(await p.evaluate(rows => rows.every(([x, y, z]) => window.moorsteadTest.cell(x, y, z) === 0), materialised)).toBe(true);
    };
    await assertRestored(page);
    await signOut(page); await login(page, 'Henry'); await settled(page, initial.revision + 5);
    await page.evaluate(p => window.moorsteadTest.prepareView(p.x + .5, p.y + 5, p.z + 5, 0, -.8), finalVehicle.pose);
    await expect.poll(() => page.evaluate(rows => rows.every(([x,,z]) => window.moorsteadTest.rendered(x, z)), materialised), { timeout: 45000 }).toBe(true);
    await assertRestored(page);
    await testInfo.attach('vehicle-state', { body: JSON.stringify({ original, parked, restored: (await vehicles(page))[0] }), contentType: 'application/json' });
    await page.screenshot({ path: testInfo.outputPath('restored-plane.png') });
    expect(errors).toEqual([]);
});
