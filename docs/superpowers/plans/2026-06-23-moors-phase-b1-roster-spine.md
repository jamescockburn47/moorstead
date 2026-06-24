# Moors 1900 — Phase B.1: Roster-Sim Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the server-authoritative living-NPC pipeline end-to-end with a small scripted cast — the brain runs a real-time roster sim and serves logical NPC state; the moors client polls it and renders the folk walking the dales and riding the lines.

**Architecture:** The roster sim lives in the **brain** (FastAPI, `moorstead-evo-work/brain`) as a background `asyncio` loop over *logical* NPC state — each NPC is `at` a place, `walk`ing a road, or on `rail`. A new `GET /api/roster/state` serves a snapshot `{seq, now, npcs[]}`. The **moors client** (`src/roster.js`) polls it ~1 Hz, then **derives each NPC's voxel position locally every frame** (town anchors for walkers; the line spline via `samplePos` for riders) using the server's clock, and renders them as `spawnVillager` mobs. B.1 uses a **scripted** next-errand policy (no LLM) and a fixed ~6-NPC cast; **B.2** swaps in the LLM `/act` + the procedural population. Moors-gated (`geo.realWorld`), brain-gated (degrades to today's scripted crowd when the brain is offline).

**Tech Stack:** Brain — Python, FastAPI, `pytest` + Starlette `TestClient`. Client — JS ES modules, three.js, the existing `npc.js` / `moorsgeo.js` / `entities.js` / `railpath.js`; `node` for the headless verify.

**Standing rules (READ FIRST):**
- **Do NOT `git commit` or branch** in either repo — James commits manually. Leave all work uncommitted.
- Per-task checkpoint = that task's tests green (`python -m pytest …` or `node scripts/verify-roster.mjs`), plus `npm run build` for client tasks. The plan's TDD steps therefore have **no commit step** — stop at green.
- The **stylised world is untouched**: every client-side NPC-render path is gated on `geo.realWorld`.

**Two repos:**
- **BRAIN:** `C:\Users\James\moorstead-evo-work` — the FastAPI app is `brain/app.py`; run pytest from this dir. New modules go in `brain/`.
- **CLIENT:** `C:\Users\James\Desktop\Moorcraft` — the game.

---

## The contract — `GET /api/roster/state`

The brain serves **logical** state; the client owns all geometry. Names (`place`, `line`, `fromStn`, `toStn`) MUST match the client's `moorsgeo` names exactly — the client resolves them to coordinates.

```jsonc
{
  "seq": 1234,            // monotonic tick counter (B.1: client ignores; B.2 uses for deltas)
  "now": 1719150000.0,    // the sim's clock (unix seconds) at snapshot time
  "npcs": [
    {
      "id": "amos",
      "name": "Amos Burnett",
      "role": "jet-cutter",
      "intent": "taking carved jet to Pickering",   // human-readable; seeds chat in B.3
      "state": { "kind": "at", "place": "Whitby" }
      //   | { "kind": "walk", "from": "Ruswarp", "to": "Sleights", "started": 1719149900.0, "eta": 1719150100.0 }
      //   | { "kind": "rail", "line": "Whitby & Pickering", "fromStn": "Grosmont", "toStn": "Pickering", "started": 1719149950.0, "eta": 1719150190.0 }
    }
  ]
}
```

**Client derivation (per NPC, every frame), using `nowEff = now + (localElapsed since snapshot)`:**
- `at`     → the town anchor: `village(place)` → `{x, ground+1, z}`.
- `walk`   → the client **steers** the mob from anchor(`from`) toward anchor(`to`) (`steerWalk`): each frame it takes the most direct *walkable* heading, skirting buildings, drystone walls, and trees, keeping to walkable ground + gentle slopes, paced to arrive by `eta`. NOT a straight lerp. (A real lane network between towns is a later B.2+ refinement.)
- `rail`   → on the named line's spline: `sNow = lerp(stationS[fromIdx], stationS[toIdx], f)`; `samplePos(path, sNow)` → `{x, deck+1, z}`.

---

## File structure

**Brain (`moorstead-evo-work/`):**
- Create `brain/moors-data.json` — a copy of the client's `data/moors-data.json` (the sim reads `towns`, `stations`, `lines` from it; names stay in sync because it's the same source). Re-copy if the world's geography changes.
- Create `brain/world.py` — loads the topology; exposes `TOWNS`, `STATIONS`, `LINES`, `line_between(a,b)`, `WALK_SECONDS`, `RAIL_SECONDS`.
- Create `brain/roster_sim.py` — `NPC` model, pure executors, the scripted cast, `RosterSim`.
- Modify `brain/app.py` — add the `lifespan` background loop + `GET /api/roster/state`.
- Create `brain/test_roster_sim.py` — pytest for executors, tick, snapshot, endpoint.

