"""Moorstead parish ledger — players, login codes, and full EVO diagnostics.

:8095 on LAN/Tailscale only. The Cloudflare tunnel routes three public endpoints
here (POST /ping, POST /auth/claim, POST /visit, POST /request-invite, POST /feedback); the dashboard UI never leaves
the house.
"""
import hashlib
import hmac
import os
import threading
import urllib.request
import json
import re
import secrets
import shutil
import subprocess
import time
from pathlib import Path

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse

ROOT = Path("/home/james/moorstead")
DASH = ROOT / "dash"
DASH.mkdir(exist_ok=True)
PLAYERS_F = DASH / "players.json"
SESSIONS_F = DASH / "sessions.json"
VISITS_F = DASH / "visits.json"
CODES_F = DASH / "codes.json"
ACCOUNTS_F = DASH / "accounts.json"
WS_TOKENS_F = DASH / "ws_tokens.json"
REQUESTS_F = DASH / "token_requests.json"
REQUEST_RATE_F = DASH / "request_rate.json"
FEEDBACK_F = DASH / "feedback.json"
FEEDBACK_RATE_F = DASH / "feedback_rate.json"
INSIDERS_F = DASH / "insiders.json"   # pids James has tagged as his own devices
MEM = ROOT / "brain_memory" / "players"
CADDY_LOG = Path("/var/log/caddy/moorstead.log")
BRAIN = "http://127.0.0.1:8010"
LLM = "http://127.0.0.1:8086"
RELAY = "http://127.0.0.1:8096"
ROOM_CAP = 15

# Mirrors src/defs.js's ADMIN_HASHES (sha256 of the raw warden key) — kept in sync by hand,
# same list as the client checks client-side for the pause-menu warden login.
ADMIN_HASHES = {
    "29889b77f82b79d1585f514ac0e6489deed67ddb27b55a81109492a443b8e950",
    "d3586a9e0a64041ad379c88e7e646866232700925b973f26297e7be1c5b62c14",
    "5a19e539f87a5776ee01e7d8d603fcc7b63e810a14f23c471f94150437e854d8",
}

PID_RE = re.compile(r"^[a-z0-9-]{4,40}$")
CODE_RE = re.compile(r"^[a-z]+-[a-z]+-\d{2}$")
ROOM_RE = re.compile(r"^[a-z0-9-]{1,24}$")
EMAIL_RE = re.compile(r"^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$")
ADULT_ROOMS = frozenset({"moor", "dale", "crag", "tarn"})
MINT_W1 = ("heather", "curlew", "gorse", "bracken", "lapwing", "merlin", "foxglove", "tarn", "syke",
           "moss", "rigg", "howe", "thorn", "ling", "whin", "crag", "fell", "gill", "beck", "wren")
MINT_W2 = ("yow", "kiln", "fold", "gate", "dale", "scar", "mire", "stile", "cairn", "lees",
           "slack", "grain", "holt", "wick", "garth", "stead", "shaw", "cleugh", "sike", "pot")

app = FastAPI()


def _load(p, default):
    try:
        return json.loads(p.read_text())
    except Exception:
        return default


def _save(p, data):
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=1))
    tmp.replace(p)


def _utc_day(ts=None):
    return time.strftime("%Y-%m-%d", time.gmtime(ts or time.time()))


def _client_ip(req):
    return (req.headers.get("x-forwarded-for", "").split(",")[0].strip()
            or (req.client.host if req.client else "?"))


def _record_visit(pid, ip, name="", event="landing"):
    if not PID_RE.match(pid):
        return
    now = time.time()
    day = _utc_day(now)
    players = _load(PLAYERS_F, {})
    p = players.setdefault(pid, {"first": now, "names": [], "minutes": 0, "worlds": {},
                                 "visits": 0, "visitDays": []})
    p["last"] = now
    p["lastIp"] = ip
    if event == "landing":
        p["landings"] = p.get("landings", 0) + 1
        p["lastLanding"] = now
    elif event == "login":
        p["logins"] = p.get("logins", 0) + 1
    days = list(p.get("visitDays") or [])
    if day not in days:
        days.append(day)
        p["visitDays"] = days[-120:]
    p["visits"] = p.get("visits", 0) + 1
    if name and name not in p.get("names", []):
        p["names"] = (p.get("names", []) + [name])[-5:]
    _save(PLAYERS_F, players)
    log = _load(VISITS_F, [])
    log.append({"ts": now, "pid": pid, "name": name[:24], "event": event, "ip": ip})
    _save(VISITS_F, log[-2000:])
    _maybe_ping_clint("visit", pid, ip, name)


def _player_stats(players, now):
    today = _utc_day(now)
    week_cut = _utc_day(now - 7 * 86400)
    month_cut = _utc_day(now - 30 * 86400)
    st = {"total": len(players), "today": 0, "week": 0, "month": 0, "returning": 0,
          "playedToday": 0, "playedWeek": 0, "playedEver": 0}
    for p in players.values():
        days = p.get("visitDays") or []
        if today in days:
            st["today"] += 1
        if any(d >= week_cut for d in days):
            st["week"] += 1
        if any(d >= month_cut for d in days):
            st["month"] += 1
        if len(days) > 1 or p.get("visits", 0) > 1:
            st["returning"] += 1
        # played = in-world heartbeats, not just the page opened. playDays is
        # per-day and exact from 2026-07-17 on; minutes>0 backfills "ever".
        pdays = p.get("playDays") or []
        if today in pdays:
            st["playedToday"] += 1
        if any(d >= week_cut for d in pdays):
            st["playedWeek"] += 1
        if pdays or p.get("minutes", 0) > 0:
            st["playedEver"] += 1
    return st


# ---- clean numbers: partition players real (pub) / house (James) / bot ----
# Read-only classification from each player's stored lastIp + the insiders
# file; the write path and all existing stats fields are untouched.
_BOT_IP_PREFIXES = ("66.249.", "66.102.", "64.233.", "40.77.", "157.55.", "207.46.", "17.58.", "54.236.")


