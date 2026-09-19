import { BattleRenderer } from './battle-renderer.js';
import { battlePanel } from './battle-ui.js';
import { BATTLE_TEAMS } from './battle-config.js';
import { weaponById } from './weapons.js';
import { captureHint, warBombAllowed } from './capture-ui.js';

export class FreeplayBattle{
  constructor(game){
    this.game=game;this.pid='a'+game.connection.auth.acct;this.renderer=new BattleRenderer(game.scene,game.world);
    this.renderer.settings=game.settings;
    this.state=null;this.me=null;this.spawnSeq=null;this.correctionSeq=0;this.cooldown=0;this.savedPosition=null;
  }
  panel(parent){battlePanel(this,parent);}
  receive(message){
    if(message.type==='battle-event'){this.renderer.event(message.event);return;}
    const state=message.battle,previous=this.state;this.state=state;
    if(state.ctf&&this.game.ui.error&&(state.ctf.phase!==previous?.ctf?.phase
      ||JSON.stringify(state.ctf.bases)!==JSON.stringify(previous?.ctf?.bases)))this.game.ui.error.hidden=true;
    if(state.available===false){this.disconnected();return;}
    const me=state.players.find(row=>row.id===this.pid)||null,was=this.me;
    this.me=me;this.renderer.apply(state);
    if(me){
      if(!was){this.game.actions.cancel?.();this.game.ui.select?.({type:'weapon',id:'machinegun'});}
      if(me.correctionSeq!==undefined&&me.correctionSeq!==this.correctionSeq){
        this.correctionSeq=me.correctionSeq;Object.assign(this.game.player.pos,{x:me.x,y:me.y,z:me.z});
        this.game.player.vel={x:0,y:0,z:0};
      }
      if(me.spawnSeq!==this.spawnSeq){
        this.spawnSeq=me.spawnSeq;const p=this.game.player;
        Object.assign(p.pos,{x:me.x,y:me.y,z:me.z});p.vel={x:0,y:0,z:0};p.flying=false;
        p.pitch=-.12;p.yaw=me.team==='blue'?-Math.PI/2:Math.PI/2;
        this.game.ui.panel.close();this.game.connection.position({...p.pos,yaw:p.yaw});
      }
    }else if(was){
      this.spawnSeq=null;
      this.game.ui.selection.textContent='Free Play · unlimited health';
      if(this.wantHome){this.wantHome=false;this.savedPosition=null;this.game.home();return;}
      if(this.savedPosition){Object.assign(this.game.player.pos,this.savedPosition);this.game.player.flying=true;this.savedPosition=null;}
    }
  }
  command(type,fields={}){
    const g=this.game;
    if(!g.ready||!g.connection.connected||g.connection.stage){g.ui.message('Wait for the shared world to connect.');return false;}
    return g.connection.battle(type,fields);
  }
  join(team){
    if(this.game.vehicles.driving)return this.game.ui.message('Park your vehicle before joining an army.');
    this.savedPosition={...this.game.player.pos};this.command('battle-join',{team});
  }
  leave(){if(this.command('battle-leave'))this.game.ui.panel.close();}
  setBase(){if(this.command('battle-base'))this.game.ui.panel.close();}
  bombAllowed(id){return warBombAllowed(id,!!this.me);}
  combatReady(){
    if(!this.me||!this.state?.ctf||this.state.ctf.phase==='active')return true;
    this.game.ui.message(captureHint(this.state,this.me));return false;
  }
  order(order,aim=false){
    if(!this.me)return;const p=this.game.player.pos,hit=aim?this.game.actions.target():null;
    if(aim&&!hit)return this.game.ui.message('Aim at a loaded patch of ground first.');
    const rally=hit?[hit.x+.5,hit.y+1,hit.z+.5]:[p.x,p.y,p.z];this.command('battle-order',{order,rally});
  }
  shield(){if(this.me)this.command('battle-shield');else this.game.ui.open('battle');}
  fire(weapon){
    if(!this.me||!['machinegun','plasma'].includes(weapon?.id))return false;
    if(!this.combatReady())return true;
    if(this.me.hp<=0||this.cooldown>0)return true;
    const g=this.game;g.camera.getWorldDirection(g.actions.direction);
    if(this.command('battle-shot',{weapon:weapon.id,direction:g.actions.direction.toArray()})){
      this.cooldown=weapon.id==='plasma'?.5:weapon.cooldown||.35;g.actions.weapons.recoil=1;g.unlockAudio();g.actions.weapons.tone(weapon);
    }
    return true;
  }
  update(dt){
    this.cooldown=Math.max(0,this.cooldown-dt);this.renderer.update(dt,this.game.player.pos);
    const g=this.game,ui=g.ui,me=this.me;
    if(ui.connectionState==='ready')ui.status(me?'Battlefield · ∞ supplies':'Shared · ∞ health · ∞ supplies');
    ui.army.hidden=ui.shield.hidden=!me;ui.fly.hidden=ui.undo.hidden=!!me;
    if(!me)return;
    g.player.flying=false;
    const b=this.state.bounds,p=g.player.pos;
    p.x=Math.max(b.minX+1,Math.min(b.maxX-1,p.x));p.z=Math.max(b.minZ+1,Math.min(b.maxZ-1,p.z));
    if(me.hp<=0){Object.assign(p,{x:me.x,y:me.y,z:me.z});g.input.clear();}
    const name=weaponById(g.actions.selected.id)?.name||'Build / fortify';
    ui.selection.textContent=`${BATTLE_TEAMS[me.team].name} · HP ${Math.ceil(me.hp)} · Shield ${Math.ceil(me.shield||0)} · ${name}`;
    ui.shield.disabled=(me.shieldCooldown||0)>0||me.hp<=0;
    ui.shield.textContent=me.shieldCooldown>0?'Shield '+Math.ceil(me.shieldCooldown):'Shield';
    if(me.hp<=0)ui.message('Knocked out! Returning to camp in '+Math.ceil(me.respawn||0)+'…');
    else if(this.state.ctf&&!g.actions.fuse)ui.message(captureHint(this.state,me));
  }
  disconnected(){this.me=null;this.state=null;this.spawnSeq=null;this.correctionSeq=0;this.renderer.clear();}
  dispose(){this.renderer.dispose();}
}