**Client (`Moorcraft/`):**
- Modify `src/npc.js` — add `rosterState()`.
- Create `src/roster.js` — `npcVoxelPos()` (pure mapping, exported) + `RosterClient` (poll + spawn/despawn/drive).
- Modify `src/main.js` — instantiate `RosterClient`, poll, and `update()` each frame (moors+brain gated, degrade).
- Create `scripts/verify-roster.mjs` — headless test of `npcVoxelPos` + the name-resolution contract.
- Modify `package.json` — append `verify-roster.mjs` to the `verify` chain.

---

## Brain tasks (run from `C:\Users\James\moorstead-evo-work`)

### Task 1: Logical geography (`world.py`)

**Files:**
- Create: `brain/moors-data.json` (copy of `Moorcraft/data/moors-data.json`)
- Create: `brain/world.py`
- Test: `brain/test_roster_sim.py` (start the file here)

- [ ] **Step 1: Copy the world data**

```bash
cp /c/Users/James/Desktop/Moorcraft/data/moors-data.json /c/Users/James/moorstead-evo-work/brain/moors-data.json
```

- [ ] **Step 2: Write the failing test**

Create `brain/test_roster_sim.py`:

```python
import world

def test_world_loads_real_names():
    assert "Whitby" in world.TOWNS and "Pickering" in world.TOWNS
    assert "Whitby & Pickering" in world.LINES
    # every station named on a line is a known station
    for line, stops in world.LINES.items():
        assert len(stops) >= 2, f"{line} has too few stops"
        for s in stops:
            assert s in world.STATIONS, f"{s} on {line} is not a station"

def test_line_between():
    # two towns sharing a line return that line; unrelated towns return None
    assert world.line_between("Whitby", "Pickering") == "Whitby & Pickering"
    assert world.line_between("Whitby", "Whitby") is None
```

- [ ] **Step 3: Run it — expect failure**

Run: `cd /c/Users/James/moorstead-evo-work && python -m pytest brain/test_roster_sim.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'world'`.

- [ ] **Step 4: Implement `brain/world.py`**

```python
"""Logical place/rail graph for the roster sim — loaded from the SAME moors-data.json
the client uses, so place/line/station names match the client's moorsgeo exactly."""
import json, os

_DATA = json.load(open(os.path.join(os.path.dirname(__file__), "moors-data.json"), encoding="utf-8"))

TOWNS = [t["name"] for t in _DATA["towns"]]
STATIONS = [s["name"] for s in _DATA["stations"]]
# line name -> ordered list of station names actually present as stations
LINES = {
    l["name"]: [n for n in l.get("stations", []) if n in set(STATIONS)]
    for l in _DATA.get("lines", [])
}
LINES = {name: stops for name, stops in LINES.items() if len(stops) >= 2}

WALK_SECONDS = 200   # nominal walk between adjacent towns (B.1 flat; refine in B.2)
RAIL_SECONDS = 60    # nominal ride PER LEG (per intermediate station) on a line

def line_between(a, b):
    """A line that carries both stations (in order), else None."""
    if a == b:
        return None
    for name, stops in LINES.items():
        if a in stops and b in stops:
            return name
    return None

def leg_count(line, a, b):
    stops = LINES.get(line, [])
    if a not in stops or b not in stops:
        return 1                       # safe default — never raises on a bad name
    return abs(stops.index(a) - stops.index(b))
```

- [ ] **Step 5: Run it — expect pass**

Run: `python -m pytest brain/test_roster_sim.py -v`
Expected: PASS (2 tests). If a line's stations don't match `STATIONS`, the loader drops them — check `moors-data.json` `lines[].stations` vs `stations[].name`.

---

### Task 2: NPC model + pure executors (`roster_sim.py`)

**Files:**
- Create: `brain/roster_sim.py`
- Test: `brain/test_roster_sim.py` (append)

- [ ] **Step 1: Write failing tests** (append to `test_roster_sim.py`)

```python
import roster_sim as rs

def test_start_walk_sets_transit():
    npc = rs.NPC(id="x", name="X", role="r", place="Whitby")
    rs.start_walk(npc, "Sleights", now=1000.0)
    assert npc.state["kind"] == "walk"
    assert npc.state["from"] == "Whitby" and npc.state["to"] == "Sleights"
    assert npc.state["eta"] == 1000.0 + rs.world.WALK_SECONDS

def test_arrive_lands_at_destination():
    npc = rs.NPC(id="x", name="X", role="r", place="Whitby")
    rs.start_walk(npc, "Sleights", now=1000.0)
    rs.arrive(npc, now=1000.0 + rs.world.WALK_SECONDS)
    assert npc.state == {"kind": "at", "place": "Sleights"}
    assert npc.place == "Sleights"

def test_start_rail_sets_leg_timed_transit():
    npc = rs.NPC(id="x", name="X", role="r", place="Whitby")
    rs.start_rail(npc, "Whitby & Pickering", "Pickering", now=2000.0)
    assert npc.state["kind"] == "rail"
    assert npc.state["line"] == "Whitby & Pickering"
    assert npc.state["eta"] > 2000.0   # at least one leg of time
```

