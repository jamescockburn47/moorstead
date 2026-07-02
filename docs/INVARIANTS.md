# Moorstead — the invariants a change must not break

These are the load-bearing rules that are **not obvious from reading any single
file**. A capable model infers them; a cheaper one won't, and will break the game
in ways the reviewer only catches later. They are written down here so the rule is
explicit and, wherever possible, enforced by a verify script rather than by judgment.

## 1. The verify gate is the contract

`npm run verify` runs ~60 headless scripts and MUST be green before any deploy
(`deploy.mjs` refuses otherwise). Green is the definition of "safe to ship". If you
add behaviour, add an assertion that defends it. If you change behaviour and a script
goes red, do not weaken the script to pass — either your change is wrong, or the
rule changed and the script's assertion (and this doc) must be updated deliberately.

Visual quality is the ONE thing the gate cannot judge — that is gated by preview
screenshots and a human eye. Everything else is judged by a script.

## 2. Content tables are append-only-safe; control flow is not

Adding a row to `RECIPES`, `MILESTONES`, a quest arc, a festival, the wardrobe, or a
greet pool is low-risk **if the row is well-formed** (real ids, no collisions, legal
shape). Editing `frame()`, the relay `handle()` chain, physics, or the save format is
high-risk. Prefer the former. A validator script should reject a malformed row; a
malformed row must never reach production silently.

## 3. The multiplayer protocol is additive-safe — so most features need no version bump

The relay and every client `handle()` **ignore unknown message types** (the `else if`
chain simply falls through; the server drops types it doesn't know). Therefore:

- Adding a NEW relay message type (like the Tradin' Post `stall*` messages) is
  additive. Old clients ignore it. **Do NOT raise `minClientVersion` for it.**
- Adding a key to the `init` payload is safe — old `onInit` ignores unknown keys.
- `minClientVersion` is raised ONLY for a genuinely breaking change: a change to the
  meaning of an EXISTING message, or a save-format change old clients can't read.
- `version` (the update-toast trigger) is bumped by `deploy.mjs` automatically; bump
  it by choosing when to deploy, not by editing `package.json`.

Corollary: relay-borne strings are UNTRUSTED. Any player name, chat, or NPC text
inserted into the DOM MUST go through `escHtml` (see `src/escape.js`) — a missed one
was a live XSS. Grep new `toast(`/`innerHTML` sites for interpolated network data.

## 4. Save format: forward-refuse, back-migrate

`src/save.js` owns `SAVE_VERSION` and `migrateSave`. A save from an OLDER version is
migrated stepwise up to current. A save from a NEWER version is REFUSED (the client
returns to title with a "newer Moorstead — update first" toast) rather than loaded
and corrupted. When you change the save shape: bump `SAVE_VERSION`, add a migration
step, and if old clients can't read the new shape, raise `minClientVersion`.

New persisted data should be ADDITIVE (a new key old code ignores), so old saves load
clean with the field simply absent — the way `meta.strongboxes` was added.

## 5. Every visual feature needs a Plain fallback

The renderer has a Fine/Plain quality toggle (`applyQuality` in `main.js`,
`localStorage['moorcraft-gfx']`; touch devices default Plain). Anything you add to the
Fine path — post effects, shadows, particles, emissive glow — MUST degrade cleanly to
today's look on Plain, and MUST be guarded so headless Node import (the verify gate)
never touches a GL/composer object. Pattern: build the pure logic separately (testable),
gate the GL construction behind the quality check and a `typeof` guard.

## 6. Determinism: the same world/NPC looks the same everywhere

Terrain, NPC positions, roster thinning, and NPC appearance are DETERMINISTIC from a
stable seed (world seed, or an id-hash of a charId). This is why every client sees the
same moor and the same Mary Agar. **Never use `Math.random()` at build/spawn time for
anything that must match across clients or sessions** — seed from the stable id
(`idHash` in `roster.js`) or the world seed. Cosmetic per-frame jitter (flicker,
particle spread) may use time or index, never persistent identity.

## 7. Resource hygiene in the voxel/scene layer

Three.js geometries/materials/textures are not GC'd — they must be disposed or shared.
The rule the codebase settled on: **share materials/geometries via a per-key cache**
(drops share one SpriteMaterial per item id; bursts share per colour; NPC outfits share
per size/colour). Anything that builds scene objects per-frame or per-spawn must pool or
cache, and anything torn down (chunks, festival props, layers) must dispose or be shared.

## 8. Server truth lives on the EVO; read it, don't guess

The relay (`worldsvc`, now under git), brain (`yorkshire_bot`), and dashboard run on the
EVO, reachable over Tailscale (`ssh evo-tailscale`, passwordless `sudo -n`). When a
question needs server-side truth, read the real source there; back up any file before
editing (`cp x x.bak-YYYYMMDD-tag`), commit worldsvc changes to its git, restart the
unit, and confirm `verify-live` stays green. Units: `moorstead-world`,
`moorstead-brain`, `moorstead-dash`, `llama-server-moorstead`.

## 9. The identity constraints (product, not code)

- **Browser-first, instant-play, procedural-only.** No asset files, ever — textures,
  audio, and models are painted/synthesised in code. The title screen credits this;
  it's the game's identity and its moat. A dependency on a binary asset breaks it.
- **Victorian NYM, c.1900.** No anachronisms (candles/lanterns, not electric light; no
  modern tech or music). Player-facing text is Yorkshire dialect.
- **Kid-safe shared worlds.** No unbounded griefing surface; server-authoritative caps;
  no raw player text rendered as HTML.
