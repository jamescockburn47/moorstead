import { BATTLE_TEAMS } from './battle-config.js';

export const warBombAllowed=(id,participant)=>!participant||!['mega','atom'].includes(id);
export function captureHint(state,me){
  const ctf=state?.ctf;if(!ctf||!me)return '';
  if(ctf.phase==='won')return BATTLE_TEAMS[ctf.winner].name+' wins! '+(ctf.reason==='forfeit'?'The other army forfeited.':'Enemy flag captured.')+' Play another round or return to Free Play.';
  if(ctf.paused)return 'Battle paused while the other player reconnects. Your soldiers and base are kept.';
  if(ctf.phase==='setup')return ctf.ready?.[me.team]?'Your flag is ready. Waiting for the other army. Guns unlock when both are ready.'
    :'Choose your base: stand inside it on clear ground, then Place flag & ready. Guns unlock when both are ready.';
  return 'Enter the enemy highlighted flag zone to win. Army → Attack sends your selected squads. High flags can be captured from below.';
}
