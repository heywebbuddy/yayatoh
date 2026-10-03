import type { TenantTx } from '@yayatoh/db';
import { DomainError } from '@yayatoh/kernel';
import { type SQL, sql } from 'drizzle-orm';
import { NO_SHOW_PRIOR_BPS } from '../stats/formulas.ts';
import { RFM_SQL } from '../stats/rfm.ts';
import {
  type Comparison,
  type SegmentCondition,
  type SegmentDefinition,
  type SegmentNode,
  type SegmentScope,
  type StatsMetric,
  scopeKey,
} from './dsl.ts';

/**
 * What a scope means for this org at query time: `null` = every event, otherwise these event ids
 * (possibly none). The audiences module resolves series, editions and date ranges through the
 * events module; crm never reads the events schema.
 */
export type ResolvedScopes = ReadonlyMap<string, readonly string[] | null>;

export interface CompileOptions {
  readonly scopes: ResolvedScopes;
  /** IANA timezone the definition's dates are read in (the org's). */
  readonly timezone: string;
  /**
   * Event-scoped access (an event role): only contacts on this event's list (or its buyers) can
   * match. The caller has already refused scopes that reach other events.
   */
  readonly restrictToEventId?: string | null;
}

// Fixed SQL fragments, chosen by enum values (never by text a person typed).
const OPS: Readonly<Record<Comparison, SQL>> = {
  gte: sql.raw('>='),
  gt: sql.raw('>'),
  lte: sql.raw('<='),
  lt: sql.raw('<'),
  eq: sql.raw('='),
};
const TOTAL_COLUMNS = {
  events: sql.raw('pr.events'),
  eventsAttended: sql.raw('pr.events_attended'),
  tickets: sql.raw('pr.tickets'),
  orders: sql.raw('pr.orders'),
} as const;
const CONSENT_COLUMNS = {
  email: sql.raw('pr.email_consent'),
  sms: sql.raw('pr.sms_consent'),
} as const;

/** A bound uuid[]: one parameter per element. */
const uuidArray = (ids: readonly string[]) =>
  ids.length
    ? sql`ARRAY[${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )}]::uuid[]`
    : sql`'{}'::uuid[]`;

/** The start of a calendar day in the org timezone, as timestamptz. */
const dayStart = (date: string, tz: string) => sql`(${date}::date::timestamp at time zone ${tz})`;
const dayEnd = (date: string, tz: string) => sql`((${date}::date + 1)::timestamp at time zone ${tz})`;

function scopeSql(scope: SegmentScope, opts: CompileOptions): SQL {
  const key = scopeKey(scope);
  if (!opts.scopes.has(key)) throw new DomainError('internal', `Unresolved segment scope ${key}`);
  const ids = opts.scopes.get(key) ?? null;
  if (ids === null) return sql`true`;
  if (ids.length === 0) return sql`false`;
  return sql`p.event_id = any(${uuidArray(ids)})`;
}

function participationSql(c: Extract<SegmentCondition, { type: 'participation' }>, o: CompileOptions): SQL {
  const parts: SQL[] = [sql`p.contact_id = c.id`, scopeSql(c.scope, o)];
  parts.push(c.role === 'buyer' ? sql`p.orders > 0` : sql`p.registered`);
  if (c.ticketTypeIds.length) parts.push(sql`p.ticket_type_ids && ${uuidArray(c.ticketTypeIds)}`);
  if (c.seated !== null) parts.push(sql`p.has_seat = ${c.seated}`);
  if (c.checkedIn !== null) parts.push(sql`p.checked_in = ${c.checkedIn}`);
  if (c.registeredFrom) parts.push(sql`p.registered_at >= ${dayStart(c.registeredFrom, o.timezone)}`);
  if (c.registeredTo) parts.push(sql`p.registered_at < ${dayEnd(c.registeredTo, o.timezone)}`);
  const exists = sql`exists (select 1 from crm.event_participation p where ${sql.join(parts, sql` and `)})`;
  return c.negate ? sql`not ${exists}` : exists;
}

