# Dracula — the Flagship Quest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`). Where flagged "confirm against the engine", read the real code — the engine is the authority. This is a **multi-slice** build; Slice 1 is detailed below, Slices 2–3 are scoped and will be detailed when reached.

**Goal:** Elevate the existing Dracula arc into the game's biggest quest — a **moors-spanning mystery** that sends you across the moor to collect materials and gather knowledge from NPCs, ending in a **multi-phase boss battle** in a dramatic setting, rewarding a grand title.

**Architecture:** *Elevate, don't rebuild.* The v1 `buildDraculaArc(geo)` already gives: drac1 visit the **Dracula Museum** (`geo.museumSite()`), drac2 read the exhibits, drac3 draw **holy water** (abbey font, item `HOLY_WATER`), drac4 craft the **holy stake** (`HOLY_STAKE` = `WOODEN_STAKE` + `HOLY_WATER`), drac5 **vanquish the Count** (`kill` mob `dracula` at `DRACULA_MOOR`, night). It runs in v2 today via geo. We (1) insert moors-spanning knowledge+material chapters routed through **roster NPCs** (the parson, Bess the herbwife, an elder), (2) attach the **honour** (titles system, just built), (3) ground the lore, then in later slices (4) make the boss multi-phase in the **East Cliff / St Mary's churchyard** setting with the **boxes of earth**, and (5) add the **Demeter wreck** and **black-hound** spectacle.

**Tech Stack:** `src/quests.js` (`buildDraculaArc`, the folklore clue/resolver helpers from the giants slice, the honours helpers), `src/defs.js` (a few new materials), `src/game-facts.js` (grounding), `src/entities.js` + `src/main.js` (boss + manifestations, later slices), verify scripts.

**Standing rules:**
- **Do NOT git commit** (James commits). No deploy.
- Period-accurate (c.1897); all lore from Stoker's novel + real Whitby/moor history and folklore. Never invent.
- **Don't break the stylised-world arc:** the dracArc serves both worlds. New chapters use geo-derived locations (work in both) and **role-based** knowledge that surfaces via whatever cast exists; the v1 persona clues stay. Confirm the stylised path still flows end-to-end.
- Checkpoint per task = `npm run verify` green + `npm run build` ok. No commit.

---

## Slices
1. **The moors-spanning mystery + honour (the spine)** — detailed below.
2. **The multi-phase boss + the boxes of earth + the East Cliff setting** — scoped below.
3. **The Demeter wreck + the black-hound manifestation + storm FX + polish** — scoped below.

Each slice is shippable and verified on its own.

---

## SLICE 1 — the moors-spanning mystery + honour

Insert moors-spanning chapters between the museum intro and the boss, route the knowledge through roster NPCs, add the grand honour, ground the lore.

### Task 1.1 — new materials in defs.js

**Files:** Modify `src/defs.js`.

- [ ] **Step 1 — read** the item block (the `I.*` ids around `HOLY_WATER:95 … DRACULA_JOURNAL:98`, the name map ~208, the value/sell map ~256, and the carry/forage lists ~346). Confirm the next free `I.*` ids.
- [ ] **Step 2 — add three materials** following the exact pattern of `HOLY_WATER`/`WILD_GARLIC` (id, display name, sell value, and inclusion in any carry list `HOLY_WATER` is in):
  - `WOLFSBANE` — "Wolfsbane" (a moor-forage herb).
  - `SILVER_TOKEN` — "Blessed Silver Token".
  - `GRAVE_EARTH` — "Consecrated Earth".
  Add each to the name map and the value map (small values, e.g. 2–4), and to the same carry/quest-item list `DRACULA_JOURNAL`/`HOLY_WATER` belong to. Do NOT add block textures (these are inventory items, not placeable blocks) — confirm whether `HOLY_WATER` is item-only and mirror that exactly.
- [ ] **Step 3 — verify:** `npm run build` ok (no missing-id errors); `npm run verify` green.

### Task 1.2 — the moors-spanning chapters in buildDraculaArc

**Files:** Modify `src/quests.js` (`buildDraculaArc`).

