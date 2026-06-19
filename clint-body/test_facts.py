"""test_facts.py — checks the Python fact-retrieval matches the JS behaviour.
Run wi': python test_facts.py  (from the clint-body dir)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from npc_facts import load_facts, retrieve_facts, score_fact  # noqa: E402

FACTS = load_facts()
failed = False


def ok(m):
    print("  ok    " + m)


def bad(m):
    global failed
    failed = True
    print("  FAIL  " + m)


def has(arr, sub, m):
    (ok if sub.lower() in " ".join(arr).lower() else bad)(m)


(ok if len(FACTS) >= 20 else bad)(f"corpus loaded ({len(FACTS)} facts)")

has(retrieve_facts(FACTS, "how do I sell my coal for a good price"), "rail", "selling coal -> rail / market route")
has(retrieve_facts(FACTS, "how do I get a sheepdog to herd sheep"), "dog", "sheepdog question -> dog facts")
has(retrieve_facts(FACTS, "how do I build a pen to keep my sheep"), "gate", "penning question -> fold / gate facts")
has(retrieve_facts(FACTS, "what do I do at night when it goes dark"), "night", "night question -> danger facts")
has(retrieve_facts(FACTS, "how do I ride the train"), "train", "train question -> railway facts")
(ok if len(retrieve_facts(FACTS, "how do I make money")) > 0 else bad)("money question retrieves something")

(ok if retrieve_facts(FACTS, "") == [] else bad)("empty message retrieves nothing")
(ok if retrieve_facts(FACTS, "   ") == [] else bad)("whitespace retrieves nothing")
(ok if retrieve_facts(FACTS, "asdfqwerty zzzv") == [] else bad)("unknown terms retrieve nothing")

(ok if len(retrieve_facts(FACTS, "sell coal wool jet fish at market by rail train", k=2)) <= 2 else bad)("respects k=2")

# affinity lifts an own-patch fact only when relevant
rail = next((f for f in FACTS if f.get("topic") == "railway"), None)
if rail:
    with_aff = score_fact(rail, ["train", "station"], ("railway",))[1]
    without = score_fact(rail, ["train", "station"], ())[1]
    (ok if with_aff > without else bad)("affinity lifts an own-patch fact when relevant")
else:
    bad("there is a railway fact to score")

# drift guard: the corpus states the live freight cap
alltext = " ".join(f.get("text", "") for f in FACTS)
(ok if "96" in alltext else bad)("corpus states the freight cap (96)")

print("RESULT: " + ("FAIL" if failed else "PASS"))
sys.exit(1 if failed else 0)
