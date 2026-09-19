"""Prepare fail-closed source patches; never touches live paths or starts services."""
import argparse
import ast
import hashlib
from pathlib import Path

BASELINES = {
    "server.py": "884f200eee30172216ff0875fdb3119d41f5f59a51ac0080be846d98bb42fd8c",
    "app.py": "f9f8d7c226274f4275c345cd31defefafd589d7345b28580be8d510e5d4995eb",
    "Caddyfile": "89bf09f58b49b7ba5221acc1448df131071f27d292b2ee1a09ab56fec26d4468",
}


def replace_one(source, old, new):
    if source.count(old) != 1:
        raise ValueError(f"Expected exactly one integration anchor: {old[:70]!r}")
    return source.replace(old, new, 1)


def relay(source):
    source = replace_one(source, '@app.websocket("/ws")',
        'from freeplay_service import mount_freeplay\n'
        'freeplay_hub = mount_freeplay(app, check_ws_access, banned, DATA)\n\n\n'
        '@app.websocket("/ws")')
    source = replace_one(source, '    r = room(rid)\n',
        '    if rid == "family-freeplay":\n'
        '        await reject_ws(ws, "Open the separate /freeplay entrance for this world.")\n'
        '        return\n'
        '    r = room(rid)\n')
    return source


def dashboard(source):
    source = replace_one(source,
        '@app.post("/auth/claim")\nasync def claim(req: Request):\n',
        '@app.post("/auth/claim")\nasync def claim(req: Request):\n'
        '    return await _claim_for_room(req)\n\n\n'
        '@app.post("/auth/freeplay-claim")\nasync def freeplay_claim(req: Request):\n'
        '    return await _claim_for_room(req, "family-freeplay")\n\n\n'
        'async def _claim_for_room(req: Request, required_room=None):\n')
    source = replace_one(source, '    acct = accounts.get(code)\n    if acct is None:',
        '    acct = accounts.get(code)\n'
        '    if required_room and (not isinstance(entry, dict) or entry.get("room") != required_room\n'
        '                          or (acct and acct.get("room") != required_room)):\n'
        '        return {"ok": False, "err": "That invite is not for this Free Play world."}\n'
        '    if acct is None:')
    source = replace_one(source, '    acct["room"] = _pick_room(base, acct.get("room"))',
        '    acct["room"] = required_room or _pick_room(base, acct.get("room"))')
    source = replace_one(source, '            "daemon": daemon}',
        '            "daemon": daemon,\n'
        '            **({"edition": "freeplay"} if required_room else {})}')
    # Shared input parser now refuses arrays/scalars before accessing .get().
    source = replace_one(source, 'async def _claim_for_room(req: Request, required_room=None):\n'
        '    try:\n        d = await req.json()\n',
        'async def _claim_for_room(req: Request, required_room=None):\n'
        '    try:\n        d = await req.json()\n'
        '        if not isinstance(d, dict):\n'
        '            return {"ok": False, "err": "bad request"}\n')
    return source


def caddy(source):
    source = replace_one(source, '\thandle /ws {\n',
        '\thandle /freeplay/ws {\n\t\treverse_proxy 127.0.0.1:8096\n\t}\n\n\thandle /ws {\n')
    source = replace_one(source,
        '@notallowed not path /ping /auth/claim /visit /request-invite /feedback /api/admin-summary',
        '@notallowed not path /ping /auth/claim /auth/freeplay-claim /visit /request-invite /feedback /api/admin-summary')
    return source


def prepare(source_directory, output_directory):
    source_directory, output_directory = Path(source_directory), Path(output_directory)
    if source_directory.resolve() == output_directory.resolve():
        raise ValueError("Source and output directories must be different")
    output_directory.mkdir(parents=True, exist_ok=True)
    for name, transform in (("server.py", relay), ("app.py", dashboard), ("Caddyfile", caddy)):
        raw = (source_directory / name).read_bytes()
        if name in BASELINES and hashlib.sha256(raw).hexdigest() != BASELINES[name]:
            raise ValueError(f"{name} changed from the inspected baseline; merge and review explicitly")
        result = transform(raw.decode().replace("\r\n", "\n"))
        if name.endswith(".py"):
            ast.parse(result)
        (output_directory / name).write_text(result, encoding="utf-8", newline="\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_directory", help="Read-only copies of current EVO service sources")
    parser.add_argument("output_directory", help="Separate local staging directory")
    args = parser.parse_args()
    prepare(args.source_directory, args.output_directory)
