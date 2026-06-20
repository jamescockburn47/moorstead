#!/usr/bin/env python3
"""One-shot: add WS session tokens to live dash/app.py on the EVO."""
import re
from pathlib import Path

P = Path("/home/james/moorstead/dash/app.py")
s = P.read_text()
stamp = P.with_suffix(".py.bak-20260620-tokens")
if not stamp.exists():
    stamp.write_text(s)

if "WS_TOKENS_F" not in s:
    s = s.replace(
        "import re\nimport shutil",
        "import re\nimport secrets\nimport shutil",
    )
    s = s.replace(
        "ACCOUNTS_F = DASH / \"accounts.json\"\nMEM = ROOT",
        "ACCOUNTS_F = DASH / \"accounts.json\"\nWS_TOKENS_F = DASH / \"ws_tokens.json\"\nMEM = ROOT",
    )

helpers = '''

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


def _mint_ws_token(acct_id, room, name):
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

'''
if "_mint_ws_token" not in s:
    s = s.replace("# ---------------- login ----------------", helpers + "# ---------------- login ----------------", 1)

old_tail = '''    if pid and PID_RE.match(pid) and pid not in acct["pids"]:
        acct["pids"] = (acct["pids"] + [pid])[-6:]
    acct["last"] = time.time()
    accounts[code] = acct
    _save(ACCOUNTS_F, accounts)
    return {"ok": True, "name": acct["name"],
            "room": acct.get("room", "moor"),
            "acct": hashlib.sha1(code.encode()).hexdigest()[:10]}'''

new_tail = '''    if not acct.get("room"):
        acct["room"] = _room_for_code(code, entry, acct)
    if pid and PID_RE.match(pid) and pid not in acct["pids"]:
        acct["pids"] = (acct["pids"] + [pid])[-6:]
    acct["last"] = time.time()
    accounts[code] = acct
    _save(ACCOUNTS_F, accounts)
    acct_id = hashlib.sha1(code.encode()).hexdigest()[:10]
    room = acct["room"]
    token = _mint_ws_token(acct_id, room, acct["name"])
    return {"ok": True, "name": acct["name"],
            "room": room,
            "acct": acct_id,
            "token": token}'''

if '"token": token' not in s:
    assert old_tail in s, "claim tail not found — dash already patched or layout changed"
    s = s.replace(old_tail, new_tail, 1)

P.write_text(s)
print("patched", P)
