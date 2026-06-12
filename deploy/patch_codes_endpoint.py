# /api/codes shows each token's room an' claim status (for handing out).
P = "/home/james/moorstead/dash/app.py"
s = open(P).read()
old = '''    return {c: (accounts[c]["name"] if c in accounts else None) for c in sorted(codes)}'''
new = '''    return {c: {"name": accounts.get(c, {}).get("name"),
                "room": (codes[c].get("room") if isinstance(codes[c], dict) else None)
                        or accounts.get(c, {}).get("room", "moor")}
            for c in sorted(codes)}'''
assert old in s, "list_codes return not found"
open(P, "w").write(s.replace(old, new, 1))
print("codes endpoint patched")
