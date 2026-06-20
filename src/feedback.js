// Feedback & bug reports to the parish ledger (POST /dash/feedback).

export function devicePid() {
  let pid = localStorage.getItem('moorcraft-pid');
  if (!pid) {
    pid = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
    localStorage.setItem('moorcraft-pid', pid);
  }
  return pid;
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

export async function submitFeedback({ kind, message, email = '', name = '', context = {}, pid = devicePid() }) {
  const res = await fetch('/dash/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pid, kind, message, email, name, context }),
  });
  return res.json();
}
