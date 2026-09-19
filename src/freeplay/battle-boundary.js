import * as THREE from 'three';

export function boundaryPoints(bounds){
  const {minX,minZ,maxX,maxZ}=bounds,points=[];
  for(let i=0;i<16;i++){
    const t=i/16;
    points.push([minX+1+(maxX-minX-2)*t,minZ+1]);
  }
  for(let i=0;i<16;i++)points.push([maxX-1,minZ+1+(maxZ-minZ-2)*i/16]);
  for(let i=0;i<16;i++)points.push([maxX-1-(maxX-minX-2)*i/16,maxZ-1]);
  for(let i=0;i<16;i++)points.push([minX+1,maxZ-1-(maxZ-minZ-2)*i/16]);
  return points;
}

// A fixed pool of terrain-following posts and rails marks the enforced arena edge.
export class BattleBoundary{
  constructor(scene,world){
    this.world=world;this.timer=0;this.geometry=new THREE.BoxGeometry(1,1,1);
    this.material=new THREE.MeshBasicMaterial({color:0xffd274,transparent:true,opacity:.65,depthWrite:false});
    this.mesh=new THREE.InstancedMesh(this.geometry,this.material,128);this.mesh.name='warzone-boundary';
    this.mesh.frustumCulled=false;this.mesh.visible=false;this.mesh.count=0;scene.add(this.mesh);
    this.dummy=new THREE.Object3D();this.up=new THREE.Vector3(0,1,0);
  }
  update(dt,state,visible){
    this.mesh.visible=!!visible;if(!visible||!state?.bounds)return;
    this.timer-=dt;if(this.timer>0)return;this.timer=.5;
    const points=boundaryPoints(state.bounds).map(([x,z])=>new THREE.Vector3(x,(this.world.surfaceY?.(x,z)??this.world.gen?.geo?.height(x,z)??32)+1,z));
    let index=0;
    for(let i=0;i<points.length;i++){
      const point=points[i],next=points[(i+1)%points.length];
      this.dummy.position.copy(point);this.dummy.position.y+=3;this.dummy.quaternion.identity();this.dummy.scale.set(.13,6,.13);this.dummy.updateMatrix();this.mesh.setMatrixAt(index++,this.dummy.matrix);
      const direction=new THREE.Vector3().subVectors(next,point);
      this.dummy.position.copy(point).add(next).multiplyScalar(.5);this.dummy.position.y+=3;
      this.dummy.quaternion.setFromUnitVectors(this.up,direction.clone().normalize());this.dummy.scale.set(.1,direction.length(),.1);this.dummy.updateMatrix();this.mesh.setMatrixAt(index++,this.dummy.matrix);
    }
    this.mesh.count=index;this.mesh.instanceMatrix.needsUpdate=true;
  }
  dispose(){this.mesh.removeFromParent();this.mesh.dispose();this.geometry.dispose();this.material.dispose();}
}
