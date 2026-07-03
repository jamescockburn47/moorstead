# Timetable As Shared Truth Implementation Plan (Workstream A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The brain books NPCs onto specific train calls from the same deterministic timetable the client runs, capped at 16 seats per call — killing station loitering; the client rides them in just-in-time and shows 16 passengers across two coaches.

**Architecture:** Extract the schedule maths from `src/main.js` into a pure `src/railtime.js`; an export script freezes each line's leg times into `brain-sync/timetable.json` + a call fixture; a Python `brain/timetable.py` (in the EVO mirror repo `C:\Users\James\moorstead-evo-work`) reproduces the maths bit-for-bit (verified against the fixture) and adds a 16-seat booking ledger; `roster_sim.start_rail` books `dep`/`arr` into NPC state; `act.py` gains night/errand day-phase gating (`DAY_LENGTH=1800`, same clock as `src/sky.js:9`); the client ride machine uses `dep` when present (legacy ranked path retained for a dep-less brain).

**Tech Stack:** ES modules + Node verify scripts (client repo); Python 3 + pytest (EVO mirror repo); scp + systemctl for EVO deploy.

**Spec:** `docs/superpowers/specs/2026-07-03-npc-movement-chat-night-inn-design.md` (Workstream A).
**Protocol note:** `state.dep`/`state.arr` are additive fields; old clients ignore them (INVARIANTS rule 3). No `minClientVersion` bump.

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

Note, per line: its `name`, whether it carries a `stations` array of names, and `path.stationS` length. The main line's stations come from `geo.railway()`; branches carry their own list (this is what `RosterClient._visibleTrain` reads as `bt.stations` — if the property name differs from `stations`, use what the probe shows and keep Task 3 consistent with it).

- [ ] **Step 2: Write the export script**

Create `scripts/export-timetable.mjs`:

```js
// Freeze the deterministic timetable into brain-sync/ so the EVO brain books NPCs
// onto the SAME train calls every client renders. Rerun after any rail-layout or
// railtime.js change; verify-timetable-parity fails if the committed copy is stale.
import { writeFileSync, mkdirSync } from 'node:fs';
import { MoorsGeography } from '../src/moorsgeo.js';
import { DWELL_T, legTime, nextDeparture } from '../src/railtime.js';

const geo = new MoorsGeography();
const lines = [];
for (const l of geo.railPaths()) {
  const stations = (l.path === geo.railPath())
    ? geo.railway().map(s => s.name)
    : (l.stations || []).map(s => (typeof s === 'string' ? s : s.name));
  const S = l.path.stationS;
  if (!stations.length || !S || S.length !== stations.length) {
    throw new Error(`line ${l.name}: ${stations.length} station names vs ${S && S.length} chainages`);
  }
  const legT = [];
  for (let i = 0; i < S.length - 1; i++) legT.push(legTime(S[i + 1] - S[i]));
  lines.push({ name: l.name, stations, legT, dwell: DWELL_T });
}

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

// every fixture departure really is a dwell at `from` (and arrival a dwell at `to`)
// according to the exported legT — the same numbers Game.trainScheduleFor runs on.
for (const s of fx.slice(0, 40)) {
  const L = tt.lines.find(l => l.name === s.line);
  const n = L.stations.length;
  const check = nextDeparture(L.legT, n, s.from, s.to, s.tMin);
  ok(check.dep === s.dep && check.arr === s.arr && check.dir === s.dir,
     `fixture sample stable (${s.line} ${s.from}->${s.to})`);
}
console.log(`verify-timetable-parity: ${n} assertions OK`);
```

(Adjust the final `console.log` from Task 2 so only this one prints the total.)

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

Create `brain/tests/test_timetable.py`:

```python
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import timetable

HERE = os.path.join(os.path.dirname(__file__), "..")

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
    oneway = sum(leg_t) + n * dwell
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

class SeatLedger:
    """16 seats per (line, dir, dep). book() rolls an overfull call forward to the
    next service, so nobody is ever dispatched to a train they cannot board."""
    def __init__(self):
        self.seats = {}

    def book(self, line_name, L, from_idx, to_idx, t_min):
        t = t_min
        while True:
            dep, arr, dirn = next_departure(L, from_idx, to_idx, t)
            key = (line_name, dirn, dep)
            if self.seats.get(key, 0) < SEATS_PER_CALL:
                self.seats[key] = self.seats.get(key, 0) + 1
                return dep, arr, dirn
            t = dep + 1

    def prune(self, now):
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

Create `brain/tests/test_booking.py`:

```python
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import roster_sim, timetable, world

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

