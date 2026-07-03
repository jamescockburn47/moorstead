# Admin Panel + Parish Warden Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A front-page "Admin" entry that drops the warden straight into a creative world, a
redesigned Parish Warden panel (whole-world clickable map + year/weather/time-of-day scene
sliders replacing the old button lists), and a Parish Ledger card showing who's online
(solo + shared) and basic system health, fed by one new redacted EVO endpoint.

**Architecture:** Client-only changes to `src/main.js` / `src/sky.js` / `src/festivals.js` /
`src/ui.js`, plus one new read-only FastAPI route on the EVO (`~/moorstead/dash/app.py`) and
one Caddy allowlist edit. Three small pieces of real logic are extracted as pure, exported
functions so they're headlessly testable (per `docs/INVARIANTS.md` rule 1); the DOM-heavy
panel rebuild and the EVO route are verified live/manually, per this session's established
discipline that the headless gate cannot see GL/DOM/network correctness.

**Tech Stack:** Vanilla JS (no framework), Canvas 2D (existing minimap/big-map machinery),
FastAPI + JSON-file storage on the EVO, Caddy reverse proxy.

**Spec:** `docs/superpowers/specs/2026-07-03-admin-panel-design.md` (base spec + the
2026-07-03 addendum for the panel redesign — read both before starting).

---

## File structure

- **Modify `src/festivals.js`** — add `festivalBands()`, a pure export used by the year
  slider (and headlessly tested).
- **Modify `src/sky.js`** — add a `weatherOverride` field (defaults `null`), the pure
  `overrideWeatherState(state)` export, and wire both into `update()`'s existing weather
  block (small, surgical diff — not a rewrite).
- **Modify `src/ui.js`** — add `bigMapScreenToWorld(mapXf, sx, sy)` (pure, module-level
  export, inverts the exact projection `buildBigMap()` already computes into `this._mapXf`);
  add the front-page "Admin" link + inline warden-key overlay DOM inside the existing
  `titleScreen` construction.
- **Modify `src/main.js`** — the bulk of the work: one new field on the `/dash/ping` payload
  (`room`), two new `debug` methods (`setWeather`, `setTime`), the Admin-button click handler,
  and a full rewrite of `renderAdminPanel()` (map-led split: clickable whole-world map, year/
  weather/time sliders, travel-and-actions strip, Parish Ledger card).
- **Create `scripts/verify-admin-panel.mjs`** — headless tests for the three pure exports
  above, following `scripts/verify-_template.mjs`'s pattern.
- **Modify `package.json`** — wire the new verify script into the `verify` chain +
  `verify:admin-panel` entry.
- **Modify `~/moorstead/dash/app.py`** (EVO, via SSH) — new `GET /dash/api/admin-summary`
  route (redacted projection of the same `players.json`/`sessions.json` data
  `/api/overview` already uses) and a `room` field added to the existing `/ping` handler.
- **Modify `/etc/caddy/Caddyfile`** (EVO, via SSH) — add `/api/admin-summary` to the public
  `/dash/*` path allowlist; reload Caddy.

---

### Task 1: `festivalBands()` — pure festival window geometry

**Files:**
- Modify: `src/festivals.js` (append after the existing `FESTIVALS` array / `windowIntensity`)
- Test: `scripts/verify-admin-panel.mjs` (new file — created fully in this task, extended in Tasks 2–3)

- [ ] **Step 1: Write the failing test**

Create `scripts/verify-admin-panel.mjs`:

