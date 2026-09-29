import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { frontDoorEnv, legacyStubServer } from '../web/e2e/front-door-env.ts';

const PORT = Number(process.env.E2E_ADMIN_PORT ?? 3101);
const WEB_PORT = Number(process.env.E2E_PORT ?? 3100);

/**
 * Staff console journeys (M1.3e). Needs the seeded database, the staff persona made staff with
 * the worker CLI, and DEV_PERSONA_PASSWORD. Also starts the web app (the public page must show a
 * pause). Run after the web suite: pausing checkout affects the shared seed org.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    launchOptions: {
      // Tenant sites (M1.11) resolve to the web server, as in apps/web/playwright.config.ts.
      args: ['--host-resolver-rules=MAP *.yayatoh.events 127.0.0.1, MAP *.verified.test 127.0.0.1'],
      ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
    },
  },
  projects: [
    { name: 'desktop-1280', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
    { name: 'mobile-375', use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } } },
  ],
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : [
        {
          command: `pnpm exec next start -p ${PORT}`,
          port: PORT,
          reuseExistingServer: true,
          timeout: 120_000,
          gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
          // The console lists the same front-door hosts as the web server forwards (M2.4a).
          env: { ADMIN_AUTH_URL: `http://localhost:${PORT}`, ...frontDoorEnv },
        },
        {
          command: `pnpm --dir ../web exec next start -p ${WEB_PORT}`,
          port: WEB_PORT,
          reuseExistingServer: true,
          timeout: 120_000,
          gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
          // M2.4a: the front-door hosts, as in apps/web/playwright.config.ts.
          env: frontDoorEnv,
        },
        legacyStubServer(fileURLToPath(new URL('../web/', import.meta.url))),
      ],
});
