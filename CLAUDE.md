# Moorstead — working instructions

Procedural sandbox game (Vite + Three.js). Public client: **www.moorstead.app** (Vercel).
This repo is the **client** source of truth. The backend (relay, NPC brain, dashboard) runs
on a separate box ("the EVO") and is **not** in this repo — but it **is reachable**, see below.

## The server side is reachable — verify it, don't disclaim it

The relay (`worldsvc`), NPC brain (`yorkshire_bot`), and dashboard run on the EVO and are
reachable over Tailscale (`ssh evo-tailscale`, works anywhere on the tailnet) or over LAN
(`ssh evo-wifi`). Passwordless `sudo -n` works there.

When a question needs server-side ground truth — auth/warden enforcement, how the relay
handles a message, what the brain actually returns, live service state — **SSH in and read
the real source** (`~/moorstead/worldsvc/`, `~/moorstead/yorkshire_bot/`, `~/moorstead/dash/`).
Do **not** answer "that's off-repo / I can't reach it / that's yours to check." Read-only first;
back up any file (`cp x x.bak-YYYYMMDD-tag`) before editing on the box.

The brain is also mirrored under local git at `C:\Users\James\moorstead-evo-work`.

## Build & verify

- `npm run build` — production build (Vite).
- `npm run verify` — the headless gate (~57 `scripts/verify-*.mjs` checks). **Must be green
  before deploy.** Most "visual" bugs here are scene-graph/material/camera state bugs that are
  testable headlessly (e.g. Three.js raycasting under Node) — add a verify script rather than
  relying on eyeballing.

## Deploy

Use **`npm run deploy`** (`scripts/deploy.mjs`) — not bare `vercel`. It gates on a clean tree /
on-main / pushed, runs verify + build, patch-bumps the version, commits, pushes, and ships to
Vercel. Bump `package.json` `version` only when an update is worth interrupting open tabs for;
bump `minClientVersion` only for breaking (multiplayer-protocol / save-format) changes. EVO
backend services deploy separately (scp + `systemctl restart`). Full detail in `DEPLOY.md`.

## Setting & period

Victorian-era North York Moors, ~1900. Keep all content period-accurate (candles not electric
light, no anachronistic music/tech). See the project memory for the wider world/economy/NPC state.
