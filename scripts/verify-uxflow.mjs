// UX-flow checks — node scripts/verify-uxflow.mjs
// Covers the small onboarding/HUD/audio-cue slice:
//   • milestones: adult worlds get ONLY the lite ladder (log → planks → bench + one
//     notice-board steer); the bairns' world keeps the full ladder exactly as before
//   • ui.toast kind routing: 'warn' knocks, everything else stays silent
//   • the quest-tracker HTML formatter (pure)
//   • the find-shelter bearing/distance formatters (pure)
//   • AudioEngine.warnKnock exists an' schedules struck tones (structural — the
//     actual sound is auditioned live by ear, like the bells an' the carol)
import { Milestones } from '../src/milestones.js';
import { UI, trackerHTML, bearingLabel, shelterToast } from '../src/ui.js';
import { AudioEngine } from '../src/audio.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const check = (c, m) => (c ? ok : bad)(m);

// ---------------- milestones: adult-lite vs bairns' full ladder ----------------
// fire() spaces its toasts through setTimeout; collapse timers so the whole
// sequence lands synchronously an' the script doesn't dawdle.
const realTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn) => { fn(); return 0; };

const mkGame = (bairns) => {
  const toasts = [];
  const g = {
    player: {},
    bairnLocked: () => bairns,
    ui: { toast: (t) => toasts.push(String(t)) },
    audio: { craft: () => {}, pickup: () => {} },
    saveNow: () => {},
  };
  return { ms: new Milestones(g), toasts, p: g.player };
};

{ // an adult world: only the first three rungs, then the steer, then silence
  const { ms, toasts, p } = mkGame(false);
  ms.fire('first_log');
  check(toasts.length === 1 && toasts[0].includes('felled thi first tree'), 'adult: first_log fires');
  ms.fire('first_planks');
  ms.fire('first_bench');
  check(toasts.some(t => t.includes('joiner’s bench')), 'adult: first_bench fires');
  check(toasts.some(t => t.includes('notice board')), 'adult: the notice-board steer rides after first_bench');
  check(p.milestonesSteered === true, 'adult: steer marked done (once per save)');
  const before = toasts.length;
  for (const id of ['first_pick', 'into_stone', 'stone_tools', 'first_light', 'hot_scran', 'iron_won', 'iron_tools', 'stood_ground', 'first_neet', 'flock_penned']) ms.fire(id);
  check(toasts.length === before, 'adult: no later rung fires (lite ladder only)');
  check(!(p.milestonesDone || []).includes('first_pick'), 'adult: later rungs not marked done either');
  ms.fire('first_log');
  check(toasts.length === before, 'adult: a rung never fires twice (milestonesDone persistence)');
}

{ // the bairns' world: the full ladder, steer after the LATE rungs, not the bench
  const { ms, toasts, p } = mkGame(true);
  ms.fire('first_log'); ms.fire('first_planks'); ms.fire('first_bench');
  check(!toasts.some(t => t.includes('notice board')), 'bairns: NO steer at first_bench (unchanged)');
  ms.fire('first_pick');
  check(toasts.some(t => t.includes('first pick')), 'bairns: later rungs still fire (full ladder)');
  ms.fire('iron_won'); ms.fire('iron_tools');
  check(toasts.some(t => t.includes('notice board')), 'bairns: steer rides after iron_tools, as before');
  check(p.milestonesSteered === true, 'bairns: steer marked done');
}

globalThis.setTimeout = realTimeout;

// ---------------- ui.toast kind routing ----------------
// A stub-level check: real UI.prototype.toast run against a tiny element stub —
// 'warn' knocks, default an' 'info' stay silent, the 4-toast cap still trims.
function makeEl() {
  return {
    className: '', innerHTML: '', parentNode: null, children: [],
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    remove() { const p = this.parentNode; if (p) { const i = p.children.indexOf(this); if (i >= 0) p.children.splice(i, 1); } },
    get firstChild() { return this.children[0] || null; },
  };
}
globalThis.document = { createElement: () => makeEl() };
{
  let knocks = 0;
  const ui = { el: UI.prototype.el, toastBox: makeEl(), game: { audio: { warnKnock: () => knocks++ } } };
  UI.prototype.toast.call(ui, 'mind thissen', 5, 'warn');
  check(knocks === 1, "toast(kind='warn') plays the warn knock");
  UI.prototype.toast.call(ui, 'plain news', 5);
  UI.prototype.toast.call(ui, 'more news', 5, 'info');
  check(knocks === 1, 'default an\' info toasts stay silent');
  check(ui.toastBox.children.length === 3, 'toasts land in the box');
  for (let i = 0; i < 4; i++) UI.prototype.toast.call(ui, 't' + i, 5);
  check(ui.toastBox.children.length <= 4, 'the 4-toast cap still trims the oldest');
  const noAudio = { el: UI.prototype.el, toastBox: makeEl(), game: {} };
  UI.prototype.toast.call(noAudio, 'quiet', 5, 'warn');
  ok('warn toast is fail-safe with no audio engine');
}
delete globalThis.document;

