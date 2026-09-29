import { withoutTenant } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import { type FlagStates, flagKey, ROUTE_STATES, type RouteState } from './front-door/routes.ts';

/**
 * The front door's flag states (M2.4a), through the SECURITY DEFINER `platform.front_door_flags()`
 * (app_user has no privileges on the table). Keyed `host|route`; unknown states are ignored.
 */
export async function frontDoorFlags(): Promise<FlagStates> {
  const rows = await withoutTenant((tx) =>
    tx.execute<{ host: string; route: string; state: string }>(
      sql`select host, route, state from platform.front_door_flags()`,
    ),
  );
  const out = new Map<string, RouteState>();
  for (const r of rows)
    if ((ROUTE_STATES as readonly string[]).includes(r.state))
      out.set(flagKey(r.host, r.route), r.state as RouteState);
  return out;
}

export interface FrontDoorStatRow {
  readonly host: string;
  readonly route: string;
  readonly servedBy: 'next' | 'legacy';
  readonly requests: number;
  readonly notFound: number;
  readonly proxyErrors: number;
  readonly upstream5xx: number;
  readonly latencyCount: number;
  readonly latencyMsSum: number;
  readonly latencyMsMax: number;
}

export interface FrontDoorNotFoundRow {
  readonly host: string;
  readonly path: string;
  readonly servedBy: 'next' | 'legacy';
  readonly count: number;
}

/** Add a batch of counters (today, UTC) through the SECURITY DEFINER `platform.record_front_door`. */
export async function recordFrontDoor(
  stats: readonly FrontDoorStatRow[],
  paths: readonly FrontDoorNotFoundRow[],
): Promise<void> {
  if (!stats.length && !paths.length) return;
  await withoutTenant((tx) =>
    tx.execute(
      sql`select platform.record_front_door(${JSON.stringify(stats)}::jsonb, ${JSON.stringify(paths)}::jsonb)`,
    ),
  );
}
