// The FACTS CARD — a compact, game-authoritative block prepended to every villager
// chat. Every row is computed from LIVE game state, so the brain can repeat it
// safely: LLM narrates, ledgers decide. The card is deliberately small (the model
// fumbles long context) and the header tells it to prefer these rows to its own
// recollections. Pure formatters only — callers supply plain data.
export const FACTS_CARD_MAX = 700;   // chars — the card must stay a card, not an essay

export function buildFactsCard(f) {
  const rows = [];
  if (f.playerName) rows.push(`The visitor's name is ${String(f.playerName).slice(0, 40)}.`);
  if (f.standing) rows.push(`Their standing hereabouts: ${f.standing}.`);
  if (f.titles && f.titles.length) rows.push(`Honours they carry: ${f.titles.slice(0, 3).join(', ')}.`);
  for (const t of f.trainRows || []) rows.push(t);
  for (const m of f.marketRows || []) rows.push(m);
  if (!rows.length) return '';
  let card = 'GAME FACTS (all true right now — trust these over anything you remember; '
           + 'weave them in naturally, never recite the list):\n- ' + rows.join('\n- ');
  if (card.length > FACTS_CARD_MAX) card = card.slice(0, FACTS_CARD_MAX);
  return card;
}

// True next-train lines for a station, from the live deterministic timetable
// (deps = [{dest, eta, dist}] as main.js nextDeparturesAt returns). One compact
// line; no departures -> no line, so a time is never invented.
export function trainLines(station, deps) {
  const good = (deps || []).filter(d => d && d.dest && Number.isFinite(d.eta));
  if (!good.length) return [];
  const fmt = s => { if (s <= 60) return 'due now'; const m = Math.round(s / 60); return `in ${m} minute${m === 1 ? '' : 's'}`; };
  const parts = good.slice(0, 2).map(d => `${d.dest} ${fmt(d.eta)}`);
  return [`Next trains from ${station}: ${parts.join(', then ')}. You may tell the visitor these times.`];
}
