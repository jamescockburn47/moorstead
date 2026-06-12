# One-shot patch: world-rooms on t' dash (run on t' EVO, then delete or keep for t' record).
# - claim inherits room frae t' code entry an' returns it
# - POST /api/setroom moves a code/account between rooms (LAN-only by Caddy policy)
# - overview lists accounts wi' rooms; ledger page gets a table wi' a move button
# - 20 bairn-* codes (room=bairns); wardens.json fixed to t' sha1-prefix acct
import hashlib
import json

P = "/home/james/moorstead/dash/app.py"
s = open(P).read()

old = '''    acct = accounts.get(code)
    if acct is None:
        if not name:
            return {"ok": False, "err": "Tell us thi name an' all."}
        acct = {"name": name, "pids": [], "created": time.time()}'''
new = '''    acct = accounts.get(code)
    entry = codes.get(code)
    if acct is None:
        if not name:
            return {"ok": False, "err": "Tell us thi name an' all."}
        acct = {"name": name, "pids": [], "created": time.time(),
                "room": (entry.get("room") if isinstance(entry, dict) else None) or "moor"}'''
assert old in s, "claim create block not found"
s = s.replace(old, new, 1)

old = '''    return {"ok": True, "name": acct["name"],
            "acct": hashlib.sha1(code.encode()).hexdigest()[:10]}'''
new = '''    return {"ok": True, "name": acct["name"],
            "room": acct.get("room", "moor"),
            "acct": hashlib.sha1(code.encode()).hexdigest()[:10]}'''
assert old in s, "claim return not found"
s = s.replace(old, new, 1)

anchor = "# ---------------- heartbeat ----------------"
assert anchor in s, "heartbeat anchor not found"
setroom = '''ROOM_RE = re.compile(r"^[a-z0-9-]{1,24}$")


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


# ---------------- heartbeat ----------------'''
s = s.replace(anchor, setroom, 1)

old = '''        "codes": {"total": len(codes),
                  "claimed": len(accounts),
                  "names": sorted(a["name"] for a in accounts.values())},'''
new = '''        "codes": {"total": len(codes),
                  "claimed": len(accounts),
                  "names": sorted(a["name"] for a in accounts.values())},
        "accounts": sorted([{"code": c, "name": a.get("name", "?"),
                             "room": a.get("room", "moor"), "last": a.get("last", 0)}
                            for c, a in accounts.items()], key=lambda x: -x["last"]),'''
assert old in s, "overview codes block not found"
s = s.replace(old, new, 1)

old = """  if(d.codes.names.length) h+='<div class="muted" style="margin-top:6px">'+d.codes.names.join(' &middot; ')+'</div>';"""
new = """  if(d.accounts&&d.accounts.length){h+='<table><tr><th>Account</th><th>Code</th><th>World (room)</th><th></th></tr>';
    for(const a of d.accounts) h+='<tr><td>'+a.name+'</td><td class="pid">'+a.code+'</td><td><b>'+a.room+'</b></td><td><button onclick="setRoom(&quot;'+a.code+'&quot;,&quot;'+a.room+'&quot;)">move</button></td></tr>';
    h+='</table>';}"""
assert old in s, "ledger names line not found"
s = s.replace(old, new, 1)

old = "const ago=(now,t)=>"
assert old in s, "ago helper not found"
helper = '''async function setRoom(code, cur){
  const room = prompt('World-room for '+code+' (moor = grown-ups, bairns = kids):', cur);
  if(!room) return;
  const r = await fetch('/api/setroom',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:code,room:room.trim().toLowerCase()})});
  const d = await r.json();
  alert(d.ok ? code+' -> '+d.room : ('nay: '+(d.err||'failed')));
  location.reload();
}
const ago=(now,t)=>'''
s = s.replace(old, helper, 1)

open(P, "w").write(s)
print("app.py patched")

# kid codes + warden pid fix
CP = "/home/james/moorstead/dash/codes.json"
codes = json.load(open(CP))
words = ["heather", "curlew", "bilberry", "gorse", "bracken", "lapwing", "merlin", "foxglove", "tarn", "syke",
         "moss", "rigg", "howe", "thorn", "ling", "whin", "crag", "fell", "gill", "dale"]
added = 0
for i, w in enumerate(words):
    code = "bairn-%s-%d" % (w, 11 + i * 3)
    if code not in codes:
        codes[code] = {"room": "bairns"}
        added += 1
json.dump(codes, open(CP, "w"), indent=1)
print("kid codes added:", added)

wacct = hashlib.sha1(b"bilberry-gloaming-67").hexdigest()[:10]
json.dump({"pids": ["a" + wacct]}, open("/home/james/moorstead/world/wardens.json", "w"), indent=1)
print("wardens.json fixed: a" + wacct)
