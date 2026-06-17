// All DOM UI: title, HUD, inventory/crafting/smelting, chat, quests, pause, death, minimap, toasts.
import { B, I, RECIPES, SMELTS, FUELS, FOODS, TOOLS, itemName, maxStack, CREATIVE_ITEMS, CHUNK, WATER_LEVEL } from './defs.js';
import { getIconURL } from './textures.js';
import { CASTLE } from './geography.js';

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
    this.breakCanvas = this.el('canvas', '', this.hud);
    this.breakCanvas.id = 'break-progress';
    this.breakCanvas.width = 46; this.breakCanvas.height = 46;
    this.interactHint = this.el('div', '', this.hud);
    this.interactHint.id = 'interact-hint';
    this.dreadOverlay = this.el('div', '', this.hud);
    this.dreadOverlay.id = 'dread-overlay';

    const stats = this.el('div', '', this.hud); stats.id = 'stats';
    this.heartsEl = this.el('div', '', stats); this.heartsEl.id = 'hearts';
    this.hungerEl = this.el('div', '', stats); this.hungerEl.id = 'hunger';
    this.heartImgs = []; this.foodImgs = [];
    for (let i = 0; i < 10; i++) {
      const h = this.el('img', 'pip', this.heartsEl); h.src = this.heartFull; this.heartImgs.push(h);
      const f = this.el('img', 'pip', this.hungerEl); f.src = this.foodFull; this.foodImgs.push(f);
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
    this.mapInfo = this.el('div', '', mapBox); this.mapInfo.id = 'map-info';

    this.toastBox = this.el('div', '', this.hud); this.toastBox.id = 'toasts';

    // shared-moor chat line (T to talk)
    this.netChatRow = this.el('div', 'hidden', this.hud); this.netChatRow.id = 'net-chat';
    this.netChatInput = this.el('input', 'chat-input', this.netChatRow);
    this.netChatInput.placeholder = 'Say summat to t\u2019 moor... (Enter sends, Esc shuts up)';
    this.netChatInput.maxLength = 200;
    this.vignette = this.el('div', '', body); this.vignette.id = 'hurt-vignette';

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
    this.el('div', 'subtitle', this.titleScreen, 'A reet grand voxel adventure on t&rsquo; North York Moors');
    const blurb = this.el('div', 'subtitle', this.titleScreen,
      'A whole Yorkshire moor that carries on without thee &mdash; seven villages of folk who&rsquo;ll learn thi name, ' +
      'a steam railway tha can <b>ride or drive</b>, half-wild <b>ponies</b> to saddle, jet to mine, ' +
      'crofts to raise, an&rsquo; owd <b>folklore</b> stirrin&rsquo; after dark.');
    blurb.style.cssText = 'max-width:600px;margin:12px auto 8px;font-size:14px;line-height:1.65;opacity:0.9';
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

    this.whoBox = this.el('div', 'login-who hidden', this.titleScreen, '');

    this.seedInput = this.el('input', 'seed', this.titleScreen);
    this.seedInput.placeholder = "World seed (leave blank for t' fates to decide)";
    this.btnNew = this.el('button', 'mc', this.titleScreen, 'New World &mdash; Gerron Wi&rsquo; It');
    this.btnShared = this.el('button', 'mc', this.titleScreen, 'T&rsquo; Shared Moor &mdash; Play Wi&rsquo; Others');
    this.btnContinue = this.el('button', 'mc', this.titleScreen, 'Carry On Where Tha Left Off');
    this.btnHow = this.el('button', 'mc', this.titleScreen, 'Ow Ter Play');
    this.el('div', 'muted-note', this.titleScreen, 'New to t&rsquo; moor? <b>Give &lsquo;Ow Ter Play&rsquo; a read</b> &mdash; how to build, ride, drive an&rsquo; stay alive.');
    this.el('div', 'muted-note', this.titleScreen, 'Watch thissen at neet &mdash; t&rsquo; barghest walks when t&rsquo; sun goes down.');
    this.el('div', 'title-foot', this.titleScreen, 'Made wi&rsquo; nowt but procedural generation &mdash; not a single asset file');

    // ---------- pause ----------
    this.pauseScreen = this.el('div', 'overlay hidden', body);
    const pp = this.el('div', 'panel', this.pauseScreen);
    this.el('div', 'inv-title', pp, 'Hod On a Minute (Paused)');
    this.btnResume = this.el('button', 'mc', pp, 'Back to t&rsquo; Moor');
    this.btnSave = this.el('button', 'mc', pp, 'Save T&rsquo; World');
    this.btnCreative = this.el('button', 'mc', pp, 'Toggle Creative Mode');
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

    // ---------- loading ----------
    this.loadingScreen = this.el('div', 'overlay hidden', body);
    this.el('div', 'panel', this.loadingScreen, '<div class="inv-title">Walkin&rsquo; up onto t&rsquo; moor...</div>');
  }

  // ============ ow ter play sections ============
  buildHowSections() {
    const S = {
      'First Day': `
<h3>Tha&rsquo;s just moved to Moorstead. Here&rsquo;s thi first day, sorted:</h3>
<ol>
<li><b>Click t&rsquo; screen</b> to grab t&rsquo; mouse, then have a wander round t&rsquo; green. Walk up to a villager (their name floats ower their head) and <b>right-click for a natter</b> &mdash; tell &rsquo;em thi name, ask about work.</li>
<li><b>Punch a tree</b> (hold left-click on t&rsquo; trunk) for logs. Press <b>E</b>, craft <b>Planks</b>, then <b>Sticks</b>, then a <b>Joiner&rsquo;s Bench</b>. Place t&rsquo; bench (right-click) and stand by it to unlock proper recipes.</li>
<li>Dig a bit o&rsquo; gritstone wi&rsquo; a <b>wooden pick</b>, then make a <b>gritstone sword and pick</b>. T&rsquo; sword matters: 2 cobble + 1 stick.</li>
<li>Grab some scran for thi pockets &mdash; punch <b>bilberry bushes</b> for berries, or clout a yow for mutton (not in t&rsquo; village, mind &mdash; folk talk).</li>
<li>Check t&rsquo; <b>parish notice board</b> by t&rsquo; village cross (or press <b>Q</b>) and tek a job or two.</li>
<li>When t&rsquo; light turns amber &mdash; t&rsquo; gloamin&rsquo; &mdash; <b>get back to t&rsquo; village</b>. Nowt dark sets foot on Moorstead ground. Out on t&rsquo; moor at neet, tha&rsquo;s fair game.</li>
</ol>
<p class="how-note">If tha dies: tha keeps all thi stuff and wakes on t&rsquo; green. No harm done, bar thi pride.</p>`,

      'Controls': `
<div class="controls-list">
<b>Mouse</b> Look abaht<br>
<b>Left click</b> Dig blocks (hold) / clout beasts<br>
<b>Right click</b> Place blocks / eat scran / talk to folk / use bench, range &amp; board<br>
<b>W A S D</b> Walk<br>
<b>Z</b> Leg it (sprint &mdash; burns hunger, outruns a barghest)<br>
<b>Space</b> Jump / swim up<br>
<b>Shift</b> Sneak &mdash; slow, but tha won&rsquo;t walk off edges<br>
<b>1&ndash;9 / mouse wheel</b> Pick hotbar slot<br>
<b>E</b> Thi pockets &mdash; inventory &amp; crafting<br>
<b>Q</b> Venture journal (same as t&rsquo; notice board)<br>
<b>T</b> Village chat on t&rsquo; Shared Moor (carries ~60m)<br>
<b>N</b> Sleep till morn (of a neet, under a roof, near a light)<br>
<b>M</b> Mute sound<br>
<b>Esc</b> Pause / close a screen<br>
<b>Space &times;2</b> Toggle flying (creative mode only)
</div>
<p class="how-note"><b>Ridin&rsquo; &amp; drivin&rsquo;:</b> on a pony or t&rsquo; footplate, <b>W A S D</b> shifts thee; <b>F</b> gets thee down off a pony (or shovels coal when tha&rsquo;s drivin&rsquo;); <b>E</b> brings t&rsquo; train to a stand. Full details under <b>Ponies</b> an&rsquo; <b>T&rsquo; Railway</b>.</p>
<p class="how-note">Creative mode lives in t&rsquo; pause menu: fly, infinite blocks, instant digging, nowt can hurt thee.</p>`,

      'Staying Alive': `
<h3>Hearts, hunger an&rsquo; what kills thee</h3>
<ul>
<li><b>Hunger</b> drains as tha walks, sprints, jumps an&rsquo; digs. Below 6 pies tha can&rsquo;t sprint; at nowt, tha starves down to half a heart. Eat wi&rsquo; right-click: bilberries (+3), raw mutton (+3), <b>roast mutton (+8)</b>, grouse. Cook on a range.</li>
<li><b>Health</b> heals on its own when tha&rsquo;s well fed (16+ hunger). Otherwise: eat, wait, or stay out o&rsquo; trouble.</li>
<li><b>Falling</b> hurts past 3 blocks. <b>Water</b>: tha can swim (Space), but air bubbles run out &mdash; surface afore they do.</li>
<li><b>Keep dry.</b> Caught out in t&rsquo; rain (or wadin&rsquo; t&rsquo; beck) an&rsquo; tha gets <b>soaked through</b> &mdash; soaked, tha can&rsquo;t rest up nor heal, an&rsquo; tha burns thi scran keepin&rsquo; warm. Get <b>under a roof or by a fire</b> an&rsquo; tha&rsquo;ll soon dry off.</li>
<li><b>Bogs</b> on t&rsquo; high moor are t&rsquo; dark pools in t&rsquo; peat. They grip thee, sink thee, and they&rsquo;re hungry. Skirt round, or sprint-jump if tha must.</li>
<li><b>Neet</b> belongs to t&rsquo; <b>barghest</b> (great black hound, eyes like coals) and <b>boggarts</b> (little horrors frae t&rsquo; mires). They walk frae dusk till dawn, out on t&rsquo; open moor only &mdash; <b>Moorstead ground is hallowed; nowt dark sets foot on it</b>. Tha can sprint faster than a barghest. Just.</li>
<li><b>Dark things fear flame.</b> Craft <b>torches</b> (1 stick + 1 coal = 4, no bench needed): a <b>placed</b> torch or lantern wards off all but t&rsquo; worst within ~9 blocks an&rsquo; stops owt rising nearby &mdash; plant a ring o&rsquo; them an&rsquo; camp anywhere. A torch <b>in thi hand</b> lights thi way an&rsquo; sees off boggarts, but a barghest&rsquo;s bolder than that.</li>
<li><b>Caught out at neet?</b> Stone <b>moor shelters</b> stand scattered across t&rsquo; tops, lantern-lit an&rsquo; safe. <b>Right-click any waymark signpost</b> &mdash; it&rsquo;ll tell thee t&rsquo; bearing an&rsquo; distance to t&rsquo; nearest shelter an&rsquo; back to Moorstead. Tha can craft thi own signposts (3 planks + 1 stick) to mark routes.</li>
<li><b>T&rsquo; GREAT FOG.</b> Every three days or so, a fog like wet wool comes down on t&rsquo; <b>high tops</b> for half a day. Tha can&rsquo;t see five yards, an&rsquo; t&rsquo; <b>map an&rsquo; bearings go wi&rsquo; it</b> &mdash; no minimap, no coordinates, nowt. Villages, t&rsquo; coast an&rsquo; t&rsquo; low dales stay clear. If it catches thee on t&rsquo; tops: <b>stop</b>. Find a waymark stone or a wall an&rsquo; follow it; signposts still know t&rsquo; way to shelter if tha stumbles on one. Or place torches as breadcrumbs an&rsquo; sit it out &mdash; it lifts as sudden as it falls.</li>
<li><b>Sleep t&rsquo; neet away.</b> Find a <b>roof an&rsquo; a light</b> &mdash; a villager&rsquo;s house, t&rsquo; pub, a moor shelter, or thi own cottage wi&rsquo; a torch in &mdash; an&rsquo; press <b>N</b>: tha sleeps till morn an&rsquo; wakes wi&rsquo; <b>full health</b> (an&rsquo; a bit of an appetite). On t&rsquo; Shared Moor t&rsquo; neet only passes when <b>everybody</b> kips down &mdash; so shout &rsquo;em in off t&rsquo; moor first.</li>
<li><b>Dying</b> loses thee nowt &mdash; tha wakes on t&rsquo; green wi&rsquo; thi pockets intact.</li>
</ul>
<h3>Tools an&rsquo; digging</h3>
<ul>
<li>Tiers: <b>wood &rarr; gritstone &rarr; iron</b>. Better tools dig faster an&rsquo; last longer (watch t&rsquo; little durability bar).</li>
<li>Stone, ores an&rsquo; brick <b>need a pick</b> or tha gets nowt. Dirt an&rsquo; peat like a spade; trees like an axe; beasts respect a sword.</li>
<li>Ores: <b>coal</b> (shallow), <b>ironstone</b> (deeper &mdash; smelt to ingots), <b>Whitby jet</b> (deepest, rare, precious). Caves honeycomb t&rsquo; hills if tha&rsquo;s bold.</li>
</ul>`,

      'T\u2019 Village': `
<h3>T&rsquo; folk o&rsquo; t&rsquo; moors</h3>
<ul>
<li><b>Every settlement is lived in</b>: t&rsquo; family at Moorstead, t&rsquo; stationmaster an&rsquo; shepherdess at Goathland, t&rsquo; innkeeper an&rsquo; owd miner at Rosedale Abbey, fisherfolk at Staithes, t&rsquo; vicar an&rsquo; market trader at Pickering, engine crew at Grosmont, an&rsquo; t&rsquo; fishwife an&rsquo; jet carver at Whitby. Each knows their own patch best.</li>
<li><b>Of an evening they head indoors</b> &mdash; tha&rsquo;ll see &rsquo;em walk to their own door at dusk. Follow &rsquo;em in an&rsquo; <b>right-click for a natter by t&rsquo; lantern</b>; they&rsquo;re home all neet an&rsquo; out again of a morning.</li>
<li><b>Right-click a villager</b> to talk &mdash; proper talk, they remember thee between visits, and word travels round t&rsquo; family. Tell &rsquo;em things, ask &rsquo;em things. They know t&rsquo; moors better than thee.</li>
<li><b>Friendship</b> grows wi&rsquo; every chat: Stranger &rarr; Acquaintance &rarr; Friendly &rarr; Friend &rarr; Close friend. As folk warm to thee they <b>press presents into thi hands</b> &mdash; t&rsquo; closer t&rsquo; friend, t&rsquo; finer t&rsquo; gift.</li>
<li><b>Give</b> hands ower whatever tha&rsquo;s holding. Folk have favourites &mdash; Glinda&rsquo;s partial to heather, t&rsquo; kids like bilberries. A good gift builds trust faster than talk.</li>
<li><b>Swaps (barter)</b>: trade buttons sit under t&rsquo; chat &mdash; wool for ingots, heather for wool, jet for an iron pick. Better stock unlocks as thi standing rises.</li>
<li><b>Standing</b> (under t&rsquo; minimap) is thi name across t&rsquo; whole village: Newcomer &rarr; Known &rarr; Welcomed &rarr; Respected &rarr; Treasured. It gates t&rsquo; bigger ventures an&rsquo; t&rsquo; better swaps.</li>
<li><b>Mind thissen</b>: wreck folk&rsquo;s houses or kill t&rsquo; village flock and word gets round &mdash; standing falls, folk turn cold, jobs dry up. Good deeds (and time) mend it.</li>
</ul>
<p class="how-note">Quiet villagers? T&rsquo; village brain&rsquo;s asleep &mdash; they&rsquo;ll potter abaht but say nowt till it wakes.</p>`,

      'Ventures': `
<h3>Finding work an&rsquo; adventure</h3>
<ul>
<li><b>Villagers offer jobs in conversation</b> &mdash; ask about work, news, or owt to do. A green button appears when there&rsquo;s a job going: <i>Tek t&rsquo; job</i>.</li>
<li>T&rsquo; <b>parish notice board</b> by t&rsquo; village cross (or press <b>Q</b> owt where) lists pinned notices: deliveries, beast bounties, owd treasure riddles.</li>
<li>Active ventures show <b>top-left</b> wi&rsquo; a compass bearing an&rsquo; distance (&ldquo;NW &middot; 290m&rdquo;). Riddles show nowt &mdash; tha must read t&rsquo; land.</li>
<li><b>Stuck? Ask t&rsquo; villagers.</b> They hold clues: t&rsquo; kids blurt &rsquo;em out plain, Granny Glinda talks in riddles worth untangling. Different folk know different pieces.</li>
<li>Some jobs <b>hand back in</b> &mdash; go see t&rsquo; giver and press <i>Hand ower</i>. Others (deliveries, bounties, digs) pay out on t&rsquo; spot.</li>
<li>Rewards: goods, tools, trust wi&rsquo; t&rsquo; giver &mdash; and finished jobs polish thi standing.</li>
</ul>
<h3>T&rsquo; Hound o&rsquo; the Mires &#9733;</h3>
<p>Summat&rsquo;s been taking sheep in t&rsquo; night. <b>T&rsquo; Hound o&rsquo; the Mires</b> runs five chapters across t&rsquo; real landmarks &mdash; starred &#9733; in thi journal. It starts wi&rsquo; Farmer James, and it ends on a crooked hill, at neet, wi&rsquo; summat as has eyes like coals. Higher chapters need higher standing &mdash; t&rsquo; village doesn&rsquo;t hand its secrets to strangers.</p>
<h3>Count Dracula on t&rsquo; Moors &#8224;</h3>
<p>A <b>separate</b> storyline, marked &#8224; in thi journal. Start at t&rsquo; <b>Dracula Museum in Whitby</b> (north coast, below t&rsquo; abbey cliffs). Learn how Bram Stoker&rsquo;s 1890 visit gave England its vampire; then draw <b>holy water</b> frae t&rsquo; abbey font, craft a <b>wooden stake</b> at a bench an&rsquo; steep it in t&rsquo; water. At neet, Count Dracula walks t&rsquo; open moor &mdash; tha&rsquo;ll <b>feel him afore tha sees him</b>. Hold t&rsquo; holy stake to strike true; hide in <b>moor shelters</b> or reach a village if tha must. Slaying him makes t&rsquo; moors <b>far safer after dark</b> &mdash; barghests still walk, but nowt worse.</p>`,

      'T’ Railway': `
<h3>T&rsquo; Moors Railway</h3>
<ul>
<li><b>One steam train</b> works t&rsquo; whole line, on t&rsquo; same clock for every player &mdash; tha can watch her steam past frae out on t&rsquo; moor, plume an&rsquo; all.</li>
<li>T&rsquo; line runs like t&rsquo; real un: <b>Pickering</b> (south end) &rarr; <b>Levisham</b> (a lone halt under t&rsquo; Hole of Horcum) &rarr; <b>Moorstead</b> &rarr; <b>Goathland</b> &rarr; <b>Grosmont</b> &rarr; <b>Whitby</b> by t&rsquo; sea.</li>
<li><b>To ride</b>: find t&rsquo; station platform (lantern, departures board, signpost), <b>right-click t&rsquo; board</b>, pick where tha&rsquo;s bound an&rsquo; pay t&rsquo; fare &mdash; <b>coal lumps</b>, more for further (free in creative). Then be <b>stood on t&rsquo; platform when she calls</b> &mdash; t&rsquo; board says how long. She waits half a minute at each stop, doors open.</li>
<li>Aboard, tha gets a <b>window seat</b> &mdash; watch t&rsquo; dales an&rsquo; embankments roll by. She&rsquo;ll set thee down at thi stop wi&rsquo; a whistle.</li>
<li>Miss her an&rsquo; thi fare comes back. Stations are <b>safe, lit ground</b> at neet an&rsquo; all.</li>
<li>It&rsquo;s t&rsquo; fastest way across t&rsquo; map by far &mdash; an&rsquo; t&rsquo; bonniest.</li>
<li><b>Folk ride wi&rsquo; thee.</b> Locals get on at t&rsquo; platforms an&rsquo; tek a seat in thi carriage &mdash; <b>right-click one for a natter</b>. They&rsquo;ll share t&rsquo; news, a tip worth knowin&rsquo;, an&rsquo; now an&rsquo; then a <b>parcel to run</b> to their stop for a bit o&rsquo; coal.</li>
</ul>
<h3>Drive her thissen &#128642;</h3>
<ul>
<li>When she&rsquo;s <b>stood at thi platform</b>, t&rsquo; board offers <b>&ldquo;Take the regulator&rdquo;</b> &mdash; climb on t&rsquo; footplate an&rsquo; drive her thissen.</li>
<li><b>W</b> opens t&rsquo; regulator (faster), <b>S</b> or <b>space</b> brakes, <b>R</b> throws t&rsquo; reverser to back her up. <b>E</b> brings her to a stand an&rsquo; gets thee down.</li>
<li><b>Fire t&rsquo; boiler.</b> Watch t&rsquo; steam gauge &mdash; <b>F shovels coal</b> on t&rsquo; fire to keep her pressed up. Let t&rsquo; fire die an&rsquo; she&rsquo;ll not pull. A long climb&rsquo;s a proper job.</li>
<li><b>Goods runs.</b> At a station, <b>load a wagon</b> (or tek a passenger&rsquo;s parcel) bound for another stop; drive her there an&rsquo; <b>step down for coal</b>.</li>
</ul>`,

      'Ponies': `
<h3>Moorland ponies &#128052;</h3>
<p>Half-wild ponies graze t&rsquo; open moor &mdash; shaggy, dark, sure-footed little things. They&rsquo;ll let a body up.</p>
<ul>
<li><b>Find one grazin&rsquo;</b> out on t&rsquo; heather, walk up to her, an&rsquo; <b>right-click to climb on.</b></li>
<li><b>W A S D</b> to ride &mdash; she fair shifts, near twice walkin&rsquo; pace, an&rsquo; she&rsquo;ll <b>leap a low wall hersen</b>, no need to jump. Grand for crossin&rsquo; t&rsquo; tops.</li>
<li><b>F</b> to get down. She&rsquo;ll graze where tha left her till tha wants her again.</li>
<li>She sits &rsquo;twixt shanks&rsquo;s pony an&rsquo; t&rsquo; railway: quicker than walkin&rsquo;, an&rsquo; free to roam where no rails run.</li>
</ul>`,

      'Craft & Cook': `
<h3>Crafting</h3>
<ul>
<li>Press <b>E</b>: simple recipes (planks, sticks, bench, thatch) craft owt where. Owt serious needs thee <b>stood near a joiner&rsquo;s bench</b>.</li>
<li>Key recipes: pick/axe/spade/sword in wood, gritstone an&rsquo; iron &middot; <b>range</b> (8 cobble) &middot; <b>lantern</b> (ingot + coal) &middot; dressed stone (4 gritstone) &middot; thatch (4 bracken) &middot; windows for thi cottage.</li>
<li>There&rsquo;s a free bench an&rsquo; range in t&rsquo; pub &mdash; T&rsquo; Black Sheep, west side o&rsquo; t&rsquo; green.</li>
</ul>
<h3>T&rsquo; Range (cooking an&rsquo; smelting)</h3>
<ul>
<li>Right-click a range. <b>Stoke t&rsquo; firebox first</b>: coal&rsquo;s worth 4 goes, a peat block 1 go.</li>
<li>Then: ironstone &rarr; <b>iron ingots</b> &middot; raw mutton &rarr; <b>roast mutton</b> (best scran going) &middot; grouse roasts likewise &middot; cobble fires back to gritstone.</li>
</ul>
<h3>Building &mdash; thi own croft</h3>
<ul>
<li>T&rsquo; <b>owd croft</b> at t&rsquo; south-east corner o&rsquo; t&rsquo; green (marked wi&rsquo; posts an&rsquo; a gravel edge) is <b>thine</b>. Build thissen a cottage: <b>walls</b> (stone, planks, owt solid) &rarr; a <b>thatch roof</b> &rarr; a <b>window, a lantern, an&rsquo; a bench or range</b> inside.</li>
<li>T&rsquo; village watches thi progress &mdash; folk talk about it, thi standing rises wi&rsquo; every stage, an&rsquo; finishing it earns thee a proper <b>housewarming</b>, gifts an&rsquo; all.</li>
<li>Villagers also offer <b>building commissions</b> &mdash; a lambing shed for James, a garden wall for Glinda &mdash; materials placed at a marked spot, paid fair.</li>
<li>Build owt else tha likes on t&rsquo; open moor &mdash; just <b>not through folk&rsquo;s houses</b>, unless tha fancies being t&rsquo; talk o&rsquo; t&rsquo; parish.</li>
</ul>`,

      'T\u2019 Land': `
<h3>Reading t&rsquo; moors</h3>
<ul>
<li>T&rsquo; HUD names where tha stands &mdash; high moors, dales (Rosedale, Farndale, Bilsdale...), May Moss, t&rsquo; coast. T&rsquo; minimap shows t&rsquo; lie o&rsquo; t&rsquo; land, north up.</li>
<li><b>T&rsquo; high moor</b>: a sea o&rsquo; heather, blanket bog, moor crosses, owd stone circles. <b>T&rsquo; dales</b>: becks, woods, walled pasture. <b>North</b>, past Wade&rsquo;s Causey, t&rsquo; land ends in cliffs ower t&rsquo; North Sea.</li>
</ul>
<h3>Landmarks worth t&rsquo; trek</h3>
<ul>
<li><b>Roseberry Topping</b> (far SW) &mdash; t&rsquo; lonely crooked peak. Summat lives up there, they say.</li>
<li><b>The Wainstones</b> (SW) &mdash; a crag o&rsquo; jumbled stones on t&rsquo; ridge.</li>
<li><b>T&rsquo; Hole of Horcum</b> (NE) &mdash; a giant&rsquo;s handful scooped out o&rsquo; t&rsquo; moor.</li>
<li><b>Rosedale Ironstone Kilns</b> (SE) &mdash; stone arches wi&rsquo; an ember as never dies. Rich iron seams nearby.</li>
<li><b>Wade&rsquo;s Causey</b> &mdash; t&rsquo; owd Roman road, running straight ower t&rsquo; tops.</li>
<li><b>Moor crosses</b> &mdash; waymarks on t&rsquo; high moor. One&rsquo;s painted white: say hello to <b>Fat Betty</b>, and mebbe leave her summat.</li>
<li><b>T&rsquo; Abbey</b> (far N, on t&rsquo; cliffs) &mdash; a drowned-voiced ruin ower t&rsquo; sea. A <b>holy water font</b> still glimmers in t&rsquo; nave.</li>
<li><b>Whitby</b> (below t&rsquo; abbey) &mdash; harbour, pier, fish &amp; chip shop, fossil shop, an&rsquo; t&rsquo; <b>Dracula Museum</b>. Right-click t&rsquo; museum boards to enter.</li>
<li><b>Robin Hood&rsquo;s Bay</b> (NE coast) &mdash; a sweeping bay wi&rsquo; broad <b>beaches</b>. <b>Dig t&rsquo; sand</b> for fossils: ammonites (snakestones), Devil&rsquo;s Toenails, an&rsquo; now an&rsquo; then washed-up jet. T&rsquo; bay sands are twice as rich as owt else. Harry an&rsquo; Glinda trade for fossils, an&rsquo; Harry treasures a gifted ammonite above all else.</li>
<li><b>T&rsquo; tide minds t&rsquo; beaches</b>: owt dug or built on t&rsquo; sands smooths back ower in a few minutes &mdash; t&rsquo; fossil grounds can&rsquo;t be ruined, so dig wi&rsquo; a clear conscience (just don&rsquo;t build thi house on &rsquo;em).</li>
<li>Other settlements stand across t&rsquo; moors: <b>Goathland</b>, <b>Rosedale Abbey</b>, <b>Staithes</b> on t&rsquo; clifftop, <b>Grosmont</b> in t&rsquo; valley, an&rsquo; <b>Pickering</b> t&rsquo; capital, minster, market an&rsquo; all. All safe ground, all lived in &mdash; an&rsquo; all on or near t&rsquo; railway.</li>
</ul>
<p class="how-note">A full day on t&rsquo; moors is <b>half an hour</b>. Thi world saves itsen every half-minute, in this browser. &ldquo;Carry On&rdquo; picks up where tha left off.</p>`,

      'Merlin': `
<h3>Merlin, t&rsquo; wizard o&rsquo; t&rsquo; moor</h3>
<p>A glowin&rsquo; owd wizard walks these moors &mdash; <b>beard, pointed hat an&rsquo; all</b>. He&rsquo;s a friend to every traveller, an&rsquo; he&rsquo;s in <b>every world</b>, t&rsquo; bairns&rsquo; included.</p>
<ul>
<li><b>Call him by name.</b> Press <b>T</b> to chat an&rsquo; say <b>&ldquo;Merlin&rdquo;</b> &mdash; he&rsquo;ll hear thee frae owt where on t&rsquo; map an&rsquo; <b>come straight to thee</b>. He can be in more than one place at once, so he&rsquo;ll never leave another soul waitin&rsquo;.</li>
<li><b>Then just natter.</b> Once he&rsquo;s wi&rsquo; thee tha needn&rsquo;t say his name again &mdash; talk on an&rsquo; he&rsquo;ll answer, an&rsquo; he walks alongside thee as tha goes. He knows t&rsquo; lie o&rsquo; t&rsquo; land, what&rsquo;s in thi pack, how far tha&rsquo;s come, an&rsquo; where t&rsquo; ore an&rsquo; t&rsquo; folk are.</li>
<li><b>He&rsquo;ll lead thee.</b> Ask <i>&ldquo;take me to Goathland&rdquo;</i>, <i>&ldquo;where&rsquo;s t&rsquo; iron?&rdquo;</i>, <i>&ldquo;lead me to thi keep&rdquo;</i> or <i>&ldquo;where should I build?&rdquo;</i> an&rsquo; he&rsquo;ll <b>set off walkin&rsquo;</b> &mdash; follow him. Ower far to walk, an&rsquo; he&rsquo;ll point thee t&rsquo; way.</li>
<li><b>He&rsquo;ll help thee build.</b> <i>&ldquo;Mark me a plot&rdquo;</i> an&rsquo; he lanterns out a building spot; <i>&ldquo;lay me a foundation&rdquo;</i> an&rsquo; he sets thee a dressed-stone footing to build up frae.</li>
</ul>
<h3>Merlin&rsquo;s magic &#10024;</h3>
<p>He&rsquo;s a <b>true wizard</b>: <b>fetch him t&rsquo; right token</b>, carry it in thi pack, an&rsquo; ask him to <b>work some magic</b>. He&rsquo;ll conjure it up beside thee:</p>
<ul>
<li><b>Whitby jet</b> &rarr; a <b>Circle of Light</b> &mdash; a warding ring o&rsquo; lanterns to keep t&rsquo; dark off.</li>
<li><b>Holy water</b> &rarr; a <b>Wayside Shrine</b> &mdash; a lit stone cross on hallowed ground.</li>
<li><b>An iron ingot</b> &rarr; a <b>Standing Stone</b> &mdash; a lit waymark on t&rsquo; moor.</li>
<li><b>Coal</b> &rarr; a <b>Beacon</b> &mdash; a fire burnin&rsquo; atop a stone tower.</li>
<li><b>A snakestone</b> (ammonite, or a Devil&rsquo;s toenail) &rarr; a <b>Stone Causeway</b> &mdash; a paved path frae t&rsquo; livin&rsquo; rock.</li>
<li><b>T&rsquo; Amulet o&rsquo; t&rsquo; Moors</b> &rarr; a <b>great Monument</b> &mdash; a lit obelisk ringed wi&rsquo; standin&rsquo; stones, for them as finish t&rsquo; quest.</li>
</ul>
<p class="how-note">Ask him empty-handed an&rsquo; he&rsquo;ll tell thee which token works which spell. He keeps thi token &mdash; t&rsquo; magic nobbut borrows its power.</p>`,
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
    for (const s of [this.titleScreen, this.pauseScreen, this.howScreen, this.deathScreen, this.invScreen, this.rangeScreen, this.loadingScreen, this.chatScreen, this.boardScreen, this.museumScreen]) {
      s.classList.add('hidden');
    }
    if (name) this[name].classList.remove('hidden');
    this.hud.classList.toggle('hidden', name === 'titleScreen' || name === 'loadingScreen');
  }

  // hidden on t' bairns' world so survival actually holds; shown everywhere else
  setCreativeButtonVisible(show) {
    if (this.btnCreative) this.btnCreative.style.display = show ? '' : 'none';
  }

  // ============ villager chat ============
  openChat(villager, playerHasName) {
    this.chatVillager = villager;
    this.chatName.textContent = villager.displayName;
    this.chatTier.textContent = villager.charId ? (villager.tier ? `(${villager.tier})` : '') : '(t\u2019 brain\u2019s asleep)';
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
        v.charId ? `${v.displayName} looks up as tha comes ower.` :
          'T&rsquo; village brain in&rsquo;t running &mdash; start <i>run_v2.bat</i> in yorkshire_bot and they&rsquo;ll find their tongues.');
    }
    for (const m of v.chatLog) {
      const cls = m.who === 'you' ? 'you' : m.who === 'sys' ? 'sys' : 'them';
      const who = m.who === 'you' ? 'Thee' : m.who === 'sys' ? '' : v.displayName;
      this.el('div', 'chat-msg ' + cls, this.chatMsgs, (who ? `<b>${who}:</b> ` : '') + m.text);
    }
    if (this.chatWaiting) this.el('div', 'chat-msg them thinking', this.chatMsgs, `<b>${v.displayName}</b> is thinking...`);
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
    for (const t of q.tradesFor(v.t.name)) {
      const label = `${t.give[1]}\u00d7 ${itemName(t.give[0])} \u2192 ${t.get[1]}\u00d7 ${itemName(t.get[0])}`;
      const b = this.el('button', 'mc chat-btn trade-btn' + (t.unlocked ? '' : ' locked'), this.chatQuestRow, label);
      if (t.unlocked) {
        b.addEventListener('click', () => {
          if (q.doTrade(t)) {
            v.chatLog.push({ who: 'sys', text: `Swapped: ${label}.` });
            this.renderChatLog();
          }
        });
      } else {
        this.bindTooltip(b, 'Tha needs better standing in t\u2019 village for this swap.');
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
      (q.shame > 0 ? ` &mdash; <span style="color:#d87a5a">but tha&rsquo;s in folk&rsquo;s bad books (${q.shame}). Good deeds&rsquo;ll mend it.</span>` : ''));

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
    this.seedInput.classList.toggle('hidden', !loggedIn);
    this.btnNew.classList.toggle('hidden', !loggedIn);
    this.btnShared.classList.toggle('hidden', !loggedIn);
    this.btnContinue.classList.toggle('hidden', !loggedIn);
    this.whoBox.classList.toggle('hidden', !loggedIn);
    if (!loggedIn) return;
    if (auth.guest) {
      this.whoBox.innerHTML = 'Passing through as <b>a rambler</b> &mdash; <u id="swap-user">got an invite?</u>';
      document.getElementById('swap-user').onclick = () => this.game.logout();
      return;
    }
    const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const roster = (this.game.loadAccounts ? this.game.loadAccounts() : []).filter(a => a.acct !== auth.acct);
    let html = `Welcome back, <b>${esc(auth.name)}</b>`;
    if (roster.length) {
      html += '<div class="who-switch"><span class="lbl">play as:</span>' + roster.map(a =>
        `<button class="who-chip" data-acct="${esc(a.acct)}">${esc(a.name)}</button>` +
        `<button class="who-forget" data-forget="${esc(a.acct)}" title="forget this un">&times;</button>`
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

    // air bubbles
    const showAir = survival && player.air < 10;
    this.airRow.style.visibility = showAir ? 'visible' : 'hidden';
    if (showAir) {
      for (let i = 0; i < 10; i++) this.bubbles[i].style.visibility = player.air > i ? 'visible' : 'hidden';
    }

    this.vignette.style.opacity = Math.min(1, Math.max(0, player.hurtFlash * 2));

    if (this.invDirty) { this.renderHotbar(player); this.invDirty = false; }

    const px = Math.floor(player.pos.x), py = Math.floor(player.pos.y), pz = Math.floor(player.pos.z);
    // t' Great Fog takes thi bearings wi' it: no place name, no coordinates
    if (sky.moorFog > 0.6) {
      this.mapInfo.innerHTML =
        `<span style="color:#9aa0a8">Lost in t&rsquo; fog</span><br>` +
        `?, ?, ?<br>Day ${sky.day} &mdash; ${sky.timeName()}` +
        (player.creative ? '<br><span style="color:#d8b95a">Creative</span>' : '');
      return;
    }
    const loc = this.game.world ? this.game.world.gen.geo.locationName(px, pz) : '';
    this.mapInfo.innerHTML =
      `<span style="color:#d8b95a">${loc}</span><br>` +
      `${px}, ${py}, ${pz}<br>Day ${sky.day} &mdash; ${sky.timeName()}` +
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
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    const note = (x, z) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); };
    for (const v of geo.villages) note(v.x, v.z);
    for (const s of geo.railway()) note(s.x, s.z);
    for (const [x, z] of [[-700, -880], [540, 680], [-380, -620], [-260, 380], [CASTLE.x, CASTLE.z]]) note(x, z);
    note(player.pos.x, player.pos.z);
    // North is +x (up). The North Sea lies off +x, so pad there (the top).
    minX -= 140; maxX += 200; minZ -= 140; maxZ += 140;
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
    const path = geo.railPath().pts;                                    // t' railway
    b.lineJoin = 'round';
    b.strokeStyle = '#1c1c1c'; b.lineWidth = 4; b.beginPath();
    path.forEach((pt, i) => { const X = w2x(pt.x, pt.z), Y = w2y(pt.x, pt.z); i ? b.lineTo(X, Y) : b.moveTo(X, Y); }); b.stroke();
    b.strokeStyle = '#cbb784'; b.lineWidth = 1.4; b.stroke();
    for (const st of geo.railway()) {                                   // stations
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
    b.fillStyle = '#a59c8c'; b.font = 'italic 11px sans-serif';         // landmarks
    for (const [label, x, z] of [['Roseberry Topping', -700, -880], ['Hole of Horcum', 540, 680], ['Wainstones', -380, -620], ['Rosedale Kilns', -260, 380], ['Whitby Abbey', geo.abbeySite().x, geo.abbeySite().z], ["Merlin's Keep", CASTLE.x, CASTLE.z]]) {
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
    const X = w2x(player.pos.x, player.pos.z), Y = w2y(player.pos.x, player.pos.z);  // thee
    ctx.save(); ctx.translate(X, Y); ctx.rotate(-player.yaw - Math.PI / 2);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
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
    this.mapOverlay.classList.remove('hidden');
  }

  hideBigMap() { this.mapOverlay.classList.add('hidden'); }

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
    this.btnRangeClose.addEventListener('mousedown', () => this.game.closeScreens());
    this.show('rangeScreen');
  }

  showDeath(cause) {
    this.deathCause.textContent = cause;
    this.show('deathScreen');
  }
}
