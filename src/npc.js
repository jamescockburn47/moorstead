// Client for t' Moorstead village brain (yorkshire_bot — FastAPI + Ollama,
// proxied at /brain by Vite). All calls are best-effort: the game must keep
// working when the brain's not running.

const BASE = '/brain';

async function req(path, opts = {}, timeoutMs = 90000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(BASE + path, { ...opts, signal: ctrl.signal });
    if (!res.ok) throw new Error('brain ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export async function brainOnline() {
  try {
    const s = await req('/status', {}, 3000);
    return s && (s.status === 'ok' || s.status === 'online');
  } catch {
    return false;
  }
}

// -> [{id, name}] or null when offline. Generous timeout: t' first request
// through a cold Cloudflare tunnel can dawdle.
export async function fetchRoster() {
  try {
    const data = await req('/api/characters', {}, 12000);
    return data.characters || data || null;
  } catch {
    return null;
  }
}

// -> {reply, character, trust, tier, events} (throws when offline)
// context: optional situational knowledge (quests, clues) injected into t' prompt
export function talk(characterId, message, playerName, playerId, context) {
  return req('/api/talk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      character_id: characterId,
      message,
      player_name: playerName || null,
      player_id: playerId || null,
      context: context || null,
    }),
  });
}

// -> {total_trust, standing, next_threshold, progress, villagers}
export function standing(playerId) {
  return req('/api/standing?player_id=' + encodeURIComponent(playerId || ''), {}, 8000);
}

// -> {character, trust, tier}. With an item: valued by t' character's gift
// prefs. Without: a straight trust bump o' `amount` (quest rewards).
export function gift(characterId, item, playerId, amount) {
  return req('/api/gift', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      character_id: characterId,
      item: item || null,
      amount: amount || null,
      player_id: playerId || null,
    }),
  }, 10000);
}

// Fallback roster so Moorstead in't a ghost town when t' brain is down.
// Names mirror yorkshire_bot/characters.json; ids null = offline (no chat).
export const FALLBACK_ROSTER = [
  { id: null, name: 'farmer james' },
  { id: null, name: 'granny glinda' },
  { id: null, name: 'farmer harry' },
  { id: null, name: 'karen' },
  { id: null, name: 'cc' },
  { id: null, name: 'max' },
];
