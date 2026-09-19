import { element } from './ui.js';
import { BATTLE_TEAMS } from './battle-config.js';
import { captureHint } from './capture-ui.js';

const button=(p,text,action,style='')=>{const b=element('button',style,text,p);b.type='button';b.onclick=action;return b;};
const paragraph=(p,text)=>element('p','',text,p);
function forfeitPanel(battle,parent){
  parent.replaceChildren();element('h3','','Forfeit this battle?',parent);
  paragraph(parent,'The other army wins and you return to Free Play. Your buildings stay.');
  button(parent,'Forfeit and return to Free Play',()=>battle.forfeit(),'fp-danger');
  button(parent,'Keep fighting',()=>battle.game.ui.open('battle'));
}
export function battlePanel(battle,parent){
  const g=battle.game,me=battle.me,ctf=battle.state?.ctf;
  if(!me){
    element('h3','','Build. Fight. Capture the flag.',parent);
    paragraph(parent,'Join opposite teams in the marked warzone. Build a base, place your flag, and get ready. Both sides ready starts the fight.');
    for(const [team,info]of Object.entries(BATTLE_TEAMS)){
      const b=button(parent,'Join '+info.name,()=>battle.join(team));b.style.borderLeft='8px solid '+info.colour;
    }
    paragraph(parent,'Your soldiers attack automatically. Walls, trenches and bunkers block bullets. Bring the enemy flag home while yours is safe to win.');
    paragraph(parent,'Once the fight begins, stay inside the gold boundary until a flag is captured or someone forfeits. Each side can recruit 24 soldiers.');
    return;
  }
  element('h3','',BATTLE_TEAMS[me.team].name+' · '+(ctf?.phase==='setup'?'Get ready':ctf?.phase==='won'?'Round finished':'Battle on'),parent);
  paragraph(parent,captureHint(battle.state,me));
  if(ctf?.phase==='setup'){
    const ready=ctf.ready||{};
    paragraph(parent,'Blue: '+(ready.blue?'READY':'preparing')+' · Red: '+(ready.red?'READY':'preparing'));
    paragraph(parent,'1. Build your base. 2. Stand inside it on clear ground. 3. Place your flag and get ready. Bases need 32 blocks between them.');
    const primary=button(parent,ready[me.team]?'Flag ready — waiting for opponent':'Place flag & ready',()=>battle.ready(),'fp-primary');primary.disabled=!!ready[me.team];
    if(ctf.bases[me.team])button(parent,'Move flag here',()=>battle.setBase());
  }
  if(ctf?.phase==='won')button(parent,'Play another round',()=>{battle.command('battle-reset');g.ui.panel.close();},'fp-primary');
  const own=(battle.state?.soldiers||[]).filter(row=>row.owner===battle.pid),active=own.filter(row=>row.hp>0);
  paragraph(parent,`${active.length} soldiers fighting · ${own.length-active.length} recovering · ${own.length}/24 recruited`);
  const recruit=button(parent,'Recruit 6 soldiers',()=>{battle.command('battle-recruit',{count:6});g.ui.panel.close();});recruit.disabled=own.length>=24;
  paragraph(parent,'New recruits automatically attack when the battle starts. Choose one order for your whole squad:');
  const orders=element('div','fp-battle-orders',null,parent);
  for(const [order,label,help]of [['attack','Attack the enemy','Advance and fire at enemies.'],['defend','Defend our flag','Guard your base and fire from cover.'],['follow','Follow me','Stay with you and shoot nearby enemies.']]){
    const b=button(orders,label,()=>{battle.order(order);g.ui.panel.close();});element('small','',help,b);
    b.setAttribute('aria-label',label);
    b.setAttribute('aria-pressed',String(own.length>0&&own.every(s=>s.order===order)));
  }
  button(parent,'Hold this position',()=>{battle.order('hold');g.ui.panel.close();});
  button(parent,'Move squad to aimed point',()=>{battle.order('hold',true);g.ui.panel.close();});
  button(parent,'Deploy shield dome',()=>{battle.shield();g.ui.panel.close();});
  button(parent,'Trenches and fortifications',()=>g.ui.open('build'));
  const carrying=Object.values(ctf?.flags||{}).some(flag=>flag.carrier===me.id);
  const home=button(parent,carrying?'Carry the flag home on foot':'Return to home base',()=>{battle.command('battle-rally',{});g.ui.panel.close();});home.disabled=carrying;
  if(battle.locked())button(parent,'Forfeit battle…',()=>forfeitPanel(battle,parent),'fp-danger');
  else button(parent,'Leave battlefield',()=>battle.leave());
  const help=element('details','fp-battle-help',null,parent);element('summary','','How to win with clever building',help);
  for(const text of [
    'Use trenches and sandbag walls to hide your body while you fire. Solid blocks stop bullets and block the first blast that hits them.',
    'Put your flag behind a bunker, then order Defend our flag. Leave a door and a route out: soldiers cannot walk through your walls.',
    'Watchposts give a clearer shot over hills and low walls, but expose you. Move forward until you can see the enemy — you cannot shoot through a hill.',
    'Shield domes block damage for 12 seconds and recharge in 25 seconds. A blue shield bar absorbs bullets before the green health bar falls.',
    'On a tablet, drag the world to aim and hold Fire. On a computer, click the world to capture the mouse, then hold left click to fire.',
    'Players carry flags; soldiers fight. A knocked-out carrier drops the flag. Touch your dropped flag to return it, or wait 20 seconds.',
    'Mega and atom bombs are banned. A dropped connection pauses the battle for up to 60 seconds and keeps your army. Leaving for longer forfeits.'
  ])paragraph(help,text);
}
