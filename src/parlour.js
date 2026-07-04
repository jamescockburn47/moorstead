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
// (0..PARLOUR_CAP-1 — the deterministic order parlourCrowd returns, so distinct
// occupants always land on distinct cells; pure per-id hashing can collide on a
// shared seat, which the plan doc rules out). Indices 0..3 -> the bench beside
// each of the 4 game tables (`plan.furnish.benches[i]`, carrying that table's
// `game` from `plan.parlour.tables[i]`); index 4 (and any overflow, wrapped) ->
// one of 2 standing spots near the servery. World coords; y = floorY + 1.
export function parlourSeatFor(index, plan) {
  const { floorY, w: pw, l: pl } = plan.parlour;
  const ix0 = plan.origin.x - Math.floor(pw / 2), iz0 = plan.origin.z - Math.floor(pl / 2);
  const toWorld = (local) => ({ x: ix0 + local.x, y: floorY + 1, z: iz0 + local.z });

  const benches = plan.furnish.benches;
  const tables = plan.parlour.tables;
  if (index >= 0 && index < benches.length) {
    const w = toWorld(benches[index]);
    return { x: w.x, y: w.y, z: w.z, table: true, game: tables[index].game };
  }
  // standing spots: two cells one step OUT from the servery counter (toward
  // room centre), offset ±1 along z. Checked against every occupied cell
  // (benches, tables, hearth) so a standing spot can never land on a seat
  // regardless of how the plan's numbers happen to fall — the fixed servery.x-1
  // offset alone collided with bench[1] on the real Grosmont plan (both landed
  // on local {8,3}), so this scans a small ring instead of trusting one offset.
  const servery = plan.furnish.servery;
  const occupied = new Set();
  for (const b of benches) occupied.add(b.x + ',' + b.z);
  for (const t of tables) occupied.add(t.x + ',' + t.z);
  occupied.add(plan.parlour.hearth.x + ',' + plan.parlour.hearth.z);
  const standIdx = (index - benches.length) % 2; // wraps if ever asked beyond cap+overflow
  const candidates = [
    { x: servery.x - 1, z: servery.z + (standIdx === 0 ? -1 : 1) },
    { x: servery.x - 1, z: servery.z + (standIdx === 0 ? -2 : 2) },
    { x: servery.x - 2, z: servery.z + (standIdx === 0 ? -1 : 1) },
    { x: servery.x - 1, z: servery.z },
  ];
  let standLocal = candidates.find(c =>
    c.x >= 0 && c.x < pw && c.z >= 0 && c.z < pl && !occupied.has(c.x + ',' + c.z));
  if (!standLocal) standLocal = candidates[0]; // shouldn't happen on any real plan; fall back rather than throw
  const w = toWorld(standLocal);
  return { x: w.x, y: w.y, z: w.z, table: false, game: null };
}

// Is `pos` inside the parlour interior, at parlour depth? y within
// floorY..floorY+h (the hollowed clear space), x/z within the interior bounds
// (the same box parlourSeatFor places bodies in).
export function playerInParlour(pos, plan) {
  if (!pos || !plan) return false;
  const { floorY, w: pw, l: pl, h: ph } = plan.parlour;
  const ix0 = plan.origin.x - Math.floor(pw / 2), iz0 = plan.origin.z - Math.floor(pl / 2);
  const ix1 = ix0 + pw - 1, iz1 = iz0 + pl - 1;
  return pos.x >= ix0 && pos.x <= ix1 && pos.z >= iz0 && pos.z <= iz1
    && pos.y >= floorY && pos.y <= floorY + ph;
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
