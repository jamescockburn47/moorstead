// First-hour milestones for t' bairns' world. Each fires once, celebrates wi' a
// toast an' a chime, an' nudges t' next step — so earning feels like getting
// somewhere, not a grind. T' last rungs hand off to t' village quests.
//
// State lives on t' player (milestonesDone / milestonesSteered), so it rides t'
// normal save — through IndexedDB an' t' relay per-player save alike. Only
// active on t' bairns' world; adults play unbothered.
import { B, I } from './defs.js';

const MILESTONES = {
  first_log:    'Tha’s felled thi first tree! Make some planks frae t’ log (open thi pack wi’ <b>E</b>).',
  first_planks: 'Planks! Build wi’ these — or make sticks, then a joiner’s bench.',
  first_bench:  'A joiner’s bench — now tha can make proper tools. Stand near it an’ craft.',
  first_pick:   'Thi first pick! Now stone’s thine for t’ taking — dig down a bit.',
  into_stone:   'Tha’s hewing stone now. Cobble makes tougher tools than wood.',
  stone_tools:  'Gritstone tools — they’ll last thee a deal longer than wood.',
  first_light:  'A light! T’ dark things keep their distance frae a flame — grand at neet.',
  hot_scran:    'Summat warm in thi belly — cooked scran keeps thi strength up.',
  iron_won:     'Ironstone! Smelt it at t’ range an’ tha’s on thi way to iron tools.',
  iron_tools:   'Iron tools — top o’ t’ toolbox. Tha’s earned that, that tha has.',
  stood_ground: 'Tha saw it off! T’ moor’s a bit safer for thi pluck.',
  first_neet:   'Tha’s seen a neet through on t’ moors. Not bad, that — not bad at all.',
};
const STEERS = new Set(['iron_tools', 'first_neet']);
const STEER_TEXT = 'T’ village folk have jobs for them as’ll do ’em — find a <b>notice board</b>, or have a word wi’ a villager who looks like they’ve summat on their mind.';

export class Milestones {
  constructor(game) { this.game = game; }

  // only on t' bairns' world — t' kids' onboarding
  active() { return this.game.bairnLocked(); }

  fire(id) {
    const p = this.game.player;
    if (!this.active() || !p) return;
    if (!p.milestonesDone) p.milestonesDone = [];
    if (p.milestonesDone.includes(id)) return;
    const text = MILESTONES[id];
    if (!text) return;
    p.milestonesDone.push(id);
    this.game.ui.toast('⭐ <b>' + text + '</b>', 7000);
    const a = this.game.audio;
    if (a) { if (a.craft) a.craft(); else if (a.pickup) a.pickup(); }
    if (STEERS.has(id) && !p.milestonesSteered) {
      p.milestonesSteered = true;
      setTimeout(() => this.game.ui.toast(STEER_TEXT, 9000), 4500);
    }
    if (this.game.saveNow) this.game.saveNow(false);
  }

  // ---- event mappings, called frae t' break / place / craft / smelt / kill paths ----
  onBreak(id) {
    if (id === B.LOG) this.fire('first_log');
    else if (id === B.STONE) this.fire('into_stone');
    else if (id === B.IRON_ORE) this.fire('iron_won');
  }
  onPlace(id) {
    if (id === B.TORCH || id === B.LANTERN) this.fire('first_light');
  }
  onCraft(out) {
    if (out === B.PLANKS) this.fire('first_planks');
    else if (out === B.BENCH) this.fire('first_bench');
    else if (out === I.W_PICK) this.fire('first_pick');
    else if (out === I.S_PICK || out === I.S_AXE || out === I.S_SHOVEL || out === I.S_SWORD) this.fire('stone_tools');
    else if (out === I.I_PICK || out === I.I_AXE || out === I.I_SHOVEL || out === I.I_SWORD) this.fire('iron_tools');
  }
  onSmelt(out) {
    if (out === I.IRON_INGOT) this.fire('iron_won');
    else if (out === I.COOKED_MUTTON || out === I.COOKED_GROUSE || out === I.COOKED_BEEF || out === I.COOKED_FISH) this.fire('hot_scran');
  }
  onKill(type) {
    if (type === 'barghest' || type === 'boggart' || type === 'greatbarghest') this.fire('stood_ground');
  }
  nightSurvived() { this.fire('first_neet'); }
}
