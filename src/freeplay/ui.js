import { BLOCK_CATALOGUE, BOMBS, DEFAULT_BLOCK } from './catalogue.js';
import { getIconURL } from '../textures.js';
import { FUTURE_BLOCKS, getFutureIconURL } from './future-blocks.js';
import { WEAPONS } from './weapons.js';
import { BUILD_SHAPES, BRUSH_SIZES } from './build-shapes.js';
import { playGuide } from './help-ui.js';

export function element(tag, className, text, parent) {
  const el = document.createElement(tag); el.className = className || '';
  if (text != null) el.textContent = text; parent?.append(el); return el;
}
function button(parent, text, action, className = '') {
  const el = element('button', className, text, parent); el.type = 'button';
  el.addEventListener('click', action); return el;
}

export class FreeplayUI {
  constructor(root, actions) {
    this.root = root; this.actions = actions; this.selected = { type: 'block', id: DEFAULT_BLOCK };
    this.canvas = element('canvas', 'fp-canvas', null, root); this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', 'Free-play world. Use WASD to move and drag to look.');
    this.login = element('section', 'fp-entry', null, root);
    const card = element('div', 'fp-entry-card', null, this.login);
    element('p', 'fp-eyebrow', 'THE MOOR IS YOURS', card);
    element('h1', '', 'Moorstead', card); element('p', 'fp-edition', 'Free Play', card);
    element('p', 'fp-intro', 'Build a castle. Blow a crater. Do it all again.', card);
    const badges = element('div', 'fp-badges', null, card);
    for (const label of ['∞ supplies', '∞ health', 'One shared moor']) element('span', '', label, badges);
    this.form = element('form', 'fp-login-form', null, card);
    const who = element('div', 'fp-who', null, this.form);
    for (const name of ['Henry', 'James']) button(who, name, () => { this.name.value = name; this.code.focus(); });
    const nameLabel = element('label', '', 'Thi name', this.form);
    this.name = element('input', '', null, nameLabel); this.name.name = 'username'; this.name.autocomplete = 'username'; this.name.required = true; this.name.maxLength = 24;
    const codeLabel = element('label', '', 'Free-play code', this.form);
    this.code = element('input', '', null, codeLabel); this.code.name = 'password'; this.code.type = 'password'; this.code.autocomplete = 'current-password'; this.code.required = true; this.code.maxLength = 160;
    this.submit = element('button', 'fp-primary', 'Come on in', this.form); this.submit.type = 'submit';
    this.form.addEventListener('submit', e => { e.preventDefault(); actions.login(this.code.value, this.name.value); });
    this.continueButton = button(card, 'Back to our world', () => actions.continue(), 'fp-primary'); this.continueButton.hidden = true;
    this.loginMessage = element('p', 'fp-message', '', card); this.loginMessage.setAttribute('role', 'status');
    const home = element('a', 'fp-home-link', 'Ordinary Moorstead ↗', card); home.href = '/';
    this.hud = element('div', 'fp-hud', null, root); this.hud.hidden = true;
    const top = element('header', 'fp-top', null, this.hud);
    const brand = element('div', 'fp-brand', null, top); element('strong', '', 'Moorstead', brand); element('span', '', 'FREE PLAY', brand);
    this.connection = element('span', 'fp-connection', 'Joining…', top);
    this.people = element('span', 'fp-people', '', top);
    button(top, 'Map', () => this.open('map'));
    button(top, 'Menu', () => this.open('menu'));
    this.crosshair = element('div', 'fp-crosshair', '+', this.hud);
    const bottom = element('div', 'fp-bottom', null, this.hud);
    this.selection = element('div', 'fp-selection', 'Planks · ∞', bottom);
    const tools = this.tools = element('nav', 'fp-tools', null, bottom); tools.setAttribute('aria-label', 'Free-play tools');
    button(tools, 'Build', () => this.open('build'));
    button(tools, 'Bombs', () => this.open('bombs'));
    button(tools, 'Weapons', () => this.open('weapons'));
    this.garage=button(tools,'Vehicles',()=>this.open('vehicles'));
    this.fly = button(tools, 'Fly', () => actions.fly());
    this.undo = button(tools, 'Undo', () => actions.undo());
    this.army=button(tools,'Army',()=>this.open('battle'));this.army.hidden=true;
    this.shield=button(tools,'Shield',()=>actions.shield());this.shield.hidden=true;
    this.touch = element('div', 'fp-touch', null, this.hud);
    const move = element('div', 'fp-move', null, this.touch);
    for (const [label, key] of [['↑', 'KeyW'], ['←', 'KeyA'], ['↓', 'KeyS'], ['→', 'KeyD']]) {
      const el = button(move, label, () => {}); el.dataset.key = key; el.setAttribute('aria-label', {KeyW:'Move forward',KeyA:'Move left',KeyS:'Move back',KeyD:'Move right'}[key]);
    }
    const touchActions = element('div', 'fp-touch-actions', null, this.touch);
    this.place = button(touchActions, 'Place', () => actions.use());
    this.rotate = button(touchActions, 'Rotate', () => this.rotateBuild()); this.rotate.hidden = true;
    button(touchActions, 'Break', () => actions.break());
    for (const [label, key] of [['Up / jump', 'Space'], ['Down', 'ShiftLeft']]) { const el = button(touchActions, label, () => {}); el.dataset.key = key; }
    this.notice = element('p', 'fp-notice', '', this.hud); this.notice.setAttribute('role', 'status');
    this.vehicleDrive=element('div','fp-vehicle-drive',null,bottom);this.vehicleDrive.hidden=true;
    button(this.vehicleDrive,'Park',()=>actions.park());button(this.vehicleDrive,'Change view',()=>actions.vehicleView());
    this.panel = element('dialog', 'fp-panel', null, root);
    this.panel.addEventListener('close', () => { this.actions.pause(false); this.canvas.focus(); });
    this.panelTitle = element('h2', '', '', this.panel);
    button(this.panel, 'Back to play', () => this.panel.close(), 'fp-close');
    this.panelContent = element('div', 'fp-panel-content', null, this.panel);
    this.error = element('p', 'fp-error', '', root); this.error.setAttribute('role', 'alert'); this.error.hidden = true;
  }
  saved(auth) { this.continueButton.hidden = !auth; if (auth) this.continueButton.textContent = 'Return as ' + auth.name; }
  loading(message) { this.loginMessage.textContent = message; this.submit.disabled = true; this.continueButton.disabled = true; }
  loginError(message) { this.loginMessage.textContent = message; this.submit.disabled = false; this.continueButton.disabled = false; }
  playing(name) { this.login.hidden = true; this.hud.hidden = false; this.people.textContent = name; this.canvas.focus(); }
  report(message) { this.error.textContent = message; const dismiss=button(this.error,'×',()=>{this.error.hidden=true;},'fp-dismiss');dismiss.setAttribute('aria-label','Dismiss message');this.error.hidden = false; }
  message(text) {
    this.notice.textContent=text;clearTimeout(this.noticeTimer);
    if(text)this.noticeTimer=setTimeout(()=>{this.notice.textContent='';},4500);
  }
  status(text) { if(this.connection.textContent!==text)this.connection.textContent = text; }
  select(value) {
    this.selected = value;
    const blocks=[...FUTURE_BLOCKS,...BLOCK_CATALOGUE];
    const name = value.type === 'build' ? BUILD_SHAPES.find(row=>row.id===value.shape)?.name + (value.size?' '+value.size:'')+' · '+(value.rotation||0)*90+'°'
      : value.type === 'weapon' ? WEAPONS.find(row=>row.id===value.id)?.name
      : value.type === 'block' ? blocks.find(row => row.id === value.id)?.name : BOMBS.find(row => row.id === value.id)?.name;
    this.selection.textContent = (name || 'Choose a block') + ' · ∞';
    this.place.textContent = value.type === 'bomb' ? 'Throw / place' : value.type === 'weapon' ? 'Fire' : 'Place';
    this.rotate.hidden=value.type!=='build';
    this.actions.select(value); this.panel.close();
  }
  rotateBuild(){if(this.selected.type==='build')this.select({...this.selected,rotation:((this.selected.rotation||0)+1)%4});}
  open(kind) {
    this.actions.pause(true); document.exitPointerLock?.(); this.panelContent.replaceChildren();
    this.panelTitle.textContent = {build:'Build anything',bombs:'The bomb cupboard',weapons:'The sci-fi armoury',menu:'Our shared moor',map:'Find each other',vehicles:'Build and drive',battle:'The battlefield',help:'How to play'}[kind];
    if(kind==='help')playGuide(this.panelContent);
    if(kind==='battle')this.actions.battle(this.panelContent);
    if(kind==='vehicles')this.actions.vehicles(this.panelContent);
    if (kind === 'map') this.actions.map(this.panelContent);
    if (kind === 'build') this.buildCatalogue();
    if (kind === 'bombs') for (const bomb of BOMBS.filter(bomb=>this.actions.bombAllowed?.(bomb.id)!==false)) {
      const el = button(this.panelContent, '', () => this.select({type:'bomb',id:bomb.id}), 'fp-bomb');
      el.style.setProperty('--bomb-colour', bomb.colour); element('strong', '', bomb.name + ' · ∞', el); element('span', '', bomb.description, el);
    }
    if(kind==='weapons')for(const weapon of WEAPONS){
      const el=button(this.panelContent,'',()=>this.select({type:'weapon',id:weapon.id}),'fp-bomb');
      el.style.setProperty('--bomb-colour',weapon.colour);element('strong','',weapon.name+' · ∞',el);element('span','',weapon.description,el);
    }
    if (kind === 'menu') this.menu();
    this.panel.showModal();
  }
  buildCatalogue() {
    let shape='single',size=5;
    element('p','','Choose a brush, then tap a block. Aim the blue preview and Place. R or Rotate turns it; Undo removes the whole build.',this.panelContent);
    const brushes=element('div','fp-build-choices',null,this.panelContent);
    const options=[{id:'single',name:'One block'},...BUILD_SHAPES.filter(row=>!row.prefab)];
    for(const row of options){const el=button(brushes,row.name,()=>{shape=row.id;for(const b of brushes.children)b.setAttribute('aria-pressed',String(b===el));});el.setAttribute('aria-pressed',String(row.id===shape));}
    const sizeLabel=element('label','fp-build-size','Brush size ',this.panelContent),sizes=element('select','',null,sizeLabel);
    sizes.setAttribute('aria-label','Brush size');
    for(const n of BRUSH_SIZES){const option=element('option','',String(n)+' blocks',sizes);option.value=n;option.selected=n===size;}
    sizes.onchange=()=>{size=Number(sizes.value);};
    element('h3','','Ready-made builds',this.panelContent);
    if(this.actions.inBattle?.())element('p','fp-build-strategy','Trenches and sandbags block bullets. Bunkers protect your flag; watchposts shoot over low cover. Leave doors and steps for your soldiers.',this.panelContent);
    const prefabs=element('div','fp-build-choices',null,this.panelContent);
    for(const row of BUILD_SHAPES.filter(row=>row.prefab))button(prefabs,row.name,()=>this.select({type:'build',shape:row.id,block:200,rotation:0}));
    element('h3','','Materials · unlimited',this.panelContent);
    const label = element('label', '', 'Find a block', this.panelContent), search = element('input', '', null, label); search.type = 'search';
    const grid = element('div', 'fp-catalogue', null, this.panelContent);
    const draw = () => {
      grid.replaceChildren();
      for (const block of [...FUTURE_BLOCKS,...BLOCK_CATALOGUE].filter(row => row.name.toLowerCase().includes(search.value.toLowerCase()))) {
        const el = button(grid, '', () => this.select(shape==='single'?{type:'block',id:block.id}:{type:'build',shape,block:block.id,size,rotation:0}));
        const image = element('img', '', null, el); image.src = getFutureIconURL(block.id)||getIconURL(block.id); image.alt = ''; image.width = image.height = 40;
        if(block.description)el.title=block.description;
        element('span', '', block.name, el);
      }
    };
    search.addEventListener('input', draw); draw();
  }
  menu() {
    element('p', '', 'Infinite supplies and health. No chores. Everything here belongs to this separate free-play world.', this.panelContent);
    button(this.panelContent,'How to play',()=>this.open('help'),'fp-primary');
    element('p', '', 'WASD: walk · drag/mouse: look · F: fly · Space: up/jump · Shift: down · Z: faster · left click: break/fire/build · right click: place · B: build · X: bombs · G: weapons · R: rotate build · M: map', this.panelContent);
    if(!this.actions.battleLocked?.())button(this.panelContent, 'Back to village', () => { this.actions.home(); this.panel.close(); });
    else element('p','','Battle in progress: capture the flag or choose Army → Forfeit battle to leave the warzone.',this.panelContent);
    button(this.panelContent, 'Our vehicles', () => this.open('vehicles'));
    button(this.panelContent, 'Battlefield / armies', () => this.open('battle'));
    button(this.panelContent, 'Reconnect', () => { this.actions.reconnect(); this.panel.close(); });
    const settings = this.actions.settings();
    for (const [key,label] of [['plain','Plain graphics (best for tablets)'],['reducedFlash','Gentle flashes'],['reducedMotion','Gentle effects'],['muted','Mute sound']]) {
      const row = element('label','fp-check',null,this.panelContent), input = element('input','',null,row); input.type='checkbox'; input.checked=settings[key];
      element('span','',label,row); input.addEventListener('change', () => this.actions.setting(key,input.checked));
    }
    const history = this.actions.history();
    element('h3', '', 'Shared history', this.panelContent);
    element('p', '', history.length ? 'Undo removes the newest change first, whichever of thee made it.' : 'No recent changes to undo.', this.panelContent);
    for (const row of history.slice(0,5)) element('p','fp-history',row.actor + ' · ' + (row.bomb || row.kind),this.panelContent);
    button(this.panelContent, 'Undo latest shared action', () => { this.actions.undo(); this.panel.close(); });
    if(!this.actions.worldLocked?.()){
      button(this.panelContent, 'Reset world…', () => this.confirm('reset'), 'fp-danger');
      const restore = button(this.panelContent, 'Restore before last reset…', () => this.confirm('restore')); restore.disabled = !this.actions.checkpoint();
    }
    button(this.panelContent, 'Sign out', () => this.actions.logout());
  }
  confirm(kind) {
    this.panelContent.replaceChildren(); this.panelTitle.textContent = kind === 'reset' ? 'Start our moor afresh?' : 'Bring the saved moor back?';
    element('p', '', kind === 'reset' ? 'This resets buildings and craters for BOTH players. Your logins stay. A recovery copy is saved first.'
      : 'This replaces the shared world with its saved state from before the last reset. Both players return to the village.', this.panelContent);
    button(this.panelContent, kind === 'reset' ? 'Reset for both of us' : 'Restore for both of us', () => { this.actions[kind](); this.panel.close(); }, 'fp-danger');
    button(this.panelContent, 'Keep playing', () => this.panel.close());
  }
}
