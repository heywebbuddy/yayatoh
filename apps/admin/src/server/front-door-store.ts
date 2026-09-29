import { withPlatformReader } from '@yayatoh/db/platform';
import {
  FRONT_DOOR_ROUTES,
  type FrontDoorInstance,
  frontDoorHostList,
  ROUTE_STATES,
  ROUTE_TABLE_VERSION,
  type RouteState,
} from '@yayatoh/platform/front-door';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

/**
 * The staff console's front-door data (M2.4a): the versioned route table with each host's flag
 * state, the last days' counters, the 404 top list and the flag audit trail. Everything is read
 * as platform_reader (audited in `platform.access_log`); flags change only through the SECURITY
 * DEFINER `platform.set_front_door_flag`, which re-checks the step-up time and writes the audit
 * row in the same statement. No `server-only` import, so integration tests can call it.
 */

export interface RouteRow {
  readonly host: string;
  readonly instance: FrontDoorInstance;
  readonly configured: boolean;
  readonly route: string;
  readonly stage: string;
  readonly shapes: readonly string[];
  readonly state: RouteState;
  readonly updatedBy: string | null;
  readonly updatedAt: Date | null;
  readonly requests: number;
  readonly notFound: number;
  readonly proxyErrors: number;
  readonly upstream5xx: number;
  readonly avgLatencyMs: number | null;
  readonly maxLatencyMs: number | null;
}

export interface NotFoundRow {
  readonly host: string;
  readonly path: string;
  readonly servedBy: 'next' | 'legacy';
  readonly count: number;
}

export interface FlagChangeRow {
  readonly id: string;
  readonly host: string;
  readonly route: string;
  readonly fromState: string;
  readonly toState: string;
  readonly actor: string;
  readonly reason: string;
  readonly at: Date;
}

export interface TrafficRow {
  readonly host: string;
  readonly route: string;
  readonly servedBy: 'next' | 'legacy';
  readonly requests: number;
  readonly notFound: number;
  readonly proxyErrors: number;
  readonly upstream5xx: number;
  readonly avgLatencyMs: number | null;
  readonly maxLatencyMs: number | null;
}

export interface FrontDoorOverview {
  readonly version: number;
  readonly days: number;
  readonly routes: RouteRow[];
  /** Everything else each host saw (legacy catch-all and the new app's own paths). */
  readonly other: TrafficRow[];
  readonly notFound: NotFoundRow[];
  readonly changes: FlagChangeRow[];
}

type Env = Record<string, string | undefined>;
const n = (v: unknown) => Number(v ?? 0);

