# Admin panel — front-page entry + Parish Ledger diagnostics

Status: approved by James, 2026-07-03. Client work plus one small, scoped EVO-side endpoint
(see "Reachability" below) so the panel is useful away from home, not just on the LAN.

## Problem

Warden access exists (`ADMIN_HASHES` in `defs.js`, `loginWarden()` in `main.js`) but is buried
inside the multiplayer invite-login flow, and the in-game "Parish Warden" panel (god mode,
kit, teleport, season/festival preview, relay health) has no visibility into who's actually
playing right now or basic system health. James wants a fast, discoverable route in, plus a
"Parish Ledger" view: players online (including solo worlds), recent activity, system status.

## What already exists (load-bearing facts)

- **Auth**: `ADMIN_HASHES` (SHA-256 list) in `src/defs.js`; `loginWarden()` in `src/main.js`
  hashes an input and sets `this.auth = {warden:true, name:'Warden'}`, persisted to
  `localStorage['moorcraft-auth']`. `isAdmin()` just reads `this.adminOk`.
- **Panel**: `renderAdminPanel()` (`src/main.js` ~1398) fills `ui.adminPanel`, a div inside the
  pause panel, shown whenever `isAdmin()` is true. Already has god mode, full kit, teleport
  (villages/stations/landmarks/players-in-room/coords), season+festival preview, and (when in
  a shared room) a relay connection-health readout refreshed every 1s.
- **Activity data already flows to the EVO, solo included**: `recordVisit()` (main.js ~1822)
  POSTs `/dash/visit` once per session; the frame loop (main.js ~5596) POSTs `/dash/ping`
  every 60s whenever `state !== 'title'` — gated on nothing else, so solo worlds report too.
  Server-side (`~/moorstead/dash/app.py` on the EVO), these land in `players.json` /
  `sessions.json` / `visits.json`, and `GET /api/overview` already computes a "live" view
  (any session pinged in the last 180s counts as online) plus per-player history.
- **Reachability**: `moorstead-dash` binds `0.0.0.0:8095` but Caddy only publicly proxies
  `/ping /auth/claim /visit /request-invite /feedback` — the dashboard UI and `/api/overview`
  (which include raw pid/IP) are LAN/Tailscale-only today, deliberately. James wants the panel
  useful when he's away from home, which is the common case for a quick check — so this spec
  adds ONE new scoped endpoint rather than exposing `/api/overview` itself (see below).

## Design

### 1. Front-page Admin entry