- [ ] **Step 1 — read** `buildDraculaArc` (quests.js ~156–253) fully, plus `resolveGiver`/`resolveLandmark`/`folkClueFor` (the giants-slice helpers) and how `museumOffer`/the arc chapters are surfaced and chained (`needs`). Confirm how a `visit` step with `x,z,r` and a `collect` step with `item,n` complete, and how `effect` (e.g. `dropHolyWater`) is applied — you will mirror these.
- [ ] **Step 2 — renumber the chain** so new chapters slot in after drac2 (the exhibits) and before the holy-water/stake/boss chapters. Keep the ids stable where possible; add new ids `dracA` (parson) and `dracB` (herbwife). Re-point `needs` so the order is: drac1 → drac2 → **dracA → dracB** → drac3 (holy water) → drac4 (stake) → drac5 (boss). (drac3/4/5 keep their ids so saves/`draculaDone` still work — confirm nothing else hardcodes the chain.)
- [ ] **Step 3 — dracA "The Parson's Counsel"** (knowledge + a material, across the moor):
```js
dracA: {
  id: 'dracA', giver: 'museum', minStanding: 0, needs: 'drac2',
  title: "The Parson's Counsel",
  desc: "T' museum keeper bids thee seek t' parson out on t' moor — he knows t' old defences, an' keeps a blessed token.",
  offer: "You can offer the visitor the next step: ride out across the moor to the parson at his moor church and hear the old defences against what walks from Whitby — and ask him for a blessed silver token. Knowledge is gathered by travelling and asking.",
  steps: [
    { kind: 'visit', x: cross.x, z: cross.z, r: 14, effect: 'dropSilverToken',
      objective: "Seek t' parson at t' moor cross for his counsel" },
  ],
  turnIn: 'auto',
  truth: "The visitor has NOT yet sought the parson. Do not claim they carry the silver token or know the defences.",
  doneNote: "The visitor sought the parson at the moor cross, heard the old defences, and was given a blessed silver token.",
  reward: { items: [], trust: [], text: "“Silver an’ the cross,” the parson says, pressing the token into thi hand. “Wolfsbane an’ garlic for the body, holy water for the ground, an’ a stake for the heart. Go careful.”" },
  clues: [
    { holder: 'glinda', holderRole: 'parson', text: "T' parson at t' owd cross has read more than t' Bible. He'll tell thee what holds t' Count off — silver, wolfsbane, holy water, an' a stake steeped true." },
    { holder: 'harry', holderRole: 'schoolmistress', text: "Miss says Whitby folk pinned wolfsbane ower t' door against t' neet-walker. I thought it were just an owd tale." },
  ],
},
```
Confirm a real landmark for the parson: use a moor **cross** (`geo` landmarks — Lilla / Ralph; reuse the `resolveLandmarkPoint` key if one exists, else a `geo`-derived cross/church point). Add a `dropSilverToken` effect mirroring `dropHolyWater` (grants `I.SILVER_TOKEN`) — confirm where `dropHolyWater` is implemented and add alongside.

- [ ] **Step 4 — dracB "The Herbwife's Garden"** (knowledge + collect materials, across the moor):
```js
dracB: {
  id: 'dracB', giver: 'museum', minStanding: 0, needs: 'dracA',
  title: "The Herbwife's Garden",
  desc: "Bess the herbwife at Lealholm grows wolfsbane an' garlic. Gather both — t' body's defence against him.",
  offer: "You can offer the visitor the next step: go to Bess the herbwife at Lealholm, who keeps wolfsbane and garlic in her physic garden, and gather both — the old protection worn on the body against the night-walker.",
  steps: [
    { kind: 'collect', item: I.WOLFSBANE, n: 1, objective: "Gather wolfsbane (Bess's garden, Lealholm)" },
    { kind: 'collect', item: I.WILD_GARLIC, n: 2, objective: "Gather wild garlic (2)" },
  ],
  turnIn: 'auto',
  truth: "The visitor has NOT yet gathered the wolfsbane and garlic. Do not claim they are protected.",
  doneNote: "The visitor gathered wolfsbane and garlic from Bess the herbwife at Lealholm.",
  reward: { items: [], trust: [], text: "Bess ties t' wolfsbane in a sprig. “Wear it close,” she says. “It'll not slay him, but it'll turn his eye.”" },
  clues: [
    { holder: 'glinda', holderRole: 'herbwife', text: "Bess at Lealholm grows wolfsbane — monkshood, some call it. Deadly to eat, but the owd folk say the neet-walker can't abide it. Garlic an' all." },
  ],
},
```
Confirm how `WOLFSBANE` is obtained — either a forage drop in Bess's area (add to the forage table the way `WILD_GARLIC` forages) or a `giveItem`/effect on visiting Bess. Keep it simple and confirm against how `WILD_GARLIC` is gathered today.

