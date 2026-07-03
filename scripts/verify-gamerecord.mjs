// Pub-games ledger check — run wi': node scripts/verify-gamerecord.mjs
//
// Covers Task A of docs/superpowers/plans/2026-07-04-tavern-d4-games.md:
// the additive player.gameRecord field (serialize/deserialize round-trip),
// the pure recordGameResult/gameStatsRows/wagerAllowed helpers in ledgers.js.
import { Player } from '../src/player.js';
import { recordGameResult, gameStatsRows, wagerAllowed, WAGER_MAX } from '../src/ledgers.js';
import { formatBrass } from '../src/economy.js';

let failed = false;
const ok  = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const check = (c, m) => (c ? ok(m) : bad(m));

const stub = { getBlock() { return 0; }, isLoaded() { return true; } };

// --- fresh player: gameRecord shape ---
{
  const p = new Player(stub);
  check(!!p.gameRecord, 'a fresh player has a gameRecord');
  check(JSON.stringify(p.gameRecord.games) === '{}', 'games map starts empty');
  check(p.gameRecord.biggestWin === 0, 'biggestWin starts at zero');
}

// --- serialize/deserialize round-trip (additive save protocol) ---
{
  const p = new Player(stub);
  recordGameResult(p.gameRecord, 'merrils', 'w', 8);
  recordGameResult(p.gameRecord, 'merrils', 'l');
  recordGameResult(p.gameRecord, 'draughts', 'd');
  const saved = p.serialize();
  check(!!saved.gameRecord, 'serialize writes gameRecord');
  check(saved.gameRecord.games.merrils.w === 1 && saved.gameRecord.games.merrils.l === 1, 'serialize preserves per-game counts');
  check(saved.gameRecord.biggestWin === 8, 'serialize preserves biggestWin');

  const p2 = new Player(stub);
  p2.deserialize(saved);
  check(p2.gameRecord.games.merrils.w === 1 && p2.gameRecord.games.merrils.l === 1, 'deserialize restores per-game counts');
  check(p2.gameRecord.games.draughts.d === 1, 'deserialize restores draws');
  check(p2.gameRecord.biggestWin === 8, 'deserialize restores biggestWin');
}

// --- old save (no gameRecord) migrates cleanly — additive protocol ---
{
  const p3 = new Player(stub);
  p3.deserialize({ pos: { x: 0, y: 0, z: 0 } });
  check(!!p3.gameRecord && JSON.stringify(p3.gameRecord.games) === '{}' && p3.gameRecord.biggestWin === 0,
    'an old save without gameRecord migrates to an empty ledger');
}

// --- recordGameResult: accumulation across games/results ---
{
  const rec = { games: {}, biggestWin: 0 };
  recordGameResult(rec, 'merrils', 'w', 4);
  recordGameResult(rec, 'merrils', 'w', 2);
  recordGameResult(rec, 'merrils', 'l');
  recordGameResult(rec, 'dominoes', 'd');
  check(rec.games.merrils.w === 2 && rec.games.merrils.l === 1 && rec.games.merrils.d === 0, 'merrils tally accumulates w/l');
  check(rec.games.dominoes.d === 1, 'a new gameId is lazily created');
  check(rec.biggestWin === 4, 'biggestWin holds the largest single win so far');
}

// --- biggestWin is monotonic (never decreases on a smaller win) ---
{
  const rec = { games: {}, biggestWin: 0 };
  recordGameResult(rec, 'shoveha', 'w', 10);
  recordGameResult(rec, 'shoveha', 'w', 3);
  check(rec.biggestWin === 10, 'a smaller subsequent win does not lower biggestWin');
  recordGameResult(rec, 'shoveha', 'w', 12);
  check(rec.biggestWin === 12, 'a larger subsequent win raises biggestWin');
  recordGameResult(rec, 'shoveha', 'l');
  check(rec.biggestWin === 12, 'a loss (no wagerWon) never lowers biggestWin');
}

// --- recordGameResult returns the mutated record ---
{
  const rec = { games: {}, biggestWin: 0 };
  const ret = recordGameResult(rec, 'merrils', 'w', 5);
  check(ret === rec, 'recordGameResult returns the same record it mutated');
}

// --- gameStatsRows: wording + empty record ---
{
  check(JSON.stringify(gameStatsRows({ games: {}, biggestWin: 0 })) === '[]', 'an empty record yields no rows');
  check(JSON.stringify(gameStatsRows({})) === '[]', 'a bare-empty-object record yields no rows (defensive)');

  const rec = { games: {}, biggestWin: 0 };
  recordGameResult(rec, 'merrils', 'w', 8);
  recordGameResult(rec, 'merrils', 'w', 4);
  recordGameResult(rec, 'merrils', 'l');
  const rows = gameStatsRows(rec);
  check(rows.some(r => r === "At t' tables they've won 2 an' lost 1 at merrils."), `merrils row reads correctly (got ${JSON.stringify(rows)})`);
  check(rows.some(r => r === "Biggest wager won at t' tables: 8d."), `biggest-win row uses the default formatter (got ${JSON.stringify(rows)})`);

  recordGameResult(rec, 'draughts', 'd');
  const rows2 = gameStatsRows(rec);
  check(rows2.some(r => r === "At t' tables they've won 0 an' lost 0 at draughts, wi' 1 drawn."), `a draws-only game reports the draw clause (got ${JSON.stringify(rows2)})`);

  // a game entry with zero plays (defensive shape) never produces a row
  const rec2 = { games: { merrils: { w: 0, l: 0, d: 0 } }, biggestWin: 0 };
  check(JSON.stringify(gameStatsRows(rec2)) === '[]', 'a zero-play game entry is skipped');
}

// --- gameStatsRows: accepts economy.formatBrass as the formatter (£sd) ---
{
  const rec = { games: {}, biggestWin: 0 };
  recordGameResult(rec, 'merrils', 'w', 18);
  const rows = gameStatsRows(rec, formatBrass);
  check(rows.some(r => r === 'Biggest wager won at t\' tables: 1s 6d.'), `formatBrass formatter produces £sd (got ${JSON.stringify(rows)})`);
}

// --- wagerAllowed: bounds ---
{
  check(wagerAllowed(60, 0) === true, '0 (friendly) is always allowed');
  check(wagerAllowed(60, WAGER_MAX) === true, 'exactly WAGER_MAX is allowed');
  check(WAGER_MAX === 12, 'WAGER_MAX is a shilling (12d)');
  check(wagerAllowed(60, 13) === false, 'above WAGER_MAX is refused');
  check(wagerAllowed(5, 8) === false, 'a wager the player cannot cover is refused');
  check(wagerAllowed(8, 8) === true, 'a wager exactly equal to brass on hand is allowed');
  check(wagerAllowed(60, -1) === false, 'a negative wager is refused');
  check(wagerAllowed(60, 2.5) === false, 'a fractional wager is refused');
  // James's explicit call: bairns wager too — wagerAllowed itself takes no
  // freeWorld/world-kind parameter at all, so it structurally cannot gate on it.
  check(wagerAllowed.length === 2, 'wagerAllowed takes only (brass, wager) — no freeWorld parameter to gate on');
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
