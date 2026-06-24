#!/usr/bin/env python3
"""Build data/moors-data.json from OS OpenData (OGL), all keyless downloads:
  - OS Terrain 50  (.asc tiles)      -> real elevation grid
  - OS Open Names  (.csv per tile)   -> real town + station positions
  - OS Open Rivers (.gpkg)           -> the River Esk (+ majors) as polylines

Source files are extracted to ~/moors-data-build/work/ by the PowerShell step.
The code (src/moorsgeo.js + deploy/world/geography_moors.py) consumes the schema
unchanged — this just swaps the fixture for real data. Re-run npm run verify after.

Attribution: Contains OS data (c) Crown copyright and database right 2026.
"""
import csv, glob, json, math, sqlite3, struct, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
WORK = Path.home() / "moors-data-build" / "work"
OUT = REPO / "data" / "moors-data.json"

# --- world bounds (OSGB metres) + block transform (matches src/geo-grid.js) ---
MIN_E, MIN_N, MAX_E, MAX_N = 444000, 484000, 500000, 521000
MPB = 15
STEP = 200  # output elevation-grid resolution in metres (downsampled from 50 m)

def to_block(E, N):
    # The engine's map convention is +x = NORTH (up), +z = EAST (right) — see ui.js
    # buildBigMap. Match it so the real Moors render the right way up.
    return round((N - MIN_N) / MPB), round((E - MIN_E) / MPB)

def in_bounds(E, N):
    return MIN_E <= E <= MAX_E and MIN_N <= N <= MAX_N

# ---------------------------------------------------------------- elevation
def parse_asc(path):
    """Yield (E, N, metres) cell-centres from an OS Terrain 50 Arc/ASCII grid."""
    hdr, data_start, lines = {}, 0, path.read_text().splitlines()
    for i, ln in enumerate(lines):
        p = ln.split()
        if len(p) == 2 and not p[0][0].isdigit() and p[0][0] != '-':
            hdr[p[0].lower()] = float(p[1])
        else:
            data_start = i
            break
    ncols, nrows = int(hdr["ncols"]), int(hdr["nrows"])
    xll, yll, cs = hdr["xllcorner"], hdr["yllcorner"], hdr["cellsize"]
    nodata = hdr.get("nodata_value", -9999)
    r = 0
    for ln in lines[data_start:]:
        vals = ln.split()
        if len(vals) != ncols:
            continue
        N = yll + (nrows - 1 - r) * cs + cs / 2
        for c, v in enumerate(vals):
            fv = float(v)
            if fv != nodata:
                yield (xll + c * cs + cs / 2, N, fv)
        r += 1

def build_elevation():
    cols = round((MAX_E - MIN_E) / STEP) + 1
    rows = round((MAX_N - MIN_N) / STEP) + 1
    ssum = [[0.0] * cols for _ in range(rows)]   # row 0 = north
    scnt = [[0] * cols for _ in range(rows)]
    for asc in sorted((WORK / "tiles").glob("*.asc")):
        for E, N, m in parse_asc(asc):
            if not in_bounds(E, N):
                continue
            c = round((E - MIN_E) / STEP)
            r = round((MAX_N - N) / STEP)
            if 0 <= c < cols and 0 <= r < rows:
                ssum[r][c] += m; scnt[r][c] += 1
    # MEAN of the 50 m posts in each cell — smoother than nearest-post, far fewer specks
    acc = [[(ssum[r][c] / scnt[r][c]) if scnt[r][c] else None for c in range(cols)] for r in range(rows)]
    # Flood-fill the sea from the map edges: a cell is sea if it is <= 1 m (or has no
    # Terrain 50 data) AND connects to the edge through other such cells. Terrain 50
    # gives the open sea as a flat ~0 m sheet, so a height test alone can't tell sea
    # from low coastal land; connectivity can. Inland low spots stay land. Sea cells
    # get a deep sentinel so they read clearly sub-waterline (proper deep water + a
    # real shoreline, not a sheet sitting exactly at the waterline).
    from collections import deque
    cand = lambda r, c: acc[r][c] is None or acc[r][c] <= 2.0
    sea = [[False] * cols for _ in range(rows)]
    dq = deque()
    for r in range(rows):
        for c in (0, cols - 1):
            if cand(r, c) and not sea[r][c]: sea[r][c] = True; dq.append((r, c))
    for c in range(cols):
        for r in (0, rows - 1):
            if cand(r, c) and not sea[r][c]: sea[r][c] = True; dq.append((r, c))
    while dq:
        r, c = dq.popleft()
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < rows and 0 <= nc < cols and not sea[nr][nc] and cand(nr, nc):
                sea[nr][nc] = True; dq.append((nr, nc))
    # de-speckle: absorb tiny land specks adrift in the sea (>= 3 of 4 neighbours sea)
    for _ in range(2):
        for r in range(rows):
            for c in range(cols):
                if not sea[r][c] and sum(
                        1 for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1))
                        if 0 <= r + dr < rows and 0 <= c + dc < cols and sea[r + dr][c + dc]) >= 3:
                    sea[r][c] = True
    # fill inland data gaps by neighbour averaging, so a missing-tile cell is never a lake
    for _ in range(4):
        for r in range(rows):
            for c in range(cols):
                if acc[r][c] is None and not sea[r][c]:
                    vals = [acc[r + dr][c + dc] for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1))
                            if 0 <= r + dr < rows and 0 <= c + dc < cols and acc[r + dr][c + dc] is not None]
                    if vals: acc[r][c] = sum(vals) / len(vals)
    flat = []
    for r in range(rows):
        for c in range(cols):
            if sea[r][c]:
                flat.append(-120)                       # connected open sea
            elif acc[r][c] is None:
                flat.append(0)                          # truly enclosed gap (rare)
            else:
                flat.append(max(0, round(acc[r][c])))   # clamp land >= 0 m -> nothing inland floods
    print(f"sea cells: {sum(row.count(True) for row in sea)}")
    return {"cols": cols, "rows": rows, "metres": flat}, acc

