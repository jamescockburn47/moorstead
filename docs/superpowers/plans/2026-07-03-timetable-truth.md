# Timetable As Shared Truth Implementation Plan (Workstream A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The brain books NPCs onto specific train calls from the same deterministic timetable the client runs, capped at 16 seats per call — killing station loitering; the client rides them in just-in-time and shows 16 passengers across two coaches.

**Architecture:** Extract the schedule maths from `src/main.js` into a pure `src/railtime.js`; an export script freezes each line's leg times into `brain-sync/timetable.json` + a call fixture; a Python `brain/timetable.py` (in the EVO mirror repo `C:\Users\James\moorstead-evo-work`) reproduces the maths bit-for-bit (verified against the fixture) and adds a thread-safe 16-seat booking ledger; `roster_sim.start_rail` books `dep`/`arr` into NPC state (ledger threaded through `decide`/`apply_action`/`advance_plan`); the client ride machine uses `dep` when present (legacy ranked path retained for a dep-less brain). Day-phase/night gating is **deferred** (see the corrections block and Task 6) — it depends on the relay's day clock, not wall-clock.

**Tech Stack:** ES modules + Node verify scripts (client repo); Python 3 + pytest (EVO mirror repo); scp + systemctl for EVO deploy.

**Spec:** `docs/superpowers/specs/2026-07-03-npc-movement-chat-night-inn-design.md` (Workstream A).
**Protocol note:** `state.dep`/`state.arr` are additive fields; old clients ignore them (INVARIANTS rule 3). No `minClientVersion` bump.

---

## Ground-truth corrections (verified 2026-07-03 before execution)

Probes of the client repo and the EVO mirror (`C:\Users\James\moorstead-evo-work`)
turned up five facts that revise the plan as written below. These override any
conflicting detail in the tasks; each affected task also carries the fix inline.

1. **Trains are pure wall-clock, the day/night clock is NOT.** `trainSchedule`/
   `trainScheduleFor` compute from `Date.now()/1000` directly (verified main.js:2780,
   2827) — so timetable parity holds. But `src/sky.js:936` *integrates* `this.time +=
   dt/DAY_LENGTH` (seeded 0.3 at sky.js:572) and in multiplayer is overwritten by the
   **relay's** broadcast (`multiplayer.js:218,274` `g.sky.time = m.time`), NOT by
   `Date.now()%1800`. So a brain computing night from `time.time()%1800` would not
   match the visible day. **Task 6 (day-phase/night gating) is DEFERRED** to a
   follow-up that first SSH-verifies worldsvc's day clock. Tasks 1–5, 7, 8 have no
   day-clock dependency and proceed.

