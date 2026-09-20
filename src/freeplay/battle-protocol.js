import { BATTLE_REGION } from './battle-config.js';

const id=value=>typeof value==='string'&&value.length>0&&value.length<=80;
const finite=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
const team=value=>value==='blue'||value==='red';
const point=row=>row&&finite(row.x,-8192,8192)&&finite(row.z,-8192,8192)&&finite(row.y,0,192);
export function validCaptureState(ctf){
  if(ctf?.objective!==undefined&&(ctf.objective!=='zone'||ctf.captureRadius!==3))return false;
  if(!ctf||!['setup','active','won'].includes(ctf.phase)||!(ctf.winner===null||team(ctf.winner))||!ctf.bases||!ctf.flags)return false;
  if((ctf.phase==='won')!==(ctf.winner!==null))return false;
  if(ctf.ready!==undefined&&(!ctf.ready||!['blue','red'].every(key=>typeof ctf.ready[key]==='boolean')))return false;
  if(ctf.paused!==undefined&&typeof ctf.paused!=='boolean')return false;
  if(ctf.reason!==undefined&&![null,'capture','forfeit'].includes(ctf.reason))return false;
  for(const key of ['blue','red']){
    const base=ctf.bases[key],flag=ctf.flags[key];
    if(!(base===null||Array.isArray(base)&&base.length===3&&point({x:base[0],y:base[1],z:base[2]})))return false;
    if(ctf.phase!=='setup'&&!base)return false;
    if(flag&&(!point(flag)||!['home','carried','dropped'].includes(flag.status)||!(flag.carrier===null||id(flag.carrier))||!finite(flag.returnIn,0,20)))return false;
    if(ctf.phase!=='setup'&&!flag)return false;
  }
  return true;
}
export function validBattleState(s){
  if(s?.available===false)return Object.keys(s).length===1;
  if(s?.ctf!==undefined&&!validCaptureState(s.ctf))return false;
  if(!s||!Array.isArray(s.players)||s.players.length>8||!Array.isArray(s.soldiers)||s.soldiers.length>60
    ||!Array.isArray(s.shields)||s.shields.length>8||!s.camps||!s.bounds)return false;
  const {origin,width}=BATTLE_REGION;
  if(s.bounds.minX!==origin[0]||s.bounds.minZ!==origin[1]||s.bounds.maxX!==origin[0]+width-1||s.bounds.maxZ!==origin[1]+width-1)return false;
  if(s.equipment!==undefined&&(!Array.isArray(s.equipment)||s.equipment.length>10))return false;
  const all=[...s.players,...s.soldiers,...(s.equipment||[])],seen=new Set();
  if(!['blue','red'].every(key=>Array.isArray(s.camps[key])&&s.camps[key].length===3&&s.camps[key].every(Number.isFinite)
    &&Number.isSafeInteger(s.scores?.[key])&&s.scores[key]>=0))return false;
  for(const row of all){
    if(!id(row.id)||seen.has(row.id)||!team(row.team)||!point(row)||!finite(row.hp,0,100)||!finite(row.yaw,-1000,1000)
      ||!finite(row.shield,0,100)||!finite(row.respawn,0,33)||!Number.isSafeInteger(row.spawnSeq)||row.spawnSeq<1)return false;
    if(row.squad!==undefined&&(!Number.isInteger(row.squad)||row.squad<1||row.squad>3))return false;
    seen.add(row.id);
  }
  if(!s.players.every(row=>finite(row.shieldCooldown,0,25)&&(row.correctionSeq===undefined||Number.isSafeInteger(row.correctionSeq)&&row.correctionSeq>=0)
    &&(row.connected===undefined||typeof row.connected==='boolean')&&(row.reconnectIn===undefined||finite(row.reconnectIn,0,60)))
    ||!s.soldiers.every(row=>id(row.owner)))return false;
  if(!(s.equipment||[]).every(row=>id(row.owner)&&['turret','tank'].includes(row.kind)))return false;
  return s.shields.every(row=>id(row.id)&&team(row.team)&&point(row)&&finite(row.radius,0,12)&&finite(row.remaining,0,12));
}
export function validBattleEvent(e){
  if(!e||!['shot','hit','knockout','shield'].includes(e.type))return false;
  if(e.sourceId!==undefined&&!id(e.sourceId))return false;
  return ['from','to'].every(key=>e[key]===undefined||Array.isArray(e[key])&&e[key].length===3&&e[key].every(Number.isFinite));
}
