// Client version-check + in-app update prompt.
//
// One source of truth: package.json "version" (semver). The build bakes that into
// the client as __APP_VERSION__ (see vite.config.js `define`) and emits a fresh
// version.json into the deploy ({ version, min }). A running client fetches
// version.json (cache-busted) and compares it against its own baked version:
//
//   Silent  — versions match: do nothing. (A routine deploy that did NOT bump
//             "version" is invisible; users still pick up the new code on their
//             next natural reload, because index.html revalidates + assets are
//             hash-busted. This is the whole point — little changes mustn't nag.)
//   Notify  — deployed version is AHEAD of ours: a dismissible toast ("a new
//             version is ready — tap to reload"); tap → location.reload().
//   Force   — our version is BELOW the deployed `min`: a brief "updating…" notice
//             then an automatic location.reload(), for breaking changes only.
//
// The toast reuses the game's native toast UX (game.ui.toast) and the same
// reload-on-change pattern as the shared-moor epoch reset (see multiplayer.js).

// Baked at build time by Vite's define. Guarded with typeof so this module is
// also importable headless (the verify script imports cmp/decideUpdate, where
// __APP_VERSION__ is not defined).
const RUNNING = (typeof __APP_VERSION__ !== 'undefined') ? __APP_VERSION__ : '0.0.0';

// Semver compare: -1 if a<b, 0 if equal, 1 if a>b. Numeric per dotted segment
// (so 1.10.0 > 1.2.0), tolerant of differing segment counts and a leading 'v'.
export function cmp(a, b) {
  const parse = (s) => String(s).trim().replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pa = parse(a), pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

// Pure tier decision (no DOM, no fetch) so it can be unit-tested.
//   running — the client's baked version
//   info    — { version, min } parsed from version.json
// → 'force' | 'notify' | 'none'
export function decideUpdate(running, info) {
  if (!info || typeof info !== 'object') return 'none';
  // Force: we're below the explicit floor the deploy demands (breaking change).
  // Only an explicit `min` forces a reload — a missing min is never a hard floor,
  // it just means "no breaking change", so we fall through to the Notify check.
  if (info.min && cmp(running, info.min) < 0) return 'force';
  // Notify: a newer version is live than the one we're running.
  if (info.version && cmp(running, info.version) < 0) return 'notify';
  return 'none';
}

// Wire the live check onto a game instance. Idempotent; safe to call once at boot.
export function startUpdateCheck(game) {
  if (!game || game._updateCheck) return;
  const state = { running: RUNNING, notified: false, forcing: false, checking: false };
  game._updateCheck = state;

  const reload = () => { try { location.reload(); } catch { /* nowt to do */ } };

  const onForce = () => {
    if (state.forcing) return;
    state.forcing = true;
    // Brief notice, then auto-reload — same UX as the epoch world-reset (multiplayer.js).
    game.ui?.toast('Moorstead has updated — reloading…', 6000);
    setTimeout(reload, 2000);
  };

  const onNotify = () => {
    if (state.notified || state.forcing) return; // once per session; don't re-spam
    state.notified = true;
    // A tappable toast. Reuses the toast box/styling; the .update-toast class adds
    // the tap affordance. Tap reloads; the × dismisses for the rest of the session.
    if (!game.ui) return;
    const html = '<span class="update-msg">A new version of Moorstead is ready — '
      + '<b>tap to reload</b></span><button class="update-x" aria-label="Dismiss">×</button>';
    const t = game.ui.el('div', 'toast update-toast', game.ui.toastBox, html);
    const close = t.querySelector('.update-x');
    if (close) close.onclick = (e) => { e.stopPropagation(); t.remove(); };
    t.onclick = reload;
    while (game.ui.toastBox.children.length > 4) game.ui.toastBox.firstChild.remove();
  };

  const check = async () => {
    if (state.checking || state.forcing) return; // no overlap; once forcing, we're done
    state.checking = true;
    try {
      const res = await fetch('/version.json?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return; // 404 on the dev server (no version.json emitted) — stay silent
      const info = await res.json();
      const tier = decideUpdate(state.running, info);
      if (tier === 'force') onForce();
      else if (tier === 'notify') onNotify();
    } catch { /* network blip / offline / bad JSON — silent, try again next tick */ }
    finally { state.checking = false; }
  };

  // Check when the tab comes back to the foreground (a backgrounded tab is the
  // commonest stale client) and on a slow heartbeat (~15 min) for tabs left open.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  }
  state.timer = setInterval(check, 15 * 60 * 1000);

  // A first check shortly after boot, so an already-stale open tab learns quickly
  // without racing the rest of start-up.
  setTimeout(check, 8000);

  return state;
}
