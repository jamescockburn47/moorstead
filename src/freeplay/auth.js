import { FREEPLAY, freeplayCredentials } from './config.js';

export function storedLogin(storage) {
  const text = storage.getItem(FREEPLAY.authKey);
  if (!text) return null;
  try {
    const value = JSON.parse(text);
    return freeplayCredentials(value) ? value : null;
  } catch { return null; } // Malformed optional local login confers no authority.
}

export async function claimFreeplay(code, name, { fetcher = fetch, storage = localStorage } = {}) {
  code = code.trim().toLowerCase(); name = name.trim();
  if (!code || code.length > 160 || !name || name.length > 24) throw new Error('Enter thi name and free-play code.');
  const response = await fetcher(FREEPLAY.claim, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, name, pid: 'freeplay-' + crypto.randomUUID() }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error('The parish clerk could not check thi code. Try again.');
  const value = await response.json();
  if (!value.ok) throw new Error('That code was not accepted. Check thi free-play code.');
  if (value.edition !== 'freeplay' || !freeplayCredentials(value)) throw new Error('This code is for another world. Use thi new free-play code.');
  const auth = { acct: value.acct, token: value.token, room: value.room, name: value.name };
  storage.setItem(FREEPLAY.authKey, JSON.stringify(auth));
  return auth;
}

export function forgetFreeplay(storage = localStorage) { storage.removeItem(FREEPLAY.authKey); }
