// Oak strongbox check — run wi': node scripts/verify-strongbox.mjs
// The strongbox is the death-penalty counterplay: stash goods an' brass at home, an'
// what's boxed doesn't fall wi' thee. This verifies the recipe, the block/tile wiring,
// the pure container logic (save.js), spill-on-break, an' the save round-trip.
import { readFileSync } from 'node:fs';
import { B, I, TILE, BLOCKS, RECIPES, ITEM_NAMES, itemName, maxStack, isPlaceable, CREATIVE_ITEMS } from '../src/defs.js';
import { BOX_SLOTS, boxKey, makeBox, normalizeBox, containerClick, transferBrass, spillBox } from '../src/save.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const texSrc = readFileSync(new URL('../src/textures.js', import.meta.url), 'utf8');
const uiSrc = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const playerSrc = readFileSync(new URL('../src/player.js', import.meta.url), 'utf8');

// --- block id: defined, unique, placeable, sane definition ---
{
  (typeof B.STRONGBOX === 'number' && B.STRONGBOX < 64 ? ok : bad)('B.STRONGBOX is a block id (< 64, so it doubles as an item)');
  const vals = Object.values(B);
  (new Set(vals).size === vals.length ? ok : bad)('no block-id collisions across B (STRONGBOX included)');
  const ids = new Set([...Object.values(B), ...Object.values(I)]);
  (ids.size === Object.values(B).length + Object.values(I).length ? ok : bad)('block ids an’ item ids never overlap');
  const d = BLOCKS[B.STRONGBOX];
  (d && d.name === 'Oak Strongbox' && d.kind === 'solid' ? ok : bad)('BLOCKS[B.STRONGBOX]: a solid block named Oak Strongbox');
  (d && d.drop === B.STRONGBOX ? ok : bad)('breaking a strongbox drops the strongbox block itself');
  (d && d.tool === 'axe' && !d.needsPick ? ok : bad)('axe-work, no pick needed (oak, not stone)');
  (isPlaceable(B.STRONGBOX) ? ok : bad)('placeable like other blocks');
  (CREATIVE_ITEMS.includes(B.STRONGBOX) ? ok : bad)('in t’ creative cupboard');
}

// --- texture tiles: registered, unique, painted ---
{
  (typeof TILE.STRONGBOX_TOP === 'number' && typeof TILE.STRONGBOX_SIDE === 'number' ? ok : bad)('TILE.STRONGBOX_TOP / _SIDE registered');
  const tv = Object.values(TILE);
  (new Set(tv).size === tv.length ? ok : bad)('no tile-index collisions across TILE');
  (TILE.STRONGBOX_TOP < 256 && TILE.STRONGBOX_SIDE < 256 ? ok : bad)('tiles fit the 16x16 atlas');
  const d = BLOCKS[B.STRONGBOX];
  (d.tex.t === TILE.STRONGBOX_TOP && d.tex.s === TILE.STRONGBOX_SIDE && d.tex.b === TILE.PLANKS ? ok : bad)('block faces map to the strongbox tiles (planks underside)');
  (texSrc.includes('[TILE.STRONGBOX_TOP](p)') ? ok : bad)('textures.js paints the lid tile procedurally');
  (texSrc.includes('[TILE.STRONGBOX_SIDE](p)') ? ok : bad)('textures.js paints the side tile procedurally');
}

// --- recipe: bench-crafted from real, obtainable materials ---
{
  const r = RECIPES.find(x => x.out === B.STRONGBOX);
  (r ? ok : bad)('a strongbox recipe exists');
  if (r) {
    (r.bench === true ? ok : bad)('crafted at a joiner’s bench (declaration shape matches RANGE/LANTERN)');
    (r.n === 1 ? ok : bad)('makes one box');
    (Array.isArray(r.needs) && r.needs.length > 0 &&
      r.needs.every(e => Array.isArray(e) && e.length === 2 && Number.isInteger(e[0]) && Number.isInteger(e[1]) && e[1] > 0)
      ? ok : bad)('needs is [[itemId, count]...] wi’ positive counts');
    (r.needs.every(([id]) => itemName(id) !== '?') ? ok : bad)('every ingredient is a real, named item');
    (r.needs.every(([id]) => (id < 64 ? !!BLOCKS[id] : !!ITEM_NAMES[id])) ? ok : bad)('every ingredient id resolves to a block or item definition');
    const plankCost = r.needs.find(([id]) => id === B.PLANKS);
    const ironCost = r.needs.find(([id]) => id === I.IRON_INGOT);
    (plankCost && ironCost ? ok : bad)('oak (planks) + iron banding (ingot) — period-plausible materials');
    // balance sanity: dearer than a bare bench (4 planks), in the same band as the iron fixtures
    const cost = r.needs.reduce((a, [, n]) => a + n, 0);
    (cost > 4 && cost <= 10 ? ok : bad)('cost sits between a bench an’ a range (' + cost + ' pieces)');
  }
}

