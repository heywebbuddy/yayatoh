import type { AnalyticsWarehouse } from './port.ts';
import { postgresWarehouse } from './postgres.ts';
import { tinybirdWarehouse } from './tinybird.ts';
import { fakeTinybird } from './tinybird-fake.ts';

/** Which adapter `warehouseFromEnv` picks (no connection made). */
export function configuredWarehouseName(
  env: Record<string, string | undefined> = process.env,
): AnalyticsWarehouse['name'] {
  return (env.ANALYTICS_WAREHOUSE ?? '').trim() === 'tinybird' ? 'tinybird' : 'postgres';
}

let devFake: ReturnType<typeof fakeTinybird> | null = null;

/**
 * The configured warehouse (M6.2a): `ANALYTICS_WAREHOUSE=postgres|tinybird`, Postgres when unset.
 * Tinybird needs `TINYBIRD_API_URL`, `TINYBIRD_APPEND_TOKEN`, `TINYBIRD_SIGNING_KEY` and
 * `TINYBIRD_WORKSPACE_ID`; `TINYBIRD_API_URL=fake` uses the in-memory fake (one per process,
 * dev and CI only). Production has no Tinybird account yet (owner inbox).
 */
export function warehouseFromEnv(env: Record<string, string | undefined> = process.env): AnalyticsWarehouse {
  const kind = (env.ANALYTICS_WAREHOUSE ?? 'postgres').trim() || 'postgres';
  if (kind === 'postgres') return postgresWarehouse;
  if (kind !== 'tinybird') throw new Error(`ANALYTICS_WAREHOUSE must be postgres or tinybird, not "${kind}"`);
  if (env.TINYBIRD_API_URL === 'fake') {
    if (env.NODE_ENV === 'production' && env.YAYATOH_DEV_AUTH !== '1')
      throw new Error('The fake Tinybird is for development and CI only');
    devFake ??= fakeTinybird();
    return tinybirdWarehouse({ ...devFake.config, fetch: devFake.fetch });
  }
  const missing = ['TINYBIRD_API_URL', 'TINYBIRD_APPEND_TOKEN', 'TINYBIRD_SIGNING_KEY', 'TINYBIRD_WORKSPACE_ID'].filter(
    (k) => !env[k],
  );
  if (missing.length) throw new Error(`ANALYTICS_WAREHOUSE=tinybird needs ${missing.join(', ')}`);
  return tinybirdWarehouse({
    apiUrl: env.TINYBIRD_API_URL as string,
    appendToken: env.TINYBIRD_APPEND_TOKEN as string,
    signingKey: env.TINYBIRD_SIGNING_KEY as string,
    workspaceId: env.TINYBIRD_WORKSPACE_ID as string,
  });
}

/**
 * The configured warehouse, resolved on first use (module-level queries are built before the
 * environment is read in tests and scripts).
 */
export function lazyWarehouse(env: Record<string, string | undefined> = process.env): AnalyticsWarehouse {
  let resolved: AnalyticsWarehouse | null = null;
  const get = () => {
    resolved ??= warehouseFromEnv(env);
    return resolved;
  };
  return {
    get name() {
      return configuredWarehouseName(env);
    },
    writeEvent: (scope, snapshot, version) => get().writeEvent(scope, snapshot, version),
    dailyTotals: (scope, range) => get().dailyTotals(scope, range),
    eventTotals: (scope, range) => get().eventTotals(scope, range),
    eventStates: (scope, range) => get().eventStates(scope, range),
  };
}