def _is_local_ip(ip):
    ip = (ip or "").strip()
    if not ip:
        return False
    if ip == "::1" or ip.startswith("127."):
        return True
    if ip.startswith("10.") or ip.startswith("192.168."):
        return True
    m = re.match(r"^172\.(\d+)\.", ip)
    if m and 16 <= int(m.group(1)) <= 31:
        return True
    t = re.match(r"^100\.(\d+)\.", ip)
    if t and 64 <= int(t.group(1)) <= 127:
        return True
    return False


def _classify_pid(pid, p, insiders):
    if pid in insiders:
        return "house"
    ip = p.get("lastIp") or ""
    if any(ip.startswith(x) for x in _BOT_IP_PREFIXES):
        return "bot"
    if _is_local_ip(ip):
        return "house"
    return "pub"


_STEADS_SECRET = os.environ.get("STEADS_WEBHOOK_SECRET", "")
_CLAWD_URL = os.environ.get("CLAWD_URL", "http://127.0.0.1:3000")
_clint_seen = {}  # "kind:pid" -> utc day already pinged


def _emit_clint(type_, extra=None):
    """Fire-and-forget HMAC-signed event to Clawd (the WhatsApp agent)."""
    if not _STEADS_SECRET:
        return
    body = json.dumps({"game": "moorstead", "type": type_, "ts": time.time(), **(extra or {})}).encode()
    sig = hmac.new(_STEADS_SECRET.encode(), body, hashlib.sha256).hexdigest()

    def _go():
        try:
            rq = urllib.request.Request(
                _CLAWD_URL + "/api/steads-event", data=body,
                headers={"Content-Type": "application/json", "x-steads-signature": sig})
            urllib.request.urlopen(rq, timeout=2).read()
        except Exception:
            pass
    threading.Thread(target=_go, daemon=True).start()


def _maybe_ping_clint(kind, pid, ip, name=""):
    """Ping James for a real stranger — once per browser per UTC day per kind."""
    try:
        if _classify_pid(pid, {"lastIp": ip}, set(_load(INSIDERS_F, []))) != "pub":
            return
        key = kind + ":" + pid
        day = _utc_day()
        if _clint_seen.get(key) == day:
            return
        _clint_seen[key] = day
        if len(_clint_seen) > 4000:
            _clint_seen.clear()
        _emit_clint(kind, {"name": name} if name else None)
    except Exception:
        pass


def _player_stats_all(players, now):
    """The existing flat stats plus the same numbers split real/house/bot."""
    st = _player_stats(players, now)
    insiders = set(_load(INSIDERS_F, []))
    split = {"pub": {}, "house": {}, "bot": {}}
    for cls in split:
        subset = {k: v for k, v in players.items()
                  if _classify_pid(k, v, insiders) == cls}
        split[cls] = _player_stats(subset, now)
    st["real"] = split["pub"]
    st["house"] = split["house"]
    st["bot"] = split["bot"]
    return st


def _rate_ok(ip, limit=2, rate_file=None):
    day = _utc_day()
    rates = _load(rate_file or REQUEST_RATE_F, {})
    rec = rates.get(ip, {"day": day, "n": 0})
    if rec.get("day") != day:
        rec = {"day": day, "n": 0}
    if rec["n"] >= limit:
        return False
    rec["n"] += 1
    rates[ip] = rec
    _save(rate_file or REQUEST_RATE_F, rates)
    return True


def _mint_adult_code(room="moor"):
    if room not in ADULT_ROOMS:
        room = "moor"
    codes = _load(CODES_F, {})
    for _ in range(80):
        w1 = secrets.choice(MINT_W1)
        w2 = secrets.choice(MINT_W2)
        if w1 == w2:
            continue
        n = secrets.randbelow(80) + 10
        code = f"{w1}-{w2}-{n:02d}"
        if code in codes or not CODE_RE.match(code):
            continue
        codes[code] = {"room": room}
        _save(CODES_F, codes)
        return code
    raise RuntimeError("could not mint a unique adult invite code")


def _pending_requests():
    reqs = _load(REQUESTS_F, [])
    return [r for r in reqs if r.get("status") == "pending"]


def _room_for_code(code, entry, acct):
    if isinstance(entry, dict) and entry.get("room"):
        return str(entry["room"]).lower()
    if acct and acct.get("room"):
        return str(acct["room"]).lower()
    if code.startswith("bairn-"):
        return "bairns"
    if code.startswith("dale-"):
        return "dale"
    if code.startswith("crag-"):
        return "crag"
    if code.startswith("tarn-"):
        return "tarn"
    return "moor"


def _prune_ws_tokens(tokens):
    now = time.time()
    return {k: v for k, v in tokens.items() if v.get("exp", 0) > now - 60}


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


def _mint_ws_token(code, acct_id, room, name):
    tokens = _prune_ws_tokens(_load(WS_TOKENS_F, {}))
    token = secrets.token_urlsafe(32)
    tokens[token] = {
        "acct": acct_id,
        "room": room,
        "name": name,
        "exp": time.time() + 7 * 86400,
    }
    _save(WS_TOKENS_F, tokens)
    return token


