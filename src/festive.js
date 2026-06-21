// festive.js — pure winter-festive gating. No DOM, no three.js.
// The whole winter is festive; auto-snowmen need the deepest snow; player snowmen melt in the thaw.
export function festiveActive(season) { return !!season && season.frost > 0.35; }
export function deepSnow(snowAccum) { return (snowAccum || 0) > 0.85; }
export function snowmanMelted(season) { return !festiveActive(season); }
