import { BATTLE_TEAMS } from './battle-config.js';

export const warBombAllowed=(id,participant)=>!participant||!['mega','atom'].includes(id);
export function captureHint(state,me){
  const ctf=state?.ctf;if(!ctf||!me)return '';
  const enemy=me.team==='blue'?'red':'blue',own=ctf.flags[me.team],other=ctf.flags[enemy];
  if(ctf.phase==='won')return BATTLE_TEAMS[ctf.winner].name+' wins! Enemy flag captured. Army → New round.';
  if(ctf.phase==='setup')return ctf.bases[me.team]?'Your base is ready. Waiting for the other army to choose theirs.'
    :'Choose your base: stand on clear ground, then Army → Set home base here.';
  if(other?.carrier===me.id)return own?.status==='home'?'You have their flag! Bring it back to your home base.'
    :'You have their flag. Recover your own flag before you can win!';
  if(own?.status==='carried')return 'The enemy has your flag! Stop the carrier and recover it.';
  if(own?.status==='dropped')return 'Your flag is dropped. Touch it to return it to your base.';
  return 'Capture the enemy flag and bring it home. Find both flags on the Map.';
}
