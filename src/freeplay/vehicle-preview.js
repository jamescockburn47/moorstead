// Exact-cell preview without another WebGL renderer or GPU resources.
const TINTS = { 3:'#6a727b',200:'#879fad',201:'#44d6e8',202:'#cf78e1',203:'#99d4df',204:'#465b72',205:'#637481',206:'#fff098',208:'#69776d' };
export function vehiclePreview(parent, cells) {
  const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
  canvas.style.cssText = 'display:block;width:100%;max-width:400px;height:auto;background:#152b36;border-radius:12px;margin:12px auto';
  canvas.setAttribute('role','img'); canvas.setAttribute('aria-label',`${cells.length} selected vehicle blocks; yellow marks the control`);
  parent.append(canvas); const c = canvas.getContext('2d'); if (!c || !cells.length) return;
  const low = [0,1,2].map(axis => Math.min(...cells.map(row => row[axis])));
  const project = (x,y,z) => [(x-z)*.866,(x+z)*.5-y];
  const local = cells.map(([x,y,z,id]) => [x-low[0],y-low[1],z-low[2],id]), corners = [];
  for (const [x,y,z] of local) for (const [dx,dy,dz] of [[0,0,0],[1,0,1],[0,1,0],[1,1,1],[1,0,0],[0,0,1]]) corners.push(project(x+dx,y+dy,z+dz));
  const minX = Math.min(...corners.map(p=>p[0])), maxX = Math.max(...corners.map(p=>p[0]));
  const minY = Math.min(...corners.map(p=>p[1])), maxY = Math.max(...corners.map(p=>p[1]));
  const scale = Math.min(280/Math.max(1,maxX-minX),140/Math.max(1,maxY-minY));
  const point = (x,y,z) => { const [px,py] = project(x,y,z); return [160+(px-(minX+maxX)/2)*scale,90+(py-(minY+maxY)/2)*scale]; };
  const face = (vertices, tint, shade) => {
    c.beginPath(); vertices.forEach((p,i)=>c[i?'lineTo':'moveTo'](...p)); c.closePath();
    c.fillStyle=tint;c.fill();c.fillStyle=`rgba(0,0,0,${shade})`;c.fill();c.strokeStyle='#173342';c.lineWidth=.7;c.stroke();
  };
  local.sort((a,b)=>(a[0]+a[2])-(b[0]+b[2]) || a[1]-b[1]);
  for (const [x,y,z,id] of local) {
    const tint=TINTS[id]||'#b19770';
    face([point(x,y,z+1),point(x+1,y,z+1),point(x+1,y+1,z+1),point(x,y+1,z+1)],tint,.22);
    face([point(x+1,y,z),point(x+1,y,z+1),point(x+1,y+1,z+1),point(x+1,y+1,z)],tint,.4);
    face([point(x,y+1,z),point(x+1,y+1,z),point(x+1,y+1,z+1),point(x,y+1,z+1)],tint,0);
  }
}
