import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { DAILY_METRICS } from '../schema.ts';
import {
  type AnalyticsWarehouse,
  type DayRange,
  type EventSnapshot,
  scopeOrg,
  type WarehouseScope,
} from './port.ts';

/**
 * The Tinybird warehouse (M6.2a, decision P6-2): managed ClickHouse fed from the outbox through
 * the Events API, read through published pipes. Switched on with `ANALYTICS_WAREHOUSE=tinybird`
 * once an org's volume needs it; dev and CI run it against `fakeTinybird()` only (no account,
 * no key, no network call).
 *
 * Contract (the datasource and pipe files live in `packages/modules/analytics/tinybird/`):
 * - `yy_daily_rollups` and `yy_event_states` (ReplacingMergeTree on `version`): every write of an
 *   event appends all of its rows under one new version, plus a `__snapshot` marker row, so an
 *   event whose rows vanished (a refund back to zero, a deleted event) is replaced too. Pipes read
 *   the newest version of each event only.
 * - Reads use a short-lived JWT per org and pipe, signed with the workspace's signing key, whose
 *   `fixed_params.org_id` is the caller's org: Tinybird pins the pipe's `org_id` parameter to it
 *   whatever the URL says. The URL carries the same org, and every row a pipe returns must carry
 *   it too (checked here), so a mis-deployed pipe cannot leak another org's rows.
 */
export const TINYBIRD_DATASOURCES = { daily: 'yy_daily_rollups', states: 'yy_event_states' } as const;
export const TINYBIRD_PIPES = {
  dailyTotals: 'yy_daily_totals',
  eventTotals: 'yy_event_totals',
  eventStates: 'yy_event_states_by_end_day',
} as const;
export const SNAPSHOT_MARKER = '__snapshot';

export interface TinybirdConfig {
  /** e.g. `https://api.tinybird.co` (region host). */
  readonly apiUrl: string;
  /** Token with DATASOURCES:APPEND on the two datasources (never sent to a browser). */
  readonly appendToken: string;
  /** The workspace admin token that signs per-org read JWTs (never sent anywhere). */
  readonly signingKey: string;
  readonly workspaceId: string;
  readonly fetch?: typeof fetch;
  /** Read tokens live this long (default 5 minutes). */
  readonly tokenTtlSeconds?: number;
  readonly now?: () => Date;
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url');

/** A Tinybird JWT: one pipe, read only, with the org pinned as a fixed parameter. */
export function signPipeToken(
  cfg: Pick<TinybirdConfig, 'signingKey' | 'workspaceId'>,
  pipe: string,
  orgId: string,
  expiresAt: Date,
): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      workspace_id: cfg.workspaceId,
      name: `yy_org_${orgId}`,
      exp: Math.floor(expiresAt.getTime() / 1000),
      scopes: [{ type: 'PIPES:READ', resource: pipe, fixed_params: { org_id: orgId } }],
    }),
  );
  const sig = createHmac('sha256', cfg.signingKey).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

const Metric = z.enum(DAILY_METRICS);
const PipeResponse = <T extends z.ZodType>(row: T) => z.object({ data: z.array(row) });
const Num = z.union([z.number(), z.string().regex(/^-?\d+$/)]).transform(Number);
const DailyTotalRow = z.object({
  org_id: z.string(),
  day: z.iso.date(),
  metric: Metric,
  currency: z.string(),
  value: Num,
});
const EventTotalRow = z.object({
  org_id: z.string(),
  event_id: z.uuid(),
  metric: Metric,
  currency: z.string(),
  value: Num,
});
const EventStateRow = z.object({
  org_id: z.string(),
  event_id: z.uuid(),
  starts_at: z.string(),
  ends_at: z.string(),
  end_day: z.iso.date(),
  valid_tickets: Num,
  checked_in: Num,
});

export class TinybirdError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'TinybirdError';
    this.status = status;
  }
}

