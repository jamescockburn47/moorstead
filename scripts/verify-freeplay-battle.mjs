import assert from 'node:assert/strict';
import * as THREE from 'three';
import { validBattleState, validBattleEvent } from '../src/freeplay/battle-protocol.js';
import { FreeplayBattle } from '../src/freeplay/battle.js';
import { FreeplayGame } from '../src/freeplay/runtime.js';
import { FreeplayVehicles } from '../src/freeplay/vehicles.js';
import { FreeplayConnection } from '../src/freeplay/connection.js';
import { FREEPLAY } from '../src/freeplay/config.js';
import { makeBattlefield } from './export-freeplay-battlefield.mjs';
import { Gen } from '../src/worldgen.js';

const {header,raw}=makeBattlefield(),[ox,oz]=header.origin;
const bounds={minX:ox,minZ:oz,maxX:ox+127,maxZ:oz+127};
const actor={id:'atest',team:'blue',x:header.camps.blue[0],y:header.camps.blue[1],z:header.camps.blue[2],
  yaw:0,hp:100,shield:100,respawn:0,spawnSeq:1,shieldCooldown:0};
const state={available:true,revision:0,bounds,camps:header.camps,scores:{blue:0,red:0},players:[actor],soldiers:[],shields:[]};
assert(validBattleState(state));assert(validBattleState({available:false}));
for(const change of [{hp:-1},{shield:NaN},{respawn:999},{spawnSeq:undefined},{team:'green'},{x:Infinity}])
  assert(!validBattleState({...state,players:[{...actor,...change}]}));
assert(!validBattleState({...state,players:[actor,actor]}));
assert(!validBattleState({...state,bounds:{...bounds,maxX:0}}));
assert(!validBattleState({...state,soldiers:Array.from({length:49},()=>actor)}));
assert(validBattleEvent({type:'shot',from:[0,1,0],to:[1,2,3]}));
assert(!validBattleEvent({type:'shot',from:[NaN,1,0]}));

// Exported voxel order is the exact client generator, including caves and props.
const gen=new Gen(header.seed),chunk=gen.generateChunk(ox/16+3,oz/16+2);
for(let y=0;y<64;y++)for(let z=0;z<16;z++)for(let x=0;x<16;x++)
  assert.equal(raw.readUInt16LE(((y*128+z+32)*128+x+48)*2),chunk[x+z*16+y*256]);
assert.equal(raw.length,2*128*128*64);assert(header.solidIds.includes(207)&&header.solidIds.includes(208));

const sent=[],ui={army:{},shield:{},fly:{},undo:{},selection:{},panel:{close(){}},message(){}};
const game={ui,ready:true,settings:{reducedMotion:true},scene:new THREE.Scene(),world:{isLoaded:()=>true},
  player:{pos:{x:0,y:40,z:0},vel:{x:0,y:0,z:0},flying:true},input:{clear(){}},vehicles:{driving:null},
  connection:{auth:{acct:'test'},connected:true,position(){},battle:(...args)=>{sent.push(args);return true;}},
  camera:new THREE.PerspectiveCamera(),actions:{direction:new THREE.Vector3(),selected:{type:'weapon',id:'machinegun'},weapons:{tone(){}}},unlockAudio(){}};
const battle=game.battle=new FreeplayBattle(game);battle.join('blue');
assert.deepEqual(sent.pop(),['battle-join',{team:'blue'}]);
battle.receive({type:'battle-state',battle:state});assert.equal(game.player.pos.x,actor.x);assert.equal(game.player.flying,false);
battle.update(.01);assert.equal(ui.army.hidden,false);assert.equal(ui.fly.hidden,true);
const target=game.player.pos.x;game.player.pos.x+=1;battle.receive({type:'battle-state',battle:state});
assert.equal(game.player.pos.x,target+1,'ordinary network updates do not snap local movement');
battle.receive({type:'battle-state',battle:{...state,players:[{...actor,spawnSeq:2}]}});
assert.equal(game.player.pos.x,target,'respawn/camp command repositions the client');
game.player.pos.x+=10;
battle.receive({type:'battle-state',battle:{...state,players:[{...actor,spawnSeq:2,correctionSeq:1}]}});
assert.equal(game.player.pos.x,target,'rejected movement reconciles the visible player with the server hitbox');
assert(battle.fire({id:'machinegun',cooldown:.25}));assert.equal(sent.at(-1)[0],'battle-shot');
const count=sent.length;battle.fire({id:'machinegun',cooldown:.25});assert.equal(sent.length,count,'automatic fire is rate bounded');
let cleared=0;game.input.clear=()=>cleared++;battle.state.ctf={phase:'active',paused:true};game.player.pos.x+=2;
battle.update(.01);assert.equal(game.player.pos.x,actor.x);assert(cleared>0,'reconnect pause freezes local movement rather than repeatedly snapping it');delete battle.state.ctf;
FreeplayGame.prototype.fly.call(game);assert.equal(game.player.flying,false,'F cannot bypass battlefield movement');
let claimed=false;FreeplayVehicles.prototype.enter.call({game:{...game,canEdit:()=>true,connection:{vehicle:()=>{claimed=true;}}},vehicles:new Map([['v',{id:'v'}]])},'v');
assert.equal(claimed,false,'battle participants cannot acquire a vehicle');
battle.receive({type:'battle-state',battle:{...state,players:[]}});assert.equal(game.player.pos.x,0,'leave returns to original free-play position');
battle.dispose();assert.equal(game.scene.children.length,0);

const notices=[],net=new FreeplayConnection({acct:'test',token:'synthetic-token',name:'Henry',room:FREEPLAY.room},
  {error:x=>notices.push(x),state(){},battle(){}});
net.epoch=1;net.pending='terrain-in-flight';
net.receive({type:'error',command:'battle-shot',message:'Cooldown'});
assert.equal(net.pending,'terrain-in-flight','combat errors cannot abandon a pending saved terrain change');
const noticeCount=notices.length;
net.receive({type:'error',command:'battle-shot',code:'battle-rate',message:'That weapon is cooling down.'});
assert.equal(notices.length,noticeCount,'a refused automatic-fire repeat does not leave a persistent world-error toast');
net.receive({type:'error',command:'battle-shot',code:'battle-round',message:'Place both flags first.'});
assert.equal(notices.at(-1),'Place both flags first.','real combat refusals remain visible');
net.receive({type:'battle-state',epoch:1,battle:{available:false}});
console.log('Free-play battlefield: PASS (real terrain parity, protocol bounds, join/respawn/leave, shooting cooldown, vehicle/fly isolation).');
