# Moorcraft

A fully procedural voxel sandbox set on t' North York Moors. Built with [Three.js](https://threejs.org/) — every texture, sound and creature is generated in code; there isn't a single asset file in the project.

## Running it

```bash
npm install
npm run dev
```

Then open the printed local URL (usually `http://localhost:5173`).

To build for production: `npm run build` (output in `dist/`).

### Talking villagers (optional)

The village of **Moorstead** is populated by the characters from the local
`yorkshire_bot` project. Start its brain first (`yorkshire_bot/run_v2.bat`, which
brings up Ollama + the FastAPI brain on `127.0.0.1:8000`), then right-click a
villager in-game for a natter. Conversations, memory, trust and gift preferences
all live in the brain — Vite proxies `/brain` to it, so no CORS setup is needed.
Without the brain running the villagers still potter about, they just say nowt.

## Adventures, standing & consequences

Talk to villagers (or read the **parish notice board** on the green, `Q` for your
journal) to pick up ventures: a five-chapter mystery — *T' Hound o' the Mires* —
told across the real landmarks, plus endless errands: riddle treasure hunts,
deliveries, beast bounties, lost lambs, wall-mending and foraging. Villagers
drop **clues in conversation** through the brain's injected quest context — the
kids blurt things out plainly, Granny Glinda speaks in riddles. Your **village
standing** (Newcomer → Treasured) gates bigger quests and barter stock; finishing
jobs raises it, while vandalising the village or killing the flock drops it —
folk turn cold and say so. The finale, at Respected standing, sends you up
Roseberry Topping at night with a forged amulet to face the Great Barghest.

## The land itself

The map echoes the real North York Moors: a high heather plateau cut by dales
(each named — Rosedale, Farndale, Bransdale...), blanket bog and dark pools on
the tops, and the North Sea behind cliffs away to the east. Fixed landmarks to
find: **Roseberry Topping**, **T' Hole of Horcum**, **the Wainstones**,
**Rosedale ironstone kilns**, **Wade's Causey** (the old Roman road), scattered
**moor crosses** (one of them's white — say hello to Fat Betty), and a ruined
**abbey** on the cliff top. The HUD tells you where you are.

## What's in it

- **Infinite procedurally generated moorland** — rolling heather moor, peat bogs, becks and tarns, gritstone tops, underground caves with coal, ironstone and Whitby jet
- **Generated structures** — drystone field walls, ruined farmhouses, ancient stone circles, abandoned quarry workings
- **Full survival loop** — block breaking/placing, tools with durability (wood / gritstone / iron tiers), crafting at t' joiner's bench, smelting and roasting on t' range (fuelled with coal or peat)
- **Health, hunger, drowning, fall damage** — and the bogs will swallow you whole if you're not careful
- **Wildlife** — Swaledale sheep, red grouse and brown hares by day; the barghest and boggarts stalk the moor at night
- **Day/night cycle and weather** — fog rolls in, rain siles down, wind howls over the tops
- **Procedural audio** — curlew calls, grouse going "go-back go-back", bleating yows, and the barghest's howl, all synthesised with WebAudio
- **World saving** — auto-saves to IndexedDB every 30 seconds; carry on where tha left off
- **Creative mode** — fly about and build with infinite blocks (toggle in the pause menu)
- **Minimap, coordinates, day counter** — so tha doesn't get lost in t' fog

## Controls

| Input | Action |
| --- | --- |
| Mouse | Look about |
| Left click | Dig blocks / clout mobs |
| Right click | Place blocks / eat / use bench & range |
| W A S D | Walk |
| Space | Jump / swim up (double-tap to fly in creative) |
| Ctrl | Sprint |
| Shift | Sneak (won't fall off edges) |
| 1–9 / wheel | Hotbar |
| E | Inventory & crafting |
| M | Mute |
| Esc | Pause |

## Tech notes

- Chunked voxel world (16×64×16), streamed around the player with per-frame generation/meshing budgets
- Culled-face meshing with baked per-vertex ambient occlusion; separate opaque / cutout / liquid passes from one procedural texture atlas
- Deterministic seeded value-noise terrain (fBm), 3D noise caves, hash-based ore and structure placement
- Save format: raw chunk bytes + game metadata in IndexedDB