# ---------------- login ----------------
@app.post("/auth/claim")
async def claim(req: Request):
    try:
        d = await req.json()
    except Exception:
        return {"ok": False, "err": "bad request"}
    code = str(d.get("code", "")).strip().lower()[:40]
    name = re.sub(r"[^\w \-']", "", str(d.get("name", "")).strip())[:24]
    pid = str(d.get("pid", ""))[:40].lower()
    if not CODE_RE.match(code):
        return {"ok": False, "err": "That code doesn't look right, love."}
    codes = _load(CODES_F, {})
    if code not in codes:
        return {"ok": False, "err": "No such invite. Check thi spelling."}
    accounts = _load(ACCOUNTS_F, {})
    entry = codes.get(code)
    acct = accounts.get(code)
    if acct is None:
        if not name:
            return {"ok": False, "err": "Tell us thi name an' all."}
        room = _room_for_code(code, entry, None)
        acct = {"name": name, "pids": [], "created": time.time(), "room": room}
    elif name:
        acct["name"] = name  # whoever holds t' code owns t' name
    base = _room_for_code(code, entry, acct)
    acct["room"] = _pick_room(base, acct.get("room"))
    if pid and PID_RE.match(pid) and pid not in acct["pids"]:
        acct["pids"] = (acct["pids"] + [pid])[-6:]
    acct["last"] = time.time()
    accounts[code] = acct
    _save(ACCOUNTS_F, accounts)
    acct_id = hashlib.sha1(code.encode()).hexdigest()[:10]
    room = acct["room"]
    token = _mint_ws_token(code, acct_id, room, acct["name"])
    if pid and PID_RE.match(pid):
        _record_visit(pid, _client_ip(req), acct["name"], "login")
    # the player's daemon (first pet) travels with the login token, so it shows in
    # single-player worlds too, not just the shared moor. Read from the relay's store.
    daemon = None
    try:
        _dd = json.loads(Path("/home/james/moorstead/world/daemons.json").read_text()).get("a" + acct_id)
        if isinstance(_dd, dict) and _dd.get("kind") and _dd.get("name"):
            daemon = {"kind": str(_dd["kind"])[:24], "name": str(_dd["name"])[:24]}
    except Exception:
        pass
    return {"ok": True, "name": acct["name"],
            "room": room,
            "acct": acct_id,
            "token": token,
            "daemon": daemon}


@app.post("/api/setroom")
async def setroom(req: Request):
    """LAN-only: put a code/account in a world-room (moor, bairns, ...)."""
    try:
        d = await req.json()
    except Exception:
        return {"ok": False, "err": "bad request"}
    code = str(d.get("code", "")).strip().lower()
    room = str(d.get("room", "")).strip().lower()
    if not CODE_RE.match(code) or not ROOM_RE.match(room):
        return {"ok": False, "err": "bad code or room"}
    codes = _load(CODES_F, {})
    if code not in codes:
        return {"ok": False, "err": "no such code"}
    codes[code] = {"room": room}
    _save(CODES_F, codes)
    accounts = _load(ACCOUNTS_F, {})
    if code in accounts:
        accounts[code]["room"] = room
        _save(ACCOUNTS_F, accounts)
    return {"ok": True, "code": code, "room": room}


# ---------------- heartbeat ----------------
@app.post("/ping")
async def ping(req: Request):
    try:
        d = await req.json()
    except Exception:
        return {"ok": False}
    pid = str(d.get("pid", ""))[:40].lower()
    if not PID_RE.match(pid):
        return {"ok": False}
    name = re.sub(r"[^\w \-']", "", str(d.get("name", "")))[:24]
    seed = re.sub(r"\D", "", str(d.get("seed", "")))[:12]
    room = re.sub(r"[^a-z0-9-]", "", str(d.get("room", "")).lower())[:24]  # '' = solo world
    entry = {
        "ts": time.time(), "pid": pid, "name": name, "seed": seed, "room": room,
        "day": max(0, min(int(d.get("day", 0) or 0), 99999)),
        "standing": str(d.get("standing", ""))[:12],
        "croft": max(0, min(int(d.get("croft", 0) or 0), 4)),
        "quests": max(0, min(int(d.get("quests", 0) or 0), 9999)),
        "loc": str(d.get("loc", ""))[:36],
        "ip": (req.headers.get("x-forwarded-for", "").split(",")[0].strip()
               or (req.client.host if req.client else "?")),
    }
    sessions = _load(SESSIONS_F, [])
    sessions.append(entry)
    _save(SESSIONS_F, sessions[-4000:])
    players = _load(PLAYERS_F, {})
    p = players.setdefault(pid, {"first": time.time(), "names": [], "minutes": 0, "worlds": {}})
    p["last"] = time.time()
    p["minutes"] = p.get("minutes", 0) + 1
    p["lastIp"] = entry["ip"]
    # playDays: a heartbeat means they actually PLAYED today (visitDays only
    # says the page was opened) — this is what the Admiralty Board counts
    pdays = list(p.get("playDays") or [])
    today = _utc_day()
    if today not in pdays:
        pdays.append(today)
        p["playDays"] = pdays[-120:]
    if name and name not in p["names"]:
        p["names"] = (p["names"] + [name])[-5:]
    if seed:
        p["worlds"][seed] = {"day": entry["day"], "standing": entry["standing"],
                             "croft": entry["croft"], "quests": entry["quests"],
                             "loc": entry["loc"], "last": time.time()}
    _save(PLAYERS_F, players)
    _maybe_ping_clint("play", pid, entry["ip"], name)
    return {"ok": True}


@app.post("/visit")
async def visit(req: Request):
    """Once-per-session site landing beacon from the public client."""
    try:
        d = await req.json()
    except Exception:
        return {"ok": False}
    pid = str(d.get("pid", ""))[:40].lower()
    if not PID_RE.match(pid):
        return {"ok": False}
    name = re.sub(r"[^\w \-']", "", str(d.get("name", "")))[:24]
    event = str(d.get("event", "landing"))[:12]
    if event not in ("landing", "login"):
        event = "landing"
    _record_visit(pid, _client_ip(req), name, event)
    return {"ok": True}


@app.post("/request-invite")
async def request_invite(req: Request):
    """Public: queue an adult-room invite request (operator approves on the ledger)."""
    ip = _client_ip(req)
    if not _rate_ok(ip):
        return {"ok": False, "err": "Easy now — tha can only ask once or twice a day."}
    try:
        d = await req.json()
    except Exception:
        return {"ok": False, "err": "bad request"}
    email = str(d.get("email", "")).strip().lower()[:120]
    name = re.sub(r"[^\w \-']", "", str(d.get("name", "")).strip())[:24]
    note = re.sub(r"[\r\n\t]", " ", str(d.get("note", "")).strip())[:200]
    if not EMAIL_RE.match(email):
        return {"ok": False, "err": "That email doesn't look right."}
    if re.search(r"\b(bairn|child|children|kid|kids)\b", f"{note} {email}", re.I):
        return {"ok": False,
                "err": "Children's invites aren't requested here — contact the operator directly."}
    reqs = _load(REQUESTS_F, [])
    for r in reqs:
        if r.get("email") == email and r.get("status") == "pending":
            return {"ok": True, "msg": "Already on t' list — I'll be in touch if there's a spot."}
    pid = str(d.get("pid", ""))[:40].lower()
    reqs.append({
        "id": secrets.token_hex(6),
        "email": email,
        "name": name,
        "note": note,
        "room": "moor",
        "status": "pending",
        "ts": time.time(),
        "ip": ip,
        "pid": pid if PID_RE.match(pid) else "",
    })
    _save(REQUESTS_F, reqs[-500:])
    return {"ok": True, "msg": "Thanks — I'll be in touch if there's a spot."}