function conditionSql(c: SegmentCondition, o: CompileOptions): SQL {
  switch (c.type) {
    case 'participation':
      return participationSql(c, o);
    case 'spend':
      return sql`(select coalesce(sum(p.spend_minor), 0) from crm.event_participation p
        where p.contact_id = c.id and p.currency = ${c.currency} and ${scopeSql(c.scope, o)}) ${OPS[c.op]} ${c.amountMinor}`;
    case 'consent': {
      // The profile's consent columns are refreshed in the transaction that records a consent.
      const col = sql`coalesce(${CONSENT_COLUMNS[c.channel]}, 'none')`;
      return c.granted ? sql`${col} = 'granted'` : sql`${col} <> 'granted'`;
    }
    case 'label': {
      const exists = sql`exists (select 1 from crm.event_participation p
        where p.contact_id = c.id and p.registered and ${scopeSql(c.scope, o)} and ${c.label} = any(p.labels))`;
      return c.negate ? sql`not ${exists}` : exists;
    }
    case 'totals':
      return sql`coalesce(${TOTAL_COLUMNS[c.metric]}, 0) ${OPS[c.op]} ${c.value}`;
    case 'engagement':
      return sql`(select coalesce(sum(p.score), 0) from crm.event_engagement p
        where p.contact_id = c.id and ${scopeSql(c.scope, o)}) ${OPS[c.op]} ${c.value}`;
    case 'seen': {
      const col = c.which === 'first' ? sql.raw('pr.first_seen_at') : sql.raw('pr.last_seen_at');
      const parts: SQL[] = [sql`${col} is not null`];
      if (c.from) parts.push(sql`${col} >= ${dayStart(c.from, o.timezone)}`);
      if (c.to) parts.push(sql`${col} < ${dayEnd(c.to, o.timezone)}`);
      return sql`(${sql.join(parts, sql` and `)})`;
    }
    case 'stats':
      return statsSql(c);
    case 'ltv':
      return sql`coalesce((select v.spend_minor from crm.contact_stats v
        where v.contact_id = c.id and v.currency = ${c.currency}), 0) ${OPS[c.op]} ${c.amountMinor}`;
  }
}

// M6.1b stats columns of `crm.contact_scores` (a contact without a row has none of the counts and
// the no-show prior), and the RFM quintile columns of `RFM_SQL`.
const SCORE_COLUMNS: Readonly<Partial<Record<StatsMetric, { col: SQL; missing: number; scale: number }>>> = {
  engagement: { col: sql.raw('s.engagement_score'), missing: 0, scale: 1 },
  noShowPct: { col: sql.raw('s.no_show_bps'), missing: NO_SHOW_PRIOR_BPS, scale: 100 },
  sessionsAttended: { col: sql.raw('s.sessions_attended'), missing: 0, scale: 1 },
  campaignsOpened: { col: sql.raw('s.campaigns_opened'), missing: 0, scale: 1 },
};
const RFM_COLUMNS: Readonly<Partial<Record<StatsMetric, SQL>>> = {
  rfmRecency: sql.raw('q.recency'),
  rfmFrequency: sql.raw('q.frequency'),
  rfmMonetary: sql.raw('q.monetary'),
};

function statsSql(c: Extract<SegmentCondition, { type: 'stats' }>): SQL {
  const score = SCORE_COLUMNS[c.metric];
  if (score)
    return sql`coalesce((select ${score.col} from crm.contact_scores s where s.contact_id = c.id), ${score.missing}) ${OPS[c.op]} ${c.value * score.scale}`;
  const rfm = RFM_COLUMNS[c.metric];
  if (!rfm) throw new DomainError('internal', `Unknown stats metric ${c.metric}`);
  // Uncorrelated: the org's quintiles are ranked once per query, outside the population none match.
  return sql`c.id in (select q.contact_id from ${RFM_SQL} q where ${rfm} ${OPS[c.op]} ${c.value})`;
}

function nodeSql(n: SegmentNode, o: CompileOptions): SQL {
  if (n.type !== 'group') return conditionSql(n, o);
  if (n.conditions.length === 0) return sql`true`;
  const joiner = n.op === 'and' ? sql` and ` : sql` or `;
  return sql`(${sql.join(
    n.conditions.map((c) => nodeSql(c, o)),
    joiner,
  )})`;
}

