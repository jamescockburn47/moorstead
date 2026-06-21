"""Relay epoch gate — t' authoritative half of the world-epoch reset.

A warden factory-reset bumps a room's `epoch`. The relay advertises that epoch on
connect; a client echoes back the epoch it has synced (via `epochack`). Until a
client has acknowledged the room's current epoch it is treated as stale — an old
bundle, or a session left open across the reset — and may not write edits or pocket
saves, so it cannot re-seed a world that was just wiped.

Pure + stdlib-only on purpose, so it unit-tests without standing up FastAPI.
"""


def may_persist(client_epoch, room_epoch):
    """True if a client on `client_epoch` is allowed to write to a room on
    `room_epoch`. A client must be at least as current as the room. Unparseable
    client epochs (None, junk) are refused."""
    try:
        return int(client_epoch) >= int(room_epoch)
    except (TypeError, ValueError):
        return False
