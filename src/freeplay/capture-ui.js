import { BATTLE_TEAMS } from './battle-config.js';

export const warBombAllowed=(id,participant)=>!participant||!['mega','atom'].includes(id);
export function captureHint(state,me){
  const ctf=state?.ctf;if(!ctf||!me)return '';
  const enemy=me.team==='blue'?'red':'blue',own=ctf.flags[me.team],other=ctf.flags[enemy];
  if(ctf.phase==='won')return BATTLE_TEAMS[ctf.winner].name+' wins! '+(ctf.reason==='forfeit'?'The other army forfeited.':'Enemy flag captured.')+' Play another round or return to Free Play.';
  if(ctf.paused)return 'Battle paused while the other player reconnects. Your soldiers and base are kept.';
  if(ctf.phase==='setup')return ctf.ready?.[me.team]?'Your flag is ready. Waiting for the other army. Guns unlock when both are ready.'
    :'Choose your base: stand inside it on clear ground, then Place flag & ready. Guns unlock when both are ready.';
  if(other?.carrier===me.id)return own?.status==='home'?'You have their flag! Bring it back to your home base.'
    :'You have their flag. Recover your own flag before you can win!';
  if(own?.status==='carried')return 'The enemy has your flag! Stop the carrier and recover it.';
  if(own?.status==='dropped')return 'Your flag is dropped. Touch it to return it to your base.';
  return 'Soldiers attack automatically. Advance behind cover, steal their flag and bring it home. Map shows both flags.';
}
