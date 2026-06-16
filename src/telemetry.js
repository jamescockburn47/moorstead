// Client-side bug-capture telemetry for Moorstead.
// Sends a compact error report over the existing multiplayer WebSocket.
// The relay drops non-"save" messages >600 chars, so we truncate hard:
//   message  → 200 chars
//   stack    → 300 chars
//   lookingAt → 60 chars
// Throttle: at most 1 report per 5 s; dedupe: skip identical message text
// within 60 s. Everything is wrapped in try/catch — this must never throw,
// never block rendering, never interfere with the game.

const THROTTLE_MS = 5_000;
const DEDUPE_MS   = 60_000;
const MAX_MSG     = 200;
const MAX_STACK   = 300;
const MAX_AT      = 60;

function trunc(s, n) {
  if (!s) return '';
  s = String(s);
  return s.length <= n ? s : s.slice(0, n - 1) + '…'; // …
}

export function initTelemetry(getNet, getDebug) {
  // getNet   : () => Net instance or null — called at report time
  // getDebug : () => game.debug or null  — called at report time

  let lastSentAt = 0;
  const recentMessages = new Map(); // message text → timestamp

  function sendReport(message, stack) {
    try {
      const now = Date.now();

      // throttle: max 1 per THROTTLE_MS
      if (now - lastSentAt < THROTTLE_MS) return;

      // dedupe: identical message within DEDUPE_MS
      const clean = trunc(message, MAX_MSG);
      const prev = recentMessages.get(clean);
      if (prev && (now - prev) < DEDUPE_MS) return;

      // gather lookingAt cheaply — best-effort, silent on failure
      let lookingAt = '';
      try {
        const dbg = getDebug && getDebug();
        if (dbg && typeof dbg.lookingAt === 'function') {
          const hit = dbg.lookingAt(12); // short ray — just nearby context
          if (hit && hit.name) lookingAt = hit.name;
        }
      } catch { /* ignore */ }

      const payload = JSON.stringify({
        type: 'error',
        message: clean,
        stack: trunc(stack, MAX_STACK),
        lookingAt: trunc(lookingAt, MAX_AT),
      });

      // Guard: relay drops >600 chars; this should never happen given the
      // truncation above, but double-check before sending.
      if (payload.length > 590) return;

      const net = getNet && getNet();
      if (!net) return; // not yet connected — silently drop

      // Net.send() already guards: connected && readyState === 1
      net.send({ type: 'error', message: clean, stack: trunc(stack, MAX_STACK), lookingAt: trunc(lookingAt, MAX_AT) });

      lastSentAt = now;
      recentMessages.set(clean, now);

      // evict stale dedupe entries so the map doesn't grow forever
      for (const [k, t] of recentMessages) {
        if (now - t > DEDUPE_MS) recentMessages.delete(k);
      }
    } catch { /* telemetry must never throw */ }
  }

  try {
    window.addEventListener('error', ev => {
      try {
        sendReport(
          (ev.error && ev.error.message) || ev.message || 'unknown error',
          (ev.error && ev.error.stack) || ''
        );
      } catch { /* ignore */ }
    });

    window.addEventListener('unhandledrejection', ev => {
      try {
        const r = ev.reason;
        sendReport(
          (r && r.message) || String(r) || 'unhandled rejection',
          (r && r.stack) || ''
        );
      } catch { /* ignore */ }
    });
  } catch { /* if addEventListener itself fails, swallow it */ }
}
