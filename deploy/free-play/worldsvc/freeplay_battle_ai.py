"""Bounded grounded squad movement and line-of-sight firing at five ticks/second."""
import math
from freeplay_battle_equipment import step_equipment
from freeplay_battle_breach import breach


def step(battle, delta):
    battle.wall += max(delta, 0)
    battle.expire_connections()
    delta = min(max(delta, 0), 0.5)
    battle.revision += 1
    if battle.paused() or battle.flags.phase == "won":
        return
    battle.now += delta
    battle.wall_damage = {p: damage for p, damage in battle.wall_damage.items() if battle.now - damage[1] < 10}
    battle.shields = {key: shield for key, shield in battle.shields.items() if shield["until"] > battle.now}
    for entity in battle.entities():
        if entity["id"] in battle.equipment:
            continue
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
        origin = [unit["x"], unit["y"] + 1.4, unit["z"]]
        visible = [other for other in enemies if math.dist(origin, [other["x"], other["y"] + 1, other["z"]]) <= 42
                   and battle.arena.visible(origin, [other["x"], other["y"] + 1, other["z"]])]
        # A nearer enemy behind a wall must not hide a shootable enemy/carrier.
        candidates = visible or enemies
        enemy = min(candidates, key=lambda other: (not bool(battle.flags.carrying(other["id"])),
                    math.dist(origin, [other[k] for k in ("x", "y", "z")])), default=None)
        if enemy and battle.flags.phase == "active":
            target = [enemy["x"], enemy["y"] + 1, enemy["z"]]
            distance = math.dist(origin, target)
            if distance <= 42 and battle.arena.visible(origin, target):
                unit["yaw"] = math.atan2(target[0] - origin[0], target[2] - origin[2])
                if battle.now - unit["shotAt"] >= 1.5:
                    direction = [(target[i] - origin[i]) / max(distance, 0.01) for i in range(3)]
                    battle.shoot(unit, direction, "machinegun", ai=True)
        owner = battle.players.get(unit["owner"])
        slot = unit["slot"]
        offset_x, offset_z = (slot % 5 - 2) * 1.5, (slot // 5 - 2.5) * 1.5
        goal = [unit["rally"][0] + offset_x, unit["rally"][1], unit["rally"][2] + offset_z]
        if unit["order"] == "defend" or (unit["order"] == "attack" and battle.flags.phase != "active"):
            camp = battle.arena.camps[unit["team"]]
            goal = [camp[0] + offset_x, camp[1], camp[2] + offset_z]
        elif unit["order"] == "follow" and owner and owner["hp"] > 0:
            goal = [owner["x"] + offset_x, owner["y"], owner["z"] + 5 + offset_z]
        elif unit["order"] == "attack":
            other_team = "red" if unit["team"] == "blue" else "blue"
            base = battle.flags.bases.get(other_team)
            if base:
                goal = [base[0], unit["y"], base[2]]
            elif enemy:
                goal = [enemy[k] for k in ("x", "y", "z")]
            if battle.flags.phase == "active":
                breach(battle, unit, goal)
        move(battle.arena, unit, goal, 3.2 * delta)
    step_equipment(battle, delta, move)
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
        radius = 1.1 if unit.get("kind") == "tank" else .3
        if not arena.inside(x, z) or any(arena.solid(x + ox, y + 0.1, z + oz) or arena.solid(x + ox, y + 1.2, z + oz)
               or arena.ground(x + ox, z + oz, y) is None
               for ox, oz in ((radius, 0), (-radius, 0), (0, radius), (0, -radius),
                              (radius, radius), (-radius, radius), (radius, -radius), (-radius, -radius))):
            continue
        unit.update(x=x, y=y, z=z, yaw=math.atan2(sx, sz))
        return