@app.post("/feedback")
async def feedback(req: Request):
    """Public: player feedback or bug report with page / in-game context."""
    ip = _client_ip(req)
    if not _rate_ok(ip, limit=8, rate_file=FEEDBACK_RATE_F):
        return {"ok": False, "err": "Easy now — tha can only send a few reports a day."}
    try:
        d = await req.json()
    except Exception:
        return {"ok": False, "err": "bad request"}
    kind = str(d.get("kind", "feedback")).strip().lower()
    if kind not in ("bug", "feedback"):
        kind = "feedback"
    message = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", " ", str(d.get("message", "")).strip())[:2000]
    if len(message) < 8:
        return {"ok": False, "err": "Tell us a bit more — at least a sentence."}
    email = str(d.get("email", "")).strip().lower()[:120]
    if email and not EMAIL_RE.match(email):
        return {"ok": False, "err": "That email doesn't look right."}
    name = re.sub(r"[^\w \-']", "", str(d.get("name", "")).strip())[:24]
    pid = str(d.get("pid", ""))[:40].lower()
    ctx = d.get("context") if isinstance(d.get("context"), dict) else {}
    ctx_safe = {
        "page": str(ctx.get("page", ""))[:24],
        "url": str(ctx.get("url", ""))[:240],
        "ua": str(ctx.get("ua", ""))[:240],
        "loc": str(ctx.get("loc", ""))[:36],
        "room": str(ctx.get("room", ""))[:24],
        "state": str(ctx.get("state", ""))[:16],
        "seed": re.sub(r"\D", "", str(ctx.get("seed", "")))[:12],
        "day": max(0, min(int(ctx.get("day", 0) or 0), 99999)),
        "creative": bool(ctx.get("creative")),
    }
    pos = ctx.get("pos") if isinstance(ctx.get("pos"), dict) else {}
    try:
        ctx_safe["pos"] = {
            "x": max(-9999, min(int(pos.get("x", 0) or 0), 9999)),
            "y": max(-999, min(int(pos.get("y", 0) or 0), 999)),
            "z": max(-9999, min(int(pos.get("z", 0) or 0), 9999)),
        }
    except Exception:
        ctx_safe["pos"] = {}
    entry = {
        "id": secrets.token_hex(6),
        "ts": time.time(),
        "kind": kind,
        "message": message,
        "email": email,
        "name": name,
        "pid": pid if PID_RE.match(pid) else "",
        "ip": ip,
        "context": ctx_safe,
    }
    log = _load(FEEDBACK_F, [])
    log.append(entry)
    _save(FEEDBACK_F, log[-1000:])
    _emit_clint("bug" if kind == "bug" else "feedback", {"name": name, "message": message})
    if pid and PID_RE.match(pid):
        players = _load(PLAYERS_F, {})
        p = players.setdefault(pid, {"first": time.time(), "names": [], "minutes": 0, "worlds": {}})
        p["last"] = time.time()
        p["lastIp"] = ip
        p["feedbackCount"] = p.get("feedbackCount", 0) + 1
        if name and name not in p.get("names", []):
            p["names"] = (p.get("names", []) + [name])[-5:]
        _save(PLAYERS_F, players)
    return {"ok": True, "msg": "Thanks — noted on t' parish ledger."}


@app.post("/api/request-invite/respond")
async def respond_request(req: Request):
    """LAN-only: approve (mints code) or reject a queued invite request."""
    try:
        d = await req.json()
    except Exception:
        return {"ok": False, "err": "bad request"}
    rid = str(d.get("id", "")).strip()
    action = str(d.get("action", "")).strip().lower()
    room = str(d.get("room", "moor")).strip().lower()
    if room not in ADULT_ROOMS:
        return {"ok": False, "err": "adult rooms only (moor, dale, crag, tarn)"}
    reqs = _load(REQUESTS_F, [])
    target = next((r for r in reqs if r.get("id") == rid), None)
    if not target or target.get("status") != "pending":
        return {"ok": False, "err": "no such pending request"}
    if action == "reject":
        target["status"] = "rejected"
        target["closedTs"] = time.time()
        _save(REQUESTS_F, reqs)
        return {"ok": True, "status": "rejected"}
    if action != "approve":
        return {"ok": False, "err": "action must be approve or reject"}
    try:
        code = _mint_adult_code(room)
    except RuntimeError:
        return {"ok": False, "err": "could not mint a unique code — try again"}
    target["status"] = "approved"
    target["code"] = code
    target["room"] = room
    target["approvedTs"] = time.time()
    _save(REQUESTS_F, reqs)
    return {"ok": True, "status": "approved", "code": code, "room": room, "email": target["email"]}


# ---------------- diagnostics ----------------
def _sys_stats():
    out = {}
    try:
        out["load"] = [round(float(x), 2) for x in Path("/proc/loadavg").read_text().split()[:3]]
        out["cores"] = 32
        mi = {}
        for line in Path("/proc/meminfo").read_text().splitlines()[:5]:
            k, v = line.split(":")
            mi[k] = int(v.strip().split()[0])
        out["memUsedGB"] = round((mi["MemTotal"] - mi["MemAvailable"]) / 1048576, 1)
        out["memTotalGB"] = round(mi["MemTotal"] / 1048576, 1)
        du = shutil.disk_usage("/")
        out["diskUsedGB"] = round(du.used / 1e9)
        out["diskTotalGB"] = round(du.total / 1e9)
    except Exception:
        pass
    try:
        smi = subprocess.run(["rocm-smi", "--showmeminfo", "vram", "--showuse", "--showtemp"],
                             capture_output=True, text=True, timeout=6).stdout
        m = re.search(r"VRAM Total Memory \(B\): (\d+)", smi)
        u = re.search(r"VRAM Total Used Memory \(B\): (\d+)", smi)
        g = re.search(r"GPU use \(%\): (\d+)", smi)
        t = re.search(r"Temperature \(Sensor (?:edge|junction)\) \(C\): ([\d.]+)", smi)
        if m and u:
            out["vramUsedGB"] = round(int(u.group(1)) / 2**30, 1)
            out["vramTotalGB"] = round(int(m.group(1)) / 2**30, 1)
        if g:
            out["gpuUse"] = int(g.group(1))
        if t:
            out["gpuTemp"] = float(t.group(1))
    except Exception:
        pass
    return out


