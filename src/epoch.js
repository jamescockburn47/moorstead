// World-epoch gate (client side).
//
// A warden factory-reset of a shared room bumps that room's *epoch* on the relay.
// Every browser remembers the epoch it last synced for a room (localStorage); on
// each connect the relay advertises its current epoch in the `init` message. This
// pure decision keeps a server reset authoritative for everyone, automatically.
//
//   seen        — the epoch this browser last synced for the room (0 if never)
//   server      — the epoch the relay just advertised
//   isReconnect — true when this is a live reconnect (a tab left open across the
//                 reset), which still holds stale in-memory edits + pocket that
//                 would otherwise re-seed the freshly wiped relay
//
// A FRESH join needs no wipe — joinShared already builds an empty world + a bare
// player, so adopting the new epoch is enough. Only a live reconnect must drop its
// stale state, which the caller does with the bluntest reliable tool: a reload to
// a clean join. Epochs only ever climb, so we never regress `synced`.
function num(v) { return Number.isFinite(+v) ? +v : 0; }

export function epochDecision(seen, server, isReconnect) {
  const s = num(seen), v = num(server);
  const stale = v > s;
  return {
    synced: Math.max(s, v),
    wipe: stale && !!isReconnect,
    stale,
  };
}
