import { element } from './ui.js';
import { BATTLE_TEAMS } from './battle-config.js';
import { captureHint } from './capture-ui.js';

const button=(p,text,action)=>{const b=element('button','',text,p);b.type='button';b.onclick=action;return b;};
export function battlePanel(battle,parent){
  const g=battle.game,me=battle.me;
  element('p','','Capture the flag: choose a home base, steal the enemy flag and carry it home to win. Your own flag must be at home. Soldiers fight and defend; players carry flags.',parent);
  if(!me){
    for(const [team,info] of Object.entries(BATTLE_TEAMS)){
      const b=button(parent,'Join '+info.name,()=>battle.join(team));b.style.borderLeft='8px solid '+info.colour;
    }
    element('p','','Choose opposite armies to fight each other. Each army can recruit 24 soldiers. Health and shields apply here; ordinary Free Play keeps unlimited health.',parent);
  }else{
    element('h3','',BATTLE_TEAMS[me.team].name,parent);
    const ctf=battle.state?.ctf;
    element('p','',captureHint(battle.state,me),parent);
    if(ctf?.phase==='setup'){
      button(parent,ctf.bases[me.team]?'Move home base here':'Set home base here',()=>battle.setBase());
      element('p','','Stand on clear ground for your flag. Bases must be at least 32 blocks apart. When both bases are chosen, the battle starts and their positions lock.',parent);
    }
    if(ctf?.phase==='won')button(parent,'New round',()=>{battle.command('battle-reset');g.ui.panel.close();});
    const own=(battle.state?.soldiers||[]).filter(row=>row.owner===battle.pid).length;
    element('p','',`${own} soldiers under your command · knockouts: blue ${battle.state?.scores?.blue||0} / red ${battle.state?.scores?.red||0}. Capturing the flag wins the round.`,parent);
    button(parent,'Recruit 6 soldiers',()=>{battle.command('battle-recruit',{count:6});g.ui.panel.close();});
    for(const [order,text] of [['follow','Follow me'],['hold','Hold this position'],['attack','Attack the enemy']])button(parent,text,()=>{battle.order(order);g.ui.panel.close();});
    button(parent,'Move squad to aimed point',()=>{battle.order('hold',true);g.ui.panel.close();});
    button(parent,'Deploy shield dome',()=>{battle.shield();g.ui.panel.close();});
    button(parent,'Trenches and fortifications',()=>g.ui.open('build'));
    const carrying=Object.values(ctf?.flags||{}).some(flag=>flag.carrier===me.id);
    const returnButton=button(parent,carrying?'Carry the flag home on foot':'Return to home base',()=>battle.command('battle-rally',{}));returnButton.disabled=carrying;
    button(parent,'Leave battlefield',()=>battle.leave());
    element('p','','Machine gun and plasma fire at soldiers and players. Grenades, dynamite, demolition bombs and rockets damage troops and terrain. Mega and atom bombs are banned in war mode. Get behind cover or inside a shield dome.',parent);
    element('p','','If a carrier is knocked out, the flag drops. Touch your dropped flag to recover it; abandoned flags return after 20 seconds. Bases and the round restart when everyone leaves.',parent);
    element('p','','Shield domes last 12 seconds and recharge in 25 seconds. Trenches have steps out; bunkers have firing ports. Aim low through a port, or rise above cover to shoot.',parent);
  }
}
