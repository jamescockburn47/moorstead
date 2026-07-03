# Pub-game engine contract (D4)

Every game engine in `src/games/` is a PURE module — no THREE, no DOM, no game
imports, no unseeded Math.random anywhere (INVARIANTS rule 6). One engine per
file; the table UI and the minimax NPC drive any engine through this interface:

```js
export const GAME_ID = 'merrils';          // matches plan.parlour.tables[i].game
export const GAME_LABEL = 'Merrils';       // display name (period-correct)
export function initState(seed = 0) {}     // → plain-JSON state; seed drives any deal/randomness
export function currentPlayer(state) {}    // → 0 | 1 (0 = the challenger/player)
export function legalMoves(state) {}       // → [move, ...] plain-JSON moves; [] only when game over or blocked
export function applyMove(state, move) {}  // → NEW state (never mutate); throws on illegal move
export function winner(state) {}           // → null (ongoing) | 0 | 1 | 'draw'
export function bestMove(state, level, seed) {} // → a legal move; DETERMINISTIC for (state, level, seed);
                                                // level 1..3 (persona difficulty); seeded tiebreaks only
export function summary(state) {}          // → short human string of the position ("placing: 5 men left…")
```

Rules of the house:
- State and moves must round-trip `JSON.parse(JSON.stringify(x))` unchanged —
  the PvP relay slice serialises them verbatim.
- `applyMove` validates against `legalMoves` (or equivalent logic) and throws
  `Error('illegal move')` — the UI relies on this as the single rules authority.
- Hidden information (dominoes hands) lives IN the state; the UI decides what to
  show. `initState(seed)` must deal identically for the same seed (PvP shares a
  seed).
- `bestMove` may be minimax (merrils/draughts), greedy-with-seeded-tiebreak
  (dominoes), or an aim model (shove ha'penny) — but NEVER unseeded random.
- Each engine ships with `scripts/verify-<game>.mjs` (house ok/bad style):
  determinism, legality (every legalMoves entry applies cleanly; illegal moves
  throw), termination (a seeded bestMove-vs-bestMove self-play game ends within
  a bounded move count), and game-specific rules cases.
