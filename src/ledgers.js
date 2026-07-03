// The necessity spine's ledgers and rules — "nobody sells owt of consequence to a
// stranger." Deterministic and pure: the chat brain narrates these outcomes but
// never decides them. Skills are TAUGHT in conversation by the right trade; the
// same goods can be COMMISSIONED instead; big purchases need a VOUCH; PROMISES
// have deadlines the day-clock enforces.
import { I, B, RECIPES } from './defs.js';

// skill -> who teaches it, what standing they want first, and the goods it unlocks
export const SKILLS = {
  smithing: { teacher: 'craftsman', minStanding: 1, label: 'smithing',
              goods: [I.I_PICK, I.I_AXE, I.I_SHOVEL, I.I_SWORD] },
  ironwork: { teacher: 'miner', minStanding: 1, label: 'iron-work',
              goods: [B.RANGE, B.SAFETY_LAMP, B.WINCH, B.STRONGBOX] },
};

const _skillByOut = new Map();
for (const [key, s] of Object.entries(SKILLS)) for (const id of s.goods) _skillByOut.set(id, key);

export function skillFor(outId) { return _skillByOut.get(outId) || null; }

// The ONE crafting gate — display and execution both call this.
export function canCraft(outId, taught, freeWorld) {
  const skill = skillFor(outId);
  if (!skill || freeWorld) return true;
  return !!(taught && taught[skill]);
}

export function teacherFor(skill) { return SKILLS[skill] ? SKILLS[skill].teacher : null; }

// Commissions: the tradesman makes a gated good FOR you — dearer than materials,
// never instant. Price: flat per-good table (kept simple and tunable; economy
// PRICES don't cover crafted tools).
export const COMMISSION_WAIT_DAYS = 1;
const COMMISSION_PRICES = {
  [I.I_PICK]: 24, [I.I_AXE]: 22, [I.I_SHOVEL]: 16, [I.I_SWORD]: 30,
  [B.RANGE]: 60, [B.SAFETY_LAMP]: 36, [B.WINCH]: 48, [B.STRONGBOX]: 80,
};
export function commissionable(outId) { return skillFor(outId) != null; }
export function commissionPrice(outId) { return COMMISSION_PRICES[outId] ?? 40; }

// Vouching: a villager who counts you a FRIEND this session will vouch; failing
// that, village-wide Respected standing (index >= 3) speaks for itself.
const VOUCH_TIERS = ['Friend', 'Close friend'];
export function canVouch(villager, standingIdx) {
  if (villager && VOUCH_TIERS.includes(villager.tier)) return true;
  return (standingIdx | 0) >= 3;
}

// Promises: kept before (or on) the deadline day, broken after it.
export function promiseState(promise, day) {
  return day > promise.deadlineDay ? 'broken' : 'open';
}

// --- Pub games (D4): result ledger + wager rules ---------------------------
// Small stakes only — a shilling is the ceiling. This is NEVER gated on
// freeWorld: bairns wager too (James's explicit call, 2026-07-04). The
// friendly-game path (wager 0) is always available regardless.
export const WAGER_MAX = 12; // pence — a shilling

// Mutates-and-returns gameRecord: ensures games[gameId] exists, bumps the
// w/l/d counter for `result`, and tracks the biggest single wager ever won.
export function recordGameResult(gameRecord, gameId, result, wagerWonPence = 0) {
  if (!gameRecord.games) gameRecord.games = {};
  if (!gameRecord.games[gameId]) gameRecord.games[gameId] = { w: 0, l: 0, d: 0 };
  const rec = gameRecord.games[gameId];
  if (result === 'w') rec.w++;
  else if (result === 'l') rec.l++;
  else if (result === 'd') rec.d++;
  const won = Number.isFinite(wagerWonPence) ? Math.max(0, wagerWonPence) : 0;
  gameRecord.biggestWin = Math.max(gameRecord.biggestWin || 0, won);
  return gameRecord;
}

// Facts-card sentence rows, one per game with any play, plus a biggest-win
// row when there is one. Pure: callers supply the brass formatter (economy's
// formatBrass) so this module never needs to know £sd formatting.
export function gameStatsRows(gameRecord, fmt = p => p + 'd') {
  const rows = [];
  const games = (gameRecord && gameRecord.games) || {};
  for (const [gameId, rec] of Object.entries(games)) {
    if (!rec || (rec.w + rec.l + rec.d) === 0) continue;
    let row = `At t' tables they've won ${rec.w} an' lost ${rec.l} at ${gameId}`;
    row += rec.d ? `, wi' ${rec.d} drawn.` : '.';
    rows.push(row);
  }
  const biggest = (gameRecord && gameRecord.biggestWin) || 0;
  if (biggest > 0) rows.push(`Biggest wager won at t' tables: ${fmt(biggest)}.`);
  return rows;
}

// Wager rules: integer pence, 0 (friendly) or up to WAGER_MAX, never more
// than the player is carrying. NEVER references freeWorld — bairns wager too.
export function wagerAllowed(brass, wager) {
  if (!Number.isInteger(wager)) return false;
  if (wager < 0) return false;
  if (wager > WAGER_MAX) return false;
  if (wager > brass) return false;
  return true;
}
