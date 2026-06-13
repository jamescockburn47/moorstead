// Moorstead — entry point and game orchestration.
// (Storage keys an' t' save DB keep their owd 'moorcraft' names on purpose:
// renaming them would orphan every player's saves an' login.)
import * as THREE from 'three';
import { B, I, BLOCKS, TOOLS, FOODS, isSolid, isCutout, isPlaceable, itemName, HEIGHT, WATER_LEVEL, ADMIN_HASHES } from './defs.js';
import { strSeed } from './noise.js';
import { initMaterials } from './mesher.js';
import { getIconURL } from './textures.js';
import { World } from './world.js';
import { Player } from './player.js';
import * as npc from './npc.js';
import { Quests } from './quests.js';
import { Net } from './multiplayer.js';
import { buildTrain } from './train.js';
import { Rails } from './rails.js';

const RAIL_VMAX = 11;  // blocks a second flat out — t' pace of a heritage steamer
const RAIL_ACC = 0.18; // gentle acceleration: she works up to speed an' brakes early
const DWELL_T = 30;    // thirty seconds stood at each platform, doors open

// where is she an' how fast, tt seconds into a leg o' length len?
// (trapezoid speed profile: accelerate, cruise, brake — closed form, so
// every client computes t' same train frae t' same wall clock)
function runProfile(len, tt) {
  const dFull = RAIL_VMAX * RAIL_VMAX / (2 * RAIL_ACC);
  let vPeak, tA;
  if (len >= 2 * dFull) { vPeak = RAIL_VMAX; tA = RAIL_VMAX / RAIL_ACC; }
  else { vPeak = Math.sqrt(RAIL_ACC * len); tA = vPeak / RAIL_ACC; }
  const dA = 0.5 * RAIL_ACC * tA * tA;
  const tCruise = vPeak >= RAIL_VMAX ? (len - 2 * dA) / RAIL_VMAX : 0;
  const tTotal = 2 * tA + tCruise;
  let dist, v;
  if (tt <= tA) { dist = 0.5 * RAIL_ACC * tt * tt; v = RAIL_ACC * tt; }
  else if (tt <= tA + tCruise) { dist = dA + (tt - tA) * vPeak; v = vPeak; }
  else { const tb = Math.max(0, tTotal - tt); dist = len - 0.5 * RAIL_ACC * tb * tb; v = RAIL_ACC * tb; }
  return { dist: Math.max(0, Math.min(len, dist)), v: Math.max(0, v), tTotal };
}
function legTime(len) { return runProfile(len, 0).tTotal; }
import { Entities } from './entities.js';
import { Sky } from './sky.js';
import { AudioEngine } from './audio.js';
import { UI } from './ui.js';
import { raycast, boxCollides } from './physics.js';

const REACH = 5.5;

class Game {
  constructor() {
    this.state = 'title';
    this.keys = {};
    this.mouseDown = [false, false, false];
    this.placeRepeat = 0;
    this.breakTarget = null;
    this.breakProgress = 0;
    this.autosaveTimer = 30;
    this.heldIconId = -1;

    // renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.domElement.className = 'game';
    document.getElementById('app').appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 600);
    this.camera.rotation.order = 'YXZ';

    initMaterials();

    this.audio = new AudioEngine();
    this.ui = new UI(this);

