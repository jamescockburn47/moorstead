import * as THREE from 'three';
import { B, isSolid } from '../defs.js';
import { VEHICLE_CORE, selectVehicleCells, parkedCells } from './vehicle-data.js';
import { createVehicleBody, stepVehicle, vehiclePoint } from './vehicle-motion.js';
import { VehicleRenderer } from './vehicle-renderer.js';
import { vehiclePanel } from './vehicle-ui.js';

export class FreeplayVehicles{
  constructor(game){
    this.game=game;this.vehicles=new Map();this.bodies=new Map();this.events=new Map();
    this.renderer=new VehicleRenderer(game.scene,game.atlas);this.ray=new THREE.Ray();
    this.driving=null;this.selection=null;this.seq=0;this.clock=0;this.sent=0;this.chase=false;
    this.pid='a'+game.connection.auth.acct;
  }
  panel(parent){vehiclePanel(this,parent);}
  apply(transfer){
    if(transfer.snapshot||transfer.replace){this.afterPark=null;this.stop();this.cancelSelection();this.vehicles.clear();this.bodies.clear();this.renderer.clear();}
    for(const [id,vehicle] of transfer.vehicles||[]){
      if(this.driving===id)this.stop();
      if(vehicle){this.vehicles.set(id,{...vehicle,pose:{...vehicle.pose}});this.bodies.set(id,createVehicleBody(vehicle.cells,vehicle.core));this.renderer.upsert(vehicle);}
      else{this.vehicles.delete(id);this.bodies.delete(id);this.renderer.remove(id);}
    }
    if(!this.game.transactions.length){const events=[...this.events.values()];this.events.clear();for(const m of events)if(m.epoch===transfer.epoch)this.event(m);}
  }
  event(m){
    if(m.type==='vehicle-error'){
      if(m.vehicleId===this.driving&&(m.command==='vehicle-drive'||m.command==='vehicle-release')){
        const v=this.vehicles.get(this.driving);if(v?.savedPose)v.pose={...v.savedPose};
        if(m.command==='vehicle-drive'&&!['vehicle-lease','stale','session'].includes(m.code)){
          this.parking=true;this.releaseSent=this.game.connection.vehicle('vehicle-release',{vehicleId:v.id,lease:this.lease});
        }else{this.disconnected();this.game.connection.reconnect();}
      }
      return;
    }
    const v=this.vehicles.get(m.vehicleId);
    if(!v||this.game.transactions.length||this.game.applying){
      if(this.events.size<32)this.events.set(m.type+':'+m.vehicleId,m);return;
    }
    if(m.type==='vehicle-lease'){
      v.pilot=m.pilot;
      if(m.pose){v.pose={...m.pose};v.savedPose={...m.pose};delete v.target;}
      if(m.pilot===this.pid&&m.lease){
        this.driving=v.id;this.lease=m.lease;this.seq=0;this.sent=-1;this.parking=false;this.game.actions.cancel();
        this.game.player.yaw=-v.pose.yaw;this.game.player.pitch=-.12;this.game.ui.panel.close();
        this.game.ui.message('Driving '+v.mode+' · E or Park to get out · V changes view');
      }else if(this.driving===v.id){this.stop();const after=this.afterPark;this.afterPark=null;after?.();}
    }else if(m.type==='vehicle-pos'){
      v.savedPose={...m.pose};
      if(this.driving!==v.id)v.target={...m.pose};
    }
  }
  disconnected(){this.afterPark=null;this.stop();this.events.clear();this.cancelSelection();}
  interact(hit){
    if(this.driving){this.park();return true;}
    if(this.selection){this.mark(hit);return true;}
    if(hit&&this.game.world.getBlock(hit.x,hit.y,hit.z)===VEHICLE_CORE){
      this.selection={core:[hit.x,hit.y,hit.z],first:null};this.game.ui.open('vehicles');return true;
    }
    const id=this.aimed();if(id){this.enter(id);return true;}return false;
  }
  aimed(){const g=this.game;g.camera.getWorldDirection(this.ray.direction);this.ray.origin.copy(g.camera.position);return this.renderer.pick(this.ray,14);}
  mark(hit){
    if(!hit)return this.game.ui.message('Aim at a block on the corner of your build.');
    const point=[hit.x,hit.y,hit.z],s=this.selection;
    if(!s.first){s.first=point;this.renderer.setSelection([[...point,VEHICLE_CORE]]);this.game.ui.message('First corner marked. Aim at the opposite corner and press Mark corner.');return;}
    try{Object.assign(s,selectVehicleCells(this.game.world,s.first,point,s.core));this.renderer.setSelection(s.cells);this.game.ui.open('vehicles');}
    catch(error){this.game.ui.message(error.message);}
  }
  cancelSelection(){this.selection=null;this.renderer.setSelection(null);}
  convert(mode){
    const s=this.selection;if(!s?.cells)return;
    if(this.game.send('vehicle-convert',{core:s.core,from:s.from,to:s.to,mode})){this.cancelSelection();this.game.ui.panel.close();}
  }
  enter(id){
    const g=this.game,v=this.vehicles.get(id);if(!v||!g.canEdit())return;
    if(g.battle?.me)return g.ui.message('Leave the battlefield before driving a vehicle.');
    if(v.pilot)return g.ui.message('That vehicle already has a driver.');
    if(this.driving)return g.ui.message('Park your current vehicle first.');
    g.connection.vehicle('vehicle-claim',{vehicleId:id});
  }
  park(){
    const v=this.vehicles.get(this.driving);if(!v)return;
    this.parking=true;this.releaseSent=this.game.connection.vehicle('vehicle-release',{vehicleId:v.id,lease:this.lease,seq:++this.seq,pose:v.pose});
    this.game.ui.panel.close();
  }
  stop(){
    if(this.driving){
      const v=this.vehicles.get(this.driving),g=this.game;
      if(v){const p=vehiclePoint(v.pose,v.core);g.player.pos={x:p.x,y:Math.min(179,p.y+2),z:p.z};}
      g.player.flying=true;g.player.vel={x:0,y:0,z:0};
    }
    this.driving=null;this.lease=null;this.parking=false;this.releaseSent=false;
  }
  edit(id){
    const g=this.game,v=this.vehicles.get(id);if(!v||v.pilot||!g.canEdit())return;
    const rows=parkedCells(v);
    for(const [x,y,z] of rows){
      if(y<1||y>63)return g.ui.message('Bring it below the building ceiling before editing.');
      if(!g.world.isLoaded(x,z))return g.ui.message('Go near the vehicle so its surroundings can load.');
      const block=g.world.getBlock(x,y,z);
      if(block!==B.AIR&&block!==B.WATER)return g.ui.message('Move to a clear space before turning this vehicle back into blocks.');
    }
    if(g.send('vehicle-edit',{vehicleId:id}))g.ui.panel.close();
  }
  toggleView(){this.chase=!this.chase;}
  update(dt){
    this.clock+=dt;const g=this.game;
    for(const v of this.vehicles.values()){
      if(v.id===this.driving){
        const oldYaw=v.pose.yaw,keys=g.input.keys,body=this.bodies.get(v.id);
        if(g.connection.connected&&!g.connection.stage&&!g.paused&&!this.parking&&!g.applying&&!g.transactions.length){
          const result=stepVehicle(body,v.pose,{forward:(keys.KeyW||keys.ArrowUp?1:0)-(keys.KeyS||keys.ArrowDown?1:0),turn:(keys.KeyD||keys.ArrowRight?1:0)-(keys.KeyA||keys.ArrowLeft?1:0),
            lift:(keys.Space?1:0)-(keys.ShiftLeft||keys.ShiftRight?1:0)},dt,{mode:v.mode,
            probe:(x,y,z)=>({loaded:g.world.isLoaded(x,z),solid:!!isSolid(g.world.getBlock(x,y,z)),water:g.world.getBlock(x,y,z)===B.WATER})});
          v.pose=result.pose;
          if(result.blocked&&this.clock-(this.blockedAt||-5)>2){g.ui.message(result.reason==='unloaded'?'Waiting for the moor ahead to load…':'Vehicle stopped at '+result.reason+'.');this.blockedAt=this.clock;}
        }
        const yawDelta=Math.atan2(Math.sin(v.pose.yaw-oldYaw),Math.cos(v.pose.yaw-oldYaw));g.player.yaw-=yawDelta;
        const point=vehiclePoint(v.pose,v.core);Object.assign(g.player.pos,{x:point.x,y:point.y+.55,z:point.z});
        if(this.parking){if(!this.releaseSent)this.park();}
        else if(this.clock-this.sent>=.26&&g.connection.vehicle('vehicle-drive',{vehicleId:v.id,lease:this.lease,seq:++this.seq,pose:v.pose}))this.sent=this.clock;
      }else if(v.target){
        const t=Math.min(1,dt*12);for(const key of ['x','y','z'])v.pose[key]+=(v.target[key]-v.pose[key])*t;
        v.pose.yaw+=Math.atan2(Math.sin(v.target.yaw-v.pose.yaw),Math.cos(v.target.yaw-v.pose.yaw))*t;
      }
      this.renderer.setPose(v.id,v.pose);
    }
    const ui=g.ui;
    ui.vehicleDrive.hidden=!this.driving;
    ui.tools.hidden=!!this.driving;
    if(this.driving)ui.place.textContent='Park';
    else if(this.selection)ui.place.textContent='Mark corner';
    else if(g.actions.selected.type==='block'){
      const hit=g.actions.hit;ui.place.textContent=hit&&g.world.getBlock(hit.x,hit.y,hit.z)===VEHICLE_CORE?'Use core':this.aimed()?'Enter':'Place';
    }else ui.place.textContent=g.actions.selected.type==='weapon'?'Fire':g.actions.selected.type==='bomb'?'Throw / place':'Place';
  }
  camera(){
    const v=this.vehicles.get(this.driving);if(!v||!this.chase)return;
    const p=vehiclePoint(v.pose,this.bodies.get(v.id).control),distance=Math.min(22,7+this.bodies.get(v.id).radius*.5);
    this.game.camera.position.set(p.x-Math.sin(v.pose.yaw)*distance,p.y+distance*.5,p.z+Math.cos(v.pose.yaw)*distance);
    this.game.camera.lookAt(p.x,p.y+1,p.z);
  }
  dispose(){this.renderer.dispose();this.vehicles.clear();this.bodies.clear();this.events.clear();}
}
