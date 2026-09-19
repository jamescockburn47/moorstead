import { test, expect } from '@playwright/test';
import { prepare, state, settled } from './freeplay-helpers.mjs';
import { VEHICLE_KITS } from '../../src/freeplay/vehicle-kits.js';

test.use({ hasTouch: true, isMobile: true, viewport: { width: 800, height: 600 } });

async function hold(page, cdp, name, duration) {
  const box=await page.getByRole('button',{name,exact:true}).boundingBox();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2,id:1}]});
  await page.waitForTimeout(duration);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
}
async function clearGround(page, offset) {
  await page.evaluate(offset=>window.moorsteadTest.prepareView(1690+offset,48,1800,0,-.8),offset);
  await expect.poll(()=>page.evaluate(()=>window.moorsteadTest.rendered(1690,1800)),{timeout:30000}).toBe(true);
  const point=await page.evaluate(offset=>{
    const t=window.moorsteadTest,heights=new Map(),height=(x,z)=>{
      const key=x+','+z;if(!heights.has(key))heights.set(key,t.surface(x,z));return heights.get(key);
    };
    // Locate a real supported runway. This chooses a viewpoint, never edits terrain.
    for(let x=1680+offset;x<1710+offset;x++)for(let z=1795;z<1830;z++){
      const h=height(x,z);if(h==null||h<34||h>52)continue;let clear=true;
      for(let dx=-5;dx<=5&&clear;dx++)for(let dz=-18;dz<=5;dz++){
        const y=height(x+dx,z+dz);if(y==null||Math.abs(y-h)>1){clear=false;break;}
      }
      if(clear)return{x,y:h,z};
    }
    return null;
  },offset);
  expect(point,'A loaded natural runway is required for the driving check').not.toBeNull();
  await page.evaluate(p=>window.moorsteadTest.prepareView(p.x+.5,p.y+8,p.z+12.5,0,-Math.atan2(9.62,12)),point);
  await expect.poll(()=>page.evaluate(()=>window.moorsteadTest.target()),{timeout:15000}).not.toBeNull();
}

test('starter vehicles: touch placement, visible conversion, immediate entry and real driving',async({page},testInfo)=>{
  test.setTimeout(180000);const errors=await prepare(page);
  await page.goto('/freeplay/');
  await page.getByLabel('Thi name',{exact:true}).fill('Henry');
  await page.getByLabel('Free-play code',{exact:true}).fill('henry-test-only');
  await page.getByRole('button',{name:'Come on in',exact:true}).tap();
  await expect.poll(async()=> (await state(page))?.ready,{timeout:45000}).toBe(true);
  const cdp=await page.context().newCDPSession(page),evidence=[];
  for(const [id,offset] of [['plane',0],['car',22]]){
    const kit=VEHICLE_KITS.find(row=>row.id===id),before=await state(page);
    await page.getByRole('button',{name:'Vehicles',exact:true}).tap();
    for(const row of VEHICLE_KITS)await expect(page.getByRole('button',{name:'Starter '+row.name.toLowerCase(),exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Starter '+kit.name.toLowerCase(),exact:true}).tap();
    await expect(page.locator('.fp-panel')).not.toBeVisible();
    await clearGround(page,offset);
    await expect(page.locator('.fp-selection')).toHaveText(kit.name+' starter · '+kit.cells.length+' blocks · Place to build');
    await page.screenshot({path:testInfo.outputPath(id+'-placement.png')});
    await page.getByRole('button',{name:'Place '+kit.name.toLowerCase(),exact:true}).tap();
    await settled(page,before.revision+1);
    await expect(page.getByRole('img',{name:kit.cells.length+' selected vehicle blocks; yellow marks the control'})).toBeVisible();
    await expect(page.getByLabel('Vehicle movement',{exact:true})).toHaveValue(kit.mode);
    const convert=page.getByRole('button',{name:'Convert to '+kit.mode,exact:true}),convertBox=await convert.boundingBox();
    expect(convertBox.y+convertBox.height).toBeLessThan(600);
    await convert.tap();
    await settled(page,before.revision+2);
    const created=(await state(page)).vehicles.find(v=>!before.vehicles.some(old=>old.id===v.id));
    expect(created.cells).toHaveLength(kit.cells.length);
    const enter=page.getByRole('button',{name:'Enter '+kit.mode,exact:true});
    const box=await enter.boundingBox();expect(box.y+box.height).toBeLessThan(600);
    await page.screenshot({path:testInfo.outputPath(id+'-ready.png')});
    await enter.tap();await expect.poll(async()=> (await state(page)).driving).toBe(created.id);
    await expect(page.locator('.fp-panel')).not.toBeVisible();
    await expect.poll(async()=> (await state(page)).paused).toBe(false);
    await expect(page.locator('.fp-selection')).toContainText('Driving '+kit.mode);
    if(id==='plane')await hold(page,cdp,'Up / jump',1100);
    await hold(page,cdp,'Move forward',1200);
    const moved=(await state(page)).vehicles.find(v=>v.id===created.id);
    expect(Math.hypot(moved.pose.x-created.pose.x,moved.pose.z-created.pose.z)).toBeGreaterThan(3);
    if(id==='plane')expect(moved.pose.y-created.pose.y).toBeGreaterThan(4);
    await page.screenshot({path:testInfo.outputPath(id+'-driving.png')});
    await page.locator('.fp-vehicle-drive').getByRole('button',{name:'Park',exact:true}).tap();
    await expect.poll(async()=> (await state(page)).driving,{timeout:20000}).toBeNull();
    const parked=(await state(page)).vehicles.find(v=>v.id===created.id);
    expect(parked.cells).toEqual(created.cells);expect(parked.pilot).toBeNull();
    await expect(page.locator('.fp-selection')).not.toContainText('Place to build');
    evidence.push({kit:id,cells:created.cells.length,from:created.pose,to:parked.pose});
  }
  await testInfo.attach('starter-journey',{body:JSON.stringify(evidence),contentType:'application/json'});
  expect(errors).toEqual([]);await cdp.detach();
});
