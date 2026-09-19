"""Ephemeral pilot leases and bounded pose saves, independent of terrain revision."""
import asyncio
import secrets
import time

from freeplay_rules import Refused, integer
from freeplay_vehicles import valid_id, validate_pose

COMMANDS = {"vehicle-claim", "vehicle-release", "vehicle-drive"}


class VehicleControl:
    def __init__(self, hub):
        self.hub = hub
        self.leases = {}

    def pilots(self):
        return {key: lease["peer"].pid for key, lease in self.leases.items()}

    def changed(self, result):
        if result["replace"]:
            self.leases.clear()
        else:
            for vehicle_id in result["vehicleChanges"]:
                self.leases.pop(vehicle_id, None)

    def check_edit(self, command):
        if (command.get("type") == "vehicle-edit" and isinstance(command.get("vehicleId"), str)
                and command["vehicleId"] in self.leases):
            raise Refused("vehicle-pilot", "Park the vehicle before editing its blocks.")

    async def handle(self, peer, command):
        kind, vehicle_id = command.get("type"), command.get("vehicleId")
        fields = {"type", "epoch", "vehicleId"}
        if kind in {"vehicle-drive", "vehicle-release"}:
            fields.add("lease")
        if kind == "vehicle-drive" or (kind == "vehicle-release" and "pose" in command):
            fields |= {"pose", "seq"}
        if (set(command) != fields or not valid_id(vehicle_id)
                or not integer(command.get("epoch"), 1, 2**53 - 1)):
            raise Refused("vehicle-control", "Invalid vehicle control message.")
        async with self.hub.lock:
            if self.hub.peers.get(peer.pid) is not peer:
                raise Refused("session", "This account connected somewhere else.")
            self.hub.session(peer.pid, peer.token)
            if command["epoch"] != self.hub.epoch:
                raise Refused("stale", "This vehicle belongs to another world generation.")
            vehicle = self.hub.store.vehicle(vehicle_id)
            lease = self.leases.get(vehicle_id)
            if kind == "vehicle-claim":
                if lease and lease["peer"] is not peer:
                    raise Refused("vehicle-pilot", "The other player is driving this vehicle.")
                if not lease:
                    if any(item["peer"] is peer for item in self.leases.values()):
                        raise Refused("vehicle-pilot", "Park your current vehicle first.")
                    lease = {"peer": peer, "token": secrets.token_urlsafe(18), "seq": 0, "saved": time.monotonic()}
                    self.leases[vehicle_id] = lease
                await self.announce(vehicle, lease)
                return
            if (not lease or lease["peer"] is not peer or not isinstance(command.get("lease"), str)
                    or command["lease"] != lease["token"]):
                raise Refused("vehicle-lease", "Take the controls before moving this vehicle.")
            if "pose" in command:
                if not integer(command.get("seq"), lease["seq"] + 1, 2**53 - 1):
                    raise Refused("vehicle-sequence", "That vehicle movement is outdated.")
                now = time.monotonic()
                elapsed = now - lease["saved"]
                if kind == "vehicle-drive" and elapsed < 0.249:
                    return  # Bound saves to about four per second; release flushes the final pose.
                pose = validate_pose(command["pose"], vehicle, vehicle["pose"], elapsed)
                vehicle = await asyncio.to_thread(self.hub.store.move_vehicle, vehicle_id, pose)
                lease["seq"], lease["saved"] = command["seq"], now
                await self.hub.notice({"type": "vehicle-pos", "epoch": self.hub.epoch,
                                       "vehicleId": vehicle_id, "seq": lease["seq"],
                                       "pose": pose, "pilot": peer.pid})
            if kind == "vehicle-release":
                self.leases.pop(vehicle_id)
                await self.announce(vehicle, None)

    async def announce(self, vehicle, lease):
        await self.hub.notice({"type": "vehicle-lease", "epoch": self.hub.epoch,
                               "vehicleId": vehicle["id"], "pilot": lease["peer"].pid if lease else None,
                               "lease": lease["token"] if lease else None, "pose": vehicle["pose"]})

    async def disconnect(self, peer):
        async with self.hub.lock:
            for vehicle_id, lease in list(self.leases.items()):
                if lease["peer"] is peer:
                    self.leases.pop(vehicle_id)
                    await self.announce(self.hub.store.vehicle(vehicle_id), None)
