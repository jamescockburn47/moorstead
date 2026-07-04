// src/parlour.js — Workstream D3: the parlour fills of an evening. Pure module,
// no THREE/DOM — callable headlessly (scripts/verify-inn-parlour.mjs) and from
// roster.js's client-side update loop. Everything here is COSMETIC placement
// (like roster.js's `_spread`), not brain state — see the D3 plan doc's
// "settled decisions" note. Truthfulness holds because roster.js relabels the
// NPC's activityShort to match wherever it's actually drawn.
//
// idHash lives HERE (not roster.js) so this module stays free of roster.js's
// THREE-adjacent imports (world.js, defs.js) while still sharing the exact
// same stable FNV-1a hash roster.js's `_spread`/`idHash` used before this task.
// roster.js now imports idHash FROM here and re-exports it, so there is a
// single source of truth for the hash (see roster.js's import + re-export).

// relCell resolves the door-relative (f,l) undercroft frame to world coords — the
// same one worldgen.js carves in. Pure (no THREE), so this module stays headless.
import { relCell } from './innplan.js';

// stable FNV-1a over a string — deterministic run-to-run (Math.imul keeps it 32-bit).
// (moved from roster.js 2026-07-03 — same algorithm, single source now.)
export function idHash(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// --- opening hours (handoff §3/§4: opens after the dinner bell, shut mornings,
// open through the night) ---
const CLOSE_FROM = 0.20;   // morning-shut window starts
const CLOSE_TO = 0.54;     // ~13:00 — opens after the dinner bell
export function innOpen(skyTime) {
  return !(skyTime >= CLOSE_FROM && skyTime < CLOSE_TO);
}

// --- the crowd window: folk drift in from early evening, gone before dawn.
// Deliberately wider than dayPhase's 'home' (0.78) so the pub fills BEFORE
// folk vanish indoors. ---
export function eveningAtInn(skyTime) {
  return skyTime >= 0.70 || skyTime < 0.15;
}

// --- D6: the relay-night window a quorum vote (or, solo, a lone kip) can pass
// through. Matches worldsvc's own [0.95, 0.20) window exactly (see the D6 relay
// handoff) — deliberately wraps midnight, so it's `>= 0.95 || < 0.20`, not a
// plain range compare. Pure + exported so verify-inn-notes can pin the boundaries.
export function sleepWindow(skyTime) {
  return skyTime >= 0.95 || skyTime < 0.20;
}

// --- D6: what waking up does to the player, split by whether they were
// sheltered in a parlour (rewarded) or caught outside when the neet turned
// (mildly punished — NEVER a kill, per the plan). Pure: takes the player's
// hunger/temperature and returns the DELTAS/targets the caller applies, so
// this is headlessly testable without a Player/THREE/DOM.
//   inParlour: fatigue -> 0, temperature -> 20 (warmed through, comfortable)
//   outside:   hunger -4 (floor 1, never starves 'em to 0), temperature -> min(temp, 4) (nithered)
export function wakeOutcome(inParlour, { hunger, temperature }) {
  if (inParlour) {
    return { fatigue: 0, temperature: 20, hunger };
  }
  return { fatigue: null, temperature: Math.min(temperature, 4), hunger: Math.max(1, hunger - 4) };
}

// --- D6: t' inn notes board caps — mirrors t' relay's own limits exactly (see
// the D6 relay handoff: notepost errs 'empty'/'cap'/'boardfull' at these same
// numbers), so a SOLO world's local board behaves identically to a shared one.
export const NOTE_MAX_LEN = 160;
export const NOTE_CAP_PER_PLAYER = 2;
export const NOTE_CAP_BOARD = 24;

// Pure: given the board's current notes, a poster's pid/name and raw text,
// returns either { notes: [...] } (the new list, note appended) or
// { error: 'empty'|'cap'|'boardfull' } — never throws, never mutates its
// argument. Used by BOTH the solo-world local board (main.js, localStorage-
// backed) and this file's own verify script; the relay enforces the identical
// rule server-side for shared worlds; this is the client-side mirror.
export function postLocalNote(notes, pid, name, text, ts) {
  const clean = String(text || '').trim().slice(0, NOTE_MAX_LEN);
  if (!clean) return { error: 'empty' };
  const mine = notes.filter(n => n.pid === pid).length;
  if (mine >= NOTE_CAP_PER_PLAYER) return { error: 'cap' };
  if (notes.length >= NOTE_CAP_BOARD) return { error: 'boardfull' };
  const id = (ts || Date.now()) + '-' + Math.random().toString(36).slice(2, 8);
  return { notes: [...notes, { id, pid, name, text: clean, ts: ts || Date.now() }] };
}

// Pure: remove a note by id, but only if `pid` is its poster (mirrors the
// relay's poster-only pull rule). Returns the same array (no-op) if the note
// isn't found or isn't owned by `pid`.
export function pullLocalNote(notes, pid, id) {
  const n = notes.find(x => x.id === id);
  if (!n || n.pid !== pid) return notes;
  return notes.filter(x => x.id !== id);
}

export const PARLOUR_CAP = 5;

// Which NPCs go to the pub tonight, for this village/inn (`salt`). Deterministic,
// stable across frames/calls for the same (ids, salt): each id gets a threshold
// draw from its own hash (salted per-village so the same body isn't drinking in
// every parish at once), then the whole set is capped at PARLOUR_CAP by taking
// the lowest-hash ids first (a stable, order-independent tiebreak — NOT array
// order, so callers can pass ids in any order and still agree on who's in).
// ~75% of ids fancy a pint of an evening. Deliberately generous (D3 proof pass
// 2026-07-04: at 25%, Grosmont's 7-strong roster drew ~2 candidates and both
// could be mid-journey — an empty pub most nights). PARLOUR_CAP and travel
// state thin the room naturally: only 'at'-home folk actually sit, so trains
// arriving through the evening deliver drinkers as they get home.
const CROWD_THRESHOLD = 0xC0000000;
export function parlourCrowd(ids, salt) {
  const candidates = [];
  for (const id of ids) {
    const h = idHash(id + '|parlour|' + salt);
    if (h < CROWD_THRESHOLD) candidates.push({ id, h });
  }
  candidates.sort((a, b) => a.h - b.h || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return candidates.slice(0, PARLOUR_CAP).map(c => c.id);
}

// A seated/standing spot for the occupant at this INDEX within tonight's crowd
// (0..PARLOUR_CAP-1). Indices 0..3 -> the settle beside each of the 4 game tables
// (`plan.furnish.benches[i]`, carrying that table's `game` from `plan.parlour.tables[i]`
// — 2 in the Tap Room, 2 in the Games Room); index 4 (and overflow, wrapped) -> one
// of 2 standing spots at the servery hatch. Door-relative (f,l) -> world; y=floorY+1.
export function parlourSeatFor(index, plan) {
  const fY = plan.parlour.floorY;
  const rc = (f, l) => relCell(plan.origin, plan.doorSide, f, l);
  const benches = plan.furnish.benches;
  const tables = plan.parlour.tables;
  if (index >= 0 && index < benches.length) {
    const w = rc(benches[index].f, benches[index].l);
    return { x: w.x, y: fY + 1, z: w.z, table: true, game: tables[index].game };
  }
  // standing spots at the servery hatch, one step into the Tap Room (−l from the
  // counter) at the hatch's two cells — the same cells the worldgen leaves clear.
  const sv = plan.furnish.servery;
  const standIdx = (index - benches.length) % 2; // wraps beyond cap+overflow
  const cell = standIdx === 0 ? { f: sv.f, l: sv.l - 1 } : { f: sv.f + 1, l: sv.l - 1 };
  const w = rc(cell.f, cell.l);
  return { x: w.x, y: fY + 1, z: w.z, table: false, game: null };
}

// Is `pos` inside the undercroft? A UNION of the actual room rectangles (NOT one
// bounding box — the warren is L/T-shaped, so a bounding box would read true in the
// concave rock corners), covering the main level and down into the sunken vault.
// Each room's (f,l) box rotates to an axis-aligned world x/z box (relCell is a 90°
// rotation, so min/max of two opposite corners suffice). Excludes the surface hut
// by the y-band. Read every frame for warmth/sleep/murmur/games gating.
export function playerInParlour(pos, plan) {
  if (!pos || !plan || !plan.parlour || !plan.parlour.rooms) return false;
  const { floorY, h: ph, vaultFloorY } = plan.parlour;
  if (pos.y < (vaultFloorY || floorY) || pos.y > floorY + ph + 1) return false;
  const px = Math.floor(pos.x), pz = Math.floor(pos.z);
  for (const r of plan.parlour.rooms) {
    const a = relCell(plan.origin, plan.doorSide, r.f0, r.l0);
    const b = relCell(plan.origin, plan.doorSide, r.f1, r.l1);
    if (px >= Math.min(a.x, b.x) && px <= Math.max(a.x, b.x)
      && pz >= Math.min(a.z, b.z) && pz <= Math.max(a.z, b.z)) return true;
  }
  return false;
}

// Period Yorkshire pub murmur — weather, t' trains, iron, sheep, t' fire, t' ale.
// No anachronisms, no named real people. Calibrated against villagerlife.js's
// GREET/GREET_EVENING voice (dialect: "tha", "owt", "nowt", "t'", dropped g's).
export const MURMUR_LINES = [
  "Bitter out tonight — glad I'm not on t' moor.",
  "T' seven o'clock were late again, mark my words.",
  "Iron's fetchin' a fair price at Grosmont this month.",
  "Lost three yows to t' bracken this week, I have.",
  "Get thi'sen nearer t' fire, lad, tha's froze.",
  "Ale's better this batch — landlord's got t' knack back.",
  "Rain's set in for t' night, by t' sound of it.",
  "T' line were up half a day wi' a fallen tree.",
  "My old dog won't go near t' beck after dark.",
  "Heard tell o' fog rollin' in off t' coast.",
  "Shepherd says lambin's early this year.",
  "Fire's low — someone fetch another log, eh?",
  "T' engine were fair thunderin' through t' cutting.",
  "Nowt like a warm hearth after a day on t' tops.",
  "Wool prices are up, so t' farmers tell me.",
  "Card's dealt — who's for another hand?",
];

// verify-time sanity: idHash exists as a named export above; nothing else to
// initialise here — this module has no side effects at import time.
