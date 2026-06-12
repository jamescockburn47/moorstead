// Genuine North York Moors & Yorkshire lore, matched to who'd actually know it.
// Woven into villager prompts only when t' conversation or t' player's current
// whereabouts make it natural — never a lecture.
//
// holders: which villagers know it (name fragments)
// near: surfaces more readily when t' player's been near this landmark/region
// kid: true = the holder half-understands it and retells it like a child

export const LORE = [
  // ---- James: sheep, walls, weather, t' working moor ----
  {
    holders: ['james'], near: null,
    text: 'Swaledale sheep are "hefted" — each ewe learns her own patch of open moor from her mother and passes it down, so flocks keep to their ground without a fence in sight. A hefted flock is sold with the land because it cannot be replaced.',
  },
  {
    holders: ['james'], near: null,
    text: 'A drystone wall has no mortar in it: two faces of stone leaning into each other, small fill packed between, long "throughstones" tying both sides, and big "cam" stones on top. Built right, it stands two hundred years; built wrong, two winters.',
  },
  {
    holders: ['james'], near: null,
    text: 'The heather is burned in small patches in winter — "swiddening" — so there is always young growth for sheep and grouse to eat next to older deep heather for nesting. The patchwork you see on the moor is made deliberately.',
  },
  {
    holders: ['james', 'karen'], near: null,
    text: 'When the curlews come back up from the coast to nest on the moor, that is the true start of spring — their bubbling call over the heather. Farmers say you lamb when the curlew calls.',
  },
  // ---- Glinda: folklore, history, the old ways ----
  {
    holders: ['glinda'], near: null,
    text: 'The barghest is the great black hound of Yorkshire — a phantom dog with eyes like burning coals that walks the lonely roads at night. To see it plain is an omen of death; the old folk would not name it after dark.',
  },
  {
    holders: ['glinda'], near: 'betty',
    text: 'Fat Betty is a real white-painted stone cross on Danby High Moor, stood there nine hundred years. The custom is to leave a coin or a bit of food on her for the next traveller in need, and take a blessing in return. Folk still do it.',
  },
  {
    holders: ['glinda'], near: 'road',
    text: 'Wade\u2019s Causeway, the old paved road over Wheeldale Moor, was said to be built by Wade the giant so his wife Bell could cross the bog to milk her giant cow. Bell carried the stones in her apron — where the strings broke, the stray boulders lie yet. The learned say it is Roman. The learned were not there.',
  },
  {
    holders: ['glinda'], near: 'abbey',
    text: 'When the abbey on the cliffs was pulled down in old King Henry\u2019s time, folk swore they could still hear its bells ring under the sea on rough nights. At Whitby they say the same of theirs to this day.',
  },
  {
    holders: ['glinda'], near: 'whitby',
    text: 'Bram Stoker never lived here, but he stayed in Whitby in the summer of 1890 and walked the abbey steps, the churchyard, and the harbour in fog. From that holiday he wrote Count Dracula \u2014 and Whitby has never quite shaken the story off.',
  },
  {
    holders: ['glinda'], near: 'whitby',
    text: 'The Dracula Experience in Whitby tells how Stoker braided real places into fiction: the 199 Steps, the Demeter wrecked below the East Cliff, jet workshops, sea-haar. Fiction \u2014 but folk out on the moors still swear they feel watched on certain nights.',
  },
  {
    holders: ['glinda'], near: null,
    text: 'The Lyke Wake Dirge is the old song sung over the dead in these parts — the soul must cross Whinny Moor barefoot through the prickles, and if you ever gave shoes to a beggar in life, shoes you shall have for the crossing. Be charitable; the moor remembers.',
  },
  {
    holders: ['glinda'], near: 'kilns',
    text: 'Whitby jet is found in the cliffs and the deep seams hereabouts — it is the wood of ancient trees turned to black stone over millions of years. When Queen Victoria mourned her Albert, all England wore Whitby jet, and the town grew rich carving it.',
  },
  // ---- Harry: mines, industry, boyish wonders ----
  {
    holders: ['harry'], near: 'kilns',
    text: 'Rosedale was iron country! Thousands of miners, and a railway built right over the top of the moor to carry the ironstone away. The great kilns roasted the stone to make it lighter to haul. When the iron ran out, the moor took it all back.',
  },
  {
    holders: ['harry'], near: null, kid: true,
    text: 'Jet — the black shiny stuff — is actually TREES. Monkey-puzzle trees from millions and millions of years ago, squashed flat under the sea till they went black and hard. You can find it in the deepest seams. Trees! Honest!',
  },
  {
    holders: ['harry'], near: null, kid: true,
    text: 'Adders live on the moor — real venomous snakes, England\u2019s only ones! They bask on the warm stones in the morning. Dad says leave them be and they leave you be.',
  },
  // ---- Karen: wildlife, growing things ----
  {
    holders: ['karen'], near: null, kid: true,
    text: 'The red grouse shouts "go-back, go-back, go-back!" when you walk through the heather — it lives nowhere in the world except British moors like ours. Nowhere!',
  },
  {
    holders: ['karen'], near: null, kid: true,
    text: 'Bilberries are the little wild blueberries that grow under the heather — round here some folk call them whinberries. Picking enough for one pie takes all afternoon and your fingers go purple for two days.',
  },
  {
    holders: ['karen'], near: null,
    text: 'There are three heathers on the moor, not one: ling with the tiny pink flowers, bell heather all crimson on the dry banks, and cross-leaved heath down in the wet bits. When they all bloom in August the whole moor goes purple at once.',
  },
  // ---- cc: gloriously garbled toddler versions ----
  {
    holders: ['cc'], near: 'road', kid: true,
    text: 'Wade were a GIANT and his wife carried all the rocks in her PINNY and that is why the road is there. And they had a giant COW. (This is your favourite fact and you are completely right about it.)',
  },
  {
    holders: ['cc'], near: 'betty', kid: true,
    text: 'The white lady on the moor eats pennies. You give her a penny and she does magic for you. Karen says she is a cross but you know she is a lady.',
  },
  {
    holders: ['cc'], near: null, kid: true,
    text: 'The black shiny stone is a tree that went to sleep a MILLION years ago and if you find one you can wish on it. Sparkle telled you.',
  },
  {
    holders: ['glinda'], near: 'abbey',
    text: 'Ammonites are "snakestones" hereabouts: the tale is that St Hilda of Whitby turned a plague of snakes to stone and flung them off the cliff, which is why they lie curled on the shore. Carvers used to cut snake heads onto them for the visitors.',
  },
  {
    holders: ['harry'], near: null, kid: true,
    text: 'The beaches by Robin Hood\u2019s Bay are FULL of fossils \u2014 ammonites curled up like catherine wheels, and Devil\u2019s Toenails which are really ancient oysters, and if you\u2019re dead lucky, jet! You just dig in the sand after a storm!',
  },
  // ---- shared / general ----
  {
    holders: ['james', 'glinda'], near: 'bog',
    text: 'The blanket bog on the tops is thousands of years deep in peat — it holds the rain like a sponge and keeps the becks running all summer. Step where the cotton-grass grows and you may go in to your waist; the moor has swallowed sheep, and worse.',
  },
  {
    holders: ['glinda', 'james'], near: 'roseberry',
    text: 'Roseberry Topping had a perfect cone until 1912, when the old ironstone workings underneath collapsed and took half the summit face with it — that is how it got its crooked tooth shape. Folk hereabouts call it Yorkshire\u2019s Matterhorn.',
  },
  {
    holders: ['glinda'], near: 'horcum',
    text: 'The Hole of Horcum they call the Devil\u2019s Punchbowl — scooped out, the story goes, by Wade the giant grabbing a fistful of earth to throw at his wife in a quarrel. He missed. The clod he threw stands away to the east as a hill of its own.',
  },
];

// Pick up to `count` lore entries for this villager, preferring owt relevant
// to where t' player is or what they're hunting. Deterministic per day so a
// villager doesn't shuffle facts mid-conversation.
export function loreFor(name, count, { day = 1, nearTags = [], seed = 0 } = {}) {
  const n = (name || '').toLowerCase();
  const mine = LORE.filter(l => l.holders.some(h => n.includes(h)));
  if (!mine.length) return [];
  const relevant = mine.filter(l => l.near && nearTags.includes(l.near));
  const rest = mine.filter(l => !relevant.includes(l));
  // rotate t' general pool by day so chats stay fresh
  const offset = (day * 7 + seed + n.length * 3) % Math.max(1, rest.length);
  const rotated = rest.slice(offset).concat(rest.slice(0, offset));
  return relevant.concat(rotated).slice(0, count);
}
