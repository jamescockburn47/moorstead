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
