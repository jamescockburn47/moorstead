import { defineConfig } from 'vite';

// Proxy /brain -> the village brain on the EVO (via the public tunnel, same
// route production uses) so dev gets real villagers with no CORS faff.
// Point it at http://127.0.0.1:8000 instead if running yorkshire_bot locally.
export default defineConfig({
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
