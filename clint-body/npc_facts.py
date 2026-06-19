"""npc_facts.py — per-question retrieval over the shared game-facts corpus.

A faithful Python port of src/facts.js, so Merlin answers "how do I..." questions
from the SAME facts the game client gives the villagers. Pure, deterministic
lexical scoring. Retrieved facts ride into the brain prompt as labelled reference;
Merlin's persona keeps him in his own voice.

Corpus = clint-body/game-facts.json, generated from src/game-facts.js by
scripts/sync-facts.mjs (single source of truth). All functions are fail-safe.
"""
from __future__ import annotations

import json
import pathlib
import re
from typing import Optional

_STOP = {
    "the", "and", "for", "you", "your", "how", "can", "what", "where", "who", "why",
    "with", "get", "got", "are", "was", "this", "that", "them", "they", "some", "any",
    "put", "use", "has", "have", "about", "into", "from", "out", "off", "tha", "thi",
    "thee", "owt", "nowt", "does", "doing", "just", "need", "want", "should", "would",
}

_WORD = re.compile(r"[a-z']+")


def terms(s: str) -> list:
    if not s:
        return []
    return [w for w in _WORD.findall(s.lower()) if len(w) > 2 and w not in _STOP]


def load_facts(path: Optional[str] = None) -> list:
    """Load the corpus; returns [] on any error (fail-safe)."""
    try:
        p = pathlib.Path(path) if path else pathlib.Path(__file__).parent / "game-facts.json"
        with open(p, encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def score_fact(fact: dict, query_terms: list, affinity=()) -> tuple:
    """Return (rel, total). Affinity only lifts an already-relevant fact."""
    kw = fact.get("keywords", []) or []
    kw_set = set(kw)
    txt = set(terms(fact.get("text", "")))
    rel = 0
    for t in query_terms:
        if t in kw_set:
            rel += 3
            continue
        if t in txt:
            rel += 1
            continue
        for k in kw:
            if len(k) > 3 and (k.startswith(t) or t.startswith(k)):
                rel += 2
                break
    boost = 1.5 if (rel > 0 and fact.get("topic") in affinity) else 0
    return rel, rel + boost


def retrieve_facts(facts: list, message: str, k: int = 2, max_chars: int = 600, affinity=()) -> list:
    q = terms(message)
    if not q:
        return []
    scored = []
    for f in facts:
        rel, total = score_fact(f, q, affinity)
        if rel > 0:
            scored.append((total, f))
    scored.sort(key=lambda x: x[0], reverse=True)
    out, used = [], 0
    for _total, f in scored:
        if len(out) >= k:
            break
        text = f.get("text", "")
        if used + len(text) + 1 > max_chars:
            continue
        out.append(text)
        used += len(text) + 1
    return out


def facts_context(facts: list, message: str, **kw) -> str:
    """A ready-to-inject reference block, or '' if nothing relevant."""
    got = retrieve_facts(facts, message, **kw)
    if not got:
        return ""
    return ("True things about the world, to draw on only if relevant "
            "(answer in your own voice, never recite this): " + " ".join(got))