- [ ] **Step 2: Run — expect fail** (`ModuleNotFoundError: roster_sim`)

Run: `python -m pytest brain/test_roster_sim.py -v`

- [ ] **Step 3: Implement `brain/roster_sim.py`** (model + executors only — cast/sim come next)

```python
"""The roster sim: logical NPC state advanced in real time. B.1 decisions are SCRIPTED
(a fixed itinerary per NPC); B.2 replaces the policy with the brain LLM /act call."""
from dataclasses import dataclass, field
import world

@dataclass
class NPC:
    id: str
    name: str
    role: str
    place: str                       # last known place (where a transit ends / where they stand)
    intent: str = ""
    state: dict = field(default_factory=dict)   # {"kind":"at","place":..} | walk | rail
    itinerary: list = field(default_factory=list)  # scripted steps: ("walk",to) | ("rail",line,to)
    step: int = 0

    def __post_init__(self):
        if not self.state:
            self.state = {"kind": "at", "place": self.place}

# ---- pure executors: (npc, now, ...) -> mutate npc.state/.place; no I/O ----
def start_walk(npc, to, now):
    npc.state = {"kind": "walk", "from": npc.place, "to": to,
                 "started": now, "eta": now + world.WALK_SECONDS}

def start_rail(npc, line, to, now):
    legs = max(1, world.leg_count(line, npc.place, to))
    npc.state = {"kind": "rail", "line": line, "fromStn": npc.place, "toStn": to,
                 "started": now, "eta": now + legs * world.RAIL_SECONDS}

def arrive(npc, now):
    dest = npc.state.get("to") or npc.state.get("toStn") or npc.place
    npc.place = dest
    npc.state = {"kind": "at", "place": dest}

def in_transit(npc):
    return npc.state["kind"] in ("walk", "rail")

def transit_done(npc, now):
    return in_transit(npc) and now >= npc.state["eta"]
```

- [ ] **Step 4: Run — expect pass** (3 new tests)

Run: `python -m pytest brain/test_roster_sim.py -v`

---

### Task 3: The scripted cast + next-errand policy

**Files:**
- Modify: `brain/roster_sim.py` (append)
- Test: `brain/test_roster_sim.py` (append)

- [ ] **Step 1: Write failing tests**

```python
def test_build_cast_is_valid_and_deterministic():
    a, b = rs.build_cast(), rs.build_cast()
    assert 4 <= len(a) <= 8
    ids = [n.id for n in a]
    assert len(ids) == len(set(ids)), "ids unique"
    for n in a:
        assert n.place in world.TOWNS
        for stepkind, *args in n.itinerary:
            assert stepkind in ("walk", "rail")
    assert [n.id for n in a] == [n.id for n in b], "deterministic"

def test_advance_plan_rails_validly():
    # data-driven: use a real line + its real stops, so this never depends on guessed names
    line = next(iter(world.LINES)); stops = world.LINES[line]
    npc = rs.NPC(id="x", name="X", role="r", place=stops[0],
                 itinerary=[("rail", line, stops[-1]), ("rail", line, stops[0])])
    rs.advance_plan(npc, now=10.0)
    assert npc.state["kind"] == "rail" and npc.state["toStn"] == stops[-1]
    rs.arrive(npc, now=10.0 + 9999)
    assert npc.place == stops[-1]

def test_advance_plan_skips_invalid_step_and_rests():
    # a step that can't be honoured (unknown line/town) must not wedge the sim
    npc = rs.NPC(id="y", name="Y", role="r", place="Whitby",
                 itinerary=[("rail", "No Such Line", "Nowhere")])
    rs.advance_plan(npc, now=0.0)
    assert npc.state == {"kind": "at", "place": "Whitby"}   # invalid -> safe rest
```

- [ ] **Step 2: Run — expect fail** (`AttributeError: build_cast`)

- [ ] **Step 3: Implement (append to `roster_sim.py`)**

