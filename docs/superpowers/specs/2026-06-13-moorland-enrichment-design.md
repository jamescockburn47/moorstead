# Moorland Enrichment — Design Spec

**Date:** 2026-06-13
**Status:** Design approved
**Scope:** Distinctive moorland flora (especially railway banks), a fuller cast of animals with new behaviours, and a cast-&-wait fishing system. All procedural, in keeping with Moorstead's rule: every texture, sound and creature generated in code, no asset files.

## Principles & constraints

- **Extend existing systems in place** — no parallel systems.
- **Append-only block/item/tile ids** — never renumber existing ones (save format keys on raw block bytes; DB name stays `moorcraft`).
- **Flora, rocks and trees bake into the chunk mesh** — zero runtime cost.
- **New mob behaviours are composable flags** on `MOB_TYPES`, not bespoke per-mob code.
- **Deterministic seeded worldgen** → identical for every player on the shared moor automatically; no relay/protocol changes.
- Mobs stay client-side like the existing ones; fishing is client-authoritative.
- **Must not break `scripts/verify-rail.mjs`** (railway route + siting sanity check).

## Id allocation (confirmed free)

- Blocks (`B`, current max `GORSE=31`): `FERN=32`, `FOXGLOVE=33`, `DOG_ROSE=34`, `ELDER=35`, `MONKEY_LEAVES=36`.
- Tiles (`TILE`, current max `GORSE=34`): `FERN=35`, `FOXGLOVE=36`, `DOG_ROSE=37`, `ELDER=38`, `MONKEY_LEAVES=39`. Atlas is 16×16 = 256 slots; ample room.
- Items (`I`, current max `FISH_CHIPS=99`): `FISHING_ROD=100`, `RAW_TROUT=101`, `SEA_FISH=102`, `COOKED_FISH=103`, `RAW_BEEF=104`, `COOKED_BEEF=105`.

---

## Module A — Flora & landscape

### A1. New cutout plants
Follow the `HEATHER`/`GORSE`/`BILBERRY_BUSH` pattern: a `TILE` index, a billboard painter in `textures.js`, a `D[...]` def with `kind:'cutout'`, `hard:0.05`, `tool:null`, `drop:` self. Add the four plants to `CREATIVE_ITEMS`.

| Block | Painter (procedural) | Habitat |
|---|---|---|
| `FERN` | lush green shuttlecock fronds (distinct from rusty `BRACKEN`) | damp/shady lineside, beck sides, wood edges |
| `FOXGLOVE` | green stem + tall purple bell spike | disturbed ground, wood edges, railway banks |
| `DOG_ROSE` | arching green bush + pink blooms | hedgerows, banks, wood edges |
| `ELDER` | taller bush + creamy-white flower heads | banks, settlement fringes, hedgerows |

### A2. Rocks of varied shape/size
Replace `boulderAt()` (currently a single 1-wide stone column) with a varied generator producing **small** (single weathered block), **medium** (irregular 2–3-block `STONE`+`COBBLE` cluster), and the occasional **large gritstone tor** (stacked outcrop). Hash-varied shape/size; modest density increase across the moor. Excluded from rail deck, paths and village columns. Baked into terrain.

### A3. Monkey puzzle trees
New `stampTree` variant: straight `LOG` trunk + narrow tiered dome of `MONKEY_LEAVES` (new solid leaf-type block, like `LEAVES`, for the distinctive dark spiky silhouette). **Sited via `monkeyPuzzleAt(x,z)` keyed to settlement proximity** (gardens, station yards, churchyards) plus the rare lone moorland specimen — reflecting their real history as Victorian ornamental imports, not wild moorland flora. (Per approval: settlement-sited.)

