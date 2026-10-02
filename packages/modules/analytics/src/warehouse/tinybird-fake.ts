import { createHmac, timingSafeEqual } from 'node:crypto';
import { SNAPSHOT_MARKER, TINYBIRD_DATASOURCES, TINYBIRD_PIPES, type TinybirdConfig } from './tinybird.ts';

/**
 * An in-memory Tinybird for dev and CI (M6.2a): the Events API and the three published pipes,
 * with the semantics of the files in `packages/modules/analytics/tinybird/` (newest version of
 * each event wins). It records every call and is strict where Tinybird is lenient, so tests can
 * prove isolation:
 * - an append needs the append token, and every row must carry an `org_id`;
 * - a pipe read needs a valid, unexpired JWT for that pipe whose `fixed_params.org_id` is set, and
 *   the URL's `org_id` must be present and equal it (Tinybird would silently pin it instead);
 * - every row a pipe returns belongs to that org.
 * `seed()` loads fixture rows. Never talks to the network.
 */
export interface FakeTinybirdCall {
  readonly kind: 'append' | 'query';
  /** Datasource (append) or pipe (query). */
  readonly name: string;
  readonly status: number;
  /** Append: the orgs of the rows. Query: the URL's org and the token's fixed org. */
  readonly orgIds: readonly string[];
  readonly tokenOrgId?: string;
  readonly rows: number;
}

type Row = Record<string, unknown>;

export interface FakeTinybird {
  readonly config: Required<Pick<TinybirdConfig, 'apiUrl' | 'appendToken' | 'signingKey' | 'workspaceId'>>;
  readonly fetch: typeof fetch;
  readonly calls: FakeTinybirdCall[];
  readonly datasources: Record<string, Row[]>;
  /** Load fixture rows into a datasource (as if appended). */
  seed(datasource: string, rows: readonly Row[]): void;
  /** Throws unless every query so far carried a signed org that matched its URL. */
  assertEveryQueryScoped(): void;
  reset(): void;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function fakeTinybird(opts: { now?: () => Date } = {}): FakeTinybird {
  const config = {
    apiUrl: 'https://tinybird.fake.invalid',
    appendToken: 'fake-append-token',
    signingKey: 'fake-workspace-signing-key',
    workspaceId: 'fake-workspace',
  };
  const now = opts.now ?? (() => new Date());
  const calls: FakeTinybirdCall[] = [];
  const datasources: Record<string, Row[]> = {
    [TINYBIRD_DATASOURCES.daily]: [],
    [TINYBIRD_DATASOURCES.states]: [],
  };

  function verify(token: string, pipe: string): string | null {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return null;
    const expected = createHmac('sha256', config.signingKey).update(`${h}.${p}`).digest();
    const got = Buffer.from(s, 'base64url');
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString()) as {
      exp?: number;
      workspace_id?: string;
      scopes?: { type: string; resource: string; fixed_params?: { org_id?: string } }[];
    };
    if (payload.workspace_id !== config.workspaceId) return null;
    if (!payload.exp || payload.exp * 1000 <= now().getTime()) return null;
    const scope = payload.scopes?.find((x) => x.type === 'PIPES:READ' && x.resource === pipe);
    return scope?.fixed_params?.org_id ?? null;
  }

  /** The newest version's rows of each (org, event). */
  function latest(datasource: string, orgId: string): Row[] {
    const rows = (datasources[datasource] ?? []).filter((r) => r.org_id === orgId);
    const top = new Map<string, number>();
    for (const r of rows) {
      const e = String(r.event_id);
      top.set(e, Math.max(top.get(e) ?? -1, Number(r.version)));
    }
    return rows.filter((r) => Number(r.version) === top.get(String(r.event_id)));
  }

