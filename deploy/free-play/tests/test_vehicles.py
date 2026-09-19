import math
import unittest
from pathlib import Path
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "worldsvc"))
from freeplay_rules import Refused
from freeplay_store import Store
from freeplay_vehicles import snapped_cells, validate_pose
import test_store as original


class VehicleTests(unittest.TestCase):
    setUp = original.StoreTests.setUp
    command = original.StoreTests.command
    apply = original.StoreTests.apply
    cells = original.StoreTests.cells

    def convert(self, **fields):
        defaults = {"core": [0, 10, 0], "from": [0, 10, 0], "to": [3, 12, 3], "mode": "car"}
        return self.apply("vehicle-convert", **(defaults | fields))

    def seed(self):
        self.apply(edits=[[0, 10, 0, 206], [1, 10, 0, 200], [1, 11, 0, 8], [3, 10, 3, 0]])

    def assert_counts(self):
        with self.store.connect() as db:
            self.assertEqual(self.store.state()["count"], db.execute("SELECT COUNT(*) FROM cells").fetchone()[0])
            expected = [tuple(row) for row in db.execute("SELECT x >> 4,z >> 4,COUNT(*) FROM cells GROUP BY x >> 4,z >> 4")]
            actual = [tuple(row) for row in db.execute("SELECT * FROM chunk_counts ORDER BY x,z")]
            self.assertEqual(actual, expected)

    def test_convert_only_authored_solids_reopen_undo_and_no_duplication(self):
        self.seed()
        original_cells = self.cells()
        result = self.convert()
        vehicle = self.store.vehicles()[0]
        self.assertEqual(vehicle["core"], [0, 0, 0])
        self.assertEqual(vehicle["cells"], [[0, 0, 0, 206], [1, 0, 0, 200], [1, 1, 0, 8]])
        self.assertEqual(result["changes"], [[0, 10, 0, 0], [1, 10, 0, 0], [1, 11, 0, 0]])
        self.assertEqual(len(self.cells()), len(original_cells))  # No natural blocks selected.
        self.store = Store(self.path)
        self.assertEqual(self.store.vehicles(), [vehicle])
        self.apply("undo")
        self.assertEqual(self.cells(), original_cells)
        self.assertEqual(self.store.vehicles(), [])
        self.assert_counts()

    def test_materialise_rotation_undo_restores_exact_vehicle_and_target(self):
        self.seed()
        self.convert()
        vehicle = self.store.vehicles()[0]
        vehicle = self.store.move_vehicle(vehicle["id"], {"x": 20.4, "y": 10, "z": -0.6, "yaw": math.pi / 2})
        before = self.cells()
        expected = snapped_cells(vehicle)
        self.assertEqual(expected, [[20, 10, -1, 206], [20, 10, 0, 200], [20, 11, 0, 8]])
        result = self.apply("vehicle-edit", vehicleId=vehicle["id"])
        self.assertEqual(result["changes"], expected)
        self.assertEqual(self.store.vehicles(), [])
        self.apply("undo")
        self.assertEqual(self.store.vehicles(), [vehicle])
        self.assertEqual(self.cells(), before)
        self.assert_counts()

    def test_collision_or_capacity_refusal_preserves_vehicle_and_all_cells(self):
        self.seed()
        self.convert()
        vehicle = self.store.vehicles()[0]
        self.store.move_vehicle(vehicle["id"], {"x": 20, "y": 10, "z": 0, "yaw": 0})
        self.apply(edits=[[20, 10, 0, 8]])
        before = self.store.state(), self.cells(), self.store.vehicles()
        with self.assertRaises(Refused):
            self.apply("vehicle-edit", vehicleId=vehicle["id"])
        self.assertEqual((self.store.state(), self.cells(), self.store.vehicles()), before)
        self.apply("undo")
        before = self.store.state(), self.cells(), self.store.vehicles()
        with patch("freeplay_store.MAX_CELLS", len(self.cells())), self.assertRaises(Refused):
            self.apply("vehicle-edit", vehicleId=vehicle["id"])
        self.assertEqual((self.store.state(), self.cells(), self.store.vehicles()), before)
        self.assert_counts()

    def test_reset_restore_preserves_parked_pose_and_old_cell_history(self):
        self.seed()
        self.convert(mode="plane")
        vehicle = self.store.vehicles()[0]
        vehicle = self.store.move_vehicle(vehicle["id"], {"x": 30, "y": 70, "z": 0, "yaw": 0.3})
        before = self.cells()
        self.apply("reset", confirm=True)
        self.assertEqual(self.store.vehicles(), [])
        self.assertEqual(self.cells(), [])
        self.store = Store(self.path)
        self.apply("restore", confirm=True)
        self.assertEqual(self.store.vehicles(), [vehicle])
        self.assertEqual(self.cells(), before)
        self.assert_counts()

    def test_selection_limits_control_and_vehicle_count_fail_atomically(self):
        self.seed()
        for fields in ({"to": [16, 12, 3]}, {"to": [3, 22, 3]}, {"core": [1, 10, 0]}, {"mode": "rocket"}):
            before = self.cells(), self.store.state()
            with self.subTest(fields=fields), self.assertRaises(Refused):
                self.convert(**fields)
            self.assertEqual((self.cells(), self.store.state()), before)
        with patch("freeplay_vehicles.MAX_VEHICLES", 0), self.assertRaises(Refused):
            self.convert()
        self.apply(edits=[[2, 10, 0, 206]])
        with self.assertRaises(Refused):
            self.convert()

    def test_drive_validation_speed_bounds_nan_and_negative_snap(self):
        self.seed()
        self.convert(mode="submarine")
        vehicle = self.store.vehicles()[0]
        previous = vehicle["pose"]
        accepted = {"x": 2, "y": 11.5, "z": 0, "yaw": 0.4}
        self.assertEqual(validate_pose(accepted, vehicle, previous, 0.25), accepted)
        for pose in (dict(accepted, x=100), dict(accepted, yaw=math.inf), dict(accepted, x=True),
                     dict(accepted, y=0), dict(accepted, y=180), dict(accepted, yaw=3)):
            with self.subTest(pose=pose), self.assertRaises(Refused):
                validate_pose(pose, vehicle, previous, 0.25)
        vehicle["pose"] = {"x": -0.5, "y": 10.5, "z": -1.5, "yaw": -math.pi / 2}
        self.assertEqual(snapped_cells(vehicle)[0], [0, 11, -1, 206])


if __name__ == "__main__":
    unittest.main()
