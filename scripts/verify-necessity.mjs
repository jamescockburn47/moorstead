// The necessity spine's pure rules: taught crafting gate, commission catalogue and
// pricing, vouch rule, promise deadlines. Ledgers decide; the LLM only narrates.
import { readFileSync } from 'node:fs';
import { SKILLS, skillFor, canCraft, teacherFor, commissionable, commissionPrice,
         COMMISSION_WAIT_DAYS, canVouch, promiseState } from '../src/ledgers.js';
import { RECIPES, I, B } from '../src/defs.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const check = (c, m) => (c ? ok(m) : bad(m));

// --- skills map onto real recipes ---
check(SKILLS.smithing && SKILLS.ironwork, 'two starter skills defined');
check(skillFor(I.I_PICK) === 'smithing' && skillFor(I.I_SWORD) === 'smithing', 'iron tools need smithing');
check(skillFor(B.RANGE) === 'ironwork' && skillFor(B.STRONGBOX) === 'ironwork', 'range/strongbox need ironwork');
check(skillFor(B.PLANKS) === null, 'everyday crafting is never gated');
const gated = RECIPES.filter(r => skillFor(r.out));
check(gated.length >= 6 && gated.length <= 12, `a meaningful but small gated set (${gated.length})`);
check(gated.every(r => r.bench), 'only bench recipes are ever gated (no gating hand-crafts)');

// --- canCraft: the one gate both display and execution call ---
check(canCraft(I.I_PICK, {}, false) === false, 'untaught -> cannot craft iron pick');
check(canCraft(I.I_PICK, { smithing: true }, false) === true, 'taught smithing -> can craft');
check(canCraft(I.I_PICK, {}, true) === true, 'free/bairns world -> everything open');
check(canCraft(B.PLANKS, {}, false) === true, 'ungated recipe always craftable');

// --- teachers: role + standing ---
check(teacherFor('smithing') === 'craftsman' && teacherFor('ironwork') === 'miner', 'teacher roles');
check(SKILLS.smithing.minStanding === 1 && SKILLS.ironwork.minStanding === 1, 'teaching needs Known standing');

// --- commissions: same goods, made for brass, ready later ---
check(commissionable(I.I_PICK) && commissionable(B.STRONGBOX), 'gated goods are commissionable');
check(!commissionable(B.PLANKS), 'ungated goods are not (buy or make them)');
const px = commissionPrice(I.I_PICK);
check(Number.isFinite(px) && px >= 8 && px <= 200, `commission price sane (${px}d)`);
check(commissionPrice(B.STRONGBOX) > commissionPrice(I.I_SHOVEL), 'dearer goods cost more');
check(COMMISSION_WAIT_DAYS >= 1, 'a commission is never instant');

// --- vouching ---
check(canVouch({ tier: 'Friend' }, 0) === true, 'a Friend will vouch');
check(canVouch({ tier: 'Close friend' }, 0) === true, 'a close friend certainly will');
check(canVouch({ tier: 'Acquaintance' }, 0) === false, 'an acquaintance will not');
check(canVouch({ tier: null }, 3) === true, 'Respected standing carries its own weight (no per-NPC tier needed)');
check(canVouch({ tier: null }, 2) === false, 'below Respected, tha needs a friend');

// --- promises ---
check(promiseState({ deadlineDay: 5 }, 4) === 'open', 'before the deadline: open');
check(promiseState({ deadlineDay: 5 }, 5) === 'open', 'deadline day itself still counts');
check(promiseState({ deadlineDay: 5 }, 6) === 'broken', 'past the deadline: broken');

// --- wiring greps (land across C2-C5; expected FAIL until then) ---
const u = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
check(/canCraft\(/.test(u), 'ui recipe list gates through canCraft');
const p = readFileSync(new URL('../src/player.js', import.meta.url), 'utf8');
check(/taught/.test(p) && /commissions/.test(p) && /vouches/.test(p) && /promiseLog/.test(p), 'player persists the four ledgers');
const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
check(/canVouch|vouches/.test(mainSrc), 'deed staking consults the vouch ledger');
const fc = readFileSync(new URL('../src/factscard.js', import.meta.url), 'utf8');
check(/taught|commission|promise/i.test(fc), 'facts card carries ledger rows');

console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
