import 'server-only';
import { withPlatformReader } from '@yayatoh/db/platform';
import { sql } from 'drizzle-orm';
import type { Staff } from './staff.ts';

/** One row of the tenants list: an explicit allowlist, never raw rows. */
export interface TenantRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly status: string;
  readonly createdAt: Date;
  readonly members: number;
  readonly payoutState: 'none' | 'pending' | 'restricted' | 'active';
  readonly payoutsHeld: boolean;
  readonly paused: readonly string[];
}

/** Cross-tenant list (platform_reader, audited): search by slug or name. */
export async function listTenants(staff: Staff, q: string): Promise<TenantRow[]> {
  const like = `%${q.trim().toLowerCase()}%`;
  const rows = await withPlatformReader(
    {
      actor: staff.actor,
      reason: q.trim() ? `staff console: search tenants "${q.trim()}"` : 'staff console: list tenants',
    },
    (tx) =>
      tx.execute<{
        id: string;
        slug: string;
        name: string;
        status: string;
        created_at: string;
        members: number;
        charges_enabled: boolean | null;
        payouts_enabled: boolean | null;
        details_submitted: boolean | null;
        payouts_held: boolean | null;
        paused: string[] | null;
      }>(sql`
        select o.id, o.slug, o.name, o.status, o.created_at,
          (select count(*)::int from tenancy.memberships m where m.org_id = o.id) as members,
          pa.charges_enabled, pa.payouts_enabled, pa.details_submitted, pa.payouts_held,
          (select array_agg(s.kind order by s.kind) from tenancy.org_suspensions s
            where s.org_id = o.id and s.lifted_at is null) as paused
        from tenancy.organizations o
        left join payments.payment_accounts pa on pa.org_id = o.id
        where ${q.trim() ? sql`(lower(o.slug) like ${like} or lower(o.name) like ${like})` : sql`true`}
        order by o.created_at desc
        limit 100`),
  );
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    status: r.status,
    createdAt: new Date(r.created_at),
    members: r.members,
    payoutState:
      r.charges_enabled === null
        ? 'none'
        : r.charges_enabled && r.payouts_enabled
          ? 'active'
          : r.details_submitted
            ? 'restricted'
            : 'pending',
    payoutsHeld: Boolean(r.payouts_held),
    paused: r.paused ?? [],
  }));
}

export interface AccessLogRow {
  readonly actor: string;
  readonly reason: string;
  readonly at: Date;
}

/** The latest platform_reader uses (reading the log is itself logged). */
export async function recentAccess(staff: Staff): Promise<AccessLogRow[]> {
  const rows = await withPlatformReader(
    { actor: staff.actor, reason: 'staff console: read access log' },
    (tx) =>
      tx.execute<{ actor: string; reason: string; at: string }>(
        sql`select actor, reason, at from platform.access_log order by at desc limit 200`,
      ),
  );
  return rows.map((r) => ({ actor: r.actor, reason: r.reason, at: new Date(r.at) }));
}

/** One /v1 telemetry row: requests per route × client × app version over the window. */
export interface ApiUsageRow {
  readonly route: string;
  readonly method: string;
  readonly client: string;
  readonly appVersion: string;
  readonly requests: number;
  readonly lastDay: string;
}

/** App-version telemetry for /v1 (M1.15), last `days` UTC days. No tenant data is involved. */
export async function apiUsage(staff: Staff, days = 7): Promise<ApiUsageRow[]> {
  const rows = await withPlatformReader(
    { actor: staff.actor, reason: 'staff console: read /v1 app-version telemetry' },
    (tx) =>
      tx.execute<{
        route: string;
        method: string;
        client: string;
        app_version: string;
        requests: number;
        last_day: string;
      }>(sql`
        select route, method, client, app_version, sum(count)::int as requests, max(day)::text as last_day
        from platform.api_usage
        where day > (now() at time zone 'UTC')::date - ${days}::int
        group by route, method, client, app_version
        order by requests desc, route, client, app_version
        limit 500`),
  );
  return rows.map((r) => ({
    route: r.route,
    method: r.method,
    client: r.client,
    appVersion: r.app_version,
    requests: r.requests,
    lastDay: r.last_day,
  }));
}
