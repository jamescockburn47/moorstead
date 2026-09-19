import { test, expect } from '@playwright/test';
import { prepare, login } from './freeplay-helpers.mjs';

test('freeplay map locates both players and removes departed players',async({page,context},testInfo)=>{
  const errors=await prepare(page);
  const other=await context.browser().newContext({viewport:{width:800,height:600},serviceWorkers:'block',baseURL:testInfo.project.use.baseURL});
  const james=await other.newPage(),otherErrors=await prepare(james);
  try {
    await login(page,'Henry');await login(james,'James');
    await page.evaluate(()=>window.moorsteadTest.prepareView(1674,55,1780,0,0));
    await james.evaluate(()=>window.moorsteadTest.prepareView(1774,55,1780,0,0));
    await expect(page.locator('.fp-locator')).toContainText('James · 100 m north');
    await page.getByRole('button',{name:'Map',exact:true}).click();
    await expect(page.locator('.fp-map-roster')).toContainText('Henry (you)');
    await expect(page.locator('.fp-map-roster')).toContainText('James · 100 m north');
    await page.screenshot({path:testInfo.outputPath('map-both-players.png')});
    await james.evaluate(()=>window.moorsteadTest.prepareView(1674,65,1830,0,0));
    await expect(page.locator('.fp-map-roster')).toContainText('James · 50 m east · 10 m above');
    await page.setViewportSize({width:600,height:800});
    await page.screenshot({path:testInfo.outputPath('map-tablet.png')});
    await page.getByRole('button',{name:'Back to play',exact:true}).click();
    await page.keyboard.press('KeyM');await expect(page.locator('.fp-panel')).toBeVisible();
    await james.getByRole('button',{name:'Menu',exact:true}).click();
    await james.getByRole('button',{name:'Sign out',exact:true}).click();
    await expect(page.locator('.fp-map-roster')).toContainText('No other player');
    await expect(page.locator('.fp-map-roster')).not.toContainText('James');
    expect(errors).toEqual([]);expect(otherErrors).toEqual([]);
  } finally { await other.close(); }
});
