import * as THREE from 'three';
import { BATTLE_TEAMS } from './battle-models.js';

// Ten machines, six simple shared box parts each; no per-frame allocations.
export class BattleEquipment {
  constructor(parent) {
    this.geometry=new THREE.BoxGeometry(1,1,1);
    this.material=new THREE.MeshLambertMaterial();
    this.mesh=new THREE.InstancedMesh(this.geometry,this.material,60);
    this.mesh.frustumCulled=false;this.mesh.count=0;parent.add(this.mesh);
    this.pose=new THREE.Object3D();this.part=new THREE.Object3D();this.matrix=new THREE.Matrix4();this.colour=new THREE.Color();
  }
  begin(){this.count=0;}
  put(actor){
    if(actor.knocked)return;
    this.pose.position.copy(actor.current);this.pose.rotation.set(0,actor.yaw,0);this.pose.updateMatrix();
    const tint=BATTLE_TEAMS[actor.team],tank=actor.kind==='tank';
    const parts=tank?[[0,.6,0,1.9,.65,2.2,tint],[-.95,.35,0,.35,.6,2.4,0x283343],
      [.95,.35,0,.35,.6,2.4,0x283343],[0,1.12,0,1,.5,1,tint],[0,1.35,1,.18,.18,1.5,0xffd579]]
      :[[0,.15,0,1.6,.3,1.6,0x283343],[0,.65,0,.35,1,.35,tint],
        [0,1.2,0,.8,.45,.7,tint],[0,1.4,.65,.14,.14,1.2,0xffd579]];
    for(const [x,y,z,sx,sy,sz,colour] of parts){
      this.part.position.set(x,y,z);this.part.scale.set(sx,sy,sz);this.part.updateMatrix();
      this.matrix.multiplyMatrices(this.pose.matrix,this.part.matrix);
      this.mesh.setMatrixAt(this.count,this.matrix);this.mesh.setColorAt(this.count++,this.colour.set(colour));
    }
  }
  end(){this.mesh.count=this.count;this.mesh.instanceMatrix.needsUpdate=true;if(this.mesh.instanceColor)this.mesh.instanceColor.needsUpdate=true;}
  dispose(){this.mesh.removeFromParent();this.mesh.dispose();this.geometry.dispose();this.material.dispose();}
}
