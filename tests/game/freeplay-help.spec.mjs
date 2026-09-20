import { test, expect } from '@playwright/test';
import { prepare, login, state } from './freeplay-helpers.mjs';
import { PLAY_GUIDE } from '../../src/freeplay/help-content.js';

test('guide: current rules, every chapter, keyboard navigation and tablet layout', async ({ page }, info) => {
  const errors = await prepare(page);
  await login(page, 'Henry');
  const before = await state(page);
  await page.getByRole('button', { name: 'Guide', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'How to play', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Previous topic' })).toBeDisabled();
  const picker = page.getByLabel('Choose a topic');
  for (const section of PLAY_GUIDE) {
    await picker.selectOption(section.id);
    await expect(page.getByRole('heading', { name: section.title, exact: true })).toBeFocused();
    await expect(page.locator('.fp-guide-section ol li')).toHaveCount(section.steps.length);
    await expect(page.locator('.fp-guide-section ul li')).toHaveCount(section.facts.length);
  }
  await expect(page.getByRole('button', { name: 'Next topic' })).toBeDisabled();
  await picker.selectOption('capture');
  await expect(page.getByText(/There is no flag pickup or return trip/)).toBeVisible();
  await page.getByRole('button', { name: 'Next topic' }).focus();
  await page.keyboard.press('Enter');
  await expect(picker).toHaveValue('equipment');
  await page.getByRole('button', { name: 'Previous topic' }).click();
  await expect(picker).toHaveValue('capture');
  for (const [width, height] of [[1024, 768], [800, 600], [360, 800], [640, 360]]) {
    await page.setViewportSize({ width, height });
    await picker.selectOption('squads');
    await expect.poll(() => page.locator('.fp-panel').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.locator('.fp-panel').evaluate(el => { el.scrollTop = 0; });
    await expect(picker).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`guide-${width}x${height}.png`) });
    await page.getByRole('button', { name: 'Back to play', exact: true }).click();
    await expect(page.locator('.fp-panel')).not.toBeVisible();
    await page.getByRole('button', { name: 'Guide', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Back to play', exact: true }).click();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'How to play', exact: true }).click();
  await expect(picker).toHaveValue('start');
  await page.getByRole('button', { name: 'Back to play', exact: true }).click();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Battlefield / armies', exact: true }).click();
  await page.getByRole('button', { name: 'Battle guide', exact: true }).click();
  await expect(picker).toHaveValue('battle');
  await page.keyboard.press('Escape');
  await expect(page.locator('.fp-panel')).not.toBeVisible();
  await expect.poll(async () => (await state(page)).paused).toBe(false);
  expect((await state(page)).revision).toBe(before.revision);
  expect(errors).toEqual([]);
});
