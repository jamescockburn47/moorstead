"""Moorstead shared-world relay — t' Shared Moor.

WebSocket rooms: same seed for everyone, server holds t' authoritative block
edits (persisted), relays player positions an' village-green chat. Terrain
itself is deterministic client-side, so this stays feather-light.
"""
import asyncio
import json
import re
import time
import math
import sys
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

DATA = Path("/home/james/moorstead/world")
DATA.mkdir(exist_ok=True)
TOKENS_F = Path("/home/james/moorstead/dash/ws_tokens.json")
ERRORS_F = DATA / "client_errors.log"
DAY_LENGTH = 1800.0
NAME_RE = re.compile(r"[^\w \-']")

# Load Geography terrain generator if available
try:
    sys.path.append(str(Path(__file__).resolve().parent.parent.parent / "clint-body"))
    from geography_noise import Geography
    geo = Geography()
except Exception as e:
    print("Warning: could not load geography_noise:", e)
    geo = None

TREES = {6, 7, 36}
ORES = {13, 14, 15, 51, 52, 53}
PEAT = 3

def normalize_edit(v, now_day=None):
    if now_day is None:
        now_day = time.time() / DAY_LENGTH
    if isinstance(v, dict):
        return {
            "id": v.get("id", 0),
            "was": v.get("was", 0),
            "cat": v.get("cat", "build"),
            "day": v.get("day", now_day),
            "by": v.get("by", "")
        }
    else:
        return {
            "id": int(v),
            "was": 0,
            "cat": "build",
            "day": now_day,
            "by": ""
        }

def coord_hash(x, y, z):
    val = math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453123
    return val - math.floor(val)

def find_active_deed(deeds, x, z, kind=None):
    for d in deeds:
        if d and not d.get("lapsedDay") and (kind is None or d.get("kind") == kind):
            r = d.get("radius", 0)
            if (x - d.get("cx", 0)) ** 2 + (z - d.get("cz", 0)) ** 2 <= r * r:
                return d
    return None

def find_lapsed_deed(deeds, x, z, kind=None):
    for d in deeds:
        if d and d.get("lapsedDay") and (kind is None or d.get("kind") == kind):
            r = d.get("radius", 0)
            if (x - d.get("cx", 0)) ** 2 + (z - d.get("cz", 0)) ** 2 <= r * r:
                return d
    return None

def is_expired(edit, now_day, deeds, decay_scale, x, y, z, geography):
    info = normalize_edit(edit, now_day)
    cat = info["cat"]
    was = info["was"]
    day = info["day"]
    
    if cat == "harvest":
        life = 24 if (was in TREES or was in ORES) else (12 if was == PEAT else 6)
        return (now_day - day) >= life
        
    if cat == "build":
        if find_active_deed(deeds, x, z, "claim"):
            return False
        lapsed = find_lapsed_deed(deeds, x, z, "claim")
        if lapsed:
            grace = 7 * decay_scale
            decay_duration = 14 * decay_scale
            h = coord_hash(x, y, z)
            return (now_day - lapsed.get("lapsedDay", now_day)) > (grace + h * decay_duration)
        return (now_day - day) >= 30
        
    if cat == "dig":
        mine = find_active_deed(deeds, x, z, "mine")
        if mine and geography:
            grade = geography.height(x, z)
            if y <= grade and y >= grade - mine.get("depth", 0):
                return False
        return (now_day - day) >= 24
        
    return False

app = FastAPI()
rooms = {}


def room(rid):
    if rid not in rooms:
        f = DATA / f"{rid}.json"
        edits = {}
        deeds = []
        try:
            data = json.loads(f.read_text())
            if isinstance(data, dict) and ("edits" in data or "deeds" in data):
                edits = data.get("edits", {})
                deeds = data.get("deeds", [])
            else:
                edits = data
        except Exception:
            pass
        rooms[rid] = {"clients": {}, "players": {}, "edits": edits, "deeds": deeds, "dirty": False, "file": f}
    return rooms[rid]


MAX_PLAYERS = 15   # per room; overflow shards (moor-2, bairns-2, …) assigned at login
POS_RANGE = 250.0   # tha only hears about folk within render range
CHAT_RANGE = 60.0   # speech carries about as far as a good shout

CHAT_LOG = DATA / "chat.log"
BANLIST = DATA / "banlist.json"   # {"pids": [...], "names": [...]}
# crude but it sets t' tone; t' chat log is t' real safeguard
BAD_WORDS = re.compile(r"\b(fuck\w*|shit\w*|cunt\w*|nigg\w*|fag\w*|bitch\w*|twat\w*|wank\w*)\b", re.I)


def banned(pid, name):
    try:
        b = json.loads(BANLIST.read_text())
    except Exception:
        return False
    return pid in b.get("pids", []) or name.lower() in [n.lower() for n in b.get("names", [])]


def load_ws_tokens():
    try:
        return json.loads(TOKENS_F.read_text())
    except Exception:
        return {}


