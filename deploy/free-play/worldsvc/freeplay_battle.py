"""Deterministic ephemeral teams, cartoon combat, shields and respawning armies."""
import math

from freeplay_rules import MAX_PLAYERS, Refused
from freeplay_battle_flags import Flags
from freeplay_battle_equipment import deploy_equipment

TEAMS = {"blue", "red"}
WEAPONS = {"machinegun": (12, 0.25), "plasma": (25, 0.5)}


class Battle:
    def __init__(self, arena):
        self.arena = arena
        self.players, self.soldiers, self.shields = {}, {}, {}
        self.equipment = {}
        self.wall_damage, self.breaches = {}, set()
        self.scores = {team: 0 for team in TEAMS}
        self.now, self.revision, self.serial = 0.0, 0, 0
        self.wall = 0.0
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
        if len(self.players) >= MAX_PLAYERS:
            raise Refused("battle-full", "The battlefield is full, including players reconnecting.")
        entity = {"id": pid, "name": name, "team": team, "yaw": 0, "shotAt": -999, "shieldAt": -999,
                  "correctionSeq": 0, "connected": True, "reconnectUntil": None}
        self.players[pid] = entity
        self.spawn(entity)
        self.flags.try_start()

    def reconnect(self, pid):
        if pid in self.players:
            self.players[pid].update(connected=True, reconnectUntil=None)
            self.flags.try_start()

    def disconnect(self, pid):
        if pid in self.players and self.players[pid]["connected"]:
            self.players[pid].update(connected=False, reconnectUntil=self.wall + 60)

    def paused(self):
        return self.flags.phase == "active" and any(not p["connected"] for p in self.players.values())

    def expire_connections(self):
        for pid, player in list(self.players.items()):
            if not player["connected"] and player["reconnectUntil"] <= self.wall:
                if self.flags.phase == "active":
                    self.forfeit(pid)
                else:
                    self.leave(pid)

    def forfeit(self, pid):
        player = self.players.get(pid)
        if player is None:
            raise Refused("battle-player", "Join a team first.")
        if self.flags.phase == "active":
            self.flags.phase, self.flags.reason = "won", "forfeit"
            self.flags.winner = "red" if player["team"] == "blue" else "blue"
        self.leave(pid)

    def leave(self, pid):
        participated = pid in self.players
        self.flags.release(pid)
        removed = self.players.pop(pid, None)
        self.shields.pop(pid, None)
        self.soldiers = {key: unit for key, unit in self.soldiers.items() if unit["owner"] != pid}
        if removed and not any(p["team"] == removed["team"] for p in self.players.values()):
            self.flags.ready[removed["team"]] = False
        self.equipment = {key: unit for key, unit in self.equipment.items() if unit["owner"] != pid}
        if participated and not self.players:
            self.reset()

    def alive(self, pid):
        player = self.players.get(pid)
        if not player or player["hp"] <= 0:
            raise Refused("battle-player", "Join a team and wait until you respawn.")
        return player

    def reset(self):
        self.flags.reset()
        self.soldiers.clear()
        self.equipment.clear()
        self.wall_damage.clear()
        self.breaches.clear()
        self.shields.clear()
        self.scores = {team: 0 for team in TEAMS}
        for player in self.players.values():
            player.update(recruitAt=-999, equipmentAt=-999)
            self.spawn(player)

    def recruit(self, pid, count):
        player = self.alive(pid)
        if type(count) is not int or not 1 <= count <= 10:
            raise Refused("battle-army", "Recruit up to ten soldiers.")
        if self.now - player.get("recruitAt", -999) < 25:
            raise Refused("battle-army", "Reinforcements refresh every 25 seconds.")
        used = {unit["slot"] for unit in self.soldiers.values() if unit["team"] == player["team"]}
        slots = [slot for slot in range(30) if slot not in used]
        if count > len(slots):
            raise Refused("battle-army", "Each team can field 30 soldiers.")
        groups = {unit.get("squad", 1) for unit in self.soldiers.values() if unit["owner"] == pid}
        squad = next((number for number in (1, 2, 3) if number not in groups), 3)
        player["recruitAt"] = self.now
        for offset in range(count):
            self.serial += 1
            unit = {"id": f"soldier-{self.serial}", "owner": pid, "team": player["team"], "yaw": 0,
                    "order": "attack", "rally": [player[key] for key in ("x", "y", "z")],
                    "shotAt": -999, "slot": slots[offset], "squad": squad}
            self.spawn(unit)
            self.soldiers[unit["id"]] = unit

    def order(self, pid, order, rally, squad=0):
        self.alive(pid)
        for unit in [*self.soldiers.values(), *self.equipment.values()]:
            if unit["owner"] == pid and (not squad or unit.get("squad", 1) == squad):
                unit.update(order=order, rally=rally[:])

    def deploy(self, pid, kind, point, squad=1):
        deploy_equipment(self, pid, kind, point, squad)

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
        if self.paused() or player["hp"] <= 0 or not self.arena.inside(position["x"], position["z"]) or distance > 30 * elapsed + 2:
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
        return [*self.players.values(), *self.soldiers.values(), *self.equipment.values()]

    def protected(self, target):
        return any(shield["team"] == target["team"] and shield["until"] > self.now
                   and math.dist([shield[k] for k in ("x", "y", "z")], [target[k] for k in ("x", "y", "z")]) <= 6
                   for shield in self.shields.values())

    def damage(self, target, amount, team, source_id=None):
        if self.flags.phase != "active" or self.paused() or target["hp"] <= 0 or target["team"] == team or self.protected(target):
            return
        shielded = target["shield"] > 0
        absorbed = min(target["shield"], amount)
        target["shield"] -= absorbed
        target["hp"] = max(0, target["hp"] - amount + absorbed)
        target["lastHit"] = self.now
        self.events.append({"type": "hit", "targetId": target["id"], "x": target["x"], "y": target["y"] + 1,
                            "z": target["z"], "shield": shielded, "team": team})
        if source_id is not None:
            self.events[-1]["sourceId"] = source_id
        if target["hp"] == 0:
            if target["id"] in self.players:
                self.flags.release(target["id"], dropped=True)
            # Shared 25-second wave, with at least eight seconds out of action.
            target["respawn"] = 5 if target["id"] in self.players else 25 - self.now % 25
            if target["id"] not in self.players and target["respawn"] < 8:
                target["respawn"] += 25
            self.scores[team] += 3 if target["id"] in self.players else 1

    def shoot(self, source, direction, weapon, ai=False, shot_time=None):
        self.flags.combat()
        damage, cooldown = WEAPONS[weapon]
        clock = self.now if ai or shot_time is None else shot_time
        key = "shotAt" if ai or shot_time is None else "shotAtReal"
        if clock - source.get(key, -999) < (1.5 if ai else cooldown) - 1e-9:
            raise Refused("battle-rate", "That weapon is cooling down.")
        source[key] = clock
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
        self.events.append({"type": "shot", "from": origin, "to": endpoint, "team": source["team"], "weapon": weapon, "sourceId": source["id"]})
        if hit:
            self.damage(hit, damage, source["team"], source["id"])

    def explosion_targets(self, center, radius, team):
        origin = [center[0], center[1] + 1.2, center[2]]
        return [(target, max(10, 200 * (1 - math.dist(center, [target[k] for k in ("x", "y", "z")]) / radius)))
                for target in self.entities() if target["team"] != team and target["hp"] > 0
                and math.dist(center, [target[k] for k in ("x", "y", "z")]) < radius
                and self.arena.visible(origin, [target["x"], target["y"] + 1, target["z"]])]

    def state(self):
        keys = ("id", "name", "team", "x", "y", "z", "yaw", "hp", "shield", "respawn", "spawnSeq", "correctionSeq", "owner", "order", "squad", "kind")
        def public(entity):
            result = {key: entity[key] for key in keys if key in entity}
            if entity["id"] in self.players:
                result["shieldCooldown"] = min(25, max(0, 25 - self.now + entity["shieldAt"]))
                result["connected"] = entity["connected"]
                result["reconnectIn"] = 0 if entity["connected"] else min(60, max(0, entity["reconnectUntil"] - self.wall))
                result["recruitCooldown"] = max(0, 25 - self.now + entity.get("recruitAt", -999))
                result["equipmentCooldown"] = max(0, 20 - self.now + entity.get("equipmentAt", -999))
            return result
        x, z = self.arena.origin
        return {"available": True, "revision": self.revision,
                "ctf": self.flags.state(),
                "bounds": {"minX": x, "minZ": z, "maxX": x + self.arena.width - 1, "maxZ": z + self.arena.width - 1},
                "camps": self.arena.camps, "scores": self.scores.copy(),
                "players": [public(entity) for entity in self.players.values()],
                "soldiers": [public(entity) for entity in self.soldiers.values()],
                "equipment": [public(entity) for entity in self.equipment.values()],
                "shields": [{**{key: value for key, value in shield.items() if key != "until"},
                             "remaining": min(12, max(0, shield["until"] - self.now))} for shield in self.shields.values()]}
