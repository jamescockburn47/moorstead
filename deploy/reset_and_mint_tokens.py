# Token reset + typed mint (run on t' EVO).
# Keeps: beck-kiln-87 (Alice) an' bilberry-gloaming-67 (t' warden login).
# Wipes every other code an' account, then mints typed batches whose PREFIX
# designates t' world-room:
#   bairn-*  -> room "bairns"  (t' kids)       x20
#   dale-*   -> room "dale"    (adult group 1) x15
#   crag-*   -> room "crag"    (adult group 2) x15
#   tarn-*   -> room "tarn"    (adult group 3) x15
# Writes a handout sheet to ~/moorstead/dash/handout.txt an' prints it.
import json
import shutil
import time

KEEP = {"beck-kiln-87", "bilberry-gloaming-67"}
CODES_F = "/home/james/moorstead/dash/codes.json"
ACCTS_F = "/home/james/moorstead/dash/accounts.json"

stamp = time.strftime("%Y%m%d-%H%M")
shutil.copy(CODES_F, CODES_F + ".bak-" + stamp)
shutil.copy(ACCTS_F, ACCTS_F + ".bak-" + stamp)

BATCHES = [
    ("bairn", "bairns", ["heather", "curlew", "gorse", "bracken", "lapwing", "merlin", "foxglove", "moss",
                         "rigg", "howe", "thorn", "ling", "whin", "fell", "gill", "beck", "bell", "wren",
                         "otter", "conker"]),
    ("dale", "dale", ["farndale", "bransdale", "bilsdale", "glaisdale", "fryup", "danby", "baysdale",
                      "westerdale", "raisdale", "tripsdale", "rosedale", "eskdale", "newton", "hartoft",
                      "douthwaite"]),
    ("crag", "crag", ["wainstone", "roseberry", "kettleness", "ravenscar", "nab", "scar", "brow", "heugh",
                      "clough", "kirkstone", "hasty", "cringle", "easby", "captain", "highcliff"]),
    ("tarn", "tarn", ["mallyan", "thomason", "keld", "foss", "dub", "mere", "lily", "gormire", "fen",
                      "sike", "carr", "flask", "eller", "lund", "seave"]),
]

codes = json.load(open(CODES_F))
accounts = json.load(open(ACCTS_F))

kept_codes = {k: v for k, v in codes.items() if k in KEEP}
kept_accts = {k: v for k, v in accounts.items() if k in KEEP}
removed_codes = len(codes) - len(kept_codes)
removed_accts = len(accounts) - len(kept_accts)

lines = []
for prefix, room, words in BATCHES:
    lines.append("")
    lines.append("== %s -> world '%s' ==" % (prefix.upper() + "-*", room))
    for i, w in enumerate(words):
        code = "%s-%s-%02d" % (prefix, w, (13 + i * 7) % 90 + 10)
        kept_codes[code] = {"room": room}
        lines.append("  " + code)

json.dump(kept_codes, open(CODES_F, "w"), indent=1)
json.dump(kept_accts, open(ACCTS_F, "w"), indent=1)

sheet = "Moorstead invite tokens — minted %s\n" % stamp
sheet += "Kept: beck-kiln-87 (Alice, room %s), warden login (not a hand-out token)\n" % (
    kept_accts.get("beck-kiln-87", {}).get("room", "moor"))
sheet += "Removed: %d old codes, %d old accounts\n" % (removed_codes, removed_accts)
sheet += "\n".join(lines) + "\n"
open("/home/james/moorstead/dash/handout.txt", "w").write(sheet)
print(sheet)