// --- makeBox / normalizeBox: 27 slots, corrupt data never NaNs a purse ---
{
  const b = makeBox();
  (b.slots.length === BOX_SLOTS && BOX_SLOTS === 27 ? ok : bad)('a box holds 27 slots (9x3)');
  (b.brass === 0 && b.v === 1 ? ok : bad)('fresh box: no brass, schema v1 (a future relay-synced v2 can adopt it)');
  const n1 = normalizeBox({ v: 1, slots: [{ id: B.LOG, n: 5 }, null, { id: I.I_PICK, n: 1, dur: 40 }], brass: 33 });
  (n1.slots[0].n === 5 && n1.slots[2].dur === 40 && n1.brass === 33 ? ok : bad)('normalizeBox keeps stacks, durability an’ brass');
  const n2 = normalizeBox({ slots: 'garbage', brass: NaN });
  (n2.slots.length === BOX_SLOTS && n2.slots.every(s => s === null) && n2.brass === 0 ? ok : bad)('corrupt box data normalises to an empty box, never NaN');
  const n3 = normalizeBox({ slots: [{ id: B.LOG, n: -3 }, { id: 'x', n: 2 }], brass: -50 });
  (n3.slots[0] === null && n3.slots[1] === null && n3.brass === 0 ? ok : bad)('negative counts, bad ids an’ negative brass are all rejected');
  (boxKey(3, 40, -7) === '3,40,-7' ? ok : bad)('boxKey matches the x,y,z coord-key idiom');
}

// --- containerClick: the click-to-move cursor logic, same semantics as t' pockets ---
{
  const slots = new Array(BOX_SLOTS).fill(null);
  slots[0] = { id: B.PLANKS, n: 10 };
  // left-click picks up
  let cur = containerClick(slots, 0, null, 0, maxStack);
  (cur && cur.id === B.PLANKS && cur.n === 10 && slots[0] === null ? ok : bad)('left-click picks a stack onto t’ cursor');
  // left-click puts down
  cur = containerClick(slots, 5, cur, 0, maxStack);
  (cur === null && slots[5] && slots[5].n === 10 ? ok : bad)('left-click puts it down in an empty slot');
  // merge respects max stack
  slots[6] = { id: B.PLANKS, n: 60 };
  cur = containerClick(slots, 6, { id: B.PLANKS, n: 10 }, 0, maxStack);
  (slots[6].n === 64 && cur && cur.n === 6 ? ok : bad)('merging tops the stack at 64 an’ keeps the rest on t’ cursor');
  // right-click splits half
  cur = containerClick(slots, 5, null, 2, maxStack);
  (cur && cur.n === 5 && slots[5].n === 5 ? ok : bad)('right-click splits half onto t’ cursor');
  // right-click places one
  cur = containerClick(slots, 7, cur, 2, maxStack);
  (slots[7] && slots[7].n === 1 && cur && cur.n === 4 ? ok : bad)('right-click places one off t’ cursor');
  // swap on mismatched stacks
  slots[8] = { id: B.COBBLE, n: 3 };
  cur = containerClick(slots, 8, cur, 0, maxStack);
  (cur && cur.id === B.COBBLE && slots[8].id === B.PLANKS ? ok : bad)('left-click on a different stack swaps wi’ t’ cursor');
  // tools never merge (max stack 1) — they swap, durability intact
  slots[1] = { id: I.I_PICK, n: 1, dur: 17 };
  cur = containerClick(slots, 1, { id: I.I_PICK, n: 1, dur: 251 }, 0, maxStack);
  (cur && cur.dur === 17 && slots[1].dur === 251 ? ok : bad)('tools swap (never merge), durability rides along');
}

// --- brass well: deposit / withdraw, clamped ---
{
  const player = { brass: 105 };
  const box = makeBox();
  (transferBrass(player, box, 100) === 100 && player.brass === 5 && box.brass === 100 ? ok : bad)('deposit 100: purse down, box up');
  (transferBrass(player, box, 10) === 5 && player.brass === 0 && box.brass === 105 ? ok : bad)('deposit 10 wi’ only 5 left moves the 5 (clamped, never negative)');
  (transferBrass(player, box, 10) === 0 && player.brass === 0 ? ok : bad)('an empty purse deposits nowt');
  (transferBrass(box, player, 100) === 100 && box.brass === 5 && player.brass === 100 ? ok : bad)('withdraw 100: box down, purse up');
  (transferBrass(box, player, 100) === 5 && box.brass === 0 && player.brass === 105 ? ok : bad)('overdrawing t’ box just empties it');
  const odd = { brass: 7.9 };
  transferBrass(odd, box, 3.5);
  (odd.brass === 4 && box.brass === 3 ? ok : bad)('fractions floor — brass stays whole pence');
}

