import { test, expect } from '@playwright/test';
import { prepare, login, state, settled } from './freeplay-helpers.mjs';
import { buildShape } from '../../src/freeplay/build-shapes.js';

test('sci-fi pack: shared brush, prefab persistence, weapon craters and harmless gravity',async({page,context},testInfo)=>{
  test.setTimeout(180000);
  const errors=await prepare(page);
  const other=await context.browser().newContext({viewport:{width:800,height:600},serviceWorkers:'block',baseURL:testInfo.project.use.baseURL});
  const james=await other.newPage(),otherErrors=await prepare(james);
  try {
    await login(page,'Henry');await login(james,'James');
    const aim=async()=>{
      for(const p of [page,james])await p.evaluate(()=>window.moorsteadTest.prepareView(1674,50,1780,0,-.9));
      await expect.poll(()=>page.evaluate(()=>window.moorsteadTest.target()),{timeout:15000}).not.toBeNull();
    };
    const rendered=async rows=>{await expect.poll(()=>page.evaluate(rows=>rows.every(([x,,z])=>window.moorsteadTest.rendered(x,z)),rows),{timeout:45000}).toBe(true);};
    const showBuild=async()=>{await page.getByRole('button',{name:'Weapons',exact:true}).click();await page.getByRole('button',{name:/Plasma blaster · ∞/}).click();};
    await page.getByRole('button',{name:'Build',exact:true}).click();
    await page.getByRole('button',{name:'Wall',exact:true}).click();
    await page.getByLabel('Brush size',{exact:true}).selectOption('5');
    await page.getByRole('button',{name:'Neon cyan',exact:true}).click();await aim();
    const target=await page.evaluate(()=>window.moorsteadTest.target());
    const origin=[target.x+target.face[0],target.y+target.face[1],target.z+target.face[2]];
    const before=await state(page),wall=buildShape({shape:'wall',origin,rotation:0,block:201,size:5});
    await page.getByRole('button',{name:'Place',exact:true}).click();
    await settled(page,before.revision+1);await settled(james,before.revision+1);
    for(const p of [page,james])expect(await p.evaluate(rows=>rows.every(([x,y,z,id])=>window.moorsteadTest.cell(x,y,z)===id),wall)).toBe(true);
    await rendered(wall);await showBuild();await page.screenshot({path:testInfo.outputPath('neon-wall.png')});
    await page.getByRole('button',{name:'Undo',exact:true}).click();await settled(page,before.revision+2);
    expect((await state(page)).overrides).toBe(before.overrides);
    await page.getByRole('button',{name:'Build',exact:true}).click();
    await page.getByRole('button',{name:'Space base',exact:true}).click();await aim();
    await page.getByRole('button',{name:'Rotate',exact:true}).click();
    const baseTarget=await page.evaluate(()=>window.moorsteadTest.target());
    const baseOrigin=[baseTarget.x+baseTarget.face[0],baseTarget.y+baseTarget.face[1],baseTarget.z+baseTarget.face[2]];
    const base=buildShape({shape:'base',origin:baseOrigin,rotation:1,block:200});
    await page.getByRole('button',{name:'Place',exact:true}).click();await settled(page,before.revision+3);await settled(james,before.revision+3);
    expect(await page.evaluate(rows=>rows.every(([x,y,z,id])=>window.moorsteadTest.cell(x,y,z)===id),base)).toBe(true);
    await rendered(base);await showBuild();await page.screenshot({path:testInfo.outputPath('space-base.png')});
    await james.reload();await james.getByRole('button',{name:'Return as James',exact:true}).click();await settled(james,before.revision+3);
    await james.evaluate(()=>window.moorsteadTest.prepareView(1674,50,1780,0,-.9));
    await expect.poll(()=>james.evaluate(rows=>rows.every(([x,y,z,id])=>window.moorsteadTest.cell(x,y,z)===id),base)).toBe(true);
    await page.getByRole('button',{name:'Undo',exact:true}).click();await settled(page,before.revision+4);
    for(const name of ['Plasma blaster','Rocket launcher','Gravity gun']){
      await page.getByRole('button',{name:'Weapons',exact:true}).click();
      await page.getByRole('button',{name:new RegExp(name+' · ∞')}).click();await aim();
      const start=await state(page),hit=await page.evaluate(()=>window.moorsteadTest.target());
      const old=await page.evaluate(([x,y,z])=>window.moorsteadTest.cell(x,y,z),[hit.x,hit.y,hit.z]);
      await page.getByRole('button',{name:'Fire',exact:true}).click();
      await settled(page,start.revision+1);await settled(james,start.revision+1);
      const after=await state(page);
      if(name==='Gravity gun'){
        expect(after.overrides).toBe(start.overrides);
        expect(await page.evaluate(([x,y,z])=>window.moorsteadTest.cell(x,y,z),[hit.x,hit.y,hit.z])).toBe(old);
      }else{
        expect(old).not.toBe(0);
        for(const p of [page,james])expect(await p.evaluate(([x,y,z])=>window.moorsteadTest.cell(x,y,z),[hit.x,hit.y,hit.z])).toBe(0);
        expect(after.overrides).toBeGreaterThan(start.overrides);
      }
      await page.screenshot({path:testInfo.outputPath(name.replaceAll(' ','-')+'.png')});
      if(name!=='Gravity gun'){
        await page.getByRole('button',{name:'Undo',exact:true}).click();await settled(page,start.revision+2);
        expect((await state(page)).overrides).toBe(start.overrides);
      }
    }
    await page.setViewportSize({width:600,height:800});
    await page.getByRole('button',{name:'Build',exact:true}).click();
    await page.screenshot({path:testInfo.outputPath('tablet-build-cupboard.png')});
    expect(errors).toEqual([]);expect(otherErrors).toEqual([]);
  } finally {await other.close();}
});
