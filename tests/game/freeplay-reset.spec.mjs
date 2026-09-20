import { test, expect } from '@playwright/test';
import { prepare, login, state, settled } from './freeplay-helpers.mjs';

test('full reset: two visible approvals, no unilateral clear, recover saved blocks',async({page,context},info)=>{
  test.setTimeout(120000);
  const errors=await prepare(page);
  const other=await context.browser().newContext({viewport:{width:800,height:1280},hasTouch:true,
    serviceWorkers:'block',baseURL:info.project.use.baseURL});
  const james=await other.newPage(),otherErrors=await prepare(james);
  try{
    await login(page,'Henry');await login(james,'James');
    await page.evaluate(()=>window.moorsteadTest.prepareView(1674,40,1780,0,-.65));
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await expect.poll(()=>page.evaluate(()=>window.moorsteadTest.target())).not.toBeNull();
    const original=await state(page);
    await page.getByRole('button',{name:'Place',exact:true}).click();
    await settled(page,original.revision+1);await settled(james,original.revision+1);
    const built=await state(page);expect(built.overrides).toBeGreaterThan(original.overrides);
    await page.getByRole('button',{name:'Full reset',exact:true}).click();
    await expect(page.getByText(/You must BOTH be online/)).toBeVisible();
    await page.getByRole('button',{name:'Approve full reset',exact:true}).click();
    const vote=james.getByRole('button',{name:'Reset · 1/2',exact:true});
    await expect(vote).toBeVisible();
    expect((await state(page)).overrides).toBe(built.overrides);
    expect((await state(james)).epoch).toBe(built.epoch);
    expect(await vote.evaluate(el=>{
      const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.height>=44
        &&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===el;
    })).toBe(true);
    await james.screenshot({path:info.outputPath('reset-waiting-tablet.png')});
    await vote.tap();await james.getByRole('button',{name:'Approve full reset',exact:true}).tap();
    await settled(page,built.revision+1);await settled(james,built.revision+1);
    expect((await state(page)).overrides).toBe(0);
    expect((await state(james)).epoch).toBe(built.epoch+1);
    await page.getByRole('button',{name:'Menu',exact:true}).click();
    await page.getByRole('button',{name:'Restore before last reset…',exact:true}).click();
    await page.getByRole('button',{name:'Approve restoration',exact:true}).click();
    await james.getByRole('button',{name:'Restore · 1/2',exact:true}).tap();
    expect((await state(page)).overrides).toBe(0);
    await james.getByRole('button',{name:'Approve restoration',exact:true}).tap();
    await settled(page,built.revision+2);await settled(james,built.revision+2);
    expect((await state(page)).overrides).toBe(built.overrides);
    expect((await state(james)).overrides).toBe(built.overrides);
    expect(errors).toEqual([]);expect(otherErrors).toEqual([]);
  }finally{await other.close();}
});
