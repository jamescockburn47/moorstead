import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const css = ['style.css','help.css'].map(name=>readFileSync(new URL('../../src/freeplay/'+name, import.meta.url), 'utf8')).join('\n');
let script;

test.use({ hasTouch: true, isMobile: true });
test.beforeAll(async () => {
  const result = await build({
    stdin: { contents: "import { FreeplayUI } from './src/freeplay/ui.js'; import { FreeplayInput } from './src/freeplay/input.js'; window.FreeplayUI = FreeplayUI; window.FreeplayInput = FreeplayInput;", resolveDir: root },
    bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'silent',
  });
  script = result.outputFiles[0].text;
});

test('freeplay touch Fire hold clears on captured release, cancel, pause and lost focus', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 960 });
  await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="freeplay"></div>');
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script });
  await page.evaluate(() => {
    let input; const game = { actions: { selected: { type: 'weapon', id: 'machinegun' } },
      player: { yaw: 0, pitch: 0 }, vehicles: { driving: null }, uses: 0, unlockAudio() {},
      use() { if (!input.paused) this.uses++; } };
    const ui = new window.FreeplayUI(document.getElementById('freeplay'), {
      use: () => game.use(), select: value => { game.actions.selected = value; }, pause: value => input?.pause(value),
    });
    game.ui = ui; input = new window.FreeplayInput(game, ui.canvas, ui.root); game.input = input;
    ui.place.addEventListener('pointerdown', event => { game.pointer = event.pointerId; });
    ui.playing('Henry'); ui.select({ type: 'weapon', id: 'machinegun' }); window.inputFixture = game;
  });
  const cdp = await page.context().newCDPSession(page);
  const hold = async () => {
    const box = await page.getByRole('button', { name: 'Fire', exact: true }).boundingBox();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }] });
    // Deliver the next real pointer event so pending capture becomes active.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + box.width / 2 + 1, y: box.y + box.height / 2, id: 1 }] });
    expect(await page.evaluate(() => window.inputFixture.input.firing)).toBe(true);
    expect(await page.evaluate(() => window.inputFixture.ui.place.hasPointerCapture(window.inputFixture.pointer))).toBe(true);
  };
  const firing = () => page.evaluate(() => window.inputFixture.input.firing);
  await hold();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 20, y: 300, id: 1 }] });
  expect(await firing()).toBe(true);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); expect(await firing()).toBe(false);
  await hold(); await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); expect(await firing()).toBe(false);
  await hold(); await page.evaluate(() => window.inputFixture.ui.open('weapons')); expect(await firing()).toBe(false);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.getByRole('button', { name: 'Back to play', exact: true }).tap();
  await hold(); await page.evaluate(() => window.dispatchEvent(new Event('blur'))); expect(await firing()).toBe(false);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await hold(); await page.evaluate(() => window.inputFixture.ui.place.releasePointerCapture(window.inputFixture.pointer));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 20, y: 300, id: 1 }] });
  await expect.poll(firing).toBe(false);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const sheepBefore = await page.evaluate(() => {
    window.inputFixture.ui.select({ type: 'weapon', id: 'sheep' }); return window.inputFixture.uses;
  });
  const sheepFire = await page.getByRole('button', { name: 'Fire', exact: true }).boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sheepFire.x + sheepFire.width / 2, y: sheepFire.y + sheepFire.height / 2, id: 1 }] });
  expect(await firing()).toBe(false);
  expect(await page.evaluate(() => window.inputFixture.uses)).toBe(sheepBefore + 1);
  await page.waitForTimeout(800); // Longer than the sheep cooldown: release must not fire a second shot.
  expect(await firing()).toBe(false);
  expect(await page.evaluate(() => window.inputFixture.uses)).toBe(sheepBefore + 1);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.evaluate(() => window.inputFixture.uses)).toBe(sheepBefore + 1);
  expect(await firing()).toBe(false);
  await page.getByRole('button', { name: 'Fire', exact: true }).focus();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.inputFixture.uses)).toBe(sheepBefore + 2);
  await page.evaluate(() => window.inputFixture.input.dispose());
  await cdp.detach();
});

test('freeplay touch controls remain reachable with the three-row build actions', async ({ page }) => {
  await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="freeplay"></div>');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: script });
  await page.evaluate(() => {
    const ui = new window.FreeplayUI(document.getElementById('freeplay'), { select() {}, pause() {} });
    ui.playing('Henry');
    ui.select({ type: 'build', shape: 'base', block: 200, rotation: 0 });
    const locator = document.createElement('button'); locator.className = 'fp-locator';
    locator.innerHTML = '<span class="fp-locator-arrow">↗</span><span>James · 1,234 blocks north-east</span>';
    ui.hud.append(locator); window.layoutUI = ui;
  });
  const blockedButtons = () => page.locator('.fp-hud button').evaluateAll(buttons => buttons.flatMap(button => {
      const r = button.getBoundingClientRect();
      if (!r.width || !r.height) return [];
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return hit && button.contains(hit) ? [] : [{ button: button.textContent, hit: hit?.textContent, x, y }];
  }));
  for (const [width, height] of [[360, 800], [600, 960], [640, 360], [800, 600], [1024, 600]]) {
    await page.setViewportSize({ width, height });
    for (const mode of ['building', 'driving', 'battle']) {
      await page.evaluate(mode => {
        const ui = window.layoutUI, battle = mode === 'battle';
        ui.tools.hidden = mode === 'driving'; ui.vehicleDrive.hidden = mode !== 'driving';
        ui.army.hidden = ui.shield.hidden = !battle; ui.fly.hidden = ui.undo.hidden = battle;
        ui.shield.textContent = 'Shield 25';
        ui.selection.textContent = battle ? 'Blue army · HP 100 · Shield 100 · Machine gun' : 'Space base · ∞';
      }, mode);
      expect(await blockedButtons(), `All ${mode} controls and the locator must receive their own tap at ${width}×${height}`).toEqual([]);
    }
  }
  await page.evaluate(() => {
    const ui = window.layoutUI; ui.vehicleDrive.hidden = true; ui.tools.hidden = false;
    ui.army.hidden = ui.shield.hidden = true; ui.fly.hidden = ui.undo.hidden = false;
  });
  // Counterexample: the former two-row spacing must be caught by this assertion.
  await page.setViewportSize({ width: 360, height: 800 });
  await page.addStyleTag({ content: '@media(max-width:700px){.fp-bottom{bottom:136px}}' });
  expect((await blockedButtons()).length, 'Former spacing covers Fly and Undo').toBeGreaterThan(0);
});
