// Freeze the item-name vocabulary into brain-sync/ so the EVO brain can validate
// trade/gift facts against REAL items (memory hygiene: no junk names in NPC memory).
// Names are normalised the same two ways main.js does before they reach the brain:
//   trade (recordTrade, main.js): lowercase, strip a leading 'raw '/'roast '.
//   gift  (giveGift,   main.js): trade norm + strip a trailing '(...)' suffix,
//                                bilberries->bilberry, strip a trailing ' bush'.
// We export the union of BOTH forms of every display name, so whatever the client
// actually sends is in the list. Deterministic (sorted, LF) — verify-facts-card.mjs
// regenerates and byte-compares to catch a stale committed copy.
import { writeFileSync } from 'node:fs';
import { ITEM_NAMES, BLOCKS } from '../src/defs.js';

const tradeNorm = n => String(n).toLowerCase().replace(/^(raw|roast)\s+/, '');
const giftNorm = n => tradeNorm(n)
  .replace(/\s*\(.*\)$/, '').replace('bilberries', 'bilberry').replace(/\s+bush$/, '');

const names = new Set();
const add = (n) => { if (!n || n === '?') return; names.add(tradeNorm(n)); names.add(giftNorm(n)); };
for (const n of Object.values(ITEM_NAMES)) add(n);
for (const b of Object.values(BLOCKS)) if (b && b.name && b.kind !== 'air') add(b.name);

writeFileSync(new URL('../brain-sync/items.json', import.meta.url),
  JSON.stringify([...names].sort(), null, 1) + '\n');
console.log(`exported ${names.size} item names`);