### A4. Lineside planting (headline)
In `generateChunk`, after the rail deck is carved, for columns whose `railInfo(x,z).d` falls in roughly `[2.2, 5]` (the railway's land, off the ballast) on grass/dirt at or above ground level, plant an overgrown-cutting verge: ferns, foxgloves, dog rose, elder, the odd boulder — hash-varied density. **Never** on the deck, ballast or four-foot. Separately, raise the open-moor lone-bush frequency (currently `r < 0.064`).

### A5. Acceptance
- New plants render on banks and in their biomes; appear in the creative cupboard; harvest drops them.
- Boulders visibly vary in size and shape.
- Monkey puzzles appear near settlements with a distinctive silhouette.
- `node scripts/verify-rail.mjs` still passes (4 seeds).

---

## Module B — Fauna

### B1. New composable behaviour flags (in the `entities.js` update loop)
- `fly` — ignores gravity; holds an altitude band above ground; soars in arcs. Sub-mode `swoop` (owl): periodic graceful dive toward ground then climb.
- `flock` — boids-lite cohesion/alignment/separation among same-type within radius (crow, gull).
- `bask` — seeks a sunny stone surface, sits motionless, darts away fast on approach, returns later (lizard).
- `flush` — low-visibility, tucked in bush/heather until the player is within radius, then bursts out (vertical pop / short flight) with an alarm call and flees (curlew, pheasant, grouse).
- `aggroRadius` — passive until the player enters the radius, then `chase` + headbutt with knockback; disengages on retreat (bull).

### B2. New mobs (`MOB_TYPES` entry + box-primitive `make` model + spawn gating)

| Mob | Flags | Habitat / time | Drops | Notes |
|---|---|---|---|---|
| `cow` | passive herd | dale pasture, near villages | `RAW_BEEF` 1–2 | larger than sheep; herd spawn |
| `bull` | `aggroRadius≈7`, `dmg`, knockback | with cow herds (rare) | `RAW_BEEF` | dark, horned, bulky |
| `pheasant` | `flush` | dale / wood edge | raw game | distinctive red face, long tail |
| `grouse` | + `flush` + call | heather moor | `RAW_GROUSE` | *exists* (red comb) — gains flush |
| `owl` | `fly` + `swoop`, `night` | moor/woods at night, cap 1–2 | — | hoots; does not attack |
| `crow` | `fly` + `flock`, day | over moor; settle on walls/trees | — | caw; flock ~4–7 |
| `lizard` | `bask`, day | rocky/boulder ground | — | small; darts |
| `curlew` | `flush` | open moor | — | bubbling call (see `lore.js`) |
| `frog` | hop + plop | inland water / bog edges | — | small |
| `seagull` | `fly` + loose `flock` | `coastT>0` only | — | cry; scavenges |

### B3. Spawn logic
Extend `trySpawns` to be biome/terrain/time aware: coast → gull; pasture/low ground → cow (+ rare bull); heather moor → curlew, grouse, lizard (near rock); water-adjacent → frog; night → owl; day → crow. Keep caps low; reuse existing distance-despawn.

### B4. Audio
Add procedural oscillator-based calls in `audio.js` and wire into `mobAmbient`/`mobHurt`: curlew bubble, pheasant kok-kok, owl hoot, crow caw, gull cry, cow moo, bull snort.

### B5. Acceptance
- Each creature spawns in the correct habitat/time and behaves per its flags (owl swoops, crows flock, lizard basks then darts, curlew/pheasant/grouse flush, bull chases when close and disengages, frog near water, gull coastal).
- Caps respected; frame rate stable; despawn works.
- Cows yield cookable beef.

---

## Module C — Fishing (cast & wait → cook + sell)

### C1. Items
`FISHING_ROD` (single-stack, slight durability), `RAW_TROUT`, `SEA_FISH`, `COOKED_FISH`, `RAW_BEEF`, `COOKED_BEEF`. Register in `ITEM_NAMES`; `FOODS` (raw low, cooked high — cooked fish a strong restore); `maxStack` rod = 1.

### C2. Recipe / smelt
- `RECIPES`: `FISHING_ROD` = sticks + wool (line), at the joiner's bench.
- `SMELTS`: `RAW_TROUT`→`COOKED_FISH`, `SEA_FISH`→`COOKED_FISH`, `RAW_BEEF`→`COOKED_BEEF` (roast at the range).

### C3. Mechanic (cast & wait)
In `useItem()`: if the held item is `FISHING_ROD` and the crosshair targets a `WATER` block within reach → cast a **bobber** entity onto the surface and start a randomised timer (longer inland, shorter at the coast); show ripple particles. On bite: bobber dips + a "bite!" cue + a short reaction window (~1.2 s). Click/use within the window → reel in: yields a fish (trout inland, sea fish coastal; size/luck weighted) and a small rod durability loss. Miss, walk away, or recast → cancel and reel in empty. Bobber managed in `Entities` like drops/particles.

### C4. Sell
Fresh fish become trade goods Annie/fisherman Ned buy, tied into the existing barter/standing, feeding the fish-&-chips economy (fresh fish → coal/coin).

### C5. Visible fish (light touch)
Occasional fish model finning/rising in clear inland water and the sea near the player; tiny cap; cosmetic + a hint of where to cast.

### C6. Acceptance
- Craft a rod; cast on beck/tarn/sea; bobber + ripples appear; bite cue fires; reel success/failure; durability ticks.
- Cook fish on the range; eating restores hunger; sell fresh fish to Annie/Ned.
- Trout inland vs. sea fish at the coast.

---

## Sequencing
**A (flora) → B (fauna) → C (fishing)**, each landing as its own commit(s) so the work stays reviewable. Fauna builds on flora habitats (curlews want bushes, lizards want rocks).

## Out of scope / deferred
- No relay/multiplayer protocol changes.
- No fishing timing minigame (cast & wait chosen).
- No leather/hide from cows (beef only) unless trivial.