```python
def advance_plan(npc, now):
    """Scripted policy: run the next VALID itinerary step (cycling). Skips a step whose
    precondition fails (bad name, or not on the line) and rests if none are valid, so a
    data mismatch can never wedge the sim. B.2 replaces this whole function with the LLM."""
    if not npc.itinerary:
        return
    for _ in range(len(npc.itinerary)):
        kind, *args = npc.itinerary[npc.step % len(npc.itinerary)]
        npc.step += 1
        if kind == "walk":
            (to,) = args
            if to in world.TOWNS:
                npc.intent = f"walking to {to}"
                start_walk(npc, to, now)
                return
        elif kind == "rail":
            line, to = args
            stops = world.LINES.get(line, [])
            if npc.place in stops and to in stops:
                npc.intent = f"taking the {line} train to {to}"
                start_rail(npc, line, to, now)
                return
    # nothing runnable from here -> rest in place (safe fallback; never wedges)
    npc.intent = "resting"
    npc.state = {"kind": "at", "place": npc.place}

def build_cast():
    """A small fixed B.1 cast. Names/places/lines must exist in world.* (the contract test
    on the CLIENT asserts every emitted name resolves; keep these in step with moors-data)."""
    cast = [
        NPC(id="amos",  name="Amos Burnett",  role="jet-cutter", place="Whitby",
            itinerary=[("walk", "Ruswarp"), ("rail", "Whitby & Pickering", "Pickering"),
                       ("rail", "Whitby & Pickering", "Whitby")]),
        NPC(id="mary",  name="Mary Agar",     role="fishwife",   place="Whitby",
            itinerary=[("walk", "Sleights"), ("walk", "Whitby")]),
        NPC(id="jonty", name="Jonty Featherstone", role="drover", place="Grosmont",
            itinerary=[("rail", "Esk Valley", "Glaisdale"), ("rail", "Esk Valley", "Grosmont")]),
        NPC(id="edith", name="Edith Raw",     role="postmistress", place="Pickering",
            itinerary=[("rail", "Whitby & Pickering", "Goathland"),
                       ("rail", "Whitby & Pickering", "Pickering")]),
        NPC(id="tom",   name="Tom Pennock",   role="platelayer", place="Goathland",
            itinerary=[("walk", "Grosmont"), ("walk", "Goathland")]),
        NPC(id="bess",  name="Bess Harland",  role="herbwife",   place="Lealholm",
            itinerary=[("rail", "Esk Valley", "Danby"), ("rail", "Esk Valley", "Lealholm")]),
    ]
    # Drop any NPC whose itinerary references an unknown line/station, so the sim never wedges.
    out = []
    for n in cast:
        ok = n.place in world.TOWNS
        for kind, *args in n.itinerary:
            if kind == "rail":
                line, to = args
                ok = ok and line in world.LINES and to in world.LINES[line]
            else:
                ok = ok and args[0] in world.TOWNS
        if ok:
            out.append(n)
    return out
```

- [ ] **Step 4: Run — expect pass.** If `build_cast()` drops NPCs (count < 4), a line/station name is wrong — fix the itinerary names against `world.LINES` (print it) and re-run.

---

### Task 4: `RosterSim` — tick + snapshot

**Files:**
- Modify: `brain/roster_sim.py` (append)
- Test: `brain/test_roster_sim.py` (append)

- [ ] **Step 1: Write failing tests**

```python
def test_tick_advances_idle_npc_into_transit():
    sim = rs.RosterSim(seed_now=0.0)
    # everyone starts "at"; first tick should launch each into their first step
    sim.tick(now=0.0)
    assert any(n.state["kind"] in ("walk", "rail") for n in sim.npcs)

def test_tick_completes_a_transit():
    sim = rs.RosterSim(seed_now=0.0)
    sim.tick(now=0.0)
    mover = next(n for n in sim.npcs if rs.in_transit(n))
    eta = mover.state["eta"]
    sim.tick(now=eta + 1)          # past arrival -> arrives AND launches next step
    assert mover.place in world.TOWNS                 # arrived at a real place
    assert mover.state["kind"] in ("at", "walk", "rail")

def test_snapshot_shape():
    sim = rs.RosterSim(seed_now=5.0)
    sim.tick(now=5.0)
    snap = sim.snapshot(now=5.0)
    assert set(snap.keys()) == {"seq", "now", "npcs"}
    n0 = snap["npcs"][0]
    assert set(n0.keys()) == {"id", "name", "role", "intent", "state"}
    assert n0["state"]["kind"] in ("at", "walk", "rail")
```

- [ ] **Step 2: Run — expect fail** (`AttributeError: RosterSim`)

- [ ] **Step 3: Implement (append to `roster_sim.py`)**

```python
class RosterSim:
    def __init__(self, seed_now=0.0):
        self.npcs = build_cast()
        self.seq = 0
        self._launched = False

    def tick(self, now):
        for npc in self.npcs:
            if not self._launched and npc.state["kind"] == "at":
                advance_plan(npc, now)          # kick everyone off on the first tick
            elif transit_done(npc, now):
                arrive(npc, now)
                advance_plan(npc, now)          # immediately pick the next errand
        self._launched = True
        self.seq += 1

    def snapshot(self, now):
        return {
            "seq": self.seq,
            "now": now,
            "npcs": [
                {"id": n.id, "name": n.name, "role": n.role, "intent": n.intent, "state": n.state}
                for n in self.npcs
            ],
        }
```

- [ ] **Step 4: Run — expect pass** (all brain tests green so far).

---

### Task 5: Background loop (lifespan) + `GET /api/roster/state`

**Files:**
- Modify: `brain/app.py` (the `app = FastAPI(...)` line + add the endpoint)
- Test: `brain/test_roster_sim.py` (append an endpoint test)

- [ ] **Step 1: Write the failing endpoint test**

