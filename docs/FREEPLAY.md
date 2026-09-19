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

Weapons (G) adds a plasma blaster, rocket launcher, gravity gun, automatic machine gun and live sheep launcher. Plasma and
rockets make persistent craters; gravity flings local cartoon villagers, animals
and debris without changing terrain. All have unlimited ammunition.

Build adds six futuristic materials and a Vehicle control block plus line, wall, floor and hollow-box brushes
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

Limits bound processing and storage: eight million edited cells, 1,024 touched
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

## Build and drive

Open Vehicles for a starter car, plane, submarine or tank body. Aim its preview
at clear ground and place it. The tank body uses car controls and a decorative
turret; it has no separate working cannon. Alternatively, place one Vehicle control
block on a custom build, aim at it and press E or Use core. Connected placed blocks
are highlighted automatically. A block-count preview and Car/Plane/Submarine
choice lead to an explicit Convert button, then Enter to drive. Manual corner
selection remains an advanced option. Natural terrain and air stay behind;
disconnected extras inside the selection are refused until explicitly reviewed.
Up to 512 blocks inside 16 × 12 × 16 form one vehicle, with sixteen shared saved
vehicles. Vehicles or Menu → Our vehicles reopens the controls.

Enter a vehicle to drive with WASD or the touch arrows. Plane/submarine use
Space/Up and Shift/Down for altitude/depth. V or Change view switches between the
control seat and an outside camera. Cars follow terrain and stop at walls;
submarines crawl on land and move freely underwater. Park gets out and saves the
vehicle. Either boy can enter an unoccupied vehicle or choose Edit build to snap
it to the nearest block position and quarter turn, provided the space is clear.
Buildings above the terrain ceiling must descend before becoming editable blocks.

Conversion, materialisation and undo are atomic server transactions. Vehicles
survive reconnects and restart; reset recovery includes them. Driving uses an
exclusive pilot lease and its own bounded pose stream so it does not interrupt
the other boy's terrain edits. Disconnect releases the pilot and retains the last
accepted pose. The backend schema is 4 and content negotiation is version 6;
old clients must refresh. This does not alter ordinary Moorstead's protocol.

Hold Fire (or left mouse with pointer lock) for machine-gun bursts. Sheep are
shared cartoon projectiles which land alive and amble before leaving; a bounded
pool of eight avoids filling tablet memory. Sheep shots do not carve terrain.

## Battlefield and armies

Menu → Battlefield / armies → choose Blue or Red. Joining moves the player to
that army's camp and equips the machine gun; leaving returns to the previous
Free Play position. Battlefield participants use health, shields and quick
cartoon respawns. Ordinary Free Play retains unlimited health. Park vehicles
before joining; leave the battle before driving again.

Army recruits six soldiers at a time, up to 24 per team. They automatically attack
when the round starts. Attack, Defend our flag, Follow, Hold and Move squad to aimed
point control the player's soldiers. Both players can fight
with machine gun, plasma, rockets and bombs. Solid voxel terrain blocks bullets
and shields against a blast before that blast removes the cover. Shield deploys
a six-metre dome for 12 seconds, with a 25-second cooldown. Personal shields
regenerate after three quiet seconds. Players respawn after five seconds;
soldiers return after eight. The scoreboard counts enemy knockouts.

War mode uses capture the flag in a marked 128×128 warzone. During setup, build a
base, stand inside it on clear ground, and choose Army → Place flag & ready.
Bases must be at least 32 blocks apart. Both sides ready starts the round and
locks the base locations. The HUD shows each side's readiness, troop counts,
reconnection pauses and the winner; a confirmed personal hit has visual feedback.
Players pick up
the enemy flag by approaching it, then carry it to their own base while their
own flag is home. That capture wins; knockouts alone do not decide the winner.
Knockouts drop a carried flag, defenders can touch it to return it, and dropped
flags return automatically after 20 seconds. A flag carrier cannot teleport to
base. The Map shows both flags, soldiers and the boundary. Play another round resets armies and base choices while
preserving fortifications. Mega and atom bombs are hidden and refused in war
mode; spectator blasts of those types cannot overlap an occupied battlefield.

Build includes excavating trenches with steps, bunkers with doors and firing
ports, sandbag barricades and watchposts. Their terrain changes persist and use
the existing shared undo. Armies, scores, shields and orders are session state;
leaving after a round dismisses that player's soldiers. Active rounds require
capture or explicit Forfeit to leave; world reset/restore cannot bypass the match.
A dropped connection keeps the army for 60 seconds and pauses combat. Reconnecting
resumes the round; expiry forfeits. No persistence format changes are needed.

Combat runs deterministically in the relay at 5 Hz, with no model/NPC brain.
The 128×128 battlefield is on fresh ground at [-2048,1024]; authoritative collision
starts from the exact client generator and overlays saved edits. Generate its
header and compressed voxels with
`node scripts/export-freeplay-battlefield.mjs tests/.artifacts/battlefield`.
The fixture uses these files explicitly; production stores them alongside the
Free Play database. Client and backend guards cover terrain parity, cover,
shield damage, squad orders, caps, respawn and transactional save failure.
The browser journeys include `tests/game/freeplay-battle.spec.mjs` and
`freeplay-battle-combat.spec.mjs`. The latter verifies opponent health loss,
protection from the identical shot behind a built wall, and damaging default-army
combat. A synthetic opponent walks accepted supported steps; exact camera aim is
disclosed preparation, not a claim of natural touch accuracy. Synthetic accounts
exercise the real adapter without entering the boys' production sessions.
