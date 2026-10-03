import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { frontDoorEnv, legacyStubServer } from './e2e/front-door-env.ts';

const PORT = Number(process.env.E2E_PORT ?? 3100);
/** Lighthouse specs (M4.7a): their own project, run alone (see `projects`). */
const LIGHTHOUSE = /-lighthouse\.spec\.ts$/;
/**
 * Idle keep-alive sockets stay open this long (batch 3d root cause of the ECONNRESET flakes, CI runs
 * 36573133566 and 36597004367). Node closes an idle keep-alive socket after `keepAliveTimeout`
 * (5 s, plus Node 24's 1 s buffer); Playwright's request agent keeps sockets with no idle limit of
 * its own, so a `page.request` call sent as the server closes its socket (easier under CI load, when
 * the runner's event loop is late to see the FIN) is reset. Here the server outlives any test, so
 * the client always closes first.
 */
const KEEP_ALIVE_MS = 600_000;

/**
 * Accessibility and journey checks at 375 / 768 / 1280 px (roadmap §9 CI gates).
 * Needs a migrated, seeded database and YAYATOH_DEV_AUTH=1 (dev personas).
 * `PW_CHROMIUM_PATH` points at a preinstalled browser when the bundled one isn't available.
 */
export default defineConfig({
  testDir: './e2e',
  // Migrates the synthetic legacy dataset (M2.2b) the legacy-migration spec checks.
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  // The JSON report (with each test's axe summary) feeds the evidence workflow's VPAT draft (M5.11a).
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }], ['json', { outputFile: 'e2e-results/results.json' }]]
    : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    launchOptions: {
      // Tenant hosts (M1.11): `{org}.yayatoh.events` and test custom domains resolve to this
      // server (`*.localhost` already does), so host routing runs exactly as in production. A
      // preview host (`*.vercel.app`) and the dashboard host too, for the noindex guard (M1.11d).
      args: [
        '--host-resolver-rules=MAP *.yayatoh.events 127.0.0.1, MAP *.verified.test 127.0.0.1, MAP *.vercel.app 127.0.0.1, MAP app.yayatoh.com 127.0.0.1',
      ],
      ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
    },
  },
  projects: [
    {
      name: 'mobile-375',
      testIgnore: LIGHTHOUSE,
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
    },
    {
      name: 'tablet-768',
      testIgnore: LIGHTHOUSE,
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
    },
    {
      name: 'desktop-1280',
      testIgnore: LIGHTHOUSE,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    // M4.7a: Lighthouse audits time the CPU, so they run alone, never beside the suite:
    // `pnpm --filter @yayatoh/web e2e:lighthouse` (CI: after shard 5's suite). Lighthouse emulates
    // the phone itself.
    ...(process.env.E2E_LIGHTHOUSE ? [{ name: 'lighthouse', testMatch: LIGHTHOUSE }] : []),
  ],
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : [
        // M2.4a: the stand-in legacy origins the front-door hosts forward to.
        legacyStubServer(fileURLToPath(new URL('.', import.meta.url))),
        {
          // Run next directly (a pnpm wrapper would not forward the stop signal) and bound the
          // shutdown so a lingering connection pool can never hang the run.
          command: `pnpm exec next start -p ${PORT} --keepAliveTimeout ${KEEP_ALIVE_MS}`,
          port: PORT,
          reuseExistingServer: true,
          timeout: 120_000,
          gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
          // M1.4g: the marketplace's own /blogs and /pages show this org's content (the platform
          // content org in production); the e2e uses a seeded org.
          env: {
            MARKETPLACE_CONTENT_ORG: process.env.MARKETPLACE_CONTENT_ORG ?? 'harbor-arts',
            // M6.6a: subscription billing switched on with the fake provider, so the plan spec can
            // simulate a plan change through the webhook. It applies only to orgs with a billing
            // customer (none of the seeded ones), so every other spec runs as with billing off.
            BILLING_ENABLED: '1',
            // M6.8a: agency v2 money (flag `agency_v2`); it applies only to agency orgs whose
            // clients accept an offer, which only the agency-money spec makes.
            AGENCY_V2_ENABLED: '1',
            ...frontDoorEnv,
          },
        },
      ],
});