# ---------------------------------------------------------------- coast
def build_coast(acc):
    """Coastline = easternmost land cell per row that has sea to its east (in bounds)."""
    rows, cols = len(acc), len(acc[0])
    pts = []
    for r in range(rows):
        land_c = None
        for c in range(cols - 1, -1, -1):
            v = acc[r][c]
            if v is not None and v > 3:        # land
                # require sea (<=1 m) somewhere east of it, within bounds
                if any((acc[r][cc] is None or acc[r][cc] <= 1) for cc in range(c + 1, cols)):
                    land_c = c
                break
        if land_c is not None and land_c < cols - 1:
            E = MIN_E + land_c * STEP
            N = MAX_N - r * STEP
            x, z = to_block(E, N)
            pts.append([x, z])
    pts.sort(key=lambda p: p[1])   # order north -> south
    return pts

# ---------------------------------------------------------------- open names
TIER1 = {"whitby", "pickering", "grosmont"}
TIER2 = {"goathland", "staithes", "robin hood's bay", "castleton", "danby",
         "lealholm", "glaisdale", "egton", "helmsley", "kirkbymoorside",
         "osmotherley", "great ayton", "guisborough", "rosedale abbey",
         "hutton-le-hole", "levisham", "sleights", "ruswarp", "sandsend",
         "ravenscar", "goathland"}
WANT = TIER1 | TIER2
SETTLEMENT = {"city", "town", "village", "hamlet"}

def build_towns():
    found = {}
    for f in glob.glob(str(WORK / "on_*.csv")):
        with open(f, encoding="utf-8") as fh:
            for row in csv.reader(fh):
                if len(row) < 10:
                    continue
                name, ltype = row[2], row[7].lower()
                key = name.lower()
                if key in WANT and ltype in SETTLEMENT:
                    try:
                        E, N = float(row[8]), float(row[9])
                    except ValueError:
                        continue
                    if not in_bounds(E, N):
                        continue
                    # prefer a higher-rank settlement type if duplicated
                    rank = ["hamlet", "village", "town", "city"].index(ltype) if ltype in ["hamlet","village","town","city"] else 0
                    if key not in found or rank > found[key][2]:
                        x, z = to_block(E, N)
                        found[key] = (name, (x, z), rank)
    towns = []
    for key, (name, (x, z), _rank) in sorted(found.items()):
        tier = 1 if key in TIER1 else 2
        towns.append({"name": name, "x": x, "z": z, "tier": tier})
    return towns, found

# moors line (Pickering -> Whitby), c.1900 surviving stations, sited at their town
MOORS_LINE = [("Pickering", True), ("Levisham", True), ("Goathland", True),
              ("Grosmont", True), ("Sleights", False), ("Whitby", True)]

