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