2. **Brain test import style is `from brain import X`.** The whole suite
   (`brain/test_roster_sim.py`, `brain/tests/*`) imports `from brain import world` /
   `from brain import roster_sim as rs`, run with pytest from the EVO repo root. The
   flat `sys.path.insert(...)` + `import timetable` style in Tasks 4–5 below is WRONG —
   use `from brain import timetable`, `from brain import roster_sim`, etc. New test
   files live in `brain/tests/` (matching `conftest.py`'s location).

3. **The ledger must be threaded — the pump never sees the sim.** `ActPump._decide_one`
   calls `act.decide(npc, time.time())` (roster_api.py:82) with no sim reference. So
   the plan's `ledger=sim.ledger` in `apply_action` is unreachable as written. Thread
   it: `decide(npc, now, chat_fn=None, ledger=None)` → `apply_action(npc, act, now,
   ledger=None)` → `start_rail(..., ledger=ledger)`; and `advance_plan(npc, now,
   ledger=None)` → `start_rail(..., ledger=ledger)`. Pass `self.sim.ledger` at both
   pump call sites (`act.decide(...)` and the `advance_plan` fallback) and `self.ledger`
   from `RosterSim.tick`. Detailed in Task 5.

4. **`SeatLedger` needs a lock.** Bookings happen from up to `ACT_MAX_CONCURRENT` (3)
   ActPump worker threads (`asyncio.to_thread`, roster_api.py:82) AND the main tick
   thread. `book`/`prune` do read-modify-write on `self.seats` — guard with a
   `threading.Lock` or trains occasionally over-book past 16. Detailed in Task 4.

5. **Export station-name source + ride var name.** `railPaths()` entries have `.name`
   and `.path.stationS` (chainages) but NO `.stations` array — the plan's `l.stations`
   for branches is wrong. Derive each line's ordered station names the SAME way
   `brain/world.py` does (from `data/moors-data.json` `lines[].stations` filtered to
   real `stations`), and pair index-for-index with `path.stationS`, asserting equal
   length. The two `moors-data.json` files are byte-identical (verified). The ride
   object is created at `roster.js:520` (`e.ride = { line: s.line, from: s.fromStn,
   to: s.toStn, phase: 'wait', t: 0 }`) — local state var is `s`, not `st`. Both
   detailed in Tasks 3 and 7.

---

### Task 1: Extract `src/railtime.js` (pure move, no behaviour change)

**Files:**
- Create: `src/railtime.js`
- Modify: `src/main.js:60-93` (the rail-motion constants + `runProfile` + `legTime`)

- [ ] **Step 1: Create the module**

Move the block from `src/main.js` verbatim — the constants `RAIL_ACC`, `RAIL_VMAX` (defined just above line 71; take the exact existing values), `DWELL_T` (line 74), `runProfile` (lines 79-92), `legTime` (line 93) — into a new `src/railtime.js`, adding `export` to each:

```js
// Pure rail schedule maths — shared by the Game's live trains, the verify scripts,
// and (via scripts/export-timetable.mjs -> brain-sync/timetable.json) the EVO brain,
// so client and brain read the SAME deterministic timetable from the wall clock.
export const RAIL_ACC = /* moved verbatim from main.js */;
export const RAIL_VMAX = /* moved verbatim from main.js */;
export const DWELL_T = 30;    // thirty seconds stood at each platform, doors open

// where is she an' how fast, tt seconds into a leg o' length len?
// (trapezoid speed profile: accelerate, cruise, brake — closed form, so
// every client computes t' same train frae t' same wall clock)
export function runProfile(len, tt) {
  const dFull = RAIL_VMAX * RAIL_VMAX / (2 * RAIL_ACC);
  let vPeak, tA;
  if (len >= 2 * dFull) { vPeak = RAIL_VMAX; tA = RAIL_VMAX / RAIL_ACC; }
  /* ...remaining lines moved verbatim from main.js:79-92... */
}
export function legTime(len) { return runProfile(len, 0).tTotal; }
```

(The two `/* moved verbatim */` markers mean literal cut-paste of the existing main.js lines — the executor copies them exactly; they are elided here only because this plan must not drift from the source of truth.)

In `src/main.js`, delete the moved block and add to the imports:

```js
import { DWELL_T, runProfile, legTime } from './railtime.js';
```

Leave `DRIVE_GRADE`/`DRIVE_VMAX`/`DRIVE_RAKE` (main.js:71-73) where they are — they belong to player driving, not the timetable.

- [ ] **Step 2: Verify no behaviour change**

Run: `npm run verify`
Expected: all green, especially `verify-rail`, `verify-rail-efficiency`, `verify-train-view`, `verify-station-align`.

- [ ] **Step 3: Commit**

```bash
git add src/railtime.js src/main.js
git commit -m "refactor(rail): extract pure schedule maths into src/railtime.js"
```

---

### Task 2: Call/departure maths in railtime.js (TDD)

**Files:**
- Modify: `src/railtime.js` (append)
- Create: `scripts/verify-timetable-parity.mjs` (first half)

- [ ] **Step 1: Write the failing parity test**

Create `scripts/verify-timetable-parity.mjs`:

```js
// The timetable is the shared truth: nextDeparture() must agree, to the second,
// with the live engine's trainScheduleFor() pingpong — and (via the exported
// fixture, Task 3) with the EVO brain's Python port.
import assert from 'node:assert';
import { DWELL_T, legTime, callOffset, stationCallK, nextDeparture } from '../src/railtime.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

// A toy 4-station line with unequal legs (lengths in metres -> legTime seconds).
const legT = [400, 900, 250].map(legTime);
const N = 4;
const oneway = legT.reduce((a, b) => a + b, 0) + N * DWELL_T;

// callOffset: k-th dwell starts after k dwells + the legs already run, per direction
ok(callOffset(legT, N, 0, 0) === 0, 'dir0 first call at t=0 of the pass');
ok(callOffset(legT, N, 0, 2) === 2 * DWELL_T + legT[0] + legT[1], 'dir0 third call');
ok(callOffset(legT, N, 1, 1) === DWELL_T + legT[2], 'dir1 runs the legs in reverse order');
ok(stationCallK(N, 0, 2) === 2 && stationCallK(N, 1, 2) === 1, 'station->call index per direction');

// nextDeparture: correct direction, dep >= tMin, arr later in the SAME pass
for (const [from, to] of [[0, 3], [3, 0], [1, 2], [2, 1]]) {
  for (let i = 0; i < 25; i++) {
    const tMin = i * 977.3;
    const { dep, arr, dir } = nextDeparture(legT, N, from, to, tMin);
    ok(dep >= tMin, `dep after tMin (${from}->${to} @${tMin})`);
    ok(arr > dep, 'arrives after departing');
    ok(dir === (to > from ? 0 : 1), 'direction matches the journey');
    ok(Math.floor(dep / oneway) % 2 === dir, 'departure pass runs the right way');
    ok(arr - dep < oneway, 'arrival within the same directional pass');
    // the NEXT valid departure after this one is exactly 2*oneway later
    const again = nextDeparture(legT, N, from, to, dep + 1);
    ok(Math.abs(again.dep - (dep + 2 * oneway)) < 1e-6, 'service repeats every 2*oneway');
  }
}

console.log(`verify-timetable-parity(pure): ${n} assertions OK`);
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node scripts/verify-timetable-parity.mjs`
Expected: FAIL — `callOffset` not exported.

- [ ] **Step 3: Implement the maths**

Append to `src/railtime.js`:

```js
// ---- call-time algebra over the pingpong service ------------------------------------
// A "pass" is one directional run lasting `oneway` seconds; passes alternate
// direction forever, phase-locked to the unix epoch (dir = floor(t/oneway) % 2 —
// identical to Game.trainSchedule / trainScheduleFor). legT = seconds per leg in
// dir-0 (ascending station index) order.

// dwell-start offset of the k-th call within a directional pass
export function callOffset(legT, n, dir, k) {
  let off = k * DWELL_T;
  for (let j = 0; j < k; j++) off += legT[dir === 0 ? j : n - 2 - j];
  return off;
}

// which call (0-based within a pass) serves stationIdx when running dir
export function stationCallK(n, dir, stationIdx) {
  return dir === 0 ? stationIdx : n - 1 - stationIdx;
}

// Next bookable departure from fromIdx toward toIdx with dep >= tMin (absolute unix
// seconds). Returns { dep, arr, dir } — dep/arr are dwell-START times at each station;
// a passenger boards during [dep, dep + DWELL_T].
export function nextDeparture(legT, n, fromIdx, toIdx, tMin) {
  const oneway = legT.reduce((a, b) => a + b, 0) + n * DWELL_T;
  const dir = toIdx > fromIdx ? 0 : 1;
  const kF = stationCallK(n, dir, fromIdx), kT = stationCallK(n, dir, toIdx);
  const offF = callOffset(legT, n, dir, kF), offT = callOffset(legT, n, dir, kT);
  let p = Math.max(0, Math.floor((tMin - offF) / oneway) - 2);
  for (;;) {
    if (p % 2 === dir) {
      const dep = p * oneway + offF;
      if (dep >= tMin) return { dep, arr: p * oneway + offT, dir };
    }
    p++;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node scripts/verify-timetable-parity.mjs`
Expected: `verify-timetable-parity(pure): NN assertions OK`

- [ ] **Step 5: Commit**

```bash
git add src/railtime.js scripts/verify-timetable-parity.mjs
git commit -m "feat(rail): pure call-time algebra (callOffset/nextDeparture) with parity tests"
```

---

### Task 3: Export the timetable + fixture for the brain

**Files:**
- Create: `scripts/export-timetable.mjs`
- Create: `brain-sync/timetable.json`, `brain-sync/timetable-fixture.json` (generated, committed)
- Modify: `scripts/verify-timetable-parity.mjs` (append live-engine + determinism checks)

- [ ] **Step 1: Probe the geo line shapes**

Run:

```bash
node -e "import('./src/moorsgeo.js').then(m => { const g = new m.MoorsGeography(); const ps = g.railPaths(); console.log(ps.map(l => ({ name: l.name, keys: Object.keys(l), nStationS: l.path && l.path.stationS && l.path.stationS.length }))); console.log('railway:', g.railway().map(s => s.name)); })"
```

Note, per line: its `name` and `path.stationS` length. **Correction (ground-truth #5):**
`railPaths()` entries have NO `.stations` array. Derive each line's ordered station
names the SAME way `brain/world.py` does — from `data/moors-data.json`: for the line
whose `name` matches, take `lines[].stations` filtered to names present in the top-level
`stations` array, dropping any line left with < 2 (world.py's filter). This guarantees
the export's `stations[i]` aligns index-for-index with `world.LINES[name][i]` and with
`path.stationS[i]`; the length assert catches any drift. Run the probe to confirm
`path.stationS.length` equals that filtered count per line:

```bash
node -e "import('./src/moorsgeo.js').then(m => { const g = new m.MoorsGeography(); console.log(g.railPaths().map(l => ({ name: l.name, nStationS: l.path && l.path.stationS && l.path.stationS.length }))); console.log('railway:', g.railway().map(s => s.name)); })"
```

- [ ] **Step 2: Write the export script**

Create `scripts/export-timetable.mjs`:

```js
// Freeze the deterministic timetable into brain-sync/ so the EVO brain books NPCs
// onto the SAME train calls every client renders. Rerun after any rail-layout or
// railtime.js change; verify-timetable-parity fails if the committed copy is stale.
// Station names are derived EXACTLY as brain/world.py derives world.LINES, so the
// export and the brain agree on each line's station order by construction.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { MoorsGeography } from '../src/moorsgeo.js';
import { DWELL_T, legTime, nextDeparture } from '../src/railtime.js';

const data = JSON.parse(readFileSync(new URL('../data/moors-data.json', import.meta.url), 'utf8'));
const STATION_SET = new Set(data.stations.map(s => s.name));
// name -> ordered real-station list, mirroring world.py's LINES construction
const stationsByLine = {};
for (const dl of data.lines || []) {
  const stops = (dl.stations || []).filter(n => STATION_SET.has(n));
  if (stops.length >= 2) stationsByLine[dl.name] = stops;   // world.py drops < 2
}

const geo = new MoorsGeography();
const lines = [];
for (const l of geo.railPaths()) {
  const stations = stationsByLine[l.name];
  const S = l.path.stationS;
  if (!stations) continue;                                  // line world.py wouldn't carry — skip in lockstep
  if (!S || S.length !== stations.length) {
    throw new Error(`line ${l.name}: ${stations.length} station names vs ${S && S.length} chainages — alignment broken`);
  }
  const legT = [];
  for (let i = 0; i < S.length - 1; i++) {
    const len = S[i + 1] - S[i];
    if (!(len > 0)) throw new Error(`line ${l.name}: stationS not strictly increasing at ${i} (${S[i]}->${S[i + 1]}) — station order scrambled`);
    legT.push(legTime(len));
  }
  if (legT.some(t => !Number.isFinite(t) || t <= 0)) throw new Error(`line ${l.name}: non-finite/zero leg time — bad chainage`);
  lines.push({ name: l.name, stations, legT, dwell: DWELL_T });
}
if (!lines.length) throw new Error('no lines exported — moors-data.json / railPaths() mismatch');

mkdirSync(new URL('../brain-sync/', import.meta.url), { recursive: true });
writeFileSync(new URL('../brain-sync/timetable.json', import.meta.url),
  JSON.stringify({ epoch: 'unix', lines }, null, 1));

// Fixture: sample departures the Python port must reproduce EXACTLY (same doubles).
const T0 = 1751500800;                       // fixed anchor: 2026-07-03 00:00:00 UTC
const samples = [];
for (const L of lines) {
  const n = L.stations.length;
  for (let i = 0; i < 12; i++) {
    const from = i % n, to = (from + 1 + (i % (n - 1))) % n;
    if (from === to) continue;
    const tMin = T0 + i * 977;
    const { dep, arr, dir } = nextDeparture(L.legT, n, from, to, tMin);
    samples.push({ line: L.name, from, to, tMin, dep, arr, dir });
  }
}
writeFileSync(new URL('../brain-sync/timetable-fixture.json', import.meta.url),
  JSON.stringify(samples, null, 1));
console.log(`exported ${lines.length} lines, ${samples.length} fixture samples`);
```

- [ ] **Step 3: Run it and commit the generated files**

Run: `node scripts/export-timetable.mjs`
Expected: `exported K lines, M fixture samples` and both files created under `brain-sync/`.

- [ ] **Step 4: Append live-engine parity + staleness checks to the verify script**

Append to `scripts/verify-timetable-parity.mjs`:

```js
// ---- live-engine parity + committed-file staleness ----------------------------------
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { MoorsGeography } from '../src/moorsgeo.js';

const tt = JSON.parse(readFileSync(new URL('../brain-sync/timetable.json', import.meta.url), 'utf8'));
const fx = JSON.parse(readFileSync(new URL('../brain-sync/timetable-fixture.json', import.meta.url), 'utf8'));
ok(tt.lines.length >= 1 && fx.length >= 10, 'timetable + fixture committed and non-trivial');

// staleness: regenerating must be a no-op (determinism + committed copy in sync)
const before = readFileSync(new URL('../brain-sync/timetable.json', import.meta.url), 'utf8')
             + readFileSync(new URL('../brain-sync/timetable-fixture.json', import.meta.url), 'utf8');
execFileSync(process.execPath, [new URL('./export-timetable.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')]);
const after = readFileSync(new URL('../brain-sync/timetable.json', import.meta.url), 'utf8')
            + readFileSync(new URL('../brain-sync/timetable-fixture.json', import.meta.url), 'utf8');
ok(before === after, 'committed brain-sync files match a fresh export (not stale)');

// every fixture departure re-derives to the same doubles (self-consistency of the
// exported legT vs the algebra) — the same numbers Game.trainScheduleFor runs on.
for (const s of fx.slice(0, 40)) {
  const L = tt.lines.find(l => l.name === s.line);
  const n = L.stations.length;
  const check = nextDeparture(L.legT, n, s.from, s.to, s.tMin);
  ok(check.dep === s.dep && check.arr === s.arr && check.dir === s.dir,
     `fixture sample stable (${s.line} ${s.from}->${s.to})`);
}

// ---- LIVE-ENGINE PARITY: nextDeparture lands on real dwells of a faithful copy of
// Game.trainScheduleFor's dwell logic (transcribed below, verbatim from main.js). This
// is the parity that MATTERS — NPCs must board the train the PLAYER sees. Sample
// MID-DWELL (dep + DWELL_T/2) so the check is robust to exact-boundary FP (see Task 2).
// `dwellStationAt` returns the station index the train is dwelling at, or -1 if running.
function dwellStationAt(legT, n, now) {
  const oneway = legT.reduce((a, b) => a + b, 0) + n * DWELL_T;
  const dir = Math.floor(now / oneway) % 2;
  const idx = k => (dir === 0 ? k : n - 1 - k);          // call k -> station (main.js:2826/2780)
  const leg = k => legT[dir === 0 ? k : n - 2 - k];      // leg after call k (main.js:2827/2781)
  let tt = ((now % oneway) + oneway) % oneway;           // guard negatives
  for (let k = 0; k < n; k++) {
    if (tt < DWELL_T) return idx(k);
    tt -= DWELL_T;
    if (k < n - 1) { const L = leg(k); if (tt < L) return -1; tt -= L; }
  }
  return idx(n - 1);
}
for (const s of fx) {
  const L = tt.lines.find(l => l.name === s.line);
  const n = L.stations.length;
  ok(dwellStationAt(L.legT, n, s.dep + DWELL_T / 2) === s.from,
     `engine dwells at 'from' mid-departure (${s.line} ${s.from}->${s.to})`);
  ok(dwellStationAt(L.legT, n, s.arr + DWELL_T / 2) === s.to,
     `engine dwells at 'to' mid-arrival (${s.line} ${s.from}->${s.to})`);
}
console.log(`verify-timetable-parity: ${n} assertions OK`);
```

(Adjust the final `console.log` from Task 2 so only this one prints the total. Note the
transcribed `dwellStationAt` is a line-faithful copy of `trainScheduleFor`'s dwell/run
walk — if that engine's structure ever changes, this reference copy and the in-browser
check at Task 7/8 are the two guards that catch a real divergence. The mid-dwell
sampling makes the mathematical parity robust; the in-browser check proves the *visible*
train agrees.)

- [ ] **Step 5: Run the verify script, then the full gate**

Run: `node scripts/verify-timetable-parity.mjs` — expected all OK.
Run: `npm run verify` — expected green.

- [ ] **Step 6: Commit**

```bash
git add scripts/export-timetable.mjs scripts/verify-timetable-parity.mjs brain-sync/
git commit -m "feat(rail): export deterministic timetable + parity fixture for the EVO brain"
```

---

### Task 4: Python `brain/timetable.py` (EVO mirror repo, TDD)

**Files (all under `C:\Users\James\moorstead-evo-work`):**
- Create: `brain/timetable.py`
- Create: `brain/tests/test_timetable.py`
- Copy in: `brain/timetable.json`, `brain/timetable-fixture.json` (from the client repo's `brain-sync/`)

- [ ] **Step 1: Copy the sync files**

```bash
cp "C:\Users\James\Desktop\Moorcraft\brain-sync\timetable.json"        "C:\Users\James\moorstead-evo-work\brain\timetable.json"
cp "C:\Users\James\Desktop\Moorcraft\brain-sync\timetable-fixture.json" "C:\Users\James\moorstead-evo-work\brain\timetable-fixture.json"
```

- [ ] **Step 2: Write the failing test**

Create `brain/tests/test_timetable.py`. **Correction (ground-truth #2):** use the
house import style `from brain import timetable` (run pytest from the EVO repo root),
NOT the flat `sys.path.insert` + `import timetable` shown in the original draft:

**Two corrections found during A4 (both applied in the EVO repo commit 98e2179):**
(a) the fixture path is `os.path.join(os.path.dirname(__file__), "..")` — tests live at
`brain/tests/`, fixture at `brain/`, so one `..` reaches it (NOT `"..","brain"`, which
resolves to the nonexistent `brain/brain`). (b) **`oneway` must be a plain left fold, not
`sum()`** — CPython 3.12+ `sum()` uses Neumaier compensated summation, which is 1 ULP off
JS's `legT.reduce((a,b)=>a+b,0)` on some lines (Coast Line), and `p*oneway` amplifies that
to ~5e-7, breaking exact parity. Anywhere a future Python consumer needs client parity,
sum `legT` with an explicit `for`-loop fold from `0.0`, never `sum()`/`math.fsum`.

```python
import json, os
from brain import timetable

HERE = os.path.join(os.path.dirname(__file__), "..")   # brain/tests/.. == brain/

def _fixture():
    with open(os.path.join(HERE, "timetable-fixture.json"), encoding="utf-8") as f:
        return json.load(f)

def test_fixture_parity_exact():
    """Every sampled departure matches the client's doubles EXACTLY — same maths,
    same IEEE754, same wall clock => the brain books the train the client renders."""
    for s in _fixture():
        line = timetable.line(s["line"])
        dep, arr, dirn = timetable.next_departure(line, s["from"], s["to"], s["tMin"])
        assert dep == s["dep"] and arr == s["arr"] and dirn == s["dir"], s

def test_booking_caps_at_16():
    line = timetable.line_names()[0]
    L = timetable.line(line)
    t0 = 1751500800.0
    ledger = timetable.SeatLedger()
    deps = [ledger.book(line, L, 0, len(L["stations"]) - 1, t0)[0] for _ in range(40)]
    from collections import Counter
    counts = Counter(deps)
    assert max(counts.values()) <= 16, counts        # never oversold
    assert len(counts) >= 3, counts                  # overflow rolls to later calls
    assert deps == sorted(deps), "bookings never travel back in time"

def test_ledger_prunes_past_calls():
    ledger = timetable.SeatLedger()
    ledger.seats[("x", 0, 100.0)] = 16
    ledger.prune(now=100.0 + 3601)
    assert not ledger.seats

def test_ledger_thread_safe_never_oversells():
    """Bookings run from ActPump worker threads + the tick thread. book() must be
    atomic (read-modify-write under a lock) or a call over-books past 16."""
    import threading
    line = timetable.line_names()[0]
    L = timetable.line(line)
    ledger = timetable.SeatLedger()
    t0 = 1751500800.0
    barrier = threading.Barrier(20)
    def worker():
        barrier.wait()                       # maximise contention on the same call
        for _ in range(5):
            ledger.book(line, L, 0, len(L["stations"]) - 1, t0)
    threads = [threading.Thread(target=worker) for _ in range(20)]
    for t in threads: t.start()
    for t in threads: t.join()
    assert all(v <= timetable.SEATS_PER_CALL for v in ledger.seats.values()), ledger.seats
    assert sum(ledger.seats.values()) == 100, "every booking landed somewhere exactly once"
```

- [ ] **Step 3: Run it to make sure it fails**

Run (from `C:\Users\James\moorstead-evo-work`): `python -m pytest brain/tests/test_timetable.py -q`
Expected: FAIL — `No module named 'timetable'`.

- [ ] **Step 4: Implement `brain/timetable.py`**

```python
"""The deterministic train timetable, ported bit-for-bit from the client's
src/railtime.js and frozen into timetable.json by scripts/export-timetable.mjs.
Both ends compute call times from the unix wall clock, so a booking here is the
train every client renders. test_timetable.py proves parity against a fixture
of client-computed departures."""
import json, os

with open(os.path.join(os.path.dirname(__file__), "timetable.json"), encoding="utf-8") as _f:
    _TT = json.load(_f)
_LINES = {l["name"]: l for l in _TT["lines"]}

SEATS_PER_CALL = 16          # two coaches' worth — the client renders 16 slots
LEAD_SECONDS = 120           # a body needs a couple of minutes to reach the platform

def line_names():
    return list(_LINES.keys())

def line(name):
    return _LINES.get(name)

def _call_offset(leg_t, n, dwell, dirn, k):
    off = k * dwell
    for j in range(k):
        off += leg_t[j if dirn == 0 else n - 2 - j]
    return off

def _station_call_k(n, dirn, idx):
    return idx if dirn == 0 else n - 1 - idx

def next_departure(L, from_idx, to_idx, t_min):
    """Next bookable departure with dep >= t_min. Returns (dep, arr, dir) —
    dwell-START times; a passenger boards during [dep, dep + dwell]."""
    leg_t, dwell = L["legT"], L["dwell"]
    n = len(L["stations"])
    # plain left fold to bit-match JS reduce — NOT sum() (Neumaier, 1 ULP off; see above)
    oneway = 0.0
    for _t in leg_t:
        oneway += _t
    oneway += n * dwell
    dirn = 0 if to_idx > from_idx else 1
    off_f = _call_offset(leg_t, n, dwell, dirn, _station_call_k(n, dirn, from_idx))
    off_t = _call_offset(leg_t, n, dwell, dirn, _station_call_k(n, dirn, to_idx))
    import math
    p = max(0, math.floor((t_min - off_f) / oneway) - 2)
    while True:
        if p % 2 == dirn:
            dep = p * oneway + off_f
            if dep >= t_min:
                return dep, p * oneway + off_t, dirn
        p += 1

import threading

class SeatLedger:
    """16 seats per (line, dir, dep). book() rolls an overfull call forward to the
    next service, so nobody is ever dispatched to a train they cannot board.

    Thread-safe (ground-truth #4): bookings arrive from ActPump worker threads
    (asyncio.to_thread, up to ACT_MAX_CONCURRENT of them) AND the main tick thread,
    so the read-modify-write in book() and the mutation in prune() are guarded by a
    lock — without it, two racing bookings both pass the < 16 check and over-fill."""
    def __init__(self):
        self.seats = {}
        self._lock = threading.Lock()

    def book(self, line_name, L, from_idx, to_idx, t_min):
        with self._lock:
            t = t_min
            while True:
                dep, arr, dirn = next_departure(L, from_idx, to_idx, t)
                key = (line_name, dirn, dep)
                if self.seats.get(key, 0) < SEATS_PER_CALL:
                    self.seats[key] = self.seats.get(key, 0) + 1
                    return dep, arr, dirn
                t = dep + 1

    def prune(self, now):
        with self._lock:
            stale = [k for k in self.seats if k[2] < now - 3600]
            for k in stale:
                del self.seats[k]
```

- [ ] **Step 5: Run the tests**

Run: `python -m pytest brain/tests/test_timetable.py -q`
Expected: 3 passed.

- [ ] **Step 6: Commit (EVO mirror repo)**

```bash
git add brain/timetable.py brain/timetable.json brain/timetable-fixture.json brain/tests/test_timetable.py
git commit -m "feat(brain): deterministic timetable port + 16-seat booking ledger, parity-tested"
```

---

### Task 5: Book real trains in `roster_sim.start_rail`

**Files (EVO mirror repo):**
- Modify: `brain/roster_sim.py:37-40` (`start_rail`), `brain/roster_sim.py:123-127` (`RosterSim.__init__`)
- Create: `brain/tests/test_booking.py`

- [ ] **Step 1: Write the failing test**

Create `brain/tests/test_booking.py` (house import style, ground-truth #2):

```python
from brain import roster_sim, timetable, world

def _line_and_stops():
    name = next(n for n in timetable.line_names() if n in world.LINES and len(world.LINES[n]) >= 2)
    return name, world.LINES[name]

def test_start_rail_books_dep_arr():
    line, stops = _line_and_stops()
    sim = roster_sim.RosterSim()
    npc = roster_sim.NPC(id="t1", name="t", role="farmer", place=stops[0])
    now = 1751500800.0
    roster_sim.start_rail(npc, line, stops[-1], now, ledger=sim.ledger)
    s = npc.state
    assert s["kind"] == "rail" and s["dep"] >= now + timetable.LEAD_SECONDS
    assert s["arr"] > s["dep"] and s["eta"] == s["arr"]

def test_forty_travellers_spread_across_calls():
    line, stops = _line_and_stops()
    sim = roster_sim.RosterSim()
    now = 1751500800.0
    deps = []
    for i in range(40):
        npc = roster_sim.NPC(id=f"t{i}", name="t", role="farmer", place=stops[0])
        roster_sim.start_rail(npc, line, stops[-1], now, ledger=sim.ledger)
        deps.append(npc.state["dep"])
    from collections import Counter
    assert max(Counter(deps).values()) <= 16

def test_unknown_line_falls_back_to_legacy_eta():
    npc = roster_sim.NPC(id="t", name="t", role="farmer", place="Whitby")
    roster_sim.start_rail(npc, "No Such Line", "Pickering", 1000.0, ledger=None)
    assert npc.state["kind"] == "rail" and "dep" not in npc.state
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `python -m pytest brain/tests/test_booking.py -q`
Expected: FAIL — `start_rail() got an unexpected keyword argument 'ledger'`.

- [ ] **Step 3: Implement**

In `brain/roster_sim.py`, add near the other imports (inside the existing try/except import block):

```python
    from . import timetable
```
```python
    import timetable
```

Replace `start_rail` (lines 37-40):

```python
def start_rail(npc, line, to, now, ledger=None):
    """Book a REAL train call when the timetable knows the line (dep/arr are the
    same call times every client's schedule renders; the seat ledger caps a call
    at 16 so nobody is sent to a train she can't board). Falls back to the legacy
    flat eta when the line is unknown — old data can never wedge the sim."""
    L = timetable.line(line)
    stops = world.LINES.get(line, [])
    if L and ledger is not None and npc.place in stops and to in stops \
            and L["stations"] == stops:
        dep, arr, _dir = ledger.book(line, L, stops.index(npc.place), stops.index(to),
                                     now + timetable.LEAD_SECONDS)
        npc.state = {"kind": "rail", "line": line, "fromStn": npc.place, "toStn": to,
                     "started": now, "dep": dep, "arr": arr, "eta": arr}
        return
    legs = max(1, world.leg_count(line, npc.place, to))
    npc.state = {"kind": "rail", "line": line, "fromStn": npc.place, "toStn": to,
                 "started": now, "eta": now + legs * world.RAIL_SECONDS}
```

In `RosterSim.__init__` (line 124), add a ledger and prune it each tick:

```python
        self.ledger = timetable.SeatLedger()
```

and at the top of `tick()` (line 129):

```python
        self.ledger.prune(now)
```

**Ledger threading (ground-truth #3) — the pump never sees the sim, so thread the
ledger explicitly through every path that reaches `start_rail`:**

1. `advance_plan(npc, now)` gains a `ledger=None` keyword; its internal
   `start_rail(npc, line, to, now)` call becomes `start_rail(npc, line, to, now,
   ledger=ledger)`. (The existing test `test_advance_plan_rails_validly` calls it with
   no ledger — the `ledger=None` default keeps that green via the legacy eta path.)

2. In `RosterSim.tick()`, the scripted-path call `advance_plan(npc, now)` becomes
   `advance_plan(npc, now, ledger=self.ledger)`.

3. In `brain/act.py`: `decide(npc, now, chat_fn=None)` gains a trailing `ledger=None`
   keyword; its final `apply_action(npc, act, now)` becomes `apply_action(npc, act,
   now, ledger=ledger)`. `apply_action(npc, act, now)` gains a trailing `ledger=None`
   keyword; its `roster_sim.start_rail(npc, line, dest, now)` becomes
   `start_rail(npc, line, dest, now, ledger=ledger)`. (These are additive keyword
   defaults — the existing `test_act.py` calls, which pass no ledger, stay green on
   the legacy path.)

4. In `brain/roster_api.py` `ActPump._decide_one`: the decision call
   `await asyncio.to_thread(act.decide, npc, time.time())` becomes
   `await asyncio.to_thread(act.decide, npc, time.time(), None, self.sim.ledger)`
   (positional: `chat_fn=None`, `ledger=self.sim.ledger`), and the scripted fallback
   `roster_sim.advance_plan(npc, time.time())` (both the normal and the except-branch
   call) becomes `roster_sim.advance_plan(npc, time.time(), ledger=self.sim.ledger)`.

This means Task 5 touches four files: `roster_sim.py` (start_rail, advance_plan,
__init__, tick), `act.py` (decide, apply_action), `roster_api.py` (two _decide_one
call sites), plus the new `brain/tests/test_booking.py`. Update the commit `git add`
line accordingly.

- [ ] **Step 4: Run all brain tests**

Run: `python -m pytest brain/tests -q`
Expected: all pass (including the pre-existing suite).

- [ ] **Step 5: Commit (EVO mirror repo)**

```bash
git add brain/roster_sim.py brain/act.py brain/roster_api.py brain/tests/test_booking.py
git commit -m "feat(brain): rail journeys book real timetable calls, 16 seats per train"
```

---

### Task 6: Day-phase gating in the brain — DEFERRED (do not implement in this slice)

**Deferred (ground-truth #1).** This task would gate NPC departures on the brain's
`time.time() % 1800` day-phase. But the client's *visible* day is NOT a pure function
of `Date.now()`: `src/sky.js:936` integrates `this.time += dt/DAY_LENGTH` (seeded 0.3),
and in the shared world it is overwritten by the **relay's** broadcast
(`src/multiplayer.js:218,274` `g.sky.time = m.time`). So night-in-brain-time would not
reliably match night-on-screen, and "no departures at night" could fire in daylight.

**Prerequisite for the follow-up:** SSH to the EVO and read how `worldsvc/server.py`
computes and broadcasts the day clock (`DAY_LENGTH`, whether it sends
`(time.time() % 1800)/1800` or an integrated value, and any seasonal offset). Only once
the brain can compute the SAME value the relay broadcasts should day-phase gating land —
as its own small plan, mirroring the Task 5 structure. Trains are unaffected (pure
wall-clock), so this deferral does not touch the loitering fix.

The morning-errand-weighting and no-night-departures behaviour from the spec
(Workstream A) moves to that follow-up. Nothing else in this plan depends on Task 6.

---

### Task 7: Client rides the booking (dep-aware waits, 16 slots)

**Files:**
- Modify: `src/roster.js` (`_driveRail` lines 673-731, slot maths line 695, ride creation site)
- Create: `scripts/verify-seats.mjs`

- [ ] **Step 1: Write the failing verify script**

Create `scripts/verify-seats.mjs`:

```js
// Booked rail journeys: dep-aware waiting (just-in-time platform arrival, no ranked
// lottery) and a 16-passenger rake across the two coaches.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { railWaitMode, RAIL_WAIT_LEAD, rideSlot, slotBack } from '../src/roster.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

// dep-aware wait: potter until the lead window, then approach; null dep -> legacy path
ok(railWaitMode(1000, null) === null, 'no booking -> caller falls back to ranked legacy');
ok(railWaitMode(1000, 1000 + RAIL_WAIT_LEAD + 1) === 'potter', 'early -> potter in town');
ok(railWaitMode(1000, 1000 + RAIL_WAIT_LEAD) === 'approach', 'inside the lead -> walk in');
ok(railWaitMode(1000, 900) === 'approach', 'train due/dwelling -> stay on the platform');
ok(RAIL_WAIT_LEAD >= 60 && RAIL_WAIT_LEAD <= 90, 'arrive roughly a minute early, per spec');

// 16 seats: slots 1..16, each with a distinct coach position within the rake envelope
const slots = new Set();
for (let i = 0; i < 400; i++) slots.add(rideSlot('pop-whitby-' + i));
ok(slots.size === 16, `full sixteen distinct slots used (got ${slots.size})`);
for (const s of slots) {
  ok(s >= 1 && s <= 16, 'slot in 1..16');
  const b = slotBack(s);
  ok(b >= 11 && b <= 18, `slot ${s} sits within the two coaches (back=${b})`);
}
ok(new Set([...slots].map(slotBack)).size === 16, 'no two slots share a seat position');

// wiring: _driveRail consults the booking before the ranked lottery
const src = readFileSync(new URL('../src/roster.js', import.meta.url), 'utf8');
ok(/railWaitMode\(/.test(src.split('_driveRail')[1] || ''), '_driveRail uses railWaitMode');
ok(/ride\.dep/.test(src), 'ride carries the booked departure');

console.log(`verify-seats: ${n} assertions OK`);
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node scripts/verify-seats.mjs`
Expected: FAIL — `railWaitMode` not exported.

- [ ] **Step 3: Implement in roster.js**

Add near `waitMode` (roster.js:155-177), leaving the legacy exports in place:

```js
// --- booked journeys (timetable-truth brains send dep/arr; spec 2026-07-03) ----------
// With a booking there is no lottery: she potters in town until the lead window,
// walks in to arrive just before her train, and boards on the dwell. The ranked
// waitMode above remains ONLY as the fallback for a dep-less (older) brain.
export const RAIL_WAIT_LEAD = 75;   // seconds before dep to set off for the platform
export function railWaitMode(nowSec, dep, lead = RAIL_WAIT_LEAD) {
  if (dep == null) return null;
  return (dep - nowSec) <= lead ? 'approach' : 'potter';
}

// seat 1..16 across the two coaches, stable per NPC
export function rideSlot(id) { return 1 + (idHash(id) % 16); }
// metres behind the loco lead for a slot — 16 seats spread down the rake
export function slotBack(slot) { return 11 + slot * 0.42; }
```

At the ride creation site — **verified `roster.js:520`** (ground-truth #5): the line is
`e.ride = { line: s.line, from: s.fromStn, to: s.toStn, phase: 'wait', t: 0 };` and the
NPC's state object there is the local **`s`** (not `st`). Add the booking fields:

```js
      e.ride = { line: s.line, from: s.fromStn, to: s.toStn, phase: 'wait', t: 0,
                 dep: s.dep != null ? s.dep : null, arr: s.arr != null ? s.arr : null };
```

In `_driveRail` (roster.js:716-731), insert the booked path before the legacy block, and change the slot maths:

- Replace line 695:

```js
        if (e.ride.slot == null) e.ride.slot = 1 + (Math.round(Math.abs(_spread(e.data.id).dx * 7)) % 8); // 1..8 along the rake
```

with:

```js
        if (e.ride.slot == null) e.ride.slot = rideSlot(e.data.id); // 1..16 across the two coaches
```

- Replace line 696:

```js
        const back = 11 + e.ride.slot * 0.75;               // ~12..17 m behind the loco lead — within the two coaches
```

with:

```js
        const back = slotBack(e.ride.slot);                 // ~11.4..17.7 m behind the loco lead — 16 seats down the rake
```

- After the `titleForced` early-return (line 718-721), insert:

```js
    // Booked journey: no lottery, no platform cap — she times her walk to the train.
    const bm = railWaitMode(Date.now() / 1000, ride.dep);
    if (bm === 'potter') {
      const sp = _spread(e.data.id);
      this._potterAt(m, { x: a.x + sp.dx, z: a.z + sp.dz }, this._nowEff(), dt);
      return;
    }
    if (bm === 'approach') {
      this._walkTo(m, platformPoint(this.world, this.geo, ride.line, ride.from) || a, dt);
      return;
    }
    // (bm === null: dep-less legacy brain — ranked waitMode below still applies)
```

- [ ] **Step 4: Run the verify scripts**

Run: `node scripts/verify-seats.mjs` — expected all OK.
Run: `npm run verify` — expected green (`verify-roster` still passes: `waitMode`/`waiterRank` remain exported for the legacy path).

- [ ] **Step 5: Commit**

```bash
git add src/roster.js scripts/verify-seats.mjs
git commit -m "feat(roster): booked-departure waits (just-in-time boarding) + 16-seat rake"
```

---

### Task 8: Deploy — brain first, then client

- [ ] **Step 1: Back up and ship the brain files to the EVO**

```bash
ssh evo-tailscale 'for f in roster_sim.py act.py roster_api.py; do cp ~/moorstead/yorkshire_bot/brain/$f ~/moorstead/yorkshire_bot/brain/$f.bak-20260703-timetable; done'
scp "C:\Users\James\moorstead-evo-work\brain\timetable.py" "C:\Users\James\moorstead-evo-work\brain\timetable.json" "C:\Users\James\moorstead-evo-work\brain\timetable-fixture.json" "C:\Users\James\moorstead-evo-work\brain\roster_sim.py" "C:\Users\James\moorstead-evo-work\brain\act.py" "C:\Users\James\moorstead-evo-work\brain\roster_api.py" evo-tailscale:~/moorstead/yorkshire_bot/brain/
scp -r "C:\Users\James\moorstead-evo-work\brain\tests" evo-tailscale:~/moorstead/yorkshire_bot/brain/
```

**Note:** the live EVO brain dir is `~/moorstead/yorkshire_bot/brain/` per the paths
above, but the mirror is `~/moorstead-evo-work/brain/` locally — confirm the live path
with `ssh evo-tailscale 'ls ~/moorstead/yorkshire_bot/brain/roster_sim.py'` before scp,
and adjust if the live layout differs. The systemd unit to restart is `moorstead-brain`.

- [ ] **Step 2: Test on the box, then restart the brain**

```bash
ssh evo-tailscale 'cd ~/moorstead/yorkshire_bot && python3 -m pytest brain/tests -q'
```
Expected: all pass.
```bash
ssh evo-tailscale 'sudo -n systemctl restart moorstead-brain && sleep 3 && sudo -n systemctl is-active moorstead-brain'
```
Expected: `active`.

- [ ] **Step 3: Live checks**

Run (client repo): `npm run verify:live`
Expected: green — brain `/status` up, roster populated. Then confirm bookings are flowing:

```bash
curl -s https://www.moorstead.app/brain/api/roster/state | python -c "import json,sys; d=json.load(sys.stdin); r=[n for n in d['npcs'] if n['state']['kind']=='rail']; print(len(r), 'rail;', sum(1 for n in r if 'dep' in n['state']), 'booked')"
```
Expected: every `rail` state carries `dep` (booked count == rail count) once the first post-restart journeys begin.

- [ ] **Step 4: Deploy the client**

Run: `npm run deploy`
(Gates on clean/main/pushed, runs the full verify including the three new scripts, patch-bumps, ships to Vercel, then `verify:live --expect-live`.)

- [ ] **Step 5: In-browser confirmation**

Preview or production: `moorstead.debug.warp('Grosmont')`, watch a train call. Expected: platform empty until ~75s before the call, a handful of folk walk in just before the train, board (up to 16 visible in the coaches), the platform empties again. Nobody potters at a station through a full cycle.