def build_stations(found):
    stations = []
    for name, loop in MOORS_LINE:
        key = name.lower()
        if key in found:
            (_n, (x, z), _r) = found[key]
            stations.append({"name": name, "x": x, "z": z, "line": "moors", "hasLoop": loop})
    return stations

# ---------------------------------------------------------------- rivers
def parse_gpkg_linestring(blob):
    if blob[:2] != b"GP":
        return []
    flags = blob[3]
    env = (flags >> 1) & 0x07
    hdr = 8 + {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}.get(env, 0)
    wkb = blob[hdr:]
    def read_ls(off):
        e = "<" if wkb[off] == 1 else ">"
        n = struct.unpack_from(e + "I", wkb, off + 5)[0]
        off += 9
        out = []
        for _ in range(n):
            x, y = struct.unpack_from(e + "dd", wkb, off); off += 16
            out.append((x, y))
        return out, off
    e0 = "<" if wkb[0] == 1 else ">"
    base = struct.unpack_from(e0 + "I", wkb, 1)[0] & 0xFF
    if base == 2:
        pts, _ = read_ls(0); return pts
    if base == 5:
        ng = struct.unpack_from(e0 + "I", wkb, 5)[0]; off = 9; allp = []
        for _ in range(ng):
            p, off = read_ls(off); allp += p
        return allp
    return []

def resample_chain(poly, step=8):
    """Even ~step-spaced points along a polyline (bridges reach-connection gaps with a
    straight run, so the stored course has no big jumps; the model resamples again)."""
    if len(poly) < 2:
        return poly
    out = [list(poly[0])]
    carry = 0.0  # distance accumulated since the last emitted point (carried across segments)
    for i in range(1, len(poly)):
        ax, az = poly[i - 1]; bx, bz = poly[i]
        L = ((bx - ax) ** 2 + (bz - az) ** 2) ** 0.5
        if L < 1e-9:
            continue
        pos = step - carry
        while pos <= L + 1e-9:
            t = pos / L
            out.append([round(ax + (bx - ax) * t), round(az + (bz - az) * t)])
            pos += step
        carry = (carry + L) % step
    if out[-1] != list(poly[-1]):
        out.append(list(poly[-1]))
    return out

def build_rivers(found):
    gpkg = WORK / "openrivers.gpkg"
    if not gpkg.exists():
        return []
    con = sqlite3.connect(str(gpkg))
    out = []
    DALE = {
        "River Esk": "Eskdale", "Murk Esk": "Eskdale", "River Derwent": "the Derwent valley",
        "River Rye": "Ryedale", "River Dove": "Farndale", "River Seven": "Rosedale",
        "River Leven": "the Leven valley", "River Seph": "Bilsdale",
        "River Riccal": "Riccaldale", "River Tees": "Teesdale",
    }
    MAJOR = {"River Esk", "River Derwent", "River Rye", "River Dove", "River Seven", "River Leven"}
    for nm in DALE:
        reaches = []
        for (blob,) in con.execute(
                "SELECT geometry FROM watercourse_link WHERE watercourse_name=?", (nm,)):
            r = [list(to_block(E, N)) for E, N in parse_gpkg_linestring(blob) if in_bounds(E, N)]
            if len(r) >= 2:
                reaches.append(r)
        if not reaches:
            continue
        # chain reaches end-to-end: keep each OS LineString's own order, connect by nearest
        # endpoints (flip as needed), drop bits too far to connect. Merging + easting-sorting
        # (or NN over) the points scrambles disjoint reaches into parallel channels — the
        # Dove/Esk jumped 300-1264 blocks near Hutton-le-Hole.
        reaches.sort(key=lambda r: min(p[0] for p in r))
        chain = reaches.pop(0)
        progress = True
        while reaches and progress:
            progress = False
            tx, tz = chain[-1]
            bi, bflip, bd = -1, False, 1e18
            for i, r in enumerate(reaches):
                d0 = (r[0][0] - tx) ** 2 + (r[0][1] - tz) ** 2
                d1 = (r[-1][0] - tx) ** 2 + (r[-1][1] - tz) ** 2
                if d0 < bd: bd, bi, bflip = d0, i, False
                if d1 < bd: bd, bi, bflip = d1, i, True
            if bi >= 0 and bd <= 40 * 40:
                r = reaches.pop(bi)
                chain += r[::-1] if bflip else r
                progress = True
        keep = resample_chain(chain, 8)   # even ~8-block spacing — no big jumps; model resamples again
        out.append({"name": nm, "points": keep, "dale": DALE[nm], "size": "major" if nm in MAJOR else "beck"})
    con.close()
    return out

