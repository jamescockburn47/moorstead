#!/usr/bin/env bash
# Bench the llama.cpp servers already running on this box with a villager prompt.
set -u
for port in "$@"; do
  echo "== port $port =="
  start=$(date +%s.%N)
  curl -s -m 180 "http://127.0.0.1:$port/v1/chat/completions" \
    -H 'Content-Type: application/json' \
    -d '{
      "messages":[
        {"role":"system","content":"You are Granny Glinda, a sharp-tongued but warm old woman in a North York Moors village. Speak plainly with a light Yorkshire lilt, 1-3 sentences."},
        {"role":"user","content":"Ey up Glinda. Any news about the village? And what should I do about that barghest folk keep on about?"}
      ],
      "max_tokens":90, "temperature":0.7
    }' > "/tmp/bench_$port.json"
  end=$(date +%s.%N)
  echo "wall: $(echo "$end - $start" | bc)s"
  python3 - "$port" <<'PYEOF'
import json, sys
port = sys.argv[1]
try:
    d = json.load(open(f"/tmp/bench_{port}.json"))
    print("reply:", d["choices"][0]["message"]["content"][:220].replace("\n", " "))
    print("tokens:", d.get("usage", {}).get("completion_tokens"))
    t = d.get("timings", {})
    print("decode tok/s:", round(t.get("predicted_per_second", 0), 1),
          "| prompt tok/s:", round(t.get("prompt_per_second", 0), 1))
except Exception as e:
    print("parse failed:", e)
PYEOF
done
