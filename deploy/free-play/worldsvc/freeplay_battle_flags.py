"""Server-owned bases and player-only capture-the-flag round state."""
import math

from freeplay_rules import Refused


class Flags:
    def __init__(self, battle):
        self.battle = battle
        self.defaults = {team: point[:] for team, point in battle.arena.camps.items()}
        self.reset()

    def reset(self):
        self.phase, self.winner = "setup", None
        self.bases = {"blue": None, "red": None}
        self.flags = {}
        self.battle.arena.camps = {team: point[:] for team, point in self.defaults.items()}

    def combat(self):
        if self.phase != "active":
            raise Refused("battle-round", "Choose both bases before fighting." if self.phase == "setup" else "The flag is captured. Start a new round.")

    def base(self, pid):
        player = self.battle.alive(pid)
        if self.phase != "setup":
            raise Refused("battle-base", "Bases are locked until the next round.")
        x, z = player["x"], player["z"]
        y = self.battle.arena.ground(x, z, player["y"])
        if y is None or abs(y - player["y"]) > 0.35:
            raise Refused("battle-base", "Stand on solid ground to choose a base.")
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                ground = self.battle.arena.ground(x + dx, z + dz, y)
                if ground is None or abs(ground - y) > 1:
                    raise Refused("battle-base", "Choose clear, supported ground with room around the flag.")
        team = player["team"]
        enemy = "red" if team == "blue" else "blue"
        other = self.bases[enemy]
        if other and math.hypot(other[0] - x, other[2] - z) < 32:
            raise Refused("battle-base", "Choose bases at least 32 blocks apart.")
        self.bases[team] = [x, y, z]
        self.battle.arena.camps[team] = [x, y, z]
        self.home(team)
        if all(self.bases.values()):
            self.phase = "active"

    def home(self, team):
        if self.bases[team] is not None:
            x, y, z = self.bases[team]
            self.flags[team] = {"team": team, "x": x, "y": y, "z": z,
                                "status": "home", "carrier": None, "until": 0}

    def carrying(self, pid):
        return next((flag for flag in self.flags.values() if flag["carrier"] == pid), None)

    def release(self, pid, dropped=False):
        flag = self.carrying(pid)
        if flag is None:
            return
        if not dropped:
            self.home(flag["team"])
            return
        player = self.battle.players[pid]
        ground = self.battle.arena.ground(player["x"], player["z"], player["y"])
        flag.update(x=player["x"], y=ground if ground is not None else player["y"], z=player["z"],
                    status="dropped", carrier=None, until=self.battle.now + 20)

    def touch(self, player, point):
        origin = [player[k] for k in ("x", "y", "z")]
        return math.dist(origin, point) <= 2 and self.battle.arena.visible(
            [origin[0], origin[1] + 1, origin[2]], [point[0], point[1] + 1, point[2]])

    def tick(self):
        if self.phase != "active" or not all(self.bases.values()):
            return
        for team, flag in list(self.flags.items()):
            if flag["status"] == "dropped" and flag["until"] <= self.battle.now:
                self.home(team)
            elif flag["carrier"]:
                carrier = self.battle.players.get(flag["carrier"])
                if carrier is None:
                    self.home(team)
                elif carrier["hp"] <= 0:
                    self.release(carrier["id"], dropped=True)
                else:
                    flag.update({key: carrier[key] for key in ("x", "y", "z")})
        present = {player["team"] for player in self.battle.players.values()}
        for player in self.battle.players.values():
            if player["hp"] <= 0:
                continue
            team = player["team"]
            own = self.flags[team]
            if own["status"] == "dropped" and self.touch(player, [own[k] for k in ("x", "y", "z")]):
                self.home(team)
                own = self.flags[team]
            enemy = self.flags["red" if team == "blue" else "blue"]
            if len(present) != 2:
                continue
            if (enemy["status"] != "carried" and not self.carrying(player["id"])
                    and self.touch(player, [enemy[k] for k in ("x", "y", "z")])):
                enemy.update(status="carried", carrier=player["id"], until=0,
                             **{key: player[key] for key in ("x", "y", "z")})
            if (enemy["carrier"] == player["id"] and own["status"] == "home"
                    and self.touch(player, self.bases[team])):
                self.phase, self.winner = "won", team
                return

    def state(self):
        return {"phase": self.phase, "winner": self.winner,
                "bases": {team: point[:] if point else None for team, point in self.bases.items()},
                "flags": {team: {**{k: v for k, v in flag.items() if k != "until"},
                                  "returnIn": min(20, max(0, flag["until"] - self.battle.now))}
                          for team, flag in self.flags.items()}}
