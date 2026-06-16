"""Clint-body — Phase 5a in-world presence for Moorstead.

Connects to the relay as the character "Clint" (pid=clint-body) and maintains
a visible avatar near spawn. On player join, sends a single scripted greeting.
Adult worlds only (room=moor by default). No LLM — pure scripted behaviour.

Config (env vars, all optional):
  RELAY_WS_BASE      ws://127.0.0.1:8096/ws   relay WebSocket base URL
  CLINT_BODY_ROOM    moor                       which room to join
  CLINT_BODY_PID     clint-body                 our player-id on the relay
  CLINT_BODY_NAME    Clint                      display name
  CLINT_BODY_ENABLED true                       kill-switch: set false to exit 0
  SAVES_DIR          ~/moorstead/world/saves    directory of per-player save files

Runtime notes:
  - Y=40 is used as a fixed idle height near spawn.  The relay has no server-side
    terrain height; actual ground varies by ~1-2 blocks around spawn.  A later
    refinement can sample the client's heightmap; for 5a this is acceptable.
  - The relay sanitises pid to [a-z0-9-] ≤40 and name ≤24; our defaults satisfy
    both constraints already.
  - Chat is range-limited to ~60 blocks server-side; we idle at (6,40,6) so
    greetings reach any player at spawn.
  - Messages >600 chars (excluding save) are dropped by the relay; all our
    outgoing messages are well under that limit.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import pathlib
import random
import time
import urllib.request
from typing import Optional

import websockets
from websockets.exceptions import ConnectionClosed

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

RELAY_WS_BASE: str = os.environ.get("RELAY_WS_BASE", "ws://127.0.0.1:8096/ws")
ROOM: str = os.environ.get("CLINT_BODY_ROOM", "moor")
PID: str = os.environ.get("CLINT_BODY_PID", "clint-body")
NAME: str = os.environ.get("CLINT_BODY_NAME", "Merlin")
ENABLED: bool = os.environ.get("CLINT_BODY_ENABLED", "true").strip().lower() not in ("false", "0", "no")

# Local "brain" (yorkshire_bot) — Merlin converses through his own isolated
# persona (character_id below). No access to any personal-assistant data.
BRAIN_URL: str = os.environ.get("BRAIN_URL", "http://127.0.0.1:8010/api/talk")
MERLIN_CHAR: str = os.environ.get("MERLIN_CHARACTER_ID", "merlin")
REPLY_THROTTLE: float = 4.0  # min seconds between brain replies

# Multi-manifestation: Merlin can attend several players at once. A "home" body
# idles at spawn (greets + hears summons); extra bodies are conjured on demand
# beside players who call his name, and fade after they go quiet.
MAX_MANIFEST: int = int(os.environ.get("CLINT_BODY_MAX_MANIFEST", "3") or "3")
IDLE_DESPAWN: float = float(os.environ.get("CLINT_BODY_IDLE_DESPAWN", "90") or "90")
SUMMON_THROTTLE: float = 3.0  # min seconds between replies to the same caller
LEAD_MAX: float = 150.0       # max distance Merlin will physically lead a player
LEAD_STEP: float = 1.6        # blocks Merlin walks per half-second while leading

# Player save files: /home/james/moorstead/world/saves/<pid>.json
SAVES_DIR: pathlib.Path = pathlib.Path(
    os.environ.get("SAVES_DIR", os.path.expanduser("~/moorstead/world/saves"))
)

# Behaviour constants
POS_INTERVAL: float = 2.0       # seconds between pos keep-alives
GREETING_DELAY: float = 1.5     # seconds after join before greeting
GREETING_THROTTLE: float = 5.0  # min seconds between any two greetings
RECONNECT_DELAY: float = 3.0    # seconds to wait before reconnect attempt

# Patrol waypoints near spawn — Clint idles between these, slowly rotating yaw.
# Y is fixed at 40 (see module docstring about terrain height).
WAYPOINTS: list[tuple[float, float, float]] = [
    (6.0,  40.0,  6.0),
    (10.0, 40.0,  4.0),
    (8.0,  40.0, 10.0),
    (4.0,  40.0,  8.0),
]

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [clint-body] %(levelname)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger("clint-body")


# ---------------------------------------------------------------------------
# World data (loaded once at startup)
# ---------------------------------------------------------------------------

_WORLD: dict = {}

def _load_world() -> None:
    """Load merlin-world.json from the same directory as this script.  Fail-safe."""
    global _WORLD
    try:
        world_path = pathlib.Path(__file__).parent / "merlin-world.json"
        with open(world_path, encoding="utf-8") as f:
            _WORLD = json.load(f)
        log.info("Loaded world data: %d places, %d NPCs",
                 len(_WORLD.get("places", [])), len(_WORLD.get("npcs", [])))
    except Exception as exc:
        log.warning("Could not load merlin-world.json (%s) — world context disabled", exc)
        _WORLD = {}


# ---------------------------------------------------------------------------
# Pure context-building helpers (importable / testable without a live socket)
# ---------------------------------------------------------------------------

def _compass(dx: float, dz: float) -> str:
    """Return an 8-point compass label for a displacement vector.

    Coordinate convention: NORTH is +x, EAST is +z (the map reads with Whitby
    and the coast at the top). Compass bearing: 0=North(+x), 90=East(+z).
    """
    if dx == 0.0 and dz == 0.0:
        return "here"
    angle = math.degrees(math.atan2(dz, dx)) % 360
    dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    idx = int((angle + 22.5) / 45) % 8
    return dirs[idx]


def _nearest_place(px: float, pz: float, places: list[dict]) -> Optional[dict]:
    """Return the nearest place dict from the world places list, or None."""
    best = None
    best_d = float("inf")
    for p in places:
        d = math.hypot(px - p["x"], pz - p["z"])
        if d < best_d:
            best_d = d
            best = p
    return best


def _direction_phrase(px: float, pz: float, tx: float, tz: float) -> str:
    """Return e.g. 'about 340 blocks NW'."""
    dx = tx - px
    dz = tz - pz
    dist = math.hypot(dx, dz)
    compass = _compass(dx, dz)
    rounded = int(round(dist / 10) * 10) or 5  # round to nearest 10, min 5
    return f"about {rounded} blocks {compass}"


# Inventory ids (from src/defs.js).  Blocks B are 0-44, pure items I are 64+,
# so the two never collide and a flat id->name lookup is unambiguous.
_PICK_TIER = {65: ("wooden pick", 1), 69: ("stone pick", 2), 73: ("iron pick", 3)}

# Stackable materials worth naming, with their rough count.
_RESOURCES = {
    6:  "logs",
    8:  "planks",
    77: "coal",
    78: "raw ironstone",
    79: "iron ingots",
    80: "Whitby jet",
}

# Storyline / mystery hooks — Merlin should always notice these so he can steer
# the player to the right quest.  Named in full (no counts).
_QUEST_ITEMS = {
    86: "a parcel to deliver",
    87: "half an amulet",
    88: "half an amulet",
    89: "a bell clapper",
    90: "the finished amulet",
    93: "an ammonite (snakestone)",
    94: "a gryphaea fossil",
    95: "holy water",
    96: "a wooden stake",
    97: "a holy stake",
    98: "the Captain's Log (Dracula)",
}


def _slot_id_n(slot) -> tuple:
    """Extract (id, count) from a slot that may be an int or {'id','n'} dict."""
    if isinstance(slot, dict):
        return slot.get("id"), int(slot.get("n", slot.get("count", 1)) or 1)
    return slot, 1


def _summarise_slots(slots: list) -> str:
    """Turn a sparse slots list into a short phrase Merlin can act on.

    Reports the best pickaxe (gates mining), key stacked resources with counts,
    and any storyline items in full.  Bulk terrain (dirt/stone/sand) is ignored.
    """
    if not slots or all(s is None for s in slots):
        return "empty-handed"

    best_pick: Optional[tuple] = None      # (rank, name)
    resources: dict[int, int] = {}
    quest: list[str] = []
    for slot in slots:
        if slot is None:
            continue
        sid, n = _slot_id_n(slot)
        if sid in _PICK_TIER:
            name, rank = _PICK_TIER[sid]
            if best_pick is None or rank > best_pick[0]:
                best_pick = (rank, name)
        elif sid in _RESOURCES:
            resources[sid] = resources.get(sid, 0) + n
        elif sid in _QUEST_ITEMS:
            q = _QUEST_ITEMS[sid]
            if q not in quest:
                quest.append(q)

    parts: list[str] = [best_pick[1] if best_pick else "no pick yet"]
    for sid, n in resources.items():
        nm = _RESOURCES[sid]
        parts.append(f"{n} {nm}" if n > 1 else nm)
    parts.extend(quest)
    return ", ".join(parts[:7])


# Milestone ladder (from src/milestones.js), most-advanced first.  Gives Merlin
# a one-phrase read of how far the traveller has come.
_MILESTONE_TIER = [
    ("iron_tools",   "well-equipped — has iron tools"),
    ("iron_won",     "smelting iron, close to iron tools"),
    ("into_stone",   "mining stone with a pick"),
    ("first_pick",   "has their first pick"),
    ("first_bench",  "just starting — has a joiner's bench"),
    ("first_planks", "just starting — has planks"),
    ("first_log",    "brand new — felled their first tree"),
]


def _progression(milestones) -> str:
    """Map the milestonesDone list to a single progression descriptor."""
    if not isinstance(milestones, list) or not milestones:
        return "brand new — no milestones yet"
    m = set(milestones)
    tier = next((label for key, label in _MILESTONE_TIER if key in m),
                f"{len(m)} milestones done")
    if "stood_ground" in m or "first_neet" in m:
        tier += ", has survived a night"
    return tier


def _time_of_day_str(t: Optional[float]) -> str:
    """Convert a 0..1 day fraction to a human label.

    0=midnight, 0.25=morning, 0.5=midday, 0.75=dusk.
    """
    if t is None:
        return "unknown time"
    t = t % 1.0
    if t < 0.1 or t >= 0.9:
        return "dead of night"
    if t < 0.25:
        return "early morning"
    if t < 0.4:
        return "morning"
    if t < 0.6:
        return "midday"
    if t < 0.75:
        return "afternoon"
    if t < 0.85:
        return "dusk"
    return "night"


def _read_save(pid: str) -> dict:
    """Return the parsed save dict for pid, or {} if missing/unreadable."""
    try:
        save_path = SAVES_DIR / f"{pid}.json"
        with open(save_path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _npcs_at_village(village_name: str, npcs: list[dict]) -> list[str]:
    """Return list of NPC names whose village matches (case-insensitive)."""
    vn = village_name.lower()
    return [n["name"] for n in npcs if n.get("village", "").lower() == vn]


def build_context(
    pid: str,
    px: float,
    py: float,
    pz: float,
    world_time: Optional[float],
    world: dict,
    others: Optional[dict] = None,
) -> str:
    """Build a compact situation string for Merlin's brain call.

    Parameters
    ----------
    pid         : player id (used to locate their save file)
    px, py, pz  : player position
    world_time  : 0..1 day fraction, or None
    world       : the loaded merlin-world.json dict (may be {})
    others      : optional {pid: (x,y,z)} of other tracked players, for a
                  "travellers nearby" count
    """
    parts: list[str] = []

    places = world.get("places", [])
    npcs   = world.get("npcs", [])
    kilns  = world.get("kilns", {"x": -260, "z": 380})

    # --- position + nearest place ---
    if places:
        near = _nearest_place(px, pz, places)
        if near:
            phrase = _direction_phrase(px, pz, near["x"], near["z"])
            parts.append(f"Player is at ({int(px)},{int(pz)}) — {phrase} from {near['name']}")
        else:
            parts.append(f"Player is at ({int(px)},{int(pz)})")
    else:
        parts.append(f"Player is at ({int(px)},{int(pz)})")

    # --- direction to the kilns (ore heartland) ---
    kilns_phrase = _direction_phrase(px, pz, kilns["x"], kilns["z"])
    parts.append(f"Rosedale Kilns: {kilns_phrase}")

    # --- time of day ---
    parts.append(_time_of_day_str(world_time))

    # --- save-derived inventory + progress ---
    save = _read_save(pid)
    player_data = save.get("player", save)  # save may be flat or nested under "player"
    if player_data:
        inv_summary = _summarise_slots(player_data.get("slots", []))
        progress = _progression(player_data.get("milestonesDone", []))
        health = player_data.get("health")
        save_parts = [f"carrying: {inv_summary}", f"progress: {progress}"]
        if health is not None:
            save_parts.append(f"health {health}/20")
        parts.append("; ".join(save_parts))
    else:
        parts.append("their pack and progress are unknown to thee")

    # --- other travellers nearby (within ~80 blocks) ---
    if others:
        nearby = sum(
            1 for opid, (ox, oy, oz) in others.items()
            if opid not in (pid, PID) and math.hypot(px - ox, pz - oz) <= 80
        )
        if nearby:
            parts.append(f"{nearby} other traveller{'s' if nearby > 1 else ''} nearby")

    # --- NPCs at nearest settlement ---
    if places and npcs:
        # find nearest village specifically (not station/landmark)
        villages = [p for p in places if p.get("kind") == "village"]
        if villages:
            near_v = _nearest_place(px, pz, villages)
            if near_v:
                residents = _npcs_at_village(near_v["name"], npcs)
                if residents:
                    parts.append(f"folk at nearest village {near_v['name']}: {', '.join(residents)}")

    ctx = "SITUATION (what tha can sense of this traveller right now): " + ". ".join(parts)
    # Cap well under the brain's MAX_CONTEXT_CHARS (2800); this travels by HTTP,
    # not through the relay's chat limit.
    return ctx[:800]


# ---------------------------------------------------------------------------
# Greeting templates
# ---------------------------------------------------------------------------

def _greeting(name: str) -> str:
    """Return a single scripted greeting for the given player display name."""
    name = name.strip() or "traveller"
    templates = [
        f"Welcome to t' moor, {name}. I'm Merlin, owd wizard o' these parts — give us a shout if tha needs owt.",
        f"Aye up, {name}! Merlin's the name, warden an' wizard o' t' moor. Shout if tha gets lost.",
        f"Now then, {name}. I'm Merlin — I keep watch ower these moors. Ask away if tha needs a hand.",
    ]
    return random.choice(templates)


# ---------------------------------------------------------------------------
# Manifestations — Merlin in several places at once
# ---------------------------------------------------------------------------

HOME_POS: tuple[float, float, float] = WAYPOINTS[0]


def _lead_target(text: str, world: dict, px: float, pz: float):
    """If the player asks to be taken/shown somewhere, return (x, z, name).

    Uses only the static world data (landmarks, villages, the kilns, the keep),
    so Merlin can guide without a live terrain model.  Ore requests head for the
    Rosedale kilns; "where should I build" heads for the nearest village.
    """
    t = (text or "").lower()
    if not any(w in t for w in (
        "lead", "take me", "show me", "guide", "where", "find", "go to",
        "which way", "build", "dig", "mine ", "look for", "come with",
    )):
        return None
    places = world.get("places", []) or []
    if any(w in t for w in ("iron", "ironstone", "jet")):
        k = world.get("kilns")
        if k:
            return (k["x"], k["z"], "the Rosedale kilns")
    if "castle" in t or "keep" in t:
        for p in places:
            if "keep" in p["name"].lower():
                return (p["x"], p["z"], p["name"])
    for p in places:                       # a named landmark/village/station
        nm = p["name"].lower()
        words = [w for w in nm.replace("the ", "").replace("'s", "").split() if len(w) > 3]
        if nm in t or any(w in t for w in words):
            return (p["x"], p["z"], p["name"])
    if any(w in t for w in ("build", "house", "settle")):
        vs = [p for p in places if p.get("kind") == "village"]
        if vs:
            nv = min(vs, key=lambda p: math.hypot(p["x"] - px, p["z"] - pz))
            return (nv["x"], nv["z"], nv["name"])
    return None


class Manifestation:
    """One Merlin avatar = one relay connection.

    The `home` manifestation always exists, idles at spawn, greets newcomers
    and hears summons.  Extra manifestations are conjured on demand to attend
    players who call Merlin's name, and fade when they go idle.
    """

    def __init__(self, pid: str, home: bool = False) -> None:
        self.pid = pid
        self.home = home
        self.x, self.y, self.z = HOME_POS
        self.yaw = 0.0
        self.assigned: Optional[str] = None        # player pid being attended
        self.last_active: float = 0.0              # monotonic of last summon
        self.lead: Optional[tuple] = None          # (x, z, name) destination he's walking to
        self.q: "asyncio.Queue" = asyncio.Queue()  # ('teleport',x,y,z) | ('chat',text)
        self.alive = True


class Manager:
    """Owns the pool of Merlin manifestations and dispatches summons."""

    def __init__(self) -> None:
        self.manifs: dict[str, Manifestation] = {}
        self.player_pos: dict[str, tuple[float, float, float]] = {}
        self.world_time: Optional[float] = None
        self.greeted: set[str] = set()
        self.last_greet: float = 0.0
        self.last_reply: dict[str, float] = {}     # caller pid -> monotonic of last reply

    async def start(self) -> None:
        home = Manifestation(PID, home=True)
        self.manifs[PID] = home
        log.info("Merlin manager — room=%s home=%s max=%d", ROOM, PID, MAX_MANIFEST)
        asyncio.create_task(self._reaper())
        # The home loop reconnects forever; keep the process alive on it.
        await manifestation_loop(home, self)

    async def _reaper(self) -> None:
        """Fade idle conjured manifestations back out of the world."""
        while True:
            await asyncio.sleep(5.0)
            now = time.monotonic()
            for pid, m in list(self.manifs.items()):
                if (not m.home) and m.alive and (now - m.last_active) > IDLE_DESPAWN:
                    log.info("Merlin %s fading (idle %.0fs)", pid, now - m.last_active)
                    m.alive = False
                    self.manifs.pop(pid, None)

    def _pick(self, caller_pid: str) -> Optional[Manifestation]:
        # already attending this caller?
        for m in self.manifs.values():
            if m.alive and m.assigned == caller_pid:
                return m
        # a free conjured body?
        for m in self.manifs.values():
            if m.alive and not m.home and m.assigned is None:
                return m
        # conjure a new one if under the cap
        if len(self.manifs) < MAX_MANIFEST:
            pid = f"{PID}-{len(self.manifs) + 1}"
            m = Manifestation(pid, home=False)
            self.manifs[pid] = m
            asyncio.create_task(manifestation_loop(m, self))
            log.info("Conjured Merlin %s", pid)
            return m
        # otherwise reuse the least-recently-active conjured body, else home
        conjured = [m for m in self.manifs.values() if m.alive and not m.home]
        if conjured:
            return min(conjured, key=lambda mm: mm.last_active)
        return self.manifs.get(PID)

    async def on_summon(self, msg: dict) -> None:
        cpid = msg.get("pid", "")
        cname = msg.get("name", cpid) or cpid
        text = msg.get("text", "")
        if not cpid or cpid == PID or cpid.startswith(PID):
            return
        try:
            sx = float(msg.get("x", 0.0))
            sy = float(msg.get("y", 40.0))
            sz = float(msg.get("z", 0.0))
        except (TypeError, ValueError):
            return
        now = time.monotonic()
        if now - self.last_reply.get(cpid, 0.0) < SUMMON_THROTTLE:
            return
        self.last_reply[cpid] = now
        m = self._pick(cpid)
        if m is None:
            return
        m.assigned = cpid
        m.last_active = now
        # stand just beside the caller (not inside them)
        bx, bz = sx + 1.5, sz + 1.5
        m.x, m.y, m.z = bx, sy, bz
        m.q.put_nowait(("teleport", bx, sy, bz))
        log.info("Merlin %s summoned by %s (%s) -> (%.0f,%.0f,%.0f)", m.pid, cname, cpid, sx, sy, sz)
        # situational reply from the brain (use the caller's reported position)
        ctx = ""
        try:
            ctx = build_context(cpid, sx, sy, sz, self.world_time, _WORLD, self.player_pos)
        except Exception as exc:
            log.debug("context build failed: %s", exc)
        reply = await asyncio.to_thread(_brain_reply_blocking, text, cname, cpid, ctx)
        if reply:
            m.q.put_nowait(("chat", reply))
        self._maybe_lead(m, text, sx, sz)

    def _maybe_lead(self, m: "Manifestation", text: str, px: float, pz: float) -> None:
        """If the player asked to be guided somewhere near enough, set Merlin
        walking there (the player follows). Far places stay verbal directions."""
        try:
            tgt = _lead_target(text, _WORLD, px, pz)
        except Exception:
            tgt = None
        if not tgt:
            return
        tx, tz, tname = tgt
        if math.hypot(tx - px, tz - pz) <= LEAD_MAX:
            m.lead = (float(tx), float(tz), tname)
            m.last_active = time.monotonic()
            m.q.put_nowait(("chat", f"Aye — follow me, I'll take thee to {tname}."))
            log.info("Merlin %s leading to %s", m.pid, tname)

    def queue_greeting(self, m: Manifestation, pid: str, name: str) -> None:
        """Home greets a newcomer once (throttled)."""
        if not pid or pid == PID or pid.startswith(PID):
            return
        if pid in self.greeted:
            return
        now = time.monotonic()
        if now - self.last_greet < GREETING_THROTTLE:
            return
        self.greeted.add(pid)
        self.last_greet = now
        m.q.put_nowait(("chat", _greeting(name)))
        log.info("Greeting %s (%s)", pid, name)

    async def handle(self, m: Manifestation, msg: dict) -> None:
        mtype = msg.get("type")
        if mtype == "summon":
            if m.home:
                await self.on_summon(msg)
        elif mtype == "pos":
            ppid = msg.get("pid", "")
            if ppid and not ppid.startswith(PID):
                try:
                    self.player_pos[ppid] = (
                        float(msg.get("x", 0)), float(msg.get("y", 0)), float(msg.get("z", 0)))
                except (TypeError, ValueError):
                    pass
        elif mtype == "chat":
            # An attending manifestation holds the conversation: it replies to
            # its assigned player's nearby chat even WITHOUT the wake-word, so a
            # player can keep talking after summoning Merlin. Messages that say
            # "merlin" go via the summon path (the home dispatches), so skip
            # those here to avoid a double reply.
            cpid = msg.get("pid", "")
            cname = msg.get("name", cpid) or cpid
            text = msg.get("text", "")
            if (not m.home and m.assigned and m.assigned == cpid
                    and text.strip() and "merlin" not in text.lower()):
                now = time.monotonic()
                if now - self.last_reply.get(cpid, 0.0) >= SUMMON_THROTTLE:
                    self.last_reply[cpid] = now
                    m.last_active = now
                    px, py, pz = self.player_pos.get(cpid, (m.x, m.y, m.z))
                    ctx = ""
                    try:
                        ctx = build_context(cpid, px, py, pz, self.world_time, _WORLD, self.player_pos)
                    except Exception as exc:
                        log.debug("context build failed: %s", exc)
                    reply = await asyncio.to_thread(_brain_reply_blocking, text, cname, cpid, ctx)
                    if reply:
                        m.q.put_nowait(("chat", reply))
                    self._maybe_lead(m, text, px, pz)
                    if not m.lead:
                        # not leading: drift back beside the player as they move
                        m.x, m.y, m.z = px + 1.5, py, pz + 1.5
                        m.q.put_nowait(("teleport", m.x, m.y, m.z))
                    log.info("Merlin %s follow-up to %s: %s", m.pid, cname, text[:40])
        elif mtype == "time":
            t = msg.get("time")
            if t is not None:
                try:
                    self.world_time = float(t)
                except (TypeError, ValueError):
                    pass
        elif mtype == "init":
            if m.home:
                for epid, pdata in msg.get("players", {}).items():
                    self.queue_greeting(m, epid, pdata.get("name", epid))
        elif mtype == "join":
            if m.home:
                self.queue_greeting(m, msg.get("pid", ""), msg.get("name", ""))
        elif mtype == "leave":
            lp = msg.get("pid", "")
            self.player_pos.pop(lp, None)
            for mm in self.manifs.values():
                if mm.assigned == lp:
                    mm.assigned = None


# ---------------------------------------------------------------------------
# Core loop
# ---------------------------------------------------------------------------

def _build_url(pid: str = PID) -> str:
    base = RELAY_WS_BASE.rstrip("/")
    return f"{base}?room={ROOM}&pid={pid}&name={NAME}"


def _pos_msg(x: float, y: float, z: float, yaw: float) -> str:
    return json.dumps({"type": "pos", "x": x, "y": y, "z": z, "yaw": yaw})


def _chat_msg(text: str) -> str:
    # Relay enforces ≤200 chars on text; truncate defensively.
    text = text[:200]
    return json.dumps({"type": "chat", "text": text})


def _brain_reply_blocking(message: str, player_name: str, player_id: str, context: str) -> str:
    """Ask the local brain for Merlin's reply. Blocking; run off the loop."""
    try:
        body = json.dumps({
            "character_id": MERLIN_CHAR,
            "message": str(message)[:300],
            "player_name": player_name,
            "player_id": player_id,
            "context": context or None,
        }).encode()
        req = urllib.request.Request(BRAIN_URL, data=body, method="POST",
                                     headers={"Content-Type": "application/json"})
        data = json.loads(urllib.request.urlopen(req, timeout=20).read())
        return str(data.get("reply", ""))[:200]
    except Exception:
        return ""


