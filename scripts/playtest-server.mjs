import { createServer, loadConfigFromFile } from 'vite';
import { fileURLToPath } from 'node:url';
import { playtestOptions } from './playtest-options.mjs';

const options = playtestOptions();
const root = fileURLToPath(new URL('../', import.meta.url));
const loaded = await loadConfigFromFile({ command: 'serve', mode: 'playtest' }, undefined, root);
if (!loaded) throw new Error('The game Vite configuration could not be loaded.');

const isolation = {
  name: 'moorstead-playtest-isolation',
  transformIndexHtml: {
    order: 'post',
    handler: html => html.replace(/<script\b[^>]*\bsrc=["']\/@vite\/client["'][^>]*>\s*<\/script>/g, ''),
  },
  configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      res.setHeader('X-Moorstead-Playtest', options.identity);
      const path = new URL(req.url, options.origin).pathname;
      if (path === '/__playtest_health') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ identity: options.identity, mode: 'playtest', offline: true }));
        return;
      }
      // Defence beneath browser routing: this server can never proxy a real service.
      if (/^\/(brain|dash)(\/|$)/.test(path)) {
        res.statusCode = 503;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Live services are disabled in the playtest profile.' }));
        return;
      }
      next();
    });
  },
};

// Spread the loaded config and REPLACE server settings. Vite's recursive merge
// would retain the normal /brain and /dash proxies when given an empty object.
const server = await createServer({
  ...loaded.config,
  root,
  configFile: false,
  mode: 'playtest',
  plugins: [isolation, ...(loaded.config.plugins || [])],
  server: {
    ...loaded.config.server,
    host: options.host,
    port: options.port,
    strictPort: true,
    proxy: {},
    hmr: false,
    open: false,
  },
});

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await server.close();
}
process.once('SIGINT', () => { close().catch(error => { console.error(error); process.exitCode = 1; }); });
process.once('SIGTERM', () => { close().catch(error => { console.error(error); process.exitCode = 1; }); });
await server.listen();
console.log(`Moorstead isolated playtest server: ${options.origin}`);
