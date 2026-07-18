import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Single source of truth for the running version = package.json "version".
// (Read via fs rather than a JSON import so this config works the same on every
// Node version — import assertions for JSON still vary across 18/20/22.)
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')
);
const APP_VERSION = pkg.version;
const MIN_CLIENT_VERSION = pkg.minClientVersion || pkg.version;

// Tiny plugin: drop a fresh version.json into the deploy so a running client can
// fetch it (cache-busted) and compare against its own baked-in __APP_VERSION__.
// { version } drives the Notify toast; { min } drives the Force auto-reload.
function emitVersionJson() {
  return {
    name: 'moorstead-emit-version-json',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version: APP_VERSION, min: MIN_CLIENT_VERSION }),
      });
    },
  };
}

// The PWA offline shell: emit sw.js at build with the hashed bundle baked into its
// precache list, cache name stamped with the version so each deploy rolls the cache.
// Network-only: /brain, /dash (live services) and /version.json (the update check).
// Big public/music files are runtime-cached on first fetch, not precached.
const SW_TEMPLATE = `// Generated at build by vite.config.js — the offline shell. Do not edit by hand.
const CACHE = '__CACHE__';
const PRECACHE = __PRECACHE__;
const NETWORK_ONLY = [/^\\/brain(\\/|$)/, /^\\/dash(\\/|$)/, /^\\/version\\.json$/];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (NETWORK_ONLY.some((rx) => rx.test(url.pathname))) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => {
      const cp = r.clone(); caches.open(CACHE).then((c) => c.put('/index.html', cp)); return r;
    }).catch(() => caches.match('/index.html')));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => {
    if (r.ok && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/music/'))) {
      const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp));
    }
    return r;
  })));
});
`;

function emitServiceWorker() {
  return {
    name: 'moorstead-emit-sw',
    generateBundle(_, bundle) {
      const hashed = Object.keys(bundle).filter((f) => f.startsWith('assets/'));
      const precache = [
        '/', '/index.html', '/about.html', '/about-tabs.js', '/feedback.js',
        '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png',
        ...hashed.map((f) => '/' + f),
      ];
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: SW_TEMPLATE
          .replace('__CACHE__', 'moorstead-v' + APP_VERSION)
          .replace('__PRECACHE__', JSON.stringify(precache)),
      });
    },
  };
}

// Proxy /brain -> the village brain on the EVO (via the public tunnel, same
// route production uses) so dev gets real villagers with no CORS faff.
// Point it at http://127.0.0.1:8000 instead if running yorkshire_bot locally.
export default defineConfig({
  // Bake the build's version into the client so it knows what it's running,
  // with no network call. The update check compares this to a fetched version.json.
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  plugins: [emitVersionJson(), emitServiceWorker()],
  server: {
    // honour an assigned port (preview harness sets PORT); default stays 5173
    port: Number(process.env.PORT) || 5173,
    proxy: {
      '/brain': {
        target: 'https://moorstead.sovren.xyz',
        changeOrigin: true,
        secure: false,
      },
      // ledger pings & login go straight to t' EVO in dev
      // (secure:false because this machine's TLS interception breaks verification)
      '/dash': {
        target: 'https://moorstead.sovren.xyz',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
});
