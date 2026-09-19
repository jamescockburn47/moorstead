import assert from 'node:assert/strict';
import { OverrideStore } from '../src/freeplay/terrain-overrides.js';
import { connectedVehicleCells } from '../src/freeplay/vehicle-selection.js';
import { FreeplayVehicles } from '../src/freeplay/vehicles.js';

const makeWorld = rows => {
  const overrides = new OverrideStore(); for (const row of rows) overrides.setCell(...row);
  return { overrides, isLoaded: () => true, getBlock: () => { throw Error('Procedural terrain must not be searched.'); } };
};
const rows = [[0,10,0,206],[1,10,0,200],[2,10,0,200],[2,11,0,201]];
const world = makeWorld([...rows,[9,10,0,202],[1,11,0,0]]);
assert.deepEqual(connectedVehicleCells(world,[0,10,0]).cells, rows);
assert.equal(world.overrides.size, 6, 'selection is read-only and never absorbs nearby disconnected builds');
assert.throws(() => connectedVehicleCells(world,[9,10,0]), /control/);
const ring=[];
for(let x=0;x<5;x++)for(let z=0;z<5;z++)if(x===0||x===4||z===0||z===4)ring.push([x,10,z,x===0&&z===0?206:200]);
const enclosed = makeWorld([...ring,[2,10,2,202]]);
assert.throws(() => connectedVehicleCells(enclosed,[0,10,0]), /Separate blocks/, 'bounding-box conversion must never silently include a separate object');
const extraCore = makeWorld([...rows,[3,10,0,206]]);
assert.throws(() => connectedVehicleCells(extraCore,[0,10,0]), /exactly one/);
const long = makeWorld(Array.from({length:17},(_,x)=>[x,10,0,x?200:206]));
assert.throws(() => connectedVehicleCells(long,[0,10,0]), /too large/);
const large=[];for(let x=0;x<9;x++)for(let z=0;z<9;z++)for(let y=10;y<17;y++)large.push([x,y,z,x===0&&y===10&&z===0?206:200]);
assert.throws(() => connectedVehicleCells(makeWorld(large),[0,10,0]), /512/);
const unloaded=makeWorld(rows);unloaded.isLoaded=()=>false;
assert.throws(() => connectedVehicleCells(unloaded,[0,10,0]), /load/);

const ctl=Object.create(FreeplayVehicles.prototype), commands=[], notices=[];
ctl.renderer={setSelection(){}};
ctl.game={world,connection:{pending:null},ui:{open(){},message:value=>notices.push(value),panel:{close(){}}},
  send:(type,fields)=>{commands.push({type,fields});ctl.game.connection.pending='accepted-request';return true;}};
ctl.selectCore([0,10,0],'plane');assert.equal(ctl.selection.cells.length,4);assert.equal(ctl.selection.error,undefined);
world.overrides.setCell(3,10,0,200);
ctl.convert('plane');assert.equal(commands.length,0,'a changed connected build requires a fresh preview approval');
assert.equal(ctl.selection.cells.length,5);assert.match(notices.at(-1),/changed/);
ctl.convert('plane');assert.equal(commands.length,1);assert.equal(commands[0].type,'vehicle-convert');
assert.equal(ctl.awaitConversion,'accepted-request');assert.equal(ctl.selection.cells.length,5,'keep the review until the authoritative conversion succeeds');
ctl.convert('plane');assert.equal(commands.length,1,'repeated clicks cannot duplicate conversion');
ctl.game.ui.selection={textContent:'Plane starter · Place to build'};ctl.idleLabel='Vehicle control · ∞';
ctl.cancelSelection();assert.equal(ctl.game.ui.selection.textContent,'Vehicle control · ∞','conversion/cancel removes starter instructions');
const vehicle={id:'drive-test',mode:'plane',pose:{x:0,y:20,z:0,yaw:0},core:[0,0,0]};
Object.assign(ctl,{clock:0,sent:0,kits:{pending:null},driving:vehicle.id,vehicles:new Map([[vehicle.id,vehicle]]),bodies:new Map(),driveLabel:'Vehicle control · ∞'});
Object.assign(ctl.game,{paused:true,transactions:[],player:{pos:{},yaw:0},input:{keys:{}},actions:{},
  ui:{...ctl.game.ui,vehicleDrive:{},tools:{},place:{}}});ctl.renderer.setPose=()=>{};
ctl.update(0);assert.match(ctl.game.ui.selection.textContent,/^Driving plane/);assert.doesNotMatch(ctl.game.ui.selection.textContent,/Place to build/);
ctl.stop();assert.equal(ctl.game.ui.selection.textContent,'Vehicle control · ∞','parking restores the normal block label');
console.log('Vehicle auto-selection: PASS (bounded authored cells, no disconnected bbox extras, one core, loaded regions, fresh preview after edits, one pending conversion).');