export function tinybirdWarehouse(cfg: TinybirdConfig): AnalyticsWarehouse {
  const doFetch = cfg.fetch ?? fetch;
  const now = cfg.now ?? (() => new Date());
  const base = cfg.apiUrl.replace(/\/+$/, '');

  async function append(datasource: string, rows: readonly Record<string, unknown>[]) {
    const res = await doFetch(`${base}/v0/events?name=${encodeURIComponent(datasource)}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.appendToken}`, 'content-type': 'application/x-ndjson' },
      body: rows.map((r) => JSON.stringify(r)).join('\n'),
    });
    if (!res.ok) throw new TinybirdError(`Tinybird append to ${datasource} failed`, res.status);
    const body = z
      .object({ successful_rows: z.number(), quarantined_rows: z.number() })
      .parse(await res.json());
    if (body.quarantined_rows > 0 || body.successful_rows !== rows.length)
      throw new TinybirdError(`Tinybird quarantined rows in ${datasource}`, 422);
    return rows.length;
  }

  async function pipe<T extends z.ZodType<{ org_id: string }>>(
    scope: WarehouseScope,
    name: string,
    range: DayRange,
    row: T,
  ): Promise<z.infer<T>[]> {
    const orgId = scopeOrg(scope);
    const token = signPipeToken(
      cfg,
      name,
      orgId,
      new Date(now().getTime() + (cfg.tokenTtlSeconds ?? 300) * 1000),
    );
    const qs = new URLSearchParams({ org_id: orgId, from: range.from, to: range.to });
    if (range.eventId) qs.set('event_id', range.eventId);
    const res = await doFetch(`${base}/v0/pipes/${encodeURIComponent(name)}.json?${qs.toString()}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new TinybirdError(`Tinybird pipe ${name} failed`, res.status);
    const { data } = PipeResponse(row).parse(await res.json());
    for (const r of data)
      if (r.org_id !== orgId)
        throw new TinybirdError(`Tinybird pipe ${name} returned another org's row`, 500);
    return data;
  }

  return {
    name: 'tinybird',

    async writeEvent(scope: WarehouseScope, snapshot: EventSnapshot, version: number) {
      const orgId = scopeOrg(scope);
      const head = { org_id: orgId, event_id: snapshot.eventId, version };
      const daily = [
        { ...head, day: '1970-01-01', metric: SNAPSHOT_MARKER, currency: '', value: 0 },
        ...(snapshot.state ? snapshot.daily.filter((r) => r.value !== 0) : []).map((r) => ({
          ...head,
          ...r,
        })),
      ];
      const s = snapshot.state;
      const state = {
        ...head,
        deleted: s ? 0 : 1,
        starts_at: (s?.startsAt ?? new Date(0)).toISOString(),
        ends_at: (s?.endsAt ?? new Date(0)).toISOString(),
        end_day: s?.endDay ?? '1970-01-01',
        valid_tickets: s?.validTickets ?? 0,
        checked_in: s?.checkedIn ?? 0,
      };
      const rows =
        (await append(TINYBIRD_DATASOURCES.daily, daily)) +
        (await append(TINYBIRD_DATASOURCES.states, [state]));
      return { rows };
    },

    async dailyTotals(scope, range) {
      const rows = await pipe(scope, TINYBIRD_PIPES.dailyTotals, range, DailyTotalRow);
      return rows.map((r) => ({ day: r.day, metric: r.metric, currency: r.currency, value: r.value }));
    },

    async eventTotals(scope, range) {
      const rows = await pipe(scope, TINYBIRD_PIPES.eventTotals, range, EventTotalRow);
      return rows.map((r) => ({
        eventId: r.event_id,
        metric: r.metric,
        currency: r.currency,
        value: r.value,
      }));
    },

    async eventStates(scope, range) {
      const rows = await pipe(scope, TINYBIRD_PIPES.eventStates, range, EventStateRow);
      return rows.map((r) => ({
        eventId: r.event_id,
        startsAt: new Date(r.starts_at),
        endsAt: new Date(r.ends_at),
        endDay: r.end_day,
        validTickets: r.valid_tickets,
        checkedIn: r.checked_in,
      }));
    },
  };
}
