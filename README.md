# Moorstead

A fully procedural sandbox set on t' North York Moors. Built with [Three.js](https://threejs.org/) — every texture, sound and creature is generated in code; there isn't a single asset file in the project.

## Running it

```bash
npm install
npm run dev
```

Then open the printed local URL (usually `http://localhost:5173`).

To build for production: `npm run build` (output in `dist/`).
Headless test suite — `npm run verify` (18 checks: railway, rail clearance, train view, resources, landmarks, season, weather, pets, villagers, economy, herding, game-facts, NPC activity, farm, regeneration, deeds, menagerie, mining). Run it before every deploy.

## Deploying

The public client and the backend services deploy **separately**.

**Public client → Vercel** — what players load at [www.moorstead.app](https://www.moorstead.app) (apex + owd moorcraft.app redirect there). From the repo root, once `npm run verify` and `npm run build` are green:

```bash
npx vercel deploy --prod --yes
```

Vercel rebuilds from local source — a `git push` does **not** deploy. Verify live: fetch the homepage, read the `assets/index-*.js` hash, grep that bundle for a string unique to your change. Browsers cache hard — Ctrl+Shift+R to see it. (The EVO also keeps a static mirror at `~/moorstead/game`, but it is dormant; Vercel is canonical.)

**Backend services → the EVO box** (`ssh evo-tailscale`, passwordless sudo). Only `clint-body/` is in this repo; the others live on the EVO under `~/moorstead/`. Always `cp x x.bak-YYYYMMDD-tag` before overwriting, and smoke-test after restart.

| Service | Source | Deploy |
| --- | --- | --- |
| Merlin (in-world wizard) | `clint-body/` (in repo) | `scp clint-body/{clint_body.py,npc_facts.py,game-facts.json}` → `~/moorstead/clint-body/`, then `sudo systemctl restart clint-body clint-body-bairns` |
| Villager brain (FastAPI :8010) | `~/moorstead/yorkshire_bot/brain/` (**not** in repo) | edit working copies under `C:\Users\James\moorstead-evo-work\brain\`, `scp` back, `sudo systemctl restart moorstead-brain` |
| Relay (worldsvc :8096) | `deploy/world/server.py` → EVO `~/moorstead/worldsvc/` | `scp` + `sudo systemctl restart moorstead-world` |
| Dashboard (parish ledger, LAN-only :8095) | `deploy/dash/app.py` → EVO `~/moorstead/dash/` | `scp` + `sudo systemctl restart moorstead-dash` |

`deploy/ship.ps1` does the client build + EVO mirror + Vercel in one go (it hangs off home LAN — see the `moorcraft-evo-stack` memory for the manual Tailscale path). Full host/port/tunnel detail is in `deploy/README.md`.

## Talking villagers

Every settlement is lived in: Moorstead's family, the stationmaster and shepherdess
at Goathland, the innkeeper and owd miner at Rosedale Abbey, fisherfolk at Staithes,
the vicar and market trader at Pickering, engine crew at Grosmont, and the fishwife
and jet carver at Whitby. Their brains run on the EVO X2 (`yorkshire_bot` FastAPI +
llama.cpp, Gemma) behind `/brain`; the Vite dev proxy points at the public tunnel so
dev gets real villagers with no local setup. Right-click for a natter. Conversations,
memory, trust and gift preferences all live in the brain, per visitor. **Of an
evening they head indoors — knock on, they'll still talk.** Without the brain the
villagers still potter about, they just say nowt.

## T' Moors Railway

One steam train runs the line on a shared clock — same for every player. The route
follows the real NYMR's shape: **Pickering** (south end) → **Levisham** (a lone halt
on the Hole of Horcum's shoulder) → **Moorstead** (playing Newton Dale) →
**Goathland** → **Grosmont** → **Whitby** by the sea. Book at a station board
(fare in coal), be stood on the platform when she comes in, and ride in the carriage.

## T' Shared Moor

One world for everyone (seed `t-shared-moor`), relayed through the EVO: block edits
persist server-side, players see each other, village chat carries ~60m, and the
day/night clock is shared. Pockets and ventures are kept per account.

## Adventures, standing & consequences

Talk to villagers (or read the **parish notice board** on the green, `Q` for your
journal) to pick up ventures: a five-chapter mystery — *T' Hound o' the Mires* —
told across the real landmarks, plus endless errands. Your **village standing**
(Newcomer → Treasured) gates bigger quests and barter stock. The finale sends you
up Roseberry Topping at night to face the Great Barghest.

## The land itself

The map echoes the real North York Moors at true-ish bearings: a high heather
plateau cut by named dales, blanket bog on the tops, and the North Sea behind
cliffs to the east. Fixed landmarks: **Roseberry Topping**, **T' Hole of Horcum**,
**the Wainstones**, **Rosedale ironstone kilns**, **Wade's Causey**, scattered
**moor crosses** (say hello to Fat Betty), and the ruined **abbey** on the cliff
top above Whitby.

## Claims, decay & mining

* **Deep dig restrictions**: Digging more than 1 block below the original terrain grade is restricted outside designated public quarries (Moorstead, Goathland, Pickering) and licensed mines.
* **Mine licensing**: Players can place a Mine Entrance block and buy a Mining Licence at notice boards to unlock a depth band. Deepening the mine up to 40m requires upgrades.
* **Safety fixtures**: Digging in deep bands requires a corresponding pick tier and at least one safety fixture block (Pit Props, Safety Lamp, Winch) placed inside the mine's 5m cylinder.
* **Prospecting skill**: Mining Jet requires Prospecting Level 3, and Polyhalite requires Level 6. Novices get only bare stone.
* **Land claims**: Players can stake a claim to protect their builds. Unclaimed builds decay after 30 days, and builds in lapsed claims crumble gradually. Breeding triggers in claims with 2 or more of the same animal species.

## Controls

| Input | Action |
| --- | --- |
| Mouse | Look about |
| Left click | Dig blocks / clout mobs |
| Right click | Place blocks / eat / use bench & range / natter |
| W A S D | Walk |
| Space | Jump / swim up (double-tap to fly in creative) |
| Z | Sprint |
| Shift | Sneak (won't fall off edges) |
| 1–9 / wheel | Hotbar |
| E | Inventory & crafting |
| Q | Journal |
| T | Village chat (shared moor) |
| M | Mute |
| Esc | Pause |

## Tech notes

- Chunked voxel world (16×64×16), streamed around the player with per-frame budgets
- Culled-face meshing with baked per-vertex ambient occlusion
- Deterministic seeded value-noise terrain (fBm), 3D noise caves, hash-based placement
- Save format: raw chunk bytes + game metadata in IndexedDB (DB name kept as
  `moorcraft` for save compatibility)
- `scripts/verify-rail.mjs` asserts the railway never crosses itself, no station or
  village stands in water, and the line matches the real NYMR's station order
