import * as THREE from 'three';
import { buildShape } from './build-shapes.js';

export function buildCommand(selection, hit) {
  if (!hit || selection.type !== 'build') return null;
  const origin=[hit.x+hit.face[0],hit.y+hit.face[1],hit.z+hit.face[2]];
  const fields={shape:selection.shape,origin,rotation:selection.rotation||0,block:selection.block};
  if(selection.size != null)fields.size=selection.size;
  return fields;
}
export function placementProblem(rows, world, player) {
  if(rows.some(([x,,z])=>!world.isLoaded(x,z)))return 'Wait for the whole build area to load.';
  if(rows.some(([x,y,z,id])=>id && Math.abs(x+.5-player.x)<.8 && Math.abs(z+.5-player.z)<.8 && y+1>player.y && y<player.y+1.8))return 'Step back or fly above the build preview.';
  return null;
}
export class BuildPreview {
  constructor(game) {
    this.game=game;this.key='';this.rows=[];this.fields=null;this.problem=null;
    this.geometry=new THREE.BoxGeometry(.99,.99,.99);
    this.material=new THREE.MeshBasicMaterial({color:0x53e9f5,transparent:true,opacity:.12,depthWrite:false});
    this.mesh=new THREE.InstancedMesh(this.geometry,this.material,1024);this.mesh.frustumCulled=false;
    this.mesh.count=0;this.mesh.renderOrder=5;this.dummy=new THREE.Object3D();game.scene.add(this.mesh);
    this.outline=new THREE.LineSegments(new THREE.EdgesGeometry(this.geometry),new THREE.LineBasicMaterial({color:0x53e9f5}));game.scene.add(this.outline);
  }
  update(selection,hit) {
    this.mesh.visible=selection.type==='build'&&!this.game.paused&&!!hit;
    this.outline.visible=this.mesh.visible;
    if(!this.mesh.visible)return;
    const fields=buildCommand(selection,hit),key=JSON.stringify(fields);
    if(key!==this.key){
      this.key=key;this.fields=fields;this.problem=null;
      try{this.rows=buildShape(fields);}catch(error){this.rows=[];this.problem=error.message;}
      let count=0;
      for(const [x,y,z,id] of this.rows)if(id){this.dummy.position.set(x+.5,y+.5,z+.5);this.dummy.updateMatrix();this.mesh.setMatrixAt(count++,this.dummy.matrix);}
      this.mesh.count=count;this.mesh.instanceMatrix.needsUpdate=true;
      if(this.rows.length){
        const min=[0,1,2].map(axis=>Math.min(...this.rows.map(row=>row[axis]))),max=[0,1,2].map(axis=>Math.max(...this.rows.map(row=>row[axis])));
        this.outline.position.set(...min.map((v,i)=>(v+max[i]+1)/2));this.outline.scale.set(...min.map((v,i)=>max[i]-v+1));
      }
    }
    const problem=this.problem||placementProblem(this.rows,this.game.world,this.game.player.pos);
    this.material.color.setHex(problem?0xff6a6a:0x53e9f5);
    this.outline.material.color.copy(this.material.color);
  }
  use(selection,hit) {
    this.update(selection,hit);
    const problem=this.problem||placementProblem(this.rows,this.game.world,this.game.player.pos);
    if(problem){this.game.ui.message(problem);return false;}
    return !!this.fields&&this.rows.length>0&&this.game.send('build',this.fields);
  }
  dispose(){this.outline.removeFromParent();this.outline.geometry.dispose();this.outline.material.dispose();this.mesh.removeFromParent();this.mesh.dispose();this.geometry.dispose();this.material.dispose();}
}
