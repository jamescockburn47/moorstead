import { element } from './ui.js';

export function playGuide(parent){
  const sections=[
    ['Build and drive','Open Vehicles for a starter design, or build your own and add one Vehicle control block. Use the control to highlight the connected build, choose Car, Plane or Submarine, then Convert. Enter it to drive. Park before editing it.'],
    ['Start a battle','Menu → Battlefield / armies. Choose opposite teams. Build a base inside the gold boundary, stand on clear ground inside it, then Place flag & ready. Both players ready starts the fight.'],
    ['Command soldiers','Recruit 6 soldiers at a time, up to 24 per side. They automatically advance and fight. Attack sends them forward; Defend our flag guards your base; Follow me keeps them beside you.'],
    ['Fire and defend','Aim with the crosshair and hold Fire on a tablet. On a computer, click the world to capture the mouse, then hold left click. Hills and walls stop shots. The blue shield bar takes damage before the green health bar.'],
    ['Build to win','Trenches and sandbags shelter troops from fire; bunkers protect your flag. A watchpost lets you aim over low cover but leaves you exposed. Leave openings and steps so your army has a route through.'],
    ['Capture the flag','Walk up to the enemy flag, carry it home, and keep your own flag safe. Soldiers fight; players carry flags. Capture wins. Stay in the warzone until the round ends, or choose Army → Forfeit battle.'],
    ['Move and look','Computer: WASD to walk, drag or mouse to look, Space to jump, F to fly outside battle. Tablet: hold the movement arrows and drag the world to look. Map shows each player and both flags.']
  ];
  for(const [title,text]of sections){const box=element('section','fp-guide-section',null,parent);element('h3','',title,box);element('p','',text,box);}
}
