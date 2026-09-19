"""Bounded Free Play output framing. Slow peers close and can reconnect safely."""
import asyncio
from dataclasses import dataclass
import logging

from fastapi import WebSocketDisconnect

from freeplay_builds import MAX_BUILD
from freeplay_vehicles import MAX_VEHICLES, MAX_VEHICLE_CELLS
from freeplay_rules import (BATCH_SIZE, CONTENT_VERSION, MAX_CELLS, MAX_CHUNKS, MAX_EDIT,
                            PROTOCOL, ROOM, SEED, packed)

log = logging.getLogger("moorstead.freeplay")


@dataclass
class Peer:
    ws: object
    pid: str
    name: str
    token: str
    position: dict | None = None
    last_position: float = 0
    last_command: float = 0
    last_machinegun: float = 0

    async def send(self, value):
        await asyncio.wait_for(self.ws.send_text(packed(value)), timeout=3)

    async def close(self, code=4003):
        try:
            await asyncio.wait_for(self.ws.close(code=code), timeout=1)
        except (RuntimeError, OSError, asyncio.TimeoutError, WebSocketDisconnect):
            # The socket is already disconnected; its world state is durable.
            pass


async def send_snapshot(peer, store, players, pilots=None):
    state = store.state()
    await peer.send({"type": "init", "protocol": PROTOCOL, "freeplay": True,
                     "contentVersion": CONTENT_VERSION, "minContentVersion": CONTENT_VERSION,
                     "room": ROOM, "seed": SEED, **state, "players": players,
                     "limits": {"maxCells": MAX_CELLS, "maxChunks": MAX_CHUNKS,
                                "maxEdit": MAX_EDIT, "maxBuild": MAX_BUILD,
                                "maxVehicles": MAX_VEHICLES, "maxVehicleCells": MAX_VEHICLE_CELLS}})
    batches = store.snapshot(BATCH_SIZE)
    try:
        for edits in batches:
            await peer.send({"type": "snapshot", "edits": edits})
            await asyncio.sleep(0)
    finally:
        batches.close()
    for vehicle in store.vehicles():
        await peer.send({"type": "vehicle-snapshot", "vehicle": {**vehicle, "pilot": (pilots or {}).get(vehicle["id"])}})
    await peer.send({"type": "ready", "epoch": state["epoch"], "revision": state["revision"]})


async def send_operation(peer, result, store, pilots=None):
    begin = {key: result[key] for key in ("epoch", "revision", "requestId", "actor", "kind", "replace")}
    for key in ("bomb", "center", "weapon", "shape", "origin", "rotation", "block", "size"):
        if key in result:
            begin[key] = result[key]
    begin.update(type="begin", count=result["count"] if result["replace"] else len(result["changes"]),
                 vehicleCount=result["vehicleCount"])
    await peer.send(begin)
    if result["replace"]:
        batches = store.snapshot(BATCH_SIZE)
    else:
        changes = result["changes"]
        batches = (changes[start:start + BATCH_SIZE] for start in range(0, len(changes), BATCH_SIZE))
    try:
        for edits in batches:
            await peer.send({"type": "delta", "epoch": result["epoch"],
                             "revision": result["revision"], "edits": edits})
            await asyncio.sleep(0)
    finally:
        batches.close()
    vehicles = ({vehicle["id"]: vehicle for vehicle in store.vehicles()}
                if result["replace"] else result["vehicleChanges"])
    for vehicle_id, vehicle in vehicles.items():
        await peer.send({"type": "vehicle-delta", "epoch": result["epoch"], "revision": result["revision"],
                         "vehicleId": vehicle_id,
                         "vehicle": {**vehicle, "pilot": (pilots or {}).get(vehicle_id)} if vehicle else None})
    await peer.send({"type": "commit", **{key: result[key] for key in
                    ("epoch", "revision", "requestId", "history", "checkpoint")}})


async def bounded_delivery(peer, operation, timeout=30):
    try:
        await asyncio.wait_for(operation(), timeout=timeout)
        return True
    except (OSError, RuntimeError, asyncio.TimeoutError, WebSocketDisconnect) as error:
        # No tokens, inputs, saved cells or personal names are written to logs.
        log.info("freeplay_peer_delivery_failed", extra={"error_type": type(error).__name__})
        await peer.close(1013)
        return False
