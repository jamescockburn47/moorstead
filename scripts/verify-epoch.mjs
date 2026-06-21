// World-epoch gate (client) — run wi': node scripts/verify-epoch.mjs
// A warden factory-reset bumps a shared room's epoch on the relay. Each browser
// remembers the epoch it last synced for a room; on connect the relay advertises
// its current epoch and the client decides what it must do so a reset lands for
// everyone, automatically.
import { epochDecision } from '../src/epoch.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// --- a quiet world: the relay's epoch matches what we last saw ---
{
  const d = epochDecision(0, 0, false);
  (d.wipe === false ? ok : bad)('fresh first visit (0/0) does not wipe');
  (d.synced === 0 ? ok : bad)('fresh first visit stays at epoch 0');
  (d.stale === false ? ok : bad)('0/0 is not stale');
}

// --- a reset happened while we were away, and we joined fresh ---
{
  const d = epochDecision(0, 1, false);
  (d.stale === true ? ok : bad)('relay ahead (seen 0, server 1) is stale');
  (d.synced === 1 ? ok : bad)('we adopt the relay epoch (1)');
  (d.wipe === false ? ok : bad)('a FRESH join never reloads — the world is already empty');
}

// --- a reset happened while our tab stayed open: a live reconnect is stale ---
{
  const d = epochDecision(0, 1, true);
  (d.wipe === true ? ok : bad)('a live RECONNECT at a newer epoch must wipe + reload');
  (d.synced === 1 ? ok : bad)('reconnect adopts the relay epoch (1)');
}

// --- already in sync: no action, even on a reconnect (a plain network blip) ---
{
  const d = epochDecision(1, 1, true);
  (d.wipe === false ? ok : bad)('already-synced reconnect (1/1) does not wipe');
  (d.stale === false ? ok : bad)('1/1 is not stale');
}

// --- epochs only ever climb: a client somehow ahead never wipes nor regresses ---
{
  const d = epochDecision(2, 1, true);
  (d.wipe === false ? ok : bad)('client ahead of relay (2/1) never wipes');
  (d.synced === 2 ? ok : bad)('we keep our higher epoch (2), never regress');
}

// --- garbage in (missing / NaN epochs) coerces to 0 and never throws ---
{
  const d = epochDecision(undefined, undefined, false);
  (d.synced === 0 && d.wipe === false ? ok : bad)('undefined epochs coerce to 0');
  const e = epochDecision(NaN, 3, true);
  (e.wipe === true && e.synced === 3 ? ok : bad)('NaN seen coerces to 0; server 3 wipes on reconnect');
}

console.log(failed ? '\nEPOCH: FAIL' : '\nEPOCH: all good');
process.exit(failed ? 1 : 0);
