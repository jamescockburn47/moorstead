// One procedural source for the client's visible moor and server combat collision.
import { Gen } from '../src/worldgen.js';
import { B, BLOCKS, isSolid } from '../src/defs.js';
import { BATTLE_REGION } from '../src/freeplay/battle-config.js';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mkdirSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function makeBattlefield(){
  const {origin:[ox,oz],width,height,seed}=BATTLE_REGION,g=new Gen(seed);
  const raw=Buffer.alloc(width*width*height*2),index=(x,y,z)=>((y*width+z)*width+x)*2;
  for(let cz=0;cz<width/16;cz++)for(let cx=0;cx<width/16;cx++){
    const cells=g.generateChunk(ox/16+cx,oz/16+cz);
    for(let y=0;y<height;y++)for(let z=0;z<16;z++)for(let x=0;x<16;x++)raw.writeUInt16LE(cells[x+z*16+y*256],index(cx*16+x,y,cz*16+z));
  }
  const get=(x,y,z)=>raw.readUInt16LE(index(x,y,z));
  const surface=(x,z)=>{for(let y=height-3;y>0;y--)if(isSolid(get(x,y,z)))return y+1;return null;};
  const camp=target=>{
    let best=null,score=Infinity;
    for(let z=16;z<width-16;z++)for(let x=target-9;x<=target+9;x++){
      const y=surface(x,z);if(!y||![B.GRASS,B.DIRT,B.PEAT,B.STONE,B.SAND].includes(get(x,y-1,z)))continue;
      let safe=true;
      for(let dz=-2;dz<=2;dz++)for(let dx=-2;dx<=2;dx++){
        if(Math.abs(surface(x+dx,z+dz)-y)>1||get(x+dx,y,z+dz)===B.WATER)safe=false;
      }
      const distance=Math.hypot(x-target,z-width/2);
      if(safe&&distance<score){score=distance;best=[ox+x+.5,y,oz+z+.5];}
    }
    if(!best)throw Error('No safe camp in the procedural battlefield');return best;
  };
  const header={version:1,...BATTLE_REGION,origin:[...BATTLE_REGION.origin],camps:{blue:camp(16),red:camp(width-17)},
    solidIds:[...new Set([...Object.keys(BLOCKS).map(Number).filter(isSolid),200,201,202,203,204,205,206,207,208])],
    sha256:createHash('sha256').update(raw).digest('hex')};
  return{header,raw};
}
export function exportBattlefield(directory){
  const {header,raw}=makeBattlefield();mkdirSync(directory,{recursive:true});
  writeFileSync(resolve(directory,'battlefield.json'),JSON.stringify(header,null,2));
  writeFileSync(resolve(directory,'battlefield.u16.zlib'),deflateSync(raw));return header;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(!process.argv[2])throw Error('Provide a generated-output directory');
  console.log(JSON.stringify(exportBattlefield(resolve(process.argv[2]))));
}
