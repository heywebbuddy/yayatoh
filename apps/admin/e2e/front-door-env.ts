/**
 * The front door (M2.4a) in the admin suite's web server: the same two test hosts and stub as
 * apps/web/e2e/front-door-env.ts (apps can't import each other: keep the two in step).
 */
export const LEGACY_STUB_PORT = Number(process.env.LEGACY_STUB_PORT ?? 3390);
export const FD_YAY_HOST = 'yay.frontdoor.localhost';
export const FD_ABC_HOST = 'abc.frontdoor.localhost';

export const frontDoorEnv: Record<string, string> = {
  LEGACY_ORIGIN_URL: `http://127.0.0.1:${LEGACY_STUB_PORT}`,
  LEGACY_ABC_ORIGIN_URL: `http://127.0.0.1:${LEGACY_STUB_PORT + 1}`,
  LEGACY_YAY_HOSTS: FD_YAY_HOST,
  LEGACY_ABC_HOSTS: FD_ABC_HOST,
  LEGACY_ORIGIN_SECRET: 'e2e-front-door-secret',
  // The yayatoh.com instance's front-door host is a marketplace host (the defaults first).
  MARKETPLACE_HOSTS: `yayatoh.com,www.yayatoh.com,yayatoh.localhost,${FD_YAY_HOST}`,
  FRONT_DOOR_FLAG_TTL_MS: '300',
  FRONT_DOOR_FLUSH_MS: '300',
  FRONT_DOOR_TIMEOUT_MS: '3000',
};

/** The web app's stub (apps/web/e2e/legacy-stub.ts) as a Playwright web server. */
export const legacyStubServer = (cwd: string) => ({
  command: `node ../web/e2e/legacy-stub.ts`,
  cwd,
  url: `http://127.0.0.1:${LEGACY_STUB_PORT}/__stub/log`,
  reuseExistingServer: true,
  timeout: 20_000,
  gracefulShutdown: { signal: 'SIGTERM' as const, timeout: 2_000 },
  env: { LEGACY_STUB_PORT: String(LEGACY_STUB_PORT) },
});
