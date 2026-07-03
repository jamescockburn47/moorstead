# Workstream D5 — Cold & Tiredness: Misery That Drives You Indoors

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cold and tiredness honestly push players toward the tavern of an evening —
as misery, never death. Cold stops dealing HP damage and instead stiffens you
(slower moves AND slower tool swings), fogs your breath, and tightens the frost
vignette; the parlour fire clears it fast and leaves you "warmed through" till
morning. Fatigue (new) climbs with time awake and exertion, sways the camera and
flags your pace at the top end, caps without collapse, and eases with a hearth
doze. Both are much gentler in bairns/free worlds.

**Settled decisions honoured (handoff §3):** misery-not-death (NO health damage
from cold — this CHANGES the existing ≤0° freeze damage, see below); parlour fire
clears chill fast + warmed-through buff into morning; fatigue has no forced
collapse; relief = sleep (full — DEFERRED to D6 alongside quorum sleep, no
single-player sleep exists yet), hearth doze (partial — THIS slice), or it caps;
bairns much gentler.

**The one deliberate balance change:** `player.js:316-320` currently deals 1 HP
per 4s at temperature ≤ 0. The tavern spec's "misery, not death" is James's
explicit later ruling for cold pressure, so the freeze DAMAGE goes — replaced by
deeper misery at ≤ 0 (movement ×0.6, tool swings ×0.5, max-strength vignette,
frequent shiver toasts). verify-survival's freeze-damage assertions (if any)
update accordingly; the death-by-freezing `deathCause` string becomes unreachable
and is removed. Hunger/drowning/regen rules unchanged.

**Ground truth annex (D5 probe, 2026-07-04):** temperature.js:12-32
(`temperatureTarget(season, env)` env={covered,nearFire,night,altitude01,wetness,
coat}, `stepTemperature` warms 2× faster, HOT_FOODS); player.js survival loop
282-332 (cold hunger ×1.6 <12°, freeze dmg 316-320 TO BE REMOVED, regen gate,
speed ×0.75 <6° at :150); serialize 432-457 / deserialize 459-500 (temperature
persisted; exhaustion/hungerTick transient); HUD temp pips ui.js:355-359/
1912-1918, coldVignette ui.js:397/1928-1933 (0 at ≥6°, full at 0°); nearFire =
`world.nearLight(pp.x, pp.z, 4)` main.js:5632 (torches/lanterns/safety lamps +
held storm lantern via the wrapper at main.js:802-811 — the parlour hearth TORCH
block counts for free); `playerInParlour` parlour.js:107-114; camera bob/sway
main.js:3748-3754/5843-5856 (swayAmp wind-driven — fatigue can feed it); mining
speed in main.js updateMining (find the progress rate — tool-swing slowdown hooks
there); freeWorld() gating idiom main.js:3541; sky day clock: morning = sky.time
crossing ~0.25; verify-survival.mjs/verify-winter.mjs = the pure-function
harness pattern to copy.

---

## Task 1: pure logic — chill rework + fatigue module + save fields

**Files:** modify `src/temperature.js`, `src/player.js`; create `src/fatigue.js`;
tests: extend `scripts/verify-survival.mjs` (chill semantics live there — it
already guards temperature.js), create `scripts/verify-fatigue.mjs`.

**temperature.js:**
- `temperatureTarget` gains general night-chill: outside a warm season
  (`season.warmth < 0.5`), night drops the target by 4 (so autumn/spring nights
  bite a little; summer nights stay mild); winter behaviour unchanged (already
  night ×1.35 on the drop). Also export `MISERY_TIERS` — pure classification:
  `miseryOf(temp)` → 'none' (≥12) | 'chilled' (<12: hunger burn — existing) |
  'stiff' (<6: move ×0.75 — existing — AND NEW tool swings ×0.75) |
  'perishing' (≤0: move ×0.6, tools ×0.5, shivers). Pure lookup the game code
  reads instead of scattering thresholds.
- `warmedThroughUntil(skyTime)` — pure: given the current sky time, the next
  morning boundary (0.25) strictly after it (handles wrap): warmed-through
  expiry timestamp in sky-time terms.

**player.js:**
- REMOVE the freeze-damage block (316-320) and the freezing deathCause.
- New additive fields: `this.fatigue = 0` (0..20) and `this.warmedUntil = null`
  (sky-time or null) — constructor + serialize + deserialize (`?? 0` / `?? null`).
- Survival loop: fatigue accrual — `this.fatigue = min(20, fatigue + dt*(RATE_AWAKE
  + (sprinting ? RATE_EXERT : 0) + (miningActive ? RATE_EXERT : 0)))` with rates
  from fatigue.js; miningActive/sprint flags — reuse how exhaustion already
  detects sprint (player.js:304); mining exertion can key off the same exhaustion
  bump main.js applies when swinging (find where mining adds exhaustion; if it
  doesn't, key fatigue's exert on `exhaustion` deltas instead — implementer reads
  and picks the honest signal, documents it).
