"""Moorstead shared-world relay — t' Shared Moor.

WebSocket rooms: same seed for everyone, server holds t' authoritative block
edits (persisted), relays player positions an' village-green chat. Terrain
itself is deterministic client-side, so this stays feather-light.
"""
import asyncio
import json
import re
import time
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

DATA = Path("/home/james/moorstead/world")
DATA.mkdir(exist_ok=True)
DAY_LENGTH = 600.0
NAME_RE = re.compile(r"[^\w \-']")

app = FastAPI()
rooms = {}


def room(rid):
    if rid not in rooms:
        f = DATA / f"{rid}.json"
        edits = {}
        try:
            edits = json.loads(f.read_text())
        except Exception:
            pass
        rooms[rid] = {"clients": {}, "players": {}, "edits": edits, "dirty": False, "file": f}
    return rooms[rid]


MAX_PLAYERS = 64
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
    if not pid:
        await ws.close()
        return
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
    await ws.send_text(json.dumps({
        "type": "init", "seed": "t-shared-moor", "time": world_time(),
        "edits": [[*map(int, k.split(",")), v] for k, v in r["edits"].items()],
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
                r["edits"][f"{x},{y},{z}"] = bid
                r["dirty"] = True
                await broadcast(r, {"type": "edit", "x": x, "y": y, "z": z, "id": bid}, skip=pid)
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
    except WebSocketDisconnect:
        pass
    finally:
        r["clients"].pop(pid, None)
        r["players"].pop(pid, None)
        await broadcast(r, {"type": "leave", "pid": pid})


@app.on_event("startup")
async def saver():
    async def loop():
        while True:
            await asyncio.sleep(20)
            for r in rooms.values():
                if r["dirty"]:
                    r["file"].write_text(json.dumps(r["edits"]))
                    r["dirty"] = False
    asyncio.create_task(loop())


@app.get("/status")
def status():
    return {"rooms": {k: {"players": len(v["players"]), "edits": len(v["edits"])} for k, v in rooms.items()}}
