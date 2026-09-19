import asyncio
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from fixture import fixture_app
from freeplay_rules import ROOM
from freeplay_stream import Peer


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.app = fixture_app(self.directory.name)
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)
        self.henry = self.login("henry-test-only")
        self.james = self.login("james-test-only")
        self.serial = 0

    def login(self, code):
        return self.client.post("/auth/freeplay-claim", json={"code": code}).json()

    def socket(self, login, room=ROOM, token=None, pid=None):
        return self.client.websocket_connect(
            f"/freeplay/ws?room={room}&pid={pid or 'a' + login['acct']}&token={token or login['token']}")

    def collect(self, ws, terminal):
        frames = []
        while True:
            frame = ws.receive_json()
            frames.append(frame)
            if frame["type"] == terminal:
                return frames

    def start(self, ws):
        ws.send_json({"type": "hello", "protocol": 1, "contentVersion": 2})
        return self.collect(ws, "ready")

    def command(self, kind="edit", **fields):
        self.serial += 1
        state = self.app.state.freeplay_hub.store.state()
        return {"type": kind, "epoch": state["epoch"], "baseRevision": state["revision"],
                "requestId": f"socket-{self.serial:04}", **fields}

    def test_room_and_identity_are_not_client_authority(self):
        for args in ({"room": "moor"}, {"room": "verify-freeplay"},
                     {"pid": "anot-the-account"}, {"token": "invalid-token"}):
            with self.subTest(args=args), self.socket(self.henry, **args) as ws:
                self.assertEqual(ws.receive_json()["code"], "access")
        sessions = self.app.state.sessions
        sessions[self.henry["token"]]["room"] = "moor"
        with self.socket(self.henry) as ws:
            self.assertEqual(ws.receive_json()["code"], "access")
        self.assertEqual(self.app.state.freeplay_hub.store.state()["revision"], 0)

    def test_content_negotiation_refuses_legacy_before_snapshot_or_mutation(self):
        invalid = [{"type": "hello", "protocol": 1},
                   {"type": "hello", "protocol": 1, "contentVersion": 1},
                   {"type": "hello", "protocol": 1, "contentVersion": 3},
                   {"type": "hello", "protocol": True, "contentVersion": 2},
                   {"type": "hello", "protocol": 1, "contentVersion": 2.0}]
        for hello in invalid:
            with self.subTest(hello=hello), self.socket(self.henry) as ws:
                ws.send_json(hello)
                self.assertEqual(ws.receive_json()["code"], "protocol")
                with self.assertRaises(WebSocketDisconnect):
                    ws.receive_json()
        self.assertEqual(self.app.state.freeplay_hub.store.state()["revision"], 0)

    def test_two_players_build_then_gravity_share_committed_metadata(self):
        with self.socket(self.henry) as henry, self.socket(self.james) as james:
            init = self.start(henry)[0]
            self.assertEqual((init["contentVersion"], init["minContentVersion"]), (2, 2))
            self.assertEqual(init["limits"]["maxBuild"], 1024)
            self.assertEqual((init["limits"]["maxCells"], init["limits"]["maxChunks"]), (2_000_000, 1024))
            self.start(james)
            henry.send_json(self.command("build", shape="base", origin=[0, 10, 0], rotation=1, block=200))
            first = self.collect(henry, "commit")
            second = self.collect(james, "commit")
            first = [frame for frame in first if frame["type"] != "join"]
            self.assertEqual(first, second)
            self.assertEqual(first[0]["shape"], "base")
            self.assertEqual(first[0]["count"], 125)
            self.assertTrue(any(cell[3] >= 200 for frame in first if frame["type"] == "delta"
                                for cell in frame["edits"]))
            gravity = self.command("weapon", weapon="gravity", center=[2, 12, 2])
            james.send_json(gravity)
            pulse = self.collect(henry, "commit")
            self.assertEqual(pulse, self.collect(james, "commit"))
            self.assertEqual([frame["type"] for frame in pulse], ["begin", "commit"])
            self.assertEqual((pulse[0]["kind"], pulse[0]["weapon"], pulse[0]["count"]), ("weapon", "gravity", 0))
            self.assertEqual(pulse[-1]["history"], first[-1]["history"])
            time.sleep(0.11)
            james.send_json(gravity)
            self.assertTrue(james.receive_json()["duplicate"])
            henry.send_json({"type": "ping"})
            self.assertEqual(henry.receive_json(), {"type": "pong"})

    def test_two_players_real_atom_batched_reconnect_undo(self):
        with self.socket(self.henry) as henry, self.socket(self.james) as james:
            init = self.start(henry)[0]
            self.assertTrue(init["freeplay"])
            self.assertEqual(init["room"], ROOM)
            self.start(james)
            command = self.command("blast", bomb="atom", center=[0, 30, 0])
            henry.send_json(command)
            first, second = self.collect(henry, "commit"), self.collect(james, "commit")
            cells = lambda frames: [cell for frame in frames if frame["type"] == "delta" for cell in frame["edits"]]
            one, two = cells(first), cells(second)
            self.assertEqual(one, two)
            self.assertGreater(len(one), 200000)
            self.assertTrue(all(len(frame["edits"]) <= 512 for frame in first if frame["type"] == "delta"))
            self.assertTrue(all(len(json.dumps(frame)) < 24000 for frame in first))
            james.send_json(self.command("undo"))
            undo = cells(self.collect(henry, "commit"))
            self.collect(james, "commit")
            self.assertEqual(len(undo), len(one))
            self.assertTrue(all(cell[3] is None for cell in undo))
        with self.socket(self.henry) as henry:
            snapshot = self.start(henry)
            self.assertEqual(snapshot[0]["revision"], 2)
            self.assertEqual(snapshot[0]["count"], 0)

    def test_concurrent_stale_action_cannot_overwrite(self):
        with self.socket(self.henry) as henry, self.socket(self.james) as james:
            self.start(henry)
            self.start(james)
            a = self.command(edits=[[0, 20, 0, 8]])
            b = self.command(edits=[[0, 20, 0, 4]])
            henry.send_json(a)
            james.send_json(b)
            frames_h = self.collect(henry, "commit")
            frames_j = self.collect(james, "commit")
            winner = next(frame["actor"] for frame in frames_h if frame["type"] == "begin")
            loser = james if winner == "Henry" else henry
            frames_loser = frames_j if winner == "Henry" else frames_h
            errors = [frame for frame in frames_loser if frame["type"] == "error"]
            error = errors[0] if errors else loser.receive_json()
            self.assertEqual(error["code"], "stale")
            self.assertEqual(self.app.state.freeplay_hub.store.state()["revision"], 1)

    def test_reset_rehomes_and_rejects_delayed_positions(self):
        with self.socket(self.henry) as henry:
            self.start(henry)
            henry.send_json({"type": "pos", "epoch": 1, "x": 0, "y": 70, "z": 0, "yaw": 0})
            henry.send_json(self.command(edits=[[1, 20, 1, 8]]))
            self.collect(henry, "commit")
            time.sleep(0.11)
            henry.send_json(self.command("reset", confirm=True))
            frames = self.collect(henry, "commit")
            begin = next(frame for frame in frames if frame["type"] == "begin")
            self.assertTrue(begin["replace"])
            self.assertEqual(begin["epoch"], 2)
            self.assertIsNone(self.app.state.freeplay_hub.peers["a" + self.henry["acct"]].position)
            henry.send_json({"type": "pos", "epoch": 1, "x": 0, "y": 70, "z": 0, "yaw": 0})
            self.assertEqual(henry.receive_json()["code"], "position")

    def test_token_revocation_is_checked_while_idle(self):
        with self.socket(self.henry) as henry:
            self.start(henry)
            self.app.state.sessions.pop(self.henry["token"])
            error = henry.receive_json()
            self.assertEqual(error["code"], "access")

    def test_new_device_replaces_old_with_terminal_close(self):
        with self.socket(self.henry) as old:
            self.start(old)
            with self.socket(self.henry) as new:
                self.start(new)
                with self.assertRaises(WebSocketDisconnect) as closed:
                    old.receive_json()
                self.assertEqual(closed.exception.code, 4004)
                new.send_json({"type": "ping"})
                self.assertEqual(new.receive_json(), {"type": "pong"})

    def test_failed_delivery_still_announces_leave(self):
        async def broken_send(value):
            raise OSError("Simulated disconnected transport")

        with self.socket(self.henry) as henry, self.socket(self.james) as james:
            self.start(henry)
            self.start(james)
            self.app.state.freeplay_hub.peers["a" + self.henry["acct"]].ws.send_text = broken_send
            james.send_json({"type": "pos", "epoch": 1, "x": 0, "y": 70, "z": 0, "yaw": 0})
            # Simulate the closing peer's receive side completing, as a real browser does.
            henry.close()
            frames = self.collect(james, "leave")
            self.assertEqual(frames[-1]["pid"], "a" + self.henry["acct"])

    def test_failed_notice_defers_removal_to_endpoint_cleanup(self):
        class FailedSocket:
            closed = False

            def __init__(self, exception):
                self.exception = exception

            async def send_text(self, value):
                raise self.exception

            async def close(self, code):
                self.closed = True

        hub = self.app.state.freeplay_hub
        for exception in (OSError("simulated failure"), WebSocketDisconnect(1006)):
            socket = FailedSocket(exception)
            peer = Peer(socket, "atest", "Test", "synthetic")
            hub.peers[peer.pid] = peer
            asyncio.run(hub.notice({"type": "test"}))
            self.assertTrue(socket.closed)
            self.assertIs(hub.peers[peer.pid], peer)
        # The endpoint's finally block can now remove it and broadcast leave.

    def test_oversized_and_forged_payload_refused_ping_works(self):
        with self.socket(self.henry) as henry:
            self.start(henry)
            henry.send_json({"type": "ping"})
            self.assertEqual(henry.receive_json(), {"type": "pong"})
            henry.send_json(self.command("blast", bomb="atom", center=[0, 30, 0], radius=9999))
            self.assertEqual(henry.receive_json()["code"], "shape")
            henry.send_text(" " * 16385)
            self.assertEqual(henry.receive_json()["code"], "size")
            self.assertEqual(self.app.state.freeplay_hub.store.state()["revision"], 0)


if __name__ == "__main__":
    unittest.main()
