// trainfolk.js — local folk who board the Moors train between their stops.
// They make the carriage feel lived-in, strike up a natter, and now and then
// drop a tip or hand you a parcel to see down the line. All client-side: works
// with the village brain off (a canned Yorkshire voice) or on (the roster's
// real persona, so the chat comes alive and trust counts).
import { mulberry32 } from './noise.js';

const GREET = [
  "Now then. Room for a little 'un?",
  "Ayup. Grand day for t' line, in't it?",
  "Mind if I sit? Me feet's fair killin' me.",
  "Eh up, a fresh face — where's tha bound?",
  "Settle thi sen down, we've a fair way yet.",
  "By 'eck it's parky out on them tops. Shift up.",
];

// chatter = the insights, lore an' tips tha overhears — the reason to natter.
// Each one quietly points at another bit o' the world.
const CHATTER = [
  "Tha wants Rosedale way for jet — t' owd kilns. Dig deep an' tha'll strike it, black as neet.",
  "Curlews are back ower t' moor — that's t' true start o' lambin', me granddad allus said.",
  "Whitby's where they carve t' jet into jewellery. Fetches a pretty penny, that does.",
  "Don't go whistlin' on t' moor at dusk, love — tha'll call summat tha can't un-call.",
  "Market day's at Pickering — best spot to shift owt tha's made or grown.",
  "Bilberries come on under t' heather in late summer. Purple fingers for a week, mind.",
  "They reckon a girt black hound walks t' moor at first leet. T' Barghest. I've seen its prints.",
  "Get soaked through up here an' tha'll clem — keep a fire lit an' tha'll dry off sharpish.",
  "T' Hob'll do thi chores by neet if tha leaves him be. But never thank him, or he's off for good.",
  "Up Staithes way t' owd smugglers ran their goods cottage to cottage, cellar to cellar.",
  "Three heathers on t' moor, not one — when they all bloom at once in August she goes purple.",
  "If tha's after good stone for buildin', t' dressed sort comes frae t' mason, not t' ground.",
];

const PARCELS = [
  'a crate o’ carved jet',
  'a basket o’ fresh eggs',
  'a parcel done up in brown paper',
  'a churn o’ milk for t’ dairy',
  'a sack o’ seed potatoes',
  'a bundle o’ wool for t’ mill',
];

const pick = (arr, rng) => arr[(rng() * arr.length) | 0];

// Build a passenger from a seed. roster = [{id,name,village}]; toName = where
// they're bound (so a parcel has somewhere to go).
export function boardingFolk(seedNum, roster, toName) {
  const rng = mulberry32(seedNum >>> 0);
  const person = (roster && roster.length) ? pick(roster, rng) : { id: null, name: 'a traveller' };
  return {
    name: person.name,
    charId: person.id || null,
    greet: pick(GREET, rng),
    tip: pick(CHATTER, rng),
    canned: [pick(CHATTER, rng), pick(CHATTER, rng), "Aye... that's t' way of it.", "Mmm. Can't say fairer."],
    parcel: rng() < 0.4 ? pick(PARCELS, rng) : null,
    parcelTo: toName || null,
  };
}
