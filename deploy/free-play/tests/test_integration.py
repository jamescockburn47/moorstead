import ast
import asyncio
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
import sys
import time
import types
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import integrate


class Request:
    def __init__(self, value):
        self.value = value

    async def json(self):
        return self.value


class MissingPath:
    def read_text(self):
        raise FileNotFoundError("No live daemon data in tests")


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.codes = {"family-henry": {"room": "family-freeplay"}, "ordinary-code": {"room": "bairns"}}
        self.accounts = {"ordinary-code": {"room": "bairns", "name": "Original", "pids": []}}
        self.writes, self.tokens = [], []
        transformed = integrate.dashboard(Path(__file__).with_name("live_claim_excerpt.py").read_text())
        module = ast.parse(transformed)
        nodes = [node for node in module.body if isinstance(node, ast.AsyncFunctionDef)]
        for node in nodes:
            node.decorator_list = []
        namespace = {"Request": Request, "re": re, "time": time, "json": json, "hashlib": hashlib,
                     "Path": lambda _: MissingPath(), "CODES_F": "codes", "ACCOUNTS_F": "accounts",
                     "CODE_RE": re.compile(r"^[a-z-]+$"), "PID_RE": re.compile(r"^[a-z0-9-]+$"),
                     "_load": self.load, "_save": self.save, "_mint_ws_token": self.mint,
                     "_room_for_code": lambda code, entry, acct: entry["room"],
                     "_pick_room": lambda base, current: base + "-overflow",
                     "_record_visit": lambda *args: None, "_client_ip": lambda req: "127.0.0.1"}
        exec(compile(ast.Module(body=nodes, type_ignores=[]), "actual-patched-claim", "exec"), namespace)
        self.claim, self.freeplay_claim = namespace["claim"], namespace["freeplay_claim"]

    def load(self, path, default):
        return deepcopy(self.codes if path == "codes" else self.accounts)

    def save(self, path, value):
        self.writes.append((path, deepcopy(value)))
        if path == "accounts":
            self.accounts = deepcopy(value)

    def mint(self, *args):
        self.tokens.append(args)
        return "synthetic-test-token"

    def test_wrong_code_cannot_change_ordinary_account_or_mint(self):
        original = deepcopy(self.accounts)
        result = asyncio.run(self.freeplay_claim(Request({"code": "ordinary-code", "name": "Changed", "pid": "device-1"})))
        self.assertFalse(result["ok"])
        self.assertEqual(self.accounts, original)
        self.assertEqual(self.writes, [])
        self.assertEqual(self.tokens, [])

    def test_freeplay_login_pins_room_and_has_edition_proof(self):
        result = asyncio.run(self.freeplay_claim(Request({"code": "family-henry", "name": "Henry", "pid": "device-1"})))
        self.assertTrue(result["ok"])
        self.assertEqual(result["room"], "family-freeplay")
        self.assertEqual(result["edition"], "freeplay")
        self.assertEqual(self.tokens[0][2], "family-freeplay")
        self.assertEqual(self.accounts["ordinary-code"]["name"], "Original")

    def test_reassigned_existing_account_fails_closed(self):
        self.accounts["family-henry"] = {"room": "bairns", "name": "Original", "pids": []}
        result = asyncio.run(self.freeplay_claim(Request({"code": "family-henry", "name": "Henry"})))
        self.assertFalse(result["ok"])
        self.assertEqual(self.writes, [])
        self.assertEqual(self.tokens, [])

    def test_ordinary_login_preserves_original_sharding(self):
        result = asyncio.run(self.claim(Request({"code": "ordinary-code", "name": "New name"})))
        self.assertTrue(result["ok"])
        self.assertEqual(result["room"], "bairns-overflow")
        self.assertNotIn("edition", result)

    def test_invalid_json_shape_causes_no_write(self):
        for value in (None, [], "text", 1):
            result = asyncio.run(self.freeplay_claim(Request(value)))
            self.assertFalse(result["ok"])
        self.assertEqual(self.writes, [])

    def test_relay_patch_refuses_freeplay_before_ordinary_room_access(self):
        baseline = '@app.websocket("/ws")\nasync def ws_endpoint(ws):\n    rid = ws.room\n    r = room(rid)\n    return r\n'
        transformed = ast.parse(integrate.relay(baseline))
        node = next(node for node in transformed.body if isinstance(node, ast.AsyncFunctionDef))
        node.decorator_list = []
        calls = []

        async def reject(ws, message):
            calls.append("reject")

        namespace = {"reject_ws": reject, "room": lambda rid: calls.append(rid)}
        exec(compile(ast.Module(body=[node], type_ignores=[]), "relay-gate", "exec"), namespace)
        asyncio.run(namespace["ws_endpoint"](types.SimpleNamespace(room="family-freeplay")))
        self.assertEqual(calls, ["reject"])
        asyncio.run(namespace["ws_endpoint"](types.SimpleNamespace(room="bairns")))
        self.assertEqual(calls, ["reject", "bairns"])

    def test_integration_anchor_failure_and_module_limits(self):
        with self.assertRaises(ValueError):
            integrate.relay("a newer, different server")
        root = Path(__file__).resolve().parents[1]
        for path in root.rglob("*.py"):
            lines = path.read_text(encoding="utf-8").splitlines()
            logical = [line for line in lines if line.strip() and not line.lstrip().startswith("#")]
            self.assertLessEqual(len(logical), 300, str(path))


if __name__ == "__main__":
    unittest.main()
