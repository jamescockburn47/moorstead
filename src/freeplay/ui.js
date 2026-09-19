import { BLOCK_CATALOGUE, BOMBS, DEFAULT_BLOCK } from './catalogue.js';
import { getIconURL } from '../textures.js';

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
    const tools = element('nav', 'fp-tools', null, bottom); tools.setAttribute('aria-label', 'Free-play tools');
    button(tools, 'Build', () => this.open('build'));
    button(tools, 'Bombs', () => this.open('bombs'));
    this.fly = button(tools, 'Fly', () => actions.fly());
    this.undo = button(tools, 'Undo', () => actions.undo());
    this.touch = element('div', 'fp-touch', null, this.hud);
    const move = element('div', 'fp-move', null, this.touch);
    for (const [label, key] of [['↑', 'KeyW'], ['←', 'KeyA'], ['↓', 'KeyS'], ['→', 'KeyD']]) {
      const el = button(move, label, () => {}); el.dataset.key = key; el.setAttribute('aria-label', {KeyW:'Move forward',KeyA:'Move left',KeyS:'Move back',KeyD:'Move right'}[key]);
    }
    const touchActions = element('div', 'fp-touch-actions', null, this.touch);
    this.place = button(touchActions, 'Place', () => actions.use());
    button(touchActions, 'Break', () => actions.break());
    for (const [label, key] of [['Up / jump', 'Space'], ['Down', 'ShiftLeft']]) { const el = button(touchActions, label, () => {}); el.dataset.key = key; }
    this.notice = element('p', 'fp-notice', '', this.hud); this.notice.setAttribute('role', 'status');
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
  report(message) { this.error.textContent = message; this.error.hidden = false; }
  message(text) { this.notice.textContent = text; }
  status(text) { this.connection.textContent = text; }
  select(value) {
    this.selected = value;
    const name = value.type === 'block' ? BLOCK_CATALOGUE.find(row => row.id === value.id)?.name : BOMBS.find(row => row.id === value.id)?.name;
    this.selection.textContent = (name || 'Choose a block') + ' · ∞'; this.place.textContent = value.type === 'bomb' ? 'Throw / place' : 'Place';
    this.actions.select(value); this.panel.close();
  }
  open(kind) {
    this.actions.pause(true); document.exitPointerLock?.(); this.panelContent.replaceChildren();
    this.panelTitle.textContent = {build:'Build anything',bombs:'The bomb cupboard',menu:'Our shared moor',map:'Find each other'}[kind];
    if (kind === 'map') this.actions.map(this.panelContent);
    if (kind === 'build') this.buildCatalogue();
    if (kind === 'bombs') for (const bomb of BOMBS) {
      const el = button(this.panelContent, '', () => this.select({type:'bomb',id:bomb.id}), 'fp-bomb');
      el.style.setProperty('--bomb-colour', bomb.colour); element('strong', '', bomb.name + ' · ∞', el); element('span', '', bomb.description, el);
    }
    if (kind === 'menu') this.menu();
    this.panel.showModal();
  }
  buildCatalogue() {
    const label = element('label', '', 'Find a block', this.panelContent), search = element('input', '', null, label); search.type = 'search';
    const grid = element('div', 'fp-catalogue', null, this.panelContent);
    const draw = () => {
      grid.replaceChildren();
      for (const block of BLOCK_CATALOGUE.filter(row => row.name.toLowerCase().includes(search.value.toLowerCase()))) {
        const el = button(grid, '', () => this.select({type:'block',id:block.id}));
        const image = element('img', '', null, el); image.src = getIconURL(block.id); image.alt = ''; image.width = image.height = 40;
        element('span', '', block.name, el);
      }
    };
    search.addEventListener('input', draw); draw();
  }
  menu() {
    element('p', '', 'Infinite supplies and health. No chores. Everything here belongs to this separate free-play world.', this.panelContent);
    element('p', '', 'WASD: walk · drag/mouse: look · F: fly · Space: up/jump · Shift: down · Z: faster · left click: break/throw · right click: place · B: build · X: bombs · M: map', this.panelContent);
    button(this.panelContent, 'Back to village', () => { this.actions.home(); this.panel.close(); });
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
    button(this.panelContent, 'Reset world…', () => this.confirm('reset'), 'fp-danger');
    const restore = button(this.panelContent, 'Restore before last reset…', () => this.confirm('restore')); restore.disabled = !this.actions.checkpoint();
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
