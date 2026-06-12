#!/usr/bin/env bash
# Fire 3 simultaneous villager chats an' time t' lot.
start=$(date +%s.%N)
for i in 1 2 3; do
  curl -s -m 120 -X POST http://127.0.0.1:8010/api/talk \
    -H 'Content-Type: application/json' \
    -d "{\"character_id\":\"char_1766235606269\",\"message\":\"Quick one James - how are t'sheep today? (test $i)\",\"player_id\":\"partest$i\"}" \
    > /tmp/par_$i.json &
done
wait
end=$(date +%s.%N)
echo "3 parallel talks wall time: $(echo "$end - $start" | bc)s"
for i in 1 2 3; do
  python3 -c "import json; print('  reply $i:', json.load(open('/tmp/par_$i.json'))['reply'][:80])"
done
