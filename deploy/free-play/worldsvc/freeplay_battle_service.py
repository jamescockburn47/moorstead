"""Authenticated battle commands, pre-destruction cover and bounded match ticks."""
import asyncio
import math
from pathlib import Path
import time

from freeplay_battle import Battle, TEAMS, WEAPONS
from freeplay_battle_ai import step
from freeplay_battle_terrain import Arena
from freeplay_rules import BOMBS, Refused, integer

COMMANDS = {"battle-join", "battle-leave", "battle-recruit", "battle-order", "battle-shot",
            "battle-shield", "battle-rally", "battle-reset", "battle-base"}
FIELDS = {"battle-join": {"team"}, "battle-recruit": {"count"},
          "battle-order": {"order", "rally"}, "battle-shot": {"weapon", "direction"}}


def vector(value):
    return (isinstance(value, list) and len(value) == 3
            and all(type(number) in (int, float) and math.isfinite(number) for number in value))


class BattleService:
    def __init__(self, hub, baseline):
        self.hub, self.core, self.task = hub, None, None
        if Path(baseline).exists():
            arena = Arena.load(baseline)
            arena.reload(hub.store)
            self.core = Battle(arena)

    async def start(self):
        if self.core:
            self.task = asyncio.create_task(self.run())

    async def stop(self):
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass

    async def run(self):
        previous = time.monotonic()
        while True:
            await asyncio.sleep(0.2)
            now = time.monotonic()
            async with self.hub.lock:
                if self.core.players:
                    step(self.core, now - previous)
                    await self.flush(state=True)
            previous = now

    async def initial(self, peer):
        if self.core:
            await peer.send({"type": "battle-state", "epoch": self.hub.epoch, "battle": self.core.state()})

    async def flush(self, state=False):
        events, self.core.events = self.core.events[:128], []
        for event in events:
            await self.hub.notice({"type": "battle-event", "epoch": self.hub.epoch, "event": event})
        if state:
            await self.hub.notice({"type": "battle-state", "epoch": self.hub.epoch, "battle": self.core.state()})

    async def handle(self, peer, command):
        kind = command["type"]
        if set(command) != {"type", "epoch"} | FIELDS.get(kind, set()):
            raise Refused("battle-shape", "Invalid battlefield command fields.")
        if not integer(command.get("epoch"), 1, 2**53 - 1):
            raise Refused("battle-epoch", "Invalid battlefield generation.")
        async with self.hub.lock:
            if self.hub.peers.get(peer.pid) is not peer:
                raise Refused("session", "This account connected somewhere else.")
            self.hub.session(peer.pid, peer.token)
            if command["epoch"] != self.hub.epoch:
                raise Refused("stale", "Reconnect to the current battlefield.")
            if not self.core:
                raise Refused("battle-unavailable", "The battlefield is not available on this server.")
            now = time.monotonic()
            if now - peer.last_battle < 0.08:
                raise Refused("battle-rate", "Wait a moment before the next battlefield action.")
            peer.last_battle = now
            self.execute(peer, command)
            await self.flush(state=kind != "battle-shot")

    def execute(self, peer, command):
        kind = command["type"]
        if kind == "battle-join":
            if any(lease["peer"].pid == peer.pid for lease in self.hub.control.leases.values()):
                raise Refused("battle-vehicle", "Park the vehicle before joining a team.")
            if not isinstance(command["team"], str) or command["team"] not in TEAMS:
                raise Refused("battle-team", "Choose blue or red.")
            self.core.join(peer.pid, peer.name, command["team"])
        elif kind == "battle-leave":
            self.core.leave(peer.pid)
        elif kind == "battle-recruit":
            if not integer(command["count"], 1, 6):
                raise Refused("battle-army", "Recruit one to six soldiers at a time.")
            self.core.recruit(peer.pid, command["count"])
        elif kind == "battle-order":
            order, rally = command["order"], command["rally"]
            if (not isinstance(order, str) or order not in {"follow", "hold", "attack"} or not vector(rally)
                    or not self.core.arena.inside(rally[0], rally[2]) or not 1 <= rally[1] <= 192):
                raise Refused("battle-order", "Choose follow, hold or attack inside the battlefield.")
            self.core.order(peer.pid, order, rally)
        elif kind == "battle-shot":
            weapon, direction = command["weapon"], command["direction"]
            if not isinstance(weapon, str) or weapon not in WEAPONS or not vector(direction):
                raise Refused("battle-shot", "Invalid battlefield shot.")
            length = math.sqrt(sum(value * value for value in direction))
            if not 0.5 <= length <= 1.5:
                raise Refused("battle-shot", "Aim with a unit direction.")
            self.core.shoot(self.core.alive(peer.pid), [value / length for value in direction], weapon)
        elif kind == "battle-shield":
            self.core.shield(peer.pid)
        elif kind == "battle-base":
            self.core.flags.base(peer.pid)
        elif kind == "battle-rally":
            self.core.rally(peer.pid)
        elif kind == "battle-reset":
            self.core.alive(peer.pid)
            self.core.reset()

    async def move(self, peer, position):
        if not self.core or peer.pid not in self.core.players:
            return True
        async with self.hub.lock:
            accepted = self.core.move(peer.pid, position)
            if not accepted and time.monotonic() - peer.last_correction >= 0.2:
                peer.last_correction = time.monotonic()
                await self.initial(peer)
            return accepted

    def plan_damage(self, peer, command):
        self.block_large_bombs(peer, command)
        if not self.core or peer.pid not in self.core.players:
            return []
        actor = self.core.alive(peer.pid)
        if command.get("type") not in {"weapon", "blast"}:
            return []
        self.core.flags.combat()
        center = command.get("center")
        if (not vector(center) or not self.core.arena.inside(center[0], center[2])
                or math.dist(center, [actor[key] for key in ("x", "y", "z")]) > 96):
            raise Refused("battle-range", "Aim inside the battlefield and within range.")
        profile = command.get("bomb") if command["type"] == "blast" else command.get("weapon")
        if profile in {"sheep", "gravity"}:
            return []
        radius = BOMBS[profile][0] if isinstance(profile, str) and profile in BOMBS else {"plasma": 2, "rocket": 7, "machinegun": 1}.get(profile, 0)
        if not radius:
            return []
        origin = [actor["x"], actor["y"] + 1.4, actor["z"]]
        if command["type"] == "weapon" and not self.core.arena.visible(origin, [center[0], center[1] + 1, center[2]]):
            raise Refused("battle-cover", "Cover blocks that shot. Aim at its visible surface.")
        return [(target, amount, actor["team"]) for target, amount in self.core.explosion_targets(center, radius, actor["team"])]

    def block_large_bombs(self, peer, command):
        if not self.core or not self.core.players or command.get("type") != "blast" or command.get("bomb") not in {"mega", "atom"}:
            return
        x, _, z = command["center"]
        ox, oz = self.core.arena.origin
        edge = self.core.arena.width - 1
        nearest_x, nearest_z = min(max(x, ox), ox + edge), min(max(z, oz), oz + edge)
        if peer.pid in self.core.players or math.hypot(x - nearest_x, z - nearest_z) <= BOMBS[command["bomb"]][0]:
            raise Refused("battle-bomb", "Mega and atom bombs cannot be used in or across an occupied battlefield.")

    async def committed(self, result, damage):
        if not self.core:
            return
        if result["replace"]:
            self.core.arena.reload(self.hub.store)
            self.core.reset()
        else:
            for target, amount, team in damage:
                self.core.damage(target, amount, team)
            self.core.arena.changes(result["changes"])
        await self.flush(state=bool(damage) or result["replace"])

    async def disconnect(self, peer):
        if self.core:
            async with self.hub.lock:
                self.core.leave(peer.pid)
                await self.flush(state=True)
