import { integer } from './protocol.js';

export const VEHICLE_CORE=206, MAX_VEHICLES=16, MAX_VEHICLE_CELLS=512;
export const VEHICLE_MODES=Object.freeze(['car','plane','submarine']);
export function validPose(p){return p&&[p.x,p.y,p.z,p.yaw].every(Number.isFinite)
  &&Math.abs(p.x)<=8192&&Math.abs(p.z)<=8192&&p.y>=1&&p.y<=180&&Math.abs(p.yaw)<=1000;}
export function validVehicle(v){
  if(!v||typeof v.id!=='string'||v.id.length>80||!v.id||!VEHICLE_MODES.includes(v.mode)||!validPose(v.pose)
    ||!(v.pilot==null||typeof v.pilot==='string'&&v.pilot.length<=80)
    ||!Array.isArray(v.cells)||!v.cells.length||v.cells.length>MAX_VEHICLE_CELLS
    ||!Array.isArray(v.core)||v.core.length!==3)return false;
  const keys=new Set();let core=false;
  for(const row of v.cells){
    if(!Array.isArray(row)||row.length!==4||!integer(row[0],0,15)||!integer(row[1],0,11)
      ||!integer(row[2],0,15)||!integer(row[3],1,255))return false;
    const key=row.slice(0,3).join(',');if(keys.has(key))return false;keys.add(key);
    if(row[3]===VEHICLE_CORE&&v.core.every((n,i)=>n===row[i]))core=true;
  }
  return core;
}
export function selectVehicleCells(world,a,b,core){
  const from=a.map((n,i)=>Math.min(n,b[i])),to=a.map((n,i)=>Math.max(n,b[i]));
  if(from[1]<1||to[1]>63||to.some((n,i)=>n-from[i]+1>[16,12,16][i]))throw Error('Keep the highlight within 16 × 12 × 16 blocks.');
  if(core.some((n,i)=>n<from[i]||n>to[i]))throw Error('Include the Vehicle control block in the highlight.');
  const cells=[];
  for(let x=from[0];x<=to[0];x++)for(let z=from[2];z<=to[2];z++){
    if(!world.isLoaded(x,z))throw Error('Wait for the whole build to load.');
    for(let y=from[1];y<=to[1];y++){
      const id=world.overrides.getCell(x,y,z);if(id>0)cells.push([x,y,z,id]);
    }
  }
  if(!cells.some(r=>r[3]===VEHICLE_CORE&&core.every((n,i)=>n===r[i])))throw Error('Place a Vehicle control block on your build first.');
  if(cells.filter(r=>r[3]===VEHICLE_CORE).length!==1)throw Error('A vehicle needs exactly one Vehicle control block. Remove the extra controls.');
  if(cells.length>MAX_VEHICLE_CELLS)throw Error('Highlight up to 512 placed blocks for one vehicle.');
  return{from,to,core,cells};
}
export function parkedCells(vehicle){
  const p=vehicle.pose,quarter=((Math.floor(p.yaw/(Math.PI/2)+.5)%4)+4)%4;
  const origin=[p.x,p.y,p.z].map(n=>Math.floor(n+.5));
  return vehicle.cells.map(([x,y,z,id])=>{
    const [rx,rz]=[[x,z],[-z,x],[-x,-z],[z,-x]][quarter];
    return[origin[0]+rx,origin[1]+y,origin[2]+rz,id];
  });
}
