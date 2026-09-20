import * as THREE from 'three';
import { BATTLE_TEAMS } from './battle-models.js';

export class BattleZones {
  constructor(parent){
    this.geometry=new THREE.CylinderGeometry(1,1,1,48,1,true);
    this.material=new THREE.MeshBasicMaterial({transparent:true,opacity:.12,side:THREE.DoubleSide,depthWrite:false,toneMapped:false});
    this.mesh=new THREE.InstancedMesh(this.geometry,this.material,2);this.mesh.frustumCulled=false;this.mesh.count=0;parent.add(this.mesh);
    this.ringGeometry=new THREE.RingGeometry(.92,1,48);
    this.ringMaterial=new THREE.MeshBasicMaterial({transparent:true,opacity:.65,side:THREE.DoubleSide,depthWrite:false,toneMapped:false});
    this.rings=new THREE.InstancedMesh(this.ringGeometry,this.ringMaterial,2);this.rings.frustumCulled=false;this.rings.count=0;parent.add(this.rings);
    this.pose=new THREE.Object3D();this.colour=new THREE.Color();
  }
  update(ctf,world){
    let count=0;
    if(ctf?.objective==='zone')for(const team of ['blue','red']){
      const base=ctf.bases[team];if(!base||world?.isLoaded&&!world.isLoaded(base[0],base[2]))continue;
      const radius=ctf.captureRadius||3;
      // Full-height boundary makes the footprint explicit even with an elevated flag.
      this.pose.position.set(base[0],32,base[2]);this.pose.rotation.set(0,0,0);this.pose.scale.set(radius,64,radius);this.pose.updateMatrix();
      this.mesh.setMatrixAt(count,this.pose.matrix);this.mesh.setColorAt(count,this.colour.set(BATTLE_TEAMS[team]));
      const y=world?.surfaceY?.(base[0],base[2])??base[1];
      this.pose.position.y=y+.06;this.pose.rotation.x=-Math.PI/2;this.pose.scale.set(radius,radius,1);this.pose.updateMatrix();
      this.rings.setMatrixAt(count,this.pose.matrix);this.rings.setColorAt(count++,this.colour);
    }
    for(const mesh of [this.mesh,this.rings]){mesh.count=count;mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;}
  }
  clear(){this.mesh.count=this.rings.count=0;}
  dispose(){for(const mesh of [this.mesh,this.rings]){mesh.removeFromParent();mesh.dispose();}this.geometry.dispose();this.material.dispose();this.ringGeometry.dispose();this.ringMaterial.dispose();}
}
