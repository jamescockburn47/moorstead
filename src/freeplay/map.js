import { fitMap, projectMap, mapHeading, peerGuidance } from './map-math.js';

const distanceText = value => value >= 1000 ? (value / 1000).toFixed(1) + ' km' : Math.round(value) + ' m';
const textNode = (tag, parent, text, className = '') => {
  const node = document.createElement(tag); node.className = className;
  node.textContent = text; parent.append(node); return node;
};

// Read-only navigation. It uses the existing relay positions, never account saves.
export class FreeplayMap {
  constructor(game) {
    this.game = game; this.mode = 'together'; this.timer = 0; this.canvas = null;
    this.base = document.createElement('canvas'); this.base.width = 640; this.base.height = 420;
    this.baseKey = ''; this.disposed = false;
    this.locator = textNode('button', game.ui.hud, '', 'fp-locator');
    this.locator.type = 'button'; this.locator.setAttribute('aria-label', 'Find each other on the map');
    this.locator.onclick = () => game.ui.open('map');
    this.arrow = textNode('span', this.locator, '↑', 'fp-locator-arrow');
    this.arrow.setAttribute('aria-hidden', 'true');
    this.label = textNode('span', this.locator, 'Waiting for the other player…');
  }
  positions() {
    const g = this.game;
    if(g.battle?.me&&g.battle.state)return g.battle.state.players.filter(p=>p.id!==g.battle.pid).map(p=>({...p,pid:p.id}));
    return g.connection.connected ? g.peers.locations() : [];
  }
  open(parent) {
    this.mode = 'together';
    const controls = textNode('div', parent, '', 'fp-map-controls');
    for (const [mode, label] of [['together', 'Find each other'], ['nearby', 'Nearby']]) {
      const button = textNode('button', controls, label); button.type = 'button';
      button.dataset.mapMode = mode;
      button.onclick = () => { this.mode = mode; this.baseKey = ''; this.draw(); };
    }
    this.canvas = textNode('canvas', parent, '', 'fp-map-canvas');
    this.canvas.width = 640; this.canvas.height = 420;
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Map: north is up. Your marker is gold; the other player is blue.');
    this.roster = textNode('div', parent, '', 'fp-map-roster');
    textNode('p', parent, this.game.battle?.me?'North ↑ · Gold: you and the warzone edge · Blue/red dots: soldiers · Flags: bases. Solid cover blocks bullets; move around hills for a clear shot.':'North ↑ · Gold: you · Blue: the other player. Close the map and follow the arrow to meet up.', 'fp-map-help');
    this.baseKey = ''; this.draw();
  }
  update(dt) {
    if (this.disposed || (this.timer -= dt) > 0) return;
    this.timer = .25;
    const g = this.game, peers = this.positions();
    const nearest = peers.map(peer => ({peer, guide: peerGuidance(g.player.pos, peer, g.player.yaw)}))
      .filter(row => row.guide).sort((a, b) => a.guide.distance - b.guide.distance)[0];
    this.arrow.hidden = !nearest;
    if (!g.connection.connected) this.label.textContent = 'Reconnecting — positions unavailable';
    else if (!nearest) this.label.textContent = 'Waiting for the other player…';
    else {
      const { peer, guide } = nearest;
      this.arrow.textContent = guide.arrow;
      this.label.textContent = peer.name + ' · ' + distanceText(guide.distance) + ' ' + guide.compass + this.altitude(guide.heightDifference);
    }
    if (g.ui.panel.open && this.canvas?.isConnected) this.draw();
  }
  altitude(difference) {
    return Math.abs(difference) >= 4 ? ' · ' + Math.round(Math.abs(difference)) + ' m ' + (difference > 0 ? 'above' : 'below') : '';
  }
  draw() {
    if (!this.canvas?.isConnected) return;
    const g = this.game, peers = this.positions(), player = g.player.pos;
    const flags=Object.entries(g.battle?.state?.ctf?.flags||{}).filter(([,flag])=>flag).map(([team,flag])=>({...flag,team}));
    const frame = fitMap(this.mode === 'together' ? [player, ...peers,...flags] : [player], {width:640,height:420,padding:48,minSpan:192});
    if (!frame) return;
    for (const button of this.canvas.parentNode.querySelectorAll('[data-map-mode]')) {
      button.setAttribute('aria-pressed', String(button.dataset.mapMode === this.mode));
    }
    // Only rebuild terrain when its view or edits change; live dots are cheap.
    const key = [Math.round(frame.cx), Math.round(frame.cz), Math.round(frame.scale * 100), g.world.revision].join(':');
    if (key !== this.baseKey) { this.background(frame); this.baseKey = key; }
    const ctx = this.canvas.getContext('2d'); ctx.drawImage(this.base, 0, 0);
    const battle=g.battle?.me&&g.battle.state;
    if(battle){
      const {minX,minZ,maxX,maxZ}=battle.bounds,a=projectMap({x:minX,z:minZ},frame),b=projectMap({x:maxX,z:maxZ},frame);
      ctx.strokeStyle='#ffdc89';ctx.lineWidth=2;ctx.strokeRect(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.abs(b.x-a.x),Math.abs(b.y-a.y));
      for(const soldier of battle.soldiers){const p=projectMap(soldier,frame);ctx.fillStyle=soldier.hp<=0?'#b2b8af':soldier.team==='blue'?'#58baff':'#ff826c';ctx.beginPath();ctx.arc(p.x,p.y,3,0,Math.PI*2);ctx.fill();}
    }
    for(const flag of flags){
      const colour=flag.team==='blue'?'#58baff':'#ff826c';
      this.marker(ctx,projectMap(flag,frame),colour,flag.team==='blue'?'Blue flag':'Red flag',null,30);
    }
    for (const peer of peers) {
      const pos = projectMap(peer, frame);
      ctx.strokeStyle = '#a0e5ed'; ctx.setLineDash([5, 6]);
      const from = projectMap(player, frame); ctx.beginPath();ctx.moveTo(from.x, from.y);ctx.lineTo(pos.x, pos.y);ctx.stroke();ctx.setLineDash([]);
      this.marker(ctx, pos, '#62e0f1', peer.name, null, 18);
    }
    this.marker(ctx, projectMap(player, frame), '#ffcf64', g.player.name + ' (you)', mapHeading(g.player.yaw), -20);
    ctx.fillStyle = '#fff4d7'; ctx.font = 'bold 16px sans-serif';ctx.textAlign='center';ctx.fillText('N ↑', 320, 22);
    ctx.textAlign = 'left';ctx.font = '12px sans-serif';
    ctx.fillStyle = '#132d32';ctx.fillRect(10, 382, 110, 28);ctx.fillStyle = '#fff4d7';
    ctx.fillText(distanceText(100 / frame.scale), 18, 400);ctx.fillRect(130, 396, 100, 3);
    this.roster.replaceChildren();
    textNode('p', this.roster, g.player.name + ' (you) · N ' + Math.round(player.x) + ' · E ' + Math.round(player.z));
    for(const flag of flags)textNode('p',this.roster,(flag.team==='blue'?'Blue':'Red')+' flag · '+flag.status);
    if (!g.connection.connected) textNode('p', this.roster, 'Connection lost. Other positions are unavailable until you reconnect.');
    else if (!peers.length) textNode('p', this.roster, 'No other player is broadcasting a position yet. Both of you need to be in the world.');
    for (const peer of peers) {
      const guide = peerGuidance(player, peer, g.player.yaw);
      if (guide) textNode('p', this.roster, peer.name + ' · ' + distanceText(guide.distance) + ' ' + guide.compass + this.altitude(guide.heightDifference));
    }
  }
  marker(ctx, position, colour, label, heading, labelOffset) {
    // Nearby mode retains an edge marker for distant players.
    const x = Math.max(12, Math.min(628, position.x)), y = Math.max(35, Math.min(370, position.y));
    ctx.save();ctx.translate(x,y);ctx.fillStyle=colour;ctx.strokeStyle='#132d32';ctx.lineWidth=3;
    ctx.beginPath();
    if (heading == null) ctx.arc(0,0,7,0,Math.PI*2);
    else {ctx.rotate(heading);ctx.moveTo(0,-11);ctx.lineTo(8,8);ctx.lineTo(0,5);ctx.lineTo(-8,8);ctx.closePath();}
    ctx.fill();ctx.stroke();ctx.restore();
    ctx.font='bold 15px sans-serif';ctx.textAlign='center';ctx.lineWidth=4;ctx.strokeStyle='#132d32';ctx.fillStyle=colour;
    const labelX=Math.max(75,Math.min(565,x));ctx.strokeText(label,labelX,y+labelOffset);ctx.fillText(label,labelX,y+labelOffset);
  }
  background(frame) {
    const g=this.game,geo=g.world.gen.geo,ctx=this.base.getContext('2d');
    // A bounded coarse relief map, including loaded crater floors. No chunks generated.
    for(let row=0;row<24;row++)for(let col=0;col<40;col++){
      const x=frame.cx+(210-(row+.5)*17.5)/frame.scale,z=frame.cz+((col+.5)*16-320)/frame.scale;
      const h=g.world.surfaceY(x,z)??geo.height(x,z);
      ctx.fillStyle=h<=22?'#577f88':h>=42?'#817176':h>=33?'#736d55':'#667956';
      ctx.fillRect(col*16,row*17.5,17,18.5);
    }
    // Railway routes remain useful orientation lines, not a promise of intact track.
    ctx.strokeStyle='#c8b686';ctx.lineWidth=2;
    for(const {path} of geo.railPaths()){
      ctx.beginPath();path.pts.forEach((p,i)=>{const q=projectMap(p,frame);if(q){if(i)ctx.lineTo(q.x,q.y);else ctx.moveTo(q.x,q.y);}});ctx.stroke();
    }
    ctx.font='12px sans-serif';ctx.textAlign='center';
    for(const village of geo.villages){
      const p=projectMap(village,frame);if(!p||p.x<0||p.x>640||p.y<25||p.y>390)continue;
      ctx.fillStyle='#f3e6c4';ctx.fillRect(p.x-2,p.y-2,4,4);ctx.strokeStyle='#334a3f';ctx.lineWidth=3;
      ctx.strokeText(village.name,p.x,p.y-8);ctx.fillText(village.name,p.x,p.y-8);
    }
  }
  dispose() { this.disposed=true;this.locator.remove();this.canvas=null;this.roster=null;this.base.width=this.base.height=1; }
}
