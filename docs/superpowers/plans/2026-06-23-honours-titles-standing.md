# Honours: Titles & Standing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Where flagged "confirm against the engine", read the real code — the engine is the authority.

**Goal:** A cross-cutting reward layer: completing a quest grants an **earned period title** + a **standing boost**; titles persist, are worn beside the player's name, and are viewable/choosable in the character panel.

**Architecture:** Add an optional `honour: { title, standing }` to quest records. In `Quests.finish`, if the finished quest declares an `honour`, earn its title (into a persisted store) and apply its standing boost to the existing standing system. Persist earned + worn titles in save/load. UI shows the worn title by the player's name and a Titles list to choose from. **Opt-in per quest** — only quests that declare an `honour` award one, so the stylised world's quests (which declare none) are untouched.

**Tech Stack:** JS ES modules — `src/quests.js` (finish + standing), the save/load path, `src/ui.js`, a `scripts/verify-honours.mjs`.

**Standing rules:**
- **Do NOT git commit** (James commits the client). No deploy.
- Period-accurate, Yorkshire-flavoured titles.
- Honour fires **only** for a quest declaring it → stylised world untouched (confirm no existing arc/job declares `honour`).
- Checkpoint per task = `npm run verify` (incl. the new `verify-honours`) green + `npm run build` ok. No commit.

---

## File structure
- Modify `src/quests.js` — the earned/worn-title store + helpers (`earnTitle`, `setWornTitle`, `earnedTitleList`, `wornTitle`), the honour grant in `finish()`, and the giants quest's `honour`.
- Modify the **save/load** path — persist earned titles + the worn title (find where `quests.completed` is serialized/restored; grep `completed` in the save/load).
- Modify `src/ui.js` — render the worn title beside the player's name, and a Titles list in the character/standing panel.
- Create `scripts/verify-honours.mjs` — assertions; append to `package.json` `verify`.

---

## Task 1: the honour engine + persistence + retrofit the giants

**Files:** Modify `src/quests.js`; modify the save/load path; create `scripts/verify-honours.mjs`; modify `package.json`.

- [ ] **Step 1 — read the engine.** Read `Quests.finish` (how a quest completes and how `reward.trust`/standing is applied), `standingIndex`/`STANDINGS`/`game.standingData.total_trust` (how standing is read), and the save/load (where `this.completed` is written and restored). The honour grant hooks into `finish`; the persistence mirrors `completed`.

- [ ] **Step 2 — the title store** on `Quests` (constructor): `this.earnedTitles = []` (array of unique title strings, order = earned order) and `this.wornTitle = null`. Helpers:
```js
earnTitle(t) { if (t && !this.earnedTitles.includes(t)) { this.earnedTitles.push(t); this.wornTitle = t; } }   // newest worn by default
setWornTitle(t) { if (t === null || this.earnedTitles.includes(t)) this.wornTitle = t; }
earnedTitleList() { return this.earnedTitles.slice(); }
```

- [ ] **Step 3 — grant on finish.** In `finish(inst, ...)`, after the existing reward is applied, add:
```js
if (inst.honour) {
  if (inst.honour.title) this.earnTitle(inst.honour.title);
  if (inst.honour.standing) this.bumpStanding(inst.honour.standing);   // see Step 4
  if (inst.honour.title) this.game.ui.toast(`Tha's earned t' name <b>${inst.honour.title}</b>.`, 5000);
}
```
Confirm the exact place in `finish` where rewards land, and that `inst.honour` is carried onto the instance (folklore instances are built in `buildFolkInstance` — add `honour: q.honour` there; arc instances via `buildArcInstance`/`buildDracInstance` — add `honour: def.honour` so future arcs can declare one too).

- [ ] **Step 4 — apply standing.** Add `bumpStanding(n)` that raises the standing the same way `reward.trust` does. **Confirm** how trust is added today (e.g. `this.game.standingData.total_trust += n`, or a method). Reuse that exact path so a quest's `honour.standing` and its `reward.trust` move the same number.

- [ ] **Step 5 — persistence.** Where `this.completed` is saved, also save `earnedTitles` and `wornTitle`; where it is restored, restore them (default `[]` / `null` for old saves). Confirm the save/load object shape and mirror `completed` exactly.

- [ ] **Step 6 — retrofit the giants.** Add to the `folk_wade` record in `buildFolkloreQuests`: `honour: { title: "Wade's Witness", standing: 1 }`.

- [ ] **Step 7 — `scripts/verify-honours.mjs`** (mirror the verify-*.mjs pattern; counter; print `verify-honours: N assertions OK`). Build a v2 `Quests` (or a minimal stand-in exercising the helpers) and assert:
  - `earnTitle('X')` then `earnTitle('X')` → `earnedTitleList()` has one `'X'`; `wornTitle === 'X'`.
  - `earnTitle('Y')` → `wornTitle === 'Y'` (newest worn); list `['X','Y']`.
  - `setWornTitle('X')` → `wornTitle === 'X'`; `setWornTitle('Z')` (unearned) → unchanged.
  - the giants record (`buildFolkloreQuests` → `folk_wade`) declares `honour.title` non-empty and `honour.standing > 0`.
  - **no stylised quest declares an honour** (build the v1 arcs and assert none has `honour`) — proves the stylised world is untouched.
  Append `&& node scripts/verify-honours.mjs` to `verify`.

- [ ] **Step 8 — verify.** `node scripts/verify-honours.mjs` → OK; `npm run verify` green; `npm run build` ok. No commit.

---

## Task 2: UI — wear the title, list the honours

**Files:** Modify `src/ui.js` (+ wherever the player's name / character panel renders — confirm).

- [ ] **Step 1 — find the anchors.** Locate where the player's name is shown (HUD nameplate / intro / character panel) and where standing (`standingLabel()`) is rendered (grep `standingLabel`, the player name, the character/journal panel). The title sits beside the name and the list sits in that same panel.

- [ ] **Step 2 — wear the title.** Where the player's name (or standing) is shown, append the worn title if any: e.g. `name + (quests.wornTitle ? `, <i>${quests.wornTitle}</i>` : '')`. Keep it inert when `wornTitle` is null (stylised players never earn one, so they see no change).

- [ ] **Step 3 — the Titles list.** In the character/standing panel, add a small "Honours" section listing `quests.earnedTitleList()`; the worn one marked; clicking a title calls `quests.setWornTitle(t)` and re-renders; an "—" / "none" entry calls `setWornTitle(null)`. If the list is empty, show a faint "No honours yet — folk have no special name for thee." Confirm the panel's render/click idiom and match it.

- [ ] **Step 4 — verify.** `npm run verify` green; `npm run build` ok. In-game smoke (controller): complete a quest with an honour → toast fires, the title appears by the name, the Titles list shows it and lets you switch/clear; stylised world shows no titles. No commit.

---

## Self-review (against the spec §5b)
- Earned title + standing boost on completion → Task 1 (Steps 3–4, 6). ✓
- Persistence of earned + worn titles → Task 1 Step 5. ✓
- Worn beside the name + a chooser list → Task 2. ✓
- Opt-in per quest, stylised untouched → Task 1 Step 3 (`if (inst.honour)`) + Step 7's no-stylised-honour assertion. ✓
- Symbols consistent across tasks: `honour:{title,standing}`, `earnTitle`, `setWornTitle`, `earnedTitleList`, `wornTitle`, `bumpStanding`. ✓
- Dracula and the rest then simply declare their `honour` (no further engine work).
