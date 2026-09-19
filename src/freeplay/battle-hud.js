import { element } from './ui.js';
import { captureHint } from './capture-ui.js';

const teamName=team=>team==='blue'?'Blue':'Red';
export function battlePresentation(state,me){
  if(!me||!state?.ctf)return null;
  const ctf=state.ctf,enemy=me.team==='blue'?'red':'blue';
  const count=team=>(state.soldiers||[]).filter(s=>s.team===team&&s.hp>0).length;
  if(ctf.phase==='won')return{title:teamName(ctf.winner)+' wins',detail:captureHint(state,me),action:'Play another round',kind:'again'};
  if(ctf.paused){
    const missing=state.players.find(p=>p.connected===false);
    return{title:'Battle paused',detail:'Waiting for the other player to reconnect · '+Math.ceil(missing?.reconnectIn||0)+'s',action:'',kind:'waiting'};
  }
  if(ctf.phase==='setup'){
    const ready=team=>ctf.ready?.[team]===true;
    return{title:'SETUP · Blue '+(ready('blue')?'ready':'preparing')+' · Red '+(ready('red')?'ready':'preparing'),
      detail:ready(me.team)?'Your flag is ready. Waiting for '+teamName(enemy)+'. Build cover while you wait.':'Build a base, then place your flag and get ready. Guns unlock when both sides are ready.',
      action:ready(me.team)?'Your army':'Place flag & ready',kind:ready(me.team)?'army':'ready'};
  }
  return{title:'BATTLE ON · Blue '+count('blue')+' · Red '+count('red')+' soldiers',detail:captureHint(state,me),action:'',kind:'fight'};
}

export class BattleHud{
  constructor(battle){
    this.battle=battle;this.hitTime=0;
    const ui=battle.game.ui;if(!ui.hud)return;
    this.root=element('section','fp-battle-status',null,ui.hud);this.root.hidden=true;
    this.title=element('strong','',null,this.root);
    this.detail=element('span','',null,this.root);
    this.action=element('button','fp-primary',null,this.root);this.action.type='button';
    this.action.onclick=()=>{
      if(this.kind==='ready')battle.ready();
      else if(this.kind==='again')battle.command('battle-reset');
      else battle.game.ui.open('battle');
    };
    this.exit=element('button','fp-battle-exit','Return to Free Play',this.root);this.exit.type='button';this.exit.onclick=()=>battle.leave();this.exit.hidden=true;
    this.feedback=element('span','fp-hit-feedback','',ui.hud);
  }
  hit(event){
    if(!this.feedback||event.sourceId!==this.battle.pid)return;
    this.hitTime=.65;this.feedback.textContent=event.shield?'SHIELD HIT':'HIT';
  }
  update(dt){
    if(!this.root)return;
    const b=this.battle,ui=b.game.ui,presentation=battlePresentation(b.state,b.me);
    this.root.hidden=!presentation;ui.root.classList.toggle('fp-in-battle',!!presentation);
    this.hitTime=Math.max(0,this.hitTime-dt);this.feedback.hidden=this.hitTime<=0;
    if(!presentation)return;
    this.kind=presentation.kind;
    for(const [node,text]of [[this.title,presentation.title],[this.detail,presentation.detail],[this.action,presentation.action]])if(node.textContent!==text)node.textContent=text;
    this.action.hidden=!presentation.action;
    this.exit.hidden=presentation.kind!=='again';
    this.action.setAttribute('aria-label',this.kind==='ready'?'Ready for battle':presentation.action||'Battle status');
  }
  clear(){if(this.root)this.root.hidden=true;this.battle.game.ui.root?.classList.remove('fp-in-battle');if(this.feedback)this.feedback.hidden=true;}
  dispose(){this.clear();this.root?.remove();this.feedback?.remove();}
}
