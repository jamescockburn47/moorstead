"""Bounded, temporary battlefield equipment; shots never edit terrain."""
import math

from freeplay_rules import Refused

PROFILES = {"turret": {"hp": 75, "range": 28, "damage": 6, "interval": 2.0, "cap": 3},
            "tank": {"hp": 100, "range": 38, "damage": 28, "interval": 3.5, "cap": 2}}


def deploy_equipment(battle, pid, kind, point, squad):
    player = battle.alive(pid)
    if kind not in PROFILES or type(squad) is not int or squad not in (1, 2, 3):
        raise Refused("battle-equipment", "Choose a turret or tank and squad 1, 2 or 3.")
    if battle.now - player.get("equipmentAt", -999) < 20:
        raise Refused("battle-equipment", "Equipment refreshes every 20 seconds.")
    profile = PROFILES[kind]
    if sum(unit["kind"] == kind and unit["team"] == player["team"] for unit in battle.equipment.values()) >= profile["cap"]:
        raise Refused("battle-equipment", "Team limit: three turrets and two tanks.")
    x, old_y, z = point
    if math.dist(point, [player[k] for k in ("x", "y", "z")]) > 18:
        raise Refused("battle-equipment", "Place equipment within 18 blocks.")
    y = battle.arena.ground(x, z, old_y)
    if y is None or abs(y - old_y) > 1 or not battle.arena.visible(
            [player["x"], player["y"] + 1.4, player["z"]], [x, y + 1, z]):
        raise Refused("battle-equipment", "Choose visible, supported ground.")
    for dx in (-1, 0, 1):
        for dz in (-1, 0, 1):
            floor = battle.arena.ground(x + dx, z + dz, y)
            if not battle.arena.inside(x + dx, z + dz) or floor is None or abs(floor - y) > .35:
                raise Refused("battle-equipment", "Equipment needs three blocks of level, clear ground.")
    if any(math.hypot(unit["x"] - x, unit["z"] - z) < 3 for unit in battle.equipment.values()):
        raise Refused("battle-equipment", "Leave room between equipment.")
    battle.serial += 1
    unit = {"id": f"equipment-{battle.serial}", "owner": pid, "team": player["team"],
            "kind": kind, "squad": squad, "x": x, "y": y, "z": z, "yaw": 0,
            "hp": profile["hp"], "shield": 0, "respawn": 0, "spawnSeq": 1,
            "shotAt": battle.now, "lastHit": battle.now, "order": "hold", "rally": [x, y, z]}
    battle.equipment[unit["id"]] = unit
    player["equipmentAt"] = battle.now


def step_equipment(battle, delta, move):
    for key, unit in list(battle.equipment.items()):
        if unit["hp"] <= 0:
            del battle.equipment[key]
            continue
        if battle.flags.phase != "active":
            continue
        profile = PROFILES[unit["kind"]]
        origin = [unit["x"], unit["y"] + 1.4, unit["z"]]
        enemies = [(math.dist(origin, [e["x"], e["y"] + 1, e["z"]]), e) for e in battle.entities()
                   if e["team"] != unit["team"] and e["hp"] > 0]
        visible = [(d, e) for d, e in enemies if d <= profile["range"] and battle.arena.visible(
            origin, [e["x"], e["y"] + 1, e["z"]])]
        target = min(visible, key=lambda pair: pair[0], default=None)
        if target:
            _, enemy = target
            end = [enemy["x"], enemy["y"] + 1, enemy["z"]]
            unit["yaw"] = math.atan2(end[0] - origin[0], end[2] - origin[2])
            if battle.now - unit["shotAt"] >= profile["interval"]:
                unit["shotAt"] = battle.now
                battle.events.append({"type": "shot", "from": origin, "to": end,
                                      "team": unit["team"], "weapon": unit["kind"]})
                battle.damage(enemy, profile["damage"], unit["team"])
        if unit["kind"] != "tank":
            continue
        owner = battle.players.get(unit["owner"])
        goal = unit["rally"]
        if unit["order"] == "defend":
            goal = battle.arena.camps[unit["team"]]
        elif unit["order"] == "follow" and owner and owner["hp"] > 0:
            goal = [owner["x"] + 3, owner["y"], owner["z"] + 5]
        elif unit["order"] == "attack":
            if target:
                continue
            nearest = min(enemies, key=lambda pair: pair[0], default=None)
            if nearest:
                goal = [nearest[1][k] for k in ("x", "y", "z")]
        move(battle.arena, unit, goal, 2 * delta)
