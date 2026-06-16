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

    Coordinate convention: +x is East, +z is South (matches the game renderer).
    Compass bearing: 0=North, 90=East, 180=South, 270=West.
    """
    if dx == 0.0 and dz == 0.0:
        return "here"
    # atan2(dx, -dz): North (+z→ south so negate dz) at 0°, East at 90°
    angle = math.degrees(math.atan2(dx, -dz)) % 360
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
# State
# ---------------------------------------------------------------------------

class ClintBody:
    """Holds all mutable runtime state for one connected session."""

    def __init__(self) -> None:
        self.greeted_pids: set[str] = set()     # pids greeted this session
        self.last_greeting_ts: float = 0.0      # wall-clock time of last sent greeting
        self.waypoint_idx: int = 0
        self.yaw: float = 0.0
        self.last_reply_ts: float = 0.0
        # Pending greetings: list of (send_after_ts, pid, name)
        self._pending_greetings: list[tuple[float, str, str]] = []

        # World-awareness: per-player position tracking and world time
        self.player_pos: dict[str, tuple[float, float, float]] = {}
        self.world_time: Optional[float] = None

    @property
    def current_pos(self) -> tuple[float, float, float]:
        return WAYPOINTS[self.waypoint_idx]

    def advance_waypoint(self) -> None:
        self.waypoint_idx = (self.waypoint_idx + 1) % len(WAYPOINTS)

    def rotate_yaw(self) -> None:
        """Gently sweep yaw — looks like Clint glancing around."""
        self.yaw = (self.yaw + random.uniform(15.0, 45.0)) % 360.0

    def queue_greeting(self, pid: str, name: str) -> None:
        """Schedule a greeting for pid after GREETING_DELAY seconds."""
        if pid == PID:
            return  # never greet ourselves
        if pid in self.greeted_pids:
            return  # already greeted this session
        send_after = time.monotonic() + GREETING_DELAY
        self._pending_greetings.append((send_after, pid, name))
        log.info("Queued greeting for %s (%s)", pid, name)

    def pop_due_greetings(self) -> list[tuple[str, str]]:
        """Return (pid, name) pairs whose greeting delay has elapsed and that
        can be sent now (respecting the throttle).  Removes them from the queue."""
        now = time.monotonic()
        ready = [(pid, name) for ts, pid, name in self._pending_greetings if ts <= now]
        # Keep only those not yet in greeted_pids (could have duped in the queue)
        ready = [(pid, name) for pid, name in ready if pid not in self.greeted_pids]
        if not ready:
            return []
        # Throttle: only send one greeting per GREETING_THROTTLE window
        if now - self.last_greeting_ts < GREETING_THROTTLE:
            return []
        # Remove all due entries from the pending list (send first, defer rest to next tick)
        due_pids = {pid for pid, _ in ready}
        self._pending_greetings = [
            (ts, pid, name)
            for ts, pid, name in self._pending_greetings
            if pid not in due_pids or ts > now
        ]
        # Return only the first due greeting to honour the throttle
        first_pid, first_name = ready[0]
        self.greeted_pids.add(first_pid)
        self.last_greeting_ts = now
        return [(first_pid, first_name)]

    def update_player_pos(self, pid: str, x: float, y: float, z: float) -> None:
        """Record latest position for a player (from pos messages)."""
        self.player_pos[pid] = (x, y, z)

    def update_world_time(self, t: float) -> None:
        """Record latest world time (0..1 day fraction)."""
        self.world_time = t

    def _build_context(self, pid: str) -> str:
        """Build the context string for a given player's brain call.  Fail-safe."""
        try:
            pos = self.player_pos.get(pid)
            if pos is None:
                return ""
            px, py, pz = pos
            return build_context(pid, px, py, pz, self.world_time, _WORLD, self.player_pos)
        except Exception as exc:
            log.debug("Context assembly failed for %s: %s", pid, exc)
            return ""


# ---------------------------------------------------------------------------
# Core loop
# ---------------------------------------------------------------------------

def _build_url() -> str:
    base = RELAY_WS_BASE.rstrip("/")
    return f"{base}?room={ROOM}&pid={PID}&name={NAME}"


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


async def _merlin_respond(ws, message: str, player_name: str, player_id: str, context: str) -> None:
    reply = await asyncio.to_thread(_brain_reply_blocking, message, player_name, player_id, context)
    if reply:
        try:
            await ws.send(_chat_msg(reply))
        except Exception:
            pass


