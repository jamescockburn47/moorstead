// deeds.js — the pure deeds backbone (no THREE/DOM). A DEED is a small owned holding, kind
// 'claim' (a surface plot that will protect builds, Slice 3) or 'mine' (a shaft envelope that
// will permit deep digging, Slice 4). Both are paid, upkept, and lapse if neglected. This module
// is just the maths: fee, upkeep, cylinder membership, lapse. The store + UI live in world/main/ui.
// Record shape: { id, kind, by, cx, cz, radius, depth, paidUntilDay, lapsedDay }

export const DEED = {
  claimFeeBase: 60, claimFeePerR2: 2,        // a land claim: base + radius² · rate (bigger = dearer)
  mineFeeBase: 120, mineFeePerDepth: 8,      // a mine licence: base + depth · rate
  claimUpkeepPerR: 2, mineUpkeepPerDepth: 1, // brass per game-week, size/depth scaled
  week: 7, grace: 7,                         // game-days: a week's upkeep; the lapse grace (Slice 3 scales it for bairns)
};

// The one-time stake fee, in pence, scaled by size (James: discourage land-grabs on the shared moor).
export function deedFee(kind, radius = 0, depth = 0) {
  if (kind === 'mine') return DEED.mineFeeBase + depth * DEED.mineFeePerDepth;
  return DEED.claimFeeBase + radius * radius * DEED.claimFeePerR2;
}

// Brass owed per game-week to keep a deed alive, floored at 1.
export function weeklyUpkeep(kind, radius = 0, depth = 0) {
  if (kind === 'mine') return Math.max(1, depth * DEED.mineUpkeepPerDepth);
  return Math.max(1, radius * DEED.claimUpkeepPerR);
}

// Is (x,z) inside an ACTIVE (un-lapsed) deed — optionally of a given kind? Cylinder test.
export function inDeed(deeds, x, z, kind = null) {
  return (deeds || []).some(d => d && !d.lapsedDay && (!kind || d.kind === kind) &&
    (x - d.cx) ** 2 + (z - d.cz) ** 2 <= d.radius * d.radius);
}

// Has a deed lapsed? Past its paid-up day plus the grace window.
export function isLapsed(deed, nowDay, grace = DEED.grace) {
  return nowDay > deed.paidUntilDay + grace;
}