def _talk_stats(window_s=3600):
    """LLM load from t' Caddy access log: talk volume an' latency."""
    now = time.time()
    durs, recent = [], 0
    try:
        lines = CADDY_LOG.read_text(errors="ignore").splitlines()[-12000:]
    except Exception:
        return {}
    for line in lines:
        try:
            d = json.loads(line)
            if "/api/talk" not in d["request"]["uri"]:
                continue
            if now - d["ts"] > window_s:
                continue
            durs.append(d["duration"])
            if now - d["ts"] < 300:
                recent += 1
        except Exception:
            continue
    durs.sort()
    n = len(durs)
    return {
        "talksLastHour": n,
        "talksLast5Min": recent,
        "p50": round(durs[n // 2], 1) if n else None,
        "p95": round(durs[int(n * 0.95)], 1) if n else None,
        "worst": round(durs[-1], 1) if n else None,
    }


def _services():
    out = {}
    for name in ["moorstead-brain", "llama-server-moorstead", "caddy",
                 "moorstead-dash", "sovren-cloudflared"]:
        try:
            r = subprocess.run(["systemctl", "is-active", name],
                               capture_output=True, text=True, timeout=4)
            out[name] = r.stdout.strip()
        except Exception:
            out[name] = "?"
    return out


def _visitors_from_caddy(max_lines=8000):
    out = {}
    try:
        lines = CADDY_LOG.read_text(errors="ignore").splitlines()[-max_lines:]
    except Exception:
        return []
    for line in lines:
        try:
            d = json.loads(line)
            xff = d["request"]["headers"].get("X-Forwarded-For", [""])[0]
            ip = xff.split(",")[0].strip() or d["request"].get("client_ip", "")
            if ip in ("", "127.0.0.1"):
                continue
            o = out.setdefault(ip, {"n": 0, "first": d["ts"], "last": d["ts"]})
            o["n"] += 1
            o["last"] = max(o["last"], d["ts"])
            o["first"] = min(o["first"], d["ts"])
        except Exception:
            continue
    return [{"ip": k, **v} for k, v in sorted(out.items(), key=lambda kv: -kv[1]["last"])]


def _conversations(limit_players=10):
    convs = []
    if not MEM.exists():
        return convs
    dirs = sorted(MEM.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
    for d in dirs[:limit_players]:
        if not d.is_dir():
            continue
        chars = []
        for f in d.glob("*.json"):
            try:
                m = json.loads(f.read_text())
            except Exception:
                continue
            recent = m.get("recent", [])
            if not recent:
                continue
            chars.append({
                "char": f.stem, "trust": m.get("trust", 0),
                "playerName": (m.get("facts") or {}).get("player_name", ""),
                "summary": m.get("summary", ""),
                "last": [{"role": t["role"], "text": t["content"][:180]} for t in recent[-4:]],
                "mtime": f.stat().st_mtime,
            })
        if chars:
            chars.sort(key=lambda c: -c["mtime"])
            convs.append({"pid": d.name, "mtime": d.stat().st_mtime, "chars": chars[:3]})
    return convs


@app.get("/api/overview")
async def overview():
    now = time.time()
    sessions = _load(SESSIONS_F, [])
    live = {}
    for s in sessions[-500:]:
        if now - s["ts"] < 180:
            live[(s["pid"], s["seed"])] = s
    brain = {"status": "offline"}
    llm = {"status": "offline"}
    try:
        async with httpx.AsyncClient(timeout=3) as c:
            brain = (await c.get(BRAIN + "/status")).json()
            llm = (await c.get(LLM + "/health")).json()
    except Exception:
        pass
    accounts = _load(ACCOUNTS_F, {})
    codes = _load(CODES_F, {})
    players = _load(PLAYERS_F, {})
    recent_visits = list(reversed(_load(VISITS_F, [])[-40:]))
    return {
        "now": now,
        "live": list(live.values()),
        "players": players,
        "stats": _player_stats_all(players, now),
        "recentVisits": recent_visits,
        "visitors": _visitors_from_caddy(),
        "conversations": _conversations(),
        "brain": brain, "llm": llm,
        "sys": _sys_stats(),
        "talk": _talk_stats(),
        "services": _services(),
        "codes": {"total": len(codes),
                  "claimed": len(accounts),
                  "names": sorted(a["name"] for a in accounts.values())},
        "accounts": sorted([{"code": c, "name": a.get("name", "?"),
                             "room": a.get("room", "moor"), "last": a.get("last", 0)}
                            for c, a in accounts.items()], key=lambda x: -x["last"]),
        "inviteRequests": {
            "pending": sorted(_pending_requests(), key=lambda r: -r.get("ts", 0)),
            "recent": sorted([r for r in _load(REQUESTS_F, []) if r.get("status") != "pending"],
                             key=lambda r: -(r.get("approvedTs") or r.get("closedTs") or r.get("ts", 0)))[:20],
        },
        "feedback": list(reversed(_load(FEEDBACK_F, [])[-40:])),
    }


@app.get("/api/admin-summary")
async def admin_summary(key: str = ""):
    """Public (behind Caddy allowlist) — the Parish Ledger card in the warden's admin
    panel. Auth is the same sha256(raw key) check as the client-side warden login
    (ADMIN_HASHES above mirrors src/defs.js's ADMIN_HASHES). Redacted: no pid, no ip —
    this is reachable from the public internet, unlike /api/overview.
    """
    if hashlib.sha256(key.encode()).hexdigest() not in ADMIN_HASHES:
        return {"error": "unauthorized"}
    now = time.time()
    sessions = _load(SESSIONS_F, [])
    live_by_pid = {}
    for s in sessions[-500:]:
        if now - s["ts"] < 180:
            live_by_pid[s["pid"]] = s  # last-seen entry per pid, dedup across worlds
    live = list(live_by_pid.values())
    recent = [{"name": s.get("name") or "?", "loc": s.get("loc") or "?",
               "room": s.get("room") or "solo"} for s in sorted(live, key=lambda s: -s["ts"])[:8]]
    brain_status = "offline"
    try:
        async with httpx.AsyncClient(timeout=3) as c:
            brain_status = (await c.get(BRAIN + "/status")).json().get("status", "ok")
    except Exception:
        pass
    relay_status = "offline"
    try:
        r = httpx.get(f"{RELAY}/status", timeout=2)
        if r.status_code == 200:
            relay_status = "ok"
    except Exception:
        pass
    return {
        "online": len(live),
        "live": len(live),
        "recent": recent,
        "brain": brain_status,
        "relay": relay_status,
    }


@app.get("/api/codes")
def list_codes():
    """Private: full invite list wi' claim status (for handing out)."""
    codes = _load(CODES_F, {})
    accounts = _load(ACCOUNTS_F, {})
    return {c: (accounts[c]["name"] if c in accounts else None) for c in sorted(codes)}


# ---------------- LAN-only: the Admiralty Board's desk (:8099 admin app) ----------------
@app.get("/api/codes-full")
def list_codes_full():
    """Private: the invite ledger wi' room, claimant an' last-seen — one row per code."""
    codes = _load(CODES_F, {})
    accounts = _load(ACCOUNTS_F, {})
    out = []
    for c in sorted(codes):
        a = accounts.get(c)
        entry = codes[c] if isinstance(codes[c], dict) else {}
        out.append({
            "code": c,
            "room": _room_for_code(c, entry, a),
            "name": a.get("name") if a else None,
            "last": a.get("last") if a else None,
        })
    return {"codes": out}


@app.post("/api/mint")
async def mint_direct(req: Request):
    """Private: mint an invite for ANY room (t' Admiralty Board's mint button)."""
    try:
        d = await req.json()
    except Exception:
        d = {}
    room = str(d.get("room", "moor")).strip().lower()
    if not ROOM_RE.match(room):
        return {"ok": False, "err": "bad room"}
    codes = _load(CODES_F, {})
    for _ in range(80):
        w1, w2 = secrets.choice(MINT_W1), secrets.choice(MINT_W2)
        if w1 == w2:
            continue
        n = secrets.randbelow(80) + 10
        code = f"{w1}-{w2}-{n:02d}"
        if code in codes or not CODE_RE.match(code):
            continue
        codes[code] = {"room": room}
        _save(CODES_F, codes)
        return {"ok": True, "code": code, "room": room}
    return {"ok": False, "err": "could not mint a unique code"}


@app.post("/api/revoke")
async def revoke_direct(req: Request):
    """Private: revoke a code — its account an' any live ws tokens go wi' it."""
    try:
        d = await req.json()
    except Exception:
        return {"ok": False, "err": "bad request"}
    code = str(d.get("code", "")).strip().lower()
    codes = _load(CODES_F, {})
    if code not in codes:
        return {"ok": False, "err": "no such code"}
    del codes[code]
    _save(CODES_F, codes)
    accounts = _load(ACCOUNTS_F, {})
    if code in accounts:
        del accounts[code]
        _save(ACCOUNTS_F, accounts)
    acct_id = hashlib.sha1(code.encode()).hexdigest()[:10]
    tokens = _load(WS_TOKENS_F, {})
    live = {t: v for t, v in tokens.items() if v.get("acct") != acct_id}
    if len(live) != len(tokens):
        _save(WS_TOKENS_F, live)
    return {"ok": True, "code": code}


PAGE = """<!doctype html><html><head><meta charset="utf-8">
<title>Moorstead — t' Parish Ledger</title>
<style>
body{background:#14160f;color:#d8d2c0;font-family:'Segoe UI',sans-serif;margin:0;padding:24px}
h1{color:#d8b95a;letter-spacing:2px;margin:0 0 4px}
.sub{color:#8a8478;font-style:italic;margin-bottom:14px}
h2{color:#d8b95a;font-size:16px;border-bottom:1px solid #4a4438;padding-bottom:4px;margin-top:26px}
table{border-collapse:collapse;width:100%;font-size:13px}
th{text-align:left;color:#b0a890;font-weight:600;padding:4px 10px 4px 0}
td{padding:4px 10px 4px 0;border-top:1px solid #2c2920;vertical-align:top}
.live{color:#9ec27a;font-weight:700}.pid{color:#6a655a;font-size:11px;font-family:monospace}
.conv{background:#1c1e15;border:1px solid #2c2920;border-radius:6px;padding:10px 14px;margin:8px 0;font-size:13px}
.conv b{color:#d8b95a}.you{color:#9ec27a}.them{color:#d8d2c0}
.summary{color:#8a8478;font-style:italic;font-size:12px}
.ok{color:#9ec27a}.bad{color:#d87a5a}.warn{color:#d8b95a}.muted{color:#6a655a}
.cards{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px}
.card{background:#1c1e15;border:1px solid #2c2920;border-radius:6px;padding:10px 16px;min-width:130px}
.card .v{font-size:22px;font-weight:700;color:#e8e2d0}.card .k{font-size:11px;color:#8a8478}
.bar{height:6px;background:#2c2920;border-radius:3px;margin-top:6px;overflow:hidden}
.bar i{display:block;height:100%;background:#9ec27a}
.bar i.hot{background:#d87a5a}
a{color:#9ec27a}
</style></head><body>
<h1>MOORSTEAD &mdash; T&rsquo; PARISH LEDGER</h1>
<div class="sub">Players, natters an&rsquo; t&rsquo; health o&rsquo; t&rsquo; EVO. Refreshes every 15s. <a href="/api/codes">invite codes</a></div>
<div id="content">Loading...</div>
<script>
async function setRoom(code, cur){
  const room = prompt('World-room for '+code+' (moor = grown-ups, bairns = kids):', cur);
  if(!room) return;
  const r = await fetch('/api/setroom',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:code,room:room.trim().toLowerCase()})});
  const d = await r.json();
  alert(d.ok ? code+' -> '+d.room : ('nay: '+(d.err||'failed')));
  location.reload();
}
async function respondInvite(id, action){
  let room='moor';
  if(action==='approve'){
    room=(prompt('Adult world room (moor, dale, crag, tarn):','moor')||'').trim().toLowerCase();
    if(!room) return;
  }
  const r=await fetch('/api/request-invite/respond',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,action,room})});
  const d=await r.json();
  if(!d.ok){alert('nay: '+(d.err||'failed'));return;}
  if(action==='approve') alert('Minted '+d.code+' ('+d.room+') for '+d.email+'\\nEmail them thi code.');
  location.reload();
}
const ago=(now,t)=>{const s=now-t;if(s<90)return Math.round(s)+'s ago';if(s<5400)return Math.round(s/60)+'m ago';if(s<90000)return (s/3600).toFixed(1)+'h ago';return Math.round(s/86400)+'d ago';};
const bar=(v,max,hotAt)=>'<div class="bar"><i'+(v/max>(hotAt||0.85)?' class="hot"':'')+' style="width:'+Math.min(100,100*v/max)+'%"></i></div>';
async function refresh(){
  const d=await (await fetch('/api/overview')).json();
  const s=d.sys||{}, t=d.talk||{};
  let h='';
  const st=d.stats||{};
  h+='<h2>Site visitors</h2><div class="cards">';
  h+='<div class="card"><div class="v">'+st.total+'</div><div class="k">browsers ever seen</div></div>';
  h+='<div class="card"><div class="v">'+st.today+'</div><div class="k">active today (UTC)</div></div>';
  h+='<div class="card"><div class="v">'+st.week+'</div><div class="k">active last 7 days</div></div>';
  h+='<div class="card"><div class="v">'+st.returning+'</div><div class="k">returning visitors</div></div>';
  h+='</div>';
  h+='<h2>Recent site activity</h2><table><tr><th>When</th><th>Event</th><th>Name</th><th>IP</th><th>Browser id</th></tr>';
  for(const v of (d.recentVisits||[])) h+='<tr><td>'+ago(d.now,v.ts)+'</td><td>'+v.event+'</td><td>'+(v.name||'(anon)')+'</td><td>'+v.ip+'</td><td class="pid">'+v.pid.slice(0,12)+'</td></tr>';
  h+='</table>';
  h+='<h2>EVO diagnostics</h2><div class="cards">';
  if(s.load) h+='<div class="card"><div class="v">'+s.load[0]+'</div><div class="k">CPU load (1m) / '+s.cores+' cores</div>'+bar(s.load[0],s.cores)+'</div>';
  if(s.memUsedGB!==undefined) h+='<div class="card"><div class="v">'+s.memUsedGB+' / '+s.memTotalGB+' GB</div><div class="k">system RAM</div>'+bar(s.memUsedGB,s.memTotalGB)+'</div>';
  if(s.vramUsedGB!==undefined) h+='<div class="card"><div class="v">'+s.vramUsedGB+' / '+s.vramTotalGB+' GB</div><div class="k">GPU VRAM</div>'+bar(s.vramUsedGB,s.vramTotalGB)+'</div>';
  if(s.gpuUse!==undefined) h+='<div class="card"><div class="v">'+s.gpuUse+'%</div><div class="k">GPU busy</div>'+bar(s.gpuUse,100)+'</div>';
  if(s.gpuTemp!==undefined) h+='<div class="card"><div class="v">'+s.gpuTemp+'&deg;C</div><div class="k">GPU temp</div>'+bar(s.gpuTemp,100,0.85)+'</div>';
  if(s.diskUsedGB!==undefined) h+='<div class="card"><div class="v">'+s.diskUsedGB+' / '+s.diskTotalGB+' GB</div><div class="k">disk</div>'+bar(s.diskUsedGB,s.diskTotalGB)+'</div>';
  h+='</div>';
  h+='<h2>LLM load (villager brain)</h2><div class="cards">';
  h+='<div class="card"><div class="v '+(d.llm.status==='ok'?'ok':'bad')+'">'+(d.llm.status==='ok'?'UP':'DOWN')+'</div><div class="k">gemma-4-e4b &middot; 32 slots</div></div>';
  h+='<div class="card"><div class="v">'+(t.talksLast5Min??0)+'</div><div class="k">chats last 5 min</div></div>';
  h+='<div class="card"><div class="v">'+(t.talksLastHour??0)+'</div><div class="k">chats last hour</div></div>';
  if(t.p50) h+='<div class="card"><div class="v">'+t.p50+'s</div><div class="k">median reply</div></div>';
  if(t.p95) h+='<div class="card"><div class="v '+(t.p95>20?'bad':t.p95>12?'warn':'')+'">'+t.p95+'s</div><div class="k">p95 reply</div></div>';
  h+='</div>';
  h+='<h2>Services</h2><table>';
  for(const [k,v] of Object.entries(d.services)) h+='<tr><td>'+k+'</td><td class="'+(v==='active'?'ok':'bad')+'">'+v+'</td></tr>';
  h+='</table>';
  h+='<h2>Invites</h2><div class="cards"><div class="card"><div class="v">'+d.codes.claimed+' / '+d.codes.total+'</div><div class="k">codes claimed</div></div>';
  h+='<div class="card"><div class="v">'+(d.inviteRequests?.pending?.length||0)+'</div><div class="k">invite requests waiting</div></div>';
  h+='<div class="card"><div class="v">'+(d.feedback?.length||0)+'</div><div class="k">recent feedback (last 40)</div></div></div>';
  const fb=d.feedback||[];
  if(fb.length){
    h+='<h2>Feedback &amp; bugs</h2><div class="muted">From t\\' title screen an\\' about page — includes URL, browser, an\\' any in-game coords sent.</div><table><tr><th>When</th><th>Kind</th><th>Message</th><th>Email</th><th>Page</th><th>Where</th><th>IP</th></tr>';
    for(const f of fb) {
      const pos=f.context?.pos;
      const where=(f.context?.loc||'')+(pos&&pos.x!==undefined?' @ '+pos.x+','+pos.y+','+pos.z:'');
      const msg=(f.message||'').replace(/</g,'&lt;').slice(0,180);
      h+='<tr><td>'+ago(d.now,f.ts)+'</td><td>'+f.kind+'</td><td>'+msg+'</td><td>'+(f.email||'')+'</td><td>'+(f.context?.page||'')+'</td><td>'+(where||'')+'</td><td>'+f.ip+'</td></tr>';
    }
    h+='</table>';
  }
  const pending=d.inviteRequests?.pending||[];
  if(pending.length){
    h+='<h2>Invite requests (adult rooms)</h2><div class="muted">Approve mints a fresh code — email it to them thysen.</div><table><tr><th>When</th><th>Email</th><th>Name</th><th>Note</th><th>IP</th><th></th></tr>';
    for(const r of pending) h+='<tr><td>'+ago(d.now,r.ts)+'</td><td>'+r.email+'</td><td>'+(r.name||'')+'</td><td>'+(r.note||'')+'</td><td>'+r.ip+'</td><td><button onclick="respondInvite(&quot;'+r.id+'&quot;,&quot;approve&quot;)">approve</button> <button onclick="respondInvite(&quot;'+r.id+'&quot;,&quot;reject&quot;)">reject</button></td></tr>';
    h+='</table>';
  }
  const recent=d.inviteRequests?.recent||[];
  if(recent.length){
    h+='<h2>Recent invite decisions</h2><table><tr><th>When</th><th>Email</th><th>Status</th><th>Code</th><th>Room</th></tr>';
    for(const r of recent) h+='<tr><td>'+ago(d.now,r.approvedTs||r.closedTs||r.ts)+'</td><td>'+r.email+'</td><td>'+r.status+'</td><td class="pid">'+(r.code||'')+'</td><td>'+(r.room||'')+'</td></tr>';
    h+='</table>';
  }
  if(d.accounts&&d.accounts.length){h+='<table><tr><th>Account</th><th>Code</th><th>World (room)</th><th>Last login</th><th></th></tr>';
    for(const a of d.accounts) h+='<tr><td>'+a.name+'</td><td class="pid">'+a.code+'</td><td><b>'+a.room+'</b></td><td>'+ago(d.now,a.last)+'</td><td><button onclick="setRoom(&quot;'+a.code+'&quot;,&quot;'+a.room+'&quot;)">move</button></td></tr>';
    h+='</table>';}
  h+='<h2>On t\\' moor now ('+d.live.length+')</h2>';
  if(!d.live.length) h+='<div class="muted">Nob&rsquo;dy out just now.</div>';
  else{h+='<table><tr><th>Name</th><th>Where</th><th>Day</th><th>Standing</th><th>Croft</th><th>Ventures</th><th>IP</th><th>Seen</th></tr>';
    for(const x of d.live) h+='<tr><td class="live">'+(x.name||'(nameless)')+'</td><td>'+x.loc+'</td><td>'+x.day+'</td><td>'+x.standing+'</td><td>'+x.croft+'/4</td><td>'+x.quests+'</td><td>'+x.ip+'</td><td>'+ago(d.now,x.ts)+'</td></tr>';h+='</table>';}
  const ps=Object.entries(d.players).sort((a,b)=>(b[1].visitDays?.length||0)-(a[1].visitDays?.length||0)||b[1].last-a[1].last);
  h+='<h2>All browsers / players ('+ps.length+')</h2><div class="muted">Sorted by distinct visit days, then last seen. Minutes = in-world heartbeats only.</div><table><tr><th>Name(s)</th><th>Days</th><th>Visits</th><th>Landings</th><th>Minutes</th><th>Worlds</th><th>Last IP</th><th>First</th><th>Last</th><th>id</th></tr>';
  for(const [pid,p] of ps) h+='<tr><td>'+(p.names.join(', ')||'(nameless)')+'</td><td>'+(p.visitDays?.length||0)+'</td><td>'+(p.visits||0)+'</td><td>'+(p.landings||0)+'</td><td>'+(p.minutes||0)+'</td><td>'+Object.keys(p.worlds||{}).length+'</td><td>'+(p.lastIp||'')+'</td><td>'+ago(d.now,p.first)+'</td><td>'+ago(d.now,p.last)+'</td><td class="pid">'+pid.slice(0,12)+'</td></tr>';
  h+='</table>';
  h+='<h2>Latest natters</h2>';
  for(const c of d.conversations.slice(0,8)){
    h+='<div class="conv"><span class="pid">'+c.pid.slice(0,18)+'</span> &mdash; '+ago(d.now,c.mtime);
    for(const ch of c.chars){
      h+='<div style="margin-top:6px"><b>'+(ch.playerName?ch.playerName+' &harr; ':'')+ch.char.replace('char_','villager ')+'</b> (trust '+ch.trust+')';
      if(ch.summary) h+='<div class="summary">remembers: '+ch.summary+'</div>';
      for(const m of ch.last) h+='<div class="'+(m.role==='user'?'you':'them')+'">'+(m.role==='user'?'&#9656; ':'&#9666; ')+m.text+'</div>';
      h+='</div>';}
    h+='</div>';}
  h+='<h2>Backend traffic by IP</h2><div class="muted">Caddy log: brain / dash / ws API calls — not static Vercel page loads.</div><table><tr><th>IP</th><th>Requests</th><th>First</th><th>Last</th></tr>';
  for(const v of d.visitors.slice(0,30)) h+='<tr><td>'+v.ip+'</td><td>'+v.n+'</td><td>'+ago(d.now,v.first)+'</td><td>'+ago(d.now,v.last)+'</td></tr>';
  h+='</table>';
  document.getElementById('content').innerHTML=h;
}
refresh();setInterval(refresh,15000);
</script></body></html>"""


@app.get("/", response_class=HTMLResponse)
def index():
    return PAGE
