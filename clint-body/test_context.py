"""test_context.py — unit tests for the pure world-awareness helpers in clint_body.py.

Uses stdlib only (no websockets, no asyncio, no live connections).
Run: python3 test_context.py
Exit 0 = all pass, exit 1 = failure(s).
"""

import os
import sys
import math
import pathlib
import types

# Prevent actual world-load at import so tests are fully self-contained.
# We override SAVES_DIR to a temp dir; merlin-world.json is not needed here.
os.environ.setdefault("SAVES_DIR", str(pathlib.Path(sys.argv[0]).parent))

# Stub out 'websockets' so clint_body can be imported without the package.
# The pure helpers we test do not use websockets at all.
if "websockets" not in sys.modules:
    stub = types.ModuleType("websockets")
    stub.WebSocketClientProtocol = object
    stub.connect = None
    exc_mod = types.ModuleType("websockets.exceptions")
    class _CC(Exception): pass
    exc_mod.ConnectionClosed = _CC
    stub.exceptions = exc_mod
    sys.modules["websockets"] = stub
    sys.modules["websockets.exceptions"] = exc_mod

# Import the pure helpers (and build_context) directly — no bot loop touched.
from clint_body import (
    _compass,
    _direction_phrase,
    _nearest_place,
    _summarise_slots,
    _progression,
    _time_of_day_str,
    _npcs_at_village,
    build_context,
)

PASS = 0
FAIL = 0


def check(label: str, cond: bool, detail: str = "") -> None:
    global PASS, FAIL
    if cond:
        print(f"  PASS  {label}")
        PASS += 1
    else:
        print(f"  FAIL  {label}" + (f" — {detail}" if detail else ""))
        FAIL += 1


# ---------------------------------------------------------------------------
# _compass
# ---------------------------------------------------------------------------

print("=== _compass ===")
check("due East",   _compass(10, 0)   == "E")
check("due West",   _compass(-5, 0)   == "W")
check("due South",  _compass(0, 10)   == "S")
check("due North",  _compass(0, -10)  == "N")
check("NE quadrant",_compass(10, -10) == "NE")
check("SW quadrant",_compass(-10, 10) == "SW")
check("zero vector",_compass(0, 0)    == "here")

# ---------------------------------------------------------------------------
# _direction_phrase
# ---------------------------------------------------------------------------

print("=== _direction_phrase ===")
# Player at (0,0), target at (300, 0) — 300 blocks East
phrase = _direction_phrase(0, 0, 300, 0)
check("E phrase contains 'E'", "E" in phrase, phrase)
check("E phrase contains distance", "300" in phrase, phrase)

# Player at (0,0), target at (-200, 0) — 200 blocks West
phrase2 = _direction_phrase(0, 0, -200, 0)
check("W phrase", "W" in phrase2, phrase2)

# ---------------------------------------------------------------------------
# _nearest_place
# ---------------------------------------------------------------------------

print("=== _nearest_place ===")
places = [
    {"name": "Moorstead",   "x": -87,  "z": 50,  "kind": "village"},
    {"name": "Goathland",   "x": 473,  "z": -47, "kind": "village"},
    {"name": "Rosedale Kilns", "x": -260, "z": 380, "kind": "landmark"},
]

# Close to Moorstead
near = _nearest_place(-90, 55, places)
check("nearest to (-90,55) is Moorstead", near is not None and near["name"] == "Moorstead",
      repr(near))

# Close to Goathland
near2 = _nearest_place(470, -50, places)
check("nearest to (470,-50) is Goathland", near2 is not None and near2["name"] == "Goathland",
      repr(near2))

# Empty list
near3 = _nearest_place(0, 0, [])
check("empty list returns None", near3 is None)

# ---------------------------------------------------------------------------
# _summarise_slots
# ---------------------------------------------------------------------------

print("=== _summarise_slots ===")
# Iron pick (id=73) + coal lump (77) + jet gem (80)
slots = [73, None, 77, None, 80]
summary = _summarise_slots(slots)
check("iron pick present", "iron pick" in summary, summary)
check("coal present",      "coal"      in summary, summary)
check("jet present",       "Whitby jet" in summary, summary)

# Empty / all-None
check("empty slots", "empty-handed" in _summarise_slots([None, None]))
check("empty list",  "empty-handed" in _summarise_slots([]))

# Dict-style slots with the real {'id','n'} shape + counts
dict_slots = [{"id": 6, "n": 64}, {"id": 8, "n": 32}]
ds = _summarise_slots(dict_slots)
check("dict slots: logs",   "logs" in ds, ds)
check("dict slots: planks", "planks" in ds, ds)
check("dict slots: count",  "64 logs" in ds, ds)

# Best pick only (wooden 65 + iron 73 present → report iron, the best)
best = _summarise_slots([65, 73])
check("reports best pick (iron)", "iron pick" in best, best)
check("hides lesser pick (wooden)", "wooden pick" not in best, best)

# No pick at all → says so
check("no pick phrase", "no pick yet" in _summarise_slots([{"id": 2, "n": 9}]))

# Quest item (Dracula's journal = 98) is always surfaced
quest = _summarise_slots([73, {"id": 98, "n": 1}])
check("quest item surfaced", "Captain's Log" in quest, quest)

# ---------------------------------------------------------------------------
# _progression
# ---------------------------------------------------------------------------