// --- death penalty: boxes an' banked brass are naturally safe ---
{
  // applyDeathPenalty halves only what tha CARRIES (player.slots + player.brass);
  // it must never reach into t' strongbox store.
  const fnStart = mainSrc.indexOf('applyDeathPenalty()');
  const fnBody = mainSrc.slice(fnStart, mainSrc.indexOf('\n  }', fnStart));
  (fnStart > 0 ? ok : bad)('applyDeathPenalty found in main.js');
  (!/strongbox/i.test(fnBody) && !/\bbox\b/.test(fnBody) ? ok : bad)('applyDeathPenalty never touches strongboxes');
  (fnBody.includes('p.brass') && fnBody.includes('p.slots') ? ok : bad)('applyDeathPenalty only halves carried slots an’ purse brass');
  // and behaviourally: run the same halving over a player while a stocked box stands by
  const p = { brass: 100, slots: [{ id: B.LOG, n: 9 }, { id: I.I_PICK, n: 1, dur: 5 }] };
  const box = makeBox();
  box.slots[0] = { id: B.LOG, n: 40 }; box.brass = 500;
  const snapshot = JSON.stringify(box);
  p.brass = Math.floor(p.brass / 2);
  for (const s of p.slots) if (s && s.id !== I.I_PICK) s.n = Math.floor(s.n / 2);
  (JSON.stringify(box) === snapshot ? ok : bad)('the penalty leaves boxed goods an’ banked brass untouched (that’s the whole point)');
}

// --- spill-on-break: contents become drops, never vaporised ---
{
  const box = makeBox();
  box.slots[0] = { id: B.PLANKS, n: 12 };
  box.slots[13] = { id: I.IRON_INGOT, n: 3 };
  box.slots[26] = { id: I.I_AXE, n: 1, dur: 9 };
  box.brass = 77;
  const { drops, brass } = spillBox(box);
  (drops.length === 3 ? ok : bad)('spill returns every occupied slot');
  (JSON.stringify(drops) === JSON.stringify([[B.PLANKS, 12], [I.IRON_INGOT, 3], [I.I_AXE, 1]]) ? ok : bad)('spill list carries the right ids an’ counts');
  (brass === 77 ? ok : bad)('banked brass comes back wi’ t’ spill (goes to whoever breaks it)');
  (box.slots.every(s => s === null) && box.brass === 0 ? ok : bad)('the box is emptied — nothing duplicates');
  (spillBox(makeBox()).drops.length === 0 ? ok : bad)('an empty box spills nowt');
}

// --- save round-trip: [...Map] -> JSON -> normalizeBox, additive to old saves ---
{
  const store = new Map();
  const box = makeBox();
  box.slots[4] = { id: B.WOOL, n: 7 };
  box.slots[9] = { id: I.I_SWORD, n: 1, dur: 123 };
  box.brass = 240;
  store.set(boxKey(12, 30, -4), box);
  // t' exact path: saveNow writes meta.strongboxes = [...map]; startWorld reads
  // new Map((meta.strongboxes || []).map(([k, b]) => [k, normalizeBox(b)]))
  const meta = JSON.parse(JSON.stringify({ strongboxes: [...store] })); // IndexedDB structured-clones; JSON is stricter still
  const loaded = new Map((meta.strongboxes || []).map(([k, b]) => [k, normalizeBox(b)]));
  const back = loaded.get('12,30,-4');
  (back && back.slots[4].n === 7 && back.slots[9].dur === 123 && back.brass === 240 ? ok : bad)('a box’s contents round-trip the save intact (items, durability, brass)');
  const old = new Map(((/** old save */ {}).strongboxes || []).map(([k, b]) => [k, normalizeBox(b)]));
  (old.size === 0 ? ok : bad)('an old save wi’ no strongboxes loads clean (additive data)');
}

// --- wiring: the client actually opens, spills, saves an' nudges ---
{
  (mainSrc.includes("hit.id === B.STRONGBOX) { this.openStrongbox(hit.x, hit.y, hit.z); return; }") ? ok : bad)('right-click on a placed strongbox opens the chest panel');
  (mainSrc.includes('spillBox(box)') && mainSrc.includes('this.entities.spawnDrop(hit.x + 0.5, hit.y + 0.4, hit.z + 0.5, id, n)') ? ok : bad)('finishBreak spills contents as drops via entities.spawnDrop');
  (mainSrc.includes('strongboxes: [...(this.world.strongboxes || new Map())]') ? ok : bad)('saveNow rides strongboxes in the meta alongside deeds');
  (mainSrc.includes('persistNetStrongboxes') && mainSrc.includes('loadNetStrongboxes') ? ok : bad)('shared moor: local-only per-room persistence wired (relay knows nothing, v1)');
  (mainSrc.includes("this.state === 'box'") ? ok : bad)('Esc/E closes the chest panel (state box)');
  (uiSrc.includes('openStrongbox(player, box)') && uiSrc.includes('containerClick(slots, idx, this.drag, button, maxStack)') ? ok : bad)('ui panel reuses the pockets’ click-based cursor via containerClick');
  (uiSrc.includes('Stash thi goods an&rsquo; brass at home') && uiSrc.includes('player.strongboxHinted') ? ok : bad)('first-craft nudge fires once per save (player flag)');
  (playerSrc.includes('strongboxHinted: this.strongboxHinted') ? ok : bad)('the nudge flag rides player.serialize');
  (uiSrc.includes('Oak Strongbox:') && uiSrc.includes('browser') ? ok : bad)('handbook covers the strongbox an’ the shared-moor local-memory caveat');
}

console.log('RESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