```python
def test_roster_state_endpoint():
    from starlette.testclient import TestClient
    import app as brain_app
    with TestClient(brain_app.app) as client:      # 'with' runs the lifespan (starts the loop)
        r = client.get("/api/roster/state")
        assert r.status_code == 200
        body = r.json()
        assert "npcs" in body and isinstance(body["npcs"], list) and len(body["npcs"]) >= 4
        assert "now" in body and "seq" in body
```

- [ ] **Step 2: Run — expect fail** (404, or no `lifespan`).

Run: `python -m pytest brain/test_roster_sim.py::test_roster_state_endpoint -v`
(If `ModuleNotFoundError` for `app`'s own deps — `config`, `ollama_client`, etc. — run from `moorstead-evo-work/brain` or add it to `sys.path`; the brain's deps must import. The sim itself needs none of them.)

- [ ] **Step 3: Wire the loop + endpoint into `app.py`**

At the top of `app.py`, with the other imports:

```python
import asyncio, time
from contextlib import asynccontextmanager
import roster_sim
```

Replace the existing line `app = FastAPI(title="Village Brain")` (app.py:11) with:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    sim = roster_sim.RosterSim(seed_now=time.time())
    app.state.roster = sim
    async def _loop():
        while True:
            sim.tick(time.time())
            await asyncio.sleep(1.0)
    task = asyncio.create_task(_loop())
    try:
        yield
    finally:
        task.cancel()

app = FastAPI(title="Village Brain", lifespan=lifespan)
```

Add the endpoint (near the other `@app.get` routes, e.g. by `/api/characters`):

```python
@app.get("/api/roster/state")
def roster_state():
    """Logical state of the living moors roster (Phase B.1)."""
    sim = getattr(app.state, "roster", None)
    if sim is None:
        return {"seq": 0, "now": time.time(), "npcs": []}
    return sim.snapshot(time.time())
```

- [ ] **Step 4: Run — expect pass**

Run: `python -m pytest brain/test_roster_sim.py -v`
Expected: ALL brain tests PASS.

- [ ] **Step 5: Smoke-run the brain (manual, optional)**

If the brain has a run command (uvicorn), start it and `curl localhost:<port>/api/roster/state` twice a few seconds apart — the `now` advances and at least one NPC's `state` changes over ~a minute. (No commit.)

---

## Client tasks (run from `C:\Users\James\Desktop\Moorcraft`)

### Task 6: `npc.js` — `rosterState()`

**Files:**
- Modify: `src/npc.js`

- [ ] **Step 1: Read the existing fetch idiom**

Read `src/npc.js` around `const BASE = '/brain'` and `fetchRoster()` (it wraps a `fetch` with a timeout and returns `null`/fallback on failure). Mirror it.

- [ ] **Step 2: Add `rosterState()`** next to `fetchRoster()`

```js
// Phase B.1: the living-roster sim's logical state (or null if the brain's offline).
export async function rosterState() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${BASE}/api/roster/state`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.json();   // { seq, now, npcs:[...] }
  } catch {
    return null;               // degrade silently — the client falls back to the scripted crowd
  }
}
```

(If `npc.js` already centralises fetch in a `req()` helper, use it instead — match the file.)

- [ ] **Step 3: Verify the dev proxy** — confirm `/brain` is proxied to the brain in `vite.config.*`. If not, note it; the poll fails closed (returns null) without it, which is the intended degrade.

---

### Task 7: `roster.js` — the pure mapping + headless verify

**Files:**
- Create: `src/roster.js`
- Create: `scripts/verify-roster.mjs`
- Modify: `package.json` (verify chain)

- [ ] **Step 1: Write the failing headless test** `scripts/verify-roster.mjs`

