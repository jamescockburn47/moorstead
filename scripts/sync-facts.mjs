// Generate clint-body/game-facts.json from src/game-facts.js so Merlin's Python
// brain reads the SAME corpus the game client uses. src/game-facts.js is the
// single source of truth; run this after editing it. verify-facts.mjs checks the
// two are in sync (a drift guard), so a forgotten re-run is caught by the suite.
import { writeFileSync } from 'fs';
import { GAME_FACTS } from '../src/game-facts.js';

const target = new URL('../clint-body/game-facts.json', import.meta.url);
writeFileSync(target, JSON.stringify(GAME_FACTS, null, 2) + '\n');
console.log(`wrote clint-body/game-facts.json (${GAME_FACTS.length} facts)`);
