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

// Proxy /brain -> the village brain on the EVO (via the public tunnel, same
// route production uses) so dev gets real villagers with no CORS faff.
// Point it at http://127.0.0.1:8000 instead if running yorkshire_bot locally.
export default defineConfig({
  // Bake the build's version into the client so it knows what it's running,
  // with no network call. The update check compares this to a fetched version.json.
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  plugins: [emitVersionJson()],
  server: {
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