```js
// Headless: the logical->voxel mapping yields valid positions, and every name a sim
// state can carry resolves in moorsgeo. Mirrors the verify-*.mjs pattern.
import assert from 'node:assert';
import { Gen, MOORS_SEED } from '../src/worldgen.js';
import { B } from '../src/defs.js';
import { npcVoxelPos, townAnchor, steerWalk, walkableStep } from '../src/roster.js';

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const geo = new Gen(MOORS_SEED).geo;

// 'at' -> the village coordinate
const wh = geo.villages.find(v => v.name === 'Whitby');
const atP = npcVoxelPos({ state: { kind: 'at', place: 'Whitby' } }, 100, geo);
ok(Math.abs(atP.x - wh.x) < 1 && Math.abs(atP.z - wh.z) < 1, "'at' maps to the town anchor");

// 'walk' -> between the two anchors at the right fraction
const a = townAnchor('Whitby', geo), b = townAnchor('Sleights', geo);
const midT = 100, walk = { state: { kind: 'walk', from: 'Whitby', to: 'Sleights', started: midT, eta: midT + 200 } };
const wP = npcVoxelPos(walk, midT + 100, geo); // halfway
ok(Math.abs(wP.x - (a.x + b.x) / 2) < 2 && Math.abs(wP.z - (a.z + b.z) / 2) < 2, "'walk' interpolates to the midpoint");

// 'rail' -> a point on the named line's spline, in-bounds, between the stations
const rail = { state: { kind: 'rail', line: 'Whitby & Pickering', fromStn: 'Grosmont', toStn: 'Pickering', started: 0, eta: 120 } };
const rP = npcVoxelPos(rail, 60, geo);
ok(rP && isFinite(rP.x) && isFinite(rP.z), "'rail' returns a finite position on the line");
const bnd = geo.worldBounds();
ok(rP.x >= bnd.minX && rP.x <= bnd.maxX && rP.z >= bnd.minZ && rP.z <= bnd.maxZ, "'rail' position is in-world");

// name-resolution contract: an unknown place returns null (caller skips it, never crashes)
ok(npcVoxelPos({ state: { kind: 'at', place: 'Nowhere-on-Sea' } }, 0, geo) === null, 'unknown place -> null (safe)');

// --- naturalistic walking: skirts obstacles, makes progress on open ground ---
const openWorld = { getBlock: () => B.AIR };                         // nothing in the way
const startA = townAnchor('Whitby', geo), goalB = townAnchor('Sleights', geo);
const mob = { pos: { x: startA.x, y: startA.y, z: startA.z }, yaw: 0 };
const d0 = Math.hypot(goalB.x - mob.pos.x, goalB.z - mob.pos.z);
for (let i = 0; i < 80; i++) steerWalk(mob, startA, goalB, 0, 10000, i * 0.5, openWorld, geo, 0.5);
ok(Math.hypot(goalB.x - mob.pos.x, goalB.z - mob.pos.z) < d0 - 5, 'steerWalk makes progress toward the goal');

// a 2-high solid column (building / wall / tree) is NOT standable; open ground IS
const gAt = (x, z) => geo.height(Math.round(x), Math.round(z));
const solidWorld = { getBlock: (x, y, z) => (y > gAt(x, z) ? B.COBBLE : B.GRASS) };
const fg = gAt(startA.x, startA.z);
ok(!walkableStep(solidWorld, geo, startA.x + 4, startA.z, fg), 'walkableStep rejects a 2-high solid (no walking through buildings/trees)');
ok(walkableStep(openWorld, geo, startA.x + 4, startA.z, fg), 'walkableStep accepts open walkable ground');

console.log(`verify-roster: ${n} assertions OK`);
```

- [ ] **Step 2: Run — expect fail** (`Cannot find module '../src/roster.js'`)

Run: `node scripts/verify-roster.mjs`

- [ ] **Step 3: Implement the mapping in `src/roster.js`**