- [ ] **Step 5 — the honour** on the final chapter (drac5): add
```js
honour: { title: "Slayer o' the Count", standing: 5 },
```
(the grandest honour in the game — confirm `standing:5` is a meaningfully large bump vs the giants' `1`).

- [ ] **Step 6 — verify:** `npm run verify` green; `npm run build` ok. Confirm (read) the **stylised** dracArc still chains end-to-end with the two inserted chapters (the new givers are `museum`, the locations geo-derived, so both worlds flow). No commit.

### Task 1.3 — grounding + verify

**Files:** Modify `src/game-facts.js`; modify `scripts/verify-quests.mjs` (or a new `verify-dracula.mjs`).

- [ ] **Step 1 — grounding facts** in `game-facts.js` (so NPCs tell the real story when asked):
```js
{ topic: 'dracula', keywords: ['dracula','count','stoker','demeter','vampire','vampyre','199 steps','whitby abbey'],
  text: "Bram Stoker wrote much of Dracula while staying in Whitby in 1890, and took the name from a book in the Whitby library. In the novel the Russian schooner Demeter wrecks below the East Cliff in a storm, all hands dead, and a great black hound leaps ashore and bounds up the 199 steps to St Mary's churchyard by the abbey. Folk here still half-believe the Count walks the moors at night." },
{ topic: 'vampire-defences', keywords: ['wolfsbane','garlic','holy water','silver','stake','crucifix','defence','protect'],
  text: "The old defences against the night-walker: garlic and wolfsbane worn on the body, holy water and consecrated ground, a blessed silver token, and a wooden stake steeped in holy water to finish him." },
```
Run the facts-sync step if the repo has one (the giants slice regenerated `clint-body/game-facts.json` via `scripts/sync-facts.mjs`).
- [ ] **Step 2 — assertions:** extend the verify script — the dracArc chain resolves (`drac1→drac2→dracA→dracB→drac3→drac4→drac5`, each `needs` present); drac5 declares `honour.title` non-empty + `honour.standing > 0`; the new `I.WOLFSBANE/SILVER_TOKEN/GRAVE_EARTH` exist in `defs`; the dracula + vampire-defences game-facts retrieve. Print the count.
- [ ] **Step 3 — verify:** `npm run verify` green; `npm run build` ok. No commit.

### Slice 1 self-review (against the spec §5a)
- Walks the moor (parson at a cross, Bess at Lealholm) collecting materials + knowledge → Tasks 1.1–1.2. ✓
- Knowledge from NPCs (role-based clues surface via the roster) → dracA/dracB clues with `holderRole`. ✓
- Grand honour on completion → Task 1.2 Step 5 + the honours system. ✓
- Grounding so the tale is told true → Task 1.3. ✓
- Stylised arc unbroken → Task 1.2 Step 6 check. ✓

---

## SLICE 2 — the multi-phase boss + the boxes of earth + the storm

The dramatic finale. Three tasks: the arena + boxes chapter, the multi-phase boss, and the storm (thunder/lightning/rain-or-snow).

### Task 2.1 — the v2 arena + the boxes of earth
- **A real v2 arena** on the East Cliff by the abbey churchyard. `MoorsGeography` already has the abbey landmark (`abbeyFont()` resolves there ~`(1822,3085)`); add `geo.draculaArena()` returning a clear, in-bounds cliff-top point by the abbey (confirm solid ground + a flat-ish radius). Make `drac5.spawnAt` **dual-world**: `geo.realWorld ? draculaArena() : DRACULA_MOOR` (keep the stylised arena untouched).
- **The boxes of earth** — a new chapter `dracC` between drac4 (the stake) and drac5 (the boss): the Count's boxes of Transylvanian earth are hidden near Whitby; find and **sanctify** N=3 of them. Use `GRAVE_EARTH` (Slice 1 seeded it) + holy water: e.g. `visit` each of 3 box sites near Whitby and an `effect: 'sanctifyBox'` that consumes a unit of holy water and marks a box done; track `this.boxesSanctified` on `Quests` (persisted). Confirm how multi-count `visit`/`effect` steps work (mirror `dropHolyWater`/the visit handler). Giver in v2: the **fishwife** (role/place via `DRACULA_V2_GIVERS`); stylised: `museum`.
- **Gate the kill:** drac5 can only be *finished* once `boxesSanctified >= 3` (see Task 2.2's kill condition). Update `draculaNext`/`needs`: …→drac4→**dracC**→drac5; update `DRACULA_V2_GIVERS` + `verify-dracula.mjs` for the new chapter.

### Task 2.2 — the multi-phase boss
Elevate the `dracula` mob (`entities.js`; it already takes holy-stake-only damage at ~1171 and projects a night `draculaDread` at ~968):
- **Phase 1 (approach):** the Count closes with the dread aura; periodically **summons** a `barghest` (the hound) and a flutter of `bat` mobs (confirm a bat/boggart type or add a simple bat) near him, capped, despawning on his death.
- **Phase 2 (warding):** holding the **silver token** or **holy water** in hand within range **staggers/repels** him (a brief knockback + invulnerability-to-approach window) — the player alternates warding and striking.
- **Phase 3 (the kill):** he is only *killable* with the **holy stake** AND `quests.boxesSanctified >= 3` AND dawn is near (`sky.time` approaching 0.18); before that, stake hits stagger but don't drop the last of his hp. Reuse the existing stake-dmg path; add the gate. Keep the **stylised** drac5 working (the simpler existing fight, or the same elevation guarded so it doesn't depend on v2-only state).

### Task 2.3 — the storm (thunder, lightning, rain or snow)
While the boss fight is live (`entities.draculaHuntActive()`/`draculaActive()` at the arena), drive a **storm**, reusing the existing systems:
- **Precipitation:** force the weather to a heavy state — **rain**, or **snow if it is winter** (`game.season`/`seasonOverride`) — using the existing `snow.js`/weather renderer (confirm how the live-weather state drives precipitation and override it for the fight; restore the prior state after).
- **Lightning:** periodic flashes — a brief spike of `sky` ambient/sun + a white screen-flash overlay (confirm `Sky`'s light handles; the dread aura already modulates ambient, so add a transient `flash` term). Randomised intervals (vary by a per-flash index, since `Math.random` is fine in the client runtime).
- **Thunder:** a **thunder** clap in `audio.js`, played a beat **after** each flash (delay scaled so close strikes crack and distant ones rumble).
- Season-aware, scoped to the fight only (no permanent weather change); ends when the Count falls or the player leaves. Confirm `audio.js`'s sound-loading idiom and add `thunder` alongside the existing cues.

### Slice 2 self-review (against spec §5a Ch.4–5 + the storm)
- Boxes-of-earth investigative chapter gating the kill → 2.1. ✓
- Multi-phase boss (summons / ward / staked-at-dawn) at the East Cliff arena → 2.1 + 2.2. ✓
- Thunder + lightning + rain/snow during the battle → 2.3. ✓
- Stylised drac5 unbroken → 2.1/2.2 dual-world guards. ✓

## SLICE 3 — the Demeter wreck + the black hound + polish (scoped)
- A **Demeter wreck** prop on the Whitby foreshore for Ch.1 (investigate → the `DRACULA_JOURNAL` captain's log), quest-gated.
- The **black-hound-up-the-199-steps** manifestation (reuse the barghest/manifestation pattern), quest-gated.
- Storm FX, final balance pass, full in-game smoke of the whole arc end-to-end.
