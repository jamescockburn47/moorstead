// Client for t' Moorstead village brain (yorkshire_bot — FastAPI + Ollama,
// proxied at /brain by Vite). All calls are best-effort: the game must keep
// working when the brain's not running.

import { factsContext, villagerAffinity } from './facts.js';

const BASE = '/brain';

// Fold any game facts relevant to the player's message into the situational
// context. Best-effort and fail-safe: a bad lookup must never break a chat call,
// and the facts ride in as reference — the brain's persona keeps the NPC in voice.
function withFacts(message, context, affinity) {
  try {
    const block = factsContext(message, { affinity: affinity || [] });
    return [context, block].filter(Boolean).join('\n\n') || null;
  } catch {
    return context || null;
  }
}

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

// Phase B.1: the living-roster sim's logical state (or null if the brain's offline).
export async function rosterState() {
  try {
    return await req('/api/roster/state', {}, 8000);   // { seq, now, npcs:[...] }
  } catch {
    return null;   // degrade silently — the client falls back to the scripted crowd
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
      context: withFacts(message, context),
    }),
  });
}

// -> {reply, name} (throws when offline). A stateless "passer-by" voice for
// villagers with no brain character of their own — full AI dialogue, but no
// stored memory or trust. The persona (name/role/village/mood) is sent each call.
export function talkGeneric(persona, message, playerName, context) {
  return req('/api/talk/generic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: persona.name,
      role: persona.role || null,
      village: persona.village || null,
      mood: persona.mood || null,
      message,
      player_name: playerName || null,
      context: withFacts(message, context, villagerAffinity(persona.name, persona.village)),
    }),
  });
}

// Tell the brain about a completed trade so the vendor remembers the specific
// deal and can bring it up later. Best-effort, fire-and-forget: a failure here
// must never affect the trade the player just made.
export function trade(characterId, item, qty, direction, playerId) {
  return req('/api/trade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      character_id: characterId,
      item: item || '',
      qty: qty || 1,
      direction: direction || 'sell',
      player_id: playerId || null,
    }),
  }, 8000).catch(() => null);
}

// -> {issue, date, headline, stories:[{title,body}], notices:[string], generatedAt}
// or null when t' brain's down. This week's paper is cached brain-side; the FIRST
// hit of a fresh week pays the printing (~15s of LLM), hence the long timeout.
export async function gazette() {
  try {
    return await req('/api/gazette', {}, 20000);
  } catch {
    return null;   // t' Gazette's not come up frae t' printers — the board shows a kind line
  }
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

// Fallback roster so t' moors aren't a ghost land when t' brain is down.
// Names an' villages mirror yorkshire_bot/characters.json; ids null = offline (no chat).
export const FALLBACK_ROSTER = [
  { id: null, name: 'farmer james', village: 'Moorstead' },
  { id: null, name: 'granny glinda', village: 'Moorstead' },
  { id: null, name: 'farmer harry', village: 'Moorstead' },
  { id: null, name: 'karen', village: 'Moorstead' },
  { id: null, name: 'cc', village: 'Moorstead' },
  { id: null, name: 'max', village: 'Moorstead' },
  { id: null, name: 'stationmaster briggs', village: 'Goathland' },
  { id: null, name: 'tilly', village: 'Goathland' },
  { id: null, name: 'innkeeper martha', village: 'Rosedale Abbey' },
  { id: null, name: 'owd tom', village: 'Rosedale Abbey' },
  { id: null, name: 'fisherman ned', village: 'Staithes' },
  { id: null, name: 'beck', village: 'Staithes' },
  { id: null, name: 'vicar ambrose', village: 'Pickering' },
  { id: null, name: 'market mag', village: 'Pickering' },
  { id: null, name: 'driver wassell', village: 'Grosmont' },
  { id: null, name: 'fireman joe', village: 'Grosmont' },
  { id: null, name: 'fishwife annie', village: 'Whitby' },
  { id: null, name: 'silas', village: 'Whitby' },
];
