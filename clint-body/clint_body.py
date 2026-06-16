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
import random
import time
from typing import Optional

import websockets
from websockets.exceptions import ConnectionClosed

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

RELAY_WS_BASE: str = os.environ.get("RELAY_WS_BASE", "ws://127.0.0.1:8096/ws")
ROOM: str = os.environ.get("CLINT_BODY_ROOM", "moor")
PID: str = os.environ.get("CLINT_BODY_PID", "clint-body")
NAME: str = os.environ.get("CLINT_BODY_NAME", "Clint")
ENABLED: bool = os.environ.get("CLINT_BODY_ENABLED", "true").strip().lower() not in ("false", "0", "no")

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
# Greeting templates
# ---------------------------------------------------------------------------

def _greeting(name: str) -> str:
    """Return a single scripted greeting for the given player display name."""
    name = name.strip() or "traveller"
    templates = [
        f"Welcome to t' moor, {name}. I'm Clint — give us a shout if tha needs owt.",
        f"Aye up, {name}! Grand to see thee on t' moor. I'm Clint — shout if tha gets lost.",
        f"Now then, {name}. Clint's the name — I keep an eye on t' moor. Ask away if tha needs a hand.",
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
        # Pending greetings: list of (send_after_ts, pid, name)
        self._pending_greetings: list[tuple[float, str, str]] = []

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
                # Non-binding update: update our local x,y,z for the new waypoint.
                # (We reassign the outer-scope variables via nonlocal.)
            state.rotate_yaw()
            wp = state.current_pos
            # Gentle jitter so movement looks natural rather than teleporting.
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
            # Greet any players already present when we join.
            for existing_pid, player_data in msg.get("players", {}).items():
                state.queue_greeting(existing_pid, player_data.get("name", existing_pid))

        elif mtype == "join":
            join_pid = msg.get("pid", "")
            join_name = msg.get("name", join_pid)
            log.info("join: pid=%s name=%s", join_pid, join_name)
            state.queue_greeting(join_pid, join_name)

        elif mtype == "leave":
            log.info("leave: pid=%s", msg.get("pid"))

        elif mtype == "chat":
            # Log player chat so we can see activity, but 5a does not respond.
            cpid = msg.get("pid", "")
            cname = msg.get("name", cpid)
            ctext = msg.get("text", "")
            if cpid != PID:
                log.info("chat from %s (%s): %s", cpid, cname, ctext)

        elif mtype == "time":
            pass  # ignore time updates

        # Other message types (pos, edit, full, reject, etc.) are silently ignored.


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
        # Reset greeting state so re-connects greet players afresh.
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

    asyncio.run(run())


if __name__ == "__main__":
    main()
