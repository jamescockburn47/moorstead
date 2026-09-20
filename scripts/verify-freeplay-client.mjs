import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { FreeplayConnection } from '../src/freeplay/connection.js';
import { FREEPLAY, freeplayCredentials } from '../src/freeplay/config.js';
import { claimFreeplay, storedLogin, forgetFreeplay } from '../src/freeplay/auth.js';
import { validCells, validPosition } from '../src/freeplay/protocol.js';
import { BLOCK_CATALOGUE, BOMBS, blastCells } from '../src/freeplay/catalogue.js';
import { BLOCKS, isPlaceable } from '../src/defs.js';
import { Player } from '../src/player.js';
import { World } from '../src/world.js';
import { Scene } from 'three';
import { runInNewContext } from 'node:vm';

const auth={acct:'abc123',name:'Henry',room:FREEPLAY.room,token:'synthetic-fixture-token'};
const memory=new Map([['moorcraft-auth','ordinary-login'],['moorcraft-accounts','ordinary-roster']]);
const storage={getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value),removeItem:key=>memory.delete(key)};
const fetcher=value=>async(url,request)=>{
  assert.equal(url,'/dash/auth/freeplay-claim');assert(request.signal);
  return{ok:true,json:async()=>value};
};
await assert.rejects(()=>claimFreeplay('ordinary','Henry',{storage,fetcher:fetcher({ok:true,...auth,room:'bairns'})}),/another world/);
assert.equal(memory.size,2,'wrong-world claim must not store credentials');
await assert.rejects(()=>claimFreeplay('old-server','Henry',{storage,fetcher:fetcher({ok:true,...auth})}),/another world/);
const logged=await claimFreeplay('new-test','Henry',{storage,fetcher:fetcher({ok:true,edition:'freeplay',...auth})});
assert.deepEqual(logged,auth);assert.deepEqual(storedLogin(storage),auth);
forgetFreeplay(storage);assert.equal(memory.get('moorcraft-auth'),'ordinary-login');assert.equal(memory.get('moorcraft-accounts'),'ordinary-roster');
assert.equal(storedLogin(storage),null);assert(!freeplayCredentials({...auth,room:'moor'}));

class Socket{
  constructor(){this.readyState=1;this.sent=[];this.closed=[];Socket.last=this;}
  send(text){this.sent.push(JSON.parse(text));}close(code){this.closed.push(code);}
}
const transfers=[],errors=[],states=[],positions=[],rosters=[];
const net=new FreeplayConnection(auth,{state:s=>states.push(s),error:e=>errors.push(e),transaction:t=>transfers.push(t),peer:p=>positions.push(p),peers:p=>rosters.push(p)},Socket);
try{
  net.connect();const socket=Socket.last;socket.onopen();assert.deepEqual(socket.sent[0],{type:'hello',protocol:1,contentVersion:7});
  const init={type:'init',protocol:1,contentVersion:7,minContentVersion:7,freeplay:true,room:FREEPLAY.room,seed:FREEPLAY.seed,epoch:1,revision:0,history:[],checkpoint:false,players:[],vehicleCount:0,count:1};
  assert.throws(()=>net.receive({...init,contentVersion:1}),/Wrong world/,'old content must refuse before rendering new blocks');
  net.receive(init);net.receive({type:'snapshot',edits:[[3,4,5,8]]});assert.equal(transfers.length,0,'partial snapshot not published');
  net.receive({type:'ready',epoch:1,revision:0});assert(net.connected);assert.equal(transfers[0].edits.getCell(3,4,5),8);
  const rid=net.command('edit',{edits:[[3,4,5,0]]});assert.equal(net.pending,rid);
  assert.throws(()=>net.command('reset',{confirm:true}),/Wait/);
  net.receive({type:'begin',epoch:1,revision:1,requestId:rid,kind:'edit',actor:'Henry',replace:false,count:1});
  net.receive({type:'delta',epoch:1,revision:1,edits:[[3,4,5,0]]});assert.equal(transfers.length,1,'partial operation not published');
  net.receive({type:'commit',epoch:1,revision:1,requestId:rid,history:[{kind:'edit',actor:'Henry',revision:1}],checkpoint:false});
  assert.equal(transfers[1].edits.getCell(3,4,5),0);assert.equal(net.pending,null);
  net.receive({type:'begin',epoch:2,revision:2,requestId:'reset-test',kind:'reset',actor:'James',replace:true,vehicleCount:0,count:0});
  net.receive({type:'commit',epoch:2,revision:2,requestId:'reset-test',history:[],checkpoint:true});
  assert.equal(net.epoch,2);assert(net.checkpoint);
  assert.deepEqual(rosters.at(-1),[],'reset must clear pre-reset map positions');
  const position={type:'pos',pid:'other',name:'James',x:10,y:45,z:20,yaw:0};
  net.receive({...position,epoch:1});assert.equal(positions.length,0,'old epoch must not resurrect a map marker');
  net.receive({...position,epoch:2});assert.equal(positions.length,1,'fresh positions should reach the map');
  assert.throws(()=>net.receive({type:'begin',epoch:1,revision:3,count:0,replace:false}),/sequence/);
  net.position({x:0,y:40,z:0,yaw:0});assert.equal(socket.sent.at(-1).epoch,2);
  socket.onclose({code:4004});assert.equal(states.at(-1),'replaced');assert(!net.retryTimer,'device handoff must not reconnect-loop');
}finally{net.dispose();}
const denied=new FreeplayConnection(auth,{state:()=>{},error:()=>{},transaction:()=>assert.fail('wrong world published')},Socket);
assert.throws(()=>denied.receive({type:'init',protocol:1,freeplay:true,room:'moor',seed:FREEPLAY.seed,history:[],players:[]}),/Wrong world/);
assert(!validCells([[1,0,1,0]]));assert(!validCells([[1,3,1,null]]));assert(validCells([[1,3,1,null]],true));
assert(!validCells([[NaN,3,1,0]]));assert(!validPosition({pid:'a',name:'Henry',x:0,y:10,z:0,yaw:NaN}));

