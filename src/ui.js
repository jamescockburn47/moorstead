// All DOM UI: title, HUD, inventory/crafting/smelting, chat, quests, pause, death, minimap, toasts.
import { B, I, RECIPES, SMELTS, FUELS, FOODS, TOOLS, itemName, maxStack, CREATIVE_ITEMS, CHUNK, WATER_LEVEL } from './defs.js';
import { FARM_THRESHOLD, CHARTER_FEE, farmRegisterCheck, droveValue } from './economy.js';
import { deedFee, weeklyUpkeep } from './deeds.js';
import { getIconURL } from './textures.js';
import { CASTLE } from './geography.js';
import { TitleFlyover } from './titlescene.js';
import { escHtml } from './escape.js';
import { parishQuarries, drawMinimapMarker } from './mining-guide.js';

const PIX = {
  heart: ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'],
  // a proper raised pork pie — crust, pale collar, nowt else will do
  food: ['..BBB..', '.XXXXX.', 'XXXXXXX', 'XXXXXXX', 'XBBBBBX', '.XXXXX.'],
};

function pixURL(pattern, fullColor, dim) {
  const rows = pattern.length, cols = pattern[0].length;
  const c = document.createElement('canvas');
  c.width = cols; c.height = rows;
  const x = c.getContext('2d');
  for (let r = 0; r < rows; r++) for (let col = 0; col < cols; col++) {
    const ch = pattern[r][col];
    if (ch === '.') continue;
    x.fillStyle = ch === 'B' ? (dim ? '#5a5248' : '#e8e0d0') : fullColor;
    x.fillRect(col, r, 1, 1);
  }
  return c.toDataURL();
}

export class UI {
  constructor(game) {
    this.game = game;
    this.drag = null;          // item stack on t' cursor
    this.invDirty = true;
    this.minimapTimer = 0;
    this.miningHighlights = [];
    this.miningHighlightUntil = 0;
    this.toastEls = [];
    this.buildPips();
    this.buildDOM();
  }

  buildPips() {
    this.heartFull = pixURL(PIX.heart, '#e02818');
    this.heartHalf = pixURL(PIX.heart, '#7a1810');
    this.heartEmpty = pixURL(PIX.heart, '#3a3530');
    this.foodFull = pixURL(PIX.food, '#c87838');
    this.foodEmpty = pixURL(PIX.food, '#3a3530', true);
    this.tempFull = pixURL(PIX.heart, '#e0962a');
    this.tempHalf = pixURL(PIX.heart, '#7a6030');
    this.tempEmpty = pixURL(PIX.heart, '#5a86b0');
  }

  el(tag, cls, parent, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    if (parent) parent.appendChild(e);
    return e;
  }

  buildDOM() {
    const body = document.body;

    // ---------- HUD ----------
    this.hud = this.el('div', 'hidden', body); this.hud.id = 'hud';
    this.el('div', '', this.hud).id = 'crosshair';
    this.lockHint = this.el('div', '', this.hud); this.lockHint.id = 'lock-hint'; this.lockHint.textContent = 'Click to look around';
    this.breakCanvas = this.el('canvas', '', this.hud);
    this.breakCanvas.id = 'break-progress';
    this.breakCanvas.width = 46; this.breakCanvas.height = 46;
    this.interactHint = this.el('div', '', this.hud);
    this.interactHint.id = 'interact-hint';
    this.dreadOverlay = this.el('div', '', this.hud);
    this.dreadOverlay.id = 'dread-overlay';
    this.stormFlash = this.el('div', '', this.hud);   // white lightning-flash blip (storm controller)
    this.stormFlash.id = 'storm-flash';

    const stats = this.el('div', '', this.hud); stats.id = 'stats';
    this.brassEl = this.el('div', '', stats); this.brassEl.id = 'brass';
    this.heartsEl = this.el('div', '', stats); this.heartsEl.id = 'hearts';
    this.hungerEl = this.el('div', '', stats); this.hungerEl.id = 'hunger';
    this.heartImgs = []; this.foodImgs = [];
    for (let i = 0; i < 10; i++) {
      const h = this.el('img', 'pip', this.heartsEl); h.src = this.heartFull; this.heartImgs.push(h);
      const f = this.el('img', 'pip', this.hungerEl); f.src = this.foodFull; this.foodImgs.push(f);
    }
    this.tempEl = this.el('div', '', stats); this.tempEl.id = 'temperature';
    this.tempImgs = [];
    for (let i = 0; i < 10; i++) {
      const t = this.el('img', 'pip', this.tempEl); t.src = this.tempFull; this.tempImgs.push(t);
    }

    this.airRow = this.el('div', '', this.hud); this.airRow.id = 'air-row';
    this.bubbles = [];
    for (let i = 0; i < 10; i++) this.bubbles.push(this.el('div', 'bubble', this.airRow));

    this.hotbarEl = this.el('div', '', this.hud); this.hotbarEl.id = 'hotbar';

    const mapBox = this.el('div', '', this.hud); mapBox.id = 'minimap-box';
    this.minimap = this.el('canvas', '', mapBox); this.minimap.id = 'minimap';
    this.minimap.width = 160; this.minimap.height = 160;
    // expanded "peek" map (hold Tab) — a whole-moor overview
    this.mapOverlay = this.el('div', 'hidden', document.body); this.mapOverlay.id = 'big-map';
    const mapInner = this.el('div', '', this.mapOverlay); mapInner.id = 'big-map-inner';
    this.el('div', '', mapInner, 'T&rsquo; Moors &mdash; <span class="dim">hold Tab to peek</span>').id = 'big-map-title';
    this.bigMap = this.el('canvas', '', mapInner); this.bigMap.id = 'big-map-canvas';
    this.bigMap.width = 900; this.bigMap.height = 760;
    this.mapBase = document.createElement('canvas'); // cached static layer
    this.mapBaseKey = null;
    // ride-camera switcher — shown while riding the train; keys 1/2/3 pick the view
    this.rideViewMenu = this.el('div', '', document.body); this.rideViewMenu.id = 'ride-view-menu';
    this.rideViewMenu.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);display:none;gap:7px;z-index:60;pointer-events:none;font:600 13px system-ui,sans-serif';
    this._rideChips = {};
    for (const [k, lbl] of [['seat', '1 · On board'], ['driver', '2 · Driver'], ['overhead', '3 · Overhead']]) {
      const c = this.el('div', '', this.rideViewMenu, lbl);
      c.style.cssText = 'padding:5px 12px;border-radius:7px;background:rgba(22,17,12,0.7);color:#cdbf9a;border:1px solid rgba(0,0,0,0.5);box-shadow:0 1px 4px rgba(0,0,0,0.45);white-space:nowrap';
      this._rideChips[k] = c;
    }
    this.mapInfo = this.el('div', '', mapBox); this.mapInfo.id = 'map-info';

    this.toastBox = this.el('div', '', this.hud); this.toastBox.id = 'toasts';

    // shared-moor chat line (T to talk)
    this.netChatRow = this.el('div', 'hidden', this.hud); this.netChatRow.id = 'net-chat';
    this.netChatInput = this.el('input', 'chat-input', this.netChatRow);
    this.netChatInput.placeholder = 'Say summat to t\u2019 moor... (Enter sends, Esc shuts up)';
    this.netChatInput.maxLength = 200;
    this.vignette = this.el('div', '', body); this.vignette.id = 'hurt-vignette';
    this.coldVignette = this.el('div', '', body); this.coldVignette.id = 'cold-vignette';

    this.tooltip = this.el('div', 'hidden', body); this.tooltip.id = 'tooltip';
    document.addEventListener('mousemove', e => {
      this.tooltip.style.left = (e.clientX + 14) + 'px';
      this.tooltip.style.top = (e.clientY + 10) + 'px';
      if (this.dragEl) {
        this.dragEl.style.left = (e.clientX - 20) + 'px';
        this.dragEl.style.top = (e.clientY - 20) + 'px';
      }
    });

    // ---------- title ----------
    this.titleScreen = this.el('div', 'overlay', body); this.titleScreen.id = 'title-screen';
    this.el('h1', 'title', this.titleScreen, 'MOORSTEAD');
    this.el('div', 'subtitle', this.titleScreen, 'A realistic, playable recreation of the North York Moors in 1900 &mdash; powered and built by AI');
    // "About" + "Feedback & bugs" pinned together to the top-right corner (see .title-links)
    const titleLinks = this.el('div', 'title-links', this.titleScreen);
    this.aboutBtn = this.el('a', 'about-btn', titleLinks, 'About');
    this.aboutBtn.href = '/about.html'; this.aboutBtn.rel = 'noopener';
    this.feedbackBtn = this.el('button', 'about-btn feedback-btn', titleLinks, 'Feedback &amp; bugs');
    // a LIVE moor fly-over behind it all — procedural, no asset files (see titlescene.js).
    // A dark scrim over it keeps the text readable; falls back to the CSS gradient if WebGL won't start.
    const scene = this.el('div', 'title-scene', this.titleScreen);
    this.flyoverCanvas = this.el('canvas', 'title-flyover', scene);
    this.el('div', 'title-scrim', scene);
    // what the world IS, at a glance — not a changelog
    const feats = this.el('div', 'title-feats', this.titleScreen);
    feats.innerHTML =
      '<div class="feat"><div class="ico">&#9935;</div><div class="ft">Build &amp; delve</div><div class="fd">Claim your land; license a deep mine</div></div>' +
      '<div class="feat"><div class="ico">&#127968;</div><div class="ft">A living parish</div><div class="fd">Folk who talk naturally and get to know you</div></div>' +
      '<div class="feat"><div class="ico">&#128642;</div><div class="ft">The moors line</div><div class="fd">Ride her; or take the regulator</div></div>' +
      '<div class="feat"><div class="ico">&#128017;</div><div class="ft">Sheepdog &amp; fold</div><div class="fd">Whistle her round, fold thi flock</div></div>' +
      '<div class="feat"><div class="ico">&#128176;</div><div class="ft">Brass &amp; trade</div><div class="fd">Buy cheap, sell dear by rail</div></div>' +
      '<div class="feat"><div class="ico">&#127769;</div><div class="ft">Owd tales</div><div class="fd">Folklore stirs once the sun&rsquo;s down</div></div>';
    // login (invite code) — shown till tha's claimed thi place in t' village
    this.loginBox = this.el('div', 'login-box', this.titleScreen);
    this.el('div', 'login-title', this.loginBox, 'Tha&rsquo;ll need thi invite to settle in Moorstead');
    this.loginCode = this.el('input', 'seed', this.loginBox);
    this.loginCode.placeholder = 'Invite code (like heather-yow-42)';
    this.loginName = this.el('input', 'seed', this.loginBox);
    this.loginName.placeholder = 'Thi name';
    this.loginName.maxLength = 24;
    this.btnLogin = this.el('button', 'mc', this.loginBox, 'Come On In');
    this.loginErr = this.el('div', 'login-err', this.loginBox, '');
    this.loginGuest = this.el('div', 'muted-note login-guest', this.loginBox, 'no invite? <u>play as a passing rambler</u> (villagers won&rsquo;t remember thee proper)');
    this.wardenKey = this.el('input', 'seed', this.loginBox);
    this.wardenKey.placeholder = 'Warden key';
    this.btnWarden = this.el('button', 'mc', this.loginBox, 'Enter as Warden');
    this.requestToggle = this.el('div', 'muted-note login-request-toggle', this.loginBox,
      'want a proper invite? <u>request one</u> (adult shared moor only)');
    this.requestBox = this.el('div', 'request-box hidden', this.loginBox);
    this.el('div', 'login-title', this.requestBox, 'Ask for an adult invite');
    this.el('div', 'muted-note', this.requestBox,
      'Children&rsquo;s worlds aren&rsquo;t requested here. I&rsquo;ll email thee a code if there&rsquo;s a spot.');
    this.requestEmail = this.el('input', 'seed', this.requestBox);
    this.requestEmail.type = 'email';
    this.requestEmail.placeholder = 'Thi email address';
    this.requestEmail.maxLength = 120;
    this.requestName = this.el('input', 'seed', this.requestBox);
    this.requestName.placeholder = 'Thi name (optional)';
    this.requestName.maxLength = 24;
    this.requestNote = this.el('input', 'seed', this.requestBox);
    this.requestNote.placeholder = 'Short note (optional)';
    this.requestNote.maxLength = 200;
    this.btnRequest = this.el('button', 'mc', this.requestBox, 'Send Request');
    this.requestErr = this.el('div', 'login-err', this.requestBox, '');
    this.requestOk = this.el('div', 'request-ok hidden', this.loginBox, '');

    this.whoBox = this.el('div', 'login-who hidden', this.titleScreen, '');

    // v2 is the main game: the real North York Moors, c.1900. "New Game" starts it
    // (newWorld('') → the moors world, persistent).
    this.btnNew = this.el('button', 'mc', this.titleScreen, '&#x1F689; Enter t&rsquo; Moors &mdash; New Game');
    this.btnContinue = this.el('button', 'mc', this.titleScreen, 'Carry On Where Tha Left Off');
    this.btnShared = this.el('button', 'mc', this.titleScreen, 'T&rsquo; Shared Moor: Play Wi&rsquo; Others');
    this.btnHow = this.el('button', 'mc', this.titleScreen, 'Ow Ter Play');
    this.el('div', 'moors-note', this.titleScreen, 'T&rsquo; real North York Moors, built to scale frae <b>Ordnance Survey</b> maps &mdash; t&rsquo; true landscape, dales, rivers an&rsquo; coast, t&rsquo; 1900 railways, livin&rsquo; folk an&rsquo; their tales (an&rsquo; mind t&rsquo; Count up on t&rsquo; East Cliff of a stormy neet).');
    this.el('div', 'muted-note', this.titleScreen, 'New to t&rsquo; moor? <b>Give &lsquo;Ow Ter Play&rsquo; a read</b>: learn how to build, ride, drive, and stay alive.');
    this.el('div', 'muted-note', this.titleScreen, 'Watch thissen at neet: t&rsquo; barghest walks when t&rsquo; sun goes down.');
    // The original stylised game, kept as a legacy option at the foot.
    this.legacyBox = this.el('div', 'title-legacy hidden', this.titleScreen);
    this.el('div', 'muted-note', this.legacyBox, 'Or play t&rsquo; original <b>stylised</b> Moorstead (one solo save at a time &mdash; starting a world begins fresh):');
    this.seedInput = this.el('input', 'seed', this.legacyBox);
    this.seedInput.placeholder = "Custom seed (optional)";
    this.btnLegacy = this.el('button', 'mc legacy-btn', this.legacyBox, 'Play t&rsquo; Original (Stylised) Moorstead');
    this.el('div', 'title-foot', this.titleScreen, 'Created purely with AI by a non-coder &middot; procedurally generated, not a single asset file &middot; villagers, jobs an&rsquo; adventures run on large local AI models &middot; <a href="/about.html?tab=security" style="color:#d8b95a">Security &amp; privacy</a>');

