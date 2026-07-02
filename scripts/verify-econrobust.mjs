// Economy-robustness checks — node scripts/verify-econrobust.mjs
// Covers the four hardening slices:
//   • the station departure chip formatter (pure), incl. the no-train an' stood-in cases
//   • spreadHint: the trade-spread whisper, checked against the REAL SPREAD table + exports
//   • reportQuiet: silent-catch telemetry — never throws, rate-limited to 5 a session
//   • migrateSave: stepwise save migration + the future-version refusal signal
import { stationChipHTML } from '../src/ui.js';
import { spreadHint, regionMult, priceOf, SPREAD_HINT_MIN } from '../src/economy.js';
import { reportQuiet } from '../src/feedback.js';
import { migrateSave, SAVE_VERSION } from '../src/save.js';
import { B, I } from '../src/defs.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const check = (c, m) => (c ? ok : bad)(m);

// ---------------- station departure chip (pure formatter) ----------------
{
  const none = stationChipHTML('Goathland', [], 2);
  check(none.includes('Goathland') && none.includes('no train due'), 'empty timetable says no train due');
  check(!none.includes('Fare'), 'no fare line when nowt is due');

  const inf = stationChipHTML('Goathland', [{ dest: 'Whitby', eta: Infinity }], 2);
  check(inf.includes('no train due'), 'a non-finite eta reads as no train due (never "Infinity")');

  const one = stationChipHTML('Levisham', [{ dest: 'Whitby', eta: 130 }], 1);
  check(one.includes('Levisham') && one.includes('Whitby'), "chip names the station an' the destination");
  check(one.includes('2m 10s'), "eta formats as minutes an' seconds");
  check(one.includes('Fare: 1× coal'), 'the coal fare rides on the chip');
  check(!one.includes('then'), 'a single departure has no "then"');

  const two = stationChipHTML('Grosmont', [{ dest: 'Whitby', eta: 45 }, { dest: 'Pickering', eta: 600 }], 3);
  check(two.includes('45s') && two.includes('then') && two.includes('Pickering') && two.includes('10m 0s'),
    'two departures read "next ... , then ..."');

  const now = stationChipHTML('Whitby', [{ dest: 'Pickering', eta: 0 }], 2);
  check(now.includes('stood in NOW'), 'eta 0 reads as she’s stood in now');

  const free = stationChipHTML('Whitby', [{ dest: 'Pickering', eta: 90 }], 0);
  check(free.includes('free (creative)'), 'fare 0 reads as free (creative)');
  const nofare = stationChipHTML('Whitby', [{ dest: 'Pickering', eta: 90 }], null);
  check(!nofare.includes('Fare'), 'fare null omits the fare entirely');

  check(stationChipHTML('X', [], null).includes('class="tq station"'), 'chip uses the quest-tracker idiom (.tq)');
}

// ---------------- spreadHint against the real SPREAD table ----------------
{
  const h = spreadHint(I.COAL_LUMP, 'Rosedale Abbey');
  check(h && h.kind === 'cheap' && h.best === 'Whitby', `coal at Rosedale is cheap, best fetched in Whitby (got ${JSON.stringify(h)})`);
  // the whisper must be TRUE: selling at the named best beats selling here
  check(priceOf(I.COAL_LUMP, 'Whitby', 'sell') > priceOf(I.COAL_LUMP, 'Rosedale Abbey', 'sell'),
    'the coal whisper is honest — Whitby pays more than Rosedale');

  const d = spreadHint(I.COAL_LUMP, 'Whitby');
  check(d && d.kind === 'dear', 'coal at Whitby sells dear');

  check(spreadHint(I.COAL_LUMP, 'Goathland') === null, 'coal at a par village gets no hint');
  check(spreadHint(B.PLANKS, 'Whitby') === null, 'a good with no spread gets no hint');

  const w = spreadHint(B.WOOL, 'Moorstead');
  check(w && w.kind === 'cheap' && (w.best === 'Whitby' || w.best === 'Pickering'),
    `wool at Moorstead is cheap, fetched dearer at the market towns (got ${JSON.stringify(w)})`);

  const f = spreadHint(I.SEA_FISH, 'Whitby');
  check(f && f.kind === 'cheap' && regionMult(f.best, I.SEA_FISH) > 1.15,
    `fresh fish is cheap on the quay, dear inland (got ${JSON.stringify(f)})`);

  // the off-map export can out-pay every village (Teesside for calcined ore)
  const c = spreadHint(I.CALCINED_IRONSTONE, 'Rosedale Abbey');
  check(c && c.kind === 'cheap' && c.best === 'Teesside',
    `calcined ore at the kilns points to the Teesside export (got ${JSON.stringify(c)})`);

  // threshold honesty: every hint corresponds to a real ±SPREAD_HINT_MIN move off par
  for (const [item, village] of [[I.COAL_LUMP, 'Rosedale Abbey'], [I.COAL_LUMP, 'Whitby'], [B.WOOL, 'Moorstead'], [I.JET_GEM, 'Pickering']]) {
    const hh = spreadHint(item, village), m = regionMult(village, item);
    if (hh) check(hh.kind === 'cheap' ? m <= 1 - SPREAD_HINT_MIN : m >= 1 + SPREAD_HINT_MIN,
      `hint at ${village} matches its real multiplier ${m}`);
    else check(m > 1 - SPREAD_HINT_MIN && m < 1 + SPREAD_HINT_MIN, `no hint at ${village} means near-par (${m})`);
  }
}