    // block highlight
    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 })
    );
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    // lantern light pool
    this.lanternLights = [];
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xffb84a, 0, 13, 1.6);
      this.scene.add(l);
      this.lanternLights.push(l);
    }
    // held-torch light follows t' player
    this.torchLight = new THREE.PointLight(0xffa040, 0, 11, 1.5);
    this.scene.add(this.torchLight);

    // held item sprite (viewmodel)
    this.heldSprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }));
    this.heldSprite.scale.set(0.55, 0.55, 0.55);
    this.heldSprite.position.set(0.62, -0.55, -1.1);
    this.heldSprite.renderOrder = 999;
    this.heldSprite.visible = false;
    this.camera.add(this.heldSprite);
    this.scene.add(this.camera);

    this.bindEvents();
    this.auth = JSON.parse(localStorage.getItem('moorcraft-auth') || 'null');
    this.refreshAdmin();
    this.ui.setLoggedIn(this.auth);
    this.ui.show('titleScreen');

    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------------- world lifecycle ----------------
  async newWorld(seedStr) {
    if (this.net) { this.net.disconnect(); this.net = null; }
    this.netActive = false;
    const { clearSave } = await import('./save.js');
    await clearSave();
    const seed = strSeed(seedStr || ('' + Math.random()));
    this.startWorld(seed, null, new Map());
  }

  async continueGame() {
    const { loadGame } = await import('./save.js');
    const saved = await loadGame();
    if (!saved) { this.ui.toast('No saved world found, love.'); return; }
    if (saved.meta.version !== 2) {
      this.ui.toast('That world&rsquo;s from afore t&rsquo; moors moved &mdash; expect odd seams. A fresh world&rsquo;s best.', 7000);
    }
    this.startWorld(saved.meta.seed, saved.meta, saved.chunks);
  }

  startWorld(seed, meta, chunks) {
    if (this.world) this.teardownWorld();
    this.seed = seed;
    this.world = new World(this.scene, seed, chunks);
    this.player = new Player(this.world);
    this.entities = new Entities(this.scene, this.world);
    this.sky = new Sky(this.scene, this.camera);
    this.spawn = this.world.gen.findSpawn();
    this.player.pos = { ...this.spawn };
    this.villagersSpawned = false;
    this.standing = null;
    this.standingData = null;
    this.quests = new Quests(this);
    if (this.rails) this.rails.dispose();
    this.rails = new Rails(this.scene, this.world.gen.geo); // t' permanent way, drawn proper
    this.entities.game = this;
    this.entities.onKill = mob => this.quests.onMobKilled(mob);
    window.moorstead = window.moorcraft = this; // a handle for t' dev console
    this.lastQuestDay = 1;

    if (meta) {
      this.player.deserialize(meta.player);
      this.sky.deserialize(meta.sky);
      this.quests.deserialize(meta.quests);
    } else if (this.auth && this.auth.name) {
      this.player.name = this.auth.name; // t' villagers already know thi name
    } else {
      // starter kit: nowt. Tha starts wi' thi bare hands, as is proper.
    }
    this.ui.invDirty = true;
    this.state = 'loading';
    this.ui.show('loadingScreen');
  }

  teardownWorld() {
    if (this.rails) { this.rails.dispose(); this.rails = null; }
    this.entities.clear();
    for (const c of this.world.chunks.values()) {
      if (c.meshes) for (const m of c.meshes) { this.scene.remove(m); m.geometry.dispose(); }
    }
    // remove sky objects
    for (const o of [this.sky.sun, this.sky.sun.target, this.sky.ambient, this.sky.stars,
      this.sky.clouds, this.sky.rain, this.sky.sunSprite, this.sky.moonSprite]) {
      this.scene.remove(o);
    }
    this.scene.fog = null;
  }

  async saveNow(toast = true) {
    if (!this.world) return;
    if (this.netActive) {
      // shared moor: pockets an' ventures live on t' server, keyed to thi account
      if (this.net && this.net.connected) {
        this.net.sendSave({
          player: this.player.serialize(),
          quests: this.quests.serialize(),
        });
        if (toast) this.ui.toast('Thi things are lodged wi\u2019 t\u2019 parish. Champion.');
      }
      return;
    }
    const { saveGame } = await import('./save.js');
    const meta = {
      version: 2,
      seed: this.seed,
      player: this.player.serialize(),
      sky: this.sky.serialize(),
      quests: this.quests.serialize(),
      savedAt: Date.now(),
    };
    await saveGame(meta, this.world.collectModified());
    if (toast) this.ui.toast('World saved. Champion.');
  }

  async quitToTitle() {
    await this.saveNow(false);
    if (this.net) { this.net.disconnect(); this.net = null; }
    this.netActive = false;
    this.state = 'title';
    document.exitPointerLock?.();
    this.ui.show('titleScreen');
    this.refreshContinue();
  }

  async refreshContinue() {
    const { hasSave } = await import('./save.js');
    this.ui.btnContinue.disabled = !(await hasSave());
  }

  // ---------------- input ----------------
  bindEvents() {
    const ui = this.ui;
    ui.btnLogin.addEventListener('click', () => this.login());
    ui.loginName.addEventListener('keydown', e => { if (e.code === 'Enter') this.login(); e.stopPropagation(); });
    ui.loginCode.addEventListener('keydown', e => e.stopPropagation());
    ui.loginGuest.addEventListener('click', () => this.loginGuest());
    ui.btnNew.addEventListener('click', () => { this.audio.init(); this.newWorld(ui.seedInput.value.trim()); });
    ui.btnShared.addEventListener('click', () => { this.audio.init(); this.joinShared(); });
    ui.netChatInput.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.code === 'Enter') {
        const text = ui.netChatInput.value.trim();
        if (text && this.net) {
          this.net.sendChat(text);
          ui.toast(`<b>Thee:</b> ${text.replace(/</g, '&lt;')}`, 5000);
        }
        this.closeNetChat();
      } else if (e.code === 'Escape') this.closeNetChat();
    });
    ui.btnContinue.addEventListener('click', () => { this.audio.init(); this.continueGame(); });
    ui.btnHow.addEventListener('click', () => { this.howReturn = 'titleScreen'; ui.show('howScreen'); });
    ui.btnHow2.addEventListener('click', () => { this.howReturn = 'pauseScreen'; ui.show('howScreen'); });
    ui.btnHowClose.addEventListener('click', () => ui.show(this.howReturn || 'titleScreen'));
    ui.btnResume.addEventListener('click', () => this.resume());
    ui.btnSave.addEventListener('click', () => this.saveNow());
    ui.btnCreative.addEventListener('click', () => {
      this.player.creative = !this.player.creative;
      if (!this.player.creative) this.player.flying = false;
      ui.toast(this.player.creative ? 'Creative mode: tha can fly an&rsquo; all (double-tap Space).' : 'Survival mode: watch thissen.');
      ui.invDirty = true;
    });
    ui.btnQuit.addEventListener('click', () => this.quitToTitle());
    ui.btnRespawn.addEventListener('click', () => {
      this.player.respawn(this.spawn);
      this.state = 'playing';
      ui.show(null);
      this.lockPointer();
    });
    ui.btnDeathQuit.addEventListener('click', () => this.quitToTitle());

    // villager chat wiring
    ui.btnChatClose.addEventListener('click', () => this.closeChat());
    ui.btnChatSend.addEventListener('click', () => this.sendChat());
    ui.chatInput.addEventListener('keydown', e => {
      if (e.code === 'Enter') this.sendChat();
      e.stopPropagation();
    });
    ui.btnSetName.addEventListener('click', () => this.setPlayerName());
    ui.chatNameInput.addEventListener('keydown', e => {
      if (e.code === 'Enter') this.setPlayerName();
      e.stopPropagation();
    });
    ui.btnChatGive.addEventListener('click', () => this.giveGift());

    this.refreshContinue();

    document.addEventListener('keydown', e => {
      if (e.code === 'Tab') e.preventDefault();
      this.keys[e.code] = true;
      if (e.repeat) return;
      if (e.code === 'Space') this.input.jumpTapped = true;

      if (this.state === 'playing') {
        if (e.code === 'KeyE') this.openInventory();
        if (e.code === 'KeyQ') this.openBoard(false);
        if (e.code === 'KeyT' && this.netActive) { e.preventDefault(); this.openNetChat(); return; }
        if (e.code === 'KeyN') this.trySleep();
        if (e.code === 'KeyM') { this.audio.setMuted(!this.audio.muted); this.ui.toast(this.audio.muted ? 'Sound off.' : 'Sound on.'); }
        const num = parseInt(e.key);
        if (num >= 1 && num <= 9) { this.player.hotbar = num - 1; this.ui.invDirty = true; }
      } else if (this.state === 'inv' || this.state === 'range') {
        if (e.code === 'KeyE' || e.code === 'Escape') this.closeScreens();
      } else if (this.state === 'board' || this.state === 'museum') {
        if (e.code === 'KeyQ' || e.code === 'Escape') this.closeScreens();
      } else if (this.state === 'chat') {
        if (e.code === 'Escape') this.closeChat();
      } else if (this.state === 'sleeping') {
        if (e.code === 'KeyN' || e.code === 'Escape') this.cancelSleep('Up an’ about again, then.');
      }
    });
    document.addEventListener('keyup', e => { this.keys[e.code] = false; });
    // Clear in place — never replace the object: player input holds a
    // reference to it, and swapping it out left WASD dead after any focus
    // loss (which always happens at least once on t' web).
    window.addEventListener('blur', () => this.clearKeys());

    const canvas = this.renderer.domElement;
    canvas.addEventListener('mousedown', e => {
      if (this.state !== 'playing') return;
      if (document.pointerLockElement !== canvas) { this.lockPointer(); return; }
      this.mouseDown[e.button] = true;
      if (e.button === 2) { this.placeRepeat = 0; this.useItem(); }
      if (e.button === 0) { this.breakProgress = 0; this.attackOrMine(true); }
    });
    document.addEventListener('mouseup', e => { this.mouseDown[e.button] = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    document.addEventListener('mousemove', e => {
      if ((this.state !== 'playing' && this.state !== 'riding') || document.pointerLockElement !== canvas) return;
      const sens = 0.0023;
      this.player.yaw -= e.movementX * sens;
      this.player.pitch -= e.movementY * sens;
      this.player.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.player.pitch));
    });

    document.addEventListener('wheel', e => {
      if (this.state !== 'playing') return;
      this.player.hotbar = ((this.player.hotbar + (e.deltaY > 0 ? 1 : -1)) % 9 + 9) % 9;
      this.ui.invDirty = true;
    });

    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== canvas && this.state === 'playing') {
        this.pause();
      }
    });

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    window.addEventListener('beforeunload', () => {
      if (this.world && this.state !== 'title') this.saveNow(false);
    });

    this.input = { keys: this.keys, jumpTapped: false };
  }

  clearKeys() {
    for (const k of Object.keys(this.keys)) delete this.keys[k];
  }

  lockPointer() {
    try {
      const p = this.renderer.domElement.requestPointerLock?.({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => this.renderer.domElement.requestPointerLock());
    } catch {
      this.renderer.domElement.requestPointerLock?.();
    }
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.mouseDown = [false, false, false];
    this.clearKeys();
    this.renderAdminPanel();
    this.ui.show('pauseScreen');
  }

  // ---------------- parish warden (admin) ----------------
  // T' warden check hashes t' account id (it doubles as a login code, so
  // plaintext stays out o' t' source). Needs a secure context for
  // crypto.subtle — https or localhost; a raw-IP LAN page won't have it.
  async refreshAdmin() {
    this.adminOk = false;
    if (!this.auth || !this.auth.acct || !(window.crypto && crypto.subtle)) return;
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(this.auth.acct));
      const hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
      this.adminOk = ADMIN_HASHES.includes(hex);
    } catch { /* no subtle crypto — no warden powers, no matter */ }
  }

  isAdmin() {
    return !!this.adminOk;
  }

  renderAdminPanel() {
    const panel = this.ui.adminPanel;
    if (!panel) return;
    if (!this.isAdmin() || !this.world) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');
    panel.innerHTML = '';
    const ui = this.ui;
    ui.el('div', 'inv-title', panel, 'Parish Warden');
    const row = ui.el('div', 'admin-btns', panel);
    const god = ui.el('button', 'mc', row, this.player.god ? 'Mortal Again' : 'Hard As T’ Wainstones (God)');
    god.addEventListener('click', () => {
      this.player.god = !this.player.god;
      ui.toast(this.player.god ? 'Nowt can touch thee now.' : 'Tha’s mortal again — mind t’ bogs.');
      this.renderAdminPanel();
    });
    const kit = ui.el('button', 'mc', row, 'Full Kit (iron tools an’ all)');
    kit.addEventListener('click', () => {
      const p = this.player;
      [[I.I_PICK, 1], [I.I_AXE, 1], [I.I_SHOVEL, 1], [I.I_SWORD, 1],
       [I.COAL_LUMP, 64], [B.TORCH, 64], [B.LANTERN, 8], [B.PLANKS, 64],
       [B.STONEBRICK, 64], [I.COOKED_MUTTON, 16]].forEach(([id, n]) => p.addItem(id, n));
      ui.invDirty = true;
      ui.toast('Kitted out proper.');
    });
    ui.el('div', 'r-needs', panel, 'Whisk thissen anywhere:');
    const tp = ui.el('div', 'admin-tp', panel);
    const geo = this.world.gen.geo;
    for (const v of geo.villages) {
      const b = ui.el('button', 'mc chat-btn', tp, v.name);
      b.addEventListener('click', () => this.adminTeleport(v.x, v.z, v.name));
    }
    for (const s of geo.railway()) {
      const b = ui.el('button', 'mc chat-btn', tp, s.name + ' Stn');
      b.addEventListener('click', () => this.adminTeleport(s.x, s.z, s.name + ' Station'));
    }
    for (const [label, x, z] of [['Roseberry Topping', -700, -880], ['T’ Hole of Horcum', 540, 680],
                                 ['T’ Abbey', geo.abbeySite().x, geo.abbeySite().z],
                                 ['T’ Wainstones', -380, -620], ['Rosedale Kilns', -260, 380]]) {
      const b = ui.el('button', 'mc chat-btn', tp, label);
      b.addEventListener('click', () => this.adminTeleport(x, z, label));
    }
    // drop in on a player (shared moor only — t' relay answers wardens wi' t' map)
    if (this.netActive && this.net && this.net.connected) {
      ui.el('div', 'r-needs', panel, 'Drop in on a player:');
      const pl = ui.el('div', 'admin-tp', panel);
      ui.el('div', 'r-needs', pl, 'asking t’ relay...');
      this.net.requestWhere(players => {
        if (this.state !== 'paused') return; // panel's closed — let it be
        pl.innerHTML = '';
        const mePid = (this.auth && this.auth.acct ? 'a' + this.auth.acct : this.devicePid()).slice(0, 40);
        const others = players.filter(q => q.pid !== mePid);
        if (!others.length) { ui.el('div', 'r-needs', pl, 'nob’dy else out just now'); return; }
        for (const q of others) {
          const d = Math.round(Math.hypot(q.x - this.player.pos.x, q.z - this.player.pos.z));
          const b = ui.el('button', 'mc chat-btn', pl, `${q.name} (${d}m)`);
          b.addEventListener('click', () => this.adminTeleport(Math.floor(q.x), Math.floor(q.z), q.name));
        }
      });
    }
    // or owt else: straight to coordinates
    ui.el('div', 'r-needs', panel, 'Or drop at coordinates:');
    const coordRow = ui.el('div', 'admin-btns', panel);
    const ix = ui.el('input', 'chat-input admin-coord', coordRow); ix.placeholder = 'x';
    const iz = ui.el('input', 'chat-input admin-coord', coordRow); iz.placeholder = 'z';
    const go = ui.el('button', 'mc chat-btn', coordRow, 'Drop');
    go.addEventListener('click', () => {
      const x = parseInt(ix.value, 10), z = parseInt(iz.value, 10);
      if (Number.isFinite(x) && Number.isFinite(z)) this.adminTeleport(x, z, `${x}, ${z}`);
    });
  }

  // Warden travel: tha doesn't walk, tha ARRIVES — dropped frae t' sky,
  // landing wi' a thump as t' parish will notice.
  adminTeleport(x, z, label) {
    const p = this.player;
    const g = this.world.gen.height(Math.floor(x), Math.floor(z));
    p.pos.x = x + 0.5; p.pos.z = z + 0.5;
    p.pos.y = Math.min(HEIGHT - 2, g + 38);
    if (p.vel) { p.vel.x = 0; p.vel.y = 0; p.vel.z = 0; }
    p.fallStart = null;
    p.flying = false; // creative hover would spoil t' entrance
    this.wardenDrop = { label, t: 0 };
    this.resume();
    this.ui.toast(`Dropping in ower <b>${label}</b>...`, 2500);
  }

  // a warden hits t' ground like a dropped anvil: dust ring an' a thump
  landImpact(x, y, z, mine) {
    const e = this.entities;
    if (e) {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        e.burst(x + Math.cos(a) * 1.6, y + 0.3, z + Math.sin(a) * 1.6, [122, 106, 82], 4);
      }
      e.burst(x, y + 0.6, z, [186, 178, 156], 12);
    }
    if (this.audio && this.audio.noiseBurst && this.audio.ctx) {
      const dNow = Math.hypot(x - this.player.pos.x, z - this.player.pos.z);
      const gain = Math.max(0.06, 0.5 - dNow / 200);
      this.audio.noiseBurst(this.audio.ctx.currentTime, 0.28, gain, 90, 'lowpass');
      this.audio.noiseBurst(this.audio.ctx.currentTime + 0.05, 0.12, gain * 0.6, 240, 'lowpass');
    }
    if (mine && this.netActive && this.net) this.net.sendFx('land', x, y, z);
  }

  // a warden's flourish happening near us (relayed by t' moor)
  remoteFx(m) {
    if (m.kind === 'land') this.landImpact(m.x, m.y, m.z, false);
  }

  resume() {
    this.state = 'playing';
    this.ui.show(null);
    this.lockPointer();
  }

  openInventory() {
    this.state = 'inv';
    this.mouseDown = [false, false, false];
    this.clearKeys();
    document.exitPointerLock?.();
    this.ui.openInventory(this.player, this.nearBench());
  }

  closeScreens() {
    this.ui.closeInventory(this.player);
    this.state = 'playing';
    this.ui.show(null);
    this.lockPointer();
  }

  // ---------------- villagers & chat ----------------
  async spawnVillagers() {
    if (this.villagersSpawned) return;
    this.villagersSpawned = true;
    let roster = await npc.fetchRoster();
    const online = !!roster && roster.length > 0;
    if (!online) roster = npc.FALLBACK_ROSTER;
    const geo = this.world.gen.geo;
    for (const c of roster) {
      // folk live all ower t' moors now — t' roster says which settlement
      const village = (c.village && geo.villages.find(v => v.name.toLowerCase() === c.village.toLowerCase())) || geo.village;
      const [x, z] = geo.npcSpot(c.name, village);
      const h = this.world.gen.height(Math.floor(x), Math.floor(z));
      this.entities.spawnVillager(c.id, c.name, x + 0.5, h + 1.1, z + 0.5, {
        village: village.name,
        house: geo.npcHome(c.name, village),
      });
    }
    this.ui.toast(online
      ? '<b>Right-click</b> t&rsquo; folk o&rsquo; t&rsquo; moors for a natter &mdash; every settlement&rsquo;s got its own. After dark, knock on their doors.'
      : 'T&rsquo; villages stand quiet &mdash; t&rsquo; brain in&rsquo;t answering (yet).', 8000);
    if (online) this.refreshStanding(false);
    else this.scheduleRosterRetry(3);
  }

  // T' brain can be slow to wake (cold tunnel, model loading): keep trying
  // quietly and breathe life into t' villagers when it answers.
  scheduleRosterRetry(attemptsLeft) {
    if (attemptsLeft <= 0) return;
    setTimeout(async () => {
      if (!this.world || this.villagersBound) return;
      const roster = await npc.fetchRoster();
      if (roster && roster.length) {
        this.villagersBound = true;
        for (const m of this.entities.mobs) {
          if (m.type !== 'villager' || m.charId) continue;
          const hit = roster.find(c => c.name.toLowerCase() === m.t.name.toLowerCase())
            || roster.find(c => c.name.toLowerCase().includes(m.t.name.toLowerCase().split(' ').pop()));
          if (hit) m.charId = hit.id;
        }
        this.ui.toast('T&rsquo; village brain&rsquo;s woken up &mdash; t&rsquo; folk have found their tongues!', 6000);
        this.refreshStanding(false);
      } else {
        this.scheduleRosterRetry(attemptsLeft - 1);
      }
    }, 10000);
  }

  // Identity. Invited players: account-based (follows them across devices).
  // Ramblers: per-browser UUID. Both scoped per world seed for NPC memory.
  devicePid() {
    let pid = localStorage.getItem('moorcraft-pid');
    if (!pid) {
      pid = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
      localStorage.setItem('moorcraft-pid', pid);
    }
    return pid;
  }

  playerId() {
    if (this.auth && this.auth.acct) {
      return `a${this.auth.acct}-s${this.seed}`.toLowerCase().slice(0, 64);
    }
    return `${this.devicePid()}-s${this.seed}`.toLowerCase().slice(0, 64);
  }

  async login() {
    const code = this.ui.loginCode.value.trim().toLowerCase();
    const name = this.ui.loginName.value.trim();
    if (!code || !name) {
      this.ui.loginErr.textContent = 'Code an\u2019 name both, love.';
      return;
    }
    this.ui.loginErr.textContent = 'Asking t\u2019 parish clerk...';
    try {
      const res = await fetch('/dash/auth/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name, pid: this.devicePid() }),
      });
      const d = await res.json();
      if (!d.ok) {
        this.ui.loginErr.textContent = d.err || 'That didn\u2019t work.';
        return;
      }
      this.auth = { code, name: d.name, acct: d.acct, room: d.room || 'moor' };
      localStorage.setItem('moorcraft-auth', JSON.stringify(this.auth));
      this.saveAccount(this.auth);
      this.refreshAdmin();
      this.ui.loginErr.textContent = '';
      this.ui.setLoggedIn(this.auth);
    } catch {
      this.ui.loginErr.textContent = 'Can\u2019t reach t\u2019 parish clerk \u2014 try again in a minute, or come in as a rambler.';
    }
  }

  // Quiet re-claim wi' t' stored code: picks up room moves an' name changes
  // made on t' ledger since last visit. Best-effort — offline, carry on.
  async refreshAuth() {
    if (!this.auth || !this.auth.code) return;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch('/dash/auth/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: this.auth.code, name: this.auth.name || '', pid: this.devicePid() }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      const d = await res.json();
      if (d && d.ok) {
        this.auth = { code: this.auth.code, name: d.name, acct: d.acct, room: d.room || 'moor' };
        localStorage.setItem('moorcraft-auth', JSON.stringify(this.auth));
        this.saveAccount(this.auth);
        this.refreshAdmin();
        this.ui.setLoggedIn(this.auth);
      } else if (d && /No such invite/i.test(d.err || '')) {
        // t' token's been retired in a reset — don't limp on wi' a dead identity
        this.logout();
        this.ui.toast('Thi owd invite’s been retired — ask t’ warden for a fresh un.', 8000);
      }
    } catch { /* parish clerk's having his tea */ }
  }

  loginGuest() {
    this.auth = { guest: true, name: '' };
    localStorage.setItem('moorcraft-auth', JSON.stringify(this.auth));
    this.ui.setLoggedIn(this.auth);
  }

  logout() {
    this.auth = null;
    localStorage.removeItem('moorcraft-auth');
    this.ui.setLoggedIn(null);
  }

  // ---- saved logins: switch between folk who share this browser ----
  // A roster o' real accounts (not ramblers), so t' family can hop between
  // their own pockets an' ventures wi'out keyin' t' invite code each time.
  loadAccounts() {
    try { return JSON.parse(localStorage.getItem('moorcraft-accounts') || '[]'); } catch { return []; }
  }

  saveAccount(auth) {
    if (!auth || !auth.code || auth.guest) return; // ramblers leave no trace
    const roster = this.loadAccounts().filter(a => a.acct !== auth.acct);
    roster.unshift({ code: auth.code, name: auth.name, acct: auth.acct, room: auth.room || 'moor' });
    localStorage.setItem('moorcraft-accounts', JSON.stringify(roster.slice(0, 8)));
  }

  switchAccount(acct) {
    const a = this.loadAccounts().find(x => x.acct === acct);
    if (!a) return;
    this.auth = { code: a.code, name: a.name, acct: a.acct, room: a.room || 'moor' };
    localStorage.setItem('moorcraft-auth', JSON.stringify(this.auth));
    this.refreshAdmin();
    this.ui.setLoggedIn(this.auth);
    this.ui.toast(`Now playing as <b>${a.name}</b>.`, 3000);
    this.refreshAuth(); // quiet re-claim picks up owt t' ledger's changed
  }

  forgetAccount(acct) {
    localStorage.setItem('moorcraft-accounts', JSON.stringify(this.loadAccounts().filter(a => a.acct !== acct)));
    this.ui.setLoggedIn(this.auth);
  }

  // ---- friendship has its rewards ----
  // Tier ladder matches t' brain's memory.TRUST_TIERS.
  static TIER_ORDER = ['Stranger', 'Acquaintance', 'Friendly', 'Friend', 'Close friend'];
  static TIER_REWARDS = {
    1: { items: [[I.BILBERRIES, 4]], note: 'a handful o\u2019 bilberries' },
    2: { items: [[I.COOKED_MUTTON, 3]], note: 'some roast mutton, still warm' },
    3: { items: [[I.IRON_INGOT, 2]], note: 'two good iron ingots' },
    4: { items: [[I.JET_GEM, 1]], note: 'a polished piece o\u2019 Whitby jet \u2014 a family treasure' },
  };

  maybeReward(villager, tier) {
    const idx = Game.TIER_ORDER.indexOf(tier);
    if (idx < 0 || !villager.charId) return;
    const had = this.player.npcRewards[villager.charId] ?? 0;
    if (idx <= had) return;
    this.player.npcRewards[villager.charId] = idx;
    for (let t = had + 1; t <= idx; t++) {
      const rw = Game.TIER_REWARDS[t];
      if (!rw) continue;
      for (const [id, n] of rw.items) {
        const left = this.player.addItem(id, n);
        if (left > 0) this.dropAtPlayer(id, left);
      }
      villager.chatLog.push({
        who: 'sys',
        text: `${villager.displayName} reckons thee a${t >= 3 ? ' true' : 'n'} ${Game.TIER_ORDER[t].toLowerCase()} now \u2014 and presses ${rw.note} into thi hands.`,
      });
      this.audio.pickup();
    }
    this.ui.invDirty = true;
    this.ui.renderChatLog();
    this.refreshStanding(true);
    this.saveNow(false);
  }

  async refreshStanding(announce) {
    try {
      const s = await npc.standing(this.playerId());
      this.standingData = s;
      const label = this.quests ? this.quests.standingLabel() : s.standing;
      if (announce && this.standing && label !== this.standing) {
        this.ui.toast(`Word\u2019s gone round Moorstead \u2014 tha\u2019s <b>${label}</b> in t\u2019 village now.`, 6000);
      }
      this.standing = label;
      this.quests.refreshOffers();
    } catch { /* brain offline — standing stays unknown */ }
  }

  openChat(villager) {
    this.state = 'chat';
    this.mouseDown = [false, false, false];
    this.clearKeys();
    villager.chatting = true;
    document.exitPointerLock?.();
    this.ui.chatWaiting = false;
    this.ui.openChat(villager, !!this.player.name);
  }

  closeChat() {
    if (this.ui.chatVillager) this.ui.chatVillager.chatting = false;
    this.state = 'playing';
    this.ui.show(null);
    this.lockPointer();
  }

  setPlayerName() {
    const name = this.ui.chatNameInput.value.trim();
    if (!name) return;
    this.player.name = name;
    this.ui.chatNameRow.classList.add('hidden');
    this.ui.chatInputRow.classList.remove('hidden');
    this.ui.chatInput.focus();
    this.saveNow(false);
  }

  async sendChat() {
    const v = this.ui.chatVillager;
    const text = this.ui.chatInput.value.trim();
    if (!v || !text || this.ui.chatWaiting) return;
    this.ui.chatInput.value = '';
    v.chatLog.push({ who: 'you', text });
    if (!v.charId) {
      v.chatLog.push({ who: 'sys', text: `${v.displayName} says nowt \u2014 t\u2019 village brain in\u2019t running.` });
      this.ui.renderChatLog();
      return;
    }
    this.ui.chatWaiting = true;
    this.ui.renderChatLog();
    try {
      const t0 = performance.now();
      const res = await npc.talk(v.charId, text, this.player.name, this.playerId(), this.quests.chatContext(v));
      this.lastTalkMs = performance.now() - t0;
      this.lastTalkAt = performance.now();
      v.chatLog.push({ who: 'them', text: res.reply });
      v.tier = res.tier;
      this.ui.setChatTier(res.tier);
      this.maybeReward(v, res.tier);
    } catch {
      v.chatLog.push({ who: 'sys', text: 'T\u2019 brain didn\u2019t answer \u2014 is Ollama up an\u2019 running?' });
    }
    this.ui.chatWaiting = false;
    this.ui.renderChatLog();
  }

  async giveGift() {
    const v = this.ui.chatVillager;
    const held = this.player.heldItem();
    if (!v || this.ui.chatWaiting) return;
    if (!held) { this.ui.toast('Tha&rsquo;s got nowt in hand to give.'); return; }
    if (!v.charId) {
      this.ui.toast('No use &mdash; t&rsquo; brain&rsquo;s asleep.');
      return;
    }
    const giftName = itemName(held.id).toLowerCase().replace(/^(raw|roast)\s+/, '')
      .replace(/\s*\(.*\)$/, '').replace('bilberries', 'bilberry').replace(/\s+bush$/, '');
    this.player.consumeHeld();
    this.ui.invDirty = true;
    v.chatLog.push({ who: 'sys', text: `Tha gives ${v.displayName} thi ${itemName(held.id)}.` });
    this.ui.renderChatLog();
    try {
      const res = await npc.gift(v.charId, giftName, this.playerId());
      v.tier = res.tier;
      this.ui.setChatTier(res.tier);
      v.chatLog.push({ who: 'sys', text: `${v.displayName} seems right chuffed. (${res.tier})` });
      this.maybeReward(v, res.tier);
    } catch {
      v.chatLog.push({ who: 'sys', text: 'T\u2019 gift went unmarked \u2014 brain trouble.' });
    }
    this.ui.renderChatLog();
  }

  readSignpost() {
    const geo = this.world.gen.geo;
    const p = this.player.pos;
    const dirTo = (x, z) => {
      const d = Math.hypot(x - p.x, z - p.z) | 0;
      const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
      const ang = Math.atan2(x - p.x, -(z - p.z)) * 180 / Math.PI;
      return `${dirs[Math.round(((ang + 360) % 360) / 45) % 8]} \u00b7 ${d}m`;
    };
    const v = geo.village;
    let msg = `<b>MOORSTEAD</b> \u2014 ${dirTo(v.x, v.z)}`;
    const sh = geo.nearestShelter(p.x, p.z);
    if (sh && sh.dist > 10) msg += `<br><b>MOOR SHELTER</b> \u2014 ${dirTo(sh.x, sh.z)}`;
    else if (sh) msg = `<b>MOOR SHELTER</b> \u2014 tha\u2019s stood at it<br>` + msg;
    this.ui.toast(msg, 8000);
  }

  // ---------------- sleeping ----------------
  // Neet passes if tha can find shelter: a roof ower thi head an' a flame
  // near — any house, t' pub, a moor shelter, or a cottage tha's built thissen.
  canSleepHere() {
    if (!this.world || !this.sky.isNight()) return 'not night';
    const p = this.player.pos;
    const px = Math.floor(p.x), py = Math.floor(p.y + (this.player.eye || 1.6)), pz = Math.floor(p.z);
    let roofed = false;
    for (let y = py + 1; y <= Math.min(HEIGHT - 1, py + 14); y++) {
      if (isSolid(this.world.getBlock(px, y, pz))) { roofed = true; break; }
    }
    if (!roofed) return 'no roof';
    for (let dx = -6; dx <= 6; dx++) {
      for (let dy = -3; dy <= 3; dy++) {
        for (let dz = -6; dz <= 6; dz++) {
          const id = this.world.getBlock(px + dx, py + dy, pz + dz);
          if (id === B.TORCH || id === B.LANTERN) return 'ok';
        }
      }
    }
    return 'no light';
  }

  trySleep() {
    if (this.state !== 'playing') return;
    if (!this.sky.isNight()) { this.ui.toast('Tha can only sleep of a neet.'); return; }
    const why = this.canSleepHere();
    if (why !== 'ok') {
      this.ui.toast(why === 'no roof'
        ? 'Nowhere to kip here — find a roof: a house, t’ pub, or a moor shelter.'
        : 'Too dark an’ cold to settle — get thissen near a torch or lantern first.', 5000);
      return;
    }
    this.state = 'sleeping';
    this.clearKeys();
    this.mouseDown = [false, false, false];
    this.sleepT = 0;
    this.ui.sleepScreen.classList.remove('hidden');
    if (this.netActive && this.net && this.net.connected) {
      this.ui.sleepText.textContent = 'waiting for t’ others to kip down...';
      this.net.sendSleep(true);
    } else {
      this.ui.sleepText.textContent = '';
    }
  }

  cancelSleep(msg) {
    if (this.state !== 'sleeping') return;
    this.state = 'playing';
    this.ui.sleepScreen.classList.add('hidden');
    if (this.netActive && this.net && this.net.connected) this.net.sendSleep(false);
    if (msg) this.ui.toast(msg, 4000);
  }

  finishWake() {
    this.state = 'playing';
    this.ui.sleepScreen.classList.add('hidden');
    const p = this.player;
    p.health = 20;
    p.hunger = Math.max(0, p.hunger - 3);
    p.air = 10;
    this.ui.toast('Tha wakes wi’ t’ dawn, right as rain — an’ a bit peckish.', 5000);
  }

  // relay says t' neet has passed for t' whole room (time lands separately)
  onWake() {
    if (this.state === 'sleeping') this.finishWake();
  }

  onSleepers(n, total) {
    if (this.state === 'sleeping') {
      this.ui.sleepText.textContent = `waiting for t’ others to kip down... (${n}/${total} abed)`;
    } else if (n > 0 && this.sky.isNight() && this.state === 'playing') {
      const now = performance.now() / 1000;
      if (!this._sleepNag || now - this._sleepNag > 60) {
        this._sleepNag = now;
        this.ui.toast(`${n} o’ ${total} are abed — find a roof an’ a light, press <b>N</b>, an’ t’ neet will pass for all.`, 8000);
      }
    }
  }

  // ---------------- t' shared moor ----------------
  async joinShared() {
    const { strSeed: ss, hash2i } = await import('./noise.js');
    this.netActive = true;
    // each group gets its own moor: t' room comes frae thi account
    // ('moor' = t' original world; owt else gets its own seed an' all)
    await this.refreshAuth();
    let room = ((this.auth && this.auth.room) || 'moor').toLowerCase();
    // t' warden may walk onto any world — bairns or adults, not just their own
    if (this.isAdmin()) room = (await this.ui.pickWorld(room)) || room;
    this.netRoom = room;
    this.startWorld(ss(room === 'moor' ? 't-shared-moor' : 't-shared-moor:' + room), null, new Map());
    // folk wake spread across t' villages, same one each visit
    const who = (this.auth && this.auth.acct) || this.devicePid();
    const idx = Math.floor(hash2i(ss(who), 7, 99) * this.world.gen.geo.villages.length);
    this.spawn = this.world.gen.findSpawnAt(idx);
    this.player.pos = { ...this.spawn };
    this.ui.toast(`Walking up onto <b>T\u2019 Shared Moor</b> \u2014 tha wakes in <b>${this.spawn.village}</b>. Builds, pockets an\u2019 ventures all keep. <b>T</b> to talk (speech carries ~60m).`, 10000);
  }

  async connectNet() {
    this.net = new Net(this);
    try {
      await this.net.connect(this.netRoom || 'moor', (this.auth && this.auth.acct ? 'a' + this.auth.acct : this.devicePid()).slice(0, 40), this.player.name || (this.auth && this.auth.name) || 'rambler');
      // pick up where tha left off: pockets, ventures, an' thi spot on t' map
      const sv = this.net.savedState;
      if (sv && sv.player) {
        this.player.deserialize(sv.player);
        this.quests.deserialize(sv.quests);
        this.ui.invDirty = true;
        this.ui.toast('Welcome back to t\u2019 shared moor \u2014 thi things are as tha left \u2019em.', 6000);
      } else {
        this.ui.toast('Tha\u2019s on t\u2019 shared moor. Whoever else is out here, tha\u2019ll see \u2019em.', 6000);
      }
    } catch {
      this.ui.toast('Couldn\u2019t reach t\u2019 shared moor \u2014 playing it alone for now.', 6000);
    }
  }

  openNetChat() {
    this.state = 'netchat';
    this.clearKeys();
    this.ui.netChatRow.classList.remove('hidden');
    setTimeout(() => this.ui.netChatInput.focus(), 30);
  }

  closeNetChat() {
    this.ui.netChatInput.value = '';
    this.ui.netChatRow.classList.add('hidden');
    this.state = 'playing';
    this.renderer.domElement.focus?.();
  }

  // ---------------- t' Moors Railway ----------------
  // ONE train, running t' line forever on t' shared clock — same for every
  // player, so tha can watch her steam past frae out on t' moor.
  // per-leg running times frae t' real alignment: trapezoid speed profile
  // ower t' spline's chainage — long legs genuinely take longer
  railLegs() {
    const geo = this.world.gen.geo;
    if (this._legGeo === geo) return this._legs;
    const path = geo.railPath();
    const legs = [];
    for (let i = 0; i < path.stationS.length - 1; i++) {
      const len = path.stationS[i + 1] - path.stationS[i];
      legs.push({ len, t: legTime(len), s0: path.stationS[i], s1: path.stationS[i + 1] });
    }
    this._legGeo = geo;
    this._legs = legs;
    return legs;
  }

  trainSchedule(nowSec) {
    const geo = this.world.gen.geo;
    const st = geo.railway();
    const legs = this.railLegs();
    const n = st.length;
    const oneway = legs.reduce((a, l) => a + l.t, 0) + n * DWELL_T;
    const now = nowSec !== undefined ? nowSec : Date.now() / 1000;
    const dir = Math.floor(now / oneway) % 2;
    const idx = k => (dir === 0 ? k : n - 1 - k);
    const leg = k => legs[dir === 0 ? k : n - 2 - k]; // t' leg run after t' k-th call
    let tt = now % oneway;
    for (let k = 0; k < n; k++) {
      if (tt < DWELL_T) {
        const sAt = geo.railPath().stationS[idx(k)];
        const sp = geo.samplePos(sAt);
        return { mode: 'dwell', i: idx(k), dwellLeft: DWELL_T - tt, dir, s: sAt, x: sp.x, z: sp.z };
      }
      tt -= DWELL_T;
      if (k < n - 1) {
        const L = leg(k);
        if (tt < L.t) {
          const run = runProfile(L.len, tt);
          // dir 0 runs up t' chainage, dir 1 back down it
          const s = dir === 0 ? L.s0 + run.dist : L.s1 - run.dist;
          const sp = geo.samplePos(s);
          return { mode: 'run', from: idx(k), to: idx(k + 1), frac: run.dist / L.len, dir,
                   s, x: sp.x, z: sp.z, speed: run.v + 0.05 };
        }
        tt -= L.t;
      }
    }
    return { mode: 'dwell', i: idx(n - 1), dwellLeft: 1, dir, s: geo.railPath().stationS[idx(n - 1)] };
  }

  // seconds till t' train next calls at station i
  nextCallAt(i) {
    const now = Date.now() / 1000;
    for (let dt = 0; dt < 1800; dt += 2) {
      const s = this.trainSchedule(now + dt);
      if (s.mode === 'dwell' && s.i === i) return dt;
    }
    return 0;
  }

  fmtMins(s) {
    return s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`;
  }

  openStation(st) {
    this.state = 'board';
    this.clearKeys();
    this.mouseDown = [false, false, false];
    document.exitPointerLock?.();
    const ui = this.ui;
    ui.boardPanel.innerHTML = '';
    const stations = this.world.gen.geo.railway();
    const stIdx = stations.indexOf(st);
    const sched = this.trainSchedule();
    const hereNow = sched.mode === 'dwell' && sched.i === stIdx;
    ui.el('div', 'inv-title', ui.boardPanel, `${st.name} Station \u2014 T\u2019 Moors Railway`);
    ui.el('div', 'r-needs', ui.boardPanel, hereNow
      ? `<b style="color:#9ec27a">She\u2019s stood at t\u2019 platform now</b> \u2014 ${Math.round(sched.dwellLeft)}s afore she\u2019s away. Book on an\u2019 tha\u2019s straight aboard.`
      : `Next train calls in <b style="color:#d8b95a">${this.fmtMins(this.nextCallAt(stIdx))}</b>. Book on, then be stood on t\u2019 platform when she comes in.`);
    const list = ui.el('div', 'recipes board-list', ui.boardPanel);
    // honest distances: chainage along t' actual alignment, curves an' all
    const stS = this.world.gen.geo.railPath().stationS;
    const lineDist = (a, b) => Math.abs(stS[stations.indexOf(b)] - stS[stations.indexOf(a)]);
    const myCoal = this.player.countItem(I.COAL_LUMP);
    for (const dest of stations) {
      if (dest === st) continue;
      const row = ui.el('div', 'recipe quest-row', list);
      const d = lineDist(st, dest) | 0;
      const fare = this.player.creative ? 0 : Math.max(1, Math.min(4, Math.ceil(d / 400)));
      row.innerHTML = `<div class="r-name"><b>${dest.name}</b><br><span class="r-needs">${d}m down t\u2019 line \u2014 fare: ${fare ? fare + '\u00d7 coal' : 'free (creative)'} (tha\u2019s got ${myCoal})</span></div>`;
      const b = ui.el('button', 'mc chat-btn', row, 'All aboard');
      b.addEventListener('click', () => {
        if (fare > 0 && this.player.countItem(I.COAL_LUMP) < fare) {
          this.ui.toast(`T\u2019 engine eats coal, love \u2014 fare\u2019s ${fare} lump${fare > 1 ? 's' : ''} an\u2019 tha\u2019s got ${this.player.countItem(I.COAL_LUMP)}.`);
          return;
        }
        if (fare > 0) { this.player.removeItem(I.COAL_LUMP, fare); this.ui.invDirty = true; }
        this.pendingRide = { stIdx, destIdx: stations.indexOf(dest), fare, warned: {} };
        this.closeScreens();
        const sNow = this.trainSchedule();
        if (sNow.mode === 'dwell' && sNow.i === stIdx) {
          this.ui.toast(`Booked for <b>${dest.name}</b> \u2014 straight aboard wi\u2019 thee!`, 4000);
        } else {
          this.ui.toast(`Booked for <b>${dest.name}</b>. T\u2019 train calls in <b>${this.fmtMins(this.nextCallAt(stIdx))}</b> \u2014 be on t\u2019 platform.`, 6000);
        }
      });
    }
    const close = ui.el('button', 'mc', ui.boardPanel, 'Not today, ta');
    close.addEventListener('click', () => this.closeScreens());
    ui.show('boardScreen');
  }

  // T' one true train: rendered out on t' moor for all to see, boarded at
  // platforms, ridden frae a window seat.
  updateTrainWorld(dt) {
    if (!this.world || this.state === 'title' || this.state === 'loading') return;
    const geo = this.world.gen.geo;
    const st = geo.railway();
    const s = this.trainSchedule();
    const sp = geo.samplePos(s.s);
    const x = sp.x, z = sp.z;
    let rotY = this.trainRot || 0, pitch = 0, moving = false, speed = 0;
    // she faces along t' rails — t' spline's tangent, flipped for t' down trains
    const fwd = s.dir === 0 ? 1 : -1;
    if (Math.hypot(sp.tx, sp.tz) > 0.01) rotY = Math.atan2(sp.tx * fwd, sp.tz * fwd);
    pitch = -Math.atan(sp.grade * fwd);
    if (s.mode === 'run') {
      moving = true;
      speed = s.speed; // already blocks/s
    }
    this.trainRot = rotY;
    this.trainState = { x, z, rotY, s };

    const p = this.player.pos;
    const near = Math.hypot(x - p.x, z - p.z) < 260;
    const show = (near || this.state === 'riding') && this.world.isLoaded(Math.floor(x), Math.floor(z));
    if (!this.train) this.train = buildTrain();
    const parts = this.train.parts;
    if (show) {
      // each body takes its own spot on t' spline, so t' rake bends
      // honestly through t' curves an' noses into t' gradients
      for (const part of parts) {
        const pg = part.group;
        if (!pg.parent) { this.scene.add(pg); pg.rotation.order = 'YXZ'; }
        const psp = geo.samplePos(s.s + part.offset * fwd);
        const deck = psp.deck + 1;
        pg.position.x = psp.x; pg.position.z = psp.z;
        pg.position.y = pg.position.y ? pg.position.y + (deck - pg.position.y) * Math.min(1, dt * 6) : deck;
        if (Math.hypot(psp.tx, psp.tz) > 0.01) pg.rotation.y = Math.atan2(psp.tx * fwd, psp.tz * fwd);
        const ppitch = -Math.atan(psp.grade * fwd);
        pg.rotation.x += (ppitch - pg.rotation.x) * Math.min(1, dt * 4);
        if (moving && part.wheels) {
          for (const w of part.wheels) w.rotateZ(-fwd * speed * dt / (w.userData.r || 0.62));
        }
      }
      // coupling rods ride t' crank pins, quartered like t' real thing
      if (moving && this.train.loco.rods) {
        this.train.rodPhase = (this.train.rodPhase || 0) - fwd * speed * dt / 0.62;
        this.train.loco.rods.forEach((rod, i) => {
          const th = this.train.rodPhase + i * Math.PI / 2;
          rod.position.y = 0.62 + Math.sin(th) * 0.32;
          rod.position.z = 0.2 + Math.cos(th) * 0.32;
        });
      }
      if (moving) {
        this.trainChuff = (this.trainChuff || 0) - dt;
        if (this.trainChuff <= 0) {
          this.trainChuff = Math.max(0.16, 8 / Math.max(speed, 3));
          const dNow = Math.hypot(x - p.x, z - p.z);
          if (dNow < 150 || this.state === 'riding') {
            this.audio.noiseBurst && this.audio.noiseBurst(this.audio.ctx ? this.audio.ctx.currentTime : 0, 0.09, Math.max(0.03, 0.14 - dNow / 1500), 600, 'bandpass');
          }
          const lg = this.train.loco.group;
          const fn = this.train.funnel.clone().applyQuaternion(lg.quaternion).add(lg.position);
          this.entities.burst(fn.x, fn.y, fn.z, [228, 228, 232], 5);
        }
      }
      // whistle when she arrives or departs near thee
      const key = s.mode + (s.mode === 'dwell' ? s.i : s.from);
      if (key !== this.lastTrainKey) {
        this.lastTrainKey = key;
        if (near && this.state !== 'riding') {
          this.audio.whistle && this.audio.whistle(0.35);
          if (s.mode === 'dwell') this.ui.toast(`T\u2019 train\u2019s come in at <b>${st[s.i].name}</b> \u2014 ${Math.round(s.dwellLeft)}s at t\u2019 platform.`, 5000);
        }
      }
    } else if (parts[0].group.parent) {
      for (const part of parts) this.scene.remove(part.group);
    }
  }

  // riding: thi seat is in t' carriage, wherever she is on t' curve
  updateRide() {
    const ts = this.trainState;
    const cg = this.train && this.train.carriage.group;
    if (!ts || !cg || !cg.parent) return;
    // a seat o' thi own, so a full carriage o' players sits apart
    if (this.seatOffset === undefined) {
      const hash = [...this.devicePid()].reduce((a, c) => a + c.charCodeAt(0), 0);
      this.seatOffset = [[0.55, -0.7], [-0.55, -0.7], [0.55, 1.0], [-0.55, 1.0]][hash % 4];
    }
    const seatLocal = this.train.seat.clone();
    seatLocal.x = this.seatOffset[0];
    seatLocal.z += this.seatOffset[1] + 0.7;
    const seat = seatLocal.applyQuaternion(cg.quaternion).add(cg.position);
    this.player.pos = { x: seat.x, y: seat.y - this.player.eye, z: seat.z };
    this.player.vel = { x: 0, y: 0, z: 0 };
    if (!this.rideYawSet) {
      this.player.yaw = ts.rotY + Math.PI;
      this.player.pitch = 0;
      this.rideYawSet = true;
    }
    // arrived?
    if (ts.s.mode === 'dwell' && ts.s.i === this.ride.destIdx) {
      const end = this.world.gen.geo.railway()[this.ride.destIdx];
      const g = this.world.gen.height(Math.floor(end.x), Math.floor(end.z + 2));
      this.player.pos = { x: end.x + 0.5, y: g + 2.2, z: end.z + 2.5 };
      this.ride = null;
      this.state = 'playing';
      this.audio.whistle && this.audio.whistle(0.5);
      this.ui.toast(`<b>${end.name}!</b> All change. Mind t\u2019 gap.`, 5000);
    }
  }

  // booked passengers board when she's stood at their platform
  updatePendingRide() {
    const p = this.pendingRide;
    if (!p || !this.trainState) return;
    const st = this.world.gen.geo.railway();
    const s = this.trainState.s;
    if (s.mode === 'dwell' && s.i === p.stIdx && this.state === 'playing') {
      // measured to t' TRAIN herself, not t' station post — easier to board
      const d = Math.hypot(this.player.pos.x - this.trainState.x, this.player.pos.z - this.trainState.z);
      if (d < 18) {
        this.pendingRide = null;
        this.ride = { destIdx: p.destIdx };
        this.state = 'riding';
        this.rideYawSet = false;
        this.player.flying = false;
        this.audio.whistle && this.audio.whistle();
        this.ui.toast(`<b>All aboard for ${st[p.destIdx].name}!</b> Tek thi seat \u2014 mouse to look about as t\u2019 moors roll by.`, 6000);
        return;
      }
    }
    // missed it? she's pulled away frae thi station
    if (s.mode === 'run' && s.from === p.stIdx && !p.boarded) {
      this.pendingRide = null;
      this.player.addItem(I.COAL_LUMP, p.fare);
      this.ui.invDirty = true;
      this.ui.toast('Tha missed t\u2019 train, love. Fare\u2019s refunded \u2014 she\u2019ll be back along.', 6000);
    }
  }

  openBoard(fromBoard) {
    this.state = 'board';
    this.mouseDown = [false, false, false];
    this.clearKeys();
    document.exitPointerLock?.();
    this.ui.openBoard(fromBoard);
  }

  openMuseum() {
    this.state = 'museum';
    this.mouseDown = [false, false, false];
    this.clearKeys();
    document.exitPointerLock?.();
    this.ui.openMuseum();
  }

  nearBench() {
    const p = this.player.pos;
    for (let dx = -3; dx <= 3; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -3; dz <= 3; dz++) {
      if (this.world.getBlock(Math.floor(p.x) + dx, Math.floor(p.y) + dy, Math.floor(p.z) + dz) === B.BENCH) return true;
    }
    return false;
  }

  dropAtPlayer(item, n) {
    const p = this.player.pos;
    this.entities.spawnDrop(p.x, p.y + 1, p.z, item, n);
  }

  // ---------------- interaction ----------------
  lookDir() {
    const { yaw, pitch } = this.player;
    return {
      x: -Math.sin(yaw) * Math.cos(pitch),
      y: Math.sin(pitch),
      z: -Math.cos(yaw) * Math.cos(pitch),
    };
  }

  targetBlock() {
    const eye = this.player.eyePos();
    const d = this.lookDir();
    return raycast(this.world, eye.x, eye.y, eye.z, d.x, d.y, d.z, REACH,
      id => isSolid(id) || isCutout(id));
  }

  attackOrMine(firstClick) {
    const eye = this.player.eyePos();
    const d = this.lookDir();
    // mobs first
    const blockHit = this.targetBlock();
    const mobHit = this.entities.raycastMobs(eye.x, eye.y, eye.z, d.x, d.y, d.z, REACH);
    if (mobHit && (!blockHit || mobHit.dist < blockHit.dist)) {
      if (mobHit.mob.type === 'villager') {
        if (firstClick) this.ui.toast('Nay! Tha doesn&rsquo;t clout t&rsquo; neighbours.');
        this.breakTarget = null;
        this.breakProgress = 0;
        return;
      }
      if (firstClick) {
        const held = this.player.heldItem();
        const dmg = held && TOOLS[held.id] ? TOOLS[held.id].dmg : 1;
        const len = Math.hypot(d.x, d.z) || 1;
        this.entities.hurtMob(mobHit.mob, dmg, d.x / len, d.z / len, this.audio, this.player);
        if (this.player.wearTool()) { this.audio.toolSnap(); this.ui.toast('Thi tool&rsquo;s snapped!'); }
        this.ui.invDirty = true;
      }
      this.breakTarget = null;
      this.breakProgress = 0;
    }
  }

  updateMining(dt) {
    if (this.state !== 'playing' || !this.mouseDown[0] || this.player.dead) {
      this.breakTarget = null;
      this.breakProgress = 0;
      this.ui.drawBreakProgress(0);
      return;
    }
    const hit = this.targetBlock();
    // a mob in t' way?
    const eye = this.player.eyePos();
    const d = this.lookDir();
    const mobHit = this.entities.raycastMobs(eye.x, eye.y, eye.z, d.x, d.y, d.z, REACH);
    if (mobHit && (!hit || mobHit.dist < hit.dist)) {
      this.ui.drawBreakProgress(0);
      return;
    }
    if (!hit) {
      this.breakTarget = null;
      this.breakProgress = 0;
      this.ui.drawBreakProgress(0);
      return;
    }
    const key = hit.x + ',' + hit.y + ',' + hit.z;
    if (this.breakTarget !== key) {
      this.breakTarget = key;
      this.breakProgress = 0;
    }
    const def = BLOCKS[hit.id];
    if (def.hard === Infinity) { this.ui.drawBreakProgress(0); return; }

    if (this.player.creative) {
      this.creativeBreakCd = (this.creativeBreakCd || 0) - dt;
      if (this.creativeBreakCd <= 0) {
        this.creativeBreakCd = 0.18;
        this.finishBreak(hit, true);
      }
      this.breakProgress = 0;
      return;
    }

    const held = this.player.heldItem();
    const tool = held ? TOOLS[held.id] : null;
    let speed = 1;
    if (tool && def.tool && tool.type === def.tool) speed = tool.speed;
    if (def.needsPick && (!tool || tool.type !== 'pick')) speed = 0.3;

    this.breakProgress += (dt * speed) / Math.max(0.05, def.hard);
    this.digSoundTimer = (this.digSoundTimer || 0) - dt;
    if (this.digSoundTimer <= 0) { this.audio.dig(def.hard); this.digSoundTimer = 0.25; }
    this.ui.drawBreakProgress(Math.min(1, this.breakProgress));

    if (this.breakProgress >= 1) {
      const noDrop = def.needsPick && (!tool || tool.type !== 'pick');
      this.finishBreak(hit, noDrop);
      this.breakProgress = 0;
      this.breakTarget = null;
      if (this.player.wearTool()) { this.audio.toolSnap(); this.ui.toast('Thi tool&rsquo;s snapped!'); }
      this.player.exhaustion += 0.03;
      this.ui.invDirty = true;
    }
  }

  finishBreak(hit, noDrop) {
    const def = BLOCKS[hit.id];
    this.world.setBlock(hit.x, hit.y, hit.z, B.AIR);
    this.entities.blockBurst(hit.x, hit.y, hit.z, hit.id);
    this.audio.breakBlock();
    if (!this.player.creative && !noDrop && def.drop !== null && def.drop !== undefined) {
      this.entities.spawnDrop(hit.x + 0.5, hit.y + 0.4, hit.z + 0.5, def.drop, 1);
    }
    this.quests.onBlockBroken(hit.x, hit.y, hit.z, hit.id);
    const eph = this.beachEphemeral(hit.x, hit.y, hit.z);
    if (this.net) this.net.sendEdit(hit.x, hit.y, hit.z, 0, eph ? { revert: hit.id } : null);
    if (eph) this.queueBeachRevert(hit.x, hit.y, hit.z, hit.id, 0);

    // fossil hunting: t' bay sands give up their dead, like Whitby an' Bay Town
    if ((hit.id === B.SAND || hit.id === B.GRAVEL) && !this.player.creative) {
      const geo = this.world.gen.geo;
      const ct = geo.coastT(hit.x, hit.z);
      if (ct > 0.1) {
        const inBay = hit.z > 220 && hit.z < 460;
        const r = Math.random();
        const mult = inBay ? 2 : 1; // Robin Hood's Bay is t' spot
        if (r < 0.008 * mult) {
          this.entities.spawnDrop(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, I.JET_GEM, 1, { big: true });
          this.ui.toast('Summat black an\u2019 glossy in t\u2019 sand \u2014 <b>Whitby jet</b>, washed frae t\u2019 cliffs!', 5000);
        } else if (r < 0.035 * mult) {
          this.entities.spawnDrop(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, I.AMMONITE, 1, { big: true });
          this.ui.toast('An <b>ammonite</b>! A snakestone, curled up these two hundred million years.', 5000);
        } else if (r < 0.055 * mult) {
          this.entities.spawnDrop(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, I.GRYPHAEA, 1, { big: true });
          this.ui.toast('A <b>Devil\u2019s Toenail</b> \u2014 an owd oyster turned to stone. Grand.', 5000);
        }
      }
    }
  }

  useItem() {
    if (this.player.dead) return;
    const hit = this.targetBlock();

    // a villager to natter wi'?
    {
      const eye = this.player.eyePos();
      const d = this.lookDir();
      const mobHit = this.entities.raycastMobs(eye.x, eye.y, eye.z, d.x, d.y, d.z, 4.5);
      if (mobHit && mobHit.mob.type === 'villager' && (!hit || mobHit.dist < hit.dist)) {
        if (mobHit.mob.isRemotePlayer) {
          this.ui.toast(`That\u2019s <b>${mobHit.mob.displayName}</b> \u2014 another living soul. Press <b>T</b> to talk to t\u2019 moor.`, 4500);
          return;
        }
        this.openChat(mobHit.mob);
        return;
      }
    }

    // interactable blocks
    if (hit && !this.keys['ShiftLeft']) {
      if (hit.id === B.BENCH) { this.openInventory(); return; }
      if (hit.id === B.BOARD) {
        const geo = this.world.gen.geo;
        if (geo.isMuseumBoard(hit.x, hit.z)) { this.openMuseum(); return; }
        const st = geo.nearStation(hit.x, hit.z, 8);
        if (st) { this.openStation(st); return; }
        this.openBoard(true); return;
      }
      if (hit.id === B.SIGNPOST) { this.readSignpost(); return; }
      if (hit.id === B.RANGE) {
        this.state = 'range';
        this.clearKeys();
        this.mouseDown = [false, false, false];
        document.exitPointerLock?.();
        this.ui.openRange(this.player);
        return;
      }
    }

    const held = this.player.heldItem();
    if (!held) return;

    // a fishing rod? cast toward t' watter, or reel in
    if (held.id === I.FISHING_ROD) { this.useRod(); return; }

    // scran
    if (FOODS[held.id]) {
      if (this.player.eat(this.player.hotbar, this.audio)) this.ui.invDirty = true;
      else if (this.player.hunger >= 20) this.ui.toast('Tha&rsquo;s full to bustin&rsquo;.');
      return;
    }

    // place a block
    if (!isPlaceable(held.id) || !hit) return;
    let px, py, pz;
    if (isCutout(this.world.getBlock(hit.x, hit.y, hit.z))) {
      px = hit.x; py = hit.y; pz = hit.z; // replace plants
    } else {
      px = hit.x + hit.face[0]; py = hit.y + hit.face[1]; pz = hit.z + hit.face[2];
    }
    if (py < 1 || py >= HEIGHT) return;
    const cur = this.world.getBlock(px, py, pz);
    if (isSolid(cur)) return;
    // would it squash t' player?
    if (BLOCKS[held.id].kind === 'solid') {
      const p = this.player.pos;
      const overlap =
        px + 1 > p.x - this.player.hw && px < p.x + this.player.hw &&
        pz + 1 > p.z - this.player.hw && pz < p.z + this.player.hw &&
        py + 1 > p.y && py < p.y + this.player.h;
      if (overlap) return;
    }
    // plants need summat solid underneath
    if (BLOCKS[held.id].kind === 'cutout' && !isSolid(this.world.getBlock(px, py - 1, pz))) return;

    this.world.setBlock(px, py, pz, held.id);
    if (!this.player.creative) this.player.consumeHeld();
    this.audio.place();
    this.ui.invDirty = true;
    this.quests.onBlockPlaced(px, py, pz, held.id);
    const eph = this.beachEphemeral(px, py, pz);
    if (this.net) this.net.sendEdit(px, py, pz, held.id, eph ? { revert: cur } : null);
    if (eph) this.queueBeachRevert(px, py, pz, cur, held.id);
  }

  // ---------------- fishing: cast an' wait ----------------
  useRod() {
    const f = this.fishing;
    if (f && f.active) { // already out — reel in
      if (f.state === 'biting') this.landFish();
      else this.endFishing('Tha reeled in early — nowt bit.');
      return;
    }
    const eye = this.player.eyePos();
    const d = this.lookDir();
    const w = raycast(this.world, eye.x, eye.y, eye.z, d.x, d.y, d.z, REACH + 2, id => id === B.WATER);
    if (!w) { this.ui.toast('Cast toward t’ watter, love — a beck, tarn or t’ sea.'); return; }
    // float rides t' top o' t' water column
    let sy = w.y;
    while (sy < HEIGHT - 1 && this.world.getBlock(w.x, sy + 1, w.z) === B.WATER) sy++;
    const coast = this.world.gen.geo.coastT(w.x, w.z) > 0.1;
    const bob = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5), new THREE.MeshBasicMaterial({ color: 0xd83a2a }));
    bob.position.set(w.x + 0.5, sy + 1.02, w.z + 0.5);
    this.scene.add(bob);
    this.fishing = { active: true, state: 'waiting', bob, x: w.x, y: sy + 1, z: w.z, coast,
      t: 0, biteAt: 2.5 + Math.random() * (coast ? 4 : 6), biteWindow: 0, baseY: sy + 1.02 };
    this.audio.place && this.audio.place();
    this.ui.toast('Line’s in t’ watter — wait for a bite…', 2500);
  }

  updateFishing(dt) {
    const f = this.fishing;
    if (!f || !f.active) return;
    const held = this.player.heldItem();
    if (!held || held.id !== I.FISHING_ROD || this.player.dead || this.state !== 'playing') { this.endFishing(); return; }
    if (Math.hypot(this.player.pos.x - (f.x + 0.5), this.player.pos.z - (f.z + 0.5)) > 9) { this.endFishing('Tha wandered off — t’ line went slack.'); return; }
    f.t += dt;
    if (f.state === 'waiting') {
      f.bob.position.y = f.baseY + Math.sin(f.t * 2) * 0.03; // gentle bob
      if (f.t >= f.biteAt) {
        f.state = 'biting'; f.biteWindow = 1.3; f.t = 0;
        this.ui.toast('<b>A bite!</b> Right-click sharp to reel her in!', 1400);
        this.audio.pickup && this.audio.pickup();
      }
    } else if (f.state === 'biting') {
      f.bob.position.y = f.baseY - 0.16 + Math.sin(f.t * 34) * 0.05; // t' float jerks under
      f.biteWindow -= dt;
      if (f.biteWindow <= 0) this.endFishing('She got away — too slow on t’ reel.');
    }
  }

  landFish() {
    const f = this.fishing;
    const fish = f.coast ? (Math.random() < 0.8 ? I.SEA_FISH : I.RAW_TROUT)   // mackerel an' cod off t' coast
                         : (Math.random() < 0.85 ? I.RAW_TROUT : I.SEA_FISH); // trout in t' becks an' tarns
    this.player.addItem(fish, 1);
    this.ui.invDirty = true;
    this.audio.pickup && this.audio.pickup();
    this.ui.toast(`Tha’s landed <b>${fish === I.SEA_FISH ? 'a fine sea fish' : 'a bonny brown trout'}</b>!`, 3000);
    this.endFishing();
  }

  endFishing(msg) {
    const f = this.fishing;
    if (f && f.bob) this.scene.remove(f.bob);
    this.fishing = null;
    if (msg) this.ui.toast(msg, 3000);
  }

  // ---------------- t' healing sands ----------------
  // Beach edits aren't forever: t' tide smooths t' sands back ower a few
  // minutes, so t' fossil grounds aren't ruined for t' next comer. T' relay
  // does t' same server-side for t' shared moor.
  beachEphemeral(x, y, z) {
    if (!this.world) return false;
    return this.world.gen.geo.coastT(x, z) > 0.25 && y <= WATER_LEVEL + 4;
  }

  queueBeachRevert(x, y, z, oldId, newId) {
    this.beachReverts = this.beachReverts || [];
    this.beachReverts.push({ x, y, z, oldId, newId, at: performance.now() / 1000 + 180 + Math.random() * 120 });
  }

  processBeachReverts() {
    if (!this.beachReverts || !this.beachReverts.length || !this.world) return;
    const now = performance.now() / 1000;
    for (let i = this.beachReverts.length - 1; i >= 0; i--) {
      const r = this.beachReverts[i];
      if (now < r.at) continue;
      this.beachReverts.splice(i, 1);
      if (!this.world.isLoaded(r.x, r.z)) continue; // chunk's gone — t' relay covers t' shared moor
      if (this.world.getBlock(r.x, r.y, r.z) !== r.newId) continue; // summat else changed it since
      this.world.setBlock(r.x, r.y, r.z, r.oldId);
      if (this.world.netEdits) this.world.netEdits.delete(`${r.x},${r.y},${r.z}`);
    }
  }

  // ---------------- per-frame ----------------
  frame() {
    const dt = Math.min(0.05, this.clock.getDelta());

    if (this.state === 'title') {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    if (this.state === 'loading') {
      this.world.update(this.player.pos.x, this.player.pos.z);
      // mesh aggressively while loading
      for (let i = 0; i < 6; i++) this.world.update(this.player.pos.x, this.player.pos.z);
      if (this.world.readyAround(this.player.pos.x, this.player.pos.z, 2)) {
        this.state = 'playing';
        this.ui.show(null);
        this.ui.toast('Tha wakes on Moorstead green. Click to grab t&rsquo; mouse.', 6000);
        this.ui.toast('Punch a tree for wood, or dig owt wi&rsquo; thi hands.', 6000);
        this.spawnVillagers();
        if (this.netActive) this.connectNet();
      }
      return;
    }

    const playing = this.state === 'playing';
    const paused = this.state === 'paused';

    if (!paused) {
      // t' one true train: always running, visible to all
      this.updateTrainWorld(dt);
      if (this.rails) this.rails.update(dt, this.player.pos);
      if (this.state === 'riding' && this.ride) {
        this.updateRide();
      }
      // player
      if (playing && !this.player.dead) {
        this.player.update(dt, this.input, this.audio);
      } else if (!playing && this.state !== 'riding') {
        // UI open: physics still ticks but wi' no input
        this.player.update(dt, { keys: {}, jumpTapped: false }, this.audio);
      }

      // streaming
      this.world.update(this.player.pos.x, this.player.pos.z);

      // entities
      this.entities.day = this.sky.day;
      this.entities.update(dt, this.player, this.sky.isNight(), this.audio, (item, n) => {
        this.ui.invDirty = true;
        this.ui.toast(`+${n} ${itemName(item)}`, 1600);
      });

      // sleeping: solo skips t' neet after a moment; owt hurting thee wakes thee
      if (this.state === 'sleeping') {
        this.sleepT += dt;
        if (this.player.hurtFlash > 0.3) {
          this.cancelSleep('Summat’s at thee! No sleeping through that.');
        } else if (!(this.netActive && this.net && this.net.connected) && this.sleepT > 2.2) {
          if (this.sky.time > 0.5) this.sky.day++;
          this.sky.time = 0.25;
          this.sky.weather = 'misty';
          this.finishWake();
        }
      }
      // of a neet, one nudge when tha's stood somewhere tha COULD kip
      this.sleepHintTimer = (this.sleepHintTimer || 0) - dt;
      if (this.sleepHintTimer <= 0 && this.state === 'playing' && this.sky.isNight()) {
        this.sleepHintTimer = 2;
        if (this.sleepHintDay !== this.sky.day && this.canSleepHere() === 'ok') {
          this.sleepHintDay = this.sky.day;
          this.ui.toast('Snug enough here — press <b>N</b> to sleep till morn.', 6000);
        }
      }

      // warden drop: no harm frae t' fall, an' a proper thump on arrival
      if (this.wardenDrop) {
        const wp = this.player;
        wp.fallStart = null; // t' drop doesn't count as a fall
        this.wardenDrop.t += dt;
        if ((wp.onGround && this.wardenDrop.t > 0.3) || this.wardenDrop.t > 12) {
          const d = this.wardenDrop; this.wardenDrop = null;
          this.landImpact(wp.pos.x, wp.pos.y, wp.pos.z, true);
          this.ui.toast(`<b>${d.label}</b>. T' ground remembers thee.`, 3500);
        }
      }

      // T' Great Fog gate: tops only — never t' coast, never in/near a village
      this.fogGateTimer = (this.fogGateTimer || 0) - dt;
      if (this.fogGateTimer <= 0) {
        this.fogGateTimer = 0.5;
        const geo = this.world.gen.geo, pp = this.player.pos;
        let gate = 0;
        if (geo.coastT(pp.x, pp.z) === 0) {
          const hh = geo.heightRaw(pp.x, pp.z);
          const elevT = Math.max(0, Math.min(1, (hh - 31.5) / 2.5));
          let villF = 1;
          for (const v of geo.villages) {
            const d = Math.hypot(pp.x - v.x, pp.z - v.z);
            villF = Math.min(villF, Math.max(0, Math.min(1, (d - (v.radius + 14)) / 34)));
          }
          gate = elevT * villF;
        }
        this.sky.moorGate = gate;
        const mf = this.sky.moorFog;
        if (mf > 0.25 && !this.greatFogOn) {
          this.greatFogOn = true;
          this.ui.toast('T’ <b>Great Fog</b> is down on t’ tops — tha can’t see thi hand afore thi face, an’ t’ map’s no use. Get off t’ high moor or hunker down till it lifts.', 10000);
        } else if (mf < 0.1 && this.greatFogOn) {
          this.greatFogOn = false;
          this.ui.toast('T’ fog’s lifting off t’ moor. Tha can breathe again.', 5000);
        }
      }
      // beach edits heal: t' tide smooths t' sands back ower
      this.processBeachReverts();

      // sky & weather
      const msg = this.sky.update(dt, this.player.pos);
      if (msg) {
        if (msg.type === 'night') {
          const dracHunt = this.quests.draculaHuntActive() && !this.quests.draculaDone();
          this.ui.toast(dracHunt
            ? 'Neet&rsquo;s fallen. Summat <b>cold an&rsquo; foreign</b> walks t&rsquo; moor when tha&rsquo;s ready wi&rsquo; thi stake...'
            : 'Neet&rsquo;s fallen. Summat&rsquo;s movin&rsquo; out on t&rsquo; moor...', 5000);
        }
        else if (msg.type === 'dusk' && !this.player.creative) {
          this.ui.toast('Gloamin&rsquo;s drawin&rsquo; in. Mek for t&rsquo; village &mdash; <b>nowt dark sets foot on Moorstead ground</b>.', 7000);
        }
        else if (msg.text) this.ui.toast(msg.text, 4000);
      }

      // t' shared moor: relay positions, edits an' chat
      if (this.net) this.net.update(dt);

      // ventures: progress checks, fresh offers each new day
      this.quests.update(dt);
      if (this.sky.day !== this.lastQuestDay) {
        this.lastQuestDay = this.sky.day;
        this.quests.refreshOffers();
        this.refreshStanding(false);
      }

      // mining / repeat placing / fishing
      this.updateMining(dt);
      this.updateFishing(dt);
      const repHeld = this.player.heldItem();
      if (this.mouseDown[2] && playing && !(repHeld && repHeld.id === I.FISHING_ROD)) {
        this.placeRepeat -= dt;
        if (this.placeRepeat <= 0) { this.placeRepeat = 0.22; this.useItem(); }
      }

      // death
      if (this.player.dead && this.state !== 'dead') {
        this.state = 'dead';
        this.mouseDown = [false, false, false];
        document.exitPointerLock?.();
        this.audio.hurt();
        this.ui.showDeath(this.player.deathCause);
      }
    }

    // camera follows player
    this.camera.position.set(this.player.pos.x, this.player.pos.y + this.player.eye, this.player.pos.z);
    this.camera.rotation.set(this.player.pitch, this.player.yaw, 0);
    const targetFov = this.player.sprinting ? 82 : 75;
    if (Math.abs(this.camera.fov - targetFov) > 0.5) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 8);
      this.camera.updateProjectionMatrix();
    }

    // booked train + platform announcements
    this.updatePendingRide();
    this.stationCheck = (this.stationCheck ?? 0) - dt;
    if (playing && this.stationCheck <= 0) {
      this.stationCheck = 2;
      const st = this.world.gen.geo.nearStation(Math.floor(this.player.pos.x), Math.floor(this.player.pos.z), 16);
      if (st && st !== this.lastStationNear) {
        this.lastStationNear = st;
        const i = this.world.gen.geo.railway().indexOf(st);
        this.ui.toast(`<b>${st.name} station.</b> Next train calls in <b>${this.fmtMins(this.nextCallAt(i))}</b> \u2014 right-click t\u2019 board to book on.`, 6000);
      } else if (!st) {
        this.lastStationNear = null;
      }
    }

    // block highlight + interact hint
    if (playing && !this.player.dead) {
      const hit = this.targetBlock();
      if (hit) {
        this.highlight.visible = true;
        this.highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
        let hint = '';
        if (hit.id === B.BOARD) {
          const geo = this.world.gen.geo;
          if (geo.isMuseumBoard(hit.x, hit.z)) hint = 'Right-click: Dracula Museum';
          else hint = geo.nearStation(hit.x, hit.z, 8)
            ? 'Right-click: departures board' : 'Right-click: parish notices an\u2019 jobs';
        } else if (hit.id === B.SIGNPOST) hint = 'Right-click: read t\u2019 waymark';
        else if (hit.id === B.BENCH) hint = 'Right-click: joiner\u2019s bench (craftin\u2019)';
        else if (hit.id === B.RANGE) hint = 'Right-click: t\u2019 range (cookin\u2019 an\u2019 smeltin\u2019)';
        this.ui.interactHint.textContent = hint;
      } else {
        this.highlight.visible = false;
        this.ui.interactHint.textContent = '';
      }
    } else {
      this.highlight.visible = false;
      this.ui.interactHint.textContent = '';
    }

    // lantern lights
    this.updateLanterns();

    // held torch lights thi way
    const heldNow = this.player.heldItem();
    const holdingTorch = heldNow && heldNow.id === B.TORCH;
    this.torchLight.intensity = holdingTorch ? 9 : 0;
    if (holdingTorch) {
      this.torchLight.position.set(this.player.pos.x, this.player.pos.y + 1.5, this.player.pos.z);
    }

    // held item viewmodel
    const held = this.player.heldItem();
    const heldId = held ? held.id : -1;
    if (heldId !== this.heldIconId) {
      this.heldIconId = heldId;
      if (held) {
        const tex = new THREE.TextureLoader().load(getIconURL(held.id));
        tex.magFilter = THREE.NearestFilter;
        tex.colorSpace = THREE.SRGBColorSpace;
        this.heldSprite.material.map = tex;
        this.heldSprite.material.needsUpdate = true;
        this.heldSprite.visible = true;
      } else {
        this.heldSprite.visible = false;
      }
    }
    // gentle bob
    const speed = Math.hypot(this.player.vel.x, this.player.vel.z);
    this.bobPhase = (this.bobPhase || 0) + dt * speed * 1.6;
    this.heldSprite.position.y = -0.55 + Math.sin(this.bobPhase * Math.PI) * 0.02 * Math.min(1, speed / 3);

    // villagers hail thee as tha passes (one brain call at a time, well spaced;
    // they pipe down entirely when t' brain's under load)
    const brainBusy = (this.lastTalkMs || 0) > 15000 && performance.now() - (this.lastTalkAt || 0) < 600000;
    if (playing && !this.player.dead && !this.hailInFlight && !brainBusy) {
      for (const m of this.entities.mobs) {
        if (m.type !== 'villager' || !m.charId || m.chatting) continue;
        if ((m.hailCd || 0) > 0) continue;
        const d = Math.hypot(m.pos.x - this.player.pos.x, m.pos.z - this.player.pos.z);
        if (d > 8) continue;
        m.hailCd = 240 + Math.random() * 120;
        this.hailInFlight = true;
        const t0 = performance.now();
        npc.talk(
          m.charId,
          '(The visitor walks past within earshot. Call out ONE short greeting or remark to them \u2014 a single sentence, in your own voice. If there is something between you \u2014 a job afoot, news, owt they did \u2014 that is the thing to mention.)',
          this.player.name, this.playerId(), this.quests.chatContext(m)
        ).then(res => {
          this.hailInFlight = false;
          this.lastTalkMs = performance.now() - t0;
          this.lastTalkAt = performance.now();
          const dNow = Math.hypot(m.pos.x - this.player.pos.x, m.pos.z - this.player.pos.z);
          if (dNow < 26 && res.reply) {
            this.entities.speak(m, res.reply, 9);
            m.chatLog.push({ who: 'them', text: res.reply });
            m.tier = res.tier;
          }
        }).catch(() => { this.hailInFlight = false; });
        break;
      }
    }

    // audio ambience
    let nearSheep = false;
    for (const m of this.entities.mobs) {
      if (m.type === 'sheep' && Math.hypot(m.pos.x - this.player.pos.x, m.pos.z - this.player.pos.z) < 30) { nearSheep = true; break; }
    }
    const dread = this.entities.draculaDread(this.player);
    this.sky.setDread(dread);
    this.ui.setDread(dread);

    this.audio.update(dt, {
      rain: this.sky.rainAmount,
      windiness: Math.min(1, Math.max(0, (this.player.pos.y - 26) / 20)),
      isNight: this.sky.isNight(),
      nearSheep,
      dread,
    });

    // HUD
    this.ui.updateHUD(this.player, this.sky);
    this.ui.updateTracker();
    this.ui.minimapTimer -= dt;
    if (this.ui.minimapTimer <= 0) {
      this.ui.minimapTimer = 0.6;
      this.ui.drawMinimap(this.player, this.world);
    }

    // hunger warning
    if (!this.player.creative && this.player.hunger <= 4 && !this.hungerWarned) {
      this.hungerWarned = true;
      this.ui.toast('Tha&rsquo;s fair clammed &mdash; get some scran down thee!');
    }
    if (this.player.hunger > 6) this.hungerWarned = false;

    // autosave
    if (playing) {
      this.autosaveTimer -= dt;
      if (this.autosaveTimer <= 0) {
        this.autosaveTimer = 30;
        this.saveNow(false);
      }
    }

    // heartbeat to t' parish ledger (fire-an'-forget, ~1/min)
    if (this.state !== 'title') {
      this.pingTimer = (this.pingTimer ?? 5) - dt;
      if (this.pingTimer <= 0) {
        this.pingTimer = 60;
        const p = Math.floor(this.player.pos.x);
        const z = Math.floor(this.player.pos.z);
        fetch('/dash/ping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pid: (localStorage.getItem('moorcraft-pid') || 'unknown').slice(0, 40),
            name: this.player.name || '',
            seed: '' + this.seed,
            day: this.sky.day,
            standing: this.quests.standingLabel(),
            croft: this.quests.croftStage,
            quests: this.quests.completed.length,
            loc: this.world.gen.geo.locationName(p, z),
          }),
        }).catch(() => { /* ledger's closed — no matter */ });
      }
    }

    // hold Tab to peek at t' whole-moor map (only while actually playing)
    const wantMap = this.state === 'playing' && !!this.keys['Tab'];
    if (wantMap && !this.peekingMap) { this.peekingMap = true; this.ui.showBigMap(this.player, this.world); }
    else if (!wantMap && this.peekingMap) { this.peekingMap = false; this.ui.hideBigMap(); }
    else if (this.peekingMap) this.ui.drawBigMapDots(this.player, this.net);

    this.renderer.render(this.scene, this.camera);
  }

  updateLanterns() {
    const p = this.player.pos;
    const near = [];
    for (const k of this.world.lanterns) {
      const [x, y, z] = k.split(',').map(Number);
      const d = (x - p.x) ** 2 + (y - p.y) ** 2 + (z - p.z) ** 2;
      if (d < 50 * 50) near.push([d, x, y, z]);
    }
    near.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < this.lanternLights.length; i++) {
      const l = this.lanternLights[i];
      if (i < near.length) {
        l.position.set(near[i][1] + 0.5, near[i][2] + 0.6, near[i][3] + 0.5);
        l.intensity = 14;
      } else {
        l.intensity = 0;
      }
    }
  }
}

window.game = new Game();
