"""Slow, capped wall damage. The service commits holes before collision changes."""
import math
import asyncio
import logging
from uuid import uuid4

from freeplay_rules import Refused
from freeplay_stream import bounded_delivery, send_operation

log = logging.getLogger("moorstead.freeplay")


def breach(battle, unit, goal):
    if battle.now - unit.get("breachAt", -999) < 1:
        return
    dx, dz = goal[0] - unit["x"], goal[2] - unit["z"]
    length = math.hypot(dx, dz)
    if length < 1:
        return
    direction = [dx / length, 0, dz / length]
    # Aim at both body-height voxels so the result is a walkable opening.
    for height, side in ((.4, 0), (1.4, 0), (.4, -.5), (1.4, -.5), (.4, .5), (1.4, .5)):
        origin = [unit["x"] - direction[2] * side, unit["y"] + height, unit["z"] + direction[0] * side]
        distance = battle.arena.ray(origin, direction, min(6, length))
        if distance >= min(6, length):
            continue
        point = tuple(math.floor(origin[i] + direction[i] * (distance + .02)) for i in range(3))
        x, y, z = point
        if not 1 <= y < 64 or not battle.arena.inside(x, z) or not battle.arena.solid(*point):
            continue
        unit["breachAt"] = battle.now
        battle.events.append({"type": "shot", "from": origin, "to": list(point),
                              "team": unit["team"], "weapon": "machinegun"})
        # Shared damage is capped at one hit per voxel/second, regardless of army size.
        hits, last = battle.wall_damage.get(point, (0, -999))
        if battle.now - last >= .99:
            battle.wall_damage[point] = (hits + 1, battle.now)
            if hits + 1 >= 4:
                battle.breaches.add(point)
        return


async def commit_breaches(service):
    battle, hub = service.core, service.hub
    # One small undoable terrain transaction per second; no client-supplied cells.
    if battle.now - getattr(service, "last_breach", -999) < 1 or not battle.breaches:
        return
    service.last_breach = battle.now
    points = sorted(battle.breaches)[:32]
    state = hub.store.state()
    command = {"type": "edit", "requestId": "breach-" + uuid4().hex,
               "epoch": state["epoch"], "baseRevision": state["revision"],
               "edits": [[*point, 0] for point in points]}
    try:
        hub.control.check_edit(command)
        result = await asyncio.to_thread(hub.store.apply, "battle-engine", command, "Battle wall damage")
    except Refused as error:
        # Capacity/vehicle protection remains authoritative. Preserve the wall.
        log.warning("battle_breach_refused", extra={"code": error.code})
        battle.breaches.clear()
        battle.wall_damage.clear()
        return
    battle.arena.changes(result["changes"])
    for point in points:
        battle.breaches.discard(point)
        battle.wall_damage.pop(point, None)
    hub.control.changed(result)
    await asyncio.gather(*(bounded_delivery(peer, lambda peer=peer: send_operation(
        peer, result, hub.store, hub.control.pilots())) for peer in list(hub.peers.values())))
