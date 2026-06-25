// Headless: the pure version-compare + tier-decision helpers from update-check.js.
// No DOM, no fetch (the module guards __APP_VERSION__ with typeof, so importing
// cmp/decideUpdate is safe outside a Vite build). Also checks package.json keeps
// the version fields the update flow depends on.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cmp, decideUpdate } from '../src/update-check.js';

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); n++; };

// ---- cmp: numeric-per-segment semver compare ----
eq(cmp('1.1.0', '1.1.0'), 0, 'equal versions -> 0');
eq(cmp('1.1.0', '1.2.0'), -1, 'older minor -> -1');
eq(cmp('1.2.0', '1.1.0'), 1, 'newer minor -> 1');
// the classic string-sort trap: 1.2.0 < 1.10.0 numerically
eq(cmp('1.2.0', '1.10.0'), -1, '1.2.0 < 1.10.0 (numeric, not lexical)');
eq(cmp('1.10.0', '1.2.0'), 1, '1.10.0 > 1.2.0');
eq(cmp('1.0.9', '1.0.10'), -1, '1.0.9 < 1.0.10 (patch numeric)');
eq(cmp('2.0.0', '1.9.9'), 1, 'major dominates');
// tolerant of segment count + a leading v
eq(cmp('1.1', '1.1.0'), 0, 'missing patch == .0');
eq(cmp('v1.2.0', '1.2.0'), 0, 'leading v ignored');
eq(cmp('1.2.0', '1.2.0.1'), -1, 'extra trailing segment counts');

// ---- decideUpdate: 'force' | 'notify' | 'none' ----
// Silent: running == deployed, and not below the floor.
eq(decideUpdate('1.1.0', { version: '1.1.0', min: '1.1.0' }), 'none', 'same version -> none (silent)');
// Notify: a newer version is live; min still satisfied.
eq(decideUpdate('1.1.0', { version: '1.2.0', min: '1.1.0' }), 'notify', 'newer version, min ok -> notify');
eq(decideUpdate('1.2.0', { version: '1.10.0', min: '1.1.0' }), 'notify', '1.10.0 live over 1.2.0 -> notify');
// Force: running is below the deployed minimum (breaking change). Force beats notify.
eq(decideUpdate('1.1.0', { version: '2.0.0', min: '2.0.0' }), 'force', 'below min -> force (not notify)');
eq(decideUpdate('1.9.0', { version: '2.0.0', min: '1.10.0' }), 'force', '1.9.0 < min 1.10.0 -> force');
// Boundary: exactly at min, version equal -> none; exactly at min, version ahead -> notify.
eq(decideUpdate('2.0.0', { version: '2.0.0', min: '2.0.0' }), 'none', 'exactly at min, current -> none');
eq(decideUpdate('1.10.0', { version: '1.11.0', min: '1.10.0' }), 'notify', 'exactly at min but version ahead -> notify');
// A client AHEAD of the deploy (e.g. mid-rollout cache) must not nag or reload.
eq(decideUpdate('1.3.0', { version: '1.2.0', min: '1.1.0' }), 'none', 'client ahead of deploy -> none');
// min defaults to version when absent.
eq(decideUpdate('1.0.0', { version: '1.5.0' }), 'notify', 'no min field -> falls back to version (notify)');
eq(decideUpdate('1.5.0', { version: '1.5.0' }), 'none', 'no min, equal -> none');
// Malformed / empty payloads are silent (never force a reload on junk).
eq(decideUpdate('1.1.0', null), 'none', 'null info -> none');
eq(decideUpdate('1.1.0', {}), 'none', 'empty info -> none');

// ---- package.json invariants the flow relies on ----
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')
);
ok(typeof pkg.version === 'string' && /^\d+\.\d+/.test(pkg.version), 'package.json has a semver "version"');
ok(typeof pkg.minClientVersion === 'string' && /^\d+\.\d+/.test(pkg.minClientVersion), 'package.json has "minClientVersion"');
// The dev's safety rail: min must never exceed version, or every client force-reloads on deploy.
ok(cmp(pkg.minClientVersion, pkg.version) <= 0, 'minClientVersion <= version (Force stays off until raised deliberately)');

console.log(`verify-update: ${n} assertions OK`);
