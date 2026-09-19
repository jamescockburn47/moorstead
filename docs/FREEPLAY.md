# Moorstead Free Play

Private `/freeplay` entrance for Henry and James, with separate fresh invite codes
and one persistent world. Released on 19 September 2026 with fresh room-bound
accounts. The main title page links directly to Free Play before ordinary login.
Backend release and recovery steps are in
[`deploy/free-play/README.md`](../deploy/free-play/README.md).

## Playing

Build opens a searchable cupboard of unlimited blocks. Bombs opens the five blast
levels. Fly toggles flight. WASD moves, dragging looks around, Space rises/jumps,
Shift descends and Z speeds up. Touch users have movement, look, up/down and
Place/Break controls. Health and supplies remain unlimited.

Map (or M) shows both players by name. The direction/distance arrow remains on
screen while playing; tap it to open the map. Find each other fits both players,
while Nearby keeps the local village in view. Offline or reset positions clear.

Weapons (G) adds a plasma blaster, rocket launcher and gravity gun. Plasma and
rockets make persistent craters; gravity flings local cartoon villagers, animals
and debris without changing terrain. All have unlimited ammunition.

Build adds six futuristic materials plus line, wall, floor and hollow-box brushes
in sizes 3, 5 and 7. Choose a brush, then its material. Space base, neon tower and
sky bridge are fixed prefabs. Aim the preview, rotate with R or Rotate, and Place.
Each build is one shared undo action; hollow interiors clear existing blocks.
Energy windows are solid decorative panels. Futuristic content is private to this
edition. Content-version negotiation refuses older clients before they receive it.

Undo removes the latest shared terrain action, whichever player made it. Menu
offers reset with a confirmation for both players, and recovery of the pre-reset
world. Builds and craters persist across reconnects and server restarts. Either
player can recover the world. Each account can play on one device at a time.

The world copies Moorstead's procedural terrain, including its towns and inns.
Destruction also removes unsupported rail, road and scenery sections. Trains stop
using damaged lines. Villagers and animals are cartoon local populations which
fling and recover; free play does not require the live NPC brain.

## Ownership

`npm run verify:freeplay` covers protocol, persistence, geometry, previews and
bounded effects. `npm run test:freeplay` runs the owned two-player map/pack journeys
and touch-control overlap regression against an isolated loopback server. Install
the pinned Playwright browser with `npx playwright install chromium` first. These
checks never use the boys' production accounts or modify their live world.

| Files in `src/freeplay/` | Responsibility |
|---|---|
| `entry`, `auth`, `config`, `connection`, `protocol` | Dedicated entry and strict room/session/transfer boundaries |
| `runtime`, `input`, `actions`, `ui`, `style` | Creative play, bounded update work and accessible controls |
| `world`, `terrain-overrides` | Chunked persistent overrides, explicit air, baseline restoration |
| `scenery*`, `peers` | Destructible procedural overlays, damaged railway behavior and other players |
| `catalogue`, `effects`, `explosion-audio`, `population*` | Five server-defined blast levels and bounded procedural spectacle |

Server authority determines all edited cells, ordering, history and reset epochs.
The client previews damage and renders effects; it cannot choose arbitrary bomb
radii. Replacement snapshots supersede pending client work, and a backgrounded
tab resynchronises instead of accumulating unlimited typed arrays. Ordinary save
storage and global warden powers are not used.

Limits bound processing and storage: two million edited cells, 1,024 touched
chunks, up to 20 undo entries bounded by 400,000 inverse cells, and three live
effect slots. A refusal preserves saved state and leaves undo/reset available.
Unlimited supplies do not remove these world-capacity limits.

## Verification

Install pinned Python fixture dependencies with
`python -m pip install -r deploy/free-play/requirements-test.txt`.
`npm run verify:freeplay` runs client, actual terrain/scenery, effects and backend
checks. It is included in the canonical `npm run verify` gate.

`npx playwright test tests/game/freeplay.spec.mjs` exercises two actual browser
entries against the real backend adapter on loopback, with disposable synthetic
accounts. The explicit prepared village viewpoint changes only position/camera;
building, blasting, movement, undo, reset and returning use player controls.
`MOORSTEAD_FREEPLAY_PORT` selects the fixture port (default 4319), separate from
the existing isolated Vite port. Both servers fail if their port is occupied.
External services are blocked in these journeys.

Initial integrated evidence: both players received 188,392 override cells from
the village blast; nine nearby characters were flung; the crater survived reload,
and undo/reset/recovery passed. Keyboard movement entered the real excavated
volume. Browser screenshots are disposable under `tests/.artifacts/`.

Plain graphics is the default target for a decent Amazon Fire tablet. Headless
Chromium uses software rendering, so its timing does not certify tablet frame
rate. Physical Fire/Silk performance and the boys' judgement of control feel are
explicit live-test checks. Audio synthesis is checked for bounded nonzero output;
listening on the actual device remains a live-test check.