    // ---------- pause ----------
    this.pauseScreen = this.el('div', 'overlay hidden', body);
    const pp = this.el('div', 'panel', this.pauseScreen);
    this.el('div', 'inv-title', pp, 'Hod On a Minute (Paused)');
    this.btnResume = this.el('button', 'mc', pp, 'Back to t&rsquo; Moor');
    this.btnSave = this.el('button', 'mc', pp, 'Save T&rsquo; World');
    this.btnCreative = this.el('button', 'mc', pp, 'Toggle Creative Mode');
    this.btnTouch = this.el('button', 'mc', pp, 'Touch controls: Auto');
    this.adminPanel = this.el('div', 'admin-panel hidden', pp); // filled by t' game for parish wardens
    this.btnHow2 = this.el('button', 'mc', pp, 'Ow Ter Play');
    this.btnQuit = this.el('button', 'mc', pp, 'Give Up &amp; Go Home (Save &amp; Quit)');

    // ---------- ow ter play (tabbed handbook) ----------
    this.howScreen = this.el('div', 'overlay hidden', body);
    const hp = this.el('div', 'panel how-panel', this.howScreen);
    this.el('div', 'inv-title', hp, 'Ow Ter Play');
    this.howTabs = this.el('div', 'how-tabs', hp);
    this.howContent = this.el('div', 'how-content', hp);
    this.buildHowSections();
    this.btnHowClose = this.el('button', 'mc', hp, 'Reet, Got It');

    // ---------- feedback & bugs ----------
    this.feedbackScreen = this.el('div', 'overlay hidden', body);
    const fp = this.el('div', 'panel feedback-panel', this.feedbackScreen);
    this.el('div', 'inv-title', fp, 'Feedback &amp; bugs');
    this.el('div', 'muted-note', fp,
      'Tell me what went wrong or what tha&rsquo;d like improved. I&rsquo;ll save the page, browser, and any game details with it.');
    const fbKind = this.el('div', 'feedback-kind', fp);
    fbKind.innerHTML =
      '<label><input type="radio" name="fb-kind" value="bug" checked> Bug</label>' +
      '<label><input type="radio" name="fb-kind" value="feedback"> Feedback</label>';
    this.feedbackEmail = this.el('input', 'seed', fp);
    this.feedbackEmail.type = 'email';
    this.feedbackEmail.placeholder = 'Email (optional, if tha wants a reply)';
    this.feedbackEmail.maxLength = 120;
    this.feedbackMessage = this.el('textarea', 'seed feedback-msg', fp);
    this.feedbackMessage.placeholder = 'What happened? Steps to reproduce help for bugs.';
    this.feedbackMessage.maxLength = 2000;
    this.feedbackMessage.rows = 6;
    this.feedbackErr = this.el('div', 'login-err', fp, '');
    this.feedbackOk = this.el('div', 'request-ok hidden', fp, '');
    this.btnFeedbackSend = this.el('button', 'mc', fp, 'Send to t&rsquo; parish ledger');
    this.btnFeedbackClose = this.el('button', 'mc', fp, 'Cancel');

    // ---------- death ----------
    this.deathScreen = this.el('div', 'overlay hidden', body); this.deathScreen.id = 'death-screen';
    this.el('h1', '', this.deathScreen, 'Tha&rsquo;s Deead!');
    this.deathCause = this.el('div', '', this.deathScreen); this.deathCause.id = 'death-cause';
    this.el('div', 'muted-note', this.deathScreen,
      'Tha keeps thi things. Tip: <b>Moorstead is safe ground</b> &mdash; nowt dark follows thee onto t&rsquo; green,<br>' +
      'an&rsquo; a gritstone sword (bench: 2 cobble + 1 stick) evens t&rsquo; odds out on t&rsquo; moor at neet.');
    this.btnRespawn = this.el('button', 'mc', this.deathScreen, 'Si Thee Agean (Respawn)');
    this.btnDeathQuit = this.el('button', 'mc', this.deathScreen, 'Quit to Title');

    // ---------- inventory ----------
    this.invScreen = this.el('div', 'overlay hidden', body);
    this.invPanel = this.el('div', 'panel', this.invScreen);

    // ---------- range (smelting) ----------
    this.rangeScreen = this.el('div', 'overlay hidden', body);
    this.rangePanel = this.el('div', 'panel', this.rangeScreen);

    // ---------- villager chat ----------
    this.chatScreen = this.el('div', 'overlay hidden', body);
    const cp = this.el('div', 'panel chat-panel', this.chatScreen);
    const ch = this.el('div', 'chat-head', cp);
    this.chatName = this.el('div', 'inv-title', ch, 'Villager');
    this.chatTier = this.el('div', 'chat-tier', ch, '');
    this.chatMsgs = this.el('div', 'chat-msgs', cp);
    this.chatQuestRow = this.el('div', 'chat-quest-row', cp);
    this.chatNameRow = this.el('div', 'chat-input-row hidden', cp);
    this.chatNameInput = this.el('input', 'chat-input', this.chatNameRow);
    this.chatNameInput.placeholder = 'What do they call thee?';
    this.chatNameInput.maxLength = 24;
    this.btnSetName = this.el('button', 'mc chat-btn', this.chatNameRow, 'That&rsquo;s me');
    this.chatInputRow = this.el('div', 'chat-input-row', cp);
    this.chatInput = this.el('input', 'chat-input', this.chatInputRow);
    this.chatInput.placeholder = 'Say summat...';
    this.chatInput.maxLength = 240;
    this.btnChatSend = this.el('button', 'mc chat-btn', this.chatInputRow, 'Say');
    this.btnChatGive = this.el('button', 'mc chat-btn', this.chatInputRow, 'Give');
    this.btnChatClose = this.el('button', 'mc chat-btn', this.chatInputRow, 'Ta-ra');
    this.el('div', 'chat-hint', cp,
      'Chats an&rsquo; gifts build friendship: Stranger &rarr; Acquaintance &rarr; Friendly &rarr; Friend &rarr; Close friend. ' +
      'Friends remember thee, gossip travels, an&rsquo; they&rsquo;ll press presents on thee as tha rises. <b>Give</b> hands ower whatever&rsquo;s in thi hand.');

    // drag icon follows cursor
    this.dragEl = this.el('div', 'drag-icon hidden', body);

    // ---------- parish notice board / quest journal ----------
    this.boardScreen = this.el('div', 'overlay hidden', body);
    this.boardPanel = this.el('div', 'panel board-panel', this.boardScreen);

    this.museumScreen = this.el('div', 'overlay hidden', body);
    this.museumPanel = this.el('div', 'panel museum-panel', this.museumScreen);

    // ---------- HUD quest tracker ----------
    this.tracker = this.el('div', '', this.hud);
    this.tracker.id = 'quest-tracker';

    // ---------- sleeping ----------
    this.sleepScreen = this.el('div', 'overlay sleep-overlay hidden', body);
    const slp = this.el('div', '', this.sleepScreen);
    slp.className = 'sleep-inner';
    this.sleepTitle = this.el('div', 'sleep-title', slp, 'Tha sleeps...');
    this.sleepText = this.el('div', 'sleep-sub', slp, '');
    const wake = this.el('button', 'mc sleep-wake', slp, 'Get up');   // keyboard-free exit (touch can't press N/Esc)
    wake.addEventListener('click', () => this.game.cancelSleep('Up an’ about again, then.'));

