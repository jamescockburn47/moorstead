# Folklore Quests — Design Spec

**Date:** 2026-06-23
**Goal:** Replace the thin quest layer with a **library of many quests grounded in real North York Moors mythology and history**, each with genuine *substance* — a lore-figure or living site you actually witness in the world (giants striding the moor-tops at dusk, the White Lady in the abbey ruin at the witching hour), not a talk-and-fetch errand. v2 (moors) world; period c.1900.

**Scope gate:** Moors world only (`geo.realWorld`). The stylised world keeps its current quests untouched. Built on the v2 roster population (givers) + real v2 landmarks.

---

## 1. Why / what exists

Today `src/quests.js` holds one or two hand-authored multi-chapter arcs (the barghest "Hound o' the Mires", the Dracula arc) tied to the v1 personas (james/glinda/harry) and v1 geography. The structure is already the right shape — a quest is a data record with a **giver**, **steps** at **landmarks**, NPC-held **clues** (kids blurt, elders riddle), a grounded **`truth`** (so the giver's chat never confabulates the mystery), and a **reward**. We extend that into a **library**, resolve it against the v2 roster + real landmarks, and add the missing thing: **visible, time-gated manifestations**.

---

## 2. The model — a folklore quest library

A quest is a data record (extending today's arc objects):

```
Quest {
  id, title, theme: 'myth'|'dark'|'history',
  giver:   { role?, place?, character? }   // resolves to a roster NPC by role+place (or a named curated persona)
  landmark: <real v2 location key or {x,z}>
  standingGate: int                        // min village standing to be offered
  steps:   [ { kind:'visit'|'place'|'collect'|'work', ...gating (night/dusk/midnight), objective, effect } ]
  clues:   [ { holderRole, text } ]        // held by fitting NPCs; kids plain, elders riddling
  manifestation?: <manifestation key>      // the visible payoff (see §3); optional for pure-history quests
  truth:   "<the real legend, stated plainly — grounds the giver's chat via the RAG>"
  loreFacts: [ "<real fact>", ... ]        // appended to the game-facts corpus so ANY NPC answers it grounded
  reward:  { items, trust, text }
}
```

The library is **data**: new quests are records, so "a lot more" is cheap. Givers and landmarks **resolve at runtime** against the live world (a quest names a *role + place*, e.g. "a Whitby fishwife"; the engine binds it to a real roster NPC there). A few quests remain richer **multi-chapter arcs** (the Hound); most are shorter single-encounter quests.

---

## 3. The substance layer — manifestations (the heart of this)

Every folklore quest pays off in something you **witness in the world**, **time-gated** (dusk / midnight) and **quest-gated** (only while you're on that quest, near its place; gone by dawn). This is a new **quest-manifestation layer**: special, conditional entities/effects, separate from the everyday roster folk, spawned by the quest engine when `(quest active) AND (at/near the landmark) AND (time window)` and despawned otherwise.

- **Apparition manifestations (myth/dark):** large or ghostly figures and creatures.
  - **Giants (Wade & Bell):** colossal silhouetted figures on the moor-tops by Wheeldale at dusk and midnight — Wade striding the causeway, Bell with her giant cow, a boulder arcing to a far howe. Slow, huge, wordless; fade by dawn.
  - **White Lady:** a pale, translucent woman drifting the abbey ruin and its high window at the witching hour; fades if approached or at first light.
  - **Hob:** a small, shy hob glimpsed threshing in Hart Hall barn / at Hob Hole by night; your treatment of it (leave a sark / cream, or offend it) changes the outcome.
  - **Barghest:** the phantom hound already prowls at night — the quest gives it its story.
  - **Hand of Glory:** a candle-lit, unnaturally still household at night, the dread hand on the table; you must snuff the candle.
  - **Smugglers:** lantern-lit figures landing contraband on the Bay shore by night, a lugger offshore, an exciseman to evade.
- **Living-site manifestations (history):** substance through real place + craft, not ghosts — the alum works smoking on the cliff, the Rosedale kilns alight, the Whitby jet shop at work, the Penny Hedge you weave on the foreshore at low tide, Lilla Cross on its howe.

**Implementation:** a `questfx`/special-entity module + a few new models/effects, gated on `geo.realWorld` + the active quest + the time/place condition. New manifestation entities are *not* roster mobs and skip the roster/villager AI entirely (like the existing barghest/dracula special mobs). They render only for the player on that quest.

---

## 4. v2 integration

- **Givers → roster NPCs.** A quest's `giver {role, place}` binds to a live roster NPC of that role near that place (e.g. the White Lady quest → a Whitby fishwife; Wade → a Goathland/Wheeldale shepherd; the Hand of Glory → an innkeeper; smugglers → a Robin Hood's Bay fisher). The curated deep personas (e.g. Amos the jet-cutter) are givers where they fit. If no NPC matches, the quest is simply not offered (never crashes).
- **Landmarks → real v2 locations.** Abbey, Rosedale kilns, the moor crosses (Lilla, Ralph, Fat Betty), the coast, the Wainstones, Roseberry already exist in the v2 data; Wade's Causeway and Hob Hole are added as landmark markers if absent.
- **Grounding (your auditability bar, applied to lore).** Each quest's `truth` + `loreFacts` are appended to the game-facts corpus (`src/game-facts.js`), so the giver — and any NPC asked — tells the *real* legend through the existing RAG + the anti-confabulation rule, never an invented one. The overnight grounding-coverage sweep is extended to quiz the quest lore.
- **Period accuracy (c.1900).** Folklore is *current belief* (folk still leave offerings, still fear the barghest). The industrial quests are *living memory / recent past*: the alum works largely closed by the 1870s and Rosedale's ironstone heyday is just over, so elders tell of them and the scars/sites remain; Whitby jet is declining from its mourning-trade peak but the shops are there. No anachronisms.

---

## 5. The starter set (all real NYM lore/history)

Flagship (full manifestation, built first): **Wade & Bell**, **The White Lady**, **Hob of Hart Hall**, **the barghest** (port), **Robin Hood's Bay smugglers**. The **biggest of all** — its own multi-chapter slice with a real boss battle — is **Dracula** (§5a).

| Quest | Theme | Real basis (sourced, not invented) | Giver (role@place) | Manifestation |
|---|---|---|---|---|
| Wade & Bell, the giants | myth | Wade's Causeway over Wheeldale; the giants who built Mulgrave/Pickering, hurling the hammer; Bell's giant cow; the howes are their throws | shepherd @ Goathland | giants on the moor-tops at dusk/midnight |
| The White Lady of Whitby Abbey | myth | the apparition in the abbey ruin; St Hilda, abbess 657 | fishwife @ Whitby | ghost lady in the ruin at the witching hour |
| St Hilda's snakestones | myth | Hilda turned the snakes to stone → the ammonites; carvers add snake-heads; Whitby's three snakestones | cooper/fossil-seller @ Whitby | ammonites coil/glint on the shore; collect them |
| Hob of Hart Hall | myth | the Glaisdale hob who threshed till given a smock, then left | farmer @ Glaisdale | a hob threshing the barn by night |
| Hob Hole | myth | the Runswick hob who cured the kink-cough | fishwife @ Staithes/coast | a hob shape in the cave mouth at night |
| The barghest | dark | the phantom black hound, omen of death (port the Hound arc) | shepherd @ a moor town | the night hound (exists) |
| The Hand of Glory | dark | the hanged man's hand that stills a household; the real one in Whitby Museum; the Spital Inn tale | innkeeper @ a market town | a frozen candle-lit house at night |
| Robin Hood's Bay smugglers | history | 18th-c. contraband through the cottage tunnels; the excisemen | fisher @ Robin Hood's Bay | a night landing: lanterns, a lugger, the exciseman |
| The Penny Hedge | history | Whitby's Ascension-Eve penance hedge for the 1159 hermit's killing | elder @ Whitby | weave the hedge on the foreshore at low tide |
| The alum trade | history | the Ravenscar/Boulby alum works; the urine shipped from London | alum-worker @ Ravenscar | the alum works smoking on the cliff; gather alum shale |
| Whitby jet & mourning | history | Victoria's mourning made jet the fashion; the Whitby cutters | jet-cutter @ Whitby (Amos) | the jet shop; mine → carve mourning jewellery |
| Rosedale ironstone | history | the kilns + the moor-top railway boom, just past its peak | ironstone miner @ Rosedale | the kilns alight; mine ironstone |
| Lilla Cross | history | Lilla, the thegn who took the assassin's blade for King Edwin (626); the oldest moor cross | parson @ a dale town | the cross on its howe; a vision of the deed (light manifestation) |

~13 to start; the framework scales to more as data.

---

## 5a. The flagship boss quest — Dracula (Whitby, c.1897)

**Real basis:** Bram Stoker wrote much of *Dracula* in Whitby (1890) and found the name in a book in the Whitby library. In the novel the Russian schooner *Demeter* is driven aground in a storm below the East Cliff, all hands dead and the captain lashed to the wheel; an immense black hound leaps ashore and bounds up the 199 steps to St Mary's churchyard beside the abbey; from there the Count takes his first English victim. Dracula is Whitby's own legend — the right home for the game's biggest quest.

The largest quest in the game: a **multi-chapter mystery** ending in a **hard, multi-phase boss battle** in a **dramatic setting** — St Mary's churchyard / the abbey ruin on the East Cliff, at night, in a storm. It **elevates the existing v1 `dracArc` + the `dracula` boss mob** to the v2 Whitby world.

The quest is built to **walk the whole moor** — each chapter sends you somewhere real to collect a material or prise knowledge from an NPC, before the boss.

- **Ch.1 — The wreck (Whitby).** A storm drives the *Demeter* onto the sands below the East Cliff: all hands dead, the captain lashed to the wheel. A great black hound leaps from the wreck and bounds up the 199 steps. The harbour folk and a fishwife tell what they saw; you search the wreck for the captain's log and find a hold full of earth-boxes.
- **Ch.2 — Gather the knowledge (across the dales).** No one in Whitby has the whole truth, so the quest sends you out across the moor for it: the **parson** at a moor church names the old defences; **Bess the herbwife** at Lealholm knows the wolfsbane and garlic; an **elder / the schoolmistress** carries the oldest lore. Each NPC gives a piece and points you to the next — knowledge gathered by travelling and talking.
- **Ch.3 — Collect the means (around the moors).** Assemble the defences from where they are found, criss-crossing the moor: **garlic and wolfsbane** from the herbwife's physic garden, a **blessed silver token** from the parson at one of the moor **crosses** (Lilla / Ralph), a **hawthorn stake** cut from a moor whitethorn, **consecrated earth** from a churchyard.
- **Ch.4 — The boxes of earth (Whitby).** Knowing now where he rests, find and sanctify his hidden boxes of Transylvanian earth in the Whitby vaults — each destroyed strips a resting place and weakens him.
- **Ch.5 — The reckoning (East Cliff, night, storm).** Atop the East Cliff in St Mary's churchyard by the abbey, confront the Count — the elevated `dracula` boss: harder and **multi-phase** (he summons the hound and bats; must be driven back with the blessed token; can only be finished with the hawthorn stake once his boxes are destroyed and dawn nears). A set-piece end.

The headline manifestation. It reuses the Slice-1 library engine + the manifestation/boss pattern and gets its **own detailed plan** as a major slice after the giants engine lands. Period-accurate (c.1897); all from the novel and Whitby history, no invented lore.

---

## 5b. Honours — titles & standing (the reward system)

Completing a quest grants an **earned title** plus a **standing boost** — honour is *worn*, not collected in a case. Each quest record may carry an `honour: { title, standing }`:

- **Title:** a period, Yorkshire-flavoured epithet earned for the deed — e.g. *Wade's Witness* (the giants), *Friend o' the Hob*, *Slayer o' the Count* (Dracula). On turn-in the title joins the player's earned titles; the player **wears** one (default: the latest/grandest), shown beside their name (HUD nameplate / character panel). A small **Titles** list (in the existing character/standing panel) shows all earned titles and lets the player choose which to wear.
- **Standing:** the quest's `standing` value feeds the existing standing system (`total_trust` / `standingIndex` / `STANDINGS`), so finishing quests visibly raises how the parish regards you. Tiered by quest weight — a short folklore encounter nudges it; Dracula is a major jump.
- **Persistence:** earned titles and the worn title save with the game (alongside `completed`).
- **Generic but opt-in:** the engine grants an honour **only for a quest that declares one**, so the stylised world's existing quests (which declare none) are untouched. Built first as a small cross-cutting slice and retrofitted to the moors quests (the giants first); the existing item/trust `reward` stays — `honour` is the new layer on top.

---

## 6. Build order (so it ships incrementally)

1. **Engine:** extend `quests.js` into the library (the data record above) + the v2 giver/landmark **resolver** + carry the existing arcs.
2. **Manifestation layer:** the `questfx` module + the gating (`realWorld` + active quest + time/place), with the **giants** and the **White Lady** as the first two manifestation types (prove the spectacle).
3. **Grounding:** quest `truth`/`loreFacts` → the game-facts corpus; extend the grounding-coverage sweep.
4. **Flesh out** the remaining starter quests as data + their manifestations.

Each step is a shippable increment; each gets its own task-level plan when built.

---

## 7. Testing

- **Headless (`verify-quests.mjs`):** every quest's giver role + place resolves to a real v2 roster role/town; every landmark resolves in the v2 geo; `truth`/`loreFacts` are non-empty; no quest references an unknown line/town/role (a bad record is dropped, never crashes).
- **Manifestation gating (headless):** the spawn predicate is true only when `(realWorld) AND (quest active) AND (in time window) AND (near landmark)`, false otherwise (so apparitions never leak into normal play or the stylised world).
- **Grounding:** the overnight grounding-coverage sweep gains the quest lore; NPCs answer "who's the White Lady / what's Wade's Causeway" grounded, and deflect on invented lore.
- **In-game smoke:** on the relevant quest, at dusk/midnight near the landmark, the manifestation appears (and not otherwise); the stylised world is unaffected.

---

## 8. Risks / open questions

- **Manifestation art/scale.** The giants' size/look and the White Lady's ghost shader are new visual work; start simple (silhouette/translucent) and refine. (A visual pass can come during the build.)
- **Performance.** Manifestations are few and quest+time+place gated, so cost is negligible; only one quest's manifestation is ever live at once.
- **Wade's Causeway / Hob Hole** may need adding as landmark markers in the moors data if not present — a small data add, checked at build.
- **Lore sourcing.** All lore authored from the real legends/history (the fine-tune lesson: author from real sources, never distil a model). Anything uncertain is flagged, not invented.
