// Feedback & bug reports to the parish ledger (POST /dash/feedback).

let _ephemeralPid = null;
export function devicePid() {
  try {
    let pid = localStorage.getItem('moorcraft-pid');
    if (!pid) {
      pid = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
      localStorage.setItem('moorcraft-pid', pid);
    }
    return pid;
  } catch {
    // storage blocked (private mode / cookies off) — stable per-session fallback
    return (_ephemeralPid ||= (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)));
  }
}

/** Snapshot useful context for triage — page, browser, optional in-game state. */
export function gatherContext(game = null, page = 'title') {
  const ctx = {
    page,
    url: location.href,
    ua: navigator.userAgent.slice(0, 240),
  };
  if (game?.world) {
    const p = game.player?.pos;
    ctx.seed = game.seed;
    ctx.day = game.sky?.day;
    ctx.room = game.netRoom || '';
    ctx.creative = !!game.player?.creative;
    ctx.state = game.state || '';
    if (p) {
      ctx.pos = { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) };
      try { ctx.loc = game.world.gen.geo.locationName(p.x, p.z) || ''; } catch { /* offline */ }
    }
  }
  return ctx;
}

// Quiet telemetry for swallowed catch blocks: fire-and-forget, capped per session, and it
// must NEVER throw or change the caller's behaviour — it only makes silent failures visible
// on the parish ledger. Returns true if a report was attempted, false if capped/impossible
// (the return is for the verify script; callers should ignore it).
const QUIET_MAX = 5;
let _quietSent = 0;
export function reportQuiet(tag, err) {
  try {
    if (_quietSent >= QUIET_MAX) return false;
    _quietSent++;
    let msg = 'unknown';
    try { msg = String((err && err.message) || err).slice(0, 300); } catch { /* poisoned error object */ }
    let context = { tag: String(tag || 'untagged') };
    try {
      const game = (typeof window !== 'undefined' && (window.moorstead || null)) || null;
      context = gatherContext(game, 'quiet');
      context.tag = String(tag || 'untagged');
    } catch { /* headless / half-booted — the tag alone still tells the tale */ }
    if (typeof fetch === 'function') {
      // kind 'bug': the ledger only files 'bug' | 'feedback' (owt else is coerced to
      // 'feedback' — dash/app.py:399) — the [quiet:tag] prefix marks these for triage
      fetch('/dash/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pid: devicePid(), kind: 'bug', message: `[quiet:${context.tag}] ${msg}`, email: '', name: '', context }),
      }).catch(() => { /* ledger unreachable — it was only ever best-effort */ });
    }
    return true;
  } catch {
    return false; // telemetry must never make owt worse
  }
}

export async function submitFeedback({ kind, message, email = '', name = '', context = {}, pid = devicePid() }) {
  const res = await fetch('/dash/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pid, kind, message, email, name, context }),
  });
  return res.json();
}
