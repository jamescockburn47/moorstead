// All DOM UI: title, HUD, inventory/crafting/smelting, chat, quests, pause, death, minimap, toasts.
import { B, I, RECIPES, SMELTS, FUELS, FOODS, TOOLS, itemName, maxStack, CREATIVE_ITEMS, CHUNK } from './defs.js';
import { getIconURL } from './textures.js';

const PIX = {
  heart: ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'],
  food: ['..XXX..', '.XXXXX.', '.XXXXX.', '..XXX..', '...BB..', '...BB..', '..BB...'],
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
    this.el('h1', 'title', this.titleScreen, 'MOORCRAFT');
    this.el('div', 'subtitle', this.titleScreen, 'A reet grand voxel adventure on t&rsquo; North York Moors');
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
    this.el('div', 'muted-note', this.titleScreen, 'Watch thissen at neet &mdash; t&rsquo; barghest walks when t&rsquo; sun goes down.');
    this.el('div', 'title-foot', this.titleScreen, 'Made wi&rsquo; nowt but procedural generation &mdash; not a single asset file');

    // ---------- pause ----------
    this.pauseScreen = this.el('div', 'overlay hidden', body);
    const pp = this.el('div', 'panel', this.pauseScreen);
    this.el('div', 'inv-title', pp, 'Hod On a Minute (Paused)');
    this.btnResume = this.el('button', 'mc', pp, 'Back to t&rsquo; Moor');
    this.btnSave = this.el('button', 'mc', pp, 'Save T&rsquo; World');
    this.btnCreative = this.el('button', 'mc', pp, 'Toggle Creative Mode');
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
<b>Ctrl</b> Leg it (sprint &mdash; burns hunger, outruns a barghest)<br>
<b>Space</b> Jump / swim up<br>
<b>Shift</b> Sneak &mdash; slow, but tha won&rsquo;t walk off edges<br>
<b>1&ndash;9 / mouse wheel</b> Pick hotbar slot<br>
<b>E</b> Thi pockets &mdash; inventory &amp; crafting<br>
<b>Q</b> Venture journal (same as t&rsquo; notice board)<br>
<b>M</b> Mute sound<br>
<b>Esc</b> Pause / close a screen<br>
<b>Space &times;2</b> Toggle flying (creative mode only)
</div>
<p class="how-note">Creative mode lives in t&rsquo; pause menu: fly, infinite blocks, instant digging, nowt can hurt thee.</p>`,

      'Staying Alive': `
<h3>Hearts, hunger an&rsquo; what kills thee</h3>
<ul>
<li><b>Hunger</b> drains as tha walks, sprints, jumps an&rsquo; digs. Below 6 drumsticks tha can&rsquo;t sprint; at nowt, tha starves down to half a heart. Eat wi&rsquo; right-click: bilberries (+3), raw mutton (+3), <b>roast mutton (+8)</b>, grouse. Cook on a range.</li>
<li><b>Health</b> heals on its own when tha&rsquo;s well fed (16+ hunger). Otherwise: eat, wait, or stay out o&rsquo; trouble.</li>
<li><b>Falling</b> hurts past 3 blocks. <b>Water</b>: tha can swim (Space), but air bubbles run out &mdash; surface afore they do.</li>
<li><b>Bogs</b> on t&rsquo; high moor are t&rsquo; dark pools in t&rsquo; peat. They grip thee, sink thee, and they&rsquo;re hungry. Skirt round, or sprint-jump if tha must.</li>
<li><b>Neet</b> belongs to t&rsquo; <b>barghest</b> (great black hound, eyes like coals) and <b>boggarts</b> (little horrors frae t&rsquo; mires). They walk frae dusk till dawn, out on t&rsquo; open moor only &mdash; <b>Moorstead ground is hallowed; nowt dark sets foot on it</b>. Tha can sprint faster than a barghest. Just.</li>
<li><b>Dark things fear flame.</b> Craft <b>torches</b> (1 stick + 1 coal = 4, no bench needed): a <b>placed</b> torch or lantern wards off all but t&rsquo; worst within ~9 blocks an&rsquo; stops owt rising nearby &mdash; plant a ring o&rsquo; them an&rsquo; camp anywhere. A torch <b>in thi hand</b> lights thi way an&rsquo; sees off boggarts, but a barghest&rsquo;s bolder than that.</li>
<li><b>Caught out at neet?</b> Stone <b>moor shelters</b> stand scattered across t&rsquo; tops, lantern-lit an&rsquo; safe. <b>Right-click any waymark signpost</b> &mdash; it&rsquo;ll tell thee t&rsquo; bearing an&rsquo; distance to t&rsquo; nearest shelter an&rsquo; back to Moorstead. Tha can craft thi own signposts (3 planks + 1 stick) to mark routes.</li>
<li><b>Dying</b> loses thee nowt &mdash; tha wakes on t&rsquo; green wi&rsquo; thi pockets intact.</li>
</ul>
<h3>Tools an&rsquo; digging</h3>
<ul>
<li>Tiers: <b>wood &rarr; gritstone &rarr; iron</b>. Better tools dig faster an&rsquo; last longer (watch t&rsquo; little durability bar).</li>
<li>Stone, ores an&rsquo; brick <b>need a pick</b> or tha gets nowt. Dirt an&rsquo; peat like a spade; trees like an axe; beasts respect a sword.</li>
<li>Ores: <b>coal</b> (shallow), <b>ironstone</b> (deeper &mdash; smelt to ingots), <b>Whitby jet</b> (deepest, rare, precious). Caves honeycomb t&rsquo; hills if tha&rsquo;s bold.</li>
</ul>`,

      'T\u2019 Village': `
<h3>T&rsquo; folk o&rsquo; Moorstead</h3>
<ul>
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
<p>A <b>separate</b> storyline, marked &#8224; in thi journal. Start at t&rsquo; <b>Dracula Experience museum in Whitby</b> (east coast, below t&rsquo; abbey cliffs). Learn how Bram Stoker&rsquo;s 1890 visit gave England its vampire; then draw <b>holy water</b> frae t&rsquo; abbey font, craft a <b>wooden stake</b> at a bench an&rsquo; steep it in t&rsquo; water. At neet, Count Dracula walks t&rsquo; open moor &mdash; tha&rsquo;ll <b>feel him afore tha sees him</b>. Hold t&rsquo; holy stake to strike true; hide in <b>moor shelters</b> or reach a village if tha must. Slaying him makes t&rsquo; moors <b>far safer after dark</b> &mdash; barghests still walk, but nowt worse.</p>`,

      'Craft & Cook': `
<h3>Crafting</h3>
<ul>
<li>Press <b>E</b>: simple recipes (planks, sticks, bench, thatch) craft owt where. Owt serious needs thee <b>stood near a joiner&rsquo;s bench</b>.</li>
<li>Key recipes: pick/axe/spade/sword in wood, gritstone an&rsquo; iron &middot; <b>range</b> (8 cobble) &middot; <b>lantern</b> (ingot + coal) &middot; dressed stone (4 gritstone) &middot; thatch (4 bracken) &middot; windows for thi cottage.</li>
<li>There&rsquo;s a free bench an&rsquo; range in t&rsquo; pub &mdash; T&rsquo; Black Sheep, north side o&rsquo; t&rsquo; green.</li>
</ul>
<h3>T&rsquo; Range (cooking an&rsquo; smelting)</h3>
<ul>
<li>Right-click a range. <b>Stoke t&rsquo; firebox first</b>: coal&rsquo;s worth 4 goes, a peat block 1 go.</li>
<li>Then: ironstone &rarr; <b>iron ingots</b> &middot; raw mutton &rarr; <b>roast mutton</b> (best scran going) &middot; grouse roasts likewise &middot; cobble fires back to gritstone.</li>
</ul>
<h3>Building &mdash; thi own croft</h3>
<ul>
<li>T&rsquo; <b>owd croft</b> at t&rsquo; south-west corner o&rsquo; t&rsquo; green (marked wi&rsquo; posts an&rsquo; a gravel edge) is <b>thine</b>. Build thissen a cottage: <b>walls</b> (stone, planks, owt solid) &rarr; a <b>thatch roof</b> &rarr; a <b>window, a lantern, an&rsquo; a bench or range</b> inside.</li>
<li>T&rsquo; village watches thi progress &mdash; folk talk about it, thi standing rises wi&rsquo; every stage, an&rsquo; finishing it earns thee a proper <b>housewarming</b>, gifts an&rsquo; all.</li>
<li>Villagers also offer <b>building commissions</b> &mdash; a lambing shed for James, a garden wall for Glinda &mdash; materials placed at a marked spot, paid fair.</li>
<li>Build owt else tha likes on t&rsquo; open moor &mdash; just <b>not through folk&rsquo;s houses</b>, unless tha fancies being t&rsquo; talk o&rsquo; t&rsquo; parish.</li>
</ul>`,

      'T\u2019 Land': `
<h3>Reading t&rsquo; moors</h3>
<ul>
<li>T&rsquo; HUD names where tha stands &mdash; high moors, dales (Rosedale, Farndale, Bilsdale...), May Moss, t&rsquo; coast. T&rsquo; minimap shows t&rsquo; lie o&rsquo; t&rsquo; land, north up.</li>
<li><b>T&rsquo; high moor</b>: a sea o&rsquo; heather, blanket bog, moor crosses, owd stone circles. <b>T&rsquo; dales</b>: becks, woods, walled pasture. <b>East</b>, past Wade&rsquo;s Causey, t&rsquo; land ends in cliffs ower t&rsquo; North Sea.</li>
</ul>
<h3>Landmarks worth t&rsquo; trek</h3>
<ul>
<li><b>Roseberry Topping</b> (far NW) &mdash; t&rsquo; lonely crooked peak. Summat lives up there, they say.</li>
<li><b>The Wainstones</b> (NW) &mdash; a crag o&rsquo; jumbled stones on t&rsquo; ridge.</li>
<li><b>T&rsquo; Hole of Horcum</b> (SE) &mdash; a giant&rsquo;s handful scooped out o&rsquo; t&rsquo; moor.</li>
<li><b>Rosedale Ironstone Kilns</b> (SW) &mdash; stone arches wi&rsquo; an ember as never dies. Rich iron seams nearby.</li>
<li><b>Wade&rsquo;s Causey</b> &mdash; t&rsquo; owd Roman road, running straight north ower t&rsquo; tops.</li>
<li><b>Moor crosses</b> &mdash; waymarks on t&rsquo; high moor. One&rsquo;s painted white: say hello to <b>Fat Betty</b>, and mebbe leave her summat.</li>
<li><b>T&rsquo; Abbey</b> (far E, on t&rsquo; cliffs) &mdash; a drowned-voiced ruin ower t&rsquo; sea. A <b>holy water font</b> still glimmers in t&rsquo; nave.</li>
<li><b>Whitby</b> (below t&rsquo; abbey) &mdash; harbour, pier, fish &amp; chip shop, fossil shop, an&rsquo; t&rsquo; <b>Dracula Experience museum</b>. Right-click t&rsquo; museum boards to enter.</li>
<li><b>Robin Hood&rsquo;s Bay</b> (SE coast) &mdash; a sweeping bay wi&rsquo; proper <b>beaches</b>. <b>Dig t&rsquo; sand</b> for fossils: ammonites (snakestones), Devil&rsquo;s Toenails, an&rsquo; now an&rsquo; then washed-up jet. T&rsquo; bay sands are twice as rich as owt else. Harry an&rsquo; Glinda trade for fossils, an&rsquo; Harry treasures a gifted ammonite above all else.</li>
<li>Other settlements stand across t&rsquo; moors: <b>Goathland</b>, <b>Rosedale Abbey</b>, <b>Staithes</b> on t&rsquo; clifftop, an&rsquo; <b>Pickering</b> t&rsquo; capital, minster, market an&rsquo; all. All safe ground.</li>
</ul>
<p class="how-note">Thi world saves itsen every half-minute, in this browser. &ldquo;Carry On&rdquo; picks up where tha left off.</p>`,
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
        `<div class="r-name"><b>\u2020 ${dracDef.title}</b><br><span class="r-needs">A separate mystery at t&rsquo; <b>Dracula Experience museum in Whitby</b> &mdash; right-click t&rsquo; museum boards by t&rsquo; harbour.</span></div>`);
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

  // ============ Dracula Experience museum ============
  openMuseum() {
    const q = this.game.quests;
    this.museumPanel.innerHTML = '';
    this.el('div', 'inv-title', this.museumPanel, 'Dracula Experience &mdash; Whitby');
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
    if (loggedIn) {
      this.whoBox.innerHTML = auth.guest
        ? 'Passing through as <b>a rambler</b> &mdash; <u id="swap-user">got an invite?</u>'
        : `Welcome back, <b>${auth.name}</b> &mdash; <u id="swap-user">not thee?</u>`;
      document.getElementById('swap-user').onclick = () => this.game.logout();
    }
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
    const span = size / scale;
    const px = Math.floor(player.pos.x), pz = Math.floor(player.pos.z);
    const img = ctx.createImageData(size, size);
    const d = img.data;
    let curKey = null, cols = null;
    for (let sy = 0; sy < span; sy++) {
      const wz = pz - (span >> 1) + sy;
      for (let sx = 0; sx < span; sx++) {
        const wx = px - (span >> 1) + sx;
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
    // player arrow
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(-player.yaw);
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
