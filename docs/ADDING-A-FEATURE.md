# Adding a feature to Moorstead — the recipe

Every feature in this codebase follows the same shape. Follow it and your change
will fit; the verify gate will catch you if it doesn't. This recipe is written so a
model that has NOT read the whole codebase can still add a feature safely.

## The loop you never skip

1. **Read the map.** [ARCHITECTURE.md](ARCHITECTURE.md) tells you which file owns the
   area you're touching and which verify script guards it. Read that file (and only
   that file) before editing.
2. **Make the smallest change that works.** Prefer adding a row to a data table over
   writing new control flow (see step 4).
3. **Write or extend a verify script** — a headless `scripts/verify-<name>.mjs` that
   asserts your feature's contract. This is not optional; it is how the next model
   (and the deploy gate) knows your feature still works.
4. **Wire it into the gate.** Append `&& node scripts/verify-<name>.mjs` to the
   `"verify"` chain in `package.json`, and add a `"verify:<name>"` entry.
5. **Prove it green:** `node scripts/verify-<name>.mjs`, then `npm run verify` (the
   full gate — MUST stay green), then `npm run build`.
6. **Respect the invariants** in [INVARIANTS.md](INVARIANTS.md) — especially the
   rules on additive protocol, append-only content, and the quality toggle.
7. **Deploy** with `npm run deploy` (never bare `vercel`) — it re-runs the gate,
   builds, bumps the version, ships, and proves the live stack took it.

## Prefer data over code

The cheapest, safest features are **rows in a table**, not new branches. Wherever a
table already exists, add to it rather than writing imperative code:

| Adding a… | Add a row/entry to | In file |
|---|---|---|
| craftable recipe | `RECIPES` | `src/defs.js` |
| smelt/cook output | `SMELTS` | `src/defs.js` |
| block or item | `B` / `I` / `TILE` / `ITEM_NAMES` (+ a texture in `textures.js`) | `src/defs.js` |
| quest / arc | the arc-definition object | `src/quests.js` |
| festival | the festival calendar + a `festivalKit` builder | `src/festivals.js`, `src/festivalKit.js` |
| onboarding milestone | `MILESTONES` (+ event mapping) | `src/milestones.js` |
| NPC greeting/remark | a greet/nosy pool | `src/villagerlife.js` |
| NPC outfit | the wardrobe table (`outfitSpecFor`) | `src/entities.js` |
| lore entry | the lore table | `src/lore.js` |

A model appending a validated row almost cannot break the game. A model editing
`frame()` or the relay handler easily can — so push work into the first category.

## Anatomy of a verify script

Headless Node, no DOM, no GL. Import the pure logic (or read source as text for
grep-level checks when GL is unavoidable). The house idiom:

```js
// <Feature> check — run wi': node scripts/verify-<name>.mjs
import { thingUnderTest } from '../src/yourmodule.js';

let failed = false;
const ok  = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// group assertions in blocks with a comment saying what invariant they defend
{
  (thingUnderTest(input) === expected ? ok : bad)('plain-English statement of the rule');
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
```

Rules for a good verify script:
- **Test the contract, not the implementation** — "a lapsed deed protects nothing",
  not "the third if-branch runs".
- **Make logic testable by extracting pure functions.** If your feature's core maths
  lives inside a DOM/GL method, pull it out as an exported pure function (the codebase
  does this everywhere: `spreadHint`, `lanternFlicker`, `trackerHTML`, `outfitSpecFor`,
  `migrateSave`). Then the script imports and asserts it directly.
- **When GL/DOM truly can't be avoided,** grep the source as text for the required
  config (several scripts read `main.js` as a string to assert a flag is present).
- **Assert teardown/no-leak** for anything that adds scene objects (festivals, layers):
  build, tear down, assert zero orphans.
- **Keep it fast and deterministic** — no network (except `verify-live`), no clocks,
  no `Math.random` without a seed. See `scripts/verify-_template.mjs` for a skeleton.

## What NOT to do

- Don't edit `package.json`'s `version`/`minClientVersion` by hand — `deploy.mjs`
  bumps `version`; only raise `minClientVersion` for a genuinely breaking
  protocol/save change (see [INVARIANTS.md](INVARIANTS.md) rule 3).
- Don't add a feature that only works under Fine graphics without a Plain fallback
  (rule 5).
- Don't rely on eyeballing for logic. Visual polish is judged by preview screenshots +
  a human; everything else is judged by a verify script.
- Don't skip the verify script because the change "is obviously fine". The gate is the
  memory of every past mistake; add to it.
