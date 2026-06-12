#!/usr/bin/env bash
# Who's been on t' moor? Summarises Moorstead visitors from t' Caddy access
# log (real IPs forwarded by Vercel/Cloudflare) and t' brain's memory store
# (one folder per browser that actually chatted to a villager).
echo "== Visitors by IP (from Caddy access log) =="
sudo cat /var/log/caddy/moorstead.log 2>/dev/null \
  | python3 -c '
import json, sys, collections, datetime
ips = collections.Counter()
first = {}
last = {}
for line in sys.stdin:
    try:
        d = json.loads(line)
        xff = d["request"]["headers"].get("X-Forwarded-For", [""])[0]
        ip = xff.split(",")[0].strip() or d["request"].get("client_ip", "?")
        if ip in ("127.0.0.1", "?", ""): continue
        ips[ip] += 1
        ts = datetime.datetime.fromtimestamp(d["ts"]).strftime("%d %b %H:%M")
        first.setdefault(ip, ts)
        last[ip] = ts
    except Exception:
        pass
for ip, n in ips.most_common():
    print(f"  {ip:<18} {n:>5} requests   first {first[ip]}   last {last[ip]}")
print(f"  -- {len(ips)} unique IPs")
'
echo
echo "== Browsers that chatted to villagers (brain memory) =="
for d in /home/james/moorstead/brain_memory/players/*/; do
  pid=$(basename "$d")
  n=$(ls "$d" | wc -l)
  name=$(python3 -c "
import json, glob
names = set()
for f in glob.glob('$d/*.json'):
    try:
        nm = (json.load(open(f)).get('facts') or {}).get('player_name')
        if nm: names.add(nm)
    except Exception: pass
print(', '.join(sorted(names)) or '(no name given)')
" 2>/dev/null)
  mtime=$(date -r "$d" "+%d %b %H:%M")
  echo "  $pid  villagers-met=$n  last=$mtime  name(s): $name"
done
