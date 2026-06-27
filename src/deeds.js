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

// Build a deed record — the one place claim/mine deeds are shaped, shared by every
// staking path (paid board-stake AND free starting tokens). `opts.seq` (e.g. the
// current deed count) keeps ids distinct within a single game-day batch.
export function makeDeed(kind, by, cx, cz, day, opts = {}) {
  const radius = kind === 'mine' ? 5 : (opts.radius ?? 8);
  const depth = kind === 'mine' ? (opts.depth ?? 20) : 0;
  return {
    id: 'd' + Math.round(day * 1000) + '_' + (opts.seq || 0),
    kind, by: by || '', cx, cz, radius, depth,
    paidUntilDay: day + DEED.week, lapsedDay: null,
  };
}

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

// Is this deed subject to upkeep-lapse? A child's land CLAIM never lapses — kids can't
// manage weekly upkeep and shouldn't lose their homestead. Mines (and everything in the
// adult world) still lapse if neglected, so the decay economy stays intact elsewhere.
export function lapsesUnderUpkeep(deed, bairns) {
  return !(bairns && deed && deed.kind === 'claim');
}

export function findActiveDeed(deeds, x, z, kind = null) {
  return (deeds || []).find(d => d && !d.lapsedDay && (!kind || d.kind === kind) &&
    (x - d.cx) ** 2 + (z - d.cz) ** 2 <= d.radius * d.radius);
}

export function findLapsedDeed(deeds, x, z, kind = null) {
  return (deeds || []).find(d => d && d.lapsedDay && (!kind || d.kind === kind) &&
    (x - d.cx) ** 2 + (z - d.cz) ** 2 <= d.radius * d.radius);
}

// Is (x,z) inside an ACTIVE (un-lapsed) deed — optionally of a given kind? Cylinder test.
export function inDeed(deeds, x, z, kind = null) {
  return !!findActiveDeed(deeds, x, z, kind);
}

// Has a deed lapsed? Past its paid-up day plus the grace window.
export function isLapsed(deed, nowDay, grace = DEED.grace) {
  return nowDay > deed.paidUntilDay + grace;
}
