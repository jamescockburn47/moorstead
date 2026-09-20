import time
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "worldsvc"))
from freeplay_store import Store
import test_service as original


class VehicleServiceTests(unittest.TestCase):
    setUp = original.ServiceTests.setUp
    login = original.ServiceTests.login
    socket = original.ServiceTests.socket
    collect = original.ServiceTests.collect
    start = original.ServiceTests.start
    command = original.ServiceTests.command

    def seed_vehicle(self):
        self.hub = self.app.state.freeplay_hub
        self.hub.store.apply("aseed", self.command(edits=[[0, 10, 0, 206], [1, 10, 0, 200]]))
        self.hub.store.apply("aseed", self.command("vehicle-convert", core=[0, 10, 0],
                                                  **{"from": [0, 10, 0], "to": [2, 11, 2]}, mode="car"))
        self.vehicle = self.hub.store.vehicles()[0]

    def control(self, kind, **fields):
        return {"type": "vehicle-" + kind, "epoch": self.hub.epoch, "vehicleId": self.vehicle["id"], **fields}

    def test_two_player_exclusive_pilot_bounded_drive_and_final_park_flush(self):
        self.seed_vehicle()
        revision = self.hub.store.state()["revision"]
        with self.socket(self.henry) as henry, self.socket(self.james) as james:
            frames = self.start(henry)
            self.assertEqual(frames[0]["vehicleCount"], 1)
            self.assertEqual(sum(frame["type"] == "vehicle-snapshot" for frame in frames), 1)
            self.start(james)
            henry.send_json(self.control("claim"))
            lease = self.collect(henry, "vehicle-lease")[-1]
            self.assertEqual(lease, self.collect(james, "vehicle-lease")[-1])
            james.send_json(self.control("claim"))
            error = james.receive_json()
            self.assertEqual((error["code"], error["command"]), ("vehicle-pilot", "vehicle-claim"))
            self.assertNotIn("requestId", error)
            james.send_json(self.control("drive", lease=lease["lease"], seq=1,
                                          pose={"x": 1, "y": 10, "z": 0, "yaw": 0}))
            self.assertEqual(james.receive_json()["code"], "vehicle-lease")
            self.hub.control.leases[self.vehicle["id"]]["saved"] -= 0.5
            henry.send_json(self.control("drive", lease=lease["lease"], seq=1,
                                         pose={"x": 2, "y": 10, "z": 0, "yaw": 0.2}))
            self.assertEqual(self.collect(henry, "vehicle-pos")[-1], self.collect(james, "vehicle-pos")[-1])
            henry.send_json(self.control("release", lease=lease["lease"], seq=2,
                                         pose={"x": 2.2, "y": 10, "z": 0, "yaw": 0.2}))
            parked = self.collect(henry, "vehicle-lease")[-1]
            self.collect(james, "vehicle-lease")
            self.assertIsNone(parked["pilot"])
            self.assertEqual(parked["pose"]["x"], 2.2)
            self.assertEqual(self.hub.store.state()["revision"], revision)
            self.assertEqual(Store(self.hub.store.path).vehicles()[0]["pose"], parked["pose"])
            james.send_json(self.control("claim"))
            new_lease = self.collect(james, "vehicle-lease")[-1]
            self.collect(henry, "vehicle-lease")
            self.assertNotEqual(new_lease["lease"], lease["lease"])
            self.assertEqual(new_lease["pilot"], "a" + self.james["acct"])

    def test_piloted_edit_refused_reset_releases_lease_and_old_drive(self):
        self.seed_vehicle()
        with self.socket(self.henry) as henry, self.socket(self.james) as james:
            self.start(henry)
            self.start(james)
            henry.send_json(self.control("claim"))
            lease = self.collect(henry, "vehicle-lease")[-1]
            henry.send_json(self.command("vehicle-edit", vehicleId=self.vehicle["id"]))
            self.assertEqual(henry.receive_json()["code"], "vehicle-pilot")
            time.sleep(0.11)
            henry.send_json(self.command("reset", confirm=True))
            self.collect(henry, "reset-vote")
            self.collect(james, "reset-vote")
            james.send_json(self.command("reset", confirm=True))
            frames = self.collect(henry, "commit")
            self.assertEqual(frames[0]["vehicleCount"], 0)
            self.assertEqual(self.hub.control.leases, {})
            henry.send_json(dict(self.control("drive", lease=lease["lease"], seq=1,
                                             pose={"x": 1, "y": 10, "z": 0, "yaw": 0}), epoch=1))
            self.assertEqual(henry.receive_json()["code"], "stale")

    def test_disconnect_releases_pilot_and_leaves_saved_pose(self):
        self.seed_vehicle()
        with self.socket(self.james) as james:
            self.start(james)
            with self.socket(self.henry) as henry:
                self.start(henry)
                henry.send_json(self.control("claim"))
                self.collect(henry, "vehicle-lease")
                self.collect(james, "vehicle-lease")
                henry.close()
                frames = self.collect(james, "leave")
            self.assertTrue(any(frame["type"] == "vehicle-lease" and frame["pilot"] is None for frame in frames))
            self.assertEqual(self.hub.control.leases, {})
            james.send_json(self.control("claim"))
            self.assertEqual(self.collect(james, "vehicle-lease")[-1]["pilot"], "a" + self.james["acct"])

    def test_sheep_is_shared_zero_terrain_event_machinegun_rate_is_server_owned(self):
        with self.socket(self.henry) as henry:
            self.start(henry)
            sheep = self.command("weapon", weapon="sheep", center=[0, 10, 0], origin=[0, 20, 0])
            henry.send_json(sheep)
            frames = self.collect(henry, "commit")
            self.assertEqual(frames[0]["origin"], [0, 20, 0])
            self.assertEqual(frames[0]["count"], 0)
            self.assertEqual(frames[-1]["history"], [])
            time.sleep(0.11)
            henry.send_json(self.command("weapon", weapon="machinegun", center=[0, 10, 0]))
            frames = self.collect(henry, "commit")
            self.assertEqual(frames[0]["count"], 7)
            revision = frames[-1]["revision"]
            time.sleep(0.11)
            henry.send_json(self.command("weapon", weapon="machinegun", center=[1, 10, 0]))
            self.assertEqual(henry.receive_json()["code"], "weapon-rate")
            self.assertEqual(self.app.state.freeplay_hub.store.state()["revision"], revision)


if __name__ == "__main__":
    unittest.main()