  function runPipe(pipe: string, q: URLSearchParams, orgId: string): Row[] | null {
    const from = q.get('from') ?? '0000-01-01';
    const to = q.get('to') ?? '9999-12-31';
    const eventId = q.get('event_id');
    const inEvent = (r: Row) => !eventId || r.event_id === eventId;
    const sum = (rows: Row[], key: (r: Row) => string, shape: (r: Row) => Row) => {
      const out = new Map<string, Row>();
      for (const r of rows) {
        const k = key(r);
        const cur = out.get(k) ?? { ...shape(r), org_id: orgId, value: 0 };
        cur.value = Number(cur.value) + Number(r.value);
        out.set(k, cur);
      }
      return [...out.values()];
    };
    if (pipe === TINYBIRD_PIPES.dailyTotals || pipe === TINYBIRD_PIPES.eventTotals) {
      const rows = latest(TINYBIRD_DATASOURCES.daily, orgId).filter(
        (r) => r.metric !== SNAPSHOT_MARKER && String(r.day) >= from && String(r.day) <= to && inEvent(r),
      );
      return pipe === TINYBIRD_PIPES.dailyTotals
        ? sum(
            rows,
            (r) => `${r.day}|${r.metric}|${r.currency}`,
            (r) => ({ day: r.day, metric: r.metric, currency: r.currency }),
          )
        : sum(
            rows,
            (r) => `${r.event_id}|${r.metric}|${r.currency}`,
            (r) => ({ event_id: r.event_id, metric: r.metric, currency: r.currency }),
          );
    }
    if (pipe === TINYBIRD_PIPES.eventStates)
      return latest(TINYBIRD_DATASOURCES.states, orgId)
        .filter((r) => r.deleted === 0 && String(r.end_day) >= from && String(r.end_day) <= to && inEvent(r))
        .map(({ version: _v, deleted: _d, ...r }) => r);
    return null;
  }

  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const auth = new Headers(init?.headers).get('authorization')?.replace(/^Bearer /, '') ?? '';
    if (url.origin !== config.apiUrl) throw new Error(`fake Tinybird: unexpected host ${url.origin}`);
    if (url.pathname === '/v0/events' && init?.method === 'POST') {
      const name = url.searchParams.get('name') ?? '';
      const rows = String(init.body ?? '')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Row);
      const orgIds = [...new Set(rows.map((r) => String(r.org_id ?? '')))];
      const bad = auth !== config.appendToken ? 403 : !(name in datasources) ? 404 : 0;
      const missingOrg = rows.some((r) => typeof r.org_id !== 'string' || r.org_id === '');
      const status = bad || (missingOrg ? 400 : 202);
      calls.push({ kind: 'append', name, status, orgIds, rows: rows.length });
      if (status !== 202) return json(status, { error: 'rejected' });
      datasources[name]?.push(...rows);
      return json(202, { successful_rows: rows.length, quarantined_rows: 0 });
    }
    const m = /^\/v0\/pipes\/([a-z0-9_]+)\.json$/.exec(url.pathname);
    if (m && (init?.method ?? 'GET') === 'GET') {
      const pipe = m[1] as string;
      const orgId = url.searchParams.get('org_id') ?? '';
      const tokenOrgId = verify(auth, pipe) ?? undefined;
      const status = !tokenOrgId ? 403 : !orgId ? 400 : orgId !== tokenOrgId ? 403 : 200;
      const data = status === 200 ? runPipe(pipe, url.searchParams, tokenOrgId as string) : null;
      const final = status === 200 && !data ? 404 : status;
      calls.push({
        kind: 'query',
        name: pipe,
        status: final,
        orgIds: [orgId],
        ...(tokenOrgId ? { tokenOrgId } : {}),
        rows: data?.length ?? 0,
      });
      if (final !== 200) return json(final, { error: 'rejected' });
      return json(200, { data, rows: data?.length ?? 0 });
    }
    return json(404, { error: 'not found' });
  }) as typeof fetch;

  return {
    config,
    fetch: fakeFetch,
    calls,
    datasources,
    seed(datasource, rows) {
      const ds = datasources[datasource];
      if (!ds) throw new Error(`fake Tinybird: no datasource ${datasource}`);
      ds.push(...rows.map((r) => ({ ...r })));
    },
    assertEveryQueryScoped() {
      for (const c of calls)
        if (c.kind === 'query' && (!c.tokenOrgId || c.orgIds[0] !== c.tokenOrgId || c.status !== 200))
          throw new Error(`fake Tinybird: unscoped or refused query to ${c.name}`);
    },
    reset() {
      calls.length = 0;
      for (const k of Object.keys(datasources)) (datasources[k] as Row[]).length = 0;
    },
  };
}
