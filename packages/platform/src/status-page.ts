import { withoutTenant } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

/**
 * Status page port (M3.11b; roadmap M1.14/M3.11 "status page"). The public `/status` page, the
 * incident banner in the console and on the marketplace, and the on-call runbook read it. The
 * real provider (Better Stack, owner account) keeps components and incidents; until its account
 * exists, development, preview and CI use the fake adapter, whose incidents staff post from the
 * admin console (`platform.status_fake_incidents`). Never the fake in production.
 */

/** Component states, least to most severe. */
export const COMPONENT_STATUSES = [
  'operational',
  'maintenance',
  'degraded',
  'partial_outage',
  'major_outage',
] as const;
export type ComponentStatus = (typeof COMPONENT_STATUSES)[number];

export const INCIDENT_IMPACTS = ['minor', 'major', 'critical', 'maintenance'] as const;
export type IncidentImpact = (typeof INCIDENT_IMPACTS)[number];

/** Incident updates (`scheduled` / `in_progress` / `completed` are maintenance windows). */
export const INCIDENT_STATUSES = [
  'investigating',
  'identified',
  'monitoring',
  'resolved',
  'scheduled',
  'in_progress',
  'completed',
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
const CLOSED: ReadonlySet<IncidentStatus> = new Set(['resolved', 'completed']);

/**
 * The fake provider's components (keys are stable; names are translated by the web). The real
 * provider's components come with their own names.
 */
export const STATUS_COMPONENTS = [
  'marketplace',
  'checkout',
  'console',
  'checkin',
  'payments',
  'messaging',
  'api',
] as const;
export type StatusComponentKey = (typeof STATUS_COMPONENTS)[number];

export interface StatusComponent {
  /** A known key (translated) or the provider's own id. */
  readonly key: string;
  /** The provider's name (shown when the key is not one of STATUS_COMPONENTS). */
  readonly name: string;
  readonly status: ComponentStatus;
}

export interface IncidentUpdate {
  readonly status: IncidentStatus;
  readonly body: string;
  readonly at: Date;
}

export interface StatusIncident {
  readonly id: string;
  readonly title: string;
  readonly impact: IncidentImpact;
  readonly status: IncidentStatus;
  /** Still open (not resolved or completed). */
  readonly active: boolean;
  readonly components: readonly string[];
  readonly startedAt: Date;
  readonly resolvedAt: Date | null;
  /** Newest first. */
  readonly updates: readonly IncidentUpdate[];
}

export interface StatusSnapshot {
  readonly provider: 'fake' | 'betterstack';
  readonly overall: ComponentStatus;
  readonly components: readonly StatusComponent[];
  /** Open incidents first (newest first), then those resolved recently. */
  readonly incidents: readonly StatusIncident[];
  readonly fetchedAt: Date;
}

export interface StatusPage {
  readonly provider: 'fake' | 'betterstack';
  snapshot(): Promise<StatusSnapshot>;
}

const RANK: Record<ComponentStatus, number> = {
  operational: 0,
  maintenance: 1,
  degraded: 2,
  partial_outage: 3,
  major_outage: 4,
};

/** The most severe of these states (operational when there are none). */
export function worstStatus(statuses: Iterable<ComponentStatus>): ComponentStatus {
  let worst: ComponentStatus = 'operational';
  for (const s of statuses) if (RANK[s] > RANK[worst]) worst = s;
  return worst;
}

/** What an open incident of this impact does to the components it names. */
export function impactStatus(impact: IncidentImpact): ComponentStatus {
  return { minor: 'degraded', major: 'partial_outage', critical: 'major_outage', maintenance: 'maintenance' }[
    impact
  ] as ComponentStatus;
}

const IMPACT_RANK: Record<IncidentImpact, number> = { maintenance: 0, minor: 1, major: 2, critical: 3 };

export interface IncidentBanner {
  readonly title: string;
  readonly impact: IncidentImpact;
  readonly status: IncidentStatus;
  /** More open incidents besides this one. */
  readonly others: number;
}

/**
 * The banner the console and the marketplace show while something is open: the most severe open
 * incident (maintenance only while it is in progress, not while scheduled), or null.
 */
export function incidentBanner(snapshot: StatusSnapshot | null): IncidentBanner | null {
  if (!snapshot) return null;
  const open = snapshot.incidents.filter((i) => i.active && i.status !== 'scheduled');
  if (open.length === 0) return null;
  const top = [...open].sort(
    (a, b) => IMPACT_RANK[b.impact] - IMPACT_RANK[a.impact] || b.startedAt.getTime() - a.startedAt.getTime(),
  )[0] as StatusIncident;
  return { title: top.title, impact: top.impact, status: top.status, others: open.length - 1 };
}

/**
 * The snapshot from a list of incidents and the provider's component list: every component is
 * operational unless an open (started) incident names it; the overall state is the worst one.
 */
export function snapshotFromIncidents(
  provider: StatusSnapshot['provider'],
  components: readonly { key: string; name: string; status?: ComponentStatus }[],
  incidents: readonly StatusIncident[],
  now: Date,
): StatusSnapshot {
  const byKey = new Map<string, ComponentStatus[]>();
  for (const i of incidents) {
    if (!i.active || i.status === 'scheduled') continue;
    for (const k of i.components) byKey.set(k, [...(byKey.get(k) ?? []), impactStatus(i.impact)]);
  }
  const list = components.map((c) => ({
    key: c.key,
    name: c.name,
    status: worstStatus([c.status ?? 'operational', ...(byKey.get(c.key) ?? [])]),
  }));
  const sorted = [...incidents].sort(
    (a, b) => Number(b.active) - Number(a.active) || b.startedAt.getTime() - a.startedAt.getTime(),
  );
  return {
    provider,
    overall: worstStatus(list.map((c) => c.status)),
    components: list,
    incidents: sorted,
    fetchedAt: now,
  };
}

// ── The fake adapter ──────────────────────────────────────────────────────────────────────────

const FAKE_NAMES: Record<StatusComponentKey, string> = {
  marketplace: 'Event pages and marketplace',
  checkout: 'Checkout',
  console: 'Organizer console',
  checkin: 'Check-in and scanning',
  payments: 'Payments and payouts',
  messaging: 'Email and messaging',
  api: 'API',
};

/** How long resolved incidents stay on the page. */
export const STATUS_HISTORY_DAYS = 14;

const UpdateRow = z.object({
  status: z.enum(INCIDENT_STATUSES),
  body: z.string(),
  at: z.coerce.date(),
});

export type FakeIncidentRow = {
  id: string;
  title: string;
  impact: string;
  status: string;
  components: string[] | null;
  updates: unknown;
  started_at: string | Date;
  resolved_at: string | Date | null;
};

/** A row of `platform.status_fake_recent` as an incident (unknown values are dropped). */
export function fakeIncident(r: FakeIncidentRow): StatusIncident {
  const status = z.enum(INCIDENT_STATUSES).catch('investigating').parse(r.status);
  const updates = z
    .array(z.unknown())
    .catch([])
    .parse(r.updates)
    .flatMap((u) => {
      const p = UpdateRow.safeParse(u);
      return p.success ? [p.data] : [];
    });
  return {
    id: r.id,
    title: r.title,
    impact: z.enum(INCIDENT_IMPACTS).catch('minor').parse(r.impact),
    status,
    active: !CLOSED.has(status),
    components: (r.components ?? []).filter((k) => (STATUS_COMPONENTS as readonly string[]).includes(k)),
    startedAt: new Date(r.started_at),
    resolvedAt: r.resolved_at ? new Date(r.resolved_at) : null,
    updates: updates.sort((a, b) => b.at.getTime() - a.at.getTime()),
  };
}

/** Development, preview and CI: incidents staff post in the admin console. */
export const fakeStatusPage: StatusPage = {
  provider: 'fake',
  async snapshot() {
    const rows = await withoutTenant((tx) =>
      tx.execute<FakeIncidentRow>(
        sql`select id::text as id, title, impact, status, components, updates, started_at, resolved_at
            from platform.status_fake_recent(${STATUS_HISTORY_DAYS})`,
      ),
    );
    return snapshotFromIncidents(
      'fake',
      STATUS_COMPONENTS.map((key) => ({ key, name: FAKE_NAMES[key] })),
      [...rows].map(fakeIncident),
      new Date(),
    );
  },
};

export const PostIncidentInput = z.object({
  title: z.string().trim().min(1).max(160),
  impact: z.enum(INCIDENT_IMPACTS),
  components: z.array(z.enum(STATUS_COMPONENTS)).max(STATUS_COMPONENTS.length).default([]),
  body: z.string().trim().min(1).max(2000),
});
export type PostIncidentInput = z.input<typeof PostIncidentInput>;

export const UpdateIncidentInput = z.object({
  id: z.uuid(),
  status: z.enum(INCIDENT_STATUSES),
  body: z.string().trim().min(1).max(2000),
});
export type UpdateIncidentInput = z.input<typeof UpdateIncidentInput>;

/** SQL that opens a fake incident (run as platform_reader by staff, or app_user by the dev route). */
export function postFakeIncidentSql(input: PostIncidentInput, actor: string) {
  const i = PostIncidentInput.parse(input);
  const components = `{${i.components.join(',')}}`;
  return sql`select platform.status_fake_post(${i.title}, ${i.impact}, ${components}::text[], ${i.body}, ${actor}) as id`;
}

/** SQL that adds an update to a fake incident ("resolved" / "completed" close it). */
export function updateFakeIncidentSql(input: UpdateIncidentInput) {
  const i = UpdateIncidentInput.parse(input);
  return sql`select platform.status_fake_update(${i.id}::uuid, ${i.status}, ${i.body}) as updated`;
}

// ── Better Stack ──────────────────────────────────────────────────────────────────────────────

/**
 * Better Stack's resource and report states → ours. `downtime` is a major outage; anything we
 * don't know is ignored (null) rather than shown as an outage.
 */
export function mapBetterStackStatus(state: unknown): ComponentStatus | null {
  switch (state) {
    case 'operational':
      return 'operational';
    case 'degraded':
      return 'degraded';
    case 'downtime':
      return 'major_outage';
    case 'maintenance':
      return 'maintenance';
    default:
      return null;
  }
}

/** A Better Stack report's aggregate state and type → our impact. */
export function betterStackImpact(reportType: unknown, aggregateState: unknown): IncidentImpact {
  if (reportType === 'maintenance' || aggregateState === 'maintenance') return 'maintenance';
  if (aggregateState === 'downtime') return 'critical';
  return 'minor';
}

const Resource = z.object({
  id: z.coerce.string(),
  attributes: z.object({ public_name: z.string().catch(''), status: z.unknown() }),
});
const Report = z.object({
  id: z.coerce.string(),
  attributes: z.object({
    title: z.string().catch(''),
    report_type: z.unknown(),
    aggregate_state: z.unknown(),
    starts_at: z.string().nullable().catch(null),
    ends_at: z.string().nullable().catch(null),
    affected_resources: z
      .array(z.object({ status_page_resource_id: z.coerce.string() }).catch({ status_page_resource_id: '' }))
      .catch([]),
  }),
});
const Update = z.object({
  attributes: z.object({ message: z.string().catch(''), published_at: z.string().nullable().catch(null) }),
});
const list = <T extends z.ZodType>(item: T) =>
  z
    .object({ data: z.array(z.unknown()).catch([]) })
    .catch({ data: [] })
    .transform((v) =>
      v.data.flatMap((d) => {
        const p = item.safeParse(d);
        return p.success ? [p.data as z.infer<T>] : [];
      }),
    );

/** Map Better Stack's JSON:API documents into our snapshot (pure; see the adapter below). */
export function betterStackSnapshot(
  resourcesDoc: unknown,
  reportsDoc: unknown,
  updatesByReport: ReadonlyMap<string, unknown>,
  now: Date,
): StatusSnapshot {
  const resources = list(Resource).parse(resourcesDoc);
  const components = resources.map((r) => ({
    key: r.id,
    name: r.attributes.public_name,
    status: mapBetterStackStatus(r.attributes.status) ?? 'operational',
  }));
  const since = now.getTime() - STATUS_HISTORY_DAYS * 86_400_000;
  const incidents: StatusIncident[] = [];
  for (const r of list(Report).parse(reportsDoc)) {
    const a = r.attributes;
    const startedAt = a.starts_at ? new Date(a.starts_at) : now;
    const endedAt = a.ends_at ? new Date(a.ends_at) : null;
    const maintenance = betterStackImpact(a.report_type, a.aggregate_state) === 'maintenance';
    const active = !endedAt || endedAt.getTime() > now.getTime();
    if (!active && (endedAt?.getTime() ?? 0) < since) continue;
    const status: IncidentStatus = maintenance
      ? startedAt.getTime() > now.getTime()
        ? 'scheduled'
        : active
          ? 'in_progress'
          : 'completed'
      : active
        ? 'investigating'
        : 'resolved';
    const updates = list(Update)
      .parse(updatesByReport.get(r.id) ?? {})
      .map((u) => ({
        status,
        body: u.attributes.message,
        at: u.attributes.published_at ? new Date(u.attributes.published_at) : startedAt,
      }))
      .sort((x, y) => y.at.getTime() - x.at.getTime());
    incidents.push({
      id: r.id,
      title: a.title,
      impact: betterStackImpact(a.report_type, a.aggregate_state),
      status,
      active: active && status !== 'completed',
      components: a.affected_resources.map((x) => x.status_page_resource_id).filter(Boolean),
      startedAt,
      resolvedAt: active ? null : endedAt,
      updates,
    });
  }
  return snapshotFromIncidents('betterstack', components, incidents, now);
}

/**
 * Better Stack Uptime status page (owner account; `BETTER_STACK_API_TOKEN` and
 * `BETTER_STACK_STATUS_PAGE_ID`). Read-only; incidents are posted in Better Stack itself. The
 * response is kept for `ttlMs` so every console page doesn't call the provider.
 */
export function betterStackStatusPage(opts: {
  token: string;
  statusPageId: string;
  fetch?: typeof fetch;
  ttlMs?: number;
  baseUrl?: string;
}): StatusPage {
  const doFetch = opts.fetch ?? fetch;
  const base = `${opts.baseUrl ?? 'https://uptime.betterstack.com'}/api/v2/status-pages/${encodeURIComponent(opts.statusPageId)}`;
  const ttl = opts.ttlMs ?? 30_000;
  let cached: { at: number; value: StatusSnapshot } | null = null;
  const get = async (path: string) => {
    const res = await doFetch(`${base}${path}`, {
      headers: { authorization: `Bearer ${opts.token}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`status page: HTTP ${res.status}`);
    return res.json() as Promise<unknown>;
  };
  return {
    provider: 'betterstack',
    async snapshot() {
      if (cached && Date.now() - cached.at < ttl) return cached.value;
      const [resources, reports] = await Promise.all([get('/resources'), get('/status-reports')]);
      const ids = list(Report)
        .parse(reports)
        .map((r) => r.id)
        .slice(0, 10);
      const updates = new Map<string, unknown>(
        await Promise.all(
          ids.map(
            async (id) =>
              [id, await get(`/status-reports/${encodeURIComponent(id)}/status-updates`)] as const,
          ),
        ),
      );
      const value = betterStackSnapshot(resources, reports, updates, new Date());
      cached = { at: Date.now(), value };
      return value;
    },
  };
}

/** Open a fake incident as the app role (the web's dev-only route; staff use platform_reader). */
export async function postFakeIncident(input: PostIncidentInput, actor: string): Promise<string | null> {
  const [row] = await withoutTenant((tx) => tx.execute<{ id: string }>(postFakeIncidentSql(input, actor)));
  return row?.id ?? null;
}

/** Update a fake incident as the app role. False when it is unknown or already closed. */
export async function updateFakeIncident(input: UpdateIncidentInput): Promise<boolean> {
  const [row] = await withoutTenant((tx) => tx.execute<{ updated: boolean }>(updateFakeIncidentSql(input)));
  return row?.updated === true;
}
