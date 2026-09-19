import * as THREE from 'three';
import { B, isSolid, isCutout } from '../defs.js';
import { raycast } from '../physics.js';
import { bombById, DEFAULT_BLOCK } from './catalogue.js';

export class FreeplayActions {
  constructor(game) {
    this.game = game; this.selected = { type: 'block', id: DEFAULT_BLOCK }; this.fuse = null;
    this.direction = new THREE.Vector3();
    const outline = new THREE.BoxGeometry(1.015,1.015,1.015);
    this.box = new THREE.LineSegments(new THREE.EdgesGeometry(outline),
      new THREE.LineBasicMaterial({color:0xffe6a0,depthTest:false,transparent:true,opacity:.8}));
    outline.dispose();
    this.box.renderOrder=8;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(.98,1,80),new THREE.MeshBasicMaterial({color:0xffbd54,side:THREE.DoubleSide,transparent:true,opacity:.65,depthWrite:false}));
    this.ring.rotation.x=-Math.PI/2;
    this.projectile = new THREE.Mesh(new THREE.SphereGeometry(.2,10,8),new THREE.MeshStandardMaterial({color:0xeac36c,emissive:0x543900,roughness:.7}));
    this.projectile.visible=false; game.scene.add(this.box,this.ring,this.projectile);
  }
  target() {
    const g=this.game,p=g.player;g.camera.getWorldDirection(this.direction);
    const hit=raycast(g.world,p.pos.x,p.pos.y+p.eye,p.pos.z,this.direction.x,this.direction.y,this.direction.z,
      this.selected.type==='bomb'?80:10,id=>!!(isSolid(id)||isCutout(id)));
    return hit&&g.world.isLoaded(hit.x,hit.z)?hit:null;
  }
  choose(value){this.selected=value;}
  update(dt) {
    const g=this.game,hit=this.target(),bomb=bombById(this.selected.id);
    this.hit=hit;this.box.visible=!!hit&&!g.paused;this.ring.visible=!!hit&&!!bomb&&this.selected.type==='bomb'&&!g.paused;
    if(hit){this.box.position.set(hit.x+.5,hit.y+.5,hit.z+.5);this.ring.position.set(hit.x+.5,hit.y+1.04,hit.z+.5);if(bomb)this.ring.scale.setScalar(bomb.radius);}
    if(!this.fuse)return;
    if(!g.connection.connected||g.connection.epoch!==this.fuse.epoch||g.connection.socket!==this.fuse.socket){
      this.cancel();g.ui.message('Throw cancelled while the shared world changed or reconnected.');return;
    }
    const f=this.fuse;f.elapsed+=dt;
    const t=f.bomb.delivery==='place'?1:Math.min(1,f.elapsed/Math.min(1.1,f.bomb.fuse*.65));
    this.projectile.position.lerpVectors(f.origin,f.target,t);this.projectile.position.y+=Math.sin(t*Math.PI)*4;
    g.ui.message(f.bomb.name+' · '+Math.max(0,Math.ceil(f.bomb.fuse-f.elapsed))+'…');
    if(f.elapsed>=f.bomb.fuse){
      if(g.send('blast',{bomb:f.bomb.id,center:[f.target.x,f.target.y,f.target.z]}))this.cancel();
      else g.ui.message(f.bomb.name+' queued · waiting for the shared world…');
    }
  }
  use() {
    const g=this.game,hit=this.target();if(!g.canEdit()||!hit)return;
    if(this.selected.type==='bomb'){
      const bomb=bombById(this.selected.id);if(!bomb||this.fuse)return;
      this.fuse={bomb,elapsed:0,epoch:g.connection.epoch,socket:g.connection.socket,origin:g.camera.position.clone(),target:new THREE.Vector3(hit.x,Math.min(63,hit.y+1),hit.z)};
      this.projectile.visible=true;g.unlockAudio();return;
    }
    const [dx,dy,dz]=hit.face,x=hit.x+dx,y=hit.y+dy,z=hit.z+dz,p=g.player.pos;
    if(y<1||y>63)return g.ui.message('Build between the bedrock and the sky.');
    if(!g.world.isLoaded(x,z))return g.ui.message('Wait for that part of the moor to load.');
    if(Math.abs(x+.5-p.x)<.8&&Math.abs(z+.5-p.z)<.8&&y+1>p.y&&y<p.y+1.8)return g.ui.message('Take a step back to place that block.');
    g.send('edit',{edits:[[x,y,z,this.selected.id]]});
  }
  break(){const hit=this.target();if(this.game.canEdit()&&hit&&hit.y>=1)this.game.send('edit',{edits:[[hit.x,hit.y,hit.z,B.AIR]]});}
  primary(){if(this.selected.type==='bomb')this.use();else this.break();}
  cancel(){this.fuse=null;this.projectile.visible=false;}
  dispose(){for(const object of [this.box,this.ring,this.projectile]){object.removeFromParent();object.geometry.dispose();object.material.dispose();}}
}
