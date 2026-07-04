// src/parlour.js — D6 quorum-sleep window, wake-penalty arithmetic, and the
// solo-world local notes board (cap/trim logic) — all pure, no THREE/DOM.
// run wi': node scripts/verify-inn-notes.mjs
import {
  sleepWindow, wakeOutcome, postLocalNote, pullLocalNote,
  NOTE_MAX_LEN, NOTE_CAP_PER_PLAYER, NOTE_CAP_BOARD,
} from '../src/parlour.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// --- sleepWindow: [0.95, 1) U [0, 0.20) — wraps midnight ---
{
  (!sleepWindow(0.94) ? ok : bad)('sleepWindow(0.94) — false (just before the window opens)');
  (sleepWindow(0.95) ? ok : bad)('sleepWindow(0.95) — true (window opens)');
  (sleepWindow(0.99) ? ok : bad)('sleepWindow(0.99) — true (late night)');
  (sleepWindow(0.0) ? ok : bad)('sleepWindow(0.0) — true (midnight itself)');
  (sleepWindow(0.19) ? ok : bad)('sleepWindow(0.19) — true (just before the window closes)');
  (!sleepWindow(0.20) ? ok : bad)('sleepWindow(0.20) — false (window closes)');
  (!sleepWindow(0.5) ? ok : bad)('sleepWindow(0.5) — false (broad daylight)');
}

// --- wakeOutcome: sheltered vs caught outside, NEVER a kill ---
{
  const sheltered = wakeOutcome(true, { hunger: 12, temperature: 6 });
  (sheltered.fatigue === 0 ? ok : bad)('wakeOutcome(inParlour) — fatigue resets to 0');
  (sheltered.temperature === 20 ? ok : bad)('wakeOutcome(inParlour) — temperature set to 20 (warmed through)');
  (sheltered.hunger === 12 ? ok : bad)('wakeOutcome(inParlour) — hunger untouched');

  const outside = wakeOutcome(false, { hunger: 12, temperature: 15 });
  (outside.hunger === 8 ? ok : bad)('wakeOutcome(outside) — hunger drops by 4 (12 -> 8)');
  (outside.temperature === 4 ? ok : bad)('wakeOutcome(outside) — temperature floors at min(temp, 4) (15 -> 4)');
  (outside.fatigue === null ? ok : bad)('wakeOutcome(outside) — fatigue untouched (null sentinel, caller skips it)');

  const outsideAlreadyCold = wakeOutcome(false, { hunger: 3, temperature: 2 });
  (outsideAlreadyCold.hunger === 1 ? ok : bad)('wakeOutcome(outside) — hunger floors at 1, never reaches 0');
  (outsideAlreadyCold.temperature === 2 ? ok : bad)('wakeOutcome(outside) — temperature already below 4 stays put (min, not a flat set)');

  const outsideStarving = wakeOutcome(false, { hunger: 1, temperature: 10 });
  (outsideStarving.hunger === 1 ? ok : bad)('wakeOutcome(outside) — hunger already at floor stays at 1 (never negative, never 0)');
}

// --- postLocalNote: the solo-world local board's cap/trim logic ---
{
  const r1 = postLocalNote([], 'p1', 'Bess', '  Lost a yow up Egton way, has anyone seen her?  ', 1000);
  (r1.notes && r1.notes.length === 1 ? ok : bad)('postLocalNote — first note posted, list length 1');
  (r1.notes[0].text === 'Lost a yow up Egton way, has anyone seen her?' ? ok : bad)('postLocalNote — text trimmed of surrounding whitespace');
  (r1.notes[0].pid === 'p1' && r1.notes[0].name === 'Bess' ? ok : bad)('postLocalNote — pid/name carried onto the note');
  (typeof r1.notes[0].id === 'string' && r1.notes[0].id.length > 0 ? ok : bad)('postLocalNote — note gets a non-empty id');

  const empty = postLocalNote([], 'p1', 'Bess', '   ', 1000);
  (empty.error === 'empty' ? ok : bad)('postLocalNote — blank text (whitespace only) rejected as "empty"');
  const empty2 = postLocalNote([], 'p1', 'Bess', '', 1000);
  (empty2.error === 'empty' ? ok : bad)('postLocalNote — empty string rejected as "empty"');

  const longText = 'x'.repeat(300);
  const trimmed = postLocalNote([], 'p1', 'Bess', longText, 1000);
  (trimmed.notes[0].text.length === NOTE_MAX_LEN ? ok : bad)(`postLocalNote — text over ${NOTE_MAX_LEN} chars truncated to the cap`);

  // per-player cap: NOTE_CAP_PER_PLAYER (2) notes max for one pid
  let notes = [];
  for (let i = 0; i < NOTE_CAP_PER_PLAYER; i++) {
    const r = postLocalNote(notes, 'p1', 'Bess', 'note ' + i, 1000 + i);
    notes = r.notes;
  }
  (notes.length === NOTE_CAP_PER_PLAYER ? ok : bad)(`postLocalNote — a player can post up to ${NOTE_CAP_PER_PLAYER} notes`);
  const capped = postLocalNote(notes, 'p1', 'Bess', 'one too many', 2000);
  (capped.error === 'cap' ? ok : bad)('postLocalNote — a 3rd note from the same pid is rejected as "cap"');
  // a DIFFERENT pid is unaffected by p1's cap
  const otherPlayer = postLocalNote(notes, 'p2', 'Tom', 'my own note', 2001);
  (otherPlayer.notes && otherPlayer.notes.length === NOTE_CAP_PER_PLAYER + 1 ? ok : bad)('postLocalNote — a different pid is not blocked by another player\'s cap');

  // whole-board cap: NOTE_CAP_BOARD (24) notes max regardless of poster
  let boardNotes = [];
  for (let i = 0; i < NOTE_CAP_BOARD; i++) {
    const r = postLocalNote(boardNotes, 'pid-' + i, 'Villager ' + i, 'note ' + i, 3000 + i);
    boardNotes = r.notes;
  }
  (boardNotes.length === NOTE_CAP_BOARD ? ok : bad)(`postLocalNote — the board fills to ${NOTE_CAP_BOARD} notes from distinct posters`);
  const overfull = postLocalNote(boardNotes, 'pid-new', 'Someone New', 'room for one more?', 9999);
  (overfull.error === 'boardfull' ? ok : bad)('postLocalNote — a 25th note (new poster, board full) is rejected as "boardfull"');
}

// --- pullLocalNote: poster-only removal ---
{
  let notes = [];
  notes = postLocalNote(notes, 'p1', 'Bess', 'a note', 1000).notes;
  notes = postLocalNote(notes, 'p2', 'Tom', 'another note', 1001).notes;
  const targetId = notes[0].id;

  const wrongPuller = pullLocalNote(notes, 'p2', targetId);
  (wrongPuller.length === 2 ? ok : bad)('pullLocalNote — a non-poster pulling another\'s note is a no-op');

  const rightPuller = pullLocalNote(notes, 'p1', targetId);
  (rightPuller.length === 1 && rightPuller[0].pid === 'p2' ? ok : bad)('pullLocalNote — the poster can pull their own note');

  const missingId = pullLocalNote(notes, 'p1', 'nonexistent-id');
  (missingId.length === 2 ? ok : bad)('pullLocalNote — an unknown id is a no-op, not a throw');
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
