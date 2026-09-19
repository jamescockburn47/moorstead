"""Bounded grounded squad movement and line-of-sight firing at five ticks/second."""
import math


def step(battle, delta):
    battle.wall += max(delta, 0)
    battle.expire_connections()
    delta = min(max(delta, 0), 0.5)
    battle.revision += 1
    if battle.paused() or battle.flags.phase == "won":
        return
    battle.now += delta
    battle.shields = {key: shield for key, shield in battle.shields.items() if shield["until"] > battle.now}
    for entity in battle.entities():
        if entity["hp"] <= 0:
            entity["respawn"] = max(0, entity["respawn"] - delta)
            if entity["respawn"] == 0:
                battle.spawn(entity)
        elif entity["id"] in battle.players and battle.now - entity["lastHit"] >= 3:
            entity["shield"] = min(100, entity["shield"] + 10 * delta)
    for unit in battle.soldiers.values():
        if unit["hp"] <= 0:
            continue
        enemies = [other for other in battle.entities() if other["team"] != unit["team"] and other["hp"] > 0]
        enemy = min(enemies, key=lambda other: math.dist([unit[k] for k in ("x", "y", "z")],
                                                        [other[k] for k in ("x", "y", "z")]), default=None)
        origin = [unit["x"], unit["y"] + 1.4, unit["z"]]
        if enemy and battle.flags.phase == "active":
            target = [enemy["x"], enemy["y"] + 1, enemy["z"]]
            distance = math.dist(origin, target)
            if distance <= 42 and battle.arena.visible(origin, target):
                unit["yaw"] = math.atan2(target[0] - origin[0], target[2] - origin[2])
                if battle.now - unit["shotAt"] >= 1.5:
                    direction = [(target[i] - origin[i]) / max(distance, 0.01) for i in range(3)]
                    battle.shoot(unit, direction, "machinegun", ai=True)
                if unit["order"] == "attack":
                    continue
        owner = battle.players.get(unit["owner"])
        slot = unit["slot"]
        offset_x, offset_z = (slot % 6 - 2.5) * 1.3, (slot // 6 - 1.5) * 1.3
        goal = [unit["rally"][0] + offset_x, unit["rally"][1], unit["rally"][2] + offset_z]
        if unit["order"] == "defend" or (unit["order"] == "attack" and battle.flags.phase != "active"):
            camp = battle.arena.camps[unit["team"]]
            goal = [camp[0] + offset_x, camp[1], camp[2] + offset_z]
        elif unit["order"] == "follow" and owner and owner["hp"] > 0:
            goal = [owner["x"] + offset_x, owner["y"], owner["z"] + 5 + offset_z]
        elif unit["order"] == "attack" and enemy:
            goal = [enemy[k] for k in ("x", "y", "z")]
        move(battle.arena, unit, goal, 3.2 * delta)
    battle.flags.tick()


def move(arena, unit, goal, distance):
    dx, dz = goal[0] - unit["x"], goal[2] - unit["z"]
    length = math.hypot(dx, dz)
    ground = arena.ground(unit["x"], unit["z"], unit["y"])
    if ground is None:
        landing = arena.ground(unit["x"], unit["z"])
        if landing is not None and landing < unit["y"]:
            unit["y"] = max(landing, unit["y"] - distance * 3)
        return
    unit["y"] = ground
    if length < 0.8:
        return
    stride = min(length, distance)
    for angle in (0, 0.7, -0.7, 1.4, -1.4):
        sx = (dx * math.cos(angle) - dz * math.sin(angle)) / length
        sz = (dx * math.sin(angle) + dz * math.cos(angle)) / length
        x, z = unit["x"] + sx * stride, unit["z"] + sz * stride
        y = arena.ground(x, z, unit["y"])
        if y is None or y - unit["y"] > 1:
            continue
        if any(arena.solid(x + ox, y + 0.1, z + oz) or arena.solid(x + ox, y + 1.2, z + oz)
               for ox, oz in ((0.3, 0), (-0.3, 0), (0, 0.3), (0, -0.3))):
            continue
        unit.update(x=x, y=y, z=z, yaw=math.atan2(sx, sz))
        return
