# Frozen login excerpt from live dashboard f9f8d7c226274f4275c345cd31defefafd589d7345b28580be8d510e5d4995eb, 2026-09-19.
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