const player=new Player(new World(new Scene(),FREEPLAY.seed));player.creative=true;player.god=true;
player.damage(100000,'test blast');assert.equal(player.health,20);assert(!player.dead);
assert(BLOCK_CATALOGUE.length>30);assert(BLOCK_CATALOGUE.every(row=>BLOCKS[row.id]&&isPlaceable(row.id)));
const atom=BOMBS.find(row=>row.id==='atom');const cells=[...blastCells(atom,[0,37,0])];
assert(cells.length>190000);assert(cells.some(([x,y,z])=>x===0&&z===0&&y===19));assert(cells.every(([,y])=>y>=1&&y<=63));

// Execute the actual worker template: free-play navigation must not replace the ordinary shell.
const vite=readFileSync(new URL('../vite.config.js',import.meta.url),'utf8');
const literal=vite.match(/const SW_TEMPLATE = (`[\s\S]*?`);/)[1];
const worker=runInNewContext(literal).replace('__CACHE__','test-cache').replace('__PRECACHE__','[]');
const handlers={},writes=[],reads=[];let online=true,pending;
runInNewContext(worker,{URL,location:{origin:'https://test.local'},self:{addEventListener:(name,fn)=>handlers[name]=fn},
  caches:{open:async()=>({put:async(key)=>writes.push(key)}),match:async key=>{reads.push(key);return key;}},
  fetch:async()=>{if(!online)throw Error('offline');return{ok:true,clone:()=>({})};}});
for(const path of ['/','/freeplay','/freeplay/']){
  handlers.fetch({request:{method:'GET',url:'https://test.local'+path,mode:'navigate'},respondWith:value=>{pending=value;}});await pending;
}
assert.deepEqual(writes,['/index.html','/freeplay/index.html','/freeplay/index.html']);online=false;
handlers.fetch({request:{method:'GET',url:'https://test.local/freeplay',mode:'navigate'},respondWith:value=>{pending=value;}});await pending;
assert.deepEqual(reads,['/freeplay/index.html']);

for(const file of readdirSync(new URL('../src/freeplay/',import.meta.url)).filter(name=>name.endsWith('.js'))){
  const text=readFileSync(new URL('../src/freeplay/'+file,import.meta.url),'utf8');
  assert(text.split('\n').length<=300,`${file} exceeds300 source lines`);
}
console.log('PASS freeplay client: scoped auth, transactional transfer, epochs, invulnerability, real blast shape, isolated worker cache, module bounds');
import './verify-freeplay-runtime.mjs';
import './verify-freeplay-map.mjs';
import './verify-freeplay-blocks.mjs';
import './verify-freeplay-build.mjs';
import './verify-freeplay-weapons.mjs';

await import('./verify-freeplay-vehicle-motion.mjs');
await import('./verify-freeplay-vehicle-renderer.mjs');

await import('./verify-freeplay-vehicles.mjs');
await import('./verify-freeplay-battle.mjs');
await import('./verify-freeplay-battle-renderer.mjs');
await import('./verify-freeplay-ctf-renderer.mjs');
await import('./verify-freeplay-ctf.mjs');
await import('./verify-freeplay-battle-flow.mjs');
await import('./verify-freeplay-vehicle-selection.mjs');
await import('./verify-freeplay-vehicle-kits.mjs');
await import('./verify-freeplay-reset.mjs');
await import('./verify-freeplay-help.mjs');
