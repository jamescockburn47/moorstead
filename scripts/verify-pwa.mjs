// verify-pwa.mjs — the installable-app shell holds together: manifest parses and
// points at real icons, the icons are honest PNGs at their declared sizes, index.html
// links the manifest, main.js registers the worker (prod-only), and vite.config emits
// an sw.js that leaves /brain, /dash and /version.json to the network and falls back
// to the cached shell for navigations. All source-level — no build needed.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = (p) => fileURLToPath(new URL('../' + p, import.meta.url));
let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'ok' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
};

// --- manifest ---
let manifest = null;
try { manifest = JSON.parse(readFileSync(root('public/manifest.webmanifest'), 'utf8')); } catch { /* caught below */ }
check(!!manifest, 'manifest.webmanifest parses as JSON');
if (manifest) {
  for (const f of ['name', 'short_name', 'start_url', 'display']) check(!!manifest[f], `manifest has ${f}`);
  check(Array.isArray(manifest.icons) && manifest.icons.length >= 2, 'manifest declares >=2 icons');
  check(manifest.icons?.some((i) => /maskable/.test(i.purpose || '')), 'manifest has a maskable icon');
  // --- icons: real PNGs, IHDR dims match the declared sizes ---
  for (const icon of manifest.icons || []) {
    let ok = false;
    try {
      const buf = readFileSync(root('public' + icon.src));
      const sig = buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
      const declared = parseInt(icon.sizes, 10);
      ok = sig && buf.readUInt32BE(16) === declared && buf.readUInt32BE(20) === declared;
    } catch { /* missing file -> fail */ }
    check(ok, `icon ${icon.src} is a PNG at its declared ${icon.sizes}`);
  }
}

// --- index.html links the shell ---
const html = readFileSync(root('index.html'), 'utf8');
check(html.includes('rel="manifest"'), 'index.html links the manifest');
check(html.includes('name="theme-color"'), 'index.html sets theme-color');

// --- registration: present, and prod-gated so dev never caches ---
const main = readFileSync(root('src/main.js'), 'utf8');
const reg = main.match(/import\.meta\.env\.PROD[^\n]*serviceWorker/);
check(!!reg, 'main.js registers the service worker behind import.meta.env.PROD');
check(main.includes("register('/sw.js')"), 'main.js registers /sw.js');

// --- the emitted worker: network-only routes + offline navigation fallback ---
const vite = readFileSync(root('vite.config.js'), 'utf8');
check(vite.includes("fileName: 'sw.js'"), 'vite.config emits sw.js at build');
for (const route of ['brain', 'dash', 'version\\\\.json']) {
  check(vite.includes(route), `sw template leaves /${route.replace(/\\+\./g, '.')} to the network`);
}
check(vite.includes("caches.match('/index.html')"), 'sw template falls back to the cached shell offline');
check(vite.includes('NETWORK_ONLY'), 'sw template gates network-only routes before caching');

if (failures) {
  console.error(`\nverify-pwa: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('verify-pwa: all checks passed');
