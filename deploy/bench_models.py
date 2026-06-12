#!/usr/bin/env python3
"""Benchmark candidate villager-brain models on this box and pick the best.

Measures, per model, with a realistic Moorstead persona prompt:
  - TTFT  (time to first token — how long a villager 'thinks')
  - tok/s (decode speed — how fast the reply rolls out)
  - p50 full-reply latency for a typical ~80-token villager reply

Recommends the LARGEST model that stays inside the latency budget, because
character quality scales with size and the budget is what keeps chat playable.

Usage:
  python3 bench_models.py                  # report only
  python3 bench_models.py --apply          # also write BRAIN_MODEL to /etc/moorstead/brain.env
  python3 bench_models.py --models a,b,c   # custom candidate list
  python3 bench_models.py --budget 8       # max acceptable reply seconds (default 7)
"""
import argparse
import json
import re
import sys
import time
import urllib.request

OLLAMA = "http://127.0.0.1:11434"
ENV_FILE = "/etc/moorstead/brain.env"

# Candidates, smallest -> largest. Edit freely: anything Ollama can pull.
# On a 128 GB Strix Halo the big ones are absolutely on the table.
DEFAULT_CANDIDATES = [
    "llama3.2:3b",       # the laptop baseline
    "ministral-3:8b",
    "qwen3.5:9b",
    "gemma4:e4b",
    "gemma3:27b",
    "qwen3.5:32b",
    "llama3.3:70b",
]

SYSTEM = (
    "You are Granny Glinda, a sharp-tongued but warm old woman in a North York "
    "Moors village. Speak plainly with a light Yorkshire lilt, 1-3 sentences."
)
PROMPT = "Ey up Glinda. Any news about t' village? And what should I do about that barghest folk keep on about?"


def post(path, payload, timeout=600):
    req = urllib.request.Request(
        OLLAMA + path, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"})
    return urllib.request.urlopen(req, timeout=timeout)


def have_model(name):
    try:
        with urllib.request.urlopen(OLLAMA + "/api/tags", timeout=5) as r:
            tags = [m["name"] for m in json.load(r).get("models", [])]
        return any(t == name or t.startswith(name + ":") or t.split(":")[0] == name.split(":")[0] and name in t for t in tags) or name in tags
    except Exception:
        return False


def pull(name):
    print(f"  pulling {name} (this can take a while)...", flush=True)
    try:
        with post("/api/pull", {"name": name, "stream": True}, timeout=7200) as r:
            for line in r:
                msg = json.loads(line)
                if msg.get("error"):
                    print(f"  pull failed: {msg['error']}")
                    return False
        return True
    except Exception as e:
        print(f"  pull failed: {e}")
        return False


def bench(name, runs=3):
    ttfts, rates = [], []
    for i in range(runs):
        t0 = time.time()
        ttft = None
        n_tokens = 0
        t_last = t0
        try:
            with post("/api/chat", {
                "model": name,
                "messages": [{"role": "system", "content": SYSTEM},
                             {"role": "user", "content": PROMPT}],
                "stream": True,
                "options": {"num_predict": 120, "temperature": 0.7},
            }) as r:
                for line in r:
                    msg = json.loads(line)
                    if msg.get("message", {}).get("content"):
                        if ttft is None:
                            ttft = time.time() - t0
                        n_tokens += 1
                        t_last = time.time()
                    if msg.get("done"):
                        break
        except Exception as e:
            print(f"  run failed: {e}")
            return None
        if ttft is None or n_tokens < 5:
            return None
        decode = (t_last - t0 - ttft)
        rate = (n_tokens - 1) / decode if decode > 0 else 0
        ttfts.append(ttft)
        rates.append(rate)
    ttfts.sort(); rates.sort()
    return {"ttft": ttfts[len(ttfts) // 2], "toks": rates[len(rates) // 2]}


def size_rank(name):
    m = re.search(r"(\d+)\s*b", name.lower())
    return int(m.group(1)) if m else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default=",".join(DEFAULT_CANDIDATES))
    ap.add_argument("--budget", type=float, default=7.0, help="max seconds for a typical 80-token reply")
    ap.add_argument("--apply", action="store_true", help="write the winner to " + ENV_FILE)
    ap.add_argument("--no-pull", action="store_true", help="only bench models already pulled")
    args = ap.parse_args()

    candidates = [m.strip() for m in args.models.split(",") if m.strip()]
    results = {}
    for name in candidates:
        print(f"\n== {name} ==")
        if not have_model(name):
            if args.no_pull or not pull(name):
                print("  skipped (not available)")
                continue
        r = bench(name)
        if not r:
            print("  skipped (bench failed)")
            continue
        reply80 = r["ttft"] + 80 / max(r["toks"], 0.1)
        results[name] = {**r, "reply80": reply80}
        print(f"  TTFT {r['ttft']:.2f}s | {r['toks']:.1f} tok/s | ~80-token reply: {reply80:.1f}s")

    if not results:
        print("\nNowt benchmarked. Is Ollama running?")
        sys.exit(1)

    print("\n---- summary (sorted by size) ----")
    ranked = sorted(results.items(), key=lambda kv: size_rank(kv[0]))
    for name, r in ranked:
        ok = "OK " if r["reply80"] <= args.budget else "SLOW"
        print(f"  [{ok}] {name:<18} TTFT {r['ttft']:.2f}s  {r['toks']:5.1f} tok/s  reply {r['reply80']:.1f}s")

    within = [kv for kv in ranked if kv[1]["reply80"] <= args.budget]
    pick = (within[-1] if within else min(ranked, key=lambda kv: kv[1]["reply80"]))[0]
    print(f"\nRecommended villager brain: {pick}")
    print("(largest model inside the latency budget — quality first, still chatty)")

    if args.apply:
        try:
            with open(ENV_FILE) as f:
                lines = f.read().splitlines()
        except FileNotFoundError:
            lines = []
        lines = [l for l in lines if not l.startswith("BRAIN_MODEL=")]
        lines.insert(0, f"BRAIN_MODEL={pick}")
        with open(ENV_FILE, "w") as f:
            f.write("\n".join(lines) + "\n")
        print(f"Wrote {ENV_FILE}. Restart t' brain: sudo systemctl restart moorstead-brain")


if __name__ == "__main__":
    main()
