import { test, expect } from '@playwright/test';
import { prepare, state, settled } from './freeplay-helpers.mjs';

test.use({ viewport: { width: 800, height: 1280 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });

async function tap(page, name) { await page.getByRole('button', { name, exact: true }).tap(); }
async function holdTouch(page, cdp, name, change, dragOff = false) {
  const control = page.getByRole('button', { name, exact: true });
  const box = await control.boundingBox(); expect(box).not.toBeNull();
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1, radiusX: 7, radiusY: 7, force: 1 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  try {
    if (dragOff) await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ ...point, x: point.x + 150, y: point.y - 130 }],
    });
    await expect.poll(change, { timeout: 15000 }).toBe(true);
  } finally { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
}

async function controlsReachable(page) {
  for (const name of ['Build', 'Bombs', 'Fly: on', 'Undo', 'Menu', 'Full reset', 'Move forward', 'Move left', 'Move back', 'Move right', 'Up / jump', 'Down', 'Break']) {
    const control = page.getByRole('button', { name, exact: true });
    await expect(control).toBeVisible();
    expect(await control.evaluate(element => {
      const r = element.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
      return r.width >= 44 && r.height >= 44 && r.left >= 0 && r.top >= 0
        && r.right <= innerWidth && r.bottom <= innerHeight
        && document.elementFromPoint(x, y)?.closest('button') === element;
    }), `${name} has an unobstructed reachable touch target`).toBe(true);
  }
}

test('freeplay touch: portrait entry, build, captured controls, bomb, undo, reset and landscape', async ({ page, context }, testInfo) => {
  test.setTimeout(210000);
  const errors = await prepare(page);
  const cdp = await context.newCDPSession(page);
  await page.goto('/freeplay/');
  await tap(page, 'Henry');
  await page.getByLabel('Free-play code', { exact: true }).fill('henry-test-only');
  await tap(page, 'Come on in');
  await expect.poll(async () => (await state(page))?.ready, { timeout: 45000 }).toBe(true);
  expect(await page.evaluate(() => matchMedia('(pointer:coarse)').matches)).toBe(true);
  await controlsReachable(page);

  // Preparation only: real generated ground in front of the Danby inn. Every
  // outcome below comes from the visible controls and real pointer/touch events.
  await page.evaluate(() => window.moorsteadTest.prepareView(1674, 40, 1780, 0, -.65));
  await expect.poll(async () => (await state(page)).meshes, { timeout: 45000 }).toBeGreaterThan(15);
  await expect.poll(() => page.evaluate(() => window.moorsteadTest.target())).not.toBeNull();
  await tap(page, 'Build');
  await page.getByLabel('Find a block', { exact: true }).tap();
  await page.getByLabel('Find a block', { exact: true }).fill('Dressed');
  await expect(page.locator('.fp-catalogue button')).toHaveCount(1);
  await tap(page, 'Dressed Stone');
  await expect(page.locator('.fp-selection')).toHaveText('Dressed Stone · ∞');
  const beforeBuild = await state(page);
  const target = await page.evaluate(() => window.moorsteadTest.target());
  const placedCell = [target.x + target.face[0], target.y + target.face[1], target.z + target.face[2]];
  await tap(page, 'Place');
  await settled(page, beforeBuild.revision + 1);
  expect(await page.evaluate(([x, y, z]) => window.moorsteadTest.cell(x, y, z), placedCell)).toBe(19);
  await page.screenshot({ path: testInfo.outputPath('touch-portrait-build.png') });
  const beforeBreak = await state(page), breakTarget = await page.evaluate(() => window.moorsteadTest.target());
  await tap(page, 'Break');
  await settled(page, beforeBreak.revision + 1);
  expect(await page.evaluate(({ x, y, z }) => window.moorsteadTest.cell(x, y, z), breakTarget)).toBe(0);

  await page.evaluate(() => window.moorsteadTest.prepareView(1674, 48, 1780, 0, -.65));
  let start = (await state(page)).player;
  // Moving off the button while held must still work, and off-button release
  // must stop it. This exercises the production pointer-capture handlers.
  await holdTouch(page, cdp, 'Move forward', async () => (await state(page)).player.z < start.z - 1, true);
  await page.waitForTimeout(600);
  const afterRelease = (await state(page)).player;
  await page.waitForTimeout(600);
  expect(Math.abs((await state(page)).player.z - afterRelease.z)).toBeLessThan(.25);
  start = (await state(page)).player;
  await holdTouch(page, cdp, 'Up / jump', async () => (await state(page)).player.y > start.y + 1);
  start = (await state(page)).player;
  await holdTouch(page, cdp, 'Down', async () => (await state(page)).player.y < start.y - 1);

  await page.evaluate(() => window.moorsteadTest.prepareView(1674, 40, 1780, 0, -.65));
  await expect.poll(() => page.evaluate(() => window.moorsteadTest.target())).not.toBeNull();
  const beforeLook = await page.evaluate(() => window.moorsteadTest.target());
  const point = { x: 460, y: 620, id: 2, radiusX: 7, radiusY: 7, force: 1 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, x: point.x + 90 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.evaluate(() => window.moorsteadTest.target())).not.toEqual(beforeLook);

  await tap(page, 'Bombs');
  const grenade = page.getByRole('button', { name: /Grenade · ∞/ });
  const selectedBomb = await grenade.count() ? grenade : page.getByRole('button', { name: /Atom bomb · ∞/ });
  const bombName = await selectedBomb.innerText();
  await selectedBomb.tap();
  await page.evaluate(() => window.moorsteadTest.prepareView(1674, 48, 1788, 0, -.85));
  // Preparation changes player pose; let the real frame update the aiming camera.
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect.poll(() => page.evaluate(() => window.moorsteadTest.target())).not.toBeNull();
  const beforeBomb = await state(page), bombTarget = await page.evaluate(() => window.moorsteadTest.target());
  await tap(page, 'Throw / place');
  await settled(page, beforeBomb.revision + 1);
  expect(await page.evaluate(({ x, y, z }) => window.moorsteadTest.cell(x, y, z), bombTarget)).toBe(0);
  expect((await state(page)).overrides).toBeGreaterThan(beforeBomb.overrides);
  await page.screenshot({ path: testInfo.outputPath('touch-bomb.png') });
  const afterBomb = await state(page);
  await tap(page, 'Undo');
  await settled(page, afterBomb.revision + 1);
  expect((await state(page)).overrides).toBe(beforeBomb.overrides);

  await tap(page, 'Menu');
  await tap(page, 'Reset world…');
  await tap(page, 'Approve full reset');
  await expect(page.getByRole('alert')).toContainText('Both players must be online');
  await settled(page, afterBomb.revision + 1);
  const reset = await state(page);
  expect(reset.overrides).toBe(beforeBomb.overrides); expect(reset.epoch).toBe(afterBomb.epoch);
  expect(reset.player.health).toBe(20);
  await page.setViewportSize({ width: 1280, height: 800 });
  await controlsReachable(page);
  await tap(page, 'Bombs');
  await expect(page.getByRole('heading', { name: 'The bomb cupboard' })).toBeVisible();
  await tap(page, 'Back to play');
  await page.screenshot({ path: testInfo.outputPath('touch-landscape.png') });
  await testInfo.attach('touch-state', { body: JSON.stringify({ device: '800×1280 / 1280×800 emulated touch; software WebGL', bombName, reset }), contentType: 'application/json' });
  expect(errors).toEqual([]);
  await cdp.detach();
});
