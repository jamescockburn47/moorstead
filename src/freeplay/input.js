import { captureMouse } from '../preferences.js';

export class FreeplayInput {
  constructor(game, canvas, root) {
    this.game=game; this.canvas=canvas; this.keys={}; this.jumpTapped=false; this.paused=false;
    this.controller=new AbortController(); const options={signal:this.controller.signal};
    const listen=(target,type,fn,extra={})=>target.addEventListener(type,fn,{...options,...extra});
    listen(window,'keydown',e=>{
      if(e.code==='KeyM'&&!e.repeat&&!/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)){
        e.preventDefault();if(game.ui.panel.open)game.ui.panel.close();else game.ui.open('map');return;
      }
      if (this.paused || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
      this.keys[e.code]=true;
      if (!e.repeat) {
        if (e.code==='Space') this.jumpTapped=true;
        if (e.code==='KeyF') game.fly();
        if (e.code==='KeyB') game.ui.open('build');
        if (e.code==='KeyX') game.ui.open('bombs');
        if (e.code==='Escape') game.ui.open('menu');
      }
    });
    listen(window,'keyup',e=>{ delete this.keys[e.code]; });
    listen(window,'blur',()=>this.clear());
    listen(document,'visibilitychange',()=>{ if(document.hidden)this.clear(); });
    listen(canvas,'contextmenu',e=>e.preventDefault());
    listen(canvas,'pointerdown',e=>{
      if(this.paused)return;
      game.unlockAudio();
      if(e.pointerType==='mouse' && document.pointerLockElement===canvas){
        if(e.button===2)game.use(); else if(e.button===0)game.primary(); return;
      }
      this.drag={id:e.pointerId,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,button:e.button,type:e.pointerType};
      canvas.setPointerCapture(e.pointerId);
    });
    listen(canvas,'pointermove',e=>{
      if(this.paused)return;
      if(document.pointerLockElement===canvas){this.look(e.movementX,e.movementY);return;}
      if(this.drag?.id!==e.pointerId)return;
      this.look(e.clientX-this.drag.x,e.clientY-this.drag.y); this.drag.x=e.clientX;this.drag.y=e.clientY;
    });
    listen(canvas,'pointerup',e=>{
      const drag=this.drag;if(!drag||drag.id!==e.pointerId)return;this.drag=null;
      if(drag.type==='mouse'&&Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)<5){
        if(drag.button===2)game.use();
        else captureMouse(canvas,()=>game.ui.message('Drag to look. Use Place or Break to build.'));
      }
    });
    listen(canvas,'pointercancel',()=>{this.drag=null;});
    for(const button of root.querySelectorAll('[data-key]')){
      listen(button,'pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);this.keys[button.dataset.key]=true;});
      const release=()=>{delete this.keys[button.dataset.key];};
      listen(button,'pointerup',release);listen(button,'pointercancel',release);listen(button,'lostpointercapture',release);
    }
  }
  look(dx,dy){
    this.game.player.yaw=(this.game.player.yaw-dx*.003)%(Math.PI*2);
    this.game.player.pitch=Math.max(-1.5,Math.min(1.5,this.game.player.pitch-dy*.003));
  }
  update(dt){
    if(this.paused)return;
    this.look(((this.keys.ArrowRight?1:0)-(this.keys.ArrowLeft?1:0))*dt*350,
      ((this.keys.ArrowDown?1:0)-(this.keys.ArrowUp?1:0))*dt*350);
  }
  clear(){this.keys={};this.jumpTapped=false;this.drag=null;}
  pause(value){this.paused=value;this.clear();}
  dispose(){this.controller.abort();this.clear();document.exitPointerLock?.();}
}
