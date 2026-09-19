"""Exact-room WebSocket adapter; production delegates authentication to the relay."""
import asyncio
import json
import logging
import re
import time

from fastapi import WebSocket, WebSocketDisconnect

from freeplay_rules import (CONTENT_VERSION, MAX_PACKET, MAX_PLAYERS, PROTOCOL, ROOM, Refused,
                            validate_command, validate_position)
from freeplay_store import Store
from freeplay_stream import Peer, bounded_delivery, send_operation, send_snapshot
from freeplay_vehicle_control import COMMANDS, VehicleControl
from freeplay_battle_service import COMMANDS as BATTLE_COMMANDS, BattleService

log = logging.getLogger("moorstead.freeplay")
IDENTITY = re.compile(r"a[a-z0-9-]{1,39}\Z")


class Hub:
    def __init__(self, store, authenticate, banned, battlefield=None):
        self.store, self.authenticate, self.banned = store, authenticate, banned
        self.lock = asyncio.Lock()
        self.peers = {}
        self.epoch = store.state()["epoch"]
        self.control = VehicleControl(self)
        self.battle = BattleService(self, battlefield or store.path.with_name("battlefield.json"))

    def session(self, pid, token):
        ok, session, _ = self.authenticate(ROOM, pid, "", token)
        if (not ok or not isinstance(session, dict) or session.get("room") != ROOM
                or not session.get("acct") or pid != ("a" + session["acct"])[:40]):
            raise Refused("access", "Use a current invite for this Free Play world.")
        name = re.sub(r"[^\w \-']", "", str(session.get("name", "")))[:24]
        if not name or self.banned(pid, name):
            raise Refused("access", "This account cannot enter Free Play.")
        return name

    async def notice(self, value, skip=None):
        targets = [peer for peer in self.peers.values() if peer is not skip]
        await asyncio.gather(*(bounded_delivery(peer, lambda peer=peer: peer.send(value)) for peer in targets))
        # Endpoint cleanup owns removal and its leave notice, including failed sends.

    async def command(self, peer, value):
        async with self.lock:
            if self.peers.get(peer.pid) is not peer:
                raise Refused("session", "This account connected somewhere else.")
            peer.name = self.session(peer.pid, peer.token)
            validate_command(value)
            self.control.check_edit(value)
            machinegun = value.get("type") == "weapon" and value.get("weapon") == "machinegun"
            if machinegun and time.monotonic() - peer.last_machinegun < 0.249:
                raise Refused("weapon-rate", "The machinegun is ready four times a second.")
            damage = self.battle.plan_damage(peer, value)
            result = await asyncio.to_thread(self.store.apply, peer.pid, value, peer.name)
            if result["type"] == "ack":
                await peer.send(result)
                return
            if machinegun:
                peer.last_machinegun = time.monotonic()
            self.epoch = result["epoch"]
            self.control.changed(result)
            if result["replace"]:
                for other in self.peers.values():
                    other.position = None
            targets = list(self.peers.values())
            await asyncio.gather(*(
                bounded_delivery(other, lambda other=other: send_operation(other, result, self.store, self.control.pilots()),
                                 timeout=120 if result["replace"] else 30) for other in targets))
            await self.battle.committed(result, damage)

    async def error(self, peer, error, value=None):
        state = self.store.state()
        response = {"type": "error", "code": error.code, "message": str(error),
                    "epoch": state["epoch"], "revision": state["revision"]}
        if isinstance(value, dict) and isinstance(value.get("requestId"), str):
            response["requestId"] = value["requestId"][:80]
        if isinstance(value, dict) and isinstance(value.get("type"), str) and value["type"] in COMMANDS | BATTLE_COMMANDS:
            response["command"] = value["type"]
            if isinstance(value.get("vehicleId"), str):
                response["vehicleId"] = value["vehicleId"][:32]
        await peer.send(response)

    async def receive(self, peer):
        while self.peers.get(peer.pid) is peer:
            try:
                text = await asyncio.wait_for(peer.ws.receive_text(), timeout=1)
            except asyncio.TimeoutError:
                # Check revocation/expiry even while a player is idle.
                self.session(peer.pid, peer.token)
                continue
            self.session(peer.pid, peer.token)
            if len(text.encode("utf-8")) > MAX_PACKET:
                raise Refused("size", "That message is too large.")
            try:
                value = json.loads(text, parse_constant=lambda _: None)
            except (ValueError, RecursionError):
                raise Refused("json", "Invalid JSON.") from None
            if not isinstance(value, dict):
                raise Refused("shape", "Expected an object.")
            try:
                now = time.monotonic()
                if value == {"type": "ping"}:
                    await peer.send({"type": "pong"})
                elif value.get("type") == "pos":
                    position = validate_position(value, self.epoch)
                    if now - peer.last_position < 0.08:
                        continue
                    peer.last_position = now
                    if not await self.battle.move(peer, position):
                        continue
                    peer.position = position
                    await self.notice({"type": "pos", "pid": peer.pid, "name": peer.name,
                                       "epoch": value["epoch"], **position}, skip=peer)
                elif isinstance(value.get("type"), str) and value["type"] in COMMANDS:
                    await self.control.handle(peer, value)
                elif isinstance(value.get("type"), str) and value["type"] in BATTLE_COMMANDS:
                    await self.battle.handle(peer, value)
                else:
                    if now - peer.last_command < 0.10:
                        raise Refused("busy", "Wait a moment before the next shared action.")
                    peer.last_command = now
                    await self.command(peer, value)
            except Refused as error:
                await self.error(peer, error, value)

    async def endpoint(self, ws: WebSocket):
        await ws.accept()
        peer = Peer(ws, "", "", "")
        try:
            query = ws.query_params
            pid, token = query.get("pid", ""), query.get("token", "")
            if (query.get("room") != ROOM or not IDENTITY.fullmatch(pid)
                    or not 1 <= len(token) <= 80):
                raise Refused("access", "Use this world's separate Free Play login.")
            peer.pid, peer.token = pid, token
            peer.name = self.session(pid, token)
            text = await asyncio.wait_for(ws.receive_text(), timeout=10)
            if len(text) > 128:
                raise Refused("protocol", "Reconnect with the current Free Play client.")
            try:
                hello = json.loads(text)
            except (ValueError, RecursionError):
                hello = None
            if (hello != {"type": "hello", "protocol": PROTOCOL, "contentVersion": CONTENT_VERSION}
                    or type(hello["protocol"]) is not int or type(hello["contentVersion"]) is not int):
                raise Refused("protocol", "Reconnect with the current Free Play client.")
            async with self.lock:
                self.session(pid, token)
                previous = self.peers.get(pid)
                if previous:
                    await previous.close(4004)
                elif len(self.peers) >= MAX_PLAYERS:
                    raise Refused("full", "This world is full. Try again shortly.")
                self.peers[pid] = peer
                players = [{"pid": other.pid, "name": other.name, **other.position}
                           for other in self.peers.values() if other is not peer and other.position]
                if not await bounded_delivery(peer, lambda: send_snapshot(peer, self.store, players, self.control.pilots()), timeout=120):
                    return
                await self.battle.initial(peer)
                await self.notice({"type": "join", "pid": peer.pid, "name": peer.name}, skip=peer)
            await self.receive(peer)
        except Refused as error:
            await bounded_delivery(peer, lambda: self.error(peer, error))
            await peer.close(4003)
        except (WebSocketDisconnect, OSError, RuntimeError, asyncio.TimeoutError):
            # Normal disconnect; only committed SQLite changes are authoritative.
            await peer.close(1001)
        except Exception as error:
            log.error("freeplay_operation_failed", extra={"error_type": type(error).__name__})
            await peer.close(1011)
            raise
        finally:
            await self.control.disconnect(peer)
            if self.peers.get(peer.pid) is peer:
                self.peers.pop(peer.pid, None)
                await self.battle.disconnect(peer)
                await self.notice({"type": "leave", "pid": peer.pid})


def mount_freeplay(app, authenticate, banned, data, battlefield=None):
    hub = Hub(Store(data / "freeplay" / "world.sqlite3"), authenticate, banned, battlefield)
    app.add_api_websocket_route("/freeplay/ws", hub.endpoint)
    app.router.add_event_handler("startup", hub.battle.start)
    app.router.add_event_handler("shutdown", hub.battle.stop)
    return hub
