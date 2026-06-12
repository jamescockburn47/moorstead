import { defineConfig } from 'vite';

// Proxy /brain -> the local Moorstead village brain (yorkshire_bot, FastAPI :8000)
// so the browser game can talk to it same-origin with no CORS faff.
export default defineConfig({
  server: {
    proxy: {
      '/brain': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: p => p.replace(/^\/brain/, ''),
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
});
