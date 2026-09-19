import { isSolid } from '../defs.js';

function cellsFor(kind) {
  const cells=new Map(),put=(x,y,z,id=200)=>cells.set(`${x},${y},${z}`,[x,y,z,id]);
  if(kind==='car'){
    for(const x of [0,2])for(const z of [0,4])put(x,0,z,3);
    for(let x=0;x<3;x++)for(let z=0;z<5;z++)put(x,1,z);
    for(let x=0;x<3;x++){put(x,2,0,201);put(x,2,1,203);put(x,2,4);}
    put(0,2,3);put(2,2,3);put(1,2,2,206);
  }else if(kind==='plane'){
    for(let z=0;z<7;z++)put(4,1,z);
    for(let x=0;x<9;x++)put(x,1,3,x===0||x===8?201:200);
    for(let x=2;x<7;x++)put(x,1,6);
    for(const x of [3,5])put(x,0,3,3);put(4,0,1,3);
    put(4,2,2,206);put(4,2,1,203);put(4,2,0,201);put(4,2,6);put(4,3,6,201);
    put(2,1,2,204);put(6,1,2,204);
  }else if(kind==='tank'){
    for(const x of [0,4])for(let y=0;y<2;y++)for(let z=0;z<6;z++)put(x,y,z,3);
    for(let x=1;x<4;x++)for(let z=0;z<6;z++)put(x,1,z,208);
    for(let x=1;x<4;x++)for(let z=2;z<5;z++)put(x,2,z,208);
    put(2,3,3,206);put(2,2,1,208);put(2,2,0,201);
  }else{
    for(let z=0;z<7;z++){put(1,0,z,204);for(let x=0;x<3;x++)put(x,1,z,200);}
    for(let x=0;x<3;x++)for(let z=2;z<5;z++)put(x,2,z,203);
    put(1,2,0,201);put(1,2,6);put(1,3,4,204);put(1,3,6);put(1,2,3,206);
  }
  return [...cells.values()].map(row=>Object.freeze(row));
}
export const VEHICLE_KITS=Object.freeze([
  {id:'car',name:'Car',mode:'car',description:'Four wheels, open cockpit. Drive and steer.'},
  {id:'plane',name:'Plane',mode:'plane',description:'Broad wings and a tail. Hold Up to take off.'},
  {id:'tank',name:'Tank body',mode:'car',description:'Car controls and a decorative turret; no firing cannon.'},
  {id:'submarine',name:'Submarine',mode:'submarine',description:'Drives slowly on land; rises and dives in water.'},
].map(kit=>Object.freeze({...kit,cells:Object.freeze(cellsFor(kit.id))})));
export const vehicleKit=id=>VEHICLE_KITS.find(kit=>kit.id===id);

export function placeVehicleKit(kit,hit,world,player) {
  if(!kit||!hit||hit.face?.[1]!==1)throw Error('Aim at the top of nearby ground to place the starter.');
  const size=[0,1,2].map(axis=>1+Math.max(...kit.cells.map(row=>row[axis])));
  const origin=[hit.x-Math.floor(size[0]/2),hit.y+1,hit.z-Math.floor(size[2]/2)];
  // Lift slightly above uneven natural ground. Never overwrite an authored block.
  for(let lift=0;lift<=4;lift++){
    const from=[origin[0],origin[1]+lift,origin[2]],to=from.map((n,i)=>n+size[i]-1);
    if(from[0]<-8192||to[0]>8192||from[2]<-8192||to[2]>8192||from[1]<1||to[1]>63)throw Error('Keep the whole starter inside the buildable world.');
    let blocked=false;
    for(let x=from[0];x<=to[0];x++)for(let z=from[2];z<=to[2];z++){
      if(!world.isLoaded(x,z))throw Error('Wait for the whole starter area to load.');
      for(let y=from[1];y<=to[1];y++){
        if(world.overrides.getCell(x,y,z)>0)throw Error('Move the starter outline away from placed blocks.');
        if(isSolid(world.getBlock(x,y,z)))blocked=true;
      }
    }
    if(blocked)continue;
    const rows=kit.cells.map(([x,y,z,id])=>[from[0]+x,from[1]+y,from[2]+z,id]);
    if(rows.some(([x,y,z])=>Math.abs(x+.5-player.x)<.8&&Math.abs(z+.5-player.z)<.8&&y+1>player.y&&y<player.y+1.8))throw Error('Step back from the starter outline.');
    const touching=rows.some(([x,y,z])=>[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].some(([dx,dy,dz])=>world.overrides.getCell(x+dx,y+dy,z+dz)>0));
    if(touching)continue;
    return {rows,from,to,core:rows.find(row=>row[3]===206).slice(0,3)};
  }
  throw Error('Choose a clearer patch of ground for this starter.');
}