- `warmedUntil` honoured in the temperature path: while
  `skyTimeIsBefore(now, warmedUntil)` the temperature target floor is 14
  ("warmed through" — chill can't bite till morning). Expiry clears the field.

**src/fatigue.js (new, pure):**
- `RATE_AWAKE` (≈20/(2.5 game days) — slow), `RATE_EXERT` (≈5× awake rate),
  `DOZE_RATE` (hearth doze: −2/min), tiers `fatigueTier(f)` → 'fresh' (<10) |
  'weary' (10-15: sway begins) | 'flagging' (≥15: speed ×0.9, sway strong,
  yawn toasts) | 'spent' (=20: caps, speed ×0.85). NO collapse.
- `applyDoze(fatigue, dt)`; `swayAmpFor(fatigue)` → 0..1 multiplier the camera
  code consumes; `bairnsScale(isChildrens)` → {chill: 0.5 target-drop scale,
  fatigue: 0 (cosmetic-only: sway yes, speed penalties NO)} — one place, gated
  by rooms.js's isChildrensWorld/freeWorld idiom AT THE CALLER (fatigue.js stays
  pure; it takes booleans).

**verify:** extend verify-survival (night-chill drop outside warm seasons; misery
tiers; warmedThroughUntil wrap cases; NO freeze damage — assert the survival tick
at temp 0 deals zero damage by driving the real Player.update in the existing
harness if feasible, else assert miseryOf(0)==='perishing' and grep-level absence
is covered by review); new verify-fatigue (accrual rates, cap at 20 no overflow,
doze relief, tiers, sway curve monotonic, bairns scale zeroes speed penalties).

## Task 2: integration — effects, buff, doze, HUD, breath fog

**Files:** modify `src/main.js`, `src/ui.js`; extend `scripts/verify-fatigue.mjs`
(pure bits only).

- **Tool swings:** updateMining's progress rate × the misery/fatigue multipliers
  (miseryOf: stiff ×0.75, perishing ×0.5 — read how mining progress accrues and
  scale it; document the exact hook line).
- **Movement:** replace the bare `<6 → ×0.75` at player.js:150 with the
  miseryOf tiers (×0.75 stiff, ×0.6 perishing) + fatigue tier multiplier
  (×0.9 flagging, ×0.85 spent) — skip fatigue speed penalties entirely in
  childrens worlds (bairnsScale), chill penalties halved there.
- **Warmed through:** when `playerInParlour(...)` AND temp reaches ≥ 18 →
  set `player.warmedUntil = warmedThroughUntil(sky.time)` + toast
  ('Warmed through to thi bones — t' cold'll not touch thee till morn.') once.
  (Parlour-only per the spec's wording "parlour fire clears it fast + buff" —
  a home hearth RANGE warms you the ordinary way but no buff; comment this.)
- **Hearth doze:** while in the parlour, temp ≥ 18, and player idle (no keys,
  no mining, ≥ 3s): fatigue eases at DOZE_RATE; a soft toast the first time
  ('Tha dozes by t' fire...').
- **Camera sway:** feed `swayAmpFor(player.fatigue)` into the existing bob/sway
  path (main.js:3748-3754/5843-5856 — additive with the wind sway, small).
- **Yawns:** at 'flagging'+, an occasional toast ('Tha stifles a yawn.') on a
  slow random timer (cosmetic, Math.random fine).
- **Breath fog:** Fine-quality only, cold ('stiff'+) + outdoors + (night or
  winter): a tiny short-lived smoke puff at the camera every few seconds —
  reuse `makeSmoke(0.12)`-style from fire.js with a fast uGate fade, capped at
  ONE live puff mesh reused (no allocation churn; follow fire.js's material
  registration/dispose contract). Plain quality: skip entirely.
- **HUD:** the temp pips already exist. Fatigue gets a single small moon glyph
  next to the temp bar whose opacity tracks fatigue/20 with a title tooltip —
  follow the temp bar's DOM pattern (ui.js:355-359, update fn 1912-1918);
  hidden in creative and in childrens worlds when cosmetic-only... NO — show it
  (kids like seeing it), just no penalties. Hidden at 0.
- **Toasts/vignette:** the existing cold vignette curve already maxes at 0°;
  'perishing' shiver toast on a slow timer.

## Task 3 (controller): reviews, wiring (package.json verify-fatigue), proof, deploy

Proof: fresh world, winter night outdoors → temp falls, misery tiers kick in
(speed + mining slower, vignette, breath fog on Fine), NO health loss at 0°;
into the parlour → temp restores fast, warmed-through toast + buff floor;
idle by the fire → fatigue drains; fatigue forced high via debug → sway +
yawns + flagging speed; bairns room → no speed penalties. Deploy.

## Non-goals
Single-player sleep + quorum sleep (D6 — fatigue's 'sleep (full)' relief lands
there); wind-driven chill from live weather (wetness/night/winter suffice for
v1 — note for later); NPC reactions to a shivering player (brain narration,
later); any new block/item.