// ---------------- quest-tracker HTML formatter (pure) ----------------
{
  check(trackerHTML([]) === '' && trackerHTML(null) === '', 'trackerHTML: no lines -> empty (tracker hides)');
  const html = trackerHTML([{ title: 'A Lost Lamb', text: 'Find t’ lamb — NE · 120m' }]);
  check(html.includes('<b>A Lost Lamb</b>') && html.includes('NE · 120m'), 'trackerHTML: title + bearing line');
  check(html.includes('class="tq"'), 'trackerHTML: uses the HUD chip class');
  check(trackerHTML([{ title: 'T’ Hound', text: 'x', arc: true }]).includes('★ '), 'trackerHTML: arc quests marked ★');
  check(trackerHTML([{ title: 'Cold Guest', text: 'x', dracArc: true }]).includes('† '), 'trackerHTML: Dracula arc marked †');
  const five = trackerHTML([1, 2, 3, 4, 5].map(i => ({ title: 'q' + i, text: 't' })));
  check((five.match(/class="tq"/g) || []).length === 4, 'trackerHTML: capped at 4 lines');
}

// ---------------- find-shelter bearing/toast formatters (pure) ----------------
{
  // convention check: north is +x, east is +z (must agree wi' the minimap an' quests.compassDir)
  check(bearingLabel(0, 0, 100, 0) === 'N · 100m', 'bearingLabel: +x is north');
  check(bearingLabel(0, 0, 0, 100) === 'E · 100m', 'bearingLabel: +z is east');
  check(bearingLabel(0, 0, -100, 0) === 'S · 100m', 'bearingLabel: -x is south');
  check(bearingLabel(0, 0, 0, -100) === 'W · 100m', 'bearingLabel: -z is west');
  check(bearingLabel(0, 0, 100, 100) === 'NE · 141m', 'bearingLabel: diagonal + distance floor');

  const t = shelterToast({
    fog: false,
    shelter: { at: false, label: 'NW · 120m' },
    village: null,
    moorstead: { label: 'E · 400m' },
  });
  check(t.includes('Nearest shelter</b> — NW · 120m') && t.includes('Moorstead</b> — E · 400m'),
    'shelterToast: shelter + Moorstead, both wi\' bearings');
  check(shelterToast({ shelter: { at: true, label: 'N · 2m' }, moorstead: { label: 'S · 90m' } }).includes('stood at it'),
    'shelterToast: stood at a shelter says so');
  const v = shelterToast({ shelter: null, village: { name: 'Goathland', label: 'SW · 210m' }, moorstead: { label: 'S · 900m' } });
  check(v.includes('Goathland') && v.includes('SW · 210m'), 'shelterToast: shelterless world falls back to nearest village');
  const f = shelterToast({ fog: true, shelter: { at: false, label: 'N · 10m' }, moorstead: { label: 'S · 10m' } });
  check(f.includes('fog') && !f.includes('· 10m'), 'shelterToast: Great Fog gives no bearings — follow a wall');
}

// ---------------- AudioEngine.warnKnock (structural) ----------------
// Same WebAudio stub approach as verify-festival-audio: no real sound under Node,
// just prove the cue exists, is struck (oscillator-based), an' is fail-safe.
{
  let osc = 0;
  const param = () => ({
    value: 0,
    setValueAtTime() { return this; },
    linearRampToValueAtTime() { return this; },
    exponentialRampToValueAtTime() { return this; },
    setTargetAtTime() { return this; },
  });
  const dest = { connect: () => dest };
  function ctxStub() {   // constructible: audio.js does `new window.AudioContext()`
    return {
      currentTime: 0, sampleRate: 44100, destination: dest,
      createGain: () => ({ gain: param(), connect: () => dest }),
      createBiquadFilter: () => ({ type: '', frequency: param(), Q: param(), connect: () => dest }),
      createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
      createBufferSource: () => ({ buffer: null, loop: false, playbackRate: param(), connect: () => dest, start() {}, stop() {} }),
      createOscillator: () => { osc++; return { type: '', frequency: param(), connect: () => dest, start() {}, stop() {} }; },
    };
  }
  globalThis.window = { AudioContext: ctxStub, webkitAudioContext: ctxStub };
  const eng = new AudioEngine();
  check(typeof eng.warnKnock === 'function', 'AudioEngine exposes warnKnock()');
  eng.warnKnock();   // no ctx yet — must be a silent no-op, not a crash
  ok('warnKnock without a ctx is a no-op (audio is gesture-gated)');
  eng.init();
  const before = osc;
  eng.warnKnock();
  check(osc >= before + 2, 'warnKnock schedules two struck knocks');
  delete globalThis.window;
}

console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
