// festive.js — pure winter/Christmas gating. No DOM, no three.js.
import { festivalState } from './festivals.js';

// Broad cold season: snow lies underfoot, snowballs can be scooped, snowmen
// persist. This is exactly the old `festiveActive` threshold (frost > 0.35).
export function wintry(season) { return !!season && season.frost > 0.35; }

// Narrow Christmastide: the carol + Christmas dressing only. A strict subset of
// `wintry` (asserted in tests), so narrowing it never breaks snow play.
export function yuletide(season) { return !!season && festivalState(season.yearPhase).yule > 0.5; }

// Auto-snowmen need the deepest snow.
export function deepSnow(snowAccum) { return (snowAccum || 0) > 0.85; }

// Snowmen melt in the spring thaw — keyed to the broad cold season, not
// Christmas, so they last all winter.
export function snowmanMelted(season) { return !wintry(season); }
