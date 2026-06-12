#!/usr/bin/env bash
# 6 simultaneous villager chats — true parallel capacity test.
start=$(date +%s.%N)
for i in 1 2 3 4 5 6; do
  ( s=$(date +%s.%N)
    curl -s -m 180 -X POST http://127.0.0.1:8010/api/talk \
      -H 'Content-Type: application/json' \
      -d "{\"character_id\":\"char_1766235606269\",\"message\":\"Now then James, owt fresh on t'farm today? (burst $i)\",\"player_id\":\"burst$i\"}" \
      > /tmp/b_$i.json
    e=$(date +%s.%N)
    echo "  chat $i: $(echo "$e - $s" | bc | cut -c1-5)s" ) &
done
wait
end=$(date +%s.%N)
echo "total wall: $(echo "$end - $start" | bc | cut -c1-5)s"
