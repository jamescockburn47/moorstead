"""Minimal mock-relay test for clint_body.py.

Spins up a tiny websockets server that:
  1. Accepts a connection from ClintBody.
  2. Sends an `init` message.
  3. Sends a `join` message for a fake player.
  4. Asserts it receives at least one `pos` message.
  5. Asserts it receives a `chat` message containing the greeting text.

Run: python _test_mock.py
Exit 0 = pass, exit 1 = fail.
"""

import asyncio
import json
import os
import sys
import threading

# Point the bot at our mock server
os.environ["RELAY_WS_BASE"] = "ws://127.0.0.1:19876/ws"
os.environ["CLINT_BODY_ROOM"] = "moor"
os.environ["CLINT_BODY_PID"] = "clint-body"
os.environ["CLINT_BODY_NAME"] = "Clint"
os.environ["CLINT_BODY_ENABLED"] = "true"

import websockets  # noqa: E402 (after env set)

# ---------------------------------------------------------------------------
# Shared state between mock server and test runner
received_pos: list[dict] = []
received_chat: list[dict] = []
server_ready = threading.Event()
test_done = threading.Event()
PASS = threading.Event()
# ---------------------------------------------------------------------------


async def mock_handler(ws):
    """Handle one connection from the bot."""
    # 1. Send init
    await ws.send(json.dumps({
        "type": "init",
        "seed": "t-shared-moor",
        "time": 0.5,
        "edits": [],
        "players": {},
        "save": None,
    }))

    # 2. Give the bot a moment to send its first pos, then send a join
    await asyncio.sleep(0.3)
    await ws.send(json.dumps({
        "type": "join",
        "pid": "testplayer1",
        "name": "Alice",
    }))

    # 3. Collect messages for up to 5 seconds
    deadline = asyncio.get_event_loop().time() + 5.0
    while asyncio.get_event_loop().time() < deadline:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=0.2)
            try:
                m = json.loads(raw)
                if m.get("type") == "pos":
                    received_pos.append(m)
                elif m.get("type") == "chat":
                    received_chat.append(m)
            except json.JSONDecodeError:
                pass
        except asyncio.TimeoutError:
            pass
        # Stop once we have both
        if received_pos and received_chat:
            break

    test_done.set()


async def run_server():
    async with websockets.serve(mock_handler, "127.0.0.1", 19876):
        server_ready.set()
        await asyncio.get_event_loop().run_in_executor(None, test_done.wait)


def start_server():
    asyncio.run(run_server())


# ---------------------------------------------------------------------------
# Run the bot in a thread (it has its own asyncio.run)
# ---------------------------------------------------------------------------

def start_bot():
    # Import AFTER env vars are set
    import importlib, clint_body  # noqa: E401
    importlib.reload(clint_body)  # pick up env
    try:
        clint_body.asyncio.run(clint_body.run())
    except Exception:
        pass  # bot will error when server closes — that's fine


if __name__ == "__main__":
    # Server thread
    st = threading.Thread(target=start_server, daemon=True)
    st.start()
    server_ready.wait(timeout=3.0)
    if not server_ready.is_set():
        print("FAIL: mock server did not start")
        sys.exit(1)

    # Bot thread (daemon — we kill it by letting the process exit)
    bt = threading.Thread(target=start_bot, daemon=True)
    bt.start()

    # Wait for the test to complete
    test_done.wait(timeout=8.0)

    # Assertions
    failures = []

    if not received_pos:
        failures.append("FAIL: bot never sent a pos message")
    else:
        pos = received_pos[0]
        if pos.get("type") != "pos":
            failures.append(f"FAIL: first pos message has wrong type: {pos}")
        if not isinstance(pos.get("x"), (int, float)):
            failures.append(f"FAIL: pos.x is not a number: {pos}")

    if not received_chat:
        failures.append("FAIL: bot never sent a chat (greeting) message")
    else:
        chat = received_chat[0]
        text = chat.get("text", "")
        if "Alice" not in text and "moor" not in text.lower():
            failures.append(
                f"FAIL: greeting text doesn't reference player name or moor: {text!r}"
            )
        if len(text) > 200:
            failures.append(f"FAIL: chat text exceeds 200 chars ({len(text)})")

    if failures:
        for f in failures:
            print(f)
        sys.exit(1)
    else:
        print(f"PASS: received {len(received_pos)} pos message(s), greeting: {received_chat[0]['text']!r}")
        sys.exit(0)