def check_ws_access(rid, pid, name, token):
    """Return (ok, session_or_none, err_msg). Session is set for invited accounts."""
    protected = rid != "moor"
    account_pid = pid.startswith("a") and len(pid) > 1

    if protected or account_pid:
        if not token:
            return False, None, "Thi world needs a fresh login — use thi invite code again."
        tokens = load_ws_tokens()
        sess = tokens.get(token)
        if not sess or sess.get("exp", 0) < time.time():
            return False, None, "Thi session's expired — log in again wi' thi invite."
        if sess.get("room") != rid:
            return False, None, "That invite isn't for this world."
        expected = ("a" + sess.get("acct", ""))[:40]
        if pid != expected:
            return False, None, "Identity mismatch — log in again."
        if name and sess.get("name") and name != sess["name"]:
            # keep display name in sync wi' t' ledger
            pass
        return True, sess, None

    # Ramblers on t' open moor only — no token required
    if rid != "moor":
        return False, None, "Ramblers can only walk t' open moor — get an invite for other worlds."
    return True, None, None


async def reject_ws(ws, msg):
    try:
        await ws.send_text(json.dumps({"type": "chat", "pid": "_", "name": "T' Parish", "text": msg}))
    except Exception:
        pass
    await ws.close(code=4003, reason=msg[:80])


async def broadcast(r, msg, skip=None, near=None, rng=None):
    """Send to all in t' room — or only those within rng of `near` (x, z)."""
    dead = []
    data = json.dumps(msg)
    for pid, ws in r["clients"].items():
        if pid == skip:
            continue
        if near is not None:
            p = r["players"].get(pid)
            if not p:
                continue
            if ((p["x"] - near[0]) ** 2 + (p["z"] - near[1]) ** 2) > rng * rng:
                continue
        try:
            await ws.send_text(data)
        except Exception:
            dead.append(pid)
    for pid in dead:
        r["clients"].pop(pid, None)
        r["players"].pop(pid, None)


def world_time():
    # one shared day, ticking on t' server clock (starts mid-morning)
    return (time.time() / DAY_LENGTH + 0.3) % 1.0


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    rid = re.sub(r"[^a-z0-9-]", "", (ws.query_params.get("room") or "moor"))[:24] or "moor"
    pid = re.sub(r"[^a-z0-9-]", "", (ws.query_params.get("pid") or ""))[:40]
    name = NAME_RE.sub("", (ws.query_params.get("name") or "rambler"))[:24] or "rambler"
    token = str(ws.query_params.get("token") or "")[:80]
    if not pid:
        await ws.close()
        return
    ok, sess, err = check_ws_access(rid, pid, name, token)
    if not ok:
        await reject_ws(ws, err or "Not welcome here.")
        return
    if sess and sess.get("name"):
        name = NAME_RE.sub("", sess["name"])[:24] or name
    if banned(pid, name):
        await ws.send_text(json.dumps({"type": "chat", "pid": "_", "name": "T' Parish",
                                       "text": "Tha's not welcome on t' shared moor just now."}))
        await ws.close()
        return
    r = room(rid)
    if len(r["clients"]) >= MAX_PLAYERS:
        await ws.send_text(json.dumps({"type": "full", "max": MAX_PLAYERS}))
        await ws.close()
        return
    # boot any stale connection for t' same player
    old = r["clients"].pop(pid, None)
    if old:
        try:
            await old.close()
        except Exception:
            pass
    r["clients"][pid] = ws
    r["players"][pid] = {"name": name, "x": 0, "y": 40, "z": 0, "yaw": 0, "ts": time.time()}

    # thi pockets an' ventures live on t' server, keyed to thi account
    save = None
    save_f = DATA / "saves" / f"{pid}.json"
    try:
        save = json.loads(save_f.read_text())
    except Exception:
        pass
    client_edits = []
    for k, v in r["edits"].items():
        try:
            x, y, z = map(int, k.split(","))
            info = normalize_edit(v)
            client_edits.append([x, y, z, info["id"]])
        except Exception:
            pass
    await ws.send_text(json.dumps({
        "type": "init", "seed": "t-shared-moor", "time": world_time(),
        "edits": client_edits,
        "deeds": r["deeds"],
        "players": {k: v for k, v in r["players"].items() if k != pid},
        "save": save,
    }))
    await broadcast(r, {"type": "join", "pid": pid, "name": name}, skip=pid)

    try:
        while True:
            raw = await ws.receive_text()
            if len(raw) > 262144:
                continue
            try:
                m = json.loads(raw)
            except Exception:
                continue
            t = m.get("type")
            if t != "save" and len(raw) > 600:
                continue
            if t == "save":
                data = m.get("data")
                if isinstance(data, dict):
                    (DATA / "saves").mkdir(exist_ok=True)
                    (DATA / "saves" / f"{pid}.json").write_text(json.dumps(data))
                continue
            if t == "pos":
                p = r["players"].get(pid)
                if p:
                    p.update(x=float(m["x"]), y=float(m["y"]), z=float(m["z"]),
                             yaw=float(m.get("yaw", 0)), ts=time.time())
                await broadcast(r, {"type": "pos", "pid": pid, "x": p["x"], "y": p["y"], "z": p["z"], "yaw": p["yaw"]},
                                skip=pid, near=(p["x"], p["z"]), rng=POS_RANGE)
            elif t == "edit":
                x, y, z, bid = int(m["x"]), int(m["y"]), int(m["z"]), int(m["id"])
                if not (0 <= y < 64 and 0 <= bid < 64 and abs(x) < 100000 and abs(z) < 100000):
                    continue
                was = int(m.get("was", 0))
                cat = str(m.get("cat", "build"))
                day = float(m.get("day", time.time() / DAY_LENGTH))
                by = str(m.get("by", ""))
                
                if bid == was:
                    r["edits"].pop(f"{x},{y},{z}", None)
                else:
                    r["edits"][f"{x},{y},{z}"] = {
                        "id": bid,
                        "was": was,
                        "cat": cat,
                        "day": day,
                        "by": by
                    }
                r["dirty"] = True
                await broadcast(r, {"type": "edit", "x": x, "y": y, "z": z, "id": bid}, skip=pid)
            elif t == "deeds":
                new_deeds = m.get("deeds")
                if isinstance(new_deeds, list):
                    r["deeds"] = new_deeds
                    r["dirty"] = True
                    await broadcast(r, {"type": "deeds", "deeds": r["deeds"]}, skip=pid)
            elif t == "chat":
                text = str(m.get("text", ""))[:200].strip()
                if text:
                    text = BAD_WORDS.sub("****", text)
                    me = r["players"].get(pid) or {"x": 0, "z": 0}
                    # full audit trail for t' parish ledger
                    try:
                        with CHAT_LOG.open("a") as f:
                            f.write(json.dumps({"ts": time.time(), "pid": pid, "name": name,
                                                "x": round(me["x"]), "z": round(me["z"]), "text": text}) + "\n")
                    except Exception:
                        pass
                    # speech is local: only them as can hear thee get it
                    await broadcast(r, {"type": "chat", "pid": pid, "name": name, "text": text},
                                    near=(me["x"], me["z"]), rng=CHAT_RANGE)
            elif t == "timeq":
                await ws.send_text(json.dumps({"type": "time", "time": world_time()}))
            elif t == "error":
                try:
                    with ERRORS_F.open("a") as f:
                        f.write(json.dumps({
                            "ts": time.time(), "pid": pid, "name": name, "room": rid,
                            "message": str(m.get("message", ""))[:200],
                            "stack": str(m.get("stack", ""))[:300],
                            "lookingAt": str(m.get("lookingAt", ""))[:60],
                        }) + "\n")
                except Exception:
                    pass
    except WebSocketDisconnect:
        pass
    finally:
        r["clients"].pop(pid, None)
        r["players"].pop(pid, None)
        await broadcast(r, {"type": "leave", "pid": pid})


