import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BattleBoundary,boundaryPoints } from '../src/freeplay/battle-boundary.js';
import { battlePresentation } from '../src/freeplay/battle-hud.js';
import { FreeplayBattle } from '../src/freeplay/battle.js';
import { FreeplayGame } from '../src/freeplay/runtime.js';
import { validCaptureState } from '../src/freeplay/battle-protocol.js';

const me={id:'blue-test',team:'blue',hp:100},enemy={id:'red-test',team:'red',connected:false,reconnectIn:30};
const ctf={phase:'setup',winner:null,ready:{blue:false,red:false},paused:false,reason:null,bases:{blue:null,red:null},flags:{}};
const state={ctf,players:[me,enemy],soldiers:[]};
assert.equal(battlePresentation(state,me).kind,'ready');
assert.match(battlePresentation(state,me).detail,/Guns unlock when both/);
assert.equal(battlePresentation({...state,ctf:{...ctf,ready:{blue:true,red:false}}},me).kind,'army');
assert.match(battlePresentation({...state,ctf:{...ctf,phase:'active',paused:true}},me).detail,/30s/);
assert.equal(battlePresentation({...state,ctf:{...ctf,phase:'won',winner:'red',reason:'forfeit'}},me).title,'Red wins');
assert.match(battlePresentation({...state,ctf:{...ctf,phase:'won',winner:'red',reason:'forfeit'}},me).detail,/forfeited/);
assert(validCaptureState(ctf));
for(const bad of [{ready:{blue:'yes',red:false}},{paused:'true'},{reason:'mystery'}])assert(!validCaptureState({...ctf,...bad}));

const sent=[],opened=[],messages=[];
const battle=Object.assign(Object.create(FreeplayBattle.prototype),{me,state:{...state,ctf:{...ctf,phase:'active'}},game:{
  ready:true,ui:{panel:{close(){},open:false},message:m=>messages.push(m),open:k=>opened.push(k)},
  connection:{connected:true,battle:(...args)=>{sent.push(args);return true;}}
}});
assert.equal(battle.leave(),false);assert.equal(sent.length,0);assert.equal(opened.pop(),'battle');
FreeplayGame.prototype.home.call({battle,ui:battle.game.ui});assert.equal(sent.length,0,'home cannot silently dismiss army');
battle.forfeit();assert.deepEqual(sent.pop(),['battle-forfeit',{}]);
battle.state.ctf.paused=true;assert.equal(battle.combatReady(),false,'disconnect pause blocks fire');
battle.state.ctf={...ctf,phase:'won',winner:'red'};assert.equal(battle.leave(),true);assert.equal(sent.pop()[0],'battle-leave');

const scene=new THREE.Scene(),world={surfaceY:(x,z)=>30+Math.sin(x/20)+Math.cos(z/20)};
const bounds={minX:-2048,minZ:1024,maxX:-1921,maxZ:1151};
const points=boundaryPoints(bounds);assert.equal(points.length,64);
assert.equal(new Set(points.map(p=>p.join(','))).size,64,'no duplicate corner posts');
assert(points.every(([x,z])=>x>=bounds.minX+1&&x<=bounds.maxX-1&&z>=bounds.minZ+1&&z<=bounds.maxZ-1));
const boundary=new BattleBoundary(scene,world);
boundary.update(.1,{bounds},true);assert.equal(boundary.mesh.count,128);assert(boundary.mesh.visible);
assert([...boundary.mesh.instanceMatrix.array].every(Number.isFinite),'terrain-following fence has finite transforms');
boundary.update(.1,{bounds},false);assert(!boundary.mesh.visible);
boundary.dispose();assert.equal(scene.children.length,0);
console.log('Free-play battle flow: PASS (visible ready/pause/win guidance, explicit forfeit, home lock and bounded arena boundary).');