```js
// Phase B.1 — render the brain's living roster. The brain owns logical state; this file
// owns ALL geometry: it maps {at|walk|rail} to a voxel position the client can draw.
import { rosterState } from './npc.js';
import { B } from './defs.js';

const clamp01 = t => t < 0 ? 0 : t > 1 ? 1 : t;

// the town's anchor: its marker coordinate + standing height. null if the name is unknown.
export function townAnchor(name, geo) {
  const v = geo.villages.find(t => t.name === name);
  if (!v) return null;
  return { x: v.x, y: (v.ground != null ? v.ground : geo.height(v.x, v.z)) + 1, z: v.z };
}

// logical state -> {x,y,z, frac?}. Returns null if any referenced name can't be resolved
// (the caller then skips that NPC this frame rather than crashing).
export function npcVoxelPos(npc, nowEff, geo) {
  const s = npc.state;
  if (!s) return null;
  if (s.kind === 'at') return townAnchor(s.place, geo);

  if (s.kind === 'walk') {
    const a = townAnchor(s.from, geo), b = townAnchor(s.to, geo);
    if (!a || !b) return null;
    const f = clamp01((nowEff - s.started) / Math.max(1, s.eta - s.started));
    const x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f;
    return { x, y: geo.height(Math.round(x), Math.round(z)) + 1, z, frac: f };
  }

  if (s.kind === 'rail') {
    const lp = geo.railPaths().find(l => l.name === s.line);
    const ln = geo.railLines().find(l => l.name === s.line);
    if (!lp || !ln) return null;
    const iF = ln.stops.findIndex(t => t.name === s.fromStn);
    const iT = ln.stops.findIndex(t => t.name === s.toStn);
    if (iF < 0 || iT < 0) return null;
    const sS = lp.path.stationS, sF = sS[iF], sT = sS[iT];
    const f = clamp01((nowEff - s.started) / Math.max(1, s.eta - s.started));
    const sNow = sF + (sT - sF) * f;
    const p = geo.samplePosOn(lp.path, sNow);
    return { x: p.x, y: p.deck + 1, z: p.z, frac: f };
  }
  return null;
}

// --- naturalistic walking ----------------------------------------------------------------
// A person can stand at (x,z): walkable surface, gentle slope, and NOT blocked by a 2-high
// solid column (a building, a drystone wall, or a tree) — those they walk AROUND. They don't
// cross open water (B.2 adds fords / level crossings). Trees + buildings are voxel-world
// blocks (not in geo), so this needs the chunk `world`, not just geo's terrain height.
export function walkableStep(world, geo, x, z, fromG) {
  const rx = Math.round(x), rz = Math.round(z);
  const g = geo.height(rx, rz);
  if (g == null || Math.abs(g - fromG) > 1.3) return false;          // off-map or too steep a step
  if (world.getBlock(rx, g, rz) === B.WATER) return false;            // not across open water
  const a1 = world.getBlock(rx, g + 1, rz), a2 = world.getBlock(rx, g + 2, rz);
  if (a1 !== B.AIR && a2 !== B.AIR) return false;                     // 2-high solid -> go around
  return true;
}

// Steer a walking mob toward its destination anchor, skirting buildings/walls/trees and
// following the ground, paced to arrive by `eta`. Mutates mob.pos/yaw. The streamed mob's
// own wander AI is off (it's driven here, like a ridden pony / remote player), so this owns
// its locomotion. Server keeps the LOGICAL leg + eta; the client owns HOW it walks there.
export function steerWalk(mob, from, to, started, eta, now, world, geo, dt) {
  const dx = to.x - mob.pos.x, dz = to.z - mob.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1.2) { mob.pos.x = to.x; mob.pos.z = to.z; mob.pos.y = to.y; return; } // arrived
  const remain = Math.max(1, eta - now);
  const speed = Math.max(1.2, Math.min(3.0, dist / remain));         // blocks/sec, paced to the eta
  const goal = Math.atan2(dx, dz);
  const fromG = geo.height(Math.round(mob.pos.x), Math.round(mob.pos.z));
  // context steering: take the most direct heading (fanned out from the goal) that's walkable
  let best = null;
  for (const off of [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4]) {
    const h = goal + off;
    const lx = mob.pos.x + Math.sin(h) * 1.6, lz = mob.pos.z + Math.cos(h) * 1.6;  // look-ahead
    if (walkableStep(world, geo, lx, lz, fromG)) { best = h; break; }
  }
  if (best == null) best = goal;          // boxed in -> head at the goal; Phase A rescue recovers
  const step = speed * dt;
  const nx = mob.pos.x + Math.sin(best) * step, nz = mob.pos.z + Math.cos(best) * step;
  mob.pos.x = nx; mob.pos.z = nz;
  mob.pos.y = geo.height(Math.round(nx), Math.round(nz)) + 1;        // follow the ground
  mob.yaw = best;
}
```

- [ ] **Step 4: Run — expect pass** (8 assertions).

- [ ] **Step 5: Wire into the verify chain** — in `package.json`, append to the `verify` script:

```
 && node scripts/verify-roster.mjs
```

- [ ] **Step 6:** Run `npm run verify` — expect ALL prior verifies plus `verify-roster: 8 assertions OK`.

---

### Task 8: `RosterClient` — poll, spawn/despawn, drive; wire into `main.js`

**Files:**
- Modify: `src/roster.js` (append the class)
- Modify: `src/main.js` (instantiate + per-frame update)

- [ ] **Step 1: Append `RosterClient` to `src/roster.js`**