print("=== _progression ===")
check("empty → brand new", "brand new" in _progression([]))
check("non-list → brand new", "brand new" in _progression(None))
check("iron_tools → well-equipped",
      "iron tools" in _progression(["first_log", "first_pick", "iron_tools"]))
check("first_pick (no iron) → first pick",
      "first pick" in _progression(["first_log", "first_pick"]))
check("survived a night noted",
      "survived a night" in _progression(["first_pick", "stood_ground"]))
check("most-advanced tier wins",
      "iron tools" in _progression(["iron_tools", "first_pick", "first_log"]))

# ---------------------------------------------------------------------------
# _time_of_day_str
# ---------------------------------------------------------------------------

print("=== _time_of_day_str ===")
check("t=0   is night",      "night" in _time_of_day_str(0.0).lower())
check("t=0.25 is morning",   "morning" in _time_of_day_str(0.25).lower())
check("t=0.5 is midday",     "midday"  in _time_of_day_str(0.5).lower())
check("t=0.75 is dusk",      "dusk"    in _time_of_day_str(0.75).lower())
check("None returns string", isinstance(_time_of_day_str(None), str))

# ---------------------------------------------------------------------------
# _npcs_at_village
# ---------------------------------------------------------------------------

print("=== _npcs_at_village ===")
npcs = [
    {"name": "farmer james",   "village": "Moorstead"},
    {"name": "granny glinda",  "village": "Moorstead"},
    {"name": "owd tom",        "village": "Rosedale Abbey"},
    {"name": "innkeeper martha","village": "Rosedale Abbey"},
    {"name": "silas",          "village": "Whitby"},
]
moorstead_npcs = _npcs_at_village("Moorstead", npcs)
check("Moorstead has 2 NPCs", len(moorstead_npcs) == 2, str(moorstead_npcs))
check("farmer james in Moorstead", "farmer james" in moorstead_npcs)
check("case insensitive match", len(_npcs_at_village("moorstead", npcs)) == 2)
check("Whitby has 1 NPC", len(_npcs_at_village("Whitby", npcs)) == 1)
check("unknown village empty", _npcs_at_village("Nowhere", npcs) == [])

# ---------------------------------------------------------------------------
# build_context — integration of the pure helpers
# ---------------------------------------------------------------------------

print("=== build_context ===")

FAKE_WORLD = {
    "seed": "t-shared-moor",
    "kilns": {"x": -260, "z": 380},
    "places": [
        {"name": "Moorstead",      "x": -87,  "z": 50,   "kind": "village"},
        {"name": "Rosedale Abbey", "x": -232, "z": 406,  "kind": "village"},
        {"name": "Rosedale Kilns", "x": -260, "z": 380,  "kind": "landmark"},
        {"name": "Goathland",      "x": 473,  "z": -47,  "kind": "village"},
    ],
    "npcs": [
        {"name": "farmer james",  "village": "Moorstead"},
        {"name": "granny glinda", "village": "Moorstead"},
        {"name": "owd tom",       "village": "Rosedale Abbey"},
    ],
    "ore": {"jet": "deep", "iron": "mid", "coal": "shallow"},
}

# Player near Moorstead; no save file (pid won't exist in SAVES_DIR)
ctx = build_context("testpid-noexist", -90.0, 35.0, 55.0, 0.5, FAKE_WORLD)
print(f"  context string: {ctx!r}")
check("context is a str",           isinstance(ctx, str))
check("context non-empty",          len(ctx) > 20)
check("context under 800 chars",    len(ctx) <= 800, str(len(ctx)))
check("framed as SITUATION",        ctx.startswith("SITUATION"), ctx)
check("contains player coords",     "-90" in ctx or "(-90" in ctx, ctx)
check("contains Moorstead",         "Moorstead" in ctx, ctx)
check("contains Kilns direction",   "Kilns" in ctx, ctx)
check("contains time word",         "midday" in ctx.lower(), ctx)
check("contains farmer james",      "farmer james" in ctx, ctx)

# Nearby-traveller awareness: another player 30 blocks away should be counted
others = {"other-pid": (-90.0 + 20, 35.0, 55.0 + 20)}  # ~28 blocks away
ctx_near = build_context("testpid-noexist", -90.0, 35.0, 55.0, 0.5, FAKE_WORLD, others)
check("nearby traveller counted", "1 other traveller" in ctx_near, ctx_near)
# A player far away (500 blocks) must NOT be counted
far_others = {"far-pid": (400.0, 35.0, 55.0)}
ctx_far = build_context("testpid-noexist", -90.0, 35.0, 55.0, 0.5, FAKE_WORLD, far_others)
check("far traveller not counted", "traveller nearby" not in ctx_far, ctx_far)

# Player far from any village — near Roseberry Topping (not in fake world)
# Just check the function doesn't crash and stays within 600 chars.
ctx2 = build_context("testpid-noexist", -700.0, 38.0, -880.0, 0.75, FAKE_WORLD)
check("far player: no crash",      isinstance(ctx2, str))
check("far player: under 800 chars", len(ctx2) <= 800, str(len(ctx2)))
check("far player: dusk",          "dusk" in ctx2.lower(), ctx2)

# Empty world dict — must not crash
ctx3 = build_context("testpid-noexist", 0.0, 35.0, 0.0, None, {})
check("empty world: no crash",     isinstance(ctx3, str))
check("empty world: under 800",    len(ctx3) <= 800)

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

print()
print(f"Results: {PASS} passed, {FAIL} failed")
sys.exit(0 if FAIL == 0 else 1)
