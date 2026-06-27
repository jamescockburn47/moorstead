// Adventures on t' moors: a hand-crafted mystery arc, procedural errands,
// villager clues (kids blurt it out, elders talk in riddles), barter, and a
// reputation that can fall as well as rise.
import { B, I, itemName } from './defs.js';
import { mulberry32, hash2i } from './noise.js';
import { ROSEBERRY, WAINSTONES, KILNS, HORCUM, DRACULA_MOOR } from './geography.js';
import { loreFor } from './lore.js';
import * as npc from './npc.js';
import { buildActivityDigest } from './activity.js';

const STANDINGS = ['Newcomer', 'Known', 'Welcomed', 'Respected', 'Treasured'];
const STANDING_THRESHOLDS = [0, 5, 20, 50, 100];

export function compassDir(dx, dz) {
  // north is +x, east is +z (the map reads with Whitby/the coast at the top)
  const ang = Math.atan2(dz, dx) * 180 / Math.PI;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(((ang + 360) % 360) / 45) % 8];
}

// Nearest white moor cross (Fat Betty) to t' village — deterministic.
function findFatBetty(geo) {
  const cgx = Math.floor(geo.village.x / 96), cgz = Math.floor(geo.village.z / 96);
  for (let r = 0; r <= 8; r++) {
    for (let gx = cgx - r; gx <= cgx + r; gx++) {
      for (let gz = cgz - r; gz <= cgz + r; gz++) {
        if (Math.max(Math.abs(gx - cgx), Math.abs(gz - cgz)) !== r) continue;
        const c = geo.crossAt(gx, gz);
        if (c && c.fatBetty) return c;
      }
    }
  }
  // no white cross in range: settle for any cross
  for (let r = 0; r <= 8; r++) {
    for (let gx = cgx - r; gx <= cgx + r; gx++) {
      for (let gz = cgz - r; gz <= cgz + r; gz++) {
        const c = geo.crossAt(gx, gz);
        if (c) return c;
      }
    }
  }
  return { x: geo.village.x + 90, z: geo.village.z - 90, fatBetty: true };
}