@app.on_event("startup")
async def saver_and_pruner():
    async def save_loop():
        while True:
            await asyncio.sleep(20)
            for r in list(rooms.values()):
                if r["dirty"]:
                    r["file"].write_text(json.dumps({
                        "edits": r["edits"],
                        "deeds": r["deeds"]
                    }))
                    r["dirty"] = False
                    
    async def prune_loop():
        while True:
            await asyncio.sleep(30)
            now_day = time.time() / DAY_LENGTH
            for rid, r in list(rooms.items()):
                decay_scale = 2 if "bairn" in rid else 1
                deeds = r.get("deeds", [])
                edits = r.get("edits", {})
                
                # Check for lapsed deeds
                grace = 7 * decay_scale
                deeds_dirty = False
                for d in deeds:
                    paid_until = d.get("paidUntilDay")
                    if not d.get("lapsedDay") and paid_until is not None:
                        if now_day > paid_until + grace:
                            d["lapsedDay"] = now_day
                            deeds_dirty = True
                            
                if deeds_dirty:
                    r["dirty"] = True
                    await broadcast(r, {"type": "deeds", "deeds": deeds})
                
                # Check for expired edits
                expired_keys = []
                for k, v in list(edits.items()):
                    try:
                        x, y, z = map(int, k.split(","))
                        if is_expired(v, now_day, deeds, decay_scale, x, y, z, geo):
                            expired_keys.append((k, x, y, z, v))
                    except Exception:
                        pass
                
                if expired_keys:
                    for k, x, y, z, v in expired_keys:
                        info = normalize_edit(v, now_day)
                        edits.pop(k, None)
                        await broadcast(r, {"type": "edit", "x": x, "y": y, "z": z, "id": info["was"]})
                    r["dirty"] = True

    asyncio.create_task(save_loop())
    asyncio.create_task(prune_loop())


@app.get("/status")
def status():
    return {"rooms": {k: {"players": len(v["players"]), "edits": len(v["edits"])} for k, v in rooms.items()}}
