import { test, expect } from '@playwright/test';
import { prepare, login, state, settled } from './freeplay-helpers.mjs';

test('freeplay: two real entries build, atom crater, reconnect, undo, reset and restore',async({page,context},testInfo)=>{
  test.setTimeout(180000);
  const errors=await prepare(page);
  const other=await context.browser().newContext({viewport:{width:960,height:600},serviceWorkers:'block',baseURL:testInfo.project.use.baseURL});
  const james=await other.newPage();const otherErrors=await prepare(james);
  try{
    await login(page,'Henry');await login(james,'James');
    // Explicit view preparation only: actual generated Danby inn; no edits or outcomes injected.
    for(const p of [page,james])await p.evaluate(()=>window.moorsteadTest.prepareView(1674,40,1780,0,-.65));
    await expect.poll(async()=> (await state(page)).meshes,{timeout:45000}).toBeGreaterThan(15);
    await expect.poll(()=>page.evaluate(()=>window.moorsteadTest.target()),{timeout:15000}).not.toBeNull();
    const original=await state(page),target=await page.evaluate(()=>window.moorsteadTest.target());
    await page.screenshot({path:testInfo.outputPath('before.png')});
    await page.getByRole('button',{name:'Place',exact:true}).click();
    await settled(page,original.revision+1);await settled(james,original.revision+1);
    const built=await state(page);expect(built.overrides).toBeGreaterThan(original.overrides);
    await page.getByRole('button',{name:'Bombs',exact:true}).click();
    await page.getByRole('button',{name:/Atom bomb · ∞/}).click();
    for(const p of [page,james])await p.evaluate(()=>window.moorsteadTest.prepareView(1674,58,1801,0,-.63));
    await expect.poll(()=>page.evaluate(()=>window.moorsteadTest.target()),{timeout:15000}).not.toBeNull();
    const bombTarget=await page.evaluate(()=>window.moorsteadTest.target());expect(bombTarget).not.toBeNull();
    await page.getByRole('button',{name:'Throw / place',exact:true}).click();
    await settled(page,built.revision+1);await settled(james,built.revision+1);
    const blasted=await state(page),peer=await state(james);
    expect(blasted.overrides).toBeGreaterThan(100000);expect(peer.overrides).toBe(blasted.overrides);
    const crater=[bombTarget.x,bombTarget.y,bombTarget.z];
    expect(await page.evaluate(([x,y,z])=>window.moorsteadTest.cell(x,y,z),crater)).toBe(0);
    expect(await james.evaluate(([x,y,z])=>window.moorsteadTest.cell(x,y,z),crater)).toBe(0);
    await page.screenshot({path:testInfo.outputPath('atom.png')});
    // Inspect the cloud and the lasting ground separately; a cloud alone fails.
    await page.evaluate(()=>window.moorsteadTest.prepareView(1674,58,1801,0,.15));
    await page.waitForTimeout(3000);
    await page.screenshot({path:testInfo.outputPath('mushroom.png')});
    await page.evaluate(()=>window.moorsteadTest.prepareView(1674,58,1801,0,-.85));
    await expect.poll(async()=>(await state(page)).effects.active,{timeout:35000}).toBe(0);
    await page.screenshot({path:testInfo.outputPath('crater.png')});
    // Fly from the original rim position into the actual excavated volume.
    await page.keyboard.down('KeyW');
    await expect.poll(async()=>(await state(page)).player.z,{timeout:12000}).toBeLessThan(1780);
    await page.keyboard.up('KeyW');
    await page.keyboard.down('ShiftLeft');
    await expect.poll(async()=>(await state(page)).player.y,{timeout:12000}).toBeLessThan(36);
    await page.keyboard.up('ShiftLeft');
    expect((await state(page)).player.health).toBe(20);
    await page.screenshot({path:testInfo.outputPath('inside-crater.png')});
    await testInfo.attach('atom-state',{body:JSON.stringify({target,bombTarget,before:original,after:blasted,peer}),contentType:'application/json'});
    await james.reload();await james.getByRole('button',{name:'Return as James',exact:true}).click();
    await settled(james,blasted.revision);expect((await state(james)).overrides).toBe(blasted.overrides);
    await james.getByRole('button',{name:'Undo',exact:true}).click();
    await settled(page,blasted.revision+1);await settled(james,blasted.revision+1);
    expect((await state(page)).overrides).toBe(built.overrides);
    await page.screenshot({path:testInfo.outputPath('undo.png')});
    const beforeReset=await state(page);
    await page.getByRole('button',{name:'Menu',exact:true}).click();
    await page.getByRole('button',{name:'Reset world…',exact:true}).click();
    await page.getByRole('button',{name:'Approve full reset',exact:true}).click();
    await expect(james.getByRole('button',{name:'Reset · 1/2',exact:true})).toBeVisible();
    expect((await state(page)).epoch).toBe(beforeReset.epoch);
    expect((await state(page)).overrides).toBe(beforeReset.overrides);
    await james.getByRole('button',{name:'Reset · 1/2',exact:true}).click();
    await james.getByRole('button',{name:'Approve full reset',exact:true}).click();
    await settled(page,beforeReset.revision+1);await settled(james,beforeReset.revision+1);
    expect((await state(page)).overrides).toBe(0);expect((await state(james)).epoch).toBe(beforeReset.epoch+1);
    await page.getByRole('button',{name:'Menu',exact:true}).click();
    await page.getByRole('button',{name:'Restore before last reset…',exact:true}).click();
    await page.getByRole('button',{name:'Approve restoration',exact:true}).click();
    await james.getByRole('button',{name:'Restore · 1/2',exact:true}).click();
    await james.getByRole('button',{name:'Approve restoration',exact:true}).click();
    await settled(page,beforeReset.revision+2);await settled(james,beforeReset.revision+2);
    expect((await state(page)).overrides).toBe(built.overrides);
    expect((await state(page)).player.health).toBe(20);
    expect(errors).toEqual([]);expect(otherErrors).toEqual([]);
  }finally{await other.close();}
});