# ---------------------------------------------------------------- landmarks
def build_landmarks(found):
    lm = []
    if "whitby" in found:
        # abbey on the East Cliff, just E + N of the town centre
        x, z = found["whitby"][1]
        lm.append({"name": "Whitby Abbey", "x": x + 12, "z": z - 8, "kind": "abbey"})
    # Roseberry Topping (NZ 5705 1260) — naming only; the DEM carries its real cone
    rx, rz = to_block(457050, 512600)
    if in_bounds(457050, 512600):
        lm.append({"name": "Roseberry Topping", "x": rx, "z": rz, "kind": "hill"})

    # --- moor crosses (real OSGB refs; Fat Betty is the white one) ---
    # Young Ralph Cross, Blakey Ridge — the National Park's emblem (~ NZ 682 020)
    if in_bounds(468200, 502000):
        x, z = to_block(468200, 502000)
        lm.append({"name": "Young Ralph Cross", "x": x, "z": z, "kind": "cross"})
    # Fat Betty / White Cross, ~450 m S on the Rosedale road (~ NZ 6823 0158)
    if in_bounds(468230, 501580):
        x, z = to_block(468230, 501580)
        lm.append({"name": "Fat Betty", "x": x, "z": z, "kind": "cross", "params": {"white": True}})
    # Lilla Cross, Fylingdales Moor — oldest Christian monument on the moors (~ SE 8893 9874)
    if in_bounds(488930, 498740):
        x, z = to_block(488930, 498740)
        lm.append({"name": "Lilla Cross", "x": x, "z": z, "kind": "cross"})

    # --- Wade's Causeway: the Wheeldale Roman road, a short stone-paved line over
    # Wheeldale Moor (~ SE 805 973 -> SE 812 987). Polyline in block coords. ---
    causeway_osgb = [(480450, 497300), (480650, 497900), (480820, 498400), (481150, 498650)]
    pts = [list(to_block(E, N)) for (E, N) in causeway_osgb if in_bounds(E, N)]
    if len(pts) >= 2:
        lm.append({"name": "Wade's Causeway", "kind": "causeway", "points": pts,
                   "x": pts[0][0], "z": pts[0][1]})
    return lm

# ---------------------------------------------------------------- assemble
def main():
    elev, acc = build_elevation()
    coast = []   # coast is DEM-driven now (MoorsGeography.coastT reads the elevation), no polyline needed
    towns, found = build_towns()
    stations = build_stations(found)
    rivers = build_rivers(found)
    landmarks = build_landmarks(found)
    data = {
        "_note": "Real OS OpenData (OGL): Terrain 50 + Open Names + Open Rivers. "
                 "Contains OS data (c) Crown copyright and database right 2026. "
                 "Built by scripts/build-moors-data.py.",
        "transform": {"minE": MIN_E, "minN": MIN_N, "maxE": MAX_E, "maxN": MAX_N, "metresPerBlock": MPB},
        "elevation": elev,
        "towns": towns,
        "stations": stations,
        "lines": [{"name": "Whitby & Pickering", "kind": "passenger",
                   "stations": [s["name"] for s in stations]}],
        "coast": coast,
        "rivers": rivers,
        "landmarks": landmarks,
    }
    OUT.write_text(json.dumps(data))
    print(f"elevation: {elev['cols']}x{elev['rows']} grid @ {STEP}m  ({len(elev['metres'])} cells)")
    print(f"towns: {len(towns)}  ({', '.join(t['name'] for t in towns)})")
    print(f"stations (moors line): {len(stations)}  ({', '.join(s['name'] for s in stations)})")
    print(f"coast points: {len(coast)}")
    print(f"rivers: {len(rivers)}  ({', '.join(r['name']+'['+str(len(r['points']))+']' for r in rivers)})")
    print(f"landmarks: {len(landmarks)}  ({', '.join(l['name'] for l in landmarks)})")
    print(f"wrote {OUT}  ({OUT.stat().st_size//1024} KB)")

if __name__ == "__main__":
    main()
