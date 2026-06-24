# Folklore Quests — Slice 1: the library engine + the giants (Wade & Bell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. The implementer MUST read the real `src/quests.js` engine for exact wiring where flagged "confirm against the engine" — like the B.1 plan, code below is the intent; the engine is the authority.

**Goal:** Stand up the v2 folklore-quest library engine and ship the first fully-manifested flagship quest — **Wade & Bell, the giants** — where, while on the quest, you crest the moor at dusk or midnight near Wade's Causeway and *see the giants themselves* striding the skyline.

**Architecture:** Extend `src/quests.js` into a **v2 folklore library** (data records) with a **resolver** that binds each quest's `giver {role, place}` to a live roster NPC and its `landmark` to a real location. Add a **manifestation** as a quest-gated special mob (the giant), following the existing barghest/Dracula pattern (`makeGiant()` + `MOB_TYPES.giant` + a spawn gated on `realWorld && quest-active && near-landmark && dusk|midnight`, despawned otherwise). Ground the lore through `src/game-facts.js` (the RAG), so any NPC tells Wade's tale true. Moors-gated; the stylised world's quests are untouched.

**Tech Stack:** JS ES modules, `src/quests.js`, `src/entities.js` (`MOB_TYPES` + `make*`), the roster (`game.rosterClient`) for givers, `src/game-facts.js` (grounding), `node` verify scripts.

**Standing rules:**
- **Do NOT `git commit` the client repo** — James commits. No deploy.
- **Period-accurate:** all Wade lore from the real legend (Wade's Causeway / Wheeldale; Wade & Bell built Mulgrave & Pickering; Bell's giant cow; the howe-stones are their throws). Never invent lore.
- **Moors-gated** (`geo.realWorld`); the giant is a **special mob** that skips villager/roster AI (like `dracula`).
- Checkpoint per task = `npm run verify` (+ the new `verify-quests`) green and `npm run build` ok. No commit.

---

