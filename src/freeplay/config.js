// One boundary for this edition's fixed routes and client resource budgets.
export const FREEPLAY = Object.freeze({
  room: 'family-freeplay', protocol: 1, seed: 419947177, worldLimit: 8192,
  socket: 'wss://moorstead.sovren.xyz/freeplay/ws', claim: '/dash/auth/freeplay-claim',
  authKey: 'moorstead-freeplay-auth-v1', preferencesKey: 'moorstead-freeplay-preferences-v1',
  packetCells: 512, maxCells: 1000000, maxChunks: 1024, applyCellsPerFrame: 4096,
  maxPendingTransactions: 32,
  connectTimeout: 20000, transferTimeout: 120000, heartbeat: 15000,
});

export function freeplayCredentials(value) {
  return !!value && value.room === FREEPLAY.room && typeof value.acct === 'string'
    && /^[a-zA-Z0-9_-]{1,80}$/.test(value.acct) && typeof value.token === 'string'
    && value.token.length > 10 && value.token.length < 4096
    && typeof value.name === 'string' && value.name.length > 0 && value.name.length <= 24;
}
