#!/usr/bin/env python3
"""Add 15-player room cap + overflow shard picking to live dash/app.py."""
from pathlib import Path

P = Path("/home/james/moorstead/dash/app.py")
s = P.read_text()
bak = P.with_suffix(".py.bak-20260620-overflow")
if not bak.exists():
    bak.write_text(s)

if "ROOM_CAP" not in s:
    s = s.replace(
        'LLM = "http://127.0.0.1:8086"\n',
        'LLM = "http://127.0.0.1:8086"\nRELAY = "http://127.0.0.1:8096"\nROOM_CAP = 15\n',
    )

helpers = '''

def _relay_rooms():
    try:
        r = httpx.get(f"{RELAY}/status", timeout=2)
        if r.status_code == 200:
            return r.json().get("rooms", {})
    except Exception:
        pass
    return {}


def _pick_room(base, current=None):
    """Least-full shard of a world family: moor, moor-2, moor-3, …"""
    base = re.sub(r"[^a-z0-9-]", "", (base or "moor"))[:24] or "moor"
    live = _relay_rooms()
    candidates = [base] + [f"{base}-{i}"[:24] for i in range(2, 12)]
    if current and current in candidates:
        if live.get(current, {}).get("players", 0) < ROOM_CAP:
            return current
    for rid in candidates:
        if live.get(rid, {}).get("players", 0) < ROOM_CAP:
            return rid
    return f"{base}-x{int(time.time()) % 10000}"[:24]

'''
if "_pick_room" not in s:
    s = s.replace("def _mint_ws_token", helpers + "def _mint_ws_token", 1)

old = '''    if not acct.get("room"):
        acct["room"] = _room_for_code(code, entry, acct)
    if pid and PID_RE.match(pid)'''
new = '''    base = _room_for_code(code, entry, acct)
    acct["room"] = _pick_room(base, acct.get("room"))
    if pid and PID_RE.match(pid)'''
if new not in s:
    if old in s:
        s = s.replace(old, new, 1)
    else:
        raise SystemExit("claim room block not found")

P.write_text(s)
print("patched", P)
