import { defineConfig } from '@playwright/test';
import { playtestOptions, freeplayFixtureOptions } from './scripts/playtest-options.mjs';

const options = playtestOptions();
const freeplay = freeplayFixtureOptions();

export default defineConfig({
  testDir: './tests/game',
  testMatch: '**/*.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 90_000,
  globalTimeout: 600_000,
  expect: { timeout: 8_000 },
  outputDir: './tests/.artifacts/output',
  reporter: [
    ['line'],
    ['html', { outputFolder: 'tests/.artifacts/report', open: 'never' }],
    ['json', { outputFile: 'tests/.artifacts/results.json' }],
  ],
  use: {
    baseURL: options.origin,
    browserName: 'chromium',
    headless: true,
    viewport: { width: 960, height: 600 },
    deviceScaleFactor: 1,
    serviceWorkers: 'block',
    reducedMotion: 'reduce',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    launchOptions: {
      chromiumSandbox: true,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
    screenshot: 'only-on-failure',
    video: 'off',
    trace: { mode: 'retain-on-failure', screenshots: false, snapshots: true, sources: false },
  },
  webServer: [{
    command: 'node scripts/playtest-server.mjs',
    url: `${options.origin}/__playtest_health`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  }, {
    command: `node scripts/export-freeplay-battlefield.mjs tests/.artifacts/battlefield && python deploy/free-play/fixture.py --port ${freeplay.port} --battlefield tests/.artifacts/battlefield/battlefield.json`,
    url: `${freeplay.origin}/openapi.json`,
    reuseExistingServer: false,
    timeout: 30000,
    stdout: 'pipe', stderr: 'pipe',
  }],
});
