import { element } from './ui.js';
import { VEHICLE_MODES } from './vehicle-data.js';

const button=(parent,text,action)=>{const b=element('button','',text,parent);b.type='button';b.onclick=action;return b;};
export function vehiclePanel(controller,parent){
  const g=controller.game,selection=controller.selection;
  element('p','','Build anything, add a Vehicle control block, then aim at it and press E or Use core. Highlight two opposite corners around your build.',parent);
  element('p','','Only placed blocks become the vehicle. Maximum 512 blocks inside 16 × 12 × 16. Park keeps it saved; Edit build turns it back into blocks.',parent);
  if(selection){
    element('h3','','Your highlighted build',parent);
    element('p','',selection.cells?selection.cells.length+' blocks selected. Choose how it moves.':'Aim at one corner and press Mark corner, then mark the opposite corner. Include the control block.',parent);
    if(selection.cells){
      for(const mode of VEHICLE_MODES)button(parent,'Make '+mode,()=>controller.convert(mode));
    }
    button(parent,selection.cells?'Highlight again':'Start highlighting',()=>{selection.first=null;delete selection.cells;controller.renderer.setSelection(null);g.ui.panel.close();});
    button(parent,'Cancel highlight',()=>{controller.cancelSelection();g.ui.panel.close();});
  }
  element('h3','','Our saved vehicles · '+controller.vehicles.size+'/16',parent);
  if(!controller.vehicles.size)element('p','','Your vehicles will appear here for both of you.',parent);
  for(const v of controller.vehicles.values()){
    const row=element('div','fp-vehicle-row',null,parent);
    element('strong','',v.mode[0].toUpperCase()+v.mode.slice(1)+' · '+v.cells.length+' blocks',row);
    element('span','',` ${Math.round(v.pose.x)}, ${Math.round(v.pose.y)}, ${Math.round(v.pose.z)}${v.pilot?' · being driven':''}`,row);
    if(controller.driving===v.id)button(row,'Park and get out',()=>controller.park());
    else{const b=button(row,'Enter '+v.mode,()=>controller.enter(v.id));b.disabled=!!v.pilot;}
    const edit=button(row,'Edit build',()=>controller.edit(v.id));edit.disabled=!!v.pilot;
  }
  element('p','','Driving: W/S or ↑/↓ move, A/D or ←/→ steer. Plane/submarine: Space or Up rises, Shift or Down dives. V changes view. E or Park gets out.',parent);
}