```js
// Admin panel + Parish Warden redesign — pure-logic checks. Run wi': node scripts/verify-admin-panel.mjs
//
// Headless Node only (docs/INVARIANTS.md rule 1) — these three functions are the ONLY
// testable-without-DOM/GL/network logic the feature adds; the panel rebuild itself and the
// EVO endpoint are verified live/manually (see the plan's Task 7/9 verification steps).

import { festivalBands } from '../src/festivals.js';

let failed = false;
const ok  = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// --- festivalBands: real window geometry, proportional to each festival's actual length ---
{
  const bands = festivalBands();
  (bands.length === 6 ? ok : bad)('all six festivals produce a band');
  const byId = Object.fromEntries(bands.map(b => [b.id, b]));
  (byId.bonfire && byId.harvest ? ok : bad)('bonfire and harvest bands both present');
  // Harvest (12 days) must be a wider band than Bonfire (7 days) — true-width, not decorative.
  (byId.harvest.width > byId.bonfire.width ? ok : bad)('wider festivals get wider bands (Harvest > Bonfire)');
  for (const b of bands) {
    (b.left >= 0 && b.left + b.width <= 1.001 ? ok : bad)(`${b.id} band stays inside the year [0,1]`);
    (Math.abs((b.left + b.width / 2) - b.centre) < 1e-9 ? ok : bad)(`${b.id} band is centred on its festival's centre phase`);
  }
  // determinism (INVARIANTS rule 6) — same catalogue, same output every time
  (JSON.stringify(festivalBands()) === JSON.stringify(festivalBands()) ? ok : bad)('deterministic — no Math.random');
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/verify-admin-panel.mjs`
Expected: throws — `festivalBands is not a function` (not exported yet) or similar import error.

- [ ] **Step 3: Write minimal implementation**

In `src/festivals.js`, immediately after the existing `FESTIVALS` array (the one with
`easter/mayday/midsummer/harvest/bonfire/yule`), add:

```js
// Pure: each festival's clickable-chip position AND shaded-band [left, width] as fractions
// of the year (0..1), straight from FESTIVALS' own centre/days — used by the Parish Warden
// year slider (the click-to-snap mechanism) and tested headlessly here (no DOM needed to
// prove the geometry is sane). `days` is calendar days, so the fraction is /365.25 — matches
// windowIntensity's own EDGE_DAYS convention below.
export function festivalBands() {
  return FESTIVALS.map(f => {
    const halfWidth = (f.days / 2) / 365.25;
    return { id: f.id, name: f.name, centre: f.centre, left: f.centre - halfWidth, width: halfWidth * 2 };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/verify-admin-panel.mjs`
Expected: all `ok`, `RESULT: PASS`.

- [ ] **Step 5: Commit**

```bash
git add src/festivals.js scripts/verify-admin-panel.mjs
git commit -m "feat(admin-panel): festivalBands() — pure year-slider window geometry"
```

---

### Task 2: `overrideWeatherState()` — pure weather-override resolution

**Files:**
- Modify: `src/sky.js:557-558` (constructor field init), `src/sky.js:929-968` (the `update()`
  weather block — read this exact range again before editing, other slices may have shifted
  it slightly since this plan was written)
- Test: `scripts/verify-admin-panel.mjs`

- [ ] **Step 1: Write the failing test**

Append to `scripts/verify-admin-panel.mjs` (before the final `console.log`/`process.exit`):

```js
// --- overrideWeatherState: Rain/Snow gets a REAL synthetic rainAmount, not just a label ---
{
  const clear = overrideWeatherState('clear');
  (clear.weather === 'clear' && clear.liveRain === null ? ok : bad)('Clear override carries no rain amount');
  const rain = overrideWeatherState('rain');
  (rain.weather === 'rain' && rain.liveRain > 0 ? ok : bad)(
    'Rain/Snow override forces a real rainAmount — winterPrecip only falls back to snow when ALREADY wintry, so without this a summer preview of Rain would silently produce nothing'
  );
  const fog = overrideWeatherState('fog');
  (fog.weather === 'fog' && fog.liveFog === null ? ok : bad)('Fog override carries no forced fog distance (the weather string alone already drives baseFog for misty/fog)');
}
```

And add the import at the top of `scripts/verify-admin-panel.mjs`:

```js
import { overrideWeatherState } from '../src/sky.js';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/verify-admin-panel.mjs`
Expected: import error — `overrideWeatherState` not exported yet.

- [ ] **Step 3: Write minimal implementation**

In `src/sky.js`, find the weather-state fields near the constructor (around where
`this.weather = 'misty'; this.weatherTimer = 60 + Math.random() * 60;` are set — read that
exact block first) and add one line right after them:

```js
this.weatherOverride = null; // [warden] debug.setWeather() override; null = 'Live' (today's behaviour)
```

Above the `Sky` class (or in the same module-level export area as other pure helpers like
`windowIntensity`/`cmp` in this codebase's convention), add:

```js
// Pure: what a warden's chosen weather-preview state should force this frame. Extracted so
// verify-admin-panel.mjs can prove it without constructing a Sky/THREE instance at all.
// Rain/Snow needs a REAL rainAmount (not just the 'rain' label): winterPrecip (snow.js) only
// falls back to a deterministic snowfall value when season.warmth is ALREADY < 0, so without
// this a summer preview of "Rain/Snow" would silently produce zero precipitation.
export function overrideWeatherState(state) {
  return {
    weather: state,
    liveRain: state === 'rain' ? 0.7 : null,
    liveFog: null,
    liveWind: null,
  };
}
```

Then in `update()`, find the exact existing block (re-read it first — this plan was written
against):

```js
    if (this.forceClear) { this.weather = 'clear'; this.weatherTimer = 1e9; } // title backdrop: always a clear morning
    const live = this.forceClear ? null : currentWeather();
    if (live) {
      this.liveRain = live.rainAmount;
      this.liveFog = live.fogFar;
      this.liveWind = live.windiness; // [19] real Goathland wind — finally consumed (drives t' precip slant)
      if (live.state !== this.weather) {
        this.weather = live.state;
        msg = msg || { type: 'weather', text: WEATHER_MSG[live.state] };
      }
      this.weatherTimer = 1e9; // park t' random machine while live weather rules
    } else {
      this.liveRain = null;
      this.liveFog = null;
      this.liveWind = null;
    }
```

Replace it with (small, surgical addition — the `live`/existing-branches are otherwise
untouched):

```js
    if (this.forceClear) { this.weather = 'clear'; this.weatherTimer = 1e9; } // title backdrop: always a clear morning
    // [warden] scene-preview override (debug.setWeather) wins over BOTH the live forecast and
    // the offline random machine below — checked before the live fetch so a real live sample
    // can't stomp the chosen state a frame later. Never toasts (it's a preview action, not a
    // narrative weather change).
    else if (this.weatherOverride) {
      const o = overrideWeatherState(this.weatherOverride);
      this.weather = o.weather; this.liveRain = o.liveRain; this.liveFog = o.liveFog; this.liveWind = o.liveWind;
      this.weatherTimer = 1e9;
    }
    const live = (this.forceClear || this.weatherOverride) ? null : currentWeather();
    if (live) {
      this.liveRain = live.rainAmount;
      this.liveFog = live.fogFar;
      this.liveWind = live.windiness; // [19] real Goathland wind — finally consumed (drives t' precip slant)
      if (live.state !== this.weather) {
        this.weather = live.state;
        msg = msg || { type: 'weather', text: WEATHER_MSG[live.state] };
      }
      this.weatherTimer = 1e9; // park t' random machine while live weather rules
    } else if (!this.forceClear && !this.weatherOverride) {
      this.liveRain = null;
      this.liveFog = null;
      this.liveWind = null;
    }
```

(If `WEATHER_MSG` is not the exact existing identifier — re-check the live-branch's real
current form before editing; it may be an inline object literal rather than a named constant.
Keep whatever that branch already does — this task changes ONLY the addition of the
`weatherOverride` branch above it and the narrowed final `else`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/verify-admin-panel.mjs`
Expected: all `ok`, `RESULT: PASS`.

- [ ] **Step 5: Run the full graphics/weather guard scripts to confirm no regression**

Run: `node scripts/verify-graphics.mjs && node scripts/verify-weather.mjs && node scripts/verify-snow.mjs && node scripts/verify-winter.mjs`
Expected: all four `RESULT: PASS` — this touches a heavily-asserted file; if any of these
scripts pin a literal that legitimately moved (e.g. an assertion matching the exact old
`if (this.forceClear) { ... } const live = this.forceClear ? null : currentWeather();` text),
update that ONE assertion deliberately with a comment explaining why, and re-run. Do not
weaken any assertion's semantic meaning.

- [ ] **Step 6: Commit**

```bash
git add src/sky.js scripts/verify-admin-panel.mjs
git commit -m "feat(admin-panel): weather-override hook — overrideWeatherState() + sky.js wiring"
```

---

### Task 3: `bigMapScreenToWorld()` — pure map click inversion

**Files:**
- Modify: `src/ui.js` (near `buildBigMap`/`showBigMap`, ~line 1875-2050 — re-read the exact
  current range before editing)
- Test: `scripts/verify-admin-panel.mjs`

- [ ] **Step 1: Write the failing test**

Append to `scripts/verify-admin-panel.mjs`:

```js
// --- bigMapScreenToWorld: inverts buildBigMap()'s own w2x/w2y projection exactly ---
{
  // A representative transform shape — the real one is built by ui.js's buildBigMap() from
  // world bounds; this is deliberately a plain object so the test needs no DOM/canvas at all.
  const xf = { s: 0.42, offH: 60, offV: 40, minZ: -1200, maxX: 900 };
  // Forward-project a known world point the SAME way buildBigMap() does, then invert it.
  const wx = 150, wz = -300;
  const sx = xf.offH + (wz - xf.minZ) * xf.s;
  const sy = xf.offV + (xf.maxX - wx) * xf.s;
  const back = bigMapScreenToWorld(xf, sx, sy);
  (Math.abs(back.x - wx) < 1 && Math.abs(back.z - wz) < 1 ? ok : bad)('inverts a forward-projected point back to (within rounding)');
  // determinism
  (JSON.stringify(bigMapScreenToWorld(xf, 100, 100)) === JSON.stringify(bigMapScreenToWorld(xf, 100, 100)) ? ok : bad)('deterministic');
}
```

And add the import:

```js
import { bigMapScreenToWorld } from '../src/ui.js';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/verify-admin-panel.mjs`
Expected: import error, OR (more likely) `src/ui.js` fails to import headlessly at all if it
touches `document`/DOM at module top-level. If THAT happens, stop and report it before
proceeding — it means `ui.js`'s class body has a top-level side effect outside its
constructor, which is a separate, pre-existing problem this task should not paper over. (It
is expected to import cleanly: only the `UI` class's `constructor` touches `document`, and
importing a module never runs a class's constructor.)

- [ ] **Step 3: Write minimal implementation**

In `src/ui.js`, near the `// ============ expanded "peek" map (hold Tab) ============`
section header (immediately before `mapTint` or immediately after `buildBigMap`), add this
as a module-level export (NOT a class method — it must be callable without a `UI` instance):

```js
// Pure: inverts buildBigMap()'s own world->screen projection (w2x/w2y, stored on the UI
// instance as `_mapXf` after every buildBigMap() call). Exported standalone so both the
// admin-panel map click handler AND this headless test can use the exact same maths without
// needing a real UI instance or canvas.
export function bigMapScreenToWorld(mapXf, sx, sy) {
  const { s, offH, offV, minZ, maxX } = mapXf;
  return {
    x: Math.round(maxX - (sy - offV) / s),
    z: Math.round((sx - offH) / s + minZ),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/verify-admin-panel.mjs`
Expected: all `ok`, `RESULT: PASS`.

- [ ] **Step 5: Commit**

```bash
git add src/ui.js scripts/verify-admin-panel.mjs
git commit -m "feat(admin-panel): bigMapScreenToWorld() — pure inverse map projection"
```

---

### Task 4: Wire `debug.setWeather` / `debug.setTime`

**Files:**
- Modify: `src/main.js` (the `this.debug = { ... }` object, ~line 621-733 — add two new
  methods; place them near `setSeason`/`phase`, around line 673-696)

- [ ] **Step 1: Write the implementation**

In `src/main.js`, inside the `this.debug = { ... }` object literal, add (near `setSeason`):

```js
      // dev/warden: force a weather state ('clear'|'misty'|'rain'|'fog'), or null/'live' to
      // resume the real forecast. Overrides win over BOTH the live feed and the random
      // offline machine (see sky.js's weatherOverride handling). 'rain' also forces a real
      // rainAmount so precipitation actually falls regardless of season — see
      // overrideWeatherState() in sky.js.
      //   moorstead.debug.setWeather('rain')   moorstead.debug.setWeather(null) // back to live
      setWeather(state) {
        const known = ['clear', 'misty', 'rain', 'fog'];
        if (state == null || state === 'live') { G.sky.weatherOverride = null; return 'live'; }
        if (!known.includes(state)) return { error: 'unknown weather', known };
        G.sky.weatherOverride = state;
        return state;
      },
      // dev/warden: jump to any time of day (0..1 day-fraction), or leave unset to keep
      // advancing normally. One-shot set — mirrors setSeason's clamp; time keeps ticking
      // forward from wherever this leaves it (same behaviour the title-flyover's hardcoded
      // sky.time assignment already has).
      //   moorstead.debug.setTime(0.75)   // dusk
      setTime(t) {
        G.sky.time = Math.max(0, Math.min(0.999, t));
        return G.sky.time;
      },
```

- [ ] **Step 2: Verify it live**

Run the dev server (via the preview tools), open a world, in the console:

```js
moorstead.debug.setWeather('rain'); moorstead.sky.weather // 'rain'
moorstead.sky.liveRain // > 0
moorstead.debug.setWeather(null); // back to live/random
moorstead.debug.setTime(0.75); moorstead.sky.time // 0.75
```

Expected: matches each comment. Also run `moorstead.debug.glHealth()` once — expected
`{broken: 0}` (this task touches no shaders, but it's the standing cheap sanity check for any
live-verified change this session).

- [ ] **Step 3: Commit**

```bash
git add src/main.js
git commit -m "feat(admin-panel): debug.setWeather / debug.setTime hooks"
```

---

### Task 5: Ping payload gets a `room` field

**Files:**
- Modify: `src/main.js:5596-5618` (re-read exact current range first)

- [ ] **Step 1: Write the implementation**

Find the existing `/dash/ping` fetch body (currently sends
`{pid, name, seed, day, standing, croft, quests, loc}`) and add one field:

```js
        fetch('/dash/ping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pid: (localStorage.getItem('moorcraft-pid') || 'unknown').slice(0, 40),
            name: this.player.name || '',
            seed: '' + this.seed,
            day: this.sky.day,
            standing: this.quests.standingLabel(),
            croft: this.quests.croftStage,
            quests: this.quests.completed.length,
            loc: this.world.gen.geo.locationName(p, z),
            room: this.netActive ? (this.netRoom || 'shared') : '', // '' = solo world
          }),
        }).catch(() => { /* ledger's closed — no matter */ });
```

(Only the `room:` line is new — everything else in this fetch body is unchanged.)

- [ ] **Step 2: Verify it live**

Enter a solo world, in the console after ~60s (or trigger manually):
`fetch('/dash/ping', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({pid:'test-room-field', name:'t', seed:'1', day:1, standing:'x', croft:0, quests:0, loc:'x', room:''})}).then(r=>r.json()).then(console.log)`
Expected: `{ok: true}` (the EVO doesn't validate `room` yet until Task 9 — this step just
confirms the client-side payload shape doesn't break the existing `/ping` handler, which
ignores unknown fields safely).

- [ ] **Step 3: Commit**

```bash
git add src/main.js
git commit -m "feat(admin-panel): ping payload reports solo-vs-shared room"
```

---

### Task 6: Front-page Admin entry

**Files:**
- Modify: `src/ui.js` (title screen construction, ~line 390-467 — add near the existing
  `titleLinks`/`btnNew` elements)
- Modify: `src/main.js` (wire the click handler near the other title-screen button wiring,
  ~line 1055-1093; reuse `loginWarden`'s hash logic, ~line 1995-2009)

- [ ] **Step 1: Add the DOM**

In `src/ui.js`, inside the `titleLinks` div construction (right after the existing `About`/
`Feedback & bugs` links, ~line 396-401 — re-read the exact current lines first), add:

```js
    this.btnAdminLink = this.el('button', 'title-admin-link', titleLinks, 'Admin');
    this.adminLoginBox = this.el('div', 'admin-login-box hidden', this.titleScreen);
    this.adminLoginKey = this.el('input', 'seed', this.adminLoginBox);
    this.adminLoginKey.placeholder = 'Warden key';
    this.adminLoginKey.type = 'password';
    this.btnAdminGo = this.el('button', 'mc', this.adminLoginBox, 'Enter as Warden');
    this.adminLoginErr = this.el('div', 'login-err', this.adminLoginBox, '');
```

- [ ] **Step 2: Wire the handler**

In `src/main.js`, near the existing title-screen button wiring (where `ui.btnWarden.addEventListener(...)` and `ui.btnNew.addEventListener(...)` are set up, ~line 1065-1093), add:

```js
    ui.btnAdminLink.addEventListener('click', () => {
      ui.adminLoginBox.classList.toggle('hidden');
      if (!ui.adminLoginBox.classList.contains('hidden')) ui.adminLoginKey.focus();
    });
    ui.btnAdminGo.addEventListener('click', () => this.loginWardenAndPlay());
    ui.adminLoginKey.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.loginWardenAndPlay(); });
```

Add a new method right after the existing `loginWarden()` (~line 1995-2009), reusing its
exact hash-check logic rather than duplicating it:

```js
  // Front-page Admin shortcut: same hash-check as loginWarden(), but on success skips the
  // invite-code flow entirely and drops straight into a fresh solo creative world — the
  // fastest route in for the one person who's ever going to type this key.
  async loginWardenAndPlay() {
    const key = (this.ui.adminLoginKey.value || '').trim();
    if (!key) { this.ui.adminLoginErr.textContent = 'Key needed.'; return; }
    let hex = '';
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
      hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    } catch { this.ui.adminLoginErr.textContent = "Couldn't check that key."; return; }
    if (!ADMIN_HASHES.includes(hex)) { this.ui.adminLoginErr.textContent = "That's not a warden key."; return; }
    this.auth = { warden: true, name: 'Warden' };
    localStorage.setItem('moorcraft-auth', JSON.stringify(this.auth));
    this.adminOk = true;
    this.ui.adminLoginErr.textContent = '';
    this.audio.init();
    this.newWorld('');
  }
```

- [ ] **Step 3: Verify it live**

Reload the title screen, click "Admin", type the warden key (`warden1981`), press Enter (or
click "Enter as Warden"). Expected: a fresh solo creative world starts, and once in-world,
`moorstead.isAdmin()` returns `true` and pausing shows the Parish Warden panel. Also test the
failure path: click Admin, type a wrong key — expected inline "That's not a warden key."
with no world started.

- [ ] **Step 4: Commit**

```bash
git add src/ui.js src/main.js
git commit -m "feat(admin-panel): front-page Admin entry — one click into a warden world"
```

---

### Task 7: `renderAdminPanel()` rewrite — map-led split layout

**Files:**
- Modify: `src/main.js:1398-1535` (re-read the exact current range first — this is the
  single biggest change in the plan; other slices this session may have shifted nearby
  line numbers slightly, but the function's shape from the spec research is stable)
- Modify: `src/main.js` top imports — add `festivalBands` from `./festivals.js` (FESTIVALS
  is already imported; add `festivalBands` alongside it) and `bigMapScreenToWorld` from
  `./ui.js`

- [ ] **Step 1: Add the imports**

In `src/main.js`'s import block:

```js
import { FESTIVALS, festivalState, festivalBands } from './festivals.js';
```

(FESTIVALS/festivalState already imported at ~line 49 — just add `festivalBands` to that
same line.) And add a new import line:

```js
import { bigMapScreenToWorld } from './ui.js';
```

- [ ] **Step 2: Replace the season/festival block and add the map + sliders**

Replace the ENTIRE existing `renderAdminPanel()` body (from `renderAdminPanel() {` through its
closing `}` at ~line 1535 — the block that currently builds god/kit buttons, train/pony,
teleport-anywhere button lists, drop-on-player, coordinate entry, the season-quarter +
per-festival button rows, and the relay connection-health readout) with:

```js
  renderAdminPanel() {
    const panel = this.ui.adminPanel;
    if (!panel) return;
    if (!this.isAdmin() || !this.world) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');
    panel.innerHTML = '';
    const ui = this.ui;
    const geo = this.world.gen.geo;
    ui.el('div', 'inv-title', panel, 'Parish Warden');

    // ---- map + scene sliders (map-led split) ----
    const scene = ui.el('div', 'admin-scene', panel);
    scene.style.cssText = 'display:flex;gap:14px;flex-wrap:wrap;';

    // the map: reuses buildBigMap()'s cached world-overview image (villages/stations/
    // landmarks/rails), redrawn into a dedicated canvas so it can sit inside this panel
    // permanently (not just the "hold Tab" peek). Click anywhere to drop in AT WHATEVER
    // THE SLIDERS BELOW CURRENTLY SAY — no confirm step, matches adminTeleport()'s existing
    // instant-arrival feel.
    const mapCol = ui.el('div', '', scene); mapCol.style.cssText = 'flex:1.3;min-width:220px;';
    if (ui.mapBaseKey !== this.world.gen.seed) ui.buildBigMap(this.player, this.world);
    const mapCanvas = ui.el('canvas', 'admin-map', mapCol);
    mapCanvas.width = ui.mapBase.width; mapCanvas.height = ui.mapBase.height;
    mapCanvas.style.cssText = 'width:100%;max-width:320px;border-radius:4px;cursor:crosshair;';
    mapCanvas.getContext('2d').drawImage(ui.mapBase, 0, 0);
    ui.el('div', 'r-needs', mapCol, 'Click the map to drop in — uses the settings below.');
    mapCanvas.addEventListener('click', (e) => {
      const rect = mapCanvas.getBoundingClientRect();
      const sx = (e.clientX - rect.left) * (mapCanvas.width / rect.width);
      const sy = (e.clientY - rect.top) * (mapCanvas.height / rect.height);
      const { x, z } = bigMapScreenToWorld(ui._mapXf, sx, sy);
      this.adminTeleport(x, z, `${x}, ${z}`);
    });

    const sliderCol = ui.el('div', '', scene); sliderCol.style.cssText = 'flex:1;min-width:220px;display:flex;flex-direction:column;gap:12px;';

    // -- year slider, with all six festival windows shown true-to-width + click-to-snap --
    {
      const wrap = ui.el('div', '', sliderCol);
      ui.el('div', 'r-needs', wrap, 'Year (click a festival to land in it clean):');
      const chipRow = ui.el('div', '', wrap);
      chipRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px;';
      const bands = festivalBands();
      for (const b of bands) {
        const chip = ui.el('button', 'mc', chipRow, b.name);
        chip.style.cssText = 'font-size:10px;padding:2px 6px;';
        chip.addEventListener('click', () => { slider.value = String(b.centre); slider.dispatchEvent(new Event('input')); });
      }
      const slider = ui.el('input', '', wrap);
      slider.type = 'range'; slider.min = '0'; slider.max = '0.999'; slider.step = '0.001';
      slider.style.width = '100%';
      const cur = this.seasonOverride != null ? this.seasonOverride : (this.season?.yearPhase ?? 0.5);
      slider.value = String(cur);
      const label = ui.el('div', 'label', wrap, '');
      const paintLabel = (phase) => {
        const s = seasonStateAtPhase(phase);
        label.textContent = `Day ${Math.round(phase * 365)} — ${s.season}`;
      };
      paintLabel(cur);
      slider.addEventListener('input', () => {
        const phase = parseFloat(slider.value);
        this.debug.setSeason(phase);
        paintLabel(phase);
      });
      const real = ui.el('button', 'mc', wrap, 'Real time');
      real.style.cssText = 'font-size:10px;margin-top:4px;';
      real.addEventListener('click', () => { this.debug.setSeason(null); this.renderAdminPanel(); });
    }

    // -- weather: buttons, not a slider (the states aren't a continuum) --
    {
      const wrap = ui.el('div', '', sliderCol);
      ui.el('div', 'r-needs', wrap, 'Weather:');
      const row = ui.el('div', '', wrap);
      row.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;';
      const current = this.world.sky?.weatherOverride ?? this.sky.weatherOverride ?? null;
      for (const [val, label] of [[null, 'Live'], ['clear', 'Clear'], ['misty', 'Misty'], ['rain', 'Rain/Snow'], ['fog', 'Fog']]) {
        const b = ui.el('button', 'mc', row, label);
        b.style.cssText = `font-size:11px;padding:4px 8px;${current === val ? 'outline:2px solid #e8b04a;' : ''}`;
        b.addEventListener('click', () => { this.debug.setWeather(val); this.renderAdminPanel(); });
      }
    }

    // -- time o' day --
    {
      const wrap = ui.el('div', '', sliderCol);
      ui.el('div', 'r-needs', wrap, "Time o' day:");
      const slider = ui.el('input', '', wrap);
      slider.type = 'range'; slider.min = '0'; slider.max = '0.999'; slider.step = '0.001';
      slider.style.width = '100%';
      slider.value = String(this.sky.time);
      const label = ui.el('div', 'label', wrap, '');
      const fmtTime = (t) => { const h = Math.floor(t * 24), m = Math.floor((t * 24 - h) * 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };
      label.textContent = fmtTime(this.sky.time);
      slider.addEventListener('input', () => {
        const t = parseFloat(slider.value);
        this.debug.setTime(t);
        label.textContent = fmtTime(t);
      });
    }

    // ---- Parish Ledger (players online, recent activity, system status) ----
    this.renderParishLedger(panel);

    // ---- travel & actions (separate from the scene-setting cluster above) ----
    ui.el('div', 'r-needs', panel, 'Travel & actions:');
    const row = ui.el('div', 'admin-btns', panel);
    const god = ui.el('button', 'mc', row, this.player.god ? 'Mortal Again' : 'Hard As T’ Wainstones (God)');
    god.addEventListener('click', () => {
      this.player.god = !this.player.god;
      ui.toast(this.player.god ? 'Nowt can touch thee now.' : 'Tha’s mortal again — mind t’ bogs.');
      this.renderAdminPanel();
    });
    const kit = ui.el('button', 'mc', row, 'Full Kit (iron tools an’ all)');
    kit.addEventListener('click', () => {
      const p = this.player;
      [[I.I_PICK, 1], [I.I_AXE, 1], [I.I_SHOVEL, 1], [I.I_SWORD, 1], [I.STORM_LANTERN, 1],
       [I.COAL_LUMP, 64], [B.TORCH, 64], [B.LANTERN, 8], [B.PLANKS, 64],
       [B.STONEBRICK, 64], [I.COOKED_MUTTON, 16]].forEach(([id, n]) => p.addItem(id, n));
      ui.invDirty = true;
      ui.toast('Kitted out proper.');
    });
    const tLines = (geo.realWorld && geo.railPaths) ? geo.railPaths() : [];
    if (tLines.length > 1) {
      for (const l of tLines) { const b = ui.el('button', 'mc', row, `🚂 ${l.name}`); b.addEventListener('click', () => this.wardenBoardTrain(l.name)); }
    } else {
      const train = ui.el('button', 'mc', row, 'Board t’ Train (ride owt, Esc to step off)');
      train.addEventListener('click', () => this.wardenBoardTrain());
    }
    const pony = ui.el('button', 'mc', row, 'Find a Pony (drop by t’ nearest)');
    pony.addEventListener('click', () => this.wardenToPony());

    // drop in on a player (shared moor only)
    if (this.netActive && this.net && this.net.connected) {
      ui.el('div', 'r-needs', panel, 'Drop in on a player:');
      const pl = ui.el('div', 'admin-tp', panel);
      ui.el('div', 'r-needs', pl, 'asking t’ relay...');
      this.net.requestWhere(players => {
        if (this.state !== 'paused') return;
        pl.innerHTML = '';
        const mePid = (this.auth && this.auth.acct ? 'a' + this.auth.acct : this.devicePid()).slice(0, 40);
        const others = players.filter(q => q.pid !== mePid);
        if (!others.length) { ui.el('div', 'r-needs', pl, 'nob’dy else out just now'); return; }
        for (const q of others) {
          const d = Math.round(Math.hypot(q.x - this.player.pos.x, q.z - this.player.pos.z));
          const b = ui.el('button', 'mc chat-btn', pl, `${q.name} (${d}m)`);
          b.addEventListener('click', () => this.adminTeleport(Math.floor(q.x), Math.floor(q.z), q.name));
        }
      });
    }

    // coordinate entry
    ui.el('div', 'r-needs', panel, 'Or drop at coordinates:');
    const coordRow = ui.el('div', 'admin-btns', panel);
    const ix = ui.el('input', 'chat-input admin-coord', coordRow); ix.placeholder = 'x';
    const iz = ui.el('input', 'chat-input admin-coord', coordRow); iz.placeholder = 'z';
    const go = ui.el('button', 'mc chat-btn', coordRow, 'Drop');
    go.addEventListener('click', () => {
      const x = parseInt(ix.value, 10), z = parseInt(iz.value, 10);
      if (Number.isFinite(x) && Number.isFinite(z)) this.adminTeleport(x, z, `${x}, ${z}`);
    });

    // ---- shared-moor connection health (unchanged from before) ----
    if (this.netActive && this.net) {
      ui.el('div', 'r-needs', panel, 'Shared Moor — connection:');
      const diagBox = ui.el('pre', '', panel);
      diagBox.style.cssText = 'font:10px/1.4 monospace;white-space:pre-wrap;color:#d2d8cc;background:rgba(0,0,0,0.28);padding:6px 8px;margin:4px 0;max-height:190px;overflow:auto;border-radius:4px;';
      const paint = () => {
        if (!this.net || this.ui.adminPanel.classList.contains('hidden')) return;
        const r = this.net.report(), ld = r.lastDrop;
        const kinds = Object.entries(r.dropsByKind).map(([k, n]) => `${k}×${n}`).join(', ') || 'none';
        diagBox.textContent =
          `state     ${r.state}\n` +
          `uptime    ${r.uptimeSec}s   (session ${r.sessionAgeSec}s)\n` +
          `connects  ${r.connects}    drops ${r.drops}    downtime ${r.totalDowntimeSec}s\n` +
          `last msg  ${r.lastMsgAgeSec ?? '—'}s ago    RTT ${r.lastRttMs ?? '—'}ms    others ${r.remotes}\n` +
          `causes    ${kinds}\n` +
          (ld ? `last drop ${ld.kind} (code ${ld.code}${ld.wasClean ? ', clean' : ''}${ld.hidden ? ', tab hidden' : ''}, lasted ${Math.round((ld.upMs || 0) / 1000)}s)\n` : '') +
          `\nrecent:\n` + r.recent.slice(-8).map(e => `  ${e.ago.padStart(5)}  ${e.kind}${e.detail && typeof e.detail === 'object' ? ' ' + (e.detail.kind || JSON.stringify(e.detail)) : (e.detail ? ' ' + e.detail : '')}`).join('\n');
      };
      paint();
      clearInterval(this._diagPaint);
      this._diagPaint = setInterval(paint, 1000);
      ui.el('div', 'r-needs', panel, 'Full log: type netDiag() in the browser console.');
    }
  }
```

Note: village/station/landmark/museum teleport BUTTON LISTS from the old version are
DROPPED entirely — the clickable map replaces them (per the spec's "festival buttons are
retired, not ported" reasoning, applied the same way to the location buttons: the map is a
strict superset — same destinations, plus everywhere else, plus visible geography).

- [ ] **Step 3: Verify it live**

Reload, log in as warden, pause. Expected: map-led two-column layout renders; clicking a
village on the map drops you there; dragging the year slider changes season live and the
label updates; clicking a festival chip snaps the slider to that festival's centre; clicking
a weather button changes `sky.weather`/`sky.weatherOverride` (drag the time slider WHILE
watching — it must NOT rebuild the panel mid-drag, i.e. the slider element itself must stay
under your mouse the whole drag, not get replaced). Toggling God/Kit still re-renders the
whole panel (acceptable — those aren't continuous-drag controls). Run
`moorstead.debug.glHealth()` — expected `{broken: 0}`.

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat(admin-panel): renderAdminPanel rewrite — map-led split, year/weather/time sliders"
```

---

### Task 8: Parish Ledger card (client side, fetch + render)

**Files:**
- Modify: `src/main.js` — add a `renderParishLedger(panel)` method (called from Task 7's
  `renderAdminPanel()`, which already has the call site `this.renderParishLedger(panel);`)

- [ ] **Step 1: Write the implementation**

Add this method to the same class as `renderAdminPanel()` (place it right after
`renderAdminPanel()`):

```js
  // Parish Ledger: players online (solo + shared) + recent activity + brain/version/relay
  // status, from the one new redacted EVO endpoint (no pid/IP ever in this payload). Fails
  // soft — an unreachable EVO shows a plain message, never an error, never blocks the rest
  // of the panel (this.renderAdminPanel() already ran before this is called).
  renderParishLedger(panel) {
    const ui = this.ui;
    const box = ui.el('div', '', panel);
    box.style.cssText = 'margin:8px 0;padding:8px;background:rgba(0,0,0,0.2);border-radius:4px;';
    ui.el('div', 'inv-title', box, 'Parish Ledger');
    const body = ui.el('div', '', box);
    body.textContent = 'Fetching…';

    const key = (this.ui.wardenKey && this.ui.wardenKey.value) || (this.ui.adminLoginKey && this.ui.adminLoginKey.value) || '';
    fetch('/dash/api/admin-summary' + (key ? '?key=' + encodeURIComponent(key) : ''))
      .then(r => { if (!r.ok) throw new Error('bad status'); return r.json(); })
      .then(data => {
        if (this.ui.adminPanel.classList.contains('hidden')) return; // panel closed while fetching
        body.innerHTML = '';
        ui.el('div', 'r-needs', body, `Online now: ${data.online} (solo + shared)`);
        for (const p of (data.live || []).slice(0, 12)) {
          ui.el('div', 'label', body, `${p.name || '(nameless)'} — ${p.world} — day ${p.day} — ${p.loc || ''}`);
        }
        ui.el('div', 'r-needs', body, 'Recent activity:');
        for (const a of (data.recent || []).slice(0, 8)) {
          ui.el('div', 'label', body, `${a.name || '(nameless)'} — ${a.event}`);
        }
        ui.el('div', 'r-needs', body,
          `System: brain ${data.brain ? '✓' : '✗'} · relay ${data.relay ? '✓' : '✗'} · ` +
          (typeof __APP_VERSION__ !== 'undefined' && data.version && data.version !== __APP_VERSION__
            ? `version mismatch (running ${__APP_VERSION__}, deployed ${data.version})`
            : 'version up to date'));
      })
      .catch(() => {
        if (this.ui.adminPanel.classList.contains('hidden')) return;
        body.textContent = 'Ledger unreachable.';
      });
  }
```

- [ ] **Step 2: Verify it live**

This requires Task 9 (the EVO endpoint) to exist to show real data — until then, expected
behaviour is the catch path: open the panel, see "Fetching…" then "Ledger unreachable."
(404, since the route doesn't exist yet) — confirming the fail-soft path works BEFORE the
real endpoint exists is a useful ordering (prove it never breaks the rest of the panel).
After Task 9 + Task 10 ship, re-verify here: expected real player counts/names/activity.

- [ ] **Step 3: Commit**

```bash
git add src/main.js
git commit -m "feat(admin-panel): Parish Ledger card — fetch + fail-soft render"
```

---

### Task 9: EVO — new `GET /dash/api/admin-summary` endpoint

**Files:**
- Modify (on the EVO, via `ssh evo-tailscale`): `~/moorstead/dash/app.py`

- [ ] **Step 1: Back up the file before editing**

```bash
ssh evo-tailscale "cp ~/moorstead/dash/app.py ~/moorstead/dash/app.py.bak-2026-07-03-admin-summary"
```

- [ ] **Step 2: Add a room field to the existing `/ping` handler**

SSH in and edit `~/moorstead/dash/app.py`. In the existing `ping()` handler (the one that
builds an `entry` dict with `pid/name/seed/day/standing/croft/quests/loc/ip`), add one line
to capture the new `room` field the client now sends (Task 5), and store it on the player's
per-world record:

```python
    room = re.sub(r"[^\w\- ]", "", str(d.get("room", "")))[:24]
```

(add this line alongside the existing `seed = re.sub(...)` line), and in the `p["worlds"][seed] = {...}` dict a few lines below, add `"room": room` alongside the existing `day/standing/croft/quests/loc/last` keys.

- [ ] **Step 3: Add the redacted-projection endpoint**

Add near the existing `/api/overview` route (same file, same conventions — reuses
`_load`, `PLAYERS_F`, `SESSIONS_F`, `VISITS_F`, `BRAIN`, `RELAY`):

```python
# James's warden key hashes — SAME set as the client's ADMIN_HASHES (src/defs.js). Gates
# convenience only: the data below is already redacted (no pid/IP), so this isn't a serious
# information boundary, just a light deterrent against casual scraping.
ADMIN_HASHES = {
    "29889b77f82b79d1585f514ac0e6489deed67ddb27b55a81109492a443b8e950",
    "d3586a9e0a64041ad379c88e7e646866232700925b973f26297e7be1c5b62c14",
    "5a19e539f87a5776ee01e7d8d603fcc7b63e810a14f23c471f94150437e854d8",
}


def _admin_key_ok(key):
    if not key:
        return False
    return hashlib.sha256(key.encode()).hexdigest() in ADMIN_HASHES


@app.get("/api/admin-summary")
async def admin_summary(key: str = ""):
    if not _admin_key_ok(key):
        return {"error": "unauthorized"}
    now = time.time()
    sessions = _load(SESSIONS_F, [])
    live = {}
    for s in sessions[-500:]:
        if now - s["ts"] < 180:
            live[(s["pid"], s["seed"])] = s
    live_redacted = [
        {
            "name": s.get("name", ""),
            "world": ("Shared: " + s["room"]) if s.get("room") else "Solo",
            "day": s.get("day", 0),
            "standing": s.get("standing", ""),
            "loc": s.get("loc", ""),
        }
        for s in live.values()
    ]
    recent = [
        {"name": v.get("name", ""), "event": v.get("event", "")}
        for v in reversed(_load(VISITS_F, [])[-40:])
    ]
    brain_ok = False
    try:
        async with httpx.AsyncClient(timeout=3) as c:
            r = await c.get(BRAIN + "/status")
            brain_ok = r.status_code == 200
    except Exception:
        pass
    relay_ok = False
    try:
        async with httpx.AsyncClient(timeout=3) as c:
            r = await c.get(RELAY + "/")
            relay_ok = r.status_code < 500
    except Exception:
        pass
    return {
        "online": len(live_redacted),
        "live": live_redacted,
        "recent": recent,
        "brain": brain_ok,
        "relay": relay_ok,
    }
```

- [ ] **Step 4: Restart the dash service**

```bash
ssh evo-tailscale "sudo -n systemctl restart moorstead-dash && sleep 1 && sudo -n systemctl status moorstead-dash --no-pager -l | head -20"
```
Expected: `active (running)`, no traceback in the status output.

- [ ] **Step 5: Verify the endpoint directly (localhost, before Caddy)**

```bash
ssh evo-tailscale "curl -s 'http://127.0.0.1:8095/api/admin-summary?key=wrong' && echo && curl -s 'http://127.0.0.1:8095/api/admin-summary?key=warden1981'"
```
Expected: first call returns `{"error":"unauthorized"}`; second returns a real JSON body
with `online`/`live`/`recent`/`brain`/`relay` — confirm no `"ip"` or `"pid"` substring
appears anywhere in the second response body (grep it if unsure:
`... | grep -o '"ip"' ` should print nothing).

- [ ] **Step 6: Commit is not applicable here** — the EVO's `~/moorstead/dash` is not a git
  repo tracked by this plan's commits (per `docs/CLAUDE.md`'s EVO conventions, back up +
  restart is the durability step; note the change in `docs/superpowers/specs/2026-07-03-admin-panel-design.md`'s addendum history if you want a durable record, but do not attempt
  `git commit` on the EVO path from this repo).

---

### Task 10: Caddy allowlist — make the new endpoint public

**Files:**
- Modify (on the EVO, via `ssh evo-tailscale`): `/etc/caddy/Caddyfile`

- [ ] **Step 1: Back up the file**

```bash
ssh evo-tailscale "sudo -n cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-2026-07-03-admin-summary"
```

- [ ] **Step 2: Edit the allowlist**

Find the existing block:

```
handle_path /dash/* {
    @notallowed not path /ping /auth/claim /visit /request-invite /feedback
    respond @notallowed 403
    reverse_proxy 127.0.0.1:8095
}
```

Change the `@notallowed` path list to add the new route:

```
handle_path /dash/* {
    @notallowed not path /ping /auth/claim /visit /request-invite /feedback /api/admin-summary
    respond @notallowed 403
    reverse_proxy 127.0.0.1:8095
}
```

(The full dashboard UI and `/api/overview` are NOT in this list — they stay LAN-only,
unchanged, exactly as the spec requires.)

- [ ] **Step 3: Validate and reload Caddy**

```bash
ssh evo-tailscale "sudo -n caddy validate --config /etc/caddy/Caddyfile && sudo -n systemctl reload caddy"
```
Expected: `Valid configuration` (or similar), no error, reload succeeds silently.

- [ ] **Step 4: Verify publicly (from outside the EVO, e.g. this machine, NOT via SSH)**

```bash
curl -s 'https://moorstead.sovren.xyz/dash/api/admin-summary?key=warden1981'
```
Expected: same JSON body Task 9 Step 5 showed over localhost — confirms the public route
actually reaches the new handler. Also confirm the boundary held:
```bash
curl -s -o /dev/null -w '%{http_code}\n' 'https://moorstead.sovren.xyz/dash/api/overview'
```
Expected: `403` (still blocked publicly, unchanged).

---

### Task 11: Full gate + client-side end-to-end check

**Files:** none (verification only)

- [ ] **Step 1: Wire the new verify script into the gate**

In `package.json`, add `&& node scripts/verify-admin-panel.mjs` to the end of the existing
`"verify"` chain string, and add a matching entry near the other `"verify:x"` entries:

```json
    "verify:admin-panel": "node scripts/verify-admin-panel.mjs",
```

- [ ] **Step 2: Run the full gate**

```bash
npm run verify
```
Expected: `RESULT: PASS` for every script in the chain, including the new one. If any
pre-existing script fails because Task 2's sky.js edit shifted a pinned literal, fix that
ONE assertion deliberately (per Task 2 Step 5's note) and re-run.

- [ ] **Step 3: Build**

```bash
npx vite build
```
Expected: clean build (pre-existing chunk-size warning only, no new errors).

- [ ] **Step 4: End-to-end live check**

Via the preview tools: reload → title screen → click "Admin" → enter `warden1981` → confirm
a fresh creative world starts → pause → confirm the map-led panel renders → click a village
on the map (teleports) → drag the year slider to a festival chip (season changes, label
updates) → click "Rain/Snow" (weather changes, and — important — actual rain or snow
particles appear, not just the label) → drag the time slider (sky darkens/lightens live) →
confirm the Parish Ledger card shows real online-count/activity (once Tasks 9-10 are live)
→ run `moorstead.debug.glHealth()` (expect `{broken: 0}`).

- [ ] **Step 5: Commit the verify-chain wiring**

```bash
git add package.json
git commit -m "chore(admin-panel): wire verify-admin-panel.mjs into the gate"
```

**No deploy in this plan.** Per this session's standing rule, shipping to production
(`npm run deploy`) is James's explicit call after he's looked at it — do not run it as part
of this plan's execution.

---

## Self-review

**1. Spec coverage** — front-page Admin entry (Task 6); new EVO endpoint (Task 9); Caddy
allowlist (Task 10); Parish Ledger card (Task 8); map-led split layout (Task 7); clickable
map = drop-in action (Task 7, corrected during planning to the whole-world `buildBigMap`
map rather than the small local HUD minimap the spec's addendum literally named — the local
minimap cannot reach a village 2000 blocks away, so this is a necessary, better-grounded
substitution of the SAME intent); year slider with all six festivals + click-to-snap (Task 1
+ Task 7); weather as buttons with Rain/Snow forcing real precipitation regardless of season
(Task 2 + Task 7 — corrected during planning: the spec named the label fix but not the
underlying rainAmount bug this would otherwise hide); time-of-day slider (Task 4 + Task 7);
festival buttons retired in favour of the slider (Task 7 drops them). All spec sections have
a task. Phase 2 (sendBeacon session-end) is explicitly out of this plan, per the spec.

**2. Placeholder scan** — no TBD/TODO; every code block is complete, real code against
verified current source (not paraphrased). The one explicit "re-read before editing" caveat
on Tasks 2/7/9 is not a placeholder — it's an accurate warning that this plan was written
against a specific snapshot of fast-moving files, and line numbers are anchors, not guarantees.

**3. Type/name consistency** — `festivalBands()` returns `{id, name, centre, left, width}`
consistently used the same way in Task 1's test and Task 7's chip loop. `overrideWeatherState(state)` returns `{weather, liveRain, liveFog, liveWind}` consistently in Task 2's test and
its `sky.js` integration. `bigMapScreenToWorld(mapXf, sx, sy)` returns `{x, z}` used
identically in Task 3's test and Task 7's click handler. `debug.setWeather`/`debug.setTime`
names match between Task 4's definition and Task 7's slider/button call sites. The EVO
endpoint's response shape (`online/live/recent/brain/relay`) matches exactly between Task 9's
Python return and Task 8's JS consumer.
