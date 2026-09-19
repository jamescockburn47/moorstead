"""Deterministic ephemeral teams, cartoon combat, shields and respawning armies."""
import math

from freeplay_rules import Refused
from freeplay_battle_flags import Flags

TEAMS = {"blue", "red"}
WEAPONS = {"machinegun": (12, 0.25), "plasma": (25, 0.5)}


class Battle:
    def __init__(self, arena):
        self.arena = arena
        self.players, self.soldiers, self.shields = {}, {}, {}
        self.scores = {team: 0 for team in TEAMS}
        self.now, self.revision, self.serial = 0.0, 0, 0
        self.events = []
        self.flags = Flags(self)

    def spawn(self, entity):
        camp = self.arena.camps[entity["team"]]
        slot = entity.get("slot")
        x = camp[0] if slot is None else camp[0] + (slot % 6 - 2.5)
        z = camp[2] if slot is None else camp[2] + (slot // 6 - 1.5) * 1.2
        ground = self.arena.ground(x, z, camp[1])
        entity.update(x=x, y=ground if ground is not None else (self.arena.ground(x, z) or camp[1]), z=z,
                      hp=100 if entity["id"] in self.players else 50, shield=100 if entity["id"] in self.players else 0,
                      respawn=0, spawnSeq=entity.get("spawnSeq", 0) + 1, lastMove=self.now, lastHit=self.now)

    def join(self, pid, name, team):
        if team not in TEAMS:
            raise Refused("battle-team", "Choose blue or red.")
        if pid in self.players:
            if self.players[pid]["team"] != team:
                raise Refused("battle-team", "Leave the battle before changing teams.")
            return
        entity = {"id": pid, "name": name, "team": team, "yaw": 0, "shotAt": -999, "shieldAt": -999, "correctionSeq": 0}
        self.players[pid] = entity
        self.spawn(entity)

    def leave(self, pid):
        self.flags.release(pid)
        self.players.pop(pid, None)
        self.shields.pop(pid, None)
        self.soldiers = {key: unit for key, unit in self.soldiers.items() if unit["owner"] != pid}

    def alive(self, pid):
        player = self.players.get(pid)
        if not player or player["hp"] <= 0:
            raise Refused("battle-player", "Join a team and wait until you respawn.")
        return player

    def reset(self):
        self.flags.reset()
        self.soldiers.clear()
        self.shields.clear()
        self.scores = {team: 0 for team in TEAMS}
        for player in self.players.values():
            self.spawn(player)

    def recruit(self, pid, count):
        player = self.alive(pid)
        used = {unit["slot"] for unit in self.soldiers.values() if unit["team"] == player["team"]}
        slots = [slot for slot in range(24) if slot not in used]
        if count > len(slots):
            raise Refused("battle-army", "Each team can field 24 soldiers.")
        for offset in range(count):
            self.serial += 1
            unit = {"id": f"soldier-{self.serial}", "owner": pid, "team": player["team"], "yaw": 0,
                    "order": "follow", "rally": [player[key] for key in ("x", "y", "z")],
                    "shotAt": -999, "slot": slots[offset]}
            self.spawn(unit)
            self.soldiers[unit["id"]] = unit

    def order(self, pid, order, rally):
        self.alive(pid)
        for unit in self.soldiers.values():
            if unit["owner"] == pid:
                unit.update(order=order, rally=rally[:])

    def shield(self, pid):
        player = self.alive(pid)
        if self.now - player["shieldAt"] < 25:
            raise Refused("battle-shield", "The shield dome is recharging.")
        player["shieldAt"] = self.now
        self.shields[pid] = {"id": pid, "team": player["team"], "x": player["x"], "y": player["y"],
                             "z": player["z"], "radius": 6, "until": self.now + 12}

    def rally(self, pid):
        player = self.alive(pid)
        if self.flags.carrying(pid):
            raise Refused("battle-flag", "Bring the flag home on foot.")
        if self.now - player.get("rallyAt", -999) < 10:
            raise Refused("battle-rally", "Return to camp is recharging.")
        hp, shield = player["hp"], player["shield"]
        self.spawn(player)
        player.update(hp=hp, shield=shield, rallyAt=self.now)

    def move(self, pid, position):
        player = self.players.get(pid)
        if not player:
            return True
        distance = math.dist([player[key] for key in ("x", "y", "z")], [position[key] for key in ("x", "y", "z")])
        elapsed = min(max(self.now - player["lastMove"], 0.08), 1)
        if player["hp"] <= 0 or not self.arena.inside(position["x"], position["z"]) or distance > 30 * elapsed + 2:
            player["correctionSeq"] += 1
            return False
        start = [player["x"], player["y"] + 1, player["z"]]
        end = [position["x"], position["y"] + 1, position["z"]]
        if (self.arena.solid(position["x"], position["y"] + 0.1, position["z"])
                or self.arena.solid(position["x"], position["y"] + 1.4, position["z"])
                or not self.arena.visible(start, end)):
            player["correctionSeq"] += 1
            return False
        player.update(position, lastMove=self.now)
        self.flags.tick()
        return True

    def entities(self):
        return [*self.players.values(), *self.soldiers.values()]

    def protected(self, target):
        return any(shield["team"] == target["team"] and shield["until"] > self.now
                   and math.dist([shield[k] for k in ("x", "y", "z")], [target[k] for k in ("x", "y", "z")]) <= 6
                   for shield in self.shields.values())

    def damage(self, target, amount, team):
        if self.flags.phase != "active" or target["hp"] <= 0 or target["team"] == team or self.protected(target):
            return
        shielded = target["shield"] > 0
        absorbed = min(target["shield"], amount)
        target["shield"] -= absorbed
        target["hp"] = max(0, target["hp"] - amount + absorbed)
        target["lastHit"] = self.now
        self.events.append({"type": "hit", "targetId": target["id"], "x": target["x"], "y": target["y"] + 1,
                            "z": target["z"], "shield": shielded, "team": team})
        if target["hp"] == 0:
            if target["id"] in self.players:
                self.flags.release(target["id"], dropped=True)
            target["respawn"] = 5 if target["id"] in self.players else 8
            self.scores[team] += 3 if target["id"] in self.players else 1

    def shoot(self, source, direction, weapon, ai=False):
        self.flags.combat()
        damage, cooldown = WEAPONS[weapon]
        if self.now - source["shotAt"] < (1.5 if ai else cooldown):
            raise Refused("battle-rate", "That weapon is cooling down.")
        source["shotAt"] = self.now
        origin = [source["x"], source["y"] + 1.4, source["z"]]
        distance = self.arena.ray(origin, direction, 96)
        nearest, hit = distance, None
        for target in self.entities():
            if target["team"] == source["team"] or target["hp"] <= 0:
                continue
            vector = [target[k] - origin[i] + (1 if k == "y" else 0) for i, k in enumerate(("x", "y", "z"))]
            along = sum(vector[i] * direction[i] for i in range(3))
            perpendicular = sum(v * v for v in vector) - along * along
            if 0 <= along < nearest and perpendicular <= 0.65**2:
                nearest, hit = max(0, along - math.sqrt(max(0, 0.65**2 - perpendicular))), target
        endpoint = [origin[i] + direction[i] * nearest for i in range(3)]
        self.events.append({"type": "shot", "from": origin, "to": endpoint, "team": source["team"], "weapon": weapon})
        if hit:
            self.damage(hit, damage, source["team"])

    def explosion_targets(self, center, radius, team):
        origin = [center[0], center[1] + 1.2, center[2]]
        return [(target, max(10, 200 * (1 - math.dist(center, [target[k] for k in ("x", "y", "z")]) / radius)))
                for target in self.entities() if target["team"] != team and target["hp"] > 0
                and math.dist(center, [target[k] for k in ("x", "y", "z")]) < radius
                and self.arena.visible(origin, [target["x"], target["y"] + 1, target["z"]])]

    def state(self):
        keys = ("id", "name", "team", "x", "y", "z", "yaw", "hp", "shield", "respawn", "spawnSeq", "correctionSeq", "owner", "order")
        def public(entity):
            result = {key: entity[key] for key in keys if key in entity}
            if entity["id"] in self.players:
                result["shieldCooldown"] = min(25, max(0, 25 - self.now + entity["shieldAt"]))
            return result
        x, z = self.arena.origin
        return {"available": True, "revision": self.revision,
                "ctf": self.flags.state(),
                "bounds": {"minX": x, "minZ": z, "maxX": x + self.arena.width - 1, "maxZ": z + self.arena.width - 1},
                "camps": self.arena.camps, "scores": self.scores.copy(),
                "players": [public(entity) for entity in self.players.values()],
                "soldiers": [public(entity) for entity in self.soldiers.values()],
                "shields": [{**{key: value for key, value in shield.items() if key != "until"},
                             "remaining": min(12, max(0, shield["until"] - self.now))} for shield in self.shields.values()]}
