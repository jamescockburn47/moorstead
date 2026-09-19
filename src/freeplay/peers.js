import * as THREE from 'three';
import { buildPlayerLookMesh } from '../entities.js';

export function peerVisibleFrom(peerPosition, viewerPosition) {
  if (!viewerPosition) return true;
  // Players can share a spawn or fly through one another. Do not render a
  // neighbour's torso and hat around the first-person camera when they overlap.
  return Math.hypot(peerPosition.x - viewerPosition.x, peerPosition.z - viewerPosition.z) >= .85
    || Math.abs(peerPosition.y - viewerPosition.y) >= 2.2;
}

export class FreeplayPeers {
  constructor(scene, ownId){this.scene=scene;this.ownId=ownId;this.players=new Map();}
  put(value){
    if(value.pid===this.ownId)return;
    let record=this.players.get(value.pid);
    if(!record){
      if(this.players.size>=16)return;
      const mesh=buildPlayerLookMesh({outfit:0,jacket:2,hat:1,skin:2,hair:1});
      const canvas=document.createElement('canvas');canvas.width=256;canvas.height=64;const context=canvas.getContext('2d');
      context.fillStyle='rgba(10,30,30,.8)';context.fillRect(0,0,256,64);context.fillStyle='#fff4d4';context.font='bold 26px sans-serif';context.textAlign='center';context.fillText(value.name,128,41,240);
      const texture=new THREE.CanvasTexture(canvas),label=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false}));label.position.y=2.5;label.scale.set(3,.75,1);mesh.add(label);
      record={mesh,label,texture,name:value.name,target:new THREE.Vector3(value.x,value.y,value.z)};this.players.set(value.pid,record);this.scene.add(mesh);mesh.position.copy(record.target);
    }
    record.name=value.name;record.target.set(value.x,value.y,value.z);record.mesh.rotation.y=value.yaw;
  }
  locations(){return [...this.players].map(([pid,p])=>({pid,name:p.name,x:p.target.x,y:p.target.y,z:p.target.z}));}
  remove(id){const p=this.players.get(id);if(!p)return;p.mesh.removeFromParent();p.label.material.dispose();p.texture.dispose();this.players.delete(id);}
  replace(values){for(const id of this.players.keys())this.remove(id);for(const value of values)this.put(value);}
  update(dt,viewerPosition=null){for(const p of this.players.values()){
    p.mesh.position.lerp(p.target,Math.min(1,dt*12));
    p.mesh.visible=peerVisibleFrom(p.mesh.position,viewerPosition);
  }}
  dispose(){for(const id of this.players.keys())this.remove(id);}
}