async def manifestation_loop(m: "Manifestation", manager: "Manager") -> None:
    """Maintain one manifestation's relay connection until it fades.

    Sends position keep-alives (with a gentle idle sway), drains its command
    queue (teleport-then-chat, so speech lands in range of the player it just
    moved to), and feeds incoming messages to the manager.
    """
    url = _build_url(m.pid)
    while m.alive:
        try:
            async with websockets.connect(
                url, ping_interval=None, close_timeout=5,
            ) as ws:
                log.info("Manifestation %s connected (home=%s, room=%s)", m.pid, m.home, ROOM)
                await ws.send(_pos_msg(m.x, m.y, m.z, m.yaw))
                last_pos = time.monotonic()
                while m.alive:
                    now = time.monotonic()

                    # Position keep-alive — a leading walk, or a gentle idle sway.
                    interval = 0.5 if m.lead else POS_INTERVAL
                    if now - last_pos >= interval:
                        if m.lead:
                            tx, tz, tname = m.lead
                            dx, dz = tx - m.x, tz - m.z
                            dist = math.hypot(dx, dz)
                            if dist < 5.0:
                                m.lead = None
                                m.last_active = now
                                m.q.put_nowait(("chat", f"Here we are, then — {tname}. Mind how tha goes."))
                            else:
                                step = min(dist, LEAD_STEP)
                                m.x += dx / dist * step
                                m.z += dz / dist * step
                                m.yaw = math.degrees(math.atan2(dx, dz))
                                m.last_active = now
                            await ws.send(_pos_msg(m.x, m.y, m.z, m.yaw))
                        else:
                            m.yaw = (m.yaw + random.uniform(15.0, 45.0)) % 360.0
                            jx = m.x + random.uniform(-0.25, 0.25)
                            jz = m.z + random.uniform(-0.25, 0.25)
                            await ws.send(_pos_msg(jx, m.y, jz, m.yaw))
                        last_pos = now

                    # Drain command queue. Teleport before chat keeps speech in range.
                    while not m.q.empty():
                        item = m.q.get_nowait()
                        if item[0] == "teleport":
                            _, m.x, m.y, m.z = item
                            await ws.send(_pos_msg(m.x, m.y, m.z, m.yaw))
                            last_pos = now
                        elif item[0] == "chat":
                            await ws.send(_chat_msg(item[1]))

                    # Receive incoming (short timeout so the loop stays responsive).
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=0.1)
                    except asyncio.TimeoutError:
                        continue
                    except ConnectionClosed:
                        raise
                    try:
                        msg = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    await manager.handle(m, msg)
        except ConnectionClosed as exc:
            log.warning("Manifestation %s closed (%s)", m.pid, exc)
        except OSError as exc:
            log.warning("Manifestation %s connect failed (%s)", m.pid, exc)
        except Exception as exc:  # noqa: BLE001
            log.exception("Manifestation %s error (%s)", m.pid, exc)
        if not m.alive:
            break
        await asyncio.sleep(RECONNECT_DELAY)
    log.info("Manifestation %s gone", m.pid)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    if not ENABLED:
        log.info("CLINT_BODY_ENABLED=false — disabled, exiting 0.")
        return

    # Safety: the bairns room is the children's world.  Running Merlin there
    # requires an explicit opt-in (CLINT_BODY_ALLOW_BAIRNS=true), set by James.
    if ROOM == "bairns" and os.environ.get(
        "CLINT_BODY_ALLOW_BAIRNS", "false"
    ).strip().lower() not in ("true", "1", "yes"):
        log.error(
            "CLINT_BODY_ROOM=bairns requires CLINT_BODY_ALLOW_BAIRNS=true "
            "(children's world — explicit opt-in). Refusing to start."
        )
        raise SystemExit(1)

    _load_world()
    asyncio.run(Manager().start())


if __name__ == "__main__":
    main()
