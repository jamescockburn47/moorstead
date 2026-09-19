import { BATTLE_REGION } from './battle-config.js';

const id=value=>typeof value==='string'&&value.length>0&&value.length<=80;
const finite=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
const team=value=>value==='blue'||value==='red';
const point=row=>row&&finite(row.x,-8192,8192)&&finite(row.z,-8192,8192)&&finite(row.y,0,192);
export function validBattleState(s){
  if(s?.available===false)return Object.keys(s).length===1;
  if(!s||!Array.isArray(s.players)||s.players.length>8||!Array.isArray(s.soldiers)||s.soldiers.length>48
    ||!Array.isArray(s.shields)||s.shields.length>8||!s.camps||!s.bounds)return false;
  const {origin,width}=BATTLE_REGION;
  if(s.bounds.minX!==origin[0]||s.bounds.minZ!==origin[1]||s.bounds.maxX!==origin[0]+width-1||s.bounds.maxZ!==origin[1]+width-1)return false;
  const all=[...s.players,...s.soldiers],seen=new Set();
  if(!['blue','red'].every(key=>Array.isArray(s.camps[key])&&s.camps[key].length===3&&s.camps[key].every(Number.isFinite)
    &&Number.isSafeInteger(s.scores?.[key])&&s.scores[key]>=0))return false;
  for(const row of all){
    if(!id(row.id)||seen.has(row.id)||!team(row.team)||!point(row)||!finite(row.hp,0,100)||!finite(row.yaw,-1000,1000)
      ||!finite(row.shield,0,100)||!finite(row.respawn,0,8)||!Number.isSafeInteger(row.spawnSeq)||row.spawnSeq<1)return false;
    seen.add(row.id);
  }
  if(!s.players.every(row=>finite(row.shieldCooldown,0,25)&&(row.correctionSeq===undefined||Number.isSafeInteger(row.correctionSeq)&&row.correctionSeq>=0))
    ||!s.soldiers.every(row=>id(row.owner)))return false;
  return s.shields.every(row=>id(row.id)&&team(row.team)&&point(row)&&finite(row.radius,0,12)&&finite(row.remaining,0,12));
}
export function validBattleEvent(e){
  if(!e||!['shot','hit','knockout','shield'].includes(e.type))return false;
  return ['from','to'].every(key=>e[key]===undefined||Array.isArray(e[key])&&e[key].length===3&&e[key].every(Number.isFinite));
}