async def _session(ws: websockets.WebSocketClientProtocol, state: ClintBody) -> None:
    """Handle one connected session: receive messages and drive behaviour."""

    url = ws.remote_address
    log.info("Connected to relay at %s (room=%s, pid=%s, name=%s)", url, ROOM, PID, NAME)

    x, y, z = state.current_pos
    last_pos_ts: float = 0.0
    waypoint_ts: float = time.monotonic() + 30.0  # advance waypoint every 30s

    async def send_pos() -> None:
        nonlocal last_pos_ts
        payload = _pos_msg(x, y, z, state.yaw)
        await ws.send(payload)
        last_pos_ts = time.monotonic()

    # Send initial position immediately so we appear in-world at once.
    await send_pos()

    while True:
        now = time.monotonic()

        # --- Position keep-alive / gentle patrol ---
        if now - last_pos_ts >= POS_INTERVAL:
            if now >= waypoint_ts:
                state.advance_waypoint()
                waypoint_ts = now + random.uniform(25.0, 40.0)
            state.rotate_yaw()
            wp = state.current_pos
            jx = wp[0] + random.uniform(-0.3, 0.3)
            jz = wp[2] + random.uniform(-0.3, 0.3)
            x, y, z = jx, wp[1], jz  # noqa: F841 (assigned for send_pos closure)
            await send_pos()

        # --- Pending greetings ---
        due = state.pop_due_greetings()
        for _pid, name in due:
            text = _greeting(name)
            log.info("Sending greeting to %s: %s", _pid, text)
            await ws.send(_chat_msg(text))

        # --- Receive incoming messages (non-blocking, short timeout) ---
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

        mtype = msg.get("type")

        if mtype == "init":
            log.info(
                "init received — seed=%s, %d players already in room",
                msg.get("seed"), len(msg.get("players", {}))
            )
            for existing_pid, player_data in msg.get("players", {}).items():
                state.queue_greeting(existing_pid, player_data.get("name", existing_pid))
                # Seed position from init if present
                p = player_data.get("pos")
                if p and isinstance(p, (list, tuple)) and len(p) >= 3:
                    state.update_player_pos(existing_pid, p[0], p[1], p[2])

        elif mtype == "join":
            join_pid = msg.get("pid", "")
            join_name = msg.get("name", join_pid)
            log.info("join: pid=%s name=%s", join_pid, join_name)
            state.queue_greeting(join_pid, join_name)

        elif mtype == "leave":
            log.info("leave: pid=%s", msg.get("pid"))
            # Drop position tracking for departed player
            state.player_pos.pop(msg.get("pid", ""), None)

        elif mtype == "pos":
            # Track every player's position; ignore our own echoes
            ppid = msg.get("pid", "")
            if ppid and ppid != PID:
                px = msg.get("x", 0.0)
                py = msg.get("y", 0.0)
                pz = msg.get("z", 0.0)
                state.update_player_pos(ppid, float(px), float(py), float(pz))

        elif mtype == "time":
            t = msg.get("time")
            if t is not None:
                state.update_world_time(float(t))

        elif mtype == "chat":
            cpid = msg.get("pid", "")
            cname = msg.get("name", cpid)
            ctext = msg.get("text", "")
            if cpid != PID:
                log.info("chat from %s (%s): %s", cpid, cname, ctext)
                if "merlin" in ctext.lower() and (time.time() - state.last_reply_ts) >= REPLY_THROTTLE:
                    state.last_reply_ts = time.time()
                    context = state._build_context(cpid)
                    asyncio.create_task(_merlin_respond(ws, ctext, cname, cpid, context))

        # Other message types (edit, full, reject, etc.) are silently ignored.


async def run() -> None:
    """Main reconnect loop.  Never raises — catches everything and retries."""
    state = ClintBody()
    url = _build_url()
    log.info("Clint-body starting — room=%s pid=%s name=%s", ROOM, PID, NAME)
    log.info("Connecting to %s", url)

    while True:
        try:
            async with websockets.connect(
                url,
                ping_interval=None,   # we handle our own keep-alive via pos messages
                close_timeout=5,
            ) as ws:
                await _session(ws, state)
        except ConnectionClosed as exc:
            log.warning("Connection closed (%s) — reconnecting in %.0fs", exc, RECONNECT_DELAY)
        except OSError as exc:
            log.warning("Connection failed (%s) — reconnecting in %.0fs", exc, RECONNECT_DELAY)
        except Exception as exc:  # noqa: BLE001
            log.exception("Unexpected error in session (%s) — reconnecting in %.0fs", exc, RECONNECT_DELAY)

        await asyncio.sleep(RECONNECT_DELAY)
        state = ClintBody()
        log.info("Reconnecting to %s", url)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    if not ENABLED:
        log.info("CLINT_BODY_ENABLED=false — disabled, exiting 0.")
        return

    # Safety: refuse to run in the bairns room.  5a is adult-worlds-only.
    if ROOM == "bairns":
        log.error(
            "CLINT_BODY_ROOM=bairns is not permitted in Phase 5a (adult worlds only). "
            "Set CLINT_BODY_ROOM=moor and restart."
        )
        raise SystemExit(1)

    _load_world()
    asyncio.run(run())


if __name__ == "__main__":
    main()
