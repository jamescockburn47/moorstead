"""Moorstead parish ledger — players, login codes, and full EVO diagnostics.

:8095 on LAN/Tailscale only. The Cloudflare tunnel routes just two endpoints
here (POST /ping, POST /auth/claim); the dashboard and admin data never leave
the house.
"""
import hashlib
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
CODES_F = DASH / "codes.json"
ACCOUNTS_F = DASH / "accounts.json"
WS_TOKENS_F = DASH / "ws_tokens.json"
MEM = ROOT / "brain_memory" / "players"
CADDY_LOG = Path("/var/log/caddy/moorstead.log")
BRAIN = "http://127.0.0.1:8010"
LLM = "http://127.0.0.1:8086"
RELAY = "http://127.0.0.1:8096"
ROOM_CAP = 15

PID_RE = re.compile(r"^[a-z0-9-]{4,40}$")
CODE_RE = re.compile(r"^[a-z]+-[a-z]+-\d{2}$")

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
    return {"ok": True, "name": acct["name"],
            "room": room,
            "acct": acct_id,
            "token": token}


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
    entry = {
        "ts": time.time(), "pid": pid, "name": name, "seed": seed,
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
    if name and name not in p["names"]:
        p["names"] = (p["names"] + [name])[-5:]
    if seed:
        p["worlds"][seed] = {"day": entry["day"], "standing": entry["standing"],
                             "croft": entry["croft"], "quests": entry["quests"],
                             "loc": entry["loc"], "last": time.time()}
    _save(PLAYERS_F, players)
    return {"ok": True}


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
    return {
        "now": now,
        "live": list(live.values()),
        "players": _load(PLAYERS_F, {}),
        "visitors": _visitors_from_caddy(),
        "conversations": _conversations(),
        "brain": brain, "llm": llm,
        "sys": _sys_stats(),
        "talk": _talk_stats(),
        "services": _services(),
        "codes": {"total": len(codes),
                  "claimed": len(accounts),
                  "names": sorted(a["name"] for a in accounts.values())},
    }


@app.get("/api/codes")
def list_codes():
    """Private: full invite list wi' claim status (for handing out)."""
    codes = _load(CODES_F, {})
    accounts = _load(ACCOUNTS_F, {})
    return {c: (accounts[c]["name"] if c in accounts else None) for c in sorted(codes)}


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
const ago=(now,t)=>{const s=now-t;if(s<90)return Math.round(s)+'s ago';if(s<5400)return Math.round(s/60)+'m ago';if(s<90000)return (s/3600).toFixed(1)+'h ago';return Math.round(s/86400)+'d ago';};
const bar=(v,max,hotAt)=>'<div class="bar"><i'+(v/max>(hotAt||0.85)?' class="hot"':'')+' style="width:'+Math.min(100,100*v/max)+'%"></i></div>';
async function refresh(){
  const d=await (await fetch('/api/overview')).json();
  const s=d.sys||{}, t=d.talk||{};
  let h='';
  h+='<h2>EVO diagnostics</h2><div class="cards">';
  if(s.load) h+='<div class="card"><div class="v">'+s.load[0]+'</div><div class="k">CPU load (1m) / '+s.cores+' cores</div>'+bar(s.load[0],s.cores)+'</div>';
  if(s.memUsedGB!==undefined) h+='<div class="card"><div class="v">'+s.memUsedGB+' / '+s.memTotalGB+' GB</div><div class="k">system RAM</div>'+bar(s.memUsedGB,s.memTotalGB)+'</div>';
  if(s.vramUsedGB!==undefined) h+='<div class="card"><div class="v">'+s.vramUsedGB+' / '+s.vramTotalGB+' GB</div><div class="k">GPU VRAM</div>'+bar(s.vramUsedGB,s.vramTotalGB)+'</div>';
  if(s.gpuUse!==undefined) h+='<div class="card"><div class="v">'+s.gpuUse+'%</div><div class="k">GPU busy</div>'+bar(s.gpuUse,100)+'</div>';
  if(s.gpuTemp!==undefined) h+='<div class="card"><div class="v">'+s.gpuTemp+'&deg;C</div><div class="k">GPU temp</div>'+bar(s.gpuTemp,100,0.85)+'</div>';
  if(s.diskUsedGB!==undefined) h+='<div class="card"><div class="v">'+s.diskUsedGB+' / '+s.diskTotalGB+' GB</div><div class="k">disk</div>'+bar(s.diskUsedGB,s.diskTotalGB)+'</div>';
  h+='</div>';
  h+='<h2>LLM load (villager brain)</h2><div class="cards">';
  h+='<div class="card"><div class="v '+(d.llm.status==='ok'?'ok':'bad')+'">'+(d.llm.status==='ok'?'UP':'DOWN')+'</div><div class="k">gemma-4-31b &middot; 3 slots</div></div>';
  h+='<div class="card"><div class="v">'+(t.talksLast5Min??0)+'</div><div class="k">chats last 5 min</div></div>';
  h+='<div class="card"><div class="v">'+(t.talksLastHour??0)+'</div><div class="k">chats last hour</div></div>';
  if(t.p50) h+='<div class="card"><div class="v">'+t.p50+'s</div><div class="k">median reply</div></div>';
  if(t.p95) h+='<div class="card"><div class="v '+(t.p95>20?'bad':t.p95>12?'warn':'')+'">'+t.p95+'s</div><div class="k">p95 reply</div></div>';
  h+='</div>';
  h+='<h2>Services</h2><table>';
  for(const [k,v] of Object.entries(d.services)) h+='<tr><td>'+k+'</td><td class="'+(v==='active'?'ok':'bad')+'">'+v+'</td></tr>';
  h+='</table>';
  h+='<h2>Invites</h2><div class="cards"><div class="card"><div class="v">'+d.codes.claimed+' / '+d.codes.total+'</div><div class="k">codes claimed</div></div></div>';
  if(d.codes.names.length) h+='<div class="muted" style="margin-top:6px">'+d.codes.names.join(' &middot; ')+'</div>';
  h+='<h2>On t\\' moor now ('+d.live.length+')</h2>';
  if(!d.live.length) h+='<div class="muted">Nob&rsquo;dy out just now.</div>';
  else{h+='<table><tr><th>Name</th><th>Where</th><th>Day</th><th>Standing</th><th>Croft</th><th>Ventures</th><th>IP</th><th>Seen</th></tr>';
    for(const x of d.live) h+='<tr><td class="live">'+(x.name||'(nameless)')+'</td><td>'+x.loc+'</td><td>'+x.day+'</td><td>'+x.standing+'</td><td>'+x.croft+'/4</td><td>'+x.quests+'</td><td>'+x.ip+'</td><td>'+ago(d.now,x.ts)+'</td></tr>';h+='</table>';}
  const ps=Object.entries(d.players).sort((a,b)=>b[1].last-a[1].last);
  h+='<h2>All players ('+ps.length+')</h2><table><tr><th>Name(s)</th><th>Minutes</th><th>Worlds</th><th>Last IP</th><th>First</th><th>Last</th><th>id</th></tr>';
  for(const [pid,p] of ps) h+='<tr><td>'+(p.names.join(', ')||'(nameless)')+'</td><td>'+p.minutes+'</td><td>'+Object.keys(p.worlds||{}).length+'</td><td>'+(p.lastIp||'')+'</td><td>'+ago(d.now,p.first)+'</td><td>'+ago(d.now,p.last)+'</td><td class="pid">'+pid.slice(0,12)+'</td></tr>';
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
  h+='<h2>Visitors by IP</h2><table><tr><th>IP</th><th>Requests</th><th>First</th><th>Last</th></tr>';
  for(const v of d.visitors.slice(0,30)) h+='<tr><td>'+v.ip+'</td><td>'+v.n+'</td><td>'+ago(d.now,v.first)+'</td><td>'+ago(d.now,v.last)+'</td></tr>';
  h+='</table>';
  document.getElementById('content').innerHTML=h;
}
refresh();setInterval(refresh,15000);
</script></body></html>"""


@app.get("/", response_class=HTMLResponse)
def index():
    return PAGE
