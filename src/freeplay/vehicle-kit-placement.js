import { placeVehicleKit, vehicleKit } from './vehicle-kits.js';

export class VehicleKitPlacement {
  constructor(controller){this.controller=controller;this.pending=null;}
  start(id){
    const c=this.controller,g=c.game,kit=vehicleKit(id);if(!kit)return;
    c.cancelSelection();g.ui.select({type:'block',id:206});
    c.idleLabel=g.ui.selection?.textContent;
    c.selection={kit:id};g.ui.message('Aim the '+kit.name.toLowerCase()+' outline at clear ground, then press Place '+kit.name.toLowerCase()+'.');
  }
  update(hit){
    const c=this.controller,g=c.game,s=c.selection;if(!s?.kit)return;
    const kit=vehicleKit(s.kit);
    if(this.pending){g.ui.selection.textContent='Saving '+kit.name.toLowerCase()+' starter…';return;}
    const key=JSON.stringify([hit,g.connection.revision,g.world.chunks?.size]);
    if(key!==s.previewKey){
      s.previewKey=key;s.problem=null;s.rows=null;
      try{s.rows=placeVehicleKit(kit,hit,g.world,g.player.pos).rows;}
      catch(error){s.problem=error.message;}
      c.renderer.setSelection(s.rows);
    }
    g.ui.selection.textContent=s.problem||kit.name+' starter · '+kit.cells.length+' blocks · Place to build';
  }
  place(hit){
    if(this.pending)return true;
    const c=this.controller,g=c.game,kit=vehicleKit(c.selection?.kit);if(!kit)return false;
    if(!g.canEdit())return true;
    try{
      const placement=placeVehicleKit(kit,hit,g.world,g.player.pos);
      if(g.send('edit',{edits:placement.rows}))this.pending={requestId:g.connection.pending,core:placement.core,mode:kit.mode};
    }catch(error){g.ui.message(error.message);}
    return true;
  }
  committed(transfer){
    if(!this.pending||transfer.requestId!==this.pending.requestId)return;
    const {core,mode}=this.pending;this.pending=null;this.controller.selectCore(core,mode);
  }
  cancel(){this.pending=null;}
}
