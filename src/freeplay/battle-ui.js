import { element } from './ui.js';
import { BATTLE_TEAMS } from './battle-config.js';

const button=(p,text,action)=>{const b=element('button','',text,p);b.type='button';b.onclick=action;return b;};
export function battlePanel(battle,parent){
  const g=battle.game,me=battle.me;
  element('p','','Two armies. Real cover. Cartoon knockouts and quick respawns. The battlefield is a separate patch of your shared moor; your buildings and trenches stay saved.',parent);
  if(!me){
    for(const [team,info] of Object.entries(BATTLE_TEAMS)){
      const b=button(parent,'Join '+info.name,()=>battle.join(team));b.style.borderLeft='8px solid '+info.colour;
    }
    element('p','','Choose opposite armies to fight each other. Each army can recruit 24 soldiers. Health and shields apply here; ordinary Free Play keeps unlimited health.',parent);
  }else{
    element('h3','',BATTLE_TEAMS[me.team].name,parent);
    const own=(battle.state?.soldiers||[]).filter(row=>row.owner===battle.pid).length;
    element('p','',`${own} soldiers under your command · blue ${battle.state?.scores?.blue||0} : ${battle.state?.scores?.red||0} red`,parent);
    button(parent,'Recruit 6 soldiers',()=>{battle.command('battle-recruit',{count:6});g.ui.panel.close();});
    for(const [order,text] of [['follow','Follow me'],['hold','Hold this position'],['attack','Attack the enemy']])button(parent,text,()=>{battle.order(order);g.ui.panel.close();});
    button(parent,'Move squad to aimed point',()=>{battle.order('hold',true);g.ui.panel.close();});
    button(parent,'Deploy shield dome',()=>{battle.shield();g.ui.panel.close();});
    button(parent,'Trenches and fortifications',()=>g.ui.open('build'));
    button(parent,'Return to camp',()=>battle.command('battle-rally',{}));
    button(parent,'Leave battlefield',()=>battle.leave());
    element('p','','Machine gun and plasma fire at soldiers and players. Bombs and rockets damage troops and terrain. Get behind solid blocks or inside a shield dome. Knocked-out troops and players return at camp.',parent);
    element('p','','Shield domes last 12 seconds and recharge in 25 seconds. Trenches have steps out; bunkers have firing ports. Aim low through a port, or rise above cover to shoot.',parent);
  }
}
