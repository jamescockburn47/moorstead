import { expect } from '@playwright/test';
import { freeplayFixtureOptions } from '../../scripts/playtest-options.mjs';

const fixture=freeplayFixtureOptions();
export async function prepare(page){
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/dash/auth/freeplay-claim',async route=>{
    const response=await page.request.post(fixture.origin+'/auth/freeplay-claim',{data:route.request().postDataJSON()});
    await route.fulfill({status:response.status(),contentType:'application/json',body:await response.text()});
  });
  await page.routeWebSocket('**/*',ws=>{
    const url=new URL(ws.url());
    if(url.hostname!=='moorstead.sovren.xyz'||url.pathname!=='/freeplay/ws'){ws.close();return;}
    url.protocol='ws:';url.host=new URL(fixture.origin).host;
    // Playwright 1.58 connectToServer cannot change URL. Bridge exclusively to
    // the loopback real adapter, rather than attempting the production socket.
    const upstream=new WebSocket(url.href),pending=[];
    ws.onMessage(data=>{if(upstream.readyState===WebSocket.OPEN)upstream.send(data);else pending.push(data);});
    ws.onClose(()=>upstream.close());
    upstream.onopen=()=>{for(const data of pending)upstream.send(data);pending.length=0;};
    upstream.onmessage=event=>ws.send(event.data);
    upstream.onclose=()=>ws.close();
    upstream.onerror=()=>{errors.push('Loopback fixture websocket failed');ws.close();};
  });
  await page.route('https://**/*',route=>route.abort());
  return errors;
}
export async function login(page,name){
  await page.goto('/freeplay/');
  await page.getByLabel('Thi name',{exact:true}).fill(name);
  await page.getByLabel('Free-play code',{exact:true}).fill(name.toLowerCase()+'-test-only');
  await page.getByRole('button',{name:'Come on in',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.moorsteadTest.snapshot()?.ready),{timeout:45000}).toBe(true);
}
export const state=page=>page.evaluate(()=>window.moorsteadTest.snapshot());
export async function settled(page,revision){
  await expect.poll(async()=>{const s=await state(page);return s?.revision>=revision&&!s.applying&&!s.queued;},{timeout:45000}).toBe(true);
}