// ---------------- reportQuiet: never throws, capped at 5 a session ----------------
{
  const poisoned = { get message() { throw new Error('poisoned getter'); } };
  let threw = false;
  const results = [];
  try {
    results.push(reportQuiet('verify-poison', poisoned));            // 1 — a booby-trapped error object
    results.push(reportQuiet(undefined, undefined));                 // 2 — no tag, no error
    results.push(reportQuiet('verify-plain', new Error('plain')));   // 3
    results.push(reportQuiet('verify-string', 'just a string'));     // 4
    results.push(reportQuiet('verify-circular', (() => { const o = {}; o.self = o; return o; })())); // 5 — circular
    results.push(reportQuiet('verify-over', new Error('six')));      // 6 — over the cap
    results.push(reportQuiet('verify-over2', new Error('seven')));   // 7 — still over
  } catch (e) {
    threw = true;
  }
  check(!threw, 'reportQuiet never throws, whatever it’s fed');
  check(results.slice(0, 5).every(r => r === true), `the first five reports go through (${JSON.stringify(results)})`);
  check(results[5] === false && results[6] === false, "the sixth an' seventh are rate-limited away");
}

// ---------------- migrateSave: stepwise migration + future-version refusal ----------------
{
  check(SAVE_VERSION === 2, `SAVE_VERSION is the current format (got ${SAVE_VERSION})`);

  // a v1 save steps up 1 -> 2, keeping its chunks an' recording where it came from
  const chunks = new Map([['0,0', new Uint8Array([1, 2, 3])]]);
  const v1 = { meta: { version: 1, seed: 42 }, chunks };
  const m1 = migrateSave(v1);
  check(m1.ok === true, 'a v1 save migrates ok');
  check(m1.saved.meta.version === SAVE_VERSION, 'migration lands on the current version');
  check(m1.saved.meta.migratedFrom === 1, 'the step actually RAN (migratedFrom recorded), not a blind stamp');
  check(m1.saved.meta.seed === 42 && m1.saved.chunks === chunks, "seed an' chunks ride through untouched");

  // an unversioned (ancient) save is treated as v1 an' stepped up the same
  const m0 = migrateSave({ meta: { seed: 7 }, chunks: new Map() });
  check(m0.ok === true && m0.saved.meta.version === SAVE_VERSION && m0.saved.meta.migratedFrom === 1,
    'an unversioned save steps up as v1');

  // a current save passes through untouched — no phantom migration
  const cur = { meta: { version: SAVE_VERSION, seed: 9 }, chunks: new Map() };
  const mc = migrateSave(cur);
  check(mc.ok === true && mc.saved === cur && mc.saved.meta.migratedFrom === undefined,
    'a current save is left exactly as it was');

  // a FUTURE save refuses — the signal main.js turns into the "newer Moorstead" toast
  const fut = { meta: { version: SAVE_VERSION + 1, seed: 1 }, chunks: new Map() };
  const mf = migrateSave(fut);
  check(mf.ok === false && mf.reason === 'future' && mf.version === SAVE_VERSION + 1,
    `a newer build's save is refused, not corrupted (got ${JSON.stringify({ ok: mf.ok, reason: mf.reason, version: mf.version })})`);
  check(fut.meta.version === SAVE_VERSION + 1, 'the refusal leaves the save bytes alone');

  // degenerate inputs never explode the load path
  check(migrateSave(null).ok === true, 'null passes through (loadGame already handled "no save")');
  check(migrateSave({ chunks: new Map() }).ok === true, 'a save with no meta passes through for the caller to judge');
}

console.log('RESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