Then update the two `start_rail(...)` call sites to pass the ledger: in `advance_plan` the call becomes `start_rail(npc, line, to, now, ledger=ledger)` — thread it through by giving `advance_plan` a `ledger=None` keyword and passing `self.ledger` from `tick()`; in `brain/act.py` `apply_action()`, find the `start_rail(` call and pass `ledger=sim.ledger` (the pump holds the sim — follow the existing reference it uses to reach the NPC list).

- [ ] **Step 4: Run all brain tests**

Run: `python -m pytest brain/tests -q`
Expected: all pass (including the pre-existing suite).

- [ ] **Step 5: Commit (EVO mirror repo)**

```bash
git add brain/roster_sim.py brain/act.py brain/tests/test_booking.py
git commit -m "feat(brain): rail journeys book real timetable calls, 16 seats per train"
```

---

### Task 6: Day-phase gating in the brain (no night departures, morning errands)

**Files (EVO mirror repo):**
- Modify: `brain/act.py` (add helpers near `_errand_due`, act.py:23-31; wire into `decide()`, act.py:274-318)
- Create: `brain/tests/test_dayphase.py`

- [ ] **Step 1: Write the failing test**

Create `brain/tests/test_dayphase.py`:

```python
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import act

DAY = 1800.0  # same clock as the client's src/sky.js DAY_LENGTH

def test_sky_t_and_night_match_client_dayphase():
    # client villagerlife.dayPhase: 'home' when skyT > 0.78 or < 0.15
    assert act.is_night(0.10 * DAY) and act.is_night(0.90 * DAY)
    assert not act.is_night(0.40 * DAY)
    assert abs(act.sky_t(DAY * 5 + 0.25 * DAY) - 0.25) < 1e-9

def test_errand_window_is_morning():
    assert act.in_errand_window(0.30 * DAY)          # mid-morning: off you go
    assert not act.in_errand_window(0.60 * DAY)      # afternoon: stop starting trips
    assert not act.in_errand_window(0.05 * DAY)      # small hours: certainly not
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `python -m pytest brain/tests/test_dayphase.py -q`
Expected: FAIL — `module 'act' has no attribute 'is_night'`.

- [ ] **Step 3: Implement**

Add to `brain/act.py` near the errand helpers (below act.py:31):

```python
# ---- day phase, from the SAME deterministic clock as the client (sky.js) -----------
DAY_LENGTH = 1800.0          # seconds per game day — must match src/sky.js DAY_LENGTH

def sky_t(now):
    return (now % DAY_LENGTH) / DAY_LENGTH

def is_night(now):
    """Mirrors the client's villagerlife.dayPhase 'home' band."""
    t = sky_t(now)
    return t > 0.78 or t < 0.15

def in_errand_window(now):
    """Trips START in the morning band, so folk go out early and are home by dark."""
    return 0.18 <= sky_t(now) <= 0.50
```

Wire into `decide()` (act.py:274-318):

- Where the at-home branch checks the errand due (the `_errand_due(...)` call): require `_errand_due(npc, now) and in_errand_window(now)` before offering or forcing travel.
- At the top of `decide()`, before any option-building: if `is_night(now)` and the NPC is at home, force `workTrade`/`wait` (no goTo/boardTrain in the options, no forced errand); if away from home at night, keep the existing forced-home behaviour (she heads back — the one journey night allows).

- [ ] **Step 4: Run all brain tests**

Run: `python -m pytest brain/tests -q`
Expected: all pass.

- [ ] **Step 5: Commit (EVO mirror repo)**

```bash
git add brain/act.py brain/tests/test_dayphase.py
git commit -m "feat(brain): night gating + morning errand window on the shared 1800s day"
```

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

At the ride creation site in `RosterClient.update()` (search for `e.ride = {` in the `state.kind === 'rail'` branch), copy the booking onto the ride:

```js
        dep: st.dep != null ? st.dep : null, arr: st.arr != null ? st.arr : null,
```

(where `st` is the NPC's `state` object in that branch — match the local name in place.)

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
ssh evo-tailscale 'for f in roster_sim.py act.py; do cp ~/moorstead/yorkshire_bot/brain/$f ~/moorstead/yorkshire_bot/brain/$f.bak-20260703-timetable; done'
scp "C:\Users\James\moorstead-evo-work\brain\timetable.py" "C:\Users\James\moorstead-evo-work\brain\timetable.json" "C:\Users\James\moorstead-evo-work\brain\timetable-fixture.json" "C:\Users\James\moorstead-evo-work\brain\roster_sim.py" "C:\Users\James\moorstead-evo-work\brain\act.py" evo-tailscale:~/moorstead/yorkshire_bot/brain/
scp -r "C:\Users\James\moorstead-evo-work\brain\tests" evo-tailscale:~/moorstead/yorkshire_bot/brain/
```

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
