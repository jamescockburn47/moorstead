import './style.css';
import { FreeplayUI } from './ui.js';
import { FreeplayConnection } from './connection.js';
import { FreeplayGame } from './runtime.js';
import { claimFreeplay, storedLogin, forgetFreeplay } from './auth.js';
import { FREEPLAY } from './config.js';
import { PLAYTEST } from '../playtest/profile.js';

const root=document.getElementById('freeplay');
let auth=null,connection=null,game=null,generation=0,peerCache=[];
const settings={plain:true,reducedFlash:false,reducedMotion:false,muted:false};
try{
  const saved=JSON.parse(localStorage.getItem(FREEPLAY.preferencesKey)||'null');
  for(const key of Object.keys(settings))if(typeof saved?.[key]==='boolean')settings[key]=saved[key];
  auth=storedLogin(localStorage);
}catch{/* Missing/private-mode preferences do not grant login or prevent entering a code. */}

const ui=new FreeplayUI(root,{
  login:async(code,name)=>{
    ui.loading('Checking thi free-play code…');
    try{auth=await claimFreeplay(code,name);ui.code.value='';ui.saved(auth);start();}
    catch(error){ui.loginError(error instanceof TypeError?'Cannot reach the parish clerk. Try again.':error.message);}
  },
  continue:()=>start(),pause:value=>game?.pause(value),
  map:parent=>game?.map.open(parent),
  fly:()=>game?.fly(),use:()=>game?.use(),break:()=>game?.break(),
  select:value=>game?.actions.choose(value),
  undo:()=>game?.send('undo'),reset:()=>game?.send('reset',{confirm:true}),restore:()=>game?.send('restore',{confirm:true}),
  home:()=>game?.home(),history:()=>connection?.history||[],checkpoint:()=>connection?.checkpoint||false,
  reconnect:()=>connection?.reconnect(),settings:()=>settings,
  setting:(key,value)=>{
    game?.setting(key,value);settings[key]=value;
    try{localStorage.setItem(FREEPLAY.preferencesKey,JSON.stringify(settings));}catch{ui.message('Setting applies for this session; this browser cannot save preferences.');}
  },
  logout:()=>{
    generation++;connection?.dispose();game?.dispose();game=null;connection=null;auth=null;
    try{forgetFreeplay();}catch{ui.report('This browser could not remove its remembered login.');}
    ui.panel.close();ui.hud.hidden=true;ui.login.hidden=false;ui.saved(null);ui.loginError('Signed out.');
  },
});
ui.saved(auth);

function start(){
  if(!auth)return;
  const mine=++generation;connection?.dispose();game?.dispose();game=null;peerCache=[];
  ui.loading('Joining our shared moor…');ui.error.hidden=true;
  const current=()=>mine===generation;
  connection=new FreeplayConnection(auth,{
    state:state=>{
      if(!current())return;
      const text={connecting:'Joining…',syncing:'Receiving world…',saving:'Saving…',ready:'Shared · ∞ health · ∞ supplies',offline:'Offline · reconnecting',denied:'Login required',replaced:'Playing on another device'}[state]||state;
      ui.status(text);
      if(['connecting','offline','denied','replaced'].includes(state)){peerCache=[];game?.peers.replace([]);}
      if(state==='offline')ui.message('Connection lost. Changes wait until the saved world reconnects.');
      if(state==='denied'){ui.login.hidden=false;ui.hud.hidden=true;ui.loginError('Enter thi free-play code again.');}
    },
    error:message=>{if(current()){if(game)ui.report(message);else ui.loginError(message);}},
    progress:(n,total)=>{if(current()&&!game)ui.loading('Receiving our moor · '+Math.round(n/Math.max(1,total)*100)+'%');},
    peers:values=>{peerCache=values;if(current())game?.peers.replace(values);},
    peer:value=>{if(current())game?.peers.put(value);},leave:id=>{if(current())game?.peers.remove(id);},
    transaction:transfer=>{
      if(!current())return;
      if(!game){game=new FreeplayGame(ui,connection,settings);game.peers.replace(peerCache);ui.playing(auth.name);}
      game.transaction(transfer);
    },
  });
  connection.connect();
}

window.addEventListener('pagehide',()=>{generation++;connection?.dispose();game?.dispose();});

// Existing development-only compilation boundary; no fixture or capability in releases.
if(PLAYTEST){
  window.moorsteadTest={
    snapshot:()=>game?.snapshot()||null,
    cell:(x,y,z)=>game?.world.getBlock(x,y,z),
    surface:(x,z)=>game?.world.surfaceY(x,z),
    prepareView:(x,y,z,yaw,pitch)=>{
      if(!game)throw new Error('Enter the world first');
      Object.assign(game.player.pos,{x,y,z});game.player.yaw=yaw;game.player.pitch=pitch;game.player.flying=true;
      game.player.vel={x:0,y:0,z:0};
    },
    target:()=>game?.actions.target()||null,
  };
}
