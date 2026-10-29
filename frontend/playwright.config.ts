import { defineConfig } from '@playwright/test';

/**
 * End-to-end UI tests. They drive the real dashboard in a real browser against a RUNNING backend (the one that serves
 * the built frontend), so start it first (the "NTRX AppOps" scheduled task, or `npm start` in /backend) and build the
 * frontend (`npm run build`). No browser download is needed: tests use the Edge / Chrome already installed.
 *
 *   npm run e2e              run everything (headless)
 *   npm run e2e:headed       watch it run
 *   E2E_URL=http://host:3001 npm run e2e      another address
 *   E2E_BROWSER=chrome npm run e2e            use Chrome instead of Edge
 *   E2E_EXECUTABLE=/path/to/chrome-headless-shell npm run e2e   use that browser build
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_URL ?? 'http://localhost:3001',
    // E2E_EXECUTABLE=<path to a chromium / chrome-headless-shell> overrides the installed Edge / Chrome (for machines where a
    // browser policy stops Edge / Chrome from being remote-controlled)
    channel: process.env.E2E_EXECUTABLE ? undefined : (process.env.E2E_BROWSER ?? 'msedge'),
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'], executablePath: process.env.E2E_EXECUTABLE || undefined },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
