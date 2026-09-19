import assert from 'node:assert/strict';
import { VEHICLE_KITS, placeVehicleKit } from '../src/freeplay/vehicle-kits.js';
import { connectedVehicleCells } from '../src/freeplay/vehicle-selection.js';
import { VehicleKitPlacement } from '../src/freeplay/vehicle-kit-placement.js';
import { OverrideStore } from '../src/freeplay/terrain-overrides.js';
import { FreeplayActions } from '../src/freeplay/actions.js';
import { B } from '../src/defs.js';

const aiming={game:{player:{pos:{x:.5,y:12,z:.5},eye:1.6},
  camera:{getWorldDirection:d=>Object.assign(d,{x:0,y:-1,z:0})},
  world:{isLoaded:()=>true,getBlock:(x,y,z)=>y===10?B.HEATHER:y<=9?B.GRASS:B.AIR},
  vehicles:{selection:{kit:'plane'}}},direction:{},selected:{type:'block',id:206}};
assert.equal(FreeplayActions.prototype.target.call(aiming).y,9,'starter placement reaches solid ground beneath ordinary heather');
aiming.game.vehicles.selection=null;
assert.equal(FreeplayActions.prototype.target.call(aiming).y,10,'ordinary building still targets plants for editing');

const world={overrides:new OverrideStore(),isLoaded:()=>true,getBlock:(x,y,z)=>y<10?3:0};
const hit={x:10,y:9,z:10,face:[0,1,0]},player={x:30,y:10,z:30};
for(const kit of VEHICLE_KITS){
  assert.ok(kit.cells.length<=64&&kit.cells.length>20,'each complete starter fits one atomic edit');
  assert.equal(kit.cells.filter(row=>row[3]===206).length,1);
  const placement=placeVehicleKit(kit,hit,world,player);
  assert.equal(placement.rows.length,kit.cells.length);assert.equal(world.overrides.size,0,'planning never writes terrain');
  const authored=new OverrideStore();for(const row of placement.rows)authored.setCell(...row);
  const selection=connectedVehicleCells({...world,overrides:authored},placement.core);
  assert.equal(selection.cells.length,kit.cells.length,'every starter block is connected to its one control');
  assert.deepEqual(selection.from,placement.from);assert.deepEqual(selection.to,placement.to);
  const [x,y,z]=placement.rows[0];world.overrides.setCell(x,y,z,202);
  assert.throws(()=>placeVehicleKit(kit,hit,world,player),/placed blocks/,'an occupied kit cell never gets overwritten');world.overrides.clear();
  assert.throws(()=>placeVehicleKit(kit,{...hit,y:62},world,player),/whole starter/);
}
const plane=VEHICLE_KITS.find(kit=>kit.id==='plane'),tank=VEHICLE_KITS.find(kit=>kit.id==='tank');
assert.equal(tank.mode,'car');assert.match(tank.description,/decorative.*no firing cannon/);
assert.equal(plane.mode,'plane');assert.equal(VEHICLE_KITS.find(kit=>kit.id==='submarine').mode,'submarine');
assert.throws(()=>placeVehicleKit(plane,{...hit,face:[0,0,1]},world,player),/top/);
assert.throws(()=>placeVehicleKit(plane,hit,{...world,isLoaded:()=>false},player),/load/);
const raised=placeVehicleKit(plane,hit,{...world,getBlock:(x,y,z)=>y<11?3:0},player);assert.equal(raised.from[1],11,'uneven natural ground lifts the starter safely');
assert.throws(()=>placeVehicleKit(plane,hit,world,{x:10.5,y:11,z:10.5}),/Step back/);

const sent=[],selected=[],controller={renderer:{setSelection(){}},cancelSelection(){this.selection=null;},selectCore:(core,mode)=>selected.push({core,mode})};
controller.game={world,player:{pos:player},connection:{pending:null},canEdit:()=>true,ui:{select(){},message(){}},
  send:(type,value)=>{sent.push({type,...value});controller.game.connection.pending='kit-request';return true;}};
const placement=new VehicleKitPlacement(controller);placement.start('plane');assert.equal(controller.selection.kit,'plane');
placement.place(hit);placement.place(hit);assert.equal(sent.length,1);assert.equal(sent[0].type,'edit');assert.equal(sent[0].edits.length,plane.cells.length);
placement.committed({requestId:'someone-else'});assert.equal(selected.length,0,'another player commit cannot advance this kit');
placement.committed({requestId:'kit-request'});assert.equal(selected.length,1);assert.equal(selected[0].mode,'plane');assert.equal(placement.pending,null);
console.log('Vehicle starter kits: PASS (four distinct connected bodies, one core, ≤64-cell atomic placement, no overwrite, safe bounds/loading, acknowledged conversion handoff).');
