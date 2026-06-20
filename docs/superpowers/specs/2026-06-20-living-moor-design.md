# The Living Moor — world regeneration & sustainability

**Date:** 2026-06-20
**Status:** Draft for review. Designed as **one system** (James's call) on a shared edit-ledger; built in slices (§13). Foundational: the farming vertical (Slices 1–3, built) deploys once this lands, so droving's extraction pressure meets a moor that heals.

## 1. Purpose & success criteria

Stop the shared moor being stripped and decimated, and give the world a sense of breathing back. Three things, one mechanism:

1. **The moor heals.** Harvested heather, felled trees, and mined seams grow back over time; abandoned diggings backfill. The moor a child finds is never a permanent wasteland left by the last player.
2. **No open-cast.** You can dig only one block below grade in open ground; all deeper mining is funnelled through a placed **mine entrance + a bought licence**, with better and dearer equipment needed to go deeper. Strip-pits become impossible, and the deep ore is a real investment.
3. **You keep what you tend.** A player claims a plot and pays upkeep to keep their buildings; land nobody claims or maintains reverts to moor. This adds two brass sinks and keeps the shared world from silting up with abandoned half-builds.

Success: leave a harvested/dug patch and return days later to find it regrown; a surface pit backfills; a claimed, maintained homestead persists indefinitely while an unclaimed shack out on the moor reclaims; every mechanic is told to the player where they meet it (§9). It must be **multiplayer-consistent** (the bairns room is shared) and **gentle for a ten-year-old** (lifespans generous enough that a few days away never loses a tended home).

## 2. Scope

In: the edit-ledger backbone; flora/ore regrowth; **licensed mining** (entrance + licence + the 1-block-deep rule + depth-band pick/equipment gating) with the researched **ore palette**, a **prospecting skill**, and free-but-exhausted **old workings**; deeds (land **claims** + **mine** licences); presence-based maintenance + lapse/reclamation; kept-stock breeding. Cross-cutting: in-game legibility (§9).

Out (later): player-foundable settlements & new rail (SP5); NPC-built structures decaying (SP4); weather/seasonal erosion; soil fertility / crop rotation. Wild-animal respawn is **already adequate** (`trySpawns` caps + weights) and is left as-is; the only animal addition here is kept-stock breeding (§7).

## 3. The backbone — an edit ledger that forgets

The world is a deterministic base (from the seed) plus **edits** (block-id overrides). Today an edit is bare: client keeps modified chunks as full `Uint8Array`s (`world.savedChunks`) and the relay keeps a flat `{"x,y,z": id}` dict (`deploy/world/server.py`), with **no age and no category**. The one precedent for time-limited reversion is the **beach heal** (`main.js` `beachReverts`/`queueBeachRevert`/`processBeachReverts`: a beach edit reverts after 3–5 minutes, client-side; `multiplayer.js sendEdit` already carries an optional `{ttl, revert}`). **This system generalises that precedent.**

**Every edit gains metadata: `{ cat, day, by }`** — `cat` ∈ `harvest | dig | build`, `day` = the game-day it was made (`sky.day` at edit time; the program's monotonic, save-persisted clock — never wall-clock), `by` = player id (for claims/fairness).

**Reversion = forget the edit; the deterministic base regenerates itself.** There is no "before" state to store: drop a mined-ore edit and `oreAt` puts the seam back; drop a dug-hole edit and the stone returns; drop a felled-tree edit and the tree regenerates; drop an abandoned wall and it is moor again. One rule reverts harvest, dig, **and** build uniformly: delete the edit → regenerate the cell from the seed.

**Expiry is deterministic and lazy:**
- **Client:** on chunk-load (and a throttled pass over loaded chunks near the player), any edit whose `day` is older than its category's lifespan is dropped (generalising `processBeachReverts`, but on game-days, and category-aware). On a **single-player** world this is the whole story.
- **Relay (`server.py`):** on the **shared** moor a client's local drop is not enough on its own — the relay would otherwise re-send the edit on the next chunk load. So the relay runs the **same** pass over the authoritative edit dict, is the source of truth, and broadcasts the reverts; the dict also stays bounded (today it only ever grows). Client and relay never disagree because both run the same pure rules (`editledger.js`, §10). This server-side pass is the main relay-side work, and is what makes the *shared bairns moor* actually heal (see the slice note, §13).

Edits inside an **active deed** are the exception (§6): a land **claim** protects the `build` edits within it, and a **mine** licence protects the `dig` edits (the excavation) within its envelope — so neither a tended cottage nor a working mine decays. Outside any active deed — or once a deed **lapses** (§7) — edits expire as above. Deed membership is tested at expiry time, so staking or lapsing needs no edit rewrites.

## 4. Flora & ore regrowth

Harvest and dig edits expire on a **per-category, per-block lifespan** (game-days; tuning in §14):
- **Fast (days):** heather, bracken, bilberry and other moor plants (cutouts) — the moor's green comes back quickly.
- **Moderate (a week or so):** **peat** cut from the boggy tops (surface turbary, §5) — the bank regrows, so the bog is never cut bare for good.
- **Slow (a week or two):** trees (felled logs/leaves regenerate from the seed's wood placement).
- **Slow (a week+):** a **surface scrape** (the 1-block dig allowed in open ground) backfills. *Deep* excavation only exists inside a licensed mine, where it **persists while you pay** and **refills only when the mine lapses** (§5, §7) — the seam you opened doesn't grow back under you, but an abandoned mine caves in.

Because reversion regenerates the deterministic base, a regrown tree/seam/floor is exactly the one the seed always had there — no new placement logic. Edits inside an active deed (a tended cottage's builds, a working mine's excavation) never regrow by this path; only edits outside any active deed do.

## 5. Licensed mining (the hard gate)

Open-cast is prevented **structurally**, not by healing (James's design):

- **The 1-block-deep rule (measured from the *original* grade).** At break time, if the target block sits more than one below the **original seed surface height** of that column (`world.gen.height(x,z)` — the *fixed* terrain height, **not** the current dug-down level) **and** the player is not within a licensed mine's shaft envelope, the break is refused with a hint ("tha can only dig deep inside a licensed mine — set a mine entrance an' buy a licence"). Because the gate measures from the original grade, free digging and quarrying can only ever **skim the top of the land** — you can shave the surface (and it regrows) but never gouge, pit, or level a crag. **One rule makes both strip-pits and landscape-wrecking quarries impossible.** Going below original grade is allowed only in a **sanctioned zone**: a **licensed mine** (for ores), a **designated quarry** (for building stone, below), or a claim's shallow cellar allowance (§6) — never on the open moor or a wild crag.
- **A mine = an entrance + a licence (a deed).** Place a **mine-entrance** block (buildable) and buy a **mining licence** for it — a *deed* in the same system as land claims (§6): owned, paid, upkept, on the ledger. The licence opens a **shaft envelope** (a column + radius beneath and around the entrance) inside which deep digging is allowed. All deep excavation funnels through licensed entrances.
- **Depth = an investment ladder (better picks + paid kit — James's call).** The envelope descends in **depth bands**, each gated by BOTH a minimum **pick tier** (wood → gritstone → iron) AND an installed, **purchased fixture** (pit-props → safety lamp → winch). To break below a band's floor you must hold the band's pick *and* have its fixture installed in the mine. Cost rises with depth, matching the ore-value gradient: the **shallow coal** band is cheap and accessible (a cheap licence + a wood pick — a child's first mine isn't over-gated), while the **deep jet** band (`y<20`) demands the iron pick + the dear fixtures. "Deep mining must become more difficult" falls straight out.
- **Healing still applies at the surface; an abandoned mine caves in.** A one-block surface scrape is a `dig` edit and regrows (§4). The mine's own works persist while the licence is paid, and **reclaim if it lapses** (§7) — leave a mine untended and it falls in.

**The resource palette (researched — real North York Moors workings; §15).** Distributed by region + depth, from the free surface down to the licensed deeps:
- **Peat** *(surface, no licence)* — cut at grade from the boggy tops (blanket bog, `bogginess`), the moor's traditional fuel (turbary); the **lowest-priced** good and the accessible bottom of the ladder. Regrows (§4). *(a block in game as fuel; gains a surface-cut + a price)*
- **Coal** — thin, poor moor seams worked 18th–20thC; the cheap, shallow entry band. *(in game)*
- **Cleveland ironstone** — the great 19thC Cleveland/Rosedale/Grosmont seams; the mid-depth industrial staple. *(in game)*
- **Whitby jet** — Britain's only jet, in coastal shale; the historic luxury prize — deep + skill-gated. *(in game)*
- **Alum shale** *(new)* — the first chemical industry (Loftus→Ravenscar, c.1604–1871; ~12 t shale → 1 t alum, a dye-fixer); a shallow **coastal-cliff** shale, mined + processed.
- **Potash / polyhalite (+ rock salt)** *(new)* — Boulby on the NE coast, the UK's **deepest** mine (~1.1–1.4 km, Zechstein evaporites); the modern **precious deep prize**, the ultimate find.

**Quarrying — designated, free, regenerating (James's call).** Building stone comes from **designated quarry zones**: sanctioned public sites (worldgen-placed at rocky outcrops near settlements and play), **free to all, no licence**, where you may **work the rock below the skim** and it **regenerates** — the quarry refills over its lifespan, a renewable stone source, never permanently wrecked. You **cannot open a quarry wherever you like**: outside a designated quarry (or a licensed mine), the original-grade skim rule holds — you may shave the surface (a block or two, even off a crag top), build, and farm, but not gouge the open moor or a wild crag. This confines bulk extraction to sanctioned, self-healing sites and keeps the protected landscape intact (James's requirement). Beck beds still give surface `cobble`/`gravel` anywhere as a light free top-up. **Licensed deep mining stays separate, for the valuable ores only** (coal/iron/jet/alum/polyhalite): a quarry is for stone, a mine for ore.

**Prospecting skill — experience to find the precious (James's call).** A `miningSkill` grows with mining (XP per ore, more for depth/rarity). The **precious ores (jet, polyhalite) yield only to a skilled prospector**: a novice working the same deep rock turns up bare stone, an experienced one reads the seam (mechanism: skill scales the effective ore-richness threshold in `oreAt`, or gates the precious block at break). So the deepest prizes need the **triple gate — licence + equipment + skill.**

**Old workings — free, but worked out (James's call).** The moor's pre-existing mine structures (generated drifts/adits, the Rosedale kilns) are **free to explore** — no licence, since they are already cut (the 1-block rule gates *new* deep digging, not walking an open historic tunnel). But their accessible seams are **historically exhausted**: ore near the old workings is sparse (reframing today's `nearKilns` ore *boost* into a worked-out *thinning*), so the old drifts give atmosphere and a taste while real yield needs a freshly licensed mine sunk to the deeper, unworked ore.

## 6. Claims & deeds — the keep-vs-reclaim gate

A **deed** is a small owned holding: `{ id, kind, by, centre, radius, depth?, paidUntilDay, lapsedDay? }`, `kind` ∈ `claim | mine`. A land **claim** protects builds in a surface cylinder; a **mine** licence (§5) permits deep digging in a shaft envelope (centre + radius + depth bands). Both share the deed machinery below — owned, paid (fee scaled by size/depth), weekly upkeep, lapse → reclamation.
- **Make a claim:** stake a plot for a brass fee **scaled by size** (a bigger deed costs more and carries more upkeep — discourages land-grabs on the shared moor). Like the farm charter, a deliberate paid choice.
- **Protection:** a `build` edit whose cell lies inside an **active** claim never expires. Build edits **outside** every claim decay like digs (§3). Your fold/croft becomes a claim; the **starter croft and the villages are permanent system claims** (`by: 'parish'`, never lapse) so they never reclaim.
- **Footprint:** a centre + radius (cylinder) is the v1 — cheap membership test, legible ("thi claim reaches this far"). Box/extendable footprints are later polish.
- **Mine licences are the sibling deed** (§5): the same record (`kind: mine`), the same pay / upkeep / lapse, but instead of protecting surface builds they permit deep digging in a shaft envelope and carry depth bands. One deed system, two uses.
- **Designated quarries are public zones, not owned deeds** (§5): worldgen-placed, **free to all**, regenerating stone sources where the skim limit is lifted for building stone. They reuse the footprint/membership test (a `kind: quarry`, `by: 'parish'` zone) but carry **no fee, no upkeep, and never lapse** — the parish's common stone.

## 7. Maintenance, lapse & reclamation

**Presence-based upkeep (James's call):** a claim owes **upkeep** (brass per game-week, size-scaled). It is **not** auto-deducted; you pay it by **visiting the claim and settling up** at its deed-post / the parish board, which advances `paidUntilDay`. Land you never visit and never pay falls behind — fair on a shared moor, and it teaches the child that keeping a place costs.

**Lapse:** when `now > paidUntilDay + grace`, the claim **lapses** (`lapsedDay` set). Its protection drops, and its build edits enter **gradual reclamation**: from `lapsedDay`, the build edits within it expire a few at a time **slowly, over many days** (a visible ruining — moss, gaps, then moor), never a sudden vanish; the lapse grace and this reclamation are deliberately **generous** (§14b), so a week away never costs a tended home. **Reclaimable:** return and pay before reclamation completes and the claim is restored (surviving builds stay; fully-reverted blocks are gone). A fully-reclaimed claim is removed and the land is open to claim again.

## 8. Kept-stock breeding (included)

A small husbandry reward tied to claims + farming (James's call to include): a **maintained** claim (not lapsed) holding ≥2 head of the same kept species, with room, occasionally (a low per-game-day chance, capped by the claim's space) yields a **lamb/calf** — a new kept beast of that species, penned to the claim. This slowly grows a flock on its own and feeds the drove supply, so the farming loop renews its own stock rather than only drawing wild Swaledales off the moor. Caps prevent runaway multiplication. Reuses the lamb mob + the `pets`/`stay`/`home` stock model.

## 9. In-game legibility (cross-cutting mandate)

No mechanic ships without its in-game telling (the project rule):
- **Handbook / about.html:** "the moor reclaims what's left untended — claim and keep a plot to hold your buildings." (about.html in James's voice, no em-dashes.)
- **Claims UI:** stake a claim (cost shown), see your claims + upkeep due, settle up. A deed-post block or the parish board.
- **Decay warnings:** "thi claim at [place] lapses in N days — pay t' upkeep" (toast/board); a lapsing claim looks like it's ruining.
- **Regrowth is self-evident** (you watch heather and seams come back); a one-line first-time hint when you first see something regrow.
- **Mining cues:** a refused too-deep break says why ("tha can only dig deep inside a licensed mine"); a mine UI (place an entrance, buy the licence, install fixtures, see the depth tha's cleared to); a band-floor hint ("tha needs an iron pick an' a safety lamp to go deeper").

## 10. Architecture & components

- **`src/editledger.js`** (NEW, headless-testable, no THREE/DOM) — the pure heart: the edit record `{cat, day, by}`, `categoryOf(action, oldId, newId)`, `lifespanOf(cat, blockId)`, `isExpired(edit, nowDay, inClaim)`; the deed helpers `deedFee(kind, radius, depth)`, `upkeepDue(deed, nowDay)`, `inClaim(deeds, x, z)`, `lapsed(deed, nowDay)`; and the mining helpers `depthBandFor(depthBelowGrade)` → `{ pick, fixture }` and `mayDigDeep(y, grade, mines, heldPick, fixtures)`. This is the swappable, fully-tested unit; everything else calls it.
- **`src/world.js`** — edits carry metadata; `setBlock` records `{cat, day, by}`; a generalised expiry pass (replacing/extending the beach-revert) reverts aged edits on load + near the player.
- **`src/main.js`** — categorise at the break/place sites (the existing `sendEdit` calls); the **1-block-deep break gate** + mine-entrance placement + licence/fixture purchase; the deed actions (stake / settle up); decay warnings + mining/regrowth hints; breeding tick.
- **`src/multiplayer.js`** — send edit metadata + claim messages; apply relay reverts/claims.
- **`deploy/world/server.py`** — store `{cat, day, by}` per edit + the claims; a periodic server-side expiry/prune pass (claim-aware) that broadcasts reverts; persist claims alongside edits.
- **`src/ui.js`** — the claims/deed panel + upkeep on the parish board; handbook section.
- **`src/defs.js` / `src/textures.js`** — new blocks/items: the **mine-entrance** block, the depth-band **fixtures** (pit-props, safety lamp, winch), and the new ores + products (**alum shale**, **potash/polyhalite**, rock salt).
- **`src/worldgen.js` `oreAt`** — gains the new ores by region + depth (alum shale in the coastal cliffs; potash/polyhalite deep at the NE/Boulby coast), a **skill-scaled richness threshold** (the precious finds need `miningSkill`), and a **worked-out thinning** of ore near old workings (reframing today's `nearKilns` boost). Existing coal/iron/jet seam depths stay.
- **`src/geography.js` / `src/worldgen.js`** — harvestable **peat** banks at the surface on the boggy tops (the existing `bogginess`), cut at grade (a `harvest` edit that regrows); **designated public quarry zones** placed at rocky sites near settlements/play (free, regenerating stone, the skim limit lifted within them; membership via the deed footprint test). **`src/economy.js`** — `B.PEAT` gains the **lowest** price (the cheap bulk fuel / trade good).
- **`src/player.js`** — `miningSkill` (mining XP) persisted in serialize/deserialize.

Isolation: the decision logic (categories, lifespans, expiry, claim membership, fees, upkeep) is one pure module (`editledger.js`); world.js, the relay, and the UI are thin consumers. The client and relay run the **same** pure rules (ported), so they cannot diverge.

## 11. Data flow

- **Edit:** break/place → `categoryOf` → record `{id, cat, day:sky.day, by}` in the ledger (client + relay).
- **Deep-dig gate:** a break more than one below the **original grade** (`grade = world.gen.height(x,z)`, the fixed seed height — not the current dug level, so free digging only ever skims) → `mayDigDeep(y, grade, mines, heldPick, fixtures)` → allowed only inside a licensed mine's envelope holding the band's pick + fixture; else refused with the reason.
- **Mine:** place entrance → buy licence (a `mine` deed) → install fixtures per band → deep breaks gated by the band's pick + fixture.
- **Expire (client):** chunk load / throttled near-player pass → for each edit, `isExpired(edit, sky.day, inClaim(claims, x, z))` → if so, drop the edit (base regenerates) + delete from netEdits.
- **Expire (relay):** periodic pass → same test on the authoritative dict → drop + broadcast revert + persist.
- **Deed (claim or mine):** stake → `deedFee(kind, radius, depth)` charged → deed stored (client + relay). Settle up → advance `paidUntilDay`.
- **Lapse:** `now > paidUntilDay + grace` → `lapsedDay` set → build edits inside begin gradual expiry.
- **Breed:** maintained claim tick → low chance → spawn a lamb/calf as kept stock anchored to the claim.

## 12. Error handling & edge cases

- **Categorisation ambiguity** (break a player-placed block that sat on dug ground): the *latest* action at a cell wins; breaking a build edit clears it (cell reverts to base). Documented rules in `categoryOf`.
- **Edit inside a claim staked later / claim lapses:** membership is tested at expiry time, so no edit rewrites are needed when claims change.
- **Chunk never loaded:** its edits don't expire client-side until visited; the relay's server pass covers the shared moor regardless. Consistent because expiry is pure day-math.
- **Save/load mid-life:** edits persist with their `day`; expiry on next load uses current `sky.day` (a long absence may regrow a lot at once — expected and desirable).
- **Multiplayer divergence:** prevented by deterministic day-math + the relay as the tiebreak source of truth for the shared dict.
- **Don't reclaim a build mid-construction:** unclaimed builds have a generous lifespan (§14) and a first-time warning; serious builders are nudged to claim. Never a sudden vanish — always gradual + reclaimable.
- **System claims** (croft, villages) never lapse or reclaim.
- **Natural caves & how-you-got-there:** the deep-dig gate is purely **depth below grade**, not how you arrived — mining a deep block needs a licensed mine even if a natural cave already exposed it (simple, consistent, no cave loophole). (Alternative: exempt pre-existing cave faces — decide at build; default is the depth gate.)
- **Cellars / building down:** a land claim does not grant deep digging; a cellar more than a block deep needs a mine licence too (the rule stays uniform; a deed can be both `claim` and `mine` on the same spot).
- **Grandfathering:** deep holes already dug before this ships are not retroactively backfilled (only a reset clears old edits); the gate applies to new breaks.

## 13. Build slices (one spec, sliced builds)

Each its own plan → implementation → deploy, in order:
- **Slice 1 — the ledger + flora/ore regrowth:** `editledger.js` (pure + headless) + edit metadata + client expiry generalising the beach-revert; surface **peat** banks (cut at grade + regrow + lowest price). Proves "the moor heals" single-player.
- **Slice 2 — the deeds backbone:** the pure deed record + helpers (fee, upkeep, membership, lapse) + the deeds store + the stake / settle-up UI. Abstract; serves both claims and mine licences.
- **Slice 3 — land claims (homesteads):** apply deeds to surface land — build-edit protection + lapse → gradual reclamation + warnings.
- **Slice 4 — licensed mining:** the mine-entrance block + the 1-block-deep hard rule + the shaft envelope + depth bands (pick tier + purchased fixtures) + the mining cues. Applies deeds underground. Includes the **researched ore palette** (alum coastal, potash/polyhalite deepest), **designated public quarries** (free, regenerating building-stone zones; the quarry/mine split), the **prospecting skill** (precious finds need `miningSkill`), and **free-but-exhausted old workings**.
- **Slice 5 — relay + breeding:** the server-side expiry/prune + deed persistence (`server.py`) so the shared moor heals authoritatively; kept-stock breeding.

**Sequencing reality (flag for James):** Slices 1–2 heal **single-player / adult** worlds and are shippable there, but the **shared bairns moor** — the actual concern — does not heal until the relay pass, because the relay resurrects locally-dropped edits. So the core payoff arrives with the relay work. Two options: keep it as Slice 5 (machinery first), or pull a **minimal** relay change forward (have the relay honour the client's revert message — `sendEdit` already carries one — so the shared moor heals from client-driven reverts from Slice 1, leaving only the server-side periodic pass for never-loaded chunks to Slice 5). Decide at Slice 1 plan time.

## 14. Open decisions (defaults chosen; change at review)

a. **Reversion = forget the edit; the deterministic base regenerates** (confirmed — no "before" state stored).
b. **Time in game-days** (`sky.day`; **a day = 30 real minutes**, `DAY_LENGTH=1800`), never wall-clock. **Rates bias SLOW (James's call, 2026-06-20): decay and healing must never be perceptible within a play session — they are a slow, seasonal background, felt across sessions, never watched.** Default lifespans (start slow, tune live by observation, only quicken if the world feels static): plants ~6 days, peat ~12, ore ~24, trees ~24, dug ground ~24; **decay is gentler still** — an unclaimed build only begins to reclaim after ~30+ days and crumbles gradually over many more, and a claimed build whose upkeep has lapsed gets a generous grace, so a child away for a week never loses a tended home. All rates are isolated constants (one-knob live-tuning).
c. **Claims = centre + radius cylinder**, fee + weekly upkeep scaled by radius (amounts tuned at build). Box footprints later.
d. **Maintenance = presence-based "visit & settle up"** (James's call), lapse → gradual reclamation, reclaimable.
e. **Kept-stock breeding included** (James's call): maintained claim + ≥2 same-species head + room → occasional lamb/calf, capped.
f. **Anti-open-mining = a hard licensed-mine gate (James's call, 2026-06-20 — supersedes the earlier soft model):** open ground allows only a 1-block scrape below grade; all deeper digging is funnelled through a placed **mine entrance + bought licence** (a deed, §6). Depth descends in **bands**, each gated by BOTH a minimum **pick tier** (wood→gritstone→iron) AND an installed **purchased fixture** (pit-props → safety lamp → winch); cost rises with depth (shallow coal cheap + accessible, deep jet dear). Ore depths in `oreAt` stay as-is. Exact band depths, fixtures, pick requirements + fees tuned at build.
g. **Wild respawn left as-is** (`trySpawns` is adequate); only kept-stock breeding is added.
h. **Relay role (to confirm at Slice 5 spec time):** `server.py` currently stores edits flat with no expiry; Slice 5 adds metadata + a server expiry/prune pass + deed persistence. The pure rules port from `editledger.js` so client and relay agree.
i. **Ore palette (researched, §15):** coal (shallow) · Cleveland ironstone (mid) · Whitby jet (deep, precious) · NEW alum shale (coastal cliff) · NEW potash/polyhalite + rock salt (deepest, Boulby NE coast — the modern precious prize). Distributed by region + depth; exact placement + yields tuned at build.
j. **Prospecting skill (James's call):** a `miningSkill` (XP from mining) gates the *precious* finds (jet, polyhalite) — a novice finds bare rock where an expert reads the seam; the deepest prize needs licence + equipment + skill.
k. **Old workings free but exhausted (James's call):** pre-existing mine structures are free to explore (already cut, no licence), but their seams are worked out (sparse ore near old workings, reframing `nearKilns`); real yield needs a new licensed mine.
l. **Peat (surface, James's call):** harvestable peat banks on the boggy tops (`bogginess`), cut at grade with **no licence** (the accessible entry), the **lowest-priced** good (cheap fuel/trade), regrowing as a `harvest` edit — completes the resource ladder below coal.
m. **Building stone = designated quarries, free + regenerating (James's call):** bulk building stone comes from **designated public quarry zones** (worldgen-placed at rocky sites near settlements; free, no licence, the skim limit lifted within them, and they regenerate). You **cannot open a quarry anywhere** — outside a quarry or a licensed mine the original-grade skim rule holds, so the open moor and wild crags can't be gouged. Beck `cobble`/`gravel` is a light free top-up anywhere. The deep **licence stays for ores only**. Quarry siting/size + regrowth tuned so stone is accessible, not grindy.

## 15. References (North York Moors mining history)

Researched 2026-06-20 to ground the ore distribution (James's call; accuracy over invention):
- **Industrial archaeology — ironstone, jet, alum, coal** · North York Moors National Park — https://www.northyorkmoors.org.uk/Historic-Environment-and-cultural-heritage/archaeology/industrial-archaeology
- **Cleveland & NY Moors iron mining** (Cleveland Ironstone Formation; Main/Pecten seams, identified 1836 on the Whitby–Pickering Railway) · Northern Mine Research Society — https://nmrs.org.uk/mines-map/iron-mining-in-the-british-isles/cleveland-north-yorkshire-moors-iron-mining/
- **Boulby Mine** (potash, polyhalite, rock salt; UK's deepest at ~1,400 m; Zechstein evaporites, polyhalite mined since 2016) · Wikipedia — https://en.wikipedia.org/wiki/Boulby_Mine
- **Alum industry of NE Yorkshire** (Loftus→Ravenscar, c.1604–1871; ~12 t shale → 1 t alum; England's whole alum supply until the early 1800s) · East Cleveland's Industrial Heartland — https://east-clevelands-industrial-heartland.co.uk/2018/01/17/the-alum-industry-of-north-east-yorkshire/