## File structure
- Modify `src/quests.js` — add `buildFolkloreQuests(geo)` (the library), the giver/landmark **resolver**, and the v2 offering path (offer folklore quests when `geo.realWorld`, binding givers to roster NPCs). Existing arcs untouched.
- Modify `src/entities.js` — `makeGiant()` model + `MOB_TYPES.giant` (huge, wordless, no wander).
- Modify `src/main.js` — a per-frame `updateQuestFx()` call that spawns/despawns the manifestation per the gate (near the giants' `update*` calls). (Or a small `src/questfx.js` if cleaner — confirm where the existing special-mob spawns live.)
- Modify `src/game-facts.js` — the Wade lore facts (grounding).
- Create `scripts/verify-quests.mjs` — resolver + manifestation-gating assertions; append to `package.json` `verify`.
- Data: a **Wheeldale/Wade's-Causeway** location. Check `data/moors-data.json` `landmarks` for it; if absent, add a marker (a moor-top point west of Goathland) in the data + the moors-data build, or define it as a constant in `quests.js` keyed to a real moor-top coordinate. Confirm against the data.

---

## Task 1: the folklore library engine + resolver

**Files:** Modify `src/quests.js`; Create `scripts/verify-quests.mjs`; Modify `package.json`.

- [ ] **Step 1 — read the engine.** Read `src/quests.js` `class Quests` (`refreshOffers`, `arcNext`, `buildArcInstance`, `accept`, `update`, `stepDone`, `turnInFor`, `offers`). Confirm: how an offer is surfaced to the player at a giver, and how a quest instance's `giver`/`turnIn` (NPC names) drive offer + turn-in. The folklore quests reuse this instance shape + lifecycle.

- [ ] **Step 2 — the library + record.** Add `buildFolkloreQuests(geo)` returning an array of records (the spec's schema): `{ id, title, theme, giver:{role,place}, landmark, standingGate, steps, clues, manifestation, truth, loreFacts, reward }`. Seed it with ONE record for now — the giants (Task 2 fills its content). Keep it pure data.

- [ ] **Step 3 — the resolver.** Add `resolveGiver(q)` → a live roster NPC matching `q.giver.role` at `q.giver.place` (search `game.rosterClient`'s npcs / the roster snapshot by role + place; fall back to any NPC at the place; return null if none). And `resolveLandmark(q)` → `{x,z}` for `q.landmark` (from `geo` landmarks / the data / the constant). A quest only becomes offerable when both resolve (else skipped — never crash). **Confirm against the engine** how to read the roster NPCs (the `RosterClient.npcs` map: `{data:{id,name,role}, ...}`).

- [ ] **Step 4 — v2 offering.** In the offer path (`refreshOffers` or where v1 arcs are offered), when `geo.realWorld`, also offer resolved folklore quests: set the instance's `giver`/`turnIn` to the resolved NPC's name, so talking to that NPC offers/turns-in the quest through the existing flow. Gate by `standingGate`. Existing v1 arcs only offer in the stylised world (they already key off v1 personas/geography — confirm they don't fire in v2).

- [ ] **Step 5 — `scripts/verify-quests.mjs`** (mirror the verify-*.mjs pattern; `Gen, MOORS_SEED`; counter; print `verify-quests: N assertions OK`): build the v2 geo; assert `buildFolkloreQuests(geo)` returns ≥1 record; the giants record has non-empty `truth` + `loreFacts`; its `giver.place` is a real v2 town and `giver.role` is a role the population can produce (e.g. 'shepherd'); `resolveLandmark` returns an in-bounds `{x,z}`. (Resolver-vs-live-roster is exercised in the in-game smoke, Task 4.) Append `&& node scripts/verify-quests.mjs` to `verify`.

- [ ] **Step 6 — verify.** `node scripts/verify-quests.mjs` → `verify-quests: N assertions OK`; `npm run verify` green; `npm run build` ok.

---

## Task 2: the giants quest data + grounding

**Files:** Modify `src/quests.js` (the giants record); Modify `src/game-facts.js`.

- [ ] **Step 1 — the giants record** in `buildFolkloreQuests`:
```js
{
  id: 'folk_wade', title: "Wade's Causey", theme: 'myth',
  giver: { role: 'shepherd', place: 'Goathland' },
  landmark: 'wades_causeway',                 // resolved to a Wheeldale moor-top point
  standingGate: 0,
  manifestation: 'giants',
  steps: [
    { kind: 'visit', landmark: 'wades_causeway', r: 40, time: 'duskOrNight',
      objective: "Walk Wade's Causey at dusk or after dark" },
  ],
  clues: [
    { holderRole: 'shepherd', text: "Owd folk say t' straight stone road ower Wheeldale were laid by t' giant Wade, for his wife Bell to drive her cow across t' mire. Walk it at gloamin' an' tha might see 'em yet." },
    { holderRole: 'schoolmistress', text: "They reckon Wade an' Bell built Mulgrave an' Pickering castles atween 'em, lobbin' t' same hammer ower t' moor. T' big stones out on t' tops are what they threw." },
  ],
  truth: "Wade is the legendary giant of these moors. Wade's Causeway is the old straight stone road over Wheeldale Moor, said to be built by Wade for his wife Bell to drive her giant cow across the bog. Wade and Bell are said to have built Mulgrave and Pickering castles, tossing a single hammer between them, and the great stones and howes on the moor-tops are the stones they hurled. This is folklore the moor folk still tell; do not invent extra details.",
  loreFacts: [
    "Wade is the legendary giant of the North York Moors. Wade's Causeway is the old straight stone road over Wheeldale Moor, said to be built by Wade for his wife Bell.",
    "Wade and Bell, the giants, are said to have built Mulgrave and Pickering castles by throwing a single hammer between them; the boulders and howes on the moor-tops are stones they threw.",
  ],
  reward: { items: [/* a period reward, e.g. [I.COOKED_MUTTON, 3] — confirm an item id in defs */], trust: [], text: "“Tha saw 'em, then,” the shepherd says, going quiet. “Not many do. Wade walks for them as walk his causey honest.”" },
}
```
Confirm an `I.*` reward item id exists in `defs.js` (use one the economy already prices, e.g. `COOKED_MUTTON`).

- [ ] **Step 2 — grounding.** Append the Wade lore to `src/game-facts.js` as a topic so ANY NPC answers it true:
```js
{ topic: 'wade', keywords: ['wade','giant','giants','causeway','causey','wheeldale','bell','mulgrave'],
  text: "Wade is the legendary giant of the moors. Wade's Causeway is the old straight stone road over Wheeldale Moor, built (folk say) by Wade for his wife Bell to drive her giant cow across the bog. Wade and Bell built Mulgrave and Pickering castles, tossing one hammer between them; the moor-top boulders are their throws." },
```

- [ ] **Step 3 — verify.** `node scripts/verify-quests.mjs` still green; add an assertion that the Wade game-fact retrieves for "who is Wade / what is Wade's causeway" (reuse the `factsContext` import as `verify-facts` does). `npm run verify` + build green.

---

## Task 3: the giants manifestation (the substance)

**Files:** Modify `src/entities.js` (`makeGiant` + `MOB_TYPES.giant`); Modify `src/main.js` (the per-frame gate).

- [ ] **Step 1 — `makeGiant()`** in `entities.js`, modelled on `makeBarghest`/`makeDracula` (a THREE group), but **huge** (≈4–6× a villager: tall legs, a long stride, a dark silhouette; a simple block figure is fine for v1 — refine later). Return `{ group, legs }` so the streamed/animation code can swing the legs.

- [ ] **Step 2 — `MOB_TYPES.giant`** = `{ make: makeGiant, hw: 1.6, h: 7.0, hp: Infinity, speed: 1.0, special: true }` (slow, unkillable, wordless). Confirm the `special`/no-AI convention used by `dracula` so the giant skips wander/villager logic (it is driven by the manifestation updater, not mob AI) — mirror how `dracula` is handled in `entities.update`.

- [ ] **Step 3 — the gated manifestation** (in `main.js`, a small `updateQuestFx(dt)` called each frame near the other `update*` calls — confirm where Dracula's quest-gated spawn lives and mirror it):
```js
updateQuestFx(dt) {
  const geo = this.world.gen.geo;
  if (!geo.realWorld) return;                            // moors only
  const q = this.quests && this.quests.activeManifestation && this.quests.activeManifestation('giants');
  const lm = q && this.quests.resolveLandmark(q);        // {x,z} of Wade's Causeway
  const dusk = this.sky && (this.sky.time > 0.78 || this.sky.time < 0.2);  // dusk/night/midnight window
  const near = lm && Math.hypot(this.player.pos.x - lm.x, this.player.pos.z - lm.z) < 220;
  const want = !!(q && lm && dusk && near);
  if (want && !this._giants) {
    // spawn Wade + Bell on the moor-top skyline near the causeway
    this._giants = [ this.entities.spawnMob('giant', lm.x + 80, 0, lm.z + 40),
                     this.entities.spawnMob('giant', lm.x + 120, 0, lm.z - 30) ];
    for (const g of this._giants) g.pos.y = geo.height(Math.round(g.pos.x), Math.round(g.pos.z)) + g.h * 0.5;
  } else if (!want && this._giants) {
    for (const g of this._giants) { this.entities.scene.remove(g.model.group); g.dead = true; }
    this._giants = null;
  }
  if (this._giants) { /* slow stride along the skyline; confirm the giant pos/yaw drive */ }
}
```
Confirm: `spawnMob` returns the mob; the despawn idiom (`scene.remove(model.group)` + `dead`); `sky.time` dusk window; and `quests.activeManifestation(key)` (add a tiny helper on Quests returning the active instance whose `manifestation === key`, else null).

- [ ] **Step 4 — wire** `if (this.quests) this.updateQuestFx(dt);` into `frame()` (with the other per-frame `update*` calls). `npm run build` ok.

---

## Task 4: verify end-to-end + in-game smoke

- [ ] **Step 1 — gating unit test** in `verify-quests.mjs`: factor the spawn predicate into a pure helper `wantGiants({realWorld, questActive, dusk, near})` and assert it's true ONLY when all four hold, false otherwise (so giants never leak into normal play or the stylised world). Import + assert it.
- [ ] **Step 2 — `npm run verify`** green (incl. `verify-quests`); **`npm run build`** ok.
- [ ] **Step 3 — in-game smoke** (controller drives via preview + the local brain so a roster shepherd exists at Goathland to give the quest): enter the moors; accept the Wade quest from the Goathland shepherd; warp near Wade's Causeway; set the sky to dusk/midnight; confirm the two giants appear on the skyline and despawn by day / when off-quest / away; confirm the stylised world shows no giants (gate holds) and no console errors.

---

## Self-review (against the spec)
- Library engine + resolver → Task 1. ✓
- Giants quest (real lore) + grounding → Task 2. ✓
- Manifestation (visible, dusk/midnight + quest + place gated) → Task 3, with the pure gate tested in Task 4. ✓
- Moors-gated, stylised untouched, period-accurate, no-confab grounding → throughout. ✓
- The remaining flagship manifestations (White Lady, hob, smugglers) + the history quests are later slices (each its own plan), reusing this engine + manifestation pattern.
