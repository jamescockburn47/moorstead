"""Loopback-only offline fixture. Synthetic identities; never loads live files."""
import argparse
import hashlib
from pathlib import Path
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).parent / "worldsvc"))
from fastapi import FastAPI, Request
from freeplay_rules import ROOM
from freeplay_service import mount_freeplay

IDENTITIES = {"henry-test-only": "Henry", "james-test-only": "James"}


def fixture_app(data, battlefield=None):
    app = FastAPI()
    sessions = {}

    def authenticate(room, pid, name, token):
        session = sessions.get(token)
        ok = bool(session and session["room"] == room and session["exp"] > time.time()
                  and pid == "a" + session["acct"])
        return ok, session if ok else None, None

    @app.post("/auth/freeplay-claim")
    async def claim(req: Request):
        value = await req.json()
        code = value.get("code") if isinstance(value, dict) else None
        if not isinstance(code, str) or code not in IDENTITIES:
            return {"ok": False, "err": "Use an offline fixture code."}
        acct = hashlib.sha1(code.encode()).hexdigest()[:10]
        token = "fixture-session-" + acct
        session = {"room": ROOM, "name": IDENTITIES[code], "acct": acct, "exp": time.time() + 3600}
        sessions[token] = session
        return {"ok": True, "edition": "freeplay", "token": token, **session}

    hub = mount_freeplay(app, authenticate, lambda pid, name: False, Path(data), battlefield)
    app.state.freeplay_hub = hub
    app.state.sessions = sessions
    return app


if __name__ == "__main__":
    import uvicorn
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--data", type=Path, help="Optional disposable fixture directory, never live world data")
    parser.add_argument("--battlefield", type=Path, help="Verified generated battlefield header")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="moorstead-freeplay-") as temporary:
        uvicorn.run(fixture_app(args.data or temporary, args.battlefield), host="127.0.0.1", port=args.port,
                    ws_max_size=16384, log_level="warning", access_log=False)