```js
// Polls the brain's roster, holds logical state, and drives one villager mob per NPC.
// Moors + brain gated. Degrades cleanly: if a poll fails, streamed mobs are removed and
// the existing scripted crowd remains.
export class RosterClient {
  constructor(game) {
    this.game = game;
    this.geo = game.world.gen.geo;
    this.world = game.world;      // chunk world — steerWalk needs it for tree/building obstacles
    this.npcs = new Map();       // id -> { data, mob }
    this.serverNow = 0; this.recvAt = 0; this.active = false;
    this._pollMs = 1500;
  }

  start() {
    if (this._timer || !this.geo.realWorld) return;
    const poll = async () => {
      const snap = await rosterState();
      if (snap && Array.isArray(snap.npcs)) {
        this.serverNow = snap.now;
        this.recvAt = performance.now() / 1000;
        this.active = true;
        this._sync(snap.npcs);
      } else if (this.active) {
        this._teardown();        // brain went away -> drop streamed folk, fall back
        this.active = false;
      }
      this._timer = setTimeout(poll, this._pollMs);
    };
    poll();
  }

  _nowEff() { return this.serverNow + (performance.now() / 1000 - this.recvAt); }

  _sync(list) {
    const seen = new Set();
    for (const d of list) {
      seen.add(d.id);
      let e = this.npcs.get(d.id);
      if (!e) {
        const p0 = npcVoxelPos(d, this._nowEff(), this.geo) || { x: this.geo.villages[0].x, y: 64, z: this.geo.villages[0].z };
        const mob = this.game.entities.spawnVillager(d.id, d.name, p0.x, p0.y, p0.z, { role: d.role, roam: false, streamed: true });
        e = { data: d, mob };
        this.npcs.set(d.id, e);
      } else {
        e.data = d;
      }
    }
    for (const [id, e] of this.npcs) if (!seen.has(id)) { this._remove(e); this.npcs.delete(id); }
  }

  _remove(e) { if (e.mob) this.game.entities.removeMob ? this.game.entities.removeMob(e.mob) : (e.mob.dead = true); }
  _teardown() { for (const [, e] of this.npcs) this._remove(e); this.npcs.clear(); }

  // called each frame: drive each streamed mob. 'walk' uses naturalistic steering (skirts
  // buildings / walls / trees); 'at' + 'rail' track the authoritative point directly.
  update(dt) {
    if (!this.active) return;
    const nowEff = this._nowEff();
    for (const [, e] of this.npcs) {
      const m = e.mob; if (!m) continue;
      const s = e.data.state;
      if (s && s.kind === 'walk') {
        const from = townAnchor(s.from, this.geo), to = townAnchor(s.to, this.geo);
        if (from && to) steerWalk(m, from, to, s.started, s.eta, nowEff, this.world, this.geo, dt);
      } else {
        const p = npcVoxelPos(e.data, nowEff, this.geo);   // 'at' anchor / 'rail' on the line
        if (!p) continue;
        const k = Math.min(1, dt * 6);                     // lerp idiom (as multiplayer remotes)
        m.pos.x += (p.x - m.pos.x) * k; m.pos.y += (p.y - m.pos.y) * k; m.pos.z += (p.z - m.pos.z) * k;
        const ddx = p.x - m.pos.x, ddz = p.z - m.pos.z;
        if (ddx * ddx + ddz * ddz > 0.01) m.yaw = Math.atan2(ddx, ddz);
      }
      if (e.data.intent) m.intent = e.data.intent;         // B.3 surfaces this in chat/markers
    }
  }
}
```

> **Note for the implementer:** confirm `entities.spawnVillager(charId, name, x, y, z, opts)`'s real signature and whether a remove helper exists (grep `removeMob` / how dead mobs are culled in `entities.js`). Adjust `_remove` to the real cull path. If `spawnVillager` doesn't accept a `streamed` opt, add a benign flag so these mobs skip the local wander AI (they're driven here, like a ridden pony / remote player). Do NOT let the local villager AI fight the streamed position.

- [ ] **Step 2: Wire into `main.js`**

Find where the moors world is set up (where `geo.realWorld` is known and `this.entities` exists) and where the per-frame update loop runs (near `updateRide` / `updateTrainWorld`). Add:

Construction (moors only), after entities + world exist:

```js
if (this.world.gen.geo.realWorld) {
  this.roster = new RosterClient(this);
  this.roster.start();
}
```

Import at the top of `main.js`:

```js
import { RosterClient } from './roster.js';
```

In the frame update (with the other `update*` calls):

```js
if (this.roster) this.roster.update(dt);
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `BUILD ok` (no import/syntax errors).

- [ ] **Step 4: In-game smoke check (preview)** — start the preview, enter the moors world, and confirm via `preview_eval`:
  - `game.roster` exists and `game.roster.npcs.size >= 4` once a poll lands (needs the brain reachable through the dev proxy; if not, `active` stays false and the scripted crowd shows — that's the correct degrade).
  - over ~30s, a streamed mob's `pos` changes (walking) and a `rail` NPC sits on the line.
  - the stylised world (non-realWorld) shows NO streamed roster (gate holds).

---

## Wrap-up

- [ ] **Brain:** `cd /c/Users/James/moorstead-evo-work && python -m pytest brain/test_roster_sim.py -v` → all green.
- [ ] **Client:** `npm run verify` → all green incl. `verify-roster`; `npm run build` → BUILD ok.
- [ ] **In-game:** the moors world shows the scripted cast walking/riding when the brain's up; degrades to today's crowd when it's down; stylised world untouched.
- [ ] **No commit** — leave everything uncommitted for James to review/commit.
- [ ] **Deploy** is brain-side (the new endpoint must be live on the EVO for the deployed client to see roster folk) — flag to James; do not deploy unprompted.

---

## What B.1 deliberately leaves for later

- **B.2:** replace `advance_plan`'s scripted itinerary with the brain **LLM `/act`** (decision = persona + state + world context + action-set → next action, validated), the full **action-set** (`workTrade`/`sell`/`buy`/`giveParcel`/`say`), **priority-driven** activation, and the **procedural population generator** (~80–100, scaled to towns + farms). Riders get seated in the **actual scheduled train** (align the sim's `rail` transit to the client timetable + `samplePos` seat) instead of interpolating along the line.
- **B.3 (was Phase C):** map/minimap/station-board discoverability, full **passenger chat** seeded with `intent`, **trade-with-NPC**, and the **unique-seat** authority fix.
