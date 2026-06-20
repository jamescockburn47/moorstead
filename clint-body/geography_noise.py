import math
import ctypes
import json
import pathlib

def unsigned_right_shift(val, n):
    return (val & 0xFFFFFFFF) >> n

def imul(a, b):
    return ctypes.c_int32((a & 0xFFFFFFFF) * (b & 0xFFFFFFFF)).value

def strSeed(s):
    h = 2166136261
    for char in s:
        h ^= ord(char)
        h = imul(h, 16777619)
    return unsigned_right_shift(h, 0)

def hash3i(x, y, z, seed=0):
    hx = imul(int(x), 374761393)
    hy = imul(int(y), 668265263)
    hz = imul(int(z), 2246822519)
    h = seed ^ hx ^ hy ^ hz
    h = imul(h ^ unsigned_right_shift(h, 13), 1274126177)
    return unsigned_right_shift(h ^ unsigned_right_shift(h, 16), 0) / 4294967296.0

def hash2i(x, z, seed=0):
    return hash3i(x, 0, z, seed)

def smooth(t):
    return t * t * (3.0 - 2.0 * t)

def smoothstep(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)

def lerp(a, b, t):
    return a + (b - a) * t

def noise2(x, z, seed=0):
    xi = math.floor(x)
    zi = math.floor(z)
    xf = x - xi
    zf = z - zi
    u = smooth(xf)
    v = smooth(zf)
    a = hash2i(xi, zi, seed)
    b = hash2i(xi + 1, zi, seed)
    c = hash2i(xi, zi + 1, seed)
    d = hash2i(xi + 1, zi + 1, seed)
    return lerp(lerp(a, b, u), lerp(c, d, u), v) * 2.0 - 1.0

def fbm2(x, z, octaves, seed=0):
    amp = 1.0
    freq = 1.0
    val_sum = 0.0
    norm = 0.0
    for i in range(octaves):
        val_sum += noise2(x * freq, z * freq, seed + i * 1013) * amp
        norm += amp
        amp *= 0.5
        freq *= 2.0
    return val_sum / norm

class Geography:
    def __init__(self, seed_str="t-shared-moor", world_data=None):
        self.seed = strSeed(seed_str)
        self.col_cache = {}
        
        if world_data is None:
            try:
                world_path = pathlib.Path(__file__).parent / "merlin-world.json"
                with open(world_path, encoding="utf-8") as f:
                    world_data = json.load(f)
            except Exception:
                world_data = {}
        
        village_info = {
            "Moorstead": {"radius": 52},
            "Goathland": {"radius": 40},
            "Rosedale Abbey": {"radius": 36},
            "Staithes": {"radius": 30},
            "Pickering": {"radius": 56},
            "Grosmont": {"radius": 26},
            "Whitby": {"radius": 44},
        }
        
        self.villages = []
        for p in world_data.get("places", []):
            if p.get("kind") == "village":
                name = p["name"]
                vx = p["x"]
                vz = p["z"]
                r = village_info.get(name, {}).get("radius", 30)
                g = max(math.floor(self.heightRaw(vx, vz)), 26 + 2)
                self.villages.append({
                    "x": vx,
                    "z": vz,
                    "ground": g,
                    "name": name,
                    "radius": r
                })

    def bogginess(self, x, z):
        return fbm2(x * 0.007 + 503.7, z * 0.007 + 211.3, 3, self.seed ^ 0xb09)

    def heatheriness(self, x, z):
        return fbm2(x * 0.012 + 91.2, z * 0.012 + 37.8, 2, self.seed ^ 0x4ea)

    def daleness(self, x, z):
        dn = fbm2(x * 0.0036 + 811.1, z * 0.0036 + 413.9, 3, self.seed ^ 0xda1e)
        return max(0.0, 1.0 - abs(dn) * 3.4)

    def coastX(self, z):
        bay = math.exp(-(((z - 340.0) / 130.0) ** 2.0)) * -70.0
        return 900.0 + bay + fbm2(z * 0.004, 7.7, 2, self.seed ^ 0xc0a57) * 45.0

    def coastT(self, x, z):
        cx = self.coastX(z)
        return smoothstep((x - (cx - 6.0)) / 64.0)

    def heightRaw(self, x, z):
        h = 37.0 + fbm2(x * 0.0045, z * 0.0045, 4, self.seed) * 4.5
        dale = self.daleness(x, z)
        h -= dale * dale * 12.0
        h += fbm2(x * 0.03 + 99.3, z * 0.03 + 17.1, 3, self.seed ^ 0x517) * 2.5
        bog = self.bogginess(x, z)
        if bog > 0.45 and h > 33.0:
            h = lerp(h, 34.2, min(1.0, (bog - 0.45) * 5.0))

        # Roseberry Topping
        dx = x - (-700.0)
        dz = z - (-880.0)
        r_roseberry = math.hypot(dx, dz)
        if r_roseberry < 32.0:
            cone = 56.0 - (r_roseberry / 32.0) * 24.0 + fbm2(x * 0.08, z * 0.08, 2, self.seed ^ 0x405e) * 1.5
            step = 2.0 if (r_roseberry < 7.0 and dx < 0.0) else 0.0
            h = max(h, cone + step)

        # Hole of Horcum
        r_horcum = math.hypot(x - 540.0, z - 680.0)
        if r_horcum < 48.0:
            bowl = 28.0 + (r_horcum / 48.0) ** 1.6 * 11.0
            h = min(h, bowl)
        elif r_horcum < 48.0 + 7.0:
            h += (1.0 - (r_horcum - 48.0) / 7.0) * 2.5

        # Coast
        t = self.coastT(x, z)
        if t > 0.0:
            if t < 0.4:
                h = lerp(h, 25.3, smoothstep(t / 0.4))
            else:
                sea = 17.0 + fbm2(x * 0.02, z * 0.02, 2, self.seed ^ 0x5ea) * 1.5
                h = lerp(25.3, sea, ((t - 0.4) / 0.6) ** 2.2)

        return max(5.0, min(64.0 - 6.0, h))

    def height(self, x, z):
        key = (int(x), int(z))
        if key in self.col_cache:
            return self.col_cache[key]
        
        h = self.heightRaw(x, z)
        for v in self.villages:
            d = math.hypot(x - v["x"], z - v["z"])
            if d < v["radius"]:
                t = 1.0 - smoothstep((d - (v["radius"] - 18.0)) / 18.0)
                h = lerp(h, v["ground"], t)
                break
        
        h_val = math.floor(h)
        if len(self.col_cache) > 80000:
            self.col_cache.clear()
        self.col_cache[key] = h_val
        return h_val
