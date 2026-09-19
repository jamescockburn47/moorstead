import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const css = readFileSync(new URL('../../src/freeplay/style.css', import.meta.url), 'utf8');
let script;

test.use({ hasTouch: true, isMobile: true });
test.beforeAll(async () => {
  const result = await build({
    stdin: { contents: "import { FreeplayUI } from './src/freeplay/ui.js'; window.FreeplayUI = FreeplayUI;", resolveDir: root },
    bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'silent',
  });
  script = result.outputFiles[0].text;
});

test('freeplay touch controls remain reachable with the three-row build actions', async ({ page }) => {
  await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="freeplay"></div>');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: script });
  await page.evaluate(() => {
    const ui = new window.FreeplayUI(document.getElementById('freeplay'), { select() {}, pause() {} });
    ui.playing('Henry');
    ui.select({ type: 'build', shape: 'base', block: 200, rotation: 0 });
  });
  const blockedButtons = () => page.locator('.fp-hud button').evaluateAll(buttons => buttons.flatMap(button => {
      const r = button.getBoundingClientRect();
      if (!r.width || !r.height) return [];
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return hit && button.contains(hit) ? [] : [{ button: button.textContent, hit: hit?.textContent, x, y }];
  }));
  for (const [width, height] of [[360, 800], [600, 960], [640, 360], [1024, 600]]) {
    await page.setViewportSize({ width, height });
    expect(await blockedButtons(), `All visible controls must receive their own tap at ${width}×${height}`).toEqual([]);
  }
  // Counterexample: the former two-row spacing must be caught by this assertion.
  await page.setViewportSize({ width: 360, height: 800 });
  await page.addStyleTag({ content: '@media(max-width:700px){.fp-bottom{bottom:136px}}' });
  expect((await blockedButtons()).length, 'Former spacing covers Fly and Undo').toBeGreaterThan(0);
});
