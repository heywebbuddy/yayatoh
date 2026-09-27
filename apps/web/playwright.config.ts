import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);

/**
 * Accessibility and journey checks at 375 / 768 / 1280 px (roadmap §9 CI gates).
 * Needs a migrated, seeded database and YAYATOH_DEV_AUTH=1 (dev personas).
 * `PW_CHROMIUM_PATH` points at a preinstalled browser when the bundled one isn't available.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    ...(process.env.PW_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } }
      : {}),
  },
  projects: [
    { name: 'mobile-375', use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } } },
    { name: 'tablet-768', use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } } },
    { name: 'desktop-1280', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
  ],
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        // Run next directly (a pnpm wrapper would not forward the stop signal) and bound the
        // shutdown so a lingering connection pool can never hang the run.
        command: `pnpm exec next start -p ${PORT}`,
        port: PORT,
        reuseExistingServer: true,
        timeout: 120_000,
        gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
      },
});
