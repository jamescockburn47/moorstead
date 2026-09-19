import { element } from './ui.js';
import { VEHICLE_MODES } from './vehicle-data.js';
import { vehiclePreview } from './vehicle-preview.js';
import { VEHICLE_KITS } from './vehicle-kits.js';

const button=(parent,text,action)=>{const b=element('button','',text,parent);b.type='button';b.onclick=action;return b;};
export function vehiclePanel(controller,parent){
  const g=controller.game,selection=controller.selection,ready=controller.vehicles.get(controller.justCreated);
  if(ready&&!selection){
    element('h3','','Ready to drive',parent);
    element('p','',ready.mode[0].toUpperCase()+ready.mode.slice(1)+' saved · '+ready.cells.length+' blocks',parent);
    const enter=button(parent,'Enter '+ready.mode,()=>controller.enter(ready.id));enter.classList.add('fp-primary');enter.disabled=!!ready.pilot;
    element('p','','1. Enter your vehicle. 2. Use the arrows to move'+(ready.mode==='car'?'.':' and Up / Down to rise or dive.')+' 3. Park when you want to get out.',parent);
  }
  if(selection?.kit){
    element('p','','Aim at clear ground and press the Place starter button. The highlighted shape is exactly what will be built.',parent);
    button(parent,'Continue placing starter',()=>g.ui.panel.close());
    button(parent,'Cancel starter',()=>{controller.cancelSelection();g.ui.open('vehicles');});
  }else if(selection){
    element('h3','','2. Review your vehicle',parent);
    if(selection.cells){
      element('p','',selection.cells.length+' blocks selected. Yellow is the control block.',parent);
      const label=element('label','','How should it move? ',parent),choice=element('select','',null,label);choice.setAttribute('aria-label','Vehicle movement');
      for(const mode of VEHICLE_MODES){const option=element('option','',mode[0].toUpperCase()+mode.slice(1),choice);option.value=mode;}
      choice.value=selection.mode||'car';
      const convert=button(parent,'Convert to '+choice.value,()=>controller.convert(choice.value));convert.classList.add('fp-primary');
      convert.disabled=!!controller.awaitConversion;
      choice.onchange=()=>{selection.mode=choice.value;convert.textContent='Convert to '+choice.value;};
      vehiclePreview(parent,selection.cells);
      element('p','','Convert saves these blocks as one vehicle. Then press Enter to drive it. Park saves its position; Edit build restores the blocks.',parent);
      button(parent,'See highlighted blocks',()=>g.ui.panel.close());
    }else element('p','',selection.error||'Mark the two corners of your build to finish the selection.',parent);
    button(parent,'Detect connected build again',()=>controller.selectCore(selection.core,selection.mode));
    button(parent,'Choose corners manually (advanced)',()=>controller.manualSelection());
    button(parent,'Cancel vehicle selection',()=>{controller.cancelSelection();g.ui.panel.close();});
  }else{
    element('h3','','1. Choose a build',parent);
    element('p','','Start with a ready-made vehicle, then change or expand its blocks however you like.',parent);
    for(const kit of VEHICLE_KITS){
      const b=button(parent,'Starter '+kit.name.toLowerCase(),()=>controller.kits.start(kit.id));
      b.title=kit.description;element('span','',kit.description,parent);
    }
    element('p','','Put one Vehicle control block on your build, then aim at it and press Use core. We find the connected blocks for you.',parent);
    button(parent,'Choose Vehicle control block',()=>g.ui.select({type:'block',id:206}));
  }
  element('h3','','3. Our saved vehicles · '+controller.vehicles.size+'/16',parent);
  if(!controller.vehicles.size)element('p','','Your converted vehicles will appear here for both of you.',parent);
  for(const v of [...controller.vehicles.values()].sort((a,b)=>(b.id===controller.justCreated)-(a.id===controller.justCreated))){
    if(v===ready&&!selection)continue;
    const row=element('div','fp-vehicle-row',null,parent);
    element('strong','',(v.id===controller.justCreated?'Ready! ':'')+v.mode[0].toUpperCase()+v.mode.slice(1)+' · '+v.cells.length+' blocks',row);
    element('span','',` ${Math.round(v.pose.x)}, ${Math.round(v.pose.y)}, ${Math.round(v.pose.z)}${v.pilot?' · being driven':''}`,row);
    if(controller.driving===v.id)button(row,'Park and get out',()=>controller.park());
    else{const b=button(row,'Enter '+v.mode,()=>controller.enter(v.id));b.disabled=!!v.pilot;}
    const edit=button(row,'Edit build',()=>controller.edit(v.id));edit.disabled=!!v.pilot;
  }
  element('p','','Maximum 512 placed blocks inside 16 × 12 × 16. Only your placed blocks are selected; the moor stays in place.',parent);
  element('p','','Driving: W/S or ↑/↓ move, A/D or ←/→ steer. Plane/submarine: Space or Up rises, Shift or Down dives. Change view switches camera. Park gets out.',parent);
}