A small "🔑 Admin" link on the title screen, visually secondary (near "About" / "Feedback &
bugs", not a primary CTA — this is not a player-facing feature). Click opens an inline
overlay: one "Warden key" input + Enter/submit, reusing `loginWarden()`'s existing hash-check
verbatim (no new auth path). On success: skip the invite-code flow entirely and start a fresh
solo creative world exactly like "New Single-Player World" does today, with `adminOk` already
true. On failure: inline error text, field clears, no lockout/throttle needed (it's a local
hash compare, not a network auth attempt — no brute-force surface beyond what already exists).

### 2. New EVO endpoint: `GET /dash/api/admin-summary`

Added to `~/moorstead/dash/app.py` alongside the existing `/api/overview` (which stays
LAN-only, untouched). The new endpoint reads the same `players.json`/`sessions.json` data
`/api/overview` already uses, but returns an **aggregate-safe** projection only:
- Total online now + a list of `{name, world (solo/shared + room name), day, standing, loc}`
  per live session — **no pid, no IP**, matching the existing kid-safety/no-unbounded-telemetry
  posture (the raw data already never left the LAN; this endpoint keeps that true for the
  fields that matter — identity/network — while surfacing the fields James actually asked for).
- Recent activity: a short trailing list from `sessions.json`/`visits.json`, same field
  redaction.
- Simple auth: reuse the SAME warden-key contract already in place client-side — the client
  sends the entered warden key (or a value derived from it) as a header/query param; the
  endpoint hashes and compares against the existing `ADMIN_HASHES`-equivalent list server-side
  (the EVO likely needs its own copy of the accepted hash(es) — confirm during implementation
  whether app.py already has any shared secret mechanism to reuse, e.g. for `/auth/claim`).
  This is intentionally simple (not a full auth system) since the data behind it is already
  aggregate-safe even if the endpoint were hit without a key — the key gates convenience, not
  a serious information boundary. Rate-limit lightly to avoid it becoming a scraping target.
- Added to Caddy's public path allowlist (the one existing edit to `/etc/caddy/Caddyfile`).

### 3. Parish Ledger card in the admin panel

New section at the top of `renderAdminPanel()`, above the existing god-mode/kit row. Populated
by one `fetch('/dash/api/admin-summary', ...)` call (relative path — reuses the existing
Vercel rewrite of `/dash/:path*` to the EVO, so it works from moorstead.app in production and
from localhost in dev), refreshed on a timer while the panel is open (mirror the existing 1s
relay-health `setInterval` pattern — reuse its cadence and its cleanup-on-panel-close
discipline, but at a gentler ~10s interval since this is a network fetch, not a free local read).

- **Players online now**: count + names, solo and shared combined, straight from the new
  endpoint.
- **Recent activity**: the trailing list from the same payload.
- **System status**: three lightweight, independent checks —
  - **Brain**: reuse whatever the client already calls to reach `/brain` (villager dialogue
    already depends on this working) — a one-shot status ping, not a new integration.
  - **Version**: this build's version string vs. the deployed one, reusing `update-check.js`'s
    existing comparison logic (it already knows how to detect a stale tab).
  - **Relay**: reachable/unreachable, independent of whether a shared room is currently joined
    (today's health readout only exists *inside* an active connection).
- **Fetch failure handling**: if the endpoint is genuinely unreachable (EVO down, not a
  LAN-only boundary anymore), the card shows a plain "Ledger unreachable" message instead of
  the data — must never look like an error or block the rest of the admin panel.

### 4. Phase 2 (small, optional, flagged not required for approval)

A `navigator.sendBeacon` on `visibilitychange`/`pagehide` to mark explicit session end, instead
of relying on the 180s recency heuristic — tightens "online now" accuracy. Touches `app.py`
again (a new tiny handler or `/ping` with an `event:'leave'` payload). Build only if Phase 1
ships and James wants tighter precision; not blocking.

## Addendum 2026-07-03: Parish Warden panel redesign

The original spec left `renderAdminPanel()` untouched ("already exists, not touched"). James
subsequently asked for it to be rethought — the flat button-list (villages/stations/landmarks
as individual buttons, 4 season-quarter buttons, per-festival buttons) replaced with something
that lets him preview *any* combination of location + season/date + weather + time-of-day
before dropping in, since verifying seasonal/weather/lighting changes live is now a routine
need (this session shipped a real solar model, accelerated moon, weather-linked precipitation,
etc. — the warden needs to review all of it quickly). Settled via visual-companion mockups
(`.superpowers/brainstorm/221-1783078785/content/`, not committed — throwaway mockups, the
decisions below are what's binding).

### Layout: map-led split ("Option C")

Two-column panel: a bigger live minimap on the left (clickable — see below), a stacked sidebar
of scene controls on the right (year / weather / time-of-day), with travel-and-actions
(trains, god mode, kit, Parish Ledger) as a separate strip underneath — NOT part of the
scene-setting cluster, since boarding a train is a distinct action rather than a condition to
set before dropping in.

### The map becomes the "commit" action

The existing minimap (`ui.js` ~1755–1873, canvas 2D, redrawn every frame from
`world.surfaceColors()`, north-up, fully invertible screen↔world coordinate math per the
research above) gains a click handler. Clicking computes world x/z from canvas pixel
coordinates (inverse of the existing render mapping) and calls `adminTeleport(x, z, label)`
— reusing the exact function the current village/station/landmark buttons already call, just
with a click-derived x/z instead of a hardcoded one. Clicking the map is the "drop in now"
action: whatever the three scene sliders currently say (year/weather/time) is what you land
into. No separate confirm step (matches how `adminTeleport` already works today).

### Scene sliders

1. **Year** (`<input type=range>` calling `debug.setSeason(value)` on input — this already
   works today for any 0..1 float, per the research; no engine change). All SIX festival
   windows drawn as shaded bands, TRUE to their real width from `FESTIVALS` (easter/mayday/
   midsummer/harvest/bonfire/yule — widths vary genuinely, Bonfire/May Day are the narrowest
   at ~7 days, Harvest/Yule the widest). Each festival's name renders as a clickable chip
   above its band; clicking a chip snaps the slider to that festival's exact centre phase —
   this is the mechanism that lets James land inside a narrow window cleanly without fiddly
   manual dragging. Manual dragging still works for any other date; the bands stay visible
   throughout so a manual drag shows proximity to a window without needing the chip.
2. **Weather**: a row of buttons, NOT a slider — `Live | Clear | Misty | Rain/Snow | Fog`.
   Buttons, not a slider, because the four states aren't points on a continuum (no natural
   ordering) — a slider would misleadingly imply one. "Live" (default) tracks the real
   forecast exactly as today. Selecting a state requires a NEW `debug.setWeather(state)`
   hook: sets `sky.weather` directly, parks `sky.weatherTimer = 1e9`, and sets an override
   flag checked BEFORE the live-weather block in `sky.js update()` (today `currentWeather()`
   unconditionally overwrites `this.weather` every frame when a live sample exists — a raw
   one-shot assignment would be stomped next frame without this). **The button is labelled
   "Rain/Snow", not just "Rain"**: confirmed live that `winterPrecip()` (`snow.js` ~54) already
   routes 100% of precipitation to snow whenever `season.warmth < 0` and 100% to rain
   otherwise — so selecting this button in a wintry year-slider position already produces
   snow correctly, zero new precipitation logic needed. Only the label needs to say so, so it
   doesn't read as a bug when "Rain" produces snow.
3. **Time o' day**: a plain `<input type=range>` calling a NEW `debug.setTime(t)` (clamps
   `sky.time` into [0, 0.999], mirrors `setSeason`'s existing clamp pattern exactly — trivial,
   since no such setter currently exists at all, per the research). One-shot set, same
   behaviour the title-flyover's hardcoded `sky.time = 0.40` already has — time keeps advancing
   normally from wherever the slider left it, it doesn't freeze.

### Festival buttons are retired, not ported

Confirmed via research: `debug.festival(id)` does nothing but call `phase(festival.centre)` —
no player warp, no extra logic. The year slider's snap-chips are a strict superset of what the
old festival buttons did (same effect, plus visible window width, plus works for any other
date too), so the separate per-festival buttons are dropped rather than kept alongside.

### What's carried over unchanged

God mode, full kit, "drop in on a player" (shared moor only), coordinate-entry drop, and the
Parish Ledger card from the main spec above — all keep their existing behaviour, just
relocated into the new "travel & actions" strip under the map+sliders row.

## Out of scope (explicit)

- Restructuring what counts as "recent activity" beyond what `sessions.json`/`visits.json`
  already track (e.g. quest completions, purchases) — a separate ask if wanted later.
- Exposing raw pid/IP data publicly, or changing `/api/overview`'s LAN-only boundary — the new
  endpoint is a separate, redacted projection specifically so this stays true.
- Kicking/muting players, or any other admin *action* beyond what `renderAdminPanel()` already
  offers (teleport, god mode, kit, season/festival preview).
- Changing the underlying pid/IP logging shape in `players.json` etc. — already sound, not
  touched.

## Testing

- Headless (client): a pure-function test for the "ledger unreachable" fallback rendering
  given a rejected fetch, without a real network call (mock `fetch`); confirm existing
  `update-check.js` coverage is sufficient for the version-compare reuse.
- Headless/manual (EVO): exercise the new endpoint directly via `curl` over SSH before wiring
  the client to it — confirm it returns redacted fields only (no pid/IP present in the
  response body), confirm the Caddy allowlist change actually routes it publicly (curl the
  public domain, not just localhost on the EVO), confirm the existing `/api/overview` behaviour
  and its LAN-only boundary are completely unchanged by the addition.
- Live (client, per this session's standing verification discipline): `debug.photo` +
  `debug.glHealth` aren't relevant here (no shader/GL surface) — verify instead by loading the
  title screen, clicking Admin, entering the key, confirming a fresh creative world starts with
  the panel populated from the real public endpoint; and by simulating a fetch failure to
  confirm the "unreachable" fallback renders cleanly rather than breaking the panel.
- `npm run verify` must stay green; no save-format or relay-protocol changes, so no
  `minClientVersion` bump. The EVO change is a new read-only route, additive by construction.