export async function frontDoorOverview(
  actor: string,
  days = 7,
  env: Env = process.env,
): Promise<FrontDoorOverview> {
  const since = `${days} days`;
  const [flags, stats, notFound, changes] = await withPlatformReader(
    { actor, reason: 'staff console: front door overview' },
    async (tx) => [
      await tx.execute<{
        host: string;
        route: string;
        state: string;
        updated_by: string;
        updated_at: string;
      }>(sql`select host, route, state, updated_by, updated_at from platform.front_door_flags`),
      await tx.execute<{
        host: string;
        route: string;
        served_by: 'next' | 'legacy';
        requests: string;
        not_found: string;
        proxy_errors: string;
        upstream_5xx: string;
        latency_count: string;
        latency_ms_sum: string;
        latency_ms_max: number;
      }>(sql`
        select host, route, served_by, sum(requests) as requests, sum(not_found) as not_found,
               sum(proxy_errors) as proxy_errors, sum(upstream_5xx) as upstream_5xx,
               sum(latency_count) as latency_count, sum(latency_ms_sum) as latency_ms_sum,
               max(latency_ms_max) as latency_ms_max
        from platform.front_door_stats
        where day > (now() at time zone 'UTC')::date - ${since}::interval
        group by host, route, served_by`),
      await tx.execute<{ host: string; path: string; served_by: 'next' | 'legacy'; count: string }>(sql`
        select host, path, served_by, sum(count) as count
        from platform.front_door_not_found
        where day > (now() at time zone 'UTC')::date - ${since}::interval
        group by host, path, served_by
        order by sum(count) desc, path
        limit 25`),
      await tx.execute<{
        id: string;
        host: string;
        route: string;
        from_state: string;
        to_state: string;
        actor: string;
        reason: string;
        at: string;
      }>(sql`
        select id, host, route, from_state, to_state, actor, reason, at
        from platform.front_door_flag_changes order by at desc, id desc limit 25`),
    ],
  );
  const flag = new Map(flags.map((f) => [`${f.host}|${f.route}`, f]));
  const traffic = (r: (typeof stats)[number]): TrafficRow => ({
    host: r.host,
    route: r.route,
    servedBy: r.served_by,
    requests: n(r.requests),
    notFound: n(r.not_found),
    proxyErrors: n(r.proxy_errors),
    upstream5xx: n(r.upstream_5xx),
    avgLatencyMs: n(r.latency_count) > 0 ? Math.round(n(r.latency_ms_sum) / n(r.latency_count)) : null,
    maxLatencyMs: n(r.latency_count) > 0 ? n(r.latency_ms_max) : null,
  });
  const routes: RouteRow[] = [];
  const hosts = frontDoorHostList(env);
  for (const h of hosts)
    for (const r of FRONT_DOOR_ROUTES) {
      if (!r.instances.includes(h.instance)) continue;
      const f = flag.get(`${h.host}|${r.key}`);
      const served = stats.filter((s) => s.host === h.host && s.route === r.key).map(traffic);
      const sum = (k: 'requests' | 'notFound' | 'proxyErrors' | 'upstream5xx') =>
        served.reduce((a, s) => a + s[k], 0);
      const lat = stats.filter((s) => s.host === h.host && s.route === r.key && n(s.latency_count) > 0);
      const latCount = lat.reduce((a, s) => a + n(s.latency_count), 0);
      routes.push({
        host: h.host,
        instance: h.instance,
        configured: h.configured,
        route: r.key,
        stage: r.stage,
        shapes: r.shapes,
        state: (ROUTE_STATES as readonly string[]).includes(f?.state ?? '')
          ? (f?.state as RouteState)
          : 'legacy',
        updatedBy: f?.updated_by ?? null,
        updatedAt: f ? new Date(f.updated_at) : null,
        requests: sum('requests'),
        notFound: sum('notFound'),
        proxyErrors: sum('proxyErrors'),
        upstream5xx: sum('upstream5xx'),
        avgLatencyMs: latCount
          ? Math.round(lat.reduce((a, s) => a + n(s.latency_ms_sum), 0) / latCount)
          : null,
        maxLatencyMs: latCount ? Math.max(...lat.map((s) => n(s.latency_ms_max))) : null,
      });
    }
  const moved = new Set(FRONT_DOOR_ROUTES.map((r) => r.key));
  return {
    version: ROUTE_TABLE_VERSION,
    days,
    routes,
    other: stats
      .filter((s) => !moved.has(s.route))
      .map(traffic)
      .sort((a, b) => a.host.localeCompare(b.host) || a.route.localeCompare(b.route)),
    notFound: notFound.map((r) => ({ host: r.host, path: r.path, servedBy: r.served_by, count: n(r.count) })),
    changes: changes.map((c) => ({
      id: c.id,
      host: c.host,
      route: c.route,
      fromState: c.from_state,
      toState: c.to_state,
      actor: c.actor,
      reason: c.reason,
      at: new Date(c.at),
    })),
  };
}

export const FlagChangeInput = z.object({
  host: z.string().min(1).max(253),
  route: z.string().min(1).max(60),
  state: z.enum(ROUTE_STATES),
  reason: z.string().trim().min(3).max(500),
});
export type FlagChangeInput = z.infer<typeof FlagChangeInput>;

/** Whether a route exists in the current table for that host's instance. */
export function routeAllowed(host: string, route: string, env: Env = process.env): boolean {
  const h = frontDoorHostList(env).find((x) => x.host === host);
  if (!h) return false;
  return FRONT_DOOR_ROUTES.some((r) => r.key === route && r.instances.includes(h.instance));
}

/**
 * Change one route's owner on one host (the caller verified the staff member's step-up proof and
 * passes its time). Returns the previous state.
 */
export async function setFrontDoorFlag(
  actor: string,
  input: FlagChangeInput,
  steppedUpAt: Date,
): Promise<RouteState> {
  const [row] = await withPlatformReader(
    {
      actor,
      reason: `staff console: front door ${input.host} ${input.route} → ${input.state}: ${input.reason}`,
    },
    (tx) =>
      tx.execute<{ previous: RouteState }>(
        sql`select platform.set_front_door_flag(${input.host}, ${input.route}, ${input.state}, ${ROUTE_TABLE_VERSION}, ${actor}, ${input.reason}, ${steppedUpAt.toISOString()}::timestamptz) as previous`,
      ),
    { callsWritingFunctions: true },
  );
  return row?.previous ?? 'legacy';
}