    // ---------- loading ----------
    this.loadingScreen = this.el('div', 'overlay hidden', body);
    this.el('div', 'panel', this.loadingScreen, '<div class="inv-title">Walkin&rsquo; up onto t&rsquo; moor...</div>');
  }

  // ============ ow ter play sections ============
  buildHowSections() {
    const S = {
      'First Day': `
<h3>You have just moved to Moorstead. Here is your first day, sorted:</h3>
<ol>
<li><b>Click the screen</b> to capture the mouse, then look around the village green. Walk up to a villager (their name floats over their head) and <b>right-click to talk to them</b>. Ask about work or tell them your name.</li>
<li><b>Punch a tree</b> (hold left-click on the trunk) to gather logs. Press <b>E</b> to open your pockets, craft <b>Planks</b>, then <b>Sticks</b>, and then a <b>Joiner’s Bench</b>. Place the bench (right-click) and stand near it to unlock advanced recipes.</li>
<li>Dig a bit of gritstone with a <b>wooden pickaxe</b>, then make a <b>gritstone sword and pickaxe</b>. A sword is essential: 2 cobbles + 1 stick.</li>
<li>Gather some food for your pockets. <b>Right-click</b> a glinting <b>bilberry bush</b> in late summer to pick the berries (the bush stays and fruits again), or hunt a sheep for mutton (but not inside the village bounds, or people will gossip).</li>
<li>Check the <b>parish notice board</b> by the village cross (or press <b>Q</b>) and take a job or two.</li>
<li>When the light turns amber—twilight—<b>return to the village</b>. No dark creatures can set foot on Moorstead's hallowed ground. Out on the open moor at night, you are fair game.</li>
</ol>
<p class="how-note">If you die, you keep all your items and wake up safely on the village green. Only your pride is harmed.</p>`,

      'Controls': `
<div class="controls-list">
<b>Mouse</b> Look around<br>
<b>Left click</b> Dig blocks (hold) / Attack creatures<br>
<b>Right click</b> Place blocks / Eat food / Talk to villagers / Use bench, range, and board<br>
<b>W A S D</b> Walk<br>
<b>Z</b> Sprint (burns hunger, outruns a barghest)<br>
<b>Space</b> Jump / Swim up<br>
<b>Shift</b> Sneak (prevents falling off edges)<br>
<b>1&ndash;9 / mouse wheel</b> Select hotbar slot<br>
<b>E</b> Open pockets (inventory & crafting)<br>
<b>Q</b> Open venture journal (notice board)<br>
<b>T</b> Talk in village chat (covers ~60m)<br>
<b>N</b> Sleep (available at night under a roof, near a light source)<br>
<b>M</b> Mute sound<br>
<b>Esc</b> Pause / Close screens<br>
<b>Space &times;2</b> Toggle flying (creative mode only)
</div>
<p class="how-note"><b>Riding & driving:</b> On a pony or the train footplate, use <b>W A S D</b> to move. Press <b>F</b> to dismount a pony or shovel coal on the train. Press <b>E</b> to stop the train and step down. Full details under <b>Ponies</b> and <b>T’ Railway</b>.</p>
<p class="how-note">Creative mode can be toggled in the pause menu, offering flight, infinite blocks, instant digging, and invulnerability.</p>`,

      'Staying Alive': `
<h3>Health, hunger, and hazards</h3>
<ul>
<li><b>Hunger</b> drains as you walk, sprint, jump, and dig. Below 6 hunger bars you cannot sprint; at zero hunger, your health drains down to half a heart. Eat food by right-clicking it: bilberries (+3), raw mutton (+3), <b>roast mutton (+8)</b>, or grouse. Cook food on a range.</li>
<li><b>Health</b> regenerates automatically when you are well fed (16+ hunger). Otherwise, eat, wait, or stay out of danger.</li>
<li><b>Falling</b> from heights past 3 blocks causes damage. In <b>water</b>, you can swim (Space), but your air bubbles will deplete—surface before they do.</li>
<li><b>Keep dry.</b> Getting caught in the rain or wading through deep streams will cause you to become <b>soaked through</b>. While soaked, you cannot rest or heal, and you burn food faster to stay warm. Stand <b>under a roof or near a fire</b> to dry off quickly.</li>
<li><b>Bogs</b> on the high moor are dark, dangerous pools of peat. They will trap and sink you. Skirt around them or sprint-jump across if you must.</li>
<li><b>Nighttime</b> belongs to the <b>barghest</b> (a giant black hound with eyes like burning coals) and <b>boggarts</b> (mud creatures from the mires). They roam from dusk till dawn on the open moor. <b>Moorstead's ground is hallowed and safe; night monsters will not set foot on it.</b> You can sprint faster than a barghest, but only just.</li>
<li><b>Monsters fear flame.</b> Craft <b>torches</b> (1 stick + 1 coal = 4, no bench needed). A <b>placed</b> torch or lantern wards off all but the strongest monsters within a 9-block radius and prevents them from spawning nearby. A torch <b>in your hand</b> lights your way and scares off boggarts, but a barghest is bolder.</li>
<li><b>Caught out at night?</b> Stone <b>moor shelters</b> are scattered across the tops, lantern-lit and safe. <b>Right-click any waymark signpost</b> to find the direction and distance to the nearest shelter or back to Moorstead. You can craft signposts (3 planks + 1 stick) to mark your own routes.</li>
<li><b>THE GREAT FOG.</b> Every few days, a thick fog descends on the <b>high tops</b> for half a day. Visibility drops to five yards, and <b>your map and bearings are disabled</b> (no minimap, no coordinates). Valleys and the coast remain clear. If caught on the tops: <b>stop</b>. Find a waymark stone or wall and follow it; signposts still show the way to shelters. Alternatively, place torches as breadcrumbs and wait it out.</li>
<li><b>Sleep the night away.</b> Find a <b>roof and a light</b> (a villager's house, the pub, a shelter, or your own cottage with a torch inside) and press <b>N</b> to sleep until morning. You will wake up with <b>full health</b> and a small appetite. In multiplayer, the night only passes when <b>everyone</b> sleeps.</li>
<li><b>Dying</b> carries no penalty: you wake up on the village green with your inventory intact.</li>
</ul>
<h3>Claims and build decay</h3>
<ul>
<li><b>Land Claims:</b> Stake a claim deed at the parish notice board to hold a circular plot (8m round) for a charter fee. Unclaimed building edits expire after 30 days.</li>
<li><b>Decay Durations:</b> If a claim's weekly upkeep lapses, its builds crumble gradually over 14 days after a 7-day grace period. Inside active claims, builds never decay.</li>
<li><b>Mode Scaling:</b> In the children's world, claims and builds decay twice as slow. On the <b>Free Moor</b>, builds never crumble, no claim or licence is needed, and deep digging needs only the right pick.</li>
<li><b>Breeding:</b> Keeping two or more animals of the same species inside an active claim allows them to breed tamed baby offspring.</li>
</ul>`,

      'T\u2019 Village': `
<h3>The people of the moors</h3>
<ul>
<li><b>Every settlement is inhabited</b>: the farming family at Moorstead, the stationmaster and shepherdess at Goathland, the innkeeper and retired miner at Rosedale Abbey, fisherfolk at Staithes, the vicar and market trader at Pickering, the engine crew at Grosmont, and the fishwife and jet carver at Whitby. Each knows their own area best.</li>
<li><b>At dusk, villagers head indoors.</b> You can follow them inside and <b>right-click to talk by the lantern</b>; they stay home all night and go back out in the morning.</li>
<li><b>Right-click a villager</b> to talk. They remember you between visits, and gossip travels through families. Talk to them and ask questions; they know the moors better than anyone.</li>
<li><b>Friendship</b> grows with every chat: Stranger &rarr; Acquaintance &rarr; Friendly &rarr; Friend &rarr; Close Friend. As people warm to you, they will <b>give you gifts</b>—the closer the friendship, the better the gifts.</li>
<li><b>Give items</b> to villagers by holding the item and talking to them. People have favorites—Granny Glinda loves heather, while the kids love bilberries. A good gift builds trust quickly.</li>
<li><b>Bartering</b>: Trade buttons appear under the chat window. Swap wool for ingots, heather for wool, or jet for an iron pickaxe. Better trades unlock as your standing rises.</li>
<li><b>Standing</b> (shown under the minimap) is your reputation across the parish: Newcomer &rarr; Known &rarr; Welcomed &rarr; Respected &rarr; Treasured. High standing is required for advanced trades and ventures.</li>
<li><b>Mind your behavior</b>: Destroying houses or killing the village flock will damage your reputation. Standing will fall, villagers will turn cold, and jobs will dry up. Good deeds and time will mend it.</li>
</ul>
<p class="how-note">If villagers are quiet, the village brain may be sleeping. They will walk around but won't talk until it wakes up.</p>`,

      'Ventures': `
<h3>Finding work and adventure</h3>
<ul>
<li><b>Villagers offer jobs in conversation.</b> Ask about work, news, or things to do. A green button appears when a job is available: <i>Take the job</i>.</li>
<li>The <b>parish notice board</b> by the village cross (or press <b>Q</b> anywhere) lists pinned notices: deliveries, monster bounties, and ancient treasure riddles.</li>
<li>Active ventures show in the <b>top-left corner</b> with a compass bearing and distance (e.g., "NW &middot; 290m"). Riddles show no indicators; you must read the landmarks.</li>
<li><b>Stuck? Ask the villagers.</b> They hold clues: the kids might tell you plainly, while Granny Glinda speaks in riddles worth untangling. Different people know different pieces.</li>
<li>Some jobs must be <b>turned in</b>—go see the quest giver and press <i>Hand over</i>. Others (deliveries, bounties, digs) pay out immediately.</li>
<li>Completing jobs rewards you with items, tools, trust with the giver, and boosts your village standing.</li>
</ul>
<h3>The Hound of the Mires &#9733;</h3>
<p>Something has been taking sheep in the night. <b>The Hound of the Mires</b> is a five-chapter storyline set across real landmarks, marked with a star &#9733; in your journal. It starts with Farmer James and ends on a crooked hill at night. Higher chapters require higher standing—the village does not hand its secrets to strangers.</p>
<h3>Count Dracula on the Moors &#8224;</h3>
<p>A <b>separate</b> storyline, marked with a dagger &#8224; in your journal. Start at the <b>Dracula Museum in Whitby</b> (on the north coast, below the abbey cliffs). Learn how Bram Stoker's 1890 visit inspired his famous vampire, then draw <b>holy water</b> from the abbey font and craft a <b>wooden stake</b> at a bench. At night, Count Dracula walks the open moor—you will <b>feel his presence before you see him</b>. Use the holy stake to strike him down. Slaying him makes the moors <b>far safer after dark</b>, ensuring nothing worse than barghests will roam.</p>`,

      'T\u2019 Railway': `
<h3>The Moors Railway</h3>
<ul>
<li><b>A steam train</b> works the entire line on a shared clock—you can watch it steam past from the moor, trailing a plume of smoke.</li>
<li>The line follows the real route: <b>Pickering</b> (south end) &rarr; <b>Levisham</b> (a halt under the Hole of Horcum) &rarr; <b>Moorstead</b> &rarr; <b>Goathland</b> &rarr; <b>Grosmont</b> &rarr; <b>Whitby</b> by the sea.</li>
<li><b>To ride</b>: Find a station platform (marked by a lantern, departures board, and signpost), <b>right-click the board</b>, choose your destination, and pay the fare in <b>coal lumps</b> (free in creative mode). Stand on the platform when the train arrives; it stops for 30 seconds.</li>
<li>Enjoy a window seat as the valleys and embankments roll by. The train will set you down at your stop with a whistle.</li>
<li>If you miss the train, your fare is refunded. Stations are safe, well-lit ground at night.</li>
<li><b>Ride with passengers.</b> Locals board at platforms and take seats in your carriage—<b>right-click them to chat</b>. They will share news, tips, and sometimes offer <b>cargo parcels</b> to deliver for extra coal.</li>
</ul>
<h3>Drive the train yourself &#128642;</h3>
<ul>
<li>When the train is stopped at your platform, select <b>"Take the regulator"</b> from the board to climb on the footplate and drive.</li>
<li>Use <b>W</b> to open the regulator (accelerate), <b>S</b> or <b>space</b> to brake, and <b>R</b> to throw the reverser (reverse). Press <b>E</b> to stop the train and step down.</li>
<li><b>Fire the boiler.</b> Watch the steam gauge—<b>press F to shovel coal</b> into the firebox to keep steam pressure up. If the fire dies, the train will lose power.</li>
<li><b>Goods runs</b>: Load cargo wagons at a station platform, drive to the destination stop, and step down to collect your payment in coal.</li>
</ul>`,

      'Brass & Trade': `
<h3>Currency & trade &#128176;</h3>
<p>Your money is shown at the top of the screen, counted in historical currency: **pence** (d), **shillings** (s—12 pence to a shilling), and **pounds** (£—20 shillings/240 pence to a pound). You start with **five shillings** (5s) in your pocket.</p>
<h3>Buying and selling</h3>
<ul>
<li>Press <b>T</b> to talk to a villager, and use the <b>Buy</b> and <b>Sell</b> buttons under the chat window. Different villagers deal in different goods.</li>
<li><b>Prices vary by location.</b> Goods are cheap where they are harvested and expensive where they are in demand: <b>coal</b> is cheap at pit villages like Rosedale and expensive on the coast, <b>sea fish</b> fetches the highest price far inland, and <b>wool</b> is sought after in Whitby and Pickering. Transporting goods to take advantage of these spreads is key to trading.</li>
<li><b>Spot selling to villagers carries a penalty.</b> If you sell directly to a villager, you receive a <b>drop-in price</b> (60% of the local market value), and each vendor has a shallow brass purse (up to 120d, refilling daily).</li>
<li><b>High-Reputation Spot Trades</b>: If you reach <b>Respected</b> or <b>Treasured</b> standing (standing index 3+), you can bypass the 60% penalty and vendor purse limits when selling rare goods (Whitby Jet, fossils, and iron ingots). A special <b>"Sell (Trust)"</b> button will appear, paying you full market value.</li>
<li><b>Do not buy and sell to the same person</b> hoping to turn a profit; you will always lose money. The profit lies in carrying goods between different towns.</li>
</ul>
<h3>Shipping by rail &mdash; the Goods Market &#128642;</h3>
<ul>
<li><b>Right-click a station notice board</b> and open the <b>Goods Market</b> tab.</li>
<li>It lists what you are carrying, which town down the line pays best, and the payout you will receive—paying the <b>full market price</b> with no drop-in penalty.</li>
<li><b>Book the shipment</b>, and your goods will be sent on the next train. Your <b>money arrives when the shipment is delivered</b> (about half a game-day), and a notification will confirm the sale. A wagon holds up to <b>96</b> units.</li>
</ul>`,

      'Ponies': `
<h3>Moorland ponies &#128052;</h3>
<p>Half-wild ponies graze the open moor. They are shaggy, dark, sure-footed creatures that can be tamed and ridden.</p>
<ul>
<li><b>Find a wild pony</b> out on the heather, walk up to her, and <b>right-click to mount</b>.</li>
<li>Use <b>W A S D</b> to ride. Ponies move at twice your walking speed and will <b>automatically jump low walls</b> without needing to jump manually. They are excellent for crossing the tops.</li>
<li>Press <b>F</b> to dismount. The pony will stay and graze where you left her until you return.</li>
</ul>`,

      'Pets': `
<h3>Taming and companions &#128054;</h3>
<p>Almost any creature you meet can be tamed with patience and their favorite food, then kept at your side or set to graze in a pasture.</p>
<ul>
<li><b>To tame a creature</b>: Hold their favorite food in your hand and <b>right-click the creature</b> to feed them. Repeat this until they warm to you, accept a name, and throw their lot in with you. <b>Ponies, sheep, cattle, and llamas</b> can be tamed with <b>bilberries</b>.</li>
<li><b>Shy creatures</b> (cats, hares) will run away if you approach—but if you <b>hold their favorite food</b>, they will stand still for you.</li>
<li><b>Dogs, cats, pigs, and rats</b> become <b>companions</b> that follow you everywhere.</li>
<li><b>Ponies, cattle, sheep, and llamas</b> become <b>farm stock</b>. Once tamed, they <b>stay where you won them over and graze</b>, never wandering away or despawning.</li>
</ul>
<h3>Companion Utilities</h3>
<ul>
<li>&#128021; <b>Sheepdog</b> (tamed with <b>meat</b>): Guards you at night, keeping night monsters away while at heel, and herds droveable stock to your whistle.</li>
<li>&#128008; <b>Cat</b> (tamed with <b>fish</b>): Right-click to send her scouting; she will return with useful items.</li>
<li>&#128055; <b>Pig</b> (tamed with <b>bilberries or meat</b>): Right-click to make her snuffle up buried treasures like jet, fossils, or coal.</li>
<li>&#128000; <b>Rat</b> (tamed with <b>scraps</b>): Forages for extra resources in the dark while you mine underground.</li>
</ul>`,

      'Farming': `
<h3>Building a fold &#127806;</h3>
<ul>
<li>Craft <b>Sheep Hurdles</b> (1 plank + 2 sticks makes 3) and a <b>Field Gate</b> (2 planks + 2 sticks). No bench is needed.</li>
<li>Enclose a pen with hurdles and set a gate in the ring. The gate is a special one-way barrier: animals can walk <b>in</b> from the outside, but <b>never back out</b>. You, however, can pass through freely.</li>
</ul>
<h3>Penning your stock</h3>
<ul>
<li>Drive wild animals through the gate into your fold. Any droveable species (sheep, cow, pony, llama) that steps inside becomes <b>your kept stock</b>. They receive a name, stay in the fold, and are saved with your world.</li>
<li>If you do not have a dog yet, you can tame a wild beast with bilberries where you stand and build a fence around it.</li>
</ul>
<h3>Registering your farm</h3>
<ul>
<li>Once you keep <b>5 head of penned stock</b>, visit the <b>parish notice board at Moorstead</b> and <b>register your farm</b> for a <b>£1 charter fee</b> (240d). This registers your farm on the parish books and unlocks droving.</li>
</ul>
<h3>Droving to market</h3>
<ul>
<li>Stand by your fold and press <b>G</b> to <b>muster</b> your penned animals into a drove. Use your working dog and whistle commands to drive them to the Moorstead mart.</li>
<li><b>Whistle controls</b> (using the arrow keys):
  <div class="controls-list">
  <b>&larr; Come-bye</b> Send the dog flanking to the left around the flock<br>
  <b>&rarr; Away</b> Send the dog flanking to the right around the flock<br>
  <b>&uarr; Walk on</b> Press the dog straight in to push the flock forward<br>
  <b>&darr; Lie down</b> Settle the dog where she stands<br>
  <b>H</b> Heel (call the dog back to your side)
  </div>
</li>
<li><b>Keep them bunched and move by day.</b> Animals that stray too far from you on the open moor will wander off, and after dark the <b>barghest</b> will attack them. You are paid for what arrives safely in the yard.</li>
</ul>
<h3>Livestock Market Value</h3>
<ul>
<li>Sell your droved flock at the Moorstead notice board. Payouts are species-specific:
  <ul>
  <li>🐑 <b>Sheep</b>: 120d (10s) per head</li>
  <li>🦙 <b>Pack Llama</b>: 110d (9s 2d) per head</li>
  <li>🐄 <b>Dale Cow</b>: 340d (£1 8s 4d) per head</li>
  <li>🐎 <b>Moorland Pony</b>: 540d (£2 5s) per head</li>
  </ul>
</li>
<li><b>Sty Stock (Pigs)</b>: Saddleback Pigs are kept as companions and cannot be herded. However, you can sell them individually at the Moorstead notice board for 150d (12s 6d) apiece.</li>
<li>⚠️ <b>Bull Hazard</b>: Cattle bulls are aggressive and cannot be herded or droved. Avoid herding them to prevent goring.</li>
</ul>`,

      'Mining': `
<h3>Mining rights and techniques</h3>
<ul>
<li><b>The Dig Limit:</b> Digging in open ground is restricted to a depth of 1 block below the surface level. Deep excavation requires a public quarry, an old working, or a registered mine.</li>
<li><b>Old Workings:</b> Natural cave drifts and the log-framed quarry pits scattered on the moor are free to mine — no licence — but ore there is sparse (worked out). Dig the pit floor or cave walls with a pick to explore or climb out.</li>
<li><b>Public Quarries:</b> Designated public quarries (in Moorstead, Goathland, and Pickering) allow deep digging for all players. Dug stone in public quarries regenerates over time.</li>
<li><b>Start Your Own Mine:</b> Place a crafted <b>Mine Entrance</b> (6 planks + 4 dressed stone) anywhere away from town boundaries to define your shaft.</li>
<li><b>Licensing:</b> Purchase a mining license deed at the Moorstead notice board. The initial fee is 120d plus 8d per block of licensed depth. Weekly upkeep is 1d per block of depth. Unpaid upkeep causes the mine to lapse.</li>
<li><b>Upkeeps & Upgrades:</b> Pay upkeep or increase your mine's licensed depth envelope at the notice board. If a mine lapses, its digs will gradually backfill over 24 days.</li>
</ul>
<h3>Pick Tiers & Safety Fixtures</h3>
<p>Deeper digging requires stronger picks and safety equipment placed inside the mine bounds:</p>
<ul>
<li><b>Band 1 (0 to 10 blocks below grade):</b> Wooden Pick or better. No fixtures needed.</li>
<li><b>Band 2 (11 to 20 blocks below grade):</b> Gritstone Pick or better. Must install <b>Pit Props</b> (2 oak logs + 2 sticks) to support the shaft.</li>
<li><b>Band 3 (21 to 30 blocks below grade):</b> Iron Pick or better. Must install a <b>Safety Lamp</b> (2 iron ingots + 1 torch) to ward off damp gases.</li>
<li><b>Band 4 (31+ blocks below grade):</b> Iron Pick or better. Must install a <b>Winch</b> (3 planks + 2 sticks + 1 iron ingot) to haul loads from the deeps.</li>
</ul>
<h3>Ores & Pricing</h3>
<ul>
<li><b>Coal:</b> Shallow fuel. Smelts ironstone and cooks food.</li>
<li><b>Cleveland Ironstone:</b> Found at mid depths. Smelt it on a range into iron ingots.</li>
<li><b>Alum Shale:</b> Base price 8d. Sells cheaper on the coast (Staithes and Whitby: 0.6x) and dearer inland (Rosedale and Pickering: 1.5x).</li>
<li><b>Rock Salt:</b> Base price 10d. Sells cheaper on the NE coast (Staithes: 0.6x) and dearer inland (Rosedale and Pickering: 1.6x).</li>
<li><b>Whitby Jet:</b> Base price 120d. Highly valuable gemstone. Requires Prospecting Level 3 to harvest.</li>
<li><b>Polyhalite (Potash):</b> Base price 60d. Excellent fertilizer. Sells cheaper at Staithes (0.6x) and dearer inland (Rosedale, Pickering, and Moorstead: 1.6x). Requires Prospecting Level 6 to harvest.</li>
</ul>
<h3>Prospecting Skill</h3>
<ul>
<li>Mining ores awards Prospecting XP: Coal (+1 XP), Ironstone and Alum (+2 XP), Rock Salt (+3 XP), Jet (+5 XP), and Polyhalite (+10 XP).</li>
<li>Your level is calculated as the square root of your XP divided by 10.</li>
<li><b>Harvest Gates:</b> If you try to harvest Whitby Jet (requires Level 3, 90+ XP) or Polyhalite (requires Level 6, 360+ XP) before reaching the required level, you will only receive bare stone. A notification will tell you: "Tha's too green to read t' seam: got bare stone."</li>
</ul>`,

      'Coast & Sea': `
<h3>The coast and the open sea &#9973;</h3>
<p>Follow the railway or the cliff path east to the sea—<b>Whitby</b> under the abbey, and the fishing village of <b>Staithes</b>. A <b>coble</b> (a traditional fishing boat) is moored at the harbour.</p>
<ul>
<li><b>To sail</b>: <b>Right-click the coble</b> to board. Use <b>W</b> to row forward, <b>S</b> to reverse, and <b>steer by looking in the direction</b> you want to go. Press <b>F</b> to step ashore; she will moor where you leave her.</li>
<li>The coble only sails in water—open sea, wide streams, or tarns. Pull up to a beach or pier to dismount.</li>
<li><b>Sea fishing</b>: Hold a fishing rod and cast your line from the boat into deep water for <b>larger catches</b>. You may also hook valuable treasures from the sea bed: sea-washed jet, snakestones, or sea-coal.</li>
<li>Sell your catch to the villagers at Whitby for coal or purchase a hot fish supper.</li>
</ul>`,

      'Craft & Cook': `
<h3>Crafting</h3>
<ul>
<li>Press <b>E</b> to open your pockets. Basic recipes (planks, sticks, bench, thatch) can be crafted anywhere. Advanced recipes require you to be <b>stood near a joiner's bench</b>.</li>
<li>Key recipes: pickaxes, axes, spades, and swords (wood, gritstone, and iron), <b>ranges</b> (8 cobble), <b>lanterns</b> (ingot + coal), dressed stone, thatch, and windows for your cottage.</li>
<li>A free bench and range are available in the pub (The Black Sheep, on the west side of the village green).</li>
</ul>
<h3>The Range (cooking & smelting)</h3>
<ul>
<li>Right-click a range. <b>Stoke the firebox first</b>: coal provides 4 cooking operations, while a peat block provides 1.</li>
<li>Smelting: ironstone &rarr; <b>iron ingots</b> &middot; raw mutton &rarr; <b>roast mutton</b> &middot; raw grouse &rarr; <b>roast grouse</b> &middot; raw beef &rarr; <b>roast beef</b> &middot; raw pork &rarr; <b>roast pork</b>. Cobble can also be fired back into gritstone.</li>
</ul>`,

      'T\u2019 Land': `
<h3>Reading the map</h3>
<ul>
<li>The HUD names your current location: high moors, dales (Rosedale, Farndale, Bilsdale...), May Moss, and the coast. The minimap shows the terrain, with north at the top.</li>
<li><b>The high moor</b> is a sea of heather, blanket bogs, waymark crosses, and ancient stone circles. <b>The dales</b> feature becks, woodlands, and walled pastures. To the <b>north</b>, the land ends in high cliffs overlooking the North Sea.</li>
</ul>
<h3>Landmarks worth the trek</h3>
<ul>
<li><b>Roseberry Topping</b> (far SW): The crooked peak. Rumor has it something mysterious lives at the summit.</li>
<li><b>The Wainstones</b> (SW): A crag of tumbled stones on the ridge.</li>
<li><b>The Hole of Horcum</b> (NE): A massive natural amphitheater scooped out of the moor.</li>
<li><b>Rosedale Ironstone Kilns</b> (SE): Stone arches with an ember that never dies. Rich ironstone veins are nearby.</li>
<li><b>Wade’s Causey</b>: The ancient Roman road, running straight over the tops.</li>
<li><b>Moor crosses</b>: Stone waymarks on the high moor. One is painted white: <b>Fat Betty</b>. Leaving her a small offering is customary.</li>
<li><b>The Abbey</b> (far N, on the cliffs): A ruined abbey overlooking the sea. A holy water font glimmers in the nave.</li>
<li><b>Whitby</b> (below the abbey cliffs): Features a harbour, pier, fish and chip shop, fossil shop, and the <b>Dracula Museum</b>.</li>
<li><b>Robin Hood’s Bay</b> (NE coast): A sweeping bay with broad <b>beaches</b>. <b>Dig the sand</b> to find fossils: ammonites (snakestones), Devil's Toenails (gryphaea), and washed-up jet. Harry and Glinda trade for fossils, and Harry treasures ammonites above all else.</li>
<li><b>The tide clears the beaches</b>: Anything dug or built on the sands will be smoothed over by the tide in a few minutes. Dig freely, but do not build permanent structures on the beach.</li>
</ul>
<p class="how-note">A full day-night cycle on the moors takes <b>30 minutes</b>. Your progress is saved automatically every 30 seconds in your browser.</p>`,

      'Merlin': `
<h3>Merlin, the wizard of the moor</h3>
<p>An ancient wizard walks these moors, complete with a <b>beard and pointed hat</b>. He is a friend to all travelers and exists in every world.</p>
<ul>
<li><b>Call him by name.</b> Press <b>T</b> to open chat and say <b>"Merlin"</b>. He will hear you from anywhere on the map and <b>teleport directly to you</b>. He can manifest in multiple places, so he never keeps anyone waiting.</li>
<li><b>Talk and explore.</b> Once he is with you, speak normally and he will answer, walking alongside you as you travel. He knows your inventory, coordinates, and where ores and villagers are located.</li>
<li><b>Let him lead you.</b> Ask him to <i>"take me to Goathland"</i>, <i>"where's the iron?"</i>, or <i>"lead me to your keep"</i>, and he will <b>set off walking</b>—simply follow him. If the destination is too far to walk, he will point you in the right direction.</li>
<li><b>Building assistance.</b> Ask him to <i>"mark me a plot"</i> to outline a building spot, or <i>"lay me a foundation"</i> to place a dressed-stone footing for a cottage.</li>
</ul>
<h3>Merlin’s magic &#10024;</h3>
<p>Carry the appropriate token in your pack and ask Merlin to <b>work some magic</b> to conjure a structure beside you:
<ul>
<li><b>Whitby jet</b> &rarr; a <b>Circle of Light</b> (a protective ring of lanterns).</li>
<li><b>Holy water</b> &rarr; a <b>Wayside Shrine</b> (a lit stone cross on hallowed ground).</li>
<li><b>An iron ingot</b> &rarr; a <b>Standing Stone</b> (a lit waymark).</li>
<li><b>Coal</b> &rarr; a <b>Beacon</b> (a fire burning atop a stone tower).</li>
<li><b>A snakestone</b> (ammonite or Devil’s toenail) &rarr; a <b>Stone Causeway</b> (a paved path from the living rock).</li>
<li><b>The Amulet of the Moors</b> &rarr; a <b>great Monument</b> (a lit obelisk ringed with standing stones).</li>
</ul>
<p class="how-note">Ask him empty-handed, and he will tell you which tokens trigger which structures. He consumes the token to cast the spell.</p>`
    };

    this.howTabs.innerHTML = '';
    const keys = Object.keys(S);
    this.howTabBtns = {};
    for (const k of keys) {
      const b = this.el('button', 'mc how-tab', this.howTabs, k);
      this.howTabBtns[k] = b;
      b.addEventListener('click', () => this.showHowTab(S, k));
    }
    this.showHowTab(S, keys[0]);
  }

  showHowTab(S, key) {
    this.howContent.innerHTML = S[key];
    for (const [k, b] of Object.entries(this.howTabBtns)) {
      b.classList.toggle('active', k === key);
    }
  }

  // ============ screens ============
  show(name) {
    for (const s of [this.titleScreen, this.pauseScreen, this.howScreen, this.feedbackScreen, this.deathScreen, this.invScreen, this.rangeScreen, this.loadingScreen, this.chatScreen, this.boardScreen, this.museumScreen]) {
      s.classList.add('hidden');
    }
    if (name) this[name].classList.remove('hidden');
    this.hud.classList.toggle('hidden', name === 'titleScreen' || name === 'loadingScreen');
    if (name !== 'titleScreen') this._stopFlyover();
  }

  _startFlyover() {
    try {
      if (!this.flyover && this.flyoverCanvas) this.flyover = new TitleFlyover(this.flyoverCanvas);
      this.flyover && this.flyover.start();
    } catch (e) { /* WebGL unavailable — the CSS gradient stands in */ }
  }

  _stopFlyover() { if (this.flyover) this.flyover.stop(); }

  // hidden on t' bairns' world so survival actually holds; shown everywhere else
  setCreativeButtonVisible(show) {
    if (this.btnCreative) this.btnCreative.style.display = show ? '' : 'none';
  }

  // ============ villager chat ============
  openChat(villager, playerHasName) {
    this.chatVillager = villager;
    this.chatName.textContent = villager.displayName;
    const brainDown = this.game && this.game.brainUp === false;
    this.chatTier.textContent = villager.charId
      ? (villager.tier ? `(${villager.tier})` : '')
      : (brainDown ? '(t\u2019 brain\u2019s asleep)' : '(a passer-by \u2014 won\u2019t recall thee)');
    this.chatNameRow.classList.toggle('hidden', playerHasName);
    this.chatInputRow.classList.toggle('hidden', !playerHasName);
    this.renderChatLog();
    this.renderChatActions();
    this.show('chatScreen');
    setTimeout(() => (playerHasName ? this.chatInput : this.chatNameInput).focus(), 50);
  }

  renderChatLog() {
    const v = this.chatVillager;
    this.chatMsgs.innerHTML = '';
    if (!v.chatLog.length) {
      this.el('div', 'chat-msg sys', this.chatMsgs,
        v.charId ? `${escHtml(v.displayName)} looks up as tha comes ower.` :
          (this.game && this.game.brainUp === false
            ? 'T&rsquo; village brain in&rsquo;t running &mdash; they&rsquo;ll potter abaht but say nowt till it wakes.'
            : `${escHtml(v.displayName)} gives thee a nod &mdash; happy to natter, though a passer-by&rsquo;ll not recall thee after.`));
    }
    for (const m of v.chatLog) {
      const cls = m.who === 'you' ? 'you' : m.who === 'sys' ? 'sys' : 'them';
      const who = m.who === 'you' ? 'Thee' : m.who === 'sys' ? '' : v.displayName;
      this.el('div', 'chat-msg ' + cls, this.chatMsgs,
        (who ? `<b>${escHtml(who)}:</b> ` : '') + escHtml(m.text));
    }
    if (this.chatWaiting) this.el('div', 'chat-msg them thinking', this.chatMsgs, `<b>${escHtml(v.displayName)}</b> is thinking...`);
    this.chatMsgs.scrollTop = this.chatMsgs.scrollHeight;
  }

  setChatTier(tier) {
    if (tier) this.chatTier.textContent = `(${tier})`;
  }

  // quest & barter buttons inside t' chat panel
  renderChatActions() {
    const v = this.chatVillager;
    const q = this.game.quests;
    this.chatQuestRow.innerHTML = '';
    if (!v || !q) return;

    const offer = q.offerFor(v.t.name);
    if (offer) {
      const b = this.el('button', 'mc chat-btn quest-btn', this.chatQuestRow,
        `Tek t&rsquo; job: <b>${offer.title}</b>`);
      b.addEventListener('click', () => {
        if (q.accept(offer)) {
          v.chatLog.push({ who: 'sys', text: `Tha's taken on: ${offer.title}. ${offer.desc}` });
          this.renderChatLog();
          this.renderChatActions();
        }
      });
    }
    const ti = q.turnInFor(v.t.name);
    if (ti) {
      const b = this.el('button', 'mc chat-btn quest-btn done-btn', this.chatQuestRow,
        `Hand ower: <b>${ti.title}</b>`);
      b.addEventListener('click', () => {
        q.completeTurnIn(ti, v);
        this.renderChatLog();
        this.renderChatActions();
      });
    }
    const econ = this.game.economy;
    if (econ) {
      for (const { id, price } of econ.buyList(v)) {
        const b = this.el('button', 'mc chat-btn trade-btn', this.chatQuestRow,
          `Buy ${itemName(id)} for <b>${econ.format(price)}</b>`);
        if (econ.canAfford(price)) {
          b.addEventListener('click', () => {
            if (econ.doBuy(v, id)) {
              v.chatLog.push({ who: 'sys', text: `Bought ${itemName(id)} for ${econ.format(price)}.` });
              this.game.recordTrade(v, id, 'buy');
              this.renderChatLog(); this.renderChatActions();
            }
          });
        } else {
          b.classList.add('locked');
          this.bindTooltip(b, `Tha needs ${econ.format(price)} for that.`);
        }
      }
      const isRare = (id) => [I.JET_GEM, I.AMMONITE, I.GRYPHAEA, I.IRON_INGOT].includes(id);
      const standing = econ.standing();
      const fullPrices = new Map(econ.sellList(v).map(x => [x.id, x.price]));
      for (const { id, price } of econ.dropInList(v)) {
        if (standing >= 3 && isRare(id) && fullPrices.has(id)) {
          const fullPrice = fullPrices.get(id);
          const b = this.el('button', 'mc chat-btn trade-btn', this.chatQuestRow,
            `Sell ${itemName(id)} (Trust) for <b>${econ.format(fullPrice)}</b>`);
          this.bindTooltip(b, `As a Respected/Treasured traveller, they'll buy thi rare goods at the full export rate directly.`);
          b.addEventListener('click', () => {
            if (econ.doSell(v, id)) {
              v.chatLog.push({ who: 'sys', text: `Sold ${itemName(id)} to ${v.displayName} for ${econ.format(fullPrice)}.` });
              this.game.recordTrade(v, id, 'sell');
              this.renderChatLog(); this.renderChatActions();
            }
          });
        } else {
          const b = this.el('button', 'mc chat-btn trade-btn', this.chatQuestRow,
            `Sell ${itemName(id)} for <b>${econ.format(price)}</b>`);
          this.bindTooltip(b, `A drop-in price, sold on t&rsquo; spot. Ship it by rail to where it&rsquo;s dear an&rsquo; tha&rsquo;ll get more.`);
          b.addEventListener('click', () => {
            if (econ.dropInSell(v, id)) {
              v.chatLog.push({ who: 'sys', text: `Sold ${itemName(id)} for ${econ.format(price)}.` });
              this.game.recordTrade(v, id, 'sell');
              this.renderChatLog(); this.renderChatActions();
            }
          });
        }
      }
    }
  }

  // ============ notice board / journal ============
  openBoard(fromBoard) {
    const q = this.game.quests;
    this.boardPanel.innerHTML = '';
    this.el('div', 'inv-title', this.boardPanel,
      fromBoard ? 'T&rsquo; Parish Notice Board' : 'Thi Ventures (Journal)');
    this.el('div', 'r-needs', this.boardPanel,
      `Standing in Moorstead: <b style="color:#9ec27a">${q.standingLabel()}</b>` +
      (q.wornTitle ? `, <i style="color:#c9b27a">${q.wornTitle}</i>` : '') +
      (q.shame > 0 ? ` &mdash; <span style="color:#d87a5a">but tha&rsquo;s in folk&rsquo;s bad books (${q.shame}). Good deeds&rsquo;ll mend it.</span>` : ''));

    // ---- Honours: earned period titles; wear one (or none). Inert until one is earned. ----
    {
      const titles = q.earnedTitleList();
      if (titles.length) {
        this.el('div', 'inv-title', this.boardPanel, 'Honours');
        const hlist = this.el('div', 'recipes board-list', this.boardPanel);
        const wearRow = (label, value, worn) => {
          const row = this.el('div', 'recipe quest-row', hlist);
          row.innerHTML = `<div class="r-name"><b>${worn ? '★ ' : ''}${label}</b>` +
            (worn ? '<br><span class="r-needs">worn now</span>' : '') + '</div>';
          if (!worn) {
            const b = this.el('button', 'mc chat-btn', row, 'Wear');
            b.addEventListener('click', () => { q.setWornTitle(value); this.openBoard(fromBoard); });
          }
        };
        for (const t of titles) wearRow(t, t, q.wornTitle === t);
        wearRow('&mdash; none &mdash;', null, q.wornTitle === null);
      } else if (this.game.world && this.game.world.gen.geo.realWorld) {
        // Moors world: a faint period line where honours are earnable. The stylised world
        // earns none, so it stays exactly as before (no label, no box) — the inert path.
        this.el('div', 'inv-title', this.boardPanel, 'Honours');
        this.el('div', 'r-needs', this.boardPanel,
          '<span style="opacity:.7">No honours yet &mdash; folk have no special name for thee.</span>');
      }
    }

    if (q.active.length) {
      this.el('div', 'inv-title', this.boardPanel, 'At It Now');
      const list = this.el('div', 'recipes board-list', this.boardPanel);
      for (const inst of q.active) {
        const s = inst.state === 'return' ? null : q.step(inst);
        const row = this.el('div', 'recipe quest-row', list);
        const mark = inst.dracArc ? '\u2020 ' : inst.arc ? '\u2605 ' : '';
        row.innerHTML = `<div class="r-name"><b>${mark}${inst.title}</b><br>` +
          `<span class="r-needs">${inst.state === 'return' ? 'Done \u2014 back to ' + q.dispName(inst.turnIn) : (s ? s.objective : '')}</span></div>`;
      }
    }

    this.el('div', 'inv-title', this.boardPanel, 'Pinned Notices');
    const list = this.el('div', 'recipes board-list', this.boardPanel);
    const arcDef = q.arcNext();
    const dracDef = q.draculaNext();
    if (dracDef && !q.active.some(a => a.dracArc)) {
      this.el('div', 'recipe unavail quest-row', list,
        `<div class="r-name"><b>\u2020 ${dracDef.title}</b><br><span class="r-needs">A separate mystery at t&rsquo; <b>Dracula Museum in Whitby</b> &mdash; right-click t&rsquo; museum boards by t&rsquo; harbour.</span></div>`);
    }
    if (arcDef && q.standingIndex() < arcDef.minStanding) {
      this.el('div', 'recipe unavail quest-row', list,
        `<div class="r-name"><b>\u2605 ${arcDef.title}</b><br><span class="r-needs">Folk don&rsquo;t trust thee wi&rsquo; this yet &mdash; needs &ldquo;${['Newcomer', 'Known', 'Welcomed', 'Respected', 'Treasured'][arcDef.minStanding]}&rdquo; standing. Talk to ${q.dispName(arcDef.giver)} when tha&rsquo;s ready.</span></div>`);
    } else if (arcDef && !q.offers[arcDef.giver]) {
      this.el('div', 'recipe unavail quest-row', list,
        `<div class="r-name"><b>\u2605 ${arcDef.title}</b><br><span class="r-needs">${q.dispName(arcDef.giver)} wants a word about this &mdash; go an&rsquo; talk to &rsquo;em.</span></div>`);
    }
    for (const [giver, inst] of Object.entries(q.offers)) {
      this.el('div', 'recipe unavail quest-row', list,
        `<div class="r-name"><b>${inst.arc ? '\u2605 ' : ''}${inst.title}</b><br><span class="r-needs">${q.dispName(giver)} has this job going &mdash; have a natter wi&rsquo; &rsquo;em.</span></div>`);
    }
    for (const inst of q.boardOffers) {
      const row = this.el('div', 'recipe quest-row', list);
      row.innerHTML = `<div class="r-name"><b>${inst.title}</b><br><span class="r-needs">${inst.desc}</span></div>`;
      const b = this.el('button', 'mc chat-btn', row, 'Tek it');
      b.addEventListener('click', () => {
        if (q.accept(inst, true)) this.openBoard(fromBoard);
      });
    }
    if (!q.boardOffers.length && !Object.keys(q.offers).length && !arcDef) {
      this.el('div', 'chat-msg sys', list, 'Nowt doing today. T&rsquo; moor keeps its own counsel.');
    }

    // ---- Become a Farmer (Slice 2): the registered-farm path, always shown for legibility ----
    {
      const g = this.game;
      const fs = g.player.farmStatus || { registered: false };
      const head = g.farmHeadCount();
      this.el('div', 'inv-title', this.boardPanel, 'Become a Farmer');
      if (fs.registered) {
        this.el('div', 'r-needs', this.boardPanel,
          '🌾 <b>Tha&rsquo;s a registered farmer o&rsquo; Moorstead parish.</b> Thi fold&rsquo;s on t&rsquo; books.');
        const herd = g.atMarketTown() ? g.droveHeadNear() : [];
        if (herd.length > 0) {
          const pay = g.economy.format(droveValue(herd, g.economy.standing()));
          const row = this.el('div', 'recipe quest-row', this.boardPanel);
          row.innerHTML = `<div class="r-name"><b>Sell thi droved flock</b><br><span class="r-needs">${herd.length} head in t&rsquo; yard &mdash; fetches <b>${pay}</b></span></div>`;
          const sb = this.el('button', 'mc chat-btn trade-btn', row, 'Sell at t’ mart');
          sb.addEventListener('click', () => { if (g.sellDrove()) this.openBoard(fromBoard); });
        }
        // Sell pigs individually
        const pets = g.player.pets || [];
        const pigs = pets.filter(p => p && p.kind === 'pig');
        if (pigs.length > 0 && g.atMarketTown()) {
          const row = this.el('div', 'recipe quest-row', this.boardPanel);
          const pigPrice = g.economy.format(g.economy.livestockPrice('pig', g.economy.standing()));
          row.innerHTML = `<div class="r-name"><b>Sell Saddleback Pig</b><br><span class="r-needs">Sell ${pigs[0].name} for <b>${pigPrice}</b></span></div>`;
          const sb = this.el('button', 'mc chat-btn trade-btn', row, 'Sell Pig');
          sb.addEventListener('click', () => { if (g.sellPig(pigs[0].name)) this.openBoard(fromBoard); });
        }
      } else {
        const need = FARM_THRESHOLD;
        const atMkt = g.atMarketTown();
        const bal = g.economy.balance;
        this.el('div', 'r-needs', this.boardPanel,
          `Keep <b>${need} head</b> o&rsquo; stock penned in a fold, then register here for a <b>${g.economy.format(CHARTER_FEE)}</b> charter.`);
        this.el('div', 'r-needs', this.boardPanel,
          head >= need
            ? `<b style="color:#9ec27a">${head}/${need} head penned</b> &mdash; tha&rsquo;s ready to register.`
            : `<b>${head}/${need} head penned</b> &mdash; pen <b>${need - head}</b> more.`);
        const chk = farmRegisterCheck({ head, registered: false, brass: bal, atMarket: atMkt });
        if (chk.ok) {
          const row = this.el('div', 'recipe quest-row', this.boardPanel);
          row.innerHTML = `<div class="r-name"><b>Register thi farm</b><br><span class="r-needs">pay t&rsquo; ${g.economy.format(CHARTER_FEE)} charter</span></div>`;
          const b = this.el('button', 'mc chat-btn', row, 'Register');
          b.addEventListener('click', () => { if (g.registerFarm()) this.openBoard(fromBoard); });
        } else if (head >= need && !atMkt) {
          this.el('div', 'r-needs', this.boardPanel, 'Come to <b>Moorstead</b>&rsquo;s notice board to sign t&rsquo; register.');
        } else if (head >= need && chk.reason === 'poor') {
          this.el('div', 'r-needs', this.boardPanel, `Tha needs <b>${g.economy.format(CHARTER_FEE)}</b> for t&rsquo; charter (tha&rsquo;s ${g.economy.format(bal)}).`);
        }
      }
    }

    // ---- Thi Deeds: stake a plot, keep it with upkeep (Living Moor Slice 2) ----
    {
      const g = this.game;
      const deeds = (g.world && g.world.deeds) || [];
      this.el('div', 'inv-title', this.boardPanel, 'Thi Deeds');
      const stakeFee = deedFee('claim', 8);
      this.el('div', 'r-needs', this.boardPanel,
        `Stake a <b>claim</b> to hold a plot (8m round) for <b>${g.economy.format(stakeFee)}</b>, then a little upkeep each week. (Claims protect thi builds, that lands soon.)`);
      const stakeRow = this.el('div', 'recipe quest-row', this.boardPanel);
      stakeRow.innerHTML = `<div class="r-name"><b>Stake a claim where tha stands</b><br><span class="r-needs">${g.economy.format(stakeFee)} charter</span></div>`;
      const sb = this.el('button', 'mc chat-btn', stakeRow, 'Stake');
      sb.addEventListener('click', () => { if (g.stakeClaim(8)) this.openBoard(fromBoard); });

      // Find unlicensed mine entrance near player
      let nearUnlicensedMine = null;
      const px = Math.floor(g.player.pos.x);
      const py = Math.floor(g.player.pos.y);
      const pz = Math.floor(g.player.pos.z);
      outerLoop:
      for (let dx = -8; dx <= 8; dx++) {
        for (let dy = -4; dy <= 4; dy++) {
          for (let dz = -8; dz <= 8; dz++) {
            const bx = px + dx;
            const by = py + dy;
            const bz = pz + dz;
            if (g.world.getBlock(bx, by, bz) === B.MINE_ENTRANCE) {
              const activeMine = g.world.deeds.some(d => d.kind === 'mine' && !d.lapsedDay && (bx - d.cx) ** 2 + (bz - d.cz) ** 2 <= d.radius * d.radius);
              if (!activeMine) {
                nearUnlicensedMine = { x: bx, y: by, z: bz };
                break outerLoop;
              }
            }
          }
        }
      }

      if (nearUnlicensedMine) {
        const mineFee = deedFee('mine', 5, 10);
        const mineRow = this.el('div', 'recipe quest-row', this.boardPanel);
        mineRow.innerHTML = `<div class="r-name"><b>Buy Mining Licence</b><br><span class="r-needs">${g.economy.format(mineFee)} fee (10m depth) for mine at ${nearUnlicensedMine.x}, ${nearUnlicensedMine.z}</span></div>`;
        const mb = this.el('button', 'mc chat-btn', mineRow, 'Licence');
        mb.addEventListener('click', () => {
          if (g.stakeMine(nearUnlicensedMine.x, nearUnlicensedMine.z, 10)) {
            this.openBoard(fromBoard);
          }
        });
      }

      if (!deeds.length) {
        this.el('div', 'chat-msg sys', this.boardPanel, 'Tha holds no deeds yet.');
      } else {
        for (const d of deeds) {
          const up = weeklyUpkeep(d.kind, d.radius, d.depth);
          const status = d.lapsedDay
            ? '<span style="color:#d87a5a">lapsed, settle to save it</span>'
            : `paid to day ${Math.floor(d.paidUntilDay)}`;
          
          const row = this.el('div', 'recipe quest-row', this.boardPanel);
          if (d.kind === 'mine') {
            const nextDepth = d.depth + 10;
            const upgradeCost = nextDepth <= 40 ? (deedFee('mine', 5, nextDepth) - deedFee('mine', 5, d.depth)) : 0;
            const upgradeText = nextDepth <= 40 ? ` ; upgrade ${nextDepth}m: ${g.economy.format(upgradeCost)}` : '';
            row.innerHTML = `<div class="r-name"><b>Mining Licence at ${d.cx}, ${d.cz}</b> (depth ${d.depth}m)<br><span class="r-needs">${status} ; upkeep ${g.economy.format(up)}/wk${upgradeText}</span></div>`;
            
            const pb = this.el('button', 'mc chat-btn', row, 'Settle up');
            pb.addEventListener('click', () => { if (g.settleUp(d.id)) this.openBoard(fromBoard); });
            
            if (!d.lapsedDay && d.depth < 40) {
              const ub = this.el('button', 'mc chat-btn', row, 'Upgrade');
              ub.addEventListener('click', () => { if (g.upgradeMine(d.id)) this.openBoard(fromBoard); });
            }
          } else {
            row.innerHTML = `<div class="r-name"><b>${d.kind} at ${d.cx}, ${d.cz}</b> (${d.radius}m)<br><span class="r-needs">${status} ; upkeep ${g.economy.format(up)}/wk</span></div>`;
            const pb = this.el('button', 'mc chat-btn', row, 'Settle up');
            pb.addEventListener('click', () => { if (g.settleUp(d.id)) this.openBoard(fromBoard); });
          }
        }
      }
    }

    const close = this.el('button', 'mc', this.boardPanel, 'Reet, Ta');
    close.addEventListener('click', () => this.game.closeScreens());
    this.show('boardScreen');
  }

  // ============ Dracula Museum ============
  openMuseum() {
    const q = this.game.quests;
    this.museumPanel.innerHTML = '';
    this.el('div', 'inv-title', this.museumPanel, 'Dracula Museum &mdash; Whitby');
    this.el('div', 'r-needs museum-intro', this.museumPanel,
      'How a Dublin writer&rsquo;s 1890 holiday on these cliffs gave England its most famous vampire.');

    const exhibits = [
      {
        title: 'Bram Stoker in Whitby, 1890',
        text: 'Stoker stayed at Mrs Veazey&rsquo;s guesthouse on the West Cliff and spent his days walking the harbour, the churchyard of St Mary&rsquo;s, and the 199 Steps. He read local guidebooks, listened to sailors&rsquo; tales, and filled notebooks with atmosphere &mdash; fog, gulls, the abbey ruin above the town, jet workshops clattering in narrow yards.',
      },
      {
        title: 'The Abbey &amp; the Atmosphere',
        text: 'Whitby Abbey &mdash; Benedictine, then ruined by Henry VIII &mdash; broods over the town on the east cliff. Stoker placed Dracula in the form of a great dog leaping ashore and running up the 199 Steps. The real abbey gave him scale, decay, and the sense that old powers still linger in stone.',
      },
      {
        title: 'The Demeter',
        text: 'In the novel, the Russian schooner <em>Demeter</em> runs aground below the East Cliff with all hands dead and a huge dog aboard that bounds ashore. Whitby&rsquo;s treacherous harbour mouth and sudden sea-fogs made the wreck believable. Fishermen here still watch the horizon turn strange before a haar rolls in.',
      },
      {
        title: 'Jet, Gulls &amp; Sea-Fog',
        text: 'Victorian Whitby lived on jet carving and fishing. Black jewellery, wet ropes, herring scales, gas lamps in mist &mdash; Stoker braided the town&rsquo;s real textures into Gothic terror without naming every street. That is why it feels as if the story happened here rather than anywhere else.',
      },
      {
        title: 'Why Folk Say He Walks t&rsquo; Moor',
        text: 'The book ends inland, but travellers brought the tale up the Esk valley onto the moors. A foreign count, a black dog, holy water and a stake &mdash; old village wisdom mixed with Stoker&rsquo;s fiction. Some nights, out past Wade&rsquo;s Causey, folk swear they feel watched long afore owt shows itssen.',
      },
    ];

    for (const ex of exhibits) {
      const row = this.el('div', 'museum-exhibit', this.museumPanel);
      this.el('div', 'museum-exhibit-title', row, ex.title);
      this.el('div', 'museum-exhibit-text', row, ex.text);
    }

    const offer = q.museumOffer();
    const readingDrac2 = q.active.some(a => a.dracArc && q.step(a)?.kind === 'museum');

    if (offer) {
      const b = this.el('button', 'mc chat-btn quest-btn', this.museumPanel,
        `Begin: <b>${offer.title}</b>`);
      b.addEventListener('click', () => {
        if (q.accept(offer, false)) {
          this.closeScreens();
          this.toast('New venture: <b>' + offer.title + '</b> &mdash; explore Whitby, then t\u2019 abbey an\u2019 t\u2019 moors.', 6000);
        }
      });
    } else if (readingDrac2) {
      const b = this.el('button', 'mc chat-btn done-btn', this.museumPanel, 'I\u2019ve read t\u2019 exhibits');
      b.addEventListener('click', () => {
        if (q.onMuseumRead()) this.closeScreens();
      });
    } else if (q.draculaDone()) {
      this.el('div', 'chat-msg sys', this.museumPanel,
        'Count Dracula&rsquo;s laid to rest &mdash; but t\u2019 story that began in this room changed t\u2019 moors forever.');
    }

    const close = this.el('button', 'mc', this.museumPanel, 'Out into t\u2019 harbour air');
    close.addEventListener('click', () => this.game.closeScreens());
    this.show('museumScreen');
  }

  setDread(v) {
    this.dreadOverlay.style.opacity = String(Math.max(0, Math.min(0.72, v * 0.65)));
  }

  // a white screen-flash blip for a lightning strike; the CSS transition fades it
  // back out, so the storm controller need only blip it up on each strike.
  setStormFlash(v) {
    if (!this.stormFlash) return;
    this.stormFlash.style.opacity = String(Math.max(0, Math.min(0.85, v)));
  }

  // ============ HUD quest tracker ============
  updateTracker() {
    const q = this.game.quests;
    if (!q || !q.active.length) { this.tracker.innerHTML = ''; return; }
    let html = '';
    for (const line of q.trackerLines().slice(0, 4)) {
      const mark = line.dracArc ? '\u2020 ' : line.arc ? '\u2605 ' : '';
      html += `<div class="tq"><b>${mark}${line.title}</b><br>${line.text}</div>`;
    }
    if (this.tracker.innerHTML !== html) this.tracker.innerHTML = html;
  }

  // toggle title screen between login an' play states
  setLoggedIn(auth) {
    const loggedIn = !!auth;
    this.loginBox.classList.toggle('hidden', loggedIn);
    this.btnNew.classList.toggle('hidden', !loggedIn);
    this.btnShared.classList.toggle('hidden', !loggedIn);
    this.btnContinue.classList.toggle('hidden', !loggedIn);
    this.legacyBox.classList.toggle('hidden', !loggedIn);   // contains the seed input + legacy button
    this.whoBox.classList.toggle('hidden', !loggedIn);
    if (!loggedIn) return;
    if (auth.guest) {
      this.whoBox.innerHTML = 'Passing through as <b>a rambler</b> &mdash; <u id="swap-user">got an invite?</u>';
      document.getElementById('swap-user').onclick = () => this.game.logout();
      return;
    }
    if (auth.warden) {
      this.whoBox.innerHTML = 'Logged in as <b>Warden</b> &mdash; <u id="swap-user">log out</u>';
      document.getElementById('swap-user').onclick = () => this.game.logout();
      return;
    }
    const roster = (this.game.loadAccounts ? this.game.loadAccounts() : []).filter(a => a.acct !== auth.acct);
    let html = `Welcome back, <b>${escHtml(auth.name)}</b>`;
    if (roster.length) {
      html += '<div class="who-switch"><span class="lbl">play as:</span>' + roster.map(a =>
        `<button class="who-chip" data-acct="${escHtml(a.acct)}">${escHtml(a.name)}</button>` +
        `<button class="who-forget" data-forget="${escHtml(a.acct)}" title="forget this un">&times;</button>`
      ).join('') + '</div>';
    }
    html += '<div class="who-new"><u id="swap-user">+ someone new</u></div>';
    this.whoBox.innerHTML = html;
    document.getElementById('swap-user').onclick = () => this.game.logout();
    this.whoBox.querySelectorAll('.who-chip').forEach(b => { b.onclick = () => this.game.switchAccount(b.dataset.acct); });
    this.whoBox.querySelectorAll('.who-forget').forEach(b => { b.onclick = e => { e.stopPropagation(); this.game.forgetAccount(b.dataset.forget); }; });
  }

  toast(text, ms = 3500) {
    const t = this.el('div', 'toast', this.toastBox, text);
    setTimeout(() => t.remove(), ms);
    while (this.toastBox.children.length > 4) this.toastBox.firstChild.remove();
  }

  // ============ HUD ============
  updateHUD(player, sky) {
    // hearts / hunger
    for (let i = 0; i < 10; i++) {
      const hv = player.health - i * 2;
      this.heartImgs[i].src = hv >= 2 ? this.heartFull : hv >= 1 ? this.heartHalf : this.heartEmpty;
      const fv = player.hunger - i * 2;
      this.foodImgs[i].src = fv >= 1 ? this.foodFull : this.foodEmpty;
    }
    const survival = !player.creative;
    this.heartsEl.style.visibility = survival ? 'visible' : 'hidden';
    this.hungerEl.style.visibility = survival ? 'visible' : 'hidden';
    if (this.brassEl && this.game.economy) this.brassEl.textContent = '¤ ' + this.game.economy.format(player.brass);

    // temperature pips
    for (let i = 0; i < 10; i++) {
      const tv = player.temperature - i * 2;
      this.tempImgs[i].src = tv >= 2 ? this.tempFull : tv >= 1 ? this.tempHalf : this.tempEmpty;
    }
    const wintry = this.game && this.game.season && this.game.season.warmth < 0;
    this.tempEl.style.visibility = (!player.creative && (player.temperature < 20 || wintry)) ? 'visible' : 'hidden';

    // air bubbles
    const showAir = survival && player.air < 10;
    this.airRow.style.visibility = showAir ? 'visible' : 'hidden';
    if (showAir) {
      for (let i = 0; i < 10; i++) this.bubbles[i].style.visibility = player.air > i ? 'visible' : 'hidden';
    }

    this.vignette.style.opacity = Math.min(1, Math.max(0, player.hurtFlash * 2));
    const coldV = player.temperature < 6 ? (6 - player.temperature) / 6 : 0;
    if (coldV > 0) {
      this.coldVignette.style.background = `radial-gradient(ellipse at center, transparent 45%, rgba(200,225,255,${(coldV * 0.45).toFixed(3)}) 100%)`;
      this.coldVignette.style.opacity = '1';
    } else {
      this.coldVignette.style.opacity = '0';
    }

    if (this.invDirty) { this.renderHotbar(player); this.invDirty = false; }

    const px = Math.floor(player.pos.x), py = Math.floor(player.pos.y), pz = Math.floor(player.pos.z);
    // t' Great Fog takes thi bearings wi' it: no place name, no coordinates
    const _s = this.game && this.game.season && this.game.season.season;
    const _seasonStr = _s ? ' · ' + _s.charAt(0).toUpperCase() + _s.slice(1) : '';
    if (sky.moorFog > 0.6) {
      this.mapInfo.innerHTML =
        `<span style="color:#9aa0a8">Lost in t&rsquo; fog</span><br>` +
        `?, ?, ?<br>Day ${sky.day} &mdash; ${sky.timeName()}${_seasonStr}` +
        (player.creative ? '<br><span style="color:#d8b95a">Creative</span>' : '');
      return;
    }
    const loc = this.game.world ? this.game.world.gen.geo.locationName(px, pz) : '';
    this.mapInfo.innerHTML =
      `<span style="color:#d8b95a">${loc}</span><br>` +
      `${px}, ${py}, ${pz}<br>Day ${sky.day} &mdash; ${sky.timeName()}${_seasonStr}` +
      (this.game.standing ? `<br>Standing: <span style="color:#9ec27a">${this.game.standing}</span>` : '') +
      (player.creative ? '<br><span style="color:#d8b95a">Creative</span>' : '');
  }

  renderSlot(slotEl, stack) {
    slotEl.innerHTML = '';
    if (!stack) return;
    const img = document.createElement('img');
    img.src = getIconURL(stack.id);
    img.draggable = false;
    slotEl.appendChild(img);
    if (stack.n > 1) this.el('span', 'count', slotEl, stack.n);
    if (TOOLS[stack.id] && stack.dur < TOOLS[stack.id].dur) {
      const bar = this.el('div', 'dur', slotEl);
      const fill = this.el('i', '', bar);
      const f = stack.dur / TOOLS[stack.id].dur;
      fill.style.width = (f * 100) + '%';
      fill.style.background = f > 0.5 ? '#5ad85a' : f > 0.2 ? '#d8c85a' : '#d85a5a';
    }
  }

  renderHotbar(player) {
    this.hotbarEl.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const s = this.el('div', 'slot' + (i === player.hotbar ? ' sel' : ''), this.hotbarEl);
      this.renderSlot(s, player.slots[i]);
    }
  }

  drawBreakProgress(frac) {
    const ctx = this.breakCanvas.getContext('2d');
    ctx.clearRect(0, 0, 46, 46);
    if (frac <= 0) return;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(23, 23, 18, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    ctx.stroke();
  }

  // ============ minimap ============
  drawMinimap(player, world) {
    const ctx = this.minimap.getContext('2d');
    const size = 160, scale = 2; // 2px per block, 80 block span
    // t' Great Fog blots t' map out entirely — folk navigate by memory or not at all
    if (this.game.sky && this.game.sky.moorFog > 0.6) {
      ctx.fillStyle = '#b9bec4';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#62676e';
      ctx.textAlign = 'center';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText('T’ FOG’S DOWN', size / 2, 74);
      ctx.font = '11px sans-serif';
      ctx.fillText('tha’s on thi own out here', size / 2, 94);
      return;
    }
    const span = size / scale;
    const px = Math.floor(player.pos.x), pz = Math.floor(player.pos.z);
    const img = ctx.createImageData(size, size);
    const d = img.data;
    let curKey = null, cols = null;
    for (let sy = 0; sy < span; sy++) {
      const wx = px + (span >> 1) - sy;   // screen up = north (+x)
      for (let sx = 0; sx < span; sx++) {
        const wz = pz - (span >> 1) + sx; // screen right = east (+z)
        const cx = Math.floor(wx / CHUNK), cz = Math.floor(wz / CHUNK);
        const k = cx + ',' + cz;
        if (k !== curKey) { curKey = k; cols = world.surfaceColors(cx, cz); }
        let r = 12, g = 14, b = 20;
        if (cols) {
          const lx = wx - cx * CHUNK, lz = wz - cz * CHUNK;
          const o = (lz * CHUNK + lx) * 3;
          r = cols[o]; g = cols[o + 1]; b = cols[o + 2];
        }
        for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
          const idx = ((sy * scale + dy) * size + sx * scale + dx) * 4;
          d[idx] = r; d[idx + 1] = g; d[idx + 2] = b; d[idx + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    // the railways drawn crisp over the terrain (every line), clipped to the window
    ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const { path } of world.gen.geo.railPaths()) {
      for (const [col, w] of [['rgba(28,28,28,0.85)', 3], ['rgba(203,183,132,0.95)', 1.2]]) {
        ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath();
        let on = false;
        for (const pt of path.pts) {
          const sx = (pt.z - player.pos.z) * scale + size / 2, sy = -(pt.x - player.pos.x) * scale + size / 2;
          if (sx < -4 || sx > size + 4 || sy < -4 || sy > size + 4) { on = false; continue; }
          if (on) ctx.lineTo(sx, sy); else { ctx.moveTo(sx, sy); on = true; }
        }
        ctx.stroke();
      }
    }
    ctx.restore();
    // other folk on t' shared moor, if any are in t' window
    const net = this.game && this.game.net;
    if (net && net.remotes && net.remotes.size) {
      for (const r of net.remotes.values()) {
        const p = r.mob ? r.mob.pos : r.target; if (!p) continue;
        const sx = (p.z - player.pos.z) * scale + size / 2;   // right = east (+z)
        const sy = -(p.x - player.pos.x) * scale + size / 2;  // up = north (+x)
        if (sx < 3 || sx > size - 3 || sy < 3 || sy > size - 3) continue;
        ctx.fillStyle = '#5ad0ff'; ctx.strokeStyle = '#002'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(sx, sy, 3, 0, 7); ctx.fill(); ctx.stroke();
      }
    }
    // player arrow
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(-player.yaw - Math.PI / 2);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
    // north marker
    ctx.fillStyle = '#d8b95a'; ctx.font = 'bold 11px sans-serif';
    ctx.fillText('N', size / 2 - 3, 11);
    this.drawMiningOnMinimap(ctx, player, scale, size, world);
  }

  setMiningHighlights(sites, ms = 60000) {
    const until = performance.now() + ms;
    this.miningHighlightUntil = until;
    this.miningHighlights = (sites || []).map(s => ({ ...s, until }));
  }

  guideMiningBlocked(player, world, reason, message, highlights) {
    this.toast(message, 9000);
    if (highlights && highlights.length) this.setMiningHighlights(highlights);
  }

  drawMiningOnMinimap(ctx, player, scale, size, world) {
    if (!world) return;
    const now = performance.now();
    for (const q of parishQuarries(world.deeds)) {
      drawMinimapMarker(ctx, player, scale, size, q.cx, q.cz, 'rgba(202,168,74,0.85)', 3, false);
    }
    for (const h of this.miningHighlights) {
      if (h.until <= now) continue;
      const pulse = 5 + Math.sin(now / 280) * 2;
      const col = h.kind === 'quarry' ? '#ffe080' : '#ffb040';
      drawMinimapMarker(ctx, player, scale, size, h.cx, h.cz, col, pulse, true);
    }
  }

  // ============ expanded "peek" map (hold Tab) ============
  mapTint(geo, x, z) {
    const ct = geo.coastT(x, z);
    if (ct > 0.5) return '#26415c';                                       // t' North Sea
    const h = geo.height(x, z);
    if (ct > 0.25 || (h >= 22 && h <= 27 && ct > 0.05)) return '#cdb98a'; // sands
    if (h < WATER_LEVEL) return '#3a5e7a';                                // beck or tarn
    const bog = geo.bogginess(x, z);
    if (h >= 33 && bog > 0.5) return '#39341f';                           // blanket bog
    if (h >= 33) return geo.heatheriness(x, z) > 0.3 ? '#6a4f6a' : '#5b4c3c'; // heather moor / bare top
    return '#4a5e34';                                                     // dale pasture
  }

  buildBigMap(player, world) {
    const geo = world.gen.geo;
    let minX, maxX, minZ, maxZ;
    if (geo.realWorld && geo.worldBounds) {
      // a real-OS world: fit the map exactly to the data extent so terrain never
      // gets extruded past the edge into strips, and skip the stylised landmarks
      ({ minX, maxX, minZ, maxZ } = geo.worldBounds());
    } else {
      minX = 1e9; maxX = -1e9; minZ = 1e9; maxZ = -1e9;
      const note = (x, z) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); };
      for (const v of geo.villages) note(v.x, v.z);
      for (const s of geo.railway()) note(s.x, s.z);
      for (const [x, z] of [[-700, -880], [540, 680], [-380, -620], [-260, 380], [CASTLE.x, CASTLE.z]]) note(x, z);
      note(player.pos.x, player.pos.z);
      // North is +x (up). The North Sea lies off +x, so pad there (the top).
      minX -= 140; maxX += 200; minZ -= 140; maxZ += 140;
    }
    const C = this.bigMap, W = C.width, H = C.height;
    const wwX = maxX - minX, wwZ = maxZ - minZ; // height spans world-x (N-S), width spans world-z (E-W)
    const sc = Math.min(W / wwZ, H / wwX);
    const offH = (W - wwZ * sc) / 2, offV = (H - wwX * sc) / 2;
    this._mapXf = { s: sc, offH, offV, minZ, maxX };
    // project world (x,z) -> screen: north (+x) up, east (+z) right
    const w2x = (x, z) => offH + (z - minZ) * sc;
    const w2y = (x, z) => offV + (maxX - x) * sc;
    const base = this.mapBase; base.width = W; base.height = H;
    const b = base.getContext('2d');
    b.fillStyle = '#0e1118'; b.fillRect(0, 0, W, H);
    const CELLS = 170, stepX = wwX / CELLS, stepZ = wwZ / CELLS;        // coarse terrain tint
    const cw = Math.ceil(stepZ * sc) + 2, ch = Math.ceil(stepX * sc) + 2;
    for (let i = 0; i < CELLS; i++) for (let j = 0; j < CELLS; j++) {
      const wx = minX + (i + 0.5) * stepX, wz = minZ + (j + 0.5) * stepZ;
      b.fillStyle = this.mapTint(geo, wx, wz);
      b.fillRect(Math.floor(w2x(wx, wz) - cw / 2), Math.floor(w2y(wx, wz) - ch / 2), cw, ch);
    }
    b.lineJoin = 'round';                                               // every railway line
    for (const { path } of geo.railPaths()) {
      const pts = path.pts;
      b.strokeStyle = '#1c1c1c'; b.lineWidth = 4; b.beginPath();
      pts.forEach((pt, i) => { const X = w2x(pt.x, pt.z), Y = w2y(pt.x, pt.z); i ? b.lineTo(X, Y) : b.moveTo(X, Y); }); b.stroke();
      b.strokeStyle = '#cbb784'; b.lineWidth = 1.4; b.stroke();
    }
    const stations = (geo.realWorld && geo.data) ? geo.data.stations : geo.railway();
    for (const st of stations) {                                        // stations
      const X = w2x(st.x, st.z), Y = w2y(st.x, st.z);
      b.fillStyle = '#1c1c1c'; b.fillRect(X - 3, Y - 3, 6, 6);
      b.fillStyle = '#e8d8a0'; b.fillRect(X - 2, Y - 2, 4, 4);
      b.fillStyle = '#d8c89a'; b.font = '10px sans-serif'; b.textAlign = 'left'; b.fillText(st.name, X + 5, Y + 3);
    }
    for (const v of geo.villages) {                                     // villages
      const X = w2x(v.x, v.z), Y = w2y(v.x, v.z);
      b.fillStyle = '#caa84a'; b.strokeStyle = '#000'; b.lineWidth = 1.5;
      b.beginPath(); b.arc(X, Y, 5, 0, 7); b.fill(); b.stroke();
      b.fillStyle = '#fff'; b.font = 'bold 12px sans-serif'; b.textAlign = 'left'; b.fillText(v.name, X + 7, Y + 4);
    }
    for (const q of parishQuarries(world.deeds)) {                        // parish quarries (free deep stone)
      const X = w2x(q.cx, q.cz), Y = w2y(q.cx, q.cz);
      b.strokeStyle = 'rgba(255,224,128,0.9)'; b.lineWidth = 2;
      b.beginPath(); b.arc(X, Y, Math.max(4, q.radius * sc * 0.35), 0, 7); b.stroke();
      b.fillStyle = '#caa84a'; b.beginPath(); b.arc(X, Y, 4, 0, 7); b.fill();
      b.fillStyle = '#ffe8a0'; b.font = '10px sans-serif'; b.textAlign = 'left';
      b.fillText('⛏ ' + q.name, X + 6, Y - 5);
    }
    for (const p of world.gen.listWildQuarries()) {                       // old moor pits (faint)
      const X = w2x(p.cx, p.cz), Y = w2y(p.cx, p.cz);
      b.fillStyle = 'rgba(255,176,64,0.55)'; b.beginPath(); b.arc(X, Y, 2.5, 0, 7); b.fill();
    }
    b.fillStyle = '#a59c8c'; b.font = 'italic 11px sans-serif';         // landmarks
    const lms = (geo.realWorld && geo.data && geo.data.landmarks)
      ? geo.data.landmarks.map(l => [l.name, l.x, l.z])
      : [['Roseberry Topping', -700, -880], ['Hole of Horcum', 540, 680], ['Wainstones', -380, -620], ['Rosedale Kilns', -260, 380], ['Whitby Abbey', geo.abbeySite().x, geo.abbeySite().z], ["Merlin's Keep", CASTLE.x, CASTLE.z]];
    for (const [label, x, z] of lms) {
      b.fillText('▲ ' + label, w2x(x, z) + 4, w2y(x, z));
    }
    b.fillStyle = '#d8b95a'; b.font = 'bold 16px sans-serif'; b.textAlign = 'center'; b.fillText('N ↑', W - 34, 26);
    this.mapBaseKey = world.gen.seed;
  }

  drawBigMapDots(player, net) {
    const ctx = this.bigMap.getContext('2d');
    ctx.drawImage(this.mapBase, 0, 0);
    const xf = this._mapXf; if (!xf) return;
    const w2x = (x, z) => xf.offH + (z - xf.minZ) * xf.s, w2y = (x, z) => xf.offV + (xf.maxX - x) * xf.s;
    net = net || (this.game && this.game.net);
    if (net && net.remotes) {                                           // other folk, named
      ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
      for (const r of net.remotes.values()) {
        const p = r.mob ? r.mob.pos : r.target; if (!p) continue;
        const X = w2x(p.x, p.z), Y = w2y(p.x, p.z);
        ctx.fillStyle = '#5ad0ff'; ctx.strokeStyle = '#013'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(X, Y, 4, 0, 7); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#cdefff'; ctx.fillText(r.name || 'rambler', X + 6, Y + 3);
      }
    }
    const game = this.game;                                             // every train, live
    if (game && game.world) {
      const geo = game.world.gen.geo;
      const lines = geo.railPaths ? geo.railPaths() : [];
      const mainName = (lines.find(l => l.path === geo.railPath()) || {}).name;
      const single = lines.length <= 1;
      const trains = [];
      if (game.trainState) trains.push({ x: game.trainState.x, z: game.trainState.z, name: single ? 'T’ Train' : (mainName || 'Train') });
      for (const bt of (game.branchTrains || [])) if (bt.state) trains.push({ x: bt.state.x, z: bt.state.z, name: bt.name });
      ctx.textAlign = 'left';
      for (const t of trains) {
        const TX = w2x(t.x, t.z), TY = w2y(t.x, t.z);
        ctx.save(); ctx.translate(TX, TY);
        ctx.fillStyle = 'rgba(245,245,245,0.85)'; ctx.beginPath(); ctx.arc(-5, -6, 3, 0, 7); ctx.fill();  // steam
        ctx.fillStyle = '#241310'; ctx.fillRect(-7, -4, 14, 8);                                           // loco body
        ctx.fillStyle = '#d34b38'; ctx.fillRect(2, -4, 5, 8);                                             // red boiler front
        ctx.strokeStyle = '#f4dca0'; ctx.lineWidth = 1.4; ctx.strokeRect(-7, -4, 14, 8);                  // gold outline
        ctx.restore();
        ctx.font = 'bold 11px sans-serif';
        ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.strokeText(t.name, TX + 10, TY + 4);
        ctx.fillStyle = '#ffd98a'; ctx.fillText(t.name, TX + 10, TY + 4);
      }
    }
    const X = w2x(player.pos.x, player.pos.z), Y = w2y(player.pos.x, player.pos.z);  // thee
    ctx.save(); ctx.translate(X, Y); ctx.rotate(-player.yaw - Math.PI / 2);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    const now = performance.now();
    if (this.miningHighlightUntil > now) {
      for (const h of this.miningHighlights) {
        if (h.until <= now) continue;
        const X = w2x(h.cx, h.cz), Y = w2y(h.cx, h.cz);
        const pulse = 7 + Math.sin(now / 260) * 3;
        ctx.strokeStyle = h.kind === 'quarry' ? '#ffe080' : '#ffb040';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(X, Y, pulse, 0, 7); ctx.stroke();
        ctx.fillStyle = h.kind === 'quarry' ? '#caa84a' : '#ffb040';
        ctx.beginPath(); ctx.arc(X, Y, 5, 0, 7); ctx.fill();
      }
    }
  }

  showBigMap(player, world) {
    if (!world) return;
    const ctx = this.bigMap.getContext('2d');
    if (this.game.sky && this.game.sky.moorFog > 0.6) {                 // t' fog swallows t' map an' all
      ctx.fillStyle = '#b9bec4'; ctx.fillRect(0, 0, this.bigMap.width, this.bigMap.height);
      ctx.fillStyle = '#62676e'; ctx.textAlign = 'center'; ctx.font = 'bold 22px sans-serif';
      ctx.fillText('T’ FOG’S DOWN — no map till it lifts', this.bigMap.width / 2, this.bigMap.height / 2);
      this.mapOverlay.classList.remove('hidden');
      return;
    }
    if (this.mapBaseKey !== world.gen.seed) this.buildBigMap(player, world);
    this.drawBigMapDots(player, this.game.net);
    const titleEl = document.getElementById('big-map-title');
    if (titleEl) {
      const hint = performance.now() < this.miningHighlightUntil
        ? ' <span class="dim">· gold = free quarry · amber pulse = nearest pit</span>'
        : ' <span class="dim">· ⛏ parish quarries · amber dots = old moor pits</span>';
      titleEl.innerHTML = 'T&rsquo; Moors &mdash; <span class="dim">hold Tab to peek</span>' + hint;
    }
    this.mapOverlay.classList.remove('hidden');
  }

  hideBigMap() { this.mapOverlay.classList.add('hidden'); }

  // ride-camera switcher
  showRideViewMenu(active) { if (this.rideViewMenu) { this.rideViewMenu.style.display = 'flex'; this.setRideViewMenu(active); } }
  setRideViewMenu(active) {
    if (!this._rideChips) return;
    for (const k in this._rideChips) {
      const on = k === active, c = this._rideChips[k];
      c.style.background = on ? 'rgba(211,75,56,0.92)' : 'rgba(22,17,12,0.7)';
      c.style.color = on ? '#fff' : '#cdbf9a';
      c.style.borderColor = on ? 'rgba(255,220,160,0.6)' : 'rgba(0,0,0,0.5)';
    }
  }
  hideRideViewMenu() { if (this.rideViewMenu) this.rideViewMenu.style.display = 'none'; }

  // warden world chooser — resolves wi' a relay room name
  pickWorld(currentRoom) {
    return new Promise(resolve => {
      const ov = this.el('div', '', document.body); ov.id = 'world-pick';
      const box = this.el('div', '', ov); box.id = 'world-pick-box';
      this.el('div', 'inv-title', box, 'Which world, Warden?');
      const worlds = [['moor', 'T’ Moor (original)'], ['bairns', 'Bairns’ World'], ['dale', 'Dale'], ['crag', 'Crag'], ['tarn', 'Tarn']];
      for (const [room, label] of worlds) {
        const btn = this.el('button', 'mc', box, label + (room === currentRoom ? ' · (thine)' : ''));
        btn.onclick = () => { ov.remove(); resolve(room); };
      }
      const cancel = this.el('div', 'muted-note', box, '<u>cancel</u>'); cancel.style.cursor = 'pointer';
      cancel.onclick = () => { ov.remove(); resolve(currentRoom); };
    });
  }

  // ============ inventory & crafting ============
  openInventory(player, nearBench) {
    this.invPanel.innerHTML = '';
    // A visible close — the only keyboard-free way off this screen, so touch players aren't trapped
    // (desktop still has E/Esc). Other screens (board, museum, chat) already carry their own close.
    const close = this.el('button', 'mc inv-close', this.invPanel, 'Done');
    close.addEventListener('click', () => this.game.closeScreens());
    const flex = this.el('div', 'inv-flex', this.invPanel);

    const left = this.el('div', '', flex);
    if (player.creative) {
      this.el('div', 'inv-title', left, 'T&rsquo; Creative Cupboard');
      const cg = this.el('div', 'inv-grid creative-grid', left);
      for (const id of CREATIVE_ITEMS) {
        const s = this.el('div', 'slot', cg);
        this.renderSlot(s, { id, n: 1, dur: TOOLS[id] ? TOOLS[id].dur : undefined });
        s.querySelector('.count')?.remove();
        this.bindTooltip(s, itemName(id));
        s.addEventListener('mousedown', e => {
          e.preventDefault();
          const n = e.button === 2 ? 1 : maxStack(id);
          this.drag = { id, n, dur: TOOLS[id] ? TOOLS[id].dur : undefined };
          this.refreshDrag();
        });
        s.addEventListener('contextmenu', e => e.preventDefault());
      }
    }

    this.el('div', 'inv-title', left, 'Thi Pockets');
    const grid = this.el('div', 'inv-grid', left);
    // rows 9..35 then hotbar 0..8
    const order = [];
    for (let i = 9; i < 36; i++) order.push(i);
    for (let i = 0; i < 9; i++) order.push(i);
    for (const idx of order) {
      const s = this.el('div', 'slot' + (idx < 9 ? ' sel' : ''), grid);
      if (idx < 9) s.style.borderColor = '#8a8062';
      this.renderSlot(s, player.slots[idx]);
      if (player.slots[idx]) this.bindTooltip(s, itemName(player.slots[idx].id));
      s.addEventListener('mousedown', e => {
        e.preventDefault();
        this.slotClick(player, idx, e.button);
      });
      s.addEventListener('contextmenu', e => e.preventDefault());
    }

    if (!player.creative) {
      const right = this.el('div', '', flex);
      this.el('div', 'inv-title', right, nearBench ? 'Craftin&rsquo; (at t&rsquo; bench)' : 'Craftin&rsquo;');
      const list = this.el('div', 'recipes', right);
      for (const r of RECIPES) {
        const can = r.needs.every(([id, n]) => player.countItem(id) >= n);
        const benchOk = !r.bench || nearBench;
        const row = this.el('div', 'recipe' + (can && benchOk ? '' : ' unavail'), list);
        const img = document.createElement('img');
        img.src = getIconURL(r.out); img.draggable = false;
        row.appendChild(img);
        const needsTxt = r.needs.map(([id, n]) => `${n}&times; ${itemName(id)}`).join(', ');
        this.el('div', 'r-name', row, `${itemName(r.out)}${r.n > 1 ? ' &times;' + r.n : ''}`);
        this.el('div', 'r-needs', row, benchOk ? needsTxt : 'Needs a joiner&rsquo;s bench');
        if (can && benchOk) {
          row.addEventListener('mousedown', () => {
            for (const [id, n] of r.needs) player.removeItem(id, n);
            const left2 = player.addItem(r.out, r.n);
            if (left2 > 0) this.game.dropAtPlayer(r.out, left2);
            this.game.audio.craft();
            this.game.milestones.onCraft(r.out);
            this.invDirty = true;
            this.openInventory(player, nearBench); // re-render
          });
        }
      }
    }
    this.show('invScreen');
  }

  slotClick(player, idx, button) {
    const cur = player.slots[idx];
    if (this.drag) {
      if (button === 2) { // place one
        if (!cur) {
          player.slots[idx] = { id: this.drag.id, n: 1, dur: this.drag.dur };
          this.drag.n--;
        } else if (cur.id === this.drag.id && cur.n < maxStack(cur.id)) {
          cur.n++; this.drag.n--;
        }
        if (this.drag.n <= 0) this.drag = null;
      } else {
        if (!cur) {
          player.slots[idx] = this.drag; this.drag = null;
        } else if (cur.id === this.drag.id && !TOOLS[cur.id]) {
          const take = Math.min(this.drag.n, maxStack(cur.id) - cur.n);
          cur.n += take; this.drag.n -= take;
          if (this.drag.n <= 0) this.drag = null;
        } else {
          player.slots[idx] = this.drag; this.drag = cur;
        }
      }
    } else if (cur) {
      if (button === 2) { // split half
        const half = Math.ceil(cur.n / 2);
        this.drag = { id: cur.id, n: half, dur: cur.dur };
        cur.n -= half;
        if (cur.n <= 0) player.slots[idx] = null;
      } else {
        this.drag = cur;
        player.slots[idx] = null;
      }
    }
    this.refreshDrag();
    this.invDirty = true;
    this.openInventory(player, this.game.nearBench());
  }

  refreshDrag() {
    if (this.drag) {
      this.dragEl.classList.remove('hidden');
      this.dragEl.innerHTML = `<img src="${getIconURL(this.drag.id)}">` +
        (this.drag.n > 1 ? `<span class="count">${this.drag.n}</span>` : '');
    } else {
      this.dragEl.classList.add('hidden');
      this.dragEl.innerHTML = '';
    }
  }

  closeInventory(player) {
    // owt left on t' cursor goes back in
    if (this.drag) {
      const left = player.addItem(this.drag.id, this.drag.n, this.drag.dur);
      if (left > 0 && !player.creative) this.game.dropAtPlayer(this.drag.id, left);
      this.drag = null;
      this.refreshDrag();
    }
    this.tooltip.classList.add('hidden');
    this.invDirty = true;
  }

  bindTooltip(el, text) {
    el.addEventListener('mouseenter', () => {
      this.tooltip.textContent = text;
      this.tooltip.classList.remove('hidden');
    });
    el.addEventListener('mouseleave', () => this.tooltip.classList.add('hidden'));
  }

  // ============ range / smelting ============
  openRange(player) {
    this.rangePanel.innerHTML = '';
    this.el('div', 'inv-title', this.rangePanel, 'T&rsquo; Range');
    this.el('div', 'r-needs', this.rangePanel,
      `Fuel in t&rsquo; firebox: <b style="color:#d8b95a">${player.fuelBank}</b> &mdash; chuck in coal (4 goes) or peat (1 go)`);
    const list = this.el('div', 'recipes', this.rangePanel);
    list.style.width = '380px';

    // fuel buttons
    for (const [fuelId, val] of Object.entries(FUELS)) {
      const id = +fuelId;
      const have = player.countItem(id);
      const row = this.el('div', 'recipe' + (have > 0 ? '' : ' unavail'), list);
      row.innerHTML = `<img src="${getIconURL(id)}"><div class="r-name">Stoke wi&rsquo; ${itemName(id)} (+${val})</div><div class="r-needs">tha&rsquo;s got ${have}</div>`;
      if (have > 0) {
        row.addEventListener('mousedown', () => {
          player.removeItem(id, 1);
          player.fuelBank += val;
          this.game.audio.smelt();
          this.invDirty = true;
          this.openRange(player);
        });
      }
    }

    for (const sm of SMELTS) {
      const have = player.countItem(sm.in);
      const can = have > 0 && player.fuelBank >= 1;
      const row = this.el('div', 'recipe' + (can ? '' : ' unavail'), list);
      row.innerHTML = `<img src="${getIconURL(sm.out)}"><div class="r-name">${sm.label}</div>` +
        `<div class="r-needs">1&times; ${itemName(sm.in)} + 1 fuel (tha&rsquo;s got ${have})</div>`;
      if (can) {
        row.addEventListener('mousedown', () => {
          player.removeItem(sm.in, 1);
          player.fuelBank -= 1;
          const left = player.addItem(sm.out, 1);
          if (left > 0) this.game.dropAtPlayer(sm.out, left);
          this.game.audio.smelt();
          this.game.milestones.onSmelt(sm.out);
          this.invDirty = true;
          this.openRange(player);
        });
      }
    }
    this.btnRangeClose = this.el('button', 'mc', this.rangePanel, 'Done');
    this.btnRangeClose.addEventListener('click', () => this.game.closeScreens());   // click (not mousedown) so it fires on touch
    this.show('rangeScreen');
  }

  showDeath(cause) {
    this.deathCause.textContent = cause;
    this.show('deathScreen');
  }
}
