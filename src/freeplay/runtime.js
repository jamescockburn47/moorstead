import * as THREE from 'three';
import { Player } from '../player.js';
import { Sky } from '../sky.js';
import { initMaterials, getMaterials, setCamPos, setWaterTime } from '../mesher.js';
import { seasonStateAtPhase } from '../season.js';
import { FreeplayWorld } from './world.js';
import { FreeplayScenery } from './scenery.js';
import { ExplosionEffects } from './effects.js';
import { FreeplayPopulation } from './population.js';
import { FreeplayInput } from './input.js';
import { FreeplayActions } from './actions.js';
import { FreeplayPeers } from './peers.js';
import { FREEPLAY } from './config.js';
import { bombById } from './catalogue.js';
import { FreeplayMap } from './map.js';
import { paintFutureAtlas } from './future-blocks.js';
import { FreeplayVehicles } from './vehicles.js';
import { FreeplayBattle } from './battle.js';

export class FreeplayGame {
  constructor(ui,connection,settings) {
    this.ui=ui;this.connection=connection;this.settings=settings;this.paused=false;this.active=true;this.ready=false;
    this.transactions=[];this.applying=null;this.resyncPending=false;this.frameTimes=[];this.elapsed=0;this.lastPos=0;this.pendingPeers=[];
    this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(75,1,.08,800);this.camera.rotation.order='YXZ';
    this.renderer=new THREE.WebGLRenderer({canvas:ui.canvas,antialias:!settings.plain,powerPreference:'high-performance'});
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.05;
    this.atlas=getMaterials()?.opaque.map||initMaterials();
    paintFutureAtlas(this.atlas);
    this.world=new FreeplayWorld(this.scene,FREEPLAY.seed);this.world.renderDist=settings.plain?4:6;
    this.player=new Player(this.world);this.player.creative=true;this.player.god=true;this.player.fatigue=0;
    this.player.name=connection.auth.name;this.player.pitch=-.22;this.home();
    this.sky=new Sky(this.scene,this.camera);this.sky.forceClear=true;this.sky.time=.38;
    this.season=seasonStateAtPhase(.37);
    this.scenery=new FreeplayScenery(this);this.effects=new ExplosionEffects(this.scene,settings);
    this.population=new FreeplayPopulation(this.scene,this.world,FREEPLAY.seed);
    this.peers=new FreeplayPeers(this.scene,'a'+connection.auth.acct);
    this.map=new FreeplayMap(this);
    this.input=new FreeplayInput(this,ui.canvas,ui.root);this.actions=new FreeplayActions(this);
    this.vehicles=new FreeplayVehicles(this);
    this.battle=new FreeplayBattle(this);
    this.resize=()=>{this.renderer.setPixelRatio(Math.min(devicePixelRatio,settings.plain?1:1.5));this.renderer.setSize(innerWidth,innerHeight,false);this.camera.aspect=innerWidth/innerHeight;this.camera.updateProjectionMatrix();};
    window.addEventListener('resize',this.resize);this.resize();
    this.onLost=e=>{e.preventDefault();this.ui.report('Graphics paused. Reload to return to the saved world.');this.pause(true);};
    ui.canvas.addEventListener('webglcontextlost',this.onLost);
    this.previous=performance.now();this.frameId=requestAnimationFrame(now=>this.frame(now));
  }
  home(){
    if(this.battle?.locked()){this.ui.message('Finish the battle or forfeit in Army before returning to the village.');this.ui.open('battle');return;}
    if(this.battle?.me){this.battle.wantHome=true;this.battle.leave();return;}
    if(this.vehicles?.driving){this.vehicles.afterPark=()=>this.home();this.vehicles.park();return;}
    const spawn=this.world.gen.findSpawn();Object.assign(this.player.pos,spawn);this.player.pos.y=Math.max(spawn.y,45);
    this.player.flying=true;this.player.vel={x:0,y:0,z:0};this.player.yaw=Math.PI;this.player.pitch=-.35;
    if(this.ui.fly){this.ui.fly.textContent='Fly: on';this.ui.fly.setAttribute('aria-pressed','true');}
  }
  transaction(value){
    if(value.snapshot||value.replace){
      // A complete authoritative state already contains all earlier operations.
      this.transactions.length=0;this.applying=null;this.resyncPending=false;this.actions.cancel();
    }else if(this.resyncPending)return;
    const retained=[...this.transactions,value];
    if(this.applying)retained.push(this.applying.transfer);
    const chunks=retained.reduce((total,transfer)=>total+transfer.edits.chunks.size,0);
    if(retained.length>FREEPLAY.maxPendingTransactions||chunks>FREEPLAY.maxChunks){
      // Hidden tabs still receive WebSocket commits while animation frames stop.
      // Bound actual allocated arrays, not merely the number of edited voxels.
      this.transactions.length=0;this.applying=null;this.ready=false;this.resyncPending=true;this.actions.cancel();
      this.ui.message('Catching up with the saved moor…');
      queueMicrotask(()=>{if(this.active&&this.resyncPending)this.connection.reconnect();});
      return;
    }
    this.transactions.push(value);this.ui.message('Preparing the shared world…');
  }
  applyTransaction(){
    if(!this.applying&&this.transactions.length){
      const transfer=this.transactions.shift();
      if(transfer.snapshot||transfer.replace){
        this.actions.cancel();this.world.replaceOverrides(transfer.edits);this.scenery.invalidate();
        const returnHome=transfer.replace||!this.ready;
        this.complete(transfer);if(returnHome)this.home();return;
      }
      this.applying={transfer,iterator:transfer.edits.cells(),done:0};
    }
    const work=this.applying;if(!work)return;
    const rows=[];let next;
    for(let i=0;i<FREEPLAY.applyCellsPerFrame;i++){next=work.iterator.next();if(next.done)break;rows.push(next.value);}
    this.world.applyEdits(rows);work.done+=rows.length;
    this.ui.message('Changing the moor · '+Math.round(work.done/Math.max(1,work.transfer.count)*100)+'%');
    if(next?.done){this.applying=null;this.scenery.invalidate();this.complete(work.transfer);}
  }
  complete(transfer){
    this.ready=true;
    if(transfer.replace)this.battle?.disconnected();
    this.vehicles?.apply(transfer);
    if(!transfer.snapshot&&transfer.kind==='weapon')this.actions.weapons.impact(transfer);
    if(!transfer.snapshot&&transfer.kind==='blast'){
      const bomb=bombById(transfer.bomb),[x,y,z]=transfer.center;
      if(bomb){const event={x,y,z,kind:bomb.id,radius:bomb.radius,depth:bomb.depth,id:String(transfer.revision)};this.effects.detonate(event);this.population.blast(event);}
    }
    if(transfer.replace){this.population.dispose();this.population=new FreeplayPopulation(this.scene,this.world,FREEPLAY.seed);this.ui.message(transfer.kind==='restore'?'The saved moor is back.':'A fresh moor for both of thee.');}
    else this.ui.message(transfer.snapshot?'The moor is yours. Build, fly or choose a bomb.':transfer.kind==='undo'?'Latest shared change undone.':'Saved for both of thee.');
    this.ui.undo.disabled=!this.connection.history.length;
    this.ui.error.hidden=true;
  }
  canEdit(){
    if(!this.ready||this.applying||this.transactions.length||!this.connection.connected||this.connection.stage||this.connection.pending){this.ui.message('Wait until the shared world is ready.');return false;}
    return true;
  }
  send(type,fields={}){
    if(!this.canEdit())return false;
    try{this.connection.command(type,fields);return true;}catch(error){this.ui.report(error.message);return false;}
  }
  use(){this.actions.use();}break(){this.actions.break();}primary(){this.actions.primary();}
  fly(){if(this.vehicles?.driving||this.battle?.me)return;this.player.flying=!this.player.flying;this.player.vel.y=0;this.ui.fly.textContent=this.player.flying?'Fly: on':'Fly';this.ui.fly.setAttribute('aria-pressed',String(this.player.flying));}
  pause(value){this.paused=value;this.input?.pause(value);}
  unlockAudio(){this.effects.unlockAudio().catch(()=>this.ui.message('Sound is unavailable; play can continue.'));}
  setting(key,value){
    this.settings[key]=value;this.effects[key]=value;
    if(key==='plain'){this.world.renderDist=value?4:6;this.effects.dispose();this.effects=new ExplosionEffects(this.scene,this.settings);this.unlockAudio();this.resize();}
    if(key==='muted')this.effects.audio?.setMuted?.(value);
  }
  frame(now){
    if(!this.active)return;
    const raw=now-this.previous,dt=Math.min(.05,raw/1000);this.previous=now;this.elapsed+=dt;
    this.frameTimes.push(raw);if(this.frameTimes.length>300)this.frameTimes.shift();
    try{
      this.applyTransaction();
      const p=this.player;
      this.world.update(p.pos.x,p.pos.z);
      p.creative=true;p.god=true;p.fatigue=0;p.wetness=0;p.temperature=20;p.health=20;p.hunger=20;p.air=10;
      if(!this.paused&&this.ready){this.input.update(dt);if(!this.vehicles.driving)p.update(dt,this.input,null,this.season);}
      this.vehicles.update(dt);
      this.battle.update(dt);
      p.pos.y=Math.min(180,Math.max(1,p.pos.y));
      p.pos.x=Math.max(-FREEPLAY.worldLimit+1,Math.min(FREEPLAY.worldLimit-1,p.pos.x));
      p.pos.z=Math.max(-FREEPLAY.worldLimit+1,Math.min(FREEPLAY.worldLimit-1,p.pos.z));
      this.camera.position.set(p.pos.x,p.pos.y+p.eye,p.pos.z);this.camera.rotation.set(p.pitch,p.yaw,0,'YXZ');this.camera.updateMatrixWorld();
      this.vehicles.camera();this.camera.updateMatrixWorld();
      this.sky.update(0,p.pos,this.season);this.sky.time=.38;this.sky.gfx=this.settings.plain?'plain':'fine';
      // Keep the generation edge hidden while letting the atom cloud rise beyond it.
      if(this.scene.fog){this.scene.fog.near=25;this.scene.fog.far=this.world.renderDist*16-5;}
      if(!this.applying){this.scenery.update(dt);this.population.update(dt,p.pos);}
      this.effects.update(dt,p.pos);this.peers.update(dt,p.pos);this.actions.update(dt);this.map.update(dt);
      setWaterTime(this.elapsed);setCamPos(p.pos.x,p.pos.y+p.eye,p.pos.z);
      this.renderer.render(this.scene,this.camera);
      if(this.elapsed-this.lastPos>.25){this.lastPos=this.elapsed;this.connection.position({...p.pos,yaw:p.yaw});}
    }catch(error){this.ui.report('The world paused after an error. Reconnect or reload to recover.');console.error('freeplay-runtime',error);this.pause(true);this.active=false;return;}
    this.frameId=requestAnimationFrame(time=>this.frame(time));
  }
  snapshot(){return{ready:this.ready,paused:this.paused,applying:!!this.applying,queued:this.transactions.length,epoch:this.connection.epoch,revision:this.connection.revision,
    player:{...this.player.pos,health:this.player.health,flying:this.player.flying},overrides:this.world.overrides.size,chunks:this.world.chunks.size,
    meshes:[...this.world.chunks.values()].filter(c=>c.meshes).length,drawCalls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles,
    battle:this.battle.state,battlePlayer:this.battle.me,
    vehicles:[...this.vehicles.vehicles.values()].map(v=>({id:v.id,mode:v.mode,pose:{...v.pose},cells:v.cells,core:v.core,pilot:v.pilot})),driving:this.vehicles.driving,
    effects:this.effects.stats(),population:this.population.stats(),frameTimes:[...this.frameTimes]};}
  dispose(){
    this.active=false;cancelAnimationFrame(this.frameId);window.removeEventListener('resize',this.resize);this.ui.canvas.removeEventListener('webglcontextlost',this.onLost);
    this.transactions.length=0;this.applying=null;this.resyncPending=false;
    this.battle.dispose();this.vehicles.dispose();this.map.dispose();this.input.dispose();this.actions.dispose();this.peers.dispose();this.population.dispose();this.effects.dispose();this.scenery.dispose();this.world.dispose();this.sky.dispose();this.renderer.dispose();
  }
}
