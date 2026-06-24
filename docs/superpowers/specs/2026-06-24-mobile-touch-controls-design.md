# Mobile & tablet touch controls

**Date:** 2026-06-24
**Status:** design approved, ready for implementation plan
**Scope:** new `src/touch.js`, thin wiring in `src/main.js`, responsive `style.css`, `index.html` viewport

## Problem

Moorstead is keyboard + mouse + pointer-lock only. On a phone or tablet the first-person states (`playing`, `riding`, `driving`) are unplayable: no WASD, no mouse-look (pointer-lock doesn't exist on touch), no left/right click to mine/place. The DOM menus (title, inventory, departures board, chat) already respond to taps because they're `click`-bound buttons, and `style.css` has no `@media` rules so nothing is laid out for a small screen.

Goal: full touch controls for the core gameplay loop with a "More" menu for the long tail, auto-shown on touch devices, plus responsive menu/HUD layout — without disturbing the working desktop input path.

### Decisions (locked with James, 2026-06-24)
- **Scope:** on-screen controls for the **core loop** (move, look, jump, sneak, sprint, mine, place, hotbar, inventory, talk); the long tail (whistles, muster, sleep, mute, survey, train views, loco driving) lives behind a **More (☰)** panel or contextual/state-specific buttons.
- **Mine/place:** **crosshair + buttons** — aim with drag-look, dedicated Mine (hold) and Place buttons act on the centre crosshair, reusing the existing raycast. No world-picking by finger.
- **Trigger:** **auto-detect + manual toggle** (`auto`|`on`|`off` in `localStorage`, toggle in the pause menu).
- **Layout:** **responsive menus too** — `@media` rules so menus/HUD reflow on a phone.

## Architecture — input-adapter overlay

The game already routes input through a shared bus, and `Player.update(dt, input, …)` is the sole consumer of movement/look intent:

- `this.keys = {}` (main.js:90) — key-state map.
- `this.input = { keys: this.keys, jumpTapped }` (main.js:703) — what `player.update` reads (main.js:3782).
- `this.mouseDown = [l,m,r]` (main.js:91).
- `player.yaw` / `player.pitch` — look angles (mutated directly by `mousemove`, main.js:675-678).
- `player.hotbar` + `ui.invDirty` — selected slot.

`TouchControls` (`src/touch.js`) is an **adapter**: it renders a DOM HUD over the canvas and, from touch gestures, writes to exactly those fields and calls the existing action methods (`attackOrMine`, `useItem`, `openInventory`, `openChat`, …). The movement, physics, mining, and placement code is **untouched** — touch synthesises signals the game already understands. This keeps the desktop path identical and isolates all touch logic in one file with pure, testable mapping helpers.

*Rejected:* a unified input-abstraction refactor (touches the working desktop path, YAGNI); canvas-drawn controls (worse styling, accessibility, responsiveness than DOM).

## Components

### `src/touch.js` — `TouchControls` class + pure helpers

**Pure, exported (headlessly testable):**
- `isTouchPrimary()` → bool. `matchMedia('(pointer:coarse)').matches && matchMedia('(hover:none)').matches`, OR `navigator.maxTouchPoints > 0 && !matchMedia('(pointer:fine)').matches`. Injectable `mm`/`nav` params for tests.
- `touchMode(stored, isPrimary)` → bool — resolves `auto|on|off` against detection.
- `joystickToKeys(dx, dy, radius)` → `{ KeyW, KeyA, KeyS, KeyD, KeyZ }`. Deadzone 0.18·radius; 8-way from the angle; `KeyZ` (sprint) when magnitude ≥ 0.85·radius.
- `lookDelta(dx, dy, sens)` → `{ dYaw, dPitch }` with `sens = 0.0042` (touch; higher than mouse's 0.0023). Caller applies and clamps pitch to ±(π/2−0.01), mirroring main.js:677-678.

**Class (`new TouchControls(game)`):**
- `mount()` — if `touchMode(...)`, build the overlay (§HUD), attach listeners, set `document.documentElement.classList.add('touch')` (drives `@media`/CSS); else no-op.
- **Event-driven:** listeners write to the bus directly — look on `touchmove`, `keys.*`/`mouseDown[*]` on button press/release. No per-frame input tick is needed: held buttons keep their flags set until release, and the existing `updateMining` (main.js:2937) and place-repeat (main.js:3967) loops already poll `mouseDown[*]` each frame.
- `setState(state)` — swap the contextual cluster for `playing` / `riding` / `driving` and refresh contextual pills.
- `refreshContext()` — show/hide Talk, Board, Mount/Leave, Sleep from game predicates (`villagerInView()`, near-station, `boat`/`mount`, near-bed).
- `destroy()` — remove overlay + listeners (on teardown / toggle off).

The overlay is a single absolutely-positioned container (NOT `position:fixed` relative to the canvas parent) with `touch-action:none`, layered above the canvas, below the existing DOM menus (which keep working as-is).

### `src/main.js` — thin wiring
- Instantiate `this.touch = new TouchControls(this)`; `mount()` after the renderer/canvas exist.
- **Gate pointer-lock on touch:** in the `mousedown` lock path (main.js:665) and `pointerlockchange` pause (main.js:688), skip when `this.touch.active` — touch must not request a lock or pause when it "unlocks".
- Call `this.touch.setState(...)` where `this.state` changes; `refreshContext()` each frame or on relevant events.
- Contextual buttons call existing methods — no new gameplay logic.

### `style.css` + `index.html`
- HUD styles (joystick, look zone, buttons, pills, More panel) under a `.touch` root class.
- `@media (max-width: 820px), (pointer: coarse)`: title/inventory/board/chat reflow to single column, tap targets ≥ 44px, HUD scales, `env(safe-area-inset-*)` padding for notches.
- `index.html`: viewport → `width=device-width, initial-scale=1, user-scalable=no, viewport-fit=cover`; `touch-action:none` on canvas + overlay.

## HUD layout

(Per the approved mockup.) Landscape orientation:
- **Bottom-left:** floating movement joystick (appears under first touch in the left zone). Push to edge = sprint.
- **Right drag zone:** transparent region (above the button cluster) → look. Any touch starting there that isn't on a button drives yaw/pitch.
- **Bottom-right cluster:** Jump (large; double-tap = toggle fly in creative), Mine (hold to break), Place, Crouch (hold).
- **Bottom-centre:** the existing hotbar, slots made tappable.
- **Top-right:** Pack (inventory), More (☰).
- **Contextual pills (top-left, shown only when relevant):** Talk to <name>, Board, Mount/Leave, Sleep.
- **State swaps:** `riding` → Seat/Driver/Overhead + Leave (replaces mine/place); `driving` → Reverser / Shovel coal / Leave.
- **More (☰) panel:** mute, muster flock, sheepdog whistles (5-command row), survey (creative), save, quit.

## Control mapping (touch gesture → existing signal)

| Gesture | Writes |
|---|---|
| Joystick 8-way | `keys.KeyW/KeyA/KeyS/KeyD` (via `joystickToKeys`) |
| Joystick to edge | `keys.KeyZ` (sprint) |
| Right-zone drag | `player.yaw -= dYaw; player.pitch -= dPitch` (clamped) |
| Jump (hold) | `keys.Space = true` (drives jump / fly-up) |
| Jump (each tap) | `input.jumpTapped = true` — player.js (142-149) consumes it and toggles fly on a double-tap in creative, so no touch-side fly logic is needed |
| Crouch press (hold) | `keys.ShiftLeft = true` (sneak / fly-down) |
| Mine press | `mouseDown[0]=true; breakProgress=0; attackOrMine(true)` (held → existing mining loop continues) |
| Place press | `placeRepeat=0.4; useItem(); mouseDown[2]=true` |
| Button release | clear the corresponding `keys.*` / `mouseDown[*]` |
| Hotbar slot tap | `player.hotbar = i; ui.invDirty = true` |
| Pack / ☰ | `openInventory()` / open More panel |
| Contextual pill | `openChat(v)` / `openBoard(false)` / `leaveBoat()`/`dismountPony()` / `trySleep()` |

Movement/mine/place only feed in `playing`; look feeds in `playing`/`riding`/`driving` (matching the existing handlers' state guards). When not in a feeding state the adapter writes nothing (the game already passes empty input otherwise, main.js:3785).

## Detection & toggle

- Default `auto`: HUD shows when `isTouchPrimary()`.
- `localStorage['moorcraft-touch']` = `auto|on|off`; pause-menu toggle cycles it and calls `mount()`/`destroy()`.
- A live `pointerdown` of `touchType` may also trigger first-time mount (covers devices that misreport media queries).
- On a desktop with a mouse: `off` by detection, zero overlay, zero behaviour change.

## Testing

- **`scripts/verify-touch.mjs`** (headless, added to `npm run verify`): `joystickToKeys` (deadzone, each 8-way octant, sprint threshold), `lookDelta` (sign + scale), `isTouchPrimary`/`touchMode` against mocked `matchMedia`/`nav` (coarse-no-hover → true; fine pointer → false; `on`/`off` overrides). Pure functions, no DOM.
- **Live (preview):** resize to mobile + `(pointer:coarse)` emulation; synthesise `touchstart/move/end` on the zones; assert `player.yaw` changes on look-drag, `keys.KeyW` toggles from the joystick, Mine/Place fire `attackOrMine`/`useItem`, and a desktop (fine pointer) shows no overlay and unchanged input.

## Risks / out of scope

- **Phone GPU performance** for voxel three.js is unknown — *separate* from controls; flagged, not addressed here.
- **Pointer-lock bypass** must be airtight or touch tries to lock and pauses (covered in wiring).
- **iOS Safari:** `100vh`, 300ms tap delay, gesture conflicts → handled via `touch-action:none`, `viewport-fit=cover`, and not relying on `vh` for the overlay.
- **Two-finger** look + move simultaneously: each `Touch` is tracked by `identifier` and routed by which zone it began in, so move and look are independent.
- **Out of scope:** performance tuning, gamepad, haptics, on-screen keyboard niceties beyond what the browser provides for the chat/name inputs.
