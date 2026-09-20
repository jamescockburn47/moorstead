import assert from 'node:assert/strict';
import { FreeplayConnection } from '../src/freeplay/connection.js';
import { FREEPLAY } from '../src/freeplay/config.js';
import { selectVehicleCells, parkedCells, validVehicle } from '../src/freeplay/vehicle-data.js';
import { OverrideStore } from '../src/freeplay/terrain-overrides.js';
import { FreeplayVehicles } from '../src/freeplay/vehicles.js';

const v={id:'vehicle-test',mode:'plane',core:[0,1,0],cells:[[0,0,0,200],[1,0,0,201],[0,1,0,206]],pose:{x:10,y:20,z:30,yaw:0},pilot:null};
assert(validVehicle(v));assert(!validVehicle({...v,cells:[...v.cells,v.cells[0]]}));
assert(!validVehicle({...v,core:[9,9,9]}));assert(!validVehicle({...v,pose:{...v.pose,x:Infinity}}));
const world={overrides:new OverrideStore(),isLoaded:()=>true};
for(const row of [[10,20,30,200],[11,20,30,201],[10,21,30,206],[11,21,30,0]])world.overrides.setCell(...row);
const selected=selectVehicleCells(world,[10,20,30],[11,21,30],[10,21,30]);
assert.equal(selected.cells.length,3,'AIR and procedural cells are not carried');
assert.throws(()=>selectVehicleCells(world,[10,20,30],[40,21,30],[10,21,30]),/16/);
assert.deepEqual(parkedCells({...v,pose:{x:-2.5,y:21.5,z:1.5,yaw:Math.PI/2}}),[[-2,22,2,200],[-2,22,3,201],[-2,23,2,206]]);
const published=[],events=[];
const net=new FreeplayConnection({acct:'fixture',name:'Henry',token:'test-fixture-token',room:FREEPLAY.room},
  {state(){},error(){},transaction:m=>published.push(m),vehicle:m=>events.push(m)});
const init={type:'init',protocol:1,contentVersion:7,minContentVersion:7,freeplay:true,room:FREEPLAY.room,seed:FREEPLAY.seed,
  epoch:1,revision:0,history:[],players:[],count:0,vehicleCount:1};
net.receive(init);assert.throws(()=>net.receive({type:'ready',epoch:1,revision:0}),/Incomplete vehicles/);
net.receive({type:'vehicle-snapshot',vehicle:v});assert.equal(published.length,0);
net.receive({type:'ready',epoch:1,revision:0});assert.equal(published[0].vehicles.get(v.id),v);
net.receive({type:'begin',epoch:1,revision:1,count:0,kind:'vehicle-edit'});
net.receive({type:'vehicle-delta',epoch:1,revision:1,vehicleId:v.id,vehicle:null});
assert.equal(published.length,1,'removal waits for atomic commit');
net.receive({type:'commit',epoch:1,revision:1,history:[]});assert.equal(published[1].vehicles.get(v.id),null);
net.pending='other-world-command';net.receive({type:'error',command:'vehicle-drive',vehicleId:v.id,message:'stale lease'});
assert.equal(net.pending,'other-world-command','drive rejection cannot acknowledge a terrain save');
net.receive({type:'vehicle-pos',epoch:0,vehicleId:v.id,seq:1,pose:v.pose});assert.equal(events.length,1);
net.receive({type:'vehicle-pos',epoch:1,vehicleId:v.id,seq:2,pose:v.pose});assert.equal(events.length,2);
assert.equal(net.revision,1,'drive updates never stale terrain editing');

const ctl=Object.create(FreeplayVehicles.prototype),sent=[];
Object.assign(ctl,{driving:v.id,lease:'fixture-lease',seq:0,vehicles:new Map([[v.id,{...v,pilot:'afixture'}]]),events:new Map(),pid:'afixture',
  game:{transactions:[],connection:{vehicle:()=>false},ui:{panel:{close(){}}},player:{pos:{},vel:{}}}});
ctl.park();assert.equal(ctl.driving,v.id,'a busy transfer cannot leave the server lease orphaned');assert.equal(ctl.releaseSent,false);
ctl.game.connection.vehicle=(type,fields)=>{sent.push({type,...fields});return true;};ctl.park();
assert.equal(ctl.driving,v.id,'wait for release acknowledgement');assert(sent.at(-1).pose);
ctl.event({type:'vehicle-lease',vehicleId:v.id,pilot:null,pose:{...v.pose,x:19},lease:null});
assert.equal(ctl.driving,null);assert.equal(ctl.vehicles.get(v.id).pose.x,19,'release applies server final position');
net.pending='failed-convert';net.receive({type:'error',command:'vehicle-convert',message:'too many cores'});
assert.equal(net.pending,null,'a refused conversion must leave building available');
let reconnects=0;ctl.driving=v.id;ctl.game.connection.reconnect=()=>reconnects++;
ctl.cancelSelection=()=>{};ctl.event({type:'vehicle-error',command:'vehicle-release',vehicleId:v.id,code:'vehicle-lease'});
assert.equal(reconnects,1);assert.equal(ctl.driving,null,'an invalid lease resyncs once instead of retrying release forever');
assert.equal(FREEPLAY.maxCells,8000000);
console.log('PASS vehicle integration: exact selection/parking, atomic body transfers, drive isolation, stale epochs, confirmed lease release');
