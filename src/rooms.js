// rooms.js — pure room classification (no THREE/DOM). A "free world" is a relaxed-survival
// shared room: builds never crumble, no deeds/licences, deep digging gated only by pick tier,
// and a starter pack in place of the bare-hands wipe. The survival rooms are untouched.
import { B, I } from './defs.js';

// The free-world BASE room names. Shards like 'bairns-free-2' map back to these. Extend later
// with 'moor-free', etc. as more free worlds are added.
export const FREE_ROOMS = new Set(['bairns-free']);

// Strip the relay's shard suffix: 'bairns-free-2' -> 'bairns-free', 'bairns' -> 'bairns'.
export function baseRoom(room) {
  return String(room || '').toLowerCase().replace(/-\d+$/, '');
}

// Is this room (or any shard of it) a relaxed-survival free world?
export function isFreeRoom(room) {
  return FREE_ROOMS.has(baseRoom(room));
}

// Is this room (or any shard of it) the bairns' (children's) survival world?
export function isBairnsRoom(room) {
  return baseRoom(room) === 'bairns';
}

// Is this a children's world (bairns OR the free kids' world)? Used to keep dark content
// (e.g. the Dracula horror arc) out of every room a child might be in, shards included.
export function isChildrensWorld(room) {
  return isBairnsRoom(room) || isFreeRoom(room);
}

// One-time free-world starter pack: enough to dig, chop, build and light up straight away, not
// so much that gathering is pointless. player.addItem sets tool durability automatically.
export const FREE_STARTER = [
  { id: I.W_PICK, n: 1 },
  { id: I.W_AXE, n: 1 },
  { id: I.W_SHOVEL, n: 1 },
  { id: B.PLANKS, n: 32 },
  { id: B.LOG, n: 16 },
  { id: B.TORCH, n: 8 },
];
