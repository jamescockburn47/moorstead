import unittest
from geography_noise import Geography

class TestGeography(unittest.TestCase):
    def test_height_points(self):
        geo = Geography("t-shared-moor")
        points = [
            (0, 0, 29),
            (-87, 50, 35),
            (473, -47, 30),
            (-232, 406, 30),
            (845, 140, 37),
            (540, 860, 32),
            (652, -104, 30),
            (892, 2, 28),
            (100, 100, 29),
            (-500, 300, 38)
        ]
        for x, z, expected in points:
            with self.subTest(x=x, z=z):
                self.assertEqual(geo.height(x, z), expected)

if __name__ == "__main__":
    unittest.main()