/**
 * The WHERE clause over `crm.contacts c left join crm.contact_profile pr`: live (not merged, not
 * erased) contacts matching the definition. The definition must already be parsed.
 */
export function compileSegment(def: SegmentDefinition, opts: CompileOptions): SQL {
  const parts: SQL[] = [sql`c.merged_into is null`, sql`c.email_norm not like '%@erased.invalid'`];
  if (opts.restrictToEventId)
    parts.push(sql`exists (select 1 from crm.event_participation p
      where p.contact_id = c.id and p.event_id = ${opts.restrictToEventId} and (p.registered or p.orders > 0))`);
  parts.push(nodeSql(def.root, opts));
  return sql.join(parts, sql` and `);
}

const FROM = sql`crm.contacts c left join crm.contact_profile pr on pr.org_id = c.org_id and pr.contact_id = c.id`;

/** Counting is bounded: a pathological definition fails fast instead of holding a connection. */
async function bounded(tx: TenantTx) {
  await tx.execute(sql`set local statement_timeout = '10s'`);
}

export async function countSegmentTx(tx: TenantTx, where: SQL): Promise<number> {
  await bounded(tx);
  const [row] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from ${FROM} where ${where}`);
  return Number(row?.n ?? 0);
}

/** One page of matching contacts, ordered by id (stable paging). Internal fields: callers serialize. */
export async function segmentPageTx(
  tx: TenantTx,
  where: SQL,
  page: { readonly limit: number; readonly afterId?: string | null },
) {
  await bounded(tx);
  const after = page.afterId ? sql` and c.id > ${page.afterId}` : sql``;
  const rows = await tx.execute<{
    id: string;
    name: string | null;
    email: string;
    events: number | null;
    events_attended: number | null;
    last_seen_at: Date | string | null;
  }>(sql`select c.id, c.name, c.email, pr.events, pr.events_attended, pr.last_seen_at
    from ${FROM} where ${where}${after} order by c.id limit ${Math.min(Math.max(page.limit, 1), 1000)}`);
  return rows.map((r) => ({
    contactId: r.id,
    name: r.name,
    email: r.email,
    events: Number(r.events ?? 0),
    eventsAttended: Number(r.events_attended ?? 0),
    lastSeenAt: r.last_seen_at === null ? null : new Date(r.last_seen_at),
  }));
}

/** Contact ids matching (bulk export resolution), capped by the caller. */
export async function segmentContactIdsTx(tx: TenantTx, where: SQL, limit: number): Promise<string[]> {
  await bounded(tx);
  const rows = await tx.execute<{ id: string }>(
    sql`select c.id from ${FROM} where ${where} order by c.id limit ${limit}`,
  );
  return rows.map((r) => r.id);
}

/** Export rows for these contacts (allowlisted columns; the export serializes what it writes). */
export async function segmentExportRowsTx(tx: TenantTx, contactIds: readonly string[]) {
  if (contactIds.length === 0) return [];
  const rows = await tx.execute<{
    id: string;
    name: string | null;
    email: string;
    events: number | null;
    events_attended: number | null;
    tickets: number | null;
    first_seen_at: Date | string | null;
    last_seen_at: Date | string | null;
    email_consent: string | null;
    sms_consent: string | null;
  }>(sql`select c.id, c.name, c.email, pr.events, pr.events_attended, pr.tickets, pr.first_seen_at,
      pr.last_seen_at, pr.email_consent, pr.sms_consent
    from ${FROM} where c.id = any(${uuidArray(contactIds)})`);
  const d = (v: Date | string | null) => (v === null ? null : new Date(v));
  return rows.map((r) => ({
    contactId: r.id,
    name: r.name,
    email: r.email,
    events: Number(r.events ?? 0),
    eventsAttended: Number(r.events_attended ?? 0),
    tickets: Number(r.tickets ?? 0),
    firstSeenAt: d(r.first_seen_at),
    lastSeenAt: d(r.last_seen_at),
    emailConsent: r.email_consent ?? 'none',
    smsConsent: r.sms_consent ?? 'none',
  }));
}