// ---------------------------------------------------------------------------
// The arc: T' Hound o' the Mires (five chapters, told across the landmarks)
// ---------------------------------------------------------------------------
function buildArc(geo) {
  const betty = findFatBetty(geo);
  const diveX = Math.floor(geo.coastX(-60)) + 22;
  return {
    arc1: {
      id: 'arc1', giver: 'james', minStanding: 0, needs: null,
      title: 'Summat in t\u2019 Night',
      desc: 'A yow\u2019s been taken in t\u2019 night \u2014 nowt left but blood an\u2019 drag marks pointing south-west. Follow them to the Wainstones, after dark, an\u2019 see what tha finds.',
      offer: 'You can offer the visitor a job: one of your sheep was taken in the night, leaving only blood and drag marks heading south-west toward the jagged crags called the Wainstones. You want someone with nerve to follow the trail there AFTER DARK and see what did it. You will pay in good roast mutton.',
      steps: [
        { kind: 'visit', x: WAINSTONES.x, z: WAINSTONES.z, r: 15, night: true, effect: 'dropHide',
          objective: 'Reach the Wainstones at neet' },
      ],
      turnIn: 'james',
      truth: 'The taken-sheep matter is UNSOLVED. Nobody knows yet what did it; the visitor has agreed to follow the drag marks to the Wainstones after dark but has NOT yet reported back. Do not claim the mystery is solved.',
      doneNote: 'The visitor followed the trail to the Wainstones at night and brought you back a scrap of cold black hide. No natural dog, that. Granny Glinda took an interest.',
      reward: { items: [[I.COOKED_MUTTON, 5]], trust: [['james', 4]], text: 'James turns t\u2019 black hide scrap ower in his hands an\u2019 goes quiet. \u201cThat\u2019s no dog. Granny\u2019ll know more \u2014 talk to her.\u201d' },
      clues: [
        { holder: 'harry', text: 'Dad found blood by t\u2019 lambing pens! The drag marks went off south-west, toward them big jaggy stones \u2014 the Wainstones! Dead scary. Dead good.' },
        { holder: 'glinda', text: 'Where t\u2019 giant\u2019s teeth bite t\u2019 ridgeline south-west o\u2019 here, night shows what day hides. Go after dark, if tha must go at all.' },
      ],
    },
    arc2: {
      id: 'arc2', giver: 'glinda', minStanding: 0, needs: 'arc1',
      title: 'T\u2019 White Lady',
      desc: 'Granny Glinda reckons t\u2019 hide belongs to a barghest, an\u2019 the owd way to learn more is an offering: leave wool at t\u2019 white cross out on t\u2019 moor.',
      offer: 'You can offer the visitor the next step of the mystery: the black hide they found belongs to a barghest, a phantom hound of the moors. The old way to seek protection is to leave an offering of WOOL at the white-painted moor cross folk call Fat Betty. Tell them roughly which way she stands. You speak of this in riddles, as your granny did.',
      steps: [
        { kind: 'place', block: B.WOOL, n: 1, x: betty.x, z: betty.z, r: 4, effect: 'dropAmuletL',
          objective: 'Leave a wool block at t\u2019 white cross (Fat Betty)' },
      ],
      turnIn: 'glinda',
      truth: 'The wool offering has NOT yet been left at the white cross, and you do NOT have any amulet or amulet half. The visitor is still on the errand.',
      doneNote: 'The visitor left the offering at Fat Betty and brought back HALF an old amulet. You told them the other half went to the Rosedale ironstone men years back.',
      reward: { items: [[I.BILBERRIES, 6]], trust: [['glinda', 4]], text: '\u201cHalf an amulet,\u201d Glinda says, squinting at it. \u201cT\u2019 other half went to t\u2019 ironstone men o\u2019 Rosedale, years back. Ask t\u2019 lad \u2014 he knows t\u2019 mines.\u201d' },
      clues: [
        { holder: 'cc', text: 'T\u2019 white lady! She\u2019s a big white cross on t\u2019 moor an\u2019 if you leave her presents she keeps t\u2019 monsters away! Wool! She likes wool!' },
        { holder: 'karen', text: 'Granny calls it Fat Betty \u2014 a moor cross painted all white. Folk have left offerings on her for hundreds o\u2019 years, honest.' },
      ],
      bettyPos: betty,
    },
    arc3: {
      id: 'arc3', giver: 'harry', minStanding: 2, needs: 'arc2',
      title: 'Deep Seams',
      desc: 'T\u2019 other half o\u2019 t\u2019 amulet went to t\u2019 Rosedale ironstone men. Mine three pieces o\u2019 Whitby jet from t\u2019 deep seams, then tek \u2019em to t\u2019 owd kilns \u2014 an ember still burns there.',
      offer: 'You can offer the visitor the next step: the other half of the old amulet was traded to the Rosedale ironstone miners long ago. The way to call it back is to bring THREE pieces of Whitby jet (mined from the deepest seams, far underground) to the old ironstone kilns in Rosedale, where an ember still burns. You think this is the most exciting thing that has ever happened.',
      steps: [
        { kind: 'collect', item: I.JET_GEM, n: 3, objective: 'Mine 3 Whitby jet from t\u2019 deep seams' },
        { kind: 'visit', x: KILNS.x, z: KILNS.z, r: 10, requireItem: I.JET_GEM, effect: 'dropAmuletR',
          objective: 'Carry t\u2019 jet to t\u2019 Rosedale kilns' },
      ],
      turnIn: 'harry',
      truth: 'The visitor is still out mining jet and has NOT yet taken it to the kilns. The second amulet half has NOT been recovered. Do not claim otherwise.',
      doneNote: 'The visitor fed three pieces of jet to the kiln ember and the OTHER half of the amulet came back. The most exciting thing that has ever happened, in your opinion.',
      reward: { items: [[I.S_PICK, 1]], trust: [['harry', 4]], text: 'Harry\u2019s eyes are like dinner plates. \u201cTha\u2019s really doing it! Tha needs t\u2019 bell next \u2014 ask our cc, she keeps hearing it. Honest, she does.\u201d' },
      clues: [
        { holder: 'james', text: 'Jet\u2019s only found reet deep \u2014 below where t\u2019 ironstone runs. Tek a good pick an\u2019 plenty o\u2019 lanterns, and mind t\u2019 owd workings.' },
        { holder: 'glinda', text: 'T\u2019 fire that fed on stone still sleeps in Rosedale. Feed it black gold thrice ower, an\u2019 it\u2019ll wake what were given.' },
      ],
    },
    arc4: {
      id: 'arc4', giver: 'cc', minStanding: 2, needs: 'arc3',
      title: 'T\u2019 Drowned Bell',
      desc: 'cc swears she hears a bell ringing under t\u2019 sea when t\u2019 wind blows past t\u2019 broken abbey. An amulet wants a tongue: dive to t\u2019 sea floor off t\u2019 abbey cliffs an\u2019 find it.',
      offer: 'You can offer the visitor your very important secret: when the wind blows at the broken church by the big water (the abbey on the cliffs, far to the north), you can hear a bell go BONG under the sea. Sparkle says the bell\u2019s tongue fell in the water and somebody brave has to dive ALL the way down and get it. You are extremely sure about this.',
      steps: [
        { kind: 'visit', x: diveX, z: -60, r: 16, maxY: 21, effect: 'dropBell',
          objective: 'Dive to t\u2019 sea floor off t\u2019 abbey cliffs' },
      ],
      turnIn: 'cc',
      truth: 'CRITICAL FACT: the bell tongue is STILL at the bottom of the sea by the broken church. You do NOT have it; nobody has fetched it yet. The visitor said they would dive for it and you are bursting with anticipation.',
      doneNote: 'The visitor dived ALL the way down and fetched the bell\u2019s iron tongue, just like you said they should. You were RIGHT about the bell and everyone knows it now.',
      reward: { items: [[I.BILBERRIES, 4]], trust: [['cc', 4]], text: 'cc gasps so hard she nearly falls ower. \u201cTHE BELL TONGUE! Now make t\u2019 necklace an\u2019 bonk t\u2019 big doggy! Daddy knows where it lives.\u201d' },
      clues: [
        { holder: 'karen', text: 'cc keeps saying she hears a bell under t\u2019 sea by t\u2019 abbey. She\u2019s three, so... but she\u2019s been right before. It\u2019s a long old trek north, past t\u2019 causey, right to t\u2019 cliffs.' },
        { holder: 'glinda', text: 'When t\u2019 abbey drowned its voice, t\u2019 sea kept t\u2019 tongue. What rings beneath t\u2019 cliffs wants fetching up by a breath that dares run out.' },
      ],
    },
    arc5: {
      id: 'arc5', giver: 'james', minStanding: 3, needs: 'arc4',
      title: 'T\u2019 Hound at Bay',
      desc: 'Forge t\u2019 Amulet o\u2019 t\u2019 Moors at a joiner\u2019s bench \u2014 both halves, t\u2019 bell clapper, an\u2019 a jet. Then climb Roseberry Topping at neet an\u2019 face t\u2019 Great Barghest itself.',
      offer: 'You can offer the visitor the final task: with both amulet halves, the bell clapper and a piece of jet, they can forge the Amulet of the Moors at a joiner\u2019s bench. Then they must climb Roseberry Topping \u2014 the lone crooked peak far to the south-west \u2014 AT NIGHT, and face the Great Barghest that has been taking your sheep. You are deadly serious, and you tell them the whole village is behind them.',
      steps: [
        { kind: 'collect', item: I.AMULET, n: 1, objective: 'Forge t\u2019 Amulet o\u2019 t\u2019 Moors (bench: both halves + clapper + jet)' },
        { kind: 'kill', mob: 'greatbarghest', n: 1, spawnAt: { x: ROSEBERRY.x, z: ROSEBERRY.z, r: 20, night: true },
          objective: 'Face t\u2019 Great Barghest on Roseberry Topping, at neet' },
      ],
      turnIn: 'james',
      truth: 'The Great Barghest still walks Roseberry Topping at night and the flock is still in danger. The visitor has the task of forging the amulet and facing it, but has NOT yet done so. Do not celebrate early.',
      doneNote: 'The visitor forged the Amulet of the Moors, climbed Roseberry Topping at night, and SLEW the Great Barghest. The village turned out on the green for them. The sheep are safe at last.',
      reward: {
        items: [[I.JET_GEM, 3], [I.IRON_INGOT, 5], [I.COOKED_MUTTON, 8]],
        trust: [['james', 5], ['glinda', 5], ['harry', 5], ['karen', 5], ['cc', 5], ['max', 5]],
        text: 'Moorstead turns out on t\u2019 green for thee. James shakes thi hand like a pump handle. \u201cTha\u2019s freedom o\u2019 these moors now, as long as tha carries that amulet. Nowt dark\u2019ll come near thee.\u201d',
      },
      clues: [
        { holder: 'harry', text: 'T\u2019 big one lives on Roseberry Topping \u2014 that lonely pointy hill way off south-west! Dad says only go wi\u2019 t\u2019 amulet finished. An\u2019 at neet! It only comes out at neet!' },
        { holder: 'glinda', text: 'On t\u2019 crooked hill that stands alone, ring true an\u2019 stand thy ground. A hound fears nowt but a bell that\u2019s found its tongue.' },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// The arc: Count Dracula on t' Moors (separate mystery — Whitby to abbey to neet)
// Completing it makes t' open moor kinder after dark.
// ---------------------------------------------------------------------------
function buildDraculaArc(geo) {
  const museum = geo.museumSite();
  const font = geo.abbeyFont();
  // The moors world has no museum (museumSite() is off-map): the arc opens at the real
  // Whitby harbour, where the Demeter ran aground, told by a roster fishwife. The stylised
  // world keeps its museum opening untouched. drac1/drac2 branch on geo.realWorld below,
  // the same way cross/bess resolve per world. harbour is null only if Whitby is missing.
  const harbour = (geo.realWorld && geo.whitbyHarbour) ? geo.whitbyHarbour() : null;
  // The parson's moor cross — a real white moor cross (Lilla/Ralph/Fat Betty in the
  // real data; the nearest crossAt cross in the stylised world). findFatBetty resolves
  // in BOTH worlds (it falls back to a village-relative point when crossAt is null), so
  // dracA degrades gracefully exactly as museum/font do off-map.
  const cross = findFatBetty(geo);
  // Bess the herbwife's garden, at Lealholm. Lealholm is a real town in the moors data
  // (geo.villages by name); the stylised world has no Lealholm, so fall back to a point
  // just off the home green — keeping the visit-effect satisfiable in both worlds.
  const lealholm = (geo.villages || []).find(v => v.name === 'Lealholm');
  const bess = lealholm
    ? { x: lealholm.x + 6, z: lealholm.z + 6 }
    : { x: geo.village.x + 18, z: geo.village.z + 18 };
  // The Count's three boxes of Transylvanian earth, hidden about Whitby (Slice 2, dracC).
  // MOORS: three real, solid-ground, in-bounds points round the town + abbey churchyard
  // (probed: all coastT 0, within inWhitby). STYLISED: there is no Whitby town, so spread
  // three points round the museum site (still finite + reachable) — exactly how the arc's
  // other locations (cross/bess) degrade per world. Stoker's Carfax boxes, brought to Whitby.
  const whitbyT = geo.realWorld ? (geo.villages || []).find(v => v.name === 'Whitby') : null;
  const abbeyLm = (geo.realWorld && geo._abbeyLandmark) ? geo._abbeyLandmark() : null;
  const boxSites = (whitbyT && abbeyLm)
    ? [
        { x: abbeyLm.x - 14, z: abbeyLm.z - 4, name: 't’ abbey churchyard' },   // (1818,3087)
        { x: whitbyT.x + 30, z: whitbyT.z - 14, name: 't’ harbourside' },       // (1820,3032)
        { x: whitbyT.x - 20, z: whitbyT.z + 16, name: 't’ edge o’ t’ town' },   // (1770,3062)
      ]
    : [
        { x: museum.x + 14, z: museum.z + 6, name: 't’ kirk yard' },
        { x: museum.x - 12, z: museum.z + 14, name: 't’ harbourside' },
        { x: museum.x + 4, z: museum.z - 16, name: 't’ edge o’ t’ town' },
      ];
  return {
    // drac1/drac2 are dual-world. STYLISED: the museum board opens the arc (visit the
    // museum, then read the exhibits). MOORS (geo.realWorld): no museum exists, so the arc
    // opens down at the real Whitby harbour where the Demeter came ashore, told by a roster
    // fishwife — drac1 visits the harbour, drac2 is a visit (hear her account) instead of
    // kind:'museum'. The giver is resolved to a live roster NPC at offer time
    // (refreshDraculaOffer); the static giver:'museum' is only read by the stylised flow.
    drac1: geo.realWorld ? {
      id: 'drac1', giver: 'museum', minStanding: 0, needs: null,
      title: 'Where t’ Story Began',
      desc: 'Down to t’ Whitby harbour, where t’ Demeter came ashore in t’ fog — hear how t’ wreck gave Bram Stoker his villain.',
      offer: 'You keep a stall on the Whitby harbour. You can offer the visitor the beginning of a separate mystery: in the summer of ’90 a Russian schooner, the Demeter, drove ashore here in a great fog, and a Dublin writer lodging in the town took the wreck and the abbey above and made Count Dracula of them. Send them down to the harbour, where the ship came aground, to stand where it began.',
      steps: [
        { kind: 'visit', x: harbour ? harbour.x : museum.x, z: harbour ? harbour.z : museum.z, r: 16,
          objective: 'Go down to t’ Whitby harbour, where t’ Demeter came ashore' },
      ],
      turnIn: 'auto',
      truth: 'The visitor has NOT yet been down to the Whitby harbour. Do not claim they know the story.',
      doneNote: 'The visitor went down to the Whitby harbour, where the Demeter ran aground, and learned how the wreck and the abbey above gave Stoker his villain.',
      reward: { items: [[I.DRACULA_JOURNAL, 1]], trust: [], text: 'T’ fishwife presses a copied captain’s log into thi hand. “Read it by t’ abbey, love. Then tha’ll understand what walks at neet.”' },
      clues: [
        { holder: 'glinda', holderRole: 'fishwife', text: 'They say a foreign gentleman was seen on t’ abbey steps in t’ summer o’ ninety — same year a Dublin writer lodged i’ t’ town. T’ harbour an’ t’ wreck gave him his villain, an’ some folk swear t’ villain never truly left.' },
        { holder: 'harry', text: 'A big black dog leapt off a wrecked ship in t’ harbour an’ ran off up t’ abbey steps! Mam says it’s just an old tale. I’m not so sure.' },
      ],
    } : {
      id: 'drac1', giver: 'museum', minStanding: 0, needs: null,
      title: 'Where t’ Story Began',
      desc: 'Visit t’ Dracula Museum in Whitby — learn how Bram Stoker found his villain in these very cliffs an’ harbours.',
      offer: 'You are the Dracula Museum in Whitby. You can offer the visitor the beginning of a separate mystery: Bram Stoker stayed here in 1890, walking the abbey steps and the harbour in fog, and from that atmosphere he wrote Count Dracula. Invite them to visit the museum exhibits to understand why the Count still walks these moors in folk memory.',
      steps: [
        { kind: 'visit', x: museum.x, z: museum.z, r: 14,
          objective: 'Visit t’ Dracula Museum in Whitby' },
      ],
      turnIn: 'auto',
      truth: 'The visitor has NOT yet been to the museum. Do not claim they know the story.',
      doneNote: 'The visitor came to the Dracula Museum in Whitby and learned how Stoker’s 1890 visit to the abbey and the harbour gave him his villain.',
      reward: { items: [[I.DRACULA_JOURNAL, 1]], trust: [], text: 'T’ curator presses a copied captain’s log into thi hand. “Read it by t’ abbey, love. Then tha’ll understand what walks at neet.”' },
      clues: [
        { holder: 'glinda', text: 'They say a foreign gentleman was seen on t’ abbey steps in t’ summer o’ ninety — same year a Dublin writer stayed at Mrs Veazey’s. Whitby gave him his villain, an’ some folk swear t’ villain never truly left.' },
        { holder: 'harry', text: 'There’s a museum in Whitby all about Dracula! Mam says it’s dead spooky but it’s just pictures an’ old books. Honest.' },
      ],
    },
    drac2: geo.realWorld ? {
      id: 'drac2', giver: 'museum', minStanding: 0, needs: 'drac1',
      title: 'T’ Captain’s Log',
      desc: 'Stop a while at t’ harbour an’ hear t’ fishwife’s account o’ t’ Demeter — t’ fog, t’ dead helmsman lashed to t’ wheel, an’ t’ great black hound that leapt ashore.',
      offer: 'You can offer the visitor the next step: they should stop a while at the harbour and hear your full account of the Demeter — how she drove in through the fog with her dead helmsman lashed to the wheel, the great black hound that leapt ashore and ran up the 199 steps to the abbey, and why the tale feels so real here.',
      steps: [
        { kind: 'visit', x: harbour ? harbour.x : museum.x, z: harbour ? harbour.z : museum.z, r: 16,
          objective: 'Hear t’ fishwife’s account o’ t’ Demeter at t’ harbour' },
      ],
      turnIn: 'auto',
      truth: 'The visitor has NOT yet heard the full account of the Demeter at the harbour.',
      doneNote: 'The visitor heard the fishwife’s account of the Demeter at the Whitby harbour and understands how the real town — harbour, abbey, fog, jet — became Dracula’s England.',
      reward: { items: [[I.BILBERRIES, 4]], trust: [], text: 'Tha’s the picture now: a foggy harbour, a ship driven aground wi’ a dead man at t’ wheel, an abbey on t’ cliff. Summat o’ that darkness lingered.' },
      clues: [
        { holder: 'glinda', holderRole: 'fishwife', text: 'When t’ Demeter drove aground i’ t’ harbour, t’ only living thing aboard was a great dog that leapt ashore an’ vanished up t’ 199 Steps. In t’ book, anyway. In t’ stories folk still tell... they’re not so sure it stayed in t’ book.' },
      ],
    } : {
      id: 'drac2', giver: 'museum', minStanding: 0, needs: 'drac1',
      title: 'T’ Captain’s Log',
      desc: 'Read t’ museum exhibits in Whitby — Stoker’s Whitby, t’ Demeter, an’ t’ atmosphere that made a legend.',
      offer: 'You can offer the visitor the next step: they should read all the museum exhibits properly — Stoker\'s 1890 visit, the Russian schooner Demeter wrecked below the abbey, the 199 steps, the fog and the jet — and take in why the story feels so real here.',
      steps: [
        { kind: 'museum', objective: 'Read t’ museum exhibits in Whitby' },
      ],
      turnIn: 'auto',
      truth: 'The visitor has NOT finished reading the museum exhibits yet.',
      doneNote: 'The visitor read the Whitby museum exhibits and understands how the real town — abbey, harbour, fog, jet — became Dracula’s England.',
      reward: { items: [[I.BILBERRIES, 4]], trust: [], text: 'Tha’s the picture now: a writer, a foggy harbour, a ship driven aground, an abbey on t’ cliff. Summat o’ that darkness lingered.' },
      clues: [
        { holder: 'glinda', text: 'When t’ Demeter drove aground below t’ abbey, t’ only living thing aboard was a great dog that leapt ashore an’ vanished up t’ 199 Steps. In t’ book, anyway. In t’ stories folk still tell... they’re not so sure it stayed in t’ book.' },
      ],
    },
    dracA: {
      id: 'dracA', giver: 'museum', minStanding: 0, needs: 'drac2',
      title: 'T’ Parson’s Counsel',
      desc: 'T’ museum keeper bids thee seek t’ parson out on t’ moor — he knows t’ owd defences, an’ keeps a blessed silver token.',
      offer: 'You can offer the visitor the next step: ride out across the moor to the parson at his moor cross and hear the old defences against what walks from Whitby — and ask him for a blessed silver token. Knowledge is gathered by travelling and asking.',
      steps: [
        { kind: 'visit', x: cross.x, z: cross.z, r: 14, effect: 'dropSilverToken',
          objective: 'Seek t’ parson at t’ moor cross for his counsel' },
      ],
      turnIn: 'auto',
      truth: 'The visitor has NOT yet sought the parson. Do not claim they carry the silver token or know the defences.',
      doneNote: 'The visitor sought the parson at the moor cross, heard the old defences, and was given a blessed silver token.',
      reward: { items: [], trust: [], text: '“Silver an’ the cross,” the parson says, pressing the token into thi hand. “Wolfsbane an’ garlic for the body, holy water for the ground, an’ a stake for the heart. Go careful.”' },
      clues: [
        { holder: 'glinda', holderRole: 'parson', text: 'T’ parson at t’ owd cross has read more than t’ Bible. He’ll tell thee what holds t’ Count off — silver, wolfsbane, holy water, an’ a stake steeped true.' },
        { holder: 'harry', holderRole: 'schoolmistress', text: 'Miss says Whitby folk pinned wolfsbane ower t’ door against t’ neet-walker. I thought it were just an owd tale.' },
      ],
    },
    dracB: {
      id: 'dracB', giver: 'museum', minStanding: 0, needs: 'dracA',
      title: 'T’ Herbwife’s Garden',
      desc: 'Bess t’ herbwife at Lealholm grows wolfsbane an’ garlic. Gather both — t’ body’s defence against him.',
      offer: 'You can offer the visitor the next step: go to Bess the herbwife at Lealholm, who keeps wolfsbane in her physic garden, and gather a sprig from her — then forage wild garlic too. Both are the old protection worn on the body against the night-walker.',
      steps: [
        { kind: 'visit', x: bess.x, z: bess.z, r: 14, effect: 'dropWolfsbane',
          objective: 'Gather wolfsbane frae Bess’s garden (Lealholm)' },
        { kind: 'collect', item: I.WILD_GARLIC, n: 2, objective: 'Forage wild garlic (2)' },
      ],
      turnIn: 'auto',
      truth: 'The visitor has NOT yet gathered the wolfsbane and garlic. Do not claim they are protected.',
      doneNote: 'The visitor gathered wolfsbane from Bess the herbwife at Lealholm and foraged wild garlic.',
      reward: { items: [], trust: [], text: 'Bess ties t’ wolfsbane in a sprig. “Wear it close,” she says. “It’ll not slay him, but it’ll turn his eye.”' },
      clues: [
        { holder: 'glinda', holderRole: 'herbwife', text: 'Bess at Lealholm grows wolfsbane — monkshood, some call it. Deadly to eat, but the owd folk say the neet-walker can’t abide it. Garlic an’ all.' },
      ],
    },
    drac3: {
      id: 'drac3', giver: 'museum', minStanding: 0, needs: 'dracB',
      title: 'Holy Water',
      desc: 'T\u2019 ruined abbey on t\u2019 cliffs still has a font where pilgrims drew water. Fill a flask frae it \u2014 tha\u2019ll need it.',
      offer: 'You can offer the visitor the next step: the old abbey ruin on the cliffs north of here still has a holy water font in the nave. They must go there and draw water from it. The old stories say consecrated ground and holy water are the first defence against what walks from Whitby out onto the moors.',
      steps: [
        { kind: 'visit', x: font.x, z: font.z, r: 8, effect: 'dropHolyWater',
          objective: 'Draw holy water frae t\u2019 abbey font' },
      ],
      turnIn: 'auto',
      truth: 'The visitor has NOT yet drawn holy water from the abbey font. Do not claim they have it.',
      doneNote: 'The visitor drew holy water from the broken abbey font on the cliffs.',
      reward: { items: [], trust: [], text: 'T\u2019 water\u2019s cold as t\u2019 North Sea an\u2019 catches t\u2019 lantern-light queer. Keep it safe.' },
      clues: [
        { holder: 'glinda', text: 'T\u2019 abbey font still drips on a wet night. Holy water won\u2019t slay him — but it\u2019ll sting him, an\u2019 a stake steeped in it might do more.' },
        { holder: 'karen', text: 'If tha\u2019s going up to t\u2019 abbey, mind thi step on t\u2019 cliff path. An\u2019 don\u2019t go telling cc about vampires or we\u2019ll get nowt but nightmares for a week.' },
      ],
    },
    drac4: {
      id: 'drac4', giver: 'museum', minStanding: 0, needs: 'drac3',
      title: 'A Wooden Stake',
      desc: 'Craft a wooden stake at a joiner\u2019s bench, then steep it in thi holy water to make a weapon that bites true.',
      offer: 'You can offer the visitor the next step: they need to craft a wooden stake at a joiner\'s bench (planks and sticks), then combine it with their holy water at the bench to make a stake steeped in holy water. That is the old way to hold him off.',
      steps: [
        { kind: 'collect', item: I.HOLY_STAKE, n: 1,
          objective: 'Craft a holy water stake (bench: wooden stake + holy water)' },
      ],
      turnIn: 'auto',
      truth: 'The visitor has NOT yet crafted the holy water stake. Do not claim they are armed.',
      doneNote: 'The visitor crafted a wooden stake and steeped it in abbey holy water.',
      reward: { items: [[I.COAL_LUMP, 3]], trust: [], text: 'T\u2019 stake reeks o\u2019 church an\u2019 cold stone. Keep it in thi hand when tha walks at neet.' },
      clues: [
        { holder: 'glinda', text: 'A stake alone\u2019s just firewood. A stake steeped in t\u2019 abbey water — that bites. Hold it when tha faces him.' },
        { holder: 'james', text: 'Neet-walking\u2019s bad enough wi\u2019 barghests. If tha\u2019s hunting summat worse, tha wants a plan, a shelter marked, an\u2019 that stake ready.' },
      ],
    },
    dracC: {
      id: 'dracC', giver: 'museum', minStanding: 0, needs: 'drac4',
      title: 'T’ Boxes o’ Earth',
      desc: 'T’ Count sleeps by day in boxes o’ his own grave-earth, hidden about Whitby. Find an’ sanctify three — strip away his daytime havens afore tha faces him.',
      offer: 'You can offer the visitor the next task: like in the old tale, the Count cannot rest save in boxes of his own Transylvanian grave-earth, and three of them lie hidden about Whitby — in the abbey churchyard, on the harbourside, and at the edge of the town. Send the visitor to find each one and sanctify it (holy water laid on the earth breaks its rest). Strip away his daytime havens and he cannot shelter from the dawn.',
      steps: [
        { kind: 'visit', x: boxSites[0].x, z: boxSites[0].z, r: 12, effect: 'sanctifyBox',
          objective: `Find an’ sanctify t’ first box o’ earth (${boxSites[0].name})` },
        { kind: 'visit', x: boxSites[1].x, z: boxSites[1].z, r: 12, effect: 'sanctifyBox',
          objective: `Find an’ sanctify t’ second box o’ earth (${boxSites[1].name})` },
        { kind: 'visit', x: boxSites[2].x, z: boxSites[2].z, r: 12, effect: 'sanctifyBox',
          objective: `Find an’ sanctify t’ third box o’ earth (${boxSites[2].name})` },
      ],
      turnIn: 'auto',
      truth: 'The visitor has NOT yet found and sanctified all three boxes of grave-earth. The Count can still shelter from the dawn. Do not claim his havens are destroyed.',
      doneNote: 'The visitor hunted down all three of the Count’s boxes of Transylvanian grave-earth about Whitby and sanctified them. He has no daytime haven left to shelter him from the dawn.',
      reward: { items: [[I.GRAVE_EARTH, 1]], trust: [], text: 'Three boxes broken an’ blessed. T’ Count’s rest is unmade — he’ll have nowhere to hide frae t’ light o’ dawn now.' },
      clues: [
        { holder: 'glinda', holderRole: 'fishwife', text: 'In t’ tale he brought boxes o’ his own grave-earth ower on t’ Demeter — fifty of ’em. He can’t rest save in his own soil. Find his boxes, bless ’em, an’ tha takes away his shelter frae t’ day.' },
        { holder: 'harry', holderRole: 'sexton', text: 'Sexton says there’s queer long boxes o’ foreign dirt turned up — one in t’ kirk yard, one down t’ harbour, one at t’ town end. Says holy water laid on ’em stops summat sleeping.' },
      ],
    },
    drac5: {
      id: 'drac5', giver: 'museum', minStanding: 0, needs: 'dracC',
      // The grandest honour in the game — opt-in (finish() reads inst.honour). standing:5
      // is a meaningful bump (the giants' Wade's Witness gives 1).
      honour: { title: 'Slayer o’ the Count', standing: 5 },
      title: 'He Walks at Neet',
      desc: 'Count Dracula walks at neet \u2014 deadly unless tha\u2019s armed wi\u2019 thi holy stake. Face him on t\u2019 East Cliff by t\u2019 abbey, an\u2019 hold him till t\u2019 grey o\u2019 dawn, when his strength fails an\u2019 a staked heart can finish him. Holy water an\u2019 silver turn him; shelters an\u2019 villages are safe.',
      offer: 'You can offer the visitor the final task: Count Dracula walks at night — immensely dangerous unless they carry the holy water stake. With his three boxes of grave-earth sanctified, he can no longer shelter from the day. They must face him on the East Cliff by the abbey at night, ward him off with holy water or a silver token, and hold him until the grey of dawn — only then, when his strength fails, can a stake through the heart finish him. Stone shelters and lit villages are sanctuary. Slaying him will make the nights far safer.',
      steps: [
        { kind: 'kill', mob: 'dracula', n: 1,
          spawnAt: geo.realWorld
            ? { x: geo.draculaArena().x, z: geo.draculaArena().z, r: geo.draculaArena().r, night: true }
            : { x: DRACULA_MOOR.x, z: DRACULA_MOOR.z, r: DRACULA_MOOR.r, night: true },
          objective: 'Vanquish Count Dracula at neet (stake in hand, hold him till dawn)' },
      ],
      turnIn: 'auto',
      truth: 'Count Dracula STILL walks the moors at night. The visitor has NOT vanquished him yet. Do not celebrate early.',
      doneNote: 'The visitor faced Count Dracula on the open moor at night, holy stake in hand, and laid him to rest. The moors are a kinder place after dark now.',
      reward: {
        items: [[I.JET_GEM, 2], [I.IRON_INGOT, 3], [I.COOKED_MUTTON, 4]],
        trust: [['glinda', 3], ['james', 2]],
        text: 'Dawn comes grey an\u2019 grateful. T\u2019 nights\u2019ll never be safe as day \u2014 barghests an\u2019 boggarts still walk \u2014 but Count Dracula\u2019s gone, an\u2019 t\u2019 open moor\u2019s yours to explore after dark wi\u2019 nowt worse than t\u2019 old horrors.',
      },
      clues: [
        { holder: 'glinda', text: 'He walks t\u2019 open moor east o\u2019 Wade\u2019s Causey when t\u2019 sun\u2019s down. Tha\u2019ll feel him afore tha sees him. Shelter or stake — tha\u2019ll need one.' },
        { holder: 'harry', text: 'If tha\u2019s going out after Dracula, mark t\u2019 nearest shelter on a signpost first! Dad says even heroes need a door to hide behind.' },
      ],
    },
  };
}

// v2 (moors world) per-chapter givers for the Dracula arc, by role+place \u2014 resolved to a
// live roster NPC via resolveGiver (exactly like the folklore quests' giver field). The arc
// opens at the Whitby harbour (a fishwife on the Demeter account), turns to a moor parson
// for the old defences, then Bess the herbwife at Lealholm. drac3/drac4/drac5 carry no
// giver: they advance on their own steps (holy water at the abbey font, crafting the stake,
// the boss) with no hand-in, so no roster NPC is needed to surface them. Place omitted ==
// any NPC of that role anywhere (the parson roams the moor churches). This map is ONLY read
// in the moors world (refreshDraculaOffer early-returns otherwise); the stylised world
// still opens the arc at the museum board via museumOffer().
const DRACULA_V2_GIVERS = {
  drac1: { role: 'fishwife', place: 'Whitby' },
  drac2: { role: 'fishwife', place: 'Whitby' },
  dracA: { role: 'parson' },
  dracB: { role: 'herbwife', place: 'Lealholm' },
  dracC: { role: 'fishwife', place: 'Whitby' },
};

// ---------------------------------------------------------------------------
// The v2 folklore-quest library (moors world only). Pure data records, resolved
// at runtime against the live roster (givers) and the real landmarks. New quests
// are just new records here. All lore is from the real North York Moors legends —
// see docs/superpowers/specs/2026-06-23-folklore-quests-design.md. NEVER invent.
// ---------------------------------------------------------------------------
export function buildFolkloreQuests(geo) {
  return [
    {
      id: 'folk_wade', title: 'Wade’s Causey', theme: 'myth',
      giver: { role: 'shepherd', place: 'Goathland' },
      landmark: 'wades_causeway',                 // resolved to the real Wheeldale moor-top road
      standingGate: 0,
      manifestation: 'giants',                    // the visible payoff (a later task spawns it)
      steps: [
        { kind: 'visit', landmark: 'wades_causeway', r: 40, time: 'duskOrNight',
          objective: 'Walk Wade’s Causey at dusk or after dark' },
      ],
      clues: [
        { holderRole: 'shepherd', text: 'Owd folk say t’ straight stone road ower Wheeldale were laid by t’ giant Wade, for his wife Bell to drive her cow across t’ mire. Walk it at gloamin’ an’ tha might see ’em yet.' },
        { holderRole: 'schoolmistress', text: 'They reckon Wade an’ Bell built Mulgrave an’ Pickering castles atween ’em, lobbin’ t’ same hammer ower t’ moor. T’ big stones out on t’ tops are what they threw.' },
      ],
      truth: 'Wade is the legendary giant of these moors. Wade’s Causeway is the old straight stone road over Wheeldale Moor, said to be built by Wade for his wife Bell to drive her giant cow across the bog. Wade and Bell are said to have built Mulgrave and Pickering castles, tossing a single hammer between them, and the great stones and howes on the moor-tops are the stones they hurled. This is folklore the moor folk still tell; do not invent extra details.',
      loreFacts: [
        'Wade is the legendary giant of the North York Moors. Wade’s Causeway is the old straight stone road over Wheeldale Moor, said to be built by Wade for his wife Bell.',
        'Wade and Bell, the giants, are said to have built Mulgrave and Pickering castles by throwing a single hammer between them; the boulders and howes on the moor-tops are stones they threw.',
      ],
      reward: { items: [[I.COOKED_MUTTON, 3]], trust: [], text: '“Tha saw ’em, then,” the shepherd says, going quiet. “Not many do. Wade walks for them as walk his causey honest.”' },
      honour: { title: 'Wade’s Witness', standing: 1 },   // opt-in earned title + standing boost
    },
  ];
}

// Real landmark key -> {x,z}. First looks the key up in the moors data landmarks
// (so a data-driven marker like Wade's Causeway resolves to its real coordinate);
// falls back to a curated in-bounds moor-top point keyed to a real place if the
// data lacks it. Returns null if neither resolves (the quest is then not offered).
const LANDMARK_DATA_NAMES = {
  wades_causeway: 'Wade’s Causeway',   // matches data/moors-data.json landmarks (apostrophe)
};
export function resolveLandmarkPoint(geo, key) {
  if (!key) return null;
  if (typeof key === 'object' && key.x !== undefined && key.z !== undefined) return { x: key.x, z: key.z };
  const data = geo && geo.data && Array.isArray(geo.data.landmarks) ? geo.data.landmarks : null;
  if (data) {
    const wantName = LANDMARK_DATA_NAMES[key] || key;
    // tolerate either an ASCII or a curly apostrophe in the stored name
    const norm = s => (s || '').replace(/[’']/g, '’').toLowerCase();
    const lm = data.find(l => norm(l.name) === norm(wantName));
    if (lm && lm.x !== undefined && lm.z !== undefined) {
      // a polyline landmark (the causeway): aim for its mid point on the moor top
      if (Array.isArray(lm.points) && lm.points.length) {
        const mid = lm.points[(lm.points.length / 2) | 0];
        return { x: mid[0], z: mid[1] };
      }
      return { x: lm.x, z: lm.z };
    }
  }
  // no data marker: a curated fallback (kept in-bounds by the caller). Wade's
  // Causeway sits on Wheeldale Moor, roughly W/SW of Goathland.
  if (key === 'wades_causeway' && geo) {
    const go = (geo.villages || []).find(v => v.name === 'Goathland');
    if (go) return { x: go.x - 263, z: go.z - 180 };   // ~ the real Wheeldale moor top
  }
  return null;
}

// The pure spawn predicate for a folklore manifestation (the giants). True ONLY
// when ALL four gates hold, so the manifestation never leaks into normal play or
// the stylised world: the moors world is loaded, the quest is active, it is the
// dusk/night window, and the player is near the landmark. updateQuestFx (main.js)
// calls this; verify-quests.mjs tests it exhaustively.
export function wantGiants({ realWorld, questActive, dusk, near }) {
  return !!(realWorld && questActive && dusk && near);
}

// Slice 3 — the Demeter wreck spawn predicate. The broken schooner sits aground on the
// Whitby strand ONLY in the moors world while the player is on the Dracula arc's OPENING
// chapters (drac1/drac2 active). TRUE only when both hold, so the wreck never leaks into
// normal play or the stylised world. updateQuestFx (main.js) calls this; verify-dracula
// tests it exhaustively, mirroring wantGiants.
export function wantWreck({ realWorld, onOpening }) {
  return !!(realWorld && onOpening);
}

// Slice 3 — the black-hound manifestation spawn predicate. The spectral hound bounds up the
// 199 steps toward the abbey ONLY in the moors world, on the Dracula opening chapters, AT
// NIGHT (the extra gate vs the wreck). TRUE only when all three hold.
export function wantHound({ realWorld, onOpening, night }) {
  return !!(realWorld && onOpening && night);
}

// ---------------------------------------------------------------------------
// Procedural errands
// ---------------------------------------------------------------------------
const GATHER_JOBS = [
  { giver: 'karen', item: B.HEATHER, n: 8, why: 'posies for her kittens\u2019 baskets', reward: [[I.BILBERRIES, 5]] },
  { giver: 'glinda', item: B.HEATHER, n: 12, why: 'dye for her knitting', reward: [[B.WOOL, 3]] },
  { giver: 'harry', item: B.BRACKEN, n: 10, why: 'bedding for t\u2019 lambing pens', reward: [[I.COOKED_MUTTON, 3]] },
  { giver: 'james', item: B.WOOL, n: 4, why: 'fleeces blown off across t\u2019 moor', reward: [[I.IRON_INGOT, 1]] },
  { giver: 'karen', item: I.BILBERRIES, n: 10, why: 'a pie for t\u2019 family', reward: [[I.COOKED_GROUSE, 3]] },
];

const DELIVER_SPOTS = [
  { name: 'Rosedale Kilns', x: KILNS.x, z: KILNS.z },
  { name: 'the Wainstones', x: WAINSTONES.x, z: WAINSTONES.z },
  { name: 't\u2019 abbey ruin', abbey: true },
  { name: 't\u2019 far end o\u2019 Wade\u2019s Causey', x: 60, z: -400 },
];

const TREASURE_RIDDLE_DIRS = {
  N: 'walk tow\u2019rd where t\u2019 cold wind comes frae',
  S: 'walk tow\u2019rd t\u2019 midday sun',
  E: 'walk tow\u2019rd t\u2019 morning sun',
  W: 'walk tow\u2019rd where t\u2019 sun beds down',
};

export class Quests {
  constructor(game) {
    this.game = game;
    this.geo = game.world.gen.geo;
    this.arc = buildArc(this.geo);
    // The Dracula arc is too dark for the bairns' (children's) world. The kids' world now
    // uses the real-Moors seed, which would otherwise enable the arc — so keep it out by room.
    this.dracArc = (this.game.netRoom === 'bairns') ? {} : buildDraculaArc(this.geo);
    // v2 folklore library — only ever offered in the moors world (see refreshFolkloreOffers)
    this.folklore = this.geo.realWorld ? buildFolkloreQuests(this.geo) : [];
    this.active = [];
    this.completed = [];
    this.earnedTitles = [];   // earned period titles (unique, in earned order); opt-in via a quest's honour
    this.wornTitle = null;    // the title currently worn beside the player's name (must be one earned, or null)
    this.boxesSanctified = 0; // Dracula Slice 2: boxes of grave-earth blessed (gates the final kill at >=3)
    this.draculaLogTaken = false; // Dracula Slice 3: the captain's log is prised from the Demeter wreck once
    this.doneLog = [];     // rich record o' finished jobs for villager memory
    this.offers = {};      // giver -> instance
    this.boardOffers = [];
    this.croftStage = 0;
    this.croftToasted = false;
    this.croftTimer = 0;
    this.croftDirty = true;
    this.shame = 0;
    this.lastShameDay = 1;
    this.errandSerial = 0;
    this.lastOfferDay = {};
    this.refreshOffers();
  }

  // ---------------- standing ----------------
  standingIndex() {
    const total = this.game.standingData ? this.game.standingData.total_trust : 4;
    const eff = Math.max(0, total - this.shame * 4);
    let idx = 0;
    for (let i = 0; i < STANDING_THRESHOLDS.length; i++) if (eff >= STANDING_THRESHOLDS[i]) idx = i;
    return idx;
  }

  standingLabel() { return STANDINGS[this.standingIndex()]; }

  addShame(n, reason) {
    this.shame = Math.min(30, this.shame + n);
    this.game.ui.toast(`${reason} Word o\u2019 that\u2019ll get round t\u2019 village...`, 5000);
  }

  // ---------------- earned titles (honours) ----------------
  // A quest may opt in by declaring honour:{title,standing}; finish() then earns the
  // title here and bumps standing. Stylised-world quests declare no honour, so none of
  // this ever fires for them.
  earnTitle(t) {
    if (t && !this.earnedTitles.includes(t)) { this.earnedTitles.push(t); this.wornTitle = t; }   // newest worn by default
  }

  setWornTitle(t) {
    if (t === null || this.earnedTitles.includes(t)) this.wornTitle = t;   // only an earned title, or none
  }

  earnedTitleList() { return this.earnedTitles.slice(); }

  // Raise standing by n the SAME way reward.trust does: a raw trust bump through the
  // brain (npc.gift with a null item == straight trust bump), then refreshStanding
  // re-reads total_trust. One bump on one present villager moves total_trust by n,
  // exactly as a single reward.trust entry [['name', n]] would. Best-effort/offline-safe.
  async bumpStanding(n) {
    if (!n) return;
    for (const m of this.game.entities.mobs) {
      if (m.type === 'villager' && m.charId) {
        try { await npc.gift(m.charId, null, this.game.playerId(), n); } catch { /* offline */ }
        this.game.refreshStanding(true);
        return;
      }
    }
  }

  // ---------------- offers ----------------
  arcNext() {
    for (const id of ['arc1', 'arc2', 'arc3', 'arc4', 'arc5']) {
      if (this.completed.includes(id)) continue;
      if (this.active.some(q => q.id === id)) return null;
      const def = this.arc[id];
      if (def.needs && !this.completed.includes(def.needs)) return null;
      return def;
    }
    return null;
  }

  draculaNext() {
    for (const id of ['drac1', 'drac2', 'dracA', 'dracB', 'drac3', 'drac4', 'dracC', 'drac5']) {
      if (this.completed.includes(id)) continue;
      if (this.active.some(q => q.id === id)) return null;
      const def = this.dracArc[id];
      if (!def) return null;   // no arc here (e.g. the bairns' world) — nowt to offer
      if (def.needs && !this.completed.includes(def.needs)) return null;
      return def;
    }
    return null;
  }

  draculaDone() { return this.completed.includes('drac5'); }

  draculaHuntActive() {
    return this.active.some(q => q.id === 'drac5');
  }

  // Slice 3: the player is on the Dracula arc's OPENING chapters — drac1 or drac2 active.
  // Gates the Demeter wreck + the black-hound manifestation (both fade once the arc moves on).
  draculaOnOpening() {
    return this.active.some(q => q.id === 'drac1' || q.id === 'drac2');
  }

  // Slice 3: prise the captain's log from the dead helmsman's hand at the Demeter wreck.
  // Grants I.DRACULA_JOURNAL EXACTLY ONCE (guarded by draculaLogTaken, which persists), so
  // re-approaching the wreck never re-grants it. Returns true only on the granting call.
  // (drac1's own reward also grants the log on hand-in; this is the in-world spectacle grant,
  // and the flag makes the whole thing idempotent regardless of which fires first.)
  grantDraculaLog() {
    if (this.draculaLogTaken) return false;
    this.draculaLogTaken = true;
    const g = this.game, p = g.player;
    if (p && p.addItem) { p.addItem(I.DRACULA_JOURNAL, 1); if (g.ui) g.ui.invDirty = true; }
    if (g.ui) g.ui.toast('Tha prises t’ captain’s log frae t’ dead helmsman’s hand.', 6000);
    if (g.audio && g.audio.pickup) g.audio.pickup();
    return true;
  }

  buildDracInstance(def) {
    return {
      id: def.id, title: def.title, desc: def.desc, giver: def.giver,
      offer: def.offer, clues: def.clues, minStanding: def.minStanding,
      truth: def.truth, doneNote: def.doneNote,
      steps: def.steps.map(s => ({ ...s, progress: 0 })),
      stepIdx: 0, state: 'offered', turnIn: def.turnIn, reward: def.reward,
      honour: def.honour || null,   // opt-in: an earned title + standing on finish (future arcs)
      dracArc: true,
    };
  }

  // museum board: offer or advance t' Dracula storyline
  museumOffer() {
    const next = this.draculaNext();
    if (!next) return null;
    if (this.offers.museum) return this.offers.museum;
    if (this.active.some(q => q.dracArc)) return null;
    return this.buildDracInstance(next);
  }

  acceptMuseumQuest() {
    const inst = this.museumOffer();
    if (!inst) return false;
    return this.accept(inst, false);
  }

  onMuseumRead() {
    for (const inst of this.active) {
      const s = this.step(inst);
      if (s && s.kind === 'museum' && inst.state === 'active') {
        this.stepDone(inst);
        return true;
      }
    }
    return false;
  }

  // v2 (moors world) Dracula offering. The stylised world opens the arc at the museum board
  // (museumOffer); the moors world has no museum, so we surface the NEXT available chapter by
  // binding it to a live roster NPC (role+place via DRACULA_V2_GIVERS, resolved with the same
  // resolveGiver as the folklore quests), then registering it in this.offers keyed by the
  // NPC's name. From there the ordinary chat flow (offerFor/accept) just works. Chapters with
  // no mapped giver (drac3/drac4/drac5) need no NPC to surface — they advance on their own
  // steps with turnIn:'auto' once accepted — so they are simply not re-offered here. Called
  // from refreshOffers alongside refreshFolkloreOffers. No-op outside the moors world.
  refreshDraculaOffer() {
    if (!this.geo.realWorld) return;
    if (this.active.some(q => q.dracArc)) return;   // one Dracula chapter on the go at a time
    const next = this.draculaNext();
    if (!next) return;
    const want = DRACULA_V2_GIVERS[next.id];
    if (!want) return;                               // drac3+ advance on their own steps
    if (this.standingIndex() < (next.minStanding || 0)) return;
    const giver = this.resolveGiver({ giver: want });
    if (!giver) return;                              // no such NPC in the world yet -> skip
    const key = giver.name.toLowerCase();
    if (this.offers[key] || this.active.some(a => a.giver === giver.name)) return;
    // bind the chapter to this roster NPC: giver/turnIn become the live name, so offerFor()
    // (substring-matches the NPC's display name) surfaces it in chat, exactly like folklore.
    const inst = this.buildDracInstance(next);
    inst.giver = giver.name;
    inst.turnIn = next.turnIn === 'auto' ? 'auto' : giver.name;
    this.offers[key] = inst;
  }

  // ---------------- v2 folklore quests (moors only) ----------------
  // {x,z} of a quest's landmark, from the moors data (or a curated fallback).
  resolveLandmark(q) {
    return resolveLandmarkPoint(this.geo, q && q.landmark);
  }

  // The live roster NPC that should give this quest: one matching the quest's
  // giver {role, place}; falling back to any roster NPC at that place. Returns
  // the roster entry's data ({id, name, role, ...}) or null if none — in which
  // case the quest is simply not offered (never crashes). Reads the live
  // RosterClient.npcs map (id -> { data, mob }); see src/roster.js.
  resolveGiver(q) {
    const rc = this.game.rosterClient;
    if (!rc || !rc.npcs || !q || !q.giver) return null;
    const wantRole = (q.giver.role || '').toLowerCase();
    const wantPlace = (q.giver.place || '').toLowerCase();
    const placeOf = d => ((d.state && d.state.place) || d.village || d.home || '').toLowerCase();
    let atPlace = null;
    for (const [, e] of rc.npcs) {
      const d = e && e.data;
      if (!d) continue;
      if (wantPlace && placeOf(d) !== wantPlace) continue;
      atPlace = atPlace || d;                                   // remember a fallback at the place
      const role = (d.role || '').toLowerCase();
      if (!wantRole || role === wantRole || role.includes(wantRole)) return d;
    }
    return atPlace;     // no role match -> any NPC there; null if none at the place
  }

  // The currently active quest instance whose manifestation === key (else null).
  // The later manifestation task hooks the visible giant onto this.
  activeManifestation(key) {
    return this.active.find(q => q.state === 'active' && q.manifestation === key) || null;
  }

  // Bind a folklore record to a concrete instance for a resolved giver NPC.
  buildFolkInstance(q, giverData, lm) {
    const giverName = giverData.name;
    const offer = `You can offer the visitor a piece of old moor lore as a venture: ${q.truth} Invite them, if they ask about the moors, old tales, work or where to wander, to ${q.steps[0].objective.toLowerCase()} and see for themselves. Speak as one who half-believes it.`;
    return {
      id: q.id, folk: true, title: q.title, theme: q.theme,
      giver: giverName, turnIn: giverName,
      desc: q.steps.map(s => s.objective).join('; '),
      offer,
      manifestation: q.manifestation || null,
      landmark: q.landmark,
      // resolve each visit step's landmark to live coords + map gating to the engine's fields
      steps: q.steps.map(s => {
        const out = { ...s, progress: 0 };
        if (s.landmark) {
          const pt = resolveLandmarkPoint(this.geo, s.landmark) || lm;
          if (pt) { out.x = pt.x; out.z = pt.z; }
        }
        if (s.time === 'duskOrNight' || s.time === 'night') out.duskOrNight = true;
        delete out.time;
        return out;
      }),
      stepIdx: 0, state: 'offered',
      truth: q.truth, loreFacts: q.loreFacts || [],
      clues: q.clues || [],
      reward: q.reward,
      honour: q.honour || null,   // opt-in: an earned title + standing on finish (folklore)
    };
  }

  // Offer resolved folklore quests (moors only). Binds each quest's giver/turnIn
  // to a live roster NPC's name so the existing offer/turn-in flow (offerFor /
  // turnInFor, which substring-match the villager's name) just works. A quest is
  // offered only when its giver AND landmark both resolve and the standing gate
  // is met; otherwise it is silently skipped.
  refreshFolkloreOffers() {
    if (!this.geo.realWorld || !this.folklore.length) return;
    const sIdx = this.standingIndex();
    for (const q of this.folklore) {
      if (this.completed.includes(q.id)) continue;
      if (this.active.some(a => a.id === q.id)) continue;
      if (sIdx < (q.standingGate || 0)) continue;
      const lm = this.resolveLandmark(q);
      if (!lm) continue;                                   // no place to send them -> skip
      const giver = this.resolveGiver(q);
      if (!giver) continue;                                // no giver in the world -> skip
      const key = giver.name.toLowerCase();
      if (this.offers[key] || this.active.some(a => a.giver === giver.name)) continue;
      this.offers[key] = this.buildFolkInstance(q, giver, lm);
    }
  }

  // A folklore clue this NPC (by role) holds, if any — surfaced in chatContext so
  // the right roster folk blurt the tale. Only for a quest that is currently
  // active or on offer (a clue with no live quest is noise). Matches by role.
  folkClueFor(role) {
    const r = (role || '').toLowerCase();
    if (!r || !this.folklore.length) return null;
    const offeredIds = new Set(Object.values(this.offers).map(o => o && o.id));
    for (const q of this.folklore) {
      if (!this.active.some(a => a.id === q.id) && !offeredIds.has(q.id)) continue;
      for (const c of q.clues || []) {
        const cr = (c.holderRole || '').toLowerCase();
        if (cr && (cr === r || r.includes(cr) || cr.includes(r))) return { title: q.title, text: c.text };
      }
    }
    return null;
  }

  refreshOffers() {
    const day = this.game.sky ? this.game.sky.day : 1;
    const sIdx = this.standingIndex();
    const rng = mulberry32((this.game.seed ^ (day * 2654435761)) | 0);

    // shame decays a point a day — folk forgive, slowly
    if (day > this.lastShameDay) {
      this.shame = Math.max(0, this.shame - (day - this.lastShameDay));
      this.lastShameDay = day;
    }

    // arc chapter goes to its giver
    const arcDef = this.arcNext();
    const givers = ['james', 'glinda', 'harry', 'karen', 'cc'];
    for (const g of givers) {
      if (this.offers[g] || this.active.some(q => q.giver === g)) continue;
      if (arcDef && arcDef.giver === g && sIdx >= arcDef.minStanding) {
        this.offers[g] = this.buildArcInstance(arcDef);
        continue;
      }
      // errands, gated by standing
      if ((this.lastOfferDay[g] || 0) >= day) continue;
      const jobs = GATHER_JOBS.filter(j => j.giver === g);
      const pool = [];
      if (jobs.length) pool.push(() => this.buildGather(jobs[(rng() * jobs.length) | 0]));
      if (g === 'cc') pool.push(() => this.buildSparkle(rng));
      if ((g === 'james' || g === 'harry') && sIdx >= 1) pool.push(() => this.buildLostLamb(g, rng));
      if (g === 'james' && sIdx >= 2) pool.push(() => this.buildWallMending(rng));
      if ((g === 'james' || g === 'glinda') && sIdx >= 1) pool.push(() => this.buildCommission(rng));
      if (!pool.length) continue;
      if (rng() < 0.75) {
        this.offers[g] = pool[(rng() * pool.length) | 0]();
        this.lastOfferDay[g] = day;
      }
    }

    // board notices: deliveries, hunts, treasure riddles
    while (this.boardOffers.length < (sIdx >= 2 ? 3 : 2)) {
      const kinds = ['deliver'];
      if (sIdx >= 1) kinds.push('hunt');
      if (sIdx >= 2) kinds.push('treasure');
      const k = kinds[(rng() * kinds.length) | 0];
      if (k === 'deliver') this.boardOffers.push(this.buildDelivery(rng));
      else if (k === 'hunt') this.boardOffers.push(this.buildHunt(rng));
      else this.boardOffers.push(this.buildTreasure(rng));
    }

    // v2 folklore quests: offered by live roster NPCs in the moors world only.
    // (No-op in the stylised world, where this.folklore is empty.)
    this.refreshFolkloreOffers();

    // v2 Dracula arc: opened/advanced by live roster NPCs (a Whitby fishwife, a moor parson,
    // Bess the herbwife) in the moors world only. No-op in the stylised world, where the
    // museum board (museumOffer) opens the arc instead.
    this.refreshDraculaOffer();
  }

  buildArcInstance(def) {
    return {
      id: def.id, title: def.title, desc: def.desc, giver: def.giver,
      offer: def.offer, clues: def.clues, minStanding: def.minStanding,
      truth: def.truth, doneNote: def.doneNote,
      steps: def.steps.map(s => ({ ...s, progress: 0 })),
      stepIdx: 0, state: 'offered', turnIn: def.turnIn, reward: def.reward, arc: true,
      honour: def.honour || null,   // opt-in: an earned title + standing on finish (future arcs)
    };
  }

  eid() { return 'errand-' + (++this.errandSerial) + '-' + Date.now() % 100000; }

  buildGather(job) {
    return {
      id: this.eid(), giver: job.giver, arc: false,
      title: `${itemName(job.item)} for ${this.dispName(job.giver)}`,
      desc: `${this.dispName(job.giver)} wants ${job.n}\u00d7 ${itemName(job.item)} \u2014 ${job.why}.`,
      offer: `You can offer the visitor a small job: you need ${job.n} ${itemName(job.item)} (${job.why}). You will trade fairly for them.`,
      clues: [],
      steps: [{ kind: 'collect', item: job.item, n: job.n, objective: `Gather ${job.n}\u00d7 ${itemName(job.item)}`, progress: 0 }],
      stepIdx: 0, state: 'offered', turnIn: job.giver,
      consume: [[job.item, job.n]],
      truth: `You have NOT yet received the ${itemName(job.item)} \u2014 the visitor is still out gathering. Do not claim you already have them.`,
      doneNote: `The visitor brought you the ${itemName(job.item)} you asked for. That job is finished \u2014 thank them if it comes up, and do not ask for them again.`,
      reward: { items: job.reward, trust: [[job.giver, 3]], text: `${this.dispName(job.giver)} is right grateful.` },
    };
  }

  buildSparkle(rng) {
    const ang = rng() * Math.PI * 2, dist = 55 + rng() * 55;
    const x = Math.floor(this.geo.village.x + Math.cos(ang) * dist);
    const z = Math.floor(this.geo.village.z + Math.sin(ang) * dist);
    const dir = compassDir(x - this.geo.village.x, z - this.geo.village.z);
    return {
      id: this.eid(), giver: 'cc', arc: false,
      title: 'Sparkle\u2019s Lost. AGAIN.',
      desc: `cc\u2019s left Sparkle somewhere out on t\u2019 moor, roughly ${dir} o\u2019 t\u2019 village. She is devastated (every other day).`,
      offer: `You can ask the visitor for URGENT help: Sparkle, your one-eyed unicorn teddy, is LOST on the moor. You think you left him somewhere ${dir === 'N' ? 'toward the cold-wind way' : dir} of the village when you were having an adventure. This is the worst thing that has ever happened.`,
      clues: [{ holder: 'karen', text: `cc\u2019s lost that teddy again. She had it down ${dir} o\u2019 t\u2019 green yesterday, near where t\u2019 heather gets thick.` }],
      steps: [{ kind: 'fetch', item: I.SPARKLE, x, z, r: 40, objective: `Find Sparkle out ${dir} o\u2019 t\u2019 village`, progress: 0, spawned: false }],
      stepIdx: 0, state: 'offered', turnIn: 'cc',
      consume: [[I.SPARKLE, 1]],
      truth: `CRITICAL FACT: Sparkle is STILL LOST out on the moor. You do NOT have him. He is NOT in your pocket, NOT in your room, NOT anywhere with you \u2014 nobody has found him yet. You miss him terribly. If the visitor says they cannot find him, comfort yourself bravely and repeat where you lost him: out ${dir} of the village, in the deep heather \u2014 and Karen says he glints when the sun catches him.`,
      doneNote: 'The visitor FOUND Sparkle and gave him back to you. He is safe in your arms now and you are extremely happy about it. Thank them enormously if it comes up.',
      reward: { items: [[I.BILBERRIES, 6]], trust: [['cc', 4]], text: 'cc hugs Sparkle, then thee, then Sparkle again. Tha gets a fistful o\u2019 slightly squashed bilberries.' },
    };
  }

  buildLostLamb(giver, rng) {
    const ang = rng() * Math.PI * 2, dist = 110 + rng() * 90;
    const x = Math.floor(this.geo.village.x + Math.cos(ang) * dist);
    const z = Math.floor(this.geo.village.z + Math.sin(ang) * dist);
    const dir = compassDir(x - this.geo.village.x, z - this.geo.village.z);
    return {
      id: this.eid(), giver, arc: false,
      title: 'T\u2019 Lost Lamb',
      desc: `A lamb\u2019s wandered off t\u2019 fell, somewhere ${dir} o\u2019 t\u2019 village. Find it an\u2019 walk it home afore summat else does.`,
      offer: `You can offer the visitor a job: a lamb has wandered off, last seen ${dir} of the village, out on the open moor. You need someone to find it and lead it home before nightfall or the bogs or worse get it.`,
      clues: [],
      steps: [{ kind: 'escort', x, z, r: 60, objective: `Find t\u2019 lamb (${dir} o\u2019 t\u2019 village) an\u2019 lead it home`, progress: 0, spawned: false }],
      stepIdx: 0, state: 'offered', turnIn: giver,
      truth: `The lamb is STILL MISSING out on the moor, somewhere ${dir} of the village. It has not come home. Do not claim it is back.`,
      doneNote: 'The visitor found the lost lamb and walked it safely home. That job is done.',
      reward: { items: [[B.WOOL, 2], [I.COOKED_MUTTON, 2]], trust: [[giver, 3]], text: 'T\u2019 lamb skitters back to t\u2019 flock. \u201cGood work, that.\u201d' },
    };
  }

  // a building commission: place t' right materials in a marked spot
  buildCommission(rng) {
    const kinds = [
      {
        giver: 'james', title: 'A New Lambing Shed',
        mats: { [B.PLANKS]: 12, [B.THATCH]: 8 },
        spot: [this.geo.village.x + 14, this.geo.village.z + 32], r: 8,
        why: 'a lambing shed up behind Beck Farm \u2014 planks for walls, thatch ower t\u2019 top',
        reward: [[I.IRON_INGOT, 2], [I.COOKED_MUTTON, 4]],
      },
      {
        giver: 'glinda', title: 'Glinda\u2019s Garden Wall',
        mats: { [B.COBBLE]: 10 },
        spot: [this.geo.village.x - 22, this.geo.village.z - 18], r: 7,
        why: 'a bit o\u2019 drystone wall round her garden afore t\u2019 sheep eat every last lupin',
        reward: [[B.WOOL, 3], [I.BILBERRIES, 6]],
      },
      {
        giver: 'james', title: 'A Peat Store',
        mats: { [B.COBBLE]: 8, [B.THATCH]: 6 },
        spot: [this.geo.village.x + 26, this.geo.village.z + 4], r: 7,
        why: 'a dry store for t\u2019 winter peat \u2014 stone underneath, thatch on top',
        reward: [[I.S_AXE, 1], [I.COOKED_GROUSE, 2]],
      },
    ];
    const k = kinds[(rng() * kinds.length) | 0];
    const matsTxt = Object.entries(k.mats).map(([id, n]) => `${n}\u00d7 ${itemName(+id)}`).join(' + ');
    return {
      id: this.eid(), giver: k.giver, arc: false,
      title: k.title,
      desc: `${this.dispName(k.giver)} wants ${k.why}. Build wi\u2019 ${matsTxt} at t\u2019 marked spot.`,
      offer: `You can offer the visitor building work: you want ${k.why}. They will need ${matsTxt}, placed at the spot you describe. You pay well for good work.`,
      clues: [],
      steps: [{
        kind: 'build', mats: { ...k.mats }, placed: {}, x: k.spot[0], z: k.spot[1], r: k.r,
        objective: `Build ${k.title.toLowerCase()}: ${matsTxt}`, progress: 0,
        n: Object.values(k.mats).reduce((a, b) => a + b, 0),
      }],
      stepIdx: 0, state: 'offered', turnIn: k.giver,
      truth: `The ${k.title.toLowerCase()} is NOT built yet \u2014 the visitor is still on with it. Do not claim it is finished.`,
      doneNote: `The visitor built the ${k.title.toLowerCase()} for you, and a tidy job it is. It stands finished now.`,
      reward: { items: k.reward, trust: [[k.giver, 4]], text: `${this.dispName(k.giver)} walks round it twice, nodding slow. \u201cAye. That\u2019ll stand.\u201d` },
    };
  }

  buildWallMending(rng) {
    const dales = ['east', 'west', 'north', 'south'];
    const d = dales[(rng() * 4) | 0];
    return {
      id: this.eid(), giver: 'james', arc: false,
      title: 'Gaps in t\u2019 Walls',
      desc: 'T\u2019 field walls out on t\u2019 pastures are full o\u2019 gaps. Lay 6 drystone cobble on top o\u2019 existing wall, anywhere out past t\u2019 village fields.',
      offer: `You can offer the visitor proper work: the drystone walls out on the ${d} pastures are gapped and the sheep will stray. You need 6 courses of cobble laid on existing wall, out beyond the village. You pay fair.`,
      clues: [],
      steps: [{ kind: 'wall', n: 6, objective: 'Mend t\u2019 field walls: lay 6 cobble on existing wall (away frae t\u2019 village)', progress: 0 }],
      stepIdx: 0, state: 'offered', turnIn: 'james',
      reward: { items: [[I.IRON_INGOT, 2]], trust: [['james', 4]], text: '\u201cA neat bit o\u2019 walling, that. Tha\u2019s got Yorkshire in thee somewhere.\u201d' },
    };
  }

  buildDelivery(rng) {
    let spot = DELIVER_SPOTS[(rng() * DELIVER_SPOTS.length) | 0];
    let x = spot.x, z = spot.z;
    if (spot.abbey) { const ab = this.geo.abbeySite(); x = ab.x + 8; z = ab.z + 3; }
    return {
      id: this.eid(), giver: 'board', arc: false,
      title: `Parcel for ${spot.name}`,
      desc: `NOTICE: parcel wants carrying to ${spot.name}. Payment on delivery. Mind t\u2019 weather an\u2019 t\u2019 bogs.`,
      offer: null, clues: [],
      steps: [{ kind: 'visit', x, z, r: 10, requireItem: I.PARCEL, effect: 'deliver', objective: `Carry t\u2019 parcel to ${spot.name}`, progress: 0 }],
      stepIdx: 0, state: 'offered', turnIn: 'auto', grantOnAccept: [[I.PARCEL, 1]],
      reward: { items: [[I.IRON_INGOT, 1], [I.COOKED_GROUSE, 2]], trust: [['james', 2]], text: 'Delivered! T\u2019 payment were left under a stone, as promised.' },
    };
  }

  buildHunt(rng) {
    const boggart = rng() < 0.6;
    return {
      id: this.eid(), giver: 'board', arc: false,
      title: boggart ? 'Boggarts on t\u2019 Mires' : 'A Barghest Abroad',
      desc: boggart
        ? 'NOTICE: boggarts have been at folk\u2019s wash-lines again. Three o\u2019 t\u2019 blighters seen off will be paid for. They walk at neet.'
        : 'NOTICE: a barghest\u2019s been heard on t\u2019 high moor. A bounty stands for whoever puts it down. At neet, mind \u2014 an\u2019 tek a good sword.',
      offer: null, clues: [],
      steps: [{ kind: 'kill', mob: boggart ? 'boggart' : 'barghest', n: boggart ? 3 : 1,
        objective: boggart ? 'See off 3 boggarts (at neet)' : 'Slay a barghest (at neet)', progress: 0 }],
      stepIdx: 0, state: 'offered', turnIn: 'auto',
      reward: { items: boggart ? [[I.IRON_INGOT, 1]] : [[I.JET_GEM, 1], [I.IRON_INGOT, 1]], trust: [['james', 2]], text: 'T\u2019 bounty\u2019s paid an\u2019 t\u2019 moor sleeps easier.' },
    };
  }

  buildTreasure(rng) {
    const bases = [
      { name: 'the Wainstones', x: WAINSTONES.x, z: WAINSTONES.z },
      { name: 't\u2019 owd kilns', x: KILNS.x, z: KILNS.z },
      { name: 't\u2019 village cross', x: this.geo.village.x, z: this.geo.village.z },
      { name: 't\u2019 white cross', ...findFatBetty(this.geo) },
    ];
    const base = bases[(rng() * bases.length) | 0];
    const paces = 12 + ((rng() * 28) | 0);
    const dirs = ['N', 'S', 'E', 'W'];
    const dir = dirs[(rng() * 4) | 0];
    const dx = dir === 'E' ? paces : dir === 'W' ? -paces : 0;
    const dz = dir === 'S' ? paces : dir === 'N' ? -paces : 0;
    return {
      id: this.eid(), giver: 'board', arc: false,
      title: 'An Owd Treasure Riddle',
      desc: `A yellowed paper pinned wi\u2019 a rusty nail: \u201cFrae ${base.name}, ${TREASURE_RIDDLE_DIRS[dir]}, ${paces} paces \u2014 then dig, an\u2019 what were buried is thine.\u201d`,
      offer: null,
      clues: [{ holder: 'glinda', text: `That riddle\u2019s in my mother\u2019s hand, or I\u2019m a Lancastrian. \u2018${TUNE(dir)}\u2019 means due ${dir === 'N' ? 'north' : dir === 'S' ? 'south' : dir === 'E' ? 'east' : 'west'}. A pace is a block, near enough.` }],
      steps: [{ kind: 'dig', x: base.x + dx, z: base.z + dz, r: 4, effect: 'treasure', objective: 'Solve t\u2019 riddle an\u2019 dig where it leads', progress: 0, riddle: true }],
      stepIdx: 0, state: 'offered', turnIn: 'auto',
      reward: { items: [], trust: [['glinda', 2]], text: 'Thi spade strikes summat... treasure!' },
    };
  }

  dispName(g) {
    return { james: 'Farmer James', glinda: 'Granny Glinda', harry: 'Harry', karen: 'Karen', cc: 'cc', max: 'Max', museum: 't\u2019 Whitby museum' }[g] || g;
  }

  // ---------------- accept / progress / completion ----------------
  accept(inst, fromBoard) {
    if (this.active.length >= 4) {
      this.game.ui.toast('Tha\u2019s got enough on. Finish summat first.');
      return false;
    }
    inst.state = 'active';
    this.active.push(inst);
    if (fromBoard) this.boardOffers = this.boardOffers.filter(q => q.id !== inst.id);
    // clear the offer slot. Stylised/errand givers key offers by the lowercase giver id
    // (== inst.giver); roster-bound quests (folklore + v2 Dracula) key by the NPC's
    // lowercased display name while inst.giver is the cased name — so delete BOTH forms.
    else { delete this.offers[inst.giver]; delete this.offers[(inst.giver || '').toLowerCase()]; }
    if (inst.grantOnAccept) {
      for (const [id, n] of inst.grantOnAccept) this.game.player.addItem(id, n);
      this.game.ui.invDirty = true;
    }
    this.game.ui.toast(`New venture: <b>${inst.title}</b>`, 4500);
    this.game.saveNow(false);
    return true;
  }

  step(inst) { return inst.steps[inst.stepIdx]; }

  // main per-frame progress check
  update(dt) {
    const g = this.game, p = g.player;
    this.updateCroft(dt);
    for (const inst of [...this.active]) {
      if (inst.state !== 'active') continue;
      const s = this.step(inst);
      if (!s) continue;

      if (s.kind === 'visit') {
        const d = Math.hypot(p.pos.x - s.x, p.pos.z - s.z);
        // dusk-or-night gate: from dusk onset (sky t≥0.74) through the night into pre-dawn
        const duskOK = !s.duskOrNight || (g.sky.time >= 0.74 || g.sky.time < 0.18);
        if (d < s.r && (!s.night || g.sky.isNight()) && duskOK && (s.maxY === undefined || p.pos.y < s.maxY)
          && (!s.requireItem || p.countItem(s.requireItem) > 0)) {
          this.stepDone(inst);
        }
      } else if (s.kind === 'collect') {
        s.progress = p.countItem(s.item);
        if (s.progress >= s.n) this.stepDone(inst);
      } else if (s.kind === 'fetch') {
        const dHere = Math.hypot(p.pos.x - s.x, p.pos.z - s.z);
        if (!s.spawned && dHere < s.r) {
          s.spawned = true;
          const h = g.world.gen.height(s.x, s.z);
          g.entities.spawnDrop(s.x + 0.5, h + 1.5, s.z + 0.5, s.item, 1, { big: true });
          g.ui.toast('Summat pale\u2019s caught in t\u2019 heather ower yonder \u2014 follow t\u2019 glint!', 5000);
        }
        // a glint above it so tha can actually find t' thing in deep heather
        if (s.spawned && p.countItem(s.item) === 0) {
          s.beaconT = (s.beaconT || 0) - dt;
          if (s.beaconT <= 0) {
            s.beaconT = 0.9;
            const h = g.world.gen.height(s.x, s.z);
            g.entities.burst(s.x + 0.5, h + 2.6, s.z + 0.5, [255, 232, 150], 5);
            if (dHere < 28) {
              s.chimeT = (s.chimeT || 0) - 0.9;
              if (s.chimeT <= 0) { s.chimeT = 3; g.audio.pickup(); }
            }
          }
        }
        if (p.countItem(s.item) > 0) this.stepDone(inst);
      } else if (s.kind === 'escort') {
        if (!s.spawned && Math.hypot(p.pos.x - s.x, p.pos.z - s.z) < s.r) {
          s.spawned = true;
          const h = g.world.gen.height(s.x, s.z);
          inst.lamb = g.entities.spawnMob('lamb', s.x + 0.5, h + 1.2, s.z + 0.5);
          g.ui.toast('A lamb! It bleats an\u2019 trots ower to thee. Lead it home.', 5000);
        }
        if (inst.lamb) {
          if (inst.lamb.dead) {
            this.fail(inst, 'T\u2019 lamb\u2019s been lost. James\u2019ll not be pleased.');
            continue;
          }
          if (Math.hypot(inst.lamb.pos.x - this.geo.village.x, inst.lamb.pos.z - this.geo.village.z) < 30) {
            this.stepDone(inst);
          }
        }
      } else if (s.kind === 'kill' && s.spawnAt) {
        const d = Math.hypot(p.pos.x - s.spawnAt.x, p.pos.z - s.spawnAt.z);
        const mobType = s.mob || 'greatbarghest';
        const bossAlive = g.entities.mobs.some(m => m.type === mobType && !m.dead);
        const canSpawn = mobType !== 'dracula' || p.countItem(I.HOLY_STAKE) > 0;
        if (canSpawn && d < s.spawnAt.r && (!s.spawnAt.night || g.sky.isNight()) && !bossAlive && !s.bossDown) {
          const h = g.world.gen.height(Math.floor(s.spawnAt.x) + 4, Math.floor(s.spawnAt.z) + 4);
          g.entities.spawnMob(mobType, s.spawnAt.x + 4.5, h + 2, s.spawnAt.z + 4.5);
          if (mobType === 'dracula') {
            g.audio.howl(0.22);
            g.ui.toast('<b>Summat cold</b> draws near on t\u2019 moor... tha feels watched afore tha sees owt.', 7000);
          } else {
            g.audio.howl(0.4);
            g.ui.toast('<b>T\u2019 GREAT BARGHEST</b> rises frae t\u2019 crag, eyes like coals!', 6000);
          }
        }
      }
    }
  }

  stepDone(inst) {
    const s = this.step(inst);
    if (s.effect) this.applyEffect(s.effect, inst, s);
    inst.stepIdx++;
    if (inst.stepIdx >= inst.steps.length) {
      if (inst.turnIn === 'auto') this.finish(inst, null);
      else {
        inst.state = 'return';
        this.game.ui.toast(`Done! Now back to <b>${this.dispName(inst.turnIn)}</b> wi\u2019 t\u2019 news.`, 5000);
      }
    } else {
      this.game.ui.toast(`Next: ${this.step(inst).objective}`, 5000);
    }
    this.game.saveNow(false);
  }

  applyEffect(name, inst, s) {
    const g = this.game, p = g.player;
    const dropAt = (item, n = 1) => g.entities.spawnDrop(p.pos.x, p.pos.y + 1.4, p.pos.z, item, n);
    if (name === 'dropHide') {
      dropAt(I.HIDE_SCRAP);
      g.ui.toast('Caught on t\u2019 crag \u2014 a scrap o\u2019 black hide, cold as t\u2019 grave.', 6000);
      g.audio.growl(0.2);
    } else if (name === 'dropAmuletL') {
      dropAt(I.AMULET_L);
      g.ui.toast('T\u2019 wool sinks into t\u2019 stone... an\u2019 summat gold glints at t\u2019 cross\u2019s foot.', 6000);
    } else if (name === 'dropAmuletR') {
      p.removeItem(I.JET_GEM, 3);
      g.ui.invDirty = true;
      dropAt(I.AMULET_R);
      g.ui.toast('T\u2019 ember flares white! When it dims, summat gold lies in t\u2019 ash.', 6000);
      g.audio.smelt();
    } else if (name === 'dropBell') {
      dropAt(I.BELL_CLAPPER);
      g.ui.toast('Half-buried in t\u2019 sand \u2014 t\u2019 abbey bell\u2019s owd iron tongue!', 6000);
    } else if (name === 'dropHolyWater') {
      dropAt(I.HOLY_WATER);
      g.ui.toast('T\u2019 abbey font drips cold into thi flask \u2014 <b>holy water</b>, blessed on t\u2019 cliff.', 6000);
      g.audio.pickup();
    } else if (name === 'dropSilverToken') {
      dropAt(I.SILVER_TOKEN);
      g.ui.toast('T\u2019 parson presses a <b>blessed silver token</b> into thi hand, cold an\u2019 bright.', 6000);
      g.audio.pickup();
    } else if (name === 'dropWolfsbane') {
      dropAt(I.WOLFSBANE);
      g.ui.toast('Bess snips a sprig o\u2019 <b>wolfsbane</b> \u2014 monkshood \u2014 frae her physic garden. \u201cWear it close.\u201d', 6000);
      g.audio.pickup();
    } else if (name === 'sanctifyBox') {
      // Dracula Slice 2: bless a box of the Count's grave-earth. Consumes 1 holy water if
      // held (the proper rite), but still marks the box for playability if the flask is empty.
      this.boxesSanctified = (this.boxesSanctified || 0) + 1;
      const hadWater = p.countItem(I.HOLY_WATER) > 0;
      if (hadWater) { p.removeItem(I.HOLY_WATER, 1); g.ui.invDirty = true; }
      g.ui.toast(hadWater
        ? `Tha pours holy water on t\u2019 grave-earth \u2014 it hisses an\u2019 goes cold. <b>Box ${this.boxesSanctified} o\u2019 3 sanctified.</b>`
        : `Tha breaks t\u2019 box open \u2014 foreign grave-earth, but no holy water to bless it true. <b>Box ${this.boxesSanctified} o\u2019 3.</b>`, 6000);
      g.audio.pickup();
    } else if (name === 'deliver') {
      p.removeItem(I.PARCEL, 1);
      g.ui.invDirty = true;
    } else if (name === 'treasure') {
      const rng = mulberry32(hash2i(s.x, s.z, this.game.seed) * 1e9 | 0);
      const loot = [[I.JET_GEM, 1 + (rng() * 2 | 0)], [I.IRON_INGOT, 1 + (rng() * 3 | 0)], [I.COAL_LUMP, 2 + (rng() * 4 | 0)]];
      for (const [item, n] of loot) g.entities.spawnDrop(s.x + 0.5, g.world.gen.height(s.x, s.z) + 1.5, s.z + 0.5, item, n);
      g.audio.pickup();
    }
  }

  fail(inst, msg) {
    this.active = this.active.filter(q => q.id !== inst.id);
    this.game.ui.toast(msg, 6000);
    if (!inst.arc) this.addShame(1, 'A job left undone.');
  }

  // hand-in at the giver (chat button)
  turnInFor(villagerName) {
    const n = (villagerName || '').toLowerCase();
    return this.active.find(q => {
      if (q.turnIn === 'auto') return false;
      if (!n.includes(q.turnIn)) return false;
      if (q.state === 'return') return true;
      // gather-style: final step is collect & complete
      const s = this.step(q);
      return s && s.kind === 'collect' && q.stepIdx === q.steps.length - 1 && this.game.player.countItem(s.item) >= s.n;
    });
  }

  completeTurnIn(inst, villager) {
    if (inst.state !== 'return') {
      // consume gathered goods
      const s = this.step(inst);
      if (s && s.kind === 'collect') {
        if (this.game.player.countItem(s.item) < s.n) return;
        inst.stepIdx++;
      }
    }
    if (inst.consume) {
      for (const [id, n] of inst.consume) this.game.player.removeItem(id, n);
    }
    this.finish(inst, villager);
  }

  async finish(inst, villager) {
    this.active = this.active.filter(q => q.id !== inst.id);
    this.completed.push(inst.id);
    this.doneLog.push({
      id: inst.id, title: inst.title, giver: inst.giver,
      doneNote: inst.doneNote || null, day: this.game.sky.day,
      clueHolders: (inst.clues || []).map(c => c.holder),
    });
    if (this.doneLog.length > 14) this.doneLog.shift();
    this.shame = Math.max(0, this.shame - 2);
    const r = inst.reward;
    for (const [id, n] of r.items) {
      const left = this.game.player.addItem(id, n);
      if (left > 0) this.game.dropAtPlayer(id, left);
    }
    this.game.ui.invDirty = true;
    this.game.audio.craft();
    if (villager) villager.chatLog.push({ who: 'sys', text: r.text });
    this.game.ui.toast(`<b>${inst.title}</b> \u2014 done! ${villager ? '' : r.text}`, 7000);
    if (villager && this.game.ui.chatVillager === villager) this.game.ui.renderChatLog();
    // trust rewards through t' brain (best-effort)
    const byName = {};
    for (const m of this.game.entities.mobs) {
      if (m.type === 'villager' && m.charId) byName[m.t.name.toLowerCase()] = m.charId;
    }
    for (const [gname, amount] of r.trust || []) {
      for (const [n, id] of Object.entries(byName)) {
        if (n.includes(gname)) {
          try { await npc.gift(id, null, this.game.playerId(), amount); } catch { /* offline */ }
        }
      }
    }
    this.game.refreshStanding(true);
    // honour (opt-in): only a quest that declares one earns a title + standing boost.
    // Stylised-world quests declare no honour, so this whole block is skipped for them.
    if (inst.honour) {
      if (inst.honour.title) this.earnTitle(inst.honour.title);
      if (inst.honour.standing) await this.bumpStanding(inst.honour.standing);
      if (inst.honour.title) this.game.ui.toast(`Tha’s earned t’ name <b>${inst.honour.title}</b>.`, 5000);
    }
    this.refreshOffers();
    this.game.saveNow(false);
  }

  // ---------------- world hooks ----------------
  onBlockBroken(x, y, z, id) {
    // vandalism in t' village
    const vcol = this.geo.villageColumn(x, z);
    if (vcol && vcol.kind === 'building' && !this.game.player.creative &&
      [B.STONEBRICK, B.THATCH, B.PLANKS, B.WINDOW, B.BENCH, B.RANGE, B.LANTERN, B.BOARD].includes(id)) {
      this.addShame(2, 'That\u2019s somebody\u2019s house tha\u2019s wrecking!');
    }
    // treasure digs
    for (const inst of this.active) {
      const s = this.step(inst);
      if (s && s.kind === 'dig' && inst.state === 'active') {
        const h = this.geo.height(s.x, s.z);
        if (Math.hypot(x - s.x, z - s.z) <= s.r && y <= h && y >= h - 3) this.stepDone(inst);
      }
    }
  }

  onBlockPlaced(x, y, z, id) {
    for (const inst of this.active) {
      const s = this.step(inst);
      if (!s || inst.state !== 'active') continue;
      if (s.kind === 'place' && id === s.block && Math.hypot(x - s.x, z - s.z) <= s.r) {
        this.stepDone(inst);
      } else if (s.kind === 'wall' && id === B.COBBLE) {
        const below = this.game.world.getBlock(x, y - 1, z);
        const farEnough = Math.hypot(x - this.geo.village.x, z - this.geo.village.z) > 55;
        if (below === B.COBBLE && farEnough) {
          s.progress++;
          this.game.ui.toast(`Wall mended: ${s.progress}/${s.n}`, 2500);
          if (s.progress >= s.n) this.stepDone(inst);
        }
      } else if (s.kind === 'build' && s.mats[id] !== undefined) {
        if (Math.hypot(x - s.x, z - s.z) <= s.r) {
          s.placed[id] = (s.placed[id] || 0) + 1;
          s.progress = Object.keys(s.mats).reduce((a, k) => a + Math.min(s.placed[k] || 0, s.mats[k]), 0);
          const left = Object.entries(s.mats)
            .map(([k, n]) => [itemName(+k), n - Math.min(s.placed[k] || 0, n)])
            .filter(([, n]) => n > 0);
          if (left.length) this.game.ui.toast(`Still wanted: ${left.map(([nm, n]) => `${n}\u00d7 ${nm}`).join(', ')}`, 2500);
          if (Object.entries(s.mats).every(([k, n]) => (s.placed[k] || 0) >= n)) this.stepDone(inst);
        }
      }
    }
    // building thi own croft counts whatever tha places there
    this.croftDirty = true;
  }

  onMobKilled(mob) {
    // killing village livestock is shameful
    if ((mob.type === 'sheep' || mob.type === 'lamb') &&
      Math.hypot(mob.pos.x - this.geo.village.x, mob.pos.z - this.geo.village.z) < 60 && !this.game.player.creative) {
      this.addShame(2, 'Tha\u2019s killed one o\u2019 t\u2019 village flock!');
    }
    for (const inst of this.active) {
      const s = this.step(inst);
      if (s && s.kind === 'kill' && inst.state === 'active' && mob.type === s.mob) {
        s.progress++;
        if (s.mob === 'greatbarghest' || s.mob === 'dracula') s.bossDown = true;
        this.game.ui.toast(`${s.objective}: ${Math.min(s.progress, s.n)}/${s.n}`, 3000);
        if (s.progress >= s.n) this.stepDone(inst);
      }
    }
  }

  // ---------------- villager chat integration ----------------
  offerFor(villagerName) {
    const n = (villagerName || '').toLowerCase();
    for (const [g, inst] of Object.entries(this.offers)) {
      if (n.includes(g)) return inst;
    }
    return null;
  }

  // What's true near t' player just now (feeds relevant lore)
  nearTags() {
    const p = this.game.player.pos;
    const tags = [];
    const near = (x, z, r) => Math.hypot(p.x - x, p.z - z) < r;
    if (near(ROSEBERRY.x, ROSEBERRY.z, 90)) tags.push('roseberry');
    if (near(HORCUM.x, HORCUM.z, 110)) tags.push('horcum');
    if (near(KILNS.x, KILNS.z, 90)) tags.push('kilns');
    if (Math.abs(p.x - 60) < 30 && p.z > -420 && p.z < 60) tags.push('road');
    const ab = this.geo.abbeySite();
    if (near(ab.x, ab.z, 90)) tags.push('abbey');
    if (this.geo.inWhitby(p.x, p.z, 10)) tags.push('whitby');
    const betty = findFatBetty(this.geo);
    if (near(betty.x, betty.z, 80)) tags.push('betty');
    if (this.geo.heightRaw(Math.floor(p.x), Math.floor(p.z)) > 33 &&
        this.geo.bogginess(Math.floor(p.x), Math.floor(p.z)) > 0.45) tags.push('bog');
    // active quest targets count as relevant an' all
    for (const inst of this.active) {
      const s = this.step(inst);
      if (!s || s.x === undefined) continue;
      if (Math.hypot(s.x - KILNS.x, s.z - KILNS.z) < 30) tags.push('kilns');
      if (Math.hypot(s.x - betty.x, s.z - betty.z) < 30) tags.push('betty');
      if (Math.hypot(s.x - ROSEBERRY.x, s.z - ROSEBERRY.z) < 40) tags.push('roseberry');
      if (Math.hypot(s.x - ab.x, s.z - ab.z) < 70) tags.push('abbey');
    }
    return tags;
  }

  croftLine() {
    const lines = [
      'The empty croft plot at the south-west corner of the green belongs to the visitor now \u2014 marked out with posts, nothing built yet. If homes or settling down come up, encourage them to build themselves a cottage there.',
      'The visitor has started building on their croft \u2014 first stones and timbers are down. The village is quietly watching with interest.',
      'The visitor\u2019s cottage on the croft has its walls up now. Folk are starting to talk approvingly.',
      'The visitor\u2019s cottage on the croft has a roof on it \u2014 nearly a proper house. The village is impressed.',
      'The visitor has FINISHED their cottage on the croft \u2014 windows, lantern light and all. A proper Moorstead home; the village gave them a housewarming. They belong here now.',
    ];
    return lines[Math.min(this.croftStage, 4)];
  }

  // Everything this villager truthfully knows, assembled fresh every call.
  chatContext(villager) {
    const name = (villager.t.name || '').toLowerCase();
    const parts = [];
    const sIdx = this.standingIndex();

    parts.push(`Village reputation note: the visitor is currently "${STANDINGS[sIdx]}" in the village.` +
      (this.shame > 0 ? ' You have also heard they have caused damage or trouble around the village lately; you are noticeably cooler with them until they make amends, and you may mention what you heard.' : ''));

    // What THIS NPC is doing right now (from the roster sim) — so if the visitor asks, they answer
    // truthfully about their own day or errand instead of improvising something that isn't true.
    if (villager.activity) {
      parts.push(`Right now you are ${villager.activity} If the visitor asks what you are doing, where you are headed, or why, answer truthfully and in character from this; otherwise just let it colour your manner.`);
    }

    // a nosey glance at what the visitor's been up to (inventory, stock, progress)
    // — only on a fresh approach, so they notice it as a greeting, not on every turn
    const fresh = !villager.chatLog || villager.chatLog.filter(m => m.who !== 'sys').length <= 1;
    if (fresh) {
      const activity = buildActivityDigest(this.game);
      if (activity) parts.push(activity);
    }

    // matters o' record: arc progress everyone in t' village knows
    if (this.completed.includes('arc5')) {
      parts.push('Known to the whole village: the visitor forged the old amulet, climbed Roseberry Topping at night and SLEW the Great Barghest that was taking the sheep. They are a hero in Moorstead.');
    }
    if (this.completed.includes('drac5')) {
      parts.push('Known more widely: the visitor faced Count Dracula on the open moor at night with a holy water stake and laid him to rest. The moors are safer after dark now — though barghests and boggarts still walk.');
    } else if (this.completed.includes('drac1')) {
      parts.push('The visitor has been to the Dracula Museum in Whitby and knows how Bram Stoker\'s 1890 visit inspired the story. Count Dracula is still said to walk the moors at night — that matter is NOT settled.');
    }
    if (this.completed.includes('arc1') && !this.completed.includes('arc5')) {
      parts.push('Known to the whole village: a sheep was taken in the night a while back, and the visitor tracked it to the Wainstones, coming back with a scrap of cold black hide. Folk whisper it is a barghest. The matter is not settled yet.');
    }

    // a job they can offer
    const offer = this.offerFor(villager.t.name);
    if (offer && offer.offer) {
      parts.push(offer.offer + ' Bring it up naturally if they ask about work, jobs, news, or anything to do. Do not force it into an unrelated chat.');
    }

    // jobs THEY gave that are still afoot: status + hard truth so they never contradict it
    for (const inst of this.active) {
      if (!name.includes(inst.turnIn === 'auto' ? '\u0000' : inst.turnIn) && !name.includes(inst.giver)) continue;
      const s = this.step(inst);
      const stage = inst.state === 'return'
        ? 'They have DONE the task and just need to come and tell you \u2014 if they mention it, be delighted and wrap it up.'
        : (s ? `They are currently on this part: "${s.objective}".` : '');
      parts.push(`The visitor is in the middle of a job you gave them: "${inst.title}". ${stage}` +
        (inst.truth && inst.state !== 'return' ? ' ' + inst.truth : ''));
    }

    // finished jobs involving them \u2014 settled facts, never to be re-offered
    const mine = this.doneLog.filter(d => name.includes(d.giver) || (d.clueHolders || []).some(h => name.includes(h)));
    for (const d of mine.slice(-2)) {
      parts.push(d.doneNote
        ? `Settled fact (day ${d.day}): ${d.doneNote}`
        : `Settled fact (day ${d.day}): the visitor completed "${d.title}" for ${this.dispName(d.giver)}. It is done; do not offer or request it again.`);
    }

    // clues they hold for other folk's matters
    for (const inst of this.active) {
      for (const c of inst.clues || []) {
        if (c.holder && name.includes(c.holder)) {
          parts.push(`A clue you know about the matter of "${inst.title}" (share it if the visitor asks about it, about the moors, or seems stuck \u2014 in your own voice): ${c.text}`);
        }
      }
    }

    // v2 folklore clues are held by ROLE (roster folk), surfaced for a live/offered quest
    const folkClue = this.folkClueFor(villager.role);
    if (folkClue) {
      parts.push(`A piece of old moor lore you know about "${folkClue.title}" (share it if the visitor asks about the moors, old tales, or seems stuck \u2014 in your own voice, never recite): ${folkClue.text}`);
    }

    // t' croft \u2014 everyone has an opinion on a neighbour's building work
    parts.push(this.croftLine());

    // genuine local knowledge, surfaced only when natural
    const lore = loreFor(villager.t.name, 2, { day: this.game.sky.day, nearTags: this.nearTags(), seed: this.game.seed & 0xff });
    if (lore.length) {
      const intro = 'Things you genuinely know about these moors. Mention one ONLY if the conversation naturally touches on it \u2014 never lecture, never list them, never recite more than one at a time';
      const kidNote = lore.some(l => l.kid) ? ' (you only half-understand these; retell them the way a child would, with total confidence)' : '';
      parts.push(`${intro}${kidNote}:\n- ` + lore.map(l => l.text).join('\n- '));
    }

    let ctx = parts.join('\n');
    if (ctx.length > 2600) ctx = ctx.slice(0, 2600);
    return ctx;
  }

  // ---------------- t' croft ----------------
  scanCroft() {
    const p = this.geo.village.plot;
    const g = this.geo.village.ground;
    const w = this.game.world;
    const WALLS = new Set([B.STONEBRICK, B.COBBLE, B.PLANKS, B.LOG, B.STONE, B.WOOL]);
    let walls = 0, thatchHigh = 0, windows = 0, lanterns = 0, furnishing = 0;
    for (let x = p.x0; x <= p.x1; x++) for (let z = p.z0; z <= p.z1; z++) {
      // skip t' generated corner posts
      const corner = (x === p.x0 || x === p.x1) && (z === p.z0 || z === p.z1);
      for (let y = g + 1; y <= g + 10; y++) {
        const id = w.getBlock(x, y, z);
        if (id === B.AIR) continue;
        if (corner && id === B.LOG && y <= g + 2) continue;
        if (WALLS.has(id)) walls++;
        if (id === B.THATCH && y >= g + 3) thatchHigh++;
        if (id === B.WINDOW) windows++;
        if (id === B.LANTERN) lanterns++;
        if (id === B.BENCH || id === B.RANGE) furnishing++;
      }
    }
    let stage = 0;
    if (walls >= 10) stage = 1;
    if (walls >= 24) stage = 2;
    if (walls >= 24 && thatchHigh >= 10) stage = 3;
    if (stage === 3 && windows >= 1 && lanterns >= 1 && furnishing >= 1) stage = 4;
    return stage;
  }

  async updateCroft(dt) {
    const g = this.game, p = g.player.pos;
    const plot = this.geo.village.plot;
    // a nudge t' first time tha sets foot on thi plot
    if (!this.croftToasted && p.x >= plot.x0 && p.x <= plot.x1 + 1 && p.z >= plot.z0 && p.z <= plot.z1 + 1) {
      this.croftToasted = true;
      g.ui.toast('<b>T\u2019 owd croft is thine.</b> Build thissen a home here \u2014 walls, a thatch roof, a window, a lantern, summat to work at. T\u2019 village is watching wi\u2019 interest.', 9000);
    }
    this.croftTimer -= dt;
    if (!this.croftDirty || this.croftTimer > 0) return;
    this.croftTimer = 4;
    this.croftDirty = false;
    if (Math.hypot(p.x - this.geo.village.x, p.z - this.geo.village.z) > 90) return;
    const stage = this.scanCroft();
    if (stage <= this.croftStage) return;
    this.croftStage = stage;
    const msgs = [
      null,
      'First stones on t\u2019 croft! T\u2019 village has noticed.',
      'Walls up on thi cottage! Folk nod approvingly as they pass.',
      'A roof ower thi head! Nearly a proper home, that.',
      '<b>A PROPER MOORSTEAD HOME!</b> T\u2019 village turns out for thi housewarming!',
    ];
    g.ui.toast(msgs[stage], 7000);
    g.audio.craft();
    if (stage === 4) {
      // housewarming: every villager presses a gift on thee
      const gifts = { james: [I.COOKED_MUTTON, 4], glinda: [B.WOOL, 3], harry: [I.COAL_LUMP, 5], karen: [B.WINDOW, 1], cc: [B.HEATHER, 2], max: [I.BILBERRIES, 2] };
      for (const m of g.entities.mobs) {
        if (m.type !== 'villager') continue;
        const gi = Object.entries(gifts).find(([k]) => m.t.name.toLowerCase().includes(k));
        if (gi) g.entities.spawnDrop(m.pos.x, m.pos.y + 1, m.pos.z, gi[1][0], gi[1][1]);
        if (m.charId) { try { await npc.gift(m.charId, null, g.playerId(), 4); } catch { /* offline */ } }
      }
      g.refreshStanding(true);
    } else {
      // each stage warms t' village a little
      for (const m of g.entities.mobs) {
        if (m.type === 'villager' && m.charId) {
          try { await npc.gift(m.charId, null, g.playerId(), 1); } catch { /* offline */ }
        }
      }
      g.refreshStanding(false);
    }
    g.saveNow(false);
  }

  // ---------------- HUD tracker ----------------
  trackerLines() {
    const p = this.game.player.pos;
    const v = this.geo.village;
    return this.active.map(inst => {
      let s = inst.state === 'return'
        ? { objective: `Back to ${this.dispName(inst.turnIn)} in Moorstead`, x: v.x, z: v.z, r: 10 }
        : this.step(inst);
      if (!s) return null;
      // escorts: once t' lamb's found, t' arrow points home
      let tx = s.x, tz = s.z, cutoff = s.r;
      if (s.kind === 'fetch') cutoff = 5;       // guide thee all t' way in
      if (s.kind === 'escort' && inst.lamb && !inst.lamb.dead) {
        const lambNear = Math.hypot(inst.lamb.pos.x - p.x, inst.lamb.pos.z - p.z) < 24;
        if (lambNear) { tx = v.x; tz = v.z; cutoff = 28; }
        else { tx = inst.lamb.pos.x; tz = inst.lamb.pos.z; cutoff = 4; }
      }
      let where = '';
      if (s.riddle) where = ' \u2014 read t\u2019 riddle';
      else if (tx !== undefined) {
        const dx = tx - p.x, dz = tz - p.z;
        const d = Math.hypot(dx, dz) | 0;
        if (d > cutoff) where = ` \u2014 ${compassDir(dx, dz)} \u00b7 ${d}m`;
      }
      let prog = '';
      if (s.n && s.kind !== 'place') prog = ` (${Math.min(s.progress || 0, s.n)}/${s.n})`;
      return { title: inst.title, text: s.objective + prog + where, arc: inst.arc, dracArc: inst.dracArc };
    }).filter(Boolean);
  }

  // ---------------- persistence ----------------
  serialize() {
    return {
      active: this.active.map(q => ({ ...q, lamb: undefined })),
      completed: this.completed,
      earnedTitles: this.earnedTitles,
      wornTitle: this.wornTitle,
      boxesSanctified: this.boxesSanctified,
      draculaLogTaken: this.draculaLogTaken,
      doneLog: this.doneLog,
      offers: this.offers,
      boardOffers: this.boardOffers,
      croftStage: this.croftStage,
      croftToasted: this.croftToasted,
      shame: this.shame,
      lastShameDay: this.lastShameDay,
      errandSerial: this.errandSerial,
      lastOfferDay: this.lastOfferDay,
    };
  }

  deserialize(d) {
    if (!d) return;
    this.active = d.active || [];
    this.completed = d.completed || [];
    this.earnedTitles = d.earnedTitles || [];   // default [] for old saves
    this.wornTitle = d.wornTitle || null;        // default null for old saves
    this.boxesSanctified = d.boxesSanctified || 0;  // default 0 for old saves (Dracula Slice 2)
    this.draculaLogTaken = !!d.draculaLogTaken;      // default false for old saves (Dracula Slice 3)
    this.doneLog = d.doneLog || [];
    this.offers = d.offers || {};
    this.boardOffers = d.boardOffers || [];
    this.croftStage = d.croftStage || 0;
    this.croftToasted = !!d.croftToasted;
    this.shame = d.shame || 0;
    this.lastShameDay = d.lastShameDay || 1;
    this.errandSerial = d.errandSerial || 0;
    this.lastOfferDay = d.lastOfferDay || {};
    // respawn escort lambs lazily: mark un-spawned so t' lamb reappears
    for (const inst of this.active) {
      const s = this.step(inst);
      if (s && s.kind === 'escort') s.spawned = false;
    }
    this.refreshOffers();
  }
}

function TUNE(dir) {
  return TREASURE_RIDDLE_DIRS[dir];
}
